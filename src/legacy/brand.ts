import { PRODUCT } from "@/lib/app/product";

// Everything brand-specific lives here and in the colour tokens at the top of
// styles.css, so a copy of this app can be rebranded for a reseller in one place.
export const brand = {
  name: PRODUCT,
  product: PRODUCT,
  company: "Twin Technologies",
  supportEmail: "contact@twinagency.co",
  site: "https://answeredai.co",
  // The red full stop after the name in the Twin wordmark.
  dot: false,
};
