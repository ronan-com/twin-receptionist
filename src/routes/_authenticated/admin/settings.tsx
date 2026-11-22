import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/settings")({
  head: () => ({ meta: [{ title: "Admin settings — Answered admin" }] }),
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  return <PagePlaceholder title="Admin settings" description="Your team and console settings." />;
}
