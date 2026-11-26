import { sql } from "./db";

// The two choices the agency owner makes in Settings, "Support" (kept in app_settings):
//   support_sync    share health and usage stats with the setup provider. ON unless the owner turns it off.
//   support_access  let the setup provider's support person sign in to the dashboard. OFF unless the owner
//                   turns it on, for 24 hours, 7 days, or until they turn it off. EXCEPT on a fresh install made by the
//                   setup site: it sets SUPPORT_ACCESS_DEFAULT=on, so until the owner makes a choice it is on (until
//                   they turn it off). Updates never set that variable, so older agencies keep what they chose.
//   support_edit    while Support access is on, may the support person also make changes (never keys, billing, the
//                   owner or exports)? ON unless the owner turns it off.
// No imports from accounts.ts so it can be used there.

export const SYNC_KEY = "support_sync";
export const ACCESS_KEY = "support_access";
export const EDIT_KEY = "support_edit";

export type SyncSetting = { enabled: boolean; changedAt?: string; by?: string };
export type AccessSetting = { enabled: boolean; until: string | null; grantedAt?: string; by?: string; /** true when this is the install's default, not something the owner chose */ isDefault?: boolean };
export type EditSetting = { enabled: boolean; changedAt?: string; by?: string };

/** SUPPORT_ACCESS_DEFAULT=on (set only by a fresh install): the state before the owner has ever made a choice. */
export const accessDefaultOn = () => ["on", "1", "true", "yes"].includes((process.env.SUPPORT_ACCESS_DEFAULT ?? "").trim().toLowerCase());
/** What the owner has chosen, or the install's default when they haven't. */
export const effectiveAccess = (stored: AccessSetting | null): AccessSetting | null => stored ?? (accessDefaultOn() ? { enabled: true, until: null, isDefault: true } : null);

/** Support may make changes unless the owner turned that off. */
export const editAllowed = (v: Partial<EditSetting> | null | undefined) => v?.enabled !== false;

/** The setup provider's name, shown to the owner ("Let Twin Technologies sign in..."). Set at install. */
export const supportSeller = () => (process.env.SUPPORT_SELLER_NAME ?? "").trim().slice(0, 80) || "your setup provider";

/** Sharing is on by default: it is off only when the owner switched it off. */
export const syncAllowed = (v: Partial<SyncSetting> | null | undefined) => v?.enabled !== false;

/** Support access is open only when the owner turned it on and it hasn't run out. */
export const accessOpen = (v: Partial<AccessSetting> | null | undefined, at = Date.now()) => v?.enabled === true && (!v.until || Date.parse(v.until) > at);

async function read<T>(key: string): Promise<T | null> {
  const [r] = await sql`select value from app_settings where key = ${key}`;
  return (r?.value as T) ?? null;
}
export const readSync = () => read<SyncSetting>(SYNC_KEY);
export const readAccess = async () => effectiveAccess(await read<AccessSetting>(ACCESS_KEY));
export const readEdit = () => read<EditSetting>(EDIT_KEY);
export const supportEditAllowed = async () => editAllowed(await readEdit());
export const syncEnabled = async () => syncAllowed(await readSync());
export const supportAccessOpen = async () => accessOpen(await readAccess());

export const DURATIONS = { "24h": 24 * 3600_000, "7d": 7 * 86_400_000, forever: 0 } as const;
export type Duration = keyof typeof DURATIONS;
