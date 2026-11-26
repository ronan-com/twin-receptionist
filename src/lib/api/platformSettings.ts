import type { PlatformSettings, PlatformTestResult } from "../shared";
import { api } from "./base";

// The platform admin's email sender and Google/Microsoft apps (Settings, "Email and
// calendars"). Server side: server/platformSettingsApi.ts.

export type PlatformService = "mail" | "google" | "microsoft";

const base = "/api/admin/platform-settings";

export const platformSettingsApi = {
  get: () => api.get<PlatformSettings>(base),
  save: (service: PlatformService, input: Record<string, string>) => api.put<PlatformSettings>(`${base}/${service}`, input),
  /** Back to the server's own setting (or off). */
  clear: (service: PlatformService) => api.del<PlatformSettings>(`${base}/${service}`),
  /** Checks the values typed in (or, left empty, the ones in use). Email: sends a test to the signed-in admin. */
  test: (service: PlatformService, input: Record<string, string>) => api.post<PlatformTestResult>(`${base}/${service}/test`, input),
};

export const platformSettingsQuery = () => ({ queryKey: ["admin", "platform-settings"] as const, queryFn: platformSettingsApi.get });
