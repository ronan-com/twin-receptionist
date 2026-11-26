import type { FollowupSettings } from "../followups";
import { api } from "./base";

// Per-receptionist automations (area T). Server side: server/routes/automations.ts
// under /api/automations/<businessId>. Staff, the platform team and the business's
// managers can change them; viewers read only.

export type TransferWhen = "hours" | "always";
export type AfterHoursMode = "message_only" | "message_and_booking";
export type LanguageCode = "en-AU" | "multi";

export type AutomationSettings = {
  transfer: {
    enabled: boolean;
    /** E.164 Australian number, e.g. +61412345678. */
    number: string;
    /** Who the caller is put through to ("the team", "Sam"). */
    name: string;
    when: TransferWhen;
    onRequest: boolean;
    urgent: boolean;
    cantHelp: boolean;
    /** If the transfer reaches voicemail: carry on (off) or come back and take a message. */
    voicemail: "off" | "take_message";
  };
  textBack: {
    enabled: boolean;
    afterCall: boolean;
    missedCall: boolean;
    afterCallText: string;
    missedCallText: string;
    bookingText: string;
  };
  recording: { enabled: boolean; notice: string };
  language: { code: LanguageCode };
  callLimits: { maxMinutes: number; idleSeconds: number };
  hoursMode: { enabled: boolean; greeting: string; mode: AfterHoursMode };
} & FollowupSettings;

export type AutomationKey = keyof AutomationSettings;

/** Honest per-automation status, worked out by the server. */
export type AutomationStatus = {
  state: "on" | "off" | "needs_setup" | "unsupported" | "error";
  label: string;
  detail?: string;
};

export type LanguageOption = { code: LanguageCode; label: string; note?: string };

export type AutomationsState = {
  settings: AutomationSettings;
  status: Record<AutomationKey, AutomationStatus>;
  canEdit: boolean;
  demo: boolean;
  appliedAt: string | null;
  applyError: string | null;
  updatedAt: string | null;
  smsNumber: string | null;
  languages: LanguageOption[];
  /** Reminders, missed-call follow-ups and review requests. */
  followups: {
    emailReady: boolean;
    businessName: string;
    recent: { at: string; kind: "reminder" | "missed" | "review"; channel: "sms" | "email"; to: string; status: "sending" | "sent" | "skipped" | "failed"; detail: string }[];
  };
  recentTexts: { at: string; to: string; kind: string; status: string; detail: string }[];
};

/** A partial update: any subset of the sections, each a partial of its fields. */
export type AutomationsPatch = { [K in AutomationKey]?: Partial<AutomationSettings[K]> };

export const getAutomations = (businessId: string) => api.get<AutomationsState>(`/api/automations/${businessId}`);

export const saveAutomations = (businessId: string, patch: AutomationsPatch) =>
  api.put<AutomationsState>(`/api/automations/${businessId}`, patch);

export const automationsQueryKey = (businessId: string | null) => ["automations", businessId] as const;

/** "Send me a test": one example to the signed-in person's own email, or to the mobile number they give. */
export const sendFollowupTest = (
  businessId: string,
  body: { kind: "reminder" | "missed" | "review"; channel: "sms" | "email"; phone?: string; settings?: Record<string, unknown> },
) => api.post<{ sentTo: string }>(`/api/automations/${businessId}/test`, body);
