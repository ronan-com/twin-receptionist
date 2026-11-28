// The shared Google / Microsoft sign-in from the app's side (server/broker.ts and oauth.ts): off by default, the connect
// flow, refreshing through the setup site, an outage, and bring-your-own winning. The setup site is a stand-in server.
// Needs a scratch Postgres: DATABASE_URL=postgres://.../scratch_db bun test server/broker.db.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { migrate, sql } from "./db";
import { BROKER_SCOPES } from "../download-site/brokerScopes";
import { SCOPES, accessToken, claimSignIn, finishSignIn, mailSignInAvailable, oauthAvailable, startSignIn, usesSharedApp } from "./oauth";
import { brokerResetForTests, brokerStatus } from "./broker";

let ready = true;
beforeAll(async () => {
  try { await migrate(); } catch (err) { ready = false; console.warn("[broker.db.test] no database, skipping:", (err as Error).message); }
}, 60000);

// ---- a stand-in for the setup site ----
type Hit = { path: string; auth: string; body: any };
const hits: Hit[] = [];
let offered: any = { google: { calendar: true, mail: false }, microsoft: { calendar: false, mail: false } };
let refreshReply: () => Response = () => Response.json({ accessToken: "ya29.A", expiresIn: 3599 });
let site: ReturnType<typeof Bun.serve> | null = null;
const TOKEN = "st_" + "t".repeat(43);
function startSite(port = 0) {
  site = Bun.serve({
    port,
    async fetch(req) {
      const path = new URL(req.url).pathname.replace("/api/broker/", "");
      const body = req.method === "POST" ? await req.json() : null;
      hits.push({ path, auth: req.headers.get("authorization") ?? "", body });
      if (path === "status") return Response.json({ enabled: true, offered });
      if (path === "start") return Response.json({ url: `https://accounts.example/auth?state=${body.state}` });
      if (path === "redeem") return body.ticket === "good-ticket" ? Response.json({ refreshToken: "brk1.sealed", address: "owner@clinic.example" }) : Response.json({ error: "expired", message: "That sign-in took too long or was already used." }, { status: 400 });
      if (path === "refresh") return refreshReply();
      return Response.json({}, { status: 404 });
    },
  });
  process.env.SUPPORT_SYNC_URL = `http://127.0.0.1:${site.port}/api/sync`;
}
const ENV = ["OAUTH_BROKER", "SUPPORT_SYNC_URL", "SUPPORT_SYNC_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MAILBOX_SIGNIN", "PUBLIC_URL", "OAUTH_REDIRECT_BASE"];
const saved: Record<string, string | undefined> = {};
for (const k of ENV) saved[k] = process.env[k];
beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  process.env.SUPPORT_SYNC_TOKEN = TOKEN;
  process.env.PUBLIC_URL = "https://app.agency.example";
  hits.length = 0;
  brokerResetForTests();
  offered = { google: { calendar: true, mail: false }, microsoft: { calendar: false, mail: false } };
  refreshReply = () => Response.json({ accessToken: "ya29.A", expiresIn: 3599 });
  site?.stop(true);
  startSite();
});
afterAll(() => {
  site?.stop(true);
  for (const k of ENV) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
});
const sha = (s: string) => createHash("sha256").update(s).digest("base64url");

describe("the same permissions on both sides", () => {
  test("the setup site asks for exactly what this app would ask for with its own app", () => {
    expect(BROKER_SCOPES).toEqual(SCOPES);
  });
});

describe("off by default", () => {
  test("without OAUTH_BROKER nothing is offered and the setup site is never called", async () => {
    await brokerStatus();
    expect(oauthAvailable()).toEqual({ google: false, microsoft: false });
    expect(usesSharedApp("google", "calendar")).toBe(false);
    await expect(startSignIn("google", "calendar", { clientId: "c" })).rejects.toThrow("isn't switched on yet");
    expect(hits).toHaveLength(0);
  });
  test("OAUTH_BROKER=1 but the setup site doesn't offer it (or is unreachable): still off", async () => {
    process.env.OAUTH_BROKER = "1";
    offered = { google: { calendar: false, mail: false }, microsoft: { calendar: false, mail: false } };
    await brokerStatus();
    expect(oauthAvailable()).toEqual({ google: false, microsoft: false });
    site!.stop(true);
    brokerResetForTests();
    await brokerStatus();
    expect(oauthAvailable()).toEqual({ google: false, microsoft: false });
  });
});

describe("connecting through the shared app", () => {
  test("offered per provider; start hands the setup site our callback, state and PKCE challenge; finish redeems the ticket", async () => {
    if (!ready) return;
    process.env.OAUTH_BROKER = "1";
    await brokerStatus();
    expect(oauthAvailable()).toEqual({ google: true, microsoft: false });
    const url = await startSignIn("google", "calendar", { clientId: "client-1", orgId: "org-1" });
    expect(url).toStartWith("https://accounts.example/auth?state=");
    const start = hits.find((h) => h.path === "start")!;
    expect(start.auth).toBe(`Bearer ${TOKEN}`);
    expect(start.body).toMatchObject({ provider: "google", purpose: "calendar", returnUrl: "https://app.agency.example/api/oauth/google/callback" });
    const pending = (await claimSignIn("google", start.body.state))!;
    expect(pending.via).toBe("shared");
    expect(sha(pending.verifier)).toBe(start.body.challenge);
    const done = await finishSignIn(pending, "good-ticket");
    expect(done).toMatchObject({ address: "owner@clinic.example", refreshToken: "brk1.sealed", provider: "google", purpose: "calendar", clientId: "client-1" });
    expect(JSON.stringify(done)).not.toContain(pending.verifier);
    // the state is used up
    expect(await claimSignIn("google", start.body.state)).toBeNull();
    // a ticket the setup site refuses is shown to the person as a plain message
    const again = await startSignIn("google", "calendar", { clientId: "client-1" });
    const p2 = (await claimSignIn("google", new URL(again).searchParams.get("state")!))!;
    await expect(finishSignIn(p2, "stale")).rejects.toThrow("took too long");
  });
  test("a provider the setup site doesn't offer, or an unreachable one, says so", async () => {
    if (!ready) return;
    process.env.OAUTH_BROKER = "1";
    await brokerStatus();
    await expect(startSignIn("microsoft", "calendar", { clientId: "c" })).rejects.toThrow("isn't switched on yet");
    site!.stop(true);
    await expect(startSignIn("google", "calendar", { clientId: "c" })).rejects.toThrow("isn't reachable");
    expect((await sql`select count(*)::int as n from oauth_states where data->>'via' = 'shared'`)[0].n).toBe(0);
  });
  test("Gmail needs the setup site to offer it AND MAILBOX_SIGNIN to allow Google", async () => {
    process.env.OAUTH_BROKER = "1";
    offered = { google: { calendar: true, mail: true }, microsoft: { calendar: true, mail: true } };
    await brokerStatus();
    expect(await mailSignInAvailable()).toEqual({ google: false, microsoft: true });
    process.env.MAILBOX_SIGNIN = "both";
    expect(await mailSignInAvailable()).toEqual({ google: true, microsoft: true });
    offered = { google: { calendar: true, mail: false }, microsoft: { calendar: true, mail: true } };
    brokerResetForTests();
    expect(await mailSignInAvailable()).toEqual({ google: false, microsoft: true });
  });
  test("an app of the agency's own wins: that provider doesn't touch the setup site", async () => {
    if (!ready) return;
    process.env.OAUTH_BROKER = "1";
    process.env.GOOGLE_CLIENT_ID = "own-id";
    process.env.GOOGLE_CLIENT_SECRET = "own-secret";
    await brokerStatus();
    expect(usesSharedApp("google", "calendar")).toBe(false);
    const url = await startSignIn("google", "calendar", { clientId: "c" });
    expect(url).toStartWith("https://accounts.google.com/o/oauth2/v2/auth?");
    expect(new URL(url).searchParams.get("client_id")).toBe("own-id");
    expect(hits.some((h) => h.path === "start")).toBe(false);
  });
});

describe("refreshing", () => {
  const tok = () => `brk1.${Math.random()}`;
  test("a shared connection's token is refreshed by the setup site, kept for most of an hour, and a rotated one is saved", async () => {
    process.env.OAUTH_BROKER = "1";
    const t = tok();
    let rotated = "";
    expect(await accessToken("google", "calendar", t, (n) => (rotated = n))).toBe("ya29.A");
    expect(hits.at(-1)).toMatchObject({ path: "refresh", auth: `Bearer ${TOKEN}`, body: { provider: "google", purpose: "calendar", refreshToken: t } });
    const n = hits.length;
    expect(await accessToken("google", "calendar", t, () => {})).toBe("ya29.A");
    expect(hits).toHaveLength(n); // from memory
    expect(rotated).toBe("");
    const t2 = tok();
    refreshReply = () => Response.json({ accessToken: "ya29.B", expiresIn: 3599, refreshToken: "brk1.next" });
    expect(await accessToken("microsoft", "mail", t2, (x) => (rotated = x))).toBe("ya29.B");
    expect(rotated).toBe("brk1.next");
  });
  test("access taken away: asks the person to connect again", async () => {
    process.env.OAUTH_BROKER = "1";
    refreshReply = () => Response.json({ error: "invalid_grant", message: "Token has been expired or revoked." }, { status: 400 });
    await expect(accessToken("google", "calendar", tok(), () => {})).rejects.toThrow("Connect it again");
  });
  test("setup site down or erring: a temporary pause, never 'connect again'", async () => {
    process.env.OAUTH_BROKER = "1";
    refreshReply = () => Response.json({ error: "unavailable" }, { status: 502 });
    const err = await accessToken("google", "calendar", tok(), () => {}).catch((e) => e as Error) as Error;
    expect(err.message).toContain("temporarily unreachable");
    expect(err.message).not.toContain("Connect it again");
    expect(hits.filter((h) => h.path === "refresh")).toHaveLength(2); // one retry
    site!.stop(true);
    const down = await accessToken("google", "calendar", tok(), () => {}).catch((e) => e as Error) as Error;
    expect(down.message).toContain("temporarily unreachable");
  }, 15000);
  test("switched off after connecting: says to connect again rather than guessing", async () => {
    const err = await accessToken("google", "calendar", tok(), () => {}).catch((e) => e as Error) as Error;
    expect(err.message).toContain("Connect it again");
  });
});
