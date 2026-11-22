import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/audit")({
  head: () => ({ meta: [{ title: "Audit log — Answered admin" }] }),
  component: AuditPage,
});

function AuditPage() {
  return <PagePlaceholder title="Audit log" description="Who did what, and when." />;
}
