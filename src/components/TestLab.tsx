import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api";
import type { EmailPreview } from "../lib/shared";

const TABS = ["Call", "Text", "Email"] as const;
type Tab = (typeof TABS)[number];

// One place to try the receptionist on every channel. Call uses the real
// Telnyx widget; Text and Email are simulators that never send anything.
export default function TestLab({
  clientId,
  name,
  call,
  onTexted,
}: {
  clientId: string;
  name: string;
  call: ReactNode;
  onTexted: () => void;
}) {
  const [tab, setTab] = useState<Tab>("Call");

  return (
    <section className="card card-accent">
      <h2>Test {name}</h2>
      <div className="segmented segmented-3" role="tablist" aria-label="Test by">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {/* Kept mounted so switching tabs doesn't drop a live call or a text thread. */}
      <div hidden={tab !== "Call"} className="stack">
        <p className="muted">
          Call it from your browser to test it or demo it to the client. Allow the microphone when your browser asks.
        </p>
        {call}
        <p className="hint">Test calls are billed per minute, the same as real calls.</p>
      </div>
      <div hidden={tab !== "Text"}>
        <TextSim clientId={clientId} onTexted={onTexted} />
      </div>
      <div hidden={tab !== "Email"}>
        <EmailSim clientId={clientId} />
      </div>
    </section>
  );
}

type Bubble = { from: "me" | "them"; text: string };

function TextSim({ clientId, onTexted }: { clientId: string; onTexted: () => void }) {
  const [conversationId, setConversationId] = useState("");
  const [thread, setThread] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [thread, sending]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setError("");
    setSending(true);
    setDraft("");
    setThread((t) => [...t, { from: "me", text }]);
    try {
      let id = conversationId;
      if (!id) {
        id = (await api.startTextSim(clientId)).conversationId;
        setConversationId(id);
      }
      const { reply } = await api.sendSimText(clientId, id, text);
      setThread((t) => [...t, { from: "them", text: reply || "(no reply)" }]);
      onTexted();
    } catch (err) {
      setError((err as Error).message);
      // Put the message back so it can be resent.
      setThread((t) => t.slice(0, -1));
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  function restart() {
    setConversationId("");
    setThread([]);
    setError("");
  }

  return (
    <div className="stack">
      <p className="muted">
        Text it like a customer would. It replies exactly as it would to a real text, but nothing is sent to a phone.
      </p>
      <div className="sms" aria-live="polite">
        {thread.length === 0 && <p className="sms-empty">Try “Can I book in for Thursday arvo?”</p>}
        {thread.map((b, i) => (
          <p key={i} className={`sms-bubble sms-${b.from}`}>
            {b.text}
          </p>
        ))}
        {sending && <p className="sms-bubble sms-them sms-typing">…</p>}
        <div ref={end} />
      </div>
      <form className="sms-compose" onSubmit={send}>
        <input
          type="text"
          aria-label="Your text"
          placeholder="Type a text…"
          value={draft}
          maxLength={1000}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !draft.trim()}>
          Send
        </button>
      </form>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      <div className="sms-foot">
        <span className="hint">Costs a fraction of a cent per reply. Threads also show under recent calls and texts.</span>
        {thread.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={restart} disabled={sending}>
            New conversation
          </button>
        )}
      </div>
    </div>
  );
}

const EXAMPLES: { label: string; fromName: string; fromAddress: string; subject: string; body: string }[] = [
  {
    label: "Booking request",
    fromName: "Priya Shah",
    fromAddress: "priya.shah@example.com",
    subject: "Appointment next week",
    body: "Hi there,\n\nCould I book something for early next week? Mornings are best for me.\n\nThanks,\nPriya",
  },
  {
    label: "Price question",
    fromName: "Tom Nguyen",
    fromAddress: "tom.nguyen@example.com",
    subject: "How much?",
    body: "Hey, how much do you charge and do you take new customers? Cheers, Tom",
  },
  {
    label: "Sales spam",
    fromName: "Growth Agency",
    fromAddress: "hello@growth-agency.example",
    subject: "Get 50 new customers this month",
    body: "We help local businesses rank #1 on Google. Reply to book a free 15-minute strategy call.",
  },
];

function EmailSim({ clientId }: { clientId: string }) {
  const [fromName, setFromName] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<EmailPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function fill(ex: (typeof EXAMPLES)[number]) {
    setFromName(ex.fromName);
    setFromAddress(ex.fromAddress);
    setSubject(ex.subject);
    setBody(ex.body);
    setResult(null);
    setError("");
  }

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await api.previewEmail(clientId, { fromName, fromAddress, subject, body }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        Write an email as if a customer sent it to the business. You'll see the reply it would save to their Drafts,
        or why it would leave the email alone. Nothing is sent.
      </p>
      <div className="chips">
        {EXAMPLES.map((ex) => (
          <button key={ex.label} type="button" className="example-chip" onClick={() => fill(ex)}>
            {ex.label}
          </button>
        ))}
      </div>
      <form className="stack" onSubmit={run}>
        <div className="field-row">
          <label className="field">
            <span>From name</span>
            <input type="text" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Priya Shah" />
          </label>
          <label className="field">
            <span>From address</span>
            <input type="email" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="customer@example.com" />
          </label>
        </div>
        <label className="field">
          <span>Subject</span>
          <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="field">
          <span>Email</span>
          <textarea rows={5} required value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>
            {busy ? "Reading it…" : "See what it would do"}
          </button>
        </div>
      </form>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {result && !result.reply && (
        <div className="notice notice-wait" role="status">
          It would leave this one alone. {result.reason}
        </div>
      )}
      {result?.reply && (
        <div className="email-preview">
          <p className="turn-who">Draft reply it would save</p>
          <pre>{result.body}</pre>
        </div>
      )}
    </div>
  );
}
