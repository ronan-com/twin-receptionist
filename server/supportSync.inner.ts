// The checks for supportSync.test.ts. They run in their own bun process against a database of their own
// (made and dropped by that file), so they never touch the dev database.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { blankSettings, type Business } from "../src/lib/shared";
import { AuthError, hashToken, resetPassword, sessionFrom, type Ctx } from "./accounts";
import { migrate, sql } from "./db";
import { insertClient } from "./store";
import { ACCESS_KEY, SYNC_KEY, accessOpen, syncAllowed } from "./supportAccess";
import {
  SHAPE,
  SUPPORT_EMAIL,
  SupportRefused,
  assertWhitelisted,
  buildSnapshot,
  cleanSnapshot,
  issueLoginLink,
  redeemLoginLink,
  sendHeartbeat,
  supportPublicRoutes,
  supportSettingsRoute,
  tokenOk,
} from "./supportSync";

const TOKEN = "st_test_token_0123456789abcdef0123456789";
const CALL = "sc_test_token_0123456789abcdef0123456789";
const orgId = crypto.randomUUID();
const ownerId = crypto.randomUUID();
const clientId = crypto.randomUUID();
const saved: Record<string, string | undefined> = {};
for (const k of ["SUPPORT_SYNC_URL", "SUPPORT_SYNC_TOKEN", "SUPPORT_CALL_TOKEN", "SUPPORT_SELLER_NAME", "SINGLE_AGENCY", "PUBLIC_URL"]) saved[k] = process.env[k];
let setting: Record<string, any> = {};

const req = (path: string, init: RequestInit = {}) => new Request(`https://app.example.com${path}`, init);
const bearer = (t = CALL) => ({ authorization: `Bearer ${t}` });
const post = (path: string, headers: Record<string, string> = {}) => req(path, { method: "POST", headers });
const putSettings = (body: unknown) => req("/api/support/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const owner = (over: Partial<Ctx> = {}): Ctx => ({ tokenHash: "x", user: { id: ownerId, email: "owner@example.com", name: "Owner", platformAdmin: false }, org: { id: orgId, name: "Test Agency" }, role: "owner", ...over });
const setAccess = (v: unknown) => sql`insert into app_settings (key, value) values (${ACCESS_KEY}, ${v as any}) on conflict (key) do update set value = excluded.value`;
const setSync = (v: unknown) => sql`insert into app_settings (key, value) values (${SYNC_KEY}, ${v as any}) on conflict (key) do update set value = excluded.value`;
const auditActions = async () => (await sql`select action from audit_log where org_id = ${orgId} order by created_at`).map((r: any) => r.action as string);
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

beforeAll(async () => {
  process.env.SUPPORT_SYNC_URL = "http://127.0.0.1:9/api/sync";
  process.env.SUPPORT_SYNC_TOKEN = TOKEN;
  process.env.SUPPORT_CALL_TOKEN = CALL;
  process.env.SUPPORT_SELLER_NAME = "Acme Setups";
  process.env.SINGLE_AGENCY = "1";
  process.env.PUBLIC_URL = "https://app.example.com";
  await migrate();
  for (const key of [ACCESS_KEY, SYNC_KEY]) {
    const [r] = await sql`select value from app_settings where key = ${key}`;
    setting[key] = r?.value ?? null;
  }
  // Oldest org, so it is the one a single-agency copy would use.
  await sql`insert into orgs (id, name, created_at) values (${orgId}, 'Test Agency', '1970-01-01')`;
  await sql`insert into users (id, email, name, password_hash) values (${ownerId}, ${`owner-${ownerId}@example.com`}, 'Owner', 'x')`;
  await sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${ownerId}, 'owner')`;
  const now = new Date().toISOString();
  const biz: Business = { id: clientId, assistantId: "asst-1", settings: { ...blankSettings(), businessName: "Secret Plumbing" }, instructions: "", phoneNumbers: ["+61299990000"], createdAt: now, updatedAt: now };
  await insertClient(orgId, biz);
  await sql`insert into call_log (org_id, client_id, provider_call_id, channel, from_number, started_at, summary)
    values (${orgId}, ${clientId}, ${`test-${clientId}`}, 'call', '+61412345678', now() - interval '1 hour', 'Jane Citizen wants her tax records, secret transcript')`;
}, 120_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await sql`delete from sessions where support`.catch(() => {});
  await sql`delete from users where email = ${SUPPORT_EMAIL}`.catch(() => {});
  await sql`delete from support_login_links`.catch(() => {});
  await sql`delete from clients where org_id = ${orgId}`.catch(() => {});
  await sql`delete from orgs where id = ${orgId}`.catch(() => {});
  await sql`delete from users where id = ${ownerId}`.catch(() => {});
  for (const key of [ACCESS_KEY, SYNC_KEY]) {
    if (setting[key] === null) await sql`delete from app_settings where key = ${key}`.catch(() => {});
    else await sql`insert into app_settings (key, value) values (${key}, ${setting[key]}) on conflict (key) do update set value = excluded.value`.catch(() => {});
  }
});

beforeEach(async () => {
  await sql`delete from app_settings where key in (${ACCESS_KEY}, ${SYNC_KEY})`;
  await sql`delete from sessions where support`;
  await sql`delete from support_login_links`;
  await sql`delete from audit_log where org_id = ${orgId}`;
});

describe("settings logic", () => {
  test("sharing is on unless switched off; access is off unless granted and unexpired", () => {
    expect(syncAllowed(null)).toBe(true);
    expect(syncAllowed({ enabled: false })).toBe(false);
    expect(accessOpen(null)).toBe(false);
    expect(accessOpen({ enabled: true, until: null })).toBe(true);
    expect(accessOpen({ enabled: true, until: new Date(Date.now() + 60_000).toISOString() })).toBe(true);
    expect(accessOpen({ enabled: true, until: new Date(Date.now() - 1000).toISOString() })).toBe(false);
    expect(accessOpen({ enabled: false, until: null })).toBe(false);
  });
});

describe("token auth", () => {
  test("only the shared token gets in", () => {
    expect(tokenOk(post("/x", bearer()))).toBe(true);
    expect(tokenOk(post("/x", bearer("st_wrong_token_0123456789abcdef0123456789")))).toBe(false);
    expect(tokenOk(post("/x"))).toBe(false);
    expect(tokenOk(post("/x", { authorization: CALL }))).toBe(false); // needs "Bearer"
    expect(tokenOk(post("/x", bearer("")))).toBe(false);
    // The token the app sends OUT can't be used to call IN.
    expect(tokenOk(post("/x", bearer(TOKEN)))).toBe(false);
  });

  test("a copy without the settings never accepts a token", () => {
    const t = process.env.SUPPORT_CALL_TOKEN;
    process.env.SUPPORT_CALL_TOKEN = "";
    try {
      expect(tokenOk(post("/x", bearer("")))).toBe(false);
      expect(tokenOk(post("/x", bearer(CALL)))).toBe(false);
    } finally {
      process.env.SUPPORT_CALL_TOKEN = t;
    }
  });

  test("the routes refuse a wrong or missing token and say nothing about the app", async () => {
    for (const path of ["/api/support/ping", "/api/support/login-link"]) {
      expect((await supportPublicRoutes(post(path), path, "POST"))!.status).toBe(401);
      expect((await supportPublicRoutes(post(path, bearer("st_wrong_token_0123456789abcdef0123456789")), path, "POST"))!.status).toBe(401);
    }
    const get = await supportPublicRoutes(req("/api/support/ping"), "/api/support/ping", "GET");
    expect(get!.status).toBe(404);
  });
});

describe("what is sent", () => {
  test("the snapshot has only whitelisted fields and no personal details", async () => {
    const snap = await buildSnapshot();
    expect(() => assertWhitelisted(snap)).not.toThrow();
    expect(snap.v).toBe(1);
    expect(snap.publicUrl).toBe("https://app.example.com");
    expect(snap.counts.calls24h).toBeGreaterThanOrEqual(1);
    expect(snap.counts.numbers).toBeGreaterThanOrEqual(1);
    const text = JSON.stringify(snap);
    for (const secret of ["+61412345678", "61412345678", "Jane Citizen", "secret transcript", "Secret Plumbing", "+61299990000", TOKEN, "owner@example.com"]) expect(text).not.toContain(secret);
    expect(Object.keys(snap).sort()).toEqual(Object.keys(SHAPE).sort());
  });

  test("anything outside the whitelist is dropped, and personal details in text are blanked", () => {
    const dirty: any = {
      v: 1, sentAt: new Date().toISOString(), appVersion: "1.2.3", publicUrl: "https://a.example.com",
      callerName: "Jane", transcript: "hello", apiKey: "KEY123",
      health: { ok: true, db: true, phoneKey: true, openIncidents: 0, lastError: "stack trace" },
      counts: { calls7d: 4, from_number: "+61412345678" },
      brand: { name: "Call me on 0412 345 678", logoUrl: "https://a.example.com/brand/x" },
      extras: { email: true, domain: false, openRouter: true, smtpUrl: "smtps://u:p@h" },
      support: { sharing: true, access: false, accessUntil: null },
      lastCallAt: "2026-01-01T00:00:00.000Z",
    };
    const clean = cleanSnapshot(dirty)!;
    expect(() => assertWhitelisted(clean)).not.toThrow();
    const text = JSON.stringify(clean);
    for (const x of ["Jane", "hello", "KEY123", "stack trace", "from_number", "+61412345678", "0412 345 678", "smtps"]) expect(text).not.toContain(x);
    expect(clean.counts.calls7d).toBe(4);
    expect(clean.brand.name).toBe("");
    expect(cleanSnapshot({ v: 2 })).toBeNull();
    expect(cleanSnapshot("nope")).toBeNull();
  });

  test("the whitelist check itself catches a leaking field", () => {
    const ok = { ...cleanSnapshot({ v: 1 })! };
    expect(() => assertWhitelisted({ ...ok, callerName: "x" })).toThrow(/whitelist/);
    expect(() => assertWhitelisted({ ...ok, counts: { ...ok.counts, caller: 1 } })).toThrow(/whitelist/);
    expect(() => assertWhitelisted({ ...ok, brand: { name: "a@b.com", logoUrl: "" } })).toThrow(/personal/);
    expect(() => assertWhitelisted({ ...ok, brand: { name: "+61 412 345 678", logoUrl: "" } })).toThrow(/personal/);
  });
});

describe("the heartbeat and its off switch", () => {
  test("on by default: one POST with the bearer token and a whitelisted body", async () => {
    const calls: { url: string; init: any }[] = [];
    const fake = (async (url: any, init: any) => (calls.push({ url: String(url), init }), new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    const r = await sendHeartbeat(fake);
    expect(r.sent).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:9/api/sync");
    expect(calls[0].init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(() => assertWhitelisted(JSON.parse(calls[0].init.body))).not.toThrow();
  });

  test("switched off: nothing is sent, at all", async () => {
    let n = 0;
    const fake = (async () => (n++, new Response("{}"))) as unknown as typeof fetch;
    await setSync({ enabled: false });
    expect(await sendHeartbeat(fake)).toEqual({ sent: false, reason: "off" });
    expect(n).toBe(0);
    await setSync({ enabled: true });
    expect((await sendHeartbeat(fake)).sent).toBe(true);
    expect(n).toBe(1);
  });

  test("switching off through Settings stops it, and is audited", async () => {
    let n = 0;
    const fake = (async () => (n++, new Response("{}"))) as unknown as typeof fetch;
    const res = await supportSettingsRoute(putSettings({ sync: false }), "PUT", owner());
    expect(((await res.json()) as any).sync.enabled).toBe(false);
    expect((await sendHeartbeat(fake)).sent).toBe(false);
    expect(n).toBe(0);
    expect(await auditActions()).toContain("support.sharing_off");
  });

  test("a copy with no sync settings sends nothing", async () => {
    const u = process.env.SUPPORT_SYNC_URL;
    process.env.SUPPORT_SYNC_URL = "";
    try {
      let n = 0;
      const fake = (async () => (n++, new Response("{}"))) as unknown as typeof fetch;
      expect(await sendHeartbeat(fake)).toEqual({ sent: false, reason: "not-configured" });
      expect(n).toBe(0);
    } finally {
      process.env.SUPPORT_SYNC_URL = u;
    }
  });

  test("Sync now (ping) answers with the snapshot, or says sharing is off", async () => {
    const on = await supportPublicRoutes(post("/api/support/ping", bearer()), "/api/support/ping", "POST");
    const body = (await on!.json()) as any;
    expect(body.sharing).toBe(true);
    expect(() => assertWhitelisted(body.snapshot)).not.toThrow();
    await setSync({ enabled: false });
    const off = (await (await supportPublicRoutes(post("/api/support/ping", bearer()), "/api/support/ping", "POST"))!.json()) as any;
    expect(off).toEqual({ ok: true, sharing: false });
  });
});

describe("Support access", () => {
  test("off by default: a sign-in link is refused and the refusal is audited", async () => {
    await expect(issueLoginLink("https://app.example.com")).rejects.toBeInstanceOf(SupportRefused);
    const res = await supportPublicRoutes(post("/api/support/login-link", bearer()), "/api/support/login-link", "POST");
    expect(res!.status).toBe(403);
    expect(((await res!.json()) as any).error).toBe("access_off");
    expect(await auditActions()).toContain("support.link_refused");
    expect(await auditActions()).not.toContain("support.link_issued");
  });

  test("only the owner can turn it on; not an admin, not while viewing", async () => {
    await expect(supportSettingsRoute(putSettings({ access: { enabled: true } }), "PUT", owner({ role: "admin" }))).rejects.toBeInstanceOf(AuthError);
    await expect(supportSettingsRoute(putSettings({ access: { enabled: true } }), "PUT", owner({ viewing: { org: "x", client: null, business: "", support: true } }))).rejects.toBeInstanceOf(AuthError);
    expect(accessOpen((await sql`select value from app_settings where key = ${ACCESS_KEY}`)[0]?.value)).toBe(false);
  });

  test("granting it is audited and can expire", async () => {
    await supportSettingsRoute(putSettings({ access: { enabled: true, for: "24h" } }), "PUT", owner());
    const [r] = await sql`select value from app_settings where key = ${ACCESS_KEY}`;
    expect(r.value.enabled).toBe(true);
    const hours = (Date.parse(r.value.until) - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
    expect(await auditActions()).toContain("support.access_granted");
    await expect(supportSettingsRoute(putSettings({ access: { enabled: true, for: "forever-ish" } }), "PUT", owner())).rejects.toThrow();
  });

  test("a link works once, signs in as a read-only support person, and is audited", async () => {
    await setAccess({ enabled: true, until: null });
    const r = await supportPublicRoutes(post("/api/support/login-link", bearer()), "/api/support/login-link", "POST");
    const { url, expiresInSeconds } = (await r!.json()) as any;
    expect(expiresInSeconds).toBe(60);
    const path = new URL(url).pathname;
    expect(path).toMatch(/^\/api\/support\/in\/[A-Za-z0-9_-]{43}$/);

    const first = await supportPublicRoutes(req(path), path, "GET");
    expect(first!.status).toBe(302);
    expect(first!.headers.get("location")).toBe("/admin");
    const cookie = cookieOf(first!);
    expect(cookie).toMatch(/^twin_sid=/);

    const ctx = await sessionFrom(req("/api/session", { headers: { cookie } }));
    expect(ctx?.viewing?.support).toBe(true);
    expect(ctx?.viewing?.by).toBe("Acme Setups");
    expect(ctx?.org?.id).toBe(orgId);
    expect(ctx?.role).toBe("admin");
    expect(ctx?.user.platformAdmin).toBe(false);
    expect(ctx?.user.email).toBe(SUPPORT_EMAIL);

    // Second use of the same link: refused.
    const second = await supportPublicRoutes(req(path), path, "GET");
    expect(second!.status).toBe(410);
    expect(second!.headers.get("set-cookie")).toBeNull();

    const actions = await auditActions();
    expect(actions).toEqual(expect.arrayContaining(["support.link_issued", "support.signin"]));
    expect(actions.filter((a: string) => a === "support.signin")).toHaveLength(1);
  });

  test("a link runs out after 60 seconds", async () => {
    await setAccess({ enabled: true, until: null });
    const { url } = await issueLoginLink("https://app.example.com");
    const token = url.split("/").pop()!;
    await sql`update support_login_links set expires_at = now() - interval '1 second' where token_hash = ${hashToken(token)}`;
    expect(await redeemLoginLink(token)).toBeNull();
    // ...and a guessed one never worked.
    expect(await redeemLoginLink("A".repeat(43))).toBeNull();
    const [{ n }] = await sql`select count(*)::int as n from sessions where support`;
    expect(n).toBe(0);
  });

  test("turning access off after a link was made refuses it; turning it off ends open sessions", async () => {
    await setAccess({ enabled: true, until: null });
    const a = (await issueLoginLink("https://app.example.com")).url.split("/").pop()!;
    await setAccess({ enabled: false, until: null });
    expect(await redeemLoginLink(a)).toBeNull();

    await setAccess({ enabled: true, until: null });
    const b = (await issueLoginLink("https://app.example.com")).url.split("/").pop()!;
    const session = (await redeemLoginLink(b))!;
    const cookie = `twin_sid=${session}`;
    expect(await sessionFrom(req("/", { headers: { cookie } }))).not.toBeNull();
    await supportSettingsRoute(putSettings({ access: { enabled: false } }), "PUT", owner());
    expect(await sessionFrom(req("/", { headers: { cookie } }))).toBeNull();
    expect(await auditActions()).toContain("support.access_revoked");
  });

  test("an expired grant ends the session on its next request", async () => {
    await setAccess({ enabled: true, until: new Date(Date.now() + 60_000).toISOString() });
    const t = (await issueLoginLink("https://app.example.com")).url.split("/").pop()!;
    const cookie = `twin_sid=${(await redeemLoginLink(t))!}`;
    expect(await sessionFrom(req("/", { headers: { cookie } }))).not.toBeNull();
    await setAccess({ enabled: true, until: new Date(Date.now() - 1000).toISOString() });
    expect(await sessionFrom(req("/", { headers: { cookie } }))).toBeNull();
  });

  test("the client picker: the businesses list needs access on; a link with a business id opens straight into that business", async () => {
    await setAccess({ enabled: false, until: null });
    const off = await supportPublicRoutes(post("/api/support/clients", bearer()), "/api/support/clients", "POST");
    expect(off!.status).toBe(403);
    expect(((await supportPublicRoutes(post("/api/support/clients"), "/api/support/clients", "POST"))!).status).toBe(401);
    await setAccess({ enabled: true, until: null });
    const ok = await (await supportPublicRoutes(post("/api/support/clients", bearer()), "/api/support/clients", "POST"))!.json() as any;
    expect(ok.clients).toEqual([{ id: clientId, name: "Secret Plumbing" }]);
    expect(JSON.stringify(ok)).not.toContain("Jane Citizen");
    const t = (await issueLoginLink("https://app.example.com")).url.split("/").pop()!;
    const res = (await supportPublicRoutes(req(`/api/support/in/${t}?c=${clientId}`), `/api/support/in/${t}`, "GET"))!;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/app");
    const ctx = await sessionFrom(req("/", { headers: { cookie: cookieOf(res) } }));
    expect(ctx?.viewing?.client).toBe(clientId);
    expect(ctx?.role).toBe("customer");
    // A business id from somewhere else is ignored: the agency console, as before.
    const t2 = (await issueLoginLink("https://app.example.com")).url.split("/").pop()!;
    const res2 = (await supportPublicRoutes(req(`/api/support/in/${t2}?c=${crypto.randomUUID()}`), `/api/support/in/${t2}`, "GET"))!;
    expect((await sessionFrom(req("/", { headers: { cookie: cookieOf(res2) } })))?.viewing?.client).toBeNull();
  });

  test("the support person can't sign in with a password", async () => {
    await setAccess({ enabled: true, until: null });
    await redeemLoginLink((await issueLoginLink("https://app.example.com")).url.split("/").pop()!);
    const { signIn } = await import("./accounts");
    await expect(signIn({ email: SUPPORT_EMAIL, password: "anything at all" })).rejects.toBeInstanceOf(AuthError);
  });
});

describe("Owner reset via the setup link", () => {
  const PATH = "/api/support/owner-reset-link";
  const call = (h: Record<string, string> = bearer()) => supportPublicRoutes(post(PATH, h), PATH, "POST");
  const tokenOf = (url: string) => url.split("/").pop()!;

  beforeEach(async () => {
    // Off, to show the owner reset doesn't need Support access.
    await setAccess({ enabled: false, until: null });
    await sql`delete from password_resets where user_id = ${ownerId}`;
  });

  test("needs the call token (the sync token and no token are refused)", async () => {
    expect((await call({}))!.status).toBe(401);
    expect((await call(bearer(TOKEN)))!.status).toBe(401);
    expect((await call(bearer("sc_wrong_token_0123456789abcdef0123456789")))!.status).toBe(401);
    expect((await supportPublicRoutes(req(PATH), PATH, "GET"))!.status).toBe(404);
  });

  test("works with Support access off, is for the owner only, and is audited", async () => {
    const before = (await auditActions()).filter((a: string) => a === "support.owner_reset").length;
    const res = await call();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.expiresInMinutes).toBe(15);
    expect(new URL(body.url).pathname).toMatch(/^\/reset\/[A-Za-z0-9_-]{20,100}$/);
    const [r] = await sql`select user_id, expires_at from password_resets where token_hash = ${hashToken(tokenOf(body.url))}`;
    expect(r.user_id).toBe(ownerId);
    const mins = (new Date(r.expires_at).getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(14);
    expect(mins).toBeLessThan(15.1);
    const rows = await sql`select detail from audit_log where org_id = ${orgId} and action = 'support.owner_reset'`;
    expect(rows.length).toBe(before + 1);
    expect(String(rows[rows.length - 1].detail.summary)).toBe("Owner password reset via setup link");
  });

  test("never picks another user, even if one is an admin", async () => {
    const adminId = crypto.randomUUID();
    await sql`insert into users (id, email, name, password_hash) values (${adminId}, ${`admin-${adminId}@example.com`}, 'Admin', 'x')`;
    await sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${adminId}, 'admin')`;
    try {
      const body = (await (await call())!.json()) as any;
      const [r] = await sql`select user_id from password_resets where token_hash = ${hashToken(tokenOf(body.url))}`;
      expect(r.user_id).toBe(ownerId);
      expect((await sql`select 1 from password_resets where user_id = ${adminId}`).length).toBe(0);
    } finally {
      await sql`delete from users where id = ${adminId}`;
    }
  });

  test("the link works once: it sets the password, then is spent", async () => {
    const body = (await (await call())!.json()) as any;
    const t = tokenOf(body.url);
    expect(await resetPassword(t, { password: "a-brand-new-password-1" })).toBeTruthy();
    const [u] = await sql`select password_hash from users where id = ${ownerId}`;
    expect(await Bun.password.verify("a-brand-new-password-1", u.password_hash)).toBe(true);
    await expect(resetPassword(t, { password: "another-new-password-2" })).rejects.toThrow(/expired/);
  });

  test("a new link replaces the old one, and an expired one is refused", async () => {
    const a = tokenOf(((await (await call())!.json()) as any).url);
    const b = tokenOf(((await (await call())!.json()) as any).url);
    await expect(resetPassword(a, { password: "a-brand-new-password-1" })).rejects.toThrow(/expired/);
    await sql`update password_resets set expires_at = now() - interval '1 minute' where token_hash = ${hashToken(b)}`;
    await expect(resetPassword(b, { password: "a-brand-new-password-1" })).rejects.toThrow(/expired/);
  });

  test("a copy that isn't single-agency refuses", async () => {
    const was = process.env.SINGLE_AGENCY;
    process.env.SINGLE_AGENCY = "";
    try {
      expect((await call())!.status).toBe(404);
    } finally {
      process.env.SINGLE_AGENCY = was;
    }
  });

  test("rate-limited after 5 in ten minutes", async () => {
    let last = 200;
    for (let i = 0; i < 8 && last === 200; i++) last = (await call())!.status;
    expect(last).toBe(429);
  });
});
