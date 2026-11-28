import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, ErrorState } from "@/components/app/primitives";
import { DataTable, TableToolbar, type Column } from "@/components/app/DataTable";
import { adminAgentsQuery, adminNumbersQuery } from "@/lib/app/queries";
import type { AdminNumberRow } from "@/lib/api/console";
import { BizCell, useConsole } from "./-shared";
import { BuyNumber } from "./-buy-number";
import { NumberCaps } from "./-number-caps";
import { NumberList } from "./-number-list";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/admin/phone-numbers")({
  head: () => ({ meta: [{ title: `Phone numbers — ${PRODUCT} admin` }] }),
  component: AdminNumbersPage,
});

function AdminNumbersPage() {
  const { platform, single, canManage, ws } = useConsole();
  const qc = useQueryClient();
  // Buying, or using a number from the agency's own account. (Not on the platform's key: it sees every agency's numbers.)
  const canUseOwn = canManage && !platform && (ws.session?.telnyx === "own" || single);
  const agentsQ = useQuery({ ...adminAgentsQuery(), enabled: !platform });
  const [buyFor, setBuyFor] = useState("");

  return (
    <div className="space-y-5" data-page="admin-phone-numbers">
      <PageHeader
        title="Phone numbers"
        actions={
          single ? null : (
            <Button asChild size="sm" variant="outline" className="h-8 text-[12.5px]">
              <Link to="/admin/number-requests">Number requests</Link>
            </Button>
          )
        }
      />
      {platform ? <PlatformNumbers /> : <NumberList agents={agentsQ.data ?? []} canAssign={canManage} />}
      {canUseOwn ? (
        <Panel title="Get a number">
          <div className="grid gap-2 sm:max-w-sm">
            <Select value={buyFor} onValueChange={setBuyFor}>
              <SelectTrigger className="h-9 text-[13px]" aria-label="Receptionist" data-field="buy-for"><SelectValue placeholder="Which receptionist?" /></SelectTrigger>
              <SelectContent>
                {(agentsQ.data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({a.business.name})</SelectItem>)}
              </SelectContent>
            </Select>
            {buyFor ? <BuyNumber key={buyFor} clientId={buyFor} onBought={async () => { await qc.invalidateQueries({ queryKey: ["admin"] }); }} /> : null}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

/** The platform team's view: every agency's receptionist numbers. */
function PlatformNumbers() {
  const q = useQuery(adminNumbersQuery());
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase().replace(/\s/g, "");
    return (q.data ?? []).filter((n) => !s || [n.e164, n.friendly_name.replace(/\s/g, ""), n.business.name.toLowerCase(), n.business.org_name.toLowerCase()].some((v) => v.toLowerCase().includes(s)));
  }, [q.data, search]);

  const columns: Column<AdminNumberRow>[] = [
    { key: "number", header: "Number", cell: (n) => <span className="whitespace-nowrap font-medium tabular-nums text-ink">{n.friendly_name}</span> },
    { key: "client", header: "Client", cell: (n) => <BizCell biz={n.business} showAgency /> },
    { key: "receptionist", header: "Answers", hideBelow: "md", cell: (n) => <span className="text-ink-muted">{n.agent.name}</span> },
    { key: "caps", header: "Takes", hideBelow: "sm", cell: (n) => <NumberCaps sms={n.capabilities.sms} /> },
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
    <>
      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}
      <Panel padded={false}>
        <TableToolbar>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number or client" className="h-8 pl-8 text-[12.5px]" aria-label="Search numbers" />
          </div>
        </TableToolbar>
        <DataTable columns={columns} rows={rows} rowKey={(n) => `${n.business_id}:${n.id}`} loading={q.isPending} empty={{ title: "No numbers yet", icon: Phone }} />
      </Panel>
    </>
  );
}
