import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, ErrorState, Notice, Panel } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtDateTime, fmtRelative } from "@/lib/app/format";
import { webchatApi, webchatKey, type WebchatChat, type WebchatState } from "@/lib/api/webchat";
import { cn } from "@/lib/utils";

// The "Website chat" card on a receptionist: switch it on, list the websites that may show
// it, copy the snippet, preview it on this page, and read the chats it has had.
// Server side: server/webchat.ts. The widget itself is public/webchat.js.

const OUTCOME: Record<string, { label: string; tone: "success" | "info" }> = {
  booked: { label: "Booked", tone: "success" },
  callback: { label: "Message taken", tone: "info" },
};

export function WebsiteChatCard({ clientId, businessName }: { clientId: string; businessName: string }) {
  const qc = useQueryClient();
  const key = webchatKey(clientId);
  const q = useQuery({ queryKey: key, queryFn: () => webchatApi.get(clientId) });
  const chats = useQuery({ queryKey: [...key, "chats"], queryFn: () => webchatApi.chats(clientId), refetchInterval: 30_000 });
  const [domains, setDomains] = useState("");
  const [greeting, setGreeting] = useState("");
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const state = q.data;

  useEffect(() => {
    if (!state) return;
    setDomains(state.domains.join("\n"));
    setGreeting(state.greeting);
  }, [state?.domains.join("\n"), state?.greeting]);

  const save = useMutation({
    mutationFn: (patch: { enabled?: boolean; domains?: string; greeting?: string }) => webchatApi.save(clientId, patch),
    onSuccess: (next) => {
      qc.setQueryData(key, next);
      toast.success("Website chat saved");
    },
    onError: (e: Error) => toast.error("Couldn't save", { description: e.message }),
  });

  // Live preview: the real widget, loaded on this page, opened.
  const preview = () => {
    if (!state) return;
    (window as any).TwinWebchat?.destroy?.();
    document.querySelectorAll("script[data-twin-preview]").forEach((n) => n.remove());
    const s = document.createElement("script");
    s.src = `${window.location.origin}/webchat.js`;
    s.setAttribute("data-receptionist", state.publicId);
    s.setAttribute("data-open", "true");
    s.setAttribute("data-twin-preview", "1");
    s.async = true;
    document.body.appendChild(s);
  };
  // The preview is removed when leaving the page.
  useEffect(
    () => () => {
      (window as any).TwinWebchat?.destroy?.();
      document.querySelectorAll("script[data-twin-preview]").forEach((n) => n.remove());
    },
    [],
  );

  if (q.isPending) return <Panel title="Website chat"><p className="text-[12.5px] text-ink-muted">Loading…</p></Panel>;
  if (q.error || !state) return <ErrorState message={(q.error as Error)?.message ?? "Couldn't load website chat."} onRetry={() => void q.refetch()} />;

  const editable = state.canEdit;
  const dirty = domains !== state.domains.join("\n") || greeting !== state.greeting;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the snippet and copy it by hand.");
    }
  };

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          <MessageCircle className="h-4 w-4 text-ink-muted" /> Website chat
          <StatusBadge tone={state.enabled && state.keyConfigured ? "success" : "muted"} dot>{state.enabled && state.keyConfigured ? "On" : "Off"}</StatusBadge>
        </span>
      }
      description={`A chat bubble for ${businessName}'s website. It answers like the phone receptionist and can book or take a message.`}
      actions={
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          On
          <Switch
            checked={state.enabled}
            disabled={!editable || save.isPending || !state.keyConfigured}
            onCheckedChange={(v) => save.mutate({ enabled: v })}
            aria-label="Website chat on"
            data-action="toggle-website-chat"
          />
        </label>
      }
    >
      <div className="space-y-4" data-section="website-chat">
        {!state.keyConfigured ? (
          <Notice tone="warning" title="Add an OpenRouter key to turn on website chat">
            Set OPENROUTER_API_KEY on the server. Until then the chat can't answer, so the snippet is switched off.
          </Notice>
        ) : null}
        {state.enabled && state.domains.length === 0 ? (
          <Notice tone="warning" title="Any website can show this chat">
            No websites are listed, so the chat works on any page that carries the snippet. List the business's own websites below to limit it.
          </Notice>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Websites that can show the chat" htmlFor={`wc-domains-${clientId}`} hint="One per line, e.g. example.com. Covers www. and other subdomains. Leave empty to allow any website.">
            <Textarea id={`wc-domains-${clientId}`} rows={3} value={domains} onChange={(e) => setDomains(e.target.value)} disabled={!editable} placeholder="example.com.au" className="text-[13px]" />
          </Field>
          <Field label="First message (optional)" htmlFor={`wc-greeting-${clientId}`} hint={`Left empty it says: "${state.defaultGreeting}"`}>
            <Input id={`wc-greeting-${clientId}`} value={greeting} onChange={(e) => setGreeting(e.target.value)} disabled={!editable} maxLength={300} className="h-9 text-[13px]" />
          </Field>
        </div>
        {editable && dirty ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate({ domains, greeting })} disabled={save.isPending} data-action="save-website-chat">
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setDomains(state.domains.join("\n")); setGreeting(state.greeting); }}>Discard</Button>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <div className="text-[12.5px] font-medium text-ink">Snippet</div>
          <p className="text-[12px] text-ink-muted">Paste this just before the closing &lt;/body&gt; tag of the website.</p>
          <div className="flex items-start gap-2">
            <pre className={cn("min-w-0 flex-1 overflow-x-auto rounded-[6px] border border-hairline bg-canvas-2 px-3 py-2 text-[12px] text-ink", !state.keyConfigured && "opacity-50")} data-snippet>{state.snippet}</pre>
            <div className="flex shrink-0 flex-col gap-1.5">
              <Button size="sm" variant="outline" className="h-8" onClick={copy} disabled={!state.keyConfigured} data-action="copy-snippet">
                {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
              </Button>
              <Button size="sm" variant="outline" className="h-8" onClick={preview} disabled={!state.keyConfigured || !state.enabled} data-action="preview-website-chat" title={state.enabled ? "" : "Switch the chat on first"}>
                Preview
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-2 border-t border-hairline pt-3">
          <div className="flex items-center justify-between">
            <div className="text-[12.5px] font-medium text-ink">Website chats</div>
            <span className="text-[12px] text-ink-muted">{state.chats} so far</span>
          </div>
          {chats.isPending ? (
            <p className="text-[12.5px] text-ink-muted">Loading…</p>
          ) : chats.error ? (
            <p className="text-[12.5px] text-ink-muted">Couldn't load the chats.</p>
          ) : chats.data.length === 0 ? (
            <EmptyState compact title="No chats yet" description="Conversations visitors have on the website show up here." />
          ) : (
            <ul className="divide-y divide-hairline rounded-[6px] border border-hairline" data-list="website-chats">
              {chats.data.map((c) => (
                <ChatRow key={c.id} chat={c} onOpen={() => setOpen(c.id)} />
              ))}
            </ul>
          )}
        </div>
      </div>
      <TranscriptSheet clientId={clientId} chatId={open} onClose={() => setOpen(null)} state={state} />
    </Panel>
  );
}

function ChatRow({ chat, onOpen }: { chat: WebchatChat; onOpen: () => void }) {
  const o = chat.outcome ? OUTCOME[chat.outcome] : null;
  return (
    <li>
      <button type="button" onClick={onOpen} className="row-hover flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12.5px]" data-chat={chat.id}>
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{chat.visitorName || chat.preview || "Visitor"}</div>
          <div className="truncate text-[11.5px] text-ink-muted">
            {fmtRelative(chat.lastMessageAt)} · {chat.messageCount} messages{chat.origin ? ` · ${chat.origin}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusBadge tone="muted">Chat</StatusBadge>
          {o ? <StatusBadge tone={o.tone}>{o.label}</StatusBadge> : null}
        </div>
      </button>
    </li>
  );
}

function TranscriptSheet({ clientId, chatId, onClose, state }: { clientId: string; chatId: string | null; onClose: () => void; state: WebchatState }) {
  const q = useQuery({ queryKey: [...webchatKey(clientId), "chat", chatId], queryFn: () => webchatApi.transcript(clientId, chatId!), enabled: Boolean(chatId) });
  const chat = q.data?.chat;
  return (
    <Sheet open={Boolean(chatId)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{chat?.visitorName || "Website chat"}</SheetTitle>
          <SheetDescription>{chat ? `${fmtDateTime(chat.startedAt)}${chat.origin ? ` · ${chat.origin}` : ""}` : "Loading…"}</SheetDescription>
        </SheetHeader>
        {q.error ? <p className="mt-4 text-[13px] text-ink-muted">{(q.error as Error).message}</p> : null}
        <ol className="mt-4 space-y-2" data-testid="website-chat-transcript">
          {state.defaultGreeting && q.data ? <Bubble who="assistant" text={state.greeting || state.defaultGreeting} /> : null}
          {(q.data?.lines ?? []).map((l, i) =>
            l.role === "event" ? (
              <li key={i} className="py-0.5 text-center text-[11.5px] text-ink-muted">{l.text}</li>
            ) : (
              <Bubble key={i} who={l.role} text={l.text} />
            ),
          )}
        </ol>
      </SheetContent>
    </Sheet>
  );
}

function Bubble({ who, text }: { who: "user" | "assistant"; text: string }) {
  const ai = who === "assistant";
  return (
    <li className={cn("flex", ai ? "justify-start" : "justify-end")}>
      <div className={cn("max-w-[85%] whitespace-pre-wrap break-words rounded-[10px] px-3 py-2 text-[13px]", ai ? "bg-canvas-2 text-ink" : "bg-indigo text-white")}>
        <div className="mb-0.5 text-[10.5px] font-medium opacity-70">{ai ? "Receptionist" : "Visitor"}</div>
        {text}
      </div>
    </li>
  );
}
