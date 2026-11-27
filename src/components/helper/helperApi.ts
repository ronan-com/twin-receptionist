// The browser side of server/helper.ts: three small calls. Nothing here keeps a key or a session; the cookie does that.

export type HelperAction =
  | { type: "navigate"; path: string; label: string }
  | { type: "offer"; path: string; label: string }
  | { type: "confirm"; id: string; title: string; lines: string[] };

export type CardState = { s: "working" | "done" | "cancelled" | "error"; text?: string };

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<{ res: Response; data: T }> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", signal, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T;
  return { res, data };
}

export async function askHelper(messages: { role: "user" | "assistant"; content: string }[], route: string, signal?: AbortSignal): Promise<{ reply: string; actions: HelperAction[] }> {
  const { res, data } = await post<{ reply?: string; actions?: HelperAction[]; error?: string }>("/api/helper/chat", { messages, route }, signal);
  if (!res.ok) throw new Error(data.error || "Helper isn't available right now.");
  return { reply: data.reply ?? "", actions: Array.isArray(data.actions) ? data.actions : [] };
}

/** Press "Do it" (or Cancel) on a card. Throws with the server's words when the change is refused. */
export async function answerCard(id: string, cancel: boolean): Promise<{ message: string; navigate?: string }> {
  const { res, data } = await post<{ message?: string; navigate?: string; error?: string }>("/api/helper/confirm", { id, ...(cancel ? { cancel: true } : {}) });
  if (!res.ok) throw new Error(data.error || "That didn't work.");
  return { message: data.message ?? "Done.", navigate: data.navigate };
}

/** The reply in the agency's own phone voice, or null (204, or any failure) so the browser's voice is used. */
export async function serverSpeech(text: string, signal?: AbortSignal): Promise<Blob | null> {
  try {
    const res = await fetch("/api/helper/speak", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", signal, body: JSON.stringify({ text }) });
    if (res.status !== 200) return null;
    return await res.blob();
  } catch {
    return null;
  }
}
