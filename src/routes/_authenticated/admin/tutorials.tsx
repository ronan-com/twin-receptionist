import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Compass, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/primitives";
import { SupportDialog } from "@/components/app/SupportDialog";
import { useGetStarted } from "@/components/onboarding/GetStarted";
import { TutorialList } from "@/components/tutorials/TutorialList";
import { useWorkspace } from "@/lib/app/workspace";
import { PRODUCT } from "@/lib/app/product";
import { TUTORIAL_GROUPS, tutorialsFor } from "@/lib/tutorials";

// Tutorials for agency owners and staff: short how-tos for every part of the
// console, each with a "Go there" button, an optional video and, where there is one,
// the animated guide. Content lives in src/lib/tutorials.ts.
export const Route = createFileRoute("/_authenticated/admin/tutorials")({
  head: () => ({ meta: [{ title: `Tutorials — ${PRODUCT} admin` }] }),
  component: TutorialsPage,
});

function TutorialsPage() {
  const ws = useWorkspace();
  const getStarted = useGetStarted();
  const [support, setSupport] = useState(false);
  const singleAgency = Boolean(ws.session?.singleAgency);
  const tutorials = useMemo(() => tutorialsFor(ws.session?.telnyx, singleAgency), [ws.session?.telnyx, singleAgency]);
  const readOnly = Boolean(ws.viewing);

  return (
    <div className="space-y-5" data-page="admin-tutorials">
      <PageHeader
        title="Guides"
        description="Short steps for everything."
        actions={
          getStarted ? (
            <Button size="sm" className="h-9" onClick={() => getStarted.startTour()} data-action="tutorials-take-tour">
              <Compass className="mr-1.5 h-4 w-4" /> Take the tour again
            </Button>
          ) : !readOnly ? (
            <Button size="sm" variant="outline" className="h-9" onClick={() => setSupport(true)}>
              <LifeBuoy className="mr-1.5 h-4 w-4" /> Contact support
            </Button>
          ) : null
        }
      />
      <TutorialList
        tutorials={tutorials}
        groups={TUTORIAL_GROUPS}
        names={{ product: PRODUCT, agency: ws.org?.name }}
        canAct={(a) => (a === "tour" ? Boolean(getStarted) : !readOnly)}
        onAction={(a) => (a === "tour" ? getStarted?.startTour() : setSupport(true))}
      />
      {support ? <SupportDialog open onOpenChange={setSupport} allRequestsTo="/admin/support-requests" /> : null}
    </div>
  );
}
