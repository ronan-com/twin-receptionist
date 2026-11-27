// Demo runs: the wizard's accounts are pretend, and "Open your dashboard" makes a real agency
// on a running copy of the app (our team demo app). Two ways in:
//   * a demo buyer (buyers.demo = 1, made from /admin's "Start a demo"): works on the live site, no
//     fake provider switch needed; setup.ts never calls a provider for them. Needs DEMO_APP_URL,
//     DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD (DEMO_APP_LOCAL is optional: the address this
//     server uses to reach the app, when it differs from the public DEMO_APP_URL).
//   * the old global team demo (needs a MOCK_* switch AND DEMO_APP_URL + DEMO_APP_LOCAL): every buyer
//     is a pretend one and the fake providers run.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ANY_MOCK, CONFIG, RAILWAY, addBuyer } from "./lib";

const APP = (process.env.DEMO_APP_URL || "").replace(/\/+$/, "");
const LOCAL = (process.env.DEMO_APP_LOCAL || "").replace(/\/+$/, "");
const CALL = LOCAL || APP; // where this server talks to the demo app
export const DEMO = ANY_MOCK && !!APP && !!LOCAL;
/** Demo buyers can be made: the demo app's address and admin sign-in are set (and the site installs on Railway). */
export const DEMO_READY = RAILWAY && !!APP && !!(process.env.DEMO_ADMIN_EMAIL || "").trim() && !!process.env.DEMO_ADMIN_PASSWORD;
/** The wizard shows pretend values and the demo finish for this buyer. */
export const isDemo = (b: { demo?: number }) => DEMO || b.demo === 1;
export class DemoOffline extends Error {}
export const DEMO_KEY = process.env.DEMO_KEY || "";

export function demoBuyer(): string {
  const id = randomBytes(3).toString("hex");
  return addBuyer(`Team test ${id}`, `team-${id}@example.com`, false, { style: "neutral" }).code;
}

/** Pretend account details, already filled in so a tester only presses Continue. */
export function demoSample(view: string, field: string, code: string, on = DEMO): string {
  if (!on) return "";
  const zone = `team-${code.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}.test`;
  const all: Record<string, string> = {
    "railway.token": "mock-rail-token-ok",
    "phones.key": "platform-fake-demo-0001",
    "email.key": "re_mock_full_access_key",
    "email.address": `hello@mail.${zone}`,
    "domain.domain": zone,
  };
  return all[`${view}.${field}`] || "";
}

/** Makes (once per `key`) the agency on the demo app and returns the link that opens it. Throws DemoOffline when the demo app can't be reached. */
export async function demoDashboard(key: string, name: string, email: string, logo = "", colour = ""): Promise<string> {
  const file = join(CONFIG.dataDir, "demo-agencies.json");
  const saved: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const old = saved[key];
  const call = (path: string, init: RequestInit = {}) => fetch(`${CALL}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
  try {
    if (old) return (await call(`/api/invites/${old}`)).ok ? `${APP}/invite/${old}` : `${APP}/login`;
    const signIn = await call("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: process.env.DEMO_ADMIN_EMAIL, password: process.env.DEMO_ADMIN_PASSWORD }),
    });
    if (!signIn.ok) throw new Error(`demo sign-in failed (${signIn.status})`);
    const cookie = (signIn.headers.get("set-cookie") || "").split(";")[0];
    const made = await call("/api/admin/demo-agency", {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name, ownerEmail: email, logo, colour }),
    });
    const token = ((await made.json()) as { url?: string }).url?.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error(`demo agency not created (${made.status})`);
    saved[key] = token;
    writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
    return `${APP}/invite/${token}`;
  } catch (e) {
    console.error(`[demo] dashboard failed: ${(e as Error)?.message || (e as Error)?.name}`);
    throw new DemoOffline();
  }
}
