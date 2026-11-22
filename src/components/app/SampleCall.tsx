import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/app/StatusBadge";
import type { Voice } from "@/lib/app/types";
import { cn } from "@/lib/utils";

// A browser-only sample call for the receptionist settings on screen (used by the
// receptionist page and the onboarding wizard).

export function Bubble({ who, accent, children }: { who: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("max-w-[92%] rounded-[8px] px-3 py-2", accent ? "bg-[#efeeff] text-ink" : "ml-auto bg-canvas-2 text-ink")}>
      <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink-muted">{who}</div>
      <div className="leading-5 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

interface SampleLine {
  who: "caller" | "agent";
  text: string;
}

/**
 * Browser-only sample. Nothing is dialled, recorded or saved: the script below
 * is read aloud by the browser's own speech voice so the wording of the settings
 * on screen can be heard.
 */
export type SampleSettings = { name: string; greeting: string; business_name: string; services: string[] };

export function TestPreviewDialog({ form, voice }: { form: SampleSettings; voice: Pick<Voice, "display_name"> | null }) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [spokenIndex, setSpokenIndex] = useState(-1);
  const [speechError, setSpeechError] = useState(false);
  const agentName = form.name || "Receptionist";
  const service = form.services[0] ?? "an appointment";
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const browserVoiceName = useRef<string>("");

  const script: SampleLine[] = [
    { who: "agent", text: form.greeting || `Thanks for calling ${form.business_name || "us"}. How can I help?` },
    { who: "caller", text: `Hi, this is Alex Sample. I'd like to book ${service} please.` },
    { who: "agent", text: "Of course, Alex. What's the best mobile number for you?" },
    { who: "caller", text: "It's 0400 000 000." },
    { who: "agent", text: "Thank you. I'll pass that straight to the team and they'll confirm a time with you." },
    { who: "caller", text: "Great, thanks." },
    { who: "agent", text: "All noted. Have a lovely day." },
  ];

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setPlaying(false);
    setSpokenIndex(-1);
  }, []);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (!open) stop();
  }, [open, stop]);

  const play = () => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeechError(false);
    setPlaying(true);
    script.forEach((line, i) => {
      const u = new SpeechSynthesisUtterance(line.text);
      u.pitch = line.who === "caller" ? 0.9 : 1.05;
      browserVoiceName.current = u.voice?.name || window.speechSynthesis.getVoices()[0]?.name || "your browser's default voice";
      u.onstart = () => setSpokenIndex(i);
      u.onerror = () => {
        window.speechSynthesis.cancel();
        setPlaying(false);
        setSpokenIndex(-1);
        setSpeechError(true);
      };
      if (i === script.length - 1) {
        u.onend = () => {
          setPlaying(false);
          setSpokenIndex(-1);
        };
      }
      window.speechSynthesis.speak(u);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Hear a sample
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg rounded-[6px]">
        <DialogHeader>
          <DialogTitle className="text-[16px]">Sample call</DialogTitle>
          <DialogDescription className="text-[12.5px]">Browser-generated sample, not a live call or recording. Nothing is dialled, booked, sent or saved.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1 text-[12.5px]">
          {script.map((line, i) => (
            <div key={i} className={cn("rounded-[8px]", i === spokenIndex ? "ring-1 ring-indigo" : "")}>
              <Bubble who={line.who === "agent" ? agentName : "Alex Sample (sample caller)"} accent={line.who === "agent"}>
                {line.text}
              </Bubble>
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <StatusBadge tone="muted">Read aloud by your browser voice</StatusBadge>
            {voice ? <StatusBadge tone="muted">Live voice on real calls: {voice.display_name}</StatusBadge> : null}
          </div>
          {!supported ? <p className="text-[12px] text-ink-muted">Your browser cannot read this aloud, so the script above is the full sample.</p> : null}
          {speechError ? <p className="text-[12px] text-ink-muted">Your browser stopped reading the sample aloud. The full script above is unchanged.</p> : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <span className="text-[11.5px] text-ink-muted">The wording comes from the settings on this page.</span>
          {supported ? (
            playing ? (
              <Button variant="outline" size="sm" onClick={stop}>Stop</Button>
            ) : (
              <Button size="sm" onClick={play}>Play sample</Button>
            )
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

