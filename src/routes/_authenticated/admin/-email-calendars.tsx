import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarCheck, ExternalLink, Mail, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, Notice, Panel } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtDate } from "@/lib/app/format";
import { PRODUCT } from "@/lib/app/product";
import { platformSettingsApi, platformSettingsQuery, type PlatformService } from "@/lib/api/platformSettings";
import type { PlatformServiceState, PlatformSettings, PlatformTestResult } from "@/lib/shared";
import { LinkBox } from "./-shared";

// Settings, "Email and calendars" (platform admin only): the address account emails
// are sent from, and the Google and Microsoft apps behind "Sign in with Google /
// Microsoft" for mailboxes and calendars. What's saved here replaces the server's
// own setting; removing it goes back to that.

export function EmailCalendarsSection() {
  const q = useQuery(platformSettingsQuery());
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  if (!q.data) return <div className="panel p-4 text-[12.5px] text-ink-muted">Loading…</div>;
  const s = q.data;
  return (
    <div className="space-y-4" data-section="email-calendars">
      <p className="max-w-[680px] text-[12.5px] leading-5 text-ink-muted">
        What you save here is used straight away and replaces the setting in the server's files. Secrets are stored encrypted and never shown again, only their last 4 characters.
      </p>
      <Notice tone="info">For the simple choices (Resend, Gmail, Microsoft 365, Zoho), a backup sender and the recent emails, use Settings, Email. Pasting a mail server address here still works and keeps any backup.</Notice>
      <MailCard s={s} />
      <OAuthCard s={s} provider="google" />
      <OAuthCard s={s} provider="microsoft" />
    </div>
  );
}

function StateBadge({ st }: { st: PlatformServiceState }) {
  if (st.problem) return <StatusBadge tone="danger" dot>Needs attention</StatusBadge>;
  if (st.state === "saved") return <StatusBadge tone="success" dot>Connected</StatusBadge>;
  if (st.state === "server") return <StatusBadge tone="info" dot>Using server setting</StatusBadge>;
  return <StatusBadge tone="warning" dot>Not set</StatusBadge>;
}

function CardTitle({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-ink-muted" aria-hidden />
      {children}
    </span>
  );
}

function ConsoleLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-indigo hover:underline">
      {children} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function SavedLine({ st, children }: { st: PlatformServiceState; children: ReactNode }) {
  if (st.state === "none") return null;
  return (
    <div className="rounded-[6px] border border-hairline bg-canvas-2 px-3 py-2 text-[12.5px] text-ink" data-current>
      <div className="break-words">{children}</div>
      <div className="mt-0.5 text-[11.5px] text-ink-muted">
        {st.state === "saved" ? `Saved here${st.savedBy ? ` by ${st.savedBy}` : ""}${st.savedAt ? ` on ${fmtDate(st.savedAt)}` : ""}.` : "From the server's own settings file. Save here to replace it."}
      </div>
    </div>
  );
}

/** Save, test and remove, shared by the three cards. */
function useServiceActions(service: PlatformService, onSaved: () => void) {
  const qc = useQueryClient();
  const [result, setResult] = useState<PlatformTestResult | null>(null);
  const put = (d: PlatformSettings) => qc.setQueryData(platformSettingsQuery().queryKey, d);
  const save = useMutation({
    mutationFn: (input: Record<string, string>) => platformSettingsApi.save(service, input),
    onSuccess: (d) => {
      put(d);
      setResult(null);
      onSaved();
      toast.success("Saved", { description: "In use from now on." });
    },
  });
  const test = useMutation({
    mutationFn: (input: Record<string, string>) => platformSettingsApi.test(service, input),
    onMutate: () => setResult(null),
    onSuccess: setResult,
  });
  const clear = useMutation({
    mutationFn: () => platformSettingsApi.clear(service),
    onSuccess: (d) => {
      put(d);
      setResult(null);
      onSaved();
      toast.success("Removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return { save, test, clear, result };
}

function Outcome({ save, test, result }: { save: { error: unknown }; test: { error: unknown }; result: PlatformTestResult | null }) {
  const err = (save.error || test.error) as Error | null;
  if (err) {
    return (
      <div role="alert" className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]" data-outcome="error">
        {err.message}
      </div>
    );
  }
  if (!result) return null;
  return (
    <div data-outcome="ok">
      <Notice tone="success">
        <div>{result.message}</div>
        {result.redirectUri ? <div className="mt-1.5 break-all font-mono text-[12px]">{result.redirectUri}</div> : null}
      </Notice>
    </div>
  );
}

function Buttons({ busy, onTest, testLabel, st, onClear, children }: { busy: boolean; onTest: () => void; testLabel: string; st: PlatformServiceState; onClear: () => void; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" className="h-9" disabled={busy} data-action="save">
        Save
      </Button>
      <Button type="button" size="sm" variant="outline" className="h-9" disabled={busy} onClick={onTest} data-action="test">
        {testLabel}
      </Button>
      {st.state === "saved" ? (
        <Button type="button" size="sm" variant="ghost" className="h-9 text-ink-muted" disabled={busy} onClick={onClear} data-action="clear">
          {st.serverHas ? "Go back to server setting" : "Remove"}
        </Button>
      ) : null}
      {children}
    </div>
  );
}

// ---- Account emails ----

function MailCard({ s }: { s: PlatformSettings }) {
  const st = s.mail;
  const [smtpUrl, setSmtpUrl] = useState("");
  const [from, setFrom] = useState(st.from);
  useEffect(() => setFrom(st.from), [st.from]);
  const { save, test, clear, result } = useServiceActions("mail", () => setSmtpUrl(""));
  const busy = save.isPending || test.isPending || clear.isPending;
  const input = () => ({ smtpUrl: smtpUrl.trim(), from: from.trim() });

  return (
    <div data-card="mail" data-state={st.state}>
      <Panel title={<CardTitle icon={Mail}>Account emails</CardTitle>} description="Invites, password resets and booking emails." actions={<StateBadge st={st} />}>
        <div className="space-y-3">
          <p className="max-w-[680px] text-[12.5px] leading-5 text-ink-muted">
            Use any email service that gives you SMTP details, such as Amazon SES, Resend or your own mail server. Make SMTP credentials there, verify the address you'll send from, then paste the server address below.{" "}
            <ConsoleLink href="https://console.aws.amazon.com/ses/home#/smtp">Amazon SES</ConsoleLink> · <ConsoleLink href="https://resend.com/docs/send-with-smtp">Resend</ConsoleLink>
          </p>
          {st.state === "none" ? <Notice tone="info">Not set: emails are written to the server log instead of being sent.</Notice> : null}
          {st.problem ? <Notice tone="danger">{st.problem}</Notice> : null}
          <SavedLine st={st}>
            Sending through <span className="font-mono">{st.host || "—"}</span>
            {st.last4 ? (
              <>
                {" "}· password ending <span className="font-mono">{st.last4}</span>
              </>
            ) : null}
            {st.from ? <> · from {st.from}</> : null}
          </SavedLine>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(input());
            }}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Mail server address" htmlFor="pm-smtp" hint={st.state === "saved" ? "Leave empty to keep the saved one." : "Like smtps://USERNAME:PASSWORD@smtp.example.com:465"}>
                <Input
                  id="pm-smtp"
                  type="password"
                  value={smtpUrl}
                  onChange={(e) => setSmtpUrl(e.target.value)}
                  placeholder={st.state === "saved" ? `Saved, ending ${st.last4 || "…"}` : "smtps://…"}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9 font-mono text-[13px]"
                  data-field="smtp-url"
                />
              </Field>
              <Field label="Send from" htmlFor="pm-from" hint="A name and an address your email service has verified.">
                <Input id="pm-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={`${PRODUCT} <no-reply@example.com>`} maxLength={200} autoComplete="off" className="h-9" data-field="mail-from" />
              </Field>
            </div>
            <Buttons busy={busy} st={st} testLabel={test.isPending ? "Sending…" : "Send test email"} onTest={() => test.mutate(input())} onClear={() => clear.mutate()}>
              <span className="text-[11.5px] text-ink-muted">The test goes to {s.testTo}.</span>
            </Buttons>
            <Outcome save={save} test={test} result={result} />
          </form>
        </div>
      </Panel>
    </div>
  );
}

// ---- Google and Microsoft sign-in apps ----

const PROVIDER = {
  google: {
    title: "Google",
    sub: "Google Calendar sign-in for your clients.",
    mailSub: "Gmail and Google Calendar sign-in for your clients.",
    how: "In Google Cloud, open Credentials and create an OAuth client ID of type \"Web application\". Add the redirect URI below, turn on the Google Calendar API, then paste the client ID and secret here.",
    link: "https://console.cloud.google.com/apis/credentials",
    linkText: "Open Google Cloud",
    idPlaceholder: "123456789-abc….apps.googleusercontent.com",
    secretPlaceholder: "GOCSPX-…",
  },
  microsoft: {
    title: "Microsoft",
    sub: "Outlook calendar sign-in for your clients.",
    mailSub: "Outlook mail and calendar sign-in for your clients.",
    how: "In Microsoft Entra, open App registrations and make a new one for \"any organizational directory and personal Microsoft accounts\", with a Web redirect URI (below). Then make a client secret and copy its Value.",
    link: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    linkText: "Open Microsoft Entra",
    idPlaceholder: "Application (client) ID",
    secretPlaceholder: "Secret value",
  },
} as const;

// What Google has to approve before anyone outside the buyer's own Google
// Workspace can sign in, for the scopes listed above.
function GoogleReview({ mailbox }: { mailbox: boolean }) {
  return (
    <p className="max-w-[680px] text-[12.5px] leading-5 text-ink-muted" data-google-review={mailbox ? "restricted" : "sensitive"}>
      {mailbox ? (
        <>
          Gmail sign-in for mailboxes is on (MAILBOX_SIGNIN), so this app also asks for <span className="font-mono">https://mail.google.com/</span>. Google rates that scope
          restricted: publishing the app needs Google's restricted-scope verification plus a yearly security assessment you pay for. Clients can connect Gmail with an
          app password instead.
        </>
      ) : (
        <>
          Calendar only: this app never asks for access to Gmail (clients connect a mailbox with an app password). Before you publish it for clients outside your own
          Google Workspace, Google has to verify it for the sensitive calendar scope.
        </>
      )}
    </p>
  );
}

function OAuthCard({ s, provider }: { s: PlatformSettings; provider: "google" | "microsoft" }) {
  const st = s[provider];
  const p = PROVIDER[provider];
  const [clientId, setClientId] = useState(st.clientId);
  const [secret, setSecret] = useState("");
  useEffect(() => setClientId(st.clientId), [st.clientId]);
  const { save, test, clear, result } = useServiceActions(provider, () => setSecret(""));
  const busy = save.isPending || test.isPending || clear.isPending;
  const input = () => ({ clientId: clientId.trim(), clientSecret: secret.trim() });

  return (
    <div data-card={provider} data-state={st.state}>
      <Panel title={<CardTitle icon={CalendarCheck}>{p.title}</CardTitle>} description={st.mailboxSignIn ? p.mailSub : p.sub} actions={<StateBadge st={st} />}>
        <div className="space-y-3">
          <p className="max-w-[680px] text-[12.5px] leading-5 text-ink-muted">
            {p.how} <ConsoleLink href={p.link}>{p.linkText}</ConsoleLink>
          </p>
          <Field label="Scopes this app asks for">
            <ul className="space-y-0.5 rounded-[6px] border border-hairline bg-canvas-2 px-3 py-2 font-mono text-[12px] text-ink" data-list="scopes">
              {st.scopes.map((sc) => (
                <li key={sc} className="break-all">{sc}</li>
              ))}
            </ul>
          </Field>
          {provider === "google" ? <GoogleReview mailbox={st.mailboxSignIn} /> : null}
          <Field label="Redirect URI to add">
            <LinkBox url={st.redirectUri} label={`${p.title} redirect URI`} />
          </Field>
          {s.publicWarning ? <Notice tone="warning">{s.publicWarning}</Notice> : null}
          {st.problem ? <Notice tone="danger">{st.problem}</Notice> : null}
          <SavedLine st={st}>
            Client ID <span className="break-all font-mono">{st.clientId}</span>
            {st.last4 ? (
              <>
                {" "}· secret ending <span className="font-mono">{st.last4}</span>
              </>
            ) : null}
          </SavedLine>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(input());
            }}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Client ID" htmlFor={`${provider}-id`}>
                <Input id={`${provider}-id`} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={p.idPlaceholder} autoComplete="off" spellCheck={false} className="h-9 font-mono text-[13px]" data-field="client-id" />
              </Field>
              <Field label="Client secret" htmlFor={`${provider}-secret`} hint={st.state === "saved" ? "Leave empty to keep the saved one." : undefined}>
                <Input
                  id={`${provider}-secret`}
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={st.state === "saved" ? `Saved, ending ${st.last4 || "…"}` : p.secretPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9 font-mono text-[13px]"
                  data-field="client-secret"
                />
              </Field>
            </div>
            <Buttons busy={busy} st={st} testLabel={test.isPending ? "Checking…" : "Check"} onTest={() => test.mutate(input())} onClear={() => clear.mutate()} />
            {st.state !== "none" ? <p className="text-[11.5px] text-ink-muted">Changing to a different app later means clients who signed in with {p.title} need to sign in again.</p> : null}
            <Outcome save={save} test={test} result={result} />
          </form>
        </div>
      </Panel>
    </div>
  );
}
