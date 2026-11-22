import { useCallback, useEffect, useRef, useState } from "react";
import { Languages, MoonStar, PhoneCall, PhoneForwarded, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Panel } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Bubble } from "@/components/app/SampleCall";
import type { AutomationSettings } from "@/lib/api/automations";
import { defaultGreeting, formatNumber } from "@/lib/shared";
import { cn } from "@/lib/utils";
import { COLLECT_OPTIONS, DIALECT_OPTIONS, TONE_OPTIONS, type CollectKey, type DialectKey, type ToneKey } from "./model";

// How a typical call goes with the settings on screen, built from the same fields the
// server puts in the receptionist's script (server/prompt.ts). Used by the live Preview
// panel and the "Hear a sample" dialog, which reads it aloud with the browser's voice.

export type PreviewSettings = {
  name: string;
  business_name: string;
  greeting: string;
  closing: string;
  tone: ToneKey;
  dialect: DialectKey;
  services: string[];
  collect: CollectKey[];
  questions: string[];
  bookingLive: boolean;
  voiceName: string | null;
  paused: { message: string } | null;
};

export type Line = { who: "agent" | "caller"; text: string };

const firstName = (s: string) => s.trim().split(/\s+/)[0] ?? "";

export function callScript(f: PreviewSettings, auto: AutomationSettings | null, afterHours: boolean): Line[] {
  const notice = auto?.recording.enabled ? ` ${auto.recording.notice}` : "";
  if (f.paused) {
    return [
      { who: "agent", text: f.paused.message },
      { who: "caller", text: "Oh, okay. Can you ask someone to call me back?" },
      { who: "agent", text: "Of course. Can I grab your full name and the best number to reach you?" },
    ];
  }
  const greeting =
    afterHours && auto?.hoursMode.enabled
      ? auto.hoursMode.greeting.replace(/\{business\}/g, f.business_name || "us")
      : f.greeting.trim() || defaultGreeting(f.business_name, f.name);
  const service = f.services[0] ?? "an appointment";
  const lines: Line[] = [{ who: "agent", text: `${greeting}${notice}` }, { who: "caller", text: `Hi, I'd like to book ${service.toLowerCase()} please.` }];
  const closedNoBooking = afterHours && auto?.hoursMode.enabled && auto.hoursMode.mode === "message_only";
  if (closedNoBooking) {
    lines.push({ who: "agent", text: "We're closed right now, so I can't book that in, but I'll take a message and the team will get back to you. Can I grab your full name?" });
  } else if (f.bookingLive) {
    lines.push({ who: "agent", text: "Of course. Which day suits you? I'll check what's free." });
  } else {
    lines.push({ who: "agent", text: "Of course. I'll take your details and the team will confirm a time with you. Can I grab your full name?" });
  }
  const extra = COLLECT_OPTIONS.find((c) => f.collect.includes(c.value));
  const question = f.questions[0];
  if (extra || question) {
    lines.push({ who: "caller", text: "Sure, it's Alex Sample, on 0400 000 000." });
    lines.push({ who: "agent", text: `Thanks, ${firstName("Alex Sample")}. ${extra ? extra.ask : question}` });
  }
  const transfer = auto?.transfer.enabled && auto.transfer.onRequest && auto.transfer.number;
  lines.push({ who: "caller", text: "Actually, can I speak to someone?" });
  lines.push({
    who: "agent",
    text:
      transfer && !(afterHours && auto?.transfer.when === "hours")
        ? `Sure, I'll put you through to ${auto!.transfer.name} now.`
        : "They're not available right now, but I'll pass on a message and they'll call you back.",
  });
  lines.push({ who: "agent", text: f.closing.trim() || "Thanks for calling. Have a lovely day." });
  return lines;
}

function Badges({ f, auto }: { f: PreviewSettings; auto: AutomationSettings | null }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      <StatusBadge tone="muted">{f.voiceName ?? "No voice selected"}</StatusBadge>
      <StatusBadge tone="muted">{TONE_OPTIONS.find((t) => t.value === f.tone)?.label ?? f.tone}</StatusBadge>
      <StatusBadge tone="muted">{DIALECT_OPTIONS.find((d) => d.value === f.dialect)?.label}</StatusBadge>
      {auto?.language.code === "multi" ? (
        <StatusBadge tone="muted">
          <Languages className="h-3 w-3" /> Replies in the caller's language
        </StatusBadge>
      ) : null}
      {auto?.transfer.enabled ? (
        <StatusBadge tone="muted">
          <PhoneForwarded className="h-3 w-3" /> Transfers on
        </StatusBadge>
      ) : null}
      {auto?.hoursMode.enabled ? (
        <StatusBadge tone="muted">
          <MoonStar className="h-3 w-3" /> After-hours mode
        </StatusBadge>
      ) : null}
    </div>
  );
}

export function PreviewPanel({ f, auto }: { f: PreviewSettings; auto: AutomationSettings | null }) {
  const [afterHours, setAfterHours] = useState(false);
  const canSwitch = !!auto?.hoursMode.enabled && !f.paused;
  const lines = callScript(f, auto, canSwitch && afterHours);
  const who = f.name || "Receptionist";
  return (
    <Panel
      title="Preview"
      description={f.paused ? "What callers hear while it's paused" : "How a typical call goes with these settings"}
      className="h-fit lg:sticky lg:top-[72px]"
      actions={
        canSwitch ? (
          <div className="flex rounded-[5px] border border-hairline p-0.5 text-[11.5px]" role="group" aria-label="Preview time">
            {[
              { v: false, label: "Open" },
              { v: true, label: "Closed" },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={afterHours === o.v}
                onClick={() => setAfterHours(o.v)}
                className={cn("rounded-[4px] px-2 py-0.5", afterHours === o.v ? "bg-[#efeeff] font-medium text-indigo" : "text-ink-muted")}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : null
      }
    >
      <div className="space-y-2 text-[12.5px]" data-preview>
        {lines.map((l, i) => (
          <Bubble key={i} who={l.who === "agent" ? who : "Caller"} accent={l.who === "agent"}>
            <span data-preview-line={l.who}>{l.text}</span>
          </Bubble>
        ))}
        <Badges f={f} auto={auto} />
      </div>
    </Panel>
  );
}

/**
 * "Hear a sample": a real recorded example call, and the preview script of the settings
 * on screen read aloud by the browser's own speech voice. Nothing is dialled, recorded
 * or saved. Neither is the receptionist's own voice (a voice preview needs the phone
 * provider, which charges per use), so the dialog says how to hear it: call the number.
 */
/** The recorded example call also used on the home page (src/components/RealCallDemo.tsx). */
const SAMPLE_RECORDING = "/audio/answered-real-booking.mp3";

export function SampleCallDialog({ f, auto, numbers, demo }: { f: PreviewSettings; auto: AutomationSettings | null; numbers: string[]; demo: boolean }) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [spoken, setSpoken] = useState(-1);
  const [speechError, setSpeechError] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const lines = callScript(f, auto, false);
  const who = f.name || "Receptionist";

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setPlaying(false);
    setSpoken(-1);
  }, []);
  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (!open) stop();
  }, [open, stop]);

  const recording = useRef<HTMLAudioElement>(null);
  const play = () => {
    if (!supported) return;
    recording.current?.pause();
    window.speechSynthesis.cancel();
    setSpeechError(false);
    setPlaying(true);
    lines.forEach((line, i) => {
      const u = new SpeechSynthesisUtterance(line.text);
      u.lang = f.dialect;
      u.pitch = line.who === "caller" ? 0.9 : 1.05;
      u.rate = f.tone === "calm" ? 0.92 : f.tone === "upbeat" ? 1.06 : 1;
      u.onstart = () => setSpoken(i);
      u.onerror = () => {
        window.speechSynthesis.cancel();
        setPlaying(false);
        setSpoken(-1);
        setSpeechError(true);
      };
      if (i === lines.length - 1) u.onend = () => stop();
      window.speechSynthesis.speak(u);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-action="sample">
          <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Hear a sample
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg rounded-[6px]">
        <DialogHeader>
          <DialogTitle className="text-[16px]">Sample call</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Hear how a call sounds, then your own settings (including unsaved changes) read aloud by your browser. Neither is a live call or your receptionist's own voice. Nothing is dialled, booked or saved.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 rounded-[6px] border border-hairline px-3 py-2.5" data-sample-recording>
          <p className="text-[12.5px] font-medium text-ink">A real recorded call</p>
          <p className="text-[12px] text-ink-muted">An AI receptionist booking a check-up for an example dental practice. It shows how calls sound; it isn't your voice or your settings.</p>
          <audio ref={recording} controls preload="none" src={SAMPLE_RECORDING} className="h-9 w-full" onPlay={stop} />
        </div>
        <p className="text-[12.5px] font-medium text-ink">Your settings, read aloud</p>
        <div className="max-h-[38vh] space-y-2 overflow-y-auto pr-1 text-[12.5px]" data-sample-script>
          {lines.map((line, i) => (
            <div key={i} className={cn("rounded-[8px]", i === spoken ? "ring-1 ring-indigo" : "")}>
              <Bubble who={line.who === "agent" ? who : "Alex Sample (sample caller)"} accent={line.who === "agent"}>
                {line.text}
              </Bubble>
            </div>
          ))}
          <div className="flex items-start gap-2 rounded-[6px] border border-hairline bg-canvas-2 px-3 py-2 text-[12px] text-ink-muted">
            <PhoneCall className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo" />
            <span>
              {numbers.length > 0
                ? `To hear the real voice${f.voiceName ? ` (${f.voiceName})` : ""}, call ${numbers.map(formatNumber).join(" or ")} once you've saved.`
                : demo
                  ? "This is a test receptionist with no phone line, so the real voice can't be called. Ask your agency for a live receptionist to hear it."
                  : `To hear the real voice${f.voiceName ? ` (${f.voiceName})` : ""}, call your receptionist once a phone number is connected.`}
            </span>
          </div>
          {!supported ? <p className="text-[12px] text-ink-muted">Your browser can't read this aloud, so the script above is the full sample.</p> : null}
          {speechError ? <p className="text-[12px] text-ink-muted">Your browser stopped reading the sample aloud. The script above is unchanged.</p> : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <span className="text-[11.5px] text-ink-muted">Browser voice, not the phone voice.</span>
          {supported ? (
            playing ? (
              <Button variant="outline" size="sm" onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button size="sm" onClick={play}>
                Play sample
              </Button>
            )
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
