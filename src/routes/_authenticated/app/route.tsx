import { useMemo } from "react";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/AppShell";
import { WorkspaceSwitcher } from "@/components/app/WorkspaceSwitcher";
import { DateRangeSelect } from "@/components/app/DateRangeSelect";
import { Notice, ErrorState } from "@/components/app/primitives";
import { SetupPrompt } from "@/components/app/SetupPrompt";
import { WorkspaceBrand, WorkspaceLogo } from "@/components/app/WorkspaceBrand";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CLIENT_NAV } from "@/lib/app/constants";
import { integrationsQuery, phoneNumbersQuery, unansweredQuery } from "@/lib/app/queries";
import { useWorkspace } from "@/lib/app/workspace";
import { PRODUCT } from "@/lib/app/product";

// The business workspace. Business users (managers and viewers) live here; the
// platform team gets here only while viewing as a business. Agency staff and the
// platform team otherwise belong in the console.
export const Route = createFileRoute("/_authenticated/app")({
  beforeLoad: ({ context }) => {
    if (context.session.console) throw redirect({ to: "/admin", replace: true });
  },
  head: () => ({
    meta: [{ title: `Workspace — ${PRODUCT}` }, { name: "robots", content: "noindex" }],
  }),
  component: ClientAppLayout,
});

function ShellSkeleton() {
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

function ClientAppLayout() {
  const ws = useWorkspace();
  const unansweredQ = useQuery({ ...unansweredQuery(ws.businessId), staleTime: 60_000 });
  const integrationsQ = useQuery({ ...integrationsQuery(ws.businessId), staleTime: 60_000 });
  const numbersQ = useQuery({ ...phoneNumbersQuery(ws.businessId), staleTime: 60_000 });

  const notifications = useMemo(() => {
    const out: { title: string; description?: string; tone?: "info" | "warning" | "danger"; to?: string }[] = [];
    const open = (unansweredQ.data ?? []).filter((u) => u.status === "open");
    if (open.length > 0)
      out.push({
        title: `${open.length} question${open.length === 1 ? "" : "s"} your receptionist couldn't answer`,
        description: "Add answers so callers get helped next time.",
        tone: "warning",
        to: "/app/knowledge",
      });
    for (const i of integrationsQ.data ?? []) {
      if (i.status === "error") out.push({ title: `${i.display_name ?? i.provider} needs attention`, description: i.last_error ?? "Sync failed", tone: "danger", to: "/app/integrations" });
    }
    for (const n of numbersQ.data ?? []) {
      if (n.health && n.health !== "healthy")
        out.push({ title: `${n.friendly_name ?? n.e164} is ${n.health}`, description: "Calls to this number may not connect.", tone: "danger", to: "/app/phone-numbers" });
    }
    return out;
  }, [unansweredQ.data, integrationsQ.data, numbersQ.data]);

  if (ws.loading) return <ShellSkeleton />;
  if (ws.error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorState message={ws.error} onRetry={() => void ws.refresh()} />
      </div>
    );
  }

  const banner = (() => {
    if (!ws.business) return null;
    if (ws.access.kind === "staff_view") {
      return (
        <div className="border-b border-[#dcdaff] bg-[#f4f3ff] px-4 py-2 text-[12.5px] text-[#4338ca]">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              <span className="font-semibold">Staff view.</span> You're viewing <span className="font-medium">{ws.business.name}</span> as {ws.isPlatformAdmin ? "the platform team" : "their agency"}. This is read only.
            </span>
            <button type="button" onClick={() => void ws.exitView()} className="self-start font-medium underline-offset-2 hover:underline sm:self-auto">
              Exit view
            </button>
          </div>
        </div>
      );
    }
    if (ws.business.is_demo) {
      return (
        <div className="border-b border-[#ffe1b0] bg-[#fff9ee] px-4 py-2 text-[12.5px] text-[#8a4b00]">
          <div className="mx-auto max-w-[1400px]">
            <span className="font-semibold">Test lab.</span> {ws.business.name} is a demo receptionist with sample calls. Nothing here reaches a real phone.
          </div>
        </div>
      );
    }
    if (ws.access.kind === "member" && !ws.access.canEdit) {
      return (
        <div className="border-b border-hairline bg-canvas-2 px-4 py-2 text-[12.5px] text-ink-muted">
          <div className="mx-auto max-w-[1400px]">View-only access. Ask a manager of {ws.business.name} for more access.</div>
        </div>
      );
    }
    return null;
  })();

  return (
    <AppShell
      nav={CLIENT_NAV}
      variant="client"
      brandTo="/app"
      sidebarHeader={
        <>
          <WorkspaceLogo />
          <WorkspaceSwitcher />
        </>
      }
      topbarRight={<DateRangeSelect value={ws.rangePreset} onChange={ws.setRangePreset} />}
      banner={banner}
      notifications={notifications}
    >
      {ws.business ? (
        <>
          <WorkspaceBrand />
          <SetupPrompt />
          <Outlet />
        </>
      ) : (
        <div className="mx-auto max-w-lg py-16">
          <Notice tone="neutral" title="No business yet" action={<Button size="sm" variant="outline" onClick={() => void ws.signOut()}>Sign out</Button>}>
            No business has been shared with you yet. Ask the business's manager, or your agency, to invite you.
          </Notice>
        </div>
      )}
    </AppShell>
  );
}
