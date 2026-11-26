import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";
import { PRODUCT } from "@/lib/app/product";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/integrations")({
  head: () => ({ meta: [{ title: `Integrations — ${PRODUCT} admin` }] }),
  component: AdminIntegrationsPage,
});

function AdminIntegrationsPage() {
  return <PagePlaceholder title="Integrations" description="Calendar, email and CRM connections across businesses." />;
}
