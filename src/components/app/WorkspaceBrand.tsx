import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBrand, type BrandLook } from "@/lib/api/manage";
import { useWorkspace } from "@/lib/app/workspace";

// The business's own look in its workspace (area S): primary and accent colours, a
// background colour or image, and a logo above the workspace switcher. The business's
// settings win over its agency's (server/routes/manage.ts brandState).

export const brandQueryKey = (businessId: string | null) => ["brand", businessId] as const;

export function useWorkspaceBrand() {
  const ws = useWorkspace();
  return useQuery({ queryKey: brandQueryKey(ws.businessId), enabled: !!ws.businessId, queryFn: () => getBrand(ws.businessId!), staleTime: 60_000 });
}

const HEX = /^#[0-9a-f]{6}$/i;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex: string, by: number): string {
  return `#${rgb(hex)
    .map((c) => Math.max(0, Math.min(255, Math.round(c * (1 - by)))).toString(16).padStart(2, "0"))
    .join("")}`;
}
/** Black or white text, whichever reads better on this colour. */
export function textOn(hex: string): string {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#0a2540" : "#ffffff";
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** The brand colour darkened until text in it passes AA (4.5:1) on a light tint. */
function readableInk(hex: string): string {
  for (let by = 0.15; by < 0.95; by += 0.05) {
    const c = shade(hex, by);
    if (1.0 / (luminance(c) + 0.05) >= 4.9) return c; // white is 1.0; a 4.9 margin covers the tint
  }
  return "#061b31";
}

/** CSS custom properties for a look (also used by the settings preview). */
export function brandVars(look: Partial<BrandLook> | null | undefined): Record<string, string> {
  const vars: Record<string, string> = {};
  const p = look?.primaryColor ?? "";
  const a = look?.accentColor ?? "";
  if (HEX.test(p)) {
    vars["--indigo"] = p;
    vars["--indigo-deep"] = shade(p, 0.12);
    vars["--primary"] = p;
    vars["--primary-foreground"] = textOn(p);
    vars["--ring"] = p;
    // Dashboard accents (styles.css): text-strength primary, and the ribbon's colours.
    vars["--primary-ink"] = readableInk(p);
    vars["--ribbon-2"] = HEX.test(a) ? a : shade(p, 0.12);
    vars["--ribbon-3"] = HEX.test(a) ? a : p;
  }
  if (HEX.test(a)) {
    vars["--accent"] = a;
    vars["--accent-foreground"] = textOn(a);
  }
  return vars;
}

const STYLE_ID = "workspace-brand";

/** Applies the effective look while the workspace is open; renders nothing. */
export function WorkspaceBrand() {
  const q = useWorkspaceBrand();
  const look = q.data?.effective;
  useEffect(() => {
    const root = document.documentElement;
    const vars = brandVars(look);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    const bg: string[] = [];
    if (look?.bgColor && HEX.test(look.bgColor)) bg.push(`background-color: ${look.bgColor};`);
    // The image URL comes from our own server (/brand/<uuid>).
    if (look?.bgImage && /^\/brand\/[a-f0-9-]{36}$/.test(look.bgImage)) bg.push(`background-image: url("${look.bgImage}"); background-size: cover; background-position: center; background-attachment: fixed;`);
    // A sidebar colour (set per company in the console); light text on a dark one.
    const side = look?.sidebarColor && HEX.test(look.sidebarColor) ? look.sidebarColor : "";
    const sideRule = side
      ? `[data-app-shell] aside { background: ${side} !important;${textOn(side) === "#ffffff" ? " --ink: #ffffff; --ink-muted: rgba(255,255,255,0.75); --hairline: rgba(255,255,255,0.18);" : ""} }`
      : "";
    if (bg.length || side) {
      if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        document.head.appendChild(style);
      }
      style.textContent = `${bg.length ? `[data-app-shell] { ${bg.join(" ")} }` : ""}\n${sideRule}`;
    } else style?.remove();
    return () => {
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
      document.getElementById(STYLE_ID)?.remove();
    };
  }, [look]);
  return null;
}

/** The business's logo above the workspace switcher, when it has one. */
export function WorkspaceLogo() {
  const q = useWorkspaceBrand();
  const logo = q.data?.effective.logo;
  if (!logo || !/^\/brand\/[a-f0-9-]{36}$/.test(logo)) return null;
  return (
    <div className="px-1 pb-2" data-workspace-logo>
      <img src={logo} alt="" className="max-h-10 max-w-full object-contain" />
    </div>
  );
}
