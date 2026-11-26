// TEST MODE ONLY. Local fakes of every outside service the wizard talks to, so the whole
// flow runs on one machine with no real accounts:
//   :4521  DigitalOcean API. A "droplet" is a privileged local container (mock/droplet/) with
//          Docker inside; its user_data script is run in it, like cloud-init, so the real
//          install.sh runs end to end and reports back to the site over HTTP.
//   :4522  SMTP server (user "test", password "test-pass") for the "other SMTP" option
//   :4523  Cloudflare API (/client/v4)
//   :4524  Resend API
//   :4525  DNS server (UDP). Answers from the fake Cloudflare zones (active ones only) and from
//          "registrar" records the test adds by hand (POST /_mock/registrar on :4521).
//   bun download-site/mock/serve.ts
// Only containers, volumes and the network named wiz-test-* are ever created or removed.
import { createSocket } from "node:dgram";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const BASE = Number(process.env.MOCK_PORT_BASE || 4520);
const P = { do: BASE + 1, smtp: BASE + 2, cf: BASE + 3, resend: BASE + 4, dns: BASE + 5, rail: BASE + 6 };
const NET = process.env.MOCK_DROPLET_NET || "wiz-test-net";
const IMAGE = process.env.MOCK_DROPLET_IMAGE || "wiz-test-droplet:24.04";
const NS_AFTER = Number(process.env.MOCK_NS_AFTER || 3); // pending zone turns active after this many zone reads
const log = (...a: unknown[]) => console.log("[mock]", ...a);
const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sh(args: string[], input?: string): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(args, { stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out.trim(), err: err.trim() };
}

// ============================ DNS data ============================
interface Rec { id: string; type: string; name: string; content: string; ttl: number; proxied?: boolean; priority?: number; comment?: string }
const zones = [
  { id: "z-alpha", name: "alpha-reception.test", status: "active", reads: 0, records: [] as Rec[] },
  { id: "z-beta", name: "beta-reception.test", status: "active", reads: 0, records: [] as Rec[] },
  { id: "z-gamma", name: "gamma-reception.test", status: "pending", reads: 0, records: [] as Rec[] },
  { id: "z-delta", name: "delta-reception.test", status: "active", reads: 0, records: [{ id: "r-old", type: "A", name: "app.delta-reception.test", content: "203.0.113.5", ttl: 1, proxied: true }] as Rec[] },
];
const nsFor = (z: string) => [`ada.ns.cloudflare.com`, `bob.ns.cloudflare.com`];
const registrar: Rec[] = []; // records "added at the registrar" for the manual path
const unq = (s: string) => s.replace(/^"|"$/g, "");

function publicAnswers(type: string, name: string): Rec[] {
  name = name.toLowerCase().replace(/\.$/, "");
  const out: Rec[] = [];
  for (const z of zones) if (z.status === "active" && (name === z.name || name.endsWith("." + z.name))) out.push(...z.records.filter((r) => r.name === name && r.type === type && !r.proxied));
  out.push(...registrar.filter((r) => r.name === name && r.type === type));
  return out;
}

// ============================ DNS server (UDP) ============================
function encName(n: string): Buffer {
  const parts = n.replace(/\.$/, "").split(".").filter(Boolean);
  return Buffer.concat([...parts.map((p) => Buffer.concat([Buffer.from([p.length]), Buffer.from(p)])), Buffer.from([0])]);
}
const TYPES: Record<number, string> = { 1: "A", 5: "CNAME", 15: "MX", 16: "TXT" };
const udp = createSocket("udp4");
udp.on("message", (msg, rinfo) => {
  try {
    let o = 12;
    const labels: string[] = [];
    while (msg[o] !== 0) { labels.push(msg.subarray(o + 1, o + 1 + msg[o]).toString()); o += msg[o] + 1; }
    o += 1;
    const qtype = msg.readUInt16BE(o);
    const qend = o + 4;
    const name = labels.join(".");
    const type = TYPES[qtype];
    const recs = type ? publicAnswers(type, name) : [];
    const answers = recs.map((r) => {
      let rdata: Buffer;
      if (r.type === "A") rdata = Buffer.from(r.content.split(".").map(Number));
      else if (r.type === "TXT") {
        const t = Buffer.from(unq(r.content));
        const chunks: Buffer[] = [];
        for (let i = 0; i < t.length; i += 255) { const c = t.subarray(i, i + 255); chunks.push(Buffer.from([c.length]), c); }
        rdata = Buffer.concat(chunks.length ? chunks : [Buffer.from([0])]);
      } else if (r.type === "MX") { const pr = Buffer.alloc(2); pr.writeUInt16BE(r.priority ?? 10); rdata = Buffer.concat([pr, encName(r.content)]); }
      else rdata = encName(r.content);
      const h = Buffer.alloc(12);
      h.writeUInt16BE(0xc00c, 0); h.writeUInt16BE(qtype, 2); h.writeUInt16BE(1, 4); h.writeUInt32BE(30, 6); h.writeUInt16BE(rdata.length, 10);
      return Buffer.concat([h, rdata]);
    });
    const head = Buffer.alloc(12);
    msg.copy(head, 0, 0, 2);
    head.writeUInt16BE(0x8180, 2); head.writeUInt16BE(1, 4); head.writeUInt16BE(answers.length, 6);
    udp.send(Buffer.concat([head, msg.subarray(12, qend), ...answers]), rinfo.port, rinfo.address);
  } catch (e) { log("dns error", e); }
});
udp.bind(P.dns, "127.0.0.1");

// ============================ Cloudflare ============================
const CF_OK = "mock-cf-token-ok", CF_RO = "mock-cf-token-readonly";
const cfOk = (result: unknown, extra: object = {}) => json(200, { success: true, errors: [], messages: [], result, ...extra });
const cfErr = (status: number, code: number, message: string) => json(status, { success: false, errors: [{ code, message }], messages: [], result: null });
const zoneJson = (z: (typeof zones)[0]) => ({ id: z.id, name: z.name, status: z.status, name_servers: nsFor(z.name), paused: false, type: "full" });

Bun.serve({
  port: P.cf, hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url);
    const p = u.pathname.replace(/^\/client\/v4/, "");
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (tok !== CF_OK && tok !== CF_RO) return cfErr(400, 1000, "Invalid API Token");
    if (p === "/user/tokens/verify") return cfOk({ id: "tok-1", status: "active" }, { messages: [{ code: 10000, message: "This API Token is valid and active" }] });
    if (p === "/zones" && req.method === "GET") {
      const name = u.searchParams.get("name");
      const list = zones.filter((z) => !name || z.name === name);
      return cfOk(list.map(zoneJson), { result_info: { page: 1, per_page: 50, count: list.length, total_count: list.length, total_pages: 1 } });
    }
    let m = p.match(/^\/zones\/([^/]+)$/);
    if (m) {
      const z = zones.find((x) => x.id === m![1]);
      if (!z) return cfErr(404, 7003, "Could not route to /zones/x, perhaps your object identifier is invalid?");
      // Fake nameserver propagation: a pending zone turns active after a few checks.
      if (z.status === "pending" && ++z.reads >= NS_AFTER) { z.status = "active"; log(`zone ${z.name} is now active`); }
      return cfOk(zoneJson(z));
    }
    m = p.match(/^\/zones\/([^/]+)\/dns_records(?:\/([^/]+))?$/);
    if (m) {
      const z = zones.find((x) => x.id === m![1]);
      if (!z) return cfErr(404, 7003, "Could not route");
      const write = req.method !== "GET";
      if (write && tok === CF_RO) return cfErr(403, 10000, "Authentication error");
      if (!m[2] && req.method === "GET") {
        const name = u.searchParams.get("name.exact"), type = u.searchParams.get("type");
        return cfOk(z.records.filter((r) => (!name || r.name === name) && (!type || r.type === type)));
      }
      if (!m[2] && req.method === "POST") {
        const b: any = await req.json();
        if (!b.name || !b.type || b.ttl === undefined) return cfErr(400, 9000, "DNS name, type and ttl are required");
        if (b.type === "CNAME" ? z.records.some((r) => r.name === b.name) : z.records.some((r) => r.name === b.name && r.type === "CNAME")) return cfErr(400, 81053, "An A, AAAA, or CNAME record with that host already exists.");
        if (z.records.some((r) => r.name === b.name && r.type === b.type && r.content === b.content)) return cfErr(400, 81058, "An identical record already exists.");
        const r: Rec = { id: "r-" + randomBytes(4).toString("hex"), type: b.type, name: String(b.name).toLowerCase(), content: String(b.content), ttl: b.ttl, proxied: !!b.proxied, priority: b.priority, comment: b.comment };
        z.records.push(r);
        log(`cf ${z.name}: + ${r.type} ${r.name} ${r.content}`);
        return cfOk(r);
      }
      const r = z.records.find((x) => x.id === m![2]);
      if (!r) return cfErr(404, 81044, "Record does not exist.");
      if (req.method === "PATCH") { const b: any = await req.json(); Object.assign(r, b, b.name ? { name: String(b.name).toLowerCase() } : {}); log(`cf ${z.name}: ~ ${r.type} ${r.name} ${r.content} proxied=${r.proxied}`); return cfOk(r); }
      if (req.method === "DELETE") { z.records.splice(z.records.indexOf(r), 1); log(`cf ${z.name}: - ${r.type} ${r.name}`); return cfOk({ id: r.id }); }
    }
    return cfErr(404, 7000, "No route for that URI");
  },
});

// ============================ Resend ============================
const RS_OK = "re_mock_full_access_key", RS_SEND = "re_mock_sending_only_key";
const domains: any[] = [];
const apiKeys: any[] = [];
const sent: any[] = [];
function domainView(d: any) {
  if (d.verifying) {
    for (const r of d.records) {
      const want = r.type === "MX" ? r.value : r.value;
      const full = r.fqdn;
      r.status = publicAnswers(r.type, full).some((a) => unq(a.content).toLowerCase() === unq(want).toLowerCase()) ? "verified" : "pending";
    }
    d.status = d.records.every((r: any) => r.status === "verified") ? "verified" : "pending";
  }
  return { object: "domain", id: d.id, name: d.name, status: d.status, created_at: d.created_at, region: "us-east-1", records: d.records.map(({ fqdn, ...r }: any) => r) };
}
Bun.serve({
  port: P.resend, hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url);
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!req.headers.get("user-agent")) return json(403, { statusCode: 403, name: "missing_user_agent", message: "User-Agent required" });
    if (tok !== RS_OK && tok !== RS_SEND) return json(401, { statusCode: 401, name: "invalid_api_key", message: "API key is invalid" });
    if (u.pathname === "/emails" && req.method === "POST") {
      const b: any = await req.json();
      const dom = String(b.from).match(/@([^>\s]+)/)?.[1]?.toLowerCase();
      const d = domains.find((x) => x.name === dom);
      if (!d || domainView(d).status !== "verified") return json(403, { statusCode: 403, name: "validation_error", message: `The ${dom} domain is not verified. Please, add and verify your domain.` });
      sent.push(b); log(`resend: email to ${b.to} from ${b.from}`);
      return json(200, { id: "em-" + randomBytes(4).toString("hex") });
    }
    if (tok === RS_SEND) return json(401, { statusCode: 401, name: "restricted_api_key", message: "This API key is restricted to only send emails." });
    if (u.pathname === "/api-keys" && req.method === "POST") {
      const b: any = await req.json();
      if (b.permission !== "sending_access" || !domains.some((d) => d.id === b.domain_id)) return json(422, { statusCode: 422, name: "validation_error", message: "Invalid domain_id" });
      const k = { id: "key-" + randomBytes(4).toString("hex"), token: "re_mocksend_" + randomBytes(12).toString("hex") };
      apiKeys.push({ ...b, id: k.id }); log(`resend: sending key for ${b.domain_id}`);
      return json(201, k);
    }
    if (u.pathname === "/domains" && req.method === "GET") return json(200, { object: "list", has_more: false, data: domains.map((d) => ({ id: d.id, name: d.name, status: domainView(d).status })) });
    if (u.pathname === "/domains" && req.method === "POST") {
      const b: any = await req.json();
      const name = String(b.name).toLowerCase();
      if (domains.some((d) => d.name === name)) return json(403, { statusCode: 403, name: "validation_error", message: "This domain is already registered." });
      // Like the real API: names are relative to the registered root (a .com.au style root is three labels),
      // so mail.t1.chloeeai.co gives resend._domainkey.mail.t1 and the apex chloeeai.co gives resend._domainkey.
      const parts = name.split(".");
      const zone = parts.slice(-(/^(com|net|org|edu|gov|id|asn)\.au$|^co\.(uk|nz)$/.test(parts.slice(-2).join(".")) ? 3 : 2)).join(".");
      const rel = name === zone ? "" : "." + name.slice(0, -(zone.length + 1));
      const dkim = "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ" + randomBytes(24).toString("base64").replace(/[+/=]/g, "x");
      const d = {
        id: "dom-" + randomBytes(6).toString("hex"), name, status: "not_started", created_at: new Date().toISOString(), verifying: false,
        records: [
          { record: "DKIM", name: `resend._domainkey${rel}`, fqdn: `resend._domainkey.${name}`, type: "TXT", ttl: "Auto", status: "not_started", value: dkim },
          { record: "SPF", name: `send${rel}`, fqdn: `send.${name}`, type: "MX", ttl: "Auto", status: "not_started", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10 },
          // The real API wraps this value in quote marks.
          { record: "SPF", name: `send${rel}`, fqdn: `send.${name}`, type: "TXT", ttl: "Auto", status: "not_started", value: '"v=spf1 include:amazonses.com ~all"' },
        ],
      };
      domains.push(d); log(`resend: domain ${name} created`);
      return json(201, domainView(d));
    }
    let m = u.pathname.match(/^\/domains\/([^/]+)(\/verify)?$/);
    const d = m && domains.find((x) => x.id === m![1]);
    if (m && !d) return json(404, { statusCode: 404, name: "not_found", message: "Domain not found" });
    if (m && m[2] && req.method === "POST") { d.verifying = true; return json(200, { object: "domain", id: d.id }); }
    if (m && req.method === "GET") return json(200, domainView(d));
    return json(404, { statusCode: 404, name: "not_found", message: "Not found" });
  },
});

// ============================ DigitalOcean ============================
const DO_OK = "mock-do-token-ok", DO_RO = "mock-do-token-readonly", DO_LIMIT = "mock-do-token-nolimit";
const keys = new Map<number, any>();
const droplets = new Map<number, any>();
const tags = new Set<string>();
let nextId = BASE * 10; // e.g. 45200 for the e2e run, 45900 for the preview, so container names never collide
let failNextCreate: string | null = null;
let noDockerNext = false;
const sizes = [["s-1vcpu-1gb", 1, 1024, 25, 6], ["s-1vcpu-2gb", 1, 2048, 50, 12], ["s-2vcpu-2gb", 2, 2048, 60, 18], ["s-2vcpu-4gb", 2, 4096, 80, 24], ["s-4vcpu-8gb", 4, 8192, 160, 48]]
  .map(([slug, vcpus, memory, disk, price]) => ({ slug, vcpus, memory, disk, price_monthly: price, price_hourly: Number(price) / 730, available: true, regions: ["syd1", "sgp1", "nyc3", "lon1"] }));
const regions = [["syd1", "Sydney 1"], ["sgp1", "Singapore 1"], ["nyc3", "New York 3"], ["lon1", "London 1"]].map(([slug, name]) => ({ slug, name, available: true, sizes: sizes.map((s) => s.slug) }));

async function bootDroplet(d: any) {
  try {
    const authorized = (d.ssh_keys || []).map((id: number) => keys.get(id)?.public_key).filter(Boolean).join("\n");
    const r = await sh(["docker", "run", "-d", "--privileged", "--name", d.container, "--hostname", d.name.slice(0, 60), "--network", NET, "--label", "wiz-test=1",
      "-v", `${d.volume}:/var/lib/docker`, "-e", `AUTHORIZED_KEYS=${authorized}`, ...(d.noDocker ? ["-e", "NO_DOCKERD=1"] : []), IMAGE]);
    if (r.code !== 0) throw new Error(r.err);
    d.ip = (await sh(["docker", "inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", d.container])).out;
    d.status = "active";
    log(`droplet ${d.id} is container ${d.container} at ${d.ip}`);
    // cloud-init: run user_data once, as root, at first boot.
    if (d.user_data) {
      await sh(["docker", "exec", "-i", d.container, "sh", "-c", "mkdir -p /var/lib/cloud/instance && cat > /var/lib/cloud/instance/user-data.txt && chmod 600 /var/lib/cloud/instance/user-data.txt"], d.user_data);
      await sh(["docker", "exec", "-d", d.container, "sh", "-c", "bash /var/lib/cloud/instance/user-data.txt > /var/log/cloud-init-output.log 2>&1"]);
      log(`droplet ${d.id}: ran user_data (${d.user_data.length} bytes) like cloud-init`);
    }
  } catch (e) {
    log("droplet boot failed: " + e);
    d.status = "errored";
  }
}
async function removeDroplet(d: any) {
  droplets.delete(d.id);
  await sh(["docker", "rm", "-f", d.container]);
  await sh(["docker", "volume", "rm", d.volume]);
  log(`deleted droplet ${d.id}`);
}
const dropletJson = (d: any) => ({ id: d.id, name: d.name, status: d.status, tags: d.tags, region: { slug: d.region }, size_slug: d.size, image: { slug: d.image }, networks: { v4: d.ip ? [{ ip_address: d.ip, type: "public" }] : [] } });

Bun.serve({
  port: P.do, hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url);
    const p = u.pathname, m0 = req.method;
    // ---- test controls (no auth: only on 127.0.0.1) ----
    if (p === "/_mock/rail/fail-next-deploy" && m0 === "POST") { railFailNext = (await req.text()) || "error: script \"build\" exited with code 1"; return json(200, { ok: true }); }
    if (p === "/_mock/state") return json(200, { railway: [...rProjects.values()].map((x) => ({ ...x, services: [...x.services.values()].map((s: any) => ({ ...s, variables: Object.keys(s.variables), smtpKey: /re_mocksend_/.test(String(s.variables.SMTP_URL || "")) ? "send-only" : /re_mock_full_access_key/.test(String(s.variables.SMTP_URL || "")) ? "FULL" : "" })) })), deployments: [...rDeps.values()].map(({ logs, rlogs, ...d }: any) => d), droplets: [...droplets.values()].map((d) => ({ ...d, user_data: undefined, user_data_bytes: d.user_data?.length || 0, has_user_data: !!d.user_data })), keys: [...keys.values()], zones, registrar, resend: domains.map(domainView), sent });
    if (p === "/_mock/droplet-user-data") return new Response(droplets.get(Number(u.searchParams.get("id")))?.user_data || "", { status: 200 });
    if (p === "/_mock/registrar" && m0 === "POST") { const b: any = await req.json(); registrar.push({ id: "reg-" + registrar.length, ttl: 300, ...b, name: String(b.name).toLowerCase() }); return json(200, { ok: true }); }
    if (p === "/_mock/do/fail-next-create" && m0 === "POST") { failNextCreate = (await req.text()) || "Region is not available"; return json(200, { ok: true }); }
    if (p === "/_mock/do/no-docker-next" && m0 === "POST") { noDockerNext = true; return json(200, { ok: true }); }
    if (p === "/_mock/cleanup" && m0 === "POST") { for (const d of [...droplets.values()]) await removeDroplet(d); for (const x of [...rProjects.values()]) await removeRailProject(x); return json(200, { ok: true }); }

    const tok = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (![DO_OK, DO_RO, DO_LIMIT].includes(tok)) return json(401, { id: "Unauthorized", message: "Unable to authenticate you" });
    if (m0 !== "GET" && tok === DO_RO) return json(403, { id: "Forbidden", message: "You do not have access for the attempted action." });
    if (m0 === "GET" && p === "/v2/account") return json(200, { account: { email: "owner@example.com", status: "active", email_verified: true, droplet_limit: tok === DO_LIMIT ? 0 : 10, uuid: "mock" } });
    if (m0 === "GET" && p === "/v2/regions") return json(200, { regions, meta: { total: regions.length } });
    if (m0 === "GET" && p === "/v2/sizes") return json(200, { sizes, meta: { total: sizes.length } });
    if (m0 === "POST" && p === "/v2/tags") { const b: any = await req.json(); if (tags.has(b.name)) return json(422, { id: "unprocessable_entity", message: "tag already exists" }); tags.add(b.name); return json(201, { tag: { name: b.name } }); }
    if (m0 === "POST" && p === "/v2/account/keys") {
      const b: any = await req.json();
      if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+) [A-Za-z0-9+/=]+/.test(b.public_key || "")) return json(422, { id: "unprocessable_entity", message: "Key invalid type, we support 'ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256'..." });
      if ([...keys.values()].some((k) => k.public_key === b.public_key)) return json(422, { id: "unprocessable_entity", message: "SSH Key is already in use on your account" });
      const k = { id: nextId++, name: b.name, public_key: b.public_key, fingerprint: "mock:" + randomBytes(4).toString("hex") };
      keys.set(k.id, k);
      return json(201, { ssh_key: k });
    }
    if (m0 === "GET" && p === "/v2/account/keys") return json(200, { ssh_keys: [...keys.values()] });
    if (m0 === "POST" && p === "/v2/droplets") {
      const b: any = await req.json();
      if (failNextCreate) { const msg = failNextCreate; failNextCreate = null; return json(422, { id: "unprocessable_entity", message: msg }); }
      if (b.image !== "ubuntu-24-04-x64") return json(422, { id: "unprocessable_entity", message: "You specified an invalid image for Droplet creation." });
      if (!regions.some((r) => r.slug === b.region)) return json(422, { id: "unprocessable_entity", message: "Region is not available" });
      if (!sizes.some((s) => s.slug === b.size)) return json(422, { id: "unprocessable_entity", message: "Size is not available" });
      if (b.user_data && Buffer.byteLength(b.user_data) > 64 * 1024) return json(422, { id: "unprocessable_entity", message: "user_data is too large (64 KiB max)" });
      for (const k of b.ssh_keys || []) if (!keys.has(k)) return json(422, { id: "unprocessable_entity", message: "ssh_keys contains an unknown key" });
      const id = nextId++;
      const d = { noDocker: noDockerNext, id, name: b.name, region: b.region, size: b.size, image: b.image, tags: b.tags || [], ssh_keys: b.ssh_keys || [], user_data: b.user_data || "", status: "new", container: `wiz-test-droplet-${id}`, volume: `wiz-test-dvol-${id}` };
      noDockerNext = false;
      droplets.set(id, d);
      log(`create droplet ${id} name=${b.name} region=${b.region} size=${b.size} tags=${d.tags.join(",")} ssh_keys=${d.ssh_keys.length} user_data=${d.user_data.length}B`);
      setTimeout(() => bootDroplet(d), 1500);
      return json(202, { droplet: dropletJson(d) });
    }
    const mm = p.match(/^\/v2\/droplets\/(\d+)$/);
    if (mm) {
      const d = droplets.get(Number(mm[1]));
      if (!d) return json(404, { id: "not_found", message: "The resource you were accessing could not be found." });
      if (m0 === "GET") return json(200, { droplet: dropletJson(d) });
      if (m0 === "DELETE") { await removeDroplet(d); return json(204); }
    }
    return json(404, { id: "not_found", message: "The resource you were accessing could not be found." });
  },
});


// ============================ Railway ============================
// GraphQL at :BASE+6/graphql/v2 and the `railway up` upload at /project/<id>/environment/<id>/up.
// An upload really builds the app's image from the uploaded source (deploy/Dockerfile) and runs
// it as wiz-test-rail-app-<p> with a local postgres:16 (wiz-test-rail-pg-<p>), published on
// 127.0.0.1:<port from MOCK_APP_PORTS>, so the end of the wizard opens a real dashboard.
const RW_OK = "mock-rail-token-ok", RW_NOCARD = "mock-rail-token-nocard";
const [PORT_LO, PORT_HI] = (process.env.MOCK_APP_PORTS || `${BASE + 30}-${BASE + 39}`).split("-").map(Number);
const usedPorts = new Set<number>();
const rProjects = new Map<string, any>();
const rDeps = new Map<string, any>();
let railFailNext: string | null = null;
const RAIL_TMP = join(process.env.TMPDIR || "/tmp", `wiz-test-rail-${BASE}`);
const rid = (p: string) => `${p}-${randomBytes(5).toString("hex")}`;
const tag = (projectId: string) => projectId.slice(-10);
const gqlErr = (message: string) => json(200, { data: null, errors: [{ message }] });

function findService(id: string): [any, any] | [] {
  for (const p of rProjects.values()) { const s = p.services.get(id); if (s) return [p, s]; }
  return [];
}
function resolveVars(p: any, svc: any, depth = 0): Record<string, string> {
  const out: Record<string, string> = {};
  const builtins = (s: any): Record<string, string> => ({ RAILWAY_PRIVATE_DOMAIN: s.container, RAILWAY_PROJECT_ID: p.id, RAILWAY_SERVICE_NAME: s.name });
  const sub = (s: any, v: string): string => v.replace(/\$\{\{\s*(?:([A-Za-z0-9_-]+)\.)?([A-Za-z0-9_]+)\s*\}\}/g, (_m, other, key) => {
    if (depth > 5) return "";
    if (other) { const o = [...p.services.values()].find((x: any) => x.name === other); return o ? resolveVars(p, o, depth + 1)[key] ?? "" : ""; }
    return builtins(s)[key] ?? (s.variables[key] !== undefined ? sub(s, String(s.variables[key])) : "");
  });
  for (const [k, v] of Object.entries(svc.variables)) out[k] = sub(svc, String(v));
  return out;
}
function domainJson(p: any, cd: any) {
  const zone = cd.domain.split(".").slice(1).join(".");
  const label = cd.domain.split(".")[0];
  const cname = publicAnswers("CNAME", cd.domain).find((r) => unq(r.content).toLowerCase() === cd.target);
  const txt = publicAnswers("TXT", `_railway-verify.${cd.domain}`).find((r) => unq(r.content) === cd.token);
  const dep = [...rDeps.values()].filter((d) => d.serviceId === cd.serviceId).pop();
  const verified = !!cname && !!txt;
  return {
    id: cd.id, domain: cd.domain, status: {
      verified, verificationDnsHost: `_railway-verify.${label}`, verificationToken: cd.token,
      certificateStatus: verified && dep?.status === "SUCCESS" ? "CERTIFICATE_STATUS_TYPE_VALID" : verified ? "CERTIFICATE_STATUS_TYPE_ISSUING" : "CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP",
      dnsRecords: [{ recordType: "DNS_RECORD_TYPE_CNAME", hostlabel: label, fqdn: cd.domain, zone, requiredValue: cd.target, currentValue: cname ? cd.target : "", status: cname ? "DNS_RECORD_STATUS_PROPAGATED" : "DNS_RECORD_STATUS_REQUIRES_UPDATE", purpose: "DNS_RECORD_PURPOSE_TRAFFIC_ROUTE" }],
    },
  };
}
async function removeRailProject(p: any) {
  rProjects.delete(p.id);
  for (const s of p.services.values()) { if (s.port) usedPorts.delete(s.port); await sh(["docker", "rm", "-f", s.container]); }
  await sh(["docker", "volume", "rm", `wiz-test-rail-pgvol-${tag(p.id)}`]);
  await sh(["docker", "network", "rm", `wiz-test-rail-net-${tag(p.id)}`]);
  await sh(["docker", "rmi", `wiz-test-rail-img-${tag(p.id)}`]);
  log(`railway: deleted project ${p.id}`);
}
async function streamInto(args: string[], into: string[]): Promise<number> {
  const pr = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const pump = async (st: ReadableStream<Uint8Array>) => {
    let buf = "";
    for await (const chunk of st as any) { buf += new TextDecoder().decode(chunk); let i; while ((i = buf.indexOf("\n")) >= 0) { into.push(buf.slice(0, i)); buf = buf.slice(i + 1); if (into.length > 3000) into.splice(0, 1000); } }
    if (buf) into.push(buf);
  };
  await Promise.all([pump(pr.stdout), pump(pr.stderr)]);
  return pr.exited;
}
async function runDeploy(d: any, body: Uint8Array) {
  if (process.env.DEMO_APP_URL) { await Bun.sleep(800); d.logs.push("Build finished", "Deploy complete"); d.status = "DEPLOYING"; await Bun.sleep(800); d.status = "SUCCESS"; return; }
  const [p, app] = findService(d.serviceId) as [any, any];
  const gone = () => !rProjects.has(p.id); // deleted while it built
  try {
    if (railFailNext) {
      const msg = railFailNext; railFailNext = null;
      await Bun.sleep(2500);
      d.logs.push("[internal] load build definition from deploy/Dockerfile", "#9 [build 6/6] RUN bun run build", msg, 'ERROR: failed to solve: process "/bin/sh -c bun run build" did not complete successfully: exit code: 1');
      d.status = "FAILED"; log(`railway: deployment ${d.id} FAILED (test switch)`);
      return;
    }
    const dir = join(RAIL_TMP, d.id);
    await sh(["mkdir", "-p", dir]);
    await Bun.write(join(dir, "src.tgz"), body);
    const x = await sh(["tar", "-xzf", join(dir, "src.tgz"), "-C", dir]);
    if (x.code !== 0) { d.logs.push("could not unpack the upload: " + x.err); d.status = "FAILED"; return; }
    const dockerfile = app.variables.RAILWAY_DOCKERFILE_PATH || app.settings?.dockerfilePath || "Dockerfile";
    d.logs.push(`Using Detected Dockerfile ${dockerfile}`, "");
    const img = `wiz-test-rail-img-${tag(p.id)}`;
    const code = await streamInto(["docker", "build", "-f", join(dir, dockerfile), "-t", img, dir], d.logs);
    await sh(["rm", "-rf", dir]);
    if (code !== 0) { d.logs.push(`ERROR: docker build exited with code ${code}`); d.status = "FAILED"; log(`railway: build ${d.id} failed`); return; }
    if (gone()) { d.status = "REMOVED"; return; }
    d.status = "DEPLOYING";
    const net = `wiz-test-rail-net-${tag(p.id)}`;
    if ((await sh(["docker", "network", "inspect", net])).code !== 0) await sh(["docker", "network", "create", "--label", "wiz-test=1", "--label", `wiz-test-port=${BASE}`, net]);
    const pg = [...p.services.values()].find((s: any) => s.name === "Postgres");
    if (pg && (await sh(["docker", "inspect", "-f", "{{.State.Running}}", pg.container])).out !== "true") {
      const v = resolveVars(p, pg);
      await sh(["docker", "rm", "-f", pg.container]);
      await sh(["docker", "volume", "create", "--label", "wiz-test=1", "--label", `wiz-test-port=${BASE}`, `wiz-test-rail-pgvol-${tag(p.id)}`]);
      // Stand-in for Railway's postgres-ssl image (same official Postgres underneath).
      const r = await sh(["docker", "run", "-d", "--name", pg.container, "--network", net, "--label", "wiz-test=1", "--label", `wiz-test-port=${BASE}`, "-e", `POSTGRES_USER=${v.POSTGRES_USER}`, "-e", `POSTGRES_PASSWORD=${v.POSTGRES_PASSWORD}`, "-e", `POSTGRES_DB=${v.POSTGRES_DB}`,
        "-v", `wiz-test-rail-pgvol-${tag(p.id)}:/var/lib/postgresql/data`, "postgres:16"]);
      if (r.code !== 0) throw new Error("postgres: " + r.err);
      for (let i = 0; i < 60; i++) { if ((await sh(["docker", "exec", pg.container, "pg_isready", "-U", v.POSTGRES_USER])).code === 0) break; await Bun.sleep(1000); }
      await Bun.sleep(1500);
    }
    const env = resolveVars(p, app);
    const envFile = join(RAIL_TMP, `${d.id}.env`);
    await Bun.write(envFile, Object.entries(env).map(([k, v]) => `${k}=${v.replace(/[\r\n]/g, " ")}`).join("\n") + "\n");
    await sh(["docker", "rm", "-f", app.container]);
    const r = await sh(["docker", "run", "-d", "--name", app.container, "--network", net, "--label", "wiz-test=1", "--label", `wiz-test-port=${BASE}`, "--env-file", envFile, ...(app.port ? ["-p", `127.0.0.1:${app.port}:${env.PORT || 8791}`] : []), img]);
    await sh(["rm", "-f", envFile]);
    if (r.code !== 0) { d.logs.push("could not start: " + r.err); d.status = "CRASHED"; return; }
    let okHealth = false;
    for (let i = 0; i < 90 && app.port; i++) {
      okHealth = await fetch(`http://127.0.0.1:${app.port}${app.settings?.healthcheckPath || "/"}`, { signal: AbortSignal.timeout(3000) }).then((x) => x.ok).catch(() => false);
      if (okHealth) break;
      await Bun.sleep(2000);
    }
    d.rlogs = (await sh(["docker", "logs", "--tail", "80", app.container])).out.split("\n");
    d.status = okHealth ? "SUCCESS" : "CRASHED";
    log(`railway: deployment ${d.id} ${d.status} (app ${app.container} on 127.0.0.1:${app.port})`);
  } catch (e) {
    d.logs.push(String(e)); d.status = "CRASHED"; log("railway deploy error " + e);
  }
}

Bun.serve({
  port: P.rail, hostname: "127.0.0.1", maxRequestBodySize: 200 * 1024 * 1024,
  async fetch(req) {
    const u = new URL(req.url);
    const tok = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    const up = u.pathname.match(/^\/project\/([^/]+)\/environment\/([^/]+)\/up$/);
    if (up && req.method === "POST") {
      if (tok !== RW_OK && tok !== RW_NOCARD) return json(401, { message: "Unauthorized" });
      if (tok === RW_NOCARD) return json(400, { message: "Your account is on a limited trial and cannot deploy code. Upgrade to the Hobby plan." });
      const p = rProjects.get(up[1]);
      const sid = u.searchParams.get("serviceId") || "";
      if (!p || p.envId !== up[2] || !p.services.has(sid)) return json(400, { message: "Project or service not found" });
      const body = new Uint8Array(await req.arrayBuffer());
      const d = { id: rid("dep"), projectId: p.id, serviceId: sid, status: "BUILDING", createdAt: new Date().toISOString(), bytes: body.length, logs: [] as string[], rlogs: [] as string[] };
      rDeps.set(d.id, d);
      log(`railway: upload ${body.length} bytes to ${p.id}/${sid} -> deployment ${d.id}`);
      void runDeploy(d, body);
      const svc = p.services.get(sid);
      return json(200, { deploymentId: d.id, url: `https://railway.com/project/${p.id}/service/${sid}?id=${d.id}`, logsUrl: `https://railway.com/project/${p.id}/service/${sid}?id=${d.id}`, deploymentDomain: svc.domain || "" });
    }
    if (u.pathname !== "/graphql/v2" || req.method !== "POST") return json(404, { message: "Not found" });
    const { query = "", variables = {} } = (await req.json().catch(() => ({}))) as any;
    if (tok !== RW_OK && tok !== RW_NOCARD) return gqlErr("Not Authorized");
    const has = (f: string) => new RegExp(`\\b${f}\\s*[({]`).test(query);
    const input = variables.input || {};
    if (has("me")) {
      if (/\bplan\b/.test(query)) return json(200, { data: { me: { workspaces: [{ id: "ws-1", plan: tok === RW_NOCARD ? "FREE" : "HOBBY", customer: { isTrialing: tok === RW_NOCARD, defaultPaymentMethodId: tok === RW_NOCARD ? null : "pm_mock" } }] } } });
      return json(200, { data: { me: { email: "owner@example.com", workspaces: [{ id: "ws-1", name: "Owner's Projects" }] } } });
    }
    if (has("projectCreate")) {
      if (tok === RW_NOCARD) return gqlErr("You must upgrade your plan to create more projects");
      const p = { id: rid("prj"), name: input.name, envId: rid("env"), services: new Map<string, any>(), customDomains: [] as any[] };
      rProjects.set(p.id, p); log(`railway: project ${p.id} "${p.name}"`);
      return json(200, { data: { projectCreate: { id: p.id, environments: { edges: [{ node: { id: p.envId, name: "production" } }] } } } });
    }
    if (has("projectDelete")) { const p = rProjects.get(variables.id); if (!p) return gqlErr("Project not found"); await removeRailProject(p); return json(200, { data: { projectDelete: true } }); }
    if (has("project")) { const p = rProjects.get(variables.id); if (!p) return gqlErr("Project not found"); return json(200, { data: { project: { id: p.id, environments: { edges: [{ node: { id: p.envId, name: "production" } }] } } } }); }
    if (has("serviceCreate")) {
      const p = rProjects.get(input.projectId); if (!p) return gqlErr("Project not found");
      const id = rid("svc");
      const role = input.name === "Postgres" ? "pg" : "app";
      p.services.set(id, { id, name: input.name, image: input.source?.image, variables: { ...(input.variables || {}) }, settings: {}, container: `wiz-test-rail-${role}-${tag(p.id)}`, volume: null });
      log(`railway: service ${input.name}${input.source?.image ? ` (${input.source.image})` : ""} in ${p.id}`);
      return json(200, { data: { serviceCreate: { id } } });
    }
    if (has("volumeCreate")) { const [, s] = findService(input.serviceId); if (!s) return gqlErr("Service not found"); s.volume = input.mountPath; return json(200, { data: { volumeCreate: { id: rid("vol") } } }); }
    if (has("variableCollectionUpsert")) { const [, s] = findService(input.serviceId); if (!s) return gqlErr("Service not found"); Object.assign(s.variables, input.variables || {}); return json(200, { data: { variableCollectionUpsert: true } }); }
    if (has("serviceInstanceUpdate")) { const [, s] = findService(variables.serviceId); if (!s) return gqlErr("Service not found"); Object.assign(s.settings, variables.input || {}); return json(200, { data: { serviceInstanceUpdate: true } }); }
    if (has("serviceDomainCreate")) {
      const [, s] = findService(input.serviceId); if (!s) return gqlErr("Service not found");
      if (!s.port) { for (let q = PORT_LO; q <= PORT_HI; q++) if (!usedPorts.has(q)) { s.port = q; usedPorts.add(q); break; } }
      if (!s.port) return gqlErr("mock: no free app port (MOCK_APP_PORTS)");
      s.domain = `localhost:${s.port}`;
      return json(200, { data: { serviceDomainCreate: { id: rid("sd"), domain: s.domain } } });
    }
    if (has("customDomainCreate")) {
      const p = rProjects.get(input.projectId); if (!p) return gqlErr("Project not found");
      if (rProjects.size && [...rProjects.values()].some((x) => x.customDomains.some((c: any) => c.domain === input.domain))) return gqlErr("Domain is already in use");
      const cd = { id: rid("cd"), domain: String(input.domain).toLowerCase(), serviceId: input.serviceId, target: `${randomBytes(4).toString("hex")}.up.railway.app`, token: `railway-verify=${randomBytes(16).toString("hex")}` };
      p.customDomains.push(cd);
      return json(200, { data: { customDomainCreate: domainJson(p, cd) } });
    }
    if (has("customDomain")) {
      const p = rProjects.get(variables.p); const cd = p?.customDomains.find((c: any) => c.id === variables.id);
      if (!cd) return gqlErr("Custom domain not found");
      return json(200, { data: { customDomain: domainJson(p, cd) } });
    }
    if (has("deployment")) { const d = rDeps.get(variables.id); if (!d) return gqlErr("Deployment not found"); return json(200, { data: { deployment: { id: d.id, status: d.status } } }); }
    if (has("buildLogs")) {
      const d = rDeps.get(variables.d); if (!d) return gqlErr("Deployment not found");
      const t = new Date().toISOString();
      return json(200, { data: { buildLogs: d.logs.slice(-400).map((m: string) => ({ timestamp: t, message: m })), ...(has("deploymentLogs") ? { deploymentLogs: d.rlogs.slice(-150).map((m: string) => ({ timestamp: t, message: m })) } : {}) } });
    }
    return gqlErr("mock: unsupported operation");
  },
});

// ============================ SMTP ============================
createServer((sock) => {
  let authed = false, inData = false, buf = "", authStep = "";
  const say = (s: string) => sock.write(s + "\r\n");
  say("220 mock.smtp ready");
  sock.on("data", (d) => {
    buf += d.toString("utf8");
    let i: number;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (inData) { if (line === ".") { inData = false; say("250 queued"); } continue; }
      if (authStep === "user") { authStep = Buffer.from(line, "base64").toString() === "test" ? "pass" : "bad"; say("334 UGFzc3dvcmQ6"); continue; }
      if (authStep) { authed = authStep === "pass" && Buffer.from(line, "base64").toString() === "test-pass"; authStep = ""; say(authed ? "235 ok" : "535 5.7.8 Authentication credentials invalid"); continue; }
      const cmd = line.toUpperCase();
      if (cmd.startsWith("EHLO")) sock.write("250-mock.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n");
      else if (cmd.startsWith("HELO")) say("250 mock.smtp");
      else if (cmd.startsWith("AUTH PLAIN")) { const parts = Buffer.from(line.split(" ")[2] || "", "base64").toString().split("\0"); authed = parts[1] === "test" && parts[2] === "test-pass"; say(authed ? "235 ok" : "535 5.7.8 Authentication credentials invalid"); }
      else if (cmd.startsWith("AUTH LOGIN")) { authStep = "user"; say("334 VXNlcm5hbWU6"); }
      else if (cmd.startsWith("MAIL FROM")) say(authed ? "250 ok" : "530 auth required");
      else if (cmd.startsWith("RCPT TO")) say("250 ok");
      else if (cmd === "DATA") { inData = true; say("354 go"); }
      else if (cmd === "QUIT") { say("221 bye"); sock.end(); }
      else say("250 ok");
    }
  });
  sock.on("error", () => {});
}).listen(P.smtp, "127.0.0.1");

log(`DigitalOcean :${P.do}  SMTP :${P.smtp}  Cloudflare :${P.cf}  Resend :${P.resend}  DNS udp :${P.dns}  Railway :${P.rail} (apps on 127.0.0.1:${PORT_LO}-${PORT_HI})  (droplets on ${NET}, image ${IMAGE})`);
void join;
