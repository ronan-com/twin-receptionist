import type {
  Account,
  Agency,
  TelnyxSettings,
  InviteInfo,
  OrgRole,
  Session,
  TeamState,
  AvailableNumber,
  BookingProvider,
  BookingState,
  ConnectInfo,
  Business,
  CallMessage,
  CallSummary,
  EmailPreview,
  EmailMode,
  EmailStatus,
  NumberOrder,
  NumberState,
  NumberType,
  Settings,
  TextingState,
  Voice,
} from "./shared";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  // Signed out (expired, or signed out on another tab): back to the sign-in page.
  if (res.status === 401 && !AUTH_PATHS.test(path)) window.location.reload();
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status}).`);
  return data as T;
}

const AUTH_PATHS = /^\/api\/(login|signup|invites\/|password-reset|session)/;

export type MailboxDetails = {
  address: string;
  password: string;
  host?: string;
  port?: number;
  username?: string;
  smtpHost?: string;
  smtpPort?: number;
  mode?: EmailMode;
};

const one = (id: string) => `/api/clients/${encodeURIComponent(id)}`;

export const auth = {
  session: () => request<Session>("GET", "/api/session"),
  signUp: (details: { name: string; email: string; password: string; orgName: string }) =>
    request<{ ok: true }>("POST", "/api/signup", details),
  signIn: (email: string, password: string) => request<{ ok: true }>("POST", "/api/login", { email, password }),
  signOut: () => request<{ ok: true }>("POST", "/api/logout"),
  forgot: (email: string) => request<{ ok: true }>("POST", "/api/password-reset", { email }),
  reset: (token: string, password: string) =>
    request<{ ok: true }>("POST", `/api/password-reset/${encodeURIComponent(token)}`, { password }),
  invite: (token: string) => request<InviteInfo>("GET", `/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string, details: { name?: string; password: string }) =>
    request<{ ok: true }>("POST", `/api/invites/${encodeURIComponent(token)}`, details),
};

export const accountApi = {
  update: (change: { name?: string; currentPassword?: string; newPassword?: string }) =>
    request<Account>("PUT", "/api/account", change),
  createOrg: (name: string) => request<Account>("POST", "/api/orgs", { name }),
  switchOrg: (orgId: string) => request<Account>("POST", "/api/orgs/switch", { orgId }),
  renameOrg: (name: string) => request<Account>("PUT", "/api/org", { name }),
  team: () => request<TeamState>("GET", "/api/team"),
  invite: (email: string, role: OrgRole) =>
    request<{ url: string; emailed: boolean }>("POST", "/api/team/invites", { email, role }),
  revokeInvite: (id: string) => request<TeamState>("DELETE", `/api/team/invites/${id}`),
  changeRole: (userId: string, role: OrgRole) => request<TeamState>("PUT", `/api/team/members/${userId}`, { role }),
  removeMember: (userId: string) => request<TeamState>("DELETE", `/api/team/members/${userId}`),
};

export const telnyxApi = {
  get: () => request<TelnyxSettings>("GET", "/api/org/telnyx"),
  save: (apiKey: string) => request<TelnyxSettings>("PUT", "/api/org/telnyx", { apiKey }),
  remove: () => request<TelnyxSettings>("DELETE", "/api/org/telnyx"),
};

export const adminApi = {
  agencies: () => request<{ agencies: Agency[] }>("GET", "/api/admin/agencies").then((r) => r.agencies),
  create: (details: { name: string; ownerEmail: string }) =>
    request<{ url: string; emailed: boolean }>("POST", "/api/admin/agencies", details),
  inviteOwner: (id: string, email: string) =>
    request<{ url: string; emailed: boolean }>("POST", `/api/admin/agencies/${id}/invites`, { email }),
  update: (id: string, change: { name?: string; suspended?: boolean; platformTelnyx?: boolean }) =>
    request<{ agencies: Agency[] }>("PUT", `/api/admin/agencies/${id}`, change).then((r) => r.agencies),
};

export const api = {
  voices: () => request<{ voices: Voice[] }>("GET", "/api/voices").then((r) => r.voices),
  clients: () => request<{ clients: Business[] }>("GET", "/api/clients").then((r) => r.clients),
  client: (id: string) => request<{ client: Business }>("GET", one(id)).then((r) => r.client),
  create: (settings: Settings) =>
    request<{ client: Business }>("POST", "/api/clients", settings).then((r) => r.client),
  update: (id: string, settings: Settings) =>
    request<{ client: Business }>("PUT", one(id), settings).then((r) => r.client),
  remove: (id: string) => request<{ ok: true }>("DELETE", one(id)),
  calls: (id: string) => request<{ calls: CallSummary[] }>("GET", `${one(id)}/calls`).then((r) => r.calls),
  call: (id: string, callId: string) =>
    request<{ summary: string; messages: CallMessage[] }>(
      "GET",
      `${one(id)}/calls/${encodeURIComponent(callId)}/messages`,
    ),
  email: (id: string) => request<EmailStatus>("GET", `${one(id)}/email`),
  connectEmail: (id: string, details: MailboxDetails) =>
    request<EmailStatus>("PUT", `${one(id)}/email`, details),
  disconnectEmail: (id: string) => request<EmailStatus>("DELETE", `${one(id)}/email`),
  checkEmail: (id: string) => request<EmailStatus>("POST", `${one(id)}/email/check`),
  numbers: (id: string) => request<NumberState>("GET", `${one(id)}/numbers`),
  availableNumbers: (type: NumberType) =>
    request<{ numbers: AvailableNumber[] }>("GET", `/api/numbers/available?type=${type}`).then((r) => r.numbers),
  buyNumber: (id: string, phoneNumber: string) =>
    request<NumberState & { order: NumberOrder }>("POST", `${one(id)}/numbers`, { phoneNumber, confirm: true }),
  booking: (id: string) => request<BookingState>("GET", `${one(id)}/booking`),
  setUpBooking: (id: string, setup: { provider: BookingProvider; minutes: number; notifyEmail: string }) =>
    request<BookingState>("POST", `${one(id)}/booking`, setup),
  changeBooking: (
    id: string,
    change: { enabled?: boolean; minutes?: number; notifyEmail?: string; leadWebhook?: string },
  ) => request<BookingState>("PUT", `${one(id)}/booking`, change),
  cancelAppointment: (id: string, eventId: string) =>
    request<BookingState>("DELETE", `${one(id)}/booking/events/${encodeURIComponent(eventId)}`),
  disconnectCalendar: (id: string) => request<BookingState>("DELETE", `${one(id)}/calendar`),
  removeBooking: (id: string) => request<BookingState>("DELETE", `${one(id)}/booking`),
  testBooking: (id: string) => request<{ date: string; result: unknown }>("POST", `${one(id)}/booking/test`),
  connectLink: (id: string) => request<{ url: string; expiresAt: string }>("POST", `${one(id)}/connect-link`),
  revokeConnectLink: (id: string) => request<{ ok: true }>("DELETE", `${one(id)}/connect-link`),
  linkInfo: (token: string) => request<ConnectInfo>("GET", `/api/connect/${encodeURIComponent(token)}`),
  linkConnect: (token: string, details: MailboxDetails) =>
    request<ConnectInfo>("PUT", `/api/connect/${encodeURIComponent(token)}/email`, details),
  linkDisconnect: (token: string) => request<ConnectInfo>("DELETE", `/api/connect/${encodeURIComponent(token)}/email`),
  texting: (id: string) => request<TextingState>("GET", `${one(id)}/texting`),
  enableTexting: (id: string) => request<TextingState>("POST", `${one(id)}/texting`),
  connectTextNumber: (id: string, phoneNumber: string) =>
    request<TextingState>("POST", `${one(id)}/texting/numbers`, { phoneNumber }),
  startTextSim: (id: string) => request<{ conversationId: string }>("POST", `${one(id)}/simulator/texts`),
  sendSimText: (id: string, conversationId: string, text: string) =>
    request<{ reply: string }>("POST", `${one(id)}/simulator/texts/send`, { conversationId, text }),
  previewEmail: (id: string, email: { fromName: string; fromAddress: string; subject: string; body: string }) =>
    request<EmailPreview>("POST", `${one(id)}/simulator/email`, email),
  sendTestText: (id: string, to: string) =>
    request<{ conversationId: string }>("POST", `${one(id)}/texting/test`, { to }),
};
