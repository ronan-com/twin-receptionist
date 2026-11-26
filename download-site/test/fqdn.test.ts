// bun test download-site/test/fqdn.test.ts
// Resend's record names are relative to the registered root domain. providers.ts fqdn() must give the
// full DNS names for an apex sending domain, a subdomain, and a wizard zone that is itself a subdomain.
import { describe, expect, test } from "bun:test";

process.env.SETUP_SECRET_KEY ||= Buffer.alloc(32, 1).toString("base64");
const { fqdn } = await import("../providers");

describe("fqdn", () => {
  test("apex sending domain", () => {
    expect(fqdn("resend._domainkey", "chloeeai.co", "chloeeai.co")).toBe("resend._domainkey.chloeeai.co");
    expect(fqdn("send", "chloeeai.co", "chloeeai.co")).toBe("send.chloeeai.co");
    expect(fqdn("@", "chloeeai.co", "chloeeai.co")).toBe("chloeeai.co");
  });
  test("mail. subdomain of an apex zone", () => {
    expect(fqdn("resend._domainkey.mail", "mail.chloeeai.co", "chloeeai.co")).toBe("resend._domainkey.mail.chloeeai.co");
    expect(fqdn("send.mail", "mail.chloeeai.co", "chloeeai.co")).toBe("send.mail.chloeeai.co");
    expect(fqdn("send", "mail.chloeeai.co", "chloeeai.co")).toBe("send.mail.chloeeai.co"); // relative to the domain itself
  });
  test("wizard zone that is itself a subdomain (t1.chloeeai.co), names relative to the root chloeeai.co", () => {
    expect(fqdn("resend._domainkey.mail.t1", "mail.t1.chloeeai.co", "t1.chloeeai.co")).toBe("resend._domainkey.mail.t1.chloeeai.co");
    expect(fqdn("send.mail.t1", "mail.t1.chloeeai.co", "t1.chloeeai.co")).toBe("send.mail.t1.chloeeai.co");
    expect(fqdn("resend._domainkey.t1", "t1.chloeeai.co", "t1.chloeeai.co")).toBe("resend._domainkey.t1.chloeeai.co");
    expect(fqdn("send.t1", "t1.chloeeai.co", "t1.chloeeai.co")).toBe("send.t1.chloeeai.co");
  });
  test("three-label roots and already-full names are not changed or doubled", () => {
    expect(fqdn("send.mail", "mail.example.com.au", "example.com.au")).toBe("send.mail.example.com.au");
    expect(fqdn("send.mail.t1.chloeeai.co", "mail.t1.chloeeai.co", "t1.chloeeai.co")).toBe("send.mail.t1.chloeeai.co");
    expect(fqdn("send.mail.chloeeai.co.", "mail.chloeeai.co", "chloeeai.co")).toBe("send.mail.chloeeai.co");
  });
});
