// Team demo only (needs a MOCK_* switch AND DEMO_APP_URL): the wizard's accounts are pretend,
// and "Open your dashboard" makes a real agency on a running copy of the app.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ANY_MOCK, CONFIG, addBuyer } from "./lib";

const APP = (process.env.DEMO_APP_URL || "").replace(/\/+$/, "");
const LOCAL = (process.env.DEMO_APP_LOCAL || "").replace(/\/+$/, "");
export const DEMO = ANY_MOCK && !!APP && !!LOCAL;
export const DEMO_KEY = process.env.DEMO_KEY || "";

export function demoBuyer(): string {
  const id = randomBytes(3).toString("hex");
  return addBuyer(`Team test ${id}`, `team-${id}@example.com`).code;
}

/** Pretend account details, already filled in so a tester only presses Continue. */
export function demoSample(view: string, field: string, code: string): string {
  if (!DEMO) return "";
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

export async function demoDashboard(buyerId: number, name: string, email: string, logo = "", colour = ""): Promise<string> {
  const file = join(CONFIG.dataDir, "demo-agencies.json");
  const saved: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const old = saved[buyerId];
  if (old) return (await fetch(`${LOCAL}/api/invites/${old}`)).ok ? `${APP}/invite/${old}` : `${APP}/login`;
  const signIn = await fetch(`${LOCAL}/api/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.DEMO_ADMIN_EMAIL, password: process.env.DEMO_ADMIN_PASSWORD }),
  });
  if (!signIn.ok) throw new Error(`demo sign-in failed (${signIn.status})`);
  const cookie = (signIn.headers.get("set-cookie") || "").split(";")[0];
  const made = await fetch(`${LOCAL}/api/admin/demo-agency`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name, ownerEmail: email, logo, colour }),
  });
  const token = ((await made.json()) as { url?: string }).url?.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error(`demo agency not created (${made.status})`);
  saved[buyerId] = token;
  writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
  return `${APP}/invite/${token}`;
}
