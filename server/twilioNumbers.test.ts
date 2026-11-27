// The numbers on a connected Twilio account are all listed (what the Connections page shows after "Check and save").
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/twilioNumbers.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { ownedTwilioNumbers, twilioNumbersFor, type TwilioCreds } from "./twilio";

const creds: TwilioCreds = { accountSid: "AC" + "1".repeat(32), user: "AC" + "1".repeat(32), secret: "s".repeat(32), kind: "token", own: true };
const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

// The shape Twilio really returns for a US number with voice and texts (read from a live account).
const row = (n: string, sid: string) => ({ sid, phone_number: n, friendly_name: n, capabilities: { fax: false, mms: true, sms: true, voice: true }, status: "in-use" });
const stub = (pages: any[]) => {
  const urls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    urls.push(String(url));
    return new Response(JSON.stringify(pages[Math.min(urls.length, pages.length) - 1]), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as any;
  return urls;
};

describe("Twilio numbers", () => {
  test("a number already on the account is listed with its texting and voice abilities, and its owner", async () => {
    stub([{ incoming_phone_numbers: [row("+12272204547", "PN1")], next_page_uri: null }]);
    const list = await twilioNumbersFor(creds, new Map([["+12272204547", "Test Plumbing"]]));
    expect(list).toEqual([{ id: "PN1", phoneNumber: "+12272204547", friendlyName: "+12272204547", type: expect.any(String), sms: true, voice: true, assignedTo: "Test Plumbing" }]);
    const free = await twilioNumbersFor(creds, new Map());
    expect(free[0].assignedTo).toBe("");
  });

  test("an account with more than one page of numbers is listed in full", async () => {
    const urls = stub([
      { incoming_phone_numbers: [row("+12272204547", "PN1")], next_page_uri: "/2010-04-01/Accounts/AC/IncomingPhoneNumbers.json?PageSize=200&Page=1" },
      { incoming_phone_numbers: [row("+12272204548", "PN2")], next_page_uri: null },
    ]);
    expect((await ownedTwilioNumbers(creds)).map((n) => n.phoneNumber)).toEqual(["+12272204547", "+12272204548"]);
    expect(urls[0]).toContain("/IncomingPhoneNumbers.json?PageSize=200");
    expect(urls[1]).toBe("https://api.twilio.com/2010-04-01/Accounts/AC/IncomingPhoneNumbers.json?PageSize=200&Page=1");
  });

  test("Twilio refusing the keys is an error with its reason, not an empty list", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: "Authenticate", code: 20003 }), { status: 401 })) as any;
    await expect(ownedTwilioNumbers(creds)).rejects.toThrow(/Authenticate/);
  });
});
