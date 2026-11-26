// Screenshots of /, /download/<code> and /guide at desktop and phone width.
//   node download-site/test/shots.mjs http://localhost:4500 <code>
// Uses puppeteer-core from the repo's node_modules and the snap Chromium.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const [base = "http://localhost:4500", code] = process.argv.slice(2);
if (!code) throw new Error("usage: node shots.mjs <base-url> <download-code>");
const out = join(dirname(fileURLToPath(import.meta.url)), "../test-shots");
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/snap/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
  userDataDir: process.env.CHROME_PROFILE || undefined,
});
const pages = [["home", "/"], ["download", `/download/${code}`], ["guide", "/guide"]];
const sizes = [["desktop", { width: 1280, height: 860, deviceScaleFactor: 1 }], ["phone", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]];
for (const [name, path] of pages) {
  for (const [label, vp] of sizes) {
    const p = await browser.newPage();
    await p.setViewport(vp);
    await p.goto(base + path, { waitUntil: "networkidle0" });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const file = join(out, `${name}-${label}.png`);
    await p.screenshot({ path: file, fullPage: true });
    console.log(`${file}${overflow ? "  WARNING: horizontal overflow" : ""}`);
    await p.close();
  }
}
await browser.close();
