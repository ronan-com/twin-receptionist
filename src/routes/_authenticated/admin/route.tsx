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
import { named } from "@/lib/app/product";

// The console. Variant "platform" (the platform admin: everything) or "agency"
// (agency staff: their own agency). Business users are sent to their workspace,
// and agency staff can't open the platform-only pages.
export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: ({ context, location }) => {
    const s = context.session;
    if (!s.console && !s.user.platformAdmin) throw redirect({ to: "/app", replace: true });
    // An agency that brings its own phone account connects it before anything else.
    if (s.console === "agency" && s.telnyx === "none" && !s.viewing && !s.user.platformAdmin) throw redirect({ to: "/setup", replace: true });
    if (!s.user.platformAdmin && isPlatformOnlyPath(location.pathname)) throw redirect({ to: "/admin", replace: true });
    // One agency per server (SINGLE_AGENCY): numbers are bought from each client's page, there's no request queue.
    if (s.singleAgency && location.pathname.startsWith("/admin/number-requests")) throw redirect({ to: "/admin", replace: true });
  },
  head: () => ({
    meta: [{ title: named("Admin console — Answered") }, { name: "robots", content: "noindex" }],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const ws = useWorkspace();
  // The platform admin viewing as an agency sees that agency's console.
  const viewingAgency = Boolean(ws.viewing && !ws.viewing.client);
  const variant: "platform" | "agency" = ws.isPlatformAdmin && !viewingAgency ? "platform" : "agency";
  const countsQ = useQuery({ ...adminOverviewCountsQuery(), enabled: !ws.loading && !!ws.session, staleTime: 60_000 });

  const notifications = useMemo(() => {
    const out: { title: string; description?: string; tone?: "info" | "warning" | "danger"; to?: string }[] = [];
    const c = countsQ.data;
    if (c?.openIncidents) out.push({ title: `${c.openIncidents} open incident${c.openIncidents === 1 ? "" : "s"}`, description: "Review in System / QA.", tone: "danger", to: "/admin/system" });
    if (c?.pendingNumberRequests && !ws.session?.singleAgency)
      out.push({ title: `${c.pendingNumberRequests} number request${c.pendingNumberRequests === 1 ? "" : "s"} waiting`, tone: "warning", to: "/admin/number-requests" });
    return out;
  }, [countsQ.data, ws.session?.singleAgency]);

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
  const label =
    variant === "platform"
      ? { title: "Platform console", sub: "Platform admin" }
      : { title: ws.org?.name ?? "Agency", sub: role === "owner" ? "Agency owner" : role === "admin" ? "Agency admin" : "Agency team" };

  return (
    <AppShell
      nav={adminNavFor(variant).filter((n) => !(variant === "agency" && (ws.session?.telnyx === "own" || ws.session?.singleAgency) && n.to === "/admin/number-requests"))}
      variant="admin"
      brandTo="/admin"
      sidebarHeader={
        <div
          className="mx-2 rounded-[6px] border border-[var(--hue-line)] bg-[linear-gradient(135deg,var(--hue-soft),#fff_80%)] px-2.5 py-1.5 text-[12px] text-ink-muted"
          data-hue={variant === "platform" ? "indigo" : "sky"}
          data-console={variant}
        >
          <span className="font-medium text-ink">{label.title}</span> · {label.sub}
        </div>
      }
      banner={
        ws.viewing ? (
          <div className="border-b border-[#dcdaff] bg-[#f4f3ff] px-4 py-2 text-[12.5px] text-[#4338ca]">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>
                <span className="font-semibold">Viewing as {ws.viewing.business || ws.viewing.org}.</span> Read only.
              </span>
              <button type="button" onClick={() => void ws.exitView()} className="self-start font-medium underline-offset-2 hover:underline sm:self-auto">
                Exit view
              </button>
            </div>
          </div>
        ) : null
      }
      topbarRight={<DateRangeSelect value={ws.rangePreset} onChange={ws.setRangePreset} />}
      notifications={notifications}
    >
      <Outlet />
    </AppShell>
  );
}
