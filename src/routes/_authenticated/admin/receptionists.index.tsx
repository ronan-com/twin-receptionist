import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Mail, MessageSquareText, Mic, Plus, Search } from "lucide-react";
import { NeedsPhone } from "@/components/app/PhoneGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Panel, MetricCard, MetricGrid, ErrorState } from "@/components/app/primitives";
import { DataTable, TableToolbar, type Column } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { fmtNumber, fmtRelative, humanize } from "@/lib/app/format";
import { adminAgentsQuery } from "@/lib/app/queries";
import type { AdminAgentRow } from "@/lib/api/console";
import { BizCell, useConsole } from "./-shared";
import { PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/admin/receptionists/")({
  head: () => ({ meta: [{ title: `AI Receptionist — ${PRODUCT} admin` }] }),
  component: AdminAgentsPage,
});

function AdminAgentsPage() {
  const { platform, readOnly } = useConsole();
  const q = useQuery(adminAgentsQuery());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [includeDemo, setIncludeDemo] = useState(true);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((a) => {
      if (!includeDemo && a.business?.is_demo) return false;
      if (status !== "all" && a.status !== status) return false;
      if (!s) return true;
      return [a.name, a.business?.name, a.business?.org_name, a.voice?.display_name].some((v) => v?.toLowerCase().includes(s));
    });
  }, [q.data, search, status, includeDemo]);

  const stats = useMemo(() => {
    const live = (q.data ?? []).filter((a) => !a.business?.is_demo);
    return {
      total: live.length,
      active: live.filter((a) => a.status === "active").length,
      booking: live.filter((a) => a.booking?.enabled).length,
      unrouted: live.filter((a) => a.routing_status !== "routed").length,
    };
  }, [q.data]);

  const columns: Column<AdminAgentRow>[] = [
    {
      key: "agent",
      header: "Receptionist",
      cell: (a) => <BizCell biz={{ name: a.name, is_demo: a.business.is_demo, org_name: a.business.org_name }} sub={platform ? `${a.business.name} · ${a.business.org_name}` : a.business.name} />,
    },
    { key: "status", header: "Status", cell: (a) => <StatusBadge tone={a.status === "active" ? "success" : "muted"} dot>{humanize(a.status)}</StatusBadge> },
    {
      key: "channels",
      header: "Does",
      cell: (a) => (
        <span className="flex gap-1.5">
          {([["voice", Mic, "Voice", "indigo"], ["messages", MessageSquareText, "Messages", "cyan"], ["email", Mail, "Email", "magenta"]] as const).map(([tab, Ic, label, hue]) => (
            <Link key={tab} to="/admin/receptionists/$receptionistId" params={{ receptionistId: a.id }} search={{ tab }} title={label} data-hue={hue} className="hue-icon inline-flex h-7 w-7 items-center justify-center rounded-[8px] hover:opacity-80"><Ic className="h-3.5 w-3.5" /></Link>
          ))}
        </span>
      ),
    },
    {
      key: "open",
      header: "",
      align: "right",
      cell: (a) => (
        <Button asChild size="sm" variant="outline" className="h-8 text-[12.5px]">
          <Link to="/admin/receptionists/$receptionistId" params={{ receptionistId: a.id }} search={{ tab: "voice" }}>Edit</Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5" data-page="admin-receptionists">
      <PageHeader
        title="AI Receptionist"
        description="One setup. Answers calls, texts and email."
        actions={!readOnly ? (
          <NeedsPhone className="h-8 text-[12.5px]" label={<><Plus className="mr-1.5 h-3.5 w-3.5" /> New receptionist</>}>
            <Button asChild size="sm" className="h-8 text-[12.5px]"><Link to="/admin/receptionists/new" data-cta="new-receptionist"><Plus className="mr-1.5 h-3.5 w-3.5" /> New receptionist</Link></Button>
          </NeedsPhone>
        ) : null}
      />

      <MetricGrid cols={4}>
        <MetricCard label="Receptionists" value={fmtNumber(stats.total)} hint="Excluding demo" icon={Bot} loading={q.isPending} />
        <MetricCard label="Active" value={fmtNumber(stats.active)} loading={q.isPending} />
        <MetricCard label="Taking bookings" value={fmtNumber(stats.booking)} loading={q.isPending} />
        <MetricCard label="No number yet" value={fmtNumber(stats.unrouted)} loading={q.isPending} />
      </MetricGrid>

      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}

      <Panel padded={false}>
        <TableToolbar>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search receptionist or client" className="h-8 pl-8 text-[12.5px]" aria-label="Search receptionists" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-[130px] text-[12.5px]" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </SelectContent>
          </Select>
          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-muted">
            <Switch checked={includeDemo} onCheckedChange={setIncludeDemo} aria-label="Include demo workspaces" /> Demo
          </label>
        </TableToolbar>
        <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} loading={q.isPending} empty={{ title: "No receptionists match", icon: Bot }} />
      </Panel>

      
    </div>
  );
}
