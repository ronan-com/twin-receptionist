import type { RouteArgs } from "./http";

// Area C (console): the /admin screens for agency staff (scoped to their org) and
// the platform admin (everything). Paths: /api/console/... Business users never
// reach this module. Platform-only actions must check args.ctx.user.platformAdmin.
// Return null for paths this module doesn't serve.
//
// Stub from the foundation: nothing is served yet.
export async function consoleRoutes(_args: RouteArgs): Promise<Response | null> {
  return null;
}
