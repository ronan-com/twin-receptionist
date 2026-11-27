import { serverSpeech } from "./helperApi";

// Helper's voice, basic: the browser's speech recognition for the mic (hidden where there is none),
// and spoken replies that try the agency's own phone voice first (server) and fall back to the
// browser's speechSynthesis. Both are off until the person turns them on.

// ---- Listening ----------------------------------------------------------------------

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

const recognitionCtor = (): (new () => Recognition) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const canListen = () => recognitionCtor() !== null;

/** Starts listening for one sentence. `onText` gets the words so far (final = true once). Returns a stop function. */
export function listen(on: { onText: (text: string, final: boolean) => void; onEnd: (error?: string) => void }): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    on.onEnd("Your browser can't listen. Type instead.");
    return () => {};
  }
  const r = new Ctor();
  r.lang = "en-AU";
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let error: string | undefined;
  r.onresult = (e) => {
    let words = "";
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      words += e.results[i][0]?.transcript ?? "";
      if (e.results[i].isFinal) final = true;
    }
    on.onText(words.trim(), final);
  };
  r.onerror = (e) => {
    const code = String(e?.error ?? "");
    if (code === "not-allowed" || code === "service-not-allowed") error = "Allow the microphone to talk to Helper.";
    else if (code === "no-speech" || code === "aborted") error = undefined;
    else error = "I couldn't hear that. Try again or type.";
  };
  r.onend = () => on.onEnd(error);
  try {
    r.start();
  } catch {
    on.onEnd("I couldn't start the microphone.");
  }
  return () => {
    try {
      r.stop();
    } catch {
      /* already stopped */
    }
  };
}

// ---- Speaking -----------------------------------------------------------------------

/** What is worth reading aloud from a markdown reply: no links, symbols or lists; a few sentences. */
export function speakable(markdown: string, max = 450): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > 80 ? cut.slice(0, end + 1) : cut;
}

let audio: HTMLAudioElement | null = null;
let audioUrl = "";
let serverVoice = true; // flips off for the session once the server has no voice for us
let run = 0;

export function stopSpeaking(): void {
  run++;
  try {
    audio?.pause();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  } catch {
    /* nothing playing */
  }
  audio = null;
  audioUrl = "";
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* no synthesis here */
  }
}

export async function speak(markdown: string): Promise<void> {
  const text = speakable(markdown);
  if (!text) return;
  stopSpeaking();
  const mine = run;
  if (serverVoice) {
    const blob = await serverSpeech(text);
    if (mine !== run) return; // they stopped it, or asked something else
    if (blob && blob.size > 0) {
      try {
        audioUrl = URL.createObjectURL(blob);
        audio = new Audio(audioUrl);
        await audio.play();
        return;
      } catch {
        /* autoplay blocked or bad audio: the browser's voice instead */
      }
    } else serverVoice = false;
  }
  if (mine !== run) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-AU";
    synth.speak(u);
  } catch {
    /* silent is fine */
  }
}
