import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/number-requests")({
  head: () => ({ meta: [{ title: "Number requests — Answered admin" }] }),
  component: NumberRequestsPage,
});

function NumberRequestsPage() {
  return <PagePlaceholder title="Number requests" description="Phone numbers agencies have asked for." />;
}
