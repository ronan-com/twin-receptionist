// A custom domain that doesn't answer yet is not used for hooks and links: the Railway address is, until it answers.
import { expect, test } from "bun:test";
import { join } from "node:path";

async function run(env: Record<string, string>, code: string): Promise<string> {
  const p = Bun.spawn(["bun", "-e", code], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, PUBLIC_URL: "", FALLBACK_URL: "", RAILWAY_PUBLIC_DOMAIN: "", ...env } });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return (out + err).trim();
}

test("publicUrl: custom domain pending uses the Railway address; live custom domain wins; no fallback keeps PUBLIC_URL", async () => {
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response('{"ok":true}') });
  const code = `import { publicUrl, customDomainPending, probePublicUrl } from "./server/booking"; const a = publicUrl(); const p = customDomainPending(); const ok = await probePublicUrl(1500); console.log(JSON.stringify({ a, p, ok, b: publicUrl() }));`;
  try {
    // Pending: domain doesn't resolve (reserved .invalid name), fallback is the Railway address.
    const pending = JSON.parse(await run({ PUBLIC_URL: "https://agency.invalid", FALLBACK_URL: "https://app-x.up.railway.app" }, code));
    expect(pending).toEqual({ a: "https://app-x.up.railway.app", p: true, ok: false, b: "https://app-x.up.railway.app" });
    // RAILWAY_PUBLIC_DOMAIN works the same (older installs have no FALLBACK_URL).
    const rw = JSON.parse(await run({ PUBLIC_URL: "https://agency.invalid", RAILWAY_PUBLIC_DOMAIN: "app-y.up.railway.app" }, code));
    expect(rw.a).toBe("https://app-y.up.railway.app");
    // No fallback (not a Railway install, or no custom domain): PUBLIC_URL as before.
    const plain = JSON.parse(await run({ PUBLIC_URL: "https://agency.invalid" }, code));
    expect(plain).toEqual({ a: "https://agency.invalid", p: false, ok: true, b: "https://agency.invalid" });
    const same = JSON.parse(await run({ PUBLIC_URL: "https://app-x.up.railway.app", FALLBACK_URL: "https://app-x.up.railway.app" }, code));
    expect(same.a).toBe("https://app-x.up.railway.app");
  } finally { srv.stop(true); }
});
