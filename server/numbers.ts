import type { AvailableNumber, ConnectedNumber, NumberOrder, NumberType } from "../src/lib/shared";
import { ValidationError } from "./prompt";
import { TelnyxError, telnyx } from "./telnyx";

// Every Telnyx assistant gets its own voice app. A phone number pointed at that
// app is answered by the assistant, so "connect a number" means "order it onto this app".
export async function voiceAppFor(assistantId: string): Promise<string> {
  const res = await telnyx<any>("GET", `/ai/assistants/${assistantId}`);
  const id = (res.data ?? res)?.telephony_settings?.default_texml_app_id;
  if (!id) throw new TelnyxError(502, "This receptionist has no voice app on Telnyx yet.");
  return String(id);
}

export async function availableNumbers(type: NumberType): Promise<AvailableNumber[]> {
  const query = `filter[country_code]=AU&filter[phone_number_type]=${type}&filter[limit]=8`;
  const res = await telnyx<{ data?: any[] }>("GET", `/available_phone_numbers?${query}`);
  return (res.data ?? []).map((n) => {
    const features: string[] = (n.features ?? []).map((f: any) => f.name);
    const cost = n.cost_information ?? {};
    return {
      phoneNumber: n.phone_number,
      type,
      monthly: Number(cost.monthly_cost ?? 0),
      upfront: Number(cost.upfront_cost ?? 0),
      currency: cost.currency ?? "USD",
      sms: features.includes("sms"),
    };
  });
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
  if (!/^\+61\d{9}$/.test(phoneNumber)) throw new ValidationError("Choose an Australian number from the list.");
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
