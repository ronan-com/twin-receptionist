import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AtSign, ExternalLink, Inbox, Loader2, Mail, PenLine, Send, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/forms";
import { StatusBadge } from "@/components/app/StatusBadge";
import type { Hue } from "@/components/app/hues";
import { checkEmail, connectEmail, disconnectEmail, getEmail, mailSignInUrl, setEmailMode, type EmailState } from "@/lib/api/manage";
import { fmtRelative } from "@/lib/app/format";
import { cn } from "@/lib/utils";
import { ASK_OWNER, SetItUp, useSignIn } from "./SignInSetup";

// Connecting the inbox the receptionist reads: pick Gmail, Outlook or other; one Connect button where the
// install's Google / Microsoft sign-in is on, otherwise an app password in three steps. Then: draft or send.

type Pick = "gmail" | "outlook" | "other";
type Mode = "draft" | "send";
const PICKS: { id: Pick; label: string; icon: LucideIcon; hue: Hue }[] = [
  { id: "gmail", label: "Gmail", icon: Mail, hue: "coral" },
  { id: "outlook", label: "Outlook", icon: Inbox, hue: "sky" },
  { id: "other", label: "Other", icon: AtSign, hue: "slate" },
];
const MODES: { id: Mode; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "draft", label: "Draft replies for me", hint: "Saved in your drafts. You check and send.", icon: PenLine },
  { id: "send", label: "Send replies itself", hint: "Replies go out straight away.", icon: Send },
];

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 font-medium text-indigo hover:underline">
    {children} <ExternalLink className="h-3 w-3" />
  </a>
);

function ModeChoice({ value, onChange, disabled }: { value: Mode; onChange: (m: Mode) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Replies">
      {MODES.map((m) => (
        <button key={m.id} type="button" role="radio" aria-checked={value === m.id} disabled={disabled} onClick={() => value !== m.id && onChange(m.id)} data-mode={m.id}
          className={cn("flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left disabled:opacity-60", value === m.id ? "chip-on" : "border-hairline hover:bg-canvas-2")}>
          <m.icon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
          <span>
            <span className="block text-[13px] font-semibold text-ink">{m.label}</span>
            <span className="block text-[11.5px] text-ink-muted">{m.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

const Problem = ({ children }: { children: ReactNode }) => (
  <div role="alert" className="rounded-[8px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[13px] leading-5 text-[#a41d1d] [overflow-wrap:anywhere]" data-outcome="error">
    {children}
  </div>
);

export function InboxSetup({ businessId, canEdit, editor, onChanged }: { businessId: string; canEdit: boolean; /** In the agency's receptionist editor (where sign-in comes back to). */ editor?: boolean; onChanged?: () => void }) {
  const qc = useQueryClient();
  const key = ["email", businessId];
  const q = useQuery({ queryKey: key, queryFn: () => getEmail(businessId), retry: false });
  const signIn = useSignIn(businessId);
  const [pick, setPick] = useState<Pick | null>(null);
  const [mode, setMode] = useState<Mode>("draft");
  const [withPassword, setWithPassword] = useState(false);
  const [f, setF] = useState({ address: "", password: "", host: "", port: "", smtpHost: "", smtpPort: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const done = (e: EmailState) => {
    qc.setQueryData(key, e);
    onChanged?.();
  };
  const connect = useMutation({
    mutationFn: () =>
      connectEmail(businessId, {
        address: f.address.trim(),
        // Google shows app passwords in groups of four; the spaces aren't part of it.
        password: pick === "gmail" ? f.password.replace(/\s+/g, "") : f.password,
        mode,
        ...(pick === "gmail" ? { host: "imap.gmail.com" } : pick === "other" ? { host: f.host.trim(), port: f.port.trim() || undefined, smtpHost: f.smtpHost.trim(), smtpPort: f.smtpPort.trim() || undefined } : {}),
      }),
    onSuccess: (e) => {
      done(e);
      setF({ ...f, password: "" });
      toast.success("Inbox connected");
    },
  });
  const change = useMutation({
    mutationFn: (m: Mode) => setEmailMode(businessId, m),
    onSuccess: (e) => {
      done(e);
      toast.success(e.mode === "send" ? "It now sends replies itself" : "It now drafts replies for you");
    },
  });
  const check = useMutation({ mutationFn: () => checkEmail(businessId), onSuccess: done });
  const off = useMutation({
    mutationFn: () => disconnectEmail(businessId),
    onSuccess: (e) => {
      done(e);
      toast.success("Inbox disconnected");
    },
  });

  if (q.isPending) return <p className="text-[13px] text-ink-muted">Loading…</p>;
  if (q.error) return <p className="text-[13px] text-ink-muted">Email isn't available here: {(q.error as Error).message}</p>;
  const e = q.data;

  if (e.connected) {
    const problem = (change.error ?? check.error ?? off.error) as Error | null;
    return (
      <div className="space-y-3" data-inbox="connected">
        <div className="flex flex-wrap items-center gap-3">
          <span data-hue="green" className="hue-icon grid h-12 w-12 shrink-0 place-items-center rounded-[12px]" aria-hidden><Mail className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-ink">{e.address}</div>
            <div className="text-[12px] text-ink-muted" data-last-checked>{e.lastCheckedAt ? `Last checked ${fmtRelative(e.lastCheckedAt)}` : "Not checked yet"}</div>
          </div>
          <StatusBadge tone={e.lastError ? "danger" : "success"} dot>{e.lastError ? "Needs attention" : "Connected"}</StatusBadge>
        </div>
        {e.lastError ? <Problem>{e.lastError}</Problem> : null}
        <ModeChoice value={e.mode} onChange={(m) => change.mutate(m)} disabled={!canEdit || change.isPending} />
        {problem ? <Problem>{problem.message}</Problem> : null}
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10" onClick={() => check.mutate()} disabled={check.isPending}>{check.isPending ? "Checking…" : "Check now"}</Button>
            <Button variant="ghost" className="h-10 text-[#a41d1d] hover:bg-[#fff7f7] hover:text-[#a41d1d]" onClick={() => off.mutate()} disabled={off.isPending} data-action="disconnect">Disconnect</Button>
          </div>
        ) : null}
      </div>
    );
  }
  if (!canEdit) return <p className="text-[13px] text-ink-muted">No inbox connected.</p>;

  const provider = pick === "gmail" ? "google" : pick === "outlook" ? "microsoft" : null;
  const oneClick = Boolean(provider && signIn.data?.mail[provider]);
  // Outlook and Microsoft 365 no longer let apps in with a password, so there's no app-password route for it.
  const password = pick === "other" || (pick === "gmail" && !signIn.isPending && (!oneClick || withPassword));
  const name = pick === "gmail" ? "Gmail" : "Outlook";

  return (
    <div className="space-y-4" data-inbox="setup">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Where is the email?">
        {PICKS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={pick === p.id} data-pick={p.id}
            onClick={() => {
              setPick(p.id);
              setWithPassword(false);
              connect.reset();
            }}
            className={cn("flex flex-col items-center gap-2 rounded-[12px] border px-2 py-4 text-[14px] font-semibold text-ink", pick === p.id ? "chip-on" : "border-hairline hover:bg-canvas-2")}>
            <span data-hue={p.hue} className="hue-icon grid h-12 w-12 place-items-center rounded-[12px]" aria-hidden><p.icon className="h-6 w-6" /></span>
            {p.label}
          </button>
        ))}
      </div>

      {pick ? <ModeChoice value={mode} onChange={setMode} /> : null}

      {pick && provider && signIn.isPending ? <p className="text-[13px] text-ink-muted">Loading…</p> : null}

      {oneClick && provider && !withPassword ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button className="h-12 gap-2 px-8 text-[14px]" onClick={() => window.location.assign(mailSignInUrl(businessId, provider, mode, editor ? "editor" : undefined))} data-connect={provider}>
            <Mail className="h-5 w-5" /> Connect {name}
          </Button>
          {pick === "gmail" ? <button type="button" className="text-[12.5px] text-indigo hover:underline" onClick={() => setWithPassword(true)}>Use an app password instead</button> : null}
        </div>
      ) : null}

      {pick === "outlook" && !signIn.isPending && !oneClick ? (
        <div className="space-y-2" data-outlook="not-set-up">
          <p className="text-[13px] text-ink">Outlook only lets apps in through Microsoft sign-in.</p>
          {signIn.data?.mailAllowed.microsoft === false ? <p className="text-[13px] text-ink-muted">{ASK_OWNER}</p> : <SetItUp provider="microsoft" />}
        </div>
      ) : null}

      {password ? (
        <>
        {mode === "send" ? <p className="rounded-lg bg-canvas-2 p-3 text-[12.5px] text-ink-muted">App-password sending needs SMTP access. Railway Hobby does not allow SMTP, so choose drafts or use an authorised Gmail sign-in with Gmail API enabled.</p> : null}
        <form
          className="grid gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            connect.mutate();
          }}
        >
          <ol className="grid gap-1.5 text-[13px] leading-5 text-ink" data-guide={pick}>
            {(pick === "gmail"
              ? [
                  <>Turn on <A href="https://myaccount.google.com/signinoptions/two-step-verification">2-Step Verification</A>.</>,
                  <>Open <A href="https://myaccount.google.com/apppasswords">App passwords</A>, type a name, press <b>Create</b>.</>,
                  <>Paste the 16 letters below.</>,
                ]
              : [
                  <>Open your email account's security settings.</>,
                  <>Make an <b>app password</b> (no such option? use your email password).</>,
                  <>Paste it below.</>,
                ]
            ).map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--indigo)] text-[11px] font-semibold text-white" aria-hidden>{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email address" htmlFor={`em-${businessId}`}>
              <Input id={`em-${businessId}`} type="email" className="h-10" value={f.address} onChange={set("address")} placeholder={pick === "gmail" ? "yourbusiness@gmail.com" : "hello@yourbusiness.com"} />
            </Field>
            <Field label="App password" htmlFor={`pw-${businessId}`}>
              <Input id={`pw-${businessId}`} type="password" className="h-10" value={f.password} onChange={set("password")} autoComplete="new-password" />
            </Field>
          </div>
          {pick === "other" ? (
            <details className="rounded-[8px] border border-hairline px-3 py-2">
              <summary className="cursor-pointer text-[12.5px] font-medium text-ink">Advanced: server settings (only if it can't find them)</summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_90px]">
                <Field label="Incoming server (IMAP)" htmlFor={`ih-${businessId}`}><Input id={`ih-${businessId}`} value={f.host} onChange={set("host")} placeholder="imap.yourbusiness.com" /></Field>
                <Field label="Port" htmlFor={`ip-${businessId}`}><Input id={`ip-${businessId}`} inputMode="numeric" value={f.port} onChange={set("port")} placeholder="993" /></Field>
                <Field label="Outgoing server (SMTP)" htmlFor={`sh-${businessId}`}><Input id={`sh-${businessId}`} value={f.smtpHost} onChange={set("smtpHost")} placeholder="smtp.yourbusiness.com" /></Field>
                <Field label="Port" htmlFor={`sp-${businessId}`}><Input id={`sp-${businessId}`} inputMode="numeric" value={f.smtpPort} onChange={set("smtpPort")} placeholder="465" /></Field>
              </div>
            </details>
          ) : null}
          {connect.error ? <Problem>{connect.error.message}</Problem> : null}
          <Button type="submit" className="h-11 w-full gap-2 sm:w-auto sm:justify-self-start sm:px-8" disabled={connect.isPending || !f.address.trim() || !f.password} data-action="connect-inbox">
            {connect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} {connect.isPending ? "Connecting…" : "Connect"}
          </Button>
        </form>
        </>
      ) : null}
    </div>
  );
}
