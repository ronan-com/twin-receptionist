const BASE = "https://api.telnyx.com/v2";

export class TelnyxError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function hasKey(): boolean {
  return Boolean(process.env.TELNYX_API_KEY);
}

export async function telnyx<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new TelnyxError(500, "TELNYX_API_KEY is not set. Add it to ~/aibiz/.env and restart.");

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new TelnyxError(502, `Could not reach Telnyx: ${(err as Error).message}`);
  }

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error bodies fall through to the generic message below.
  }

  if (!res.ok) {
    const first = json?.errors?.[0];
    const detail = first?.detail || first?.title || text.slice(0, 200) || res.statusText;
    throw new TelnyxError(res.status, `Telnyx said: ${detail}`);
  }
  return json as T;
}
