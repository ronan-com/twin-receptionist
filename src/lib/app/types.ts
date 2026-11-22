import type { Tables, Enums, TablesInsert, TablesUpdate } from "./db-types";

export type Profile = Tables<"profiles">;
export type Business = Tables<"businesses">;
export type Membership = Tables<"business_memberships">;
export type Invitation = Tables<"invitations">;
export type InternalAdmin = Tables<"internal_admins">;
export type ProviderConfig = Tables<"provider_configs">;
export type Voice = Tables<"voices">;
export type Agent = Tables<"ai_agents">;
export type VoiceConfig = Tables<"voice_configs">;
export type PhoneNumber = Tables<"phone_numbers">;
export type Contact = Tables<"contacts">;
export type Call = Tables<"calls">;
export type CallEvent = Tables<"call_events">;
export type TranscriptSegment = Tables<"transcript_segments">;
export type Recording = Tables<"recordings">;
export type Lead = Tables<"leads">;
export type Appointment = Tables<"appointments">;
export type KnowledgeItem = Tables<"knowledge_base_items">;
export type UnansweredQuestion = Tables<"unanswered_questions">;
export type Integration = Tables<"integrations">;
export type IntegrationEvent = Tables<"integration_events">;
export type Plan = Tables<"plans">;
export type Subscription = Tables<"subscriptions">;
export type Invoice = Tables<"invoices">;
export type UsageRecord = Tables<"usage_records">;
export type AuditLog = Tables<"audit_logs">;
export type SystemIncident = Tables<"system_incidents">;

export type MembershipRole = Enums<"membership_role">;
export type InternalRole = Enums<"internal_role">;
export type ProviderKind = Enums<"provider_kind">;
export type ProviderStatus = Enums<"provider_status">;
export type AgentStatus = Enums<"agent_status">;
export type CallDirection = Enums<"call_direction">;
export type CallStatus = Enums<"call_status">;
export type CallOutcome = Enums<"call_outcome">;
export type CallSentiment = Enums<"call_sentiment">;
export type QaStatus = Enums<"qa_status">;
export type LeadStage = Enums<"lead_stage">;
export type AppointmentStatus = Enums<"appointment_status">;
export type KnowledgeType = Enums<"knowledge_type">;
export type KnowledgeStatus = Enums<"knowledge_status">;
export type IntegrationStatus = Enums<"integration_status">;
export type PhoneRoutingMode = Enums<"phone_routing_mode">;
export type PhoneNumberStatus = Enums<"phone_number_status">;
export type SubscriptionStatus = Enums<"subscription_status">;
export type UsageKind = Enums<"usage_kind">;
export type EventSeverity = Enums<"event_severity">;

export type AgentUpdate = TablesUpdate<"ai_agents">;
export type BusinessUpdate = TablesUpdate<"businesses">;
export type PhoneNumberUpdate = TablesUpdate<"phone_numbers">;
export type KnowledgeInsert = TablesInsert<"knowledge_base_items">;
export type KnowledgeUpdate = TablesUpdate<"knowledge_base_items">;
export type LeadUpdate = TablesUpdate<"leads">;
export type AppointmentUpdate = TablesUpdate<"appointments">;
export type VoiceInsert = TablesInsert<"voices">;
export type VoiceUpdate = TablesUpdate<"voices">;
export type IntegrationInsert = TablesInsert<"integrations">;

/** Call row with the light joins used by list views. */
export type CallListRow = Call & {
  contact: Pick<Contact, "id" | "full_name" | "phone"> | null;
  agent: Pick<Agent, "id" | "name"> | null;
  phone_number: Pick<PhoneNumber, "id" | "e164" | "friendly_name"> | null;
  business?: Pick<Business, "id" | "name" | "is_demo" | "timezone"> | null;
  /** Present on call list selects so demo rows can agree with their booking. */
  appointments?: Pick<Appointment, "id" | "starts_at" | "service" | "staff_name" | "customer_name">[];
};

export type AppointmentRow = Appointment & {
  integration: Pick<Integration, "id" | "provider" | "display_name" | "status"> | null;
};

export type IntegrationEventRow = IntegrationEvent & {
  integration: Pick<Integration, "id" | "provider" | "display_name"> | null;
};

export type MemberRow = Membership & {
  profile: Pick<Profile, "id" | "email" | "full_name" | "avatar_url"> | null;
};

export type SubscriptionRow = Subscription & { plan: Plan | null };

export type AuditRow = AuditLog & { business: Pick<Business, "id" | "name" | "is_demo"> | null };

/** Presentation-only marker added for demo workspaces. Never stored. */
export interface DemoPresentation {
  /** True when the shown summary or transcript is generated, not captured. */
  generated: boolean;
  note: string;
}

export type CallDetail = Omit<CallListRow, "appointments"> & {
  demo_presentation?: DemoPresentation;
  call_events: CallEvent[];
  transcript_segments: TranscriptSegment[];
  recordings: Recording[];
  appointments: Pick<Appointment, "id" | "starts_at" | "ends_at" | "service" | "status" | "customer_name" | "staff_name" | "location" | "integration_id" | "sync_status">[];
  leads: Pick<Lead, "id" | "stage" | "name" | "intent">[];
};

export type BusinessHours = Record<
  "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
  { open: string; close: string; closed: boolean }
>;

export const DAY_KEYS: (keyof BusinessHours)[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_LABELS: Record<keyof BusinessHours, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const DEFAULT_HOURS: BusinessHours = {
  mon: { open: "09:00", close: "17:00", closed: false },
  tue: { open: "09:00", close: "17:00", closed: false },
  wed: { open: "09:00", close: "17:00", closed: false },
  thu: { open: "09:00", close: "17:00", closed: false },
  fri: { open: "09:00", close: "17:00", closed: false },
  sat: { open: "09:00", close: "12:00", closed: true },
  sun: { open: "09:00", close: "12:00", closed: true },
};

export function asBusinessHours(value: unknown): BusinessHours {
  const v = (value ?? {}) as Partial<BusinessHours>;
  const out = { ...DEFAULT_HOURS };
  for (const k of DAY_KEYS) {
    const d = v[k];
    if (d && typeof d === "object") {
      out[k] = {
        open: typeof d.open === "string" ? d.open : DEFAULT_HOURS[k].open,
        close: typeof d.close === "string" ? d.close : DEFAULT_HOURS[k].close,
        closed: Boolean(d.closed),
      };
    }
  }
  return out;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
