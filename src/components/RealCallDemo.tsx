import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { PRODUCT } from "@/lib/app/product";
import {
  Calendar,
  Check,
  CheckCircle2,
  Clock3,
  Pause,
  Phone,
  Play,
  RotateCcw,
  RotateCw,
  UserRound,
} from "lucide-react";

const AUDIO_SRC = "/audio/answered-real-booking.mp3";
const DURATION = 81.11;

type TranscriptLine = {
  start: number;
  end: number;
  who: "agent" | "caller";
  text: string;
};

const TRANSCRIPT: TranscriptLine[] = [
  { start: 0, end: 4, who: "agent", text: "Thanks for calling Bright Smile Dental. How can I help you today?" },
  { start: 4, end: 9.73, who: "caller", text: "Hey, do you guys accept new patients?" },
  { start: 9.73, end: 17.73, who: "agent", text: "Yes, we do accept new patients. Would you like to book your first appointment with us, or is there something specific you'd like to know first?" },
  { start: 17.73, end: 20.73, who: "caller", text: "Yeah, I just want to book a normal checkup." },
  { start: 20.73, end: 27.58, who: "agent", text: "No problem. We can book you in for a standard checkup and clean. Can I get your full name please?" },
  { start: 27.58, end: 32.57, who: "caller", text: "Jack Smith." },
  { start: 32.57, end: 34.57, who: "agent", text: "Thanks, Jack." },
  { start: 34.57, end: 42.65, who: "agent", text: "You mentioned this is your first visit with us, so we'll book you as a new patient." },
  { start: 42.65, end: 52.65, who: "agent", text: "When would you like to come in? We have availability this week. Would you prefer a morning or afternoon?" },
  { start: 52.65, end: 56.65, who: "caller", text: "I want a morning one. Can you do Wednesday, 10 a.m.?" },
  { start: 56.65, end: 68.73, who: "agent", text: "Yes, we have a 10 a.m. slot available on Wednesday, the 9th of September. I'll book you in for a new patient checkup and clean then." },
  { start: 68.73, end: 70.73, who: "caller", text: "No, thank you. That's great." },
  { start: 70.73, end: DURATION, who: "agent", text: "You're all booked in, Jack. Wednesday, the 9th of September at 10 a.m. for your new patient checkup. We'll see you then." },
];

const WAVES = [8, 12, 18, 10, 22, 15, 27, 12, 20, 29, 16, 24, 10, 18, 26, 13, 22, 30, 14, 19, 25, 11, 17, 23, 9, 16, 20, 12, 18, 14];

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? seconds : 0;
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, "0")}`;
}

function RealCallDemo() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const reduceMotion = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(DURATION);

  const activeIndex = useMemo(() => {
    const index = TRANSCRIPT.findIndex((line) => time >= line.start && time < line.end);
    return index < 0 ? (time >= duration - 0.1 ? TRANSCRIPT.length - 1 : 0) : index;
  }, [duration, time]);

  const active = TRANSCRIPT[activeIndex];
  const customerCaptured = time >= 27.58;
  const serviceCaptured = time >= 20.73;
  const slotCaptured = time >= 56.65;
  const confirmed = time >= 68.73;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setTime(audio.currentTime);
    const onMeta = () => setDuration(audio.duration || DURATION);
    const onEnded = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.ended || audio.currentTime >= duration - 0.1) audio.currentTime = 0;
    if (audio.paused) {
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        // Autoplay policy or a failed load: leave the player paused.
        setPlaying(false);
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const skipBy = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Math.min(duration, Math.max(0, audio.currentTime + seconds));
    audio.currentTime = next;
    setTime(next);
  };

  const seek = (next: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = next;
    setTime(next);
  };

  const progress = Math.min(100, Math.max(0, (time / duration) * 100));

  return (
    <div className="relative isolate px-0 pb-3 pt-2 sm:px-3 sm:pb-5">
      <audio ref={audioRef} src={AUDIO_SRC} preload="metadata" />
      <div aria-hidden className="absolute left-0 top-0 -z-10 h-[74%] w-[88%] bg-[#eae8ff]" />
      <div aria-hidden className="absolute bottom-0 right-0 -z-10 h-[72%] w-[82%] bg-[#fff0f6]" />

      <div className="relative overflow-hidden border border-[#dcdff0] bg-white shadow-[0_30px_70px_-42px_rgba(38,35,91,0.48)]">

      <div className="flex flex-col gap-2 border-b border-hairline bg-[#fbfbff] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#eeecff] text-indigo">
            <Phone className="h-4 w-4" strokeWidth={2.1} />
            <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="truncate text-[14px] font-semibold text-slate-deep sm:text-[15px]">Bright Smile Dental</h3>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-700">Example call</span>
            </div>
            <p className="mt-0.5 text-[12px] text-ink-muted">AI receptionist · New patient booking</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-ink-muted">
          <Clock3 className="h-3.5 w-3.5" />
          <span>{formatTime(time)} / {formatTime(duration)}</span>
        </div>
      </div>

      <div className="grid bg-[#f7f7fb] lg:grid-cols-[minmax(0,1fr)_350px]">
        <div className="min-w-0 p-3 sm:p-4 lg:pr-0">
          <div className="relative flex min-h-[216px] flex-col justify-between overflow-hidden bg-white/72 p-4 sm:min-h-[224px] sm:p-5">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#f6f7fb] to-transparent" />

            <div className="relative flex min-h-[112px] items-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeIndex}
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="w-full"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`grid h-6 w-6 place-items-center rounded-full ${active.who === "agent" ? "bg-indigo text-white" : "bg-[#f0f1f6] text-slate-deep"}`}>
                      {active.who === "agent" ? <Phone className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                    </span>
                    <span className={`text-[12px] font-semibold ${active.who === "agent" ? "text-indigo" : "text-ink-muted"}`}>{active.who === "agent" ? PRODUCT : "Caller"}</span>
                  </div>
                  <p className="max-w-[42ch] text-[17px] font-medium leading-[1.42] tracking-[-0.015em] text-slate-deep sm:text-[20px]">
                    {active.text}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="relative mt-4">
              <div className="mb-2 flex h-6 items-center gap-[3px] overflow-hidden" aria-hidden>
                {WAVES.map((height, index) => (
                  <motion.span
                    key={index}
                    className="w-[3px] shrink-0 rounded-full bg-indigo"
                    animate={playing && !reduceMotion ? { height: [height * 0.55, height, height * 0.7] } : { height: Math.max(4, height * 0.48) }}
                    transition={{ duration: 0.52 + (index % 4) * 0.08, repeat: playing && !reduceMotion ? Infinity : 0, delay: (index % 7) * 0.045 }}
                  />
                ))}
              </div>
              <button
                type="button"
                aria-label={`Seek audio, ${Math.round(progress)} percent played`}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  seek(((event.clientX - rect.left) / rect.width) * duration);
                }}
                className="group relative block h-5 w-full cursor-pointer"
              >
                <span className="absolute inset-x-0 top-2 h-[2px] bg-[#d9dcea]" />
                <span className="absolute left-0 top-2 h-[2px] bg-indigo" style={{ width: `${progress}%` }} />
                <span className="absolute top-[3px] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white bg-indigo opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" style={{ left: `${progress}%` }} />
              </button>
              <div className="mt-2 flex items-center justify-center gap-2">
                  <button type="button" onClick={() => skipBy(-10)} className="relative grid h-9 w-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[#f0efff] hover:text-indigo" aria-label="Rewind 10 seconds">
                    <RotateCcw className="h-[18px] w-[18px]" />
                    <span className="absolute text-[8px] font-bold">10</span>
                  </button>
                  <button type="button" onClick={toggle} className="grid h-10 w-10 place-items-center rounded-full bg-[#533AFD] text-white transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo" aria-label={playing ? "Pause example call" : "Play example call"}>
                    {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
                  </button>
                  <button type="button" onClick={() => skipBy(10)} className="relative grid h-9 w-9 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[#f0efff] hover:text-indigo" aria-label="Skip forward 10 seconds">
                    <RotateCw className="h-[18px] w-[18px]" />
                    <span className="absolute text-[8px] font-bold">10</span>
                  </button>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 m-3 border border-[#e1e2ec] bg-white p-4 shadow-[0_22px_44px_-30px_rgba(38,35,91,0.5)] sm:m-4 lg:-ml-4 lg:my-5">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.11em] text-indigo">Captured as they speak</p>
              <h4 className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-slate-deep">Booking details</h4>
            </div>
            <motion.span
              animate={confirmed && !reduceMotion ? { scale: [0.8, 1.08, 1] } : { scale: 1 }}
              className={`grid h-9 w-9 place-items-center rounded-full ${confirmed ? "bg-emerald-50 text-emerald-600" : "bg-canvas-2 text-ink-muted"}`}
            >
              {confirmed ? <CheckCircle2 className="h-5 w-5" /> : <Calendar className="h-4 w-4" />}
            </motion.span>
          </div>

          <div className="divide-y divide-hairline border-y border-hairline">
            {[
              { label: "Customer", value: "Jack Smith", ready: customerCaptured, icon: UserRound },
              { label: "Service", value: "New patient checkup & clean", ready: serviceCaptured, icon: CheckCircle2 },
              { label: "Time", value: "Wed 9 Sep · 10:00 am", ready: slotCaptured, icon: Calendar },
            ].map(({ label, value, ready, icon: Icon }) => (
              <div key={label} className="grid min-h-[58px] grid-cols-[28px_72px_1fr] items-center gap-2 py-2">
                <span className={`grid h-8 w-8 place-items-center rounded-full transition-colors duration-300 ${ready ? "bg-[#eeecff] text-indigo" : "bg-canvas-2 text-[#a2a9b6]"}`}><Icon className="h-3.5 w-3.5" /></span>
                <span className="text-[12px] font-medium text-ink-muted">{label}</span>
                <AnimatePresence mode="wait">
                  <motion.span key={ready ? value : "waiting"} initial={reduceMotion ? false : { opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} className={`text-right text-[13px] font-semibold sm:text-[14px] ${ready ? "text-slate-deep" : "text-[#a2a9b6]"}`}>
                    {ready ? value : "Listening..."}
                  </motion.span>
                </AnimatePresence>
              </div>
            ))}
          </div>

          <motion.div
            animate={confirmed && !reduceMotion ? { y: [6, 0], opacity: 1 } : { y: 0, opacity: confirmed ? 1 : 0.62 }}
            className={`mt-3 flex items-center gap-3 border px-3 py-3 transition-colors ${confirmed ? "border-emerald-200 bg-emerald-50/70" : "border-hairline bg-canvas-2/60"}`}
          >
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${confirmed ? "bg-emerald-500 text-white" : "bg-white text-[#a2a9b6]"}`}>
              {confirmed ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Clock3 className="h-4 w-4" />}
            </span>
            <div>
              <p className={`text-[13px] font-semibold ${confirmed ? "text-emerald-900" : "text-ink-muted"}`}>{confirmed ? "Appointment confirmed" : "Waiting for confirmation"}</p>
              <p className="mt-0.5 text-[11px] text-ink-muted">Ready for your calendar</p>
            </div>
          </motion.div>
        </div>
      </div>
      </div>
    </div>
  );
}

export default RealCallDemo;
