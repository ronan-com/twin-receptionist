import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/StatusBadge";
import { getTexts, setTexts } from "@/lib/api/console";
import type { TextsStatus } from "@/lib/shared";

// The Texts switch, under a receptionist's numbers: on, off, waiting for the number's approval, or
// no number that can text. Switching on again retries a connection that didn't finish.

const LABEL: Record<TextsStatus["status"], { text: string; tone: "success" | "muted" | "warning" | "danger" }> = {
  on: { text: "On", tone: "success" },
  off: { text: "Off", tone: "muted" },
  waiting: { text: "Waiting for number approval", tone: "warning" },
  cant: { text: "Number can't text", tone: "muted" },
  failed: { text: "Not connected", tone: "danger" },
};

export function TextsSwitch({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ["texts", clientId];
  const q = useQuery({ queryKey: key, queryFn: () => getTexts(clientId), staleTime: 15_000 });
  const set = useMutation({
    mutationFn: (on: boolean) => setTexts(clientId, on),
    onSuccess: (s) => {
      qc.setQueryData(key, s);
      toast.success(s.on ? "Texts on" : "Texts off");
    },
    onError: (e: Error) => toast.error("Couldn't change texts", { description: e.message }),
  });
  const s = q.data;
  const label = s ? LABEL[s.status] : null;
  return (
    <div className="mt-3 space-y-1.5 border-t border-hairline pt-3" data-texts={clientId}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12.5px] font-medium text-ink">Texts</div>
        <div className="flex items-center gap-2">
          {label ? <span data-texts-status={s!.status}><StatusBadge tone={label.tone}>{label.text}</StatusBadge></span> : null}
          {canEdit ? <Switch checked={s?.on ?? false} onCheckedChange={(v) => set.mutate(v)} disabled={!s || set.isPending} aria-label="Texts" data-action="toggle-texts" /> : null}
        </div>
      </div>
      {s && s.detail && s.status !== "on" ? <p className="text-[11.5px] text-ink-muted">{s.detail}</p> : null}
      {s?.status === "failed" && canEdit ? (
        <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => set.mutate(true)} disabled={set.isPending} data-action="retry-texts">
          Try again
        </Button>
      ) : null}
    </div>
  );
}
