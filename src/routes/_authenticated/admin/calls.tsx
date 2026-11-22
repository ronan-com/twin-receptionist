import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/calls")({
  head: () => ({ meta: [{ title: "Live / Calls — Answered admin" }] }),
  component: AdminCallsPage,
});

function AdminCallsPage() {
  return <PagePlaceholder title="Live / Calls" description="Calls across every receptionist." />;
}
