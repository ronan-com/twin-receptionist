import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, Notice, Panel } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { fmtDate } from "@/lib/app/format";
import { PRODUCT } from "@/lib/app/product";
import { emailSettingsApi, emailSettingsQuery, type SenderWhich } from "@/lib/api/emailSettings";
import type { EmailProviderId, EmailSenderView, EmailSettings, RecentEmail } from "@/lib/shared";

// Settings, "Email": how invites, password resets and booking emails are sent. Simple choices
// (Resend, or your own Gmail, Microsoft 365 or Zoho account, or any SMTP server), an optional
// backup that's used when the main one fails, a test email, and the last 10 emails.

type Choice = "resend" | "gmail" | "microsoft" | "zoho" | "smtp";
const CHOICES: { id: Choice; title: string; sub: string }[] = [
  { id: "resend", title: "Resend", sub: "Recommended. Sends from your own domain." },
  { id: "gmail", title: "Gmail / Google Workspace", sub: "Your Google account, with an app password." },
  { id: "microsoft", title: "Microsoft 365 / Outlook", sub: "Your Microsoft work or Outlook account." },
  { id: "zoho", title: "Zoho Mail", sub: "Australia or worldwide." },
  { id: "smtp", title: "Other (SMTP)", sub: "Any email service with SMTP details." },
];

const choiceOf = (p: EmailProviderId | undefined): Choice => (p === "zoho_au" ? "zoho" : (p ?? "resend"));

export function EmailSendingSection() {
  const q = useQuery(emailSettingsQuery());
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  if (!q.data) return <div className="panel p-4 text-[12.5px] text-ink-muted">Loading…</div>;
  const s = q.data;
  return (
    <div className="space-y-4" data-section="email-sending">
      <Overview s={s} />
      <SenderCard s={s} which="primary" />
      {s.primary ? <SenderCard s={s} which="backup" /> : null}
      <RecentCard rows={s.recent} />
    </div>
  );
}

function senderLine(v: EmailSenderView) {
  return (
    <>
      <b>{v.label}</b> · from {v.from}
      {v.provider === "smtp" ? (
        <>
          {" "}· <span className="font-mono">{v.host}:{v.port}</span>
        </>
      ) : null}
      {v.last4 ? (
        <>
          {" "}· {v.provider === "resend" ? "key" : "password"} ending <span className="font-mono">{v.last4}</span>
        </>
      ) : null}
    </>
  );
}

function Overview({ s }: { s: EmailSettings }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const test = useMutation({
    mutationFn: () => emailSettingsApi.test(),
    onMutate: () => setMsg(""),
    onSuccess: (r) => {
      setMsg(r.message);
      void qc.invalidateQueries({ queryKey: emailSettingsQuery().queryKey });
    },
  });
  const badge = s.problem ? (
    <StatusBadge tone="danger" dot>Needs attention</StatusBadge>
  ) : s.primary ? (
    <StatusBadge tone="success" dot>{s.backup ? "Sending, with a backup" : "Sending"}</StatusBadge>
  ) : (
    <StatusBadge tone="warning" dot>Not set</StatusBadge>
  );
  return (
    <div data-card="email-overview" data-state={s.primary ? (s.backup ? "backup" : "primary") : "none"}>
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-ink-muted" aria-hidden /> How emails are sent
          </span>
        }
        description="Invites, password resets and booking emails."
        actions={badge}
      >
        <div className="space-y-3">
          {s.problem ? <Notice tone="danger">{s.problem}</Notice> : null}
          {!s.primary ? (
            <Notice tone="info">Not set up yet. Until it is, invite and password-reset links show on screen for you to copy and send yourself.</Notice>
          ) : (
            <div className="rounded-[6px] border border-hairline bg-canvas-2 px-3 py-2 text-[12.5px] text-ink" data-current>
              <div className="break-words" data-current="primary">Main: {senderLine(s.primary)}</div>
              <div className="mt-1 break-words" data-current="backup">
                Backup: {s.backup ? senderLine(s.backup) : <span className="text-ink-muted">none. Add one below so emails still go out if the main one fails.</span>}
              </div>
              <div className="mt-1 text-[11.5px] text-ink-muted">
                {s.source === "saved" ? `Saved here${s.savedBy ? ` by ${s.savedBy}` : ""}${s.savedAt ? ` on ${fmtDate(s.savedAt)}` : ""}.` : "From the server's own settings file. Saving here replaces it."}
                {" "}An email that fails on every sender is tried again after 1, 5, 30 and 120 minutes.
              </div>
            </div>
          )}
          {s.primary ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="h-9" disabled={test.isPending} onClick={() => test.mutate()} data-action="send-test">
                {test.isPending ? "Sending…" : "Send test email"}
              </Button>
              <span className="text-[11.5px] text-ink-muted">It goes to {s.testTo}.</span>
            </div>
          ) : null}
          {test.error ? (
            <div role="alert" className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]" data-outcome="error">
              {(test.error as Error).message}
            </div>
          ) : null}
          {msg ? (
            <div data-outcome="ok">
              <Notice tone="success">{msg}</Notice>
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function SenderCard({ s, which }: { s: EmailSettings; which: SenderWhich }) {
  const qc = useQueryClient();
  const now = which === "primary" ? s.primary : s.backup;
  const [open, setOpen] = useState(!now);
  const [choice, setChoice] = useState<Choice>(choiceOf(now?.provider));
  const [zoho, setZoho] = useState<"zoho_au" | "zoho">(now?.provider === "zoho" ? "zoho" : "zoho_au");
  const [f, setF] = useState({ address: "", fromName: which === "primary" ? PRODUCT : "", password: "", host: "", port: "587", username: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const put = (d: EmailSettings) => qc.setQueryData(emailSettingsQuery().queryKey, d);
  const save = useMutation({
    mutationFn: () => emailSettingsApi.save(which, { provider: choice === "zoho" ? zoho : choice, ...f }),
    onSuccess: (d) => {
      put(d);
      setF({ ...f, password: "" });
      setOpen(false);
      toast.success(which === "primary" ? "Email sender saved" : "Backup saved", { description: "We signed in to it, and it's in use from now on." });
    },
  });
  const clear = useMutation({
    mutationFn: () => emailSettingsApi.clear(which),
    onSuccess: (d) => {
      put(d);
      toast.success("Removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const id = (k: string) => `es-${which}-${k}`;
  const title = which === "primary" ? "Main sender" : "Backup sender (optional)";
  const desc = which === "primary" ? "Every email goes through this first." : "Used only when the main sender fails, so emails still go out. Pick a different account.";

  return (
    <div data-card={`email-${which}`} data-state={now ? "set" : "none"}>
      <Panel
        title={
          <span className="flex items-center gap-2">
            {which === "backup" ? <ShieldCheck className="h-4 w-4 text-ink-muted" aria-hidden /> : <Mail className="h-4 w-4 text-ink-muted" aria-hidden />} {title}
          </span>
        }
        description={desc}
        actions={now ? <StatusBadge tone="success" dot>{now.label}</StatusBadge> : null}
      >
        {!open ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => setOpen(true)} data-action="change">
              {now ? "Change" : which === "backup" ? "Add a backup" : "Set up"}
            </Button>
            {now && (which === "backup" || s.source === "saved") ? (
              <Button type="button" size="sm" variant="ghost" className="h-9 text-ink-muted" disabled={clear.isPending} onClick={() => clear.mutate()} data-action="remove">
                {which === "backup" ? "Remove backup" : "Remove (use the server's setting)"}
              </Button>
            ) : null}
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            data-provider={choice}
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="How emails are sent">
              {CHOICES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={choice === c.id}
                  onClick={() => setChoice(c.id)}
                  className={`rounded-[8px] border px-3 py-2 text-left text-[12.5px] ${choice === c.id ? "border-indigo bg-canvas-2" : "border-hairline hover:bg-canvas-2"}`}
                  data-choice={c.id}
                >
                  <div className="font-medium text-ink">{c.title}</div>
                  <div className="text-[11.5px] text-ink-muted">{c.sub}</div>
                </button>
              ))}
            </div>

            {choice === "resend" ? (
              <p className="text-[12.5px] leading-5 text-ink-muted">
                In <a className="font-medium text-indigo hover:underline" href="https://resend.com/domains" target="_blank" rel="noreferrer noopener">Resend</a>, add and verify your domain, then make an API key (Sending access is enough) and paste it here. Send from an address on that domain.
              </p>
            ) : null}
            {choice === "gmail" ? (
              <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-5 text-ink-muted" data-guide="gmail">
                <li>
                  Turn on 2-Step Verification for the Google account at{" "}
                  <a className="font-medium text-indigo hover:underline" href="https://myaccount.google.com/signinoptions/two-step-verification" target="_blank" rel="noreferrer noopener">myaccount.google.com</a>.
                </li>
                <li>
                  Open <a className="font-medium text-indigo hover:underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer noopener">App passwords</a>, type a name like "{PRODUCT}" and press Create.
                </li>
                <li>Copy the 16-letter password Google shows and paste it below. It's shown only once.</li>
              </ol>
            ) : null}
            {choice === "microsoft" ? (
              <p className="text-[12.5px] leading-5 text-ink-muted">
                Use the mailbox's address and password (or an app password if it has multi-factor sign-in). On Microsoft 365 work accounts an admin may need to turn on "Authenticated SMTP" for the mailbox.
              </p>
            ) : null}
            {choice === "zoho" ? (
              <Field label="Zoho region" htmlFor={id("zoho")}>
                <select id={id("zoho")} value={zoho} onChange={(e) => setZoho(e.target.value as "zoho_au" | "zoho")} className="h-9 rounded-[6px] border border-hairline bg-canvas px-2 text-[13px]" data-field="zoho-region">
                  <option value="zoho_au">Australia (zoho.com.au)</option>
                  <option value="zoho">Worldwide (zoho.com)</option>
                </select>
              </Field>
            ) : null}

            {choice === "smtp" ? (
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="SMTP server" htmlFor={id("host")} className="md:col-span-2">
                  <Input id={id("host")} value={f.host} onChange={set("host")} placeholder="smtp.example.com" autoComplete="off" spellCheck={false} className="h-9" data-field="host" />
                </Field>
                <Field label="Port" htmlFor={id("port")} hint="Usually 587, or 465.">
                  <Input id={id("port")} value={f.port} onChange={set("port")} inputMode="numeric" className="h-9" data-field="port" />
                </Field>
                <Field label="Username" htmlFor={id("username")} hint="Often the email address.">
                  <Input id={id("username")} value={f.username} onChange={set("username")} autoComplete="off" spellCheck={false} className="h-9" data-field="username" />
                </Field>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <Field label={choice === "resend" || choice === "smtp" ? "Send from" : "Email address"} htmlFor={id("address")} hint={choice === "resend" ? "On your verified domain." : choice === "smtp" ? undefined : "Emails come from this account."}>
                <Input id={id("address")} type="email" value={f.address} onChange={set("address")} placeholder={now?.from.replace(/^.*<|>$/g, "") || "hello@yourbusiness.com"} autoComplete="off" className="h-9" data-field="address" />
              </Field>
              <Field label={choice === "resend" ? "Resend API key" : choice === "gmail" ? "App password" : "Password"} htmlFor={id("password")}>
                <Input id={id("password")} type="password" value={f.password} onChange={set("password")} placeholder={choice === "resend" ? "re_…" : choice === "gmail" ? "abcd efgh ijkl mnop" : ""} autoComplete="new-password" spellCheck={false} className="h-9 font-mono text-[13px]" data-field="password" />
              </Field>
              <Field label="Name shown (optional)" htmlFor={id("fromName")}>
                <Input id={id("fromName")} value={f.fromName} onChange={set("fromName")} maxLength={80} className="h-9" data-field="from-name" />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" className="h-9" disabled={save.isPending} data-action="save">
                {save.isPending ? "Signing in…" : "Check and save"}
              </Button>
              {now ? (
                <Button type="button" size="sm" variant="ghost" className="h-9 text-ink-muted" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              ) : null}
              <span className="text-[11.5px] text-ink-muted">We sign in to the account first, so a wrong password is caught now, not later.</span>
            </div>
            {save.error ? (
              <div role="alert" className="rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] text-[#a41d1d]" data-outcome="error">
                {(save.error as Error).message}
              </div>
            ) : null}
          </form>
        )}
      </Panel>
    </div>
  );
}

const STATUS: Record<RecentEmail["status"], { tone: "success" | "warning" | "danger"; text: string }> = {
  sent: { tone: "success", text: "Sent" },
  pending: { tone: "warning", text: "Trying again" },
  failed: { tone: "danger", text: "Failed" },
};

function RecentCard({ rows }: { rows: RecentEmail[] }) {
  return (
    <div data-card="email-recent">
      <Panel title="Recent emails" description="The last 10 sent or failed.">
        {rows.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">Nothing sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-[11.5px] text-ink-muted">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">When</th>
                  <th className="py-1.5 pr-3 font-medium">To</th>
                  <th className="py-1.5 pr-3 font-medium">Subject</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-hairline align-top" data-row={r.status}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(r.at)}</td>
                    <td className="py-1.5 pr-3 break-all">{r.to}</td>
                    <td className="py-1.5 pr-3">{r.subject}</td>
                    <td className="py-1.5 pr-3">
                      <StatusBadge tone={STATUS[r.status].tone} dot>
                        {STATUS[r.status].text}
                      </StatusBadge>
                      {r.status === "sent" && r.via === "backup" ? <div className="mt-0.5 text-[11.5px] text-ink-muted">by the backup</div> : null}
                      {r.status !== "sent" && r.error ? <div className="mt-0.5 max-w-[320px] text-[11.5px] text-ink-muted">{r.error}</div> : null}
                      {r.status === "pending" && r.nextAt ? <div className="text-[11.5px] text-ink-muted">next try {fmtDate(r.nextAt)}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
