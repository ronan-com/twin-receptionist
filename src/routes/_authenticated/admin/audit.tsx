import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, ScrollText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, Panel, ErrorState } from "@/components/app/primitives";
import { DataTable, TableToolbar, type Column } from "@/components/app/DataTable";
import { DemoBadge, StatusBadge } from "@/components/app/StatusBadge";
import { fmtSmartDate, humanize } from "@/lib/app/format";
import { downloadCsv } from "@/lib/app/csv";
import { getAudit, type ConsoleAudit } from "@/lib/api/console";
import { useConsole } from "./-shared";
import { named } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  head: () => ({ meta: [{ title: named("Audit log — Answered admin") }] }),
  component: AdminAuditPage,
});

// Our actions are "<thing>.<verb>": colour by the verb.
function tone(action: string): "success" | "info" | "warning" | "danger" | "muted" {
  if (/\.(create|created|signup|shared|granted|start)/.test(action)) return "success";
  if (/\.(delete|deleted|removed|revoked|unshared|paused|declined)/.test(action)) return "danger";
  if (/\.(resolved|resumed)/.test(action)) return "info";
  return "muted";
}

function AdminAuditPage() {
  const { platform } = useConsole();
  const q = useQuery({ queryKey: ["console", "audit"], queryFn: () => getAudit(null) as Promise<ConsoleAudit[]> });
  const [search, setSearch] = useState("");
  const [entity, setEntity] = useState("all");
  const entities = useMemo(() => [...new Set((q.data ?? []).map((a) => a.entity_type))].sort(), [q.data]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((a) => {
      if (entity !== "all" && a.entity_type !== entity) return false;
      if (!s) return true;
      return [a.summary, a.actor_email, a.business?.name, a.org_name, a.action].some((v) => v?.toLowerCase().includes(s));
    });
  }, [q.data, search, entity]);

  const columns: Column<ConsoleAudit>[] = [
    { key: "when", header: "When", cell: (a) => <span className="whitespace-nowrap text-ink-muted">{fmtSmartDate(a.created_at)}</span> },
    { key: "actor", header: "Who", hideBelow: "sm", cell: (a) => <span className="block max-w-[200px] truncate text-ink">{a.actor_email ?? "System"}</span> },
    { key: "action", header: "Action", cell: (a) => <StatusBadge tone={tone(a.action)}>{humanize(a.action.replace(/\./g, " "))}</StatusBadge> },
    { key: "summary", header: "What happened", hideBelow: "md", cell: (a) => <span className="block max-w-[360px] truncate text-ink">{a.summary ?? "—"}</span> },
    {
      key: "client",
      header: platform ? "Client · agency" : "Client",
      hideBelow: "lg",
      cell: (a) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-ink-muted">{[a.business?.name, platform ? a.org_name : null].filter(Boolean).join(" · ") || "—"}</span>
          {a.business?.is_demo ? <DemoBadge /> : null}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5" data-page="admin-audit">
      <PageHeader
        eyebrow={platform ? "Platform console" : "Agency console"}
        title="Audit log"
        description="Sign-ups, new receptionists, sharing, pausing, number requests, incidents and View as. Entries can't be edited or deleted."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[12.5px]"
            onClick={() => downloadCsv(`answered-audit-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((a) => ({ when: a.created_at, actor: a.actor_email ?? "system", action: a.action, summary: a.summary ?? "", client: a.business?.name ?? "", agency: a.org_name ?? "" })))}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export
          </Button>
        }
      />
      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}
      <Panel padded={false}>
        <TableToolbar>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search summary, person or client" className="h-8 pl-8 text-[12.5px]" aria-label="Search audit log" />
          </div>
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger className="h-8 w-[160px] text-[12.5px]" aria-label="Record type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All record types</SelectItem>
              {entities.map((e) => (
                <SelectItem key={e} value={e}>{humanize(e)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-[12px] tabular-nums text-ink-muted">{rows.length} entries</span>
        </TableToolbar>
        <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} loading={q.isPending} pageSize={40} empty={{ title: "Nothing logged yet", icon: ScrollText }} />
      </Panel>
    </div>
  );
}
