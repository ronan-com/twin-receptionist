import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/system")({
  head: () => ({ meta: [{ title: "System / QA — Answered admin" }] }),
  component: SystemPage,
});

function SystemPage() {
  return <PagePlaceholder title="System / QA" description="Incidents, failed calls and syncs that need a look." />;
}
