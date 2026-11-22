import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { formatNumber, type TextingState } from "../lib/shared";

export default function TextingCard({ clientId, businessName }: { clientId: string; businessName: string }) {
  const [state, setState] = useState<TextingState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(() => {
    api
      .texting(clientId)
      .then(setState)
      .catch((err: Error) => setError(err.message));
  }, [clientId]);

  useEffect(load, [load]);

  async function run(label: string, action: () => Promise<TextingState | void>, done = "") {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const next = await action();
      if (next) setState(next);
      if (done) setNotice(done);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  function sendTest(e: FormEvent) {
    e.preventDefault();
    run("test", () => api.sendTestText(clientId, to).then(() => undefined), `Sent. Reply to it from that phone to chat with the receptionist. The conversation shows under recent calls and texts.`);
  }

  const numbers = state?.numbers ?? [];
  const waiting = state?.waiting ?? [];

  return (
    <section className="card">
      <h2>Text messages</h2>

      {state === null && !error && <p className="muted">Loading…</p>}

      {state && !state.enabled && (
        <>
          <p className="muted">Texting isn't switched on for this receptionist yet.</p>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== ""} onClick={() => run("enable", () => api.enableTexting(clientId))}>
            {busy === "enable" ? "Switching on…" : "Switch on texting"}
          </button>
        </>
      )}

      {state?.enabled && numbers.length > 0 && (
        <>
          <ul className="numbers">
            {numbers.map((n) => (
              <li key={n}>
                <span className="number">{formatNumber(n)}</span>
                <span className="pill pill-on">Answering texts</span>
              </li>
            ))}
          </ul>
          <p className="muted">
            Texts to this number get a reply from the receptionist straight away, using what it knows about {businessName}.
          </p>
        </>
      )}

      {state?.enabled && numbers.length === 0 && waiting.length === 0 && (
        <p className="muted">
          Ready to text, but it needs a mobile number first. Buy one under Phone number (choose "Mobile · calls and
          texts") and it will answer calls and texts.
        </p>
      )}

      {state?.enabled && waiting.length > 0 && (
        <ul className="number-options">
          {waiting.map((n) => (
          <li key={n}>
            <span className="number">{formatNumber(n)}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy !== ""}
              onClick={() => run(n, () => api.connectTextNumber(clientId, n), `${formatNumber(n)} now answers texts.`)}
            >
              {busy === n ? "Connecting…" : "Answer texts on this number"}
            </button>
          </li>
          ))}
        </ul>
      )}

      {numbers.length > 0 && (
        <form onSubmit={sendTest} className="stack">
          <label className="field">
            <span>Send a test text to</span>
            <input type="tel" inputMode="tel" required placeholder="0412 345 678" value={to} onChange={(e) => setTo(e.target.value)} />
            <span className="hint">Your own mobile, or the client's when you demo it. Each text costs a few cents.</span>
          </label>
          <div>
            <button type="submit" className="btn btn-secondary btn-sm" disabled={busy !== ""}>
              {busy === "test" ? "Sending…" : "Send test text"}
            </button>
          </div>
        </form>
      )}

      {notice && (
        <div className="notice notice-ok" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
