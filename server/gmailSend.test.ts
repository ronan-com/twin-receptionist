import { expect, test } from "bun:test";
import { verifyGmailSend, sendGmail } from "./gmailSend";
const mock = (fn: (url: string, init?: RequestInit) => Response): typeof fetch => ((url: string, init?: RequestInit) => Promise.resolve(fn(url, init))) as typeof fetch;
test("Gmail verifies the authorised mailbox without sending", async () => {
  await verifyGmailSend("mock-token", "buyer@example.test", mock((url, init) => {
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/profile");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer mock-token");
    return Response.json({ emailAddress: "buyer@example.test" });
  }));
  await expect(verifyGmailSend("mock-token", "buyer@example.test", mock(() => Response.json({ emailAddress: "other@example.test" })))).rejects.toThrow(/does not match/);
  await expect(verifyGmailSend("mock-token", "buyer@example.test", mock(() => new Response("", { status: 403 })))).rejects.toThrow(/Enable Gmail API/);
});
test("Gmail send sends MIME over HTTPS and requires confirmation", async () => {
  const raw = Buffer.from("From: buyer@example.test\r\nTo: sample@example.test\r\n\r\nTest");
  await sendGmail("mock-token", raw, mock((url, init) => {
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer mock-token");
    expect(Buffer.from(JSON.parse(String(init?.body)).raw, "base64url")).toEqual(raw);
    return Response.json({ id: "mock-id" });
  }));
  await expect(sendGmail("mock-token", raw, mock(() => new Response("", { status: 429 })))).rejects.toThrow(/429/);
  await expect(sendGmail("mock-token", raw, mock(() => Response.json({})))).rejects.toThrow(/did not confirm/);
});
