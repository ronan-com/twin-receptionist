// First run without the create-owner form: the install gives the app OWNER_NAME, AGENCY_NAME,
// FIRST_ADMIN_EMAIL and a one-time FIRST_LOGIN_TOKEN, and the done screen's button opens /welcome?t=<token>.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "firstrun-test-"));
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "HOSTING"]) delete process.env[k];

const { addBuyer } = await import("../lib");
const { actions, finish, railwayVars, buildSettings, ownerNameOf, dashboardLink, firstLoginFresh } = await import("../setup");
const { getSetup, putSecret, updateSetup } = await import("../store");
const { wizardPage } = await import("../wizard");

async function buyer(n: string) {
  const b = addBuyer(`Buyer ${n}`, `fr-${n}@example.com`);
  await actions.start(b, {});
  await actions.brand(b, { productName: "Acme Calls", ownerEmail: "jane.smith@acme.test" });
  putSecret(b.id, "railway_token", "rail-token-0123456789");
  updateSetup(b.id, (s) => { s.railway = { confirmed: true }; s.ai = { confirmed: true }; s.step = "phones"; });
  await actions["phones-skip"](b, {});
  return b;
}
const doneHtml = (b: any) => wizardPage(b, getSetup(b.id), b.code, "sid", "done");

describe("first run", () => {
  test("the owner's name comes from their email", () => {
    expect(ownerNameOf("jane.smith@acme.test")).toBe("Jane Smith");
    expect(ownerNameOf("bob@x.com")).toBe("Bob");
    expect(ownerNameOf("@x.com")).toBe("Owner");
  });

  test("Railway install variables carry the owner, the agency name and a one-time token", async () => {
    const b = await buyer("a");
    const vars = await railwayVars(b.id, getSetup(b.id), "rail-token-0123456789");
    expect(vars.FIRST_ADMIN_EMAIL).toBe("jane.smith@acme.test");
    expect(vars.OWNER_NAME).toBe("Jane Smith");
    expect(vars.AGENCY_NAME).toBe("Acme Calls");
    expect(vars.FIRST_LOGIN_TOKEN.length).toBeGreaterThanOrEqual(32);
    expect(vars.FIRST_LOGIN_TOKEN).toMatch(/^[A-Za-z0-9_-]+$/);
    // A retry of the install keeps the same token; another buyer gets a different one.
    expect((await railwayVars(b.id, getSetup(b.id), "rail-token-0123456789")).FIRST_LOGIN_TOKEN).toBe(vars.FIRST_LOGIN_TOKEN);
    const other = await buyer("b");
    expect((await railwayVars(other.id, getSetup(other.id), "rail-token-0123456789")).FIRST_LOGIN_TOKEN).not.toBe(vars.FIRST_LOGIN_TOKEN);
  });

  test("the done screen's Open button signs in with the token; a stale token falls back to the plain address", async () => {
    const b = await buyer("c");
    const vars = await railwayVars(b.id, getSetup(b.id), "rail-token-0123456789");
    updateSetup(b.id, (s) => { s.phase = "done"; s.step = "done"; s.resultUrl = "https://acme.up.railway.app"; s.tempUrl = "https://acme.up.railway.app"; });
    expect(doneHtml(b)).toContain(`href="https://acme.up.railway.app/welcome?t=${vars.FIRST_LOGIN_TOKEN}"`);
    // The address shown on screen is still the plain one, with no token in it.
    expect(doneHtml(b)).toContain('class="url" href="https://acme.up.railway.app"');
    expect(doneHtml(b)).not.toContain("Set up your agency");
    // The source download button appears once we know the installed version, and points at our route for this buyer.
    expect(doneHtml(b)).not.toContain("download-source");
    updateSetup(b.id, (s) => { s.attemptVersion = "1.0.21"; });
    expect(doneHtml(b)).toContain(`href="/setup/${b.code}/source" data-action="download-source">Download your full source code`);
    updateSetup(b.id, (s) => { s.firstLogin!.at = new Date(Date.now() - 24 * 3_600_000).toISOString(); });
    expect(firstLoginFresh(getSetup(b.id))).toBe(false);
    expect(doneHtml(b)).not.toContain("/welcome?t=");
    expect(dashboardLink(getSetup(b.id), "https://acme.up.railway.app/")).toBe("https://acme.up.railway.app/");
  });

  test("the token survives the finish step's clean-up (the done screen needs it)", async () => {
    const b = await buyer("d");
    const vars = await railwayVars(b.id, getSetup(b.id), "rail-token-0123456789");
    finish(b.id, "https://acme.up.railway.app");
    expect(getSetup(b.id).firstLogin?.token).toBe(vars.FIRST_LOGIN_TOKEN);
  });

  test("the server install (DigitalOcean) gets the same variables", async () => {
    const b = await buyer("e");
    updateSetup(b.id, (s) => { s.email = { mode: "smtp", address: "hi@acme.test", from: "hi@acme.test", smtp: { host: "smtp.acme.test", port: 587, user: "u" }, checked: true, confirmed: true } as any; s.domain = { host: "app.acme.test", confirmed: true } as any; });
    const env = buildSettings(b.id, getSetup(b.id));
    expect(env).toContain("OWNER_NAME=");
    expect(env).toContain("AGENCY_NAME=");
    expect(env).toContain("FIRST_LOGIN_TOKEN=");
    expect(env).toContain("FIRST_ADMIN_EMAIL=");
  });
});
