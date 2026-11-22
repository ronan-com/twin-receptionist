import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/clients/")({
  head: () => ({ meta: [{ title: "Clients — Answered admin" }] }),
  component: ClientsPage,
});

function ClientsPage() {
  return <PagePlaceholder title="Clients" description="Every business and its receptionist." />;
}
