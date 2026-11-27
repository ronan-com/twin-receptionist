// What Helper remembers per person, in this browser only (localStorage can be blocked: every call is guarded).

export type HelperPrefs = { open: boolean; mini: boolean; speak: boolean };
const DEFAULTS: HelperPrefs = { open: false, mini: false, speak: false };
const key = (userId: string) => `helper:prefs:v1:${userId}`;

export function loadPrefs(userId: string, store: Pick<Storage, "getItem"> | null = safeStore()): HelperPrefs {
  try {
    const raw = store?.getItem(key(userId));
    const p = raw ? JSON.parse(raw) : {};
    return { open: p?.open === true, mini: p?.mini === true, speak: p?.speak === true };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(userId: string, prefs: HelperPrefs, store: Pick<Storage, "setItem"> | null = safeStore()): void {
  try {
    store?.setItem(key(userId), JSON.stringify(prefs));
  } catch {
    /* private window: it just starts fresh next time */
  }
}

function safeStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
