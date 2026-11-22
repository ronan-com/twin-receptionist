import type { Business } from "../../src/lib/shared";
import type { Ctx } from "../accounts";

// Shared pieces for the route modules in server/routes/. server/index.ts calls each
// module once, after sign-in and the usual guards. A handler returns a Response, or
// null when the path isn't one of its own (the server then answers 404).

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const readBody = (req: Request): Promise<any> => req.json().catch(() => ({}));

export type RouteArgs = {
  req: Request;
  url: URL;
  path: string;
  method: string;
  /** The signed-in person (also set while the platform team is viewing as someone). */
  ctx: Ctx;
  /** The org this request works in (ctx.org.id). */
  orgId: string;
  /** Base for links in emails (invites etc). */
  appUrl: string;
};

/**
 * How the signed-in person reaches the receptionist named in the path:
 *  - "staff":    a member of the agency (org) that owns it
 *  - "platform": the platform admin, any receptionist
 *  - "manager":  a business user with client_access.role = 'manager'
 *  - "viewer":   a business user with client_access.role = 'viewer' (read-only), or
 *                the platform team viewing as the business (read-only)
 */
export type ClientAccess = "staff" | "platform" | "manager" | "viewer";

export type ClientRouteArgs = RouteArgs & {
  /** The receptionist from /api/<area>/<clientId>/..., or null if the path names none. */
  client: Business | null;
  clientOrgId: string | null;
  access: ClientAccess | null;
  /** The rest of the path after /api/<area>/<clientId> (e.g. "/calls"), or after /api/<area> when there's no id. */
  rest: string;
};

export type Handler<A = RouteArgs> = (args: A) => Promise<Response | null>;
