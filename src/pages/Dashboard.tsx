import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BusinessFields, HoursFields, NotesField, ServicesFields, VoiceFields } from "../components/fields";
import BookingCard from "../components/BookingCard";
import EmailCard from "../components/EmailCard";
import PhoneNumberCard from "../components/PhoneNumberCard";
import TestLab from "../components/TestLab";
import TextingCard from "../components/TextingCard";
import { api } from "../lib/api";
import {
  describeHours,
  formatNumber,
  industry,
  type Business,
  type CallMessage,
  type CallSummary,
  type Settings,
  type Voice,
} from "../lib/shared";

type Props = { business: Business; onChange: (b: Business) => void; onDeleted: () => void };
type CallDetail = { summary: string; messages: CallMessage[] };

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function TestCall({ assistantId, onEnded }: { assistantId: string; onEnded: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let cancelled = false;
    // Registers the <telnyx-ai-agent> element. Loaded here so the landing page stays light.
    // @ts-expect-error the widget ships without type definitions
    import("@telnyx/ai-agent-widget")
      .then(() => !cancelled && setReady(true))
      .catch(() => !cancelled && setFailed("The call widget didn't load. Refresh the page to try again."));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = holder.current?.querySelector("telnyx-ai-agent");
    if (!el) return;
    const ended = () => onEnded();
    const errored = (e: Event) => setFailed((e as CustomEvent).detail?.message ?? "The call ran into a problem.");
    el.addEventListener("agent.disconnected", ended);
    el.addEventListener("agent.error", errored);

    // The widget always floats in the bottom-right corner of the window. Pin it
    // inside this card instead. If a later widget version changes its markup,
    // this stops applying and the button simply floats again.
    let tries = 0;
    const pin = window.setInterval(() => {
      const root = el.shadowRoot;
      if (root && !root.querySelector("style[data-twin-inline]")) {
        const style = document.createElement("style");
        style.setAttribute("data-twin-inline", "");
        style.textContent =
          "main{position:static!important;inset:auto!important;pointer-events:auto!important}" +
          "main>div{position:static!important}";
        root.appendChild(style);
      }
      if (root || ++tries > 40) window.clearInterval(pin);
    }, 100);

    return () => {
      window.clearInterval(pin);
      el.removeEventListener("agent.disconnected", ended);
      el.removeEventListener("agent.error", errored);
    };
  }, [ready, onEnded]);

  return (
    <div className="testcall" ref={holder}>
      {!ready && !failed && <p className="muted">Loading the call button…</p>}
      {ready && createElement("telnyx-ai-agent", { "agent-id": assistantId })}
      {failed && (
        <div className="notice notice-error" role="alert">
          {failed}
        </div>
      )}
    </div>
  );
}

function Calls({ clientId, refreshKey }: { clientId: string; refreshKey: number }) {
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, CallDetail | "loading" | "error">>({});

  const load = useCallback(() => {
    setError("");
    api
      .calls(clientId)
      .then(setCalls)
      .catch((err: Error) => setError(err.message));
  }, [clientId]);

  useEffect(load, [load, refreshKey]);

  function toggle(id: string) {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (transcripts[id] && transcripts[id] !== "error") return;
    setTranscripts((t) => ({ ...t, [id]: "loading" }));
    api
      .call(clientId, id)
      .then((detail) => setTranscripts((t) => ({ ...t, [id]: detail })))
      .catch(() => setTranscripts((t) => ({ ...t, [id]: "error" })));
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Recent calls and texts</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
          Refresh
        </button>
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {!error && calls === null && <p className="muted">Loading…</p>}
      {calls?.length === 0 && (
        <p className="muted">No calls yet. Make a test call above and it will show up here with its transcript.</p>
      )}
      {calls && calls.length > 0 && (
        <ul className="calls">
          {calls.map((c) => {
            const t = transcripts[c.id];
            return (
              <li key={c.id}>
                <button type="button" className="call-row" aria-expanded={open === c.id} onClick={() => toggle(c.id)}>
                  <span className="call-when">{when(c.startedAt)}</span>
                  <span className="call-from">
                    {c.simulated
                      ? "Test texts (simulator)"
                      : c.channel === "sms_chat"
                      ? `Texts with ${c.from ? formatNumber(c.from) : "unknown number"}`
                      : c.from
                        ? formatNumber(c.from)
                        : c.channel === "web"
                          ? "Browser test call"
                          : "Phone call"}
                  </span>
                  <span className="call-chevron" aria-hidden>
                    {open === c.id ? "–" : "+"}
                  </span>
                </button>
                {open === c.id && (
                  <div className="transcript">
                    {t === "loading" && <p className="muted">Loading transcript…</p>}
                    {t === "error" && <p className="muted">Couldn't load this transcript.</p>}
                    {typeof t === "object" && t.summary && (
                      <p className="call-summary">
                        <span className="turn-who">Summary</span>
                        {t.summary}
                      </p>
                    )}
                    {typeof t === "object" && t.messages.length === 0 && (
                      <p className="muted">Nothing was said in this conversation.</p>
                    )}
                    {typeof t === "object" &&
                      t.messages.map((m, i) => (
                        <p key={i} className={`turn turn-${m.role}`}>
                          <span className="turn-who">{m.role === "assistant" ? "Receptionist" : c.channel === "sms_chat" ? "Them" : "Caller"}</span>
                          {m.text}
                        </p>
                      ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const TABS = ["Business", "Hours and services", "Voice"] as const;

function Editor({ business, onSaved, onClose }: { business: Business; onSaved: (b: Business) => void; onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Business");
  const [settings, setSettings] = useState<Settings>(business.settings);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .voices()
      .then(setVoices)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const patch = (p: Partial<Settings>) => {
    setError("");
    setSettings((s) => ({ ...s, ...p }));
  };

  async function save() {
    setSaving(true);
    setError("");
    try {
      onSaved(await api.update(business.id, settings));
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Edit receptionist">
        <div className="modal-head">
          <h2>Edit receptionist</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="modal-body">
          {tab === "Business" && <BusinessFields value={settings} onChange={patch} />}
          {tab === "Hours and services" && (
            <div className="stack">
              <HoursFields value={settings} onChange={patch} />
              <div className="field">
                <span>What callers can ask for</span>
                <ServicesFields value={settings} onChange={patch} />
              </div>
              <NotesField value={settings} onChange={patch} />
            </div>
          )}
          {tab === "Voice" && <VoiceFields value={settings} onChange={patch} voices={voices} />}
        </div>
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ business, onChange, onDeleted }: Props) {
  const s = business.settings;
  const who = s.receptionistName || "Your receptionist";
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showScript, setShowScript] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  // Telnyx takes a few seconds to file a finished call, so wait before reloading the list.
  const callEnded = useCallback(() => {
    window.setTimeout(() => setRefreshKey((k) => k + 1), 4000);
  }, []);

  async function remove() {
    const ok = window.confirm(
      `Delete the receptionist for ${s.businessName}? This removes it and its call history, and can't be undone here.`,
    );
    if (!ok) return;
    setDeleting(true);
    setError("");
    try {
      await api.remove(business.id);
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  return (
    <div className="dash">
      <Link to="/" className="back">
        ← All receptionists
      </Link>
      <div className="dash-head">
        <div>
          <p className="eyebrow">{s.businessName}</p>
          <h1>{who} is ready for a test call</h1>
        </div>
        <div className="pills">
          <span className="pill pill-on">Browser test call: on</span>
          {(business.phoneNumbers ?? []).length > 0 ? (
            <span className="pill pill-on">Phone number connected</span>
          ) : (
            <span className="pill">Phone number: not connected yet</span>
          )}
        </div>
      </div>

      {saved && (
        <div className="notice notice-ok" role="status">
          Saved. The receptionist uses the new details from its next call.
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="dash-grid">
        <div className="dash-col">
          <TestLab
            clientId={business.id}
            name={s.receptionistName || "the receptionist"}
            call={<TestCall key={business.updatedAt} assistantId={business.assistantId} onEnded={callEnded} />}
            onTexted={callEnded}
          />

          <Calls clientId={business.id} refreshKey={refreshKey} />

          <EmailCard clientId={business.id} businessName={s.businessName} />
        </div>

        <div className="dash-col">
          <section className="card">
            <div className="card-head">
              <h2>What it knows</h2>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setSaved(false); setEditing(true); }}>
                Edit
              </button>
            </div>
            <dl className="review">
              <div>
                <dt>Business</dt>
                <dd>
                  {s.businessName}
                  <span className="muted">
                    {" "}
                    · {industry(s.industry).label}
                    {s.suburb ? ` · ${s.suburb}` : ""}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Hours</dt>
                <dd>
                  {describeHours(s.hours).map((line) => (
                    <span key={line} className="line">
                      {line}
                    </span>
                  ))}
                </dd>
              </div>
              <div>
                <dt>Callers can ask for</dt>
                <dd>{s.services.join(", ")}</dd>
              </div>
              <div>
                <dt>Voice</dt>
                <dd>
                  {s.voiceName.split(" - ")[0]}
                  <span className="muted"> · {s.tone === "friendly" ? "Friendly" : "Professional"}</span>
                </dd>
              </div>
              <div>
                <dt>It answers with</dt>
                <dd className="quote">“{s.greeting}”</dd>
              </div>
            </dl>
            <button type="button" className="link" onClick={() => setShowScript(!showScript)}>
              {showScript ? "Hide the full script" : "See the full script it follows"}
            </button>
            {showScript && <pre className="script">{business.instructions
                  .replace(/\{\{telnyx_current_time[^}]*\}\}/g, "the current")
                  .replace(/\{\{telnyx_conversation_channel\}\}/g, "call or text")
                  .replace(/\{\{telnyx_end_user_target\}\}/g, "the number they texted from")}</pre>}
          </section>

          <BookingCard clientId={business.id} onChanged={() => api.client(business.id).then(onChange).catch(() => {})} />

          <PhoneNumberCard clientId={business.id} businessName={s.businessName} />

          <TextingCard clientId={business.id} businessName={s.businessName} />

          <section className="card card-quiet">
            <h2>Delete this receptionist</h2>
            <p className="muted">Removes it and its call history.</p>
            <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete receptionist"}
            </button>
          </section>
        </div>
      </div>

      {editing && (
        <Editor
          business={business}
          onClose={() => setEditing(false)}
          onSaved={(b) => {
            onChange(b);
            setEditing(false);
            setSaved(true);
          }}
        />
      )}
    </div>
  );
}
