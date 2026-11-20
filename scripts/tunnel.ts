// Opens a public https address for this computer's API (port 8791) with a free
// Cloudflare quick tunnel, then tells the API so the receptionists' booking tools
// point at it. The address changes every time this restarts; the tools follow.
//
// Only /hooks/* (each locked to one client's key) works without the dashboard
// password through this address.

const API = `http://127.0.0.1:${process.env.API_PORT ?? 8791}`;
const bin = process.env.CLOUDFLARED ?? "cloudflared";

const proc = Bun.spawn([bin, "tunnel", "--no-autoupdate", "--url", API], { stdout: "ignore", stderr: "pipe" });
process.on("SIGINT", () => proc.kill());
process.on("SIGTERM", () => proc.kill());

let announced = false;
const decoder = new TextDecoder();
for await (const chunk of proc.stderr) {
  const text = decoder.decode(chunk);
  const found = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (found && !announced) {
    announced = true;
    const url = found[0];
    // Give Cloudflare a moment to route the new name before Telnyx is told about it.
    await Bun.sleep(3000);
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        const res = await fetch(`${API}/api/public-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        if (res.ok) {
          console.log(`Public address: ${url}  (receptionists updated)`);
          break;
        }
        console.error(`API refused the address: ${await res.text()}`);
        break;
      } catch {
        console.error(`API not reachable yet (attempt ${attempt}). Is bun run dev running?`);
        await Bun.sleep(3000);
      }
    }
  }
  if (/ERR|error/.test(text) && !/Cannot determine default/.test(text)) process.stderr.write(text);
}
console.log("Tunnel closed.");
