import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

const TABS = ["persona", "conversation", "booking", "transfers", "hours"] as const;
type AgentTab = (typeof TABS)[number];

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/app/receptionist")({
  validateSearch: (search: Record<string, unknown>): { tab?: AgentTab } => {
    const t = String(search["tab"] ?? "");
    return TABS.includes(t as AgentTab) ? { tab: t as AgentTab } : {};
  },
  head: () => ({ meta: [{ title: "Receptionist | Answered" }] }),
  component: ReceptionistPage,
});

function ReceptionistPage() {
  return <PagePlaceholder title="Receptionist" description="Voice, greeting, hours and how your receptionist books." />;
}
