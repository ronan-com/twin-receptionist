// Saved progress. Everything lives in one JSON file in the state volume,
// written with mode 600 because it holds the buyer's keys. The install log
// and the server's SSH key sit next to it, also mode 600.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const STATE_DIR = process.env.STATE_DIR || "/state";
const STATE_FILE = join(STATE_DIR, "installer-state.json");
export const LOG_FILE = join(STATE_DIR, "install.log");
export const KEY_FILE = join(STATE_DIR, "server-ssh-key");
export const PUB_FILE = join(STATE_DIR, "server-ssh-key.pub");

export type StepId = "brand" | "domain" | "digitalocean" | "telnyx" | "email" | "calendar" | "server" | "dns" | "install" | "done";
export const STEPS: StepId[] = ["brand", "domain", "digitalocean", "telnyx", "email", "calendar", "server", "dns", "install", "done"];

export interface State {
  step: StepId;
  brand?: { productName: string; ownerEmail: string; ownPhoneAccount: boolean };
  domain?: string;
  digitalocean?: { token?: string; accountEmail?: string; region: string; size: string; priceMonthly?: number; tokenRemoved?: boolean };
  telnyx?: { apiKey: string; balance?: string };
  email?: { smtpUrl: string; mailFrom: string; testSentTo?: string };
  calendar?: {
    google?: { clientId: string; clientSecret: string };
    microsoft?: { clientId: string; clientSecret: string };
    skipped?: boolean;
  };
  server?: {
    sshKeyId?: number;
    sshFingerprint?: string;
    dropletId?: number;
    ip?: string;
    phase: "idle" | "creating" | "ready" | "failed" | "deleting" | "deleted";
    progress: string[];
    error?: string;
  };
  dns?: { ok: boolean; seen?: string[]; checks: number; skipped?: boolean };
  install?: {
    phase: "idle" | "running" | "ok" | "failed";
    url?: string;
    error?: string;
    attempts: number;
    remotePid?: number;
  };
  finished?: boolean;
}

function ensureDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
}

let cache: State | null = null;

export function load(): State {
  if (cache) return cache;
  ensureDir();
  try {
    cache = JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    cache = { step: "brand" };
  }
  return cache;
}

export function save(s: State = load()) {
  ensureDir();
  cache = s;
  const tmp = STATE_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, STATE_FILE);
}

export function update(fn: (s: State) => void): State {
  const s = load();
  fn(s);
  save(s);
  return s;
}

export function eraseAll() {
  for (const f of [STATE_FILE, LOG_FILE, KEY_FILE, PUB_FILE]) rmSync(f, { force: true });
  cache = { step: "brand" };
}

export function writeSecretFile(path: string, data: string) {
  ensureDir();
  writeFileSync(path, data, { mode: 0o600 });
  chmodSync(path, 0o600);
}

// --- install log (already scrubbed of secrets before it gets here) ---
export function logReset() {
  writeSecretFile(LOG_FILE, "");
}
export function logAppend(text: string) {
  ensureDir();
  if (!existsSync(LOG_FILE)) writeSecretFile(LOG_FILE, "");
  appendFileSync(LOG_FILE, text);
}
export function logRead(from: number): { text: string; next: number } {
  if (!existsSync(LOG_FILE)) return { text: "", next: 0 };
  const size = statSync(LOG_FILE).size;
  if (from >= size) return { text: "", next: size };
  const buf = readFileSync(LOG_FILE);
  return { text: buf.subarray(from).toString("utf8"), next: size };
}

/** Every secret the buyer gave us, so we can blank them out of anything we show or print. */
export function secrets(s: State = load()): string[] {
  const out = [
    s.digitalocean?.token,
    s.telnyx?.apiKey,
    s.calendar?.google?.clientSecret,
    s.calendar?.microsoft?.clientSecret,
  ];
  if (s.email?.smtpUrl) {
    try {
      const u = new URL(s.email.smtpUrl);
      if (u.password) out.push(decodeURIComponent(u.password), u.password);
    } catch {}
    out.push(s.email.smtpUrl);
  }
  return out.filter((x): x is string => !!x && x.length >= 4);
}

export function scrub(text: string, s: State = load()): string {
  let t = text;
  for (const sec of secrets(s)) t = t.split(sec).join("••••••");
  return t;
}

export const mask = (v?: string) => (v ? (v.length > 8 ? "••••" + v.slice(-4) : "••••") : "");
