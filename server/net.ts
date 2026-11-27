import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Addresses this server must never be pointed at by a form (a mail server on the
// connect page, a CRM webhook): this machine, the local network and cloud
// metadata services.
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const groups = expandV6(ip.toLowerCase());
    if (!groups) return true;
    const v4 = (x: number, y: number) => `${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`;
    // ::, ::1 and IPv4-mapped (::ffff:a.b.c.d or ::ffff:7f00:1), IPv4-compatible and NAT64 (64:ff9b::) forms
    // are judged by the IPv4 address inside them.
    if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0 || groups[5] === 0xffff)) return privateAddress(v4(groups[6], groups[7]));
    if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) return privateAddress(v4(groups[6], groups[7]));
    return (groups[0] & 0xfe00) === 0xfc00 || (groups[0] & 0xffc0) === 0xfe80 || (groups[0] & 0xffc0) === 0xfec0;
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

// "::ffff:1.2.3.4" and "::1" style text as eight 16-bit groups, or null when it isn't valid.
function expandV6(ip: string): number[] | null {
  let text = ip.split("%")[0];
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [, a, b, c, d] = dotted.map(Number);
    text = text.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [head, tail, extra] = text.split("::");
  if (extra !== undefined) return null;
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  const all = [...h, ...Array(Math.max(0, fill)).fill("0"), ...t];
  if (all.length !== 8 || fill < 0) return null;
  const nums = all.map((g) => parseInt(g, 16));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? nums : null;
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
