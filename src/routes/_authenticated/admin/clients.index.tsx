import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Download, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Panel, MetricCard, MetricGrid, ErrorState, InitialsAvatar } from "@/components/app/primitives";
import { DataTable, TableToolbar, type Column } from "@/components/app/DataTable";
import { DemoBadge, StatusBadge } from "@/components/app/StatusBadge";
import { fmtDate, fmtNumber, fmtPhone, fmtRelative } from "@/lib/app/format";
import { adminBusinessesQuery } from "@/lib/app/queries";
import { downloadCsv } from "@/lib/app/csv";
import type { AdminBusinessRow } from "@/lib/api/console";
import { useConsole } from "./-shared";

export const Route = createFileRoute("/_authenticated/admin/clients/")({
  head: () => ({ meta: [{ title: "Clients — Answered admin" }] }),
  component: ClientsPage,
});

function ClientsPage() {
  const { platform, readOnly } = useConsole();
  const navigate = useNavigate();
  const q = useQuery(adminBusinessesQuery());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [agency, setAgency] = useState("all");
  const [showDemo, setShowDemo] = useState(true);

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
      return [b.name, b.industry, b.city, b.org_name, b.receptionist_name, ...(b.phone_numbers ?? [])].some((v) => v?.toLowerCase().includes(s));
    });
  }, [q.data, search, status, agency, showDemo]);

  const stats = useMemo(() => {
    const all = (q.data ?? []).filter((b) => !b.is_demo);
    return {
      total: all.length,
      active: all.filter((b) => b.status === "active").length,
      paused: all.filter((b) => b.status === "paused").length,
      shared: all.filter((b) => b.memberships.length > 0).length,
      numbers: all.filter((b) => b.numbers.length > 0).length,
    };
  }, [q.data]);

  const columns: Column<AdminBusinessRow>[] = [
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
            <div className="truncate text-[12px] text-ink-muted">{[b.industry, b.city].filter(Boolean).join(" · ") || "—"}</div>
          </div>
        </div>
      ),
    },
    ...(platform ? [{ key: "agency", header: "Agency", hideBelow: "md" as const, cell: (b: AdminBusinessRow) => <span className="truncate text-ink-muted">{b.org_name}</span> }] : []),
    {
      key: "status",
      header: "Status",
      cell: (b) => (
        <StatusBadge tone={b.status === "active" ? "success" : "warning"} dot>
          {b.status === "active" ? "Active" : b.agency_paused ? "Agency paused" : "Paused"}
        </StatusBadge>
      ),
    },
    { key: "receptionist", header: "Receptionist", hideBelow: "lg", cell: (b) => <span className="truncate">{b.receptionist_name || "Receptionist"}</span> },
    {
      key: "number",
      header: "Number",
      hideBelow: "sm",
      cell: (b) =>
        b.phone_numbers[0] ? (
          <span className="whitespace-nowrap tabular-nums">{fmtPhone(b.phone_numbers[0])}</span>
        ) : b.pending_number_requests ? (
          <StatusBadge tone="info">Requested</StatusBadge>
        ) : (
          <span className="text-ink-muted">None yet</span>
        ),
    },
    { key: "customers", header: "Customers", align: "right", hideBelow: "lg", cell: (b) => <span className="tabular-nums">{b.memberships.length}{b.pending_invites ? ` (+${b.pending_invites})` : ""}</span> },
    { key: "calls", header: "Calls 30d", align: "right", hideBelow: "md", cell: (b) => <span className="tabular-nums">{fmtNumber(b.calls_30d)}</span> },
    { key: "created", header: "Since", hideBelow: "xl", cell: (b) => <span className="whitespace-nowrap text-ink-muted">{fmtDate(b.created_at)}</span> },
  ];

  return (
    <div className="space-y-5" data-page="admin-clients">
      <PageHeader
        eyebrow={platform ? "Platform console" : "Agency console"}
        title="Clients"
        description={platform ? "Every business on the platform, the agency that owns it, its receptionist and health." : "The businesses you look after, their receptionist and health."}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[12.5px]"
              onClick={() =>
                downloadCsv(
                  `answered-clients-${new Date().toISOString().slice(0, 10)}.csv`,
                  rows.map((b) => ({ name: b.name, agency: b.org_name, status: b.status, industry: b.industry ?? "", timezone: b.timezone, number: b.phone_numbers[0] ?? "", customers: b.memberships.length, calls_30d: b.calls_30d, created: b.created_at, demo: b.is_demo })),
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
            {!readOnly ? (
              <Button asChild size="sm" className="h-8 text-[12.5px]">
                <Link to="/admin/clients/new">
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> New receptionist
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <MetricGrid cols={5}>
        <MetricCard label="Clients" value={fmtNumber(stats.total)} hint="Excluding demo" icon={Building2} loading={q.isPending} />
        <MetricCard label="Active" value={fmtNumber(stats.active)} loading={q.isPending} />
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
                {agencies.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-muted">
            <Switch checked={showDemo} onCheckedChange={setShowDemo} aria-label="Show demo workspaces" /> Demo
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
            description: (q.data ?? []).length ? "Try clearing the search or filters." : "Create a receptionist for the first business you look after.",
            icon: Building2,
            action: !readOnly && !(q.data ?? []).length ? (
              <Button asChild size="sm">
                <Link to="/admin/clients/new">New receptionist</Link>
              </Button>
            ) : undefined,
          }}
        />
      </Panel>

      <p className="text-[11.5px] text-ink-muted">Last refreshed {fmtRelative(q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null)}. Open a client to pause it, share it with the business, or request a phone number.</p>
    </div>
  );
}
