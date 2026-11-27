import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BookOpen, Building2, CalendarCheck, Mail, MessageSquareText, Mic, Plug, SlidersHorizontal } from "lucide-react";
import { ErrorState, PageSkeleton, Panel } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { AutomationsPanel } from "@/components/app/AutomationsPanel";
import { ConnectApps } from "@/components/app/client/ConnectApps";
import { IntegrationsPage } from "@/components/app/editor/IntegrationsEditor";
import { KnowledgePage } from "@/components/app/editor/KnowledgeEditor";
import { ReceptionistPage } from "@/components/app/editor/ReceptionistScript";
import { companyApi, platformApi, getAdminAgents, type CompanyReceptionist } from "@/lib/api/console";
import { nicheIcon } from "@/lib/app/niche-icons";
import { useWorkspace } from "@/lib/app/workspace";
import { cn } from "@/lib/utils";
import { PRODUCT } from "@/lib/app/product";
import { useConsole } from "./-shared";
import { ReceptionistCard } from "./-receptionist-card";

// One receptionist, edited without leaving the agency's console: AI Voice Agent, AI Message Agent,
// AI Email Agent, Booking, Apps and Advanced. (The client's own dashboard is only what the client sees.)
const TABS = ["voice", "messages", "email", "booking", "apps", "advanced"] as const;
type Tab = (typeof TABS)[number];
const TAB_META: Record<Tab, { label: string; icon: typeof Mic }> = {
  voice: { label: "Voice", icon: Mic },
  messages: { label: "Messages", icon: MessageSquareText },
  email: { label: "Email", icon: Mail },
  booking: { label: "Booking", icon: CalendarCheck },
  apps: { label: "Apps", icon: Plug },
  advanced: { label: "Advanced", icon: SlidersHorizontal },
};

export const Route = createFileRoute("/_authenticated/admin/receptionists/$receptionistId")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; script?: string } => ({
    ...(TABS.includes(String(s.tab) as Tab) ? { tab: String(s.tab) as Tab } : {}),
    ...(typeof s.script === "string" ? { script: s.script } : {}),
  }),
  head: () => ({ meta: [{ title: `Receptionist — ${PRODUCT} admin` }] }),
  component: ReceptionistEditor,
});

/** Points the workspace at this receptionist, so the editors below read and save the right one. */
function Scope({ id, children }: { id: string; children: ReactNode }) {
  const ws = useWorkspace();
  useEffect(() => {
    if (ws.businessId !== id) ws.setBusinessId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ws.businessId]);
  if (ws.businessId !== id) return <PageSkeleton metrics={0} rows={4} />;
  return <>{children}</>;
}

function ReceptionistEditor() {
  const { receptionistId } = Route.useParams();
  const { tab = "voice" } = Route.useSearch();
  const { ws, platform, readOnly, canManage } = useConsole();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const agents = useQuery({ queryKey: ["admin", "agents"], queryFn: getAdminAgents });
  const companyId = agents.data?.find((a) => a.id === receptionistId)?.business_id;
  const key = ["console", "company", companyId];
  const q = useQuery({ queryKey: key, queryFn: () => companyApi.get(companyId!), enabled: !!companyId });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["console"] });
    await qc.invalidateQueries({ queryKey: ["admin"] });
  };
  const viewAs = useMutation({
    mutationFn: (r: CompanyReceptionist) => platformApi.viewAs(q.data!.company.org_id, r.id),
    onSuccess: () => window.location.assign("/app"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (agents.isPending || (companyId && q.isPending)) return <PageSkeleton metrics={0} rows={5} />;
  if (agents.error) return <ErrorState message={(agents.error as Error).message} onRetry={() => void agents.refetch()} />;
  if (!companyId) return <ErrorState message="That receptionist wasn't found." />;
  if (q.error || !q.data) return <ErrorState message={(q.error as Error | null)?.message ?? "Couldn't load it."} onRetry={() => void q.refetch()} />;
  const co = q.data.company;
  const r = q.data.receptionists.find((x) => x.id === receptionistId);
  if (!r) return <ErrorState message="That receptionist wasn't found." />;
  const ownOrg = ws.org?.id === co.org_id;
  const Niche = nicheIcon(r.settings.industry);
  const go = (t: Tab) => void navigate({ to: "/admin/receptionists/$receptionistId", params: { receptionistId }, search: { tab: t }, replace: true });

  const card = (section: "voice" | "messages" | "email" | "advanced", extra?: ReactNode) => (
    <ReceptionistCard
      key={`${r.id}-${section}`}
      r={r}
      companyName={co.name}
      ownOrg={ownOrg}
      platform={platform}
      readOnly={readOnly}
      canManage={canManage}
      onViewAs={() => viewAs.mutate(r)}
      viewing={viewAs.isPending}
      onChanged={refresh}
      section={section}
      advancedExtra={extra}
    />
  );
  // The setup pages below belong to the agency's own clients (they save through the workspace).
  const editable = ownOrg;
  const readNote = <p className="text-[12.5px] text-ink-muted">This receptionist belongs to another agency, so it can only be looked at here.</p>;

  return (
    <div className="space-y-5" data-page="receptionist-editor" data-receptionist={r.id}>
      <Link to="/admin/receptionists" className="inline-flex items-center gap-1 text-[12.5px] text-ink-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> AI Receptionist
      </Link>

      <div className="panel flex flex-wrap items-center gap-4 px-4 py-4">
        <span data-hue={Niche.hue} className="hue-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px]"><Niche.icon className="h-7 w-7" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[22px] font-semibold tracking-[-0.02em] text-ink">{r.name}</h1>
            <StatusBadge tone={r.status === "paused" ? "muted" : "success"} dot>{r.status === "paused" ? "Paused" : "Active"}</StatusBadge>
          </div>
          <Link to="/admin/clients/$businessId" params={{ businessId: co.id }} data-link="client" className="mt-1 inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
            <Building2 className="h-3.5 w-3.5" /> For <span className="font-medium text-ink">{co.name}</span>
          </Link>
        </div>
      </div>

      <nav aria-label="Receptionist" data-section-tabs className="-mx-1 flex gap-1 overflow-x-auto border-b border-hairline px-1">
        {TABS.map((t) => {
          const M = TAB_META[t];
          const on = tab === t;
          return (
            <Link key={t} to="/admin/receptionists/$receptionistId" params={{ receptionistId }} search={{ tab: t }} replace aria-current={on ? "page" : undefined} data-tab={t}
              className={cn("relative -mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13.5px] font-medium outline-none transition-colors", on ? "border-[var(--indigo)] text-ink" : "border-transparent text-ink-muted hover:text-ink")}>
              <M.icon className="h-4 w-4" /> {M.label}
            </Link>
          );
        })}
      </nav>

      {tab === "voice" ? (
        <div className="space-y-5">
          {card("voice")}
          {editable ? (
            <Panel title="Script and voice" description="What it says and how it sounds.">
              <Scope id={r.id}><ReceptionistPage embeddedId={r.id} /></Scope>
            </Panel>
          ) : null}
        </div>
      ) : null}
      {tab === "messages" ? card("messages") : null}
      {tab === "email" ? card("email") : null}
      {tab === "booking" ? (editable ? <Scope id={r.id}><IntegrationsPage show="booking" /></Scope> : readNote) : null}
      {tab === "apps" ? (editable ? <Scope id={r.id}><IntegrationsPage show="apps" /></Scope> : readNote) : null}
      {tab === "advanced" ? (
        card("advanced", editable ? (
          <>
            <details className="panel px-4 py-3" open>
              <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-semibold text-ink"><BookOpen className="h-4 w-4" /> What it knows</summary>
              <div className="mt-3"><Scope id={r.id}><KnowledgePage /></Scope></div>
            </details>
            <details className="panel px-4 py-3">
              <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-semibold text-ink"><SlidersHorizontal className="h-4 w-4" /> Call handling</summary>
              <div className="mt-3"><Scope id={r.id}><AutomationsPanel key={r.id} businessId={r.id} canEdit={ws.access.canEdit} /></Scope></div>
            </details>
          </>
        ) : null)
      ) : null}
    </div>
  );
}
