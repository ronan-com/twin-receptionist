// The product's name on this copy of the app. One build serves every brand: the
// server writes the name into the page (<meta name="product">, from PRODUCT_NAME),
// and the screens read it here. With no tag the name is "Answered".

function fromPage(): string {
  if (typeof document === "undefined") return "";
  return document.querySelector('meta[name="product"]')?.getAttribute("content")?.trim() ?? "";
}

export const PRODUCT = fromPage() || "Answered";

/** True on a copy sold under another name (its own public site lives elsewhere). */
export const OTHER_BRAND = PRODUCT !== "Answered";

/** Ready-made wording with this copy's name in place of the default one. */
export const named = (text: string) => (OTHER_BRAND ? text.replaceAll("Answered", PRODUCT) : text);
