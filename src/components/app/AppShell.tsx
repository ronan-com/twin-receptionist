import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, BellRing, Compass, ExternalLink, GraduationCap, HelpCircle, LifeBuoy, Menu, Moon, PhoneCall, MessageSquareText, Rocket, Sparkles, Sun, TriangleAlert, Volume2, VolumeX } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/app/constants";
import { BrandMark } from "./BrandMark";
import { AgencyMark } from "./AgencyMark";
import { UserMenu } from "./UserMenu";
import { useGetStarted } from "@/components/onboarding/GetStarted";
import { TOUR_NAV_EVENT } from "@/components/onboarding/Tour";
import { useAssistant } from "@/components/assistant/Assistant";
import { OTHER_BRAND } from "@/lib/app/product";
import { SupportDialog, UnreadDot, useSupportUnread } from "./SupportDialog";
import type { AlertItem } from "./alerts";
import { getTheme, isDark, setTheme, subscribeTheme } from "@/lib/app/theme";
import { setSoundOn, soundOn, subscribeSound } from "@/lib/app/sounds";

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
  notifications?: Omit<AlertItem, "id">[];
  children: ReactNode;
}

export function isNavActive(item: NavItem, pathname: string) {
  if (item.matchExact?.includes(pathname)) return true;
  if (item.exact) return pathname === item.to;
  if (pathname === item.to || pathname.startsWith(item.to + "/")) return true;
  return (item.match ?? []).some((m) => pathname === m || pathname.startsWith(m + "/"));
}

type Notification = NonNullable<AppShellProps["notifications"]>[number];

/** Notifications that point into this nav item, for its count dot. */
function itemAlerts(item: NavItem, notifications: Notification[]) {
  const mine = notifications.filter((n) => n.to && n.kind !== "call" && n.kind !== "message" && isNavActive(item, n.to.split("?")[0]));
  if (!mine.length) return null;
  const tone: keyof typeof COUNT_DOT = mine.some((n) => n.tone === "danger") ? "danger" : mine.some((n) => n.tone === "warning") ? "warning" : "info";
  return { count: mine.length, tone };
}

const COUNT_DOT = {
  danger: "bg-[color-mix(in_srgb,var(--coral)_18%,var(--card))] text-[var(--coral)] ring-[color-mix(in_srgb,var(--coral)_35%,var(--card))]",
  warning: "bg-[color-mix(in_srgb,var(--amber)_20%,var(--card))] text-[#9a5b00] ring-[color-mix(in_srgb,var(--amber)_40%,var(--card))] dark:text-[#f5c36b]",
  info: "bg-[color-mix(in_srgb,var(--indigo)_12%,var(--card))] text-[var(--primary-ink)] ring-[color-mix(in_srgb,var(--indigo)_25%,var(--card))]",
} as const;

function NavIcon({ item, active, size = 15 }: { item: { icon: NavItem["icon"]; hue?: NavItem["hue"] }; active?: boolean; size?: number }) {
  const Icon = item.icon;
  return (
    <span data-hue={item.hue ?? "indigo"} className={cn("hue-icon flex shrink-0 items-center justify-center rounded-[7px]", active && "shadow-sm")} style={{ width: size + 12, height: size + 12 }} aria-hidden>
      <Icon style={{ width: size, height: size }} strokeWidth={active ? 2.1 : 1.9} />
    </span>
  );
}

function NavList({ nav, notifications = [], onNavigate }: { nav: NavItem[]; notifications?: Notification[]; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-2">
      {nav.map((item) => {
        const active = isNavActive(item, pathname);
        const alerts = itemAlerts(item, notifications);
        if (item.featured) {
          // The AI Receptionist package: the biggest thing in the nav, with its three agents underneath.
          return (
            <div key={item.to} className="nav-featured my-1 rounded-[12px] p-1.5" data-nav-featured>
              <Link
                to={item.to}
                onClick={onNavigate}
                data-tour={`nav:${item.to}`}
                aria-current={active && pathname === item.to ? "page" : undefined}
                className={cn("flex items-center gap-2.5 rounded-[9px] px-2 py-2 outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]", active && pathname === item.to && "bg-[color-mix(in_srgb,var(--indigo)_14%,transparent)]")}
              >
                <NavIcon item={item} active size={18} />
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-semibold leading-tight text-ink">{item.label}</span>
                  <span className="block truncate text-[11px] leading-tight text-ink-muted">Voice · Messages · Email</span>
                </span>
                {alerts ? <span data-nav-count={alerts.count} data-tone={alerts.tone} className={cn("ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10.5px] font-semibold tabular-nums ring-1 before:content-[attr(data-nav-count)]", COUNT_DOT[alerts.tone])} aria-hidden /> : null}
              </Link>
              <div className="mt-0.5 flex flex-col gap-px pl-3">
                {(item.children ?? []).map((c) => {
                  const on = pathname === c.to || pathname.startsWith(c.to + "/");
                  return (
                    <Link
                      key={c.to}
                      to={c.to}
                      onClick={onNavigate}
                      data-tour={`nav:${c.to}`}
                      aria-current={on ? "page" : undefined}
                      className={cn("flex h-8 items-center gap-2 rounded-[7px] px-2 text-[12.5px] font-medium outline-none transition-colors", on ? "nav-active font-semibold" : "text-ink-muted hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] hover:text-ink")}
                    >
                      <NavIcon item={c} size={12} />
                      <span className="truncate">{c.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        }
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            data-tour={`nav:${item.to}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex h-[38px] items-center gap-2.5 rounded-[8px] px-2 text-[13.5px] font-medium outline-none transition-colors",
              active ? "nav-active font-semibold" : "text-ink-muted hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] hover:text-ink focus-visible:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]",
            )}
          >
            <NavIcon item={item} active={active} size={14} />
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


function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      data-action="toggle-theme"
      className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-muted hover:bg-canvas-2 hover:text-ink"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun className="h-[17px] w-[17px]" strokeWidth={1.8} /> : <Moon className="h-[17px] w-[17px]" strokeWidth={1.8} />}
    </button>
  );
}

const KIND_ICON = { call: PhoneCall, message: MessageSquareText, warning: TriangleAlert, info: BellRing } as const;

/** The bell: what needs attention (low balance, open incidents ...) and new calls and messages, with the sound switch. */
function BellMenu({ notifications }: { notifications: Notification[] }) {
  const sound = useSyncExternalStore(subscribeSound, soundOn, () => true);
  const needsAttention = notifications.filter((n) => n.tone === "warning" || n.tone === "danger").length;
  const [seenAt, setSeenAt] = useState(() => Date.now());
  const fresh = notifications.filter((n) => n.at && n.at > seenAt).length;
  const badge = needsAttention + fresh;
  return (
    <Popover onOpenChange={(o) => o && setSeenAt(Date.now())}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-bell
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-muted hover:bg-canvas-2 hover:text-ink"
          aria-label={`Notifications${badge ? ` (${badge} need attention)` : ""}`}
        >
          <Bell className="h-[17px] w-[17px]" strokeWidth={1.8} />
          {badge > 0 ? <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-[var(--surface)]">{badge > 9 ? "9+" : badge}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] max-w-[calc(100vw-1.5rem)] p-0 shadow-[var(--shadow-2)]">
        <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
          <span className="text-[13px] font-semibold">Notifications</span>
          <button
            type="button"
            data-action="toggle-sound"
            onClick={() => setSoundOn(!sound)}
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2 py-0.5 text-[11.5px] font-medium text-ink-muted hover:bg-canvas-2 hover:text-ink"
            aria-pressed={sound}
            title={sound ? "Sounds on. Click to mute" : "Sounds muted. Click to turn on"}
          >
            {sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />} {sound ? "Sound on" : "Muted"}
          </button>
        </div>
        {notifications.length === 0 ? (
          <div className="px-3 py-8 text-center text-[12.5px] text-ink-muted">
            <BellRing className="mx-auto mb-2 h-5 w-5 opacity-60" />
            You're all caught up.
          </div>
        ) : (
          <ul className="max-h-[22rem] divide-y divide-hairline overflow-y-auto">
            {notifications.map((n, i) => {
              const Icon = KIND_ICON[n.kind ?? (n.tone === "info" || !n.tone ? "info" : "warning")];
              const hue = n.tone === "danger" ? "coral" : n.tone === "warning" ? "amber" : n.kind === "message" ? "cyan" : n.kind === "call" ? "green" : "indigo";
              return (
                <li key={i} className="px-3 py-2.5 text-[12.5px]">
                  <div className="flex items-start gap-2.5">
                    <span data-hue={hue} className="hue-icon mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]" aria-hidden>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink">{n.title}</div>
                      {n.description ? <div className="text-ink-muted">{n.description}</div> : null}
                      <div className="mt-1 flex gap-3">
                        {n.href ? (
                          <a href={n.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--primary-ink)] hover:underline">
                            {n.hrefLabel ?? "Open"} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                        {n.to ? (
                          <Link to={n.to} className="text-[12px] font-medium text-[var(--primary-ink)] hover:underline">
                            Open
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function AppShell({ nav, variant, brandTo, sidebarHeader, topbarRight, banner, notifications = [], children }: AppShellProps) {
  const [open, setOpen] = useState(false);
  // The guided tour opens the phone menu so it can point at the items inside.
  const [tourNav, setTourNav] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const support = useSupportUnread();
  // The agency console has a "Support requests" page (with the client inbox); the help menu links to it.
  const requestsPage = nav.find((n) => n.to === "/admin/support-requests")?.to;
  const tutorialsPage = nav.find((n) => n.to === "/admin/tutorials")?.to;
  const canContact = Boolean(support.data?.canCreate || support.data?.mine.length || (requestsPage && support.data?.inbox.length));
  const getStarted = useGetStarted();
  const assistant = useAssistant();
  useEffect(() => {
    const on = (e: Event) => setTourNav(Boolean((e as CustomEvent<{ open: boolean }>).detail?.open));
    window.addEventListener(TOUR_NAV_EVENT, on);
    return () => window.removeEventListener(TOUR_NAV_EVENT, on);
  }, []);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = nav.find((n) => isNavActive(n, pathname));

  return (
    <div data-app-shell className="min-h-screen bg-[var(--page)] text-ink lg:flex">
      {/* Desktop sidebar */}
      {/* The column runs the full height of the page; its content sticks to the top of the screen. */}
      <aside className="z-30 hidden w-[244px] shrink-0 border-r border-hairline bg-[var(--surface)] lg:block">
        <div className="sticky top-0 h-screen">
          <SidebarBody nav={nav} variant={variant} brandTo={brandTo} sidebarHeader={sidebarHeader} notifications={notifications} />
        </div>
      </aside>

      {/* Mobile sheet */}
      <Sheet open={open || tourNav} onOpenChange={(o) => { if (!tourNav) setOpen(o); }} modal={!tourNav}>
        <SheetContent side="left" className="w-[280px] p-0 [&>button]:top-4" onInteractOutside={(e) => { if (tourNav) e.preventDefault(); }}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody nav={nav} variant={variant} brandTo={brandTo} sidebarHeader={sidebarHeader} notifications={notifications} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-hairline bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] px-3 backdrop-blur sm:px-5">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[5px] text-ink hover:bg-canvas-2 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden min-w-0 items-center gap-2 text-[13px] sm:flex">
            <span className="truncate font-medium text-ink">{current?.label ?? "Home"}</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {topbarRight}
            <ThemeToggle />
            <BellMenu notifications={notifications} />
            <Popover open={helpOpen} onOpenChange={setHelpOpen}>
              <PopoverTrigger asChild>
                <button type="button" data-tour="help" className="relative inline-flex h-9 w-9 items-center justify-center rounded-[5px] text-ink-muted hover:bg-canvas-2 hover:text-ink" aria-label={support.unread ? "Help (new replies)" : "Help"}>
                  <HelpCircle className="h-[17px] w-[17px]" strokeWidth={1.8} />
                  {support.unread ? <UnreadDot className="absolute right-1.5 top-1.5" /> : null}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 text-[12.5px]">
                {getStarted || assistant || canContact || tutorialsPage ? (
                  <div className="mb-3 space-y-1 border-b border-hairline pb-3">
                    {tutorialsPage ? (
                      <Link
                        to={tutorialsPage}
                        data-action="open-tutorials"
                        onClick={() => setHelpOpen(false)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-medium text-ink hover:bg-canvas-2"
                      >
                        <GraduationCap className="h-4 w-4 text-indigo" /> Tutorials
                      </Link>
                    ) : null}
                    {canContact ? (
                      <button
                        type="button"
                        data-action="contact-support"
                        onClick={() => { setHelpOpen(false); setSupportOpen(true); }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-medium text-ink hover:bg-canvas-2"
                      >
                        <LifeBuoy className="h-4 w-4 text-indigo" /> Contact support
                        {support.unread ? <UnreadDot className="ml-auto" /> : null}
                      </button>
                    ) : null}
                    {assistant ? (
                      <button
                        type="button"
                        data-action="ask-ai"
                        onClick={() => { setHelpOpen(false); assistant.open(); }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-medium text-ink hover:bg-canvas-2"
                      >
                        <Sparkles className="h-4 w-4 text-indigo" /> Ask AI
                        <kbd className="ml-auto rounded border border-hairline bg-canvas-2 px-1 font-mono text-[11px] font-normal text-ink-muted">Ctrl /</kbd>
                      </button>
                    ) : null}
                    {getStarted ? (<>
                    <button
                      type="button"
                      data-action="get-started"
                      onClick={() => { setHelpOpen(false); getStarted.openWelcome(); }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-medium text-ink hover:bg-canvas-2"
                    >
                      <Rocket className="h-4 w-4 text-indigo" /> Get started
                    </button>
                    <button
                      type="button"
                      data-action="take-tour-menu"
                      onClick={() => { setHelpOpen(false); getStarted.startTour(); }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-medium text-ink hover:bg-canvas-2"
                    >
                      <Compass className="h-4 w-4 text-indigo" /> Take the tour
                    </button>
                    </>) : null}
                  </div>
                ) : null}
                <div className="font-semibold text-ink">Need a hand?</div>
                <p className="mt-1 text-ink-muted">
                  {OTHER_BRAND ? <>Contact whoever set up your account and they'll help you out.</> : <>Email <a className="text-indigo hover:underline" href="mailto:support@answeredai.co">support@answeredai.co</a> and a human will reply within one business day.</>}
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

        {banner}

        {supportOpen ? <SupportDialog open onOpenChange={setSupportOpen} allRequestsTo={requestsPage} /> : null}

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-5 sm:px-5 sm:py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
