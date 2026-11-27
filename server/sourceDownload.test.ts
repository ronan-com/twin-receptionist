// Settings, "Your source code": where the download comes from, without a network.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/sourceDownload.test.ts
import { describe, expect, test } from "bun:test";
import { sourceDownloadUrl } from "./sourceDownload";

const env = { APP_VERSION: "1.0.21", SUPPORT_SYNC_URL: "https://setup.example.com/api/sync", SUPPORT_SYNC_TOKEN: "st_" + "a".repeat(43) };
const fake = (status: number, body: unknown, seen: { url?: string; auth?: string } = {}) =>
  (async (url: any, init: any) => { seen.url = String(url); seen.auth = init?.headers?.authorization; return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;

describe("source download link", () => {
  test("asks the setup site for the version it runs, with its own sync token", async () => {
    const seen: any = {};
    const r = await sourceDownloadUrl(env, fake(200, { version: "1.0.21", url: "https://setup.example.com/api/releases/source/1.0.21?b=1&exp=2&sig=x" }, seen));
    expect(r).toEqual({ version: "1.0.21", url: "https://setup.example.com/api/releases/source/1.0.21?b=1&exp=2&sig=x" });
    expect(seen.url).toBe("https://setup.example.com/api/releases/source-link?version=1.0.21");
    expect(seen.auth).toBe(`Bearer ${env.SUPPORT_SYNC_TOKEN}`);
  });

  test("SOURCE_DOWNLOAD_URL (a template with {version}) wins and needs no setup site", async () => {
    const r = await sourceDownloadUrl({ APP_VERSION: "1.0.21", SOURCE_DOWNLOAD_URL: "https://github.com/acme/app/archive/refs/tags/v{version}.tar.gz" }, fake(500, {}));
    expect(r.url).toBe("https://github.com/acme/app/archive/refs/tags/v1.0.21.tar.gz");
    await expect(sourceDownloadUrl({ APP_VERSION: "1.0.21", SOURCE_DOWNLOAD_URL: "http://x/{version}" })).rejects.toThrow(/https/);
  });

  test("clear messages: not connected, version not held, site down, bad answer", async () => {
    await expect(sourceDownloadUrl({ APP_VERSION: "1.0.21" }, fake(200, {}))).rejects.toThrow(/isn't connected to its setup site/);
    await expect(sourceDownloadUrl(env, fake(404, { error: "not available" }))).rejects.toThrow(/source for version 1.0.21 isn't available/);
    await expect(sourceDownloadUrl(env, (async () => { throw new Error("down"); }) as unknown as typeof fetch)).rejects.toThrow(/Couldn't reach the setup site/);
    await expect(sourceDownloadUrl(env, fake(200, { url: "javascript:alert(1)" }))).rejects.toThrow(/couldn't give a download link/);
    await expect(sourceDownloadUrl(env, fake(500, {}))).rejects.toThrow(/couldn't give a download link/);
  });
});

describe("who may download", () => {
  const ctx = (role: any, extra: any = {}) => ({ tokenHash: "x", user: { id: "u", email: "a@b.c", name: "A", platformAdmin: false }, org: { id: "o", name: "O" }, role, ...extra }) as any;
  test("only the owner of a single-agency copy; not an admin, not a platform install, not a read-only view", async () => {
    const { sourceDownloadRoute } = await import("./sourceDownload");
    expect((await sourceDownloadRoute("POST", ctx("owner"), true)).status).toBe(404);
    await expect(sourceDownloadRoute("GET", ctx("admin"), true)).rejects.toThrow(/owner/);
    await expect(sourceDownloadRoute("GET", ctx("member"), true)).rejects.toThrow();
    await expect(sourceDownloadRoute("GET", ctx("owner"), false)).rejects.toThrow(/own copy/);
    await expect(sourceDownloadRoute("GET", ctx("owner", { viewing: { org: "x", client: null, business: "" } }), true)).rejects.toThrow();
  });
});
