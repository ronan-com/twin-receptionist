// The checks for broker.test.ts: the shared Google / Microsoft sign-in on the setup site, against a fake Google.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "broker-test-"));
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.SITE_URL = "https://setup.example.com";
for (const k of ["OAUTH_BROKER", "BROKER_GOOGLE_MAIL", "BROKER_URL", "MOCK_OAUTH"]) delete process.env[k];

// ---- a fake Google: authorize is never visited (the test reads the address), token checks the secret and PKCE ----
let issued = 0;
let behaviour: "ok" | "revoked" | "500" | "rotate" = "ok";
const seen: URLSearchParams[] = [];
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;
const google = Bun.serve({
  port: 0,
  async fetch(req) {
    const form = new URLSearchParams(await req.text());
    seen.push(form);
    if (form.get("client_id") !== "gid" || form.get("client_secret") !== "gsecret") return Response.json({ error: "invalid_client" }, { status: 401 });
    if (form.get("grant_type") === "authorization_code") {
      if (form.get("code") !== "google-code") return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ access_token: "ya29.first", expires_in: 3599, refresh_token: `1//real-refresh-${++issued}`, id_token: idToken("Owner@Clinic.example") });
    }
    if (behaviour === "revoked") return Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 });
    if (behaviour === "500") return Response.json({ error: "backend_error" }, { status: 500 });
    return Response.json({ access_token: `ya29.refreshed-${form.get("refresh_token")}`, expires_in: 3599, ...(behaviour === "rotate" ? { refresh_token: "1//rotated" } : {}) });
  },
});
const G = `http://127.0.0.1:${google.port}`;

const { addBuyer } = await import("../lib");
const { newSyncToken } = await import("../sync");
const broker = await import("../broker");
const { BROKER_SCOPES } = await import("../brokerScopes");

const turnOn = () => {
  process.env.OAUTH_BROKER = "1";
  process.env.GOOGLE_BROKER_CLIENT_ID = "gid";
  process.env.GOOGLE_BROKER_CLIENT_SECRET = "gsecret";
  process.env.BROKER_GOOGLE_AUTH_URL = `${G}/auth`;
  process.env.BROKER_GOOGLE_TOKEN_URL = `${G}/token`;
};
type Allow = (key: string, max: number, windowMs: number) => number;
const open: Allow = () => 0; // no rate limit
const b64 = (b: Buffer) => b.toString("base64url");
const sha = (s: string) => b64(createHash("sha256").update(s).digest());
const RET = "https://app.agency.example/api/oauth/google/callback";
const A = "A".repeat(43);

const call = async (path: string, token: string | null, body?: unknown, method = "POST", allow: Allow = open) =>
  broker.brokerApi(new Request(`https://setup.example.com${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) }), new URL(`https://setup.example.com${path}`), "1.2.3.4", allow);
const j = async (r: Response | null) => (await r!.json()) as any;

let t1 = "", t2 = "", b1 = 0, b2 = 0;
beforeAll(() => {
  b1 = addBuyer("Agency One", "one@example.com").id; t1 = newSyncToken(b1).token;
  b2 = addBuyer("Agency Two", "two@example.com").id; t2 = newSyncToken(b2).token;
});
afterAll(() => google.stop(true));

/** Runs a whole sign-in as an app would. Returns what the app ends up holding. */
async function signIn(token: string, verifier = "v".repeat(43), purpose = "calendar", appState = "S".repeat(30)) {
  const s = await call("/api/broker/start", token, { provider: "google", purpose, returnUrl: RET, state: appState, challenge: sha(verifier) });
  const sj = await j(s);
  expect(s!.status).toBe(200);
  const auth = new URL(sj.url);
  expect(`${auth.origin}${auth.pathname}`).toBe(`${G}/auth`);
  const cb = await call(`/oauth/broker/google/callback?code=google-code&state=${auth.searchParams.get("state")}`, null, undefined, "GET");
  expect(cb!.status).toBe(302);
  const back = new URL(cb!.headers.get("location")!);
  return { auth, back, verifier };
}

describe("off by default", () => {
  test("every route answers 404 and nothing is created", async () => {
    expect(brokerOffers()).toEqual(false);
    for (const [p, m] of [["/api/broker/status", "GET"], ["/api/broker/start", "POST"], ["/api/broker/refresh", "POST"], ["/oauth/broker/google/callback?state=x", "GET"]] as const) {
      expect((await call(p, t1, {}, m))!.status).toBe(404);
    }
    expect(await call("/api/sync", t1)).toBeNull();
  });
  function brokerOffers() { return broker.brokerOn(); }
  test("on, but with no Google app configured, nothing is offered", async () => {
    process.env.OAUTH_BROKER = "1";
    expect((await j(await call("/api/broker/status", t1, undefined, "GET"))).offered.google).toEqual({ calendar: false, mail: false });
    delete process.env.OAUTH_BROKER;
  });
});

describe("who may ask", () => {
  test("an app needs its sync token; wrong tokens are counted and eventually refused", async () => {
    turnOn();
    expect((await call("/api/broker/start", null, {}))!.status).toBe(401);
    expect((await call("/api/broker/start", "st_" + "x".repeat(43), {}))!.status).toBe(401);
    expect((await call("/api/broker/start", t1, {}, "POST", () => 0))!.status).toBe(400);
    expect((await call("/api/broker/start", t1, {}, "POST", () => 30))!.status).toBe(429);
    expect((await call("/api/broker/start", "nope", {}, "POST", () => 30))!.status).toBe(429);
  });
  test("status says what is offered: calendars yes, Gmail only with its own switch", async () => {
    expect((await j(await call("/api/broker/status", t1, undefined, "GET"))).offered).toEqual({ google: { calendar: true, mail: false }, microsoft: { calendar: false, mail: false } });
    process.env.BROKER_GOOGLE_MAIL = "1";
    expect((await j(await call("/api/broker/status", t1, undefined, "GET"))).offered.google.mail).toBe(true);
    delete process.env.BROKER_GOOGLE_MAIL;
  });
});

describe("connecting", () => {
  test("start: address uses our app, our redirect, the right scopes and its own PKCE", async () => {
    const { auth } = await signIn(t1);
    expect(auth.searchParams.get("client_id")).toBe("gid");
    expect(auth.searchParams.get("redirect_uri")).toBe("https://setup.example.com/oauth/broker/google/callback");
    expect(auth.searchParams.get("scope")).toBe(BROKER_SCOPES.google.calendar);
    expect(auth.searchParams.get("access_type")).toBe("offline");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("state")).not.toBe("S".repeat(30));
  });
  test("BROKER_URL moves the redirect address to the owner's own domain", async () => {
    process.env.BROKER_URL = "https://connect.owner.example/";
    expect(broker.brokerRedirectUri("google")).toBe("https://connect.owner.example/oauth/broker/google/callback");
    delete process.env.BROKER_URL;
  });
  test("the whole trip: ticket on return, redeemed once, only by the app that started it", async () => {
    seen.length = 0;
    const { back, verifier, auth } = await signIn(t1);
    expect(`${back.origin}${back.pathname}`).toBe(RET);
    expect(back.searchParams.get("state")).toBe("S".repeat(30));
    const ticket = back.searchParams.get("code")!;
    // our PKCE verifier went to Google and matches the challenge Google was sent; our secret never left
    const exchange = seen[0];
    expect(sha(exchange.get("code_verifier")!)).toBe(auth.searchParams.get("code_challenge")!);
    expect(back.toString()).not.toContain("real-refresh");
    // another agency, or the wrong verifier, gets nothing, and spends the ticket
    expect((await call("/api/broker/redeem", t2, { ticket, verifier }))!.status).toBe(400);
    expect((await call("/api/broker/redeem", t1, { ticket, verifier }))!.status).toBe(400);
    // a second ticket: wrong verifier first
    const again = await signIn(t1, "w".repeat(43));
    const t = again.back.searchParams.get("code")!;
    expect((await call("/api/broker/redeem", t1, { ticket: t, verifier: "x".repeat(43) }))!.status).toBe(400);
    expect((await call("/api/broker/redeem", t1, { ticket: t, verifier: "w".repeat(43) }))!.status).toBe(400);
    // a third: the right way
    const ok = await signIn(t1, "z".repeat(43));
    const r = await call("/api/broker/redeem", t1, { ticket: ok.back.searchParams.get("code"), verifier: ok.verifier });
    expect(r!.status).toBe(200);
    const got = await j(r);
    expect(got.address).toBe("owner@clinic.example");
    expect(got.refreshToken).toStartWith("brk1.");
    expect(got.refreshToken).not.toContain("real-refresh");
    expect((await call("/api/broker/redeem", t1, { ticket: ok.back.searchParams.get("code"), verifier: ok.verifier }))!.status).toBe(400);
  });
  test("a state works once; an unknown one gets a plain page, not a redirect", async () => {
    const { auth } = await signIn(t1);
    const r = await call(`/oauth/broker/google/callback?code=google-code&state=${auth.searchParams.get("state")}`, null, undefined, "GET");
    expect(r!.status).toBe(400);
    expect(r!.headers.get("location")).toBeNull();
    expect((await call("/oauth/broker/google/callback?code=c&state=nope", null, undefined, "GET"))!.status).toBe(400);
  });
  test("cancelled, and a refused code, go back to the app with an error and the app's state", async () => {
    for (const [q, err] of [["error=access_denied", "cancelled"], ["code=wrong", "refused"]] as const) {
      const s = await j(await call("/api/broker/start", t1, { provider: "google", purpose: "calendar", returnUrl: RET + "?x=1", state: "T".repeat(30), challenge: A }));
      const st = new URL(s.url).searchParams.get("state");
      const r = await call(`/oauth/broker/google/callback?${q}&state=${st}`, null, undefined, "GET");
      const back = new URL(r!.headers.get("location")!);
      expect([back.searchParams.get("error"), back.searchParams.get("state"), back.searchParams.get("x"), back.searchParams.get("code")]).toEqual([err, "T".repeat(30), "1", null]);
    }
  });
  test("bad requests: return address must be https (or local), Gmail and Microsoft not offered", async () => {
    const base = { provider: "google", purpose: "calendar", returnUrl: RET, state: "S".repeat(30), challenge: A };
    for (const bad of [{ returnUrl: "http://evil.example/x" }, { returnUrl: "javascript:alert(1)" }, { returnUrl: RET + "#frag" }, { returnUrl: "https://u:p@x.example/" }, { state: "short" }, { challenge: "!!" }, { provider: "yahoo" }, { purpose: "admin" }]) {
      expect((await call("/api/broker/start", t1, { ...base, ...bad }))!.status).toBe(400);
    }
    expect((await call("/api/broker/start", t1, { ...base, returnUrl: "http://localhost:8791/cb" }))!.status).toBe(200);
    expect((await call("/api/broker/start", t1, { ...base, purpose: "mail" }))!.status).toBe(403);
    expect((await call("/api/broker/start", t1, { ...base, provider: "microsoft" }))!.status).toBe(403);
  });
  test("nothing readable is kept: no token in the tables, and no ticket after redeeming", async () => {
    const { db } = await import("../lib");
    const dump = JSON.stringify([db().query("SELECT * FROM broker_states").all(), db().query("SELECT * FROM broker_tickets").all()]);
    expect(dump).not.toContain("real-refresh");
    expect(dump).not.toContain("owner@clinic");
    expect((db().query("SELECT count(*) AS n FROM broker_tickets WHERE buyer_id = ?").get(b1) as any).n).toBeGreaterThan(0); // the tickets nobody redeemed
    db().query("UPDATE broker_tickets SET created_at = ?").run(new Date(Date.now() - 3 * 60_000).toISOString());
    db().query("UPDATE broker_states SET created_at = ?").run(new Date(Date.now() - 11 * 60_000).toISOString());
    await call("/api/broker/status", t1, undefined, "GET");
    expect(db().query("SELECT count(*) AS n FROM broker_tickets").get()).toEqual({ n: 0 });
    expect(db().query("SELECT count(*) AS n FROM broker_states").get()).toEqual({ n: 0 });
  });
});

describe("refreshing", () => {
  let wrapped = "";
  beforeAll(async () => {
    const ok = await signIn(t1, "r".repeat(43));
    wrapped = (await j(await call("/api/broker/redeem", t1, { ticket: ok.back.searchParams.get("code"), verifier: ok.verifier }))).refreshToken;
  });
  const refresh = (token: string, over: Record<string, unknown> = {}) => call("/api/broker/refresh", token, { provider: "google", purpose: "calendar", refreshToken: wrapped, ...over });

  test("gives an access token from the real refresh token; the real token never leaves", async () => {
    behaviour = "ok"; seen.length = 0;
    const r = await j(await refresh(t1));
    expect(r.accessToken).toMatch(/^ya29\.refreshed-1\/\/real-refresh-\d+$/);
    expect(r.expiresIn).toBe(3599);
    expect(r.refreshToken).toBeUndefined();
    expect(seen[0].get("client_secret")).toBe("gsecret");
    expect(seen[0].get("scope")).toBe(BROKER_SCOPES.google.calendar);
  });
  test("the wrapper only works for its own agency, provider and purpose", async () => {
    expect((await refresh(t2))!.status).toBe(400);
    expect((await refresh(t1, { purpose: "mail" }))!.status).toBe(400);
    expect((await refresh(t1, { refreshToken: wrapped.slice(0, -2) + "AA" }))!.status).toBe(400);
    expect((await refresh(t1, { refreshToken: "1//plain-google-token" }))!.status).toBe(400);
    expect((await refresh(null as any))!.status).toBe(401);
  });
  test("Google rotating the token gives back a new wrapper that works", async () => {
    behaviour = "rotate";
    const r = await j(await refresh(t1));
    expect(r.refreshToken).toStartWith("brk1.");
    expect(r.refreshToken).not.toContain("rotated");
    behaviour = "ok";
    const again = await j(await refresh(t1, { refreshToken: r.refreshToken }));
    expect(again.accessToken).toContain("1//rotated");
  });
  test("revoked access is a refusal (reconnect); Google or the network failing is a 502 (try later)", async () => {
    behaviour = "revoked";
    const a = await refresh(t1);
    expect([a!.status, (await j(a)).error]).toEqual([400, "invalid_grant"]);
    behaviour = "500";
    expect((await refresh(t1))!.status).toBe(502);
    behaviour = "ok";
    process.env.BROKER_GOOGLE_TOKEN_URL = "http://127.0.0.1:9/token";
    const down = await refresh(t1);
    expect([down!.status, (await j(down)).error]).toEqual([502, "unavailable"]);
    process.env.BROKER_GOOGLE_TOKEN_URL = `${G}/token`;
  });
  test("rate limited per agency", async () => {
    expect((await refresh(t1, {}) as Response).status).toBe(200);
    const hit = await call("/api/broker/refresh", t1, { provider: "google", purpose: "calendar", refreshToken: wrapped }, "POST", (k) => (k.startsWith("broker:refresh:") ? 60 : 0));
    expect([hit!.status, hit!.headers.get("retry-after")]).toEqual([429, "60"]);
  });
});
