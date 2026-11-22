import { useEffect, type CSSProperties } from "react";
import type { Brand } from "@/lib/shared";

// A company's branding on its customer workspace (/app): colours become the theme's
// CSS variables, the background goes behind the page and the logo sits in the sidebar.
// Set by the agency per company (console, client page), with the agency's own branding
// as the default. Unset fields keep Answered's look.

const HEX = /^#[0-9a-f]{6}$/i;

function shade(hex: string, by: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + by))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Whether white text reads on this colour. */
export function isDark(hex: string): boolean {
  if (!HEX.test(hex)) return false;
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 150;
}

/** The theme variables for a brand's colours (for the page, or a preview box). */
export function brandVars(b: Partial<Brand> | null | undefined): CSSProperties {
  const v: Record<string, string> = {};
  if (b?.primary && HEX.test(b.primary)) {
    Object.assign(v, {
      "--indigo": b.primary,
      "--indigo-deep": shade(b.primary, -0.15),
      "--primary": b.primary,
      "--ring": b.primary,
      "--primary-foreground": isDark(b.primary) ? "#ffffff" : "#061b31",
    });
  }
  if (b?.accent && HEX.test(b.accent)) Object.assign(v, { "--accent": b.accent, "--accent-foreground": isDark(b.accent) ? "#ffffff" : "#061b31" });
  return v as CSSProperties;
}

/** Applies a brand to the whole page while mounted. */
export function BusinessBrand({ brand }: { brand: Partial<Brand> | null | undefined }) {
  const key = JSON.stringify(brand ?? {});
  useEffect(() => {
    const b = (JSON.parse(key) ?? {}) as Partial<Brand>;
    const root = document.documentElement;
    const vars = brandVars(b) as Record<string, string>;
    for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
    const style = document.createElement("style");
    style.setAttribute("data-business-brand", "");
    const rules: string[] = [];
    // The app shell (wrapped in [data-brand-shell]) has the page background on its outer box.
    const bg = [b.bgImage ? `url("${encodeURI(b.bgImage)}") center / cover fixed` : "", HEX.test(b.bgColor ?? "") ? b.bgColor : ""].filter(Boolean).join(", ");
    if (bg) rules.push(`[data-brand-shell] > .min-h-screen { background: ${bg}; }`);
    if (b.sidebar && HEX.test(b.sidebar)) {
      const dark = isDark(b.sidebar);
      rules.push(
        `[data-brand-shell] aside, [data-brand-sidebar] { background: ${b.sidebar} !important;${dark ? " --ink: #ffffff; --ink-muted: rgba(255,255,255,0.75); --hairline: rgba(255,255,255,0.18);" : ""} }`,
      );
    }
    style.textContent = rules.join("\n");
    document.head.appendChild(style);
    return () => {
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
      style.remove();
    };
  }, [key]);
  return null;
}

/** The company's logo, for the sidebar. */
export function BrandLogo({ brand, name }: { brand: Partial<Brand> | null | undefined; name?: string }) {
  if (!brand?.logo) return null;
  return (
    <div className="mb-2 flex h-12 items-center justify-center rounded-[6px] bg-white/80 px-2" data-brand-logo>
      <img src={brand.logo} alt={name ? `${name} logo` : "Logo"} className="max-h-10 max-w-full object-contain" />
    </div>
  );
}
