// Two tiny "who is calling" flags, carried through async work without changing every function's arguments.
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Set while one of OUR admins runs a wizard action on a buyer's behalf (assist.ts). The value is the admin's email.
 * The wizard's own checks run exactly the same; the only differences are that the "finish the earlier steps first"
 * ordering rule is skipped (we can fill any step in any order) and the per-buyer provider-check rate limit isn't spent.
 */
export const asAdmin = new AsyncLocalStorage<string>();

/** Set while a request is served on a buyer's own domain (hosts.ts): pages must show their brand, never ours. */
export const onOwnHost = new AsyncLocalStorage<true>();
export const adminEmailNow = () => asAdmin.getStore() || "";
export const servingOwnHost = () => !!onOwnHost.getStore();
