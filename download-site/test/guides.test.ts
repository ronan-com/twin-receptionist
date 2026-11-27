// bun test download-site/test/guides.test.ts
// Every step-by-step guide has numbered steps (a few lines each), a "Common problems" list and a checked date, no
// guide or helper text sends the buyer to a person, DigitalOcean isn't in the helper's knowledge, every wizard step
// that needs an outside account has a guide, and the helper's prompt carries the same guides. Code spans (things to
// paste) get a Copy button.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PROVIDER_IDS, markdown, howTo } from "../content";
import { STEP_GUIDES, STEPS_NOT_USED, STEPS_WITHOUT_GUIDE, allGuidesForHelper } from "../guides";
import { STEPS } from "../store";
import { systemPrompt } from "../chat";

const dir = resolve(import.meta.dir, "../../handoff-content/providers");
const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
const parts = (f: string) => {
  const raw = readFileSync(join(dir, f), "utf8");
  const meta = raw.match(/^---\n([\s\S]*?)\n---\n/)?.[1] || "";
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  const [steps, problems = ""] = body.split(/^## Common problems\s*$/m);
  return { raw, meta, body, steps, problems };
};
// Wording that sends a buyer to a person. The guides and the helper never do that.
const PERSON = /\b(contact (us|support|our|the team)|talk to (a|our|someone)|speak to|get in touch|reach out|email us|call us|support (team|email|desk)|customer support|help ?desk|support@)/i;

test("every provider id has a real guide file, and every file is a known id", () => {
  expect(files.map((f) => f.replace(/\.md$/, "")).sort()).toEqual([...PROVIDER_IDS].sort());
});

test("each guide: numbered steps, a Common problems list with fixes, and a checked date", () => {
  for (const f of files) {
    const { meta, steps, problems } = parts(f);
    const n = steps.split("\n").filter((l) => /^\d+\.\s/.test(l));
    expect(n.length, `${f} steps`).toBeGreaterThanOrEqual(3);
    expect(n.length, `${f} steps`).toBeLessThanOrEqual(9);
    for (const s of n) expect(s.length, `${f}: ${s}`).toBeLessThan(520);
    const p = problems.split("\n").filter((l) => /^- \*\*/.test(l));
    expect(p.length, `${f} problems`).toBeGreaterThanOrEqual(3);
    for (const l of p) expect(l, `${f}: ${l}`).toMatch(/^- \*\*[^*]+\*\*\s+\S/); // a bold problem, then its fix
    expect(meta, f).toMatch(/^checked: \d{1,2} [A-Z][a-z]{2} 20\d\d$/m);
    expect(meta, f).toMatch(/^link: https:\/\//m);
  }
});

test("no guide, and nothing the helper is told, sends the buyer to a person or an email address", () => {
  for (const f of files) expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(PERSON);
  const prompt = systemPrompt({});
  expect(prompt).not.toMatch(PERSON);
  expect(prompt).not.toMatch(/emailing|purchase email/i);
  expect(allGuidesForHelper()).not.toMatch(/[\w.-]+@[\w-]+\.[a-z]{2,}/i);
});

test("hosting is Railway only: no DigitalOcean guide or helper knowledge", () => {
  expect(files).not.toContain("digitalocean-token.md");
  expect((PROVIDER_IDS as readonly string[]).includes("digitalocean-token")).toBe(false);
  expect(systemPrompt({})).not.toMatch(/digitalocean|droplet/i);
  expect(allGuidesForHelper()).not.toMatch(/digitalocean|droplet/i);
});

test("every wizard step has a guide (with common problems) or needs no outside account", () => {
  for (const id of STEPS) {
    if (STEPS_WITHOUT_GUIDE.includes(id) || STEPS_NOT_USED.includes(id)) continue;
    const ids = STEP_GUIDES[id];
    expect(ids?.length, `step ${id} has no guide`).toBeGreaterThan(0);
    for (const g of ids!) {
      const h = howTo(g);
      expect(h.placeholder, `${g} is still a placeholder`).toBe(false);
      expect(h.md, g).toContain("## Common problems");
      expect(h.html, g).toContain("<h4>Common problems</h4>");
    }
  }
  // No step is in two lists.
  for (const id of [...STEPS_WITHOUT_GUIDE, ...STEPS_NOT_USED]) expect(STEP_GUIDES[id], id).toBeUndefined();
});

test("the helper's prompt carries every guide, steps and common problems, and the step they are on", () => {
  const prompt = systemPrompt({ view: "railway" });
  for (const id of PROVIDER_IDS) {
    const h = howTo(id);
    expect(prompt, id).toContain(`### ${h.title}`);
  }
  expect(prompt).toContain("Common problems");
  expect(prompt).toContain("sk-or-v1-"); // the OpenRouter key shape is in the OpenRouter guide
  expect(prompt).toContain("Guides for the page they have open");
});

test("the helper card can be hidden: a Hide button, a Show button, remembered", () => {
  const w = readFileSync(resolve(import.meta.dir, "../wizard.ts"), "utf8");
  const js = readFileSync(resolve(import.meta.dir, "../public/wizard.js"), "utf8");
  expect(w).toContain('class="hhide"');
  expect(w).toContain('class="hshow"');
  expect(js).toContain("setup-helper-off");
});

test("code spans become a copy button; the rest of the markdown is unchanged", () => {
  const html = markdown("1. Type `Setup` and click **Create**.", 1, true);
  expect(html).toContain('<span class="cp"><code>Setup</code><button type="button" class="copy" data-copy="Setup" hidden>Copy</button></span>');
  expect(html).toContain("<b>Create</b>");
  expect(markdown("Use `x`.")).toBe("<p>Use <code>x</code>.</p>");
});
