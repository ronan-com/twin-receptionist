import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, Notice, Panel } from "@/components/app/primitives";
import { brandApi, teamApi } from "@/lib/api/console";
import type { Brand } from "@/lib/shared";
import { BrandEditor } from "./-brand";
import { READ_ONLY_HINT, useConsole } from "./-shared";

// ---- Branding: logo and background for the agency's own screens and its clients' ----

export function BrandingSection() {
  const { ws, canManage, readOnly, orgName, role } = useConsole();
  const [name,setName] = useState(orgName);
  useEffect(()=>setName(orgName),[orgName]);
  const rename=useMutation({mutationFn:()=>teamApi.renameOrg(name.trim()),onSuccess:async()=>{await ws.refresh();toast.success("Agency name saved")},onError:(e:Error)=>toast.error(e.message)});
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["console", "brand"], queryFn: brandApi.get });
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  return (
    <div className="space-y-4" data-section="branding">
      {readOnly ? <Notice tone="info">{READ_ONLY_HINT}</Notice> : !canManage ? <Notice tone="info">Only owners and admins can change the branding.</Notice> : null}
      <Panel title="Business identity" description="Your dashboard name and current dashboard address.">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={e=>{e.preventDefault();rename.mutate()}}>
          <Input aria-label="Agency name" value={name} maxLength={80} required disabled={readOnly || role !== "owner" || !!ws.viewing} onChange={e=>setName(e.target.value)}/>
          {!readOnly && role === "owner" && !ws.viewing ? <Button type="submit" disabled={rename.isPending || !name.trim() || name.trim()===orgName}>Save name</Button> : null}
        </form>
        <p className="mt-4 text-sm font-medium">Dashboard domain</p><p className="text-sm text-ink-muted break-all">{typeof window !== "undefined" ? window.location.origin : ""}</p>
        <p className="mt-2 text-sm text-ink-muted">The agency owner can change this under Settings, Web address.</p>
      </Panel>
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

