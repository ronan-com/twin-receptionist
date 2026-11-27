import type { AvailableNumber, NumberCountry, NumberType, TwilioAccount, TwilioNumber, TwilioRegulatory } from "../shared";
import { api } from "./base";

// The agency's Twilio account (Connections) and its numbers. Server side: server/twilio.ts and
// server/phoneAccount.ts, under /api/twilio-account and /api/numbers/twilio.

/** Account SID plus the Auth Token, or plus an API Key SID and secret. */
export type TwilioKeys = { accountSid: string; authToken?: string; apiKeySid?: string; apiKeySecret?: string };

export const twilioApi = {
  get: () => api.get<TwilioAccount>("/api/twilio-account"),
  /** Checks the credentials with Twilio without saving them. With none, checks the account already in use. */
  test: (keys: Partial<TwilioKeys> = {}) => api.post<{ ok: true; name: string; source: "typed" | "saved" | "server" }>("/api/twilio-account/test", keys),
  connect: (keys: TwilioKeys) => api.put<TwilioAccount>("/api/twilio-account", keys),
  disconnect: () => api.del<TwilioAccount>("/api/twilio-account"),
  numbers: () => api.get<{ numbers: TwilioNumber[]; regulatory: TwilioRegulatory; test: boolean }>("/api/numbers/twilio"),
  available: async (type: NumberType, country: NumberCountry) => (await api.get<{ numbers: AvailableNumber[] }>(`/api/numbers/twilio/available?country=${country}&type=${type}`)).numbers,
};

export const twilioAccountQuery = () => ({ queryKey: ["twilio-account"] as const, queryFn: twilioApi.get, staleTime: 30_000 });
