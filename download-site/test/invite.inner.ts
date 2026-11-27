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
process.env.PRODUCT_NAME = "Chloe";
process.env.SELLER_NAME = "Chloe AI";
process.env.SITE_SMTP_URL = `smtp://127.0.0.1:${smtp.port}`;
process.env.SITE_MAIL_FROM = "setup@example.com";
for (const k of ["HOSTING", "SUPPORT_EMAIL", "DEMO_APP_URL", "OPENROUTER_API_KEY"]) delete process.env[k];

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
  expect(await adminPage()).toContain("Add an agency");
});

describe("no Chloe branding by default", () => {
  test("Add agency: Style select defaults to Generic, 'Email them now' is off, onboarding links list Generic first as the default", async () => {
    const html = await adminPage();
    expect(html).toContain(`<option value="neutral" selected>Generic (no Chloe branding)</option><option value="branded">Chloe branded</option>`);
    expect(html).toMatch(/<input type="checkbox" name="welcome" value="1"> <b>Email them now<\/b>/);
    expect(html).not.toMatch(/name="welcome" value="1" checked/);
    const g = html.indexOf("Generic onboarding link (default)"), c = html.indexOf("Chloe-branded onboarding link");
    expect(g).toBeGreaterThan(0);
    expect(c).toBeGreaterThan(g);
  });

  test("Add agency with the defaults: neutral style, and nobody is emailed (even with site email set up)", async () => {
    const before = mails.length;
    const r = await call("POST", "/admin/buyers", { t: tok(await adminPage()), name: "Ann Agency", email: "ann@example.com" });
    expect(r.res.status).toBe(200);
    expect(r.body).toContain("Nobody was emailed");
    const b = buyerByEmail("ann@example.com");
    expect(b.style).toBe("neutral");
    expect(b.invited_at).toBeNull();
    expect(mails.length).toBe(before);
  });

  test("Add agency picking 'Chloe branded' makes a branded agency; the agency page shows the style and can switch it", async () => {
    await call("POST", "/admin/buyers", { t: tok(await adminPage()), name: "Ben Branded", email: "ben@example.com", style: "branded" });
    const b = buyerByEmail("ben@example.com");
    expect(b.style).toBe("branded");
    const page = (await call("GET", `/admin/b/${b.id}`)).body;
    expect(page).toContain("<span>Style</span><b>Chloe branded</b>");
    expect(page).toContain("Switch to Generic (no Chloe branding)");
    const sw = await call("POST", `/admin/b/${b.id}/style`, { t: tok(page), style: "neutral" });
    expect(sw.loc).toBe(`/admin/b/${b.id}?m=style-neutral`);
    expect(buyerByEmail("ben@example.com").style).toBe("neutral");
    await call("POST", `/admin/b/${b.id}/style`, { t: tok(page), style: "branded" });
    expect(buyerByEmail("ben@example.com").style).toBe("branded");
  });

  test("a neutral agency's wizard, every step, shows no Chloe (title, header, footer, guides); a branded one does", async () => {
    const n = findBuyer(buyerByEmail("ann@example.com").code)!;
    for (const view of STEPS) {
      const html = wizardPage(n, getSetup(n.id), n.code, "sid-x", view);
      expect(html).not.toMatch(/Chloe/i);
      expect(html).not.toContain('href="/guide"');
    }
    expect(await A.fillStep(n, ADMIN, "brand", { productName: "Acme Voice", ownerEmail: "owner@acme.test", logo: "", removeLogo: "", colour: "" })).toMatchObject({ ok: true });
    for (const view of STEPS) expect(wizardPage(n, getSetup(n.id), n.code, "sid-x", view)).not.toMatch(/Chloe/i);
    const br = findBuyer(buyerByEmail("ben@example.com").code)!;
    expect(wizardPage(br, getSetup(br.id), br.code, "sid-x", "welcome")).toContain("Chloe");
  });

  test("the help chat's instructions, the start pages and the link-off page say no Chloe for a neutral agency", () => {
    const n = findBuyer(buyerByEmail("ann@example.com").code)!;
    expect(systemPrompt({ buyer: n, setup: getSetup(n.id), view: "brand" })).not.toMatch(/Chloe/i);
    const br = findBuyer(buyerByEmail("ben@example.com").code)!;
    expect(systemPrompt({ buyer: br, setup: getSetup(br.id) })).toContain("Chloe");
    expect(startShell("neutral", "Start", "<p>x</p>")).not.toMatch(/Chloe/i);
    expect(inactivePage("neutral")).not.toMatch(/Chloe/i);
  });

  test("'Email them now' on a neutral agency: the welcome email has no Chloe, and counts as invited", async () => {
    const before = mails.length;
    const r = await call("POST", "/admin/buyers", { t: tok(await adminPage()), name: "Wendy Welcome", email: "wendy@example.com", welcome: "1" });
    expect(r.body).toContain("Welcome email sent to wendy@example.com");
    expect(mails.length).toBe(before + 1);
    const m = mails[mails.length - 1];
    expect(m.to).toBe("wendy@example.com");
    expect(m.data).not.toMatch(/Chloe/i);
    expect(buyerByEmail("wendy@example.com").invited_at).toBeTruthy();
  });
});

describe("Invite them", () => {
  test("not installed: the card offers their setup link, lists what we did and what's left, and the list says Not invited yet", async () => {
    const b = buyerByEmail("ann@example.com");
    const page = (await call("GET", `/admin/b/${b.id}`)).body;
    const card = page.slice(page.indexOf('id="invite"'));
    expect(card).toContain("Send their setup link");
    expect(card).toContain("Not invited yet");
    expect(card).toContain(`Send invite email to ann@example.com`);
    expect(card).toContain(`/setup/${b.code}`);
    expect(card).toMatch(/Done by us<\/span><b>Brand<\/b>/);
    expect(card).toMatch(/Left for them<\/span><b>[^<]*Phones \(Telnyx\)[^<]*Install<\/b>/);
    expect(card).not.toContain("Send their dashboard login");
    const list = await adminPage();
    expect(list).toMatch(/Ann Agency[\s\S]*?Not invited yet/);
  });

  test("Send invite email: the setup link goes to them (no Chloe for a neutral agency) and invited-at is recorded and shown", async () => {
    const b = buyerByEmail("ann@example.com");
    const before = mails.length;
    const page = (await call("GET", `/admin/b/${b.id}`)).body;
    const r = await call("POST", `/admin/b/${b.id}/assist/invite`, { t: tok(page) });
    expect(r.loc).toBe(`/admin/b/${b.id}#invite`);
    expect(mails.length).toBe(before + 1);
    const m = mails[mails.length - 1];
    expect(m.to).toBe("ann@example.com");
    expect(m.data).toContain(`/setup/${b.code}`);
    expect(m.data).toContain("Brand");
    expect(m.data).not.toMatch(/Chloe/i);
    const after = buyerByEmail("ann@example.com");
    expect(after.invited_at).toBeTruthy();
    const again = (await call("GET", `/admin/b/${b.id}`)).body;
    expect(again).toContain("Invite emailed to ann@example.com: their setup link.");
    expect(again.slice(again.indexOf('id="invite"'))).toContain("Invited ");
    expect(await adminPage()).toMatch(/Ann Agency[\s\S]*?Invited \d{4}-\d\d-\d\d/);
    expect(sync.supportLog(b.id, 20).some((l) => l.action === "invite: setup link" && /emailed to ann@example.com/.test(l.note))).toBe(true);
  });

  test("installed: the card offers their dashboard login to the owner email, and sending it emails the owner their login", async () => {
    const b = findBuyer(buyerByEmail("ben@example.com").code)!;
    updateSetup(b.id, (s) => { s.phase = "done"; s.step = "done"; s.brand = { productName: "Ben Voice", ownerEmail: "owner@ben.test", ownPhoneAccount: false }; s.resultUrl = "https://app.ben.test"; s.extrasDone = true; });
    sync.newSyncToken(b.id);
    const page = (await call("GET", `/admin/b/${b.id}`)).body;
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
      const page = (await call("GET", `/admin/b/${b.id}`)).body;
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
