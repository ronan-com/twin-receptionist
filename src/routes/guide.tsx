import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, CreditCard, ExternalLink, KeyRound, Phone, Plug, ShieldCheck, UserPlus, Wallet, type LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/app/BrandMark";
import type { Hue } from "@/components/app/hues";
import { PRODUCT } from "@/lib/app/product";

// The agency set-up guide: what Telnyx is, and how to make the account, upgrade it,
// add credit, create an API key and connect it here. Public (no sign-in), so it can
// be sent to a new agency before they have an account. The Setup wizard links here.
// Telnyx's menu names were checked against Telnyx's own help pages on 26 Nov 2026.

export const Route = createFileRoute("/guide")({
  head: () => ({ meta: [{ title: `Set-up guide · ${PRODUCT}` }] }),
  component: GuidePage,
});

const LINKS = {
  signup: "https://telnyx.com/sign-up",
  upgrade: "https://portal.telnyx.com/#/account/account-levels/upgrade",
  billing: "https://portal.telnyx.com/#/app/billing/payment",
  keys: "https://portal.telnyx.com/#/app/api-keys",
};

type Step = { id: string; icon: LucideIcon; hue: Hue; title: string; time: string; intro: ReactNode; items: ReactNode[]; link?: { href: string; label: string }; note?: { title: string; body: ReactNode } };

const B = ({ children }: { children: ReactNode }) => <b className="font-semibold text-ink">{children}</b>;

const STEPS: Step[] = [
  {
    id: "account",
    icon: UserPlus,
    hue: "violet",
    title: "Create your Telnyx account",
    time: "5 minutes",
    intro: "Telnyx is the phone company your receptionists run on. The account is free to open and it's yours: you see every call and charge there, and you pay Telnyx directly.",
    items: [
      <>Open Telnyx sign-up and register with your work email. Free addresses such as Gmail may be refused.</>,
      <>Click the link in the email Telnyx sends you.</>,
    ],
    link: { href: LINKS.signup, label: "Open Telnyx sign-up" },
  },
  {
    id: "upgrade",
    icon: ShieldCheck,
    hue: "indigo",
    title: "Upgrade it from trial",
    time: "5 minutes, then Telnyx's review",
    intro: "A new Telnyx account starts as a trial. Real callers can't get through to a trial account, so this step matters.",
    items: [
      <>
        In Telnyx, click your profile icon (top right), open <B>Account Level</B> and click <B>Upgrade</B>.
      </>,
      <>Confirm who you are with LinkedIn or GitHub.</>,
      <>Verify your mobile number and turn on two-step sign-in.</>,
      <>Enter your business address.</>,
    ],
    link: { href: LINKS.upgrade, label: "Open Account Level" },
    note: { title: "Can't add credit yet?", body: "Telnyx only lets you pay once the identity check is done. Finish this step first." },
  },
  {
    id: "credit",
    icon: Wallet,
    hue: "magenta",
    title: "Add credit",
    time: "2 minutes, card review up to 2 working days",
    intro: "Telnyx takes its charges for numbers and call minutes from credit on your account. With no credit, calls don't connect.",
    items: [
      <>
        Click your profile icon and open <B>Billing</B>.
      </>,
      <>
        Click <B>Make Payment</B> and pay by card. The minimum is US$10.
      </>,
      <>
        Once that payment has gone through, turn on <B>Auto Recharge</B> on the same page and set a threshold and a recharge amount.
      </>,
      <>
        Check that your Account Level now says <B>Paid</B>.
      </>,
    ],
    link: { href: LINKS.billing, label: "Open Billing" },
    note: { title: "Don't skip Auto Recharge", body: "If credit runs out, your receptionists stop answering until you top up." },
  },
  {
    id: "key",
    icon: KeyRound,
    hue: "coral",
    title: "Create your API key",
    time: "1 minute",
    intro: "The API key is what lets this dashboard run receptionists on your Telnyx account.",
    items: [
      <>
        Click your profile icon, then <B>Account Settings</B>, then <B>API Keys</B>.
      </>,
      <>
        Click <B>Create API Key</B>, give it a name (for example "{PRODUCT}") and leave Expiration on <B>No Expiration</B>.
      </>,
      <>
        Copy it straight away. It starts with <code className="rounded bg-canvas-2 px-1 py-0.5 font-mono text-[12.5px]">KEY</code> and Telnyx only shows it once.
      </>,
    ],
    link: { href: LINKS.keys, label: "Open API Keys" },
    note: { title: "Keep it private", body: "Anyone with the key can spend your Telnyx credit. Paste it only into your dashboard, never into an email or chat." },
  },
  {
    id: "connect",
    icon: Plug,
    hue: "green",
    title: `Connect it to ${PRODUCT}`,
    time: "1 minute",
    intro: "We check the key with Telnyx before saving it, so you know straight away whether it works.",
    items: [
      <>Sign in to your dashboard. A new agency opens on the Setup screen.</>,
      <>
        On the <B>Connect it</B> step, paste the key and click <B>Check and connect</B>.
      </>,
      <>
        A green tick means it's connected. Your credit shows on the <B>Connections</B> page.
      </>,
    ],
    note: { title: "Changing the key later", body: "Open Connections and click Replace key. Use a key from the same Telnyx account: your receptionists live in that account." },
  },
  {
    id: "number",
    icon: Phone,
    hue: "cyan",
    title: "Give each client a phone number",
    time: "Minutes for US numbers, about 3 days for Australian",
    intro: "Each client's receptionist answers its own number. You can test a receptionist from the browser before it has one.",
    items: [
      <>
        Add a client, open its page, click <B>Add a number</B> and choose <B>Buy a new number</B>.
      </>,
      <>Pick a number. You see its monthly price before you buy, and Telnyx charges your account.</>,
      <>Australian numbers need proof of address, and mobiles also need ID. Telnyx approves them in about three days.</>,
    ],
  },
];

const PROBLEMS: { q: string; a: string }[] = [
  { q: "\"Telnyx didn't accept that key\"", a: "Copy it again from API Keys, or create a new one. Check you copied the whole line, starting with KEY." },
  { q: "\"That key belongs to a different Telnyx account\"", a: "Your receptionists were made on another Telnyx account. Use a key from that account." },
  { q: "Callers can't get through", a: "Check that your Account Level says Paid, that you have credit, and that the number shows as connected on the client's page." },
  { q: "Callers hear a Telnyx message before the receptionist", a: "Telnyx may play an automated-call notice on accounts that aren't fully verified. Completing Telnyx's Verified level removes it." },
  { q: "Credit is low", a: "Top up from Billing in Telnyx and make sure Auto Recharge is on. The Connections page warns you below US$5." },
];

function GuidePage() {
  return (
    <div className="min-h-screen bg-canvas-2 text-ink" data-page="guide">
      <div className="h-[5px] bg-[linear-gradient(90deg,#635bff,#a78bfa_22%,#ff5caa_46%,#ff7a59_68%,#ffb03d_84%,#00d4ff)]" aria-hidden />
      <header className="mx-auto flex max-w-[860px] items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <BrandMark to="/guide" />
        <Link to="/login" className="text-[13px] font-medium text-indigo hover:underline">
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-[860px] px-4 pb-16 sm:px-6">
        <section className="rounded-[16px] border border-hairline bg-white p-5 shadow-[0_24px_60px_-38px_rgba(6,27,49,0.45)] sm:p-9">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-indigo">Agency set-up guide</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-[1.15] tracking-[-0.025em] sm:text-[34px]">Connect your phone service</h1>
          <p className="mt-3 max-w-[620px] text-[15px] leading-6 text-ink-muted">
            {PRODUCT} runs your clients' AI receptionists on <B>Telnyx</B>, a phone company. You open your own Telnyx account, add credit, and paste one key into your dashboard. You own the account and pay Telnyx directly for numbers and call minutes.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Fact icon={CreditCard} hue="coral" title="Have ready" body="A work email, your mobile, a payment card, your business address, and a LinkedIn or GitHub login." />
            <Fact icon={UserPlus} hue="violet" title="Your time" body="About 15 minutes, start to finish." />
            <Fact icon={ShieldCheck} hue="green" title="Then Telnyx checks" body="Card and number approvals can take from a few hours to a few days." />
          </div>
          <nav className="mt-6 flex flex-wrap gap-2" aria-label="Steps">
            {STEPS.map((s, i) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-full border border-hairline bg-canvas-2 px-3 py-1 text-[12.5px] text-ink-muted hover:text-ink">
                {i + 1}. {s.title}
              </a>
            ))}
          </nav>
        </section>

        <ol className="mt-5 space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.id} id={s.id} data-hue={s.hue} className="scroll-mt-4 rounded-[14px] border border-hairline bg-white p-5 sm:p-7" data-step={s.id}>
              <div className="flex items-start gap-4">
                <span className="hue-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px]" aria-hidden>
                  <s.icon className="h-[22px] w-[22px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-ink-muted">
                    Step {i + 1} · {s.time}
                  </p>
                  <h2 className="text-[20px] font-semibold tracking-[-0.015em] sm:text-[22px]">{s.title}</h2>
                  <p className="mt-1.5 text-[14px] leading-6 text-ink-muted">{s.intro}</p>
                </div>
              </div>
              <ol className="mt-5 space-y-3 sm:pl-[60px]">
                {s.items.map((item, j) => (
                  <li key={j} className="flex gap-3">
                    <span className="hue-icon mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold">{j + 1}</span>
                    <span className="min-w-0 text-[14.5px] leading-6 text-ink">{item}</span>
                  </li>
                ))}
              </ol>
              {s.link || s.note ? (
                <div className="mt-5 space-y-3 sm:pl-[60px]">
                  {s.link ? (
                    <a href={s.link.href} target="_blank" rel="noreferrer noopener" className="inline-flex h-10 items-center gap-2 rounded-md border border-hairline bg-white px-4 text-[14px] font-medium text-ink shadow-sm hover:bg-canvas-2">
                      {s.link.label} <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                  {s.note ? (
                    <div className="rounded-[8px] border border-[#ffe1b0] bg-[#fff9ee] px-3.5 py-2.5 text-[13px] leading-5 text-[#8a4b00]">
                      <span className="font-semibold">{s.note.title}.</span> {s.note.body}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>

        <section className="mt-5 rounded-[14px] border border-hairline bg-white p-5 sm:p-7" data-section="problems">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-[#b45309]" />
            <h2 className="text-[20px] font-semibold tracking-[-0.015em]">If something goes wrong</h2>
          </div>
          <dl className="mt-4 divide-y divide-hairline">
            {PROBLEMS.map((p) => (
              <div key={p.q} className="py-3">
                <dt className="text-[14px] font-semibold text-ink">{p.q}</dt>
                <dd className="mt-0.5 text-[13.5px] leading-6 text-ink-muted">{p.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="mt-6 flex flex-col gap-3 rounded-[14px] bg-ink px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div>
            <div className="text-[16px] font-semibold">Ready to connect?</div>
            <div className="text-[13px] text-white/70">Sign in and the Setup screen takes you through it.</div>
          </div>
          <Link to="/setup" className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-white px-5 text-[14px] font-medium text-ink hover:bg-white/90">
            Open Setup <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>
    </div>
  );
}

function Fact({ icon: Icon, hue, title, body }: { icon: LucideIcon; hue: Hue; title: string; body: string }) {
  return (
    <div data-hue={hue} className="rounded-[12px] border border-[var(--hue-line)] bg-[linear-gradient(160deg,var(--hue-faint),#fff_70%)] p-4">
      <span className="hue-icon mb-2 flex h-8 w-8 items-center justify-center rounded-[8px]" aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <div className="text-[13.5px] font-semibold">{title}</div>
      <p className="mt-0.5 text-[12.5px] leading-5 text-ink-muted">{body}</p>
    </div>
  );
}
