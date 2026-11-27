import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/app/primitives";
import { telegramApi, telegramKey } from "@/lib/api/telegram";

// Connect a business's own Telegram bot (server/telegram.ts): paste the token from @BotFather, Connect,
// and the same chatbot that answers the website and texts answers there too.

const STEPS = [
  { n: 1, title: "Make a bot", body: "In Telegram, open @BotFather, send /newbot and pick a name." },
  { n: 2, title: "Paste the token", body: "Copy the token BotFather gives you, paste it here and press Connect." },
  { n: 3, title: "Test it", body: "Open your bot, press Start and say hi." },
];

export function TelegramSetup({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const key = telegramKey(clientId);
  const q = useQuery({ queryKey: key, queryFn: () => telegramApi.get(clientId) });
  const [token, setToken] = useState("");
  const connect = useMutation({
    mutationFn: () => telegramApi.connect(clientId, token.trim()),
    onSuccess: (next) => {
      qc.setQueryData(key, next);
      setToken("");
      toast.success(`Connected @${next.username}`);
    },
    onError: (e: Error) => toast.error("Couldn't connect", { description: e.message }),
  });
  const disconnect = useMutation({
    mutationFn: () => telegramApi.disconnect(clientId),
    onSuccess: (next) => {
      qc.setQueryData(key, next);
      toast.success("Telegram disconnected");
    },
    onError: (e: Error) => toast.error("Couldn't disconnect", { description: e.message }),
  });

  const s = q.data;
  if (q.isPending) return <p className="text-[14px] text-ink-muted">Loading…</p>;
  if (q.error || !s) return <p className="text-[14px] text-ink-muted">{(q.error as Error)?.message ?? "Couldn't load Telegram."}</p>;

  return (
    <div className="space-y-4" data-section="telegram">
      {!s.keyConfigured ? <Notice tone="warning" title="The chatbot isn't switched on">Your agency needs to add an AI key before the bot can answer.</Notice> : null}
      {!s.reachable && !s.connected ? <Notice tone="warning" title="This server isn't reachable by Telegram yet">Telegram needs a public https address. Ask your agency to set it up.</Notice> : null}

      {s.connected ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-ink" data-telegram-username>@{s.username}</div>
              <div className="truncate text-[13px] text-ink-muted">{s.botName ? `${s.botName} · ` : ""}{s.chats} chat{s.chats === 1 ? "" : "s"} so far</div>
            </div>
            <a href={s.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-indigo hover:underline" data-telegram-link>
              {s.link.replace("https://", "")} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <p className="text-[13.5px] text-ink-muted">Open the link, press Start and say hi to test it. Chats show in your Inbox under Telegram.</p>
          {s.canEdit ? (
            <Button variant="outline" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} data-action="disconnect-telegram">
              {disconnect.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Disconnect
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <ol className="space-y-2.5" data-telegram-guide>
            {STEPS.map((st) => (
              <li key={st.n} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo/10 text-[12.5px] font-semibold text-indigo">{st.n}</span>
                <span className="min-w-0 text-[14px] text-ink-muted"><span className="font-medium text-ink">{st.title}.</span> {st.body}</span>
              </li>
            ))}
          </ol>
          {s.canEdit ? (
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (token.trim()) connect.mutate();
              }}
            >
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456789:ABC-def..."
                aria-label="Bot token"
                autoComplete="off"
                spellCheck={false}
                disabled={connect.isPending}
                className="h-12 flex-1 bg-white font-mono text-[14px]"
              />
              <Button type="submit" className="h-12 sm:min-w-[120px]" disabled={!token.trim() || connect.isPending || !s.reachable} data-action="connect-telegram">
                {connect.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Connect
              </Button>
            </form>
          ) : (
            <p className="text-[13.5px] text-ink-muted">You have view-only access. Ask a manager to connect Telegram.</p>
          )}
        </>
      )}
    </div>
  );
}
