import { useMemo } from "react";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { DateRangeSelect } from "@/components/app/DateRangeSelect";
import { ErrorState } from "@/components/app/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { adminNavFor, isPlatformOnlyPath } from "@/lib/app/constants";
import { adminOverviewCountsQuery } from "@/lib/app/queries";
import { useWorkspace } from "@/lib/app/workspace";
import { PRODUCT } from "@/lib/app/product";
import { GetStartedProvider } from "@/components/onboarding/GetStarted";
import { AssistantProvider } from "@/components/assistant/Assistant";
import { useSupportUnread } from "@/components/app/SupportDialog";
import { ConnectPhoneBanner } from "@/components/app/PhoneGate";
import { SectionTabs } from "@/components/app/SectionTabs";
import { ProviderWarnings } from "@/components/app/ProviderWarnings";

// The console. Variant "platform" (the platform admin: everything) or "agency"
// (agency staff: their own agency). Business users are sent to their workspace,
// and agency staff can't open the platform-only pages.
export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: ({ context, location }) => {
    const s = context.session;
    if (!s.console && !s.user.platformAdmin) throw redirect({ to: "/app", replace: true });
    // An agency that brings its own phone account connects it before anything else.
    // SINGLE_AGENCY installs made without a key connect it in Connections instead (a banner says so).
    if (s.console === "agency" && s.telnyx === "none" && !s.singleAgency && !s.viewing && !s.user.platformAdmin) throw redirect({ to: "/setup", replace: true });
    if (!s.user.platformAdmin && isPlatformOnlyPath(location.pathname)) throw redirect({ to: "/admin", replace: true });
    // One agency per server (SINGLE_AGENCY): numbers are bought from each client's page, there's no request queue.
    if (s.singleAgency && location.pathname.startsWith("/admin/number-requests")) throw redirect({ to: "/admin", replace: true });
  },
  head: () => ({
    meta: [{ title: `Admin console — ${PRODUCT}` }, { name: "robots", content: "noindex" }],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const ws = useWorkspace();
  // The platform admin viewing as an agency sees that agency's console.
  const viewingAgency = Boolean(ws.viewing && !ws.viewing.client);
  const variant: "platform" | "agency" = ws.isPlatformAdmin && !viewingAgency ? "platform" : "agency";
  const countsQ = useQuery({ ...adminOverviewCountsQuery(), enabled: !ws.loading && !!ws.session, staleTime: 60_000 });
  // New replies and new client requests: a count on "Support requests" (agency console only).
  const support = useSupportUnread(!ws.loading && !!ws.session);
  const supportUnread = variant === "agency" ? support.unread : 0;

  const notifications = useMemo(() => {
    const out: { title: string; description?: string; tone?: "info" | "warning" | "danger"; to?: string }[] = [];
    const c = countsQ.data;
    if (c?.openIncidents) out.push({ title: `${c.openIncidents} open incident${c.openIncidents === 1 ? "" : "s"}`, description: "Review in System / QA.", tone: "danger", to: "/admin/system" });
    if (c?.pendingNumberRequests && !ws.session?.singleAgency)
      out.push({ title: `${c.pendingNumberRequests} number request${c.pendingNumberRequests === 1 ? "" : "s"} waiting`, tone: "warning", to: "/admin/number-requests" });
    if (supportUnread) out.push({ title: `${supportUnread} new in Support requests`, description: "Replies and client requests you haven't read.", tone: "info", to: "/admin/support-requests" });
    return out;
  }, [countsQ.data, ws.session?.singleAgency, supportUnread]);

  if (ws.loading) {
    return (
      <div className="min-h-screen bg-canvas-2">
        <div className="hidden h-screen w-[232px] border-r border-hairline bg-white lg:fixed lg:block" />
        <div className="lg:pl-[232px]">
          <div className="h-14 border-b border-hairline bg-white" />
          <div className="mx-auto max-w-[1400px] space-y-4 p-6">
            <Skeleton className="h-7 w-56" />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[92px]" />
              ))}
            </div>
            <Skeleton className="h-[300px]" />
          </div>
        </div>
      </div>
    );
  }

  if (ws.error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorState message={ws.error} onRetry={() => void ws.refresh()} />
      </div>
    );
  }

  const role = ws.session?.role;
  const navItems = adminNavFor(variant);
  const hasQueue = !(variant === "agency" && (ws.session?.telnyx === "own" || ws.session?.singleAgency));
  // "Get started" is for the agency's own owners and admins: not the platform admin, not a read-only view.
  const getStarted = variant === "agency" && !ws.isPlatformAdmin && !ws.viewing && (role === "owner" || role === "admin") && !!ws.session;

  // "Ask for help" (AI): same audience as Get started, and only where the server has a key (session.assistant).
  const assistant = getStarted && Boolean(ws.session?.assistant);

  return (
    <AssistantProvider enabled={assistant} userId={ws.session?.user.id ?? ""}>
    <GetStartedProvider
      enabled={getStarted}
      userId={ws.session?.user.id ?? ""}
      userName={ws.session?.user.name ?? ""}
      orgName={ws.org?.name ?? ""}
      navPaths={navItems.map((n) => n.to)}
    >
    <AppShell
      nav={navItems}
      variant="admin"
      brandTo="/admin"
      banner={
        <>
        <ProviderWarnings />
        {!ws.viewing ? (
          <ConnectPhoneBanner />
        ) : ws.viewing ? (
          <div className="border-b border-[#dcdaff] bg-[#f4f3ff] px-4 py-2 text-[12.5px] text-[#4338ca]">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {ws.viewing.support ? (
                  <>
                    <span className="font-semibold">Support session.</span> {ws.viewing.by || "Your setup provider"} is helping you, with your permission. {ws.viewing.canEdit ? "They can fix things for you but never see or change your keys, billing or owner account, or export your data." : "Read only."} Every sign-in and change is in your audit log.
                  </>
                ) : (
                  <>
                    <span className="font-semibold">Viewing as {ws.viewing.business || ws.viewing.org}.</span> Read only.
                  </>
                )}
              </span>
              <button type="button" onClick={() => void (ws.viewing?.support && !ws.viewing.client ? ws.signOut() : ws.exitView())} className="self-start font-medium underline-offset-2 hover:underline sm:self-auto">
                {ws.viewing.support && !ws.viewing.client ? "End support session" : "Exit view"}
              </button>
            </div>
          </div>
        ) : null}
        </>
      }
      topbarRight={<DateRangeSelect value={ws.rangePreset} onChange={ws.setRangePreset} />}
      notifications={notifications}
    >
      <SectionTabs variant={variant} hasQueue={hasQueue} />
      <Outlet />
    </AppShell>
    </GetStartedProvider>
    </AssistantProvider>
  );
}
