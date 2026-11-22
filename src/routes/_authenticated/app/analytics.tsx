import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/app/analytics")({
  head: () => ({ meta: [{ title: "Reports — Answered" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  return <PagePlaceholder title="Reports" description="Call volume, busiest times, outcomes and booking trends." />;
}
