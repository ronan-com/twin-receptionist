import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ErrorState, Notice, Panel } from "@/components/app/primitives";
import { fmtDateTime } from "@/lib/app/format";
import { updatesApi, type UpdatesChange } from "@/lib/api/support";
import { READ_ONLY_HINT, useConsole } from "./-shared";

// Settings, "Updates" (server/autoUpdate.ts): this copy can update itself, in your own Railway project, using a
// token that only works for that one project. On by default; the owner can turn it off or choose when.

export function UpdatesSection() {
  const { readOnly, role } = useConsole();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["console", "updates"], queryFn: updatesApi.get, refetchInterval: (query) => (query.state.data?.deploying ? 15_000 : false) });
  const save = useMutation({
    mutationFn: (c: UpdatesChange) => updatesApi.save(c),
    onSuccess: (data) => {
      qc.setQueryData(["console", "updates"], data);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const check = useMutation({
    mutationFn: () => updatesApi.check(),
    onSuccess: (data) => {
      qc.setQueryData(["console", "updates"], data.status);
      const r = data.result;
      if (!r.ok) toast.error(r.error || "Couldn't check for updates.");
      else if (r.started) toast.success(`Updating to version ${r.version}. This takes a few minutes and the dashboard may restart.`);
      else toast.success("You're on the newest version.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const source = useMutation({
    mutationFn: () => updatesApi.source(),
    onSuccess: (r) => {
      window.location.assign(r.url);
      toast.success(`Downloading the source of version ${r.version}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  if (!q.data) return <div className="panel p-4 text-[12.5px] text-ink-muted">Loading…</div>;
  const u = q.data;
  const canChange = !readOnly && (role === "owner" || role === "admin");
  return (
    <div className="space-y-4" data-section="updates">
      {readOnly ? <Notice tone="info">{READ_ONLY_HINT}</Notice> : !canChange ? <Notice tone="info">Only an owner or admin can change these.</Notice> : null}
      <Panel title="Automatic updates" description={`You're on version ${u.version || "unknown"}${u.latest && u.latest !== u.version ? `; ${u.latest} is available` : ""}.`}>
        {!u.available ? (
          <p className="max-w-[620px] text-[13px] leading-5 text-ink-muted" data-state="unavailable">
            Automatic updates aren't available on this copy. To update, open your private setup link and press "Update your agency". It takes a few minutes and keeps all your data.
            {u.unavailableReason && u.unavailableReason !== "no-token" ? <span className="mt-1 block">Why: {u.unavailableReason}.</span> : null}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 max-w-[620px] space-y-2 text-[13px] leading-5 text-ink-muted">
                <p className="font-medium text-ink">Keep this agency up to date automatically</p>
                <p>New versions are checked for every hour and installed in your own Railway project. A version that fails to build never replaces the one that's running, and your data is untouched. Turn it off and nothing updates until you press "Update your agency" on your setup link.</p>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-ink">
                <Switch checked={u.enabled} disabled={!canChange || save.isPending} onCheckedChange={(v) => save.mutate({ enabled: v })} aria-label="Automatic updates" data-setting="auto-update" />
                {u.enabled ? "On" : "Off"}
              </label>
            </div>
            <div className="flex items-center justify-between gap-4">
              <p className="text-[13px] font-medium text-ink">When</p>
              <Select value={u.mode} onValueChange={(v) => save.mutate({ mode: v as "overnight" | "asap" })} disabled={!canChange || !u.enabled || save.isPending}>
                <SelectTrigger className="h-8 w-[260px] text-[12.5px]" aria-label="When to update" data-setting="auto-update-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overnight">Overnight, 2 to 4am your time</SelectItem>
                  <SelectItem value="asap">As soon as it's available</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {u.deploying ? <p className="text-[12.5px] text-ink" data-state="deploying">An update is being installed now. This page refreshes itself.</p> : null}
            {u.lastResult === "failed" ? <Notice tone="warning">The last automatic update didn't work{u.lastError ? `: ${u.lastError}` : ""}. Your agency is still running as before{u.lastAt ? ` (${fmtDateTime(u.lastAt)})` : ""}. Your setup provider has been told.</Notice> : null}
            {u.lastResult === "ok" && u.lastAt ? <p className="text-[12.5px] text-ink-muted">Last updated automatically {fmtDateTime(u.lastAt)}.</p> : null}
            <div>
              <Button variant="outline" size="sm" className="h-8 text-[12.5px]" disabled={!canChange || check.isPending || u.deploying} onClick={() => check.mutate()} data-action="update-now">
                {check.isPending ? "Checking…" : "Check and update now"}
              </Button>
            </div>
          </div>
        )}
      </Panel>
      <Panel title="Your source code" description="The full source of the exact version this agency runs. It's yours to keep. It holds no keys or settings.">
        <Button variant="outline" size="sm" className="h-8 text-[12.5px]" disabled={!canChange || source.isPending} onClick={() => source.mutate()} data-action="download-source">
          {source.isPending ? "Getting the link…" : `Download your full source code${u.version ? ` (version ${u.version})` : ""}`}
        </Button>
      </Panel>
    </div>
  );
}
