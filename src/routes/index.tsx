import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { OTHER_BRAND } from "@/lib/app/product";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";


import {
  Phone,
  Calendar,
  MessageSquare,
  Check,
  ChevronRight,
  FileText,
  Mail,
  Menu,
  X,
  Wrench,
  Maximize2,
  Plus,
  CalendarCheck,
  CalendarDays,
} from "lucide-react";
import CallGlobe from "@/components/CallGlobe";
import RealCallDemo from "@/components/RealCallDemo";
import HeroRibbonCanvas from "@/components/HeroRibbonCanvas";
import googleCalendarLogo from "@/assets/integrations/google-calendar.svg";

import healthcareImg from "@/assets/industries/healthcare.jpg";

import salonImg from "@/assets/industries/salon.jpg";
import hotelImg from "@/assets/industries/hotel.jpg";
import realestateImg from "@/assets/industries/realestate.jpg";
import lawImg from "@/assets/industries/law.jpg";
import tradesImg from "@/assets/industries/trades.jpg";

// Ported from Answered's marketing homepage. Copy changes from the original are
// deliberate (honest claims for this engine); see the area M report.
export const Route = createFileRoute("/")({
  // The marketing page is Answered's own. A copy sold under another name has its
  // public site elsewhere, so "/" goes straight to sign-in.
  beforeLoad: () => {
    if (OTHER_BRAND) throw redirect({ to: "/login", replace: true });
  },
  head: () => ({ meta: [{ title: "Answered — The AI Receptionist" }] }),
  component: Index,
});

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`gutter mx-auto w-full max-w-[1180px] ${className}`}>{children}</div>;
}


function Reveal({
  children,
  delay = 0,
  y = 12,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* Stripe H2: 22px / 300 / 1.2 / -0.01em on mobile */
function SectionHeading({
  eyebrow,
  children,
  className = "",
}: {
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {eyebrow ? (
        <Reveal>
          <div className="text-[12px] font-semibold leading-none text-indigo">{eyebrow}</div>
        </Reveal>
      ) : null}
      <Reveal delay={0.05}>
        <h2 className="display-strong mt-3 text-[28px] leading-[1.14] md:text-[38px] lg:text-[42px]">
          {children}
        </h2>
      </Reveal>

    </div>
  );
}

/* Stripe control: rectangular, 44px, 4px radius, 16px text */
type SignupAs = "business" | "agency";

/** In-page anchors ("#demo") stay plain links; app routes go through the router. */
function SmartLink({
  href,
  as,
  className,
  onClick,
  children,
}: {
  href: string;
  as?: SignupAs;
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  if (href === "/signup") {
    return (
      <Link to="/signup" search={as ? { as } : {}} className={className} onClick={onClick}>
        {children}
      </Link>
    );
  }
  if (href === "/login" || href === "/") {
    return (
      <Link to={href} className={className} onClick={onClick}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

function CTA({
  children,
  variant = "primary",
  href = "#demo",
  as,
  block = false,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "link";
  href?: string;
  as?: SignupAs;
  block?: boolean;
}) {
  if (variant === "link") {
    return (
      <SmartLink
        href={href}
        as={as}
        className="group inline-flex min-h-[44px] items-center gap-1 text-[16px] font-medium text-indigo transition-colors hover:text-indigo-deep"
      >
        {children}
        <ChevronRight
          className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
          strokeWidth={2.25}
        />
      </SmartLink>
    );
  }
  const styles =
    variant === "primary"
      ? "bg-[#533AFD] text-white hover:bg-[#635BFF]"
      : "bg-white text-slate-deep border border-hairline hover:border-slate-deep/25";
  return (
    <SmartLink
      href={href}
      as={as}
      className={`group inline-flex h-11 items-center justify-center gap-1.5 rounded-[4px] px-5 text-[16px] font-medium transition-colors duration-200 ${styles} ${
        block ? "w-full sm:w-auto" : ""
      }`}
    >
      <span>{children}</span>
      <ChevronRight
        className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
        strokeWidth={2.25}
      />
    </SmartLink>
  );
}

/* Small square action control used at the top-right of product panels */
function PanelAction({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      title={label}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-[4px] border border-hairline bg-white text-indigo"
    >
      <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
    </span>
  );
}

function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel flex h-full flex-col ${className}`}>
      <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
        <h3 className="display-strong max-w-[26ch] text-[22px]">
          {title}
        </h3>
        {action ? <PanelAction label={action} /> : null}
      </div>

      <div className="relative flex-1">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Nav                                                                        */
/* -------------------------------------------------------------------------- */

const NAV_LINKS = [
  { label: "How it works", href: "#demo" },
  { label: "Industries", href: "#industries" },
  { label: "Dashboard", href: "#dashboard" },
  { label: "FAQ", href: "#faq" },
];

function LogoWave() {
  const bars = 18;
  return (
    <div className="flex h-[9px] items-center gap-[2px]">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-indigo"
          style={{
            height: `${30 + Math.sin(i * 0.7) * 18 + 20}%`,
            animation: `wave 1.6s ease-in-out ${i * 70}ms infinite`,
          }}
        />
      ))}
    </div>
  );
}

function Nav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="absolute inset-x-0 top-0 z-50">
      <Container className="flex h-[66px] items-center justify-between gap-4">
        <Link to="/" aria-label="Answered home" className="flex min-w-0 shrink-0 flex-col items-start gap-[3px]">
          <span className="text-[22px] font-bold leading-none tracking-[-0.02em] text-slate-deep">
            Answered
          </span>
          <LogoWave />
        </Link>

        <nav className="hidden items-center gap-7 text-[15px] font-medium text-slate-deep md:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="transition-colors hover:text-indigo">
              {l.label}
            </a>
          ))}
          <Link to="/login" className="transition-colors hover:text-indigo">
            Sign in
          </Link>
          <Link
            to="/signup"
            className="inline-flex h-9 items-center rounded-[4px] bg-[#533AFD] px-4 text-[15px] font-medium text-white transition-colors hover:bg-[#635BFF]"
          >
            Get started
          </Link>
        </nav>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[4px] bg-white text-indigo shadow-[0_1px_2px_rgba(6,27,49,0.12)] md:hidden"
        >
          {open ? <X className="h-5 w-5" strokeWidth={2} /> : <Menu className="h-5 w-5" strokeWidth={2} />}
        </button>
      </Container>

      <motion.div
        id="mobile-menu"
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden border-b border-hairline bg-white md:hidden"
      >
        <Container className="py-1">
          {[...NAV_LINKS, { label: "Sign in", href: "/login" }, { label: "Get started", href: "/signup" }].map((l) => (
            <SmartLink
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="flex min-h-[52px] items-center justify-between border-b border-hairline text-[16px] font-medium text-slate-deep last:border-b-0"
            >
              {l.label}
              <ChevronRight className="h-4 w-4 text-slate-deep/35" strokeWidth={2} />
            </SmartLink>
          ))}
        </Container>
      </motion.div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

function Waveform() {
  const bars = 20;
  return (
    <div className="flex h-5 items-center gap-[2px]">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-indigo"
          style={{
            height: `${15 + Math.sin(i * 0.7) * 12 + 15}%`,
            animation: `wave 1.6s ease-in-out ${i * 70}ms infinite`,
          }}
        />
      ))}
    </div>
  );
}

function LiveCallCard() {
  const lines = [
    { who: "Caller", text: "Hi, I'd like to book a cleaning next Thursday." },
    { who: "Answered", text: "Of course. I have 10:30 or 2:15, which suits?" },
    { who: "Caller", text: "Two-fifteen is perfect." },
    { who: "Answered", text: "Booked. See you Thursday at 2:15." },
  ];
  return (
    <div className="panel w-full max-w-[358px] p-4 shadow-[0_2px_5px_rgba(6,27,49,0.06)]">
      <div className="flex items-center justify-between gap-3 border-b border-hairline pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative shrink-0">
            <span className="pulse-ring absolute inset-0 rounded-full bg-indigo/30" />
            <span className="relative grid h-8 w-8 place-items-center rounded-full bg-indigo text-white">
              <Phone className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-slate-deep">Incoming, 03:42</div>
            <div className="text-[12px] leading-snug text-ink-muted">
              New caller · Sydney
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-600">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Live
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {lines.map((l, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 + i * 0.45, duration: 0.45 }}
            className="text-[13px] leading-[1.5]"
          >
            <span className="mr-1.5 text-[11px] font-semibold text-indigo">{l.who}</span>
            <span className={l.who === "Answered" ? "text-slate-deep" : "text-ink-muted"}>
              {l.text}
            </span>
          </motion.div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3">
        <Waveform />
        <div className="font-mono text-[11px] text-ink-muted">Live transcript</div>
      </div>
    </div>
  );
}

function BookingCard() {
  return (
    <div className="panel w-full max-w-[358px] p-4 shadow-[0_2px_5px_rgba(6,27,49,0.06)] sm:max-w-[262px]">

      <div className="flex items-center gap-2 text-[12px] font-medium text-indigo">
        <Calendar className="h-3.5 w-3.5" />
        Thu · 14 Nov
      </div>
      <div className="mt-2 text-[15px] font-medium text-slate-deep">Deep clean · 14:15</div>
      <div className="mt-1 text-[13px] text-ink-muted">Confirmed to Sarah C.</div>
      <div className="mt-3 flex items-center gap-2 rounded-[4px] bg-canvas-2 px-2.5 py-2 text-[12px] text-slate-deep">
        <Check className="h-3.5 w-3.5 text-emerald-500" />
        Added to your calendar
      </div>
    </div>
  );
}

function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 50]);

  return (
    <section ref={ref} className="relative isolate overflow-hidden bg-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[520px] md:h-[720px]">
        <HeroRibbonCanvas />
      </div>
      <Container className="relative z-10 pt-[92px] pb-14 md:pt-[128px] md:pb-24">
        <motion.div style={{ y }} className="max-w-[760px]">
          <Reveal delay={0.05}>
            <h1 className="display-strong max-w-[13ch] text-[38px] leading-[1.04] md:text-[60px] lg:text-[66px]">
              Every call, answered.
            </h1>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mt-5 max-w-[34ch] text-[16px] leading-[1.6] text-ink-muted sm:max-w-[52ch] md:text-[18px]">
              Never Miss Another Customer Enquiry. Your{" "}
              <strong className="font-semibold text-slate-deep">AI receptionist</strong> answers calls,
              replies to messages, books appointments and flags the customers who need a follow-up.
            </p>
            <div className="mt-7 flex flex-col items-stretch gap-3 sm:w-fit">
              <CTA block href="/signup">Get started</CTA>
              <CTA block variant="secondary" href="#demo">Hear it in action</CTA>
            </div>
          </Reveal>

          <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:gap-4 md:mt-12">
            <LiveCallCard />
            <BookingCard />
          </div>
        </motion.div>
      </Container>
    </section>

  );
}


/* -------------------------------------------------------------------------- */
/* Product theatre                                                            */
/* -------------------------------------------------------------------------- */

function ProductTheatre() {
  return (
    <section id="demo" className="relative overflow-hidden border-t border-hairline bg-canvas-2 py-12 md:py-20">
      <Container>
        <div className="mb-6 max-w-2xl md:mb-8">
          <p className="text-[12px] font-semibold text-indigo">Hear it in action</p>
          <h2 className="display-strong mt-3 text-[28px] md:text-[42px]">From first hello to booked.</h2>
          <p className="mt-3 max-w-[58ch] text-[16px] leading-[1.6] text-ink-muted">Listen to an example conversation as a new patient enquiry becomes a confirmed appointment.</p>
        </div>
        <RealCallDemo />
      </Container>

    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Entire office                                                              */
/* -------------------------------------------------------------------------- */

const OFFICE_TASKS = [
  { icon: Phone, label: "Answers every call", detail: "Captures incoming enquiries", iconClass: "text-indigo", tintClass: "bg-indigo/10", edgeClass: "border-l-indigo", glowClass: "bg-indigo/10" },
  { icon: Calendar, label: "Books appointments", detail: "Finds suitable appointment times", iconClass: "text-cyan-600", tintClass: "bg-cyan-50", edgeClass: "border-l-cyan", glowClass: "bg-cyan/10" },
  {
    icon: MessageSquare,
    label: "Replies to messages",
    detail: "Handles customer messages",
    iconClass: "text-fuchsia-600",
    tintClass: "bg-fuchsia-50",
    edgeClass: "border-l-magenta",
    glowClass: "bg-magenta/10",
  },
  { icon: Mail, label: "Flags follow-ups", detail: "Shows who needs a call back", iconClass: "text-coral", tintClass: "bg-rose-50", edgeClass: "border-l-coral", glowClass: "bg-coral/10" },
  { icon: FileText, label: "Logs every note", detail: "Records conversation details", iconClass: "text-indigo-deep", tintClass: "bg-indigo/10", edgeClass: "border-l-indigo-deep", glowClass: "bg-indigo/10" },
  {
    icon: Wrench,
    label: "Keeps you in the loop",
    detail: "Every call and booking in your dashboard",
    iconClass: "text-emerald-600",
    tintClass: "bg-emerald-50",
    edgeClass: "border-l-emerald-500",
    glowClass: "bg-emerald-100",
  },
];

function OfficeActivityCard({
  task,
  index,
  activeIndex,
  reduceMotion,
  onActivate,
}: {
  task: (typeof OFFICE_TASKS)[number];
  index: number;
  activeIndex: number;
  reduceMotion: boolean;
  onActivate: (index: number) => void;
}) {
  const active = activeIndex === index;
  const Icon = task.icon;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={() => onActivate(index)}
      onFocus={() => onActivate(index)}
      onPointerEnter={() => onActivate(index)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate(index);
        }
      }}
      animate={reduceMotion ? undefined : { x: active ? 7 : index % 2 === 0 ? 0 : 2, y: active ? -2 : 0, scale: active ? 1.012 : 1, opacity: active ? 1 : 0.96 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className={`group relative flex min-h-[64px] origin-center cursor-pointer items-center gap-3 rounded-md border border-l-[3px] bg-card px-3.5 py-2 text-left outline-none transition-[border-color,box-shadow] duration-200 ${active ? `${task.edgeClass} border-y-indigo/15 border-r-indigo/15 shadow-[0_12px_28px_-20px_rgba(83,58,253,0.55)]` : "border-hairline border-l-hairline shadow-sm hover:border-indigo/20"}`}
    >
      <span aria-hidden className={`absolute -inset-2 -z-10 rounded-lg blur-xl transition-opacity duration-300 ${task.glowClass} ${active ? "opacity-100" : "opacity-0"}`} />
      <motion.span animate={reduceMotion || !active ? { scale: 1 } : { scale: [1, 1.12, 1] }} transition={{ duration: 0.42 }} className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${task.tintClass} ${task.iconClass}`}>
        <Icon className="h-[19px] w-[19px]" fill="none" strokeWidth={1.9} />
      </motion.span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold leading-tight text-slate-deep sm:text-[15px]">{task.label}</span>
        <span className="mt-0.5 block text-[11px] leading-tight text-ink-muted sm:text-[12px]">{task.detail}</span>
      </span>
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 transition-opacity ${active ? "opacity-100" : "opacity-60"}`}>
        <motion.span animate={reduceMotion || !active ? { scale: 1 } : { scale: [0.72, 1.08, 1] }} transition={{ duration: 0.34 }}><Check className="h-4 w-4" strokeWidth={2.4} /></motion.span>
      </span>
    </motion.div>
  );
}

function EntireOffice() {
  const sectionRef = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const [motionPreferenceReady, setMotionPreferenceReady] = useState(false);
  const reduceMotion = motionPreferenceReady && Boolean(prefersReducedMotion);
  const [activeIndex, setActiveIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [interacting, setInteracting] = useState(false);
  const [autoDone, setAutoDone] = useState(false);

  useEffect(() => setMotionPreferenceReady(true), []);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.28 });
    observer.observe(node);
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (reduceMotion || interacting || autoDone || !visible || !pageVisible) return;
    const timer = window.setTimeout(() => {
      setActiveIndex((current) => {
        if (current >= OFFICE_TASKS.length - 1) {
          setAutoDone(true);
          return current;
        }
        return current + 1;
      });
    }, 950);
    return () => window.clearTimeout(timer);
  }, [activeIndex, autoDone, interacting, pageVisible, reduceMotion, visible]);

  const activateTask = (index: number) => {
    setActiveIndex(index);
    setInteracting(true);
    setAutoDone(true);
  };

  return (
    <section ref={sectionRef} className="relative border-t border-hairline bg-white py-12 md:py-24">
      <Container>
        <div className="grid items-center gap-8 md:grid-cols-12 md:gap-12">
          <div className="md:col-span-5 md:py-8">
            <SectionHeading>Your reception, taken care of.</SectionHeading>
            <Reveal delay={0.1}>
              <p className="mt-4 max-w-md text-[16px] leading-[1.55] text-ink-muted">
                Answered takes care of the day-to-day reception tasks, making life easier for you and your team.
              </p>
            </Reveal>
          </div>
          <div className="md:col-span-7">
            <div
              className="relative space-y-2.5 overflow-visible px-3 py-3 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-[radial-gradient(ellipse_at_center,rgba(99,91,255,0.09),transparent_68%)] sm:px-5 md:px-7"
              aria-label="Reception capabilities"
              onPointerEnter={() => setInteracting(true)}
              onPointerLeave={() => setInteracting(false)}
              onFocusCapture={() => setInteracting(true)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false);
              }}
            >
              {OFFICE_TASKS.map((task, index) => (
                 <OfficeActivityCard key={task.label} task={task} index={index} activeIndex={activeIndex} reduceMotion={Boolean(reduceMotion)} onActivate={activateTask} />
              ))}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Integrations                                                               */
/* -------------------------------------------------------------------------- */

/* Calendars: the built-in calendar works today; Google Calendar and Outlook are
   built in the engine but not switched on for this site yet, so they say "Coming soon"
   and their routes are dashed. (Xero and ServiceM8 from the original are not offered.) */
const CALENDAR_NODES = [
  { id: "builtin", label: "Built-in calendar", status: "Included", live: true, path: "M174 132 C140 105 116 83 92 72", color: "var(--indigo)", delay: 0, cx: 70, cy: 62 },
  { id: "outlook", label: "Outlook", status: "Coming soon", live: false, path: "M226 132 C260 105 284 83 308 72", color: "var(--cyan)", delay: 0.8, cx: 330, cy: 62 },
  { id: "google", label: "Google Calendar", status: "Coming soon", live: false, path: "M200 192 C200 200 200 204 200 208", color: "var(--coral)", delay: 1.6, cx: 200, cy: 238 },
] as const;

function Integrations() {
  const networkRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [networkVisible, setNetworkVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    const node = networkRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setNetworkVisible(entry.isIntersecting), { threshold: 0.1 });
    observer.observe(node);
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const pulsesRun = networkVisible && pageVisible && !reduceMotion;
  const activeNode = focusedNode ?? selectedNode;
  const activateNode = (id: string) => setSelectedNode((current) => current === id ? null : id);
  const nodeKeyDown = (event: React.KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activateNode(id);
  };

  return (
    <section className="relative border-t border-hairline bg-white py-12 md:py-24">
        <Container>
          <div className="grid gap-8 md:grid-cols-12 md:items-center md:gap-12">
            <div className="md:col-span-5">
              <Reveal>
                <h2 className="display-strong text-[28px] leading-[1.14] md:text-[38px] lg:text-[42px]">
                  Bookings land in <span className="text-indigo">your calendar</span>
                </h2>
              </Reveal>
              <Reveal delay={0.1}>
                <p className="mt-4 max-w-md text-[16px] leading-[1.55] text-ink-muted">
                  Answered books into its built-in calendar today, around your business hours. Google Calendar and Outlook connections are coming soon.
                </p>
              </Reveal>
            </div>

            <div className="md:col-span-7">
              <div ref={networkRef} className="relative mx-auto aspect-[4/3] w-[300px] max-w-full md:w-[400px]">
                <svg viewBox="0 0 400 300" className="h-full w-full overflow-visible" fill="none" role="img" aria-label="Answered books into its built-in calendar. Google Calendar and Outlook are coming soon.">
                  <defs>
                    <filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="5" stdDeviation="6" floodColor="var(--slate-deep)" floodOpacity="0.12" /></filter>
                    <filter id="hub-glow" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="0" stdDeviation="10" floodColor="var(--indigo)" floodOpacity="0.22" /></filter>
                  </defs>
                  {CALENDAR_NODES.map((item) => (
                    <g key={item.id} className={`transition-opacity duration-200 ${activeNode && activeNode !== item.id ? "opacity-30" : "opacity-100"}`}>
                      <path d={item.path} stroke={item.color} strokeOpacity={activeNode === item.id ? "0.9" : "0.34"} strokeWidth={activeNode === item.id ? "2.4" : "1.5"} strokeDasharray={item.live ? undefined : "4 5"} />
                      {pulsesRun && item.live ? <circle r="3" fill={item.color}><animateMotion path={item.path} dur="2.7s" begin={`${item.delay}s`} repeatCount="indefinite" /></circle> : null}
                    </g>
                  ))}

                  {CALENDAR_NODES.map((item) => {
                    const r = item.id === "google" ? 30 : 32;
                    const labelY = item.cy + r + 17;
                    return (
                      <motion.g key={item.id} tabIndex={0} role="button" aria-label={`${item.label}: ${item.status}`} aria-pressed={selectedNode === item.id} onClick={() => activateNode(item.id)} onKeyDown={(event) => nodeKeyDown(event, item.id)} onFocus={() => setFocusedNode(item.id)} onBlur={() => setFocusedNode(null)} onMouseEnter={() => setFocusedNode(item.id)} onMouseLeave={() => setFocusedNode(null)} animate={{ scale: activeNode === item.id ? 1.06 : 1 }} style={{ transformOrigin: `${item.cx}px ${item.cy}px`, cursor: "pointer" }}>
                        <circle cx={item.cx} cy={item.cy} r={r} fill="var(--card)" stroke="var(--hairline)" filter="url(#node-shadow)" />
                        {item.id === "google" ? (
                          <image href={googleCalendarLogo} x={item.cx - 16} y={item.cy - 16} width="32" height="32" preserveAspectRatio="xMidYMid meet" />
                        ) : item.id === "builtin" ? (
                          <CalendarCheck x={item.cx - 15} y={item.cy - 15} width={30} height={30} color="var(--indigo)" strokeWidth={1.8} />
                        ) : (
                          <CalendarDays x={item.cx - 15} y={item.cy - 15} width={30} height={30} color="#0a6fd6" strokeWidth={1.8} />
                        )}
                        <text x={item.cx} y={labelY} textAnchor="middle" fill="var(--slate-deep)" fontSize="13" fontWeight="600">{item.label}</text>
                        <text x={item.cx} y={labelY + 15} textAnchor="middle" fill={item.live ? "#059669" : "var(--ink-muted)"} fontSize="11" fontWeight="500">{item.status}</text>
                      </motion.g>
                    );
                  })}

                  <motion.circle cx="200" cy="152" r="50" fill="none" stroke="var(--indigo)" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="4 7" animate={pulsesRun ? { rotate: 360 } : { rotate: 0 }} transition={{ duration: 18, repeat: pulsesRun ? Infinity : 0, ease: "linear" }} style={{ transformOrigin: "200px 152px" }} />
                  <circle cx="200" cy="152" r="40" fill="var(--card)" stroke="var(--indigo)" strokeOpacity="0.28" filter="url(#hub-glow)" />
                  <text x="200" y="149" textAnchor="middle" fill="var(--slate-deep)" fontSize="15" fontWeight="700">Answered</text>
                  {[7, 13, 19, 11, 16, 8].map((height, index) => <motion.rect key={height} x={181 + index * 7} y={164 - height / 2} width="3" height={height} rx="1.5" initial={false} fill="var(--indigo)" fillOpacity={index % 2 === 0 ? 1 : 0.55} animate={activeNode && pulsesRun ? { height: [height, Math.max(6, height + (index % 2 === 0 ? 6 : -3)), height], y: [164 - height / 2, 164 - Math.max(6, height + (index % 2 === 0 ? 6 : -3)) / 2, 164 - height / 2] } : { height, y: 164 - height / 2 }} transition={activeNode && pulsesRun ? { duration: 0.7, delay: index * 0.04, repeat: Infinity } : { duration: 0.2 }} />)}
                </svg>
              </div>
            </div>
          </div>
        </Container>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Industries                                                                 */
/* -------------------------------------------------------------------------- */

const INDUSTRY_GROUPS = [
  {
    id: "health",
    name: "Health & care",
    img: healthcareImg,
    heading: "AI reception for clinics and dental practices",
    members: ["Medical & Healthcare Clinics", "Dental Practices"],
    benefits: [
      "Answers patient calls and common enquiries so reception workload drops",
      "Books and confirms appointments straight into the day's schedule",
      "Captures new patient enquiries for your team to follow up",
    ],
  },
  {
    id: "beauty",
    name: "Beauty & wellness",
    img: salonImg,
    heading: "AI reception for salons, studios and gyms",
    members: ["Beauty Salons & Spas", "Hairdressers & Barbers", "Fitness Studios & Gyms"],
    benefits: [
      "Answers service, pricing and availability questions instantly",
      "Books appointments, classes and consultations around the clock",
      "Takes cancellation requests and passes them on so clients always get a reply",
    ],
  },
  {
    id: "trades",
    name: "Trades & services",
    img: tradesImg,
    heading: "AI reception for trades and service businesses",
    members: ["Trades & Home Services", "Plumbing, Electrical & HVAC", "Automotive Workshops"],
    benefits: [
      "Answers calls and urgent enquiries while you are on the tools",
      "Books jobs and vehicle services into your schedule",
      "Qualifies leads and passes them to you so work does not slip",
    ],
  },
  {
    id: "property",
    name: "Property",
    img: realestateImg,
    heading: "AI reception for agencies and property managers",
    members: ["Real Estate Agencies", "Property Management"],
    benefits: [
      "Qualifies buyer, tenant and owner enquiries as they come in",
      "Books inspections and maintenance visits without phone tag",
      "Captures every new lead and passes it to your team",
    ],
  },
  {
    id: "hospitality",
    name: "Hospitality",
    img: hotelImg,
    heading: "AI reception for hotels, restaurants and cafes",
    members: ["Hotels & Accommodation", "Restaurants & Cafés"],
    benefits: [
      "Answers guest enquiries about menus, rooms and opening hours",
      "Takes reservations and notes booking changes for your team",
      "Answers every guest call, even when the front desk is busy",
    ],
  },
  {
    id: "professional",
    name: "Professional services",
    img: lawImg,
    heading: "AI reception for firms and consultancies",
    members: ["Law Firms", "Accounting Firms", "Professional Services"],
    benefits: [
      "Gives every new enquiry a professional first response",
      "Schedules consultations and client appointments",
      "Collects details for your team to follow up during your busiest periods",
    ],
  },
];

function Industries() {
  const [activeId, setActiveId] = useState(INDUSTRY_GROUPS[0].id);
  const reducedMotionPreference = useReducedMotion();
  const [motionReady, setMotionReady] = useState(false);
  useEffect(() => setMotionReady(true), []);
  const prefersReducedMotion = motionReady && Boolean(reducedMotionPreference);

  const active = INDUSTRY_GROUPS.find((group) => group.id === activeId) ?? INDUSTRY_GROUPS[0];
  const activeIndex = INDUSTRY_GROUPS.findIndex((group) => group.id === active.id);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const map: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const delta = map[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = (activeIndex + delta + INDUSTRY_GROUPS.length) % INDUSTRY_GROUPS.length;
    setActiveId(INDUSTRY_GROUPS[next].id);
    const el = document.getElementById(`industry-tab-${INDUSTRY_GROUPS[next].id}`);
    el?.focus();
    el?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", inline: "center", block: "nearest" });
  };

  return (
    <section id="industries" className="relative border-t border-hairline bg-canvas-2 py-12 md:py-24">
      <Container>
        <div className="max-w-2xl">
          <SectionHeading eyebrow="Industries">
            Tailored AI-powered solutions
            <br />
            for every service industry.
          </SectionHeading>
          <Reveal delay={0.1}>
            <p className="mt-4 max-w-lg text-[16px] leading-[1.55] text-ink-muted">
              Purpose-built for the businesses that live or die by every call answered.
            </p>
          </Reveal>
        </div>

        <div className="mt-8 grid gap-6 md:mt-12 md:grid-cols-12 md:gap-10">
          <div className="min-w-0 md:col-span-4">
            <div
              role="tablist"
              aria-label="Industry groups"
              onKeyDown={onKeyDown}
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:mx-0 md:flex-col md:gap-1 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden"
            >
              {INDUSTRY_GROUPS.map((group) => {
                const selected = group.id === active.id;
                return (
                  <button
                    key={group.id}
                    id={`industry-tab-${group.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="industry-panel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActiveId(group.id)}
                    className={`shrink-0 whitespace-nowrap rounded-[6px] border px-3.5 py-2.5 text-left text-[14px] font-medium transition md:w-full md:whitespace-normal ${
                      selected
                        ? "border-indigo/30 bg-indigo/8 text-indigo-deep shadow-sm"
                        : "border-hairline bg-white text-ink-muted hover:border-indigo/20 hover:text-slate-deep"
                    }`}
                  >
                    {group.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-w-0 md:col-span-8">
            <div id="industry-panel" role="tabpanel" aria-labelledby={`industry-tab-${active.id}`} className="panel overflow-hidden">
              <div className="relative h-[190px] overflow-hidden bg-canvas-2 sm:h-[240px] md:h-[300px]">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.img
                    key={active.id}
                    src={active.img}
                    alt={active.heading}
                    width={1024}
                    height={768}
                    loading="lazy"
                    decoding="async"
                    initial={prefersReducedMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={prefersReducedMotion ? undefined : { opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </AnimatePresence>
              </div>
              <motion.div
                key={`${active.id}-copy`}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="border-t border-hairline p-5 md:p-6"
              >
                <p className="text-[12px] font-semibold text-indigo">{active.members.join(" · ")}</p>
                <h3 className="display-strong mt-2 text-[20px] md:text-[24px]">{active.heading}</h3>
                <ul className="mt-4 space-y-2.5">
                  {active.benefits.map((benefit) => (
                    <li key={benefit} className="flex gap-2.5 text-[14px] leading-[1.55] text-ink-muted">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo" strokeWidth={2.2} />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* FAQ                                                                        */
/* -------------------------------------------------------------------------- */
const FAQS = [
  {
    q: "How does Answered handle incoming calls?",
    a: "You choose the flow. Forward calls to Answered only when you miss them, or send every call straight to Answered so it picks up instantly. Either way, every caller gets a prompt, professional response, whether you're free or not.",
  },
  {
    q: "Does Answered work after hours and on weekends?",
    a: "Yes. Answered can handle calls after hours and on weekends, following the availability and call-handling rules configured for your business.",
  },
  {
    q: "What happens if Answered can't answer a customer's question?",
    a: "When a question needs your team, Answered can capture the enquiry for review. You can update its knowledge base to help it handle similar questions in future.",
  },
  {
    q: "How does Answered know what to say to my customers?",
    a: "Answered uses the business information and call instructions you provide. You can review conversations and refine its knowledge base and responses over time.",
  },
  {
    q: "Can Answered handle different types of businesses?",
    a: "Yes. Answered is built for any service-based business, trades, medical, legal, finance, automotive, health and wellness, hospitality and more. It adapts to your services with responses tailored to how you actually work.",
  },
  {
    q: "Can Answered handle multiple calls at once?",
    a: "Yes. Answered can take more than one call at the same time, so callers aren't left waiting while it talks to someone else.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-hairline">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-5 py-4 text-left"
        aria-expanded={open}
      >
        <span className="text-[17px] font-medium leading-[1.4] tracking-[-0.01em] text-slate-deep md:text-[18px]">
          {q}
        </span>
        <span
          className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[4px] border border-hairline text-indigo transition-transform duration-300 ${
            open ? "rotate-45" : ""
          }`}
          aria-hidden
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden"
      >
        <p className="pb-5 pr-8 text-[15px] leading-[1.6] text-ink-muted">{a}</p>
      </motion.div>
    </div>
  );
}

function FAQ() {
  return (
    <section id="faq" className="relative border-t border-hairline bg-white py-12 md:py-24">
      <Container>
        <div className="max-w-2xl">
          <SectionHeading eyebrow="FAQ">Frequently asked questions</SectionHeading>
          <Reveal delay={0.1}>
            <p className="mt-4 max-w-lg text-[16px] leading-[1.55] text-ink-muted">
              Quick answers to the things people ask most about how Answered works.
            </p>
          </Reveal>
        </div>

        <div className="mt-8 max-w-2xl border-t border-hairline md:mt-12">
          {FAQS.map((f) => (
            <FAQItem key={f.q} q={f.q} a={f.a} />
          ))}
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Global calls (particle world)                                              */
/* -------------------------------------------------------------------------- */

function DashboardShowcase() {
  return (
    <section id="dashboard" className="relative overflow-hidden border-t border-hairline bg-white py-12 md:py-24">
      <Container className="relative isolate">
        <div className="max-w-2xl">
          <Reveal>
            <p className="text-[12px] font-semibold text-indigo">Dashboard</p>
            <h2 className="display-strong mt-3 max-w-[18ch] text-[28px] md:text-[42px]">
              Every call, booking and next step. In one place.
            </h2>
          </Reveal>
          <Reveal delay={0.06}>
            <p className="mt-4 max-w-[54ch] text-[16px] leading-[1.6] text-ink-muted">
              Review calls, bookings and receptionist activity in one place.
            </p>
            <Link
              to="/signup"
              className="group mt-4 inline-flex items-center gap-1 text-[15px] font-medium text-indigo transition-colors hover:text-indigo-deep"
            >
              Create an account
              <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={2.25} />
            </Link>
          </Reveal>
        </div>
        <Reveal delay={0.08}>
          <div className="mt-8 grid gap-3 md:mt-10 md:grid-cols-3">
            {[
              { icon: Phone, title: "See what happened", text: "Open a call to read its summary, transcript and outcome." },
              { icon: Calendar, title: "Know what's booked", text: "See upcoming appointments and the details captured for each customer." },
              { icon: MessageSquare, title: "Know who needs you", text: "Find enquiries and follow-ups that need your attention." },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="border border-hairline bg-canvas-2/60 p-5">
                <Icon className="h-5 w-5 text-indigo" />
                <h3 className="mt-4 text-[16px] font-semibold text-ink">{title}</h3>
                <p className="mt-2 text-[14px] leading-6 text-ink-muted">{text}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

function ClosingCTA() {
  return (
    <section className="relative border-t border-hairline bg-canvas-2 py-14 md:py-24">
      <Container>
        <div className="mx-auto max-w-[720px] text-center">
          <Reveal>
            <h2 className="display-strong text-[28px] md:text-[42px]">
              Hear what Answered can do for your business.
            </h2>
          </Reveal>
          <Reveal delay={0.06}>
            <p className="mx-auto mt-4 max-w-[52ch] text-[16px] leading-[1.6] text-ink-muted">
              Create an account and set up your receptionist, or listen to an example call first.
            </p>
            <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <CTA href="/signup" as="business">Create an account</CTA>
              <CTA variant="secondary" href="#demo">Hear it in action</CTA>
            </div>
            <p className="mt-4 text-[13px] text-ink-muted">
              Run receptionists for your clients?{" "}
              <Link to="/signup" search={{ as: "agency" }} className="font-medium text-indigo hover:text-indigo-deep">
                Sign up as an agency
              </Link>
            </p>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-hairline bg-white py-10 md:py-14">
      <Container>
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-[36ch]">
            <div className="flex flex-col items-start gap-[3px]">
              <span className="text-[20px] font-bold leading-none tracking-[-0.02em] text-slate-deep">Answered</span>
              <LogoWave />
            </div>
            <p className="mt-3 text-[14px] leading-[1.55] text-ink-muted">AI reception for service businesses.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3 text-[14px] font-medium text-slate-deep">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="transition-colors hover:text-indigo">
                {link.label}
              </a>
            ))}
            <Link to="/login" className="transition-colors hover:text-indigo">
              Sign in
            </Link>
            <Link to="/signup" className="transition-colors hover:text-indigo">
              Get started
            </Link>
          </nav>
        </div>
        <p className="mt-8 border-t border-hairline pt-6 text-[13px] text-ink-muted">© 2026 Answered</p>
      </Container>
    </footer>
  );
}


function GlobeSection() {
  return (
    <section className="relative overflow-hidden border-t border-hairline bg-[linear-gradient(180deg,var(--canvas)_0%,#f7f5ff_22%,#fff4f8_72%,var(--canvas)_100%)] py-12 md:py-20">
      <Container className="relative">
        <div className="grid items-center gap-4 md:grid-cols-[0.8fr_1.2fr] md:gap-8">
          <div className="z-10 py-4 md:py-10">
            <p className="text-[12px] font-semibold text-indigo">Always available</p>
            <h2 className="display-strong mt-4 max-w-[12ch] text-[32px] md:text-[44px]">
              A world that never stops calling.
            </h2>
            <p className="mt-5 max-w-[42ch] text-[16px] leading-[1.65] text-ink-muted">
              Answer enquiries and book after-hours appointments wherever business finds you.
            </p>
          </div>
          <div className="relative -mx-8 min-h-[390px] md:-my-16 md:ml-0 md:mr-[-10vw] md:min-h-[650px]">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-canvas to-transparent" />
            <CallGlobe theme="light" />
          </div>
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

function Index() {
  return (
    <main className="overflow-x-hidden bg-white text-slate-deep">
      <Nav />
      <Hero />
      <ProductTheatre />
      <EntireOffice />
      <DashboardShowcase />
      <GlobeSection />
      <Integrations />
      <Industries />
      <FAQ />
      <ClosingCTA />
      <SiteFooter />
    </main>
  );
}
