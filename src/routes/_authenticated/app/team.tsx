import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/app/team")({
  head: () => ({ meta: [{ title: "Team — Answered" }] }),
  component: TeamPage,
});

function TeamPage() {
  return <PagePlaceholder title="Team" description="Invite managers and viewers to this business." />;
}
