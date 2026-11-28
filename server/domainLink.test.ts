// "Change domain": the app asks the setup site, with its sync token, for a short-lived way to the domain form,
// and only for the owner of a single-agency copy.
import { describe, expect, test } from "bun:test";
import type { Ctx } from "./accounts";
import { domainFormUrl, domainLinkRoute } from "./domainLink";

const env = { SUPPORT_SYNC_URL: "https://setup.example.com/api/sync", SUPPORT_SYNC_TOKEN: "st_token" };

describe("domain form link", () => {
  test("asks the setup site with the sync token and passes the address on", async () => {
    let asked: [string, string] = ["", ""];
    const url = await domainFormUrl(env, (async (u: any, init: any) => {
      asked = [String(u), init.headers.authorization];
      return Response.json({ url: "https://setup.example.com/api/domain-link/open?b=1" });
    }) as typeof fetch);
    expect(url).toBe("https://setup.example.com/api/domain-link/open?b=1");
    expect(asked).toEqual(["https://setup.example.com/api/domain-link", "Bearer st_token"]);
  });
  test("says what to do when it can't", async () => {
    await expect(domainFormUrl({})).rejects.toThrow("setup link");
    await expect(domainFormUrl(env, (async () => Response.json({}, { status: 404 })) as unknown as typeof fetch)).rejects.toThrow("setup link");
    await expect(domainFormUrl(env, (async () => { throw new Error("down"); }) as unknown as typeof fetch)).rejects.toThrow("Couldn't reach");
  });
  test("owner only, never while viewing, only on an agency's own copy", async () => {
    const ctx = (role: string, viewing?: object) => ({ role, viewing, user: { platformAdmin: false } }) as unknown as Ctx;
    for (const bad of [domainLinkRoute("GET", ctx("admin"), true), domainLinkRoute("GET", ctx("member"), true), domainLinkRoute("GET", ctx("customer"), true), domainLinkRoute("GET", ctx("owner", { support: true }), true), domainLinkRoute("GET", ctx("owner"), false)]) {
      await expect(bad).rejects.toMatchObject({ status: 403 });
    }
  });
});
