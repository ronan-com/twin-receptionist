import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import { ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/forms";
import { LinkBox } from "@/routes/_authenticated/admin/-shared";
import { platformSettingsApi, platformSettingsQuery } from "@/lib/api/platformSettings";
import { getSignIn } from "@/lib/api/manage";
import { useWorkspace } from "@/lib/app/workspace";

// "Connect Google / Outlook" only works once this install has its own Google or Microsoft app (or the setup
// provider's shared sign-in is on). The account owner can do that right here, once; everyone else is told to ask.

export type SignInProvider = "google" | "microsoft";
export const ASK_OWNER = "Ask your account owner to switch this on.";

export const signInQuery = (businessId: string) => ({ queryKey: ["sign-in", businessId] as const, queryFn: () => getSignIn(businessId) });
export const useSignIn = (businessId: string) => useQuery(signInQuery(businessId));

/** The people who may save this install's keys (the server checks again). */
export function useCanSetUp(): boolean {
  const ws = useWorkspace();
  return Boolean(ws.session?.serverSettings) && !ws.viewing;
}

/** Back from Google or Microsoft: say how it went, once, and tidy the address bar. */
export function useSignInOutcome() {
  const search = useSearch({ strict: false }) as { error?: string; calendar?: string; connected?: string };
  const navigate = useNavigate();
  useEffect(() => {
    if (search.error) toast.error("Sign-in didn't finish", { id: "sign-in", description: search.error });
    else if (search.calendar) toast.success("Calendar connected", { id: "sign-in" });
    else if (search.connected) toast.success("Inbox connected", { id: "sign-in" });
    if (search.error || search.calendar || search.connected) void navigate({ search: ((p: Record<string, unknown>) => ({ ...p, error: undefined, calendar: undefined, connected: undefined })) as never, replace: true } as never);
  }, [search.error, search.calendar, search.connected, navigate]);
}

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 font-medium text-indigo hover:underline">
    {children} <ExternalLink className="h-3 w-3" />
  </a>
);

const NAME = { google: "Google", microsoft: "Microsoft" } as const;

/** "Set it up" for the owner; "ask your account owner" for everyone else. */
export function SetItUp({ provider, label }: { provider: SignInProvider; label?: string }) {
  const can = useCanSetUp();
  const [open, setOpen] = useState(false);
  if (!can) return <p className="text-[13px] text-ink-muted" data-ask-owner={provider}>{ASK_OWNER}</p>;
  if (open) return <SignInSetup provider={provider} onClose={() => setOpen(false)} />;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" className="h-11 gap-2 px-5" onClick={() => setOpen(true)} data-set-up={provider}>
        <KeyRound className="h-4 w-4" /> {label ?? "Set it up"}
      </Button>
      <span className="text-[12px] text-ink-muted">Once, about 10 minutes.</span>
    </div>
  );
}

/** The numbered steps (from handoff-content/providers/*-oauth.md), this install's redirect address, and the two boxes. */
export function SignInSetup({ provider, onClose }: { provider: SignInProvider; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery(platformSettingsQuery());
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const save = useMutation({
    mutationFn: () => platformSettingsApi.save(provider, { clientId: clientId.trim(), clientSecret: secret.trim() }),
    onSuccess: async (d) => {
      qc.setQueryData(platformSettingsQuery().queryKey, d);
      await qc.invalidateQueries({ queryKey: ["sign-in"] });
      toast.success("Saved. Now press Connect.");
      onClose();
    },
  });
  if (q.isPending) return <p className="text-[12.5px] text-ink-muted">Loading…</p>;
  if (q.error) return <p role="alert" className="text-[12.5px] text-[#a41d1d]">{(q.error as Error).message}</p>;
  const st = q.data[provider];
  const address = (
    <div className="mt-1.5" data-redirect={provider}>
      <LinkBox url={st.redirectUri} label={`${NAME[provider]} redirect address`} />
    </div>
  );
  const scopes = st.scopes.filter((s) => s.startsWith("https://")).map((s) => s.replace("https://www.googleapis.com/auth/", ""));
  const steps: ReactNode[] =
    provider === "google"
      ? [
          <>Open <A href="https://console.cloud.google.com/projectcreate">Google Cloud</A> and create a project (any name). In <b>APIs &amp; Services &gt; Library</b>, enable <b>Google Calendar API</b>{st.mailboxSignIn ? <> and <b>Gmail API</b></> : null}.</>,
          <>Open <b>Google Auth platform</b>, press <b>Get started</b>, add the app name and your email, choose <b>External</b>.</>,
          <>Under <b>Audience</b> press <b>Publish app</b>. Under <b>Data Access</b> add: <span className="font-mono text-[11.5px] [overflow-wrap:anywhere]">{scopes.join(", ")}</span></>,
          <>Under <b>Clients &gt; Create client</b> choose <b>Web application</b>. In <b>Authorised redirect URIs</b> paste:{address}</>,
          <>Press <b>Create</b>. Paste the <b>Client ID</b> and <b>Client secret</b> below (the secret is shown once).</>,
        ]
      : [
          <>Open <A href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade">Microsoft Entra &gt; App registrations</A> and press <b>New registration</b> (any name).</>,
          <>For account types choose <b>Any Entra ID Tenant + Personal Microsoft accounts</b>.</>,
          <>Under <b>Redirect URI</b> choose <b>Web</b>, paste this, then press <b>Register</b>:{address}</>,
          <>Copy the <b>Application (client) ID</b> into the first box below.</>,
          <>Under <b>Certificates &amp; secrets</b> press <b>New client secret</b>, then <b>Add</b>. Copy its <b>Value</b> (not the Secret ID) into the second box.</>,
        ];
  return (
    <form
      className="grid gap-3 rounded-[10px] border border-hairline bg-canvas-2 p-3.5"
      data-sign-in-setup={provider}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-[14px] font-semibold text-ink">Set up once (about 10 minutes)</p>
      <ol className="grid gap-2.5 text-[12.5px] leading-5 text-ink">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--indigo)] text-[11px] font-semibold text-white" aria-hidden>{i + 1}</span>
            <div className="min-w-0 flex-1">{s}</div>
          </li>
        ))}
      </ol>
      {provider === "google" ? <p className="text-[12px] text-ink-muted">If Google later says it hasn't verified the app: press Advanced, then "Go to" your app.</p> : null}
      {q.data.publicWarning ? <p className="text-[12px] text-[#8a4b00]">{q.data.publicWarning}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client ID" htmlFor={`su-id-${provider}`}>
          <Input id={`su-id-${provider}`} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} className="h-10 bg-card font-mono text-[13px]" data-field="client-id" />
        </Field>
        <Field label="Client secret" htmlFor={`su-secret-${provider}`}>
          <Input id={`su-secret-${provider}`} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} className="h-10 bg-card font-mono text-[13px]" data-field="client-secret" />
        </Field>
      </div>
      {save.error ? <p role="alert" className="text-[12.5px] text-[#a41d1d]">{(save.error as Error).message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-10 px-6" disabled={save.isPending || !clientId.trim() || !secret.trim()} data-action="save-keys">
          {save.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null} Save
        </Button>
        <Button type="button" variant="ghost" className="h-10" onClick={onClose}>Not now</Button>
      </div>
    </form>
  );
}
