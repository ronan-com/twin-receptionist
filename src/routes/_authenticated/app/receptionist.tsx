import { createFileRoute } from "@tanstack/react-router";
import { AGENT_TABS, ReceptionistPage, type AgentTab } from "@/components/app/editor/ReceptionistScript";
import { PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/app/receptionist")({
  head: () => ({ meta: [{ title: `Receptionist | ${PRODUCT}` }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: AgentTab } => {
    const t = String(search["tab"] ?? "");
    return AGENT_TABS.includes(t as AgentTab) ? { tab: t as AgentTab } : {};
  },
  component: () => <ReceptionistPage />,
});
