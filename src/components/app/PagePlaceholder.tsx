import type { ReactNode } from "react";
import { Construction } from "lucide-react";
import { PageHeader, Panel, EmptyState } from "./primitives";

// Stands in for a page that another part of the port fills in. Renders inside the
// AppShell of /app or /admin, so navigation and guards can be tested end to end.
export function PagePlaceholder({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="space-y-5" data-placeholder={title}>
      <PageHeader title={title} description={description} />
      {children}
      <Panel>
        <EmptyState icon={Construction} title="Not set up yet" description="Nothing here yet." />
      </Panel>
    </div>
  );
}
