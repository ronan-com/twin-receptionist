import { NEUTRAL_DASHBOARD } from "@/lib/app/product";
import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

// The tabs across Settings. Each one is its own page, so every older link keeps working.

type Tab = { to: string; label: string; tab?: string };
const TABS: Tab[] = [
  { to: "/app/settings", label: "General" },
  { to: "/app/receptionist", label: "Receptionist" },
  { to: "/app/knowledge", label: "Knowledge" },
  { to: "/app/automations", label: "Automations" },
  { to: "/app/integrations", label: "Apps" },
  { to: "/app/team", label: "Team" },
  { to: "/app/settings", label: "Brand", tab: "branding" },
  { to: "/app/how-it-works", label: "Help" },
];
const PATHS = ["/app/settings", "/app/receptionist", "/app/knowledge", "/app/automations", "/app/integrations", "/app/team", "/app/how-it-works", "/app/phone-numbers", "/app/analytics"];

export function SettingsTabs() {
  const { pathname, search } = useRouterState({ select: (s) => ({ pathname: s.location.pathname, search: s.location.search as { tab?: string } }) });
  if (!PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;
  const tabs = TABS.filter((t) => !NEUTRAL_DASHBOARD || t.tab !== "branding");
  const on = (t: Tab) => (t.to === "/app/settings" ? pathname === "/app/settings" && (t.tab ? search.tab === t.tab : !search.tab) : pathname === t.to);
  return (
    <nav aria-label="Settings" data-settings-tabs className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-hairline px-1">
      {tabs.map((t) => (
        <Link
          key={t.label}
          to={t.to}
          search={(t.tab ? { tab: t.tab } : {}) as never}
          aria-current={on(t) ? "page" : undefined}
          className={cn("-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[13.5px] font-medium outline-none transition-colors", on(t) ? "border-[var(--indigo)] text-ink" : "border-transparent text-ink-muted hover:text-ink")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
