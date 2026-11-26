import { loadAutomations } from "../automations";
import { normaliseFollowups } from "../followups";
import { readOnlyView } from "../supportChanges";
import { sendTest } from "../followupsRun";
import { ValidationError } from "../prompt";
import { enterOrg } from "../telnyx";
import { json, readBody, type RouteArgs } from "./http";
import type { AutomationRouteDeps } from "./automations";

// "Send me a test" for the follow-up automations:
//   POST /api/automations/<clientId>/test   { kind: "reminder" | "missed" | "review", channel: "sms" | "email", phone?, settings? }
// Sends one example, filled with sample details, to the signed-in person's own email or
// to the mobile number they type. `settings` is the section as it is on screen (maybe
// not saved yet), so the test shows the wording they just wrote. Same access as editing.

const SECTION = { reminder: "reminders", missed: "missedFollowup", review: "reviews" } as const;

export async function followupTestRoute(args: RouteArgs, deps: AutomationRouteDeps): Promise<Response | null> {
  const m = args.path.match(/^\/api\/automations\/([a-f0-9-]{36})\/test$/);
  if (!m || args.method !== "POST") return null;
  const found = await deps.clientAccessFor(args.ctx, args.orgId, m[1]);
  if (!found) return json({ error: "That business isn't shared with you." }, 404);
  const { client, orgId, access } = found;
  if (orgId !== args.orgId) enterOrg(orgId);
  if (access === "viewer" || readOnlyView(args.ctx)) return json({ error: "Your access to this business is view-only. Ask a manager to change it." }, 403);

  const body = await readBody(args.req);
  const kind = body?.kind as keyof typeof SECTION;
  const channel = body?.channel;
  if (!(kind in SECTION) || (channel !== "sms" && channel !== "email")) throw new ValidationError("Choose what to test.");
  if (kind === "missed" && channel === "email") throw new ValidationError("Missed-call follow-ups are text only.");
  const saved = (await loadAutomations(client.id)).settings;
  const section = SECTION[kind];
  const settings = normaliseFollowups(body?.settings && typeof body.settings === "object" ? { [section]: body.settings } : {}, saved);
  const { sentTo } = await sendTest(client, settings, { kind, channel, phone: body?.phone, email: args.ctx.user.email });
  return json({ sentTo });
}
