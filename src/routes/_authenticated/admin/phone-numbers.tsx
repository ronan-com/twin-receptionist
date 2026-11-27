import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, MetricCard, MetricGrid, ErrorState } from "@/components/app/primitives";
import { DataTable, TableToolbar, type Column } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { fmtNumber } from "@/lib/app/format";
import { adminAgentsQuery, adminNumbersQuery, adminBusinessesQuery } from "@/lib/app/queries";
import type { AdminNumberRow } from "@/lib/api/console";
import { BizCell, useConsole } from "./-shared";
import { OwnedNumbers } from "./-own-numbers";
import { BuyNumber } from "./-buy-number";
import { NumberCaps } from "./-number-caps";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/admin/phone-numbers")({
  head: () => ({ meta: [{ title: `Phone numbers — ${PRODUCT} admin` }] }),
  component: AdminNumbersPage,
});

function AdminNumbersPage() {
  const { platform, single, canManage, ws } = useConsole();
  const qc = useQueryClient();
  // Numbers already on the agency's own Telnyx account can be connected here. (Not on the platform's key: it sees every agency's numbers.)
  const canUseOwn = canManage && !platform && (ws.session?.telnyx === "own" || single);
  const agentsQ = useQuery({ ...adminAgentsQuery(), enabled: canUseOwn });
  const q = useQuery(adminNumbersQuery());
  const bizQ = useQuery(adminBusinessesQuery());
  const [search, setSearch] = useState("");
  const [buyFor, setBuyFor] = useState("");

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase().replace(/\s/g, "");
    return (q.data ?? []).filter((n) => !s || [n.e164, n.friendly_name.replace(/\s/g, ""), n.business.name.toLowerCase(), n.business.org_name.toLowerCase()].some((v) => v.toLowerCase().includes(s)));
  }, [q.data, search]);

  const without = (bizQ.data ?? []).filter((b) => b.numbers.length === 0);
  const requested = without.filter((b) => b.pending_number_requests > 0).length;

  const columns: Column<AdminNumberRow>[] = [
    { key: "number", header: "Number", cell: (n) => <span className="whitespace-nowrap font-medium tabular-nums text-ink">{n.friendly_name}</span> },
    { key: "client", header: "Client", cell: (n) => <BizCell biz={n.business} showAgency={platform} /> },
    { key: "receptionist", header: "Answers", hideBelow: "md", cell: (n) => <span className="text-ink-muted">{n.agent.name}</span> },
    { key: "caps", header: "Takes", hideBelow: "sm", cell: (n) => <NumberCaps sms={n.capabilities.sms} /> },
    { key: "health", header: "Status", cell: () => <StatusBadge tone="success" dot>Connected</StatusBadge> },
    {
      key: "open",
      header: "",
      align: "right",
      cell: (n) => (
        <Link to="/admin/clients/$businessId" params={{ businessId: n.business_id }} className="whitespace-nowrap text-[12px] text-indigo hover:underline">
          Open client
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-5" data-page="admin-phone-numbers">
      <PageHeader
        eyebrow={platform ? "Platform console" : "Agency console"}
        title="Phone numbers"
        description="Each number rings a receptionist."
        actions={
          single ? null : (
            <Button asChild size="sm" variant="outline" className="h-8 text-[12.5px]">
              <Link to="/admin/number-requests">Number requests</Link>
            </Button>
          )
        }
      />

      <MetricGrid cols={3}>
        <MetricCard label="Numbers" value={fmtNumber((q.data ?? []).length)} icon={Phone} loading={q.isPending} />
        <MetricCard label="Clients without a number" value={fmtNumber(without.length)} loading={bizQ.isPending} />
        <MetricCard label="Requested, waiting" value={fmtNumber(requested)} loading={bizQ.isPending} />
      </MetricGrid>

      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}

      <Panel padded={false}>
        <TableToolbar>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number or client" className="h-8 pl-8 text-[12.5px]" aria-label="Search numbers" />
          </div>
        </TableToolbar>
        <DataTable columns={columns} rows={rows} rowKey={(n) => `${n.business_id}:${n.id}`} loading={q.isPending} empty={{ title: "No numbers yet", description: "Open a client and request a number.", icon: Phone }} />
      </Panel>
      {canUseOwn ? (
        <Panel title="Get a number" description="Pick who it's for, then buy one or use one you have.">
          <div className="grid gap-2 sm:max-w-sm">
            <Select value={buyFor} onValueChange={setBuyFor}>
              <SelectTrigger className="h-9 text-[13px]" aria-label="Receptionist" data-field="buy-for"><SelectValue placeholder="Which receptionist?" /></SelectTrigger>
              <SelectContent>
                {(agentsQ.data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({a.business.name})</SelectItem>)}
              </SelectContent>
            </Select>
            {buyFor ? <BuyNumber key={buyFor} clientId={buyFor} onBought={async () => { await Promise.all([q.refetch(), bizQ.refetch(), qc.invalidateQueries({ queryKey: ["admin"] })]); }} /> : null}
          </div>
        </Panel>
      ) : null}
      {canUseOwn ? (
        <Panel title="Numbers already on your Telnyx account" description="Numbers you own in Telnyx that no receptionist answers yet. Connect one to a receptionist to start taking calls on it.">
          <OwnedNumbers
            receptionists={(agentsQ.data ?? []).map((a) => ({ id: a.id, name: `${a.name} (${a.business.name})` }))}
            onChanged={async () => {
              await Promise.all([q.refetch(), bizQ.refetch(), qc.invalidateQueries({ queryKey: ["admin"] })]);
            }}
          />
        </Panel>
      ) : null}
      <p className="text-[11.5px] text-ink-muted">Calls to a number always go to the receptionist. Forwarding and voicemail routing aren't available.</p>
    </div>
  );
}
