// bun test download-site/test/dnsdelete.test.ts
// Delete the project / Delete the server take back the DNS records the install wrote (GoDaddy and Cloudflare),
// and the DigitalOcean path writes its A record with GoDaddy like Railway does. Once per hosting mode.
import { expect, test } from "bun:test";
import { join } from "node:path";

for (const hosting of ["railway", "digitalocean"]) {
  test(`dns delete + GoDaddy on ${hosting}`, async () => {
    const p = Bun.spawn(["bun", "test", "./test/dnsdelete.inner.ts"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, DNSDELETE_INNER: "1", HOSTING: hosting } });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (code !== 0) console.log((out + err).slice(-6000));
    expect(out + err).not.toMatch(/\b[1-9]\d* fail/);
    expect(out + err).toMatch(/\b\d+ pass/);
    expect(code).toBe(0);
  }, 120_000);
}
