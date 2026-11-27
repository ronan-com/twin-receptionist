import { useEffect, useState, type ReactNode } from "react";
import { Check, Mic, Pause, Play, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// Short, looping "how to" walkthroughs drawn with CSS: a small mock of the screen, a
// pointer that moves to the next thing to press, and a step list underneath. No video
// files. Every scene reads the brand colour (--indigo) so it matches the agency.

export type GuideKind = "receptionist" | "testcall" | "invite";

type Step = { title: string; hint: string; cursor: [number, number] };

export const GUIDES: Record<GuideKind, { title: string; blurb: string; steps: Step[] }> = {
  receptionist: {
    title: "Make a receptionist",
    blurb: "Five quick choices and it is ready to answer.",
    steps: [
      { title: "Pick a template", hint: "Start from the business type that fits your client.", cursor: [27, 52] },
      { title: "Set the hours", hint: "Say when the business is open. Outside those hours it takes messages.", cursor: [78, 30] },
      { title: "Choose call handling", hint: "Decide what to do with bookings, messages and urgent calls.", cursor: [22, 66] },
      { title: "Pick a voice", hint: "Press play to hear it, then choose the one that sounds right.", cursor: [86, 47] },
      { title: "Create it", hint: "Press Create receptionist. It is live and ready to test.", cursor: [74, 86] },
    ],
  },
  testcall: {
    title: "Make a test call",
    blurb: "Try a receptionist from your browser, no phone needed.",
    steps: [
      { title: "Press Talk to this receptionist", hint: "Open a client, find the receptionist and press the button.", cursor: [50, 60] },
      { title: "Say hello and speak", hint: "Allow the microphone, then talk like a customer would.", cursor: [86, 88] },
      { title: "Read the transcript", hint: "The call appears under Calls with the full transcript.", cursor: [86, 30] },
    ],
  },
  invite: {
    title: "Invite a client",
    blurb: "Send an onboarding link so the client finishes their own setup.",
    steps: [
      { title: "Open Clients and add a client", hint: "Choose Add client, then Send the client an onboarding link.", cursor: [83, 20] },
      { title: "Enter their name and email", hint: "We email them a link. You can also copy it and send it yourself.", cursor: [40, 62] },
      { title: "Press Create and get link", hint: "They set up their business and receptionist in their own workspace.", cursor: [74, 86] },
    ],
  },
};

const STEP_MS = 3200;

export function GuideAnimation({ kind, className }: { kind: GuideKind; className?: string }) {
  const guide = GUIDES[kind];
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(!reduce);
  const [tick, setTick] = useState(0); // restarts the scene's entrance animation

  useEffect(() => {
    setStep(0);
    setTick(0);
  }, [kind]);

  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => {
      setStep((s) => (s + 1) % guide.steps.length);
      setTick((n) => n + 1);
    }, STEP_MS);
    return () => window.clearTimeout(t);
  }, [playing, step, tick, guide.steps.length]);

  const go = (i: number) => {
    setStep(i);
    setTick((n) => n + 1);
    setPlaying(false);
  };
  const cur = guide.steps[step];

  return (
    <div className={cn("space-y-3", className)} data-guide={kind} data-guide-step={step}>
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-hairline bg-canvas-2 shadow-sm" aria-hidden>
        <div className="flex h-6 items-center gap-1.5 border-b border-hairline bg-white px-3">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ff6b5e]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#f5b72e]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#4cc77a]" />
          <span className="ml-3 h-2 w-28 rounded-full bg-canvas-2" />
        </div>
        <div className="absolute inset-x-0 bottom-0 top-6" key={`${kind}-${step}-${tick}`}>
          <div className="gs-scene h-full p-3 sm:p-4">
            {kind === "receptionist" ? <ReceptionistScene step={step} /> : kind === "testcall" ? <TestCallScene step={step} /> : <InviteScene step={step} />}
          </div>
        </div>
        <span
          className="gs-cursor pointer-events-none absolute z-10 -translate-x-1 -translate-y-1"
          style={{ left: `${cur.cursor[0]}%`, top: `${cur.cursor[1]}%` }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" className="drop-shadow-md">
            <path d="M3 2l12 6.2-5.2 1.6L8 15.4z" fill="#0a2540" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span key={`ring-${step}-${tick}`} className="gs-click absolute -left-1 -top-1 h-5 w-5 rounded-full border-2 border-indigo" />
        </span>
      </div>

      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink" aria-live="polite">
            {step + 1}. {cur.title}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">{cur.hint}</p>
        </div>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hairline text-ink-muted hover:bg-canvas-2 hover:text-ink"
          aria-label={playing ? "Pause the animation" : "Play the animation"}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
      </div>

      <ol className="flex gap-1.5" aria-label="Steps">
        {guide.steps.map((s, i) => (
          <li key={s.title} className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => go(i)}
              aria-label={`Step ${i + 1}: ${s.title}`}
              aria-current={i === step ? "step" : undefined}
              className="group block w-full py-1.5"
            >
              <span className="relative block h-1 overflow-hidden rounded-full bg-hairline">
                <span
                  key={i === step ? `${tick}-${playing}` : "x"}
                  className={cn("absolute inset-y-0 left-0 rounded-full bg-indigo", i < step && "w-full", i > step && "w-0", i === step && (playing ? "gs-fill" : "w-full"))}
                  style={i === step && playing ? { animationDuration: `${STEP_MS}ms` } : undefined}
                />
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------ scene pieces ------------------------------ */

const Bar = ({ w, className }: { w: string; className?: string }) => <span className={cn("block h-2 rounded-full bg-[#dfe6ee]", className)} style={{ width: w }} />;

function Pill({ children, on, className }: { children: ReactNode; on?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors sm:text-[11px]",
        on ? "border-indigo bg-[color-mix(in_srgb,var(--indigo)_12%,#fff)] text-[var(--primary-ink,var(--indigo))]" : "border-hairline bg-white text-ink-muted",
        className,
      )}
    >
      {on ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
      {children}
    </span>
  );
}

function MockButton({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center justify-center rounded-md bg-indigo px-3 py-1.5 text-[10px] font-semibold text-white shadow-sm sm:text-[11px]", className)}>{children}</span>;
}

function Wave({ active }: { active: boolean }) {
  return (
    <span className="inline-flex h-5 items-center gap-[3px]">
      {[5, 11, 16, 9, 14, 7, 12, 5].map((h, i) => (
        <span key={i} className={cn("w-[3px] origin-center rounded-full bg-indigo", active && "gs-wave")} style={{ height: h, animationDelay: `${i * 0.08}s` }} />
      ))}
    </span>
  );
}

function ReceptionistScene({ step }: { step: number }) {
  if (step === 0)
    return (
      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-ink">What kind of business?</div>
        <div className="grid grid-cols-2 gap-2">
          {["Dental clinic", "Salon", "Plumber", "Childcare"].map((t, i) => (
            <div key={t} className={cn("rounded-lg border bg-white p-2.5", i === 1 ? "gs-pick border-indigo ring-2 ring-[color-mix(in_srgb,var(--indigo)_25%,transparent)]" : "border-hairline")}>
              <div className="mb-1.5 flex h-5 w-5 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--indigo)_12%,#fff)]">
                <Sparkles className="h-3 w-3 text-indigo" />
              </div>
              <div className="text-[11px] font-medium text-ink">{t}</div>
              <Bar w="70%" className="mt-1.5" />
            </div>
          ))}
        </div>
      </div>
    );
  if (step === 1)
    return (
      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-ink">When are you open?</div>
        <div className="rounded-lg border border-hairline bg-white p-2.5">
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, i) => (
            <div key={d} className="flex items-center gap-2 border-b border-hairline py-1 last:border-0">
              <span className="w-8 text-[10px] text-ink-muted">{d}</span>
              <span className="gs-fade rounded bg-canvas-2 px-1.5 py-0.5 text-[10px] text-ink" style={{ animationDelay: `${i * 0.12}s` }}>9:00 am</span>
              <span className="text-[10px] text-ink-muted">to</span>
              <span className="gs-fade rounded bg-canvas-2 px-1.5 py-0.5 text-[10px] text-ink" style={{ animationDelay: `${i * 0.12}s` }}>5:00 pm</span>
            </div>
          ))}
        </div>
      </div>
    );
  if (step === 2)
    return (
      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-ink">What should it do on a call?</div>
        <div className="space-y-1.5 rounded-lg border border-hairline bg-white p-2.5">
          {[
            ["Take a message", true],
            ["Book appointments", true],
            ["Pass urgent calls to a person", true],
            ["Send a text after the call", false],
          ].map(([l, on], i) => (
            <div key={String(l)} className="gs-fade flex items-center justify-between" style={{ animationDelay: `${i * 0.15}s` }}>
              <span className="text-[11px] text-ink">{l}</span>
              <span className={cn("relative h-3.5 w-6 rounded-full", on ? "bg-indigo" : "bg-[#d3dbe5]")}>
                <span className={cn("absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white", on ? "right-0.5" : "left-0.5")} />
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  if (step === 3)
    return (
      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-ink">Choose a voice</div>
        <div className="space-y-1.5">
          {["Olivia", "Henry", "Grace"].map((v, i) => (
            <div key={v} className={cn("flex items-center gap-2 rounded-lg border bg-white px-2.5 py-2", i === 1 ? "gs-pick border-indigo" : "border-hairline")}>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo text-white">
                <Play className="h-2.5 w-2.5 fill-current" />
              </span>
              <span className="w-12 text-[11px] font-medium text-ink">{v}</span>
              <Wave active={i === 1} />
              {i === 1 ? <Check className="ml-auto h-3.5 w-3.5 text-indigo" strokeWidth={3} /> : null}
            </div>
          ))}
        </div>
      </div>
    );
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="gs-pop flex h-12 w-12 items-center justify-center rounded-full bg-indigo text-white shadow-md">
        <Check className="h-6 w-6" strokeWidth={3} />
      </div>
      <div>
        <div className="text-[13px] font-semibold text-ink">Your receptionist is ready</div>
        <div className="text-[11px] text-ink-muted">Your new receptionist can take a test call now.</div>
      </div>
      <MockButton className="gs-press">Create receptionist</MockButton>
    </div>
  );
}

function TestCallScene({ step }: { step: number }) {
  if (step === 0)
    return (
      <div className="flex h-full flex-col justify-center gap-3">
        <div className="rounded-lg border border-hairline bg-white p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--indigo)_14%,#fff)] text-[11px] font-semibold text-indigo">C</span>
            <div>
              <div className="text-[11px] font-semibold text-ink">Receptionist</div>
              <Bar w="60px" className="mt-1" />
            </div>
          </div>
          <div className="text-[10.5px] font-medium text-ink">Test call</div>
          <MockButton className="gs-press mt-1.5 w-full gap-1">
            <Mic className="h-3 w-3" /> Talk to this receptionist
          </MockButton>
        </div>
      </div>
    );
  if (step === 1)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="relative flex h-14 w-14 items-center justify-center">
          <span className="gs-ring absolute inset-0 rounded-full bg-indigo/30" />
          <span className="gs-ring absolute inset-0 rounded-full bg-indigo/30" style={{ animationDelay: "0.6s" }} />
          <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-indigo text-white shadow-md">
            <Mic className="h-5 w-5" />
          </span>
        </div>
        <Wave active />
        <div className="rounded-full bg-white px-3 py-1 text-[11px] text-ink shadow-sm ring-1 ring-hairline">"Hi, I'd like to book a check-up"</div>
      </div>
    );
  const lines: [string, string][] = [
    ["AI", `Thanks for calling. How can I help?`],
    ["You", "I'd like to book a check-up."],
    ["AI", "Of course. What day suits you?"],
  ];
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold text-ink">Calls · Test call</div>
      <div className="space-y-1.5 rounded-lg border border-hairline bg-white p-2.5">
        {lines.map(([who, text], i) => (
          <div key={text} className={cn("gs-fade flex gap-1.5", who === "You" && "flex-row-reverse")} style={{ animationDelay: `${0.3 + i * 0.7}s` }}>
            <span className={cn("max-w-[78%] rounded-lg px-2 py-1 text-[10.5px] leading-snug", who === "You" ? "bg-indigo text-white" : "bg-canvas-2 text-ink")}>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InviteScene({ step }: { step: number }) {
  if (step === 0)
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold text-ink">Clients</div>
          <MockButton className="gs-press">Add client</MockButton>
        </div>
        <div className="rounded-lg border border-hairline bg-white">
          {["Bright Smiles Dental", "Harbour Plumbing"].map((n) => (
            <div key={n} className="flex items-center gap-2 border-b border-hairline px-2.5 py-2 last:border-0">
              <span className="h-5 w-5 rounded-full bg-[#dfe6ee]" />
              <span className="text-[11px] text-ink">{n}</span>
            </div>
          ))}
        </div>
      </div>
    );
  if (step === 1)
    return (
      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-ink">Send the client an onboarding link</div>
        <div className="space-y-1.5 rounded-lg border border-hairline bg-white p-2.5">
          <div className="text-[10px] text-ink-muted">Business name</div>
          <div className="gs-type rounded border border-hairline bg-canvas-2 px-2 py-1 text-[11px] text-ink">Sunny Days Childcare</div>
          <div className="text-[10px] text-ink-muted">Their email</div>
          <div className="gs-type rounded border border-indigo bg-white px-2 py-1 text-[11px] text-ink" style={{ animationDelay: "0.9s" }}>owner@sunnydays.com</div>
        </div>
      </div>
    );
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 text-center">
      <div className="gs-pop flex h-11 w-11 items-center justify-center rounded-full bg-indigo text-white shadow-md">
        <Send className="h-5 w-5" />
      </div>
      <div className="text-[13px] font-semibold text-ink">Onboarding link sent</div>
      <div className="w-4/5 truncate rounded border border-hairline bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">…/invite/k3x9a2c7e1</div>
      <MockButton className="gs-press">Create and get link</MockButton>
    </div>
  );
}
