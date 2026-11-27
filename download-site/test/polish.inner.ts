// The checks for polish.test.ts: the onboarding polish. Continue always moves on (also after Back, after a returned sign-in and after an error),
// a step shows what's really connected, Voice is Telnyx / Vapi / Skip, "Connect more" is all optional, the step list has no descriptions,
// provider logos and the header mark are inline, the Telnyx and Vapi sign-ins are parked, and "Talk to a person" makes a help ticket.
// Runs against a real site process (mock OpenRouter sign-in) with fake data only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "polish-test-"));
const PORT = 49000 + Math.floor(Math.random() * 800);
const SITE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.SITE_URL = SITE;
process.env.MOCK_OAUTH = "1";
process.env.MOCK_TELNYX = "1";
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "HOSTING", "PREVIEW_JUMP", "OPENROUTER_API_KEY", "OAUTH_PARKED_ON"]) delete process.env[k];

const { addBuyer } = await import("../lib");
const store = await import("../store");
const { actions } = await import("../setup");
const { wizardPage } = await import("../wizard");
const T = await import("../tickets");
const { chatBubble } = await import("../chat");

let server: ReturnType<typeof Bun.spawn> | null = null;
beforeAll(async () => {
  server = Bun.spawn(["bun", "server.ts"], {
    cwd: join(import.meta.dir, ".."), stdout: "ignore", stderr: "ignore",
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", SITE_URL: SITE, DATA_DIR: dir, MOCK_OAUTH: "1", MOCK_TELNYX: "1" },
  });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${SITE}/healthz`)).ok) return; } catch {} await Bun.sleep(100); }
  throw new Error("the site didn't start");
}, 30_000);
afterAll(() => server?.kill());

let n = 0;
/** A buyer with everything connected (fake keys), sitting at Install, like someone who has been through the whole wizard. */
async function doneBuyer(opts: { extrasDone?: boolean; step?: string } = {}) {
  const b = addBuyer(`Buyer ${++n}`, `polish-${n}@example.com`);
  await actions.start(b, {});
  await actions.brand(b, { productName: "Polish Co", ownerEmail: "o@polish.test" });
  store.putSecret(b.id, "railway_token", "rail-token-0123456789");
  store.putSecret(b.id, "telnyx_key", "KEY0123456789ABCDEF0123456789_abcdefghijkl");
  store.putSecret(b.id, "openrouter_key", "sk-or-v1-polish0123456789");
  store.updateSetup(b.id, (s) => {
    s.railway = { confirmed: true, via: "paste" }; s.phones = { confirmed: true, provider: "telnyx", numbers: ["+61 2 5550 0101"] }; s.ai = { confirmed: true, via: "paste" };
    s.extrasDone = opts.extrasDone ?? true; s.step = (opts.step || "install") as any;
  });
  return b;
}

/** A buyer's browser: session cookie + the page's CSRF token. */
async function browser(code: string) {
  const r = await fetch(`${SITE}/setup/${code}`);
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const t = (await r.text()).match(/name="t" value="([^"]+)"/)![1];
  const get = (path: string, c = cookie) => fetch(`${SITE}${path}`, { redirect: "manual", headers: { cookie: c } });
  const page = async (step = "", opt = "") => (await get(`/setup/${code}${step ? `?step=${step}${opt ? `&opt=${opt}` : ""}` : ""}`)).text();
  const post = (action: string, f: Record<string, string>) => fetch(`${SITE}/setup/${code}/a/${action}`, { method: "POST", redirect: "manual", headers: { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, ...f }).toString() });
  return { cookie, t, get, page, post };
}
const titleOf = (html: string) => html.match(/<title>([^<]*)<\/title>/)![1];
const loc = (r: Response) => r.headers.get("location") || "";

describe("Continue always moves on", () => {
  test("after Back: every step's Continue goes to the very next step (and that page really is that step)", async () => {
    const b = await doneBuyer();
    const br = await browser(b.code);
    const next: [string, string, string][] = [ // [step you went Back to, its Continue action, the step you land on]
      ["railway", "railway-continue", "phones"], ["phones", "phones-continue", "ai"], ["ai", "ai-continue", "extras"],
    ];
    for (const [view, action, want] of next) {
      // the page offers Continue
      expect(await br.page(view)).toContain(`/a/${action}"`);
      const r = await br.post(action, { v: view });
      expect(r.status).toBe(303);
      expect(loc(r)).toBe(`/setup/${b.code}?step=${want}`); // not the same page again (that was the bug), not a jump to Install
      expect(titleOf(await br.page(want))).toStartWith({ phones: "Voice", ai: "AI", extras: "Connect more" }[want]!);
    }
    // Connect more -> Install is the saved step, so the plain link
    const x = await br.post("extras-continue", { v: "extras" });
    expect(loc(x)).toBe(`/setup/${b.code}`);
    expect(titleOf(await (await br.get(loc(x))).text())).toStartWith("Install");
    // Start on the Welcome page again, and Brand again: they go on too
    expect(loc(await br.post("start", { v: "welcome" }))).toBe(`/setup/${b.code}`);
    const brand = await br.post("brand", { v: "brand", productName: "Polish Co", ownerEmail: "o@polish.test" });
    expect(loc(brand)).toBe(`/setup/${b.code}?step=railway`);
  });

  test("on the way forward (first time through) Continue lands on the plain link", async () => {
    const b = await doneBuyer({ extrasDone: false, step: "ai" });
    const br = await browser(b.code);
    const r = await br.post("ai-continue", { v: "ai" });
    expect(loc(r)).toBe(`/setup/${b.code}`);
    expect(store.getSetup(b.id).step).toBe("extras");
    expect(titleOf(await (await br.get(loc(r))).text())).toStartWith("Connect more");
  });

  test("after an error the page is the same step with the message, and Continue still works from it", async () => {
    const b = await doneBuyer();
    const br = await browser(b.code);
    // A form that fails (a help request with no words): back on the same step, with the message shown
    const bad = await br.post("help-request", { v: "ai", problem: "" });
    expect(loc(bad)).toBe(`/setup/${b.code}?step=ai#person`);
    const html = await (await br.get(`/setup/${b.code}?step=ai`)).text();
    expect(html).toContain("Please tell us what");
    expect(html).toContain("/a/ai-continue\""); // connected already: Continue is still there
    expect(loc(await br.post("ai-continue", { v: "ai" }))).toBe(`/setup/${b.code}?step=extras`);
  });

  test("after a returned sign-in (OpenRouter) the buyer goes on, also when they had been sent Back to that step", async () => {
    const b = await doneBuyer();
    const br = await browser(b.code);
    const start = await br.get(`/setup/${b.code}/oauth/openrouter`);
    expect(start.status).toBe(303);
    const ob = (start.headers.get("set-cookie") || "").split(";")[0];
    const auth = new URL(loc(start));
    const back = await fetch(`${SITE}${auth.pathname}${auth.search}`, { redirect: "manual" }); // the fake provider sends the browser back
    const cb = new URL(loc(back));
    expect(cb.searchParams.get("state")).toBeNull(); // OpenRouter sends only ?code=
    const done = await br.get(cb.pathname + cb.search, ob);
    expect(done.status).toBe(303);
    expect(loc(done)).toBe(`/setup/${b.code}?step=extras`);
    expect(store.getSetup(b.id).ai).toMatchObject({ confirmed: true, via: "oauth" });
  });

  test("a form with nothing to move (e.g. Check key on Voice) stays on its step, and keeps the provider open", async () => {
    const b = await doneBuyer({ extrasDone: false, step: "phones" });
    store.updateSetup(b.id, (s) => { s.phones = undefined; });
    store.deleteSecret(b.id, "telnyx_key");
    const br = await browser(b.code);
    const r = await br.post("phones", { v: "phones", opt: "telnyx", key: "" });
    expect(loc(r)).toBe(`/setup/${b.code}?step=phones&opt=telnyx`);
    expect(await (await br.get(loc(r))).text()).toContain("Paste your Telnyx API key.");
  });

  test("the page script gives buttons back after a dropped connection and reloads a page the browser's Back button restored", () => {
    const js = readFileSync(join(import.meta.dir, "../public/wizard.js"), "utf8");
    expect(js).toContain('addEventListener("pageshow"');
    expect(js).toMatch(/e\.persisted\) location\.reload\(\)/);
    expect(js).toContain("30000"); // the button is given back
  });
});

describe("a step shows what is really connected", () => {
  test("OpenRouter, Railway and Voice say 'connected' only while the key is really stored; a purged key shows the form again", async () => {
    const b = await doneBuyer({ extrasDone: false, step: "ai" });
    const html = (view: string) => wizardPage(b, store.getSetup(b.id), b.code, "sid", view as any);
    const on = html("ai");
    expect(on).toContain("OpenRouter connected");
    expect(on).toContain("••••6789"); // which key, by its last four
    expect(on).toContain("Use a different key");
    expect(html("railway")).toContain("Railway connected");
    expect(html("phones")).toContain("Telnyx connected");
    // The keys are gone (purged, or replaced): the saved "confirmed" flag alone must not say connected.
    store.deleteSecret(b.id, "openrouter_key"); store.deleteSecret(b.id, "railway_token"); store.deleteSecret(b.id, "telnyx_key");
    const ai = html("ai");
    expect(ai).not.toContain("OpenRouter connected");
    expect(ai).toContain('name="key"');
    expect(ai).not.toContain("/a/ai-continue");
    expect(html("railway")).not.toContain("Railway connected");
    expect(html("railway")).toContain('name="token"');
    expect(html("phones")).not.toContain("Telnyx connected");
    expect(html("phones")).toContain("Choose who carries your calls");
  });
});

describe("Voice: Telnyx, Vapi or Skip", () => {
  test("three choices; each provider opens on its own page with a link to where its key is made; no sign-in buttons; no Twilio", async () => {
    const b = addBuyer("Voice Buyer", "voice@example.com");
    await actions.start(b, {}); await actions.brand(b, { productName: "Voice Co", ownerEmail: "o@v.test" });
    store.updateSetup(b.id, (s) => { s.railway = { confirmed: true }; s.step = "phones"; });
    store.putSecret(b.id, "railway_token", "rail-token-0123456789");
    const br = await browser(b.code);
    const choose = await br.page("phones");
    for (const w of ["Telnyx", "Vapi", "Skip for now"]) expect(choose).toContain(w);
    expect(choose).not.toMatch(/Twilio|Sign in with|name="key"/);
    expect(choose).toContain(`step=phones&amp;opt=telnyx`);
    expect(choose).toContain(`step=phones&amp;opt=vapi`);
    const tel = await br.page("phones", "telnyx");
    expect(tel).toContain('href="https://portal.telnyx.com/#/app/api-keys"');
    expect(tel).toContain('name="key"');
    expect(tel).not.toMatch(/Twilio|Sign in with/);
    const vap = await br.page("phones", "vapi");
    expect(vap).toContain('href="https://dashboard.vapi.ai/org/api-keys"');
    expect(vap).toContain('name="vapiKey"');
    expect(vap).not.toMatch(/Twilio|Sign in with/);
    // The sign-in route for Telnyx is off too (parked)
    expect((await br.get(`/setup/${b.code}/oauth/telnyx`)).status).toBe(404);
    // Skip moves on; the choice can be undone with "Choose a different provider"
    const skip = await br.post("phones-skip", { v: "phones" });
    expect(loc(skip)).toBe(`/setup/${b.code}`);
    expect(store.getSetup(b.id).skipped?.phones).toBe(true);
    const again = await br.page("phones");
    expect(again).toContain("No voice provider yet");
    expect(again).toContain("Skip for now"); // the three choices are still there
    store.putSecret(b.id, "vapi_key", "priv-0123456789abcdef");
    store.updateSetup(b.id, (s) => { s.vapi = { confirmed: true }; s.phones = { checked: true, provider: "vapi" }; });
    expect(await br.page("phones")).toContain("Vapi connected");
    expect(await actions["phones-reset"](b, {})).toBeNull();
    expect(store.hasSecret(b.id, "vapi_key")).toBe(false);
    expect(store.getSetup(b.id).vapi).toBeUndefined();
    expect(await br.page("phones")).toContain("Choose who carries your calls");
  });
});

describe("Connect more (optional)", () => {
  test("it comes after AI and before Install; email, own domain and Twilio can each be added or skipped; skipping all goes on to Install", async () => {
    const b = await doneBuyer({ extrasDone: false, step: "extras" });
    const br = await browser(b.code);
    const page = await br.page("extras");
    expect(titleOf(page)).toStartWith("Connect more");
    for (const c of ["email", "domain", "calendars", "twilio"]) expect(page).toContain(`data-card="${c}"`);
    expect(page).toContain("Skip all and continue");
    // Nothing is required: Install is refused only because this screen hasn't been passed, and passing it needs nothing
    expect((await actions["install-start"](b, {}))?.kind).toBe("err");
    // Skip one: back on Connect more (not stuck on the Email page)
    const sk = await br.post("email-skip", { v: "extras" });
    expect(loc(sk)).toBe(`/setup/${b.code}`);
    expect(store.getSetup(b.id).skipped?.email).toBe(true);
    expect(await br.page("extras")).toContain("Skipped: add it later");
    // Twilio on its own page, skipped from there: lands back on Connect more
    expect(await br.page("twilio")).toContain('href="https://console.twilio.com/"');
    const ts = await br.post("twilio-skip", { v: "twilio" });
    expect(loc(ts)).toBe(`/setup/${b.code}`); // their saved step is Connect more, so the plain link lands there
    // Skip all and continue
    const go = await br.post("extras-continue", { v: "extras" });
    expect(loc(go)).toBe(`/setup/${b.code}`);
    expect(titleOf(await (await br.get(loc(go))).text())).toStartWith("Install");
    expect(store.getSetup(b.id).step).toBe("install");
  });

  test("adding Twilio (checked, kept) shows Added; the step list names it 'Connect more'; a buyer already at Install is not sent back to it", async () => {
    const b = await doneBuyer({ extrasDone: false, step: "extras" });
    expect(await actions.twilio(b, { twilioSid: "AC" + "0".repeat(32), twilioToken: "t".repeat(32) })).toBeNull(); // test mode: the pretend Twilio account passes
    const s = store.getSetup(b.id);
    expect(s.step).toBe("extras");
    const html = wizardPage(b, s, b.code, "sid", "extras");
    expect(html).toMatch(/data-card="twilio"[^>]*>[\s\S]*?Added/);
    expect(html).toContain("Continue to install");
    expect(html).toContain("Connect more</span>"); // in the step list
    // An old buyer (short wizard, schema 2) already at Install keeps going: nothing new to do
    const old = await doneBuyer({ extrasDone: false, step: "install" });
    require("../lib").db().query("UPDATE setups SET data = ? WHERE buyer_id = ?").run(JSON.stringify({ ...store.getSetup(old.id), schema: 2, extrasDone: undefined }), old.id);
    expect(store.getSetup(old.id)).toMatchObject({ schema: 3, step: "install", extrasDone: true });
  });
});

describe("how the pages look", () => {
  test("the step list has no descriptions under the step names (every step)", async () => {
    const b = await doneBuyer({ extrasDone: false, step: "extras" });
    for (const view of ["welcome", "brand", "railway", "phones", "ai", "extras", "install"]) {
      const h = wizardPage(b, store.getSetup(b.id), b.code, "sid", view as any);
      expect(h).toContain('<aside class="rail">');
      expect(h).not.toContain('<span class="s">');
    }
  });

  test("provider logos are inline drawings (no files, no hotlinks); the header has a generic mark, or the buyer's own logo", async () => {
    const b = await doneBuyer({ extrasDone: false, step: "extras" });
    const s = store.getSetup(b.id);
    const h = (view: string) => wizardPage(b, store.getSetup(b.id), b.code, "sid", view as any, undefined, view === "phones" ? "vapi" : "");
    expect(h("railway")).toContain('fill="#13111c"'); // Railway
    expect(h("ai")).toContain('fill="#6366f1"'); // OpenRouter
    expect(h("extras")).toContain('fill="#f22f46"'); // Twilio in Connect more
    expect(wizardPage(b, { ...s, phones: undefined, vapi: undefined }, b.code, "sid", "phones", undefined, "vapi")).toContain('stroke="#5dfeca"'); // Vapi green
    store.deleteSecret(b.id, "telnyx_key");
    expect(wizardPage(b, { ...s, phones: undefined }, b.code, "sid", "phones", undefined, "telnyx")).toContain('fill="#00c08b"'); // Telnyx green
    expect(h("welcome")).toMatch(/<a class="mark" href="[^"]+"><span class="mlogo"><svg/); // generic mark next to the name
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    store.updateSetup(b.id, (x) => { x.brand!.logo = PNG; });
    expect(h("welcome")).toContain(`<img class="mlogo" src="${PNG}"`);
  });

  test("CSP-safe: no inline styles or scripts, no event handlers, and nothing loaded from another site, on every step", async () => {
    const b = await doneBuyer({ extrasDone: false, step: "extras" });
    for (const [view, opt] of [["welcome", ""], ["brand", ""], ["railway", ""], ["phones", ""], ["phones", "telnyx"], ["phones", "vapi"], ["ai", ""], ["extras", ""], ["email", ""], ["domain", ""], ["twilio", ""], ["install", ""]]) {
      const h = wizardPage(b, store.getSetup(b.id), b.code, "sid", view as any, undefined, opt);
      expect(h).not.toMatch(/\sstyle=/i);
      expect(h).not.toMatch(/\son[a-z]+=\s*["']/i);
      expect(h.match(/<script\b[^>]*>/g) || []).toEqual(['<script src="/wizard.js" defer>']);
      expect(h).not.toMatch(/<(img|link|script)\b[^>]*(src|href)="https?:\/\//i);
      expect(h).not.toMatch(/Chloe/i);
    }
  });

  test("the Railway step: a big button to the page where the token is created, three short steps, no 'Login with Railway'", async () => {
    const b = addBuyer("Rail Buyer", "rail@example.com");
    await actions.start(b, {}); await actions.brand(b, { productName: "Rail Co", ownerEmail: "o@r.test" });
    const h = wizardPage(b, store.getSetup(b.id), b.code, "sid", "railway");
    expect(h).toContain('href="https://railway.com/account/tokens"');
    expect(h).toContain('target="_blank"');
    expect(h).toContain("Open Railway and create your token");
    expect(h).toContain("No workspace");
    expect(h).not.toContain("Login with Railway");
    expect((h.match(/<ol class="mini3">[\s\S]*?<\/ol>/)![0].match(/<li>/g) || []).length).toBe(3);
  });
});

describe("Talk to a person", () => {
  test("the chat panel has a 'Talk to a person' tab with the form (and keeps the AI helper); sending it makes a help ticket our admin sees", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-chat-test-0123456789";
    const b = await doneBuyer({ extrasDone: false, step: "ai" });
    const html = wizardPage(b, store.getSetup(b.id), b.code, "sid", "ai");
    delete process.env.OPENROUTER_API_KEY;
    const panel = html.slice(html.indexOf('<div id="chat"'));
    expect(panel).toContain("Ask the helper"); // the AI chat is still there
    expect(panel).toContain('class="chat-tab chat-person-btn"');
    expect(panel).toContain("Talk to a person");
    expect(panel).toContain(`action="/setup/${b.code}/a/help-request"`);
    expect(panel).toContain('id="chat-problem"');
    // and the box at the bottom of every step, and the header link, are there without the chat
    expect(html).toContain('<summary>Talk to a person</summary>');
    expect(html).toContain('href="#person"');
    // Sending it (as the panel's form would): a ticket with the step they were on
    const br = await browser(b.code);
    const r = await br.post("help-request", { v: "ai", problem: "My OpenRouter sign-in keeps failing", contact: "o@polish.test", phone: "" });
    expect(r.status).toBe(303);
    expect(loc(r)).toBe(`/setup/${b.code}?step=ai#person`);
    const t = T.listTickets("all", b.id)[0];
    expect(t).toBeTruthy();
    expect(t.subject).toContain("AI");
    expect(JSON.stringify(T.messagesOf(t.id))).toContain("OpenRouter sign-in keeps failing");
    expect(chatBubble({ url: "/setup/x/chat" })).toBe(""); // chat off: no bubble (the bottom box still works)
  });
});

describe("Brand colours and look, and the Done screen", () => {
  test("1 to 3 colours and light/dark are saved and handed to the install as BRAND_COLOURS, BRAND_COLOUR (the first) and THEME", async () => {
    const b = addBuyer("Colour Buyer", "colour@example.com");
    await actions.start(b, {});
    const page = wizardPage(b, store.getSetup(b.id), b.code, "sid", "brand");
    for (const f of ['name="colour"', 'name="colour2"', 'name="colour3"', 'name="theme" value="light"', 'name="theme" value="dark"']) expect(page).toContain(f);
    // Just the main colour, light (the default): one colour
    expect(await actions.brand(b, { productName: "C Co", ownerEmail: "o@c.test", colour: "#aa2244" })).toBeNull();
    expect(store.getSetup(b.id).brand).toMatchObject({ colour: "#aa2244", colours: ["#aa2244"] });
    const { railwayVars } = await import("../setup");
    let vars = await railwayVars(b.id, store.getSetup(b.id), "rail-token-0123456789");
    expect(vars).toMatchObject({ BRAND_COLOURS: "#aa2244", BRAND_COLOUR: "#aa2244" });
    expect(vars.THEME).toBeUndefined();
    // Three colours and dark; an unticked extra colour is ignored; rubbish is ignored
    expect(await actions.brand(b, { productName: "C Co", ownerEmail: "o@c.test", colour: "#AA2244", colour2: "#00ff00", colour2on: "1", colour3: "nope", colour3on: "1", theme: "dark" })).toBeNull();
    expect(store.getSetup(b.id).brand).toMatchObject({ colour: "#aa2244", colours: ["#aa2244", "#00ff00"], theme: "dark" });
    expect(await actions.brand(b, { productName: "C Co", ownerEmail: "o@c.test", colour: "#111111", colour2: "#222222", colour3: "#333333", colour3on: "1", theme: "light" })).toBeNull();
    vars = await railwayVars(b.id, store.getSetup(b.id), "rail-token-0123456789");
    expect(vars).toMatchObject({ BRAND_COLOURS: "#111111,#333333", BRAND_COLOUR: "#111111", THEME: "light" });
    // The saved choice shows again when they come back
    const again = wizardPage(b, store.getSetup(b.id), b.code, "sid", "brand");
    expect(again).toMatch(/name="colour2" type="color" value="#333333"/); // the picked colours fill the boxes in order
    expect(again).toMatch(/name="theme" value="light" checked/);
  });

  test("Done screen: few words, the main button opens the dashboard, nothing about deleting tokens, backups or deleted keys", async () => {
    const b = await doneBuyer();
    store.updateSetup(b.id, (s) => { s.phase = "done"; s.step = "done"; s.resultUrl = "https://acme.up.railway.app"; s.tempUrl = "https://acme.up.railway.app"; });
    const h = wizardPage(b, store.getSetup(b.id), b.code, "sid", "done");
    expect(h).toContain("Open your dashboard");
    expect(h).toMatch(/class="btn p big" href="https:\/\/acme.up.railway.app"/);
    for (const bad of [/Before you go/i, /Delete your Railway/i, /Revoke/i, /backups/i, /deleted/i, /Later<\/h3>/, /Tip: turn on auto top-up/]) expect(h).not.toMatch(bad);
    // and no step shows "deleted" about keys
    for (const view of ["welcome", "brand", "railway", "phones", "ai", "extras", "install"]) expect(wizardPage(b, store.getSetup(b.id), b.code, "sid", view as any)).not.toMatch(/deleted/i);
  });
});
