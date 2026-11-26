import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowUp, Check, Copy, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { PRODUCT } from "@/lib/app/product";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";

// "Ask for help": an AI assistant for agency owners and admins on the console. A
// floating button and a slide-over chat that streams answers from POST /api/assistant
// (server/assistant.ts). It is only mounted where the server says it is on
// (session.assistant), so with no OPENROUTER_API_KEY there is no button at all.

export type AssistantApi = { open: () => void; toggle: () => void; isOpen: boolean };
const Ctx = createContext<AssistantApi | null>(null);
/** Null where the assistant is off (no key, or not an agency owner or admin). */
export const useAssistant = () => useContext(Ctx);

type Msg = { id: string; role: "user" | "assistant"; content: string; error?: string };

export const STARTERS = [
  "How do I make my first receptionist?",
  "How do I give a client their own login?",
  "Why isn't my receptionist transferring calls?",
  "How do I connect a phone number?",
];

const MAX_CHARS = 2000;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const storeKey = (userId: string) => `assistant:v1:${userId}`;

function load(userId: string): Msg[] {
  try {
    const raw = window.sessionStorage.getItem(storeKey(userId));
    const list = raw ? (JSON.parse(raw) as Msg[]) : [];
    return Array.isArray(list) ? list.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-20) : [];
  } catch {
    return [];
  }
}
function save(userId: string, msgs: Msg[]) {
  try {
    window.sessionStorage.setItem(storeKey(userId), JSON.stringify(msgs.filter((m) => !m.error || m.content).slice(-20)));
  } catch {
    /* private window: the chat just starts fresh next time */
  }
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function AssistantProvider({ enabled, userId, children }: { enabled: boolean; userId: string; children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const api = useMemo<AssistantApi>(() => ({ open: () => setOpen(true), toggle: () => setOpen((o) => !o), isOpen }), [isOpen]);

  // ⌘/ or Ctrl+/ toggles it anywhere; "?" opens it when you're not typing in a field.
  useEffect(() => {
    if (!enabled) return;
    const on = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === "/") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [enabled]);

  if (!enabled) return <Ctx.Provider value={null}>{children}</Ctx.Provider>;
  return (
    <Ctx.Provider value={api}>
      {children}
      <AssistantPanel userId={userId} open={isOpen} onOpenChange={setOpen} />
    </Ctx.Provider>
  );
}

function AssistantPanel({ userId, open, onOpenChange }: { userId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const route = useRouterState({
    select: (s) => {
      const tab = /(?:^|[?&])tab=([a-z]+)/.exec(s.location.searchStr ?? "")?.[1];
      return s.location.pathname + (tab ? `?tab=${tab}` : "");
    },
  });
  const [msgs, setMsgs] = useState<Msg[]>(() => load(userId));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;

  useEffect(() => {
    if (!busy) save(userId, msgs);
  }, [msgs, busy, userId]);

  // Focus the box when it opens; Esc closes.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => input.current?.focus(), 220);
    const on = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", on);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", on);
    };
  }, [open, onOpenChange]);

  // Keep the newest words in view while the answer streams, unless the person scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [msgs, open]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft, open]);

  useEffect(() => () => abort.current?.abort(), []);

  const go = useCallback(
    (href: string) => {
      router.history.push(href);
      if (window.matchMedia("(max-width: 1023px)").matches) onOpenChange(false);
    },
    [router, onOpenChange],
  );

  const ask = useCallback(
    async (history: Msg[]) => {
      const reply: Msg = { id: uid(), role: "assistant", content: "" };
      setMsgs([...history, reply]);
      setBusy(true);
      pinned.current = true;
      const ctrl = new AbortController();
      abort.current = ctrl;
      let text = "";
      let frame = 0;
      const patch = (p: Partial<Msg>) => setMsgs((cur) => cur.map((m) => (m.id === reply.id ? { ...m, ...p } : m)));
      const flush = () => {
        frame = 0;
        patch({ content: text });
      };
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          signal: ctrl.signal,
          body: JSON.stringify({ route, messages: history.map(({ role, content }) => ({ role, content })) }),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || "The assistant isn't available right now.");
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const obj = JSON.parse(data);
              if (obj.error) throw new Error(obj.error);
              if (typeof obj.t === "string") {
                text += obj.t;
                if (!frame) frame = window.requestAnimationFrame(flush);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
        if (frame) window.cancelAnimationFrame(frame);
        patch({ content: text });
      } catch (e) {
        if (frame) window.cancelAnimationFrame(frame);
        if ((e as Error).name === "AbortError") patch({ content: text });
        else patch({ content: text, error: (e as Error).message || "Something went wrong." });
      } finally {
        abort.current = null;
        setBusy(false);
      }
    },
    [route],
  );

  const send = useCallback(
    (text: string) => {
      const q = text.trim().slice(0, MAX_CHARS);
      if (!q || busy) return;
      setDraft("");
      void ask([...msgsRef.current.filter((m) => m.content), { id: uid(), role: "user", content: q }]);
    },
    [ask, busy],
  );

  const retry = useCallback(() => {
    const cur = msgsRef.current;
    const lastUser = [...cur].reverse().findIndex((m) => m.role === "user");
    if (lastUser < 0 || busy) return;
    void ask(cur.slice(0, cur.length - lastUser));
  }, [ask, busy]);

  const clear = () => {
    abort.current?.abort();
    setMsgs([]);
    setDraft("");
    input.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  const empty = msgs.length === 0;
  const lastId = msgs[msgs.length - 1]?.id;

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        data-assistant-button
        aria-label="Ask for help"
        aria-keyshortcuts="Control+/ Meta+/"
        title="Ask for help (Ctrl or ⌘ + /)"
        className={cn(
          "fixed bottom-4 right-4 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-indigo pl-3.5 pr-4 text-[13px] font-semibold text-white shadow-[0_6px_20px_-4px_color-mix(in_srgb,var(--indigo)_55%,transparent),0_2px_6px_rgba(15,23,42,0.18)] transition duration-200 hover:bg-indigo-deep hover:shadow-[0_8px_24px_-4px_color-mix(in_srgb,var(--indigo)_60%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo sm:bottom-6 sm:right-6",
          open && "pointer-events-none translate-y-2 opacity-0",
        )}
        tabIndex={open ? -1 : 0}
      >
        <Sparkles className="h-4 w-4" aria-hidden /> Ask for help
      </button>

      <aside
        role="dialog"
        aria-label={`${PRODUCT} help`}
        aria-hidden={!open}
        data-assistant-panel
        data-open={open}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col border-l border-hairline bg-white shadow-[-12px_0_40px_-12px_rgba(15,23,42,0.25)] transition-[transform,visibility] duration-300 ease-out sm:w-[440px]",
          open ? "visible translate-x-0" : "invisible translate-x-full",
        )}
      >
        <header className="relative flex items-center gap-3 border-b border-hairline bg-[linear-gradient(135deg,color-mix(in_srgb,var(--indigo)_10%,#fff),#fff_70%)] px-4 py-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo text-white shadow-sm" aria-hidden>
            <Sparkles className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[14.5px] font-semibold leading-tight tracking-[-0.01em] text-ink">{PRODUCT} help</h2>
            <p className="truncate text-[12px] text-ink-muted">AI assistant · knows your dashboard</p>
          </div>
          {!empty ? (
            <button type="button" onClick={clear} data-assistant-clear title="Clear chat" aria-label="Clear chat" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-ink-muted hover:bg-canvas-2 hover:text-ink">
              <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Clear</span>
            </button>
          ) : null}
          <button type="button" onClick={() => onOpenChange(false)} title="Close (Esc)" aria-label="Close help" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-canvas-2 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-4"
          aria-live="polite"
        >
          {empty ? (
            <div className="flex min-h-full flex-col justify-center pb-6" data-assistant-empty>
              <h3 className="text-[20px] font-semibold leading-snug tracking-[-0.02em] text-ink">How can I help?</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
                Ask me anything about setting up {PRODUCT}. I can see how far along your agency is, so I can point you to the next step.
              </p>
              <div className="mt-5 grid gap-2" role="list">
                {STARTERS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    role="listitem"
                    onClick={() => send(q)}
                    data-assistant-starter
                    className="group flex items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-3.5 py-2.5 text-left text-[13.5px] font-medium text-ink transition hover:border-indigo hover:bg-[color-mix(in_srgb,var(--indigo)_5%,#fff)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo"
                  >
                    {q}
                    <ArrowUp className="h-3.5 w-3.5 shrink-0 rotate-45 text-ink-muted transition group-hover:text-indigo" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ol className="space-y-5">
              {msgs.map((m) => (
                <li key={m.id} data-assistant-msg={m.role}>
                  {m.role === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-indigo px-3.5 py-2 text-[13.5px] leading-[1.5] text-white">{m.content}</div>
                    </div>
                  ) : (
                    <Answer msg={m} streaming={busy && m.id === lastId} onLink={go} onRetry={retry} />
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer className="border-t border-hairline bg-white px-3 pb-3 pt-2.5">
          <div className="flex items-end gap-2 rounded-2xl border border-hairline bg-canvas-2/60 p-1.5 transition focus-within:border-indigo focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo/20">
            <textarea
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={onKey}
              rows={1}
              placeholder="Ask a question…"
              aria-label="Your question"
              data-assistant-input
              className="max-h-[140px] min-h-[36px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[13.5px] leading-[1.4] text-ink outline-none placeholder:text-ink-muted/70"
            />
            {busy ? (
              <button type="button" onClick={() => abort.current?.abort()} aria-label="Stop" title="Stop" data-assistant-stop className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink text-white hover:opacity-90">
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => send(draft)}
                disabled={!draft.trim()}
                aria-label="Send"
                title="Send (Enter)"
                data-assistant-send
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo text-white transition hover:bg-indigo-deep disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-2 px-1 text-center text-[11px] text-ink-muted">AI can make mistakes. Check anything important. Press Ctrl or ⌘ + / to open or close.</p>
        </footer>
      </aside>
    </>
  );
}

function Answer({ msg, streaming, onLink, onRetry }: { msg: Msg; streaming: boolean; onLink: (href: string) => void; onRetry: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = msg.content;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing more to try */
      }
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="group flex gap-2.5">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--indigo)_12%,#fff)] text-indigo" aria-hidden>
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        {msg.content ? (
          <Markdown text={msg.content} onLink={onLink} />
        ) : streaming && !msg.error ? (
          <div className="flex h-6 items-center gap-1" role="status" aria-label="Thinking">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted/60" style={{ animationDelay: `${i * 140}ms` }} />
            ))}
          </div>
        ) : null}
        {msg.error ? (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-[#ffcfcb] bg-[#fff1f0] px-3 py-2 text-[12.5px] text-[#a3231b]" role="alert">
            <span>{msg.error}</span>
            <button type="button" onClick={onRetry} className="shrink-0 font-semibold underline underline-offset-2">
              Try again
            </button>
          </div>
        ) : null}
        {msg.content && !streaming ? (
          <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <button type="button" onClick={copy} data-assistant-copy aria-label="Copy answer" className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-ink-muted hover:bg-canvas-2 hover:text-ink">
              {copied ? <Check className="h-3.5 w-3.5 text-[#0e9f6e]" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
