import { countryOfNumber, type AvailableNumber, type ConnectedNumber, type NumberCountry, type NumberOrder, type NumberType } from "../src/lib/shared";
import { ValidationError } from "./prompt";
import { TelnyxError, telnyx } from "./telnyx";

// Every Telnyx assistant gets its own voice app. A phone number pointed at that
// app is answered by the assistant, so "connect a number" means "order it onto this app".
export async function voiceAppFor(assistantId: string): Promise<string> {
  const res = await telnyx<any>("GET", `/ai/assistants/${assistantId}`);
  const id = (res.data ?? res)?.telephony_settings?.default_texml_app_id;
  if (!id) throw new TelnyxError(502, "This receptionist isn't set up for calls yet.");
  return String(id);
}

// The number types that can be searched in each country. Telnyx's phone_number_type
// filter takes local, toll_free, mobile, national or shared_cost; the US has no
// "mobile" numbers to buy.
const TYPES: Record<NumberCountry, NumberType[]> = { AU: ["mobile", "local"], US: ["local", "toll_free"] };

/** Reads ?country= and ?type= from a search: Australia unless "US"; a type that country has. */
export function searchFor(country: unknown, type: unknown): { country: NumberCountry; type: NumberType } {
  const c: NumberCountry = country === "US" ? "US" : "AU";
  if (c === "AU") return { country: c, type: type === "mobile" ? "mobile" : "local" };
  return { country: c, type: type === "toll_free" ? "toll_free" : "local" };
}

export const searchableTypes = (country: NumberCountry) => TYPES[country];

/** Checks a picked number is one of ours to buy: +61 and 9 digits, or +1 and 10. */
export function checkBuyable(phoneNumber: string): NumberCountry {
  const country = countryOfNumber(phoneNumber);
  if (!country) throw new ValidationError("Choose an Australian or US number from the list.");
  return country;
}

export async function availableNumbers(type: NumberType, country: NumberCountry = "AU"): Promise<AvailableNumber[]> {
  const query = `filter[country_code]=${country}&filter[phone_number_type]=${type}&filter[limit]=8`;
  const res = await telnyx<{ data?: any[] }>("GET", `/available_phone_numbers?${query}`);
  return (res.data ?? []).map((n) => {
    const features: string[] = (n.features ?? []).map((f: any) => f.name);
    const cost = n.cost_information ?? {};
    return {
      phoneNumber: n.phone_number,
      country,
      type,
      monthly: Number(cost.monthly_cost ?? 0),
      upfront: Number(cost.upfront_cost ?? 0),
      currency: cost.currency ?? "USD",
      // Only Australian mobiles text through our Telnyx path (US numbers need 10DLC registration first).
      sms: features.includes("sms") && /^\+614\d{8}$/.test(n.phone_number),
    };
  });
}

// Stand-ins for local test servers, where the phone account is a pretend one.
// The US ones are in 555-0100 to 0199, which is kept for fiction and never rings anyone.
export function sampleNumbers(type: NumberType, country: NumberCountry = "AU"): AvailableNumber[] {
  if (country === "US") {
    const local = ["+12125550101", "+13125550102", "+14155550103", "+15125550104"];
    const tollFree = ["+18885550101", "+18775550102", "+18665550103", "+18555550104"];
    return (type === "toll_free" ? tollFree : local).map((phoneNumber) => ({
      phoneNumber,
      country,
      type,
      monthly: type === "toll_free" ? 2 : 1,
      upfront: 0,
      currency: "USD",
      // US numbers can text only after 10DLC (or toll-free) registration in Telnyx.
      sms: false,
    }));
  }
  const mobile = ["+61480011201", "+61480011202", "+61480011203", "+61480011204"];
  const local = ["+61255501201", "+61355501202", "+61755501203", "+61855501204"];
  return (type === "mobile" ? mobile : local).map((phoneNumber) => ({
    phoneNumber,
    country,
    type,
    monthly: type === "mobile" ? 6 : 2,
    upfront: 0,
    currency: "USD",
    sms: type === "mobile",
  }));
}

export async function connectedNumbers(voiceAppId: string): Promise<ConnectedNumber[]> {
  const res = await telnyx<{ data?: any[] }>(
    "GET",
    `/phone_numbers?filter[connection_id]=${encodeURIComponent(voiceAppId)}&page[size]=20`,
  );
  return (res.data ?? []).map((n) => ({
    id: n.id,
    phoneNumber: n.phone_number,
    status: n.status ?? "",
    type: n.phone_number_type ?? "",
  }));
}

function toOrder(o: any): NumberOrder {
  return {
    id: o.id,
    status: o.status ?? "",
    requirementsMet: o.requirements_met !== false,
    phoneNumbers: (o.phone_numbers ?? []).map((p: any) => p.phone_number),
    createdAt: o.created_at ?? "",
  };
}

// Orders that Telnyx has not finished yet, usually because it is checking documents.
export async function openOrders(clientId: string): Promise<NumberOrder[]> {
  const res = await telnyx<{ data?: any[] }>(
    "GET",
    `/number_orders?filter[customer_reference]=${encodeURIComponent(clientId)}&page[size]=10`,
  );
  return (res.data ?? []).map(toOrder).filter((o) => o.status === "pending");
}

// This spends money on the Telnyx account, so the caller must pass confirm: true.
export async function buyNumber(voiceAppId: string, clientId: string, input: unknown): Promise<NumberOrder> {
  const body = (input ?? {}) as { phoneNumber?: unknown; confirm?: unknown };
  const phoneNumber = String(body.phoneNumber ?? "");
  checkBuyable(phoneNumber);
  if (body.confirm !== true) throw new ValidationError("Confirm the purchase first.");

  const res = await telnyx<{ data?: any }>("POST", "/number_orders", {
    phone_numbers: [{ phone_number: phoneNumber }],
    connection_id: voiceAppId,
    customer_reference: clientId,
  });
  return toOrder(res.data ?? {});
}

export async function accountBalance(): Promise<{ amount: number; currency: string }> {
  const res = await telnyx<{ data?: any }>("GET", "/balance");
  return { amount: Number(res.data?.available_credit ?? res.data?.balance ?? 0), currency: res.data?.currency ?? "USD" };
}

// Telnyx writes a short summary of each finished call. It appears a little after the call ends.
export async function callSummary(conversationId: string): Promise<string> {
  const res = await telnyx<{ data?: any[] }>("GET", `/ai/conversations/${conversationId}/conversations-insights`);
  for (const group of res.data ?? []) {
    if (group.status !== "completed") continue;
    const text = (group.conversation_insights ?? []).map((i: any) => i.result).find((r: unknown) => typeof r === "string" && r);
    if (text) return text;
  }
  return "";
}
