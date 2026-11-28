import { countryOfNumber, typeOfNumber, type AvailableNumber, type NumberCountry, type NumberType, type TwilioNumber, type TwilioRegulatory } from "../src/lib/shared";
import { sql } from "./db";
import { ValidationError } from "./prompt";
import { fakeProvider } from "./sandbox";
import { seal, unseal } from "./secrets";
import { smsHookUrl } from "./smsWebhook";
import { currentOrg } from "./telnyx";

// Twilio as another place a receptionist's phone number can come from (optional).
//
//  - The agency connects its own Twilio account: Account SID plus the Auth Token, or an API
//    Key SID and Secret. Kept sealed in orgs.twilio_creds like the other phone keys. A
//    SINGLE_AGENCY install can instead be given TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN.
//  - Numbers are searched, bought and listed with Twilio's AvailablePhoneNumbers and
//    IncomingPhoneNumbers APIs. Australian numbers need an approved regulatory bundle and an
//    address in Twilio first, so buying shows the same "waiting for approval" state as Telnyx.
//  - Calls on a Twilio number are answered by a Vapi receptionist: Vapi imports it (POST /phone-number,
//    server/voice/vapi.ts). A Telnyx receptionist can't answer its calls.
//  - Texts on any SMS-capable Twilio number can be answered by any receptionist (server/textsControl.ts):
//    only the number's text webhook is set. Those texts go out through Twilio's Messages API (server/sms.ts).

const API = "https://api.twilio.com/2010-04-01";
const NUMBERS_API = "https://numbers.twilio.com/v2";
const PRICING_API = "https://pricing.twilio.com/v1";

export const TWILIO_CONSOLE = "https://console.twilio.com";
export const TWILIO_BUNDLES_URL = `${TWILIO_CONSOLE}/us1/develop/phone-numbers/regulatory-compliance/bundles`;
export const TWILIO_NUMBERS_URL = `${TWILIO_CONSOLE}/us1/develop/phone-numbers/manage/incoming`;

// SINGLE_AGENCY (same test as accounts.singleAgency, kept here so this file stays light).
const singleAgencyOn = () => ["1", "true", "yes", "on"].includes((process.env.SINGLE_AGENCY ?? "").trim().toLowerCase());

export class TwilioError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: number,
  ) {
    super(message);
  }
}

export type TwilioCreds = {
  accountSid: string;
  /** What signs in: the Account SID (with the auth token) or the API Key SID. */
  user: string;
  /** The auth token or the API Key secret. */
  secret: string;
  kind: "token" | "key";
  /** Where they came from: the agency's own, or the install's (SINGLE_AGENCY). */
  own: boolean;
};

// Local test servers (fake provider) accept these pretend credentials, so the screens can be
// clicked through without a Twilio account. A real server never does.
export const TEST_SID = "AC00000000000000000000000000000000";
export const TEST_TOKEN = "00000000000000000000000000000000";
export const isTestTwilio = (c: Pick<TwilioCreds, "accountSid">) => fakeProvider() && c.accountSid === TEST_SID;

const SID = /^AC[0-9a-f]{32}$/i;
const KEY_SID = /^SK[0-9a-f]{32}$/i;

/** Reads what a person typed in: Account SID + Auth Token, or Account SID + API Key SID + Secret. */
export function parseTwilioInput(input: unknown): Omit<TwilioCreds, "own"> {
  const b = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => String(v ?? "").trim();
  const accountSid = str(b.accountSid);
  if (!SID.test(accountSid)) throw new ValidationError("That isn't a Twilio Account SID. It starts with AC and is 34 characters; it's on the front page of the Twilio console.");
  const keySid = str(b.apiKeySid);
  if (keySid || str(b.apiKeySecret)) {
    const secret = str(b.apiKeySecret);
    if (!KEY_SID.test(keySid)) throw new ValidationError("That isn't a Twilio API Key SID. It starts with SK and is 34 characters.");
    if (!secret || /\s/.test(secret) || secret.length < 16 || secret.length > 80) throw new ValidationError("Paste the whole API Key secret. Twilio only shows it once, when the key is made.");
    return { accountSid, user: keySid, secret, kind: "key" };
  }
  const token = str(b.authToken);
  if (!token) throw new ValidationError("Paste the Auth Token (the Account SID's partner on the Twilio console), or use an API Key instead.");
  if (/\s/.test(token) || token.length > 100) throw new ValidationError("That doesn't look like a Twilio Auth Token. Copy it again from the Twilio console: it's one line of 32 letters and numbers.");
  return { accountSid, user: accountSid, secret: token, kind: "token" };
}

// ---- Which credentials ------------------------------------------------------------------

const cache = new Map<string, { creds: TwilioCreds; at: number }>();
export const forgetTwilio = (orgId: string) => cache.delete(orgId);

const sealCreds = (c: Omit<TwilioCreds, "own">) => seal(JSON.stringify({ accountSid: c.accountSid, user: c.user, secret: c.secret, kind: c.kind }));

function envCreds(): TwilioCreds | null {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const token = (process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  if (!accountSid || !token) return null;
  return { accountSid, user: accountSid, secret: token, kind: "token", own: false };
}

/** The agency's Twilio credentials, or null when it has none connected. */
export async function twilioCredsFor(orgId: string | null): Promise<TwilioCreds | null> {
  if (!orgId) return envCreds();
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < 30_000) return hit.creds;
  const [o] = await sql`select twilio_creds from orgs where id = ${orgId}`;
  let creds: TwilioCreds | null = null;
  if (o?.twilio_creds) {
    const j = JSON.parse(unseal(o.twilio_creds));
    creds = { accountSid: j.accountSid, user: j.user, secret: j.secret, kind: j.kind === "key" ? "key" : "token", own: true };
  } else if (singleAgencyOn()) {
    // The one agency of an installed copy runs on the server's own Twilio account, when it has one.
    creds = envCreds();
  }
  if (creds) cache.set(orgId, { creds, at: Date.now() });
  return creds;
}

/** The credentials for the work in hand (the current org), or an error a person can act on. */
export async function requireTwilio(orgId: string | null = currentOrg()): Promise<TwilioCreds> {
  const creds = await twilioCredsFor(orgId);
  if (!creds) throw new ValidationError("Connect your Twilio account first. It's under Connections.");
  return creds;
}

export async function saveTwilio(orgId: string, creds: Omit<TwilioCreds, "own">, name: string): Promise<void> {
  await sql`update orgs set twilio_creds = ${sealCreds(creds)}, twilio_account_sid = ${creds.accountSid}, twilio_last4 = ${creds.secret.slice(-4)}, twilio_name = ${name}, twilio_at = now() where id = ${orgId}`;
  forgetTwilio(orgId);
  smsCache.clear();
}

export async function clearTwilio(orgId: string): Promise<void> {
  await sql`update orgs set twilio_creds = null, twilio_account_sid = null, twilio_last4 = null, twilio_name = null, twilio_at = null where id = ${orgId}`;
  forgetTwilio(orgId);
  smsCache.clear();
}

// ---- The REST calls ---------------------------------------------------------------------

type Form = Record<string, string | undefined>;

/**
 * One call to Twilio. `path` is under the account (/IncomingPhoneNumbers.json) or a full
 * address (Twilio's Numbers and Pricing APIs live on other hosts). POST bodies are forms.
 */
export async function twilio<T = any>(creds: TwilioCreds, method: string, path: string, form?: Form): Promise<T> {
  const url = path.startsWith("http") ? path : `${API}/Accounts/${creds.accountSid}${path}`;
  const body = form ? new URLSearchParams(Object.entries(form).filter((e): e is [string, string] => e[1] !== undefined && (e[1] !== "" || e[0] === "SmsUrl"))) : undefined;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.user}:${creds.secret}`).toString("base64")}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new TwilioError(502, `Could not reach Twilio: ${(err as Error).message}`);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error bodies fall through to the generic message below.
  }
  if (!res.ok) {
    const detail = json?.message || text.slice(0, 200) || res.statusText;
    throw new TwilioError(res.status, `Twilio said: ${detail}`, typeof json?.code === "number" ? json.code : undefined);
  }
  return json as T;
}

/** Whether Twilio accepts these credentials. Returns the account's name. Throws a message a person can act on. */
export async function checkTwilio(creds: TwilioCreds): Promise<{ name: string }> {
  if (isTestTwilio(creds)) return { name: "Test account (local)" };
  try {
    const a = await twilio<{ friendly_name?: string; status?: string }>(creds, "GET", ".json");
    if (a?.status && a.status !== "active") throw new ValidationError(`That Twilio account is ${a.status}. Reactivate it in Twilio first.`);
    return { name: String(a?.friendly_name ?? "") };
  } catch (err) {
    if (err instanceof TwilioError && (err.status === 401 || err.status === 403 || err.status === 404)) {
      throw new ValidationError(
        creds.kind === "key"
          ? "Twilio didn't accept that API Key. Check the Account SID, the Key SID (SK…) and its secret; the key must belong to that account."
          : "Twilio didn't accept those. Check the Account SID and Auth Token on the front page of the Twilio console.",
      );
    }
    throw err;
  }
}

// ---- Numbers ----------------------------------------------------------------------------

const KIND: Record<NumberCountry, Partial<Record<NumberType, string>>> = {
  AU: { local: "Local", mobile: "Mobile" },
  US: { local: "Local", toll_free: "TollFree" },
};
const PRICE_KEY: Record<string, NumberType> = { local: "local", mobile: "mobile", "toll free": "toll_free", toll_free: "toll_free" };

/** Monthly prices by number type, from Twilio's pricing page. Best effort: a miss only hides the price. */
async function monthlyPrices(creds: TwilioCreds, country: NumberCountry): Promise<{ unit: string; prices: Partial<Record<NumberType, number>> }> {
  try {
    const r = await twilio<{ price_unit?: string; phone_number_prices?: { number_type?: string; current_price?: string; base_price?: string }[] }>(creds, "GET", `${PRICING_API}/PhoneNumbers/Countries/${country}`);
    const prices: Partial<Record<NumberType, number>> = {};
    for (const p of r.phone_number_prices ?? []) {
      const t = PRICE_KEY[String(p.number_type ?? "").toLowerCase()];
      if (t) prices[t] = Number(p.current_price ?? p.base_price ?? 0);
    }
    return { unit: r.price_unit ?? "USD", prices };
  } catch {
    return { unit: "USD", prices: {} };
  }
}

/** Numbers Twilio has for sale, in the same shape as the Telnyx search. */
export async function availableTwilioNumbers(creds: TwilioCreds, type: NumberType, country: NumberCountry = "AU"): Promise<AvailableNumber[]> {
  const kind = KIND[country][type];
  if (!kind) return [];
  if (isTestTwilio(creds)) return sampleTwilioAvailable(type, country);
  const query = new URLSearchParams({ PageSize: "8", VoiceEnabled: "true", ...(type === "mobile" ? { SmsEnabled: "true" } : {}) });
  const [res, price] = await Promise.all([
    twilio<{ available_phone_numbers?: any[] }>(creds, "GET", `/AvailablePhoneNumbers/${country}/${kind}.json?${query}`),
    monthlyPrices(creds, country),
  ]);
  return (res.available_phone_numbers ?? []).map((n) => ({
    phoneNumber: String(n.phone_number),
    country,
    type,
    monthly: price.prices[type] ?? 0,
    upfront: 0,
    currency: price.unit,
    sms: Boolean(n.capabilities?.SMS ?? n.capabilities?.sms),
    // address_requirements is "none" when Twilio needs nothing; Australia needs a bundle and an address.
    needsBundle: country === "AU" || (n.address_requirements && n.address_requirements !== "none"),
  }));
}

const toOwned = (n: any): Omit<TwilioNumber, "assignedTo"> => ({
  id: String(n.sid),
  phoneNumber: String(n.phone_number ?? ""),
  friendlyName: String(n.friendly_name ?? n.phone_number ?? ""),
  type: typeOfNumber(String(n.phone_number ?? "")),
  sms: Boolean(n.capabilities?.sms ?? n.capabilities?.SMS),
  voice: Boolean(n.capabilities?.voice ?? n.capabilities?.Voice ?? true),
});

/** The account's numbers as Twilio reports them, webhooks included. Server only: sms_url holds our hook's secret. */
async function twilioNumberRecords(creds: TwilioCreds): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = "/IncomingPhoneNumbers.json?PageSize=200";
  // Twilio pages its answer: follow next_page_uri so an account with more than 200 numbers isn't cut short.
  for (let page = 0; next && page < 5; page++) {
    const res: { incoming_phone_numbers?: any[]; next_page_uri?: string | null } = await twilio(creds, "GET", next.startsWith("/2010-04-01/") ? `https://api.twilio.com${next}` : next);
    out.push(...(res.incoming_phone_numbers ?? []));
    next = res.next_page_uri || null;
  }
  return out;
}

/** Every number on the Twilio account (up to 200 a page, 5 pages). */
export async function ownedTwilioNumbers(creds: TwilioCreds): Promise<Omit<TwilioNumber, "assignedTo">[]> {
  if (isTestTwilio(creds)) return SAMPLE_TWILIO_OWNED;
  return (await twilioNumberRecords(creds)).map(toOwned).filter((n) => n.phoneNumber);
}

/** The Twilio numbers none of the agency's receptionists answers, and the ones that do. */
export async function twilioNumbersFor(creds: TwilioCreds, taken: Map<string, string>): Promise<TwilioNumber[]> {
  const owned = await ownedTwilioNumbers(creds);
  return owned.map((n) => ({ ...n, assignedTo: taken.get(n.phoneNumber) ?? "" })).sort((a, b) => a.phoneNumber.localeCompare(b.phoneNumber));
}

/** Australia's rule: a bundle Twilio has approved, or one still being checked, and where to go to make one. */
export async function twilioRegulatory(creds: TwilioCreds, country: NumberCountry = "AU"): Promise<TwilioRegulatory & { bundles: { sid: string; type: string }[]; addressSid: string }> {
  const none = { approved: country !== "AU", inReview: 0, consoleUrl: TWILIO_BUNDLES_URL, bundles: [], addressSid: "" };
  if (country !== "AU") return none;
  if (isTestTwilio(creds)) return { ...none, approved: true };
  const bundles: any[] = (await twilio<{ results?: any[] }>(creds, "GET", `${NUMBERS_API}/RegulatoryCompliance/Bundles?IsoCountry=AU&PageSize=50`).catch(() => ({ results: [] }))).results ?? [];
  const approved = bundles.filter((b) => b.status === "twilio-approved");
  const inReview = bundles.filter((b) => b.status === "pending-review" || b.status === "in-review").length;
  let addressSid = "";
  if (approved.length) {
    const a = await twilio<{ addresses?: { sid: string }[] }>(creds, "GET", "/Addresses.json?IsoCountry=AU&PageSize=5").catch(() => ({ addresses: [] }));
    addressSid = a.addresses?.[0]?.sid ?? "";
  }
  return { approved: approved.length > 0, inReview, consoleUrl: TWILIO_BUNDLES_URL, bundles: approved.map((b) => ({ sid: String(b.sid), type: String(b.number_type ?? "") })), addressSid };
}

/** Buys one number on the agency's Twilio account. Spends money: needs input.confirm === true. */
export async function buyTwilioNumber(creds: TwilioCreds, input: unknown, label: string): Promise<{ sid: string; phoneNumber: string }> {
  const b = (input ?? {}) as { phoneNumber?: unknown; confirm?: unknown };
  const phoneNumber = String(b.phoneNumber ?? "");
  const country = countryOfNumber(phoneNumber);
  if (!country) throw new ValidationError("Choose an Australian or US number from the list.");
  if (b.confirm !== true) throw new ValidationError("Confirm the purchase first.");
  if (isTestTwilio(creds)) return { sid: `PN${"0".repeat(30)}${phoneNumber.slice(-2)}`, phoneNumber };

  const form: Form = { PhoneNumber: phoneNumber, FriendlyName: label.slice(0, 64) };
  if (country === "AU") {
    const reg = await twilioRegulatory(creds, "AU");
    if (!reg.approved) {
      throw new ValidationError(
        reg.inReview
          ? "Your Australian regulatory bundle is still waiting for Twilio's approval. Once Twilio approves it (usually 1 to 3 business days) you can buy the number here."
          : `Twilio needs an approved regulatory bundle (business details and proof of address) before it will sell an Australian number. Create one in the Twilio console: ${reg.consoleUrl}`,
      );
    }
    const wanted = typeOfNumber(phoneNumber);
    const bundle = reg.bundles.find((x) => x.type === wanted) ?? reg.bundles[0];
    if (!reg.addressSid) throw new ValidationError(`Add your business address in the Twilio console first (Phone Numbers, Regulatory Compliance, Addresses): ${TWILIO_CONSOLE}`);
    form.BundleSid = bundle.sid;
    form.AddressSid = reg.addressSid;
  }
  try {
    const n = await twilio<{ sid: string; phone_number: string }>(creds, "POST", "/IncomingPhoneNumbers.json", form);
    return { sid: n.sid, phoneNumber: n.phone_number };
  } catch (err) {
    if (err instanceof TwilioError && err.status === 401) throw new ValidationError("Twilio refused the purchase: this account can't buy numbers (a trial account has to be upgraded first).");
    throw err;
  }
}

// ---- Texts ------------------------------------------------------------------------------

/** Sends one text from a number on the Twilio account. */
export async function sendTwilioSms(creds: TwilioCreds, from: string, to: string, text: string): Promise<string> {
  if (isTestTwilio(creds)) return "SM-test";
  const r = await twilio<{ sid: string }>(creds, "POST", "/Messages.json", { From: from, To: to, Body: text });
  return r.sid;
}

/**
 * Points a Twilio number's incoming texts at our text chatbot (server/smsBot.ts): sets its SmsUrl.
 * Only voice stays with Vapi (it is imported with smsEnabled: false so it leaves the texting
 * address alone). Best effort: false when there's nothing to do (no public address, a number that
 * can't text, not on this account), never an error that would undo an attach.
 */
export async function pointTextsAtUs(creds: TwilioCreds, clientId: string, phoneNumber: string, url = smsHookUrl("twilio", clientId)): Promise<boolean> {
  if (!url || isTestTwilio(creds)) return false;
  try {
    const owned = await ownedTwilioNumbers(creds);
    const n = owned.find((x) => x.phoneNumber === phoneNumber);
    if (!n || !n.sms) return false;
    await twilio(creds, "POST", `/IncomingPhoneNumbers/${n.id}.json`, { SmsUrl: url, SmsMethod: "POST" });
    return true;
  } catch (err) {
    console.error(`[twilio ${clientId}] couldn't point texts at the receptionist for ${phoneNumber}:`, (err as Error).message);
    return false;
  }
}

/** Whether a number's text address is this receptionist's hook (on any public address). */
const isOurHook = (url: unknown, clientId: string) => String(url ?? "").includes(`/hooks/sms/twilio/${clientId}/`);

/**
 * Takes the text address off a number again (a number let go of a receptionist). Only our own address for
 * this receptionist is cleared, never one another receptionist (or another service) put there. Best effort.
 */
export async function releaseTexts(creds: TwilioCreds, clientId: string, phoneNumber: string): Promise<void> {
  if (isTestTwilio(creds)) return;
  try {
    const n = (await twilioNumberRecords(creds)).find((x) => x.phone_number === phoneNumber);
    if (n && isOurHook(n.sms_url, clientId)) await twilio(creds, "POST", `/IncomingPhoneNumbers/${n.sid}.json`, { SmsUrl: "", SmsMethod: "POST" });
  } catch (err) {
    console.error(`[twilio ${clientId}] couldn't release texts for ${phoneNumber}:`, (err as Error).message);
  }
}

/** Why texts to this number wouldn't reach the receptionist, in plain words; null when they will. */
export async function textHookProblem(creds: TwilioCreds, clientId: string, phoneNumber: string): Promise<{ detail: string; retry: boolean } | null> {
  if (isTestTwilio(creds)) return null;
  const url = smsHookUrl("twilio", clientId);
  if (!url) return { detail: "This server has no public web address yet, so Twilio can't pass texts to it.", retry: true };
  let n: any;
  try {
    n = (await twilioNumberRecords(creds)).find((x) => x.phone_number === phoneNumber);
  } catch (err) {
    return { detail: `Couldn't check with Twilio. ${(err as Error).message}`, retry: true };
  }
  if (!n) return { detail: `${phoneNumber} isn't on your Twilio account any more. Choose another number.`, retry: false };
  if (!toOwned(n).sms) return { detail: `${phoneNumber} can't send or receive texts. Choose another number.`, retry: false };
  if (n.sms_application_sid) return { detail: "A TwiML app in Twilio takes this number's texts. In Twilio, set its messaging to Webhook, then try again.", retry: true };
  if (n.sms_url !== url) return { detail: "Twilio isn't sending this number's texts here. Try again.", retry: true };
  return null;
}

/**
 * After the public address changes (a new PUBLIC_URL, or the custom domain starting to answer): moves our
 * text address on each wanted number to the new one. A number is only touched when it already points at that
 * receptionist (or was picked for it and points nowhere). Voice settings are never sent.
 */
export async function moveTextHooks(creds: TwilioCreds, wanted: { clientId: string; number: string; picked: boolean }[]): Promise<number> {
  if (isTestTwilio(creds) || !wanted.length) return 0;
  const records = await twilioNumberRecords(creds);
  let moved = 0;
  for (const w of wanted) {
    const n = records.find((x) => x.phone_number === w.number);
    const url = smsHookUrl("twilio", w.clientId);
    if (!n || !url || !toOwned(n).sms || n.sms_url === url) continue;
    if (!isOurHook(n.sms_url, w.clientId) && !(w.picked && !n.sms_url)) continue;
    await twilio(creds, "POST", `/IncomingPhoneNumbers/${n.sid}.json`, { SmsUrl: url, SmsMethod: "POST" })
      .then(() => moved++)
      .catch((err) => console.error(`[twilio ${w.clientId}] couldn't move the text address of ${w.number}:`, (err as Error).message));
  }
  return moved;
}

const smsCache = new Map<string, { number: string | null; at: number }>();

/**
 * The number of the receptionist that can send texts through Twilio: one of its numbers that
 * is on the agency's Twilio account with texting. null: it has none; throws if Twilio can't be asked.
 */
export async function twilioSmsNumber(orgId: string | null, numbers: string[]): Promise<string | null> {
  if (!numbers.length) return null;
  const creds = await twilioCredsFor(orgId);
  if (!creds) return null;
  const key = `${creds.accountSid}|${numbers.join(",")}`;
  const hit = smsCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.number;
  const owned = await ownedTwilioNumbers(creds);
  const found = owned.find((n) => n.sms && numbers.includes(n.phoneNumber))?.phoneNumber ?? null;
  smsCache.set(key, { number: found, at: Date.now() });
  return found;
}

// ---- Stand-ins for local test servers ----------------------------------------------------

export const SAMPLE_TWILIO_OWNED: Omit<TwilioNumber, "assignedTo">[] = [
  { id: "PN00000000000000000000000000000001", phoneNumber: "+61480011301", friendlyName: "0480 011 301", type: "mobile", sms: true, voice: true },
  { id: "PN00000000000000000000000000000002", phoneNumber: "+61255501301", friendlyName: "(02) 5550 1301", type: "local", sms: false, voice: true },
];

function sampleTwilioAvailable(type: NumberType, country: NumberCountry): AvailableNumber[] {
  const list = country === "US" ? (type === "toll_free" ? ["+18885550111", "+18775550112"] : ["+12125550111", "+13125550112"]) : type === "mobile" ? ["+61480011311", "+61480011312", "+61480011313"] : ["+61255501311", "+61355501312", "+61755501313"];
  return list.map((phoneNumber) => ({ phoneNumber, country, type, monthly: type === "mobile" ? 6.5 : 3, upfront: 0, currency: "USD", sms: type === "mobile", needsBundle: country === "AU" }));
}
