import { describe, expect, test } from "bun:test";
import { testApp } from "./routes/apps";

const fetcher = (status: number, seen: { url?: string; headers?: any } = {}) => async (url: string, init?: RequestInit) => {
  seen.url = url;
  seen.headers = init?.headers;
  return { ok: status >= 200 && status < 300, status };
};

describe("Test connection", () => {
  test("ServiceM8 sends the key and reports the answer", async () => {
    const seen: any = {};
    expect((await testApp("servicem8", "abcdefgh1234", fetcher(200, seen))).ok).toBe(true);
    expect(seen.headers["X-API-Key"]).toBe("abcdefgh1234");
    const bad = await testApp("servicem8", "abcdefgh1234", fetcher(401));
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain("didn't accept");
  });
  test("Cliniko picks its region from the key", async () => {
    const seen: any = {};
    expect((await testApp("cliniko", "abc123-au2", fetcher(200, seen))).ok).toBe(true);
    expect(seen.url).toBe("https://api.au2.cliniko.com/v1/user");
    expect((await testApp("cliniko", "no-region-here", fetcher(200))).ok).toBe(false);
  });
  test("an unreachable app and Tradify", async () => {
    const down = async () => {
      throw new Error("down");
    };
    expect((await testApp("xero", "token-token", down)).message).toContain("Couldn't reach");
    expect((await testApp("tradify", "abcdefgh", down)).ok).toBe(true);
  });
});
