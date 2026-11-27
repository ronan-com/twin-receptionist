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
const { actions, railwayVars } = await import("../setup");
const { wizardPage } = await import("../wizard");
afterAll(() => { db().close(); rmSync(dir, { recursive: true, force: true }); });
async function owner(name: string) {
  const b = addBuyer(name, name.toLowerCase() + "@example.com");
  await actions.start(b, {});
  return b;
}
test("the Brand step takes owner email, an OPTIONAL agency name, logo, 1 to 3 colours and light/dark; leaving the name blank starts a plain dashboard", async () => {
  const b = await owner("Alice");
  const html = wizardPage(b, getSetup(b.id), b.code, "sid", "brand");
  expect(html).toContain("data-neutral-onboarding");
  for (const field of ["ownerEmail", "ownerName", "productName", "logo", "colour", "colour2", "colour3", "theme"]) expect(html).toContain('name="' + field + '"');
  expect(html).toMatch(/<input id="productName" name="productName" maxlength="60" value=/); // not required
  expect(html).toContain("Leave it blank to start with a plain dashboard");
  expect(html).not.toMatch(/Chloe|Twin Technologies/);
  expect((await actions.brand(b, { ownerEmail: "invalid" }))?.kind).toBe("err");
  expect(await actions.brand(b, { ownerEmail: "alice@example.com", colour: "#4f46e5", theme: "dark" })).toBeNull();
  expect(getSetup(b.id).brand).toMatchObject({ productName: PLAIN_AGENCY_NAME, deferred: true, theme: "dark" });
  expect(getSetup(b.id).step).toBe("railway");
  // a plain install carries NEUTRAL_DASHBOARD and the look, but no brand colours or logo
  const vars = await railwayVars(b.id, getSetup(b.id), "fake-token");
  expect(vars.NEUTRAL_DASHBOARD).toBe("1");
  expect(vars.THEME).toBe("dark");
  expect(vars).not.toHaveProperty("BRAND_COLOUR");
  expect(vars).not.toHaveProperty("BRAND_COLOURS");
  // naming it later in the wizard makes it a branded install
  expect(await actions.brand(b, { ownerEmail: "alice@example.com", productName: "Alice AI", colour: "#0a8f5c", colour2on: "1", colour2: "#f59e0b", theme: "dark" })).toBeNull();
  const named = getSetup(b.id).brand!;
  expect(named.deferred).not.toBe(true);
  expect(named).toMatchObject({ productName: "Alice AI", colours: ["#0a8f5c", "#f59e0b"] });
  const v2 = await railwayVars(b.id, getSetup(b.id), "fake-token");
  expect(v2).not.toHaveProperty("NEUTRAL_DASHBOARD");
  expect(v2.BRAND_COLOURS).toBe("#0a8f5c,#f59e0b");
});
test("new installations with no agency name are plain and reveal no seller brand", async () => {
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
  expect(JSON.stringify(vars)).not.toMatch(/Chloe|BRAND_LOGO_PNG|BRAND_COLOUR/);
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
test("legacy buyer styles use the neutral portal and preserve supplied business branding", async () => {
  const b = addBuyer("Existing", "existing@example.com", false, { style: "branded" });
  expect(b.style).toBe("neutral");
  await actions.start(b, {});
  expect(await actions.brand(b, { ownerEmail: b.email, productName: "Existing Brand" })).toBeNull();
  expect(getSetup(b.id).brand?.deferred).not.toBe(true);
  expect(await actions.brand(b, { ownerEmail: "changed@example.com" })).toBeNull();
  expect(getSetup(b.id).brand).toMatchObject({ productName: "Existing Brand", ownerEmail: "changed@example.com" });
  expect(wizardPage(b, getSetup(b.id), b.code, "sid", "brand")).toContain('value="Existing Brand"');
});

test("skip buttons open a read-only preview without submitting forms or advancing setup", async () => {
  const b = addBuyer("Preview", "preview@example.com");
  await actions.start(b, {});
  const before = JSON.stringify(getSetup(b.id));
  const { STEPS } = await import("../store");
  const { dashboardPreview } = await import("../dashboard-preview");
  for (const step of STEPS.filter(step => step !== "done")) {
    const html = wizardPage(b, getSetup(b.id), b.code, "sid", step);
    expect(html).toContain('href="/setup/' + b.code + '?preview=dashboard">Preview your dashboard');
  }
  const page = dashboardPreview("/setup/" + b.code);
  expect(page).toContain('href="/setup/' + b.code + '">Continue onboarding');
  expect(page).toContain("Preview mode");
  expect(page).toContain("Switch to customer view");
  const customer=dashboardPreview("/setup/"+b.code,"calendar","customer");
  expect(customer).toContain("Switch to agency view");
  expect(customer).toContain('data-demo-form="booking"');
  expect(page).not.toContain("preview@example.com");
  expect(JSON.stringify(getSetup(b.id))).toBe(before);
});
test("shared link preview does not create a buyer, consume a place, or require an email", async () => {
  const { createLink, startRoute, linkById } = await import("../genericlink");
  const l = createLink("boss@example.com", "Preview links", "neutral", "1")!;
  const count = () => (db().query("SELECT count(*) AS n FROM buyers").get() as {n:number}).n;
  const before = count();
  const ctx = {
    ip: "203.0.113.10", secure: false,
    sameOrigin: () => true, readForm: async () => null,
    html: (body: string, status = 200, headers = {}) => new Response(body, {status,headers}),
    redirect: (url: string, headers = {}) => new Response(null,{status:303,headers:{Location:url,...headers}})
  };
  const base = "/start/" + l.code;
  const form = await startRoute(new Request("http://localhost:4500"+base),l.code,ctx);
  expect(await form.text()).toContain("Preview your dashboard");
  const preview = await startRoute(new Request("http://localhost:4500"+base+"?preview=dashboard&section=clients"),l.code,ctx);
  expect(preview.status).toBe(200);
  const text = await preview.text();
  expect(text).toContain('href="'+base+'">Continue onboarding');
  expect(text).toContain("<h1>Clients</h1>");
  expect(count()).toBe(before);
  expect(linkById(l.id)?.started).toBe(0);
  db().query("UPDATE generic_links SET enabled=0 WHERE id=?").run(l.id);
  expect((await startRoute(new Request("http://localhost:4500"+base+"?preview=dashboard"),l.code,ctx)).status).toBe(410);
});
