// Builds the droplet's user_data: the script cloud-init runs once at first boot.
// It never gives us a way in. It writes the settings, then starts provision/runner.sh,
// which only asks our site "is it time?", downloads the app bundle with a one-time link,
// runs install.sh, posts its output back, and stops for good.
// DigitalOcean caps user_data at 64 KiB; this is about 4 KiB plus the settings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "./lib";

export const USER_DATA_LIMIT = 64 * 1024;
const RUNNER = readFileSync(join(import.meta.dir, "provision/runner.sh"), "utf8");

/** One .env line per the deploy/selfhost contract: KEY=value, raw. read_env strips one pair
 *  of matching surrounding quotes, so only a value that is itself quote-wrapped is escaped. */
export function envLine(k: string, v: string): string {
  v = String(v ?? "").replace(/[\r\n]+/g, " ");
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  return `${k}=${v}`;
}
export const buildEnv = (vals: Record<string, string>) =>
  "# Written by the setup wizard. Keep this file private.\n" + Object.entries(vals).map(([k, v]) => envLine(k, v)).join("\n") + "\n";

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function buildUserData(opts: { dropletToken: string; env: string; productName: string; testMode: boolean }): string {
  const b64 = Buffer.from(opts.env, "utf8").toString("base64").replace(/(.{76})/g, "$1\n").trim();
  // Test mode only (MOCK_DO=1): install.sh's own test switches, for the local fake droplet.
  const runner = RUNNER.replace("#TEST_ENV#", opts.testMode ? "export SELFHOST_TEST=1 SKIP_DNS_CHECK=1   # TEST MODE ONLY (fake droplet)" : "");
  const label = opts.productName.replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 60) || "Receptionist";
  return `#!/bin/bash
# ${label} server setup. DigitalOcean runs this once, at first boot.
# It downloads the app from ${CONFIG.provisionUrl} with a one-time link, writes your
# settings to /opt/receptionist/.env, runs /opt/receptionist/install.sh and reports
# progress to your setup page. It opens no way in for anyone, and stops when done.
set -u
umask 077
S=/opt/receptionist/setup
mkdir -p "$S" && chmod 755 /opt/receptionist && chmod 700 "$S"
printf '%s' ${sq(CONFIG.provisionUrl)} > "$S/site"
printf '%s' ${sq(opts.dropletToken)} > "$S/token"
base64 -d > "$S/settings.env" <<'SETTINGS'
${b64}
SETTINGS
chmod 600 "$S/settings.env"
cat > "$S/run.sh" <<'RUNNER'
${runner.trimEnd()}
RUNNER
chmod 700 "$S/run.sh"
if [ -d /run/systemd/system ]; then
  systemd-run --unit=receptionist-setup --description="${label} setup" /bin/bash "$S/run.sh"
else
  setsid nohup /bin/bash "$S/run.sh" > "$S/run.log" 2>&1 < /dev/null &
fi
`;
}
