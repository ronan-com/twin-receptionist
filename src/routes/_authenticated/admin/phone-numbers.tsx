import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/phone-numbers")({
  head: () => ({ meta: [{ title: "Phone numbers — Answered admin" }] }),
  component: AdminNumbersPage,
});

function AdminNumbersPage() {
  return <PagePlaceholder title="Phone numbers" description="Numbers connected to receptionists." />;
}
