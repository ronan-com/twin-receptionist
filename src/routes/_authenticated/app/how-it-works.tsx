import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { SupportDialog } from "@/components/app/SupportDialog";
import { TutorialList } from "@/components/tutorials/TutorialList";
import { useWorkspace } from "@/lib/app/workspace";
import { PRODUCT } from "@/lib/app/product";
import { CLIENT_TUTORIALS } from "@/lib/tutorials";

// "How it works" for a business owner: five short how-tos for their dashboard.
// Reached from Settings and the ? menu. Content lives in src/lib/tutorials.ts.
export const Route = createFileRoute("/_authenticated/app/how-it-works")({
  head: () => ({ meta: [{ title: `How it works | ${PRODUCT}` }] }),
  component: HowItWorksPage,
});

function HowItWorksPage() {
  const ws = useWorkspace();
  const agency = ws.business?.org_name || "your agency";
  const [support, setSupport] = useState(false);
  const staffView = ws.access.kind === "staff_view" || Boolean(ws.viewing);
  return (
    <div className="mx-auto max-w-3xl space-y-4" data-page="client-how-it-works">
      <Link to="/app/settings" search={{}} data-back className="-ml-1 inline-flex min-h-10 items-center gap-1 rounded-md pr-3 text-[14px] font-medium text-[var(--primary-ink)] hover:underline">
        <ChevronLeft className="h-4 w-4" /> Settings
      </Link>
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">How it works</h1>
        <p className="mt-1 text-[14px] text-ink-muted">Quick help for the things you'll do most. Tap one to see the steps.</p>
      </div>
      <TutorialList
        tutorials={CLIENT_TUTORIALS}
        names={{ product: PRODUCT, agency }}
        search={false}
        size="lg"
        accent="text-[var(--primary-ink)]"
        canAct={() => !staffView}
        onAction={() => setSupport(true)}
      />
      {support ? <SupportDialog open onOpenChange={setSupport} /> : null}
    </div>
  );
}
