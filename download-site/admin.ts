#!/usr/bin/env bun
// Admin for the download site. There is no admin web page on purpose: run this on the
// server (or inside the container) where DATA_DIR lives.
//   bun download-site/admin.ts add-buyer "<name>" <email>   prints the buyer's private setup link
//   bun download-site/admin.ts list                         buyers, where each is in setup, bundles
//   bun download-site/admin.ts revoke <code|link>           turns a link off
//   bun download-site/admin.ts restore <code|link>          turns a revoked link back on
//   bun download-site/admin.ts reset <code|link>            wipes a buyer's setup so they can start again
//   bun download-site/admin.ts publish <selfhost-bundle.tgz> <version> [notes]   the app bundle new servers install
//   bun download-site/admin.ts notes <version> <notes>      set or change a published version's release notes
//   bun download-site/admin.ts admin-link <email>           a one-time /admin sign-in link (15 minutes)
//   bun download-site/admin.ts admin-hash                   makes ADMIN_PASSWORD_HASH from a password (stdin)
//   bun download-site/admin.ts backup [file]                a consistent copy of site.db (schedule it)
//   bun download-site/admin.ts gen-key                      prints a new SETUP_SECRET_KEY
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, openSync, readFileSync, readSync, closeSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  CONFIG, PACKAGES_DIR, addBuyer, currentPackage, setupLink, extractCode, findBuyer, humanSize,
  listBuyers, listPackages, recordPackage, restoreBuyer, revokeBuyer, setPackageNotes, slug, db,
} from "./lib";
import { getSetup, resetSetup } from "./store";

const die = (msg: string, code = 1): never => {
  console.error(msg);
  process.exit(code);
};

const USAGE = `Usage: bun download-site/admin.ts <command>

  add-buyer "<name>" <email>              Add a buyer and print their private setup link
  list                                    Buyers, where each is in setup, and published bundles
  revoke <code|link>                      Turn a buyer's link off
  restore <code|link>                     Turn a revoked link back on
  reset <code|link>                       Wipe a buyer's setup (and stored keys) so they can start again
  publish <selfhost-bundle.tgz> <version> [notes]
                                          Publish the app bundle new servers install (newest wins). notes = a text file or
                                          a string, one change per line: buyers see it on their "Update your agency" screen
  notes <version> <notes>                 Set or change a published version's release notes (text file or string)
  admin-link <email>                      One-time sign-in link for /admin (the email must be in ADMIN_EMAILS)
  admin-hash                              Read a password (stdin or prompt) and print ADMIN_PASSWORD_HASH
  backup [file]                           Write a consistent copy of site.db (default DATA_DIR/backups/site-<time>.db)
  gen-key                                 Print a new SETUP_SECRET_KEY (32 random bytes, base64)

Data: ${CONFIG.dataDir}   Site: ${CONFIG.siteUrl}`;

function buyerArg(arg: string | undefined) {
  const code = extractCode(arg || "");
  if (!code) die("That isn't a setup code or link. Copy it from `list`.");
  const b = findBuyer(code!);
  if (!b) die("No buyer has that code.");
  return b!;
}

async function sha256File(path: string) {
  const h = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) h.update(chunk);
  return h.digest("hex");
}

/** Release notes: the path of a text file, or the notes themselves. */
function notesArg(v: string | undefined): string {
  if (!v) return "";
  const isFile = existsSync(v) && statSync(v).isFile();
  if (isFile && statSync(v).size > 20_000) die("That notes file is too big (20 KB at most).");
  return String(isFile ? readFileSync(v, "utf8") : v).replace(/\r/g, "").trim().slice(0, 4000);
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "add-buyer": {
    const [name, email] = args.map((a) => (a || "").trim());
    if (!name || !email || args.length !== 2) die('Usage: add-buyer "<name>" <email>', 2);
    if (name.length > 120) die("Name is too long (120 characters at most).");
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) || email.length > 200) die(`"${email}" doesn't look like an email address.`);
    const b = addBuyer(name, email.toLowerCase());
    console.log(`Added ${b.name} <${b.email}>.`);
    console.log("Private setup link (send this to the buyer):");
    console.log(setupLink(b.code));
    if (!currentPackage()) console.log("Note: no app bundle is published yet. The buyer can connect accounts, but Install waits until you run publish.");
    break;
  }

  case "list": {
    const buyers = listBuyers();
    const pkgs = listPackages();
    console.log(`Buyers (${buyers.length}):`);
    if (!buyers.length) console.log("  (none yet)");
    for (const b of buyers) {
      const s = getSetup(b.id);
      const where = s.phase === "done" ? `INSTALLED${s.attemptVersion ? ` v${s.attemptVersion}` : ""} ${s.installedAt?.slice(0, 16).replace("T", " ")} https://${s.domain?.host} (droplet ${s.dropletId}, ${s.ip})`
        : s.phase !== "idle" ? `install: ${s.phase}${s.error ? ` (${s.error.slice(0, 80)})` : ""}` : `setup step: ${s.step}`;
      console.log(`  #${b.id}  ${b.name} <${b.email}>  added ${b.created_at.slice(0, 10)}  ${b.revoked_at ? `REVOKED ${b.revoked_at.slice(0, 10)}` : where}`);
      console.log(`       ${setupLink(b.code)}`);
    }
    console.log(`\nApp bundles (${pkgs.length}), newest is what new servers install:`);
    if (!pkgs.length) console.log("  (none published)");
    for (const p of pkgs) console.log(`  ${p.version.padEnd(12)} ${p.file}  ${humanSize(p.size)}  sha256 ${p.sha256}  published ${p.published_at.slice(0, 16).replace("T", " ")}${p.notes ? "  (has release notes)" : ""}`);
    break;
  }

  case "revoke": {
    const b = buyerArg(args[0]);
    if (b.revoked_at) console.log(`${b.name}'s link was already revoked on ${b.revoked_at}.`);
    else { revokeBuyer(b.id); console.log(`Revoked ${b.name} <${b.email}>. Their link no longer works.`); }
    break;
  }

  case "restore": {
    const b = buyerArg(args[0]);
    restoreBuyer(b.id);
    console.log(`${b.name}'s link works again.`);
    break;
  }

  case "reset": {
    const b = buyerArg(args[0]);
    const s = getSetup(b.id);
    if (s.dropletId && s.phase !== "done") console.log(`Note: ${b.name} has a server (droplet ${s.dropletId}) that isn't finished. It stays in their DigitalOcean account; they can delete it there.`);
    resetSetup(b.id);
    console.log(`${b.name}'s setup is wiped (and any keys we held deleted). Their link starts from the beginning.`);
    break;
  }

  case "gen-key": {
    console.log(randomBytes(32).toString("base64"));
    break;
  }

  case "publish": {
    const [src, version, notesIn] = args;
    if (!src || !version || args.length < 2 || args.length > 3) die("Usage: publish <selfhost-bundle.tgz> <version> [notes file or text]", 2);
    const notes = notesArg(notesIn);
    if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(version)) die("Version may use letters, digits, '.', '-' and '+' only (e.g. 1.0.0).");
    if (!existsSync(src) || !statSync(src).isFile()) die(`No such file: ${src}`);
    const fd = openSync(src, "r");
    const magic = Buffer.alloc(4);
    readSync(fd, magic, 0, 4, 0);
    closeSync(fd);
    if (magic[0] !== 0x1f || magic[1] !== 0x8b) die(`${basename(src)} is not a .tgz file (make it with deploy/selfhost/make-bundle.sh).`);
    const list = Bun.spawnSync(["tar", "-tzf", basename(src)], { cwd: dirname(src) }); // bare name: GNU tar reads "C:\..." as a remote host
    const names = list.stdout.toString().split("\n").map((n) => n.replace(/^\.\//, ""));
    if (list.exitCode !== 0 || !names.includes("install.sh") || !names.includes("app-src.tgz")) die(`${basename(src)} doesn't have install.sh and app-src.tgz at the top. Use deploy/selfhost/out/selfhost-bundle.tgz.`);
    if (db().query("SELECT 1 FROM packages WHERE version = ?").get(version)) die(`Version ${version} is already published. Use a new version number.`);
    const file = `${slug(CONFIG.productName)}-server-${version}.tgz`;
    const dest = join(PACKAGES_DIR, file);
    const tmp = `${dest}.part`;
    copyFileSync(src, tmp);
    const size = statSync(tmp).size;
    const sha256 = await sha256File(tmp);
    if (sha256 !== (await sha256File(src))) { unlinkSync(tmp); die("The copy doesn't match the original. Try again."); }
    renameSync(tmp, dest);
    recordPackage({ version, file, size, sha256, notes });
    console.log(`Published ${file}`);
    console.log(`  version ${version}, ${humanSize(size)}, sha256 ${sha256}${notes ? `, ${notes.split("\n").filter(Boolean).length} release notes` : ", no release notes (add them with: notes <version> <text>)"}`);
    console.log("New installs (and retries) now get this version, and buyers already installed see \"Update available\" on their setup link.");
    break;
  }

  case "notes": {
    const [version, notesIn] = args;
    if (!version || !notesIn || args.length !== 2) die("Usage: notes <version> <notes file or text>", 2);
    const notes = notesArg(notesIn);
    if (!setPackageNotes(version, notes)) die(`Version ${version} isn't published. See \`list\`.`);
    console.log(`Release notes for ${version} saved (${notes.split("\n").filter(Boolean).length} lines).`);
    break;
  }

  case "admin-link": {
    const { adminEnabled, isAdminEmail, newAdminLink } = await import("./admin-web");
    const email = (args[0] || "").trim().toLowerCase();
    if (!adminEnabled()) die("Admin is off: set ADMIN_EMAILS (comma-separated) first.");
    if (!email || !isAdminEmail(email)) die("Usage: admin-link <email>   (the email must be in ADMIN_EMAILS)", 2);
    console.log("One-time sign-in link (works once, for 15 minutes):");
    console.log(newAdminLink(email));
    break;
  }

  case "admin-hash": {
    let pw = "";
    if (process.stdin.isTTY) pw = prompt("Password (12+ characters):") || "";
    else pw = (await new Response(Bun.stdin.stream()).text()).replace(/\r?\n$/, "");
    if (pw.length < 12) die("Use at least 12 characters.");
    console.log(`ADMIN_PASSWORD_HASH=${await Bun.password.hash(pw, { algorithm: "argon2id" })}`);
    break;
  }

  case "backup": {
    // VACUUM INTO makes a clean, consistent copy while the site keeps running. The copy holds
    // buyers' encrypted keys: keep SETUP_SECRET_KEY somewhere else, never next to the backups.
    const dir = join(CONFIG.dataDir, "backups");
    const out = args[0] || join(dir, `site-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.db`);
    if (existsSync(out)) die(`${out} already exists.`);
    (await import("node:fs")).mkdirSync((await import("node:path")).dirname(out), { recursive: true, mode: 0o700 });
    db().query("VACUUM INTO ?").run(out);
    console.log(`Backed up to ${out} (${humanSize(statSync(out).size)})`);
    break;
  }

  case undefined:
  case "help":
  case "--help":
  case "-h":
    console.log(USAGE);
    break;

  default:
    die(`Unknown command "${cmd}".\n\n${USAGE}`, 2);
}
