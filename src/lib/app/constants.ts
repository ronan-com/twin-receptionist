import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AudioLines,
  Bot,
  Briefcase,
  Building2,
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  FlaskConical,
  GraduationCap,
  Home,
  LayoutDashboard,
  LifeBuoy,
  Palette,
  Phone,
  PhoneCall,
  PhoneIncoming,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
} from "lucide-react";
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
  /** Console pages only the platform team sees (agency staff are sent back to /admin). */
  platformOnly?: boolean;
  /** Console pages for an agency only: hidden in the platform team's own console, shown while it views as an agency. */
  agencyOnly?: boolean;
}

/**
 * Four top-level destinations for a business owner. Older URLs still work: the
 * receptionist, knowledge, numbers, automations, reports, team and connected apps
 * are reached from Settings (and link back to it); follow-ups from Home.
 */
export const CLIENT_NAV: NavItem[] = [
  { to: "/app", label: "Home", icon: Home, exact: true },
  { to: "/app/calls", label: "Calls", icon: PhoneCall },
  { to: "/app/bookings", label: "Bookings", icon: CalendarDays },
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
  { to: "/app", label: "Home", from: ["/app/leads"] },
];

// The console (/admin). The platform team sees every item; agency staff see the
// ones without platformOnly, scoped to their own agency.
export const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/admin/agencies", label: "Agencies", icon: Briefcase, platformOnly: true },
  { to: "/admin/clients", label: "Clients", icon: Building2 },
  { to: "/admin/calls", label: "Calls", icon: Activity },
  { to: "/admin/receptionists", label: "AI Receptionists", icon: Bot },
  { to: "/admin/voices", label: "Voices", icon: AudioLines },
  { to: "/admin/phone-numbers", label: "Phone Numbers", icon: Phone },
  { to: "/admin/number-requests", label: "Number Requests", icon: PhoneIncoming },
  { to: "/admin/connections", label: "Connections", icon: Plug },
  { to: "/admin/usage", label: "Usage", icon: CreditCard },
  { to: "/admin/test-lab", label: "Test Lab", icon: FlaskConical, platformOnly: true },
  { to: "/admin/system", label: "System / QA", icon: ClipboardCheck },
  { to: "/admin/audit", label: "Audit Log", icon: ScrollText },
  { to: "/admin/support-requests", label: "Support requests", icon: LifeBuoy, agencyOnly: true },
  { to: "/admin/tutorials", label: "Tutorials", icon: GraduationCap, agencyOnly: true },
  { to: "/admin/settings", label: "Settings", icon: ShieldCheck, match: ["/admin/branding"] },
];
// (Integrations and Billing have no Twin backing yet: no console pages. Branding is a tab of Settings.)

/** Console paths agency staff may not open. */
export const PLATFORM_ONLY_PATHS = ADMIN_NAV.filter((n) => n.platformOnly).map((n) => n.to);

export function isPlatformOnlyPath(pathname: string): boolean {
  return PLATFORM_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export const adminNavFor = (variant: "platform" | "agency") => (variant === "platform" ? ADMIN_NAV.filter((n) => !n.agencyOnly) : ADMIN_NAV.filter((n) => !n.platformOnly));

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
  not_connected: "Not connected",
  connected: "Connected",
  error: "Needs attention",
  coming_soon: "Coming soon",
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
  availability: "available" | "coming_soon";
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
  { provider: "zapier", name: "Zapier", category: "Automation", description: `Connect ${PRODUCT} to thousands of apps without code.`, availability: "coming_soon", oauth: false },
  { provider: "cliniko", name: "Cliniko", category: "Calendar", description: "Practice management booking for allied health.", availability: "coming_soon", oauth: true },
];

export const CHART_COLORS = {
  indigo: "#635bff",
  indigoDeep: "#533afd",
  cyan: "#00d4ff",
  magenta: "#ff5caa",
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
export const TOOL_PERMISSIONS = ["book_appointment", "lookup_availability", "take_message", "transfer_call", "send_sms", "lookup_contact", "create_lead", "end_call"];
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
