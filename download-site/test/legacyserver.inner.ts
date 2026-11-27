// A setup saved while a server-hosting mode existed (droplet id, IP, "server" step, an install in a phase that no longer
// exists) must still load, strip those fields and land on a sensible Railway step: never an error.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "legacyserver-test-"));
process.env.DATA_DIR = dir;
process.env.SETUP_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.SITE_URL = "http://localhost:4500";
for (const k of ["MOCK_FAST", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "PREVIEW_JUMP"]) delete process.env[k];

const { addBuyer, db } = await import("../lib");
const { getSetup, STEPS } = await import("../store");
const { firstOpen } = await import("../setup");
const { wizardPage } = await import("../wizard");

const brand = { productName: "Acme", ownerEmail: "o@acme.test", ownPhoneAccount: true };
function stored(n: string, data: Record<string, unknown>) {
  const b = addBuyer(`Legacy ${n}`, `legacy-${n}@example.com`);
  getSetup(b.id); // makes the row
  db().query("UPDATE setups SET data = ? WHERE buyer_id = ?").run(JSON.stringify(data), b.id);
  return b;
}
const GONE = ["dropletId", "ip", "aRecord", "dnsChecks", "pendingAttempt", "lastSeenAt", "installStep", "serverCreatedAt", "sshKeyAdded", "server", "hosting"];
const views = STEPS as any[];

describe("old server-mode setups load", () => {
  test("parked on the old Server step: moved to Railway, old fields dropped, every screen renders", () => {
    const b = stored("a", { step: "server", phase: "idle", hosting: "digitalocean", brand, domain: { mode: "manual", zone: "acme.test", sub: "app", host: "app.acme.test", confirmed: true }, server: { region: "syd1", size: "s-2vcpu-2gb", price: 18, chosen: true } });
    const s = getSetup(b.id);
    expect(s.step).toBe("railway");
    expect(s.phase).toBe("idle");
    for (const k of GONE) expect(k in s, k).toBe(false);
    expect(s.brand?.productName).toBe("Acme");
    expect(firstOpen(b, s)).toBe("railway");
    for (const v of views) expect(() => wizardPage(b, s, b.code, "sid", v)).not.toThrow();
  });

  test("an install that was running on a droplet goes back to idle on the Railway step", () => {
    const b = stored("b", { step: "install", phase: "installing", brand, dropletId: 123, ip: "203.0.113.5", installStep: "4/10 Building", attempt: 1, aRecord: { key: "a", type: "A", name: "app.acme.test", value: "203.0.113.5", ttl: 300 }, progress: ["Your server is on"] });
    const s = getSetup(b.id);
    expect(s.phase).toBe("idle");
    expect(s.step).toBe("railway");
    expect(s.progress).toEqual([]);
    for (const k of GONE) expect(k in s, k).toBe(false);
    expect(getSetup(b.id)).toEqual(s); // idempotent
    for (const v of views) expect(() => wizardPage(b, s, b.code, "sid", v)).not.toThrow();
  });

  test("a finished server install stays done and its Done screen renders", () => {
    const b = stored("c", { step: "done", phase: "done", brand, dropletId: 9, ip: "203.0.113.9", resultUrl: "https://app.acme.test", domain: { mode: "manual", zone: "acme.test", sub: "app", host: "app.acme.test", confirmed: true }, installedAt: new Date().toISOString() });
    const s = getSetup(b.id);
    expect(s.phase).toBe("done");
    expect(s.resultUrl).toBe("https://app.acme.test");
    for (const k of GONE) expect(k in s, k).toBe(false);
    for (const v of ["done", "install"] as const) expect(() => wizardPage(b, s, b.code, "sid", v)).not.toThrow();
  });

  test("a failed server install is not stuck: it can be started again on Railway", () => {
    const b = stored("d", { step: "install", phase: "create_failed", brand, dropletId: 5, error: "DigitalOcean couldn't start the server." });
    const s = getSetup(b.id);
    expect(s.phase).toBe("idle");
    expect(s.error).toBeUndefined();
    expect(s.step).toBe("railway");
  });
});
