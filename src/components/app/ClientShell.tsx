import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CLIENT_BACKLINKS, type NavItem } from "@/lib/app/constants";
import { PRODUCT } from "@/lib/app/product";
import { useWorkspace } from "@/lib/app/workspace";
import { isNavActive } from "./AppShell";
import { UserMenu } from "./UserMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { useWorkspaceBrand } from "./WorkspaceBrand";

// The business owner's frame: four places (Home, Calls, Bookings, Settings), as a bar
// along the bottom on a phone and a plain sidebar on a desk. The brand is the agency's
// (its logo and name), never ours.

export interface ClientShellProps {
  nav: NavItem[];
  banner?: ReactNode;
  children: ReactNode;
}

/** The agency's logo, or its name when it has no logo. */
function Brand() {
  const ws = useWorkspace();
  const logo = useWorkspaceBrand().data?.effective.logo;
  const name = ws.business?.org_name || PRODUCT;
  return (
    <Link to="/app" className="inline-flex min-w-0 items-center gap-2 outline-none" data-client-brand>
      {logo && /^\/brand\/[a-f0-9-]{36}$/.test(logo) ? <img src={logo} alt={name} className="max-h-9 max-w-[140px] object-contain" /> : <span className="truncate text-[16px] font-semibold tracking-[-0.02em] text-ink">{name}</span>}
    </Link>
  );
}

function HelpMenu({ className }: { className?: string }) {
  const ws = useWorkspace();
  const who = ws.business?.org_name || "whoever set up your account";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Help" className={cn("inline-flex items-center gap-2 text-ink-muted hover:text-ink", className)}>
          <HelpCircle className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-[13px]">
        <div className="font-semibold text-ink">Need a hand?</div>
        <p className="mt-1 text-ink-muted">Contact {who} and they'll help you out. You can always change how your receptionist answers in Settings.</p>
      </PopoverContent>
    </Popover>
  );
}

function SideNav({ nav }: { nav: NavItem[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-3">
      {nav.map((item) => {
        const active = isNavActive(item, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-11 items-center gap-3 rounded-[8px] px-3 text-[14.5px] font-medium outline-none transition-colors",
              active ? "bg-[color-mix(in_srgb,var(--indigo)_10%,#fff)] font-semibold text-[var(--primary-ink)]" : "text-ink-muted hover:bg-canvas-2 hover:text-ink",
            )}
          >
            <Icon className="h-[19px] w-[19px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function TabBar({ nav }: { nav: NavItem[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav aria-label="Primary" data-tab-bar className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {nav.map((item) => {
          const active = isNavActive(item, pathname);
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11.5px] font-medium outline-none", active ? "font-semibold text-[var(--primary-ink)]" : "text-ink-muted")}
              >
                <Icon className="h-6 w-6" strokeWidth={active ? 2.2 : 1.8} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function ClientShell({ nav, banner, children }: ClientShellProps) {
  const ws = useWorkspace();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const back = CLIENT_BACKLINKS.find((b) => b.from.some((f) => pathname === f || pathname.startsWith(f + "/")));
  const several = ws.businesses.length > 1;

  return (
    <div data-app-shell data-client-shell className="min-h-screen bg-canvas-2 text-ink">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-hairline bg-white lg:flex">
        <div className="flex h-16 items-center px-5">
          <Brand />
        </div>
        <div className="px-3 pb-3">
          {several ? (
            <WorkspaceSwitcher />
          ) : ws.business ? (
            <div className="truncate px-2 text-[12.5px] font-medium text-ink-muted">{ws.business.name}</div>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          <SideNav nav={nav} />
        </div>
        <div className="flex items-center gap-1 border-t border-hairline p-2">
          <div className="min-w-0 flex-1">
            <UserMenu />
          </div>
          <HelpMenu className="h-9 w-9 justify-center rounded-md hover:bg-canvas-2" />
        </div>
      </aside>

      <div className="flex min-h-screen flex-col lg:pl-[232px]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-hairline bg-white/95 px-4 backdrop-blur lg:hidden">
          <span className="ribbon-gradient pointer-events-none absolute inset-x-0 top-0 h-[2px] opacity-90" aria-hidden />
          <div className="min-w-0 flex-1">
            {several ? <WorkspaceSwitcher /> : <Brand />}
          </div>
          <HelpMenu className="h-10 w-10 justify-center rounded-full hover:bg-canvas-2" />
          <UserMenu compact />
        </header>

        {banner}

        <main className="mx-auto w-full max-w-[920px] flex-1 px-4 pb-28 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pb-10">
          {back ? (
            <Link to={back.to} data-back className="-ml-1 mb-3 inline-flex min-h-10 items-center gap-1 rounded-md pr-3 text-[14px] font-medium text-[var(--primary-ink)] hover:underline">
              <ChevronLeft className="h-4 w-4" /> {back.label}
            </Link>
          ) : null}
          {children}
        </main>
      </div>

      <TabBar nav={nav} />
    </div>
  );
}
