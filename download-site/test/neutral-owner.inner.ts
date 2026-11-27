import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const dir = mkdtempSync(join(tmpdir(), "neutral-owner-"));
process.env.DATA_DIR = dir;
process.env.SITE_URL = "http://localhost:4500";
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.PRODUCT_NAME = "Chloe";
process.env.SELLER_NAME = "Chloe AI";
delete process.env.HOSTING;
const { addBuyer, db, PLAIN_AGENCY_NAME } = await import("../lib");
const { getSetup, updateSetup } = await import("../store");
const { actions, railwayVars, buildSettings } = await import("../setup");
const { wizardPage } = await import("../wizard");
afterAll(() => { db().close(); rmSync(dir, { recursive: true, force: true }); });
async function owner(name: string) {
  const b = addBuyer(name, name.toLowerCase() + "@example.com");
  await actions.start(b, {});
  return b;
}
test("generic onboarding asks for owner email without a name, logo or colour", async () => {
  const b = await owner("Alice");
  const html = wizardPage(b, getSetup(b.id), b.code, "sid", "brand");
  expect(html).toContain("Your owner account");
  expect(html).toContain("data-neutral-onboarding");
  expect(html).toContain('name="ownerEmail"');
  for (const field of ["productName", "logo", "colour"]) expect(html).not.toContain('name="' + field + '"');
  expect(html).not.toMatch(/Chloe|Twin Technologies/);
  expect((await actions.brand(b, { ownerEmail: "invalid" }))?.kind).toBe("err");
  expect(await actions.brand(b, { ownerEmail: "alice@example.com" })).toBeNull();
  expect(getSetup(b.id).brand).toMatchObject({ productName: PLAIN_AGENCY_NAME, deferred: true });
  expect(getSetup(b.id).step).toBe("railway");
});
test("new installations are plain on both hosting paths and reveal no seller brand", async () => {
  const b = await owner("Bob");
  await actions.brand(b, { ownerEmail: "bob@example.com" });
  updateSetup(b.id, (s) => {
    s.skipped = { phones: true };
    s.domain = { mode: "manual", sub: "app", host: "app.bob.test", confirmed: true };
    s.email = { mode: "smtp", confirmed: true, smtp: { host: "smtp.test", port: 587, user: "bob" } };
  });
  const s = getSetup(b.id);
  const vars = await railwayVars(b.id, s, "fake-token");
  expect(vars.PRODUCT_NAME).toBe(PLAIN_AGENCY_NAME);
  expect(vars.NEUTRAL_DASHBOARD).toBe("1");
  expect(vars.SINGLE_AGENCY).toBe("1");
  expect(vars.SUPPORT_SELLER_NAME).toBe("Support");
  expect(vars).not.toHaveProperty("BRAND_LOGO_PNG");
  expect(vars).not.toHaveProperty("BRAND_COLOUR");
  const settings = buildSettings(b.id, s);
  expect(settings).toContain("NEUTRAL_DASHBOARD=1");
  expect(settings).not.toMatch(/Chloe|BRAND_LOGO_PNG|BRAND_COLOUR/);
});
test("changing owner email preserves the manual branding and other buyers are independent", async () => {
  const a = await owner("Carol"), b = await owner("Dan");
  await actions.brand(a, { ownerEmail: "carol@example.com" });
  await actions.brand(b, { ownerEmail: "dan@example.com", productName: "Dan Voice", colour: "#125588" });
  await actions.brand(b, { ownerEmail: "owner@dan.test" });
  expect(getSetup(b.id).brand).toMatchObject({ productName: "Dan Voice", colour: "#125588", ownerEmail: "owner@dan.test" });
  expect(getSetup(b.id).brand?.deferred).not.toBe(true);
  expect(getSetup(a.id).brand).toMatchObject({ productName: PLAIN_AGENCY_NAME, deferred: true, ownerEmail: "carol@example.com" });
  const vars = await railwayVars(b.id, getSetup(b.id), "fake-token");
  expect(vars.BRAND_COLOUR).toBe("#125588");
  expect(vars).not.toHaveProperty("NEUTRAL_DASHBOARD");
});
test("explicitly branded installations retain their existing validation and styling", async () => {
  const b = addBuyer("Existing", "existing@example.com", false, { style: "branded" });
  await actions.start(b, {});
  expect((await actions.brand(b, { ownerEmail: b.email }))?.text).toBe("Give your brand a name.");
  expect(await actions.brand(b, { ownerEmail: b.email, productName: "Existing Brand" })).toBeNull();
  expect(getSetup(b.id).brand?.deferred).not.toBe(true);
  expect(wizardPage(b, getSetup(b.id), b.code, "sid", "brand")).toContain('name="productName"');
});
