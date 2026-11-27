// A few soft sounds (new call, new message, warning), made with the browser's audio API so there are no
// files to load. Browsers only allow sound after the person has clicked or pressed a key on the page, so
// nothing plays until then; the mute switch in the bell menu turns it all off (and remembers).

export type SoundKind = "call" | "message" | "warning";

const KEY = "ui-sound";
let ctx: AudioContext | null = null;
let armed = false;
const listeners = new Set<() => void>();

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

export function subscribeSound(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Listens for the first click or key press, after which the browser lets us make sound. */
export function armSounds() {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const unlock = () => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC && !ctx) ctx = new AC();
      void ctx?.resume();
    } catch {
      /* no audio */
    }
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

const NOTES: Record<SoundKind, { f: number; at: number; len: number }[]> = {
  call: [{ f: 660, at: 0, len: 0.16 }, { f: 880, at: 0.14, len: 0.22 }],
  message: [{ f: 784, at: 0, len: 0.2 }],
  warning: [{ f: 520, at: 0, len: 0.18 }, { f: 392, at: 0.18, len: 0.28 }],
};

/** Plays one sound, unless muted or the browser hasn't allowed sound yet. */
export function playSound(kind: SoundKind) {
  if (!soundOn() || !ctx || ctx.state !== "running") return;
  const t0 = ctx.currentTime + 0.01;
  for (const n of NOTES[kind]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = n.f;
    gain.gain.setValueAtTime(0.0001, t0 + n.at);
    gain.gain.exponentialRampToValueAtTime(0.06, t0 + n.at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.len + 0.02);
  }
}
