// The setup app: a local web page on http://localhost:4400 that walks the
// buyer through their accounts and then builds their server.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MOCK, DEFAULT_REGION, DEFAULT_SIZE, checkDigitalOcean, checkTelnyx, checkSmtp, sendTestEmail,
  checkGoogle, checkMicrosoft, resolveA, normalizeDomain, splitDomain, parseMailFrom,
} from "./providers";
import { load, update, save, mask, eraseAll, logRead, KEY_FILE, STEPS, type State, type StepId } from "./state";
import { BUNDLE_PATH, deleteServer, installRunning, resumeInstallIfNeeded, startCreateServer, startInstall } from "./job";

const PORT = Number(process.env.PORT || 4400);
const PUBLIC = join(import.meta.dir, "../public");

if (MOCK) {
  const { startMockDO } = await import("./mock/do-api");
  const { startMockSmtp } = await import("./mock/smtp");
  startMockDO();
  startMockSmtp();
}

const oauthCallback = (domain: string | undefined, p: "google" | "microsoft") => `https://${domain || "your-domain.com"}/api/oauth/${p}/callback`;

function publicState(s: State) {
  const smtp = (() => {
    try {
      const u = new URL(s.email!.smtpUrl);
      return { host: u.hostname, port: u.port, user: decodeURIComponent(u.username) };
    } catch {
      return null;
    }
  })();
  const rec = s.domain ? splitDomain(s.domain) : null;
  return {
    mock: MOCK,
    bundleReady: existsSync(BUNDLE_PATH),
    steps: STEPS,
    step: s.step,
    brand: s.brand || null,
    domain: s.domain || "",
    digitalocean: s.digitalocean
      ? { accountEmail: s.digitalocean.accountEmail, region: s.digitalocean.region, size: s.digitalocean.size, priceMonthly: s.digitalocean.priceMonthly, hasToken: !!s.digitalocean.token, tokenHint: mask(s.digitalocean.token), tokenRemoved: !!s.digitalocean.tokenRemoved }
      : null,
    doOptions: doOptions,
    telnyx: s.telnyx ? { keyHint: mask(s.telnyx.apiKey), balance: s.telnyx.balance } : null,
    email: s.email ? { mailFrom: s.email.mailFrom, smtp, testSentTo: s.email.testSentTo } : null,
    calendar: {
      skipped: !!s.calendar?.skipped,
      google: s.calendar?.google ? { clientId: s.calendar.google.clientId } : null,
      microsoft: s.calendar?.microsoft ? { clientId: s.calendar.microsoft.clientId } : null,
      googleRedirect: oauthCallback(s.domain, "google"),
      microsoftRedirect: oauthCallback(s.domain, "microsoft"),
    },
    server: s.server ? { phase: s.server.phase, progress: s.server.progress, ip: s.server.ip, dropletId: s.server.dropletId, error: s.server.error } : null,
    dns: s.dns ? { ...s.dns, record: rec && s.server?.ip ? { type: "A", name: rec.name, zone: rec.zone, value: s.server.ip } : null } : null,
    install: s.install ? { ...s.install, running: installRunning() } : null,
    hasKey: existsSync(KEY_FILE),
    completed: Object.fromEntries(STEPS.map((id) => [id, completed(s, id)])),
    finished: !!s.finished,
  };
}

// Region/size lists are only needed while choosing; kept in memory, refetched on demand.
let doOptions: { regions: any[]; sizes: any[] } | null = null;

const ok = (body: Record<string, unknown> = {}) => Response.json({ ok: true, ...body, state: publicState(load()) });
const bad = (message: string, status = 200) => Response.json({ ok: false, message, state: publicState(load()) }, { status });

const completed = (s: State, id: StepId): boolean => {
  switch (id) {
    case "brand": return !!s.brand;
    case "domain": return !!s.domain;
    case "digitalocean": return !!s.digitalocean?.region && (!!s.digitalocean?.token || !!s.digitalocean?.tokenRemoved);
    case "telnyx": return !!s.telnyx;
    case "email": return !!s.email;
    case "calendar": return !!s.calendar;
    case "server": return s.server?.phase === "ready";
    case "dns": return !!s.dns?.ok || !!s.dns?.skipped;
    case "install": return s.install?.phase === "ok";
    case "done": return !!s.finished;
  }
};

function advance(s: State, from: StepId) {
  // Next step that isn't finished yet (so editing an earlier step returns you to where you were).
  const i = STEPS.indexOf(from);
  for (let j = i + 1; j < STEPS.length; j++) {
    if (!completed(s, STEPS[j]) || STEPS[j] === "done") {
      s.step = STEPS[j];
      return;
    }
  }
}

async function body(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const routes: Record<string, (req: Request, b: any) => Promise<Response> | Response> = {
  "GET /api/state": () => ok(),

  "POST /api/goto": (_r, b) => {
    const s = load();
    const target = b.step as StepId;
    if (!STEPS.includes(target)) return bad("Unknown step");
    const i = STEPS.indexOf(target);
    // You can go back to anything, or forward to the first unfinished step.
    const firstOpen = STEPS.findIndex((id) => !completed(s, id));
    if (i > (firstOpen < 0 ? STEPS.length - 1 : firstOpen)) return bad("Finish the earlier steps first.");
    if (s.finished && target !== "done") return bad("Setup is finished.");
    s.step = target;
    save(s);
    return ok();
  },

  "POST /api/brand": (_r, b) => {
    const productName = str(b.productName, 60);
    const ownerEmail = str(b.ownerEmail, 200).toLowerCase();
    if (!productName) return bad("Give your product a name. Your customers will see it.");
    if (!isEmail(ownerEmail)) return bad("Enter a real email address. You'll use it to sign in.");
    update((s) => {
      s.brand = { productName, ownerEmail, ownPhoneAccount: !!b.ownPhoneAccount };
      advance(s, "brand");
    });
    return ok({ message: "Saved." });
  },

  "POST /api/domain": (_r, b) => {
    const d = normalizeDomain(str(b.domain, 253));
    if (!d) return bad("That doesn't look like a web address. Type something like reception.yourcompany.com");
    update((s) => {
      if (s.domain !== d && s.dns) s.dns = { ok: false, checks: 0 };
      s.domain = d;
      advance(s, "domain");
    });
    return ok({ message: "Saved." });
  },

  "POST /api/digitalocean/check": async (_r, b) => {
    let token = str(b.token, 500);
    const s = load();
    if (!token && s.digitalocean?.token) token = s.digitalocean.token;
    const r = await checkDigitalOcean(token);
    if (!r.ok) return bad(r.message);
    doOptions = { regions: r.regions, sizes: r.sizes };
    update((s) => {
      const region = s.digitalocean?.region || (r.regions.some((x) => x.slug === DEFAULT_REGION) ? DEFAULT_REGION : r.regions[0]?.slug);
      const size = s.digitalocean?.size || (r.sizes.some((x) => x.slug === DEFAULT_SIZE) ? DEFAULT_SIZE : r.sizes[0]?.slug);
      s.digitalocean = { ...s.digitalocean, token, accountEmail: r.accountEmail, region, size, priceMonthly: r.sizes.find((x) => x.slug === size)?.priceMonthly, tokenRemoved: false };
    });
    return ok({ message: r.message });
  },

  "POST /api/digitalocean/choose": (_r, b) => {
    const s = load();
    if (!s.digitalocean?.token) return bad("Check your token first.");
    if (s.server?.dropletId) return bad("Your server already exists, so its location and size can't change here.");
    const region = str(b.region, 40);
    const size = str(b.size, 40);
    if (doOptions) {
      if (!doOptions.regions.some((r) => r.slug === region)) return bad("Pick a location from the list.");
      const sz = doOptions.sizes.find((x) => x.slug === size);
      if (!sz) return bad("Pick a size from the list.");
      if (sz.regions && !sz.regions.includes(region)) return bad("That size isn't available in that location. Pick another size or location.");
    }
    update((s) => {
      s.digitalocean!.region = region;
      s.digitalocean!.size = size;
      s.digitalocean!.priceMonthly = doOptions?.sizes.find((x) => x.slug === size)?.priceMonthly;
      advance(s, "digitalocean");
    });
    return ok();
  },

  "POST /api/telnyx/check": async (_r, b) => {
    let key = str(b.apiKey, 500);
    if (!key && load().telnyx?.apiKey) key = load().telnyx!.apiKey;
    const r = await checkTelnyx(key);
    if (!r.ok) return bad(r.message);
    update((s) => {
      s.telnyx = { apiKey: key, balance: r.balance };
    });
    return ok({ message: r.message });
  },

  "POST /api/telnyx/next": () => {
    const s = load();
    if (!s.telnyx) return bad("Check your Telnyx key first.");
    update((s) => advance(s, "telnyx"));
    return ok();
  },

  "POST /api/email/check": async (_r, b) => {
    const s = load();
    let smtpUrl = str(b.smtpUrl, 1000);
    if (!smtpUrl && s.email?.smtpUrl) smtpUrl = s.email.smtpUrl;
    const mailFrom = str(b.mailFrom, 300) || s.email?.mailFrom || "";
    const r = await checkSmtp(smtpUrl, mailFrom);
    if (!r.ok) return bad(r.message);
    update((s) => {
      s.email = { smtpUrl, mailFrom };
    });
    return ok({ message: r.message });
  },

  "POST /api/email/test": async () => {
    const s = load();
    if (!s.email || !s.brand) return bad("Check the email sender first.");
    const r = await sendTestEmail(s.email.smtpUrl, s.email.mailFrom, s.brand.ownerEmail, s.brand.productName);
    if (!r.ok) return bad(r.message);
    update((s) => {
      s.email!.testSentTo = s.brand!.ownerEmail;
    });
    return ok({ message: r.message });
  },

  "POST /api/email/next": () => {
    if (!load().email) return bad("Check the email sender first.");
    update((s) => advance(s, "email"));
    return ok();
  },

  "POST /api/calendar/check": async (_r, b) => {
    const s = load();
    const provider = b.provider === "microsoft" ? "microsoft" : "google";
    const clientId = str(b.clientId, 300);
    let clientSecret = str(b.clientSecret, 500);
    const prev = s.calendar?.[provider];
    if (!clientSecret && prev && prev.clientId === clientId) clientSecret = prev.clientSecret;
    const redirect = oauthCallback(s.domain, provider);
    const r = provider === "google" ? await checkGoogle(clientId, clientSecret, redirect) : await checkMicrosoft(clientId, clientSecret, redirect);
    if (!r.ok) return bad(r.message);
    update((s) => {
      s.calendar = { ...(s.calendar || {}), [provider]: { clientId, clientSecret }, skipped: false };
    });
    return ok({ message: r.message });
  },

  "POST /api/calendar/remove": (_r, b) => {
    const provider = b.provider === "microsoft" ? "microsoft" : "google";
    update((s) => {
      if (s.calendar) delete s.calendar[provider];
    });
    return ok();
  },

  "POST /api/calendar/next": (_r, b) => {
    update((s) => {
      s.calendar = { ...(s.calendar || {}), skipped: !s.calendar?.google && !s.calendar?.microsoft };
      advance(s, "calendar");
    });
    return ok();
  },

  "POST /api/server/create": () => {
    const s = load();
    const missing = (["brand", "domain", "digitalocean", "telnyx", "email", "calendar"] as StepId[]).find((id) => !completed(s, id));
    if (missing) return bad(`Finish the ${missing} step first.`);
    if (!s.digitalocean?.token) return bad("The DigitalOcean token is missing. Go back to the DigitalOcean step and paste it again.");
    startCreateServer();
    return ok();
  },

  "POST /api/server/delete": async () => {
    const r = await deleteServer();
    return r.ok ? ok({ message: r.message }) : bad(r.message);
  },

  "POST /api/dns/check": async () => {
    const s = load();
    if (!s.domain || !s.server?.ip) return bad("Your server isn't ready yet.");
    const ips = await resolveA(s.domain, s.server.ip);
    const good = ips.includes(s.server.ip);
    update((s) => {
      s.dns = { ok: good, seen: ips, checks: (s.dns?.checks || 0) + 1, skipped: s.dns?.skipped };
    });
    return ok({ resolved: ips, match: good });
  },

  "POST /api/install/start": (_r, b) => {
    const s = load();
    if (s.server?.phase !== "ready") return bad("Your server isn't ready yet.");
    if (!s.dns?.ok) update((s) => (s.dns = { ...(s.dns || { checks: 0, ok: false }), skipped: true }));
    startInstall();
    return ok();
  },

  "GET /api/install/log": (req) => {
    const from = Number(new URL(req.url).searchParams.get("from") || 0);
    const r = logRead(Number.isFinite(from) ? from : 0);
    return Response.json({ text: r.text, next: r.next, state: publicState(load()) });
  },

  "GET /api/ssh-key": () => {
    if (!existsSync(KEY_FILE)) return new Response("The key has been erased.", { status: 404 });
    const s = load();
    const name = `${(s.brand?.productName || "receptionist").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-server-key.txt`;
    return new Response(readFileSync(KEY_FILE), {
      headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
    });
  },

  "POST /api/finish": () => {
    const s = load();
    if (s.install?.phase !== "ok") return bad("The install hasn't finished yet.");
    update((s) => {
      if (s.digitalocean) {
        delete s.digitalocean.token;
        s.digitalocean.tokenRemoved = true;
      }
      s.finished = true;
      s.step = "done";
    });
    return ok({ message: "The installer's copy of your DigitalOcean token is deleted." });
  },

  "POST /api/erase": () => {
    const s = load();
    if (s.server?.dropletId && s.install?.phase !== "ok" && s.server.phase !== "deleted") {
      // Don't strand a half-built server the buyer can't see from here any more.
      if (s.digitalocean?.token) return bad("You still have a server that isn't finished. Delete it first, or finish the install.");
    }
    eraseAll();
    return ok({ message: "Everything the installer saved has been erased." });
  },
};

function allowedHost(req: Request) {
  // Blocks DNS-rebinding: only answer pages loaded from this computer.
  const h = (req.headers.get("host") || "").toLowerCase();
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h);
}

const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

Bun.serve({
  port: PORT,
  hostname: process.env.HOST || "0.0.0.0",
  idleTimeout: 120,
  async fetch(req) {
    if (!allowedHost(req)) return new Response("Open this page at http://localhost:" + PORT, { status: 403 });
    const url = new URL(req.url);
    const key = `${req.method} ${url.pathname}`;
    const handler = routes[key];
    if (handler) {
      // Writes need our own header, which a page on another site can't send without CORS approval.
      if (req.method !== "GET" && req.headers.get("x-installer") !== "1") return new Response("Forbidden", { status: 403 });
      try {
        return await handler(req, req.method === "POST" ? await body(req) : {});
      } catch (e: any) {
        console.log(`[api] ${key} error: ${e?.name || "Error"}`);
        return bad("Something went wrong on our side. Try again.", 500);
      }
    }
    if (req.method !== "GET") return new Response("Not found", { status: 404 });
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    if (p.includes("..")) return new Response("Not found", { status: 404 });
    const f = Bun.file(join(PUBLIC, p));
    if (!(await f.exists())) return new Response(Bun.file(join(PUBLIC, "index.html")), { headers: { "Content-Type": types[".html"] } });
    const ext = p.slice(p.lastIndexOf("."));
    return new Response(f, { headers: { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-cache" } });
  },
});

// Resume background work after a restart.
{
  const s = load();
  if (s.server?.phase === "creating") startCreateServer();
  resumeInstallIfNeeded();
}

console.log(`Setup is running. Open http://localhost:${PORT} in your browser.${MOCK ? " (TEST MODE: fake DigitalOcean)" : ""}`);
if (!existsSync(BUNDLE_PATH)) console.log("Warning: the app bundle is missing; the install step will not work.");
