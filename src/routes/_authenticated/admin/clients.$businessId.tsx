import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the console area replaces it.
export const Route = createFileRoute("/_authenticated/admin/clients/$businessId")({
  head: () => ({ meta: [{ title: "Client — Answered admin" }] }),
  component: ClientDetailPage,
});

function ClientDetailPage() {
  const { businessId } = Route.useParams();
  return <PagePlaceholder title="Client" description={`Business ${businessId}`} />;
}
