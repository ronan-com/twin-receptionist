import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/integrations")({
  head: () => ({ meta: [{ title: "Integrations — Answered admin" }] }),
  component: AdminIntegrationsPage,
});

function AdminIntegrationsPage() {
  return <PagePlaceholder title="Integrations" description="Calendar, email and CRM connections across businesses." />;
}
