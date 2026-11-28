// Easy calendar booking, through the real server on a fresh database (single-agency install, local test provider):
// built-in bookings on from the start, the private calendar link, setting Google sign-in up from the dashboard
// without a restart, and moving to Google only once its sign-in has worked.
//   DATABASE_URL=postgres://... bun test server/bookingEasy.test.ts
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIcs } from "./calendarFeed";
import { isoLocal, localDate, localToEpoch } from "./booking";
import { loginProblem } from "./email";

const OWNER = "jane.smith@acme.test";
const TOKEN = "T".repeat(10) + "abcdefghijklmnopqrstuvwxyz0123456789_-";
const TZ = "Australia/Brisbane";

test("the calendar file is valid: CRLF lines of at most 75 bytes, special characters escaped", () => {
  const ics = buildIcs("Smith; Co, bookings", [{ id: "abc", start: Date.UTC(2030, 0, 2, 3, 30), end: Date.UTC(2030, 0, 2, 4, 0), title: "Check-up · " + "é".repeat(80), description: "Name: Sam\nBack\\slash" }], Date.UTC(2029, 0, 1));
  expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
  expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  const joined = ics.replace(/\r\n /g, "");
  expect(joined).toContain("X-WR-CALNAME:Smith\; Co\\, bookings");
  expect(joined).toContain("DTSTART:20300102T033000Z\r\nDTEND:20300102T040000Z");
  expect(joined).toContain("SUMMARY:Check-up · " + "é".repeat(80));
  expect(joined).toContain("DESCRIPTION:Name: Sam\\nBack\\\\slash");
  expect(joined).toContain("UID:abc@bookings\r\nDTSTAMP:20290101T000000Z");
});

test("mailbox errors say what to fix", () => {
  const bad = { authenticationFailed: true };
  expect(loginProblem(bad, "imap.gmail.com")).toContain("Wrong app password");
  expect(loginProblem(bad, "outlook.office365.com")).toContain("Sign in with Microsoft");
  expect(loginProblem(bad, "mail.example.com")).toContain("Wrong email address or app password");
  expect(loginProblem(bad, "imap.gmail.com", true)).toContain("connect again");
  expect(loginProblem({ authenticationFailed: true, responseText: "IMAP access is disabled for your domain." }, "imap.gmail.com")).toContain("IMAP is switched off");
});

type Reply = { status: number; json: any; text: string; cookie: string; headers: Headers };
async function withServer(extra: Record<string, string>, fn: (s: { call: (m: string, p: string, b?: unknown, cookie?: string, headers?: Record<string, string>) => Promise<Reply>; db: SQL }) => Promise<void>) {
  const base = process.env.DATABASE_URL ?? "";
  expect(base).not.toBe("");
  const name = `bookingeasy_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new SQL(base, { max: 1 });
  await admin.unsafe(`create database ${name}`);
  const u = new URL(base);
  u.pathname = `/${name}`;
  const port = 25100 + Math.floor(Math.random() * 1500);
  const env: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_URL: u.toString(), API_PORT: String(port), HOST: "127.0.0.1", SINGLE_AGENCY: "1", E2E_FAKE_PROVIDER: "1",
    TELNYX_API_KEY: "platform-fake-booking-test", VAPI_API_KEY: "", VAPI_PUBLIC_KEY: "", VOICE_PROVIDER: "", OWN_PHONE_ACCOUNT: "", PUBLIC_URL: "https://app.acme.test", FALLBACK_URL: "", RAILWAY_PUBLIC_DOMAIN: "",
    FIRST_ADMIN_EMAIL: OWNER, OWNER_NAME: "Jane Smith", AGENCY_NAME: "Acme Calls", FIRST_LOGIN_TOKEN: TOKEN,
    MAILBOX_KEY: Buffer.alloc(32, 7).toString("base64"), LEGACY_DATA_DIR: mkdtempSync(join(tmpdir(), "bookingeasy-")),
    SUPPORT_SYNC_URL: "", SUPPORT_SYNC_TOKEN: "", OAUTH_BROKER: "", OPENROUTER_API_KEY: "", MAILBOX_SIGNIN: "",
    GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", MICROSOFT_CLIENT_ID: "", MICROSOFT_CLIENT_SECRET: "", OAUTH_REDIRECT_BASE: "",
    ...extra,
  };
  const p = Bun.spawn(["bun", "server/index.ts"], { cwd: join(import.meta.dir, ".."), env, stdout: "pipe", stderr: "pipe" });
  let log = "";
  const pump = async (s: ReadableStream<Uint8Array>) => {
    const dec = new TextDecoder();
    for await (const chunk of s as any) log += dec.decode(chunk);
  };
  void pump(p.stdout);
  void pump(p.stderr);
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120 && p.exitCode === null; i++) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) break;
    } catch {}
    await Bun.sleep(250);
  }
  const call = async (method: string, path: string, body?: unknown, cookie = "", headers: Record<string, string> = {}): Promise<Reply> => {
    const r = await fetch(baseUrl + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: r.status, json, text, headers: r.headers, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
  };
  const db = new SQL(u.toString(), { max: 1 });
  try {
    await fn({ call, db });
  } catch (err) {
    console.log(log);
    throw err;
  } finally {
    p.kill();
    await p.exited;
    await db.close();
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.close();
  }
}

test("a new receptionist books straight away, and its calendar link follows bookings, moves and cancellations", async () => {
  await withServer({}, async ({ call, db }) => {
    const { cookie } = await call("POST", "/api/welcome", { token: TOKEN });
    const made = await call("POST", "/api/clients", { businessName: "Alpha Physio", industry: "dental", services: ["Check-up"], defaultVoice: true, timezone: TZ }, cookie);
    expect({ status: made.status, error: made.json?.error }).toEqual({ status: 201, error: undefined });
    const id = made.json.client.id as string;
    const m = `/api/manage/${id}`;

    // On from the start, nothing to set up: built-in, 30 minutes.
    const ints = (await call("GET", `${m}/integrations`, undefined, cookie)).json.integrations;
    expect(ints).toHaveLength(1);
    expect(ints[0]).toMatchObject({ provider: "builtin_calendar", status: "connected", config: { default_duration: 30, enabled: true } });
    // Asking for the built-in calendar again just applies what was sent.
    const again = await call("POST", `${m}/calendar`, { provider: "builtin", minutes: 45 }, cookie);
    expect(again.status).toBe(201);
    expect(again.json.integrations[0].config.default_duration).toBe(45);

    // The private link: the public address, no sign-in, nothing without the exact token.
    const feed = (await call("GET", `${m}/calendar/feed`, undefined, cookie)).json;
    expect(feed.allowed).toBe(true);
    expect(feed.url).toMatch(new RegExp(`^https://app\\.acme\\.test/api/calendar-feed/${id}/[A-Za-z0-9_-]{32}\\.ics$`));
    expect((await call("GET", `${m}/calendar/feed`, undefined, cookie)).json.url).toBe(feed.url);
    expect((await call("GET", `${m}/calendar/feed`)).status).toBe(401);
    const path = new URL(feed.url).pathname;
    const empty = await call("GET", path);
    expect(empty.status).toBe(200);
    expect(empty.headers.get("content-type")).toContain("text/calendar");
    expect(empty.text).not.toContain("BEGIN:VEVENT");
    const wrong = await call("GET", path.replace(/.\.ics$/, (x) => (x[0] === "A" ? "B.ics" : "A.ics")));
    expect(wrong.status).toBe(404);
    expect(wrong.text).not.toContain("VCALENDAR");
    // The raw token isn't kept in the database.
    const [row] = await db`select data from clients where id = ${id}`;
    expect(JSON.stringify(row.data)).not.toContain(path.split("/").pop()!.replace(".ics", ""));

    // Book, move and cancel through the receptionist's own tools.
    const key = row.data.booking.token as string;
    const hook = (action: string, body: unknown) => call("POST", `/hooks/${id}/${action}`, body, "", { "X-Twin-Key": key, "X-Twin-Caller": "+61412345678" });
    let date = "";
    for (let n = 2; n < 12 && !date; n++) {
      const d = localDate(Date.now() + n * 86_400_000, TZ);
      if (((await hook("availability", { date: d })).json?.slots ?? []).length > 1) date = d;
    }
    expect(date).not.toBe("");
    const slots = (await hook("availability", { date })).json.slots as { start: string }[];
    const booked = await hook("book", { name: "Sam Taylor", phone: "+61412345678", service: "Check-up", start: slots[0].start });
    expect(booked.json.booked).toBe(true);
    const ics = (s: string) => new Date(Date.parse(s)).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    let now = (await call("GET", path)).text.replace(/\r\n /g, "");
    expect(now).toContain(`DTSTART:${ics(slots[0].start)}`);
    expect(now).toContain("Sam Taylor");
    const found = (await hook("find", {})).json.bookings[0];
    const later = isoLocal(localToEpoch(date, "14:00", TZ), TZ);
    expect((await hook("reschedule", { booking_id: found.booking_id, new_start: later })).json.rescheduled).toBe(true);
    now = (await call("GET", path)).text;
    expect(now).toContain(`DTSTART:${ics(later)}`);
    expect(now).not.toContain(`DTSTART:${ics(slots[0].start)}`);
    expect(now.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect((await hook("cancel", { booking_id: found.booking_id, confirmed: "yes" })).json.cancelled).toBe(true);
    expect((await call("GET", path)).text).not.toContain("BEGIN:VEVENT");

    // A new link stops the old one; switched off, none works.
    const next = (await call("POST", `${m}/calendar/feed`, {}, cookie)).json.url as string;
    expect(next).not.toBe(feed.url);
    expect((await call("GET", path)).status).toBe(404);
    expect((await call("GET", new URL(next).pathname)).status).toBe(200);
    expect((await call("DELETE", `${m}/calendar/feed`, undefined, cookie)).json.url).toBe("");
    expect((await call("GET", new URL(next).pathname)).status).toBe(404);
    expect((await call("GET", `${m}/calendar/feed`, undefined, cookie)).json.url).toBe("");

    // ---- Google: off until the owner saves keys here; then Connect works at once ----
    expect((await call("GET", `${m}/sign-in`, undefined, cookie)).json.calendar).toEqual({ google: false, microsoft: false });
    const before = await call("GET", `${m}/calendar/signin/google?return=editor`, undefined, cookie);
    expect(decodeURIComponent(before.headers.get("location")!)).toContain("Ask your account owner to switch this on");

    // A client's own login can't see or save keys, and a view-only one gets no calendar link.
    const invite = await call("POST", `${m}/team/invites`, { email: "client@biz.test", role: "viewer" }, cookie);
    const inviteToken = String(invite.json.url).split("/invite/")[1];
    const client = await call("POST", `/api/invites/${inviteToken}`, { name: "Cli Ent", password: "client-password-12" });
    expect(client.status).toBe(200);
    expect((await call("GET", "/api/session", undefined, client.cookie)).json.serverSettings).toBeFalsy();
    const keys = { clientId: "123456789-abcdef.apps.googleusercontent.com", clientSecret: "GOCSPX-not-a-real-secret" };
    expect((await call("PUT", "/api/admin/platform-settings/google", keys, client.cookie)).status).toBe(403);
    expect((await call("GET", `${m}/calendar/feed`, undefined, client.cookie)).json).toEqual({ allowed: false, url: "" });
    expect((await call("GET", "/api/domain-link", undefined, client.cookie)).status).toBe(403);
    const domain = await call("GET", "/api/domain-link", undefined, cookie);
    expect(domain.status).toBe(400);
    expect(domain.json.error).toContain("setup link");

    expect((await call("PUT", "/api/admin/platform-settings/google", keys, cookie)).status).toBe(200);
    expect((await call("GET", `${m}/sign-in`, undefined, cookie)).json.calendar).toEqual({ google: true, microsoft: false });
    const go = await call("GET", `${m}/calendar/signin/google?return=editor`, undefined, cookie);
    const to = new URL(go.headers.get("location")!);
    expect(to.host).toBe("accounts.google.com");
    expect(to.searchParams.get("redirect_uri")).toBe("https://app.acme.test/api/oauth/google/callback");
    // Starting the sign-in changes nothing; cancelling at Google leaves the built-in calendar working.
    const back = await call("GET", `/api/oauth/google/callback?state=${to.searchParams.get("state")}&error=access_denied`);
    expect(back.headers.get("location")).toStartWith(`/admin/receptionists/${id}?tab=booking&error=`);
    expect((await call("GET", `${m}/integrations`, undefined, cookie)).json.integrations[0]).toMatchObject({ provider: "builtin_calendar", status: "connected" });
  });
}, 120_000);

test("keys from the setup wizard (environment) switch Connect on without saving anything", async () => {
  await withServer({ MICROSOFT_CLIENT_ID: "1a2b3c4d-1234-5678-9abc-1234567890ab", MICROSOFT_CLIENT_SECRET: "not-a-real-secret-value" }, async ({ call }) => {
    const { cookie } = await call("POST", "/api/welcome", { token: TOKEN });
    const id = (await call("POST", "/api/clients", { businessName: "Beta", industry: "dental", services: ["Check-up"], defaultVoice: true }, cookie)).json.client.id;
    const s = (await call("GET", `/api/manage/${id}/sign-in`, undefined, cookie)).json;
    expect(s.calendar).toEqual({ google: false, microsoft: true });
    expect(s.mail).toEqual({ google: false, microsoft: true });
    const go = await call("GET", `/api/manage/${id}/email/signin/microsoft?mode=draft&return=editor`, undefined, cookie);
    expect(new URL(go.headers.get("location")!).host).toBe("login.microsoftonline.com");
  });
}, 120_000);
