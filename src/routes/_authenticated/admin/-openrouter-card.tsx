import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { openRouterApi, openRouterQuery, providerStatusQuery } from "@/lib/api/openrouter";

// The AI behind website chat, texts, email replies and call summaries runs on OpenRouter, whichever
// phone provider is used. The key is saved sealed; without one the server's own key (if any) is used.

export function OpenRouterCard({ canManage, readOnly }: { canManage: boolean; readOnly: boolean }) {
  const qc = useQueryClient();
  const q = useQuery(openRouterQuery());
  const status = useQuery({ ...providerStatusQuery(), enabled: canManage });
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: () => openRouterApi.save(key.trim()),
    onSuccess: (s) => {
      qc.setQueryData(openRouterQuery().queryKey, s);
      void qc.invalidateQueries({ queryKey: providerStatusQuery().queryKey });
      setKey("");
      toast.success("OpenRouter connected", { description: "Checked with OpenRouter and saved." });
    },
    onError: (e: Error) => toast.error("Couldn't save the key", { description: e.message }),
  });
  const remove = useMutation({
    mutationFn: openRouterApi.remove,
    onSuccess: (s) => {
      qc.setQueryData(openRouterQuery().queryKey, s);
      void qc.invalidateQueries({ queryKey: providerStatusQuery().queryKey });
      toast.success("OpenRouter key removed");
    },
    onError: (e: Error) => toast.error("Couldn't remove it", { description: e.message }),
  });
  if (!q.data) return null;
  const s = q.data;
  const low = (status.data ?? []).filter((i) => i.low);

  return (
    <section className="rounded-[12px] border border-hairline bg-white p-5" data-card="openrouter-key">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold text-ink">AI (OpenRouter)</h2>
        <StatusBadge tone={s.configured ? "success" : "muted"} dot>
          {s.source === "own" ? `Key ending ${s.last4}` : s.source === "server" ? "Using this server's key" : "Not connected"}
        </StatusBadge>
      </div>
      <p className="mt-1 max-w-[620px] text-[13px] text-ink-muted">
        Writes the replies for website chat, texts and email, and the call summaries. Get a key at{" "}
        <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-indigo hover:underline">
          openrouter.ai/keys <ExternalLink className="h-3 w-3" />
        </a>{" "}
        and add credit there.
      </p>
      {!readOnly && canManage ? (
        <form
          className="mt-3 flex max-w-[620px] flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) save.mutate();
          }}
        >
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-…" autoComplete="off" spellCheck={false} className="h-9 min-w-[220px] flex-1 bg-white font-mono text-[13px]" data-field="openrouter-key" />
          <Button size="sm" type="submit" className="h-9 text-[12.5px]" disabled={!key.trim() || save.isPending} data-action="save-openrouter">
            {s.source === "own" ? "Replace" : "Save"}
          </Button>
          {s.source === "own" ? (
            <Button size="sm" type="button" variant="ghost" className="h-9 text-[12.5px]" onClick={() => remove.mutate()} disabled={remove.isPending} data-action="remove-openrouter">
              Remove
            </Button>
          ) : null}
        </form>
      ) : null}
      {low.map((i) => (
        <div key={i.provider} className="mt-3">
          <Notice tone="danger" title="Running low">
            {i.message}{" "}
            {i.url ? (
              <a href={i.url} target="_blank" rel="noreferrer noopener" className="text-indigo hover:underline">
                Top up
              </a>
            ) : null}
          </Notice>
        </div>
      ))}
    </section>
  );
}
