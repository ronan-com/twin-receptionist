import { useMemo, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Compass, PlayCircle, X } from "lucide-react";
import { brandApi, companyApi, getConsoleCalls } from "@/lib/api/console";
import { adminOverviewCountsQuery } from "@/lib/app/queries";
import { resolveRange } from "@/lib/app/date-range";
import { cn } from "@/lib/utils";
import { PRODUCT } from "@/lib/app/product";
import { useGetStarted } from "./GetStarted";
import type { GuideKind } from "./Guides";
import { PHONE_NEEDED, usePhoneKeyNeeded } from "@/components/app/PhoneGate";
import { useWorkspace } from "@/lib/app/workspace";

// The "Get started" card on the agency Overview. Ticks come from the same APIs the
// rest of the console uses, so doing the thing anywhere ticks it here.

type Item = {
  key: string;
  title: string;
  hint: string;
  done: boolean;
  to: string;
  cta: string;
  guide?: GuideKind;
};

export function useGetStartedItems(enabled: boolean) {
  const brand = useQuery({ queryKey: ["console", "brand"], queryFn: brandApi.get, retry: false, enabled });
  const counts = useQuery({ ...adminOverviewCountsQuery(), enabled });
  const companies = useQuery({ queryKey: ["console", "companies"], queryFn: companyApi.list, enabled });
  // Browser test calls are logged as channel "web", so a recent one means a test call was made.
  const calls = useQuery({
    queryKey: ["console", "calls", "get-started-test"],
    queryFn: () => getConsoleCalls(resolveRange("90d")),
    enabled,
    staleTime: 30_000,
  });

  // A single-agency install made without a phone key: connecting it comes first.
  const ws = useWorkspace();
  const phoneNeeded = usePhoneKeyNeeded();
  const phoneItem = Boolean(ws.session?.singleAgency);
  const loading = brand.isPending || counts.isPending || companies.isPending || calls.isPending;
  const items = useMemo<Item[]>(() => {
    const list = companies.data ?? [];
    const withReceptionist = list.find((c) => c.receptionists.length > 0);
    const look = brand.data;
    const c = counts.data;
    const out: Item[] = [
      ...(phoneItem
        ? [
            {
              key: "connect-phone",
              title: "Connect your phone provider",
              hint: phoneNeeded ? `${PHONE_NEEDED}: paste your Telnyx API key in Connections.` : "Your phone account is connected.",
              done: !phoneNeeded,
              to: "/admin/connections",
              cta: "Open Connections",
            },
          ]
        : []),
      {
        key: "brand",
        title: "Set your brand",
        hint: "Add your logo and colour so clients see your name, not ours.",
        done: Boolean(look?.logo || look?.primaryColor),
        to: "/admin/settings",
        cta: "Open branding",
      },
      {
        key: "receptionist",
        title: "Create your first receptionist",
        hint: "Pick a template, set the hours and call handling, choose a voice.",
        done: (c?.agents ?? 0) > 0 || Boolean(withReceptionist),
        to: "/admin/receptionists/new",
        cta: "Create receptionist",
        guide: "receptionist",
      },
      {
        key: "testcall",
        title: "Make a test call",
        hint: "Press Talk to this receptionist on its page and say hello from your browser.",
        done: (calls.data ?? []).some((x) => x.channel === "web"),
        to: withReceptionist ? "/admin/receptionists/$receptionistId" : "/admin/receptionists/new",
        cta: withReceptionist ? "Open receptionist" : "Create one first",
        guide: "testcall",
      },
      {
        key: "invite",
        title: "Invite a client",
        hint: "Send an onboarding link and they set up their own business.",
        done: list.some((x) => x.onboarding_pending || x.pending_invites > 0 || x.customers > 0),
        to: "/admin/clients",
        cta: "Go to Clients",
        guide: "invite",
      },
      {
        key: "phone",
        title: "Connect a phone number",
        hint: "Attach a number so real callers reach the receptionist.",
        done: (c?.numbers ?? 0) > 0,
        to: "/admin/phone-numbers",
        cta: "Phone numbers",
      },
    ];
    return out;
  }, [brand.data, counts.data, companies.data, calls.data, phoneItem, phoneNeeded]);

  const target = (companies.data ?? []).find((c) => c.receptionists.length > 0)?.receptionists[0]?.id;
  return { items, loading, firstCompanyId: target };
}

function ItemLink({ item, companyId, className, children }: { item: Item; companyId?: string; className?: string; children: ReactNode }) {
  if (item.to === "/admin/receptionists/$receptionistId" && companyId)
    return (
      <Link to="/admin/receptionists/$receptionistId" params={{ receptionistId: companyId }} search={{ tab: "voice" }} className={className} data-cta={`gs-${item.key}`}>
        {children}
      </Link>
    );
  if (item.to === "/admin/settings")
    return (
      <Link to="/admin/branding" className={className} data-cta={`gs-${item.key}`}>
        {children}
      </Link>
    );
  const to = item.to === "/admin/receptionists/$receptionistId" ? "/admin/receptionists/new" : (item.to as "/admin/clients");
  return (
    <Link to={to} className={className} data-cta={`gs-${item.key}`}>
      {children}
    </Link>
  );
}

export function GetStartedChecklist() {
  const gs = useGetStarted();
  const { items, loading, firstCompanyId } = useGetStartedItems(Boolean(gs && !gs.dismissed));
  if (!gs || gs.dismissed) return null;

  const done = items.filter((i) => i.done).length;
  const all = !loading && done === items.length;
  const next = items.findIndex((i) => !i.done);

  return (
    <section
      data-tour="checklist"
      data-get-started-card
      aria-labelledby="gs-heading"
      className="overflow-hidden rounded-xl border border-hairline bg-white shadow-sm"
    >
      <div className="relative border-b border-hairline bg-[linear-gradient(135deg,color-mix(in_srgb,var(--indigo)_10%,var(--card)),var(--card)_70%)] px-4 py-3.5 sm:px-5">
        <div className="flex items-start gap-3 pr-8">
          <div className="min-w-0 flex-1">
            <h2 id="gs-heading" className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
              {all ? "You're all set" : `Get started with ${PRODUCT}`}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">
              {all ? "Everything on the list is done. You can close this card." : `${items.length} steps to your first live receptionist. We tick each one as you go.`}
            </p>
          </div>
          <button
            type="button"
            onClick={gs.startTour}
            className="hidden shrink-0 items-center gap-1.5 rounded-md border border-hairline bg-white px-2.5 py-1.5 text-[12px] font-medium text-ink hover:border-indigo sm:inline-flex"
          >
            <Compass className="h-3.5 w-3.5 text-indigo" /> Take the tour
          </button>
        </div>
        <button
          type="button"
          onClick={() => gs.setDismissed(true)}
          aria-label="Dismiss the Get started list"
          title="Dismiss. Reopen it from the help menu."
          className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-canvas-2 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mt-3 flex items-center gap-3">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-hairline"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-valuenow={done}
            aria-label="Get started progress"
          >
            <div className="h-full rounded-full bg-indigo transition-all duration-500" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <span className="text-[12px] font-medium tabular-nums text-ink-muted" data-gs-progress>
            {loading ? "…" : `${done} of ${items.length}`}
          </span>
        </div>
      </div>

      <ul className="divide-y divide-hairline">
        {items.map((item, idx) => (
          <li
            key={item.key}
            data-gs-item={item.key}
            data-done={item.done ? "true" : "false"}
            className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5", idx === next && !loading && "bg-[color-mix(in_srgb,var(--indigo)_5%,var(--card))]")}
          >
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors",
                  item.done ? "border-indigo bg-indigo text-white" : "border-[#c5cedb] bg-white text-ink-muted",
                )}
                aria-hidden
              >
                {item.done ? <Check className="h-3 w-3" strokeWidth={3} /> : idx + 1}
              </span>
              <div className="min-w-0">
                <div className={cn("text-[13.5px] font-medium text-ink", item.done && "text-ink-muted line-through decoration-[#c5cedb]")}>
                  {item.title}
                  <span className="sr-only">{item.done ? " (done)" : " (to do)"}</span>
                </div>
                <div className="text-[12.5px] leading-snug text-ink-muted">{item.hint}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 pl-8 sm:pl-0">
              {item.guide && !item.done ? (
                <button
                  type="button"
                  onClick={() => gs.openGuide(item.guide!)}
                  data-guide-open={item.guide}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-ink-muted hover:bg-canvas-2 hover:text-ink"
                >
                  <PlayCircle className="h-3.5 w-3.5 text-indigo" /> Watch how
                </button>
              ) : null}
              <ItemLink
                item={item}
                companyId={firstCompanyId}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-md px-3 text-[12.5px] font-medium",
                  item.done ? "border border-hairline text-ink-muted hover:bg-canvas-2" : "bg-indigo text-white hover:bg-indigo-deep",
                )}
              >
                {item.done ? "View" : item.cta} {item.done ? null : <ArrowRight className="h-3.5 w-3.5" />}
              </ItemLink>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
