import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, CalendarClock, Clock, Download, Loader2, Phone, Search, Sparkles, Target, TrendingUp, UserPlus, Users } from "lucide-react";
import { updateLead, type LeadPatch } from "@/lib/api/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader, Panel, ErrorState, MetricCard, MetricGrid, KeyValue, Notice } from "@/components/app/primitives";
import { DataTable, TableToolbar, type Column } from "@/components/app/DataTable";
import { LeadStageBadge, StatusBadge } from "@/components/app/StatusBadge";
import { CallDetailSheet } from "@/components/app/CallDetailSheet";
import { Field } from "@/components/app/forms";
import { LEAD_STAGES, LEAD_STAGE_LABELS } from "@/lib/app/constants";
import { fmtCurrency, fmtDateTime, fmtNumber, fmtPhone, fmtRelative, humanize, initials } from "@/lib/app/format";
import { leadsQuery, teamQuery } from "@/lib/app/queries";
import type { Lead, LeadStage } from "@/lib/app/types";
import { useWorkspace } from "@/lib/app/workspace";
import { isFollowUpDone, instantToLocalInput, resolveLocalInput, tzAbbrev, tzDateTime, tzDayKey } from "@/lib/app/business-logic";
import { cn } from "@/lib/utils";
import { named } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/app/leads")({
  validateSearch: (search: Record<string, unknown>): { lead?: string } => ({
    lead: typeof search['lead'] === "string" && search['lead'] ? String(search['lead']) : undefined,
  }),
  head: () => ({
    meta: [
      { title: named("Follow-ups — Answered") },
      { name: "description", content: "Everyone who asked your receptionist to get back to them, with what they wanted and what happens next." },
    ],
  }),
  component: LeadsPage,
});

const STAGE_TONE: Record<LeadStage, string> = {
  new: "border-l-indigo",
  contacted: "border-l-cyan",
  qualified: "border-l-[#f0a800]",
  proposal: "border-l-magenta",
  won: "border-l-[#1a9c5b]",
  lost: "border-l-hairline",
};

function qualificationEntries(q: unknown): { label: string; value: string }[] {
  if (!q || typeof q !== "object" || Array.isArray(q)) return [];
  return Object.entries(q as Record<string, unknown>).map(([k, v]) => ({ label: humanize(k), value: typeof v === "string" ? v : JSON.stringify(v) }));
}

function toCsv(rows: Lead[]) {
  const head = ["Created", "Name", "Phone", "Email", "Intent", "Stage", "Value", "Follow-up", "Enquiry"];
  // Quoted, and text a spreadsheet would run as a formula (=, @, +/- before a non-digit) is defused.
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    const safe = /^[=@\t\r]|^[+-](?![\d\s(])/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = rows.map((l) =>
    [l.created_at, l.name, l.phone, l.email, l.intent, l.stage, l.value_cents != null ? (l.value_cents / 100).toFixed(2) : "", l.follow_up_at ?? "", l.enquiry].map(esc).join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

function LeadsPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const q = useQuery(leadsQuery(ws.businessId));
  const teamQ = useQuery(teamQuery(ws.businessId));
  const tz = ws.business?.timezone ?? null;
  const canEdit = ws.access.canEdit;

  const [view, setView] = useState<"pipeline" | "list">("list");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<LeadStage | "all">("all");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [dueInput, setDueInput] = useState("");
  const [valueInput, setValueInput] = useState("");

  const all = q.data ?? [];

  // Deep link from the dashboard attention inbox: open that exact follow-up once.
  const deepLinked = Route.useSearch().lead ?? null;
  const openedDeepLink = useRef(false);
  useEffect(() => {
    if (openedDeepLink.current || !deepLinked) return;
    const match = all.find((l) => l.id === deepLinked);
    if (!match) return;
    openedDeepLink.current = true;
    setSelected(match);
    setSummary(match.summary ?? "");
    setDueInput(instantToLocalInput(match.follow_up_at, tz));
    setValueInput(match.value_cents != null ? String(match.value_cents / 100) : "");
  }, [deepLinked, all]);


  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return all.filter((l) => {
      if (stage !== "all" && l.stage !== stage) return false;
      if (s) {
        const hay = [l.name, l.phone, l.email, l.intent, l.enquiry, l.summary].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [all, search, stage]);

  const stats = useMemo(() => {
    // Actionable counts only ever look at follow-ups that are still live: closed
    // stages (won/lost) and follow-ups already marked done are never counted.
    const actionable = all.filter((l) => l.stage !== "won" && l.stage !== "lost" && !isFollowUpDone(l.follow_up_status));
    const won = all.filter((l) => l.stage === "won");
    const closed = all.filter((l) => l.stage === "won" || l.stage === "lost");
    const openForValue = all.filter((l) => l.stage !== "won" && l.stage !== "lost");
    const pipelineValue = openForValue.reduce((s, l) => s + (l.value_cents ?? 0), 0);
    const wonValue = won.reduce((s, l) => s + (l.value_cents ?? 0), 0);
    const now = Date.now();
    const overdue = actionable.filter((l) => l.follow_up_at && new Date(l.follow_up_at).getTime() < now).length;
    // "Due today" uses the business day, not the browser's, so a late-evening
    // viewer in another timezone still sees the client's own day.
    const todayKey = tzDayKey(new Date(), tz);
    const dueToday = actionable.filter((l) => l.follow_up_at && tzDayKey(l.follow_up_at, tz) === todayKey).length;
    const unassigned = actionable.filter((l) => !l.assigned_to).length;
    return { open: actionable.length, overdue, dueToday, unassigned, pipelineValue, wonValue, winRate: closed.length ? won.length / closed.length : 0 };
  }, [all, tz]);


  const update = useMutation({
    mutationFn: (input: { id: string } & LeadPatch) => {
      const { id, ...patch } = input;
      return updateLead(ws.businessId!, id, patch);
    },
    onSuccess: (saved, input) => {
      toast.success(input.stage ? `Moved to ${LEAD_STAGE_LABELS[input.stage]}` : "Follow-up updated");
      void qc.invalidateQueries({ queryKey: ["leads", ws.businessId] });
      if (selected && selected.id === saved.id) setSelected(saved);
    },
    onError: (e) => toast.error("Couldn't update lead", { description: e.message }),
  });

  const openDetail = (l: Lead) => {
    setSelected(l);
    setSummary(l.summary ?? "");
    setDueInput(instantToLocalInput(l.follow_up_at, tz));
    setValueInput(l.value_cents != null ? (l.value_cents / 100).toString() : "");
  };

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `answered-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} leads`);
  };

  const columns: Column<Lead>[] = [
    {
      key: "lead",
      header: "Lead",
      cell: (l) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-canvas-2 text-[11px] font-semibold text-ink-muted">{initials(l.name)}</span>
          <div className="min-w-0">
            <div className="truncate font-medium">{l.name ?? "Unknown caller"}</div>
            <div className="truncate text-[12px] text-ink-muted">{fmtPhone(l.phone) || l.email || "—"}</div>
          </div>
        </div>
      ),
    },
    { key: "intent", header: "Intent", cell: (l) => <span>{l.intent ?? "—"}</span>, hideBelow: "md" },
    { key: "enquiry", header: "Enquiry", cell: (l) => <span className="line-clamp-1 max-w-[320px] text-ink-muted">{l.enquiry ?? l.summary ?? "—"}</span>, hideBelow: "lg" },
    { key: "value", header: "Value", align: "right", cell: (l) => <span className="tabular-nums">{l.value_cents != null ? fmtCurrency(l.value_cents) : "—"}</span>, hideBelow: "sm" },
    {
      key: "follow",
      header: "Follow-up",
      hideBelow: "lg",
      cell: (l) =>
        l.follow_up_at ? (
          <span className={cn("whitespace-nowrap", new Date(l.follow_up_at).getTime() < Date.now() && !isFollowUpDone(l.follow_up_status) && l.stage !== "won" && l.stage !== "lost" ? "font-medium text-[#a41d1d]" : "text-ink-muted")}>
            {fmtRelative(l.follow_up_at)}
          </span>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    { key: "stage", header: "Stage", align: "right", cell: (l) => <LeadStageBadge stage={l.stage} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={ws.business?.name}
        title="Follow-ups"
        description="Everyone who asked for a call back, what they wanted and what happens next."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
            <div className="flex items-center rounded-[6px] border border-hairline bg-white p-0.5">
              {(["pipeline", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn("rounded-[4px] px-3 py-1 text-[12.5px] font-medium capitalize transition-colors", view === v ? "bg-canvas-2 text-ink" : "text-ink-muted hover:text-ink")}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {q.error ? <ErrorState message={q.error.message} onRetry={() => void q.refetch()} /> : null}

      {view === "list" ? (
        <MetricGrid cols={4}>
          <MetricCard label="Open" value={fmtNumber(stats.open)} icon={Users} loading={q.isPending} hint="Follow-ups still waiting on someone" />
          <MetricCard label="Overdue" value={fmtNumber(stats.overdue)} icon={Clock} loading={q.isPending} hint={stats.overdue ? "Past their due time" : "Nothing past due"} />
          <MetricCard label="Due today" value={fmtNumber(stats.dueToday)} icon={CalendarClock} loading={q.isPending} hint={`Your business day${tz ? ` (${tzAbbrev(new Date(), tz)})` : ""}`} />
          <MetricCard label="Unassigned" value={fmtNumber(stats.unassigned)} icon={UserPlus} loading={q.isPending} hint={stats.unassigned ? "Nobody owns these yet" : "All have an owner"} />
        </MetricGrid>
      ) : (
        // Money figures live in the optional pipeline view only, and stack to a
        // single column on the narrowest phones so currency never clips.
        <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Open leads" value={fmtNumber(stats.open)} icon={Users} loading={q.isPending} hint={stats.overdue ? `${stats.overdue} overdue follow-up${stats.overdue === 1 ? "" : "s"}` : "All follow-ups on track"} />
          <MetricCard label="Pipeline value" value={fmtCurrency(stats.pipelineValue)} icon={Target} loading={q.isPending} hint="Estimated value of open leads" />
          <MetricCard label="Won" value={fmtCurrency(stats.wonValue)} icon={TrendingUp} loading={q.isPending} hint={`${Math.round(stats.winRate * 100)}% win rate`} />
          <MetricCard label="Captured by receptionist" value={fmtNumber(all.filter((l) => l.call_id).length)} icon={Sparkles} loading={q.isPending} hint="Leads that started as a phone call" />
        </div>
      )}


      {view === "pipeline" ? (
        <div className="-mx-3 overflow-x-auto px-3 pb-2 sm:-mx-5 sm:px-5 md:mx-0 md:px-0">
          <div className="grid min-w-[900px] grid-cols-6 gap-3">
            {LEAD_STAGES.map((s) => {
              const col = all.filter((l) => l.stage === s);
              const value = col.reduce((t, l) => t + (l.value_cents ?? 0), 0);
              return (
                <div key={s} className="rounded-[6px] border border-hairline bg-canvas-2/60">
                  <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-semibold text-ink">{LEAD_STAGE_LABELS[s]}</span>
                      <span className="rounded-full bg-white px-1.5 text-[11px] tabular-nums text-ink-muted ring-1 ring-hairline">{col.length}</span>
                    </div>
                    <span className="text-[11px] tabular-nums text-ink-muted">{value ? fmtCurrency(value) : ""}</span>
                  </div>
                  <div className="max-h-[560px] space-y-2 overflow-y-auto p-2">
                    {q.isPending ? (
                      <div className="h-16 animate-pulse rounded-[4px] bg-white" />
                    ) : col.length === 0 ? (
                      <div className="px-1 py-4 text-center text-[11.5px] text-ink-muted/70">Empty</div>
                    ) : (
                      col.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => openDetail(l)}
                          className={cn("block w-full rounded-[4px] border-l-2 bg-white p-2.5 text-left ring-1 ring-hairline transition-colors hover:bg-[#fbfcfe]", STAGE_TONE[s])}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-medium text-ink">{l.name ?? "Unknown caller"}</div>
                              <div className="truncate text-[11.5px] text-ink-muted">{l.intent ?? fmtPhone(l.phone)}</div>
                            </div>
                            {l.value_cents != null ? <span className="shrink-0 text-[11.5px] tabular-nums text-ink-muted">{fmtCurrency(l.value_cents)}</span> : null}
                          </div>
                          {l.enquiry ? <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-4 text-ink-muted">{l.enquiry}</p> : null}
                          <div className="mt-2 flex items-center justify-between text-[11px] text-ink-muted">
                            <span>{fmtRelative(l.created_at)}</span>
                            {l.follow_up_at && s !== "won" && s !== "lost" ? (
                              <span className={cn(new Date(l.follow_up_at).getTime() < Date.now() && !isFollowUpDone(l.follow_up_status) ? "font-medium text-[#a41d1d]" : "")}>
                                Follow up {fmtRelative(l.follow_up_at)}
                              </span>
                            ) : null}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <Panel padded={false}>
          <TableToolbar>
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads…" className="h-8 pl-8 text-[13px]" aria-label="Search leads" />
            </div>
            <Select value={stage} onValueChange={(v) => setStage(v as LeadStage | "all")}>
              <SelectTrigger className="h-8 w-[140px] text-[12.5px]" aria-label="Stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {LEAD_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {LEAD_STAGE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-auto text-[12px] text-ink-muted">{fmtNumber(rows.length)} leads</span>
          </TableToolbar>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(l) => l.id}
            loading={q.isPending}
            onRowClick={openDetail}
            empty={{ icon: Users, title: all.length === 0 ? "No leads yet" : "Nothing matches", description: all.length === 0 ? "When a caller enquires about something you sell, your receptionist captures their details here." : "Try a different search or stage." }}
          />
        </Panel>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {selected ? (
            <div className="space-y-5">
              <SheetHeader className="p-0 text-left">
                <LeadStageBadge stage={selected.stage} />
                <SheetTitle className="text-[18px]">{selected.name ?? "Unknown caller"}</SheetTitle>
                <SheetDescription>{selected.intent ?? "Enquiry"} · captured {fmtRelative(selected.created_at)}</SheetDescription>
              </SheetHeader>

              <div className="flex flex-wrap gap-2">
                {selected.phone ? (
                  <Button asChild variant="outline" size="sm" className="h-8">
                    <a href={`tel:${selected.phone}`}>
                      <Phone className="mr-1.5 h-3.5 w-3.5" /> {fmtPhone(selected.phone)}
                    </a>
                  </Button>
                ) : null}
                {selected.email ? (
                  <Button asChild variant="outline" size="sm" className="h-8">
                    <a href={`mailto:${selected.email}`}>{selected.email}</a>
                  </Button>
                ) : null}
                {selected.call_id ? (
                  <Button variant="outline" size="sm" className="h-8" onClick={() => setCallId(selected.call_id)}>
                    Open call <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>

              {selected.enquiry ? (
                <div className="rounded-[6px] border border-hairline bg-canvas-2 p-3 text-[13px] leading-5 text-ink">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">What they asked for</div>
                  {selected.enquiry}
                </div>
              ) : null}

              {qualificationEntries(selected.qualification).length > 0 ? (
                <div>
                  <div className="mb-2 text-[12.5px] font-medium text-ink">Qualification answers</div>
                  <KeyValue columns={1} items={qualificationEntries(selected.qualification)} />
                </div>
              ) : null}

              <KeyValue
                columns={2}
                items={[
                  { label: "Due", value: selected.follow_up_at ? tzDateTime(selected.follow_up_at, tz) : "Not scheduled" },
                  { label: "Owner", value: (teamQ.data?.members ?? []).find((mem) => mem.user_id === selected.assigned_to)?.profile?.full_name ?? (selected.assigned_to ? "Team member" : "Unassigned") },
                  { label: "Follow-up status", value: humanize(selected.follow_up_status) },
                  { label: "Value", value: selected.value_cents != null ? fmtCurrency(selected.value_cents) : "—" },
                  { label: "Updated", value: fmtRelative(selected.updated_at) },
                ]}
              />

              {canEdit ? (
                <>
                  <div className="space-y-2">
                    <div className="text-[12.5px] font-medium text-ink">Move to</div>
                    <div className="flex flex-wrap gap-1.5">
                      {LEAD_STAGES.filter((s) => s !== selected.stage).map((s) => (
                        <Button key={s} variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => update.mutate({ id: selected.id, stage: s })} disabled={update.isPending}>
                          {LEAD_STAGE_LABELS[s]}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Estimated value (AUD)" htmlFor="lead-value">
                      <Input id="lead-value" inputMode="decimal" value={valueInput} onChange={(e) => setValueInput(e.target.value)} placeholder="0.00" />
                    </Field>
                    <Field label="Follow-up" htmlFor="lead-follow">
                      <Select value={selected.follow_up_status} onValueChange={(v) => update.mutate({ id: selected.id, follow_up_status: v })}>
                        <SelectTrigger id="lead-follow"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="scheduled">Scheduled</SelectItem>
                          <SelectItem value="done">Done</SelectItem>
                          <SelectItem value="not_required">Not required</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Due date" htmlFor="lead-due" hint={`Shown in ${tzAbbrev(new Date(), tz)}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input id="lead-due" type="datetime-local" value={dueInput} onChange={(e) => setDueInput(e.target.value)} className="min-w-[190px] flex-1" />
                        {dueInput !== instantToLocalInput(selected.follow_up_at, tz) ? (
                          <Button
                            size="sm"
                            className="h-8 text-[12px]"
                            disabled={update.isPending}
                            onClick={() => {
                              const res = dueInput ? resolveLocalInput(dueInput, tz) : null;
                              if (dueInput && !res?.iso) {
                                toast.error(res?.note || "Enter a valid date and time");
                                return;
                              }
                              if (res?.kind === "fold") toast.info(res.note);
                              update.mutate({ id: selected.id, follow_up_at: res?.iso ?? null });
                            }}
                          >
                            Save
                          </Button>
                        ) : null}
                      </div>
                    </Field>
                    <Field label="Owner" htmlFor="lead-owner" hint="Who is chasing this up">
                      <Select
                        value={selected.assigned_to ?? "unassigned"}
                        onValueChange={(v) => update.mutate({ id: selected.id, assigned_to: v === "unassigned" ? null : v })}
                      >
                        <SelectTrigger id="lead-owner"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {(teamQ.data?.members ?? []).map((mem) => (
                            <SelectItem key={mem.user_id} value={mem.user_id}>
                              {mem.profile?.full_name ?? mem.profile?.email ?? "Team member"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Next action" htmlFor="lead-summary">
                    <Textarea id="lead-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What happens next, for whoever picks this up." />
                  </Field>
                  {summary !== (selected.summary ?? "") || valueInput !== (selected.value_cents != null ? (selected.value_cents / 100).toString() : "") ? (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={() => {
                          const parsed = valueInput.trim() === "" ? null : Math.round(Number(valueInput.replace(/[^0-9.]/g, "")) * 100);
                          if (parsed != null && !Number.isFinite(parsed)) {
                            toast.error("Enter a valid amount");
                            return;
                          }
                          update.mutate({ id: selected.id, summary, value_cents: parsed });
                        }}
                        disabled={update.isPending}
                      >
                        {update.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Save changes
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <Notice tone="neutral">{ws.access.readOnlyReason}</Notice>
              )}
              {selected.summary && !canEdit ? <StatusBadge tone="muted">{selected.summary}</StatusBadge> : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <CallDetailSheet callId={callId} onOpenChange={(o) => !o && setCallId(null)} linkPrefix="/app" />
    </div>
  );
}
