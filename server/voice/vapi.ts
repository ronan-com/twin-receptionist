import { typeOfNumber, type Business, type CallMessage, type NumberOrder, type Settings } from "../../src/lib/shared";
import { afterHoursGreeting, automationInstructions, greetingFor, loadAutomations, openNow, transferSpec } from "../automations";
import { publicUrl } from "../booking";
import { sql } from "../db";
import { greetingOf, ValidationError } from "../prompt";
import { UI_PRODUCT } from "../product";
import { currentOrg } from "../telnyx";
import { VapiError, vapiCredsFor } from "./config";
import type { Conversation, VoiceProvider } from "./provider";
import { toolAllowed } from "./tools";
import { BOOKING_TOOL_DEFS } from "../booking";
import { callRecord, eventsSecret, toVapiScript, vapiAssistantBody, vapiVoiceList, type VapiBuild } from "./vapiMap";

const BASE = "https://api.vapi.ai";


/**
 * One call to Vapi's REST API with the current org's private key (or `withKey`, to check a
 * key before saving it). Errors become a VapiError with a message a person can act on.
 */
export async function vapi<T = any>(method: string, path: string, body?: unknown, withKey?: string): Promise<T> {
  const key = withKey ?? (await vapiCredsFor(currentOrg())).key;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new VapiError(502, `Could not reach the phone service: ${(err as Error).message}`);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error bodies fall through to the generic message below.
  }
  if (!res.ok) {
    const m = json?.message;
    const detail = (Array.isArray(m) ? m.join("; ") : m) || json?.error || text.slice(0, 200) || res.statusText;
    throw new VapiError(res.status, `The phone service said: ${detail}`);
  }
  return json as T;
}

/** A cheap read to check a private key: lists at most one assistant. */
export async function checkVapiKey(key: string): Promise<void> {
  await vapi("GET", "/assistant?limit=1", undefined, key);
}

// ---- Building the assistant ----------------------------------------------------------

type AutomationRow = { stored: boolean; settings: import("../automations").AutomationSettings } | null;

/** Everything Vapi needs for one receptionist, from what Twin knows. Pure: the caller supplies the saved automations and the public address. */
export function buildVapi(client: Business, settings: Settings, instructions: string, row: AutomationRow, base: string, at = new Date()): VapiBuild {
  // Paused by the business, or nothing saved yet: the script and greeting go as they are.
  const a = row?.stored && !settings.paused ? row.settings : null;
  const open = openNow(settings, at);
  const withClient = { ...client, settings };
  const script = toVapiScript(instructions + (a ? automationInstructions(withClient, a, "vapi") : ""), open);
  let greeting = greetingOf(settings);
  if (a) greeting = a.hoursMode.enabled && !open ? afterHoursGreeting(withClient, a) : greetingFor(settings.greeting, a);
  const live = Boolean(client.booking?.enabled && base);
  return {
    name: `${settings.businessName} · ${UI_PRODUCT}`,
    script,
    greeting,
    voiceId: settings.voiceId,
    tools: live ? BOOKING_TOOL_DEFS.map((d) => d.name).filter((n) => toolAllowed(settings, n)) : [],
    hookBase: live ? `${base}/hooks/${client.id}` : null,
    toolKey: client.booking?.token ?? "",
    events: base ? { url: `${base}/hooks/vapi/${client.id}`, secret: eventsSecret(client.id) } : null,
    transfer: a ? transferSpec(a) : null,
    recording: a?.recording.enabled ?? false,
    language: a?.language.code ?? "en-AU",
    maxMinutes: a?.callLimits.maxMinutes ?? 30,
  };
}

async function buildFor(client: Business, settings: Settings, instructions: string): Promise<VapiBuild> {
  const row = await loadAutomations(client.id).catch(() => null);
  return buildVapi(client, settings, instructions, row, publicUrl());
}

async function push(client: Business, settings: Settings, instructions: string): Promise<void> {
  await vapi("PATCH", `/assistant/${client.assistantId}`, vapiAssistantBody(await buildFor(client, settings, instructions)));
}

// ---- Numbers --------------------------------------------------------------------------

const toOrder = (n: any): NumberOrder => ({
  id: String(n.id ?? ""),
  status: "success",
  requirementsMet: true,
  phoneNumbers: [String(n.number ?? n.sipUri ?? "")].filter(Boolean),
  createdAt: String(n.createdAt ?? new Date().toISOString()),
});

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Brings a number onto the receptionist. input.source is "twilio" (number, accountSid, authToken),
 * "telnyx" (number, apiKey) or "vapi" (areaCode: a free US number, inbound calls only).
 */
export async function attachNumber(client: Business, input: unknown): Promise<NumberOrder> {
  const b = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
  const assistantId = client.assistantId;
  const name = `${client.settings.businessName}`.slice(0, 40);
  const source = str(b.source, 10);
  if (source === "vapi") {
    const areaCode = str(b.areaCode, 3);
    if (!/^\d{3}$/.test(areaCode)) throw new ValidationError("Enter a 3-digit US area code.");
    return toOrder(await vapi("POST", "/phone-number", { provider: "vapi", numberDesiredAreaCode: areaCode, assistantId, name }));
  }
  if (source !== "twilio" && source !== "telnyx") throw new ValidationError("Choose where the number comes from: Twilio, Telnyx, or a free US number.");
  const number = str(b.number, 20).replace(/[\s()-]/g, "");
  if (!E164.test(number)) throw new ValidationError("Enter the number with its country code, like +61412345678.");
  if (source === "twilio") {
    const sid = str(b.accountSid, 60);
    const token = str(b.authToken, 80);
    if (!/^AC[0-9a-f]{32}$/i.test(sid)) throw new ValidationError("That isn't a Twilio Account SID. It starts with AC and is 34 characters.");
    if (!token) throw new ValidationError("Paste the Twilio auth token.");
    return toOrder(await vapi("POST", "/phone-number", { provider: "twilio", number, twilioAccountSid: sid, twilioAuthToken: token, assistantId, name }));
  }
  // Telnyx
  const apiKey = str(b.apiKey, 300);
  if (!apiKey) throw new ValidationError("Paste the Telnyx API key the number is on.");
  // Vapi keeps provider keys as credentials; the number is imported against one.
  const cred = await vapi<{ id: string }>("POST", "/credential", { provider: "telnyx", apiKey, name: `${name} Telnyx`.slice(0, 40) });
  return toOrder(await vapi("POST", "/phone-number", { provider: "telnyx", number, credentialId: cred.id, assistantId, name }));
}

// ---- The adapter ------------------------------------------------------------------------

export const vapiProvider: VoiceProvider = {
  id: "vapi",
  label: "Vapi",

  async createAssistant(settings, instructions, clientId) {
    const draft = { id: clientId, assistantId: "", settings, instructions, createdAt: "", updatedAt: "" } as Business;
    const created = await vapi<{ id?: string }>("POST", "/assistant", vapiAssistantBody(await buildFor(draft, settings, instructions)));
    if (!created?.id) throw new VapiError(502, "The phone service did not return an assistant ID.");
    return created.id;
  },

  async syncAssistant(client, instructions) {
    await push(client, client.settings, instructions);
  },

  async updateAssistant(client, settings, instructions) {
    await push(client, settings, instructions);
  },

  async applyAutomations(client) {
    await push(client, client.settings, client.instructions);
  },

  async deleteAssistant(client) {
    await vapi("DELETE", `/assistant/${client.assistantId}`).catch((err) => {
      if (!(err instanceof VapiError && err.status === 404)) throw err;
    });
  },

  async recentConversations(assistantId, limit): Promise<Conversation[]> {
    const calls = await vapi<any[]>("GET", `/call?assistantId=${encodeURIComponent(assistantId)}&limit=${Math.min(limit, 100)}`);
    return (Array.isArray(calls) ? calls : []).map((c) => {
      const r = callRecord({}, c);
      return {
        id: r.id,
        startedAt: r.startedAt ?? "",
        endedAt: r.endedAt ?? "",
        channel: r.channel,
        from: r.channel === "web" ? "" : (r.from ?? ""),
        to: r.to ?? "",
        simulated: false,
      };
    });
  },

  async callDetail(business, conversationId): Promise<{ summary: string; messages: CallMessage[] }> {
    // The end-of-call report stored it already; otherwise ask Vapi for the call.
    const [row] = await sql`select transcript, summary from call_log where provider_call_id = ${conversationId} and client_id = ${business.id} and transcript is not null`;
    if (row) return { summary: row.summary ?? "", messages: (row.transcript as CallMessage[]) ?? [] };
    const call = await vapi<any>("GET", `/call/${encodeURIComponent(conversationId)}`);
    if (call?.assistantId !== business.assistantId) throw new ValidationError("Unknown call.");
    const r = callRecord({}, call);
    return { summary: r.summary ?? "", messages: r.transcript };
  },

  async voices() {
    return vapiVoiceList();
  },

  numbers: {
    support: () => ({
      provider: "vapi",
      buy: false,
      import: true,
      note: "Vapi only gives away US numbers. For an Australian number, bring one you already have from Twilio or Telnyx and Vapi will answer it.",
    }),
    async state(_ctx, client) {
      const list = await vapi<any[]>("GET", "/phone-number?limit=100");
      const mine = (Array.isArray(list) ? list : []).filter((n) => n.assistantId === client.assistantId);
      return {
        numbers: mine.map((n) => ({ id: String(n.id), phoneNumber: String(n.number ?? n.sipUri ?? ""), status: String(n.status ?? "active"), type: n.number ? typeOfNumber(String(n.number)) : "" })),
        pending: [],
        balance: null,
      };
    },
    async search() {
      return [];
    },
    async buy() {
      throw new ValidationError("Vapi doesn't sell Australian numbers. Bring a number from Twilio or Telnyx instead.");
    },
    attach: attachNumber,
  },

  async webCall(assistantId) {
    const { publicKey } = await vapiCredsFor(currentOrg());
    if (!publicKey) throw new ValidationError("Add your Vapi public key in Connections to use the test call.");
    return { provider: "vapi", assistantId, publicKey };
  },
};

