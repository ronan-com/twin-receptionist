import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/app/primitives";
import { getPipedream, getProviderStatus, putPipedream, removePipedream } from "@/lib/api/clean";
import { cn } from "@/lib/utils";

// Optional: the agency's own Pipedream project, so its clients can connect thousands of apps.

export function PipedreamCard({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["console", "pipedream"], queryFn: getPipedream, retry: false });
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [projectId, setProjectId] = useState("");
  const [open, setOpen] = useState(false);
  const save = useMutation({
    mutationFn: () => putPipedream({ clientId: clientId.trim() || q.data?.clientId || "", clientSecret: secret.trim(), projectId: projectId.trim() || q.data?.projectId || "", environment: "production" }),
    onSuccess: (d) => {
      qc.setQueryData(["console", "pipedream"], d);
      setSecret("");
      setOpen(false);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error("Couldn't save", { description: e.message }),
  });
  const remove = useMutation({
    mutationFn: removePipedream,
    onSuccess: (d) => qc.setQueryData(["console", "pipedream"], d),
    onError: (e: Error) => toast.error("Couldn't remove", { description: e.message }),
  });
  if (!q.data) return null;
  const on = q.data.configured;
  return (
    <Panel title="Pipedream" description={on ? "On. Your clients see Connect an app." : "Add your Pipedream key to unlock 2,000+ apps."}>
      {on && !open ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted"><Plug className="h-4 w-4" /> Project {q.data.projectId}</span>
          {canManage ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Change</Button>
              <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
            </>
          ) : null}
        </div>
      ) : canManage ? (
        open ? (
          <div className="grid gap-2 sm:max-w-md">
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client id" aria-label="Pipedream client id" autoComplete="off" />
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Client secret" aria-label="Pipedream client secret" autoComplete="off" />
            <Input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="Project id (proj_...)" aria-label="Pipedream project id" autoComplete="off" />
            <div className="flex gap-2">
              <Button size="sm" disabled={save.isPending || !secret.trim() || !(clientId.trim() || q.data.clientId) || !(projectId.trim() || q.data.projectId)} onClick={() => save.mutate()}>
                {save.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Save
              </Button>
              {open ? <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button> : null}
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Add key</Button>
        )
      ) : null}
    </Panel>
  );
}

export function BalancesCard() {
  const q = useQuery({ queryKey: ["provider-status", "all"], queryFn: getProviderStatus, retry: false, staleTime: 60_000 });
  if (!q.data || q.data.length === 0) return null;
  return (
    <Panel title="Balances">
      <ul className="divide-y divide-hairline">
        {q.data.map((i) => (
          <li key={i.provider} className="flex flex-wrap items-center gap-3 py-2.5 text-[13.5px]">
            <span className="w-28 font-medium capitalize text-ink">{i.provider}</span>
            <span className={cn("flex-1", i.low ? "text-[#8a4b00]" : "text-ink-muted")}>
              {i.balance != null ? `${i.balance.toLocaleString("en-AU", { maximumFractionDigits: 2 })} ${i.currency ?? ""}`.trim() : i.message || "OK"}
              {i.low && i.message ? ` · ${i.message}` : ""}
            </span>
            {i.url && /^https:\/\//.test(i.url) ? (
              <a href={i.url} target="_blank" rel="noreferrer" className="shrink-0 text-[13px] font-medium text-indigo hover:underline">Top up</a>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
