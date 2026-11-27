import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { ADMIN_SECTIONS, type AdminTab } from "@/lib/app/constants";

// The tabs across the top of a console area (Clients: Overview, Clients, Calls ...).
// Each tab is its own page, so every older link keeps working.

const on = (t: AdminTab, pathname: string) => (t.exact ? pathname === t.to : pathname === t.to || pathname.startsWith(t.to + "/"));

export function SectionTabs({ variant, hasQueue }: { variant: "platform" | "agency"; hasQueue: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = ADMIN_SECTIONS.find((tabs) => tabs.some((t) => on(t, pathname)));
  if (!section) return null;
  const tabs = section.filter((t) => !(t.platformOnly && variant !== "platform") && !(t.agencyOnly && variant === "platform") && !(t.queueOnly && !hasQueue));
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Section" data-section-tabs className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-hairline px-1">
      {tabs.map((t) => {
        const active = on(t, pathname);
        return (
          <Link
            key={t.to}
            to={t.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative -mb-px shrink-0 border-b-2 px-3 py-2.5 text-[13.5px] font-medium outline-none transition-colors",
              active ? "border-[var(--indigo)] text-ink" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
