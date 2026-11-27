import { Link } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Bot, CheckCircle2, Mail, MessageSquareText, Mic, Plus, type LucideIcon } from "lucide-react";
import { NeedsPhone } from "@/components/app/PhoneGate";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, InitialsAvatar, MetricCard, MetricGrid, PageHeader, Panel } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { adminAgentsQuery } from "@/lib/app/queries";
import { getTexts, type AdminAgentRow } from "@/lib/api/console";
import { getEmail } from "@/lib/api/manage";
import { fmtNumber } from "@/lib/app/format";
import type { Hue } from "@/components/app/hues";
import { useConsole } from "./-shared";

// The three parts of the AI Receptionist package, one page each: every receptionist and whether
// that part is working, with a button straight to where it's set up.

export type Channel = "voice" | "messages" | "email";
const META: Record<Channel, { title: string; blurb: string; icon: LucideIcon; hue: Hue; none: string }> = {
  voice: { title: "AI Voice Agent", blurb: "Answers the phone.", icon: Mic, hue: "indigo", none: "No number" },
  messages: { title: "AI Message Agent", blurb: "Replies to texts and website chat.", icon: MessageSquareText, hue: "cyan", none: "Off" },
  email: { title: "AI Email Agent", blurb: "Reads and answers email.", icon: Mail, hue: "magenta", none: "Not connected" },
};

type Row = { a: AdminAgentRow; on: boolean | null; detail: string };

export function ChannelPage({ channel }: { channel: Channel }) {
  const m = META[channel];
  const { platform, readOnly } = useConsole();
  const q = useQuery(adminAgentsQuery());
  const agents = (q.data ?? []).filter((a) => !a.business?.is_demo).slice(0, 40);
  const extra = useQueries({
    queries: agents.map((a) => ({
      queryKey: [channel === "messages" ? "texts" : "email", a.id],
      queryFn: () => (channel === "messages" ? getTexts(a.id) : getEmail(a.id)),
      enabled: channel !== "voice" && !a.demo_assistant,
      retry: false,
      staleTime: 30_000,
    })),
  });
  const rows: Row[] = agents.map((a, i) => {
    if (channel === "voice") return { a, on: a.routing_status === "routed", detail: a.routing_status === "routed" ? (a.number_source ?? "Number on") : "No number yet" };
    const d = extra[i]?.data as { on?: boolean; status?: string; connected?: boolean; address?: string } | undefined;
    if (!d) return { a, on: extra[i]?.isError ? false : null, detail: extra[i]?.isError ? m.none : "Checking…" };
    if (channel === "messages") return { a, on: Boolean(d.on), detail: d.on ? "Texts on" : d.status === "waiting" ? "Waiting for approval" : "Texts off" };
    return { a, on: Boolean(d.connected), detail: d.connected ? d.address ?? "Connected" : m.none };
  });
  const on = rows.filter((r) => r.on).length;
  const Icon = m.icon;

  return (
    <div className="space-y-5" data-page={`channel-${channel}`}>
      <PageHeader
        title={<span className="flex items-center gap-2.5"><span data-hue={m.hue} className="hue-icon flex h-10 w-10 items-center justify-center rounded-[11px]"><Icon className="h-5 w-5" /></span>{m.title}</span>}
        description={m.blurb}
        actions={!readOnly ? (
          <NeedsPhone className="h-8 text-[12.5px]" label={<><Plus className="mr-1.5 h-3.5 w-3.5" /> New receptionist</>}>
            <Button asChild size="sm" className="h-8 text-[12.5px]"><Link to="/admin/receptionists/new"><Plus className="mr-1.5 h-3.5 w-3.5" /> New receptionist</Link></Button>
          </NeedsPhone>
        ) : null}
      />
      <MetricGrid cols={3}>
        <MetricCard label="Receptionists" value={fmtNumber(rows.length)} icon={Bot} hue="violet" loading={q.isPending} />
        <MetricCard label="Working" value={fmtNumber(on)} icon={CheckCircle2} hue="green" loading={q.isPending} />
        <MetricCard label="To set up" value={fmtNumber(rows.length - on)} icon={Icon} hue="amber" loading={q.isPending} />
      </MetricGrid>
      {q.error ? <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /> : null}
      <Panel padded={false}>
        {q.isPending ? <div className="space-y-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : rows.length === 0 ? (
          <EmptyState icon={Bot} title="No receptionists yet" description="Make one and all three parts are in it." action={<Button asChild size="sm"><Link to="/admin/receptionists/new">New receptionist</Link></Button>} />
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.map(({ a, on: isOn, detail }) => (
              <li key={a.id} className="row-hover flex items-center gap-3 px-4 py-3">
                <InitialsAvatar name={a.name} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-ink">{a.name}</div>
                  <div className="truncate text-[12px] text-ink-muted">{platform ? `${a.business.name} · ${a.business.org_name}` : a.business.name}</div>
                </div>
                <StatusBadge tone={isOn ? "success" : "muted"} dot>{detail}</StatusBadge>
                <Button asChild size="sm" variant={isOn ? "ghost" : "outline"} className="h-8 text-[12.5px]">
                  <Link to="/admin/receptionists/$receptionistId" params={{ receptionistId: a.id }} search={{ tab: channel }}>{isOn ? "Open" : "Set up"}</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
