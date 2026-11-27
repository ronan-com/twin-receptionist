import { api, qs } from "./base";

// The business app's Inbox, Calendar, Contacts and "connect your apps" (server/routes/workspaceMore.ts, apps.ts).

const base = (id: string) => `/api/workspace/${encodeURIComponent(id)}`;

export type InboxKind = "call" | "text" | "chat" | "email";
export type InboxItem = {
  id: string;
  kind: InboxKind;
  at: string;
  who: string | null;
  phone: string | null;
  email: string | null;
  summary: string | null;
  outcome: string | null;
  callId: string | null;
  booking: boolean;
};
export const getInbox = async (id: string, days = 90) =>
  (await api.get<{ items: InboxItem[] }>(`${base(id)}/inbox${qs({ from: new Date(Date.now() - days * 86_400_000).toISOString(), to: new Date().toISOString() })}`)).items;

export type CalEvent = {
  id: string;
  starts_at: string;
  ends_at: string;
  title: string;
  customer_name: string | null;
  phone: string | null;
  status: "pending" | "confirmed" | "declined" | "cancelled";
  source: "booking" | "builtin" | "google" | "microsoft";
  requestId: string | null;
};
export const getCalendar = async (id: string, from: Date, to: Date) =>
  (await api.get<{ events: CalEvent[] }>(`${base(id)}/calendar${qs({ from: from.toISOString(), to: to.toISOString() })}`)).events;

/** Approve or decline a booking the AI is holding. The caller is told either way. */
export const decideBooking = (id: string, requestId: string, status: "confirmed" | "declined") =>
  api.patch(`${base(id)}/bookings/${encodeURIComponent(requestId)}`, { status });

export type ContactStatus = "new" | "active" | "customer" | "closed";
export type Contact = { id: string; name: string; phone: string; email: string; status: ContactStatus; notes: string; last_at: string; counts: { calls: number; bookings: number; chats: number } };
export type TimelineEntry = { at: string; kind: "call" | "text" | "booking" | "callback" | "chat"; title: string; summary: string | null; callId: string | null };
export const getContacts = async (id: string) => (await api.get<{ contacts: Contact[] }>(`${base(id)}/contacts`)).contacts;
export const getContact = (id: string, key: string) => api.get<{ contact: Contact; timeline: TimelineEntry[] }>(`${base(id)}/contacts/${encodeURIComponent(key)}`);
export const patchContact = (id: string, key: string, body: Partial<Pick<Contact, "name" | "notes" | "status">>) => api.patch<{ contact: Contact }>(`${base(id)}/contacts/${encodeURIComponent(key)}`, body);
export const contactsCsvUrl = (id: string) => `${base(id)}/contacts.csv`;

export type McpView = { mcp: { url: string; headerName: string; hasHeader: boolean }; warning?: string };
export const getMcp = (id: string) => api.get<McpView>(`${base(id)}/mcp`);
export const putMcp = (id: string, body: { url: string; headerName?: string; headerValue?: string }) => api.put<McpView>(`${base(id)}/mcp`, body);

export type AppCard = {
  provider: string; name: string; hint: string; connected: boolean; savedAt: string | null;
  /** false for Tradify (no public API). */
  syncable: boolean; enabled: boolean; config: Record<string, string>;
  last: { at: string; ok: boolean; error: string | null; what: string } | null;
};
export type AppOptions = { businesses?: { id: string; name: string }[]; practitioners?: { id: string; name: string }[]; appointmentTypes?: { id: string; name: string }[]; staff?: { id: string; name: string }[] };
export const getAppOptions = (id: string, provider: string) => api.get<AppOptions>(`${base(id)}/apps/${provider}/options`);
export const saveAppSettings = (id: string, provider: string, body: { enabled?: boolean; config?: Record<string, string> }) => api.put<AppsView>(`${base(id)}/apps/${provider}/settings`, body);
export type AppsView = { apps: AppCard[]; pipedream: boolean };
export const getApps = (id: string) => api.get<AppsView>(`${base(id)}/apps`);
export const saveAppKey = (id: string, provider: string, key: string) => api.put<AppsView>(`${base(id)}/apps/${provider}`, { key });
export const removeAppKey = (id: string, provider: string) => api.del<AppsView>(`${base(id)}/apps/${provider}`);
export const testAppKey = (id: string, provider: string) => api.post<{ ok: boolean; message: string }>(`${base(id)}/apps/${provider}/test`);
export const pipedreamConnect = (id: string) => api.post<{ url: string }>(`${base(id)}/pipedream/connect`);

export type PipedreamView = { configured: boolean; projectId: string; clientId: string; environment: "production" | "development" };
export const getPipedream = () => api.get<PipedreamView>("/api/console/pipedream");
export const putPipedream = (body: { clientId: string; clientSecret: string; projectId: string; environment: string }) => api.put<PipedreamView>("/api/console/pipedream", body);
export const removePipedream = () => api.del<PipedreamView>("/api/console/pipedream");

export type ProviderItem = { provider: string; balance?: number; currency?: string; low?: boolean; url?: string; message?: string };
/** null when this server has no provider-status route (404) or it failed. */
export async function getProviderStatus(): Promise<ProviderItem[] | null> {
  try {
    return (await api.get<{ items?: ProviderItem[] }>("/api/provider-status", { allow401: true })).items ?? [];
  } catch {
    return null;
  }
}
