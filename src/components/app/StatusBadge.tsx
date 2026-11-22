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

export type Tone = "neutral" | "success" | "info" | "warning" | "danger" | "indigo" | "muted" | "live";

const TONES: Record<Tone, string> = {
  neutral: "bg-canvas-2 text-ink border-hairline",
  muted: "bg-canvas-2 text-ink-muted border-hairline",
  success: "bg-[#e6f8f1] text-[#0e6245] border-[#c8eedf]",
  info: "bg-[#e6f6ff] text-[#0b5d87] border-[#c5e7fb]",
  warning: "bg-[#fff4e0] text-[#8a4b00] border-[#ffe1b0]",
  danger: "bg-[#ffecec] text-[#a41d1d] border-[#ffd0d0]",
  indigo: "bg-[#efeeff] text-[#4338ca] border-[#dcdaff]",
  live: "bg-[#e6f8f1] text-[#0e6245] border-[#c8eedf]",
};

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
    case "cancelled":
      return "warning";
    case "failed":
      return "danger";
  }
}
export const CallStatusBadge = ({ status }: { status: CallStatus }) => (
  <StatusBadge tone={callStatusTone(status)}>{CALL_STATUS_LABELS[status]}</StatusBadge>
);

export function outcomeTone(o: CallOutcome | null): Tone {
  switch (o) {
    case "resolved":
      return "indigo";
    case "booked":
      return "success";
    case "lead_captured":
      return "info";
    case "transferred":
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
  const tone: Tone = status === "connected" ? "success" : status === "error" ? "danger" : status === "coming_soon" ? "muted" : "neutral";
  return <StatusBadge tone={tone} dot={status === "connected"}>{INTEGRATION_STATUS_LABELS[status]}</StatusBadge>;
};

export const ProviderStatusBadge = ({ status }: { status: ProviderStatus }) => {
  const tone: Tone = status === "active" ? "success" : status === "configured" ? "info" : status === "error" ? "danger" : status === "disabled" ? "muted" : "warning";
  return <StatusBadge tone={tone}>{PROVIDER_STATUS_LABELS[status]}</StatusBadge>;
};

export const AgentStatusBadge = ({ status }: { status: AgentStatus }) => {
  const tone: Tone = status === "active" ? "success" : status === "paused" ? "warning" : status === "disabled" ? "danger" : "muted";
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
