// bun test download-site/test/smtpguard.test.ts
// The "other SMTP" test connection must never reach a private, loopback, link-local or cloud-metadata address.
import { describe, expect, test } from "bun:test";

process.env.SETUP_SECRET_KEY ||= Buffer.alloc(32, 1).toString("base64");
const { isPrivateAddress, publicSmtpAddress } = await import("../providers");

describe("smtp host guard", () => {
  test("which addresses count as private", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip", "300.1.1.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "100.63.0.1", "203.0.113.5", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip)).toBe(false);
  });
  test("the host is resolved once; any private answer refuses it; the public address is the one to connect to", async () => {
    expect(await publicSmtpAddress("smtp.example.com", async () => [{ address: "2606:4700::1111" }, { address: "203.0.113.5" }])).toEqual({ ok: true, ip: "203.0.113.5" });
    const priv = await publicSmtpAddress("sneaky.example.com", async () => [{ address: "203.0.113.5" }, { address: "169.254.169.254" }]);
    expect(priv.ok).toBe(false);
    expect((await publicSmtpAddress("localhost.example.com", async () => [{ address: "127.0.0.1" }])).ok).toBe(false);
    const gone = await publicSmtpAddress("nope.example.com", async () => { throw new Error("ENOTFOUND"); });
    expect(gone).toMatchObject({ ok: false });
    expect((await publicSmtpAddress("empty.example.com", async () => [])).ok).toBe(false);
  });
});
