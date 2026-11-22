import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Briefcase, Building2, Hash, PhoneIncoming, Plus, Sparkles } from "lucide-react";
import { PageHeader, MetricCard, MetricGrid, Panel, EmptyState, ErrorState } from "@/components/app/primitives";
import { CreateBusinessDialog } from "@/components/app/WorkspaceSwitcher";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/base";
import { fmtNumber, fmtPhone } from "@/lib/app/format";
import { adminOverviewCountsQuery } from "@/lib/app/queries";
import { useWorkspace } from "@/lib/app/workspace";
import type { Agency } from "@/lib/shared";

// Foundation version of the console overview: real counts from the existing
// endpoints, the agency's receptionists and (for the platform) every agency.
// The console area replaces it with Answered's full overview.
export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Admin overview — Answered" }] }),
  component: AdminOverview,
});

function AdminOverview() {
  const ws = useWorkspace();
  const platform = ws.isPlatformAdmin && !(ws.viewing && !ws.viewing.client);
  const countsQ = useQuery(adminOverviewCountsQuery());
  const agenciesQ = useQuery({
    queryKey: ["admin", "agencies"],
    enabled: platform,
    queryFn: () => api.get<{ agencies: Agency[] }>("/api/admin/agencies").then((r) => r.agencies),
  });
  const [creating, setCreating] = useState(false);
  const c = countsQ.data;
  const canCreate = !ws.viewing;

  return (
    <div className="space-y-5" data-page="admin-overview">
      <PageHeader
        title={platform ? "Platform overview" : `${ws.org?.name ?? "Agency"} overview`}
        description={platform ? "Every agency and business on the platform." : "Your clients' receptionists at a glance."}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> New receptionist
            </Button>
          ) : null
        }
      />

      {countsQ.error ? <ErrorState message={(countsQ.error as Error).message} onRetry={() => void countsQ.refetch()} /> : null}

      <MetricGrid cols={4}>
        <MetricCard label="Businesses" value={fmtNumber(c?.businesses ?? 0)} icon={Building2} loading={countsQ.isPending} />
        <MetricCard label="AI receptionists" value={fmtNumber(c?.agents ?? 0)} icon={Bot} loading={countsQ.isPending} />
        <MetricCard label="With a phone number" value={fmtNumber(c?.numbers ?? 0)} icon={Hash} loading={countsQ.isPending} />
        {platform ? (
          <MetricCard label="Agencies" value={fmtNumber(c?.agencies ?? 0)} icon={Briefcase} loading={countsQ.isPending} hint={`${fmtNumber(c?.pendingNumberRequests ?? 0)} number requests waiting`} />
        ) : (
          <MetricCard label="Active" value={fmtNumber(c?.activeBusinesses ?? 0)} icon={PhoneIncoming} loading={countsQ.isPending} />
        )}
      </MetricGrid>

      {ws.businesses.length === 0 && !platform ? (
        <Panel>
          <EmptyState
            icon={Sparkles}
            title="Create your first receptionist"
            description="Add a business you look after and we'll set up its AI receptionist. You can share it with the business owner afterwards."
            action={
              canCreate ? (
                <Button onClick={() => setCreating(true)} data-cta="first-receptionist">
                  <Plus className="mr-1.5 h-4 w-4" /> Create your first receptionist
                </Button>
              ) : null
            }
          />
        </Panel>
      ) : (
        <Panel title={platform ? "Platform team's receptionists" : "Receptionists"} description={`${ws.businesses.length} in ${ws.org?.name ?? "this team"}`} padded={false}>
          {ws.businesses.length === 0 ? (
            <EmptyState compact title="No receptionists yet" />
          ) : (
            <ul className="divide-y divide-hairline" data-list="receptionists">
              {ws.businesses.map((b) => (
                <li key={b.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium text-ink">{b.name}</div>
                    <div className="truncate text-[12px] text-ink-muted">
                      {[b.industry, b.city, b.receptionist_name ? `Receptionist: ${b.receptionist_name}` : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[12px] text-ink-muted">
                    {b.phone ? <span className="tabular-nums">{fmtPhone(b.phone)}</span> : <span>No number yet</span>}
                    {b.is_demo ? <StatusBadge tone="warning">Demo</StatusBadge> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {platform ? (
        <Panel title="Agencies" description="Agencies sign up by themselves or are invited by you." padded={false}>
          {agenciesQ.isPending ? (
            <div className="p-4 text-[12.5px] text-ink-muted">Loading…</div>
          ) : (agenciesQ.data ?? []).length === 0 ? (
            <EmptyState compact title="No agencies yet" />
          ) : (
            <ul className="divide-y divide-hairline" data-list="agencies">
              {(agenciesQ.data ?? []).map((a) => (
                <li key={a.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium text-ink">{a.name}</div>
                    <div className="truncate text-[12px] text-ink-muted">{a.owners.join(", ") || a.pendingInvites.join(", ") || "No owner yet"}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 text-[12px] text-ink-muted">
                    <span>{fmtNumber(a.clients)} businesses</span>
                    <span>{fmtNumber(a.customers)} business logins</span>
                    {a.suspended ? <StatusBadge tone="danger">Paused</StatusBadge> : null}
                    {a.sandbox ? <StatusBadge tone="warning">Test lab</StatusBadge> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      <CreateBusinessDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
