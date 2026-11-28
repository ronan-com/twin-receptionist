const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Gmail API works over HTTPS with the mailbox owner's authorised Google token.
export async function verifyGmailSend(token: string, address: string, request: typeof fetch = fetch): Promise<void> {
  const response = await request(BASE + "/profile", { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Gmail API could not be verified (HTTP " + response.status + "). Enable Gmail API for your Google app or reconnect the mailbox.");
  const profile = await response.json() as { emailAddress?: string };
  if (profile.emailAddress?.toLowerCase() !== address.toLowerCase()) throw new Error("The Google account does not match this mailbox.");
}

export async function sendGmail(token: string, raw: Buffer, request: typeof fetch = fetch): Promise<void> {
  const response = await request(BASE + "/messages/send", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ raw: raw.toString("base64url") }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("Gmail API refused the send (HTTP " + response.status + ").");
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error("Gmail did not confirm the send.");
}
