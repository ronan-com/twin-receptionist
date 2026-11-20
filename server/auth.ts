// A request counts as local only if it was addressed to this machine and carries
// none of the headers a tunnel or proxy adds. Only the tunnel script relies on it,
// to report its public address; everything else needs a signed-in account.
export function isLocal(req: Request): boolean {
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (host !== "127.0.0.1" && host !== "localhost") return false;
  for (const name of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip", "cf-connecting-ip", "cf-ray"]) {
    if (req.headers.has(name)) return false;
  }
  return true;
}
