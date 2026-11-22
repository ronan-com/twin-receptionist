import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/agencies")({
  head: () => ({ meta: [{ title: "Agencies — Answered admin" }] }),
  component: AgenciesPage,
});

function AgenciesPage() {
  return <PagePlaceholder title="Agencies" description="Every agency on the platform: invite, pause, view as." />;
}
