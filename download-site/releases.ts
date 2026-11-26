// Releases the buyers' apps can fetch to update themselves (the app's Settings, "Updates"; server/autoUpdate.ts).
//   GET /api/releases/latest                           Bearer <the app's sync token>
//        { version, notes, sha256, size, bundleUrl, expiresAt }
//   GET /api/releases/bundle/<version>?b=&exp=&sig=    the app's source (.tar.gz), only with a signed, short-lived address
// The address is signed with our site key (HMAC-SHA-256 over buyer, version and expiry) and runs out after 10 minutes,
// so it is no use to anyone who finds it later. The checksum is of the exact bytes served, so a damaged or swapped
// download is refused by the app. We never hold a Railway token for this: the app uses its own project token.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG, PACKAGES_DIR, currentPackage } from "./lib";
import { ProviderError } from "./providers";
import { siteKey } from "./store";

export const BUNDLE_TTL_SECONDS = 600;

/** The app's source (.tar.gz), taken out of the published bundle once and kept next to it. */
export async function appSource(): Promise<Uint8Array> {
  const pkg = currentPackage();
  if (!pkg) throw new ProviderError("The app isn't ready to install yet. Please try again later or contact support.");
  const bundle = join(PACKAGES_DIR, pkg.file);
  const cached = bundle.replace(/\.tgz$/, ".app-src.tgz");
  if (!existsSync(cached)) {
    const p = Bun.spawn(["tar", "-xzOf", bundle, "./app-src.tgz"], { stdout: "pipe", stderr: "ignore" });
    const out = new Uint8Array(await new Response(p.stdout).arrayBuffer());
    if ((await p.exited) !== 0 || out.length < 1000) throw new ProviderError("The app bundle is damaged. Contact support.");
    writeFileSync(cached, out, { mode: 0o600 });
  }
  return new Uint8Array(readFileSync(cached));
}

const shaCache = new Map<string, { mtime: number; sha: string }>();
export const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** The newest release: its version, notes and the checksum of the exact bytes the bundle address serves. Null when nothing is published. */
export async function latestRelease(): Promise<{ version: string; notes: string; sha256: string; size: number } | null> {
  const pkg = currentPackage();
  if (!pkg) return null;
  let bytes: Uint8Array;
  try { bytes = await appSource(); } catch { return null; }
  const file = join(PACKAGES_DIR, pkg.file.replace(/\.tgz$/, ".app-src.tgz"));
  const mtime = existsSync(file) ? statSync(file).mtimeMs : 0;
  const hit = shaCache.get(file);
  const sha = hit && hit.mtime === mtime ? hit.sha : sha256Hex(bytes);
  shaCache.set(file, { mtime, sha });
  return { version: pkg.version, notes: String(pkg.notes || ""), sha256: sha, size: bytes.length };
}

const mac = (buyerId: number, version: string, exp: number) => createHmac("sha256", siteKey()).update(`release:${buyerId}:${version}:${exp}`).digest("base64url");

export function signBundleUrl(buyerId: number, version: string, at = Date.now()): { url: string; expiresAt: string } {
  const exp = Math.floor(at / 1000) + BUNDLE_TTL_SECONDS;
  const q = new URLSearchParams({ b: String(buyerId), exp: String(exp), sig: mac(buyerId, version, exp) });
  return { url: `${CONFIG.siteUrl}/api/releases/bundle/${encodeURIComponent(version)}?${q}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** True when the signature is ours, for this buyer and version, and hasn't run out. Constant time. */
export function bundleSignatureOk(buyerId: number, version: string, expRaw: string, sig: string, at = Date.now()): boolean {
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp * 1000 < at || exp * 1000 > at + (BUNDLE_TTL_SECONDS + 60) * 1000) return false;
  if (!/^[A-Za-z0-9_-]{43}$/.test(sig)) return false;
  return timingSafeEqual(Buffer.from(mac(buyerId, version, exp)), Buffer.from(sig));
}
