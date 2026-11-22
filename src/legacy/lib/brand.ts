import type { CSSProperties } from "react";
import type { Brand } from "./shared";

// The page background an agency chose (a colour and/or an image behind the cards).
export function brandStyle(brand?: Brand | null): CSSProperties {
  if (!brand || (!brand.bgColor && !brand.bgImage)) return {};
  return {
    backgroundColor: brand.bgColor || undefined,
    backgroundImage: brand.bgImage ? `url(${brand.bgImage})` : undefined,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundAttachment: "fixed",
    minHeight: "100vh",
  };
}
