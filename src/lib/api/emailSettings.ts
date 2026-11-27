import type { EmailSettings, PlatformTestResult } from "../shared";
import { api } from "./base";

// Settings, "Email": the main and backup sender for account emails. Server side: server/emailSettings.ts.

const base = "/api/admin/email-settings";
export type SenderWhich = "primary" | "backup";

export const emailSettingsApi = {
  get: () => api.get<EmailSettings>(base),
  /** Signs in to the account for real before saving it. */
  save: (which: SenderWhich, input: Record<string, string>) => api.put<EmailSettings>(`${base}/${which}`, input),
  /** primary: back to the server's own setting (or off). backup: no backup. */
  clear: (which: SenderWhich) => api.del<EmailSettings>(`${base}/${which}`),
  /** Sends a test to the signed-in person: through the main sender then the backup, or just one of them. */
  test: (which?: SenderWhich) => api.post<PlatformTestResult>(`${base}/test`, which ? { which } : {}),
};

export const emailSettingsQuery = () => ({ queryKey: ["admin", "email-settings"] as const, queryFn: emailSettingsApi.get });
