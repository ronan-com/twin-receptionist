import { useEffect, useSyncExternalStore } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// The Play button on every voice in the pickers (wizard, receptionist page, Voices). One clip
// plays at a time across the whole page: pressing another voice's Play stops the first.
// Vapi voices' clips are static files (/voice-previews/...); Telnyx's are made on first play
// (/api/voices/preview?voice=...).

type State = { id: string | null; loading: boolean };
let state: State = { id: null, loading: false };
let audio: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();
const set = (next: State) => {
  state = next;
  for (const l of listeners) l();
};

export function stopVoicePreview() {
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = null;
  }
  if (state.id) set({ id: null, loading: false });
}

// Telnyx makes a clip on first play, which can take a few seconds. Past this, say so instead of spinning.
const LOAD_LIMIT_MS = 25_000;

/** Says why a sample didn't play: the server's own message when it sent one (no phone key, Telnyx refused), else a plain line. */
async function explainFailure(url: string): Promise<string> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      if (data && typeof data.error === "string") return data.error;
      if (res.status === 404) return "This voice sample isn't available.";
      if (res.status === 401) return "Sign in again to play samples.";
    }
  } catch {
    return "Can't reach the server. Check your connection and try again.";
  }
  return "This sample couldn't play. Try again, or pick the voice and test it with a call.";
}

export function playVoicePreview(id: string, url: string) {
  if (state.id === id) return stopVoicePreview();
  stopVoicePreview();
  const a = new Audio(url);
  audio = a;
  set({ id, loading: true });
  const done = () => {
    window.clearTimeout(slow);
    if (audio === a) stopVoicePreview();
  };
  const fail = () => {
    const mine = audio === a;
    done();
    if (mine) void explainFailure(url).then((m) => toast.error(m));
  };
  const slow = window.setTimeout(() => {
    if (audio !== a || state.loading === false) return;
    stopVoicePreview();
    toast.error("The sample is taking too long to load. Try again in a moment.");
  }, LOAD_LIMIT_MS);
  a.addEventListener("playing", () => audio === a && (window.clearTimeout(slow), set({ id, loading: false })));
  a.addEventListener("ended", done);
  a.addEventListener("error", fail);
  a.play().catch((err) => (err?.name === "AbortError" ? done() : fail()));
}

function usePreviewState(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** Play / Stop for one voice. Renders nothing for a voice with no clip. */
export function VoicePreviewButton({ id, url, name, className }: { id: string; url: string | null | undefined; name: string; className?: string }) {
  const s = usePreviewState();
  // Leaving the page stops the clip.
  useEffect(() => () => void (state.id === id && stopVoicePreview()), [id]);
  if (!url) return null;
  const on = s.id === id;
  return (
    <button
      type="button"
      data-action="preview-voice"
      data-voice={id}
      aria-pressed={on}
      aria-label={on ? `Stop ${name}` : `Play ${name}`}
      title={on ? "Stop" : "Play a sample"}
      onClick={(e) => {
        e.stopPropagation();
        playVoicePreview(id, url);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
        on ? "border-indigo bg-indigo text-white" : "border-hairline bg-white text-ink-muted hover:border-indigo hover:text-indigo",
        className,
      )}
    >
      {on && s.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : on ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3.5 w-3.5 translate-x-[1px] fill-current" />}
    </button>
  );
}
