import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/app/leads")({
  validateSearch: (search: Record<string, unknown>): { lead?: string } => ({
    lead: typeof search["lead"] === "string" && search["lead"] ? String(search["lead"]) : undefined,
  }),
  head: () => ({ meta: [{ title: "Follow-ups — Answered" }] }),
  component: LeadsPage,
});

function LeadsPage() {
  return <PagePlaceholder title="Follow-ups" description="Callers waiting for a call back." />;
}
