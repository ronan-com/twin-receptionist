import type { Business } from "../../src/lib/shared";
import type { Ctx } from "../accounts";
import { audit } from "../audit";
import { automationsState, dynamicVariables, saveAutomations, type AutomationDeps } from "../automations";
import { enterOrg } from "../telnyx";
import { followupTestRoute } from "./followups";
import { json, readBody, type ClientAccess, type RouteArgs } from "./http";

// Area T: per-receptionist automations.
//   GET /api/automations/<clientId>   settings, honest status per automation, recent texts
//   PUT /api/automations/<clientId>   a partial update; saved, then applied to the assistant
// The same access as /api/manage: agency staff, the platform team and the business's
// managers can change them; viewers (and anyone viewing as someone) read only.
// Another org's receptionist answers 404, like one that doesn't exist.
//
//   POST /hooks/automations/<clientId>/<token>   Telnyx's dynamic-variables webhook (public)

export type AutomationRouteDeps = AutomationDeps & {
  clientAccessFor: (ctx: Ctx, orgId: string, id: string) => Promise<{ client: Business; orgId: string; access: ClientAccess } | null>;
};

export async function automationRoutes(args: RouteArgs, deps: AutomationRouteDeps): Promise<Response | null> {
  const test = await followupTestRoute(args, deps); // POST .../test: "Send me a test" for the follow-ups
  if (test) return test;
  const m = args.path.match(/^\/api\/automations\/([a-f0-9-]{36})$/);
  if (!m) return null;
  const found = await deps.clientAccessFor(args.ctx, args.orgId, m[1]);
  if (!found) return json({ error: "That business isn't shared with you." }, 404);
  const { client, orgId, access } = found;
  if (orgId !== args.orgId) enterOrg(orgId);
  const canEdit = access !== "viewer" && !args.ctx.viewing;

  if (args.method === "GET") return json(await automationsState(client, canEdit));
  if (args.method === "PUT") {
    if (!canEdit) return json({ error: "Your access to this business is view-only. Ask a manager to change it." }, 403);
    const { changed } = await saveAutomations(client, await readBody(args.req), args.ctx.user.id, deps);
    if (changed.length) await audit(args.ctx, "automations.update", { changed }, { orgId, clientId: client.id });
    return json(await automationsState(client, canEdit));
  }
  return json({ error: "Not found" }, 404);
}

export async function automationHooks(req: Request, path: string): Promise<Response | null> {
  const m = path.match(/^\/hooks\/automations\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{16,64})$/);
  if (!m || (req.method !== "POST" && req.method !== "GET")) return null;
  return dynamicVariables(m[1], m[2]);
}
