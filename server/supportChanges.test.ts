// What a support person may change (server/supportChanges.ts): the allow/deny matrix, and the read-only rule.
//   bun test --env-file=../.env server/supportChanges.test.ts
import { describe, expect, test } from "bun:test";
import { describeChange, readOnlyView, supportMayChange } from "./supportChanges";

const ID = "0a1b2c3d-1111-2222-3333-444455556666";
const ID2 = "9f8e7d6c-1111-2222-3333-444455556666";
const ok = (m: string, p: string) => supportMayChange(m, p).ok;

describe("allowed: what an agency admin does to fix things", () => {
  const allowed: [string, string][] = [
    ["POST", "/api/clients"],
    ["PUT", `/api/clients/${ID}`],
    ["POST", `/api/clients/${ID}/numbers`],
    ["POST", `/api/clients/${ID}/numbers/attach`],
    ["POST", `/api/clients/${ID}/number-requests`],
    ["PUT", `/api/clients/${ID}/booking`],
    ["POST", `/api/clients/${ID}/booking/test`],
    ["DELETE", `/api/clients/${ID}/booking/events/${ID2}`],
    ["PUT", `/api/clients/${ID}/brand`],
    ["POST", `/api/clients/${ID}/brand/logo`],
    ["PUT", "/api/org/brand"],
    ["PUT", `/api/automations/${ID}`],
    ["POST", `/api/automations/${ID}/test`],
    ["PUT", `/api/website-chat/${ID}`],
    ["PUT", `/api/manage/${ID}/receptionist`],
    ["POST", `/api/manage/${ID}/receptionist/pause`],
    ["POST", `/api/manage/${ID}/knowledge`],
    ["PUT", `/api/manage/${ID}/knowledge/${ID2}`],
    ["DELETE", `/api/manage/${ID}/knowledge/${ID2}`],
    ["PUT", `/api/manage/${ID}/business`],
    ["PUT", `/api/manage/${ID}/brand`],
    ["POST", `/api/workspace/${ID}/follow-ups/abc`],
    ["PUT", "/api/console/businesses/abc"],
    ["PUT", `/api/console/companies/${ID}`],
    ["POST", "/api/console/onboarding"],
    ["POST", "/api/console/incidents/abc/resolve"],
    ["POST", "/api/logout"],
  ];
  for (const [m, p] of allowed) test(`${m} ${p}`, () => expect(supportMayChange(m, p)).toEqual({ ok: true }));
  test("reading is never judged here", () => {
    for (const p of ["/api/phone-account", "/api/team", `/api/clients/${ID}/email`, "/api/anything"]) expect(ok("GET", p)).toBe(true);
    expect(ok("HEAD", "/api/phone-account")).toBe(true);
  });
});

describe("denied: keys, connection secrets, billing, the owner, deleting the agency, exports", () => {
  const denied: [string, string, RegExp][] = [
    ["PUT", "/api/phone-account", /keys/],
    ["POST", "/api/phone-account/test", /keys/],
    ["DELETE", "/api/phone-account", /keys/],
    ["PUT", "/api/twilio-account", /keys/],
    ["PUT", `/api/clients/${ID}/email`, /connections/],
    ["POST", `/api/clients/${ID}/email/check`, /connections/],
    ["POST", `/api/clients/${ID}/connect-link`, /connections/],
    ["GET", `/api/clients/${ID}/calendar/signin/google`, /./], // placeholder (reads pass); see below
    ["PUT", `/api/clients/${ID}/calendar`, /connections/],
    ["POST", `/api/clients/${ID}/customers`, /connections/],
    ["PUT", `/api/manage/${ID}/email`, /connections/],
    ["POST", `/api/manage/${ID}/team/invites`, /connections/],
    ["PUT", `/api/manage/${ID}/calendar`, /connections/],
    ["PUT", `/api/manage/${ID}/integrations`, /connections/],
    ["DELETE", `/api/clients/${ID}`, /deleting/],
    ["POST", "/api/team/invites", /owner/],
    ["PUT", `/api/team/members/${ID}`, /owner/],
    ["DELETE", `/api/team/members/${ID}`, /owner/],
    ["POST", `/api/team/members/${ID}/reset-link`, /owner/],
    ["PUT", "/api/account", /owner/],
    ["DELETE", "/api/account", /owner/],
    ["DELETE", `/api/console/companies/${ID}`, /deleting a client/],
    ["DELETE", `/api/console/users/${ID}`, /accounts/],
    ["DELETE", `/api/admin/agencies/${ID}`, /./],
    ["PUT", "/api/org", /owner/],
    ["POST", "/api/orgs", /owner/],
    ["POST", "/api/orgs/switch", /owner/],
    ["POST", "/api/password-reset", /owner/],
    ["PUT", "/api/support/settings", /Support/],
    ["PUT", "/api/updates/settings", /Updates/],
    ["POST", "/api/updates/check", /./],
    ["POST", "/api/admin/agencies", /./],
    ["POST", "/api/admin/sandbox", /./],
    ["PUT", "/api/admin/platform-settings", /./],
    ["POST", "/api/console/platform-admins", /platform admins/],
    ["DELETE", `/api/console/platform-admins/${ID}`, /platform admins/],
    ["POST", `/api/console/businesses/${ID}/members`, /sharing/],
    ["DELETE", `/api/console/companies/${ID}/invites/abc`, /sharing/],
    ["POST", "/api/anything-new", /./],
    ["POST", `/api/manage/${ID}/billing`, /billing/],
    ["POST", `/api/manage/${ID}/subscription`, /billing/],
    ["POST", "/api/org/billing/checkout", /billing/],
    ["POST", `/api/manage/${ID}/export`, /export/],
    ["POST", "/api/workspace/export", /export/],
    ["POST", "/api/org/api-keys", /keys/],
    ["PUT", "/api/org/secrets/x", /keys/],
  ];
  for (const [m, p, why] of denied) {
    if (m === "GET") continue;
    test(`${m} ${p}`, () => {
      const d = supportMayChange(m, p);
      expect(d.ok).toBe(false);
      expect((d as any).why).toMatch(why);
    });
  }
  test("trailing slashes and query strings don't help", () => {
    expect(ok("PUT", "/api/phone-account/")).toBe(false);
    expect(ok("PUT", "/api/phone-account?x=1")).toBe(false);
    expect(ok("DELETE", `/api/clients/${ID}/?force=1`)).toBe(false);
    expect(ok("put", "/api/phone-account")).toBe(false);
  });
  test("the one thing allowed on a receptionist's own address is editing it", () => {
    expect(ok("PUT", `/api/clients/${ID}`)).toBe(true);
    expect(ok("PATCH", `/api/clients/${ID}`)).toBe(true); // handled (or refused) by the route; not a destructive verb
    expect(ok("DELETE", `/api/clients/${ID}`)).toBe(false);
  });
});

describe("the read-only rule", () => {
  const v = (x: object) => ({ viewing: { org: "A", client: null, business: "", ...x } });
  test("no view is not read only; a platform view is; a customer view is", () => {
    expect(readOnlyView({})).toBe(false);
    expect(readOnlyView(v({}))).toBe(true);
    expect(readOnlyView(v({ client: ID, business: "B" }))).toBe(true);
  });
  test("a support session is read only unless the owner allows changes (and never for a customer's view)", () => {
    expect(readOnlyView(v({ support: true }))).toBe(true);
    expect(readOnlyView(v({ support: true, canEdit: false }))).toBe(true);
    expect(readOnlyView(v({ support: true, canEdit: true }))).toBe(false);
    expect(readOnlyView(v({ support: true, canEdit: true, client: ID }))).toBe(true);
    expect(readOnlyView(v({ canEdit: true }))).toBe(true); // canEdit means nothing without support
  });
});

describe("the audit wording", () => {
  test("ids are hidden and the area is named", () => {
    expect(describeChange("PUT", `/api/automations/${ID}`)).toBe("Changed automations (PUT /api/automations/:id)");
    expect(describeChange("POST", `/api/manage/${ID}/knowledge`)).toContain("knowledge");
    expect(describeChange("PUT", `/api/clients/${ID}`)).not.toContain(ID);
  });
});
