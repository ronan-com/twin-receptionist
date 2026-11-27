// The checks for onboarding.test.ts.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "onboarding-test-"));
const ADMIN = "boss@example.com";
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 3).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
process.env.MOCK_OAUTH = "1";
process.env.MOCK_TELNYX = "1";
process.env.ADMIN_EMAILS = ADMIN;
process.env.SITE_SMTP_URL = "smtp://127.0.0.1:1";
process.env.SITE_MAIL_FROM = "setup@example.com";
for (const k of ["HOSTING", "MOCK_DO", "MOCK_CF", "MOCK_RESEND", "PREVIEW_JUMP", "RESEND_API_KEY", "ALERT_WEBHOOK_URL", "ALERT_EMAIL_TO"]) delete process.env[k];

const { addBuyer, db, now } = await import("../lib");
const oauth = await import("../oauth");
const setup = await import("../setup");
const store = await import("../store");
const mailer = await import("../mailer");
const alerts = await import("../alerts");
const sync = await import("../sync");
const { adminRoute, newAdminLink, sendForgotLink } = await import("../admin-web");
const { wizardPage } = await import("../wizard");

// Every email the site "sends" lands here.
const sent: { to: string; subject: string; text: string; html?: string }[] = [];
mailer.mailDeps.deliver = async (_smtp, mail) => { sent.push({ to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }); };
const realFetch = globalThis.fetch;
// The mock OAuth providers answer inside this process.
globalThis.fetch = (async (url: any, init: any) => {
  const u = new URL(String(url));
  if (u.pathname.startsWith("/__mock/oauth/")) return (await oauth.mockOAuthRoute(new Request(u.toString(), init), u))!;
  return realFetch(url, init);
}) as any;
afterAll(() => { globalThis.fetch = realFetch; });

const newBuyer = (n: string) => addBuyer(`Buyer ${n}`, `ob-${n}@example.com`);

describe("OAuth: PKCE and state", () => {
  test("the S256 challenge is the RFC 7636 one", () => {
    expect(oauth.challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  test("starting a login: a fresh state and challenge, the verifier stays here, the redirect address is ours", async () => {
    const b = newBuyer("a");
    const seen = new Set<string>();
    for (const p of oauth.OAUTH_PROVIDERS) {
      const { url, cookie } = await oauth.oauthStart(b.id, p);
      const u = new URL(url);
      expect(u.pathname).toBe(`/__mock/oauth/${p}/authorize`);
      expect(u.searchParams.get("code_challenge_method")).toBe("S256");
      expect(u.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(u.searchParams.get(p === "openrouter" ? "callback_url" : "redirect_uri")).toBe(`http://localhost:4500/oauth/${p}/callback`);
      const state = u.searchParams.get("state")!;
      expect(state.length).toBeGreaterThanOrEqual(40);
      expect(seen.has(state)).toBe(false); seen.add(state);
      expect(url).not.toMatch(/verifier/i);
      expect(cookie).toMatch(/^ob=[A-Za-z0-9_-]+; Path=\/oauth; HttpOnly; SameSite=Lax/);
      // Only a hash of the state is stored.
      const row = db().query("SELECT * FROM oauth_states ORDER BY rowid DESC LIMIT 1").get() as any;
      expect(Buffer.from(row.state_hash).toString("utf8")).not.toContain(state);
      expect(oauth.challengeOf(row.verifier)).toBe(u.searchParams.get("code_challenge") as string);
    }
    // The paste-a-key way is always there; Railway and Telnyx buttons need their own registration outside test mode.
  });

  test("a state works once, only for its provider, its browser, and for 10 minutes", async () => {
    const b = newBuyer("b");
    const start = async (p: "railway" | "telnyx" | "openrouter") => {
      const { url, cookie } = await oauth.oauthStart(b.id, p);
      return { state: new URL(url).searchParams.get("state")!, browser: cookie.match(/^ob=([^;]+)/)![1] };
    };
    const a = await start("openrouter");
    expect(oauth.consumeState("railway", a.state, a.browser)).toMatchObject({ ok: false, reason: "bad-state" }); // another provider's callback
    const a2 = await start("openrouter");
    expect(oauth.consumeState("openrouter", a2.state, "someone-elses-browser-cookie-0123")).toMatchObject({ ok: false, reason: "browser" });
    expect(oauth.consumeState("openrouter", a2.state, a2.browser)).toMatchObject({ ok: false, reason: "used" }); // a try uses it up
    const ok = oauth.consumeState("openrouter", a.state, a.browser);
    expect(ok).toMatchObject({ ok: true, buyerId: b.id });
    expect(oauth.consumeState("openrouter", a.state, a.browser)).toMatchObject({ ok: false, reason: "used" });
    expect(oauth.consumeState("openrouter", "x".repeat(43), a.browser)).toMatchObject({ ok: false, reason: "bad-state" });
    expect(oauth.consumeState("openrouter", "short", a.browser)).toMatchObject({ ok: false, reason: "bad-state" });
    const late = await start("telnyx");
    expect(oauth.consumeState("telnyx", late.state, late.browser, Date.now() + 11 * 60_000)).toMatchObject({ ok: false, reason: "expired" });
  });

  test("OpenRouter does not send our state back: the browser cookie finds the sign-in instead (once, this browser, this provider, 10 minutes)", async () => {
    const b = newBuyer("nostate");
    const start = async (p: "railway" | "telnyx" | "openrouter") => {
      const { cookie } = await oauth.oauthStart(b.id, p);
      return cookie.match(/^ob=([^;]+)/)![1];
    };
    const c1 = await start("openrouter");
    expect(oauth.consumeState("openrouter", "", "someone-elses-browser-cookie-0123")).toMatchObject({ ok: false, reason: "bad-state" }); // another browser
    expect(oauth.consumeState("openrouter", "", "")).toMatchObject({ ok: false, reason: "bad-state" }); // no cookie at all
    expect(oauth.consumeState("openrouter", "", c1)).toMatchObject({ ok: true, buyerId: b.id });
    expect(oauth.consumeState("openrouter", "", c1)).toMatchObject({ ok: false, reason: "bad-state" }); // used up
    const c2 = await start("openrouter");
    expect(oauth.consumeState("openrouter", "", c2, Date.now() + 11 * 60_000)).toMatchObject({ ok: false, reason: "expired" });
    // Only OpenRouter may do this: Telnyx and Railway still need their state.
    const c3 = await start("telnyx");
    expect(oauth.consumeState("telnyx", "", c3)).toMatchObject({ ok: false, reason: "bad-state" });
    // Two sign-ins started in one browser: the newest one wins.
    await start("openrouter");
    const newest = await oauth.oauthStart(b.id, "openrouter");
    const cookieN = newest.cookie.match(/^ob=([^;]+)/)![1];
    expect(oauth.consumeState("openrouter", "", cookieN)).toMatchObject({ ok: true, buyerId: b.id });
  });

  test("the code is swapped with the verifier; OpenRouter gives a key, Railway a refreshable token; a bad code is an error", async () => {
    const b = newBuyer("c");
    const or = await oauth.exchangeCode("openrouter", "mock-code", "v".repeat(60));
    expect(or.access).toMatch(/^sk-or-v1-/);
    const rw = await oauth.exchangeCode("railway", "mock-code", "v".repeat(60));
    expect(rw).toMatchObject({ access: "mock-rail-token-ok", refresh: "mock-rail-refresh", expiresIn: 3600 });
    await expect(oauth.exchangeCode("telnyx", "mock-code", "")).rejects.toThrow(); // no verifier: the provider refuses
    void b;
  });

  test("Sign in with OpenRouter finishes its step; Telnyx sign-in is parked (no button) but its code still works; Telnyx shows the numbers it already has", async () => {
    const b = newBuyer("d");
    await setup.actions.start(b, {}); await setup.actions.brand(b, { productName: "Acme", ownerEmail: "o@acme.test" });
    store.updateSetup(b.id, (s) => { s.railway = { confirmed: true, via: "oauth" }; s.step = "phones"; });
    store.putSecret(b.id, "railway_token", "mock-rail-token-ok");
    const before = wizardPage(b, store.getSetup(b.id), b.code, "sid", "phones", undefined, "telnyx");
    expect(before).not.toContain("Sign in with Telnyx"); // parked: paste a key only
    expect(before).not.toContain(`/oauth/telnyx`);
    expect(oauth.oauthEnabled("telnyx")).toBe(false);
    expect(oauth.oauthEnabled("openrouter")).toBe(true); // this one is kept
    expect(await setup.oauthComplete(b, "telnyx", await oauth.exchangeCode("telnyx", "c", "v".repeat(60)))).toBeNull();
    const s = store.getSetup(b.id);
    expect(s.phones).toMatchObject({ confirmed: true, via: "oauth", numbers: ["+61 2 5550 0101", "+61 3 5550 0102"] });
    expect(store.getSecret(b.id, "telnyx_key")).toMatch(/^platform-fake-/); // a key that doesn't run out, made with the login
    expect(s.step).toBe("phones"); // stays, so they see the numbers
    const page = wizardPage(b, s, b.code, "sid", "phones");
    expect(page).toContain("+61 2 5550 0101");
    expect(page).toContain("Telnyx connected");
    expect(await setup.actions["phones-continue"](b, {})).toBeNull();
    expect(store.getSetup(b.id).step).toBe("ai");
    expect(await setup.oauthComplete(b, "openrouter", await oauth.exchangeCode("openrouter", "c", "v".repeat(60)))).toBeNull();
    expect(store.getSetup(b.id)).toMatchObject({ ai: { confirmed: true, via: "oauth" }, step: "extras" });
    expect(store.getSecret(b.id, "openrouter_key")).toMatch(/^sk-or-v1-/);
  });
});

describe("old setups keep working", () => {
  const old = (name: string, data: Record<string, unknown>) => {
    const b = newBuyer(name);
    store.getSetup(b.id); // makes the row
    db().query("UPDATE setups SET data = ? WHERE buyer_id = ?").run(JSON.stringify({ phase: "idle", ...data }), b.id);
    return b;
  };
  test("a buyer sitting on a step that is gone moves to the next one that is there; what they stored stays", () => {
    const brand = { productName: "Old Co", ownerEmail: "o@old.test", ownPhoneAccount: false };
    const b1 = old("m1", { step: "extras", brand, railway: { confirmed: true }, phones: { confirmed: true, provider: "telnyx" }, skipped: { email: true } });
    expect(store.getSetup(b1.id)).toMatchObject({ schema: 3, step: "ai", skipped: { email: true }, phones: { confirmed: true } });
    const b2 = old("m2", { step: "vapi", brand, railway: { confirmed: true } });
    expect(store.getSetup(b2.id).step).toBe("phones");
    const b3 = old("m3", { step: "calendars", railway: { confirmed: true } });
    expect(store.getSetup(b3.id).step).toBe("brand");
    // Already on a step that's still there: untouched, and an install that started carries on.
    const b4 = old("m4", { step: "install", phase: "deploying", brand, railway: { confirmed: true }, phones: { confirmed: true }, rw: { projectId: "p1" } });
    expect(store.getSetup(b4.id)).toMatchObject({ step: "install", phase: "deploying", rw: { projectId: "p1" } });
    expect(setup.stepDone(b4, store.getSetup(b4.id), "ai")).toBe(true); // an install in progress never goes back to ask for the new key
    expect(store.getSetup(b4.id).extrasDone).toBe(true); // ...nor for the new Connect more step
    // A buyer on the short wizard (schema 2): at Install they skip the new Connect more step; before it, they meet it.
    const b8 = old("m8", { schema: 2, step: "install", brand, railway: { confirmed: true }, phones: { confirmed: true }, ai: { confirmed: true } });
    expect(store.getSetup(b8.id)).toMatchObject({ schema: 3, step: "install", extrasDone: true });
    const b9 = old("m9", { schema: 2, step: "ai", brand, railway: { confirmed: true }, phones: { confirmed: true } });
    expect(store.getSetup(b9.id)).toMatchObject({ schema: 3, step: "ai" });
    expect(store.getSetup(b9.id).extrasDone).toBeUndefined();
    // Email through Resend, started but with no domain finished, would block the install: dropped. A finished domain keeps its email.
    const b5 = old("m5", { step: "email", brand, railway: { confirmed: true }, phones: { confirmed: true }, email: { mode: "resend", confirmed: true, from: "A <a@mail.x.test>" } });
    expect(store.getSetup(b5.id).email).toBeUndefined();
    expect(store.getSetup(b5.id).skipped?.email).toBe(true);
    const b6 = old("m6", { step: "email", brand, railway: { confirmed: true }, phones: { confirmed: true }, domain: { mode: "manual", zone: "x.test", sub: "app", host: "app.x.test", confirmed: true }, email: { mode: "resend", confirmed: true, from: "A <a@mail.x.test>" } });
    expect(store.getSetup(b6.id)).toMatchObject({ email: { mode: "resend" }, domain: { host: "app.x.test" } });
    // Idempotent.
    expect(store.migrate(store.getSetup(b1.id))).toEqual(store.getSetup(b1.id));
  });
  test("a finished agency is untouched", () => {
    const b = old("m7", { step: "done", phase: "done", brand: { productName: "Live Co", ownerEmail: "o@l.test", ownPhoneAccount: false }, resultUrl: "https://app.live.test" });
    expect(store.getSetup(b.id)).toMatchObject({ step: "done", phase: "done", resultUrl: "https://app.live.test" });
  });
});

describe("what the installed app is given", () => {
  const TK = "KEY0123456789ABCDEF0123456789_abcdefghijkl";
  async function ready(n: string, f: { telnyx?: boolean; vapi?: boolean; twilio?: boolean }) {
    const b = newBuyer(n);
    await setup.actions.start(b, {}); await setup.actions.brand(b, { productName: "Acme", ownerEmail: "o@acme.test" });
    store.putSecret(b.id, "openrouter_key", "sk-or-v1-abcdef0123456789");
    store.updateSetup(b.id, (s) => {
      s.ai = { confirmed: true };
      if (f.telnyx) s.phones = { confirmed: true, provider: "telnyx" };
      if (f.vapi) { s.vapi = { confirmed: true }; if (!f.telnyx) s.phones = { checked: true, provider: "vapi" }; }
      if (f.twilio) s.twilio = { sid: "AC" + "a".repeat(32), confirmed: true };
    });
    if (f.telnyx) store.putSecret(b.id, "telnyx_key", TK);
    if (f.vapi) { store.putSecret(b.id, "vapi_key", "priv-0123456789abcdef"); store.putSecret(b.id, "vapi_public", "pub-0123456789abcdef"); }
    if (f.twilio) store.putSecret(b.id, "twilio_token", "t".repeat(32));
    return b;
  }
  const V = { VAPI_API_KEY: "priv-0123456789abcdef", VAPI_PUBLIC_KEY: "pub-0123456789abcdef" };
  test("Telnyx only: Telnyx is the voice engine", async () => {
    const b = await ready("e1", { telnyx: true });
    expect(setup.phoneSettings(b.id, store.getSetup(b.id))).toEqual({ TELNYX_API_KEY: TK, VOICE_PROVIDER: "telnyx" });
  });
  test("Telnyx + Vapi: Telnyx stays the main engine, Vapi is the backup (the bug: the app ended up Vapi-only)", async () => {
    const b = await ready("e2", { telnyx: true, vapi: true });
    expect(setup.phoneSettings(b.id, store.getSetup(b.id))).toEqual({ TELNYX_API_KEY: TK, VOICE_PROVIDER: "telnyx", ...V });
    // Even where an older click left the provider on "vapi" with Telnyx connected.
    store.updateSetup(b.id, (s) => { s.phones = { ...s.phones, provider: "vapi" }; });
    expect(setup.phoneSettings(b.id, store.getSetup(b.id)).VOICE_PROVIDER).toBe("telnyx");
    expect(setup.phoneSettings(b.id, store.getSetup(b.id)).TELNYX_API_KEY).toBe(TK);
  });
  test("Vapi + Twilio only (Telnyx skipped): Vapi is the engine and there is no Telnyx key", async () => {
    const b = await ready("e3", { vapi: true, twilio: true });
    expect(setup.phoneSettings(b.id, store.getSetup(b.id))).toEqual({ VOICE_PROVIDER: "vapi", ...V, TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32), TWILIO_AUTH_TOKEN: "t".repeat(32) });
  });
  test("the OpenRouter key reaches the app's environment, with the phone settings, on the install", async () => {
    const b = await ready("e4", { telnyx: true, vapi: true });
    const vars = await setup.railwayVars(b.id, store.getSetup(b.id), "rail-token-0123456789");
    expect(vars).toMatchObject({ OPENROUTER_API_KEY: "sk-or-v1-abcdef0123456789", TELNYX_API_KEY: TK, VOICE_PROVIDER: "telnyx", VAPI_API_KEY: V.VAPI_API_KEY, SINGLE_AGENCY: "1" });
  });
});

describe("the admin", () => {
  const ctx = {
    ip: "203.0.113.9", sameOrigin: () => true,
    readForm: async (r: Request) => Object.fromEntries(new URLSearchParams(await r.text())) as Record<string, string>,
    html: (body: string, status = 200, extra: Record<string, string> = {}) => new Response(body, { status, headers: { "Content-Type": "text/html", ...extra } }),
    redirect: (to: string, extra: Record<string, string> = {}) => new Response(null, { status: 303, headers: { Location: to, ...extra } }),
  };
  let cookie = "";
  async function call(method: "GET" | "POST", path: string, form: Record<string, string> = {}, ip = ctx.ip) {
    const u = new URL(path, "http://localhost:4500");
    const req = new Request(u.toString(), { method, headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: method === "POST" ? new URLSearchParams(form).toString() : undefined });
    const res = await adminRoute(req, u, { ...ctx, ip });
    return { res, body: await res.text(), loc: res.headers.get("location") || "" };
  }
  const tok = (html: string) => html.match(/name="t" value="([^"]+)"/)![1];

  test("sign in, and Add agency has no test-run option", async () => {
    const r = await call("POST", new URL(newAdminLink(ADMIN)).pathname);
    cookie = (r.res.headers.get("set-cookie") || "").split(";")[0];
    const html = (await call("GET", "/admin")).body;
    expect(html).toContain("Add an agency");
    expect(html).not.toContain("Test run (pretend accounts)");
    expect(html).not.toContain('name="demo"');
    // A posted demo flag is ignored: the agency is real.
    const t = tok(html);
    await call("POST", "/admin/buyers", { t, name: "Real One", email: "real-one@example.com", demo: "1" });
    expect((db().query("SELECT demo FROM buyers WHERE email = 'real-one@example.com'").get() as any).demo).toBe(0);
  });

  test("Delete all test runs removes every test agency and only those", async () => {
    addBuyer("Test 10:00", "demo-a@example.com", true); addBuyer("Test 10:01", "demo-b@example.com", true);
    const html = (await call("GET", "/admin")).body;
    expect(html).toContain("Delete all test runs");
    const r = await call("POST", "/admin/demo/delete-all", { t: tok(html) });
    expect(r.loc).toBe("/admin?m=tests-deleted");
    expect(db().query("SELECT COUNT(*) AS n FROM buyers WHERE demo = 1").get()).toEqual({ n: 0 });
    expect((db().query("SELECT COUNT(*) AS n FROM buyers WHERE email = 'real-one@example.com'").get() as any).n).toBe(1);
    expect((await call("GET", "/admin")).body).not.toContain("Delete all test runs");
  });

  test("assist works for the AI step too: the admin fills the OpenRouter key", async () => {
    const A = await import("../assist");
    const b = newBuyer("assist");
    await A.fillStep(b, ADMIN, "brand", { productName: "As Co", ownerEmail: "o@as.test" });
    const out = await A.fillStep(b, ADMIN, "ai", { key: "sk-or-v1-assist0123456789" });
    expect(out.ok).toBe(true);
    expect(store.getSetup(b.id).ai?.confirmed).toBe(true);
    expect(A.stepRows(b, store.getSetup(b.id)).find((r) => r.id === "ai")).toMatchObject({ done: true, by: "you" });
  });

  test("forgot password: a one-time link by email for admins only, 15 minutes, rate limited", async () => {
    sent.length = 0;
    expect((await call("GET", "/admin/forgot")).body).toContain("Email me a link");
    // Unknown address: the same page, no email.
    const un = await call("POST", "/admin/forgot", { email: "stranger@example.com" }, "198.51.100.1");
    expect(un.body).toContain("If that address is an admin");
    expect(sent).toHaveLength(0);
    const ok = await call("POST", "/admin/forgot", { email: ADMIN.toUpperCase() }, "198.51.100.2");
    expect(ok.body).toContain("If that address is an admin");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ADMIN, subject: "Sign in to AI Agency Admin" });
    const link = sent[0].text.match(/https?:\/\/\S+\/admin\/login\/[A-Za-z0-9_-]{43}/)![0];
    expect(sent[0].html).toContain(link);
    expect(sent[0].text).toContain("15 minutes");
    // The link signs in once, and not after it runs out.
    const path = new URL(link).pathname;
    const first = await call("POST", path);
    expect(first.res.headers.get("set-cookie")).toMatch(/^as=/);
    expect((await call("POST", path)).res.status).toBe(410);
    expect(await sendForgotLink(ADMIN)).toBe("sent");
    const second = sent[1].text.match(/\/admin\/login\/([A-Za-z0-9_-]{43})/)![1];
    db().query("UPDATE admin_links SET expires_at = ? WHERE token_hash = ?").run(new Date(Date.now() - 1000).toISOString(), require("node:crypto").createHash("sha256").update(second).digest());
    expect((await call("POST", `/admin/login/${second}`)).res.status).toBe(410);
    // Three an hour per address.
    expect(await sendForgotLink(ADMIN)).toBe("sent");
    expect(await sendForgotLink(ADMIN)).toBe("limited");
    expect(await sendForgotLink("stranger@example.com")).toBe("unknown");
    // And per visitor.
    let last = 200;
    for (let i = 0; i < 7; i++) last = (await call("POST", "/admin/forgot", { email: "x@example.com" }, "198.51.100.3")).res.status;
    expect(last).toBe(429);
    // The sign-in page links to it.
    process.env.ADMIN_PASSWORD_HASH = "x";
  });
});

describe("agency offline", () => {
  const snap = () => ({
    v: 1, sentAt: new Date().toISOString(), appVersion: "1.0.0", publicUrl: "https://app.acme.example",
    health: { ok: true, db: true, phoneKey: true, openIncidents: 0 },
    counts: { agencies: 1, clients: 3, receptionists: 4, numbers: 4, calls24h: 5, calls7d: 31, calls30d: 120, bookings7d: 6, errors24h: 0 },
    lastCallAt: new Date().toISOString(), brand: { name: "Acme AI", logoUrl: "" }, extras: { email: true, domain: false, openRouter: true },
    support: { sharing: true, access: false, accessUntil: null, edit: true },
    updates: { available: true, enabled: true, mode: "overnight", latest: "", lastResult: "", lastError: "", lastAt: null }, problems: [],
  });
  test("a quiet agency: its owner gets one email per outage, the admin gets the alert; a heartbeat in between starts a new outage", async () => {
    const b = addBuyer("Quiet", "quiet@example.com");
    const { token } = sync.newSyncToken(b.id);
    store.updateSetup(b.id, (s) => { s.phase = "done"; s.step = "done"; s.brand = { productName: "Quiet AI", ownerEmail: "owner@quiet.test", ownPhoneAccount: true }; s.resultUrl = "http://127.0.0.1:9"; });
    sync.receive(token, JSON.stringify(snap()));
    const down = (async () => "down") as any;
    sent.length = 0;
    const mins = (m: number) => Date.now() + m * 60_000;
    await alerts.checkSilence(mins(10), down); // 10 minutes: not quiet enough
    expect(sent).toHaveLength(0);
    await alerts.checkSilence(mins(40), down);
    const toOwner = () => sent.filter((m) => m.to === "owner@quiet.test");
    expect(toOwner()).toHaveLength(1);
    expect(toOwner()[0].subject).toBe("Quiet AI looks offline");
    expect(alerts.alertHistory(5, b.id).map((a) => a.kind)).toEqual(["no_heartbeat"]);
    await alerts.checkSilence(mins(50), down);
    await alerts.checkSilence(mins(130), down); // the admin alert may repeat after an hour...
    expect(toOwner()).toHaveLength(1); // ...the owner is told once
    // It comes back, then goes quiet again: a new outage, a new email.
    await Bun.sleep(5);
    sync.receive(token, JSON.stringify(snap()));
    await alerts.checkSilence(mins(300), down);
    expect(toOwner()).toHaveLength(2);
    // An app that is simply up (alive) with a stuck heartbeat still counts, but sharing switched off never does.
    const c = addBuyer("Private", "private@example.com");
    const t2 = sync.newSyncToken(c.id).token;
    store.updateSetup(c.id, (s) => { s.phase = "done"; s.brand = { productName: "Private AI", ownerEmail: "owner@private.test", ownPhoneAccount: true }; s.resultUrl = "http://127.0.0.1:9"; });
    sync.receive(t2, JSON.stringify(snap()));
    await alerts.checkSilence(mins(600), (async () => "sharing-off") as any);
    expect(sent.filter((m) => m.to === "owner@private.test")).toHaveLength(0);
  });
  test("no email is sent when the site can't send email; it is tried again once it can", async () => {
    const b = addBuyer("Nomail", "nomail@example.com");
    store.updateSetup(b.id, (s) => { s.phase = "done"; s.brand = { productName: "Nomail AI", ownerEmail: "owner@nomail.test", ownPhoneAccount: true }; });
    sent.length = 0;
    const from = process.env.SITE_MAIL_FROM; delete process.env.SITE_MAIL_FROM;
    expect(await alerts.notifyOwnerOffline(b.id, new Date(Date.now() - 3600_000).toISOString())).toBe(false);
    process.env.SITE_MAIL_FROM = from;
    expect(await alerts.notifyOwnerOffline(b.id, new Date(Date.now() - 3600_000).toISOString())).toBe(true);
    expect(await alerts.notifyOwnerOffline(b.id, new Date(Date.now() - 3600_000).toISOString())).toBe(false);
    expect(sent).toHaveLength(1);
  });
});

describe("Login with ... on the real site (mock providers)", () => {
  const PORT = 47000 + Math.floor(Math.random() * 900);
  const SITE = `http://127.0.0.1:${PORT}`;
  let server: ReturnType<typeof Bun.spawn> | null = null;
  afterAll(() => server?.kill());
  const get = (path: string, cookie = "") => realFetch(`${SITE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });

  test("start sets a browser cookie and goes to the provider; the callback needs that browser and a good state", async () => {
    server = Bun.spawn(["bun", "server.ts"], { cwd: join(import.meta.dir, ".."), stdout: "ignore", stderr: "ignore",
      env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", SITE_URL: SITE, DATA_DIR: dir, MOCK_OAUTH: "1", MOCK_TELNYX: "1" } });
    for (let i = 0; i < 100; i++) { try { if ((await realFetch(`${SITE}/healthz`)).ok) break; } catch {} await Bun.sleep(100); }
    const b = newBuyer("http");
    await setup.actions.start(b, {}); await setup.actions.brand(b, { productName: "Http Co", ownerEmail: "o@h.test" });
    store.updateSetup(b.id, (s) => { s.railway = { confirmed: true }; s.phones = { confirmed: true }; s.step = "ai"; });
    store.putSecret(b.id, "railway_token", "mock-rail-token-ok");
    // The page offers the button.
    expect(await (await get(`/setup/${b.code}?step=ai`)).text()).toContain(`href="/setup/${b.code}/oauth/openrouter"`);
    // Start.
    const st = await get(`/setup/${b.code}/oauth/openrouter`);
    expect(st.status).toBe(303);
    const cookie = (st.headers.get("set-cookie") || "").split(";")[0];
    expect(cookie).toMatch(/^ob=/);
    const auth = new URL(st.headers.get("location")!);
    expect(auth.pathname).toBe("/__mock/oauth/openrouter/authorize");
    // The provider sends the browser back with a code. Like the real OpenRouter, it does NOT send our state back.
    const back = await get(auth.pathname + auth.search);
    const cb = new URL(back.headers.get("location")!);
    expect(cb.pathname).toBe("/oauth/openrouter/callback");
    expect(cb.searchParams.get("code")).toBeTruthy();
    expect(cb.searchParams.get("state")).toBeNull();
    // Another browser (no cookie): refused with a plain "didn't finish" page (not "setup link isn't valid"), and nothing is saved.
    const lost = await get(cb.pathname + cb.search);
    expect(lost.status).toBe(400);
    const lostHtml = await lost.text();
    expect(lostHtml).toContain("That sign-in didn&#39;t finish");
    expect(lostHtml).not.toContain("setup link isn't valid");
    expect(store.getSecret(b.id, "openrouter_key")).toBeNull();
    // A fresh login from the right browser finishes the step, found by its browser cookie.
    const st2 = await get(`/setup/${b.code}/oauth/openrouter`);
    const cookie2 = (st2.headers.get("set-cookie") || "").split(";")[0];
    const a2 = new URL(st2.headers.get("location")!);
    const cb2 = new URL((await get(a2.pathname + a2.search)).headers.get("location")!);
    const done = await get(cb2.pathname + cb2.search, cookie2);
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`/setup/${b.code}`); // s.step moved on to Connect more, so the plain link lands there
    expect(store.getSetup(b.id)).toMatchObject({ ai: { confirmed: true, via: "oauth" }, step: "extras" });
    // Used once: the same callback again is refused.
    expect((await get(cb2.pathname + cb2.search, cookie2)).status).toBe(400);
    expect(store.getSecret(b.id, "openrouter_key")).toMatch(/^sk-or-v1-/);
    // The buyer can say no at the provider: nothing saved, a plain message.
    const b2 = newBuyer("http2");
    await setup.actions.start(b2, {}); await setup.actions.brand(b2, { productName: "No Co", ownerEmail: "o@n.test" });
    store.updateSetup(b2.id, (s) => { s.railway = { confirmed: true }; s.phones = { confirmed: true }; s.step = "ai"; });
    store.putSecret(b2.id, "railway_token", "x");
    const s3 = await get(`/setup/${b2.code}/oauth/openrouter`);
    const c3 = (s3.headers.get("set-cookie") || "").split(";")[0];
    const denied = await get(`/oauth/openrouter/callback?error=access_denied`, c3);
    expect(denied.status).toBe(303);
    expect(store.getSecret(b2.id, "openrouter_key")).toBeNull();
    expect(store.getSetup(b2.id).flash?.text).toMatch(/cancelled/);
    // Unknown provider and a buyer's wrong code.
    expect((await get(`/setup/${b.code}/oauth/nope`)).status).toBe(404);
    expect((await get(`/setup/${"A".repeat(22)}/oauth/openrouter`)).status).toBe(404);
  }, 30_000);
});

void now;
