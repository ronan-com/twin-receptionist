import type { ClientRouteArgs } from "./http";

// Area S (workspace, manage): receptionist settings, knowledge, call handling,
// integrations, team, business profile for one business.
// Paths: /api/manage/<clientId>/... (args.client and args.access are already
// checked: viewers never reach a non-GET request here). Return null for paths this
// module doesn't serve.
//
// Stub from the foundation: nothing is served yet.
export async function manageRoutes(_args: ClientRouteArgs): Promise<Response | null> {
  return null;
}
