import type { SupportSettings } from "../shared";
import { api } from "./base";

// Settings, "Support": sharing health and usage stats with the setup provider, and Support access.
// Server side: server/supportSync.ts.
export type SupportChange = { sync?: boolean; edit?: boolean; access?: { enabled: boolean; for?: "24h" | "7d" | "forever" } };

export const supportApi = {
  get: () => api.get<SupportSettings>("/api/support/settings"),
  save: (change: SupportChange) => api.put<SupportSettings>("/api/support/settings", change),
};

// Settings, "Updates": the owner's automatic-updates switch. Server side: server/autoUpdate.ts.
import type { UpdatesStatus } from "../shared";
export type UpdatesChange = { enabled?: boolean; mode?: "overnight" | "asap" };
export type CheckResult = { result: { ok: boolean; started?: boolean; reason?: string; error?: string; version?: string; latest?: string }; status: UpdatesStatus };

export const updatesApi = {
  get: () => api.get<UpdatesStatus>("/api/updates/settings"),
  save: (change: UpdatesChange) => api.put<UpdatesStatus>("/api/updates/settings", change),
  check: () => api.post<CheckResult>("/api/updates/check", {}),
};
