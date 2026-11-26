// Test mode only (MOCK_DO=1): a tiny fake of the DigitalOcean API.
// A "droplet" is a local Docker container (installer/mock-droplet) running
// Ubuntu 24.04 with sshd, so the SSH, upload and .env steps run for real.
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { STATE_DIR } from "../state";

export const MOCK_TOKEN = "mock-do-token-for-tests";
const IMAGE = "receptionist-mock-droplet:24.04";
const LABEL = "receptionist-installer-mock=1";

const keys = new Map<number, { id: number; name: string; public_key: string; fingerprint: string }>();
const droplets = new Map<number, { id: number; name: string; region: string; size: string; tags: string[]; status: string; ip?: string; container: string; created: number }>();
let nextId = 1000;
// Kept on disk so a restarted installer (resume test) still sees its droplet.
const MOCK_FILE = join(STATE_DIR, "mock-do.json");
function persist() {
  writeFileSync(MOCK_FILE, JSON.stringify({ nextId, keys: [...keys.values()], droplets: [...droplets.values()] }));
}
function restore() {
  if (!existsSync(MOCK_FILE)) return;
  const j = JSON.parse(readFileSync(MOCK_FILE, "utf8"));
  nextId = j.nextId;
  for (const k of j.keys) keys.set(k.id, k);
  for (const d of j.droplets) droplets.set(d.id, d);
}

async function sh(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out.trim(), err: err.trim() };
}

async function ensureImage() {
  if ((await sh(["docker", "image", "inspect", IMAGE])).code === 0) return;
  console.log("[mock-do] building the mock droplet image");
  const r = await sh(["docker", "build", "-q", "-t", IMAGE, join(import.meta.dir, "../../mock-droplet")]);
  if (r.code !== 0) throw new Error("mock droplet image build failed: " + r.err);
}

const sizes = [
  ["s-1vcpu-1gb", 1, 1024, 25, 6],
  ["s-1vcpu-2gb", 1, 2048, 50, 12],
  ["s-2vcpu-2gb", 2, 2048, 60, 18],
  ["s-2vcpu-4gb", 2, 4096, 80, 24],
  ["s-4vcpu-8gb", 4, 8192, 160, 48],
].map(([slug, vcpus, memory, disk, price]) => ({ slug, vcpus, memory, disk, price_monthly: price, price_hourly: (price as number) / 730, available: true, regions: ["syd1", "sgp1", "nyc3", "lon1"] }));

const regions = [
  ["syd1", "Sydney 1"],
  ["sgp1", "Singapore 1"],
  ["nyc3", "New York 3"],
  ["lon1", "London 1"],
].map(([slug, name]) => ({ slug, name, available: true, sizes: sizes.map((s) => s.slug) }));

const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function bootDroplet(d: { id: number; container: string; status: string; ip?: string }, pubKey: string) {
  try {
    await ensureImage();
    const r = await sh(["docker", "run", "-d", "--name", d.container, "--label", LABEL, "-e", `AUTHORIZED_KEY=${pubKey}`, IMAGE]);
    if (r.code !== 0) throw new Error(r.err);
    const ip = await sh(["docker", "inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", d.container]);
    d.ip = ip.out;
    d.status = "active";
    persist();
    console.log(`[mock-do] droplet ${d.id} is container ${d.container} at ${d.ip}`);
  } catch (e) {
    console.log("[mock-do] failed to boot droplet: " + e);
    d.status = "errored";
  }
}

export function startMockDO(port = 4401) {
  restore();
  Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization") || "";
      if (auth !== `Bearer ${MOCK_TOKEN}`) return json(401, { id: "Unauthorized", message: "Unable to authenticate you" });
      const p = url.pathname;
      const m = req.method;
      if (m === "GET" && p === "/v2/account")
        return json(200, { account: { email: "owner@example.com", status: "active", email_verified: true, droplet_limit: 10, uuid: "mock" } });
      if (m === "GET" && p === "/v2/regions") return json(200, { regions, meta: { total: regions.length } });
      if (m === "GET" && p === "/v2/sizes") return json(200, { sizes, meta: { total: sizes.length } });
      if (m === "POST" && p === "/v2/account/keys") {
        const b: any = await req.json();
        if (!/^ssh-ed25519 /.test(b.public_key || "")) return json(422, { id: "unprocessable_entity", message: "Key invalid type" });
        const k = { id: nextId++, name: b.name, public_key: b.public_key, fingerprint: "mock:" + nextId };
        keys.set(k.id, k);
        persist();
        return json(201, { ssh_key: k });
      }
      let mm = p.match(/^\/v2\/account\/keys\/(\d+)$/);
      if (mm && m === "DELETE") return keys.delete(+mm[1]) ? (persist(), json(204)) : json(404, { id: "not_found", message: "The resource you were accessing could not be found." });
      if (m === "POST" && p === "/v2/droplets") {
        const b: any = await req.json();
        if (b.image !== "ubuntu-24-04-x64") return json(422, { id: "unprocessable_entity", message: "You specified an invalid image for Droplet creation." });
        if (!regions.some((r) => r.slug === b.region)) return json(422, { id: "unprocessable_entity", message: "Region is not available" });
        if (!sizes.some((s) => s.slug === b.size)) return json(422, { id: "unprocessable_entity", message: "Size is not available" });
        const key = keys.get(b.ssh_keys?.[0]);
        if (!key) return json(422, { id: "unprocessable_entity", message: "ssh_keys contains an unknown key" });
        const id = nextId++;
        const d = { id, name: b.name, region: b.region, size: b.size, tags: b.tags || [], status: "new", container: `receptionist-mock-droplet-${id}`, created: Date.now() };
        droplets.set(id, d);
        persist();
        console.log(`[mock-do] create droplet ${id} name=${b.name} region=${b.region} size=${b.size} image=${b.image} tags=${(b.tags || []).join(",")}`);
        // Like the real thing, it's "new" for a bit before it's "active".
        setTimeout(() => bootDroplet(d, key.public_key), 1500);
        return json(202, { droplet: { id, name: d.name, status: "new", networks: { v4: [] } } });
      }
      mm = p.match(/^\/v2\/droplets\/(\d+)$/);
      if (mm) {
        const d = droplets.get(+mm[1]);
        if (!d) return json(404, { id: "not_found", message: "The resource you were accessing could not be found." });
        if (m === "GET")
          return json(200, {
            droplet: { id: d.id, name: d.name, status: d.status, tags: d.tags, region: { slug: d.region }, size_slug: d.size, networks: { v4: d.ip ? [{ ip_address: d.ip, type: "public" }] : [] } },
          });
        if (m === "DELETE") {
          droplets.delete(d.id);
          persist();
          await sh(["docker", "rm", "-f", d.container]);
          console.log(`[mock-do] deleted droplet ${d.id}`);
          return json(204);
        }
      }
      return json(404, { id: "not_found", message: "not found" });
    },
  });
  console.log(`[mock-do] fake DigitalOcean API on http://127.0.0.1:${port} (token: ${MOCK_TOKEN})`);
}

/** Remove every mock droplet container (used by tests). */
export async function cleanupMockDroplets() {
  const r = await sh(["docker", "ps", "-aq", "--filter", `label=${LABEL}`]);
  for (const id of r.out.split("\n").filter(Boolean)) await sh(["docker", "rm", "-f", id]);
}
