import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Mail, MessageSquareText, RotateCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { request } from "@/lib/api/base";
import { cn } from "@/lib/utils";

// "Try it" for the message and email agents. Nothing real is sent: texts go through the same chat the
// receptionist uses on a real number, and the email is run through the same drafting step as a connected inbox
// (server/simulator.ts: POST /api/clients/<id>/simulator/texts, .../texts/send, .../simulator/email).

type Line = { who: "you" | "agent"; text: string };

export function TryMessages({ clientId, name }: { clientId: string; name: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [convo, setConvo] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [lines]);
  const send = useMutation({
    mutationFn: async (t: string) => {
      let id = convo;
      if (!id) {
        id = (await request<{ conversationId: string }>("POST", `/api/clients/${clientId}/simulator/texts`, {})).conversationId;
        setConvo(id);
      }
      return (await request<{ reply: string }>("POST", `/api/clients/${clientId}/simulator/texts/send`, { conversationId: id, text: t })).reply;
    },
    onSuccess: (reply) => setLines((l) => [...l, { who: "agent", text: reply || "(no reply)" }]),
    onError: (e: Error) => setLines((l) => [...l, { who: "agent", text: `Couldn't try it: ${e.message}` }]),
  });
  const go = () => {
    const t = text.trim();
    if (!t || send.isPending) return;
    setLines((l) => [...l, { who: "you", text: t }]);
    setText("");
    send.mutate(t);
  };
  return (
    <Panel
      title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[var(--primary-ink)]" /> Try it</span>}
      description={`Text ${name} like a customer would.`}
      actions={lines.length ? <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => { setLines([]); setConvo(null); }}><RotateCcw className="mr-1 h-3 w-3" /> Start over</Button> : null}
    >
      <div data-try="messages" className="mx-auto flex max-w-md flex-col gap-3">
        <div className="flex min-h-[180px] max-h-[320px] flex-col gap-2 overflow-y-auto rounded-[14px] bg-canvas-2 p-3">
          {lines.length === 0 ? (
            <div className="m-auto text-center text-[12.5px] text-ink-muted"><MessageSquareText className="mx-auto mb-1.5 h-5 w-5 opacity-60" />Say hi to start.</div>
          ) : lines.map((l, i) => (
            <div key={i} className={cn("max-w-[85%] rounded-[14px] px-3 py-2 text-[13px] leading-5", l.who === "you" ? "self-end bg-[var(--indigo)] text-white" : "self-start bg-[var(--card)] text-ink shadow-sm")}>{l.text}</div>
          ))}
          {send.isPending ? <div className="self-start rounded-[14px] bg-[var(--card)] px-3 py-2 text-ink-muted shadow-sm"><Loader2 className="h-4 w-4 animate-spin" /></div> : null}
          <div ref={end} />
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" maxLength={1000} aria-label="Message" />
          <Button type="submit" size="icon" disabled={!text.trim() || send.isPending} aria-label="Send"><Send className="h-4 w-4" /></Button>
        </form>
      </div>
    </Panel>
  );
}

type EmailResult = { reply: boolean; reason: string; body: string };

const SAMPLE = { fromName: "Sam Taylor", fromAddress: "sam@example.com", subject: "Do you have a time this week?", body: "Hi, I'd like to book an appointment this week if you have anything free. Thanks, Sam" };

export function TryEmail({ clientId, mode, connected }: { clientId: string; mode: "draft" | "send" | null; connected: boolean }) {
  const [mail, setMail] = useState(SAMPLE);
  const set = (p: Partial<typeof SAMPLE>) => setMail((m) => ({ ...m, ...p }));
  const run = useMutation({ mutationFn: () => request<EmailResult>("POST", `/api/clients/${clientId}/simulator/email`, mail) });
  const r = run.data;
  const sends = mode === "send";
  return (
    <Panel title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[var(--primary-ink)]" /> Try it</span>} description="Paste an email. See what the agent would do with it.">
      <div data-try="email" className="grid gap-4 lg:grid-cols-2">
        <form className="grid gap-2.5" onSubmit={(e) => { e.preventDefault(); if (mail.body.trim()) run.mutate(); }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={mail.fromName} onChange={(e) => set({ fromName: e.target.value })} placeholder="From (name)" aria-label="From name" maxLength={80} />
            <Input value={mail.fromAddress} onChange={(e) => set({ fromAddress: e.target.value })} placeholder="From (email)" aria-label="From email" maxLength={200} />
          </div>
          <Input value={mail.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="Subject" aria-label="Subject" maxLength={200} />
          <Textarea value={mail.body} onChange={(e) => set({ body: e.target.value })} rows={6} placeholder="Paste the email here" aria-label="Email" maxLength={4000} />
          <Button type="submit" size="sm" className="justify-self-start" disabled={run.isPending || !mail.body.trim()}>{run.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Mail className="mr-1.5 h-4 w-4" />} See what it does</Button>
        </form>
        <div className="min-h-[160px] rounded-[12px] bg-canvas-2 p-3 text-[13px]">
          {run.isPending ? <p className="text-ink-muted">Reading it…</p> : run.error ? <p className="text-[#a41d1d] dark:text-[#ff9d8a]">{(run.error as Error).message}</p> : !r ? <p className="text-ink-muted">The answer shows here.</p> : (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge tone={r.reply ? "success" : "muted"} dot>{r.reply ? "It would reply" : "It would leave it"}</StatusBadge>
                {r.reply ? <StatusBadge tone={sends ? "warning" : "muted"}>{!connected ? "Draft, waits for you (no inbox yet)" : sends ? "Sends by itself" : "Draft, waits for you"}</StatusBadge> : null}
              </div>
              {r.reason ? <p className="text-[12.5px] text-ink-muted">{r.reason}</p> : null}
              {r.reply ? <div className="whitespace-pre-wrap rounded-[10px] bg-[var(--card)] p-3 text-ink shadow-sm">{r.body}</div> : null}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
