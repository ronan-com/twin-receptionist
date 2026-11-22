import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/app/integrations")({
  head: () => ({ meta: [{ title: "Integrations — Answered" }] }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  return <PagePlaceholder title="Integrations" description="Calendars, email and CRMs your receptionist works with." />;
}
