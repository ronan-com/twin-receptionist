import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PhoneIncoming, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Panel, MetricCard, MetricGrid, ErrorState, EmptyState, Notice } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtDate, fmtNumber, fmtPhone } from "@/lib/app/format";
import { adminBusinessesQuery } from "@/lib/app/queries";
import { getConsoleNumberRequests, platformApi, requestNumberFor } from "@/lib/api/console";
import { formatNumber, type AdminNumberRequest, type AvailableNumber } from "@/lib/shared";
import { READ_ONLY_HINT, useConsole } from "./-shared";
import { named } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/admin/number-requests")({
  head: () => ({ meta: [{ title: named("Number requests — Answered admin") }] }),
  component: NumberRequestsPage,
});

const typeLabel = (t: string) => (t === "mobile" ? "Mobile (calls and texts)" : "Local (calls only)");

// A made-up number for a test lab receptionist (nothing is bought). US ones are in
// 555-0100 to 0199, which is kept for fiction.
function testNumber(r: AdminNumberRequest): string {
  if (r.country === "US") return `+1212555${String(100 + Math.floor(Math.random() * 100)).padStart(4, "0")}`;
  return `${r.type === "mobile" ? "+614" : "+617"}${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
}

function NumberRequestsPage() {
  const { platform } = useConsole();
  return platform ? <PlatformQueue /> : <AgencyRequests />;
}

// ---- The platform team: buy and connect, or decline ----

function PlatformQueue() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["console", "admin-number-requests"], queryFn: platformApi.numberRequests });
  const bizQ = useQuery(adminBusinessesQuery());
  const demoIds = useMemo(() => new Set((bizQ.data ?? []).filter((b) => b.is_demo).map((b) => b.id)), [bizQ.data]);
  const [picking, setPicking] = useState<{ id: string; options: AvailableNumber[] | null; error?: string } | null>(null);
  const [buying, setBuying] = useState<{ r: AdminNumberRequest; number: string; test?: boolean } | null>(null);
  const [declining, setDeclining] = useState<AdminNumberRequest | null>(null);
  const [reason, setReason] = useState("");

  const done = async (data: { requests: AdminNumberRequest[]; pending: number }) => {
    qc.setQueryData(["console", "admin-number-requests"], data);
    await qc.invalidateQueries({ queryKey: ["admin"] });
    await qc.invalidateQueries({ queryKey: ["console", "overview"] });
  };
  const decline = useMutation({
    mutationFn: () => platformApi.declineRequest(declining!.id, reason.trim()),
    onSuccess: async (d) => {
      toast.success("Request declined");
      setDeclining(null);
      setReason("");
      await done(d);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const buy = useMutation({
    mutationFn: () => platformApi.fulfilRequest(buying!.r.id, buying!.number),
    onSuccess: async (d) => {
      toast.success(buying?.test ? "Test number connected" : "Number bought and connected");
      setBuying(null);
      setPicking(null);
      await done(d);
    },
    onError: (e: Error) => toast.error("Couldn't connect the number", { description: e.message }),
  });

  // In the receptionist's country. The US has no mobiles to buy: its local numbers do calls (and texts once registered).
  const find = (r: AdminNumberRequest) => {
    setPicking({ id: r.id, options: null });
    platformApi
      .availableNumbers(r.country === "US" ? "local" : r.type, r.country)
      .then((options) => setPicking({ id: r.id, options }))
      .catch((err: Error) => setPicking({ id: r.id, options: [], error: err.message }));
  };

  const all = q.data?.requests ?? [];
  const pending = all.filter((r) => r.status === "pending");
  const recent = all.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-5" data-page="admin-number-requests">
      <PageHeader eyebrow="Platform console" title="Number requests" description="Agencies ask for numbers from a client's page. Numbers are bought on the platform's phone account and connected to the receptionist." />
      <MetricGrid cols={3}>
        <MetricCard label="Waiting" value={fmtNumber(pending.length)} icon={PhoneIncoming} loading={q.isPending} />
        <MetricCard label="Connected (14 days)" value={fmtNumber(recent.filter((r) => r.status === "done").length)} loading={q.isPending} />
        <MetricCard label="Declined (14 days)" value={fmtNumber(recent.filter((r) => r.status === "declined").length)} loading={q.isPending} />
      </MetricGrid>
      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}

      <Panel title="Waiting" padded={false}>
        {pending.length === 0 && !q.isPending ? (
          <EmptyState compact icon={PhoneIncoming} title="Nothing waiting" description="Agencies ask for numbers from a client's page." />
        ) : (
          <ul className="divide-y divide-hairline" data-list="pending-requests">
            {pending.map((r) => {
              const demo = demoIds.has(r.clientId);
              return (
                <li key={r.id} className="space-y-2 px-4 py-3 text-[13px]" data-request={r.id}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                        <Link to="/admin/clients/$businessId" params={{ businessId: r.clientId }} className="hover:underline">{r.business}</Link>
                        <span className="font-normal text-ink-muted">({r.agency})</span>
                        {demo ? <StatusBadge tone="warning">Test lab</StatusBadge> : null}
                      </div>
                      <div className="text-[12px] text-ink-muted">
                        {typeLabel(r.type)}
                        {r.country === "US" ? " · United States" : ""} · {fmtDate(r.createdAt)}
                        {r.requestedBy ? ` · ${r.requestedBy}` : ""}
                      </div>
                      {r.note ? <div className="text-[12px] text-ink-muted">“{r.note}”</div> : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {demo ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-[12.5px]"
                          onClick={() => setBuying({ r, number: testNumber(r), test: true })}
                          data-action="test-number"
                        >
                          Connect a test number
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="h-8 text-[12.5px]" onClick={() => find(r)} data-action="find-numbers">
                          Find numbers
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-8 text-[12.5px]" onClick={() => setDeclining(r)} data-action="decline">
                        Decline
                      </Button>
                    </div>
                  </div>
                  {picking?.id === r.id ? (
                    <div className="rounded-[6px] border border-hairline bg-canvas-2 p-2">
                      {r.country === "US" ? (
                        <p className="px-1 pb-1 text-[12px] text-ink-muted" data-note="us-texting">
                          US local numbers. Texting from them needs 10DLC registration in Telnyx first, so texts aren't switched on for them.
                        </p>
                      ) : null}
                      {picking.options === null ? <p className="px-1 text-[12.5px] text-ink-muted">Searching…</p> : null}
                      {picking.error ? <p className="px-1 text-[12.5px] text-[#a41d1d]">{picking.error}</p> : null}
                      {picking.options?.length === 0 && !picking.error ? <p className="px-1 text-[12.5px] text-ink-muted">No numbers available right now.</p> : null}
                      <ul className="divide-y divide-hairline">
                        {picking.options?.map((n) => (
                          <li key={n.phoneNumber} className="flex flex-col gap-1.5 px-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                            <span>
                              <span className="font-medium tabular-nums">{formatNumber(n.phoneNumber)}</span>
                              <span className="ml-2 text-[12px] text-ink-muted">US${(n.upfront + n.monthly).toFixed(2)} now, then US${n.monthly.toFixed(2)}/month</span>
                            </span>
                            <Button size="sm" className="h-7 text-[12px]" onClick={() => setBuying({ r, number: n.phoneNumber })}>
                              Buy and connect
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Recently dealt with" description="Last 14 days" padded={false}>
        {recent.length === 0 ? (
          <EmptyState compact title="Nothing yet" />
        ) : (
          <ul className="divide-y divide-hairline" data-list="recent-requests">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-4 py-2.5 text-[12.5px] sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0 truncate">
                  <span className="text-ink">{r.business}</span> <span className="text-ink-muted">({r.agency}) · {typeLabel(r.type)}</span>
                  {r.status === "done" && r.phoneNumber ? <span className="text-ink-muted"> · {fmtPhone(r.phoneNumber)}</span> : null}
                  {r.status === "declined" && r.reason ? <span className="text-ink-muted"> · “{r.reason}”</span> : null}
                </span>
                <StatusBadge tone={r.status === "done" ? "success" : "muted"}>{r.status === "done" ? "Connected" : "Declined"}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Dialog open={!!buying} onOpenChange={(o) => !o && setBuying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{buying?.test ? "Connect a test number?" : "Buy this number?"}</DialogTitle>
            <DialogDescription>
              {buying?.test
                ? `${buying ? formatNumber(buying.number) : ""} is recorded for ${buying?.r.business}. It's a test lab receptionist, so nothing is bought.`
                : `${buying ? formatNumber(buying.number) : ""} for ${buying?.r.business}. It's charged to the platform's phone account.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuying(null)}>Cancel</Button>
            <Button onClick={() => buy.mutate()} disabled={buy.isPending} data-action="confirm-buy">
              {buy.isPending ? "Connecting…" : buying?.test ? "Connect" : "Buy and connect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!declining} onOpenChange={(o) => !o && setDeclining(null)}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              decline.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Decline the request?</DialogTitle>
              <DialogDescription>{declining?.business} ({declining?.agency}) will see that it was declined, with your reason.</DialogDescription>
            </DialogHeader>
            <Field label="Reason (optional)" htmlFor="decline-reason" className="mt-4">
              <Input id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. No Brisbane numbers available this week" />
            </Field>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setDeclining(null)}>Cancel</Button>
              <Button type="submit" disabled={decline.isPending} data-action="confirm-decline">
                {decline.isPending ? "Declining…" : "Decline"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Agency staff: their own requests, and a new one ----

function AgencyRequests() {
  const { readOnly } = useConsole();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["console", "number-requests"], queryFn: getConsoleNumberRequests });
  const bizQ = useQuery(adminBusinessesQuery());
  const [clientId, setClientId] = useState("");
  const [type, setType] = useState<"local" | "mobile">("mobile");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");

  const request = useMutation({
    mutationFn: () => requestNumberFor(clientId, type, note.trim()),
    onSuccess: async () => {
      toast.success("Number requested", { description: "The platform team will buy and connect it." });
      setNote("");
      await qc.invalidateQueries({ queryKey: ["console"] });
      await qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error("Couldn't request a number", { description: e.message }),
  });

  const rows = (q.data ?? []).filter((r) => !search.trim() || r.business.toLowerCase().includes(search.trim().toLowerCase()));
  const pending = (q.data ?? []).filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-5" data-page="admin-number-requests">
      <PageHeader eyebrow="Agency console" title="Number requests" description="Ask for a phone number for a client. The platform team buys it and connects it to the receptionist, usually within a business day." />
      <MetricGrid cols={3}>
        <MetricCard label="Waiting" value={fmtNumber(pending)} icon={PhoneIncoming} loading={q.isPending} />
        <MetricCard label="Connected" value={fmtNumber((q.data ?? []).filter((r) => r.status === "done").length)} loading={q.isPending} />
        <MetricCard label="Declined" value={fmtNumber((q.data ?? []).filter((r) => r.status === "declined").length)} loading={q.isPending} />
      </MetricGrid>
      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}

      {readOnly ? (
        <Notice tone="info">{READ_ONLY_HINT}</Notice>
      ) : (
        <Panel title="Request a number">
          <form
            className="grid gap-3 sm:grid-cols-[1fr_200px] lg:grid-cols-[1fr_200px_1fr_auto] lg:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (clientId) request.mutate();
            }}
          >
            <Field label="Client" htmlFor="nr-client">
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="nr-client" className="h-9"><SelectValue placeholder="Choose a client" /></SelectTrigger>
                <SelectContent>
                  {(bizQ.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Type" htmlFor="nr-type">
              <Select value={type} onValueChange={(v) => setType(v as "local" | "mobile")}>
                <SelectTrigger id="nr-type" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mobile">Mobile (calls and texts)</SelectItem>
                  <SelectItem value="local">Local (calls only)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Note (optional)" htmlFor="nr-note">
              <Input id="nr-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="h-9" placeholder="e.g. 07 area code" />
            </Field>
            <Button type="submit" className="h-9" disabled={!clientId || request.isPending}>
              {request.isPending ? "Requesting…" : "Request"}
            </Button>
          </form>
        </Panel>
      )}

      <Panel title="Your requests" padded={false} actions={<div className="relative w-44 sm:w-56"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client" className="h-8 pl-8 text-[12.5px]" aria-label="Search requests" /></div>}>
        {rows.length === 0 && !q.isPending ? (
          <EmptyState compact icon={PhoneIncoming} title="No requests yet" />
        ) : (
          <ul className="divide-y divide-hairline" data-list="requests">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-4 py-2.5 text-[12.5px] sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <Link to="/admin/clients/$businessId" params={{ businessId: r.clientId }} className="font-medium text-ink hover:underline">{r.business}</Link>
                  <span className="block truncate text-ink-muted">
                    {typeLabel(r.type)} · {fmtDate(r.createdAt)}
                    {r.status === "done" && r.phoneNumber ? ` · ${fmtPhone(r.phoneNumber)}` : ""}
                    {r.status === "declined" && r.reason ? ` · “${r.reason}”` : ""}
                  </span>
                </span>
                <StatusBadge tone={r.status === "pending" ? "warning" : r.status === "done" ? "success" : "muted"}>{r.status === "pending" ? "Waiting" : r.status === "done" ? "Connected" : "Declined"}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
