import { cn } from "@/lib/utils";
import type {
  AgentStatus,
  AppointmentStatus,
  CallOutcome,
  CallStatus,
  IntegrationStatus,
  LeadStage,
  PhoneNumberStatus,
  ProviderStatus,
  QaStatus,
  SubscriptionStatus,
  CallSentiment,
} from "@/lib/app/types";
import {
  APPOINTMENT_STATUS_LABELS,
  CALL_OUTCOME_LABELS,
  CALL_STATUS_LABELS,
  INTEGRATION_STATUS_LABELS,
  LEAD_STAGE_LABELS,
  PROVIDER_STATUS_LABELS,
  QA_STATUS_LABELS,
} from "@/lib/app/constants";
import { titleCase } from "@/lib/app/format";

export type Tone = "neutral" | "success" | "info" | "warning" | "danger" | "indigo" | "muted" | "live" | "cyan" | "magenta" | "coral";

// Status colours mean the same thing everywhere:
//   live / on / active / connected = green, pending / waiting / needs setup = amber,
//   paused / off / not started = grey, failed / error = red.
// The extra hues (indigo, cyan, magenta, coral) are for categories such as call
// outcomes, and match the chart colours for the same thing.
const TONES: Record<Tone, string> = {
  neutral: "bg-canvas-2 text-ink border-hairline",
  muted: "bg-[#f1f4f8] text-[#4a5b6e] border-[#e1e6ed]",
  success: "bg-[#e3f7ee] text-[#0b6142] border-[#c3ecd9]",
  info: "bg-[#e6f6ff] text-[#0b5d87] border-[#c5e7fb]",
  warning: "bg-[#fff3dc] text-[#7f4a00] border-[#ffdfa6]",
  danger: "bg-[#ffeceb] text-[#a3231b] border-[#ffcfcb]",
  indigo: "bg-[color-mix(in_srgb,var(--indigo)_11%,var(--card))] text-[var(--primary-ink)] border-[color-mix(in_srgb,var(--indigo)_24%,#fff)]",
  live: "bg-[#e3f7ee] text-[#0b6142] border-[#c3ecd9]",
  cyan: "bg-[#e0f8ff] text-[#0a6680] border-[#b8ecfa]",
  magenta: "bg-[#ffebf4] text-[#a8125b] border-[#ffcfe4]",
  coral: "bg-[#fff0eb] text-[#a8391a] border-[#ffd6c9]",
};

/** One tone per state word, so every page colours a status the same way. */
export const STATE_TONE = {
  live: "success",
  on: "success",
  active: "success",
  connected: "success",
  pending: "warning",
  waiting: "warning",
  needs_setup: "warning",
  paused: "muted",
  off: "muted",
  failed: "danger",
  error: "danger",
} as const satisfies Record<string, Tone>;

export function StatusBadge({
  tone = "neutral",
  children,
  className,
  dot,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-[4px] border px-1.5 text-[12px] font-medium leading-none",
        TONES[tone],
        className,
      )}
    >
      {dot || tone === "live" ? (
        <span className="relative flex h-1.5 w-1.5">
          {tone === "live" ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" /> : null}
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      ) : null}
      {children}
    </span>
  );
}

export function callStatusTone(s: CallStatus): Tone {
  switch (s) {
    case "completed":
      return "success";
    case "in_progress":
    case "ringing":
    case "queued":
      return "live";
    case "voicemail":
      return "info";
    case "missed":
      return "coral";
    case "cancelled":
      return "muted";
    case "failed":
      return "danger";
  }
}
export const CallStatusBadge = ({ status }: { status: CallStatus }) => (
  <StatusBadge tone={callStatusTone(status)}>{CALL_STATUS_LABELS[status]}</StatusBadge>
);

export function outcomeTone(o: CallOutcome | null): Tone {
  // Same colours as the outcome chart (OUTCOME_COLORS).
  switch (o) {
    case "resolved":
      return "indigo";
    case "booked":
      return "cyan";
    case "lead_captured":
      return "magenta";
    case "transferred":
      return "coral";
    case "callback_requested":
      return "warning";
    case "voicemail":
    case "no_answer":
      return "muted";
    case "spam":
      return "muted";
    case "unresolved":
      return "danger";
    default:
      return "muted";
  }
}
export const OutcomeBadge = ({ outcome }: { outcome: CallOutcome | null }) =>
  outcome ? <StatusBadge tone={outcomeTone(outcome)}>{CALL_OUTCOME_LABELS[outcome]}</StatusBadge> : <span className="text-ink-muted">—</span>;

export const QaBadge = ({ status }: { status: QaStatus }) => {
  const tone: Tone = status === "passed" ? "success" : status === "needs_review" ? "warning" : status === "failed" ? "danger" : "muted";
  return <StatusBadge tone={tone}>{QA_STATUS_LABELS[status]}</StatusBadge>;
};

export const LeadStageBadge = ({ stage }: { stage: LeadStage }) => {
  const tone: Tone =
    stage === "new" ? "indigo" : stage === "contacted" ? "info" : stage === "qualified" ? "success" : stage === "proposal" ? "warning" : stage === "won" ? "success" : "muted";
  return <StatusBadge tone={tone}>{LEAD_STAGE_LABELS[stage]}</StatusBadge>;
};

export const AppointmentBadge = ({ status }: { status: AppointmentStatus }) => {
  const tone: Tone = status === "confirmed" ? "success" : status === "pending" ? "warning" : status === "completed" ? "indigo" : status === "no_show" ? "danger" : "muted";
  return <StatusBadge tone={tone}>{APPOINTMENT_STATUS_LABELS[status]}</StatusBadge>;
};

export const IntegrationBadge = ({ status }: { status: IntegrationStatus }) => {
  const tone: Tone = status === "connected" ? "success" : status === "error" ? "danger" : "neutral";
  return <StatusBadge tone={tone} dot={status === "connected"}>{INTEGRATION_STATUS_LABELS[status]}</StatusBadge>;
};

export const ProviderStatusBadge = ({ status }: { status: ProviderStatus }) => {
  const tone: Tone = status === "active" ? "success" : status === "configured" ? "info" : status === "error" ? "danger" : status === "disabled" ? "muted" : "warning";
  return <StatusBadge tone={tone}>{PROVIDER_STATUS_LABELS[status]}</StatusBadge>;
};

export const AgentStatusBadge = ({ status }: { status: AgentStatus }) => {
  const tone: Tone = status === "active" ? "success" : "muted";
  return <StatusBadge tone={tone} dot={status === "active"}>{titleCase(status)}</StatusBadge>;
};

export const NumberStatusBadge = ({ status }: { status: PhoneNumberStatus }) => {
  const tone: Tone = status === "active" ? "success" : status === "pending" ? "warning" : status === "suspended" ? "danger" : "muted";
  return <StatusBadge tone={tone}>{titleCase(status)}</StatusBadge>;
};

export const SubscriptionBadge = ({ status }: { status: SubscriptionStatus }) => {
  const tone: Tone = status === "active" ? "success" : status === "trialing" ? "indigo" : status === "past_due" ? "danger" : "muted";
  return <StatusBadge tone={tone}>{titleCase(status)}</StatusBadge>;
};

export const SentimentBadge = ({ sentiment }: { sentiment: CallSentiment | null }) => {
  if (!sentiment) return <span className="text-ink-muted">—</span>;
  const tone: Tone = sentiment === "positive" ? "success" : sentiment === "negative" ? "danger" : "muted";
  return <StatusBadge tone={tone}>{titleCase(sentiment)}</StatusBadge>;
};

export const DemoBadge = ({ className }: { className?: string }) => (
  <StatusBadge tone="warning" className={className}>
    Demo
  </StatusBadge>
);

export function HealthDot({ health }: { health: string | null }) {
  const color = health === "healthy" ? "bg-[#1ea672]" : health === "degraded" ? "bg-[#f5a623]" : health === "down" ? "bg-[#e0423c]" : "bg-[#b6bfca]";
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
      {titleCase(health ?? "unknown")}
    </span>
  );
}
