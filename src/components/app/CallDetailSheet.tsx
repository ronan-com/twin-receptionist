import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, Bot, CalendarDays, ChevronDown, MessageSquare, Mic, Phone, PhoneForwarded, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { callDetailQuery } from "@/lib/app/queries";
import { fmtDuration, fmtPercent, fmtPhone, humanize, titleCase } from "@/lib/app/format";
import { tzAbbrev, tzDateTime, tzTime } from "@/lib/app/business-logic";
import { PROVIDER_LABELS } from "@/lib/app/constants";
import type { CallEvent, TranscriptSegment } from "@/lib/app/types";
import { asRecord } from "@/lib/app/types";
import { useWorkspace } from "@/lib/app/workspace";
import { cn } from "@/lib/utils";
import { CallStatusBadge, OutcomeBadge, SentimentBadge, StatusBadge, AppointmentBadge, LeadStageBadge } from "./StatusBadge";
import { EmptyState, KeyValue, SectionLabel } from "./primitives";

// Answered's call drawer, on our data: the call_log row, the transcript and summary
// from the phone provider (or the test lab's sample call), the bookings and call-backs
// the call produced, and a simple timeline. Twin keeps no audio and does no QA review,
// so the recording section says so and the QA tab is gone.

function ms(v: number | null) {
  if (v == null) return "";
  const s = Math.floor(v / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function Transcript({ segments }: { segments: TranscriptSegment[] }) {
  if (segments.length === 0) return <EmptyState compact icon={Mic} title="No transcript" description="A transcript shows here once the phone provider delivers one." />;
  return (
    <ol className="space-y-3" data-testid="transcript">
      {segments.map((s) => {
        const ai = s.speaker === "agent" || s.speaker === "ai";
        const when = ms(s.started_ms);
        return (
          <li key={s.id} className={cn("flex gap-2.5", ai ? "" : "flex-row-reverse")}>
            <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", ai ? "bg-[#efeeff] text-indigo" : "bg-canvas-2 text-ink-muted")}>
              {ai ? <Bot className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
            </span>
            <div className={cn("min-w-0 max-w-[85%]", ai ? "" : "text-right")}>
              <div className={cn("mb-0.5 text-[11px] text-ink-muted", ai ? "" : "text-right")}>
                {ai ? "Receptionist" : titleCase(s.speaker)}
                {when ? ` · ${when}` : ""}
                {s.confidence != null && s.confidence < 0.7 ? <span className="ml-1 text-[#8a4b00]">· low confidence</span> : null}
              </div>
              <div className={cn("inline-block break-words rounded-[8px] px-3 py-2 text-left text-[13px] leading-5", ai ? "bg-[#f4f3ff] text-ink" : "bg-canvas-2 text-ink")}>{s.text}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Timeline({ events, tz }: { events: CallEvent[]; tz?: string | null }) {
  if (events.length === 0) return <EmptyState compact title="No events" />;
  return (
    <ol className="relative ml-2 border-l border-hairline">
      {events.map((e) => (
        <li key={e.id} className="relative pb-4 pl-4 last:pb-0">
          <span
            className={cn(
              "absolute -left-[5px] top-1.5 h-[9px] w-[9px] rounded-full border-2 border-white",
              e.severity === "error" ? "bg-coral" : e.severity === "warning" ? "bg-[#f5a623]" : "bg-indigo",
            )}
          />
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium text-ink">{humanize(e.type)}</span>
            <span className="shrink-0 font-mono text-[11px] text-ink-muted">{tzTime(e.occurred_at, tz)}</span>
          </div>
          {e.message ? <div className="text-[12.5px] text-ink-muted">{e.message}</div> : null}
        </li>
      ))}
    </ol>
  );
}

export function CallDetailSheet({
  callId,
  onOpenChange,
  admin = false,
  linkPrefix = "/app",
  businessId,
}: {
  callId: string | null;
  onOpenChange: (open: boolean) => void;
  admin?: boolean;
  linkPrefix?: "/app" | "/admin";
  /** The business the call belongs to. Defaults to the workspace's business; the console passes none. */
  businessId?: string | null;
}) {
  const ws = useWorkspace();
  const forBusiness = businessId !== undefined ? businessId : admin ? null : ws.businessId;
  const q = useQuery(callDetailQuery(callId, forBusiness));
  const call = q.data;
  const tz = call?.business?.timezone ?? null;
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const integrationEvents = call?.call_events.filter((e) => /^(integration|webhook|crm|calendar|sms)\./.test(e.type)) ?? [];
  const isText = String(asRecord(call?.metadata)["channel"] ?? "").startsWith("sms");

  return (
    <Sheet open={!!callId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]" data-testid="call-detail">
        <SheetHeader className="border-b border-hairline px-5 py-4 text-left">
          {q.isPending ? (
            <div className="space-y-2">
              <SheetTitle className="sr-only">Loading call</SheetTitle>
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-72" />
            </div>
          ) : q.isError ? (
            <>
              <SheetTitle>Call unavailable</SheetTitle>
              <SheetDescription>{q.error.message}</SheetDescription>
            </>
          ) : call ? (
            <>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full", call.direction === "inbound" ? "bg-[#e6f6ff] text-[#0b5d87]" : "bg-[#efeeff] text-indigo")}>
                  {isText ? <MessageSquare className="h-3.5 w-3.5" /> : call.direction === "inbound" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                </span>
                <SheetTitle className="text-[16px]">{call.contact?.full_name || fmtPhone(call.direction === "inbound" ? call.from_number : call.to_number) || "Unknown caller"}</SheetTitle>
                <CallStatusBadge status={call.status} />
                <OutcomeBadge outcome={call.outcome} />
                {call.business?.is_demo ? <StatusBadge tone="warning">Demo</StatusBadge> : null}
              </div>
              <SheetDescription className="text-[12.5px]">
                {isText ? "Text conversation" : titleCase(call.direction)} · {tzDateTime(call.started_at, tz)} {tzAbbrev(call.started_at, tz)}
                {isText ? "" : ` · ${fmtDuration(call.duration_seconds)}`}
                {admin && call.business ? ` · ${call.business.name}` : ""}
              </SheetDescription>
            </>
          ) : null}
        </SheetHeader>

        {call ? (
          <div className="flex-1 overflow-y-auto">
            <div className="space-y-5 px-5 py-4">
              {!admin && call.direction === "inbound" && call.from_number ? (
                <Button asChild className="h-12 w-full text-[15px]" data-action="call-back">
                  <a href={`tel:${call.from_number}`}>
                    <Phone className="mr-2 h-4 w-4" /> Call {call.contact?.full_name?.split(" ")[0] || "them"} back
                  </a>
                </Button>
              ) : null}

              <KeyValue
                columns={2}
                items={[
                  { label: "Caller", value: <span>{call.contact?.full_name ?? "Unknown caller"}<span className="block text-[12px] text-ink-muted">{fmtPhone(call.direction === "inbound" ? call.from_number : call.to_number) || "No number"}</span></span> },
                  { label: "What they wanted", value: call.intent ?? "Not available" },
                  { label: "How it ended", value: <OutcomeBadge outcome={call.outcome} /> },
                  { label: isText ? "Conversation length" : "Talk time", value: fmtDuration(call.talk_time_seconds) },
                  ...(admin
                    ? [
                        { label: "Answered on", value: <span>{fmtPhone(call.phone_number?.e164 ?? (call.direction === "inbound" ? call.to_number : call.from_number)) || "—"}</span> },
                        { label: "Receptionist", value: call.agent?.name ?? "—" },
                        { label: "Handled by AI", value: call.ai_handled ? "Yes" : "No" },
                      ]
                    : []),
                  ...(call.after_hours ? [{ label: "After hours", value: "Yes" }] : []),
                ]}
              />

              {call.status === "failed" || call.error_code ? (
                <div className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]">
                  <span className="font-semibold">{call.error_code ?? "Call failed"}</span>
                  {call.error_message ? <span> — {call.error_message}</span> : null}
                </div>
              ) : null}

              <section>
                <SectionLabel className="mb-1.5">What happened</SectionLabel>
                {call.summary ? (
                  <p className="text-[13px] leading-5 text-ink" data-testid="call-summary">{call.summary}</p>
                ) : (
                  <p className="text-[12.5px] text-ink-muted">No summary was generated for this call.</p>
                )}
              </section>

              {call.transferred ? (
                <div className="flex items-center gap-2 rounded-[6px] border border-hairline bg-canvas-2 px-3 py-2 text-[12.5px]">
                  <PhoneForwarded className="h-4 w-4 text-coral" />
                  <span>
                    Transferred to a human{call.transfer_target ? <> at <span className="font-medium">{fmtPhone(call.transfer_target)}</span></> : null}.
                  </span>
                </div>
              ) : null}

              {admin ? (
              <section>
                <button
                  type="button"
                  onClick={() => setShowDiagnostics((v) => !v)}
                  aria-expanded={showDiagnostics}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-muted hover:text-ink"
                >
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showDiagnostics ? "" : "-rotate-90")} />
                  Call diagnostics
                </button>
                {showDiagnostics ? (
                  <div className="mt-2">
                    <KeyValue
                      columns={2}
                      items={[
                        { label: "Sentiment", value: <SentimentBadge sentiment={call.sentiment} /> },
                        { label: "Confidence", value: call.confidence != null ? fmtPercent(call.confidence) : "Not available" },
                        { label: "Handled by AI", value: call.ai_handled ? "Yes" : "No" },
                        { label: "Provider", value: <span className="break-all">{`${call.provider ? PROVIDER_LABELS[call.provider] : "Not available"}${call.provider_call_id ? ` · ${call.provider_call_id}` : ""}`}</span>, mono: true },
                      ]}
                    />
                  </div>
                ) : null}
              </section>
              ) : null}

              {(call.appointments.length > 0 || call.leads.length > 0) && (
                <section>
                  <SectionLabel className="mb-1.5">Linked records</SectionLabel>
                  <ul className="divide-y divide-hairline rounded-[6px] border border-hairline">
                    {call.appointments.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-[13px]">
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <CalendarDays className="h-4 w-4 shrink-0 text-cyan" />
                          <span className="min-w-0">
                            {a.service ?? "Booking"} <span className="text-ink-muted">· {tzDateTime(a.starts_at, tz)}{a.staff_name ? ` · ${a.staff_name}` : ""}</span>
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <AppointmentBadge status={a.status} />
                          {linkPrefix === "/app" ? (
                            <Link to="/app/bookings" search={{ booking: a.id }} className="text-[12px] font-medium text-indigo hover:underline">
                              View booking
                            </Link>
                          ) : null}
                        </span>
                      </li>
                    ))}
                    {call.leads.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-[13px]">
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <UserRound className="h-4 w-4 shrink-0 text-magenta" />
                          <span className="min-w-0">
                            {l.name ?? "Lead"} <span className="text-ink-muted">· {l.intent ?? "Enquiry"}</span>
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <LeadStageBadge stage={l.stage} />
                          {linkPrefix === "/app" ? (
                            <Link to="/app/leads" search={{ lead: l.id }} className="text-[12px] font-medium text-indigo hover:underline">
                              View follow-up
                            </Link>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {admin ? (
              <section>
                <SectionLabel className="mb-1.5">Recording</SectionLabel>
                <p className="text-[12.5px] text-ink-muted">Audio isn't stored for calls. The transcript is below.</p>
              </section>
              ) : null}

              {!admin ? (
                <section>
                  <SectionLabel className="mb-2">Transcript</SectionLabel>
                  <Transcript segments={call.transcript_segments} />
                </section>
              ) : (
              <Tabs defaultValue="transcript">
                <TabsList className="h-8 bg-canvas-2 p-0.5">
                  <TabsTrigger value="transcript" className="h-7 text-[12px]">Transcript</TabsTrigger>
                  <TabsTrigger value="timeline" className="h-7 text-[12px]">Timeline</TabsTrigger>
                  <TabsTrigger value="integrations" className="h-7 text-[12px]">Integrations</TabsTrigger>
                </TabsList>
                <TabsContent value="transcript" className="mt-3">
                  <Transcript segments={call.transcript_segments} />
                </TabsContent>
                <TabsContent value="timeline" className="mt-3">
                  <Timeline events={call.call_events} tz={tz} />
                </TabsContent>
                <TabsContent value="integrations" className="mt-3">
                  {integrationEvents.length === 0 ? (
                    <EmptyState compact title="No integration activity" description="Bookings and call-back requests made on this call appear here." />
                  ) : (
                    <Timeline events={integrationEvents} tz={tz} />
                  )}
                </TabsContent>
              </Tabs>
              )}
            </div>
          </div>
        ) : q.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
