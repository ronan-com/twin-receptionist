// The Hosting step and the Railway plan: free trial, Free plan, unreadable plan and Hobby, against a stubbed Railway API.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "railwayplan-test-"));
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "HOSTING"]) delete process.env[k];

const { addBuyer } = await import("../lib");
const { actions } = await import("../setup");
const { getSetup, updateSetup } = await import("../store");
const { wizardPage } = await import("../wizard");
const { RAILWAY_PLAN_MSG, RAILWAY_TRIAL_MSG, RAILWAY_PLAN_UNKNOWN_MSG } = await import("../providers");

const realFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = realFetch; });
type Plan = { plan: string; isTrialing: boolean; card: string | null } | "unreadable";
/** Railway, pretend: the account has one workspace on `plan`. */
const stub = (plan: Plan) => {
  globalThis.fetch = (async (_u: any, init: any) => {
    const q = JSON.parse(init.body).query as string;
    const j = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (/\bplan\b/.test(q)) return plan === "unreadable" ? new Response(JSON.stringify({ errors: [{ message: "Problem processing request" }] }), { status: 200 }) : j({ me: { workspaces: [{ id: "ws-1", plan: plan.plan, customer: { isTrialing: plan.isTrialing, defaultPaymentMethodId: plan.card } }] } });
    return j({ me: { email: "owner@example.com", workspaces: [{ id: "ws-1", name: "Owner" }] } });
  }) as any;
};
async function buyer(n: string) {
  const b = addBuyer(`Buyer ${n}`, `rp-${n}@example.com`);
  await actions.start(b, {});
  await actions.brand(b, { productName: "Acme Calls", ownerEmail: "boss@acme.test" });
  return b;
}
const page = (b: any) => wizardPage(b, getSetup(b.id), b.code, "sid", "railway" as any);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

describe("Hosting step and the Railway plan", () => {
  test("before connecting, the step says what plan is needed", async () => {
    const b = await buyer("a");
    const h = page(b);
    expect(h).toContain("Hobby plan");
    expect(h).toContain("free trial");
    expect(h).toContain("stops after 30 days");
  });

  test("Hobby with a card: connected, goes straight on, no warning", async () => {
    const b = await buyer("b"); stub({ plan: "HOBBY", isTrialing: false, card: "pm" });
    expect(await actions.railway(b, { token: "rail-token-0123456789" })).toBeNull();
    expect(getSetup(b.id).step).not.toBe("railway");
    expect(getSetup(b.id).railway).toMatchObject({ confirmed: true, plan: "HOBBY" });
    expect(getSetup(b.id).railway?.trial).toBeUndefined();
    expect(page(b)).not.toContain("free trial.</b>");
  });

  test("free trial: stays on Hosting with a clear warning (30 days / US$5, upgrade to Hobby); Continue still works", async () => {
    const b = await buyer("c"); stub({ plan: "FREE", isTrialing: true, card: null });
    expect(await actions.railway(b, { token: "rail-token-0123456789" })).toBeNull();
    const s = getSetup(b.id);
    expect(s.step).toBe("railway");
    expect(s.railway).toMatchObject({ confirmed: true, trial: true });
    const h = page(b);
    expect(h).toContain("You're on Railway's free trial.");
    expect(h).toContain(esc("30 days or once the US$5 credit is used up"));
    expect(h).toContain("Upgrade to Hobby");
    expect(h).toContain("railway-continue");
    await actions["railway-continue"](b, {});
    expect(getSetup(b.id).step).not.toBe("railway");
  });

  test("a plan name with 'trial' in it counts as the trial too", async () => {
    const b = await buyer("d"); stub({ plan: "TRIAL", isTrialing: false, card: null });
    await actions.railway(b, { token: "rail-token-0123456789" });
    expect(getSetup(b.id).railway?.trial).toBe(true);
  });

  test("Free plan (no trial): refused up front with the Hobby message, nothing saved", async () => {
    const b = await buyer("e"); stub({ plan: "FREE", isTrialing: false, card: null });
    const r = await actions.railway(b, { token: "rail-token-0123456789" });
    expect(r).toMatchObject({ kind: "err", text: RAILWAY_PLAN_MSG });
    expect(getSetup(b.id).railway?.confirmed).toBeFalsy();
  });

  test("a plan we can't read: connects but warns on the Hosting step instead of failing later at Install", async () => {
    const b = await buyer("f"); stub("unreadable");
    expect(await actions.railway(b, { token: "rail-token-0123456789" })).toBeNull();
    expect(getSetup(b.id).step).toBe("railway");
    expect(getSetup(b.id).railway?.planUnknown).toBe(true);
    expect(page(b)).toContain(esc(RAILWAY_PLAN_UNKNOWN_MSG));
  });

  test("the messages are plain and name the numbers", () => {
    expect(RAILWAY_TRIAL_MSG).toMatch(/30 days/);
    expect(RAILWAY_TRIAL_MSG).toMatch(/US\$5/);
    expect(RAILWAY_TRIAL_MSG).toMatch(/Hobby/);
  });

  test("Done page: no token-deleting or backup to-dos (the dashboard button is the main action)", async () => {
    const b = await buyer("g");
    updateSetup(b.id, (s) => { s.railway = { confirmed: true, via: "paste" }; s.phase = "done"; s.step = "done"; s.resultUrl = "https://app-x.up.railway.app"; s.domain = { mode: "cloudflare", zone: "x.test" } as any; });
    const h = wizardPage(b, getSetup(b.id), b.code, "sid", "done" as any);
    expect(h).not.toMatch(/Before you go|Delete your Railway|Revoke|backups/i);
    expect(h).toContain("Open your dashboard");
  });
});
