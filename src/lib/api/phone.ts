import type { PhoneAccount } from "../shared";
import { api } from "./base";

// The agency's own phone account (Setup and Connections). Server side:
// server/phoneAccount.ts under /api/phone-account.

export const phoneApi = {
  get: () => api.get<PhoneAccount>("/api/phone-account"),
  /** Checks a key with Telnyx without saving it. */
  test: (key: string) => api.post<{ ok: true; balance: { amount: number; currency: string } }>("/api/phone-account/test", { key }),
  /** Checks the key, then saves it. */
  connect: (key: string) => api.put<PhoneAccount>("/api/phone-account", { key }),
  disconnect: () => api.del<PhoneAccount>("/api/phone-account"),
};

export const phoneAccountQuery = () => ({ queryKey: ["phone-account"] as const, queryFn: phoneApi.get, staleTime: 30_000 });

export const fmtCredit = (b: { amount: number; currency: string } | null | undefined) =>
  b ? new Intl.NumberFormat("en-US", { style: "currency", currency: b.currency || "USD" }).format(b.amount) : "";
