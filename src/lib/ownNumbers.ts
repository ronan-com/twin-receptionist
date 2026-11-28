// Numbers an agency already owns on its own Telnyx account, and numbers still waiting
// for Telnyx to approve them. Shared by the server and the dashboard.

/** A number on the agency's Telnyx account that isn't connected to one of our receptionists. */
export type OwnedNumber = {
  id: string;
  phoneNumber: string;
  type: string;
  status: string;
  /** Telnyx's id for what it is connected to now (a voice app, a SIP connection), or "". */
  connectionId: string;
  /** What that connection is called in Telnyx, or "" when it isn't connected to anything. */
  connectionName: string;
  /** It was left on an assistant that no longer exists, so it counts as unconnected. */
  orphaned?: boolean;
};

export const TELNYX_ORDERS_URL = "https://portal.telnyx.com/#/numbers/number-orders";

export const PENDING_NOTE = "Australian numbers need proof of address, and approval usually takes 1 to 3 business days. The number starts answering calls by itself once it's approved.";

/** Telnyx number statuses that mean it's finished and answering. */
export const numberIsLive = (status: string) => status === "" || status === "active";

/** Failed purchases and ports won't finish by waiting. */
export const numberFailed = (status: string) => status.endsWith("-failed");

/** Not live yet: Telnyx is still checking the order (purchase-pending, port-pending and so on). */
export const numberWaiting = (status: string) => status.includes("pending");
