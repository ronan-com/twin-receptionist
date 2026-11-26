// US and Australian numbers: searching, checking a pick, and showing them.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/numbers.test.ts
import { describe, expect, test } from "bun:test";
import { countryForTimezone, countryOfNumber, formatNumber, typeOfNumber } from "../src/lib/shared";
import { checkBuyable, sampleNumbers, searchFor } from "./numbers";
import { mailboxSignInAllowed, mailboxSignInSetting, requestedScopes } from "./oauth";

describe("number country", () => {
  test("comes from the receptionist's time zone", () => {
    expect(countryForTimezone("Australia/Brisbane")).toBe("AU");
    expect(countryForTimezone("America/New_York")).toBe("US");
    expect(countryForTimezone("Pacific/Honolulu")).toBe("US");
    expect(countryForTimezone("Europe/London")).toBe("AU");
    expect(countryForTimezone(undefined)).toBe("AU");
  });

  test("search keeps Australia as it was and gives the US local or toll-free", () => {
    expect(searchFor(null, "mobile")).toEqual({ country: "AU", type: "mobile" });
    expect(searchFor("AU", "toll_free")).toEqual({ country: "AU", type: "local" });
    expect(searchFor("US", "mobile")).toEqual({ country: "US", type: "local" });
    expect(searchFor("US", "toll_free")).toEqual({ country: "US", type: "toll_free" });
  });

  test("a pick must be +61 and 9 digits or +1 and 10", () => {
    expect(checkBuyable("+61480011201")).toBe("AU");
    expect(checkBuyable("+12125550101")).toBe("US");
    expect(() => checkBuyable("+6148001120")).toThrow();
    expect(() => checkBuyable("+1212555010")).toThrow();
    expect(() => checkBuyable("+11125550101")).toThrow();
    expect(() => checkBuyable("+447700900123")).toThrow();
    expect(countryOfNumber("+18885550101")).toBe("US");
  });

  test("stand-in numbers for both countries; US ones never text", () => {
    for (const n of sampleNumbers("local", "US")) expect([countryOfNumber(n.phoneNumber), n.sms]).toEqual(["US", false]);
    for (const n of sampleNumbers("toll_free", "US")) expect(typeOfNumber(n.phoneNumber)).toBe("toll_free");
    expect(sampleNumbers("mobile").every((n) => n.phoneNumber.startsWith("+614") && n.sms)).toBe(true);
  });

  test("one format per country", () => {
    expect(formatNumber("+61480011201")).toBe("0480 011 201");
    expect(formatNumber("+61255501201")).toBe("(02) 5550 1201");
    expect(formatNumber("+12125550101")).toBe("(212) 555-0101");
    expect(formatNumber("+447700900123")).toBe("+447700900123");
  });
});

describe("MAILBOX_SIGNIN", () => {
  const set = (v: string | undefined) => (v === undefined ? delete process.env.MAILBOX_SIGNIN : (process.env.MAILBOX_SIGNIN = v));
  test("explicit values", async () => {
    const before = process.env.MAILBOX_SIGNIN;
    try {
      set("off");
      expect(await mailboxSignInAllowed()).toEqual({ google: false, microsoft: false });
      set("google");
      expect(await mailboxSignInAllowed()).toEqual({ google: true, microsoft: false });
      set("Both");
      expect(await mailboxSignInAllowed()).toEqual({ google: true, microsoft: true });
      set("microsoft");
      expect(await mailboxSignInAllowed()).toEqual({ google: false, microsoft: true });
      set("nonsense");
      expect(mailboxSignInSetting()).toBeNull();
    } finally {
      set(before);
    }
  });
  test("not set: Google calendar only, Microsoft mailboxes on; the scopes listed are exactly those asked for", async () => {
    const before = process.env.MAILBOX_SIGNIN;
    try {
      set(undefined);
      expect(await mailboxSignInAllowed()).toEqual({ google: false, microsoft: true });
      expect(await requestedScopes("google")).toEqual(["openid", "email", "https://www.googleapis.com/auth/calendar.events"]);
      set("both");
      expect(await requestedScopes("google")).toContain("https://mail.google.com/");
    } finally {
      set(before);
    }
  });
});

describe("SINGLE_AGENCY", () => {
  test("off unless set; on, an agency owner may change the server settings and Setup's own key isn't required", async () => {
    const { singleAgency, canChangeServerSettings } = await import("./accounts");
    const { ownAccountRequired } = await import("./phoneAccount");
    const before = { s: process.env.SINGLE_AGENCY, o: process.env.OWN_PHONE_ACCOUNT };
    const owner = { tokenHash: "", user: { id: "u", email: "o@x.test", name: "O", platformAdmin: false }, org: { id: "o", name: "Org" }, role: "owner" as const };
    try {
      process.env.OWN_PHONE_ACCOUNT = "required";
      delete process.env.SINGLE_AGENCY;
      expect([singleAgency(), canChangeServerSettings(owner), ownAccountRequired()]).toEqual([false, false, true]);
      process.env.SINGLE_AGENCY = "1";
      expect([singleAgency(), canChangeServerSettings(owner), ownAccountRequired()]).toEqual([true, true, false]);
      expect(canChangeServerSettings({ ...owner, role: "admin" })).toBe(false);
    } finally {
      if (before.s === undefined) delete process.env.SINGLE_AGENCY;
      else process.env.SINGLE_AGENCY = before.s;
      if (before.o === undefined) delete process.env.OWN_PHONE_ACCOUNT;
      else process.env.OWN_PHONE_ACCOUNT = before.o;
    }
  });
});
