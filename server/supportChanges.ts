import type { Ctx } from "./accounts";

// What the setup provider's support person may do, once the owner has Support access on (server/supportSync.ts).
//
// The owner's "Support can make changes" switch (ON by default) decides whether a support session is
// read-only (as it always was) or can fix things the way an agency admin can: receptionists, automations,
// website chat, numbers, knowledge, clients, branding and settings. Even then there are things nobody on the
// support side can do, however the request is made, because this is a default-DENY list:
//   - see or change API keys or connection secrets (the phone account, Twilio, mailboxes, calendar sign-ins,
//     signing secrets)
//   - billing and subscriptions
//   - the owner's account, the team, anyone's password or invite
//   - delete the agency, or anything under /api/admin
//   - export data
//   - the owner's own switches (Support, Updates)
// Every change that does go through is written to the agency's audit log, "by support", for the owner to see.

/** True when this person is only looking: viewing as someone, or a support session with changes switched off. */
export const readOnlyView = (ctx: Pick<Ctx, "viewing">): boolean => Boolean(ctx.viewing && !(ctx.viewing.support && ctx.viewing.canEdit && !ctx.viewing.client));

const ID = "[a-f0-9-]{36}";
const DENY: [RegExp, string][] = [
  [/\/(export|exports|download)(\/|$)/, "exporting data"],
  [/\/(billing|subscription|invoices?|payment)(\/|$)/, "billing"],
  [/\/(api-keys?|keys|secrets?)(\/|$)/, "keys and secrets"],
  [/^\/api\/(phone-account|twilio-account)(\/|$)/, "keys and connections"],
  [/^\/api\/support\/settings$/, "the owner's Support settings"],
  [/^\/api\/updates\/settings$/, "the owner's Updates settings"],
  [/^\/api\/(team|account|orgs|org|password-reset|signup|invites|login)$|^\/api\/(team|orgs|password-reset|invites)\//, "the owner, the team or the account"],
  [new RegExp(`^/api/(clients|manage)/${ID}/(email|connect-link|team|customers|customer-invites|calendar|calendar/test|calendar/signin|integrations)(/|$)`), "connections, mailboxes or sharing access"],
  [new RegExp(`^/api/clients/${ID}$`), "deleting a receptionist"],
  [/^\/api\/console\/platform-admins(\/|$)/, "platform admins"],
  [/^\/api\/console\/users(\/|$)/, "people's accounts"],
  [/^\/api\/console\/companies\/[^/]+$/, "deleting a client"],
  [/^\/api\/console\/(companies|businesses)\/[^/]+\/(members|invites)(\/|$)/, "sharing access"],
];
const ALLOW: RegExp[] = [
  /^\/api\/clients$/,
  new RegExp(`^/api/clients/${ID}$`), // PUT only (DELETE is refused above)
  new RegExp(`^/api/clients/${ID}/(calls|numbers|number-requests|texting|texting/number|texting/numbers|texting/test|simulator/texts|simulator/texts/send|simulator/email|booking|booking/test|booking/events/${ID})$`),
  new RegExp(`^/api/clients/${ID}/numbers/(owned|attach|detach)$`),
  new RegExp(`^/api/clients/${ID}/calls/[^/]+/messages$`),
  new RegExp(`^/api/clients/${ID}/brand(/(logo|background))?$`),
  /^\/api\/org\/brand(\/(logo|background))?$/,
  new RegExp(`^/api/automations/${ID}(/test)?$`),
  new RegExp(`^/api/website-chat/${ID}(/.*)?$`),
  /^\/api\/workspace\/.*/,
  new RegExp(`^/api/manage/${ID}/(receptionist|receptionist/pause|knowledge|knowledge/${ID}|phone-numbers|number-requests|onboarding|brand|brand/(logo|background)|business|voices)$`),
  /^\/api\/console\/.*/,
  /^\/api\/admin\/view-as$/, // opening one of this agency's businesses read-only
  /^\/api\/logout$/,
];

export type Decision = { ok: true } | { ok: false; why: string };

/** May a support person (changes allowed) make this request? Reads are always fine here; only writes are judged. */
export function supportMayChange(method: string, path: string): Decision {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return { ok: true };
  const p = path.split("?")[0].replace(/\/+$/, "") || "/";
  if (m === "POST" && p === "/api/logout") return { ok: true };
  for (const [re, why] of DENY) if (re.test(p)) {
    // the receptionist's own page (PUT) is the one thing matched by the delete rule
    if ((why === "deleting a receptionist" || why === "deleting a client") && m !== "DELETE") continue;
    return { ok: false, why };
  }
  return ALLOW.some((re) => re.test(p)) ? { ok: true } : { ok: false, why: "that isn't something support can change" };
}

export type Gate = { action: "pass" } | { action: "deny"; error: string } | { action: "audit"; summary: string };

/**
 * What happens to a request made by a support session (server/index.ts runs this right after sign-in, before any
 * route). Anyone else, and reads, pass. A write is refused when the session is read-only (the owner switched
 * "Support can make changes" off, or support is looking at one business's view) or the matrix above says no;
 * otherwise it goes ahead and is written to the owner's audit log as "by support".
 */
export function supportGate(ctx: Pick<Ctx, "viewing">, method: string, path: string, seller: string): Gate {
  if (!ctx.viewing?.support) return { action: "pass" };
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || path === "/api/admin/view-as" || path === "/api/logout") return { action: "pass" };
  if (!ctx.viewing.canEdit) return { action: "deny", error: "This is a read-only support session. Nothing can be changed." };
  if (readOnlyView(ctx)) return { action: "deny", error: "You're looking at a business's own view, which is read-only. Go back to the agency to make changes." };
  const allowed = supportMayChange(m, path);
  if (!allowed.ok) return { action: "deny", error: `Support can't change that (${allowed.why}). Ask the owner to do it.` };
  return { action: "audit", summary: `By support (${seller}): ${describeChange(m, path)}` };
}

/** A short plain description for the audit log, with ids hidden. */
export function describeChange(method: string, path: string): string {
  const p = path.split("?")[0].replace(new RegExp(ID, "g"), ":id");
  const area = [
    [/^\/api\/automations/, "automations"],
    [/^\/api\/website-chat/, "website chat"],
    [/^\/api\/manage\/:id\/knowledge/, "knowledge"],
    [/\/numbers|number-requests|phone-numbers/, "phone numbers"],
    [/\/brand/, "branding"],
    [/^\/api\/manage\/:id\/receptionist/, "a receptionist"],
    [/^\/api\/clients/, "a receptionist"],
    [/^\/api\/workspace/, "bookings, leads or follow-ups"],
    [/^\/api\/console/, "agency clients or settings"],
  ].find(([re]) => (re as RegExp).test(p));
  return `Changed ${area ? area[1] : "settings"} (${method.toUpperCase()} ${p})`;
}
