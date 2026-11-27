import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AudioLines, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Panel, MetricCard, MetricGrid, ErrorState } from "@/components/app/primitives";
import { DataTable, TableToolbar, type Column } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { fmtNumber, titleCase } from "@/lib/app/format";
import { adminVoicesQuery } from "@/lib/app/queries";
import { applyVapiVoiceSettingsAll, type AdminVoiceRow } from "@/lib/api/console";
import { useConsole } from "./-shared";
import { PRODUCT } from "@/lib/app/product";
import { VoicePreviewButton } from "@/components/app/VoicePreview";

export const Route = createFileRoute("/_authenticated/admin/voices")({
  head: () => ({ meta: [{ title: `Voices — ${PRODUCT} admin` }] }),
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
      return [v.display_name, v.description, v.gender, v.accent, v.maker].some((x) => x?.toLowerCase().includes(s));
    });
  }, [q.data, search, inUseOnly]);

  const all = q.data ?? [];
  // Vapi receptionists made before the faster voice setup pick it up on their next save, or all at once here.
  const vapiInUse = all.some((v) => v.provider === "vapi" && v.agents.length > 0);
  const apply = useMutation({
    mutationFn: applyVapiVoiceSettingsAll,
    onSuccess: (r) =>
      r.failed.length
        ? toast.warning(`Updated ${r.updated}; ${r.failed.length} couldn't be updated`, { description: r.failed.join("; ") })
        : toast.success(`Updated ${r.updated} Vapi receptionist${r.updated === 1 ? "" : "s"}`, { description: "They now use the faster voice setup." }),
    onError: (e: Error) => toast.error("Couldn't apply the voice settings", { description: e.message }),
  });
  const columns: Column<AdminVoiceRow>[] = [
    {
      key: "play",
      header: "",
      className: "w-10",
      cell: (v) => <VoicePreviewButton id={v.id} url={v.preview_url} name={v.display_name.split(" - ")[0]} />,
    },
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
    { key: "provider", header: "Provider", hideBelow: "lg", cell: (v) => <span className="text-ink-muted">{v.provider === "vapi" ? (v.maker && v.maker !== "Vapi" ? `Vapi (${v.maker})` : "Vapi") : "Telnyx"}</span> },
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
      <PageHeader eyebrow={platform ? "Platform console" : "Agency console"} title="Voices" description="Voices come from your voice engine: Telnyx's Australian catalogue, or Vapi's (ElevenLabs voices, Australian Azure voices and Vapi's own quick voices). Press play to hear one."
        actions={
          vapiInUse && !platform ? (
            <Button variant="outline" size="sm" onClick={() => apply.mutate()} disabled={apply.isPending} data-action="apply-voice-settings-all">
              {apply.isPending ? "Applying…" : "Apply new voice settings to Vapi receptionists"}
            </Button>
          ) : null
        }
      />

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
    </div>
  );
}
