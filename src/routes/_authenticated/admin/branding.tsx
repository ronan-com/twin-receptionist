import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/primitives";
import { PRODUCT } from "@/lib/app/product";
import { BrandingSection } from "./-branding-section";
import { useOwnsAddress } from "./-web-address";

export const Route = createFileRoute("/_authenticated/admin/branding")({
  head: () => ({ meta: [{ title: `Brand — ${PRODUCT} admin` }] }),
  component: BrandPage,
});

function BrandPage() {
  const owns = useOwnsAddress();
  return (
    <div className="space-y-5" data-page="admin-branding">
      <PageHeader title="Brand & domain" description="Your name, logo, colours and dashboard address." />
      {owns ? (
        <Link to="/admin/settings" search={{ tab: "domain" }} className="inline-block text-[13px] font-medium text-indigo hover:underline" data-link="change-domain">
          Change your web address
        </Link>
      ) : null}
      <BrandingSection />
    </div>
  );
}
