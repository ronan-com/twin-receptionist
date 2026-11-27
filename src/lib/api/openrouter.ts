import { api } from "./base";

// The agency's OpenRouter key (Connections): the AI that writes website chat, text, email and
// call-summary replies. And which services are running low. Server side: server/llm.ts,
// server/providerStatus.ts, under /api/openrouter-key and /api/provider-status.

export type OpenRouterState = { configured: boolean; source: "own" | "server" | "none"; last4: string; at: string | null };
export type ProviderItem = { provider: "telnyx" | "openrouter" | "twilio" | "vapi" | "database"; balance?: number; currency?: string; low: boolean; url?: string; message: string };

export const openRouterApi = {
  get: () => api.get<OpenRouterState>("/api/openrouter-key"),
  save: (key: string) => api.put<OpenRouterState>("/api/openrouter-key", { key }),
  remove: () => api.del<OpenRouterState>("/api/openrouter-key"),
  status: async () => (await api.get<{ items: ProviderItem[] }>("/api/provider-status")).items,
};

export const openRouterQuery = () => ({ queryKey: ["openrouter-key"] as const, queryFn: openRouterApi.get, staleTime: 30_000 });
export const providerStatusQuery = () => ({ queryKey: ["provider-status"] as const, queryFn: openRouterApi.status, staleTime: 5 * 60_000 });
