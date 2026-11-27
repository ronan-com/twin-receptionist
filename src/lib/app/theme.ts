// Light / dark mode and up to three brand colours, as CSS variables.
//
// Where the choices come from (first one found wins):
//   brand colours: the agency's own look in the console (BrandingEditor, applied inline by
//                  AgencyMark / WorkspaceBrand), else the server's branding config, written into
//                  the page as <meta name="brand-colours" content="#635bff,#00b4d8,#ff7a59">
//                  (1 to 3 hex colours; the server may also send brandColours: string[] in
//                  window.__BRANDING__), else the built-in indigo.
//   theme:         what this person picked with the toggle (localStorage), else the server's
//                  <meta name="theme" content="light|dark|auto"> (or __BRANDING__.theme), else light.
//
// Colours land in <style id="brand-env"> (not inline on <html>) so the agency's inline look still wins
// and, when it is removed, the server's colours show again.

export type Theme = "light" | "dark" | "auto";
type Branding = { brandColours?: unknown; theme?: unknown };

const HEX = /^#[0-9a-f]{6}$/i;
const KEY = "ui-theme";

function branding(): Branding {
  if (typeof window === "undefined") return {};
  return ((window as unknown as { __BRANDING__?: Branding }).__BRANDING__ ?? {}) as Branding;
}
const meta = (name: string) => (typeof document === "undefined" ? "" : document.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim() ?? "");

/** 1 to 3 valid hex colours from the server's config; empty when none. */
export function envBrandColours(): string[] {
  const b = branding().brandColours;
  const raw = Array.isArray(b) ? b.map(String) : (meta("brand-colours") || meta("brand-colors")).split(/[,\s]+/);
  return raw.map((c) => c.trim()).filter((c) => HEX.test(c)).slice(0, 3);
}

function envTheme(): Theme {
  const t = String(branding().theme ?? meta("theme")).toLowerCase();
  return t === "dark" || t === "auto" ? t : "light";
}

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark" || t === "auto") return t;
  } catch {
    /* private window */
  }
  return envTheme();
}

const listeners = new Set<() => void>();

function resolved(t: Theme): "light" | "dark" {
  if (t !== "auto") return t;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(t: Theme = getTheme()) {
  if (typeof document === "undefined") return;
  const dark = resolved(t) === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  for (const l of listeners) l();
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
  applyTheme(t);
}

export function subscribeTheme(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
export const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

/** Writes the server's brand colours (if any) as CSS variables. Call once at start. */
export function applyEnvBrand() {
  if (typeof document === "undefined") return;
  const [c1, c2, c3] = envBrandColours();
  let el = document.getElementById("brand-env") as HTMLStyleElement | null;
  if (!c1) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = "brand-env";
    document.head.appendChild(el);
  }
  el.textContent = `:root{--indigo:${c1};--indigo-deep:color-mix(in srgb,${c1} 88%,#000);--primary:${c1};--ring:${c1};--primary-ink:color-mix(in srgb,${c1} 78%,#000);` +
    `${c2 ? `--brand-2:${c2};` : ""}${c3 ? `--brand-3:${c3};` : ""}}`;
}

export function initTheme() {
  applyEnvBrand();
  applyTheme();
  if (typeof matchMedia !== "undefined") matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => getTheme() === "auto" && applyTheme());
}
