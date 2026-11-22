// Area M: browser test of the marketing homepage at desktop (1440) and phone (390) widths.
// Needs the server: E2E_PORT=8904 E2E_DB=e2e_m bash scripts/e2e/setup.sh, then: node scripts/e2e/m-home.mjs
//   BASE (default http://localhost:8904)   SHOTS (default $HOME/aibiz/answered-port-notes/shots)
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE ?? `http://localhost:${process.env.E2E_PORT ?? 8904}`;
const SHOTS = process.env.SHOTS ?? join(homedir(), "aibiz/answered-port-notes/shots");
const PROFILE = join(homedir(), "aibiz/answered-port-notes/e2e-m/chrome-profile");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(PROFILE, { recursive: true });

const results = [];
const T0 = Date.now();
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${((Date.now() - T0) / 1000).toFixed(0)}s] ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  protocolTimeout: 60000,
  executablePath: "/snap/bin/chromium",
  headless: "new",
  userDataDir: PROFILE,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--mute-audio"],
});

browser.on("disconnected", () => console.log(`browser disconnected after ${((Date.now() - T0) / 1000).toFixed(0)}s`));

function watch(page) {
  const problems = [];
  const external = new Set();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("error", (e) => console.log(`page crashed: ${e.message}`));
  page.on("requestfailed", (r) => {
    // Media range requests are cancelled when the player seeks; that's normal.
    if (r.resourceType() === "media" && r.failure()?.errorText === "net::ERR_ABORTED") return;
    problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`);
  });
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin !== new URL(BASE).origin && !u.protocol.startsWith("data")) external.add(u.host);
  });
  return { problems, external };
}

async function scrollThrough(page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const vh = await page.evaluate(() => innerHeight);
  for (let y = 0; y < h; y += Math.round(vh * 0.6)) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await sleep(180);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(600);
}

async function run(label, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const { problems, external } = watch(page);
  await page.evaluateOnNewDocument(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  const resp = await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 30000 });
  check(`${label}: page loads`, resp?.status() === 200, `status ${resp?.status()}`);
  await page.waitForSelector("h1", { timeout: 10000 });
  await sleep(2500);
  const h1 = await page.$eval("h1", (e) => e.textContent?.trim());
  check(`${label}: hero heading`, h1 === "Every call, answered.", h1);
  check(`${label}: title`, (await page.title()).startsWith("Answered"), await page.title());

  const cls = await page.evaluate(() => window.__cls);
  check(`${label}: layout shift during load < 0.1`, cls < 0.1, `CLS ${cls.toFixed(4)}`);

  // Canvases (hero ribbon, call globe) are sized and drawing.
  const canvases = await page.$$eval("canvas", (cs) =>
    cs.map((c) => {
      const ctx = c.getContext("2d");
      let painted = false;
      try {
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) { painted = true; break; }
      } catch {}
      return { w: c.width, h: c.height, painted };
    }),
  );
  check(`${label}: hero ribbon canvas drawn`, canvases[0]?.w > 0 && canvases[0]?.painted, JSON.stringify(canvases[0]));

  // No horizontal scrolling.
  const overflow = await page.evaluate(() => {
    window.scrollTo(500, window.scrollY);
    const sx = window.scrollX;
    window.scrollTo(0, window.scrollY);
    return { sx, sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: innerWidth };
  });
  check(`${label}: no horizontal overflow`, overflow.sx === 0 && overflow.sw <= overflow.iw && overflow.bw <= overflow.iw, JSON.stringify(overflow));

  await scrollThrough(page);
  const globe = await page.$$eval("canvas", (cs) => cs.length);
  check(`${label}: globe canvas present`, globe >= 2, `${globe} canvases`);
  const globeDrawn = await page.$$eval("canvas", (cs) => {
    const c = cs[1];
    if (!c || !c.width) return false;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4 * 101) if (d[i] > 0) return true;
    return false;
  });
  check(`${label}: globe canvas drawn`, globeDrawn);

  // Every image loaded and has intrinsic size attributes or a sized box.
  const imgs = await page.$$eval("img", (is) => is.map((i) => ({ src: i.currentSrc, nw: i.naturalWidth, w: i.getAttribute("width"), h: i.getAttribute("height"), complete: i.complete })));
  check(`${label}: images load with width/height`, imgs.length > 0 && imgs.every((i) => i.nw > 0 && i.w && i.h), JSON.stringify(imgs));

  // Audio demo: metadata loads, play advances time, skip works.
  await page.$eval("#demo", (e) => e.scrollIntoView());
  await page.waitForFunction(() => document.querySelector("audio")?.readyState >= 1, { timeout: 10000 }).catch(() => {});
  const audio = await page.$eval("audio", (a) => ({ src: a.currentSrc, ready: a.readyState, dur: a.duration, err: a.error?.code ?? null }));
  check(`${label}: audio metadata loads`, audio.ready >= 1 && Math.abs(audio.dur - 81) < 2 && !audio.err, JSON.stringify(audio));
  await page.$eval('button[aria-label="Play example call"]', (e) => e.scrollIntoView({ block: "center" }));
  await sleep(1200); // let scroll-linked layout settle before clicking
  await page.click('button[aria-label="Play example call"]');
  await sleep(1500);
  const playing = await page.$eval("audio", (a) => ({ t: a.currentTime, paused: a.paused }));
  const pauseBtn = await page.$('button[aria-label="Pause example call"]');
  check(`${label}: audio plays`, playing.t > 0.3 && !playing.paused && !!pauseBtn, JSON.stringify(playing));
  await page.click('button[aria-label="Skip forward 10 seconds"]');
  await sleep(300);
  const skipped = await page.$eval("audio", (a) => a.currentTime);
  check(`${label}: skip forward`, skipped > 10, `t=${skipped.toFixed(1)}`);
  if (await page.$('button[aria-label="Pause example call"]')) await page.click('button[aria-label="Pause example call"]');

  // Industry tabs swap the photo and copy.
  const tabs = await page.$$('[role="tab"]');
  const seen = new Set();
  for (const t of tabs) {
    await t.click();
    const id = await t.evaluate((b) => b.id.replace("industry-tab-", ""));
    // The photo cross-fades (exit, then the new one mounts and loads lazily).
    const s = await page
      .waitForFunction(
        (tabId) => {
          const imgs = [...document.querySelectorAll("#industry-panel img")];
          const panel = document.getElementById("industry-panel");
          const img = imgs[imgs.length - 1];
          // The outgoing photo lingers while it fades, so match the new photo by its alt (= panel heading).
          const heading = panel?.querySelector("h3")?.textContent;
          return panel?.getAttribute("aria-labelledby") === `industry-tab-${tabId}` && imgs.length === 1 && img.alt === heading && img.complete && img.naturalWidth > 0 ? img.currentSrc : false;
        },
        { timeout: 5000 },
        id,
      )
      .then((h) => h.jsonValue())
      .catch(() => "");
    if (s) seen.add(s);
  }
  check(`${label}: 6 industry tabs show 6 photos`, tabs.length === 6 && seen.size === 6, `${tabs.length} tabs, ${seen.size} photos`);

  // FAQ opens.
  const faq = await page.$("#faq button[aria-expanded]");
  await faq.click();
  await sleep(400);
  check(`${label}: FAQ item expands`, (await faq.evaluate((b) => b.getAttribute("aria-expanded"))) === "true");

  // Links: anchors resolve, CTAs point where they should, nothing points at answeredai.co or a phone number.
  const links = await page.$$eval("a[href]", (as) => as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim() })));
  const anchors = links.filter((l) => l.href.startsWith("#"));
  const missing = [];
  for (const a of anchors) if (!(await page.$(a.href))) missing.push(a.href);
  check(`${label}: in-page anchors exist`, anchors.length > 0 && missing.length === 0, missing.join(",") || `${anchors.length} anchors`);
  const bad = links.filter((l) => /answeredai\.co|^tel:|^mailto:|demo=1|^https?:/.test(l.href));
  check(`${label}: no external, tel: or demo-dashboard links`, bad.length === 0, JSON.stringify(bad));
  const ctas = links.filter((l) => /Get started|Create an account|Sign up as an agency/.test(l.text));
  check(`${label}: sign-up CTAs go to /signup`, ctas.length >= 3 && ctas.every((l) => l.href.startsWith("/signup")), JSON.stringify(ctas.map((c) => c.href)));
  const agency = links.filter((l) => l.text === "Sign up as an agency");
  check(`${label}: agency CTA goes to /signup?as=agency`, agency.length === 1 && agency[0].href === "/signup?as=agency", JSON.stringify(agency));
  const signins = links.filter((l) => l.text === "Sign in");
  check(`${label}: Sign in goes to /login`, signins.length >= 1 && signins.every((l) => l.href === "/login"), `${signins.length} links`);
  const internal = [...new Set(links.map((l) => l.href).filter((h) => h.startsWith("/")))];
  for (const href of internal) {
    const p2 = await browser.newPage();
    const w2 = watch(p2);
    const r2 = await p2.goto(`${BASE}${href}`, { waitUntil: "load" });
    await sleep(500);
    const notFound = await p2.evaluate(() => document.body.innerText.includes("Page not found"));
    check(`${label}: link ${href} works`, r2?.status() === 200 && !notFound && w2.problems.length === 0, w2.problems.join(" | "));
    await p2.close();
  }

  // Mobile menu (phone width only) and a real click-through on a CTA.
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  if (viewport.width < 768) {
    await page.click('button[aria-label="Open menu"]');
    await sleep(450);
    const menu = await page.$$eval("#mobile-menu a", (as) => as.filter((a) => a.getBoundingClientRect().height > 0).map((a) => a.textContent.trim()));
    check(`${label}: mobile menu opens`, menu.includes("Sign in") && menu.includes("Get started"), menu.join(", "));
    await page.click('button[aria-label="Close menu"]');
    await sleep(400);
  }
  await page.screenshot({ path: join(SHOTS, `m-home-${viewport.width}-full.png`), fullPage: true });

  const ext = [...external].filter((h) => !/^fonts\.(googleapis|gstatic)\.com$/.test(h));
  check(`${label}: no third-party requests (besides Google Fonts)`, ext.length === 0, ext.join(", "));
  check(`${label}: no console/page/network errors`, problems.length === 0, problems.join(" | "));

  // Hero CTA click-through (client-side navigation).
  await page.click("section a[href^='/signup']");
  await page.waitForFunction(() => location.pathname === "/signup", { timeout: 5000 }).catch(() => {});
  check(`${label}: hero CTA opens /signup`, new URL(page.url()).pathname === "/signup", page.url());
  await page.close();
}

try {
  await run("1440", { width: 1440, height: 900 });
  await run("390", { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
