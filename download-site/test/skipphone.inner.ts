// Skipping the phone provider (Telnyx approval can take hours to two days): the buyer still installs,
// the app gets no voice key at all, and every screen says to connect it later in the dashboard.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "skipphone-test-"));
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "HOSTING"]) delete process.env[k];

const { addBuyer } = await import("../lib");
const { actions, phoneSettings, railwayVars, firstOpen, PHONE_LATER } = await import("../setup");
const { getSetup, hasSecret, putSecret, updateSetup } = await import("../store");
const { wizardPage } = await import("../wizard");
const { installBlockers, detailOf, fillStep, stepRows } = await import("../assist");
const { getSecret } = await import("../store");

const realFetch = globalThis.fetch;
let calls: string[] = [];
const stub = (status: number, body: unknown) => {
  calls = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as any;
};
afterAll(() => { globalThis.fetch = realFetch; });

const run = async (b: any, name: string, f: Record<string, string> = {}) => actions[name](b, f);
async function buyer(n: string) {
  const b = addBuyer(`Buyer ${n}`, `skip-${n}@example.com`);
  await run(b, "start");
  await run(b, "brand", { productName: "Acme Calls", ownerEmail: "boss@acme.test" });
  putSecret(b.id, "railway_token", "rail-token-0123456789");
  updateSetup(b.id, (s) => { s.railway = { confirmed: true }; s.step = "phones"; });
  return b;
}
const html = (b: any, view: string) => wizardPage(b, getSetup(b.id), b.code, "sid", view as any);
const TKEY = "KEY0123456789ABCDEF0123456789_abcdefghijkl";

describe("skip the phone step", () => {
  test("the Phones and Vapi steps offer Skip for now", async () => {
    const b = await buyer("a");
    expect(html(b, "phones")).toContain("Skip for now — connect it later in your dashboard");
    expect(html(b, "phones")).toContain('action="/setup/' + b.code + '/a/phones-skip"');
    // Secondary: a small text link under the options, not a button in the bar.
    expect(html(b, "phones")).toMatch(/<div class="skip-phones"><form[^>]*phones-skip"><input[\s\S]*?<button class="linkbtn"/);
    expect(html(b, "phones").indexOf("Or use Vapi (Twilio optional)")).toBeLessThan(html(b, "phones").indexOf("data-skip-phones"));
    expect(html(b, "vapi")).toContain("Skip for now — connect it later in your dashboard");
  });

  test("skip: no network, no key kept, the wizard moves on and the install is allowed", async () => {
    const b = await buyer("b");
    // Before skipping, the install is held up by the phone step.
    await run(b, "phones-backup");
    expect((await run(b, "extras-continue"))?.text).toMatch(/Telnyx/);
    putSecret(b.id, "telnyx_key", "KEY-half-typed-000000000000");
    stub(500, {});
    expect(await run(b, "phones-skip")).toBeNull();
    expect(calls).toHaveLength(0);
    const s = getSetup(b.id);
    expect(s.skipped?.phones).toBe(true);
    expect(s.step).toBe("extras");
    expect(hasSecret(b.id, "telnyx_key")).toBe(false);
    // A gentle nudge to go back and connect now.
    expect(html(b, "extras")).toContain("Recommended: connect Telnyx or Vapi now so your voice receptionist can start.");
    expect(html(b, "extras")).toContain('href="/setup/' + b.code + '?step=phones" data-action="connect-phones">Go back and connect</a>');
    expect(await run(b, "extras-continue")).toBeNull();
    expect(firstOpen(b, getSetup(b.id))).toBe("install");
    expect(installBlockers(b, getSetup(b.id))).toEqual([]);
    expect(detailOf(b, getSetup(b.id), "phones")).toMatch(/later in their dashboard/);
    // install-start gets past the phone check (it stops only because no app package is loaded in this test).
    const r = await run(b, "install-start");
    expect(r?.text || "").not.toMatch(/Telnyx|phone/i);
  });

  test("the installed app gets no voice key at all, and stays one agency (SINGLE_AGENCY)", async () => {
    const b = await buyer("c");
    expect(await run(b, "phones-skip")).toBeNull();
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({});
    const vars = await railwayVars(b.id, getSetup(b.id), "rail-token-0123456789");
    for (const k of ["TELNYX_API_KEY", "VAPI_API_KEY", "VAPI_PUBLIC_KEY", "VOICE_PROVIDER"]) expect(k in vars).toBe(false);
    expect(vars.SINGLE_AGENCY).toBe("1");
  });

  test("the step list, install summary and Done screen say: not connected yet, connect it in your dashboard", async () => {
    const b = await buyer("d");
    await run(b, "phones-skip");
    await run(b, "extras-continue");
    expect(html(b, "install")).toContain(PHONE_LATER);
    expect(html(b, "install")).toMatch(/<span class="s">Not connected yet — connect it in your dashboard \(Connections\)<\/span>/);
    updateSetup(b.id, (s) => { s.phase = "done"; s.step = "done"; s.resultUrl = "https://acme.up.railway.app"; s.tempUrl = "https://acme.up.railway.app"; });
    const done = html(b, "done");
    expect(done).toContain("<b>Phone provider:</b> not connected yet — connect it in your dashboard (Connections)");
    expect(done).toContain('data-card="phone-later"');
  });

  test("adding a Telnyx key afterwards (the buyer, or our admin's Set up for them) undoes the skip", async () => {
    const b = await buyer("e");
    await run(b, "phones-skip");
    stub(200, { data: { available_credit: "12.50", currency: "USD" } });
    expect(await run(b, "phones", { key: TKEY })).toBeNull();
    const s = getSetup(b.id);
    expect(s.skipped?.phones).toBeUndefined();
    expect(phoneSettings(b.id, s)).toEqual({ TELNYX_API_KEY: TKEY });
    expect(html(b, "phones")).not.toContain("Skip for now — connect it later");
  });

  test("Telnyx path: one key on the Phones step, done, the app gets TELNYX_API_KEY", async () => {
    const b = await buyer("t");
    stub(200, { data: { available_credit: "12.50", currency: "USD" } });
    expect(await run(b, "phones", { key: TKEY })).toBeNull();
    expect(calls).toEqual(["https://api.telnyx.com/v2/balance", "https://api.telnyx.com/v2/ai/assistants?page[size]=1", "https://api.telnyx.com/v2/call_control_applications?page[size]=1"]); // the balance, then the pretrial probes
    expect(getSetup(b.id).step).toBe("extras");
    expect(await run(b, "extras-continue")).toBeNull();
    expect(firstOpen(b, getSetup(b.id))).toBe("install");
    const vars = await railwayVars(b.id, getSetup(b.id), "rail-token-0123456789");
    expect(vars.TELNYX_API_KEY).toBe(TKEY);
    expect("VOICE_PROVIDER" in vars).toBe(false);
  });

  test("Vapi + Twilio path: both checked on the Phones step itself, the step is done, the app gets Vapi and Twilio", async () => {
    const SID = "AC" + "c".repeat(32);
    const b = await buyer("v");
    // Missing fields are refused before anything is called.
    stub(200, {});
    // Half of the Twilio details is refused (Twilio itself is optional: both empty is fine, see the Vapi-only test).
    expect((await run(b, "phones-vapi", { vapiKey: "priv-0123456789abcdef", vapiPublic: "pub-0123456789abcdef", twilioSid: SID }))?.text).toMatch(/Twilio Auth Token/);
    expect(calls).toHaveLength(0);
    // Twilio refusing is an error, and nothing is kept.
    globalThis.fetch = (async (url: any) => new Response(JSON.stringify(String(url).includes("twilio") ? { message: "Authenticate" } : []), { status: String(url).includes("twilio") ? 401 : 200, headers: { "Content-Type": "application/json" } })) as any;
    expect((await run(b, "phones-vapi", { vapiKey: "priv-0123456789abcdef", vapiPublic: "pub-0123456789abcdef", twilioSid: SID, twilioToken: "t".repeat(32) }))?.kind).toBe("err");
    expect(hasSecret(b.id, "vapi_key")).toBe(false);
    expect(getSetup(b.id).vapi).toBeUndefined();
    // Both accepted.
    calls = [];
    globalThis.fetch = (async (url: any) => {
      calls.push(String(url));
      return new Response(JSON.stringify(String(url).includes("twilio") ? { status: "active", friendly_name: "Acme" } : []), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;
    expect(await run(b, "phones-vapi", { vapiKey: "priv-0123456789abcdef", vapiPublic: "pub-0123456789abcdef", twilioSid: SID, twilioToken: "t".repeat(32) })).toBeNull();
    expect(calls).toEqual(["https://api.vapi.ai/assistant?limit=1", `https://api.twilio.com/2010-04-01/Accounts/${SID}.json`]);
    const s = getSetup(b.id);
    expect(s.vapi?.confirmed).toBe(true);
    expect(s.twilio).toMatchObject({ sid: SID, confirmed: true });
    expect(s.step).toBe("extras");
    expect(stepRows(b, s).find((r) => r.id === "phones")?.done).toBe(true);
    expect(phoneSettings(b.id, s)).toEqual({ VOICE_PROVIDER: "vapi", VAPI_API_KEY: "priv-0123456789abcdef", VAPI_PUBLIC_KEY: "pub-0123456789abcdef", TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: "t".repeat(32) });
    expect(await run(b, "extras-continue")).toBeNull();
    expect(firstOpen(b, getSetup(b.id))).toBe("install");
    expect(html(b, "phones")).toContain("Vapi connected");
    expect(html(b, "install")).toContain("Vapi");
    // "Use Telnyx instead" forgets both and goes back to Phones.
    expect(await run(b, "phones-vapi-remove")).toBeNull();
    expect(getSecret(b.id, "vapi_key")).toBeNull();
    expect(getSetup(b.id).step).toBe("phones");
  });

  test("our admin's Set up for them offers the same three: Telnyx, Vapi + Twilio, or skip", async () => {
    const b = await buyer("adm");
    expect((await fillStep(b, "admin@us.test", "phones", {}, "phones-skip")).ok).toBe(true);
    expect(getSetup(b.id).skipped?.phones).toBe(true);
    expect(phoneSettings(b.id, getSetup(b.id))).toEqual({});
    const SID = "AC" + "d".repeat(32);
    globalThis.fetch = (async (url: any) => new Response(JSON.stringify(String(url).includes("twilio") ? { status: "active", friendly_name: "Acme" } : []), { status: 200, headers: { "Content-Type": "application/json" } })) as any;
    const out = await fillStep(b, "admin@us.test", "phones", { vapiKey: "priv-0123456789abcdef", vapiPublic: "pub-0123456789abcdef", twilioSid: SID, twilioToken: "t".repeat(32) }, "phones-vapi");
    expect(out.ok).toBe(true);
    const s = getSetup(b.id);
    expect(s.skipped?.phones).toBeUndefined();
    expect(s.assist?.steps?.phones?.by).toBe("admin@us.test");
    expect(detailOf(b, s, "phones")).toContain("Twilio " + SID);
  });
});
