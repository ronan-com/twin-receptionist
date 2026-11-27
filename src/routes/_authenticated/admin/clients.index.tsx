import { NeedsPhone, usePhoneKeyNeeded } from "@/components/app/PhoneGate";
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Download, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Panel, MetricCard, MetricGrid, ErrorState, InitialsAvatar } from "@/components/app/primitives";
import { DataTable, TableToolbar, type Column } from "@/components/app/DataTable";
import { DemoBadge, StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtDate, fmtNumber, fmtRelative } from "@/lib/app/format";
import { downloadCsv } from "@/lib/app/csv";
import { companyApi, type CompanyRow } from "@/lib/api/console";
import { INDUSTRIES, industry as industryPreset, type IndustryKey } from "@/lib/shared";
import { AutomationChips, LinkBox, useConsole } from "./-shared";
import { cn } from "@/lib/utils";
import { PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/admin/clients/")({
  head: () => ({ meta: [{ title: `Clients — ${PRODUCT} admin` }] }),
  component: ClientsPage,
});

const companiesKey = ["console", "companies"] as const;

function ClientsPage() {
  const { platform, readOnly } = useConsole();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: companiesKey, queryFn: companyApi.list });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [agency, setAgency] = useState("all");
  const [showDemo, setShowDemo] = useState(true);
  const [adding, setAdding] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("add") === "1");
  // No phone provider yet: a new client opens on its own page, not the receptionist wizard.
  const phoneNeeded = usePhoneKeyNeeded();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<IndustryKey>("other");
  const [mode, setMode] = useState<"self" | "link">("self");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ id: string; url: string; emailed: boolean; added: boolean; email: string } | null>(null);

  const onboard = useMutation({
    mutationFn: () => companyApi.sendOnboarding({ name: name.trim(), industry: kind, email: email.trim() }),
    onSuccess: async (r) => {
      setSent({ ...r, email: email.trim() });
      setName("");
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["console"] });
    },
    onError: (e: Error) => toast.error("Couldn't send the onboarding link", { description: e.message }),
  });
  const add = useMutation({
    mutationFn: () => companyApi.create({ name: name.trim(), industry: kind }),
    onSuccess: async (id) => {
      setAdding(false);
      setName("");
      await qc.invalidateQueries({ queryKey: ["console"] });
      if (phoneNeeded) void navigate({ to: "/admin/clients/$businessId", params: { businessId: id } });
      else void navigate({ to: "/admin/receptionists/new", search: { company: id } });
    },
    onError: (e: Error) => toast.error("Couldn't add the client", { description: e.message }),
  });

  const agencies = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of q.data ?? []) m.set(b.org_id, b.org_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [q.data]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((b) => {
      if (!showDemo && b.is_demo) return false;
      if (status !== "all" && b.status !== status) return false;
      if (agency !== "all" && b.org_id !== agency) return false;
      if (!s) return true;
      return [b.name, b.industry, b.org_name, ...b.receptionists.flatMap((r) => [r.name, r.business_name, ...r.numbers])].some((v) => v?.toLowerCase().includes(s));
    });
  }, [q.data, search, status, agency, showDemo]);

  const stats = useMemo(() => {
    const all = (q.data ?? []).filter((b) => !b.is_demo);
    return {
      total: all.length,
      receptionists: all.reduce((n, b) => n + b.receptionists.length, 0),
      paused: all.filter((b) => b.status === "paused").length,
      shared: all.filter((b) => b.customers > 0).length,
      numbers: all.filter((b) => b.numbers > 0).length,
    };
  }, [q.data]);

  const columns: Column<CompanyRow>[] = [
    {
      key: "name",
      header: "Client",
      cell: (b) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <InitialsAvatar name={b.name} size={28} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate font-medium text-ink">
              <span className="truncate">{b.name}</span> {b.is_demo ? <DemoBadge /> : null}
            </div>
            <div className="truncate text-[12px] text-ink-muted">
              {[b.industry ? industryPreset(b.industry as IndustryKey).label : "", platform ? b.org_name : ""].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (b) =>
        b.onboarding_pending ? (
          <StatusBadge tone="warning" dot>
            <span data-onboarding="pending">Waiting for client to finish setup</span>
          </StatusBadge>
        ) : b.receptionists.length === 0 ? (
          <StatusBadge tone="muted">Setting up</StatusBadge>
        ) : (
          <StatusBadge tone={b.status === "active" ? "success" : "muted"} dot>
            {b.status === "active" ? "Active" : "Paused"}
          </StatusBadge>
        ),
    },
    {
      key: "receptionists",
      header: "Receptionists",
      hideBelow: "lg",
      cell: (b) => <span className="truncate">{b.receptionists.length ? b.receptionists.map((r) => r.name).join(", ") : <span className="text-ink-muted">None yet</span>}</span>,
    },
    { key: "automations", header: "Automations", hideBelow: "md", cell: (b) => <AutomationChips items={b.automations} compact /> },
    { key: "customers", header: "Customers", align: "right", hideBelow: "lg", cell: (b) => <span className="tabular-nums">{b.customers}{b.pending_invites ? ` (+${b.pending_invites})` : ""}</span> },
    { key: "calls", header: "Calls 30d", align: "right", hideBelow: "sm", cell: (b) => <span className="tabular-nums">{fmtNumber(b.calls_30d)}</span> },
    { key: "created", header: "Since", hideBelow: "xl", cell: (b) => <span className="whitespace-nowrap text-ink-muted">{fmtDate(b.created_at)}</span> },
  ];

  return (
    <div className="space-y-5" data-page="admin-clients">
      <PageHeader
        eyebrow={platform ? "Platform console" : "Agency console"}
        title="Clients"
        description={
          platform
            ? "Every company on the platform, the agency that looks after it, and its automations."
            : "The companies you look after. Open one to see its receptionists, automations, calls and customers."
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[12.5px]"
              onClick={() =>
                downloadCsv(
                  `answered-clients-${new Date().toISOString().slice(0, 10)}.csv`,
                  rows.map((b) => ({ name: b.name, agency: b.org_name, status: b.status, industry: b.industry, receptionists: b.receptionists.length, numbers: b.numbers, customers: b.customers, calls_30d: b.calls_30d, created: b.created_at, demo: b.is_demo })),
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
            {!readOnly ? (
              <>
                <Button variant="outline" size="sm" className="h-8 text-[12.5px]" onClick={() => setAdding(true)} data-action="add-client">
                  <Building2 className="mr-1.5 h-3.5 w-3.5" /> Add client
                </Button>
                <NeedsPhone className="h-8 text-[12.5px]" label={<><Plus className="mr-1.5 h-3.5 w-3.5" /> New receptionist</>}>
                <Button asChild size="sm" className="h-8 text-[12.5px]">
                  <Link to="/admin/receptionists/new" data-action="new-receptionist">
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> New receptionist
                  </Link>
                </Button>
                </NeedsPhone>
              </>
            ) : null}
          </>
        }
      />

      <MetricGrid cols={5}>
        <MetricCard label="Clients" value={fmtNumber(stats.total)} hint="Excluding demo" icon={Building2} loading={q.isPending} />
        <MetricCard label="Receptionists" value={fmtNumber(stats.receptionists)} loading={q.isPending} />
        <MetricCard label="Paused" value={fmtNumber(stats.paused)} loading={q.isPending} />
        <MetricCard label="With a number" value={fmtNumber(stats.numbers)} loading={q.isPending} />
        <MetricCard label="Shared with customers" value={fmtNumber(stats.shared)} loading={q.isPending} />
      </MetricGrid>

      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}

      <Panel padded={false}>
        <TableToolbar>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients" className="h-8 pl-8 text-[12.5px]" aria-label="Search clients" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-[130px] text-[12.5px]" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </SelectContent>
          </Select>
          {platform && agencies.length > 1 ? (
            <Select value={agency} onValueChange={setAgency}>
              <SelectTrigger className="h-8 w-[170px] text-[12.5px]" aria-label="Agency"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agencies</SelectItem>
                {agencies.map(([id, n]) => (
                  <SelectItem key={id} value={id}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-muted">
            <Switch checked={showDemo} onCheckedChange={setShowDemo} aria-label="Show demo clients" /> Demo
          </label>
          <span className="text-[12px] tabular-nums text-ink-muted">{rows.length} shown</span>
        </TableToolbar>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(b) => b.id}
          onRowClick={(b) => void navigate({ to: "/admin/clients/$businessId", params: { businessId: b.id } })}
          loading={q.isPending}
          empty={{
            title: (q.data ?? []).length ? "No clients match" : "No clients yet",
            description: (q.data ?? []).length ? "Try clearing the search or filters." : "Create a receptionist for the first company you look after.",
            icon: Building2,
            action:
              !readOnly && !(q.data ?? []).length ? (
                <NeedsPhone label="New receptionist">
                <Button asChild size="sm">
                  <Link to="/admin/receptionists/new">New receptionist</Link>
                </Button>
                </NeedsPhone>
              ) : undefined,
          }}
        />
      </Panel>

      <p className="text-[11.5px] text-ink-muted">Last refreshed {fmtRelative(q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null)}.</p>

      <Dialog
        open={adding}
        onOpenChange={(o) => {
          setAdding(o);
          if (!o) setSent(null);
        }}
      >
        <DialogContent>
          {sent ? (
            <div data-onboarding-sent>
              <DialogHeader>
                <DialogTitle>Onboarding link ready</DialogTitle>
                <DialogDescription>
                  {sent.added
                    ? `${sent.email} already has a login: they can now manage this client from their workspace.`
                    : sent.emailed
                      ? `Emailed to ${sent.email}. You can also send them this link:`
                      : `Send ${sent.email} this link. They set a password and finish setting up the receptionist (invite emails aren't set up on this server yet).`}
                </DialogDescription>
              </DialogHeader>
              {sent.url ? (
                <div className="mt-4">
                  <LinkBox url={sent.url} label="Onboarding link" />
                </div>
              ) : null}
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => void navigate({ to: "/admin/clients/$businessId", params: { businessId: sent.id } })}>
                  Open the client
                </Button>
                <Button type="button" onClick={() => (setAdding(false), setSent(null))}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                if (mode === "link") onboard.mutate();
                else add.mutate();
              }}
            >
              <DialogHeader>
                <DialogTitle>Add a client</DialogTitle>
                <DialogDescription>A company you look after.</DialogDescription>
              </DialogHeader>
              <div className="mt-4 grid gap-3">
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How to set it up">
                  {(
                    [
                      ["self", "Set it up myself", "Go through the receptionist setup now."],
                      ["link", "Send the client an onboarding link", "They finish the setup in their own workspace."],
                    ] as const
                  ).map(([v, t, d]) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={mode === v}
                      data-mode={v}
                      onClick={() => setMode(v)}
                      className={cn("rounded-[6px] border px-3 py-2 text-left", mode === v ? "border-indigo bg-[#efeeff]" : "border-hairline bg-white hover:bg-canvas-2")}
                    >
                      <span className="block text-[13px] font-medium text-ink">{t}</span>
                      <span className="block text-[11.5px] text-ink-muted">{d}</span>
                    </button>
                  ))}
                </div>
                <Field label="Company name" htmlFor="co-name" required>
                  <Input id="co-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus />
                </Field>
                <Field label="Industry" htmlFor="co-industry">
                  <Select value={kind} onValueChange={(v) => setKind(v as IndustryKey)}>
                    <SelectTrigger id="co-industry"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INDUSTRIES.map((i) => (
                        <SelectItem key={i.key} value={i.key}>{i.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {mode === "link" ? (
                  <Field label="Client's email" htmlFor="co-email" required hint="They're invited as a manager of this client.">
                    <Input id="co-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
                  </Field>
                ) : null}
              </div>
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
                <Button type="submit" disabled={add.isPending || onboard.isPending || !name.trim() || (mode === "link" && !email.trim())} data-action="create-client">
                  {mode === "link" ? (onboard.isPending ? "Sending…" : "Create and get link") : add.isPending ? "Adding…" : "Continue to setup"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
