import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/receptionists")({
  head: () => ({ meta: [{ title: "AI receptionists — Answered admin" }] }),
  component: ReceptionistsPage,
});

function ReceptionistsPage() {
  return <PagePlaceholder title="AI receptionists" description="Every receptionist and its setup." />;
}
