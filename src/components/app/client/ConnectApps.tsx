import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ExternalLink, Link2, Loader2, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAppOptions, getApps, getMcp, saveAppSettings, pipedreamConnect, putMcp, removeAppKey, saveAppKey, testAppKey, type AppCard } from "@/lib/api/clean";
import { useWorkspace } from "@/lib/app/workspace";
import { cn } from "@/lib/utils";

// Connect your apps. Every way is optional: paste an app's key, paste an MCP link,
// use the webhook below, or (when the agency has set it up) pick from thousands of apps.

const PICKS: Record<string, { field: string; label: string; from: "businesses" | "practitioners" | "appointmentTypes" | "staff" }[]> = {
  cliniko: [
    { field: "businessId", label: "Location", from: "businesses" },
    { field: "practitionerId", label: "Practitioner", from: "practitioners" },
    { field: "appointmentTypeId", label: "Appointment type", from: "appointmentTypes" },
  ],
  servicem8: [{ field: "staffUuid", label: "Schedule jobs with (optional)", from: "staff" }],
};
const SEND_NOTE: Record<string, string> = {
  servicem8: "Finds or adds the caller as a client, creates a job (a Work Order for a booking, a Quote for a callback) and adds the call summary as a note.",
  cliniko: "Finds or adds the caller as a patient, books the appointment with your choices below, and adds the call summary to the patient's notes.",
  xero: "Finds or adds the caller as a contact and adds the booking and call summary to their history. Xero is accounting, so no appointment is made.",
};

function SendBox({ app }: { app: AppCard }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const id = ws.businessId!;
  const canEdit = ws.access.canEdit;
  const picks = PICKS[app.provider] ?? [];
  const opts = useQuery({ queryKey: ["app-options", id, app.provider], enabled: picks.length > 0 && app.connected && canEdit, queryFn: () => getAppOptions(id, app.provider), retry: false });
  const save = useMutation({ mutationFn: (b: { enabled?: boolean; config?: Record<string, string> }) => saveAppSettings(id, app.provider, b), onSuccess: (d) => qc.setQueryData(["apps", id], d), onError: (e: Error) => toast.error("Couldn't save", { description: e.message }) });
  return (
    <div className="space-y-2 rounded-lg bg-[#f6f7f9] p-3">
      <label className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
        <input type="checkbox" checked={app.enabled} disabled={!canEdit || save.isPending} onChange={(e) => save.mutate({ enabled: e.target.checked })} aria-label={`Send bookings to ${app.name}`} />
        Send bookings to {app.name}
      </label>
      <p className="text-[12px] text-ink-muted">{SEND_NOTE[app.provider]}</p>
      {canEdit && picks.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {picks.map((p) => (
            <label key={p.field} className="text-[12px] text-ink-muted">
              {p.label}
              <select className="mt-1 h-9 w-full rounded-md border border-hairline bg-white px-2 text-[13px] text-ink" value={app.config[p.field] ?? ""} onChange={(e) => save.mutate({ config: { [p.field]: e.target.value } })}>
                <option value="">{opts.isLoading ? "Loading..." : "Choose"}</option>
                {(opts.data?.[p.from] ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      ) : null}
      {opts.isError ? <p className="text-[12px] text-[#a41d1d]">Couldn't load your {app.name} choices. Check the key with Test connection.</p> : null}
      {app.last ? (
        <p className={cn("text-[12px]", app.last.ok ? "text-ink-muted" : "text-[#a41d1d]")} data-last-sync role="status">
          Last sync: {new Date(app.last.at).toLocaleString()} ({app.last.what}){app.last.ok ? ", sent" : `, failed: ${app.last.error ?? "unknown error"}`}
        </p>
      ) : null}
    </div>
  );
}

function KeyCard({ app }: { app: AppCard }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const id = ws.businessId!;
  const canEdit = ws.access.canEdit;
  const [key, setKey] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const done = (data: unknown) => qc.setQueryData(["apps", id], data);
  const save = useMutation({ mutationFn: () => saveAppKey(id, app.provider, key.trim()), onSuccess: (d) => { done(d); setKey(""); setResult(null); toast.success(`${app.name} key saved`); }, onError: (e: Error) => toast.error("Couldn't save", { description: e.message }) });
  const remove = useMutation({ mutationFn: () => removeAppKey(id, app.provider), onSuccess: (d) => { done(d); setResult(null); }, onError: (e: Error) => toast.error("Couldn't remove", { description: e.message }) });
  const test = useMutation({ mutationFn: () => testAppKey(id, app.provider), onSuccess: setResult, onError: (e: Error) => toast.error("Couldn't test", { description: e.message }) });
  return (
    <div data-app={app.provider} className="flex flex-col gap-3 rounded-xl border border-hairline bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14.5px] font-semibold text-ink">{app.name}</span>
        {app.connected ? <span className="inline-flex items-center gap-1 rounded-full bg-[#e6f6ee] px-2.5 py-0.5 text-[12px] font-medium text-[#0e6245]"><Check className="h-3 w-3" /> Key saved</span> : null}
      </div>
      {canEdit ? (
        <div className="flex gap-2">
          <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={app.connected ? "Paste a new key" : "Paste API key"} aria-label={`${app.name} API key`} className="h-10" />
          <Button size="sm" className="h-10" disabled={key.trim().length < 8 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      ) : null}
      <p className="text-[12px] text-ink-muted">{app.hint}</p>
      {app.connected && app.syncable ? <SendBox app={app} /> : null}
      {!app.syncable ? <p className="text-[12px] text-ink-muted">Tradify has no public API, so bookings can't be sent to it. Use the Pipedream button, an MCP link or the webhook below.</p> : null}
      {app.connected && canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-8" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Test connection
          </Button>
          <Button size="sm" variant="ghost" className="h-8" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
          {result ? <span className={cn("text-[12.5px]", result.ok ? "text-[#0e6245]" : "text-[#a41d1d]")} role="status">{result.message}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function McpBox() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const id = ws.businessId!;
  const canEdit = ws.access.canEdit;
  const q = useQuery({ queryKey: ["mcp", id], queryFn: () => getMcp(id) });
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  useEffect(() => {
    if (q.data) {
      setUrl(q.data.mcp.url);
      setName(q.data.mcp.headerName);
      setValue("");
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: (clear: boolean) => putMcp(id, clear ? { url: "" } : { url: url.trim(), headerName: name.trim(), headerValue: value.trim() }),
    onSuccess: (d) => {
      qc.setQueryData(["mcp", id], d);
      if (d.warning) toast.warning(d.warning);
      else toast.success("Saved");
    },
    onError: (e: Error) => toast.error("Couldn't save", { description: e.message }),
  });
  const dirty = url.trim() !== (q.data?.mcp.url ?? "") || name.trim() !== (q.data?.mcp.headerName ?? "") || value.trim() !== "";
  return (
    <div data-mcp className="space-y-3 rounded-xl border border-hairline bg-white p-4">
      <div className="flex items-center gap-2 text-[14.5px] font-semibold text-ink"><Link2 className="h-4 w-4" /> MCP link</div>
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-app.com/mcp" aria-label="MCP link" disabled={!canEdit} className="h-10" />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Header name (optional)" aria-label="Header name" disabled={!canEdit} className="h-10" />
        <Input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={q.data?.mcp.hasHeader ? "Saved. Paste to replace" : "Header value"} aria-label="Header value" disabled={!canEdit} className="h-10" />
      </div>
      {canEdit ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(false)}>{save.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Save</Button>
          {q.data?.mcp.url ? <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate(true)}>Remove</Button> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ConnectApps() {
  const ws = useWorkspace();
  const id = ws.businessId;
  const q = useQuery({ queryKey: ["apps", id], enabled: !!id, queryFn: () => getApps(id!) });
  const hosted = useMutation({
    mutationFn: () => pipedreamConnect(id!),
    onSuccess: (r) => window.open(r.url, "_blank", "noopener"),
    onError: (e: Error) => toast.error("Couldn't open it", { description: e.message }),
  });
  if (!id) return null;
  return (
    <section data-connect-apps className="space-y-3">
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Connect your apps</h2>
      {q.data?.pipedream && ws.access.canEdit ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-white p-4">
          <span className="flex items-center gap-2 text-[14.5px] font-semibold text-ink"><Plug className="h-4 w-4" /> Thousands of apps</span>
          <Button size="sm" disabled={hosted.isPending} onClick={() => hosted.mutate()} data-action="connect-an-app">
            {hosted.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="mr-1.5 h-3.5 w-3.5" />}Connect an app
          </Button>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">{(q.data?.apps ?? []).map((a) => <KeyCard key={a.provider} app={a} />)}</div>
      <McpBox />
      <p className="text-[12.5px] text-ink-muted">Saved keys are kept private and never shown again. Switch on "Send bookings" on an app to have each booking, callback and call summary sent to it. Anything goes to the webhook below too. Your MCP link is used by the phone assistant only.</p>
    </section>
  );
}
