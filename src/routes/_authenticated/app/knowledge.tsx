import { createFileRoute } from "@tanstack/react-router";
import { KnowledgePage } from "@/components/app/editor/KnowledgeEditor";
import { PRODUCT } from "@/lib/app/product";

export const Route = createFileRoute("/_authenticated/app/knowledge")({
  validateSearch: (search: Record<string, unknown>): { question?: string } => ({
    question: typeof search["question"] === "string" && search["question"] ? String(search["question"]) : undefined,
  }),
  head: () => ({ meta: [{ title: `Knowledge base — ${PRODUCT}` }] }),
  component: () => <KnowledgePage />,
});
