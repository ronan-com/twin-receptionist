import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ErrorState, Notice, Panel } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { fmtDateTime } from "@/lib/app/format";
import { supportApi, type SupportChange } from "@/lib/api/support";
import { READ_ONLY_HINT, useConsole } from "./-shared";

// Settings, "Support" (server/supportSync.ts): what this copy shares with the company that set it up,
// and whether that company's support person may sign in. Both are the owner's choice.

type For = "24h" | "7d" | "forever";

export function SupportSection() {
  const { readOnly, role } = useConsole();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["console", "support"], queryFn: supportApi.get });
  const [duration, setDuration] = useState<For>("7d");
  const save = useMutation({
    mutationFn: (c: SupportChange) => supportApi.save(c),
    onSuccess: (data) => {
      qc.setQueryData(["console", "support"], data);
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  if (!q.data) return <div className="panel p-4 text-[12.5px] text-ink-muted">Loading…</div>;
  const s = q.data;
  if (!s.configured) {
    return (
      <Panel title="Support" description="Sharing with the company that set this up">
        <p className="max-w-[620px] text-[13px] leading-5 text-ink-muted">This copy isn't connected to a setup provider, so nothing is shared and nobody can sign in. There is nothing to turn on or off.</p>
      </Panel>
    );
  }
  const canChange = !readOnly && role === "owner";
  const seller = s.seller;
  return (
    <div className="space-y-4" data-section="support">
      {readOnly ? <Notice tone="info">{READ_ONLY_HINT}</Notice> : !canChange ? <Notice tone="info">Only the owner can change these.</Notice> : null}

      <Panel title="Share health and usage stats with your setup provider" description={`${seller} set this up for you. Sharing is on by default and you can turn it off at any time.`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 max-w-[620px] space-y-2 text-[13px] leading-5 text-ink-muted">
            <p className="font-medium text-ink">Every 15 minutes this copy sends {seller}:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {s.sends.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p>{s.neverSent}</p>
            <p>
              Turn it off and nothing is sent at all. {s.sync.enabled && s.sync.lastSentAt ? `Last sent ${fmtDateTime(s.sync.lastSentAt)}${s.sync.lastOk === false ? `, but it didn't arrive (${s.sync.lastError})` : ""}.` : ""}
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-ink">
            <Switch checked={s.sync.enabled} disabled={!canChange || save.isPending} onCheckedChange={(v) => save.mutate({ sync: v })} aria-label="Share health and usage stats with your setup provider" data-setting="support-sync" />
            {s.sync.enabled ? "On" : "Off"}
          </label>
        </div>
      </Panel>

      <Panel title="Support access" description={`On by default for a fresh install, so ${seller} can help you fast. You can turn it off at any time. Lets ${seller} sign in to your dashboard to help you.`}>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 max-w-[620px] space-y-2 text-[13px] leading-5 text-ink-muted">
              <p className="font-medium text-ink">Let {seller} sign in to your dashboard to help you</p>
              <p>They sign in through a link that works once, for 60 seconds, as a support person. They can look around to help with a problem{s.edit.enabled ? " and, while \"Support can make changes\" is on, fix things for you (receptionists, automations, numbers, knowledge, clients and settings)" : " (read only, because \"Support can make changes\" is off)"}. They can never see or change your keys or connection secrets, billing, the owner account or password, delete your agency, or export your data. Every sign-in and every change is in your audit log and listed below.</p>
              {s.access.enabled ? <p className="text-ink">On{s.access.until ? ` until ${fmtDateTime(s.access.until)}` : " until you turn it off"}{s.access.isDefault ? " (the default for this install: you haven't chosen yet)" : ""}.</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!s.access.enabled ? (
                <Select value={duration} onValueChange={(v) => setDuration(v as For)} disabled={!canChange}>
                  <SelectTrigger className="h-8 w-[150px] text-[12.5px]" aria-label="How long">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24h">For 24 hours</SelectItem>
                    <SelectItem value="7d">For 7 days</SelectItem>
                    <SelectItem value="forever">Until I turn it off</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
              <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
                <Switch
                  checked={s.access.enabled}
                  disabled={!canChange || save.isPending}
                  onCheckedChange={(v) => save.mutate({ access: v ? { enabled: true, for: duration } : { enabled: false } })}
                  aria-label={`Let ${seller} sign in to your dashboard to help you`}
                  data-setting="support-access"
                />
                {s.access.enabled ? "On" : "Off"}
              </label>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Support can make changes" description={`On by default. Off means ${seller} can look but not change anything, as before.`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 max-w-[620px] space-y-2 text-[13px] leading-5 text-ink-muted">
            <p className="font-medium text-ink">Let {seller} fix things while they're signed in</p>
            <p>Only while Support access is on. Each change is written to your audit log as "By support" and shown under Support activity below.</p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-ink">
            <Switch checked={s.edit.enabled} disabled={!canChange || save.isPending} onCheckedChange={(v) => save.mutate({ edit: v })} aria-label={`Let ${seller} make changes while signed in`} data-setting="support-edit" />
            {s.edit.enabled ? "On" : "Off"}
          </label>
        </div>
      </Panel>

      <Panel title="Support activity" description="Every time access was turned on or off, a link was asked for, someone signed in, or support changed something.">
        {s.recent.length ? (
          <ul className="divide-y divide-[var(--hue-line,#e5e7eb)] text-[12.5px]">
            {s.recent.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate text-ink">{r.summary || r.action}</span>
                <span className="flex shrink-0 items-center gap-2 text-ink-muted">
                  {r.action === "support.signin" ? <StatusBadge tone="info">Sign-in</StatusBadge> : null}
                  {r.action === "support.change" ? <StatusBadge tone="info">By support</StatusBadge> : null}
                  {fmtDateTime(r.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-muted">Nothing yet. Nobody has asked to sign in.</p>
        )}
        <div className="pt-3">
          <Button asChild variant="outline" size="sm" className="h-8 text-[12.5px]">
            <a href="/admin/audit">Open the audit log</a>
          </Button>
        </div>
      </Panel>
    </div>
  );
}
