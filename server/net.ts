import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Addresses this server must never be pointed at by a form (a mail server on the
// connect page, a CRM webhook): this machine, the local network and cloud
// metadata services.
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6.startsWith("::ffff:")) return privateAddress(v6.slice(7));
    return v6 === "::1" || v6 === "::" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

// True when every address the name resolves to is public.
export async function isPublicHost(host: string): Promise<boolean> {
  if (isIP(host)) return !privateAddress(host);
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && !addresses.some((a) => privateAddress(a.address));
  } catch {
    return false;
  }
}
