import { useEffect, useSyncExternalStore } from "react";
import { Loader2, Play, Square } from "lucide-react";
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

export function playVoicePreview(id: string, url: string) {
  if (state.id === id) return stopVoicePreview();
  stopVoicePreview();
  const a = new Audio(url);
  audio = a;
  set({ id, loading: true });
  const done = () => {
    if (audio === a) stopVoicePreview();
  };
  a.addEventListener("playing", () => audio === a && set({ id, loading: false }));
  a.addEventListener("ended", done);
  a.addEventListener("error", done);
  a.play().catch(done);
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
