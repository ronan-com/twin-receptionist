// The long-running work: create the server, then install onto it. Both run
// in the background so the page can be closed; progress goes into state and
// the install log, and both pick up where they left off after a restart.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { doApi, DOError, MOCK } from "./providers";
import { load, update, save, logAppend, logReset, scrub, type State } from "./state";
import { ensureKeypair, forgetHost, scpUpload, sshAnswers, sshRun } from "./ssh";

const here = import.meta.dir;
export const BUNDLE_PATH =
  process.env.BUNDLE_PATH ||
  [join(here, "../bundle/selfhost-bundle.tgz"), resolve(here, "../../deploy/selfhost/out/selfhost-bundle.tgz")].find((p) => existsSync(p)) ||
  join(here, "../bundle/selfhost-bundle.tgz");

const R = "/opt/receptionist";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let serverBusy = false;
let installBusy = false;

function progress(msg: string) {
  update((s) => {
    s.server!.progress.push(msg);
  });
  console.log("[server] " + msg);
}

function dropletName(s: State) {
  const base = (s.brand?.productName || "receptionist").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "receptionist";
  return `${base}-server`;
}

function publicIp(d: any): string | undefined {
  return d?.networks?.v4?.find((n: any) => n.type === "public")?.ip_address;
}

// ---------------- create server ----------------

export function startCreateServer() {
  if (serverBusy) return;
  const s = load();
  if (s.server?.phase === "ready") return;
  update((s) => {
    s.server = { ...(s.server || { progress: [] }), phase: "creating", error: undefined, progress: s.server?.progress?.length && s.server?.dropletId ? s.server.progress : [] };
  });
  serverBusy = true;
  createServer()
    .catch((e) => {
      const msg = e instanceof DOError || e?.userMessage ? e.message : "Something went wrong: " + scrub(String(e?.message || e));
      update((s) => {
        s.server!.phase = "failed";
        s.server!.error = msg;
      });
      console.log("[server] failed: " + scrub(String(e?.message || e)));
    })
    .finally(() => (serverBusy = false));
}

class UserError extends Error {
  userMessage = true;
}

async function createServer() {
  let s = load();
  const token = s.digitalocean?.token;
  if (!token) throw new UserError("The DigitalOcean token is missing. Go back to the DigitalOcean step and paste it again.");

  progress("Making a private key for your server");
  const pub = await ensureKeypair();

  s = load();
  if (!s.server!.sshKeyId) {
    progress("Adding the key to your DigitalOcean account");
    const r = await doApi(token, "POST", "/v2/account/keys", { name: `${dropletName(s)} key ${new Date().toISOString().slice(0, 10)}`, public_key: pub });
    update((s) => {
      s.server!.sshKeyId = r.ssh_key.id;
      s.server!.sshFingerprint = r.ssh_key.fingerprint;
    });
  }

  s = load();
  if (s.server!.dropletId) {
    try {
      await doApi(token, "GET", `/v2/droplets/${s.server!.dropletId}`);
    } catch (e) {
      if (e instanceof DOError && e.status === 404) {
        progress("The server we made earlier is gone, so we'll make a new one");
        update((s) => {
          s.server!.dropletId = undefined;
          s.server!.ip = undefined;
        });
      } else throw e;
    }
  }

  s = load();
  if (!s.server!.dropletId) {
    progress(`Creating the server (${s.digitalocean!.size} in ${s.digitalocean!.region})`);
    forgetHost();
    const r = await doApi(token, "POST", "/v2/droplets", {
      name: dropletName(s),
      region: s.digitalocean!.region,
      size: s.digitalocean!.size,
      image: "ubuntu-24-04-x64",
      ssh_keys: [s.server!.sshKeyId],
      tags: ["receptionist"],
      monitoring: true,
      ipv6: false,
    });
    update((s) => {
      s.server!.dropletId = r.droplet.id;
    });
  }

  progress("Waiting for DigitalOcean to start it (usually about a minute)");
  const deadline = Date.now() + 10 * 60_000;
  let ip: string | undefined;
  for (;;) {
    const r = await doApi(token, "GET", `/v2/droplets/${load().server!.dropletId}`);
    ip = publicIp(r.droplet);
    if (r.droplet.status === "active" && ip) break;
    if (Date.now() > deadline) throw new UserError("DigitalOcean is taking unusually long to start the server. Press Try again in a few minutes.");
    await sleep(MOCK ? 1000 : 5000);
  }
  update((s) => {
    s.server!.ip = ip;
  });
  progress(`Server is on at ${ip}`);

  progress("Waiting for the server to let us in");
  const sshDeadline = Date.now() + 6 * 60_000;
  while (!(await sshAnswers(ip!))) {
    if (Date.now() > sshDeadline) throw new UserError("The server started but isn't letting us connect yet. Press Try again in a minute.");
    await sleep(MOCK ? 1000 : 5000);
  }
  progress("Connected to your server");
  update((s) => {
    s.server!.phase = "ready";
    if (s.step === "server") s.step = "dns";
    s.dns = { ok: false, checks: 0 };
  });
}

// ---------------- delete server ----------------

export async function deleteServer(): Promise<{ ok: boolean; message: string }> {
  const s = load();
  const token = s.digitalocean?.token;
  if (!token) return { ok: false, message: "The DigitalOcean token is missing, so we can't delete the server from here. Delete it in DigitalOcean under Droplets." };
  if (installBusy || serverBusy) return { ok: false, message: "Wait for the current step to finish first." };
  try {
    if (s.server?.dropletId) await doApi(token, "DELETE", `/v2/droplets/${s.server.dropletId}`).catch((e) => {
      if (!(e instanceof DOError && e.status === 404)) throw e;
    });
    if (s.server?.sshKeyId) await doApi(token, "DELETE", `/v2/account/keys/${s.server.sshKeyId}`).catch(() => {});
  } catch (e: any) {
    return { ok: false, message: e.message };
  }
  forgetHost();
  update((s) => {
    s.server = { phase: "idle", progress: [] };
    s.dns = undefined;
    s.install = undefined;
    s.step = "server";
  });
  logReset();
  return { ok: true, message: "The server was deleted. You won't be charged for it any more." };
}

// ---------------- install ----------------

/** Matches read_env in deploy/selfhost/lib.sh: values are literal, one pair of
 *  surrounding quotes is stripped, and inside double quotes only \" and \\ are escapes. */
function envValue(v: string) {
  v = v.replace(/\r?\n/g, " ");
  if (!v.includes("'")) return `'${v}'`;
  return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

export function buildEnv(s: State): string {
  const vals: Record<string, string> = {
    PRODUCT_NAME: s.brand?.productName || "",
    DOMAIN: s.domain || "",
    FIRST_ADMIN_EMAIL: s.brand?.ownerEmail || "",
    TELNYX_API_KEY: s.telnyx?.apiKey || "",
    OWN_PHONE_ACCOUNT: s.brand?.ownPhoneAccount ? "required" : "",
    SMTP_URL: s.email?.smtpUrl || "",
    MAIL_FROM: s.email?.mailFrom || "",
    GOOGLE_CLIENT_ID: s.calendar?.google?.clientId || "",
    GOOGLE_CLIENT_SECRET: s.calendar?.google?.clientSecret || "",
    MICROSOFT_CLIENT_ID: s.calendar?.microsoft?.clientId || "",
    MICROSOFT_CLIENT_SECRET: s.calendar?.microsoft?.clientSecret || "",
  };
  return "# Written by the setup app. Keep this file private.\n" + Object.entries(vals).map(([k, v]) => `${k}=${envValue(v)}`).join("\n") + "\n";
}

function out(text: string) {
  logAppend(scrub(text));
}

export function installRunning() {
  return installBusy;
}

export function startInstall() {
  if (installBusy) return;
  const s = load();
  if (!s.server?.ip || s.server.phase !== "ready") return;
  update((s) => {
    s.install = { phase: "running", attempts: (s.install?.attempts || 0) + 1 };
    s.step = "install";
  });
  logReset();
  installBusy = true;
  runInstall()
    .then((r) => finishInstall(r))
    .catch((e) => finishInstall({ ok: false, reason: e?.userMessage ? e.message : "Something went wrong: " + scrub(String(e?.message || e)) }))
    .finally(() => (installBusy = false));
}

/** After a restart: if the server is still installing, re-attach to its log. */
export function resumeInstallIfNeeded() {
  const s = load();
  if (s.install?.phase !== "running" || !s.server?.ip || installBusy) return;
  installBusy = true;
  logReset();
  out("(Reconnecting to your server to follow the install…)\n");
  follow(s.server.ip)
    .then((r) => finishInstall(r))
    .catch((e) => finishInstall({ ok: false, reason: scrub(String(e?.message || e)) }))
    .finally(() => (installBusy = false));
}

function finishInstall(r: { ok: boolean; url?: string; reason?: string }) {
  update((s) => {
    s.install = { ...(s.install || { attempts: 1 }), phase: r.ok ? "ok" : "failed", url: r.url, error: r.reason };
    if (r.ok) s.step = "done";
  });
  console.log(`[install] ${r.ok ? "OK" : "FAILED"}`);
}

async function step(ip: string, label: string, cmd: string, input?: string) {
  out(`\n▸ ${label}\n`);
  const r = await sshRun(ip, cmd, input);
  if (r.stdout.trim()) out(r.stdout.endsWith("\n") ? r.stdout : r.stdout + "\n");
  if (r.code !== 0) {
    out(r.stderr);
    throw new UserError(`${label} didn't work (${scrub(r.stderr.trim().split("\n").pop() || "exit " + r.code)}).`);
  }
}

const MOCK_STUB = `#!/bin/bash
# Test mode only: stands in for the last part of install.sh (which needs
# Docker inside the server, and a test container can't run Docker).
set -e
cd ${R}
echo "[test mode] install.sh is present: $(test -f install.sh && echo yes)"
bash -n install.sh && echo "[test mode] install.sh passes a syntax check"
perm=$(stat -c %a .env); echo "[test mode] .env permissions: $perm"
[ "$perm" = "600" ] || { echo "INSTALL FAILED: .env is not private"; exit 1; }
for k in PRODUCT_NAME DOMAIN FIRST_ADMIN_EMAIL TELNYX_API_KEY OWN_PHONE_ACCOUNT SMTP_URL MAIL_FROM GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET; do
  grep -q "^$k=" .env || { echo "INSTALL FAILED: .env is missing $k"; exit 1; }
done
source ./lib.sh; read_env ./.env
echo "[test mode] .env read with lib.sh read_env: product '\${CONF[PRODUCT_NAME]}', domain \${CONF[DOMAIN]}, admin \${CONF[FIRST_ADMIN_EMAIL]}"
[ -f app-src.tgz ] && echo "[test mode] app-src.tgz is present ($(du -h app-src.tgz | cut -f1))"
for s in "Installing Docker" "Starting the database" "Starting the app" "Getting a security certificate"; do echo "$s..."; sleep 1; done
if [ -f /tmp/fail-next-install ]; then rm -f /tmp/fail-next-install; echo "INSTALL FAILED: test failure (the next try will work)"; exit 1; fi
echo "INSTALL OK https://\${CONF[DOMAIN]}"
`;

async function runInstall(): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const s = load();
  const ip = s.server!.ip!;
  if (!existsSync(BUNDLE_PATH)) throw new UserError("The app bundle is missing from this installer. Download the installer again.");

  out(`Installing onto your server at ${ip}\n`);
  await step(ip, "Preparing the server", `mkdir -p ${R} && chmod 755 ${R} && echo ok`);
  out("\n▸ Uploading the app\n");
  const up = await scpUpload(ip, BUNDLE_PATH, `${R}/selfhost-bundle.tgz`);
  if (up.code !== 0) throw new UserError("Uploading the app didn't work: " + scrub(up.stderr.trim()));
  out("uploaded\n");
  // The bundle may hold install.sh at its top level or inside one folder; handle both.
  await step(
    ip,
    "Unpacking the app",
    `set -e; t=$(mktemp -d); tar -xzf ${R}/selfhost-bundle.tgz -C "$t"; f=$(find "$t" -maxdepth 2 -name install.sh -type f | head -1); ` +
      `[ -n "$f" ] || { echo "install.sh not found in bundle" >&2; exit 1; }; cp -a "$(dirname "$f")/." ${R}/; rm -rf "$t"; echo unpacked`,
  );
  await step(ip, "Saving your settings", `set -e; umask 077; cat > ${R}/.env.new && chmod 600 ${R}/.env.new && mv ${R}/.env.new ${R}/.env && echo saved`, buildEnv(s));

  let cmd = `sudo bash ${R}/install.sh`;
  if (MOCK && process.env.MOCK_REAL_INSTALL !== "1") {
    await step(ip, "Test mode: using a stand-in for the final install step", `cat > ${R}/.mock-install.sh && echo ready`, MOCK_STUB);
    if (process.env.MOCK_FAIL_FIRST_INSTALL === "1" && s.install!.attempts === 1) await sshRun(ip, "touch /tmp/fail-next-install");
    cmd = `sudo bash ${R}/.mock-install.sh`;
  }

  out("\n▸ Running the installer on your server (this takes a few minutes)\n");
  // Run detached on the server so a dropped connection (or a closed laptop) doesn't kill it.
  const launch =
    `cd ${R} && rm -f install.exit install.pid && : > install.log && chmod 600 install.log && ` +
    `setsid nohup bash -c 'echo $$ > ${R}/install.pid; ${cmd} > ${R}/install.log 2>&1; echo $? > ${R}/install.exit' > /dev/null 2>&1 < /dev/null & ` +
    `for i in $(seq 1 50); do [ -s ${R}/install.pid ] && break; sleep 0.1; done; cat ${R}/install.pid`;
  const r = await sshRun(ip, launch);
  if (r.code !== 0) throw new UserError("Couldn't start the installer on the server: " + scrub(r.stderr.trim()));
  return follow(ip);
}

/** Stream the server's install log until the install finishes. Reconnects if the connection drops. */
async function follow(ip: string): Promise<{ ok: boolean; url?: string; reason?: string }> {
  let all = "";
  for (let attempt = 0; attempt < 30; attempt++) {
    let seen = 0;
    const cmd =
      `p=$(cat ${R}/install.pid 2>/dev/null); ` +
      `if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then tail -c +1 -F --pid="$p" ${R}/install.log 2>/dev/null; else cat ${R}/install.log 2>/dev/null; fi; ` +
      `echo; echo "__INSTALL_EXIT__ $(cat ${R}/install.exit 2>/dev/null || echo none)"`;
    let buf = "";
    const res = await sshRun(ip, cmd, undefined, (chunk) => {
      buf += chunk;
      // Only print whole lines and hold back our own marker.
      const idx = buf.lastIndexOf("\n");
      if (idx < 0) return;
      const ready = buf.slice(0, idx + 1);
      buf = buf.slice(idx + 1);
      const parts = ready.split("\n");
      parts.pop(); // trailing "" after the last newline
      const lines = parts.filter((l, i, a) => !l.startsWith("__INSTALL_EXIT__") && !(l === "" && a[i + 1]?.startsWith("__INSTALL_EXIT__")));
      const text = lines.map((l) => l + "\n").join("");
      // On a reconnect the log is replayed from the start; only show what's new.
      const start = seen;
      seen += text.length;
      if (seen <= all.length) return;
      const fresh = text.slice(Math.max(0, all.length - start));
      all += fresh;
      out(fresh);
    });
    const m = (res.stdout + buf).match(/__INSTALL_EXIT__ (\S+)/);
    if (m && m[1] !== "none") {
      const okLine = all.match(/^INSTALL OK (https?:\/\/\S+)/m);
      const failLine = all.match(/^INSTALL FAILED:\s*(.*)$/m);
      if (okLine && m[1] === "0") return { ok: true, url: okLine[1] };
      if (failLine) return { ok: false, reason: failLine[1].trim() };
      return { ok: false, reason: okLine ? `the installer said OK but exited with code ${m[1]}` : `the installer stopped (code ${m[1]}) without saying why` };
    }
    if (m && m[1] === "none") {
      // Process gone but no exit code: it was killed (e.g. the server rebooted).
      const pidGone = (await sshRun(ip, `p=$(cat ${R}/install.pid 2>/dev/null); [ -n "$p" ] && kill -0 "$p" 2>/dev/null && echo alive || echo gone`)).stdout.trim();
      if (pidGone === "gone") return { ok: false, reason: "the installer was interrupted on the server (it may have restarted)" };
    }
    out("\n(Lost the connection to your server; reconnecting…)\n");
    await sleep(5000);
  }
  return { ok: false, reason: "we lost the connection to your server and couldn't get it back" };
}

export function saveState() {
  save();
}
