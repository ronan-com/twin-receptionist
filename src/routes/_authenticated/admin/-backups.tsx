import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, Notice, Panel } from "@/components/app/primitives";
import { fmtDateTime } from "@/lib/app/format";
import { backupsApi, type BackupsStatus } from "@/lib/api/support";
import { READ_ONLY_HINT, useConsole } from "./-shared";

// Settings, "Backups" (server/backup.ts): a daily copy of this agency's database, kept on its own volume, an optional
// copy to the agency's own storage, and how long call transcripts and chat messages are kept.

const fmtSize = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const KEEP_LABEL: Record<string, string> = { "3": "3 months", "6": "6 months", "12": "12 months", "24": "24 months", "0": "Forever" };

export function BackupsSection() {
  const { readOnly, role } = useConsole();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["console", "backups"], queryFn: backupsApi.get });
  const set = (d: BackupsStatus) => qc.setQueryData(["console", "backups"], d);
  const run = useMutation({
    mutationFn: () => backupsApi.run(),
    onSuccess: (r) => { set(r.status); toast.success("Backed up"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: backupsApi.save,
    onSuccess: (d) => { set(d); toast.success("Saved"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [form, setForm] = useState<{ endpoint: string; bucket: string; region: string; accessKeyId: string; secret: string } | null>(null);
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  if (!q.data) return <div className="panel p-4 text-[12.5px] text-ink-muted">Loading…</div>;
  const b = q.data;
  const canChange = !readOnly && (role === "owner" || role === "admin");
  const f = form ?? { endpoint: b.settings.s3?.endpoint ?? "", bucket: b.settings.s3?.bucket ?? "", region: b.settings.s3?.region ?? "", accessKeyId: b.settings.s3?.accessKeyId ?? "", secret: "" };
  const upd = (k: keyof typeof f, v: string) => setForm({ ...f, [k]: v });
  const dbPart = b.databaseMb === null ? null : b.databaseLimitMb ? `${b.databaseMb} MB of ${b.databaseLimitMb} MB` : `${b.databaseMb} MB`;
  return (
    <div className="space-y-4" data-section="backups">
      {readOnly ? <Notice tone="info">{READ_ONLY_HINT}</Notice> : !canChange ? <Notice tone="info">Only an owner or admin can change these.</Notice> : null}
      <Panel title="Daily backup" description="A copy of your whole agency (people, businesses, calls, chats and settings) is saved every day. The last 7 are kept.">
        <div className="space-y-3 text-[13px] leading-5 text-ink-muted">
          {!b.enabled ? <p data-state="off">Backups are switched off on this copy.</p> : b.last ? (
            <p className="text-ink" data-state="ok">Last backup {fmtDateTime(b.last.at)}, {fmtSize(b.last.size)}. {b.backups.length} kept.</p>
          ) : <p data-state="none">No backup yet. The first one runs within a few minutes of starting, or press "Back up now".</p>}
          {b.lastError ? <Notice tone="warning">The last backup didn't work: {b.lastError}</Notice> : null}
          {b.volume === "missing" ? <Notice tone="warning">Backups are on this server's temporary disk, so an update can wipe them. Update from your setup link ("Update your agency") and a volume is added, or add one to the app service in Railway yourself.</Notice> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="h-8 text-[12.5px]" disabled={!canChange || run.isPending} onClick={() => run.mutate()} data-action="backup-now">{run.isPending ? "Backing up…" : "Back up now"}</Button>
            {b.last ? <Button asChild variant="outline" size="sm" className="h-8 text-[12.5px]"><a href="/api/backups/download" download data-action="backup-download">Download latest</a></Button> : null}
          </div>
          <p className="text-[12px]">Railway Pro adds automatic volume backups.</p>
        </div>
      </Panel>
      <Panel title="Copy off-site" description="Also send each backup to your own storage (Cloudflare R2, Backblaze B2, Amazon S3 or any S3-compatible service).">
        <div className="max-w-[560px] space-y-2">
          <Input value={f.endpoint} onChange={(e) => upd("endpoint", e.target.value)} placeholder="Endpoint, e.g. https://<account>.r2.cloudflarestorage.com" aria-label="Endpoint" className="h-8 text-[12.5px]" disabled={!canChange} />
          <div className="flex gap-2">
            <Input value={f.bucket} onChange={(e) => upd("bucket", e.target.value)} placeholder="Bucket" aria-label="Bucket" className="h-8 text-[12.5px]" disabled={!canChange} />
            <Input value={f.region} onChange={(e) => upd("region", e.target.value)} placeholder="Region (optional)" aria-label="Region" className="h-8 text-[12.5px]" disabled={!canChange} />
          </div>
          <Input value={f.accessKeyId} onChange={(e) => upd("accessKeyId", e.target.value)} placeholder="Access key" aria-label="Access key" className="h-8 text-[12.5px]" disabled={!canChange} />
          <Input type="password" value={f.secret} onChange={(e) => upd("secret", e.target.value)} placeholder={b.settings.s3?.secretSet ? "Secret key (saved, leave blank to keep)" : "Secret key"} aria-label="Secret key" className="h-8 text-[12.5px]" disabled={!canChange} />
          {b.offsite.configured ? <p className="text-[12.5px] text-ink-muted">{b.offsite.error ? `Last copy failed: ${b.offsite.error}` : b.offsite.at ? `Last copied ${fmtDateTime(b.offsite.at)}.` : "Set up. The next backup is copied."}</p> : null}
          <div className="flex gap-2">
            <Button size="sm" className="h-8 text-[12.5px]" disabled={!canChange || save.isPending} onClick={() => save.mutate({ s3: f }, { onSuccess: () => setForm(null) })} data-action="offsite-save">Save</Button>
            {b.settings.s3 ? <Button variant="outline" size="sm" className="h-8 text-[12.5px]" disabled={!canChange || save.isPending} onClick={() => save.mutate({ s3: null }, { onSuccess: () => setForm(null) })}>Turn off</Button> : null}
          </div>
        </div>
      </Panel>
      <Panel title="Keep transcripts and chat messages" description="Older call transcripts and chat messages are deleted to keep the database small. Every call, its summary and its outcome are kept.">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[13px] font-medium text-ink">Keep for</p>
            <Select value={String(b.settings.retentionMonths)} onValueChange={(v) => save.mutate({ retentionMonths: Number(v) })} disabled={!canChange || save.isPending}>
              <SelectTrigger className="h-8 w-[200px] text-[12.5px]" aria-label="Keep transcripts for" data-setting="retention"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(KEEP_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {dbPart ? <p className="text-[12.5px] text-ink-muted" data-state="db-size">Database size: {dbPart}.</p> : null}
          {b.cleanup.at && b.cleanup.removed ? <p className="text-[12.5px] text-ink-muted">Last clean-up {fmtDateTime(b.cleanup.at)}: {b.cleanup.removed.transcripts} transcripts and {b.cleanup.removed.messages} messages removed.</p> : null}
        </div>
      </Panel>
    </div>
  );
}
