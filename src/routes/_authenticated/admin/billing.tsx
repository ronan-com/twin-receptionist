import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";
import { PRODUCT } from "@/lib/app/product";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/billing")({
  head: () => ({ meta: [{ title: `Usage & billing — ${PRODUCT} admin` }] }),
  component: BillingPage,
});

function BillingPage() {
  return <PagePlaceholder title="Usage & billing" description="Usage per agency and business." />;
}
