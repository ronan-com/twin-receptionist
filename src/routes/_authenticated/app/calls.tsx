import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/app/calls")({
  validateSearch: (search: Record<string, unknown>): { call?: string } => ({
    call: typeof search["call"] === "string" && search["call"] ? String(search["call"]) : undefined,
  }),
  head: () => ({ meta: [{ title: "Calls — Answered" }] }),
  component: CallsPage,
});

function CallsPage() {
  return <PagePlaceholder title="Calls" description="Every call and text your receptionist handled." />;
}
