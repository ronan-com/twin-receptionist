import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

const TABS = ["business", "hours", "calls", "notifications", "billing", "activity"] as const;
type SettingsTab = (typeof TABS)[number];

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/app/settings")({
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => {
    const t = String(search["tab"] ?? "");
    return TABS.includes(t as SettingsTab) ? { tab: t as SettingsTab } : {};
  },
  head: () => ({ meta: [{ title: "Settings | Answered" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  return <PagePlaceholder title="Business profile" description="Your business details, hours and notifications." />;
}
