// Run BEFORE every setup-site deploy, against a backup of the live site.db:
//   bun download-site/scripts/check-sitedb.ts /path/to/site.db-backup [SETUP_SECRET_KEY]
// It works on a COPY (the file you give is never opened for writing), opens it with this version of the site code (so the
// database upgrade runs on the copy), runs migrate() on every buyer's stored setup, and prints per buyer:
//   before step/phase -> where their link lands now, whether brand and every stored key survived, OK / FAIL.
// Exit code 1 if any buyer FAILs. FAIL means: the setup can't be read, the brand or a key was lost, a finished agency
// (done) no longer shows as done, or an install in progress was sent back to an earlier step.
// A buyer who skipped Voice before it became required is SENT BACK to Voice on purpose: shown as OK (sent back to voice).
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const src = process.argv[2];
if (!src || !existsSync(src)) { console.error("usage: bun download-site/scripts/check-sitedb.ts <site.db copy> [SETUP_SECRET_KEY]"); process.exit(2); }
const dir = mkdtempSync(join(tmpdir(), "check-sitedb-"));
copyFileSync(src, join(dir, "site.db"));
for (const ext of ["-wal", "-shm"]) if (existsSync(src + ext)) copyFileSync(src + ext, join(dir, "site.db" + ext));
process.env.DATA_DIR = dir;
// Keys are only counted (names), never decrypted, so any 32-byte key does for the check.
process.env.SETUP_SECRET_KEY = process.argv[3] || process.env.SETUP_SECRET_KEY || Buffer.alloc(32, 1).toString("base64");
for (const k of ["MOCK_DO", "MOCK_RAILWAY", "MOCK_CF", "MOCK_RESEND", "MOCK_TELNYX", "MOCK_OAUTH", "PREVIEW_JUMP"]) delete process.env[k];
if (!process.env.HOSTING) process.env.HOSTING = "railway";

// What each buyer had before: straight from the copy, before any of this code touches the rows.
const raw = new Database(join(dir, "site.db"), { readonly: true });
type Row = { buyer_id: number; data: string };
const before = new Map<number, { step?: string; phase?: string; brand?: string; keys: string[]; data: any }>();
const rows = raw.query("SELECT s.buyer_id, s.data FROM setups s").all() as Row[];
for (const r of rows) {
  let d: any = {};
  try { d = JSON.parse(r.data); } catch { d = { _unreadable: true }; }
  const keys = (raw.query("SELECT name FROM secrets WHERE buyer_id = ? ORDER BY name").all(r.buyer_id) as { name: string }[]).map((k) => k.name);
  before.set(r.buyer_id, { step: d.step, phase: d.phase, brand: d.brand?.productName, keys, data: d });
}
raw.close();

const { listBuyers } = await import("../lib");
const store = await import("../store");
const setup = await import("../setup");

let fails = 0;
const buyers = listBuyers();
console.log(`site.db: ${src}  (${buyers.length} buyers; checking a copy)`);
for (const b of buyers) {
  const was = before.get(b.id);
  const label = `#${b.id} ${b.name}${b.demo ? " [test run]" : ""}${b.revoked_at ? " [link off]" : ""}`;
  const problems: string[] = [];
  const notes: string[] = [];
  let landed = "?";
  try {
    const s = store.getSetup(b.id); // runs migrate()
    const open = setup.firstOpen(b, s);
    landed = s.phase === "done" ? "done" : s.phase !== "idle" ? `install (${s.phase})` : open;
    const keysNow = store.ALL_SECRETS.filter((n) => store.hasSecret(b.id, n));
    const lost = (was?.keys || []).filter((k) => !keysNow.includes(k as any));
    if (lost.length) problems.push(`keys lost: ${lost.join(", ")}`);
    if (was?.brand && s.brand?.productName !== was.brand) problems.push(`brand changed: ${was.brand} -> ${s.brand?.productName}`);
    if (was?.phase === "done" && landed !== "done") problems.push("finished agency no longer shows as done");
    if (was?.phase && !["idle", "done"].includes(was.phase) && !landed.startsWith("install")) problems.push(`install in progress (${was.phase}) now lands on ${landed}`);
    if (was?.phase === "idle" && was.step === "install" && landed === "phones") notes.push("sent back to voice (it was skipped; now required)");
    if (was?.phase === "idle" && s.brand && !["welcome", "brand"].includes(landed) && !s.brand.productName) problems.push("brand has no name");
    // Every step the buyer could be on must render without an error.
    const { wizardPage } = await import("../wizard");
    try { wizardPage(b, s, b.code, "check", s.phase === "done" ? "done" : (landed.startsWith("install") ? "install" : (landed as any))); } catch (e) { problems.push(`page error: ${(e as Error).message}`); }
    console.log(`${problems.length ? "FAIL" : "OK  "} ${label}: ${was?.phase || "-"}/${was?.step || "-"} -> ${landed}; brand ${was?.brand ? `"${was.brand}" kept` : "none"}; keys ${keysNow.length ? keysNow.join(",") : "none"}${notes.length ? `; ${notes.join("; ")}` : ""}${problems.length ? `  <-- ${problems.join("; ")}` : ""}`);
  } catch (e) {
    problems.push(`can't read setup: ${(e as Error).message}`);
    console.log(`FAIL ${label}: ${problems.join("; ")}`);
  }
  if (problems.length) fails++;
}
console.log(fails ? `\n${fails} buyer(s) FAILED. Do not deploy.` : `\nAll ${buyers.length} buyers OK. Safe to deploy as far as stored setups go.`);
rmSync(dir, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
