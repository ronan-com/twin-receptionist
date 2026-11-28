// The checks for domainlink.test.ts: /api/domain-link on the setup site.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "domainlink-test-"));
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 6).toString("base64");
process.env.SITE_URL = "https://setup.example.com";

const { addBuyer, revokeBuyer } = await import("../lib");
const { newSyncToken } = await import("../sync");
const { saveSetup, getSetup } = await import("../store");
const { domainLinkApi, domainLink, DOMAIN_LINK_SECONDS } = await import("../domainlink");

const open = () => 0;
const get = (url: string, token = "") => domainLinkApi(new Request(url, token ? { headers: { authorization: `Bearer ${token}` } } : {}), new URL(url), "1.2.3.4", open);

test("the link opens that buyer's domain form and nothing else", async () => {
  const b = addBuyer("Buyer", "b@example.com");
  saveSetup(b.id, { step: "done", phase: "done", schema: 3, rw: { projectId: "p" } } as any);
  const { token } = newSyncToken(b.id);
  const api = "https://setup.example.com/api/domain-link";
  expect((await get(api)).status).toBe(401);
  expect((await get(api, "st_" + "x".repeat(43))).status).toBe(401);
  const res = await get(api, token);
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  expect(url).toStartWith("https://setup.example.com/api/domain-link/open?");
  expect(url).not.toContain(b.code);

  // Tampered or old: refused, and nothing changes.
  const other = new URL(url);
  other.searchParams.set("b", String(b.id + 1));
  expect((await get(other.toString())).status).toBe(403);
  expect((await get(domainLink(b.id, Date.now() - (DOMAIN_LINK_SECONDS + 5) * 1000))).status).toBe(403);
  expect(getSetup(b.id).domainAdd).toBeUndefined();

  const ok = await get(url);
  expect(ok.status).toBe(302);
  expect(ok.headers.get("location")).toBe(`/setup/${b.code}`);
  expect(getSetup(b.id).domainAdd).toEqual({ phase: "ask" });

  revokeBuyer(b.id);
  expect((await get(url)).status).toBe(403);
  expect((await get(api, token)).status).toBe(401);
});
