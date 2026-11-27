// PERMANENT SUITE: no deploy may ever lose a buyer's onboarding progress or break an installed agency.
// The checks for midsetup.test.ts: a real buyer who is partway through setup on the LIVE setup site (1.0.21 shape: schema 2 or none)
// must carry on exactly where they are after the new setup site goes up: same brand, same Railway token, no re-entry, no errors.
// Voice (Telnyx or Vapi) and AI (OpenRouter) are now required, so they are asked for if they are not there yet.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "midsetup-test-"));
const PORT = 49000 + Math.floor(Math.random() * 800);
const SITE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.SITE_URL = SITE;
process.env.MOCK_OAUTH = "1";
process.env.MOCK_TELNYX = "1";
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "HOSTING", "PREVIEW_JUMP", "OPENROUTER_API_KEY"]) delete process.env[k];

const { addBuyer, db } = await import("../lib");
const store = await import("../store");
const { stepDone } = await import("../setup");

let server: ReturnType<typeof Bun.spawn> | null = null;
beforeAll(async () => {
  server = Bun.spawn(["bun", "server.ts"], { cwd: join(import.meta.dir, ".."), stdout: "ignore", stderr: "ignore", env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", SITE_URL: SITE, DATA_DIR: dir, MOCK_OAUTH: "1", MOCK_TELNYX: "1" } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${SITE}/healthz`)).ok) return; } catch {} await Bun.sleep(100); }
  throw new Error("the site didn't start");
}, 30_000);
afterAll(() => server?.kill());

/** Writes the stored setup exactly as live 1.0.21 keeps it (raw JSON, no migration run on it). */
function storedLike(buyerId: number, data: Record<string, unknown>) {
  const t = new Date().toISOString();
  db().query("INSERT OR REPLACE INTO setups (buyer_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)").run(buyerId, JSON.stringify(data), t, t);
}
const base = { phase: "idle", brand: { productName: "Jesse", ownerEmail: "daniel@jesse.test", ownPhoneAccount: false }, railway: { confirmed: true, via: "paste", workspaceName: "Daniel's workspace" } };
const TK = "KEY0123456789ABCDEF0123456789_abcdefghijkl";

async function browser(code: string) {
  const r = await fetch(`${SITE}/setup/${code}`);
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const body = await r.text();
  const t = (body.match(/name="t" value="([^"]+)"/) || body.match(/data-t="([^"]+)"/))![1];
  const get = (path: string) => fetch(`${SITE}${path}`, { redirect: "manual", headers: { cookie } });
  const page = async (step = "") => { const r = await get(`/setup/${code}${step ? `?step=${step}` : ""}`); expect(r.status).toBe(200); return r.text(); };
  const post = (action: string, f: Record<string, string> = {}) => fetch(`${SITE}/setup/${code}/a/${action}`, { method: "POST", redirect: "manual", headers: { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, ...f }).toString() });
  return { page, post, get };
}
const titleOf = (html: string) => html.match(/<title>([^<]*)<\/title>/)![1];
const loc = (r: Response) => r.headers.get("location") || "";
const noError = (html: string) => { expect(html).not.toMatch(/class="notice err"|isn&#39;t valid|went wrong/i); };

describe("Daniel: stored at Voice (welcome, brand and Railway done; Railway token held)", () => {
  for (const [label, schema] of [["schema 2", { schema: 2 }], ["no schema (older)", {}]] as const) {
    test(`${label}: his link lands on Voice with his brand; Voice -> AI -> Connect more -> Install, nothing re-entered`, async () => {
      const b = addBuyer("Daniel", `daniel-${label.length}@example.com`);
      storedLike(b.id, { step: "phones", ...schema, ...base });
      store.putSecret(b.id, "railway_token", "rail-token-0123456789");
      const br = await browser(b.code);
      const first = await br.page();
      expect(titleOf(first)).toStartWith("Voice");
      expect(first).toContain("Jesse");
      expect(first).not.toContain("Skip for now");
      noError(first);
      // Brand and Railway are intact and still shown as done
      expect(store.getSetup(b.id).brand?.productName).toBe("Jesse");
      expect(store.getSetup(b.id).brand?.ownerEmail).toBe("daniel@jesse.test");
      expect(store.hasSecret(b.id, "railway_token")).toBe(true);
      expect(store.getSetup(b.id).railway?.confirmed).toBe(true);
      // Voice: Telnyx
      const tel = await br.post("phones", { v: "phones", opt: "telnyx", key: "platform-fake-daniel-0001" });
      expect(tel.status).toBe(303);
      expect(await br.page("phones")).toContain("Telnyx connected");
      expect(loc(await br.post("phones-continue", { v: "phones" }))).toBe(`/setup/${b.code}`); // first time through: the plain link, which is now AI
      const ai = await br.page();
      expect(titleOf(ai)).toMatch(/OpenRouter|AI/);
      noError(ai);
      // Install is not open yet: AI is required
      expect(titleOf(await br.page("install"))).not.toStartWith("Install");
      // AI: paste a key
      const k = await br.post("ai", { v: "ai", key: "sk-or-v1-daniel0123456789" });
      expect(k.status).toBe(303);
      expect(titleOf(await br.page())).toStartWith("Connect more");
      expect(loc(await br.post("extras-continue", { v: "extras" }))).toBe(`/setup/${b.code}`);
      const install = await br.page();
      expect(titleOf(install)).toStartWith("Install");
      expect(install).toContain("Jesse");
      noError(install);
      expect(store.hasSecret(b.id, "railway_token")).toBe(true);
    });
  }

  test("Vapi instead of Telnyx works from the same place", async () => {
    const b = addBuyer("Daniel V", "daniel-v@example.com");
    storedLike(b.id, { step: "phones", schema: 2, ...base });
    store.putSecret(b.id, "railway_token", "rail-token-0123456789");
    const br = await browser(b.code);
    expect(titleOf(await br.page())).toStartWith("Voice");
    const v = await br.post("phones-vapi", { v: "phones", opt: "vapi", vapiKey: "platform-fake-vapi-0001", vapiPublic: "platform-fake-pub-0001" });
    expect(v.status).toBe(303);
    expect(await br.page("phones")).toContain("Vapi connected");
    expect(loc(await br.post("phones-continue", { v: "phones" }))).toBe(`/setup/${b.code}`);
    expect(titleOf(await br.page())).toMatch(/OpenRouter|AI/);
  });
});

describe("a buyer stored at AI (Voice done)", () => {
  test("lands on AI, adds the key, Connect more, Install", async () => {
    const b = addBuyer("At AI", "at-ai@example.com");
    storedLike(b.id, { step: "ai", schema: 2, ...base, phones: { confirmed: true, provider: "telnyx", checked: true, numbers: [], balance: "25.00 USD" } });
    store.putSecret(b.id, "railway_token", "rail-token-0123456789");
    store.putSecret(b.id, "telnyx_key", TK);
    const br = await browser(b.code);
    const first = await br.page();
    expect(titleOf(first)).toMatch(/OpenRouter|AI/);
    expect(first).toContain("Jesse");
    noError(first);
    expect((await br.post("ai", { v: "ai", key: "sk-or-v1-atai0123456789" })).status).toBe(303);
    expect(titleOf(await br.page())).toStartWith("Connect more");
    await br.post("extras-continue", { v: "extras" });
    expect(titleOf(await br.page())).toStartWith("Install");
    expect(store.hasSecret(b.id, "telnyx_key")).toBe(true);
  });
});

describe("a buyer stored at Install (everything connected)", () => {
  test("still lands on Install with everything intact (old setups have no Connect more mark)", async () => {
    const b = addBuyer("At Install", "at-install@example.com");
    storedLike(b.id, { step: "install", schema: 2, ...base, phones: { confirmed: true, provider: "telnyx", checked: true, numbers: [] }, ai: { confirmed: true, via: "paste" } });
    store.putSecret(b.id, "railway_token", "rail-token-0123456789");
    store.putSecret(b.id, "telnyx_key", TK);
    store.putSecret(b.id, "openrouter_key", "sk-or-v1-atinstall0123456789");
    const br = await browser(b.code);
    const html = await br.page();
    expect(titleOf(html)).toStartWith("Install");
    expect(html).toContain("Jesse");
    expect(html).toContain("/a/install-start");
    noError(html);
    // The earlier steps open again for a look (Back), each with what was stored
    for (const step of ["brand", "railway", "phones", "ai"]) noError(await br.page(step));
    expect(titleOf(await br.page("phones"))).toStartWith("Voice");
  });

  test("an old buyer who SKIPPED voice (allowed before 1.0.22) is sent back to Voice, not into Install, and keeps everything else", async () => {
    const b = addBuyer("Skipped", "skipped@example.com");
    storedLike(b.id, { step: "install", schema: 2, ...base, phones: { deferred: true, provider: "telnyx" }, skipped: { phones: true, vapi: true }, ai: { confirmed: true, via: "paste" } });
    store.putSecret(b.id, "railway_token", "rail-token-0123456789");
    store.putSecret(b.id, "openrouter_key", "sk-or-v1-skipped0123456789");
    const br = await browser(b.code);
    const html = await br.page();
    expect(titleOf(html)).toStartWith("Voice");
    noError(html);
    expect(store.hasSecret(b.id, "railway_token")).toBe(true);
    expect(store.hasSecret(b.id, "openrouter_key")).toBe(true);
    expect((await br.post("install-start", { v: "install" })).status).toBe(303);
    expect(store.getSetup(b.id).phase).toBe("idle"); // refused
  });
});

describe("every step of the 1.0.21 flow, stored in the 1.0.21 format", () => {
  const h1 = (html: string) => (html.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] || "").replace(/<[^>]+>/g, "").trim();
  const tel = { phones: { confirmed: true, provider: "telnyx", checked: true, numbers: [], balance: "25.00 USD" } };
  const keys = (id: number, names: string[]) => { for (const n of names) store.putSecret(id, n as any, n === "telnyx_key" ? TK : n === "openrouter_key" ? "sk-or-v1-mid0123456789" : "rail-token-0123456789"); };

  test("welcome: a buyer who only opened the link", async () => {
    const b = addBuyer("Mid welcome", "mid-w@example.com");
    storedLike(b.id, { step: "welcome", phase: "idle", schema: 2 });
    const br = await browser(b.code);
    expect(h1(await br.page())).toBe("Set up your agency");
    expect((await br.post("start")).status).toBe(303);
    expect(titleOf(await br.page())).toStartWith("Brand");
  });

  test("brand: brand saved with no colour fields (they are new) -> the form shows what was stored; saving moves on", async () => {
    const b = addBuyer("Mid brand", "mid-b@example.com");
    storedLike(b.id, { step: "brand", phase: "idle", schema: 2, brand: { productName: "Jesse", ownerEmail: "daniel@jesse.test", ownPhoneAccount: false } });
    const br = await browser(b.code);
    const html = await br.page();
    expect(titleOf(html)).toStartWith("Brand");
    expect(html).toContain('value="Jesse"');
    expect(html).toContain("daniel@jesse.test");
    expect((await br.post("brand", { productName: "Jesse", ownerEmail: "daniel@jesse.test", colour: "#635bff" })).status).toBe(303);
    expect(titleOf(await br.page())).toStartWith("Hosting");
  });

  test("railway: brand done, token not yet", async () => {
    const b = addBuyer("Mid railway", "mid-r@example.com");
    storedLike(b.id, { step: "railway", phase: "idle", schema: 2, brand: base.brand });
    const br = await browser(b.code);
    expect(h1(await br.page())).toBe("Connect Railway");
    expect(store.getSetup(b.id).brand?.productName).toBe("Jesse");
  });

  test("installing: the build is running -> the Setting up screen, the stored Railway project and token untouched", async () => {
    const b = addBuyer("Mid installing", "mid-i@example.com");
    storedLike(b.id, { ...base, step: "install", phase: "deploying", schema: 2, ...tel, ai: { confirmed: true, via: "paste" }, attempt: 1, attemptVersion: "1.0.21",
      rw: { projectId: "proj-1", environmentId: "env-1", appId: "app-1", pgId: "pg-1", serviceDomain: "app-x.up.railway.app", varsSet: true, settingsSet: true, deploymentId: "dep-1", deployStatus: "BUILDING", uploadedAt: new Date().toISOString() } });
    keys(b.id, ["railway_token", "telnyx_key", "openrouter_key"]);
    const br = await browser(b.code);
    const html = await br.page();
    expect(h1(html)).toMatch(/Setting up/);
    noError(html);
    const s = store.getSetup(b.id);
    expect(s.phase).toBe("deploying");
    expect(s.rw?.projectId).toBe("proj-1");
    expect(store.hasSecret(b.id, "railway_token")).toBe(true);
    expect(store.hasSecret(b.id, "telnyx_key")).toBe(true);
    // a buyer mid-install is never sent back to an earlier step, whatever is stored for Voice or AI
    expect(stepDone(b, s, "phones")).toBe(true);
    expect(stepDone(b, s, "ai")).toBe(true);
  });

  test("failed: the Install stopped screen with Try again; keys and project kept", async () => {
    const b = addBuyer("Mid failed", "mid-f@example.com");
    storedLike(b.id, { ...base, step: "install", phase: "failed", schema: 2, ...tel, ai: { confirmed: true, via: "paste" }, error: "Railway couldn't build the app", attempt: 1,
      rw: { projectId: "proj-1", environmentId: "env-1", appId: "app-1", deploymentId: "dep-1", deployStatus: "FAILED" } });
    keys(b.id, ["railway_token", "telnyx_key", "openrouter_key"]);
    const br = await browser(b.code);
    const html = await br.page();
    expect(h1(html)).toBe("The install stopped");
    expect(html).toContain("/a/install-retry");
    expect(store.hasSecret(b.id, "railway_token")).toBe(true);
  });

  test("done: a finished agency (1.0.21 finish() shape, no secrets left) -> the live screen with its address and dashboard link; Update still works", async () => {
    const b = addBuyer("Mid done", "mid-d@example.com");
    storedLike(b.id, { step: "done", phase: "done", schema: 2, brand: { productName: "Ronana AI", ownerEmail: "ronan@example.com", ownPhoneAccount: false }, railway: { workspaceName: "W", confirmed: true },
      phones: { confirmed: true, provider: "telnyx" }, skipped: {}, extrasDone: true, resultUrl: "https://app-production-1dd020dd.up.railway.app", tempUrl: "https://app-production-1dd020dd.up.railway.app",
      attemptVersion: "1.0.21", installedAt: new Date().toISOString(), rw: { projectId: "proj-1", serviceDomain: "app-production-1dd020dd.up.railway.app" } });
    const br = await browser(b.code);
    const html = await br.page();
    expect(h1(html)).toBe("Your agency is live");
    expect(html).toContain("app-production-1dd020dd.up.railway.app");
    expect(html).toContain("Open your dashboard");
    noError(html);
    // the steps stay closed: a finished agency is not sent back into the wizard
    expect(h1(await br.page("phones"))).toBe("Your agency is live");
    expect(store.getSetup(b.id).phase).toBe("done");
    expect(store.getSetup(b.id).resultUrl).toBe("https://app-production-1dd020dd.up.railway.app");
  });

  test("done, from a buyer who skipped Voice in 1.0.21: still live, still on the done screen (never sent back)", async () => {
    const b = addBuyer("Mid done skipped", "mid-ds@example.com");
    storedLike(b.id, { step: "done", phase: "done", schema: 2, brand: base.brand, phones: { deferred: true, provider: "telnyx" }, skipped: { phones: true, vapi: true }, extrasDone: true,
      resultUrl: "https://app-y.up.railway.app", tempUrl: "https://app-y.up.railway.app", rw: { projectId: "p" } });
    const br = await browser(b.code);
    const html = await br.page();
    expect(h1(html)).toBe("Your agency is live");
    noError(html);
  });
});

describe("Railway mode never shows DigitalOcean", () => {
  test("no DigitalOcean on any wizard step or the public pages for a Railway buyer", async () => {
    const b = addBuyer("Rail only", "rail-only@example.com");
    storedLike(b.id, { step: "phones", schema: 2, ...base });
    store.putSecret(b.id, "railway_token", "rail-token-0123456789");
    const br = await browser(b.code);
    for (const step of ["welcome", "brand", "railway", "phones", "ai", "extras", "email", "domain", "calendars", "vapi", "twilio"]) {
      const html = await br.get(`/setup/${b.code}?step=${step}`).then((r) => r.text());
      expect(html).not.toMatch(/DigitalOcean|droplet/i);
    }
    for (const path of ["/", "/guide"]) expect(await (await fetch(`${SITE}${path}`)).text()).not.toMatch(/DigitalOcean|droplet/i);
  });
});

describe("scripts/check-sitedb.ts on a copy of this site.db", () => {
  test("prints OK for every buyer above, never touches the file it is given, exits 0", async () => {
    const { copyFileSync } = await import("node:fs");
    const snap = join(dir, "snapshot.db");
    db().exec("PRAGMA wal_checkpoint(TRUNCATE)");
    copyFileSync(join(dir, "site.db"), snap);
    const before = await Bun.file(snap).bytes();
    const p = Bun.spawn(["bun", "scripts/check-sitedb.ts", snap], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, DATA_DIR: "/nonexistent" } });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect(err).toBe("");
    expect(out).toContain("Safe to deploy");
    expect(out).toMatch(/OK\s+#\d+ Mid done/);
    expect(out).toContain("sent back to voice");
    expect(out).not.toMatch(/FAIL/);
    expect(code).toBe(0);
    expect(Buffer.compare(Buffer.from(await Bun.file(snap).bytes()), Buffer.from(before))).toBe(0);
  });
});
