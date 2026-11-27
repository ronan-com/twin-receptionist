import { sql } from "./db";
import { ValidationError } from "./prompt";

export type CustomerBilling = { monthlyCents: number; currency: string; checkoutUrl: string; status: "not_started" | "active" | "past_due" | "cancelled" };
const currencies = ["AUD","USD","NZD","GBP","EUR","CAD"];
const statuses = ["not_started","active","past_due","cancelled"];
export function cleanCustomerBilling(input: any): CustomerBilling {
  const monthlyCents = input?.monthlyCents;
  if (!Number.isSafeInteger(monthlyCents) || monthlyCents < 1 || monthlyCents > 100_000_000) throw new ValidationError("Enter a valid monthly price.");
  if (!currencies.includes(input?.currency)) throw new ValidationError("Choose a supported currency.");
  if (!statuses.includes(input?.status)) throw new ValidationError("Choose a payment status.");
  let u: URL;
  try { u = new URL(String(input?.checkoutUrl || "")); } catch { throw new ValidationError("Paste your Stripe Payment Link."); }
  if (u.protocol !== "https:" || u.hostname !== "buy.stripe.com" || u.port || u.username || u.password || !/^\/[A-Za-z0-9_]+$/.test(u.pathname) || u.toString().length > 1000) throw new ValidationError("Use a Stripe Payment Link from buy.stripe.com.");
  return { monthlyCents, currency: input.currency, checkoutUrl: u.toString(), status: input.status };
}
export async function readCustomerBilling(orgId: string, companyId: string): Promise<CustomerBilling | null> {
  const [r] = await sql`select monthly_cents, currency, checkout_url, status from customer_billing where org_id = ${orgId} and company_id = ${companyId}`;
  return r ? { monthlyCents: Number(r.monthly_cents), currency: r.currency, checkoutUrl: r.checkout_url, status: r.status } : null;
}
export async function writeCustomerBilling(orgId: string, companyId: string, input: any): Promise<CustomerBilling> {
  const b = cleanCustomerBilling(input);
  const rows = await sql`insert into customer_billing (org_id,company_id,monthly_cents,currency,checkout_url,status)
    select org_id,id,${b.monthlyCents},${b.currency},${b.checkoutUrl},${b.status} from companies where id=${companyId} and org_id=${orgId}
    on conflict (company_id) do update set monthly_cents=excluded.monthly_cents,currency=excluded.currency,checkout_url=excluded.checkout_url,status=excluded.status,updated_at=now()
    where customer_billing.org_id=excluded.org_id returning company_id`;
  if (!rows.length) throw new ValidationError("Client is not in your agency.");
  return b;
}
