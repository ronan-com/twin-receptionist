import { createFileRoute, redirect } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/primitives";
import { NEUTRAL_DASHBOARD, PRODUCT } from "@/lib/app/product";
import { BrandingSection } from "./-branding-section";

export const Route = createFileRoute("/_authenticated/admin/branding")({
  head: () => ({ meta: [{ title: `Brand — ${PRODUCT} admin` }] }),
  beforeLoad: () => { if (NEUTRAL_DASHBOARD) throw redirect({ to: "/admin", replace: true }); },
  component: BrandPage,
});

function BrandPage() {
  return (
    <div className="space-y-5" data-page="admin-branding">
      <PageHeader title="Brand & domain" description="Your name, logo, colours and dashboard address." />
      <BrandingSection />
    </div>
  );
}
