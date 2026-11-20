import { useEffect, useState, type FormEvent } from "react";
import { brand } from "../brand";
import { api } from "../lib/api";
import type { ConnectInfo, EmailMode } from "../lib/shared";

// The page a client business opens from its private link to connect its own
// mailbox. It shows nothing from the operator's dashboard.

type Provider = "google" | "microsoft" | "other";

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "google", label: "Gmail or Google Workspace" },
  { value: "microsoft", label: "Outlook or Microsoft 365" },
  { value: "other", label: "Something else" },
];

function ModeChoice({ mode, setMode, who, step }: { mode: EmailMode; setMode: (m: EmailMode) => void; who: string; step: number }) {
  return (
    <section className="card stack">
      <h2>
        {step}. What should {who} do with replies?
      </h2>
      <div className="choice-list" role="radiogroup" aria-label="Reply handling">
        <button type="button" role="radio" aria-checked={mode === "draft"} className={`choice ${mode === "draft" ? "is-on" : ""}`} onClick={() => setMode("draft")}>
          <strong>Save them as drafts</strong>
          <span>Each reply waits in your Drafts folder. You check it and press send. A good way to start.</span>
        </button>
        <button type="button" role="radio" aria-checked={mode === "send"} className={`choice ${mode === "send" ? "is-on" : ""}`} onClick={() => setMode("send")}>
          <strong>Send them for me</strong>
          <span>Enquiries get an answer straight away. Every reply is in your Sent folder.</span>
        </button>
      </div>
    </section>
  );
}

const PROMISE =
  "It only looks at emails that arrive from now on, replies to genuine enquiries, and ignores newsletters and receipts. It never deletes or moves your emails, and you can disconnect from this page at any time.";

export default function Connect({ token }: { token: string }) {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [provider, setProvider] = useState<Provider | null>(null);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState<EmailMode>("draft");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  const [calendarJustConnected, setCalendarJustConnected] = useState(false);

  // Coming back from "Sign in with Google/Microsoft".
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected")) setJustConnected(true);
    if (params.get("calendar")) setCalendarJustConnected(true);
    if (params.get("error")) setError(params.get("error")!);
    if (params.toString()) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    api
      .linkInfo(token)
      .then(setInfo)
      .catch((err: Error) => setLoadError(err.message));
  }, [token]);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const other = provider === "other";
      setInfo(
        await api.linkConnect(token, {
          address: address.trim(),
          password: password.replace(/\s+/g, provider === "google" ? "" : " ").trim(),
          host: other ? host.trim() || undefined : undefined,
          port: other ? Number(port) || 993 : undefined,
          smtpHost: other ? smtpHost.trim() || undefined : undefined,
          smtpPort: other ? Number(smtpPort) || undefined : undefined,
          username: other ? username.trim() || undefined : undefined,
          mode,
        }),
      );
      setPassword("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!info || !window.confirm(`Stop the receptionist using ${info.email.address}?`)) return;
    setBusy(true);
    setError("");
    try {
      setInfo(await api.linkDisconnect(token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const who = info?.receptionistName || "your AI receptionist";
  const signInReady = provider === "google" ? info?.signIn.google : provider === "microsoft" ? info?.signIn.microsoft : false;
  const providerName = provider === "google" ? "Google" : "Microsoft";

  return (
    <div className="app connect-page">
      <header className="app-top">
        {/* Not a link: the business has nowhere else to go in this app. */}
        <span className="wordmark" aria-label={brand.product}>
          <span className="wordmark-name">
            {brand.name}
            <span className="wordmark-dot">.</span>
          </span>
          <span className="wordmark-sub">Receptionist</span>
        </span>
      </header>
      <main className="connect-main">
        {loadError && (
          <div className="notice notice-error" role="alert">
            {error || loadError}
          </div>
        )}
        {!info && !loadError && <p className="muted">Loading…</p>}

        {info && (
          <>
            <p className="eyebrow">{info.businessName}</p>
            <h1>Connect your email</h1>
            <p className="lede">
              {info.receptionistName ? `${info.receptionistName}, your AI receptionist,` : "Your AI receptionist"} will
              answer new enquiries that arrive in your inbox, using your opening hours and services.
            </p>

            {info.email.connected ? (
              <section className="card stack">
                {justConnected && (
                  <div className="notice notice-ok" role="status">
                    Connected. You can close this page.
                  </div>
                )}
                <div className="email-head">
                  <div>
                    <p className="email-address">{info.email.address}</p>
                    <p className="hint">
                      {info.email.mode === "send"
                        ? "Replies are sent for you. You'll find them in your Sent folder."
                        : "Replies are saved in your Drafts folder. Check them and press send."}
                    </p>
                  </div>
                  <span className="pill pill-on">Connected</span>
                </div>
                <p className="muted">
                  You're all set. To change how replies are handled, disconnect and connect again.
                </p>
                <div>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={disconnect}>
                    {busy ? "Disconnecting…" : "Disconnect"}
                  </button>
                </div>
              </section>
            ) : (
              <>
                <section className="card stack">
                  <h2>1. Who looks after your email?</h2>
                  <div className="provider-grid" role="radiogroup" aria-label="Email provider">
                    {PROVIDERS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        role="radio"
                        aria-checked={provider === p.value}
                        className={`provider ${provider === p.value ? "is-on" : ""}`}
                        onClick={() => {
                          setProvider(p.value);
                          setError("");
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </section>

                {provider && signInReady && !usePassword && (
                  <>
                    <ModeChoice mode={mode} setMode={setMode} who={who} step={2} />
                    {error && (
                      <div className="notice notice-error" role="alert">
                        {error}
                      </div>
                    )}
                    <a className="btn btn-primary signin-btn" href={`/api/oauth/${provider}/start?t=${encodeURIComponent(token)}&mode=${mode}`}>
                      Sign in with {providerName}
                    </a>
                    <p className="hint">
                      {providerName} will ask you to let {who} read and send email for this address. {PROMISE}
                    </p>
                    {provider === "google" && (
                      <button type="button" className="link" onClick={() => setUsePassword(true)}>
                        Use an app password instead
                      </button>
                    )}
                  </>
                )}

                {provider === "microsoft" && !signInReady && (
                  <section className="card stack">
                    <h2>Outlook and Microsoft 365 aren't available yet</h2>
                    <p className="muted">
                      Microsoft has switched off password sign-in for email apps, so these accounts need a "Sign in with
                      Microsoft" option, which is on its way. Let {brand.company} know you use Outlook and they'll be in
                      touch.
                    </p>
                  </section>
                )}

                {((provider === "google" && (!signInReady || usePassword)) || provider === "other") && (
                  <form className="stack" onSubmit={connect}>
                    <section className="card stack">
                      <h2>2. Create an app password</h2>
                      {provider === "google" ? (
                        <ol className="steps">
                          <li>
                            Turn on{" "}
                            <a href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noreferrer">
                              2-Step Verification
                            </a>{" "}
                            for your Google account, if it isn't on already.
                          </li>
                          <li>
                            Open{" "}
                            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
                              App passwords
                            </a>
                            , type <strong>Receptionist</strong> as the name and press Create.
                          </li>
                          <li>Copy the 16-letter password Google shows you and paste it below.</li>
                        </ol>
                      ) : (
                        <p className="muted">
                          Most providers (iCloud, Yahoo, Zoho, Telstra/Bigpond) need an app password rather than your normal
                          password: look for "app passwords" in your account's security settings. Email hosted with your
                          website usually takes your normal email password.
                        </p>
                      )}
                      {provider === "google" && (
                        <p className="hint">
                          With a work Google Workspace account, if App passwords says it isn't available, your Workspace
                          admin needs to allow it.
                        </p>
                      )}
                      <label className="field">
                        <span>Your email address</span>
                        <input type="email" required autoComplete="email" value={address} onChange={(e) => setAddress(e.target.value)} />
                      </label>
                      <label className="field">
                        <span>{provider === "google" ? "App password" : "Password or app password"}</span>
                        <input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                      </label>
                      {provider === "other" && (
                        <details className="advanced">
                          <summary>Server settings (only if it can't find them)</summary>
                          <div className="field-row">
                            <label className="field">
                              <span>Incoming server (IMAP)</span>
                              <input type="text" placeholder="mail.yourbusiness.com.au" value={host} onChange={(e) => setHost(e.target.value)} />
                            </label>
                            <label className="field">
                              <span>Port</span>
                              <input type="text" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
                            </label>
                          </div>
                          <div className="field-row">
                            <label className="field">
                              <span>Outgoing server (SMTP)</span>
                              <input type="text" placeholder="mail.yourbusiness.com.au" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
                            </label>
                            <label className="field">
                              <span>Port</span>
                              <input type="text" inputMode="numeric" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
                            </label>
                          </div>
                          <label className="field">
                            <span>
                              Login name <em>if different from your address</em>
                            </span>
                            <input type="text" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
                          </label>
                        </details>
                      )}
                    </section>

                    <ModeChoice mode={mode} setMode={setMode} who={who} step={3} />

                    {error && (
                      <div className="notice notice-error" role="alert">
                        {error}
                      </div>
                    )}
                    <button type="submit" className="btn btn-primary" disabled={busy}>
                      {busy ? "Connecting…" : "Connect my email"}
                    </button>
                    <p className="hint">{PROMISE} Your password is stored encrypted.</p>
                  </form>
                )}
              </>
            )}
            {info.calendar.wanted && (
              <section className="card stack">
                <h2>Your calendar</h2>
                {info.calendar.connected ? (
                  <>
                    {calendarJustConnected && (
                      <div className="notice notice-ok" role="status">
                        Calendar connected.
                      </div>
                    )}
                    <p className="muted">
                      {who} books appointments into {info.calendar.account}'s calendar, only at times you're free.
                    </p>
                  </>
                ) : info.signIn[info.calendar.wanted] ? (
                  <>
                    <p className="muted">
                      Let {who} see when you're free and add bookings to your{" "}
                      {info.calendar.wanted === "google" ? "Google" : "Outlook"} calendar. It only sees whether you're busy,
                      and only adds the appointments it books.
                    </p>
                    <div>
                      <a
                        className="btn btn-primary signin-btn"
                        href={`/api/oauth/${info.calendar.wanted}/start?t=${encodeURIComponent(token)}&purpose=calendar`}
                      >
                        Connect {info.calendar.wanted === "google" ? "Google Calendar" : "Outlook calendar"}
                      </a>
                    </div>
                  </>
                ) : (
                  <p className="muted">Calendar connection isn't available yet. Your provider will be in touch.</p>
                )}
              </section>
            )}
            {error && info.email.connected && (
              <div className="notice notice-error" role="alert">
                {error}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
