import type { Business } from "../../src/lib/shared";
import { requireRole } from "../accounts";
import { audit } from "../audit";
import { ValidationError } from "../prompt";
import { getSetting, putSetting } from "../store";
import { json, readBody, type ClientRouteArgs, type RouteArgs } from "./http";

// "Connect your apps": per-business API keys (ServiceM8, Cliniko, Tradify, Xero) and an
// optional Pipedream Connect link. Secrets live in app_settings and never go back to the
// browser. Full actions (creating jobs, contacts) can follow; today a saved key is checked
// with "Test connection" and kept ready for them.
//   /api/workspace/<id>/apps | apps/<provider> | apps/<provider>/test | pipedream/connect
//   /api/console/pipedream (the agency's own Pipedream project, set once)

const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export const APP_KEYS = {
  servicem8: { name: "ServiceM8", hint: "Settings, API Keys" },
  cliniko: { name: "Cliniko", hint: "My Info, Manage API keys" },
  tradify: { name: "Tradify", hint: "Settings, Integrations, API key" },
  xero: { name: "Xero", hint: "A custom connection access token" },
} as const;
export type AppProvider = keyof typeof APP_KEYS;
const isProvider = (p: string): p is AppProvider => p in APP_KEYS;

type Stored = Partial<Record<AppProvider, { key: string; savedAt: string }>>;
const keyOf = (clientId: string) => `apps:${clientId}`;

export type Fetcher = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>;

/** A cheap read with the saved key. Tradify has no public check, so it only says the key was saved. */
export async function testApp(provider: AppProvider, key: string, doFetch: Fetcher = (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(8000) })): Promise<{ ok: boolean; message: string }> {
  const name = APP_KEYS[provider].name;
  if (provider === "tradify") return { ok: true, message: "Saved. Tradify has no key check, so it's ready for when actions are added." };
  let url = "";
  let headers: Record<string, string> = {};
  if (provider === "servicem8") {
    url = "https://api.servicem8.com/api_1.0/company.json?%24top=1";
    headers = { "X-API-Key": key, Accept: "application/json" };
  } else if (provider === "cliniko") {
    // The key ends in its region, like "abc123-au2".
    const shard = key.match(/-([a-z]{2}\d)$/)?.[1];
    if (!shard) return { ok: false, message: "A Cliniko key ends in its region, like -au2. Copy the whole key." };
    url = `https://api.${shard}.cliniko.com/v1/user`;
    headers = { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "User-Agent": "Receptionist (support)", Accept: "application/json" };
  } else {
    url = "https://api.xero.com/connections";
    headers = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  }
  try {
    const r = await doFetch(url, { headers });
    if (r.ok) return { ok: true, message: `${name} accepted the key.` };
    if (r.status === 401 || r.status === 403) return { ok: false, message: `${name} didn't accept that key.` };
    return { ok: false, message: `${name} answered with an error (${r.status}). Try again in a moment.` };
  } catch {
    return { ok: false, message: `Couldn't reach ${name}. Try again in a moment.` };
  }
}

async function view(client: Business, orgId: string) {
  const saved = (await getSetting<Stored>(keyOf(client.id))) ?? {};
  return {
    apps: (Object.keys(APP_KEYS) as AppProvider[]).map((p) => ({ provider: p, name: APP_KEYS[p].name, hint: APP_KEYS[p].hint, connected: Boolean(saved[p]?.key), savedAt: saved[p]?.savedAt ?? null })),
    pipedream: Boolean((await pipedreamOf(orgId))?.clientSecret),
  };
}

/* ------------------------------ Pipedream Connect ------------------------------ */

type Pd = { clientId: string; clientSecret: string; projectId: string; environment: "production" | "development" };
const pdKey = (orgId: string) => `pipedream:${orgId}`;
const pipedreamOf = (orgId: string) => getSetting<Pd>(pdKey(orgId));
const PD_API = "https://api.pipedream.com/v1";

async function pdToken(pd: Pd): Promise<string> {
  const r = await fetch(`${PD_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: pd.clientId, client_secret: pd.clientSecret }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new ValidationError("Pipedream didn't accept those keys.");
  return String(((await r.json()) as any).access_token ?? "");
}

/** A one-time link to Pipedream's hosted "connect an app" page for this business. */
export async function pipedreamConnectUrl(pd: Pd, externalUserId: string): Promise<string> {
  const token = await pdToken(pd);
  const r = await fetch(`${PD_API}/connect/${encodeURIComponent(pd.projectId)}/tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-pd-environment": pd.environment },
    body: JSON.stringify({ external_user_id: externalUserId }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new ValidationError("Pipedream couldn't start the connection. Check the project id in Connections.");
  const url = String(((await r.json()) as any).connect_link_url ?? "");
  if (!/^https:\/\//.test(url)) throw new ValidationError("Pipedream didn't return a link.");
  return url;
}

/** The agency's own Pipedream project (Connections). The secret is never sent back. */
export async function pipedreamConsoleRoutes(args: RouteArgs): Promise<Response | null> {
  const { path, method, ctx, orgId } = args;
  if (path !== "/api/console/pipedream") return null;
  const cur = await pipedreamOf(orgId);
  if (method === "GET") return json({ configured: Boolean(cur?.clientSecret), projectId: cur?.projectId ?? "", clientId: cur?.clientId ?? "", environment: cur?.environment ?? "production" });
  requireRole(ctx, "admin");
  if (method === "DELETE") {
    await putSetting(pdKey(orgId), null);
    await audit(ctx, "integration.pipedream.removed", { summary: "Pipedream key removed" }, { orgId });
    return json({ configured: false, projectId: "", clientId: "", environment: "production" });
  }
  if (method === "PUT") {
    const b = await readBody(args.req);
    const next: Pd = {
      clientId: clip(b.clientId, 120),
      clientSecret: clip(b.clientSecret, 200) || cur?.clientSecret || "",
      projectId: clip(b.projectId, 80),
      environment: b.environment === "development" ? "development" : "production",
    };
    if (!next.clientId || !next.clientSecret || !next.projectId) throw new ValidationError("Enter the client id, client secret and project id.");
    await pdToken(next); // proves the keys work before saving them
    await putSetting(pdKey(orgId), next);
    await audit(ctx, "integration.pipedream.saved", { summary: "Pipedream key saved" }, { orgId });
    return json({ configured: true, projectId: next.projectId, clientId: next.clientId, environment: next.environment });
  }
  return null;
}

/* ------------------------------ A business's apps ------------------------------ */

export async function appsRoutes(args: ClientRouteArgs): Promise<Response | null> {
  const { client, method, rest, clientOrgId } = args;
  if (!client || !clientOrgId) return null;
  const get = method === "GET" || method === "HEAD";
  if (rest === "/apps" && get) return json(await view(client, clientOrgId));

  if (rest === "/pipedream/connect" && method === "POST") {
    const pd = await pipedreamOf(clientOrgId);
    if (!pd?.clientSecret) return json({ error: "Not set up." }, 404);
    return json({ url: await pipedreamConnectUrl(pd, client.id) });
  }

  const one = rest.match(/^\/apps\/([a-z0-9]+)(\/test)?$/);
  if (!one || !isProvider(one[1])) return null;
  const provider = one[1];
  const saved = ((await getSetting<Stored>(keyOf(client.id))) ?? {}) as Stored;

  if (one[2]) {
    if (method !== "POST") return null;
    const key = saved[provider]?.key;
    if (!key) throw new ValidationError("Save a key first.");
    return json(await testApp(provider, key));
  }
  if (method === "PUT") {
    const b = await readBody(args.req);
    const key = clip(b.key, 500);
    if (key.length < 8) throw new ValidationError("Paste the whole key.");
    await putSetting(keyOf(client.id), { ...saved, [provider]: { key, savedAt: new Date().toISOString() } });
    await audit(args.ctx, "integration.app.saved", { summary: `${APP_KEYS[provider].name} key saved` }, { orgId: clientOrgId, clientId: client.id });
    return json(await view(client, clientOrgId));
  }
  if (method === "DELETE") {
    const { [provider]: _gone, ...left } = saved;
    await putSetting(keyOf(client.id), left);
    await audit(args.ctx, "integration.app.removed", { summary: `${APP_KEYS[provider].name} key removed` }, { orgId: clientOrgId, clientId: client.id });
    return json(await view(client, clientOrgId));
  }
  return null;
}
