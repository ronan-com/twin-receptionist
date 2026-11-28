import { createFileRoute } from "@tanstack/react-router";
import { IntegrationsPage } from "@/components/app/editor/IntegrationsEditor";
import { PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/app/integrations")({
  head: () => ({ meta: [{ title: `Integrations — ${PRODUCT}` }] }),
  validateSearch: (search: Record<string, unknown>): { error?: string; calendar?: string; connected?: string } => ({
    error: typeof search["error"] === "string" && search["error"] ? String(search["error"]).slice(0, 300) : undefined,
    calendar: search["calendar"] !== undefined ? String(search["calendar"]) : undefined,
    connected: search["connected"] !== undefined ? String(search["connected"]) : undefined,
  }),
  component: () => <IntegrationsPage />,
});
