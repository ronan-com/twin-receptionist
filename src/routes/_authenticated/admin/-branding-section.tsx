import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState, Notice, Panel } from "@/components/app/primitives";
import { brandApi } from "@/lib/api/console";
import type { Brand } from "@/lib/shared";
import { BrandEditor } from "./-brand";
import { READ_ONLY_HINT, useConsole } from "./-shared";

// ---- Branding: logo and background for the agency's own screens and its clients' ----

export function BrandingSection() {
  const { ws, canManage, readOnly, orgName } = useConsole();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["console", "brand"], queryFn: brandApi.get });
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  return (
    <div className="space-y-4" data-section="branding">
      {readOnly ? <Notice tone="info">{READ_ONLY_HINT}</Notice> : !canManage ? <Notice tone="info">Only owners and admins can change the branding.</Notice> : null}
      <Panel title="Your brand" description="Logo and colours for your dashboard and your clients' logins. A client can have its own on its page.">
        <BrandEditor
          brand={q.data}
          canManage={canManage}
          previewName={orgName || "Your client"}
          upload={brandApi.upload}
          save={brandApi.set}
          onSaved={async (b: Brand) => {
            qc.setQueryData(["console", "brand"], b);
            await ws.refresh();
          }}
        />
      </Panel>
    </div>
  );
}

