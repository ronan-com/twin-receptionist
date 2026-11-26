import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Clock, CreditCard, ExternalLink, Eye, EyeOff, KeyRound, Loader2, PhoneCall, Plug, ShieldCheck, Sparkles, UserPlus, Wallet, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandMark } from "@/components/app/BrandMark";
import type { Hue } from "@/components/app/hues";
import { ErrorState, Notice } from "@/components/app/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtCredit, phoneAccountQuery, phoneApi } from "@/lib/api/phone";
import { useWorkspace } from "@/lib/app/workspace";
import type { PhoneAccount } from "@/lib/shared";
import { cn } from "@/lib/utils";
import { named } from "@/lib/app/product";

// Agency set-up: a new agency connects its own phone account (Telnyx) before it can
// make receptionists. Five short steps; the key is checked with Telnyx and stored
// sealed (server/phoneAccount.ts). The console sends agencies here until it's done.

const TELNYX_SIGNUP = "https://telnyx.com/sign-up";
const TELNYX_PORTAL = "https://portal.telnyx.com/";

export const Route = createFileRoute("/_authenticated/setup")({
  beforeLoad: ({ context }) => {
    const s = context.session;
    // Business users have nothing to set up here; agencies on the platform's account neither.
    if (!s.console) throw redirect({ to: "/app", replace: true });
    if (s.telnyx === "platform" && !s.user.platformAdmin) throw redirect({ to: "/admin", replace: true });
    // SINGLE_AGENCY: the Telnyx key comes from the install, so there's nothing to set up here.
    if (s.singleAgency) throw redirect({ to: "/admin", replace: true });
  },
  head: () => ({ meta: [{ title: named("Set up your agency — Answered") }, { name: "robots", content: "noindex" }] }),
  component: SetupPage,
});

const STEPS: { key: string; title: string; short: string; icon: LucideIcon; hue: Hue }[] = [
  { key: "welcome", title: "Welcome", short: "What you'll need", icon: Sparkles, hue: "indigo" },
  { key: "account", title: "Telnyx account", short: "Sign up, it's free", icon: UserPlus, hue: "violet" },
  { key: "credit", title: "Add credit", short: "So calls can run", icon: Wallet, hue: "magenta" },
  { key: "connect", title: "Connect it", short: "Paste one key", icon: KeyRound, hue: "coral" },
  { key: "done", title: "Connected", short: "Add your first client", icon: PhoneCall, hue: "green" },
];
const LAST = STEPS.length - 1;

const stepStore = (orgId: string) => `setup.step.${orgId}`;
function savedStep(orgId: string): number {
  try {
    const n = Number(window.localStorage.getItem(stepStore(orgId)) ?? 0);
    return Number.isInteger(n) && n >= 0 && n < LAST ? n : 0;
  } catch {
    return 0;
  }
}
function saveStep(orgId: string, n: number) {
  try {
    window.localStorage.setItem(stepStore(orgId), String(n));
  } catch {
    /* private window: the wizard just starts from the top next time */
  }
}

function SetupPage() {
  const ws = useWorkspace();
  const orgId = ws.org?.id ?? "";
  const q = useQuery({ ...phoneAccountQuery(), enabled: !!orgId });
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // Start where they left off; an agency that's already connected lands on the last step.
  useEffect(() => {
    if (loaded || !q.data || !orgId) return;
    setStep(q.data.mode === "own" ? LAST : savedStep(orgId));
    setLoaded(true);
  }, [q.data, orgId, loaded]);

  const go = (n: number) => {
    const next = Math.max(0, Math.min(LAST, n));
    setStep(next);
    if (orgId && next < LAST) saveStep(orgId, next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const role = ws.session?.role;
  const canConnect = ws.isPlatformAdmin || role === "owner" || role === "admin";
  const connected = q.data?.mode === "own";

  return (
    <div className="min-h-screen bg-canvas-2 text-ink" data-page="setup">
      <div className="h-[5px] bg-[linear-gradient(90deg,#635bff,#a78bfa_22%,#ff5caa_46%,#ff7a59_68%,#ffb03d_84%,#00d4ff)]" aria-hidden />
      <header className="mx-auto flex max-w-[1080px] items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <BrandMark to="/setup" />
        <div className="flex items-center gap-3 text-[12.5px] text-ink-muted">
          <Link to="/guide" target="_blank" className="font-medium text-indigo hover:underline" data-link="guide">
            Full guide
          </Link>
          <span className="hidden truncate sm:inline">{ws.org?.name}</span>
          <button type="button" onClick={() => void ws.signOut()} className="font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline">
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1080px] gap-6 px-4 pb-16 sm:px-6 lg:grid-cols-[250px_1fr] lg:gap-10">
        <Rail step={step} connected={connected} onPick={go} />

        <main className="min-w-0">
          {/* Phones: a slim progress bar in place of the side rail. */}
          <div className="mb-4 lg:hidden">
            <div className="mb-1.5 flex items-center justify-between text-[12px] text-ink-muted">
              <span>
                Step {step + 1} of {STEPS.length}
              </span>
              <span className="font-medium text-ink">{STEPS[step].title}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white">
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#635bff,#ff5caa,#ff7a59)] transition-[width] duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
            </div>
          </div>

          <section className="rounded-[16px] border border-hairline bg-white p-5 shadow-[0_24px_60px_-38px_rgba(6,27,49,0.45)] sm:p-9">
            {q.error ? (
              <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
            ) : !loaded || !q.data ? (
              <div className="space-y-4">
                <Skeleton className="h-11 w-11 rounded-[12px]" />
                <Skeleton className="h-8 w-72" />
                <Skeleton className="h-28" />
              </div>
            ) : !canConnect ? (
              <StepShell step={0} title="Your agency isn't set up yet" lead="The owner of your agency needs to connect its Telnyx account first. Ask them to sign in and finish set-up, then come back.">
                <Button variant="outline" onClick={() => void q.refetch()}>
                  Check again
                </Button>
              </StepShell>
            ) : (
              <div key={step} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                {step === 0 ? <Welcome name={ws.org?.name ?? "your agency"} onNext={() => go(1)} /> : null}
                {step === 1 ? <AccountStep onBack={() => go(0)} onNext={() => go(2)} /> : null}
                {step === 2 ? <CreditStep onBack={() => go(1)} onNext={() => go(3)} /> : null}
                {step === 3 ? <ConnectStep account={q.data} onBack={() => go(2)} onDone={() => go(LAST)} /> : null}
                {step === LAST ? <Done account={q.data} onBack={() => go(3)} /> : null}
              </div>
            )}
          </section>

          <p className="mt-4 flex items-center gap-1.5 px-1 text-[12px] text-ink-muted">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            Your key is stored encrypted and only used to run your own receptionists.
          </p>
        </main>
      </div>
    </div>
  );
}

function Rail({ step, connected, onPick }: { step: number; connected: boolean; onPick: (n: number) => void }) {
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-8">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Set up your agency</p>
        <ol className="relative space-y-1" data-list="setup-steps">
          {STEPS.map((s, i) => {
            const done = connected ? i < LAST || step === LAST : i < step;
            const current = i === step;
            // Steps behind you are always open; the last one only once the account is connected.
            const reachable = i <= step || (connected && i === LAST);
            return (
              <li key={s.key}>
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => onPick(i)}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors",
                    current ? "bg-white shadow-[0_6px_22px_-16px_rgba(6,27,49,0.5)]" : reachable ? "hover:bg-white/70" : "cursor-default opacity-60",
                  )}
                >
                  <span
                    data-hue={s.hue}
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold",
                      done ? "bg-[#0e9f6e] text-white" : current ? "hue-icon ring-2 ring-[var(--hue-line)]" : "border border-hairline bg-white text-ink-muted",
                    )}
                  >
                    {done ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block truncate text-[13.5px] font-medium", current ? "text-ink" : "text-ink-muted")}>{s.title}</span>
                    <span className="block truncate text-[11.5px] text-ink-muted">{s.short}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}

function StepShell({ step, title, lead, children }: { step: number; title: string; lead: ReactNode; children: ReactNode }) {
  const s = STEPS[step];
  return (
    <div data-step={s.key}>
      <span data-hue={s.hue} className="hue-icon mb-5 flex h-11 w-11 items-center justify-center rounded-[12px]" aria-hidden>
        <s.icon className="h-[22px] w-[22px]" />
      </span>
      <h1 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink sm:text-[30px]">{title}</h1>
      <p className="mt-2 max-w-[560px] text-[14.5px] leading-6 text-ink-muted">{lead}</p>
      <div className="mt-7">{children}</div>
    </div>
  );
}

function Nav({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  return (
    <div className="mt-8 flex flex-col-reverse gap-2 border-t border-hairline pt-5 sm:flex-row sm:items-center sm:justify-between">
      {onBack ? (
        <Button type="button" variant="ghost" onClick={onBack} className="text-ink-muted">
          <ArrowLeft /> Back
        </Button>
      ) : (
        <span />
      )}
      <div className="flex flex-col gap-2 sm:flex-row">{children}</div>
    </div>
  );
}

/** Numbered instructions: one action per line. */
function HowTo({ hue, items }: { hue: Hue; items: ReactNode[] }) {
  return (
    <ol className="space-y-3" data-hue={hue}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="hue-icon mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold">{i + 1}</span>
          <span className="min-w-0 text-[14px] leading-6 text-ink">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function OpenLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="outline" className="h-10">
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children} <ExternalLink />
      </a>
    </Button>
  );
}

function Welcome({ name, onNext }: { name: string; onNext: () => void }) {
  const tiles: { icon: LucideIcon; hue: Hue; title: string; body: string }[] = [
    { icon: Plug, hue: "indigo", title: "Your own Telnyx account", body: "Calls and numbers run on a Telnyx account that you own. You pay Telnyx directly, at their prices." },
    { icon: Clock, hue: "magenta", title: "About 15 minutes of your time", body: "Make the account, upgrade it, add credit, paste one key here. Telnyx's own checks can then take a day or two." },
    { icon: CreditCard, hue: "coral", title: "Have these ready", body: "A work email, your mobile, a payment card, your business address, and a LinkedIn or GitHub login for Telnyx's identity check." },
  ];
  return (
    <StepShell step={0} title={`Let's get ${name} live`} lead="Your receptionists answer real phone calls, so the first job is to connect Telnyx, the phone service they run on. We'll walk you through it, then you can start adding clients.">
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.title} data-hue={t.hue} className="rounded-[12px] border border-[var(--hue-line)] bg-[linear-gradient(160deg,var(--hue-faint),#fff_70%)] p-4">
            <span className="hue-icon mb-3 flex h-8 w-8 items-center justify-center rounded-[8px]" aria-hidden>
              <t.icon className="h-4 w-4" />
            </span>
            <div className="text-[13.5px] font-semibold text-ink">{t.title}</div>
            <p className="mt-1 text-[12.5px] leading-5 text-ink-muted">{t.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-5 text-[13px] text-ink-muted">
        Prefer to read it all first, or send it to whoever handles your accounts?{" "}
        <Link to="/guide" target="_blank" className="font-medium text-indigo hover:underline">
          Open the full set-up guide
        </Link>
        .
      </p>
      <Nav>
        <Button onClick={onNext} className="h-10 px-5" data-action="setup-start">
          Start <ArrowRight />
        </Button>
      </Nav>
    </StepShell>
  );
}

function AccountStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <StepShell step={1} title="Create your Telnyx account" lead="Telnyx is the phone company behind your receptionists. The account is free to open and it's yours: you can see every call and charge there.">
      <HowTo
        hue="violet"
        items={[
          <>Open Telnyx and sign up with your work email. Free addresses such as Gmail may be refused.</>,
          <>Click the link in the email Telnyx sends you.</>,
          <>
            In Telnyx, click your profile icon (top right), open <b className="font-semibold">Account Level</b> and click <b className="font-semibold">Upgrade</b>.
          </>,
          <>Follow the prompts: confirm who you are with LinkedIn or GitHub, verify your mobile, turn on two-step sign-in and enter your business address.</>,
        ]}
      />
      <div className="mt-6">
        <OpenLink href={TELNYX_SIGNUP}>Open Telnyx sign-up</OpenLink>
      </div>
      <Notice tone="warning" className="mt-6" title="Don't skip the upgrade">
        A brand-new Telnyx account is a trial: real callers can't get through until it has been upgraded. Already have an upgraded account? Skip ahead.
      </Notice>
      <Nav onBack={onBack}>
        <Button onClick={onNext} className="h-10 px-5" data-action="setup-next">
          I have an account <ArrowRight />
        </Button>
      </Nav>
    </StepShell>
  );
}

function CreditStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <StepShell step={2} title="Add credit to it" lead="Telnyx takes its charges for numbers and call minutes from credit on your account. With no credit, calls don't connect.">
      <HowTo
        hue="magenta"
        items={[
          <>
            In Telnyx, click your profile icon (top right) and open <b className="font-semibold">Billing</b>.
          </>,
          <>
            Click <b className="font-semibold">Make Payment</b> and pay by card. The minimum is US$10.
          </>,
          <>
            Once that payment has gone through, turn on <b className="font-semibold">Auto Recharge</b> on the same page, so the account tops itself up when credit gets low.
          </>,
        ]}
      />
      <div className="mt-6">
        <OpenLink href={TELNYX_PORTAL}>Open Telnyx</OpenLink>
      </div>
      <Notice tone="warning" className="mt-6" title="Don't skip Auto Recharge">
        If credit runs out, your receptionists stop answering until you top up. Telnyx can take up to two working days to approve a new card, so the credit may not show straight away.
      </Notice>
      <Nav onBack={onBack}>
        <Button onClick={onNext} className="h-10 px-5" data-action="setup-next">
          Credit added <ArrowRight />
        </Button>
      </Nav>
    </StepShell>
  );
}

function ConnectStep({ account, onBack, onDone }: { account: PhoneAccount; onBack: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const connect = useMutation({
    mutationFn: () => phoneApi.connect(key.trim()),
    onSuccess: async (acct) => {
      qc.setQueryData(phoneAccountQuery().queryKey, acct);
      // The console lets them in once the session says the account is connected.
      await qc.refetchQueries({ queryKey: ["session"] });
      onDone();
    },
  });

  return (
    <StepShell step={3} title="Connect your account" lead="One key links your Telnyx account to this dashboard. We check it with Telnyx straight away, so you'll know it works.">
      <HowTo
        hue="coral"
        items={[
          <>
            In Telnyx, click your profile icon, then <b className="font-semibold">Account Settings</b>, then <b className="font-semibold">API Keys</b>.
          </>,
          <>
            Click <b className="font-semibold">Create API Key</b>, give it a name and leave Expiration on <b className="font-semibold">No Expiration</b>.
          </>,
          <>
            Copy it straight away. It starts with <code className="rounded bg-canvas-2 px-1 py-0.5 font-mono text-[12.5px]">KEY</code> and is only shown once.
          </>,
          <>Paste it below.</>,
        ]}
      />
      <div className="mt-5">
        <OpenLink href={TELNYX_PORTAL}>Open Telnyx</OpenLink>
      </div>

      <form
        className="mt-7 rounded-[12px] border border-hairline bg-canvas-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) connect.mutate();
        }}
      >
        <label htmlFor="setup-key" className="mb-1.5 block text-[12.5px] font-medium text-ink">
          Your Telnyx API key
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Input
              id="setup-key"
              type={show ? "text" : "password"}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                if (connect.error) connect.reset();
              }}
              placeholder="KEY…"
              autoComplete="off"
              spellCheck={false}
              className="h-10 bg-white pr-10 font-mono text-[13px]"
              data-field="api-key"
            />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide key" : "Show key"} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button type="submit" className="h-10 px-5" disabled={!key.trim() || connect.isPending} data-action="setup-connect">
            {connect.isPending ? (
              <>
                <Loader2 className="animate-spin" /> Checking with Telnyx…
              </>
            ) : (
              <>Check and connect</>
            )}
          </Button>
        </div>
        {connect.error ? (
          <div role="alert" className="mt-3 rounded-[6px] border border-[#ffd0d0] bg-[#fff7f7] px-3 py-2 text-[12.5px] leading-5 text-[#a41d1d]" data-error="api-key">
            {(connect.error as Error).message}
          </div>
        ) : null}
        {account.testKey ? (
          <div className="mt-3 flex flex-col gap-2 rounded-[6px] border border-dashed border-[#c9c5ff] bg-white px-3 py-2 text-[12px] text-ink-muted sm:flex-row sm:items-center sm:justify-between" data-note="test-key">
            <span>Local test server: this pretend key passes the check, no Telnyx account needed.</span>
            <button type="button" className="shrink-0 font-mono font-medium text-indigo hover:underline" onClick={() => setKey(account.testKey!)} data-action="use-test-key">
              Use {account.testKey}
            </button>
          </div>
        ) : null}
      </form>
      <Nav onBack={onBack}>
        <span />
      </Nav>
    </StepShell>
  );
}

function Done({ account, onBack }: { account: PhoneAccount; onBack: () => void }) {
  const connected = account.mode === "own";
  if (!connected) {
    return (
      <StepShell step={LAST} title="One step left" lead="Your Telnyx account isn't connected yet. Go back and paste your key to finish.">
        <Nav onBack={onBack}>
          <span />
        </Nav>
      </StepShell>
    );
  }
  return (
    <StepShell step={LAST} title="You're connected" lead="Your Telnyx account is linked. Add your first client and you can hear its receptionist from the browser in a couple of minutes.">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="animate-in zoom-in-95 fade-in rounded-[12px] border border-[#c8eedf] bg-[linear-gradient(160deg,#f1fbf7,#fff_75%)] p-4 duration-500" data-card="connected">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[#0e6245]">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0e9f6e] text-white">
              <Check className="h-3.5 w-3.5" />
            </span>
            Telnyx account connected
          </div>
          <p className="mt-2 text-[12.5px] text-ink-muted">
            Telnyx key ending <span className="font-mono text-ink">{account.last4}</span>
          </p>
        </div>
        <div className={cn("animate-in zoom-in-95 fade-in rounded-[12px] border p-4 duration-700", account.lowCredit ? "border-[#ffe1b0] bg-[#fff9ee]" : "border-hairline bg-canvas-2")} data-card="credit">
          <div className="text-[12px] text-ink-muted">Credit on your account</div>
          <div className="mt-0.5 text-[24px] font-semibold tracking-[-0.02em] text-ink">{account.balance ? fmtCredit(account.balance) : "—"}</div>
          {account.lowCredit ? <p className="mt-1 text-[12px] text-[#8a4b00]">That's low. Top up in Telnyx before you take real calls.</p> : null}
        </div>
      </div>
      <Notice tone="info" className="mt-4" title="Before real callers can get through">
        Your Telnyx account needs to be upgraded from trial, and each phone number needs Telnyx's approval. Australian numbers need proof of address and take about three days.
      </Notice>
      <Nav>
        <Button asChild variant="outline" className="h-10">
          <Link to="/admin/connections">See connections</Link>
        </Button>
        <Button asChild className="h-10 px-5" data-action="setup-first-client">
          <Link to="/admin/clients/new">
            Add your first client <ArrowRight />
          </Link>
        </Button>
      </Nav>
    </StepShell>
  );
}
