import type { SupportSettings } from "../shared";
import { api } from "./base";

// Settings, "Support": sharing health and usage stats with the setup provider, and Support access.
// Server side: server/supportSync.ts.
export type SupportChange = { sync?: boolean; access?: { enabled: boolean; for?: "24h" | "7d" | "forever" } };

export const supportApi = {
  get: () => api.get<SupportSettings>("/api/support/settings"),
  save: (change: SupportChange) => api.put<SupportSettings>("/api/support/settings", change),
};
