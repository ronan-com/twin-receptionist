// bun test download-site/test/demo.test.ts
// A demo buyer never touches a provider and still finishes the wizard; a real buyer still has
// every key checked; an old database gets the demo column.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "demo-test-"));
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 3).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "HOSTING"]) delete process.env[k];

// An old live database: buyers table without the demo column, one real buyer already in it.
mkdirSync(join(dir, "packages"), { recursive: true });
{
  const old = new Database(join(dir, "site.db"), { create: true });
  old.exec(`CREATE TABLE buyers (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, code_hash BLOB NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT, downloads INTEGER NOT NULL DEFAULT 0, last_download_at TEXT);
    INSERT INTO buyers (id, code, code_hash, name, email, created_at) VALUES (1, 'oldcode', x'00', 'Old Buyer', 'old@example.com', '2026-01-01T00:00:00Z');`);
  old.close();
}

const { addBuyer, db, findBuyer } = await import("../lib");
const { actions } = await import("../setup");
const { getSetup, getSecret, hasSecret } = await import("../store");

const realFetch = globalThis.fetch;
let calls: string[] = [];
const spy = (impl?: (url: string) => Response) => {
  calls = [];
  globalThis.fetch = (async (url: any) => { calls.push(String(url)); if (!impl) throw new Error("a demo buyer must not call out: " + url); return impl(String(url)); }) as any;
};
afterAll(() => { globalThis.fetch = realFetch; });

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const run = async (b: any, name: string, f: Record<string, string> = {}) => actions[name](b, f);

describe("demo column", () => {
  test("an old database gets it, off for everyone already there", () => {
    expect(db().query("SELECT demo FROM buyers WHERE id = 1").get()).toEqual({ demo: 0 });
  });
});

describe("demo buyer", () => {
  test("walks the whole wizard with no provider call and no stored key", async () => {
    spy();
    const b = addBuyer("Demo 10:00", "demo-1@example.com", true);
    expect(findBuyer(b.code)!.demo).toBe(1);
    expect(await run(b, "start")).toBeNull();
    expect(await run(b, "brand", { productName: "Acme Calls", ownerEmail: "boss@acme.test", logo: PNG, colour: "#aa2244" })).toBeNull();
    // Anything (even nothing, even rubbish) is accepted on every account step.
    expect(await run(b, "railway", { token: "not a real token" })).toBeNull();
    expect(await run(b, "phones", {})).toBeNull();
    // The short path: Brand, Hosting, Voice, AI, Connect more (all skippable), then Install.
    expect(getSetup(b.id).step).toBe("ai");
    expect(await run(b, "ai", {})).toBeNull();
    expect(getSetup(b.id).step).toBe("extras");
    expect(await run(b, "extras-continue", {})).toBeNull();
    const s = getSetup(b.id);
    expect(s.step).toBe("install");
    expect(s.email).toBeUndefined();
    expect(s.domain).toBeUndefined();
    expect(await run(b, "install-start")).toBeNull();
    const t0 = Date.now();
    while (getSetup(b.id).phase !== "done" && Date.now() - t0 < 25_000) await Bun.sleep(300);
    const done = getSetup(b.id);
    expect(done.phase).toBe("done");
    expect(done.resultUrl).toBe(`http://localhost:4500/setup/${b.code}/open`);
    expect(done.brand).toMatchObject({ productName: "Acme Calls", ownerEmail: "boss@acme.test", colour: "#aa2244", logo: PNG });
    expect(calls).toEqual([]);
    for (const n of ["railway_token", "telnyx_key", "resend_key", "cf_token", "smtp_password", "google_secret", "microsoft_secret"] as const) expect(hasSecret(b.id, n)).toBe(false);
  }, 40_000);

  test("the extras can still be added in a test run, and each one skipped", async () => {
    spy();
    const b = addBuyer("Demo 10:02", "demo-3@example.com", true);
    await run(b, "start"); await run(b, "brand", { productName: "Y", ownerEmail: "y@y.test" });
    await run(b, "railway"); await run(b, "phones"); await run(b, "ai");
    expect(getSetup(b.id).step).toBe("extras");
    expect(await run(b, "email", { key: "garbage", address: "also garbage" })).toBeNull();
    expect(await run(b, "domain", { domain: "", mode: "cloudflare", token: "x" })).toBeNull();
    expect(await run(b, "calendars", { googleId: "x", googleSecret: "y", microsoftId: "z", microsoftSecret: "w" })).toBeNull();
    // The backup options (Vapi, Twilio) are pretend too, and Telnyx stays the default until Vapi is added.
    expect(await run(b, "vapi", { vapiKey: "x", vapiPublic: "y" })).toBeNull();
    expect(getSetup(b.id).vapi?.confirmed).toBe(true);
    expect(await run(b, "twilio", { twilioSid: "x", twilioToken: "y" })).toBeNull();
    expect(getSetup(b.id).step).toBe("extras"); // each extra comes back to Connect more
    expect(getSetup(b.id).domain?.host).toMatch(/^app\.demo-.+\.test$/);
    expect(calls).toEqual([]);
  });

  test("smtp, test email and rechecks are pretend too", async () => {
    spy();
    const b = addBuyer("Demo 10:01", "demo-2@example.com", true);
    await run(b, "start"); await run(b, "brand", { productName: "X", ownerEmail: "x@x.test" });
    await run(b, "railway"); await run(b, "phones"); await run(b, "ai");
    expect(await run(b, "smtp", { host: "nope", port: "1", user: "", pass: "" })).toBeNull();
    expect(getSetup(b.id).email?.confirmed).toBe(true);
    expect((await run(b, "email-test"))?.kind).toBe("ok");
    await run(b, "email-recheck"); await run(b, "cf-recheck");
    expect(calls).toEqual([]);
  });
});

describe("real buyer, the short path", () => {
  test("reaches Install with Railway, Telnyx and OpenRouter only; the old extras are no longer steps", async () => {
    const b = addBuyer("Slim Buyer", "slim@example.com");
    await run(b, "start");
    await run(b, "brand", { productName: "Slim Co", ownerEmail: "slim@slim.test" });
    // Stand-in for a passed Railway and Telnyx check (those are covered by the key tests).
    const { updateSetup, putSecret } = await import("../store");
    updateSetup(b.id, (s) => { s.railway = { confirmed: true }; s.phones = { confirmed: true }; s.step = "ai"; });
    putSecret(b.id, "railway_token", "railway-test-token-0000");
    expect((await run(b, "install-start"))?.kind).toBe("err"); // OpenRouter is required
    updateSetup(b.id, (s) => { s.ai = { confirmed: true, via: "paste" }; });
    expect((await run(b, "install-start"))?.kind).toBe("err"); // "confirmed" without a stored, checked key is not enough
    putSecret(b.id, "openrouter_key", "sk-or-test-0123456789");
    expect(await run(b, "ai-continue")).toBeNull();
    expect(getSetup(b.id).step).toBe("extras");
    expect((await run(b, "install-start"))?.kind).toBe("err"); // Connect more comes first (nothing on it is needed: Skip all and continue)
    expect(await run(b, "extras-continue")).toBeNull();
    expect(getSetup(b.id).step).toBe("install");
    // Email through Resend with no domain is still refused with a plain message.
    updateSetup(b.id, (s) => { s.email = { mode: "resend", confirmed: true, from: "X <a@mail.slim.test>" }; });
    expect((await run(b, "install-start"))?.text).toMatch(/domain/i);
  });
});

describe("real buyer", () => {
  test("still has every key checked", async () => {
    const b = addBuyer("Real Buyer", "real@example.com");
    expect(b.demo).toBe(0);
    await run(b, "start");
    await run(b, "brand", { productName: "Real Co", ownerEmail: "real@real.test" });
    spy(() => new Response(JSON.stringify({ errors: [{ message: "Not Authorized" }] }), { status: 401, headers: { "Content-Type": "application/json" } }));
    const r = await run(b, "railway", { token: "definitely-not-accepted-token" });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.join(" ")).toContain("railway.com");
    expect(r?.kind).toBe("err");
    expect(getSetup(b.id).railway?.confirmed).toBeFalsy();
    expect(getSetup(b.id).step).toBe("railway");
    expect(hasSecret(b.id, "railway_token")).toBe(false);
    // An empty field is refused, not waved through.
    expect((await run(b, "phones", {}))?.kind).toBe("err");
    expect(getSecret(b.id, "telnyx_key")).toBeNull();
  });
});
