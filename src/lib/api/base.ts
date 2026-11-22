// The one way the browser talks to our server (/api/*). JSON in, JSON out, the
// server's own error message on failure, and a signed-out answer (401) sends the
// person to /login (except on the public pages, which handle it themselves).

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown = null,
  ) {
    super(message);
  }
}

// Pages that are fine to show signed out: a 401 there is just an answer.
const PUBLIC_PATHS = [/^\/$/, /^\/login/, /^\/signup/, /^\/reset/, /^\/invite\//, /^\/connect\//];

function goToLogin() {
  if (typeof window === "undefined") return;
  const here = window.location.pathname;
  if (PUBLIC_PATHS.some((p) => p.test(here))) return;
  const back = encodeURIComponent(here + window.location.search);
  window.location.replace(`/login?redirect=${back}`);
}

export type RequestOptions = {
  /** Don't redirect to /login on 401 (e.g. the session probe). */
  allow401?: boolean;
  signal?: AbortSignal;
};

export async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && !opts.allow401) goToLogin();
    const message = (data && typeof data.error === "string" && data.error) || `Something went wrong (${res.status}).`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("POST", path, body ?? {}, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PUT", path, body ?? {}, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PATCH", path, body ?? {}, opts),
  del: <T>(path: string, opts?: RequestOptions) => request<T>("DELETE", path, undefined, opts),
};

/** A query string from the defined values only. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") out.set(k, String(v));
  const s = out.toString();
  return s ? `?${s}` : "";
}
