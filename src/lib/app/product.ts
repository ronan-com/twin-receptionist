// The product's name on this copy of the app. One build serves every brand: the
// server writes the name into the page (<meta name="product">, from PRODUCT_NAME),
// and the screens read it here. With no tag the name is the neutral "AI Receptionist"; a copy that sets PRODUCT_NAME=Answered
// is the Answered build itself.

function fromPage(): string {
  if (typeof document === "undefined") return "";
  return document.querySelector('meta[name="product"]')?.getAttribute("content")?.trim() ?? "";
}

export const DEFAULT_PRODUCT = "AI Receptionist";
export const PRODUCT = fromPage() || DEFAULT_PRODUCT;
export const NEUTRAL_DASHBOARD = typeof document !== "undefined" && document.documentElement.hasAttribute("data-neutral-dashboard");

/** True on a copy sold under another name (its own public site lives elsewhere). */
export const OTHER_BRAND = PRODUCT !== "Answered";

/** Ready-made wording with this copy's name in place of the default one. */
export const named = (text: string) => (OTHER_BRAND ? text.replaceAll("Answered", PRODUCT) : text);
