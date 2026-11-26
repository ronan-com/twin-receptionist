import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, HelpCircle, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/app/constants";
import { CLIENT_SUBNAV } from "@/lib/app/constants";
import { BrandMark } from "./BrandMark";
import { AgencyMark } from "./AgencyMark";
import { UserMenu } from "./UserMenu";

export interface AppShellProps {
  nav: NavItem[];
  variant: "client" | "admin";
  brandTo: string;
  /** Rendered under the brand in the sidebar (e.g. workspace switcher). */
  sidebarHeader?: ReactNode;
  /** Rendered in the top bar, right side (e.g. date range). */
  topbarRight?: ReactNode;
  /** Optional banner rendered above page content (demo / staff view). */
  banner?: ReactNode;
  notifications?: { title: string; description?: string; tone?: "info" | "warning" | "danger"; to?: string }[];
  children: ReactNode;
}

export function isNavActive(item: NavItem, pathname: string) {
  if (item.exact) return pathname === item.to;
  if (pathname === item.to || pathname.startsWith(item.to + "/")) return true;
  return (item.match ?? []).some((m) => pathname === m || pathname.startsWith(m + "/"));
}

function SubNav({ pathname }: { pathname: string }) {
  const group = CLIENT_SUBNAV.find((g) => g.items.some((i) => pathname === i.to || pathname.startsWith(i.to + "/")));
  if (!group) return null;
  return (
    <div className="border-b border-hairline bg-white">
      <div className="mx-auto flex w-full max-w-[1400px] gap-1 overflow-x-auto px-3 sm:px-5 lg:px-8">
        {group.items.map((i) => {
          const active = pathname === i.to || pathname.startsWith(i.to + "/");
          return (
            <Link
              key={i.to}
              to={i.to}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 px-2.5 py-2.5 text-[12.5px] font-medium transition-colors",
                active ? "border-indigo text-indigo" : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {i.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

type Notification = NonNullable<AppShellProps["notifications"]>[number];

/** Notifications that point into this nav item, for its count dot. */
function itemAlerts(item: NavItem, notifications: Notification[]) {
  const mine = notifications.filter((n) => n.to && isNavActive(item, n.to.split("?")[0]));
  if (!mine.length) return null;
  const tone: keyof typeof COUNT_DOT = mine.some((n) => n.tone === "danger") ? "danger" : mine.some((n) => n.tone === "warning") ? "warning" : "info";
  return { count: mine.length, tone };
}

const COUNT_DOT = {
  danger: "bg-[#ffe5e3] text-[#a3231b] ring-[#ffcfcb]",
  warning: "bg-[#fff3dc] text-[#7f4a00] ring-[#ffdfa6]",
  info: "bg-[color-mix(in_srgb,var(--indigo)_12%,#fff)] text-[var(--primary-ink)] ring-[color-mix(in_srgb,var(--indigo)_25%,#fff)]",
} as const;

function NavList({ nav, notifications = [], onNavigate }: { nav: NavItem[]; notifications?: Notification[]; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav aria-label="Primary" className="flex flex-col gap-px px-2">
      {nav.map((item) => {
        const active = isNavActive(item, pathname);
        const Icon = item.icon;
        const alerts = itemAlerts(item, notifications);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex h-[34px] items-center gap-2.5 rounded-[6px] px-2.5 text-[13px] font-medium outline-none transition-colors",
              active ? "nav-active font-semibold" : "text-ink-muted hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] hover:text-ink focus-visible:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]",
            )}
          >
            <Icon className={cn("h-[15px] w-[15px] shrink-0", active ? "text-indigo" : "text-ink-muted/80 group-hover:text-ink")} strokeWidth={active ? 2 : 1.8} />
            <span className="truncate">{item.label}</span>
            {alerts ? (
              // The count is drawn by CSS so the link's name stays just its label;
              // the bell in the top bar lists what needs attention.
              <span
                data-nav-count={alerts.count}
                data-tone={alerts.tone}
                className={cn(
                  "ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10.5px] font-semibold tabular-nums ring-1 before:content-[attr(data-nav-count)]",
                  COUNT_DOT[alerts.tone],
                )}
                aria-hidden
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarBody({ nav, variant, brandTo, sidebarHeader, notifications, onNavigate }: Pick<AppShellProps, "nav" | "variant" | "brandTo" | "sidebarHeader" | "notifications"> & { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        {variant === "admin" ? <AgencyMark to={brandTo} /> : <BrandMark to={brandTo} />}
      </div>
      {sidebarHeader ? <div className="px-2 pb-2">{sidebarHeader}</div> : null}
      <div className="flex-1 overflow-y-auto py-1">
        <NavList nav={nav} notifications={notifications} onNavigate={onNavigate} />
      </div>
      <div className="border-t border-hairline p-2">
        <UserMenu />
      </div>
    </div>
  );
}

export function AppShell({ nav, variant, brandTo, sidebarHeader, topbarRight, banner, notifications = [], children }: AppShellProps) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = nav.find((n) => isNavActive(n, pathname));
  const needsAttention = notifications.filter((n) => n.tone === "warning" || n.tone === "danger").length;

  return (
    <div data-app-shell className="min-h-screen bg-canvas-2 text-ink">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] border-r border-hairline bg-white lg:block">
        <SidebarBody nav={nav} variant={variant} brandTo={brandTo} sidebarHeader={sidebarHeader} notifications={notifications} />
      </aside>

      {/* Mobile sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[280px] p-0 [&>button]:top-4">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody nav={nav} variant={variant} brandTo={brandTo} sidebarHeader={sidebarHeader} notifications={notifications} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-screen flex-col lg:pl-[232px]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-hairline bg-white/95 px-3 backdrop-blur sm:px-5">
          <span className="ribbon-gradient pointer-events-none absolute inset-x-0 top-0 h-[2px] opacity-90" aria-hidden />
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[5px] text-ink hover:bg-canvas-2 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="hidden text-ink-muted sm:inline">{variant === "admin" ? "Admin console" : "Workspace"}</span>
            <span className="hidden text-hairline sm:inline">/</span>
            <span className="truncate font-medium text-ink">{current?.label ?? "Overview"}</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {topbarRight}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="relative inline-flex h-9 w-9 items-center justify-center rounded-[5px] text-ink-muted hover:bg-canvas-2 hover:text-ink"
                  aria-label={`Notifications${needsAttention ? ` (${needsAttention} need attention)` : ""}`}
                >
                  <Bell className="h-[17px] w-[17px]" strokeWidth={1.8} />
                  {needsAttention > 0 ? <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-coral ring-2 ring-white" /> : null}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="border-b border-hairline px-3 py-2 text-[13px] font-semibold">Notifications</div>
                {notifications.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[12.5px] text-ink-muted">You're all caught up.</div>
                ) : (
                  <ul className="max-h-80 divide-y divide-hairline overflow-y-auto">
                    {notifications.map((n, i) => (
                      <li key={i} className="px-3 py-2.5 text-[12.5px]">
                        <div className="flex items-start gap-2">
                          <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", n.tone === "danger" ? "bg-coral" : n.tone === "warning" ? "bg-[#f5a623]" : "bg-indigo")} />
                          <div className="min-w-0">
                            <div className="font-medium text-ink">{n.title}</div>
                            {n.description ? <div className="text-ink-muted">{n.description}</div> : null}
                            {n.to ? (
                              <Link to={n.to} className="mt-1 inline-block text-[12px] font-medium text-indigo hover:underline">
                                Open
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-[5px] text-ink-muted hover:bg-canvas-2 hover:text-ink" aria-label="Help">
                  <HelpCircle className="h-[17px] w-[17px]" strokeWidth={1.8} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 text-[12.5px]">
                <div className="font-semibold text-ink">Need a hand?</div>
                <p className="mt-1 text-ink-muted">
                  Email <a className="text-indigo hover:underline" href="mailto:support@answeredai.co">support@answeredai.co</a> and a human will reply within one business day.
                </p>
                <div className="mt-3 space-y-1">
                  <div className="text-ink-muted">Keyboard shortcuts</div>
                  <div className="flex justify-between"><span>Open a call</span><kbd className="rounded border border-hairline bg-canvas-2 px-1 font-mono text-[11px]">Enter</kbd></div>
                  <div className="flex justify-between"><span>Close panel</span><kbd className="rounded border border-hairline bg-canvas-2 px-1 font-mono text-[11px]">Esc</kbd></div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </header>

        {variant === "client" ? <SubNav pathname={pathname} /> : null}

        {banner}

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-5 sm:px-5 sm:py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
