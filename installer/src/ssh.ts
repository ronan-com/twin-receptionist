// Thin wrappers around the system ssh/scp. The key is copied to a private
// temp file before use: on Windows/Mac bind mounts the /state copy can look
// world-readable, and ssh refuses keys like that.
import { copyFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEY_FILE, PUB_FILE, STATE_DIR, writeSecretFile } from "./state";

const runtimeDir = mkdtempSync(join(tmpdir(), "rcpt-ssh-"));
const runtimeKey = join(runtimeDir, "id");
const knownHosts = join(runtimeDir, "known_hosts");

export async function ensureKeypair(): Promise<string> {
  if (!existsSync(KEY_FILE) || !existsSync(PUB_FILE)) {
    const tmp = join(runtimeDir, "gen");
    rmSync(tmp, { force: true });
    rmSync(tmp + ".pub", { force: true });
    const p = Bun.spawn(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "receptionist-server", "-f", tmp], { stdout: "ignore", stderr: "pipe" });
    if ((await p.exited) !== 0) throw new Error("Couldn't create the server key: " + (await new Response(p.stderr).text()));
    writeSecretFile(KEY_FILE, readFileSync(tmp, "utf8"));
    writeSecretFile(PUB_FILE, readFileSync(tmp + ".pub", "utf8"));
    rmSync(tmp, { force: true });
    rmSync(tmp + ".pub", { force: true });
  }
  return readFileSync(PUB_FILE, "utf8").trim();
}

function prepKey() {
  copyFileSync(KEY_FILE, runtimeKey);
  chmodSync(runtimeKey, 0o600);
}

export function forgetHost() {
  rmSync(knownHosts, { force: true });
}

const baseOpts = () => [
  "-i", runtimeKey,
  "-o", "IdentitiesOnly=yes",
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=accept-new",
  "-o", `UserKnownHostsFile=${knownHosts}`,
  "-o", "ConnectTimeout=10",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=8",
  "-o", "LogLevel=ERROR",
];

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command on the server. `input` is piped to stdin (used for the .env so secrets never sit in argv). */
export async function sshRun(ip: string, command: string, input?: string, onData?: (chunk: string) => void): Promise<RunResult> {
  prepKey();
  const p = Bun.spawn(["ssh", ...baseOpts(), `root@${ip}`, command], {
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });
  let stdout = "";
  const dec = new TextDecoder();
  const reader = (p.stdout as ReadableStream<Uint8Array>).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const s = dec.decode(value, { stream: true });
    stdout += s;
    onData?.(s);
  }
  const stderr = await new Response(p.stderr).text();
  const code = await p.exited;
  return { code, stdout, stderr };
}

export async function scpUpload(ip: string, localPath: string, remotePath: string): Promise<RunResult> {
  prepKey();
  const p = Bun.spawn(["scp", "-q", ...baseOpts(), localPath, `root@${ip}:${remotePath}`], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, stdout, stderr };
}

export async function sshAnswers(ip: string): Promise<boolean> {
  try {
    const r = await sshRun(ip, "true");
    return r.code === 0;
  } catch {
    return false;
  }
}

export { STATE_DIR };
