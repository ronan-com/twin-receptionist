// The product's name on this copy of the app (PRODUCT_NAME). The screens default to
// the neutral "AI Receptionist"; a copy sold under another name (e.g. Chloe) sets its own.

export const UI_PRODUCT = (process.env.PRODUCT_NAME ?? "").trim() || "AI Receptionist";

/** True on a copy sold under another name. */
export const OTHER_BRAND = UI_PRODUCT !== "Answered";

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * The built index.html with this copy's name: the browser title, the link-preview
 * tags, and <meta name="product">, which the screens read (src/lib/app/product.ts).
 */
export function brandedIndex(html: string, product = UI_PRODUCT, neutral = process.env.NEUTRAL_DASHBOARD === "1"): string {
  const name = escapeHtml(product);
  const about = `${name}: an AI receptionist that answers every call.`;
  return html
    .replace(/<html\b/, (tag) => neutral ? `${tag} data-neutral-dashboard` : tag)
    .replace(/<title>[^<]*<\/title>/, `<title>${name}</title>\n    <meta name="product" content="${name}" />`)
    .replace(/(<meta (?:name|property)="(?:og:title|twitter:title)" content=")[^"]*(")/g, `$1${name}$2`)
    .replace(/(<meta (?:name|property)="(?:description|og:description|twitter:description)" content=")[^"]*(")/g, `$1${about}$2`)
    .replace(/(<meta (?:name|property)="(?:og:site_name|author|application-name)" content=")[^"]*(")/g, `$1${name}$2`);
}
