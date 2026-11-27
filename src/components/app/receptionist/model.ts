import { api } from "@/lib/api/base";
import type { AgentRow, ReceptionistUpdate } from "@/lib/api/manage";
import type { AutomationSettings, AutomationsPatch } from "@/lib/api/automations";

// The receptionist page's data (area R). Server side: server/routes/manage.ts
// (/api/manage/<id>/receptionist and /receptionist/pause) and server/prompt.ts, which
// puts every field below into the receptionist's script. Transfers, after-hours,
// language and call limits are area T's automations (/api/automations/<id>).

export type ToneKey = "friendly" | "professional" | "calm" | "upbeat" | "direct";
export type DialectKey = "en-AU" | "en-GB" | "en-NZ" | "en-US";
export type CollectKey = "email" | "address" | "reason" | "new_customer" | "preferred_time";

/** The receptionist as /receptionist returns it, with our extra fields. */
export type ReceptionistRow = AgentRow & {
  paused_by: "agency" | "business" | null;
  paused_at: string | null;
  paused_message: string;
  dialect: DialectKey;
  closing_line: string;
  faq_style: "brief" | "detailed";
  collect_fields: CollectKey[];
  phone_numbers: string[];
};

export type ReceptionistSave = ReceptionistUpdate & {
  personality?: string;
  dialect?: DialectKey;
  closing_line?: string;
  restricted_topics?: string[];
  faq_style?: "brief" | "detailed";
  qualification_questions?: string[];
  collect_fields?: CollectKey[];
  booking_rules?: ReceptionistUpdate["booking_rules"] & { lead_webhook?: string; require_approval?: boolean };
};

export type ReceptionistSaved = { agent: ReceptionistRow; applied: boolean; demo: boolean; changed?: string[]; warning?: string };

const base = (id: string) => `/api/manage/${encodeURIComponent(id)}`;

export const saveReceptionist = (businessId: string, body: ReceptionistSave) => api.put<ReceptionistSaved>(`${base(businessId)}/receptionist`, body);

export const pauseReceptionist = (businessId: string, body: { paused: boolean; message?: string }) =>
  api.post<ReceptionistSaved>(`${base(businessId)}/receptionist/pause`, body);

export const TONE_OPTIONS: { value: ToneKey; label: string; hint: string }[] = [
  { value: "friendly", label: "Friendly", hint: "Warm and relaxed, like a good local receptionist." },
  { value: "professional", label: "Professional", hint: "Polite, clear and efficient." },
  { value: "calm", label: "Calm", hint: "Patient and reassuring, unhurried." },
  { value: "upbeat", label: "Upbeat", hint: "Positive, with genuine energy." },
  { value: "direct", label: "Direct", hint: "Straight to the point, little small talk." },
];

export const DIALECT_OPTIONS: { value: DialectKey; label: string }[] = [
  { value: "en-AU", label: "Australian English" },
  { value: "en-GB", label: "British English" },
  { value: "en-NZ", label: "New Zealand English" },
  { value: "en-US", label: "American English" },
];

export const COLLECT_OPTIONS: { value: CollectKey; label: string; hint: string; ask: string }[] = [
  { value: "email", label: "Email address", hint: "Spelled back to check.", ask: "And what's the best email address for you?" },
  { value: "address", label: "Street address", hint: "Where the job or visit is.", ask: "What's the address for the visit?" },
  { value: "reason", label: "What it's about", hint: "A short description, saved with the request.", ask: "And briefly, what's it about?" },
  { value: "new_customer", label: "New or returning", hint: "Whether they've been to you before.", ask: "Have you been to us before?" },
  { value: "preferred_time", label: "Times that suit", hint: "Days and times that usually work for them.", ask: "What days and times usually suit you?" },
];

export const DEFAULT_PAUSE_MESSAGE = "Thanks for calling. We're not taking bookings over the phone right now, but I can take a message and the team will get back to you.";

/* ---------------- Automations diff (only the changed fields are sent) ---------------- */

export function automationsPatch(next: AutomationSettings, saved: AutomationSettings): AutomationsPatch {
  const patch: Record<string, Record<string, unknown>> = {};
  for (const key of Object.keys(next) as (keyof AutomationSettings)[]) {
    const a = next[key] as Record<string, unknown>;
    const b = saved[key] as Record<string, unknown>;
    for (const k of Object.keys(a)) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) (patch[key] ??= {})[k] = a[k];
    }
  }
  return patch as AutomationsPatch;
}
