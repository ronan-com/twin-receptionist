import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";
import { named } from "@/lib/app/product";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/branding")({
  head: () => ({ meta: [{ title: named("Branding — Answered admin") }] }),
  component: BrandingPage,
});

function BrandingPage() {
  return <PagePlaceholder title="Branding" description="Your logo and colours on your clients' screens." />;
}
