import type { Business } from "../src/lib/shared";
import type { OwnedNumber } from "../src/lib/ownNumbers";
import { isDemo } from "./sandbox";
import { ValidationError } from "./prompt";
import { TelnyxError, telnyx } from "./telnyx";
import { voiceAppFor } from "./numbers";

// Using a phone number the agency already owns on its Telnyx account: list the ones
// that aren't answering for one of our receptionists, point one at a receptionist,
// or let one go again (it stays on the Telnyx account, just not connected to anything).
// Only for an agency on its own account (phoneAccount.canUseOwnNumbers): the platform's key
// can see every agency's numbers.

const toOwned = (n: any): OwnedNumber => ({
  id: String(n.id),
  phoneNumber: String(n.phone_number ?? ""),
  type: String(n.phone_number_type ?? ""),
  status: String(n.status ?? ""),
  connectionId: n.connection_id ? String(n.connection_id) : "",
  connectionName: n.connection_name ? String(n.connection_name) : "",
});

const GONE = (status: string) => status === "deleted" || status.endsWith("-failed");

/** The voice app of every receptionist the agency has, by receptionist. A receptionist Telnyx can't find is left out. */
export async function ourVoiceApps(clients: Business[]): Promise<Map<string, Business>> {
  const apps = new Map<string, Business>();
  await Promise.all(
    clients
      .filter((c) => !isDemo(c.assistantId))
      .map(async (c) => {
        try {
          apps.set(await voiceAppFor(c.assistantId), c);
        } catch (err) {
          console.error(`[own numbers ${c.id}] no voice app:`, (err as Error).message);
        }
      }),
  );
  return apps;
}

async function accountNumbers(): Promise<any[]> {
  const out: any[] = [];
  // 250 a page; an agency with more than 500 numbers has bigger things to sort out.
  for (let page = 1; page <= 2; page++) {
    const res = await telnyx<{ data?: any[]; meta?: { total_pages?: number } }>("GET", `/phone_numbers?page[size]=250&page[number]=${page}`);
    out.push(...(res.data ?? []));
    if (page >= (res.meta?.total_pages ?? 1)) break;
  }
  return out;
}

/** Numbers on the agency's Telnyx account that none of its receptionists answers. */
export async function ownedUnassigned(clients: Business[]): Promise<OwnedNumber[]> {
  const [all, apps] = await Promise.all([accountNumbers(), ourVoiceApps(clients)]);
  return all
    .map(toOwned)
    .filter((n) => n.phoneNumber && !GONE(n.status) && !apps.has(n.connectionId))
    .sort((a, b) => a.phoneNumber.localeCompare(b.phoneNumber));
}

function numberIdOf(input: unknown): string {
  const id = String((input as { numberId?: unknown })?.numberId ?? "");
  // Telnyx ids are numeric strings or UUIDs; this keeps anything else out of the request path.
  if (!/^[A-Za-z0-9-]{4,64}$/.test(id)) throw new ValidationError("Choose one of your numbers from the list.");
  return id;
}

async function findNumber(id: string): Promise<OwnedNumber> {
  try {
    const res = await telnyx<{ data?: any }>("GET", `/phone_numbers/${id}`);
    if (!res?.data?.id) throw new ValidationError("That number isn't on your Telnyx account.");
    return toOwned(res.data);
  } catch (err) {
    if (err instanceof TelnyxError && (err.status === 404 || err.status === 422)) throw new ValidationError("That number isn't on your Telnyx account.");
    throw err;
  }
}

/**
 * Points a number the agency owns at a receptionist. A number that's connected to
 * something else (another Telnyx app, a SIP connection) is moved off it, so the caller
 * must pass confirm: true for that.
 */
export async function attachNumber(clients: Business[], client: Business, input: unknown): Promise<{ number: OwnedNumber; movedFrom: string }> {
  const id = numberIdOf(input);
  const confirmed = (input as { confirm?: unknown })?.confirm === true;
  const voiceApp = await voiceAppFor(client.assistantId);
  const num = await findNumber(id);
  if (GONE(num.status)) throw new ValidationError("That number isn't active on your Telnyx account.");
  if (num.connectionId === voiceApp) throw new ValidationError("That number already answers for this receptionist.");

  const apps = await ourVoiceApps(clients);
  const other = apps.get(num.connectionId);
  if (other) {
    throw new ValidationError(`That number already answers for ${other.settings.receptionistName || other.settings.businessName || "another receptionist"}. Disconnect it there first.`);
  }
  const from = num.connectionId ? num.connectionName || "another connection" : "";
  if (from && !confirmed) throw new ValidationError(`That number is connected to ${from}. Confirm to move it off ${from}.`);

  await telnyx("PATCH", `/phone_numbers/${id}`, { connection_id: voiceApp });
  return { number: { ...num, connectionId: voiceApp, connectionName: "" }, movedFrom: from };
}

/**
 * Lets a number go from a receptionist. The number stays on the Telnyx account and
 * keeps billing there; it just stops being answered.
 */
export async function detachNumber(client: Business, input: unknown): Promise<OwnedNumber> {
  const id = numberIdOf(input);
  const voiceApp = await voiceAppFor(client.assistantId);
  const num = await findNumber(id);
  if (num.connectionId !== voiceApp) throw new ValidationError("That number isn't connected to this receptionist.");

  // Telnyx's API describes connection_id as a plain string with no word on clearing it, so
  // ask the way the spec allows (an empty string), check it took, and only then try null.
  for (const empty of ["", null]) {
    await telnyx("PATCH", `/phone_numbers/${id}`, { connection_id: empty }).catch((err) => {
      if (!(err instanceof TelnyxError && err.status === 422)) throw err;
    });
    if (!(await findNumber(id)).connectionId) return { ...num, connectionId: "", connectionName: "" };
  }
  throw new ValidationError("Telnyx wouldn't disconnect that number from here. Open the number in Telnyx and remove its connection there.");
}

// Stand-ins for local test servers, where the phone account is a pretend one.
export const SAMPLE_OWNED: OwnedNumber[] = [
  { id: "sample-1", phoneNumber: "+61480011299", type: "mobile", status: "active", connectionId: "", connectionName: "" },
  { id: "sample-2", phoneNumber: "+61255501299", type: "local", status: "active", connectionId: "sip-old", connectionName: "Old office phones" },
];

export function sampleOwned(clients: Business[]): OwnedNumber[] {
  const taken = new Set(clients.flatMap((c) => c.phoneNumbers ?? []));
  return SAMPLE_OWNED.filter((n) => !taken.has(n.phoneNumber));
}
