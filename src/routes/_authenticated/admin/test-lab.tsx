import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/test-lab")({
  head: () => ({ meta: [{ title: "Test lab — Answered admin" }] }),
  component: TestLabPage,
});

function TestLabPage() {
  return <PagePlaceholder title="Test lab" description="A sandbox agency with a demo receptionist and test logins." />;
}
