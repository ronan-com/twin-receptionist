import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Building2,
  CalendarDays,
  Home,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  MessageSquareText,
  Mic,
  Palette,
  Phone,
  PhoneCall,
  Plug,
  Settings,
  Users,
} from "lucide-react";
import type { Hue } from "@/components/app/hues";
import type {
  CallOutcome,
  CallStatus,
  IntegrationStatus,
  LeadStage,
  AppointmentStatus,
  ProviderKind,
  ProviderStatus,
  QaStatus,
  PhoneRoutingMode,
  MembershipRole,
  KnowledgeType,
} from "./types";
import { PRODUCT } from "@/lib/app/product";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Extra path prefixes that should keep this top-level item highlighted. */
  match?: string[];
  /** Paths that keep this item highlighted only when matched exactly. */
  matchExact?: string[];
  /** Colour of its icon badge. */
  hue?: Hue;
  /** The big section of the nav (AI Receptionist): drawn larger, with its sub-sections underneath. */
  featured?: boolean;
  children?: { to: string; label: string; icon: LucideIcon; hue?: Hue }[];
}

/**
 * Five top-level destinations for a business owner. Older URLs still work: the
 * receptionist, knowledge, numbers, automations, reports, team and connected apps
 * are sections of Settings (and link back to it); follow-ups are in Contacts.
 */
export const CLIENT_NAV: NavItem[] = [
  { to: "/app", label: "Home", icon: Home, exact: true },
  { to: "/app/inbox", label: "Inbox", icon: Inbox, match: ["/app/calls"] },
  { to: "/app/calendar", label: "Calendar", icon: CalendarDays, match: ["/app/bookings"] },
  { to: "/app/contacts", label: "Contacts", icon: Users, match: ["/app/leads"] },
  {
    to: "/app/settings",
    label: "Settings",
    icon: Settings,
    match: ["/app/how-it-works", "/app/receptionist", "/app/knowledge", "/app/phone-numbers", "/app/automations", "/app/analytics", "/app/team", "/app/integrations"],
  },
];

/** Pages without a tab of their own: where "Back" on them goes. */
export const CLIENT_BACKLINKS: { to: string; label: string; from: string[] }[] = [
  { to: "/app/settings", label: "Settings", from: ["/app/how-it-works", "/app/receptionist", "/app/knowledge", "/app/phone-numbers", "/app/automations", "/app/analytics", "/app/team", "/app/integrations"] },
];

// The console (/admin). Home, then the AI Receptionist package (the big one: Voice, Messages and Email
// agents), then clients, calls and the rest. Everything else is a tab inside one of them
// (ADMIN_SECTIONS), and every older URL still opens.
export const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Home", icon: LayoutDashboard, hue: "indigo", exact: true },
  {
    to: "/admin/receptionists",
    label: "AI Receptionist",
    icon: Bot,
    hue: "violet",
    featured: true,
    match: ["/admin/voices", "/admin/test-lab"],
    children: [
      { to: "/admin/receptionists/voice", label: "Voice agent", icon: Mic, hue: "indigo" },
      { to: "/admin/receptionists/messages", label: "Message agent", icon: MessageSquareText, hue: "cyan" },
      { to: "/admin/receptionists/email", label: "Email agent", icon: Mail, hue: "magenta" },
    ],
  },
  { to: "/admin/clients", label: "Clients", icon: Building2, hue: "sky", match: ["/admin/agencies"] },
  { to: "/admin/calls", label: "Calls", icon: PhoneCall, hue: "green" },
  { to: "/admin/phone-numbers", label: "Numbers", icon: Phone, hue: "amber", match: ["/admin/number-requests"] },
  { to: "/admin/connections", label: "Connections", icon: Plug, hue: "cyan" },
  { to: "/admin/branding", label: "Brand", icon: Palette, hue: "magenta" },
  {
    to: "/admin/tutorials",
    label: "Settings",
    icon: LifeBuoy,
    hue: "slate",
    match: ["/admin/support-requests", "/admin/settings", "/admin/usage", "/admin/system", "/admin/audit", "/admin/billing"],
  },
];

export interface AdminTab {
  to: string;
  label: string;
  exact?: boolean;
  /** Platform team only. */
  platformOnly?: boolean;
  /** Agency console only (hidden in the platform team's own console). */
  agencyOnly?: boolean;
  /** Hidden where numbers are bought from each client's page (own phone account / single agency). */
  queueOnly?: boolean;
}

/** The tabs shown across the top of each console area. */
export const ADMIN_SECTIONS: AdminTab[][] = [
  [
    { to: "/admin/clients", label: "Clients" },
    { to: "/admin/agencies", label: "Agencies", platformOnly: true },
  ],
  [
    { to: "/admin/receptionists", label: "All", exact: true },
    { to: "/admin/receptionists/voice", label: "Voice agent" },
    { to: "/admin/receptionists/messages", label: "Message agent" },
    { to: "/admin/receptionists/email", label: "Email agent" },
    { to: "/admin/voices", label: "Voices" },
    { to: "/admin/test-lab", label: "Test", platformOnly: true },
  ],
  [
    { to: "/admin/phone-numbers", label: "Numbers" },
    { to: "/admin/number-requests", label: "Requests", queueOnly: true },
  ],
  [
    { to: "/admin/tutorials", label: "Guides", agencyOnly: true },
    { to: "/admin/support-requests", label: "Support", agencyOnly: true },
    { to: "/admin/settings", label: "General" },
    { to: "/admin/billing", label: "Billing", agencyOnly: true },
    { to: "/admin/usage", label: "Usage" },
    { to: "/admin/system", label: "System" },
    { to: "/admin/audit", label: "Activity" },
  ],
];

/** Console paths agency staff may not open. */
export const PLATFORM_ONLY_PATHS = ["/admin/agencies", "/admin/test-lab"];

export function isPlatformOnlyPath(pathname: string): boolean {
  return PLATFORM_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export const adminNavFor = (variant: "platform" | "agency"): NavItem[] =>
  // The platform team's console has no guides or support inbox, so its Help opens on Settings.
  ADMIN_NAV.map((n) => (n.label === "Settings" && variant === "platform" ? { ...n, to: "/admin/settings" } : n));

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  twilio: "Twilio",
  telnyx: "Telnyx",
  vapi: "Vapi",
  retell: "Retell",
  elevenlabs: "ElevenLabs",
  custom: "Custom",
};

export const PROVIDER_KINDS: ProviderKind[] = ["twilio", "telnyx", "vapi", "retell", "elevenlabs", "custom"];

export const PROVIDER_STATUS_LABELS: Record<ProviderStatus, string> = {
  not_connected: "Not connected",
  configured: "Configured",
  active: "Active",
  error: "Error",
  disabled: "Disabled",
};

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  queued: "Queued",
  ringing: "Ringing",
  in_progress: "In progress",
  completed: "Completed",
  missed: "Missed",
  failed: "Failed",
  voicemail: "Voicemail",
  cancelled: "Cancelled",
};

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  resolved: "Resolved by AI",
  booked: "Booked",
  lead_captured: "Lead captured",
  transferred: "Transferred",
  voicemail: "Voicemail",
  no_answer: "No answer",
  spam: "Spam",
  callback_requested: "Callback requested",
  unresolved: "Unresolved",
};

export const QA_STATUS_LABELS: Record<QaStatus, string> = {
  unreviewed: "Unreviewed",
  passed: "Passed",
  needs_review: "Needs review",
  failed: "Failed",
};

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};
export const LEAD_STAGES: LeadStage[] = ["new", "contacted", "qualified", "proposal", "won", "lost"];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};
export const APPOINTMENT_STATUSES: AppointmentStatus[] = ["pending", "confirmed", "completed", "cancelled", "no_show"];

export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  available: "Available",
  coming_soon: "Not available",
  not_connected: "Not connected",
  connected: "Connected",
  error: "Needs attention",
};

export const ROUTING_MODE_LABELS: Record<PhoneRoutingMode, string> = {
  ai_receptionist: "AI receptionist",
  forward: "Forward to a number",
  ai_after_hours: "Forward in hours, AI after hours",
  voicemail: "Voicemail only",
  disabled: "Disabled",
};
export const ROUTING_MODES: PhoneRoutingMode[] = ["ai_receptionist", "ai_after_hours", "forward", "voicemail", "disabled"];

export const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
  read_only: "Read only",
};
export const ROLE_DESCRIPTIONS: Record<MembershipRole, string> = {
  owner: "Full access, billing and ownership transfer.",
  admin: "Manage receptionist, numbers, team and settings.",
  staff: "Work leads, bookings and knowledge. Cannot change settings.",
  read_only: "View calls, bookings and reports only.",
};
export const ASSIGNABLE_ROLES: MembershipRole[] = ["admin", "staff", "read_only"];

export const KNOWLEDGE_TYPE_LABELS: Record<KnowledgeType, string> = {
  faq: "FAQ",
  service: "Service",
  pricing: "Pricing",
  policy: "Policy",
  location: "Location",
  fact: "Business fact",
  url: "Website URL",
  document: "Document",
  custom_qa: "Custom Q&A",
};
export const KNOWLEDGE_TYPES: KnowledgeType[] = ["faq", "service", "pricing", "policy", "location", "fact", "url", "document", "custom_qa"];

/* ------------------------------------------------------------------ */
/* Integration catalogue                                               */
/* ------------------------------------------------------------------ */

export interface IntegrationDef {
  provider: string;
  name: string;
  category: "Calendar" | "CRM" | "Field service" | "Accounting" | "Automation";
  description: string;
  availability: "available";
  oauth: boolean;
}

export const INTEGRATION_CATALOG: IntegrationDef[] = [
  { provider: "google_calendar", name: "Google Calendar", category: "Calendar", description: "Two-way sync of bookings made by your receptionist.", availability: "available", oauth: true },
  { provider: "microsoft_calendar", name: "Microsoft Outlook Calendar", category: "Calendar", description: "Book straight into Outlook and Microsoft 365 calendars.", availability: "available", oauth: true },
  { provider: "hubspot", name: "HubSpot", category: "CRM", description: "Create contacts and deals from captured leads.", availability: "available", oauth: true },
  { provider: "salesforce", name: "Salesforce", category: "CRM", description: "Push qualified leads into Salesforce as Leads or Opportunities.", availability: "available", oauth: true },
  { provider: "servicem8", name: "ServiceM8", category: "Field service", description: "Turn booked call-outs into ServiceM8 jobs automatically.", availability: "available", oauth: true },
  { provider: "xero", name: "Xero", category: "Accounting", description: "Match callers to Xero contacts and surface invoice questions.", availability: "available", oauth: true },
  { provider: "webhook", name: "Webhook / custom CRM", category: "Automation", description: "Send call, booking and lead events to any HTTPS endpoint.", availability: "available", oauth: false },
];

export const CHART_COLORS = {
  indigo: "var(--indigo)",
  indigoDeep: "#533afd",
  cyan: "var(--brand-2)",
  magenta: "var(--brand-3)",
  coral: "#ff7a59",
  slate: "#425466",
  slateDeep: "#061b31",
  hairline: "#e3e8ee",
  canvas2: "#f6f9fc",
  soft: "#c7c4ff",
};

export const OUTCOME_COLORS: Record<CallOutcome, string> = {
  resolved: CHART_COLORS.indigo,
  booked: CHART_COLORS.cyan,
  lead_captured: CHART_COLORS.magenta,
  transferred: CHART_COLORS.coral,
  voicemail: "#94a3b8",
  no_answer: "#cbd5e1",
  spam: "#e2e8f0",
  callback_requested: CHART_COLORS.soft,
  unresolved: CHART_COLORS.slate,
};

export const STORAGE_KEYS = {
  currentBusiness: "answered.currentBusinessId",
  range: "answered.range",
};

export const LLM_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "claude-3-5-sonnet", "gemini-2.0-flash"];
export const TOOL_PERMISSIONS = ["book_appointment", "reschedule_appointment", "cancel_appointment", "lookup_availability", "take_message", "transfer_call", "send_sms", "lookup_contact", "create_lead", "end_call"];
export const TIMEZONES = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Hobart",
  "Australia/Darwin",
  "Pacific/Auckland",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Singapore",
];
export const INDUSTRIES = ["Dental", "Healthcare", "Trades", "Legal", "Accounting", "Real estate", "Salon & beauty", "Fitness", "Hospitality", "Automotive", "Property management", "Professional services", "Childcare", "Other"];
