import type { PhoneAccount, VoiceProviderId } from "../shared";
import { api } from "./base";

// The agency's own phone account (Setup and Connections). Server side:
// server/phoneAccount.ts under /api/phone-account.

/** Telnyx needs only the key. Vapi also needs its public key, for the browser test call. */
export type PhoneKeys = { provider?: VoiceProviderId; publicKey?: string };

export const phoneApi = {
  get: () => api.get<PhoneAccount>("/api/phone-account"),
  /** Checks a key with the voice engine without saving it. */
  test: (key: string, extra: PhoneKeys = {}) => api.post<{ ok: true; balance: { amount: number; currency: string } | null }>("/api/phone-account/test", { key, ...extra }),
  /** Checks the key (Vapi: the private and public keys), then saves it and makes it the agency's engine. */
  connect: (key: string, extra: PhoneKeys = {}) => api.put<PhoneAccount>("/api/phone-account", { key, ...extra }),
  disconnect: () => api.del<PhoneAccount>("/api/phone-account"),
};

export const phoneAccountQuery = () => ({ queryKey: ["phone-account"] as const, queryFn: phoneApi.get, staleTime: 30_000 });

export const fmtCredit = (b: { amount: number; currency: string } | null | undefined) =>
  b ? new Intl.NumberFormat("en-US", { style: "currency", currency: b.currency || "USD" }).format(b.amount) : "";
