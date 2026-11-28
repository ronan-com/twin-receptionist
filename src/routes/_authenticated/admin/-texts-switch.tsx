import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/app/StatusBadge";
import { getTextChoices, getTexts, setTextNumber, setTexts } from "@/lib/api/console";
import { fmtPhone } from "@/lib/app/format";
import { US_TEXT_NOTE, type TextsStatus } from "@/lib/shared";
import { PROVIDER_LABEL } from "./-number-caps";

// A receptionist's texts: the on/off switch, the number they come to (any Twilio number that can text, or a
// Telnyx Australian mobile, whatever answers its calls), and what's wrong when they aren't arriving.
// Switching on again retries a connection that didn't finish.

const LABEL: Record<TextsStatus["status"], { text: string; tone: "success" | "muted" | "warning" | "danger" }> = {
  on: { text: "On", tone: "success" },
  off: { text: "Off", tone: "muted" },
  waiting: { text: "Waiting for number approval", tone: "warning" },
  cant: { text: "Not working", tone: "warning" },
  failed: { text: "Not connected", tone: "danger" },
};

export function TextsSwitch({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ["texts", clientId];
  const q = useQuery({ queryKey: key, queryFn: () => getTexts(clientId), staleTime: 15_000 });
  const choicesQ = useQuery({ queryKey: ["text-choices", clientId], queryFn: () => getTextChoices(clientId), staleTime: 15_000, enabled: canEdit, retry: false });
  // Who uses which number has changed: the lists and the Numbers page look again.
  const changed = async (s: TextsStatus) => {
    qc.setQueryData(key, s);
    await Promise.all([qc.invalidateQueries({ queryKey: ["text-choices"] }), qc.invalidateQueries({ queryKey: ["admin"] }), qc.invalidateQueries({ queryKey: ["console"] })]);
  };
  const set = useMutation({
    mutationFn: (on: boolean) => setTexts(clientId, on),
    onSuccess: async (s) => {
      toast.success(s.on ? "Texts on" : "Texts off");
      await changed(s);
    },
    onError: (e: Error) => toast.error("Couldn't change texts", { description: e.message }),
  });
  const pick = useMutation({
    mutationFn: (number: string) => setTextNumber(clientId, number),
    onSuccess: async (s) => {
      if (s.status === "on") toast.success("Text number set", { description: `Texts to ${fmtPhone(s.current?.number)} are answered here.` });
      else toast.warning("Text number saved", { description: s.detail });
      await changed(s);
    },
    onError: async (e: Error) => {
      toast.error("Couldn't use that number", { description: e.message });
      await qc.invalidateQueries({ queryKey: key });
    },
  });
  const s = q.data;
  const label = s ? LABEL[s.status] : null;
  const busy = set.isPending || pick.isPending;
  const current = s?.current ?? null;
  const choices = choicesQ.data?.choices ?? [];
  // The current number stays listed even when it's gone from the account, so it's always shown.
  const options = current && !choices.some((c) => c.number === current.number) ? [{ ...current, usedBy: "" }, ...choices] : choices;
  return (
    <div className="space-y-2" data-texts={clientId}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12.5px] font-medium text-ink">Texts</div>
        <div className="flex items-center gap-2">
          {label ? <span data-texts-status={s!.status}><StatusBadge tone={label.tone}>{label.text}</StatusBadge></span> : null}
          {canEdit ? <Switch checked={s?.on ?? false} onCheckedChange={(v) => set.mutate(v)} disabled={!s || busy} aria-label="Texts" data-action="toggle-texts" /> : null}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="text-[12.5px] text-ink-muted">Text number</div>
        {canEdit && options.length ? (
          <Select value={current?.number ?? ""} onValueChange={(v) => pick.mutate(v)} disabled={!s || busy}>
            <SelectTrigger className="h-9 w-full text-[13px] sm:w-[320px]" aria-label="Text number" data-field="text-number">
              <SelectValue placeholder="Choose a number" />
            </SelectTrigger>
            <SelectContent>
              {options.map((c) => (
                <SelectItem key={c.number} value={c.number} disabled={Boolean(c.usedBy)}>
                  {fmtPhone(c.number)} · {PROVIDER_LABEL[c.via]}{c.usedBy ? ` · used by ${c.usedBy}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="text-[13px] tabular-nums text-ink">{current ? `${fmtPhone(current.number)} · ${PROVIDER_LABEL[current.via]}` : "None"}</div>
        )}
      </div>
      {canEdit && choicesQ.data && !options.length ? (
        <p className="text-[11.5px] text-ink-muted" data-note="no-text-numbers">
          No number can text yet. <Link to="/admin/connections" className="text-indigo hover:underline">Connect Twilio</Link> or add an Australian mobile.
        </p>
      ) : null}
      {choicesQ.data?.problems.map((p) => <p key={p} className="text-[11.5px] text-[#a41d1d]">{p}</p>)}
      {q.error ? <p role="alert" className="text-[11.5px] text-[#a41d1d]">{(q.error as Error).message}</p> : null}
      {s && s.detail && s.status !== "on" ? <p className="text-[11.5px] text-ink-muted" data-texts-detail>{s.detail}</p> : null}
      {s?.warning ? <p role="alert" className="text-[11.5px] text-[#a41d1d]" data-texts-warning>{s.warning}</p> : null}
      {current?.number.startsWith("+1") ? <p className="text-[11.5px] text-ink-muted" data-note="us-text-number">{US_TEXT_NOTE}</p> : null}
      {s?.status === "failed" && canEdit ? (
        <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => set.mutate(true)} disabled={busy} data-action="retry-texts">
          Try again
        </Button>
      ) : null}
    </div>
  );
}
