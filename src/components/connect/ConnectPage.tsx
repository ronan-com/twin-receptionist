import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { BrandMark } from "@/components/app/BrandMark";
import { Notice } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api/base";
import type { ConnectInfo, EmailMode } from "@/lib/shared";
import { cn } from "@/lib/utils";

// The page a business opens from its private link to connect its own mailbox (and
// calendar). It shows nothing from the agency's console. Ported from our earlier
// src/pages/Connect.tsx into Answered's style; same endpoints (/api/connect/<token>).

type Provider = "google" | "microsoft" | "other";

type MailboxDetails = {
  address: string;
  password: string;
  host?: string;
  port?: number;
  username?: string;
  smtpHost?: string;
  smtpPort?: number;
  mode?: EmailMode;
};

const link = (token: string) => `/api/connect/${encodeURIComponent(token)}`;
const connectApi = {
  info: (token: string) => api.get<ConnectInfo>(link(token), { allow401: true }),
  connect: (token: string, d: MailboxDetails) => api.put<ConnectInfo>(`${link(token)}/email`, d, { allow401: true }),
  disconnect: (token: string) => api.del<ConnectInfo>(`${link(token)}/email`, { allow401: true }),
};

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "google", label: "Gmail or Google Workspace" },
  { value: "microsoft", label: "Outlook or Microsoft 365" },
  { value: "other", label: "Something else" },
];

const PROMISE =
  "It only looks at emails that arrive from now on, replies to genuine enquiries, and ignores newsletters and receipts. It never deletes or moves your emails, and you can disconnect from this page at any time.";

function Card({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel grid gap-3 p-4 sm:p-5">
      {title ? <h2 className="text-[15px] font-semibold text-ink">{title}</h2> : null}
      {children}
    </section>
  );
}

const muted = "text-[13px] leading-5 text-ink-muted";
const hint = "text-[12px] leading-5 text-ink-muted";
const textLink = "font-medium text-indigo hover:underline";

function Choice({ on, onClick, title, body }: { on: boolean; onClick: () => void; title: string; body?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "w-full rounded-[6px] border px-3.5 py-3 text-left transition-colors",
        on ? "border-indigo bg-[#f4f3ff]" : "border-hairline bg-white hover:bg-canvas-2",
      )}
    >
      <span className="block text-[13.5px] font-medium text-ink">{title}</span>
      {body ? <span className="mt-0.5 block text-[12.5px] leading-5 text-ink-muted">{body}</span> : null}
    </button>
  );
}

function ModeChoice({ mode, setMode, who, step }: { mode: EmailMode; setMode: (m: EmailMode) => void; who: string; step: number }) {
  return (
    <Card title={`${step}. What should ${who} do with replies?`}>
      <div className="grid gap-2" role="radiogroup" aria-label="Reply handling">
        <Choice on={mode === "draft"} onClick={() => setMode("draft")} title="Save them as drafts" body="Each reply waits in your Drafts folder. You check it and press send. A good way to start." />
        <Choice on={mode === "send"} onClick={() => setMode("send")} title="Send them for me" body="Enquiries get an answer straight away. Every reply is in your Sent folder." />
      </div>
    </Card>
  );
}

function Field({ id, label, children }: { id: string; label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function ConnectPage({ token }: { token: string }) {
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
    connectApi
      .info(token)
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
        await connectApi.connect(token, {
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
      setInfo(await connectApi.disconnect(token));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const who = info?.receptionistName || "your AI receptionist";
  const signInReady = provider === "google" ? info?.signIn.google : provider === "microsoft" ? info?.signIn.microsoft : false;
  const providerName = provider === "google" ? "Google" : "Microsoft";
  const errorNotice = error ? <Notice tone="danger">{error}</Notice> : null;

  return (
    <div className="min-h-screen bg-canvas-2 text-ink" data-page="connect">
      <header className="border-b border-hairline bg-white">
        <div className="mx-auto flex h-14 max-w-[640px] items-center px-4">
          {/* Not a link anywhere useful: the business has nowhere else to go in this app. */}
          <BrandMark to={`/connect/${token}`} suffix="Receptionist" />
        </div>
      </header>
      <main className="mx-auto grid max-w-[640px] gap-4 px-4 py-8">
        {loadError ? <Notice tone="danger">{error || loadError}</Notice> : null}
        {!info && !loadError ? <p className={muted}>Loading…</p> : null}

        {info ? (
          <>
            <div>
              <div className="text-[12px] font-medium text-ink-muted">{info.businessName}</div>
              <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.02em]">Connect your email</h1>
              <p className="mt-1.5 text-[14px] leading-6 text-ink-muted">
                {info.receptionistName ? `${info.receptionistName}, your AI receptionist,` : "Your AI receptionist"} will answer new enquiries that arrive in your inbox, using your
                opening hours and services.
              </p>
            </div>

            {info.email.connected ? (
              <Card>
                {justConnected ? <Notice tone="success">Connected. You can close this page.</Notice> : null}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold">{info.email.address}</p>
                    <p className={hint}>
                      {info.email.mode === "send" ? "Replies are sent for you. You'll find them in your Sent folder." : "Replies are saved in your Drafts folder. Check them and press send."}
                    </p>
                  </div>
                  <StatusBadge tone="success">Connected</StatusBadge>
                </div>
                <p className={muted}>You're all set. To change how replies are handled, disconnect and connect again.</p>
                <div>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={disconnect}>
                    {busy ? "Disconnecting…" : "Disconnect"}
                  </Button>
                </div>
              </Card>
            ) : (
              <>
                <Card title="1. Who looks after your email?">
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Email provider">
                    {PROVIDERS.map((p) => (
                      <Choice
                        key={p.value}
                        on={provider === p.value}
                        title={p.label}
                        onClick={() => {
                          setProvider(p.value);
                          setError("");
                        }}
                      />
                    ))}
                  </div>
                </Card>

                {provider && signInReady && !usePassword ? (
                  <>
                    <ModeChoice mode={mode} setMode={setMode} who={who} step={2} />
                    {errorNotice}
                    <Button asChild className="h-10 justify-self-start">
                      <a href={`/api/oauth/${provider}/start?t=${encodeURIComponent(token)}&mode=${mode}`}>Sign in with {providerName}</a>
                    </Button>
                    <p className={hint}>
                      {providerName} will ask you to let {who} read and send email for this address. {PROMISE}
                    </p>
                    {provider === "google" ? (
                      <button type="button" className={cn(textLink, "justify-self-start text-[13px]")} onClick={() => setUsePassword(true)}>
                        Use an app password instead
                      </button>
                    ) : null}
                  </>
                ) : null}

                {provider === "microsoft" && !signInReady ? (
                  <Card title="Outlook and Microsoft 365 aren't available yet">
                    <p className={muted}>
                      Microsoft has switched off password sign-in for email apps, so these accounts need a "Sign in with Microsoft" option, which is on its way. Let your provider
                      know you use Outlook and they'll be in touch.
                    </p>
                  </Card>
                ) : null}

                {(provider === "google" && (!signInReady || usePassword)) || provider === "other" ? (
                  <form className="grid gap-4" onSubmit={connect}>
                    <Card title="2. Create an app password">
                      {provider === "google" ? (
                        <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-5 text-ink-muted">
                          <li>
                            Turn on{" "}
                            <a className={textLink} href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noreferrer">
                              2-Step Verification
                            </a>{" "}
                            for your Google account, if it isn't on already.
                          </li>
                          <li>
                            Open{" "}
                            <a className={textLink} href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
                              App passwords
                            </a>
                            , type <strong>Receptionist</strong> as the name and press Create.
                          </li>
                          <li>Copy the 16-letter password Google shows you and paste it below.</li>
                        </ol>
                      ) : (
                        <p className={muted}>
                          Most providers (iCloud, Yahoo, Zoho, Telstra/Bigpond) need an app password rather than your normal password: look for "app passwords" in your
                          account's security settings. Email hosted with your website usually takes your normal email password.
                        </p>
                      )}
                      {provider === "google" ? (
                        <p className={hint}>With a work Google Workspace account, if App passwords says it isn't available, your Workspace admin needs to allow it.</p>
                      ) : null}
                      <Field id="cx-address" label="Your email address">
                        <Input id="cx-address" type="email" required autoComplete="email" value={address} onChange={(e) => setAddress(e.target.value)} />
                      </Field>
                      <Field id="cx-password" label={provider === "google" ? "App password" : "Password or app password"}>
                        <Input id="cx-password" type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                      </Field>
                      {provider === "other" ? (
                        <details className="rounded-[6px] border border-hairline bg-canvas-2 px-3 py-2">
                          <summary className="cursor-pointer text-[13px] font-medium text-ink">Server settings (only if it can't find them)</summary>
                          <div className="mt-3 grid gap-3">
                            <div className="grid grid-cols-[1fr_88px] gap-3">
                              <Field id="cx-host" label="Incoming server (IMAP)">
                                <Input id="cx-host" placeholder="mail.yourbusiness.com.au" value={host} onChange={(e) => setHost(e.target.value)} />
                              </Field>
                              <Field id="cx-port" label="Port">
                                <Input id="cx-port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
                              </Field>
                            </div>
                            <div className="grid grid-cols-[1fr_88px] gap-3">
                              <Field id="cx-smtp" label="Outgoing server (SMTP)">
                                <Input id="cx-smtp" placeholder="mail.yourbusiness.com.au" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
                              </Field>
                              <Field id="cx-smtp-port" label="Port">
                                <Input id="cx-smtp-port" inputMode="numeric" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
                              </Field>
                            </div>
                            <Field
                              id="cx-user"
                              label={
                                <>
                                  Login name <em className="font-normal text-ink-muted">if different from your address</em>
                                </>
                              }
                            >
                              <Input id="cx-user" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
                            </Field>
                          </div>
                        </details>
                      ) : null}
                    </Card>

                    <ModeChoice mode={mode} setMode={setMode} who={who} step={3} />

                    {errorNotice}
                    <Button type="submit" className="h-10 justify-self-start" disabled={busy}>
                      {busy ? "Connecting…" : "Connect my email"}
                    </Button>
                    <p className={hint}>{PROMISE} Your password is stored encrypted.</p>
                  </form>
                ) : null}
              </>
            )}

            {info.calendar.wanted ? (
              <Card title="Your calendar">
                {info.calendar.connected ? (
                  <>
                    {calendarJustConnected ? <Notice tone="success">Calendar connected.</Notice> : null}
                    <p className={muted}>
                      {who} books appointments into {info.calendar.account}'s calendar, only at times you're free.
                    </p>
                  </>
                ) : info.signIn[info.calendar.wanted] ? (
                  <>
                    <p className={muted}>
                      Let {who} see when you're free and add bookings to your {info.calendar.wanted === "google" ? "Google" : "Outlook"} calendar. It only sees whether you're busy,
                      and only adds the appointments it books.
                    </p>
                    <div>
                      <Button asChild className="h-10">
                        <a href={`/api/oauth/${info.calendar.wanted}/start?t=${encodeURIComponent(token)}&purpose=calendar`}>
                          Connect {info.calendar.wanted === "google" ? "Google Calendar" : "Outlook calendar"}
                        </a>
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className={muted}>Calendar connection isn't available yet. Your provider will be in touch.</p>
                )}
              </Card>
            ) : null}
            {error && info.email.connected ? errorNotice : null}
          </>
        ) : null}
      </main>
    </div>
  );
}
