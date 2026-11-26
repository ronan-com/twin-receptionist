// bun test download-site/test/railwayUp.test.ts
// server/railwayUp.ts (the app) and download-site/railwayUp.ts (the setup site) are the same file: the setup
// site's Docker context can't import ../server, and the app bundle leaves out download-site/. If they drift, this fails.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("the two copies of railwayUp.ts are byte for byte the same", () => {
  const app = join(import.meta.dir, "..", "..", "server", "railwayUp.ts");
  const site = join(import.meta.dir, "..", "railwayUp.ts");
  expect(existsSync(site)).toBe(true);
  if (!existsSync(app)) return; // inside the setup-site image there is no ../server: nothing to compare
  expect(readFileSync(site, "utf8")).toBe(readFileSync(app, "utf8"));
});

test("it imports nothing from either project", () => {
  const src = readFileSync(join(import.meta.dir, "..", "railwayUp.ts"), "utf8");
  expect(src).not.toMatch(/^\s*import\s/m);
});
