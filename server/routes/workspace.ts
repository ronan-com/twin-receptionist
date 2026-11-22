import type { ClientRouteArgs } from "./http";

// Area W (workspace, read): calls, bookings, follow-ups, reports for one business.
// Paths: /api/workspace/<clientId>/... (args.client and args.access are already
// checked: a customer only reaches receptionists shared with them, and only a
// manager may change anything). Return null for paths this module doesn't serve.
//
// Stub from the foundation: nothing is served yet.
export async function workspaceRoutes(_args: ClientRouteArgs): Promise<Response | null> {
  return null;
}
