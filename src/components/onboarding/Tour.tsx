import { useCallback, type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

// A small spotlight tour: a dimmed page with a hole cut around a real element
// (found by its data-tour attribute) and a popover beside it. Back / Next / Skip,
// progress dots, arrow keys and Escape, and on a phone the popover sits at the
// bottom as a card. Written here so the app needs no tour library.

export type TourStep = {
  id: string;
  /** Value of the element's data-tour attribute. Missing = a centred card. */
  target?: string;
  title: string;
  body: string;
};

export const TOUR_NAV_EVENT = "gs:tour-nav";

const MOBILE_NAV_QUERY = "(max-width: 1023px)";
const PAD = 6;
const GAP = 14;

type Box = { top: number; left: number; width: number; height: number };

function findTarget(target: string | undefined): HTMLElement | null {
  if (!target) return null;
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(target)}"]`);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function measure(el: HTMLElement | null): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

export function Tour({ steps, onClose, onDone }: { steps: TourStep[]; onClose: () => void; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [popH, setPopH] = useState(190);
  const pop = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const step = steps[i];
  const last = i === steps.length - 1;
  const mobile = vp.w < 640;

  // The mobile menu only exists while it is open: open it for sidebar steps, close it otherwise.
  useEffect(() => {
    const isNav = Boolean(step?.target?.startsWith("nav:"));
    const small = window.matchMedia(MOBILE_NAV_QUERY).matches;
    window.dispatchEvent(new CustomEvent(TOUR_NAV_EVENT, { detail: { open: isNav && small } }));
  }, [step]);
  useEffect(() => () => void window.dispatchEvent(new CustomEvent(TOUR_NAV_EVENT, { detail: { open: false } })), []);

  // Follow the target: scroll it into view, then keep measuring (it moves while panels slide in).
  useEffect(() => {
    let alive = true;
    let scrolled: HTMLElement | null = null;
    const update = () => {
      if (!alive) return;
      const el = findTarget(step.target);
      if (el && el !== scrolled) {
        scrolled = el;
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      const b = measure(el);
      setBox((prev) => (prev && b && prev.top === b.top && prev.left === b.left && prev.width === b.width && prev.height === b.height ? prev : b));
      setVp((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
      if (pop.current) setPopH((h) => (Math.abs(h - pop.current!.offsetHeight) > 1 ? pop.current!.offsetHeight : h));
    };
    update();
    const id = window.setInterval(update, 120);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  useLayoutEffect(() => {
    next.current?.focus({ preventScroll: true });
  }, [i]);

  const go = useCallback(
    (d: number) => {
      if (d > 0 && last) return onDone();
      setI((n) => Math.max(0, Math.min(steps.length - 1, n + d)));
    },
    [last, onDone, steps.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Tab" && pop.current) {
        // Keep focus inside the popover.
        const f = [...pop.current.querySelectorAll<HTMLElement>("button")].filter((b) => !b.hasAttribute("disabled"));
        if (!f.length) return;
        const a = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (a === f[0] || !pop.current.contains(a))) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && (a === f[f.length - 1] || !pop.current.contains(a))) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, onClose]);

  // Where the popover goes.
  const W = Math.min(340, vp.w - 24);
  let style: CSSProperties;
  if (mobile || !box) {
    if (!box) {
      style = { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: W };
    } else {
      // A card pinned to the top or bottom edge, whichever leaves the target visible.
      const below = box.top + box.height / 2 < vp.h / 2;
      style = below ? { left: 12, right: 12, bottom: 12 } : { left: 12, right: 12, top: 12 };
    }
  } else {
    const spaceRight = vp.w - (box.left + box.width);
    let left: number;
    let top: number;
    if (spaceRight >= W + GAP + 12) {
      left = box.left + box.width + GAP;
      top = box.top + box.height / 2 - popH / 2;
    } else if (box.top + box.height + GAP + popH + 12 <= vp.h) {
      left = box.left + box.width / 2 - W / 2;
      top = box.top + box.height + GAP;
    } else if (box.top - GAP - popH >= 12) {
      left = box.left + box.width / 2 - W / 2;
      top = box.top - GAP - popH;
    } else {
      left = box.left - W - GAP;
      top = box.top + box.height / 2 - popH / 2;
    }
    left = Math.max(12, Math.min(vp.w - W - 12, left));
    top = Math.max(12, Math.min(vp.h - popH - 12, top));
    style = { left, top, width: W };
  }

  return createPortal(
    <div className="fixed inset-0 z-[100]" style={{ pointerEvents: "auto" }} data-tour-layer>
      {/* Swallows clicks so the page underneath can't be changed mid-tour. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} aria-hidden />
      {box ? (
        <div
          className="gs-spot pointer-events-none absolute rounded-lg"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height, boxShadow: "0 0 0 9999px rgba(8, 20, 40, 0.6)" }}
          aria-hidden
        >
          <div className="gs-spot-ring absolute inset-0 rounded-lg ring-2 ring-indigo" />
        </div>
      ) : (
        <div className="absolute inset-0 bg-[rgba(8,20,40,0.6)]" aria-hidden />
      )}
      <div
        ref={pop}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gs-tour-title"
        aria-describedby="gs-tour-body"
        data-tour-step={step.id}
        className="absolute rounded-xl border border-hairline bg-white p-4 shadow-2xl"
        style={style}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the tour"
          className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-canvas-2 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-indigo">
          Step {i + 1} of {steps.length}
        </div>
        <h2 id="gs-tour-title" className="mt-1 pr-6 text-[16px] font-semibold tracking-[-0.01em] text-ink">
          {step.title}
        </h2>
        <p id="gs-tour-body" className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">
          {step.body}
        </p>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" role="presentation" aria-hidden>
            {steps.map((s, n) => (
              <span key={s.id} className={cn("h-1.5 rounded-full transition-all", n === i ? "w-4 bg-indigo" : n < i ? "w-1.5 bg-indigo/50" : "w-1.5 bg-hairline")} />
            ))}
          </div>
          {!last ? (
            <button type="button" onClick={onClose} className="text-[12.5px] font-medium text-ink-muted hover:text-ink">
              Skip
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={i === 0}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-hairline px-2.5 text-[12.5px] font-medium text-ink hover:bg-canvas-2 disabled:pointer-events-none disabled:opacity-40"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <button
            ref={next}
            type="button"
            onClick={() => go(1)}
            data-tour-next
            className="inline-flex h-8 items-center gap-1 rounded-md bg-indigo px-3 text-[12.5px] font-semibold text-white hover:bg-indigo-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo"
          >
            {last ? "Done" : "Next"} {last ? null : <ArrowRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
