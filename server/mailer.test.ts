// Account email: the simple sender choices, the real-login check's errors, main -> backup failover,
// the outbox's retry schedule and giving up, problems recorded, and who may change the settings.
// No database and no real mail server: the transports, store and problem recorder are stand-ins.
//   bun test --env-file=../.env server/mailer.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { RETRY_MS, deliver, retryDelay, routesOf, runOutbox, sendAccountEmail, setMailDeps, type OutboxStore, type RecentMail, type Transport } from "./mailer";
import { buildSender, describeUrl, friendlySmtpError, guessProvider, PRESETS } from "./mailPresets";
import { canManageEmail, checkSender, emailSettingsRoutes, setVerifier } from "./emailSettings";
import { AuthError, type Ctx } from "./accounts";
import { ValidationError } from "./prompt";
import type { MailConfig } from "./platformSettings";

const PRIMARY = "smtp://a%40x.com:pw1@smtp.primary.test:587";
const BACKUP = "smtp://b%40x.com:pw2@smtp.backup.test:587";

// ---- stand-ins ----
type Row = { id: string; to: string; subject: string; text: string; status: "pending" | "sent" | "failed"; attempts: number; via: string; error: string; nextAt: Date | null };
function memoryStore() {
  const rows: Row[] = [];
  let n = 0;
  const store: OutboxStore = {
    async insert(r) {
      rows.push({ ...r, id: String(++n) });
    },
    async claimDue() {
      return rows.filter((r) => r.status === "pending" && r.nextAt && r.nextAt.getTime() <= clock).map((r) => ({ id: r.id, to: r.to, subject: r.subject, text: r.text, attempts: r.attempts }));
    },
    async update(id, c) {
      const r = rows.find((x) => x.id === id)!;
      Object.assign(r, { status: c.status, attempts: c.attempts, nextAt: c.nextAt, error: c.error ?? "" }, c.via ? { via: c.via } : {});
      if (c.status !== "pending") r.text = "";
    },
    async recent(limit) {
      return rows.slice(-limit).reverse() as unknown as RecentMail[];
    },
  };
  return { rows, store };
}

let clock = 1_000_000;
let up: Record<string, boolean>;
let sent: { url: string; to: string; from: string }[];
let problems: { kind: string; msg: string }[];
let incidents: { kind: string; message: string }[];
let config: MailConfig;
let mem: ReturnType<typeof memoryStore>;

const fakeTransport = (url: string): Transport => ({
  async sendMail(m) {
    if (!up[url]) throw Object.assign(new Error(`Connection refused by ${new URL(url).hostname}`), { code: "ECONNECTION" });
    sent.push({ url, to: String(m.to), from: String(m.from) });
  },
});

beforeEach(() => {
  clock = 1_000_000;
  up = { [PRIMARY]: true, [BACKUP]: true };
  sent = [];
  problems = [];
  incidents = [];
  config = { smtpUrl: PRIMARY, from: "Chloe <a@x.com>", backupUrl: BACKUP, backupFrom: "b@x.com" };
  mem = memoryStore();
  setMailDeps({
    transport: fakeTransport,
    store: mem.store,
    problem: async (kind, msg) => void problems.push({ kind, msg }),
    incident: async (i) => void incidents.push(i),
    config: () => config,
    now: () => clock,
  });
});
afterEach(() => {
  setMailDeps();
  setVerifier();
});

// ---- presets ----

describe("building a sender from a simple choice", () => {
  test("Gmail: smtp.gmail.com:587, the address is the login, app password spaces dropped", () => {
    const s = buildSender({ provider: "gmail", address: "Owner@Gmail.com", password: "abcd efgh ijkl mnop", fromName: "Chloe" });
    expect(s.host).toBe("smtp.gmail.com");
    expect(s.port).toBe(587);
    expect(s.from).toBe("Chloe <owner@gmail.com>");
    expect(s.smtpUrl).toBe("smtp://owner%40gmail.com:abcdefghijklmnop@smtp.gmail.com:587");
  });
  test("Microsoft 365 and both Zoho regions use their own servers on 587", () => {
    expect(buildSender({ provider: "microsoft", address: "a@biz.com.au", password: "p" }).smtpUrl).toBe("smtp://a%40biz.com.au:p@smtp.office365.com:587");
    expect(buildSender({ provider: "zoho_au", address: "a@biz.com.au", password: "p" }).host).toBe("smtp.zoho.com.au");
    expect(buildSender({ provider: "zoho", address: "a@biz.com", password: "p" }).host).toBe("smtp.zoho.com");
  });
  test("Resend: the API key over smtps on 465, user resend", () => {
    const s = buildSender({ provider: "resend", address: "hello@mail.biz.com", password: "re_abc123XYZ_456" });
    expect(s.smtpUrl).toBe("smtps://resend:re_abc123XYZ_456@smtp.resend.com:465");
    expect(s.from).toBe("hello@mail.biz.com");
  });
  test("Other (SMTP): host, port, username; 465 means smtps; odd passwords are encoded", () => {
    const s = buildSender({ provider: "smtp", host: "mail.example.com", port: "465", username: "me", password: "p@ss/#1", address: "me@example.com" });
    expect(s.smtpUrl).toBe("smtps://me:p%40ss%2F%231@mail.example.com:465");
    expect(describeUrl(s.smtpUrl)).toEqual({ host: "mail.example.com", port: 465, username: "me", last4: "s/#1" });
    expect(buildSender({ provider: "smtp", host: "mail.example.com", password: "x", address: "me@example.com" }).username).toBe("me@example.com");
  });
  test("a settings address is matched back to its preset", () => {
    expect(guessProvider("smtps://resend:re_x@smtp.resend.com:465")).toBe("resend");
    expect(guessProvider(PRIMARY)).toBe("smtp");
    expect(Object.keys(PRESETS)).toEqual(["resend", "gmail", "microsoft", "zoho_au", "zoho"]);
  });
});

describe("plain answers for wrong input", () => {
  const bad: [Record<string, string>, RegExp][] = [
    [{ provider: "carrier-pigeon", address: "a@b.com" }, /Choose how/],
    [{ provider: "gmail", address: "not-an-email", password: "abcdefghijklmnop" }, /address emails come from/],
    [{ provider: "gmail", address: "a@gmail.com", password: "" }, /16-letter app password/],
    [{ provider: "gmail", address: "a@gmail.com", password: "myNormalPassword1" }, /16 letters/],
    [{ provider: "resend", address: "a@b.com", password: "" }, /Resend API key/],
    [{ provider: "resend", address: "a@b.com", password: "sk_live_123456789" }, /starts with re_/],
    [{ provider: "smtp", address: "a@b.com", password: "x", host: "localhost" }, /SMTP server/],
    [{ provider: "smtp", address: "a@b.com", password: "x", host: "smtp.b.com", port: "8080" }, /587/],
    [{ provider: "smtp", address: "a@b.com", host: "smtp.b.com" }, /password/],
    [{ provider: "microsoft", address: "a@b.com" }, /password for a@b.com/],
  ];
  for (const [input, msg] of bad) {
    test(`${input.provider}: ${msg.source}`, () => {
      expect(() => buildSender(input)).toThrow(ValidationError);
      expect(() => buildSender(input)).toThrow(msg);
    });
  }

  test("a failed real login comes back as the provider's usual fix", async () => {
    setVerifier(async () => {
      throw Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"), { code: "EAUTH", responseCode: 535 });
    });
    await expect(checkSender({ provider: "gmail", address: "a@gmail.com", password: "abcdefghijklmnop" })).rejects.toThrow(/app password/);
    setVerifier(async () => {
      throw Object.assign(new Error("535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant"), { code: "EAUTH" });
    });
    await expect(checkSender({ provider: "microsoft", address: "a@biz.com", password: "x" })).rejects.toThrow(/Authenticated SMTP/);
    setVerifier(async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND smtp.nowhere.test"), { code: "EDNS" });
    });
    await expect(checkSender({ provider: "smtp", host: "smtp.nowhere.test", address: "a@b.com", password: "x" })).rejects.toThrow(/Couldn't find a mail server called smtp.nowhere.test/);
  });
  test("a good login passes and nothing is sent", async () => {
    const seen: string[] = [];
    setVerifier(async (url) => void seen.push(url));
    const s = await checkSender({ provider: "zoho_au", address: "a@biz.com.au", password: "pw" });
    expect(seen).toEqual([s.smtpUrl]);
    expect(sent).toEqual([]);
  });
  test("other errors: timeouts, refused, Zoho region, unknown", () => {
    expect(friendlySmtpError({ code: "ETIMEDOUT" }, "smtp", "h.test", 25)).toMatch(/didn't answer on port 25/);
    expect(friendlySmtpError({ code: "ECONNREFUSED" }, "smtp", "h.test", 587)).toMatch(/Couldn't connect/);
    expect(friendlySmtpError({ code: "EAUTH" }, "zoho", "smtp.zoho.com", 587)).toMatch(/region/);
    expect(friendlySmtpError({ message: "weird\nstack" }, "smtp", "h", 1)).toBe("The mail server said: weird stack.");
  });
});

// ---- failover ----

describe("main sender first, then the backup", () => {
  test("only the main is used when it works", async () => {
    expect(await sendAccountEmail("p@q.com", "Hi", "Body")).toBe(true);
    expect(sent.map((s) => s.url)).toEqual([PRIMARY]);
    expect(mem.rows).toMatchObject([{ status: "sent", via: "primary", text: "" }]);
    expect(problems).toEqual([]);
  });
  test("main down: the backup sends it with its own from address, and the failover is recorded", async () => {
    up[PRIMARY] = false;
    expect(await sendAccountEmail("p@q.com", "Hi", "Body")).toBe(true);
    expect(sent).toEqual([{ url: BACKUP, to: "p@q.com", from: "b@x.com" }]);
    expect(mem.rows[0]).toMatchObject({ status: "sent", via: "backup" });
    expect(problems.map((p) => p.kind)).toEqual(["email_failover"]);
  });
  test("no backup from address: the main one is used", () => {
    expect(routesOf({ smtpUrl: PRIMARY, from: "m@x.com", backupUrl: BACKUP })).toEqual([
      { name: "primary", url: PRIMARY, from: "m@x.com" },
      { name: "backup", url: BACKUP, from: "m@x.com" },
    ]);
  });
  test("a test of just the backup skips the main", async () => {
    const r = await deliver("p@q.com", "T", "B", "backup");
    expect(r).toEqual({ ok: true, via: "backup" });
    expect(sent.map((s) => s.url)).toEqual([BACKUP]);
  });
  test("nothing set up: printed, not queued, false so the link is shown to copy", async () => {
    config = { smtpUrl: "", from: "" };
    expect(await sendAccountEmail("p@q.com", "Reset", "https://x/reset/abc")).toBe(false);
    expect(mem.rows).toEqual([]);
  });
});

// ---- outbox ----

describe("the outbox: tried again after 1, 5, 30 and 120 minutes, then given up", () => {
  test("the schedule", () => {
    expect(RETRY_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000]);
    expect([0, 1, 2, 3, 4, 5].map(retryDelay)).toEqual([null, 60_000, 300_000, 1_800_000, 7_200_000, null]);
  });

  test("both down: queued (with the text kept), false so an invite link is still shown", async () => {
    up = {};
    expect(await sendAccountEmail("p@q.com", "Invite", "Accept: https://x/invite/t")).toBe(false);
    expect(mem.rows).toMatchObject([{ status: "pending", attempts: 1, text: "Accept: https://x/invite/t" }]);
    expect(mem.rows[0].nextAt!.getTime()).toBe(clock + 60_000);
    expect(problems.map((p) => p.kind)).toEqual(["email_failed"]);
  });

  test("not due yet: left alone; due and the main is back: sent, text forgotten", async () => {
    up = {};
    await sendAccountEmail("p@q.com", "Invite", "secret link");
    expect(await runOutbox()).toEqual({ sent: 0, retrying: 0, gaveUp: 0 });
    clock += 60_000;
    up[PRIMARY] = true;
    expect(await runOutbox()).toEqual({ sent: 1, retrying: 0, gaveUp: 0 });
    expect(mem.rows[0]).toMatchObject({ status: "sent", via: "primary", attempts: 2, text: "" });
  });

  test("still down: 5, 30, 120 minutes, then failed, with a problem and an incident for the admin", async () => {
    up = {};
    await sendAccountEmail("p@q.com", "Invite", "secret link");
    const waits: number[] = [];
    let last = clock;
    for (let i = 0; i < 10 && mem.rows[0].status === "pending"; i++) {
      clock = mem.rows[0].nextAt!.getTime();
      waits.push(clock - last);
      last = clock;
      await runOutbox();
    }
    expect(waits).toEqual([60_000, 300_000, 1_800_000, 7_200_000]);
    expect(mem.rows[0]).toMatchObject({ status: "failed", attempts: 5, text: "", nextAt: null });
    expect(problems.map((p) => p.kind)).toEqual(["email_failed", "email_failed"]);
    expect(problems[1].msg).toMatch(/Gave up on an email after 5 tries/);
    expect(incidents).toMatchObject([{ kind: "email_failed" }]);
    expect(incidents[0].message).not.toContain("p@q.com");
  });

  test("queue: false (follow-ups, tests) throws instead and is recorded as failed", async () => {
    up = {};
    await expect(sendAccountEmail("p@q.com", "Reminder", "x", { queue: false })).rejects.toThrow(/Connection refused/);
    expect(mem.rows).toMatchObject([{ status: "failed", text: "" }]);
  });
});

// ---- permissions ----

const ctx = (over: Partial<Ctx> = {}): Ctx => ({ tokenHash: "t", user: { id: "u", email: "u@x.com", name: "", platformAdmin: false }, org: { id: "o", name: "Org" }, role: "member", ...over });

describe("who may change how emails are sent", () => {
  test("packaged install (one agency): owner and admin yes, member and customer no", () => {
    expect(canManageEmail(ctx({ role: "owner" }), true)).toBe(true);
    expect(canManageEmail(ctx({ role: "admin" }), true)).toBe(true);
    expect(canManageEmail(ctx({ role: "member" }), true)).toBe(false);
    expect(canManageEmail(ctx({ role: "customer" }), true)).toBe(false);
  });
  test("shared platform: only the platform admin (it's the platform's sender)", () => {
    expect(canManageEmail(ctx({ role: "owner" }), false)).toBe(false);
    expect(canManageEmail(ctx({ user: { id: "u", email: "", name: "", platformAdmin: true } }), false)).toBe(true);
  });
  test("never while viewing as someone else", () => {
    expect(canManageEmail(ctx({ role: "owner", viewing: { org: "A", client: null, business: "" } }), true)).toBe(false);
  });
  test("the routes refuse a member with 403 before touching anything", async () => {
    const req = new Request("http://x/api/admin/email-settings/primary", { method: "PUT", body: "{}" });
    const err = await emailSettingsRoutes(req, "/api/admin/email-settings/primary", "PUT", ctx({ role: "member" })).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.status).toBe(403);
    expect(await emailSettingsRoutes(req, "/api/other", "GET", ctx())).toBeNull();
  });
});
