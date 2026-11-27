import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/primitives";
import { PRODUCT } from "@/lib/app/product";
import { BrandingSection } from "./-branding-section";

export const Route = createFileRoute("/_authenticated/admin/branding")({
  head: () => ({ meta: [{ title: `Brand — ${PRODUCT} admin` }] }),
  component: BrandPage,
});

function BrandPage() {
  return (
    <div className="space-y-5" data-page="admin-branding">
      <PageHeader title="Brand" description="Your logo and colours." />
      <BrandingSection />
    </div>
  );
}
