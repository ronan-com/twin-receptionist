import { createFileRoute } from "@tanstack/react-router";
import { AutomationsPanel } from "@/components/app/AutomationsPanel";
import { PageHeader } from "@/components/app/primitives";
import { useWorkspace } from "@/lib/app/workspace";

// The business's automations: transfer to a person, text-back, recording, language,
// call limits and after-hours mode. Managers change them; viewers see them read-only.
export const Route = createFileRoute("/_authenticated/app/automations")({
  head: () => ({ meta: [{ title: "Automations | Answered" }] }),
  component: AutomationsPage,
});

function AutomationsPage() {
  const ws = useWorkspace();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Automations"
        description="What your receptionist does for you on every call: put callers through, text them afterwards, record calls and handle after hours."
      />
      {ws.businessId ? <AutomationsPanel key={ws.businessId} businessId={ws.businessId} canEdit={ws.access.canEdit} /> : null}
    </div>
  );
}
