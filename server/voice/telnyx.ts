import type { AvailableNumber, Business, CallMessage, NumberCountry, NumberOrder, NumberType, Settings, Voice } from "../../src/lib/shared";
import { bookingLive, bookingTools, publicUrl } from "../booking";
import { ensureAutomationRow, overlayPayload, telephonyPayload, withAutomations } from "../automations";
import { greetingOf } from "../prompt";
import { UI_PRODUCT } from "../product";
import { fakeProvider } from "../sandbox";
import { TelnyxError, telnyx } from "../telnyx";
import { telnyxSettings } from "../agencies";
import { availableNumbers, buyNumber, callSummary, connectedNumbers, openOrders, voiceAppFor } from "../numbers";
import { ValidationError } from "../prompt";
import { migrateTexting, removeTextingProfile, textingProfileId } from "../texting";
import type { Conversation, VoiceProvider } from "./provider";

// The Telnyx engine: the code that used to sit in server/index.ts, server/calls.ts and
// server/automations.ts, moved here as it was so the default behaviour is the same.

const MODEL = "zai-org/GLM-5.3-Flash";

// Voices that suit a front desk, shown first in the picker.
const RECOMMENDED = [
  "Grace - Helpful Hand",
  "Bronte - Trusted Guide",
  "Ella - Caring Scout",
  "Eleanor - Composed Clarifier",
  "Arlo - Service Specialist",
  "Cooper - Friendly Mate",
  "Heath - Calm & Composed",
  "Fraser - Trusted Communicator",
];

let voiceCache: Voice[] | null = null;

// Local tests run with a fake provider key: one stand-in voice (see fakeProvider).
const DEMO_VOICE: Voice = { id: "demo-voice", name: "Grace - Helpful Hand", label: "Demo voice", gender: "female", recommended: true };

const HANGUP = {
  type: "hangup",
  hangup: { description: "End the call once the caller has said goodbye or has nothing else to ask." },
};

function assistantFields(s: Settings, instructions: string) {
  const who = s.receptionistName || "your receptionist";
  return {
    name: `${s.businessName} · ${UI_PRODUCT}`,
    description: `Created by the ${UI_PRODUCT} setup.`,
    instructions,
    greeting: greetingOf(s),
    voice_settings: { voice: s.voiceId, voice_speed: 1.0 },
    widget_settings: {
      theme: "dark",
      position: "static",
      default_state: "expanded",
      start_call_text: `Talk to ${who}`,
    },
  };
}

// ---- Voice previews ----------------------------------------------------------------------
// The Play button in the voice pickers: a short line in the voice, made by Telnyx's text-to-speech
// the first time someone plays it and kept in memory after (a few KB each, a few dozen voices).

export const PREVIEW_LINE = "Hi, thanks for calling. You've reached the front desk. How can I help you today?";
const previews = new Map<string, Buffer>();

/** An mp3 of `PREVIEW_LINE` in a Telnyx voice (ids like "Telnyx.Ultra.<uuid>"). */
export async function telnyxVoicePreview(voiceId: string): Promise<Buffer> {
  if (!/^Telnyx\.[A-Za-z0-9_.-]{2,100}$/.test(voiceId)) throw new ValidationError("Unknown voice.");
  const hit = previews.get(voiceId);
  if (hit) return hit;
  const res = await telnyx<{ base64_audio?: string }>("POST", "/text-to-speech/speech", { text: PREVIEW_LINE, voice: voiceId, language: "en-AU", output_type: "base64_output" });
  if (!res?.base64_audio) throw new TelnyxError(502, "The phone service didn't return the preview.");
  const audio = Buffer.from(res.base64_audio, "base64");
  if (previews.size > 200) previews.clear();
  previews.set(voiceId, audio);
  return audio;
}

export const telnyxProvider: VoiceProvider = {
  id: "telnyx",
  label: "Telnyx",

  async createAssistant(settings, instructions) {
    const created = await telnyx<{ id?: string; data?: { id: string } }>("POST", "/ai/assistants", {
      ...assistantFields(settings, instructions),
      model: MODEL,
      transcription: { model: "deepgram/flux", language: "en" },
      tools: [HANGUP],
      enabled_features: ["telephony"],
      // Lets the browser test call connect without a phone number.
      telephony_settings: { supports_unauthenticated_web_calls: true },
      tags: ["twin-receptionist"],
    });
    const assistantId = created.data?.id ?? created.id;
    if (!assistantId) throw new TelnyxError(502, "The phone service did not return an assistant ID.");
    // Texting (our own messaging profile, server/texting.ts) is set up when a number is connected for texts.
    return assistantId;
  },

  async syncAssistant(client, instructions, allowedTools) {
    // Paused by the business: only the take-a-message tool stays (server/prompt.ts).
    const booking = bookingLive(client) ? bookingTools(client, publicUrl()).filter((t: any) => allowedTools.includes(t.webhook?.name)) : [];
    const tools = [HANGUP, ...booking];
    await telnyx("POST", `/ai/assistants/${client.assistantId}`, await withAutomations(client, { instructions, tools }));
  },

  async updateAssistant(client, settings, instructions) {
    // Telnyx updates an assistant with POST, not PATCH.
    await telnyx("POST", `/ai/assistants/${client.assistantId}`, await withAutomations({ ...client, settings }, assistantFields(settings, instructions)));
  },

  async applyAutomations(synced) {
    const res = await telnyx<any>("GET", `/ai/assistants/${synced.assistantId}`);
    const current = (res.data ?? res)?.telephony_settings ?? {};
    const row = await ensureAutomationRow(synced.id);
    const greet = synced.settings.paused ? {} : overlayPayload(synced, row.settings, { greeting: synced.settings.greeting }, { publicUrl: publicUrl(), token: row.token, callerMemory: true });
    await telnyx("POST", `/ai/assistants/${synced.assistantId}`, { ...greet, ...telephonyPayload(row.settings, current) });
    // A receptionist whose texts were still answered by its Telnyx assistant moves to ours.
    await migrateTexting(synced).catch((err) => console.error(`[texting ${synced.id}] couldn't move to our own texting`, err.message));
  },

  async deleteAssistant(client) {
    const profileId = await textingProfileId(client).catch(() => null);
    await telnyx("DELETE", `/ai/assistants/${client.assistantId}`).catch((err) => {
      // Already gone on Telnyx's side is fine; anything else should surface.
      if (!(err instanceof TelnyxError && err.status === 404)) throw err;
    });
    if (profileId) {
      await removeTextingProfile(profileId, client).catch((err) =>
        console.error(`[texting ${client.id}] couldn't remove messaging profile`, err.message),
      );
    }
  },

  async recentConversations(assistantId, limit): Promise<Conversation[]> {
    const query = `metadata-%3Eassistant_id=eq.${encodeURIComponent(assistantId)}&order=created_at.desc&limit=${limit}`;
    const res = await telnyx<{ data?: any[] }>("GET", `/ai/conversations?${query}`);
    return (res.data ?? []).map((c) => {
      const meta = c.metadata ?? {};
      // Browser test calls arrive as phone calls from a throwaway SIP login, so
      // tell them apart by the "anonymous@" target and hide the SIP address.
      const web = String(meta.telnyx_agent_target ?? "").startsWith("anonymous@");
      return {
        id: c.id,
        startedAt: c.created_at ?? "",
        endedAt: c.last_message_at ?? c.updated_at ?? "",
        channel: web ? "web" : (meta.telnyx_conversation_channel ?? "call"),
        from: web ? "" : (meta.telnyx_end_user_target ?? ""),
        to: web ? "" : (meta.telnyx_agent_target ?? ""),
        simulated: meta.twin_simulator === "true",
      };
    });
  },

  async callDetail(business, conversationId): Promise<{ summary: string; messages: CallMessage[] }> {
    const convo = await telnyx<{ data?: any }>("GET", `/ai/conversations/${conversationId}`);
    if ((convo.data?.metadata ?? {}).assistant_id !== business.assistantId) throw new ValidationError("Unknown call.");

    const [res, summary] = await Promise.all([
      telnyx<{ data?: any[] }>("GET", `/ai/conversations/${conversationId}/messages`),
      // The summary is a nice-to-have; never let it block the transcript.
      callSummary(conversationId).catch(() => ""),
    ]);
    const messages = (res.data ?? [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && (m.text || m.content))
      .map((m) => ({ role: m.role, text: String(m.text ?? m.content), at: m.sent_at ?? m.created_at ?? "" }))
      .sort((a, b) => a.at.localeCompare(b.at));
    return { summary, messages };
  },

  async voices() {
    if (fakeProvider()) return [DEMO_VOICE];
    if (voiceCache) return voiceCache;
    const res = await telnyx<{ voices?: any[]; data?: any[] }>("GET", "/text-to-speech/voices");
    const all = res.voices ?? res.data ?? [];
    const seen = new Set<string>();
    const voices: Voice[] = [];
    for (const v of all) {
      const australian = v.language === "en-AU" || v.accent === "Australian";
      if (v.provider !== "telnyx" || !v.hosted || !australian || seen.has(v.name)) continue;
      seen.add(v.name);
      voices.push({
        id: v.id,
        name: v.name,
        label: v.label ?? "",
        gender: v.gender ?? "",
        recommended: RECOMMENDED.includes(v.name),
        accent: "Australian",
        maker: "Telnyx",
        previewUrl: `/api/voices/preview?voice=${encodeURIComponent(v.id)}`,
      });
    }
    voices.sort(
      (a, b) =>
        Number(b.recommended) - Number(a.recommended) ||
        RECOMMENDED.indexOf(a.name) - RECOMMENDED.indexOf(b.name) ||
        a.name.localeCompare(b.name),
    );
    voiceCache = voices;
    return voices;
  },

  numbers: {
    support: () => ({ provider: "telnyx", buy: true, import: false, twilio: false, note: "Numbers are bought here and charged to the Telnyx account each month. Twilio numbers work with the Vapi voice engine." }),
    async state(ctx, client) {
      const voiceApp = await voiceAppFor(client.assistantId);
      const [numbers, pending, balance] = await Promise.all([
        connectedNumbers(voiceApp),
        openOrders(client.id),
        // The balance is whoever's money pays for the numbers: an agency sees its own,
        // the platform's is only for the platform team.
        telnyxSettings(ctx).then((t) => t.balance),
      ]);
      return { numbers, pending, balance };
    },
    search: (type: NumberType, country: NumberCountry): Promise<AvailableNumber[]> => availableNumbers(type, country),
    async buy(client, input): Promise<NumberOrder> {
      return buyNumber(await voiceAppFor(client.assistantId), client.id, input);
    },
    async attach(): Promise<NumberOrder> {
      throw new ValidationError("With Telnyx, numbers are bought here. To bring a number from elsewhere, use Vapi.");
    },
    async detachAll(client) {
      // The numbers stay on the agency's Telnyx account. Once this receptionist is off Telnyx its
      // voice app is no longer one of ours, so they show under "numbers you already own", ready
      // to attach to a Telnyx receptionist.
      return (await connectedNumbers(await voiceAppFor(client.assistantId)).catch(() => [])).map((n) => n.phoneNumber);
    },
  },

  async webCall(assistantId) {
    return { provider: "telnyx", assistantId };
  },
};

