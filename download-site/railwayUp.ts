// Railway helpers shared by the app (self-update with its own project token) and the setup site (install and
// manual update with the buyer's account token). THIS FILE EXISTS TWICE, byte for byte:
//   server/railwayUp.ts           (the app bundle)
//   download-site/railwayUp.ts    (the setup-site Docker context can't import ../server)
// download-site/test/railwayUp.test.ts fails if the two differ. Edit one, then copy it over the other.
// Imports nothing from either project, only Node.
//
// Two kinds of Railway token:
//   account  Authorization: Bearer <token>             the buyer's own account token (used once, never kept by us)
//   project  Project-Access-Token: <token>             scoped to ONE project and environment (what the app keeps)

export type RailwayAuth = { token: string; kind: "account" | "project" };
export type RailwayFetch = typeof fetch;

export class RailwayError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code: "auth" | "rate" | "plan" | "server" | "network" | "other" = "other",
  ) {
    super(message);
    this.name = "RailwayError";
  }
}

export const railwayBase = (override?: string) => (override || process.env.RAILWAY_API_BASE || "https://backboard.railway.com").replace(/\/+$/, "");

export function railwayHeaders(a: RailwayAuth, extra: Record<string, string> = {}): Record<string, string> {
  return { ...(a.kind === "project" ? { "Project-Access-Token": a.token } : { Authorization: `Bearer ${a.token}` }), "User-Agent": "chloe-railway/1", ...extra };
}

function classify(status: number, said: string): RailwayError {
  if (status === 401 || status === 403 || /not authori[sz]ed|unauthori[sz]ed|invalid (api )?token|authentication|forbidden/i.test(said)) return new RailwayError("Railway didn't accept the token.", status || 401, "auth");
  if (status === 429 || /rate limit/i.test(said)) return new RailwayError("Railway is busy.", 429, "rate");
  if (/upgrade|trial|plan limit|free plan|payment|credit card|add a card|limited/i.test(said)) return new RailwayError("Railway needs a paid plan for this.", 402, "plan");
  if (status >= 500) return new RailwayError("Railway is having a problem.", status, "server");
  return new RailwayError(`Railway said: ${said.slice(0, 200) || "error " + status}`, status || 400, "other");
}

export async function railwayGql<T = any>(a: RailwayAuth, query: string, variables: Record<string, unknown> = {}, o: { base?: string; doFetch?: RailwayFetch } = {}): Promise<T> {
  let res: Response;
  try {
    res = await (o.doFetch ?? fetch)(`${railwayBase(o.base)}/graphql/v2`, {
      method: "POST",
      headers: railwayHeaders(a, { "Content-Type": "application/json" }),
      body: JSON.stringify({ query, variables }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new RailwayError("Couldn't reach Railway.", 0, "network");
  }
  let json: any = null;
  try {
    json = JSON.parse(await res.text());
  } catch {}
  const said = String(json?.errors?.[0]?.message || json?.message || "");
  if (res.status >= 300 || json?.errors?.length) throw classify(res.status >= 300 ? res.status : 0, said);
  return json?.data as T;
}

/**
 * A Railway PROJECT token for one environment, made with the buyer's account token. It can deploy and set
 * variables in that project and nothing else, so it is what the app keeps to update itself. Returns the token.
 */
export async function createProjectToken(account: string, projectId: string, environmentId: string, name: string, o: { base?: string; doFetch?: RailwayFetch } = {}): Promise<string> {
  const data = await railwayGql<{ projectTokenCreate: string }>(
    { token: account, kind: "account" },
    "mutation($input: ProjectTokenCreateInput!) { projectTokenCreate(input: $input) }",
    { input: { projectId, environmentId, name: name.slice(0, 60) } },
    o,
  );
  const t = String(data?.projectTokenCreate ?? "");
  if (t.length < 16 || /\s/.test(t)) throw new RailwayError("Railway didn't give back a project token.", 0, "other");
  return t;
}

/** Sets variables on one service without redeploying (the upload that follows does the one deploy). */
export async function setServiceVariables(a: RailwayAuth, ids: { projectId: string; environmentId: string; serviceId: string }, variables: Record<string, string>, o: { base?: string; doFetch?: RailwayFetch } = {}): Promise<void> {
  await railwayGql(a, "mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }", { input: { ...ids, variables, skipDeploys: true } }, o);
}

/** Sends the app's source (.tar.gz) to a service the way `railway up` does; Railway builds it with deploy/Dockerfile. */
export async function railwayUpload(
  a: RailwayAuth,
  ids: { projectId: string; environmentId: string; serviceId: string },
  body: Uint8Array,
  message: string,
  o: { base?: string; doFetch?: RailwayFetch } = {},
): Promise<{ deploymentId: string; url?: string; deploymentDomain?: string }> {
  const q = new URLSearchParams({ serviceId: ids.serviceId, message: message.slice(0, 120) });
  let res: Response;
  try {
    res = await (o.doFetch ?? fetch)(`${railwayBase(o.base)}/project/${encodeURIComponent(ids.projectId)}/environment/${encodeURIComponent(ids.environmentId)}/up?${q}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(300_000),
      headers: railwayHeaders(a, { "Content-Type": "application/gzip" }),
      body: body as unknown as BodyInit,
    });
  } catch {
    throw new RailwayError("Couldn't send the app to Railway.", 0, "network");
  }
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}
  if (res.status === 413) throw new RailwayError("Railway said the app upload is too large.", 413, "other");
  if (!res.ok) throw classify(res.status, String(json?.message || json?.error || ""));
  if (!json.deploymentId) throw new RailwayError("Railway took the upload but didn't start a build.", 500, "server");
  return { deploymentId: String(json.deploymentId), url: json.url, deploymentDomain: json.deploymentDomain };
}

/** SUCCESS, FAILED, CRASHED, BUILDING, DEPLOYING, ... */
export async function deploymentStatus(a: RailwayAuth, deploymentId: string, o: { base?: string; doFetch?: RailwayFetch } = {}): Promise<string> {
  const d = await railwayGql<{ deployment: { status: string } }>(a, "query($id: String!) { deployment(id: $id) { id status } }", { id: deploymentId }, o);
  return String(d?.deployment?.status ?? "");
}
