import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import type { EmailMode, EmailStatus } from "../lib/shared";

// A private link for the business owner to connect their own mailbox.
function ConnectLink({ clientId, businessName }: { clientId: string; businessName: string }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function make() {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      setLink(await api.connectLink(clientId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  const localOnly = /^http:\/\/(127\.0\.0\.1|localhost)/.test(link?.url ?? "");
  return (
    <div className="connect-link stack">
      <p className="muted">
        Send {businessName} a private link. They open it, follow the steps for their email provider, and connect it
        themselves. They choose whether replies are saved as drafts or sent for them. They never see this dashboard.
      </p>
      {!link && (
        <div>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={make}>
            {busy ? "Making link…" : "Make a connect link"}
          </button>
        </div>
      )}
      {link && (
        <>
          <div className="link-box">
            <input type="text" readOnly value={link.url} aria-label="Connect link" onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="hint">
            Works until {new Date(link.expiresAt).toLocaleDateString("en-AU", { day: "numeric", month: "long" })}. Making a
            new link stops this one working.
            {localOnly &&
              " This link only opens on this computer, because the dashboard isn't online yet. Run bun run tunnel (or host the dashboard) and make a new link to send it to them."}
          </p>
        </>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function ago(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return new Date(t).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

const LABEL = { drafted: "Reply drafted", sent: "Reply sent", skipped: "No reply needed", failed: "Couldn't reply" } as const;

export default function EmailCard({ clientId, businessName }: { clientId: string; businessName: string }) {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "connect" | "check" | "disconnect">("");
  const [open, setOpen] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState<EmailMode>("draft");

  const load = useCallback(() => {
    api
      .email(clientId)
      .then(setStatus)
      .catch((err: Error) => setError(err.message));
  }, [clientId]);

  useEffect(load, [load]);

  // The server checks each mailbox once a minute; keep this card in step with it.
  useEffect(() => {
    if (!status?.connected) return;
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [status?.connected, load]);

  async function run(kind: "connect" | "check" | "disconnect", action: () => Promise<EmailStatus>) {
    setBusy(kind);
    setError("");
    try {
      setStatus(await action());
      if (kind === "connect") setPassword("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  function connect(event: FormEvent) {
    event.preventDefault();
    run("connect", () =>
      api.connectEmail(clientId, {
        address,
        password,
        host: host.trim() || undefined,
        port: Number(port) || 993,
        username: username.trim() || undefined,
        mode,
      }),
    );
  }

  function disconnect() {
    if (!window.confirm(`Stop reading ${status?.address}? Drafts already in the mailbox stay there.`)) return;
    run("disconnect", () => api.disconnectEmail(clientId));
  }

  return (
    <section className="card">
      <h2>Email</h2>

      {status === null && !error && <p className="muted">Loading…</p>}

      {status && !status.connected && (
        <>
          <p className="muted email-intro">
            The receptionist answers {businessName}'s email enquiries from their own inbox, using their hours, services
            and, when a calendar is connected, real free times.
          </p>
          <ConnectLink clientId={clientId} businessName={businessName} />
          <details className="advanced">
            <summary>Or connect it here yourself</summary>
          <form onSubmit={connect} className="stack email-form">
            <label className="field">
              <span>Their email address</span>
              <input
                type="email"
                required
                autoComplete="off"
                placeholder="reception@theirbusiness.com.au"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <label className="field">
              <span>App password</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <span className="hint">
                Not their normal password. In Gmail or Google Workspace: Google Account, Security, 2-Step Verification,
                App passwords. Some Microsoft 365 work accounts have app passwords switched off by their admin.
              </span>
            </label>
            <details className="advanced">
              <summary>Server settings</summary>
              <p className="hint">Leave these blank for Gmail, Google Workspace and Outlook. They are worked out from the address.</p>
              <div className="row-2">
                <label className="field">
                  <span>Mail server (IMAP)</span>
                  <input type="text" placeholder="imap.theirhost.com.au" value={host} onChange={(e) => setHost(e.target.value)} />
                </label>
                <label className="field">
                  <span>Port</span>
                  <input type="text" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
                </label>
              </div>
              <label className="field">
                <span>
                  Login name <em>if different from the address</em>
                </span>
                <input type="text" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
              </label>
            </details>
            <label className="field">
              <span>When a reply is ready</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as EmailMode)}>
                <option value="draft">Save it as a draft for them to check and send</option>
                <option value="send">Send it for them</option>
              </select>
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy !== ""}>
              {busy === "connect" ? "Connecting…" : "Connect email"}
            </button>
          </form>
          </details>
        </>
      )}

      {status?.connected && (
        <>
          <div className="email-head">
            <div>
              <p className="email-address">{status.address}</p>
              <p className="hint">
                {status.lastCheckedAt ? `Checked ${ago(status.lastCheckedAt)}. ` : "First check is under way. "}
                Checks every minute and only looks at mail that arrived after it was connected.
              </p>
            </div>
            <span className={`pill ${status.lastError ? "" : "pill-on"}`}>
              {status.lastError ? "Not reading" : status.mode === "send" ? "Sending replies" : "Drafting replies"}
            </span>
          </div>

          {status.lastError && (
            <div className="notice notice-error" role="alert">
              {status.lastError}
            </div>
          )}

          {status.activity.length === 0 ? (
            <p className="muted">No new emails yet. When one arrives, it shows here with the reply it wrote.</p>
          ) : (
            <ul className="calls">
              {status.activity.map((a) => (
                <li key={a.id}>
                  <button type="button" className="email-row" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>
                    <span className="email-subject">{a.subject}</span>
                    <span className="email-from">{a.from}</span>
                    <span className={`pill ${a.action === "drafted" || a.action === "sent" ? "pill-on" : ""}`}>{LABEL[a.action]}</span>
                  </button>
                  {open === a.id && (
                    <div className="transcript">
                      <p className="hint">
                        Received {ago(a.receivedAt)}. {a.note}
                      </p>
                      {a.draft && <p className="email-draft">{a.draft}</p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="email-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== ""} onClick={() => run("check", () => api.checkEmail(clientId))}>
              {busy === "check" ? "Checking…" : "Check now"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== ""} onClick={disconnect}>
              Disconnect
            </button>
          </div>
        </>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
