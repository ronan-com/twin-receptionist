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
import { CONFIG, PACKAGES_DIR, currentPackage, listPackages } from "./lib";
import { ProviderError } from "./providers";
import { siteKey } from "./store";

export const BUNDLE_TTL_SECONDS = 600;

/** A published bundle by version (the newest when none is given). Null when we don't hold it. */
export const packageOf = (version?: string) => (version ? listPackages().find((p) => p.version === version && p.file.endsWith(".tgz")) ?? null : currentPackage());

/** The app's source (.tar.gz), taken out of the published bundle once and kept next to it. */
export async function appSource(version?: string): Promise<Uint8Array> {
  const pkg = packageOf(version);
  if (!pkg) throw new ProviderError("The app isn't ready to install yet. Please try again later or contact support.");
  const bundle = join(PACKAGES_DIR, pkg.file);
  const cached = bundle.replace(/\.tgz$/, ".app-src.tgz");
  if (!existsSync(cached)) {
    const p = Bun.spawn(["tar", "-xzOf", pkg.file, "./app-src.tgz"], { cwd: PACKAGES_DIR, stdout: "pipe", stderr: "ignore" }); // bare name: GNU tar reads "C:\..." as a remote host
    const out = new Uint8Array(await new Response(p.stdout).arrayBuffer());
    if ((await p.exited) !== 0 || out.length < 1000) throw new ProviderError("The app bundle is damaged. Contact support.");
    writeFileSync(cached, out, { mode: 0o600 });
  }
  return new Uint8Array(readFileSync(cached));
}

/**
 * File names that must never ship in a source or update download: settings with keys, private keys and key
 * stores, credential files, local databases, git history, and archives inside the archive (which hide their contents).
 * (.env.example and friends are fine.)
 */
const SECRET_NAME = new RegExp(
  "(^|/)(" +
    [
      "\\.env(\\.(?!(example|sample|template)$)[^/]*)?",
      "[^/]*\\.env",
      "secrets?\\.env",
      "\\.secrets?",
      "\\.npmrc",
      "\\.netrc",
      "_netrc",
      "\\.pgpass",
      "\\.aws",
      "\\.git",
      "\\.ssh",
      "id_(rsa|dsa|ed25519|ecdsa)(\\.pub)?",
      "[^/]*\\.(pem|key|p12|pfx|jks|keystore|token|sqlite3?|db|db3)",
      "credentials(\\.json)?",
      "service[-_]?account[^/]*\\.json",
      "[^/]*\\.(tgz|tar|zip|7z|rar|gz|bz2|xz|zst)",
    ].join("|") +
    ")(/|$)",
  "i",
);
export const secretNamesIn = (names: string[]) => names.filter((n) => SECRET_NAME.test(n.replace(/^\.\//, "")));

const checkedCache = new Map<string, string>();

/** The app's source for a version, only if its file list holds nothing that looks like a secret. Used by BOTH the update bundle and the source download. */
export async function checkedAppSource(version?: string): Promise<Uint8Array> {
  const bytes = await appSource(version);
  const key = `${version ?? "current"}:${sha256Hex(bytes)}`;
  if (checkedCache.get(key) === "ok") return bytes;
  const p = Bun.spawn(["tar", "-tzf", "-"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  p.stdin.write(bytes);
  await p.stdin.end();
  const names = (await new Response(p.stdout).text()).split("\n").filter(Boolean);
  if ((await p.exited) !== 0 || !names.length) { console.error(`[release] source ${version ?? "current"}: tar said: ${(await new Response(p.stderr).text()).slice(0, 200)}`); throw new ProviderError("The source bundle is damaged. Contact support."); }
  const bad = secretNamesIn(names);
  if (bad.length) { console.error(`[release] source ${version ?? "current"} refused: holds ${bad.slice(0, 3).join(", ")}`); throw new ProviderError("This version's source can't be offered right now. Contact support."); }
  checkedCache.set(key, "ok");
  return bytes;
}

/** The source download for one version: the app's source, refused if its file list holds anything that looks like a secret. */
export async function sourceDownload(version: string): Promise<{ bytes: Uint8Array; filename: string }> {
  return { bytes: await checkedAppSource(version), filename: `source-${version}.tar.gz` };
}

/**
 * Where a buyer downloads the source of the version they run. SOURCE_DOWNLOAD_URL (with {version}) overrides it,
 * for when releases live on GitHub; otherwise our own short-lived signed address.
 */
export function sourceUrlFor(buyerId: number, version: string): string {
  const template = CONFIG.sourceDownloadUrl;
  if (template) return template.replaceAll("{version}", encodeURIComponent(version));
  return signBundleUrl(buyerId, version, Date.now(), "source").url.replace("/api/releases/bundle/", "/api/releases/source/");
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

// The purpose is part of what is signed, so a source address can't be used as an update bundle address or the other way round.
export type ReleasePurpose = "bundle" | "source";
const mac = (buyerId: number, version: string, exp: number, purpose: ReleasePurpose) => createHmac("sha256", siteKey()).update(`release:${purpose}:${buyerId}:${version}:${exp}`).digest("base64url");

export function signBundleUrl(buyerId: number, version: string, at = Date.now(), purpose: ReleasePurpose = "bundle"): { url: string; expiresAt: string } {
  const exp = Math.floor(at / 1000) + BUNDLE_TTL_SECONDS;
  const q = new URLSearchParams({ b: String(buyerId), exp: String(exp), sig: mac(buyerId, version, exp, purpose) });
  return { url: `${CONFIG.siteUrl}/api/releases/bundle/${encodeURIComponent(version)}?${q}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** True when the signature is ours, for this buyer and version, and hasn't run out. Constant time. */
export function bundleSignatureOk(buyerId: number, version: string, expRaw: string, sig: string, at = Date.now(), purpose: ReleasePurpose = "bundle"): boolean {
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp * 1000 < at || exp * 1000 > at + (BUNDLE_TTL_SECONDS + 60) * 1000) return false;
  if (!/^[A-Za-z0-9_-]{43}$/.test(sig)) return false;
  return timingSafeEqual(Buffer.from(mac(buyerId, version, exp, purpose)), Buffer.from(sig));
}
