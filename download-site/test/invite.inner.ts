// The checks for invite.test.ts: the admin's Add agency form and agency page, driven through adminRoute, with a tiny fake
// SMTP server standing in for the site's mail sender (SITE_SMTP_URL).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "invite-test-"));
const ADMIN = "boss@example.com";

// ---- a fake SMTP server: keeps every message it's given (quoted-printable undone, so words aren't split) ----
const qp = (t: string) => Buffer.from(t.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
const mails: { to: string; data: string }[] = [];
const smtp = Bun.listen<{ buf: string; data: boolean; to: string; body: string }>({
  hostname: "127.0.0.1", port: 0,
  socket: {
    open(s) { s.data = { buf: "", data: false, to: "", body: "" }; s.write("220 fake ESMTP\r\n"); },
    data(s, chunk) {
      s.data.buf += chunk.toString();
      let i: number;
      while ((i = s.data.buf.indexOf("\r\n")) >= 0) {
        const line = s.data.buf.slice(0, i);
        s.data.buf = s.data.buf.slice(i + 2);
        if (s.data.data) {
          if (line === ".") { s.data.data = false; mails.push({ to: s.data.to, data: qp(s.data.body) }); s.data.body = ""; s.write("250 queued\r\n"); }
          else s.data.body += line + "\n";
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") s.write("250 fake\r\n");
        else if (cmd === "MAIL") s.write("250 ok\r\n");
        else if (cmd === "RCPT") { s.data.to = line.replace(/^RCPT TO:\s*<?([^>]*)>?.*$/i, "$1"); s.write("250 ok\r\n"); }
        else if (cmd === "DATA") { s.data.data = true; s.write("354 go\r\n"); }
        else if (cmd === "QUIT") { s.write("221 bye\r\n"); s.end(); }
        else s.write("250 ok\r\n");
      }
    },
  },
});

process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
process.env.MOCK_RAILWAY = "1";
process.env.MOCK_TELNYX = "1";
process.env.ADMIN_EMAILS = ADMIN;
process.env.PRODUCT_NAME = "Zorbo";
process.env.SELLER_NAME = "Zorbo AI";
process.env.SITE_SMTP_URL = `smtp://127.0.0.1:${smtp.port}`;
process.env.SITE_MAIL_FROM = "setup@example.com";
for (const k of ["SUPPORT_EMAIL", "DEMO_APP_URL", "OPENROUTER_API_KEY"]) delete process.env[k];

const { db, findBuyer } = await import("../lib");
const { adminRoute, newAdminLink } = await import("../admin-web");
const A = await import("../assist");
const { STEPS, getSetup, updateSetup } = await import("../store");
const { wizardPage, startShell } = await import("../wizard");
const { inactivePage } = await import("../genericlink");
const { systemPrompt } = await import("../chat");
const sync = await import("../sync");

afterAll(() => smtp.stop(true));

// ---- driving the admin like a browser ----
const ctx = {
  ip: "203.0.113.9",
  sameOrigin: () => true,
  readForm: async (r: Request) => Object.fromEntries(new URLSearchParams(await r.text())) as Record<string, string>,
  html: (body: string, status = 200, extra: Record<string, string> = {}) => new Response(body, { status, headers: { "Content-Type": "text/html", ...extra } }),
  redirect: (to: string, extra: Record<string, string> = {}) => new Response(null, { status: 303, headers: { Location: to, ...extra } }),
};
let cookie = "";
async function call(method: "GET" | "POST", path: string, form: Record<string, string> = {}) {
  const u = new URL(path, "http://localhost:4500");
  const req = new Request(u.toString(), { method, headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: method === "POST" ? new URLSearchParams(form).toString() : undefined });
  const res = await adminRoute(req, u, ctx);
  return { res, body: await res.text(), loc: res.headers.get("location") || "" };
}
const tok = (html: string) => html.match(/name="t" value="([^"]+)"/)![1];
const buyerByEmail = (email: string) => db().query("SELECT * FROM buyers WHERE email = ?").get(email) as any;
async function adminPage() { return (await call("GET", "/admin")).body; }

test("sign in (one-time link)", async () => {
  const link = newAdminLink(ADMIN);
  const r = await call("POST", new URL(link).pathname);
  cookie = (r.res.headers.get("set-cookie") || "").split(";")[0];
  expect(cookie).toMatch(/^as=/);
  expect(await adminPage()).toContain("New agency");
});

describe("generic setup site: no product name anywhere", () => {
  test("Add agency: no Style select, 'Email them now' is off, no onboarding links panel", async () => {
    const html = await adminPage();
    expect(html).not.toContain('name="style"');
    expect(html).not.toMatch(/branded/i);
    expect(html).toContain("AI Agency Admin");
    expect(html).not.toMatch(/Zorbo/i);
    // New agency: just three fields (person's name, email, agency name); emailing is a choice made afterwards, with a preview.
    expect(html).toContain('name="owner"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="name"');
    expect(html).not.toContain('name="welcome"');
    // No onboarding links panel on the dashboard: agencies are invited one by one with Add an agency.
    expect(html).not.toContain(`id="onboarding-link"`);
  });

  test("Add agency with the defaults: generic style, and nobody is emailed (even with site email set up)", async () => {
    const before = mails.length;
    const r = await call("POST", "/admin/buyers", { t: tok(await adminPage()), name: "Ann Agency", email: "ann@example.com" });
    expect(r.res.status).toBe(200);
    expect(r.body).toContain("Nobody has been emailed yet");
    const b = buyerByEmail("ann@example.com");
    expect(b.style).toBe("neutral");
    expect(b.invited_at).toBeNull();
    expect(mails.length).toBe(before);
  });

  test("a posted style=branded is ignored, and a stored 'branded' buyer renders generic", async () => {
    await call("POST", "/admin/buyers", { t: tok(await adminPage()), name: "Ben Old", email: "ben@example.com", style: "branded" });
    const b = buyerByEmail("ben@example.com");
    expect(b.style).toBe("neutral");
    db().query("UPDATE buyers SET style = 'branded' WHERE id = ?").run(b.id);
    const old = findBuyer(buyerByEmail("ben@example.com").code)!;
    const html = wizardPage(old, getSetup(old.id), old.code, "sid-x", "welcome");
    expect(html).not.toMatch(/Zorbo/i);
    const page = (await call("GET", `/admin/b/${b.id}`)).body;
    expect(page).not.toMatch(/Zorbo|branded/i);
    expect((await call("POST", `/admin/b/${b.id}/style`, { t: tok(page), style: "branded" })).res.status).not.toBe(302);
  });

  test("the wizard, every step, shows no product name (title, header, footer); the /guide link stays", async () => {
    const n = findBuyer(buyerByEmail("ann@example.com").code)!;
    for (const view of STEPS) {
      const html = wizardPage(n, getSetup(n.id), n.code, "sid-x", view);
      expect(html).not.toMatch(/Zorbo/i);
    }
    expect(await A.fillStep(n, ADMIN, "brand", { productName: "Acme Voice", ownerEmail: "owner@acme.test", logo: "", removeLogo: "", colour: "" })).toMatchObject({ ok: true });
    for (const view of STEPS) expect(wizardPage(n, getSetup(n.id), n.code, "sid-x", view)).not.toMatch(/Zorbo/i);
  });

  test("the help chat's instructions, the start pages and the link-off page name no product", () => {
    const n = findBuyer(buyerByEmail("ann@example.com").code)!;
    expect(systemPrompt({ buyer: n, setup: getSetup(n.id), view: "brand" })).not.toMatch(/Zorbo/i);
    expect(startShell("neutral", "Start", "<p>x</p>")).not.toMatch(/Zorbo/i);
    expect(inactivePage("neutral")).not.toMatch(/Zorbo/i);
  });

  test("New agency: the three details pre-fill their Brand step; 'Email them the link' previews first, then sends one short email with no contact lines", async () => {
    const before = mails.length;
    const r = await call("POST", "/admin/buyers", { t: tok(await adminPage()), owner: "Wendy Welcome", name: "Welcome Voice", email: "wendy@example.com" });
    expect(r.body).toContain("Email them the link");
    expect(r.body).toContain("Copy");
    expect(mails.length).toBe(before); // making the agency emails nobody
    const w = buyerByEmail("wendy@example.com");
    expect(w.name).toBe("Welcome Voice");
    expect(getSetup(w.id).prefill).toEqual({ ownerName: "Wendy Welcome", ownerEmail: "wendy@example.com", agencyName: "Welcome Voice" });
    // The Brand step starts filled in, and the buyer may change all three.
    const brandHtml = wizardPage(w, getSetup(w.id), w.code, "sid-w", "brand");
    expect(brandHtml).toContain('name="ownerName" maxlength="80" required autocomplete="name" value="Wendy Welcome"');
    expect(brandHtml).toContain('value="wendy@example.com"');
    expect(brandHtml).toContain('name="productName" maxlength="60" required value="Welcome Voice"');
    // The preview shows the exact email; nothing is sent by looking.
    const pv = (await call("GET", `/admin/b/${w.id}/email`)).body;
    expect(pv).toContain("Hi Wendy,");
    expect(pv).toContain("Welcome Voice is ready to set up");
    expect(pv).toContain(`/setup/${w.code}`);
    for (const need of ["Railway", "OpenRouter", "Telnyx", "Vapi"]) expect(pv).toContain(need);
    expect(pv).not.toMatch(/Questions|talk to a person|contact us|support@/i);
    expect(mails.length).toBe(before);
    const sent = await call("POST", `/admin/b/${w.id}/assist/invite`, { t: tok(pv) });
    expect(sent.res.status).toBe(303);
    expect(mails.length).toBe(before + 1);
    const m = mails[mails.length - 1];
    expect(m.to).toBe("wendy@example.com");
    expect(m.data).toContain("Hi Wendy,");
    expect(m.data).not.toMatch(/Zorbo|Questions|talk to a person/i);
    expect(buyerByEmail("wendy@example.com").invited_at).toBeTruthy();
  });
});

describe("Invite them", () => {
  test("not installed: the card offers their setup link, lists what we did and what's left, and the list says Not invited yet", async () => {
    const b = buyerByEmail("ann@example.com");
    const page = (await call("GET", `/admin/b/${b.id}?tab=setup`)).body;
    const card = page.slice(page.indexOf('id="invite"'));
    expect(card).toContain("Send their setup link");
    expect(card).toContain("Not invited yet");
    expect(card).toContain(`Send invite email to ann@example.com`);
    expect(card).toContain(`/setup/${b.code}`);
    expect(card).toMatch(/Done by us<\/span><b>Brand<\/b>/);
    expect(card).toMatch(/Left for them<\/span><b>[^<]*Phones \(Telnyx, or Vapi \+ Twilio\)[^<]*Install<\/b>/);
    expect(card).not.toContain("Send their dashboard login");
    const list = await adminPage();
    expect(list).toMatch(/Ann Agency[\s\S]*?Not invited yet/);
  });

  test("Send invite email: the setup link goes to them (no product name) and invited-at is recorded and shown", async () => {
    const b = buyerByEmail("ann@example.com");
    const before = mails.length;
    const page = (await call("GET", `/admin/b/${b.id}?tab=setup`)).body;
    const r = await call("POST", `/admin/b/${b.id}/assist/invite`, { t: tok(page) });
    expect(r.loc).toBe(`/admin/b/${b.id}?tab=setup#invite`);
    expect(mails.length).toBe(before + 1);
    const m = mails[mails.length - 1];
    expect(m.to).toBe("ann@example.com");
    expect(m.data).toContain(`/setup/${b.code}`);
    expect(m.data).toContain("Brand");
    expect(m.data).not.toMatch(/Zorbo/i);
    const after = buyerByEmail("ann@example.com");
    expect(after.invited_at).toBeTruthy();
    const again = (await call("GET", `/admin/b/${b.id}?tab=setup`)).body;
    expect(again).toContain("Invite emailed to ann@example.com: their setup link.");
    expect(again.slice(again.indexOf('id="invite"'))).toContain("Invited ");
    expect(await adminPage()).toMatch(/Ann Agency[\s\S]*?Invited \d{4}-\d\d-\d\d/);
    expect(sync.supportLog(b.id, 20).some((l) => l.action === "invite: setup link" && /emailed to ann@example.com/.test(l.note))).toBe(true);
  });

  test("installed: the card offers their dashboard login to the owner email, and sending it emails the owner their login", async () => {
    const b = findBuyer(buyerByEmail("ben@example.com").code)!;
    updateSetup(b.id, (s) => { s.phase = "done"; s.step = "done"; s.brand = { productName: "Ben Voice", ownerEmail: "owner@ben.test", ownPhoneAccount: false }; s.resultUrl = "https://app.ben.test"; s.extrasDone = true; });
    sync.newSyncToken(b.id);
    const page = (await call("GET", `/admin/b/${b.id}?tab=setup`)).body;
    const card = page.slice(page.indexOf('id="invite"'));
    expect(card).toContain("Send their dashboard login");
    expect(card).toContain("Send invite email to owner@ben.test");
    expect(card).toContain("https://app.ben.test");
    expect(card).not.toContain("Send their setup link");
    const before = mails.length;
    const r = await A.sendInvite(b, ADMIN, (async () => new Response(JSON.stringify({ ok: true, url: `https://app.ben.test/reset/${"B".repeat(43)}`, expiresInMinutes: 15 }), { status: 200 })) as any);
    expect(r).toMatchObject({ ok: true, kind: "dashboard", to: "owner@ben.test", mailed: true, loginKind: "reset" });
    expect(mails.length).toBe(before + 1);
    expect(mails[mails.length - 1].to).toBe("owner@ben.test");
    expect(mails[mails.length - 1].data).toContain(`https://app.ben.test/reset/${"B".repeat(43)}`);
    expect(findBuyer(b.code)!.invited_at).toBeTruthy();
  });

  test("no site email: the card shows the link with Copy and says to send it yourself; Mark as invited records it", async () => {
    delete process.env.SITE_SMTP_URL;
    try {
      await call("POST", "/admin/buyers", { t: tok(await adminPage()), name: "Nora Nomail", email: "nora@example.com" });
      const b = buyerByEmail("nora@example.com");
      const page = (await call("GET", `/admin/b/${b.id}?tab=setup`)).body;
      const card = page.slice(page.indexOf('id="invite"'));
      expect(card).toContain("Email isn't set up on the setup site — copy and send it yourself");
      expect(card).toContain(`data-copy="http://localhost:4500/setup/${b.code}"`);
      expect(card).not.toContain("Send invite email to");
      const before = mails.length;
      const r = await call("POST", `/admin/b/${b.id}/assist/invite`, { t: tok(page) });
      expect(r.res.status).toBe(200);
      expect(r.body).toContain("Email isn&#39;t set up on the setup site — copy and send it yourself");
      expect(r.body).toContain(`data-copy="http://localhost:4500/setup/${b.code}"`);
      expect(mails.length).toBe(before);
      expect(buyerByEmail("nora@example.com").invited_at).toBeNull();
      await call("POST", `/admin/b/${b.id}/assist/mark-invited`, { t: tok(page) });
      expect(buyerByEmail("nora@example.com").invited_at).toBeTruthy();
    } finally {
      process.env.SITE_SMTP_URL = `smtp://127.0.0.1:${smtp.port}`;
    }
  });
});
