// bun test download-site/test/guides.test.ts
// Every "Show me how" guide stays dead simple: five numbered steps at most, one short sentence each,
// and a "Stuck?" line at the end. Code spans (things to paste) get a Copy button.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { markdown } from "../content";

const dir = resolve(import.meta.dir, "../../handoff-content/providers");

test("each guide: 5 steps or fewer, short steps, a Stuck? line", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  expect(files.length).toBe(14);
  for (const f of files) {
    const body = readFileSync(join(dir, f), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
    const steps = body.split("\n").filter((l) => /^\d+\.\s/.test(l));
    expect(steps.length, f).toBeGreaterThanOrEqual(3);
    expect(steps.length, f).toBeLessThanOrEqual(5);
    for (const s of steps) expect(s.length, `${f}: ${s}`).toBeLessThan(400);
    expect(body, f).toMatch(/^> \*\*Stuck\?\*\*/m);
  }
});

test("code spans become a copy button; the rest of the markdown is unchanged", () => {
  const html = markdown("1. Type `Setup` and click **Create**.", 1, true);
  expect(html).toContain('<span class="cp"><code>Setup</code><button type="button" class="copy" data-copy="Setup" hidden>Copy</button></span>');
  expect(html).toContain("<b>Create</b>");
  expect(markdown("Use `x`.")).toBe("<p>Use <code>x</code>.</p>");
});
