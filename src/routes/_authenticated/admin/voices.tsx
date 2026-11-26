import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AudioLines, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Panel, MetricCard, MetricGrid, ErrorState } from "@/components/app/primitives";
import { DataTable, TableToolbar, type Column } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { fmtNumber, titleCase } from "@/lib/app/format";
import { adminVoicesQuery } from "@/lib/app/queries";
import type { AdminVoiceRow } from "@/lib/api/console";
import { useConsole } from "./-shared";
import { named } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/admin/voices")({
  head: () => ({ meta: [{ title: named("Voices — Answered admin") }] }),
  component: AdminVoicesPage,
});

function AdminVoicesPage() {
  const { platform } = useConsole();
  const q = useQuery(adminVoicesQuery());
  const [search, setSearch] = useState("");
  const [inUseOnly, setInUseOnly] = useState(false);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((v) => {
      if (inUseOnly && v.agents.length === 0) return false;
      if (!s) return true;
      return [v.display_name, v.description, v.gender].some((x) => x?.toLowerCase().includes(s));
    });
  }, [q.data, search, inUseOnly]);

  const all = q.data ?? [];
  const columns: Column<AdminVoiceRow>[] = [
    {
      key: "name",
      header: "Voice",
      cell: (v) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate font-medium text-ink">
            {v.display_name.split(" - ")[0]} {v.recommended ? <StatusBadge tone="indigo">Recommended</StatusBadge> : null}
          </div>
          <div className="truncate text-[11.5px] text-ink-muted">{v.display_name.split(" - ")[1] ?? v.description}</div>
        </div>
      ),
    },
    { key: "gender", header: "Gender", hideBelow: "sm", cell: (v) => <span className="text-ink-muted">{titleCase(v.gender) || "—"}</span> },
    { key: "accent", header: "Accent", hideBelow: "md", cell: (v) => <span className="text-ink-muted">{v.accent} · {v.language}</span> },
    { key: "provider", header: "Provider", hideBelow: "lg", cell: () => <span className="text-ink-muted">Telnyx</span> },
    {
      key: "used",
      header: "Used by",
      cell: (v) =>
        v.agents.length ? (
          <span className="block max-w-[280px] truncate text-ink" title={v.agents.map((a) => a.business.name).join(", ")}>
            {v.agents.length} · {v.agents.slice(0, 2).map((a) => (platform ? `${a.business.name} (${a.business.org_name})` : a.business.name)).join(", ")}
            {v.agents.length > 2 ? "…" : ""}
          </span>
        ) : (
          <span className="text-ink-muted">Not used</span>
        ),
    },
  ];

  return (
    <div className="space-y-5" data-page="admin-voices">
      <PageHeader eyebrow={platform ? "Platform console" : "Agency console"} title="Voices" description="Voices come from the phone provider's Australian catalogue. Every voice here can be picked for any receptionist." />

      <MetricGrid cols={3}>
        <MetricCard label="Voices" value={fmtNumber(all.length)} icon={AudioLines} loading={q.isPending} />
        <MetricCard label="Recommended" value={fmtNumber(all.filter((v) => v.recommended).length)} loading={q.isPending} />
        <MetricCard label="In use" value={fmtNumber(all.filter((v) => v.agents.length > 0).length)} loading={q.isPending} />
      </MetricGrid>

      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}

      <Panel padded={false}>
        <TableToolbar>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search voices" className="h-8 pl-8 text-[12.5px]" aria-label="Search voices" />
          </div>
          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-muted">
            <Switch checked={inUseOnly} onCheckedChange={setInUseOnly} aria-label="Only voices in use" /> In use
          </label>
        </TableToolbar>
        <DataTable columns={columns} rows={rows} rowKey={(v) => v.id} loading={q.isPending} empty={{ title: "No voices", icon: AudioLines }} />
      </Panel>
      <p className="text-[11.5px] text-ink-muted">Previews aren't available here: make a test call from a receptionist to hear its voice.</p>
    </div>
  );
}
