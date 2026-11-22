import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/app/knowledge")({
  validateSearch: (search: Record<string, unknown>): { question?: string } => ({
    question: typeof search["question"] === "string" && search["question"] ? String(search["question"]) : undefined,
  }),
  head: () => ({ meta: [{ title: "Knowledge base — Answered" }] }),
  component: KnowledgePage,
});

function KnowledgePage() {
  return <PagePlaceholder title="Business knowledge" description="What your receptionist knows about your business." />;
}
