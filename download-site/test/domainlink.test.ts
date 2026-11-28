import { expect, test } from "bun:test";
// In its own process: the site's settings come from the environment when it is first loaded.
test("the app's Change domain link: token in, short-lived signed address out, straight to the domain form", async () => {
  const p = Bun.spawn(["bun", "test", "./test/domainlink.inner.ts"], { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe", env: process.env });
  const out = (await new Response(p.stderr).text()) + (await new Response(p.stdout).text());
  expect({ code: await p.exited, out }).toMatchObject({ code: 0 });
}, 60_000);
