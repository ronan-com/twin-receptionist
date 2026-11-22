import { defaultHours, type Business, type CallMessage, type IndustryKey, type NumberState, type Settings, type Voice } from "../src/lib/shared";
import { existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import {
  AuthError,
  acceptInvite,
  account,
  appUrl,
  changeRole,
  clearCookie,
  createOrg,
  invite,
  inviteInfo,
  removeMember,
  renameOrg,
  requestReset,
  requireRole,
  resetPassword,
  revokeInvite,
  sessionCookie,
  sessionFrom,
  signIn,
  signOut,
  signUp,
  signupOpen,
  switchOrg,
  team,
  updateProfile,
  type Ctx,
} from "./accounts";
import { isLocal } from "./auth";
import { migrate, sql } from "./db";
import { checkEmail, connectEmail, connectedClientIds, disconnectEmail, emailStatus } from "./email";
import { availableNumbers, buyNumber, callSummary, connectedNumbers, openOrders, voiceAppFor } from "./numbers";
import { ValidationError, buildInstructions, knowledgeFor, normaliseSettings } from "./prompt";
import { clientsWithBooking, getClient, getOrgClient, insertClient, listClients, orgOfClient, removeClient, saveClient } from "./store";
import { TelnyxError, enterOrg, hasKey, runAsOrg, telnyx } from "./telnyx";
import { createTestLogins, demoCallDetail, ensureSandbox, fakeProvider, isDemo, resetSandbox, sandboxOrgId } from "./sandbox";
import { listCalls } from "./calls";
import { startCallSync } from "./callsync";
import { industryKeyOf, workspaceBusinesses } from "./answered";
import { audit } from "./audit";
import { consoleRoutes } from "./routes/console";
import { manageRoutes, setManageDeps } from "./routes/manage";
import { signupRoutes } from "./routes/signup";
import { workspaceRoutes } from "./routes/workspace";
import type { ClientAccess, RouteArgs } from "./routes/http";
import { changeBrand, ownBrand, serveAsset, uploadAsset } from "./brand";
import { accessibleClients, customerClientId, setFollowUpStage, customersFor, inviteCustomer, removeCustomer, revokeCustomerInvite } from "./customers";
import { createRequest, declineRequest, listRequests, markDone, pendingCount, pendingRequest, requestsForClient } from "./numberRequests";
import { createAgency, exitView, inviteAgencyOwner, viewAs, isSuspended, listAgencies, telnyxSettings, updateAgency } from "./agencies";
import { previewEmail, sendSimText, startTextSim } from "./simulator";
import {
  connectFromLink,
  connectInfo,
  createConnectLink,
  disconnectFromLink,
  revokeConnectLink,
  dashboardSignInStart,
  signInFinish,
  signInStart,
} from "./connect";
import {
  availability,
  book,
  bookingLive,
  bookingTools,
  callback,
  loadPublicUrl,
  newToken,
  publicUrl,
  requestsFor,
  savePublicUrl,
  tokenMatches,
} from "./booking";
import { CalendarError, calendarLink, cancelEvent, disconnectCalendar, providerOf, upcomingEvents } from "./calendars";
import { mailerReady } from "./mailer";
import { checkEmailAddress, checkWebhookUrl, webhookSecret } from "./notify";
import { oauthAvailable } from "./oauth";
import type { BookingProvider, BookingState } from "../src/lib/shared";
import {
  connectNumberForTexts,
  enableTexting,
  removeTextingProfile,
  sendTestText,
  textingProfileId,
  textingState,
} from "./texting";

const PORT = Number(process.env.API_PORT ?? 8791);
const MODEL = "zai-org/GLM-5.3-Flash";

// Voices that suit a front desk, shown first in the picker.
const RECOMMENDED = [
  "Grace - Helpful Hand",
  "Bronte - Trusted Guide",
  "Ella - Caring Scout",
  "Eleanor - Composed Clarifier",
  "Arlo - Service Specialist",
  "Cooper - Friendly Mate",
  "Heath - Calm & Composed",
  "Fraser - Trusted Communicator",
];

let voiceCache: Voice[] | null = null;

// Local tests run with a fake provider key: one stand-in voice (see fakeProvider).
const DEMO_VOICE: Voice = { id: "demo-voice", name: "Grace - Helpful Hand", label: "Demo voice", gender: "female", recommended: true };

async function loadVoices(): Promise<Voice[]> {
  if (fakeProvider()) return [DEMO_VOICE];
  if (voiceCache) return voiceCache;
  const res = await telnyx<{ voices?: any[]; data?: any[] }>("GET", "/text-to-speech/voices");
  const all = res.voices ?? res.data ?? [];
  const seen = new Set<string>();
  const voices: Voice[] = [];
  for (const v of all) {
    const australian = v.language === "en-AU" || v.accent === "Australian";
    if (v.provider !== "telnyx" || !v.hosted || !australian || seen.has(v.name)) continue;
    seen.add(v.name);
    voices.push({
      id: v.id,
      name: v.name,
      label: v.label ?? "",
      gender: v.gender ?? "",
      recommended: RECOMMENDED.includes(v.name),
    });
  }
  voices.sort(
    (a, b) =>
      Number(b.recommended) - Number(a.recommended) ||
      RECOMMENDED.indexOf(a.name) - RECOMMENDED.indexOf(b.name) ||
      a.name.localeCompare(b.name),
  );
  voiceCache = voices;
  return voices;
}

async function voiceNames(): Promise<Map<string, string>> {
  return new Map((await loadVoices()).map((v) => [v.id, v.name]));
}

const HANGUP = {
  type: "hangup",
  hangup: { description: "End the call once the caller has said goodbye or has nothing else to ask." },
};

// The script, with the business's published knowledge items (server/routes/manage.ts).
async function instructionsFor(client: Business, settings = client.settings): Promise<string> {
  return buildInstructions(settings, bookingLive(client) ? { minutes: client.booking!.minutes } : null, await knowledgeFor(client.id));
}

// Pushes the script and tools that match the client's booking setup to Telnyx.
// A demo receptionist has no assistant: its script is only saved.
async function syncAssistant(client: Business): Promise<Business> {
  if (isDemo(client.assistantId)) {
    const next = { ...client, instructions: await instructionsFor(client), updatedAt: new Date().toISOString() };
    await saveClient(next);
    return next;
  }
  const instructions = await instructionsFor(client);
  const tools = bookingLive(client) ? [HANGUP, ...bookingTools(client, publicUrl())] : [HANGUP];
  await telnyx("POST", `/ai/assistants/${client.assistantId}`, { instructions, tools });
  const next = { ...client, instructions, updatedAt: new Date().toISOString() };
  await saveClient(next);
  return next;
}

async function syncAll(): Promise<void> {
  for (const c of await clientsWithBooking()) {
    const orgId = await orgOfClient(c.id);
    await runAsOrg(orgId, () => syncAssistant(c)).catch((err) => console.error(`[booking ${c.id}] sync failed:`, err.message));
  }
}

async function bookingState(client: Business): Promise<BookingState> {
  const setup = client.booking;
  const provider = setup ? providerOf(client) : null;
  const { token, ...visible } = setup ?? ({} as any);
  return {
    setup: setup ? { ...visible, provider } : null,
    calendar: provider && provider !== "builtin" ? await calendarLink(client.id) : null,
    signIn: oauthAvailable(),
    emailReady: mailerReady(),
    webhookSecret: setup?.leadWebhook ? webhookSecret(token) : "",
    publicUrl: publicUrl(),
    live: bookingLive(client),
    requests: await requestsFor(client.id),
    upcoming: provider === "builtin" ? await upcomingEvents(client.id) : [],
  };
}

const MINUTES = [15, 20, 30, 45, 60, 90];
const PROVIDERS: BookingProvider[] = ["builtin", "google", "microsoft"];

async function setUpBooking(client: Business, input: any) {
  if (client.booking) throw new ValidationError("This receptionist already has a calendar. Remove it first to switch.");
  const provider: BookingProvider = PROVIDERS.includes(input?.provider) ? input.provider : "builtin";
  if (provider !== "builtin" && !oauthAvailable()[provider]) {
    throw new ValidationError(`${provider === "google" ? "Google" : "Outlook"} Calendar isn't set up on this server yet.`);
  }
  const minutes = MINUTES.includes(Number(input?.minutes)) ? Number(input.minutes) : 30;
  const next: Business = {
    ...client,
    booking: {
      provider,
      token: newToken(),
      minutes,
      enabled: true,
      notifyEmail: checkEmailAddress(input?.notifyEmail),
      leadWebhook: await checkWebhookUrl(input?.leadWebhook),
      createdAt: new Date().toISOString(),
    },
  };
  await saveClient(next);
  return syncAssistant(next);
}

async function changeBooking(client: Business, input: any) {
  if (!client.booking) throw new ValidationError("Set up a calendar first.");
  const booking = { ...client.booking, provider: providerOf(client) };
  if (typeof input?.enabled === "boolean") booking.enabled = input.enabled;
  if (input?.minutes !== undefined) {
    if (!MINUTES.includes(Number(input.minutes))) throw new ValidationError("Choose an appointment length from the list.");
    booking.minutes = Number(input.minutes);
  }
  if (input?.notifyEmail !== undefined) booking.notifyEmail = checkEmailAddress(input.notifyEmail);
  if (input?.leadWebhook !== undefined) booking.leadWebhook = await checkWebhookUrl(input.leadWebhook);
  return syncAssistant({ ...client, booking });
}

// Appointments already made stay where they are (the built-in ones are kept in
// case the calendar is set up again).
async function removeBooking(client: Business) {
  await disconnectCalendar(client.id);
  const { booking: _b, ...rest } = client;
  return syncAssistant(rest as Business);
}

// The first open day from tomorrow, in the business's time zone.
function nextOpenDate(client: Business): string {
  for (let i = 1; i <= 8; i++) {
    const d = new Date(Date.now() + i * 86400000);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: client.settings.timezone }).format(d);
    const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${date}T12:00:00Z`).getUTCDay()] as keyof Settings["hours"];
    if (client.settings.hours[day].open) return date;
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: client.settings.timezone }).format(new Date(Date.now() + 86400000));
}

// The receptionist's tools call these from Telnyx's cloud, through the tunnel.
// They are the only routes reachable without the dashboard password, and each
// needs the client's own key.
async function hook(req: Request, clientId: string, action: string): Promise<Response> {
  const client = await getClient(clientId);
  if (!client || !tokenMatches(client.booking, req.headers.get("x-twin-key"))) return json({ error: "Not found" }, 404);
  const orgId = await orgOfClient(clientId);
  if (orgId && (await isSuspended(orgId))) return json({ error: "This service is paused. Take a message instead." });
  enterOrg(orgId);
  if (!client.booking!.enabled) return json({ error: "Booking is switched off. Offer to take a message instead." });
  const text = await req.text();
  if (text.length > 8000) return json({ error: "Too large." }, 413);
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  console.log(`[hook ${client.settings.businessName}] ${action} ${JSON.stringify(Object.keys(body))}`);
  try {
    if (action === "availability") return json(await availability(client, body));
    if (action === "book") return json(await book(client, body));
    if (action === "callback") return json(await callback(client, body));
  } catch (err) {
    if (err instanceof CalendarError) {
      return json({ error: `${err.message} Use request_callback so the team can follow up.` });
    }
    throw err;
  }
  return json({ error: "Not found" }, 404);
}

function assistantFields(s: Settings, instructions: string) {
  const who = s.receptionistName || "your receptionist";
  return {
    name: `${s.businessName} · ${process.env.PRODUCT_NAME || "Twin Receptionist"}`,
    description: `Created by the ${process.env.PRODUCT_NAME || "Twin Receptionist"} setup.`,
    instructions,
    greeting: s.greeting,
    voice_settings: { voice: s.voiceId, voice_speed: 1.0 },
    widget_settings: {
      theme: "dark",
      position: "static",
      default_state: "expanded",
      start_call_text: `Talk to ${who}`,
    },
  };
}

// Also used by the self-serve business sign-up (server/routes/signup.ts). A "quick"
// create (sign-up, or "Create a business" in the Answered UI) fills what a short form
// doesn't ask: Answered's industry label becomes ours, the industry's usual hours,
// and the first recommended voice. With the fake provider key of the local tests,
// the receptionist is a demo one (no provider calls).
async function createClient(orgId: string, input: unknown, opts: { quick?: boolean } = {}): Promise<Business> {
  const voices = await voiceNames();
  const src = { ...((input ?? {}) as Record<string, unknown>) };
  if (opts.quick) {
    src.industry = industryKeyOf(src.industry);
    if (!src.hours) src.hours = defaultHours(src.industry as IndustryKey);
    if (!voices.has(String(src.voiceId ?? ""))) src.voiceId = [...voices.keys()][0];
  }
  const settings = normaliseSettings(src, voices);
  const instructions = buildInstructions(settings);
  if (fakeProvider()) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const demo: Business = { id, assistantId: `demo-${id}`, settings, instructions, createdAt: now, updatedAt: now };
    await insertClient(orgId, demo);
    return demo;
  }
  const created = await telnyx<{ id?: string; data?: { id: string } }>("POST", "/ai/assistants", {
    ...assistantFields(settings, instructions),
    model: MODEL,
    transcription: { model: "deepgram/flux", language: "en" },
    tools: [HANGUP],
    enabled_features: ["telephony"],
    // Lets the browser test call connect without a phone number.
    telephony_settings: { supports_unauthenticated_web_calls: true },
    tags: ["twin-receptionist"],
  });
  const assistantId = created.data?.id ?? created.id;
  if (!assistantId) throw new TelnyxError(502, "The phone service did not return an assistant ID.");

  const now = new Date().toISOString();
  const client: Business = {
    id: crypto.randomUUID(),
    assistantId,
    settings,
    instructions,
    createdAt: now,
    updatedAt: now,
  };
  await insertClient(orgId, client);
  // Texting is free until a number is attached, so switch it on straight away.
  // A failure here shouldn't lose the receptionist: the texts card can retry.
  await enableTexting(assistantId).catch((err) => console.error(`[texting ${client.id}]`, err.message));
  return client;
}

async function updateClient(existing: Business, input: unknown): Promise<Business> {
  const settings = normaliseSettings(input, await voiceNames());
  const instructions = await instructionsFor(existing, settings);
  // Telnyx updates an assistant with POST, not PATCH. (The demo receptionist has none.)
  if (!isDemo(existing.assistantId)) await telnyx("POST", `/ai/assistants/${existing.assistantId}`, assistantFields(settings, instructions));
  const client: Business = { ...existing, settings, instructions, updatedAt: new Date().toISOString() };
  await saveClient(client);
  return client;
}

async function callDetail(
  business: Business,
  conversationId: string,
): Promise<{ summary: string; messages: CallMessage[] }> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(conversationId)) throw new ValidationError("Unknown call.");
  if (isDemo(business.assistantId)) return demoCallDetail(conversationId);
  // Only return transcripts for calls that belong to this client's receptionist.
  const convo = await telnyx<{ data?: any }>("GET", `/ai/conversations/${conversationId}`);
  if ((convo.data?.metadata ?? {}).assistant_id !== business.assistantId) throw new ValidationError("Unknown call.");

  const [res, summary] = await Promise.all([
    telnyx<{ data?: any[] }>("GET", `/ai/conversations/${conversationId}/messages`),
    // The summary is a nice-to-have; never let it block the transcript.
    callSummary(conversationId).catch(() => ""),
  ]);
  const messages = (res.data ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && (m.text || m.content))
    .map((m) => ({ role: m.role, text: String(m.text ?? m.content), at: m.sent_at ?? m.created_at ?? "" }))
    .sort((a, b) => a.at.localeCompare(b.at));
  return { summary, messages };
}

async function numberState(ctx: Ctx, client: Business): Promise<NumberState> {
  // The demo receptionist never asks the carrier.
  if (isDemo(client.assistantId)) {
    return { numbers: [], pending: [], balance: null, canBuy: false, requests: await requestsForClient(client.id) };
  }
  const voiceApp = await voiceAppFor(client.assistantId);
  const [numbers, pending, balance] = await Promise.all([
    connectedNumbers(voiceApp),
    openOrders(client.id),
    // The balance is whoever's money pays for the numbers: an agency sees its own,
    // the platform's is only for the platform team.
    telnyxSettings(ctx).then((t) => t.balance),
  ]);
  // Remember the connected numbers so the client list can show them without asking Telnyx again.
  const current = numbers.map((n) => n.phoneNumber);
  if (JSON.stringify(current) !== JSON.stringify(client.phoneNumbers ?? [])) {
    await saveClient({ ...client, phoneNumbers: current });
  }
  return { numbers, pending, balance, canBuy: ctx.user.platformAdmin, requests: await requestsForClient(client.id) };
}

// The workspace's manage side (server/routes/manage.ts) uses the same receptionist plumbing.
setManageDeps({ updateClient, syncAssistant, setUpBooking, changeBooking, removeBooking, loadVoices, nextOpenDate });

// A redirect to a path on this server (Response.redirect needs an absolute URL).
const redirectTo = (path: string) => new Response(null, { status: 302, headers: { Location: path } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// The built dashboard (bun run build). Served from here so one address carries
// both the pages and the API, which is what a public link points at.
const DIST = join(import.meta.dir, "..", "dist");

function page(path: string): Response {
  if (!existsSync(join(DIST, "index.html"))) {
    return new Response("The dashboard hasn't been built yet. Run: bun run build", { status: 503 });
  }
  const wanted = normalize(join(DIST, path));
  // normalize() resolves any "../", so anything outside dist is refused here.
  const inside = wanted.startsWith(DIST + "/") && existsSync(wanted) && statSync(wanted).isFile();
  const hashed = inside && path.startsWith("/assets/");
  return new Response(Bun.file(inside ? wanted : join(DIST, "index.html")), {
    headers: {
      "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    },
  });
}

const withCookie = (body: unknown, cookie: string, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Set-Cookie": cookie } });

const body = (req: Request) => req.json().catch(() => ({}));

// Who may use /api/workspace/<id> and /api/manage/<id>: see ClientAccess in server/routes/http.ts.
async function clientAccessFor(ctx: Ctx, orgId: string, id: string): Promise<{ client: Business; orgId: string; access: ClientAccess } | null> {
  if (ctx.viewing?.client) {
    if (ctx.viewing.client !== id) return null;
    const client = await getOrgClient(orgId, id);
    return client ? { client, orgId, access: "viewer" } : null;
  }
  if (ctx.role === "customer") {
    const [a] = await sql`
      select a.role from client_access a join clients c on c.id = a.client_id
      where a.user_id = ${ctx.user.id} and a.client_id = ${id} and c.org_id = ${orgId}`;
    const client = a ? await getOrgClient(orgId, id) : null;
    return client ? { client, orgId, access: a.role === "manager" ? "manager" : "viewer" } : null;
  }
  const own = await getOrgClient(orgId, id);
  if (own) return { client: own, orgId, access: "staff" };
  if (ctx.user.platformAdmin) {
    const any = await getClient(id);
    const owner = any ? await orgOfClient(id) : null;
    return any && owner ? { client: any, orgId: owner, access: "platform" } : null;
  }
  return null;
}

// Everyone signs in. A person only ever sees the receptionists of the
// organisation they're working in.
async function route(req: Request, server?: { requestIP(r: Request): { address: string } | null }): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  const hookMatch = path.match(/^\/hooks\/([a-f0-9-]{36})\/(availability|book|callback)$/);
  if (hookMatch && method === "POST") return hook(req, hookMatch[1], hookMatch[2]);

  // Logos and backgrounds: public by random id.
  const brandAsset = path.match(/^\/brand\/([a-f0-9-]{36})$/);
  if (brandAsset && (method === "GET" || method === "HEAD")) return serveAsset(brandAsset[1]);

  if (!path.startsWith("/api/")) {
    if (method !== "GET" && method !== "HEAD") return json({ error: "Not found" }, 404);
    return page(path);
  }

  // A browser sends its cookie with any request, so refuse changes that come
  // from a form on some other website.
  if (method !== "GET" && method !== "HEAD") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && new URL(origin).host !== host) return json({ error: "Not allowed." }, 403);
  }

  if (path === "/api/health") return json({ ok: true });

  // ---- Signing in and out (no session needed) ----
  if (path === "/api/session" && method === "GET") {
    const ctx = await sessionFrom(req);
    if (ctx) return json({ signedIn: true, ...(await account(ctx)) });
    const { open, firstRun } = await signupOpen();
    return json({ signedIn: false, signupOpen: open, firstRun });
  }
  // Self-serve sign-up for agencies and businesses (the Answered build).
  if (path.startsWith("/api/signup/")) return (await signupRoutes(req, path, { createClient }, server)) ?? json({ error: "Not found" }, 404);
  if (path === "/api/signup" && method === "POST") return withCookie({ ok: true }, sessionCookie(req, await signUp(await body(req))), 201);
  if (path === "/api/login" && method === "POST") return withCookie({ ok: true }, sessionCookie(req, await signIn(await body(req))));
  if (path === "/api/logout" && method === "POST") {
    await signOut(await sessionFrom(req));
    return withCookie({ ok: true }, clearCookie(req));
  }
  if (path === "/api/password-reset" && method === "POST") {
    await requestReset(await body(req), appUrl(req));
    return json({ ok: true });
  }
  const resetMatch = path.match(/^\/api\/password-reset\/([A-Za-z0-9_-]{20,100})$/);
  if (resetMatch && method === "POST") {
    return withCookie({ ok: true }, sessionCookie(req, await resetPassword(resetMatch[1], await body(req))));
  }
  const inviteMatch = path.match(/^\/api\/invites\/([A-Za-z0-9_-]{20,100})$/);
  if (inviteMatch) {
    if (method === "GET") return json(await inviteInfo(inviteMatch[1]));
    if (method === "POST") return withCookie({ ok: true }, sessionCookie(req, await acceptInvite(inviteMatch[1], await body(req))));
  }

  // The business's connect page. The token in the link is the only key, so these
  // work without an account and show nothing but the connection.
  const linkMatch = path.match(/^\/api\/connect\/([A-Za-z0-9_-]{20,64})(\/email)?$/);
  if (linkMatch) {
    const [, token, email] = linkMatch;
    if (!email && method === "GET") return json(await connectInfo(token));
    if (email && method === "PUT") return json(await connectFromLink(token, await req.json()));
    if (email && method === "DELETE") return json(await disconnectFromLink(token));
    return json({ error: "Not found" }, 404);
  }

  const oauthMatch = path.match(/^\/api\/oauth\/(google|microsoft)\/(start|callback)$/);
  if (oauthMatch && method === "GET") {
    const provider = oauthMatch[1] as "google" | "microsoft";
    if (oauthMatch[2] === "start") {
      const token = url.searchParams.get("t") ?? "";
      try {
        return Response.redirect(
          await signInStart(provider, token, url.searchParams.get("mode"), url.searchParams.get("purpose")),
          302,
        );
      } catch (err) {
        return redirectTo(`/connect/${encodeURIComponent(token)}?error=${encodeURIComponent((err as Error).message)}`);
      }
    }
    return redirectTo(await signInFinish(provider, url.searchParams));
  }

  // Set by `bun run tunnel` on a developer's computer whenever the public address changes.
  if (path === "/api/public-url" && method === "POST" && isLocal(req) && !process.env.PUBLIC_URL) {
    const { url: next } = (await req.json()) as { url?: string };
    if (typeof next !== "string" || !/^https:\/\/[a-z0-9.-]+$/i.test(next)) throw new ValidationError("Not a valid https address.");
    await savePublicUrl(next);
    await syncAll();
    return json({ url: next });
  }

  // ---- Everything below needs a signed-in person ----
  const ctx = await sessionFrom(req);
  if (!ctx) return json({ error: "Please sign in." }, 401);

  // The Answered workspace: the businesses this person works with, in Answered's shapes.
  if (path === "/api/session/businesses" && method === "GET") return json(await workspaceBusinesses(ctx));

  if (path === "/api/account" && method === "PUT") {
    await updateProfile(ctx, await body(req));
    return json(await account(ctx));
  }
  if (path === "/api/orgs" && method === "POST") {
    await createOrg(ctx, await body(req));
    return json(await account((await sessionFrom(req))!), 201);
  }
  if (path === "/api/orgs/switch" && method === "POST") {
    await switchOrg(ctx, (await body(req)).orgId);
    return json(await account((await sessionFrom(req))!));
  }

  // The platform team's view of every agency. Not scoped to a team.
  if (path.startsWith("/api/admin/")) {
    if (path === "/api/admin/number-requests" && method === "GET") {
      return json({ requests: await listRequests(ctx), pending: await pendingCount() });
    }
    const nr = path.match(/^\/api\/admin\/number-requests\/([a-f0-9-]{36})\/(fulfil|decline)$/);
    if (nr && method === "POST") {
      if (nr[2] === "decline") {
        await declineRequest(ctx, nr[1], await body(req));
      } else {
        const r = await pendingRequest(ctx, nr[1]);
        const input = (await body(req)) as { phoneNumber?: string; confirm?: boolean };
        const wantMobile = r.kind === "mobile";
        if (wantMobile !== String(input.phoneNumber ?? "").startsWith("+614")) {
          throw new ValidationError(`Pick a ${wantMobile ? "mobile" : "local"} number to match the request.`);
        }
        const client = await getClient(r.client_id);
        if (!client) throw new ValidationError("That receptionist no longer exists.");
        // The test lab's demo receptionist: nothing is bought, the number is only recorded.
        if (isDemo(client.assistantId)) {
          const fake = String(input.phoneNumber);
          await markDone(r.id, fake);
          await saveClient({ ...client, phoneNumbers: [fake], updatedAt: new Date().toISOString() });
          return json({ requests: await listRequests(ctx), pending: await pendingCount() });
        }
        // Bought on our account; each agency's receptionist still lives under its own team.
        const order = await buyNumber(await voiceAppFor(client.assistantId), client.id, input);
        await markDone(r.id, order.phoneNumbers[0] ?? String(input.phoneNumber));
        if (order.status === "success") {
          const fresh = (await getClient(client.id)) ?? client;
          for (const n of order.phoneNumbers.filter((p) => p.startsWith("+614"))) {
            await connectNumberForTexts(fresh, { phoneNumber: n }).catch((err) =>
              console.error(`[texting ${client.id}] ${n}`, err.message),
            );
          }
        }
      }
      return json({ requests: await listRequests(ctx), pending: await pendingCount() });
    }
    if (path === "/api/admin/sandbox") {
      if (method === "GET") return json({ orgId: await sandboxOrgId() });
      if (method === "POST") return json({ orgId: await ensureSandbox(ctx) }, 201);
      if (method === "DELETE") {
        await resetSandbox(ctx);
        return json({ orgId: null });
      }
    }
    if (path === "/api/admin/sandbox/logins" && method === "POST") return json({ logins: await createTestLogins(ctx) }, 201);
    if (path === "/api/admin/view-as") {
      if (method === "POST") {
        const input = await body(req);
        await viewAs(ctx, input);
        await audit(ctx, "view_as.start", { orgId: input?.orgId ?? null, clientId: input?.clientId ?? null });
        return json(await account((await sessionFrom(req))!));
      }
      if (method === "DELETE") {
        await exitView(ctx);
        return json({ ok: true });
      }
    }
    if (path === "/api/admin/agencies") {
      if (method === "GET") return json({ agencies: await listAgencies(ctx) });
      if (method === "POST") return json(await createAgency(ctx, await body(req), appUrl(req)), 201);
    }
    const agency = path.match(/^\/api\/admin\/agencies\/([a-f0-9-]{36})(\/invites)?$/);
    if (agency && agency[2] && method === "POST") return json(await inviteAgencyOwner(ctx, agency[1], await body(req), appUrl(req)), 201);
    if (agency && !agency[2] && method === "PUT") {
      await updateAgency(ctx, agency[1], await body(req));
      return json({ agencies: await listAgencies(ctx) });
    }
    return json({ error: "Not found" }, 404);
  }

  // Viewing as an agency or customer is look-only.
  if (ctx.viewing && method !== "GET" && method !== "HEAD") {
    return json({ error: `You're viewing ${ctx.viewing.org} (read-only). Exit the view to make changes.` }, 403);
  }

  if (!ctx.org) return json({ error: "You're not in a team yet. Ask the platform team for an invite." }, 403);
  const orgId = ctx.org.id;
  if (!ctx.user.platformAdmin && (await isSuspended(orgId))) {
    return json({ error: "This account is paused. Contact the platform team." }, 403);
  }
  // Everything below that talks to Telnyx uses this team's own account.
  enterOrg(orgId);

  // ---- The Answered UI's route modules (server/routes/*), wired once here ----
  const area = path.match(/^\/api\/(workspace|manage|console)(\/.*)?$/);
  if (area) {
    const base: RouteArgs = { req, url, path, method, ctx, orgId, appUrl: appUrl(req) };
    if (area[1] === "console") {
      // Agency staff and the platform team only.
      if (ctx.role === "customer" && !ctx.user.platformAdmin) return json({ error: "Not allowed." }, 403);
      return (await consoleRoutes(base)) ?? json({ error: "Not found" }, 404);
    }
    let rest = area[2] ?? "";
    let client: Business | null = null;
    let clientOrgId: string | null = null;
    let access: ClientAccess | null = null;
    const one = rest.match(/^\/([a-f0-9-]{36})(\/.*)?$/);
    if (one) {
      const found = await clientAccessFor(ctx, orgId, one[1]);
      if (!found) return json({ error: "That business isn't shared with you." }, 404);
      ({ client, orgId: clientOrgId, access } = found);
      if (access === "viewer" && method !== "GET" && method !== "HEAD") {
        return json({ error: "Your access to this business is view-only. Ask a manager to change it." }, 403);
      }
      if (clientOrgId !== orgId) enterOrg(clientOrgId);
      rest = one[2] ?? "";
    }
    const handler = area[1] === "workspace" ? workspaceRoutes : manageRoutes;
    return (await handler({ ...base, client, clientOrgId, access, rest })) ?? json({ error: "Not found" }, 404);
  }

  // End customers see their own receptionist's calls and nothing else.
  if (path.startsWith("/api/portal/")) {
    // The one thing a customer may change: where a follow-up stands.
    const stage = path.match(/^\/api\/portal\/([a-f0-9-]{36})\/follow-ups\/([A-Za-z0-9_-]{1,80})$/);
    if (stage && method === "PUT") {
      const mine = await customerClientId(ctx, stage[1]);
      await setFollowUpStage(mine, stage[2], ((await body(req)) as any)?.stage);
      return json({ ok: true });
    }
    if (method !== "GET") return json({ error: "Not found" }, 404);
    if (path === "/api/portal/clients") return json({ clients: await accessibleClients(ctx) });
    const portal = path.match(/^\/api\/portal\/([a-f0-9-]{36})\/(calls|bookings|receptionist|calls\/([A-Za-z0-9-]{8,80}))$/);
    if (!portal) return json({ error: "Not found" }, 404);
    const mine = await customerClientId(ctx, portal[1]);
    const client = await getOrgClient(orgId, mine);
    if (!client) return json({ error: "Not found" }, 404);
    if (portal[2] === "calls") {
      // Test calls and the text simulator are the agency's, not the customer's.
      const calls = (await listCalls(client.assistantId, 100)).filter((c) => !c.simulated && c.channel !== "web");
      return json({ calls, receptionist: client.settings.receptionistName || "" });
    }
    if (portal[2] === "receptionist") {
      // What the business's receptionist knows. Read-only, and never the script, notes or keys.
      const s = client.settings;
      return json({
        businessName: s.businessName,
        receptionistName: s.receptionistName,
        industry: s.industry,
        suburb: s.suburb,
        timezone: s.timezone,
        hours: s.hours,
        services: s.services,
        greeting: s.greeting,
        tone: s.tone,
        voice: (s.voiceName ?? "").split(" - ")[0],
        phoneNumbers: client.phoneNumbers ?? [],
        agency: ctx.org!.name,
      });
    }
    if (portal[3]) return json(await callDetail(client, portal[3]));
    return json({ upcoming: await upcomingEvents(client.id), requests: await requestsFor(client.id) });
  }
  if (ctx.role === "customer") return json({ error: "Not allowed." }, 403);

  // Logo and background: for this team's own screens...
  const upload = async () => {
    if (Number(req.headers.get("content-length") ?? 0) > 2_000_000) throw new ValidationError("That image is too big.");
    return new Uint8Array(await req.arrayBuffer());
  };
  if (path === "/api/org/brand") {
    if (method === "GET") return json(await ownBrand({ orgId, clientId: null }));
    if (method === "PUT") {
      await changeBrand(ctx, { orgId, clientId: null }, await body(req));
      return json(await ownBrand({ orgId, clientId: null }));
    }
  }
  const orgBrandUp = path.match(/^\/api\/org\/brand\/(logo|background)$/);
  if (orgBrandUp && method === "POST") {
    await uploadAsset(ctx, { orgId, clientId: null }, orgBrandUp[1] as "logo" | "background", await upload());
    return json(await ownBrand({ orgId, clientId: null }), 201);
  }
  // ...and per business, for that business's customer dashboard.
  const clientBrand = path.match(/^\/api\/clients\/([a-f0-9-]{36})\/brand(?:\/(logo|background))?$/);
  if (clientBrand) {
    const owned = await getOrgClient(orgId, clientBrand[1]);
    if (!owned) return json({ error: "That receptionist no longer exists." }, 404);
    const scope = { orgId, clientId: owned.id };
    if (!clientBrand[2] && method === "GET") return json(await ownBrand(scope));
    if (!clientBrand[2] && method === "PUT") {
      await changeBrand(ctx, scope, await body(req));
      return json(await ownBrand(scope));
    }
    if (clientBrand[2] && method === "POST") {
      await uploadAsset(ctx, scope, clientBrand[2] as "logo" | "background", await upload());
      return json(await ownBrand(scope), 201);
    }
    return json({ error: "Not found" }, 404);
  }

  if (path === "/api/org" && method === "PUT") {
    await renameOrg(ctx, await body(req));
    return json(await account((await sessionFrom(req))!));
  }
  if (path === "/api/team" && method === "GET") return json(await team(ctx));
  if (path === "/api/team/invites" && method === "POST") return json(await invite(ctx, await body(req), appUrl(req)), 201);
  const teamInvite = path.match(/^\/api\/team\/invites\/([a-f0-9]{16})$/);
  if (teamInvite && method === "DELETE") {
    await revokeInvite(ctx, teamInvite[1]);
    return json(await team(ctx));
  }
  const teamMember = path.match(/^\/api\/team\/members\/([a-f0-9-]{36})$/);
  if (teamMember) {
    if (method === "PUT") {
      await changeRole(ctx, teamMember[1], await body(req));
      return json(await team(ctx));
    }
    if (method === "DELETE") {
      await removeMember(ctx, teamMember[1]);
      return json(await team(ctx));
    }
  }

  if (path === "/api/voices" && method === "GET") return json({ voices: await loadVoices() });

  if (path === "/api/public-url" && method === "GET") return json({ url: publicUrl() });

  if (path === "/api/numbers/available" && method === "GET") {
    // Searching shows our prices: only the platform team buys numbers.
    if (!ctx.user.platformAdmin) throw new AuthError("Request a number and we'll set it up.", 403);
    const type = url.searchParams.get("type") === "mobile" ? "mobile" : "local";
    return json({ numbers: await availableNumbers(type) });
  }

  if (path === "/api/clients") {
    if (method === "GET") return json({ clients: await listClients(orgId) });
    if (method === "POST") {
      const input = await req.json();
      const created = await createClient(orgId, input, { quick: input?.defaultVoice === true });
      await audit(ctx, "receptionist.create", { business: created.settings.businessName }, { clientId: created.id });
      return json({ client: created }, 201);
    }
  }

  const cust = path.match(/^\/api\/clients\/([a-f0-9-]{36})\/(customers(?:\/([a-f0-9-]{36}))?|customer-invites\/([a-f0-9]{16}))$/);
  if (cust) {
    const owned = await getOrgClient(orgId, cust[1]);
    if (!owned) return json({ error: "That receptionist no longer exists." }, 404);
    if (cust[2] === "customers" && method === "GET") return json(await customersFor(owned.id));
    if (cust[2] === "customers" && method === "POST") {
      const result = await inviteCustomer(ctx, owned.id, owned.settings.businessName, await body(req), appUrl(req));
      return json({ ...result, access: await customersFor(owned.id) }, 201);
    }
    if (cust[3] && method === "DELETE") {
      await removeCustomer(ctx, owned.id, cust[3]);
      return json(await customersFor(owned.id));
    }
    if (cust[4] && method === "DELETE") {
      await revokeCustomerInvite(ctx, owned.id, cust[4]);
      return json(await customersFor(owned.id));
    }
    return json({ error: "Not found" }, 404);
  }

  const match = path.match(
    /^\/api\/clients\/([a-f0-9-]{36})(\/calls(?:\/([^/]+)\/messages)?|\/numbers|\/number-requests|\/email|\/email\/check|\/texting|\/texting\/numbers|\/texting\/test|\/simulator\/texts|\/simulator\/texts\/send|\/simulator\/email|\/booking|\/booking\/test|\/booking\/events\/[a-f0-9-]{36}|\/calendar|\/calendar\/signin\/(?:google|microsoft)|\/connect-link)?$/,
  );
  if (match) {
    // Another organisation's receptionist looks exactly like one that doesn't exist.
    const client = await getOrgClient(orgId, match[1]);
    if (!client) return json({ error: "That receptionist no longer exists." }, 404);

    if (!match[2]) {
      if (method === "GET") return json({ client });
      if (method === "PUT") return json({ client: await updateClient(client, await req.json()) });
      if (method === "DELETE") {
        requireRole(ctx, "admin");
        const demo = isDemo(client.assistantId);
        const profileId = demo ? null : await textingProfileId(client.assistantId).catch(() => null);
        if (!demo) await telnyx("DELETE", `/ai/assistants/${client.assistantId}`).catch((err) => {
          // Already gone on Telnyx's side is fine; anything else should surface.
          if (!(err instanceof TelnyxError && err.status === 404)) throw err;
        });
        if (profileId) {
          await removeTextingProfile(profileId, client.assistantId).catch((err) =>
            console.error(`[texting ${client.id}] couldn't remove messaging profile`, err.message),
          );
        }
        // Its mailbox, calendar, appointments and request log go with it (foreign keys cascade).
        await removeClient(client.id);
        return json({ ok: true });
      }
    } else if (match[2] === "/email") {
      if (method === "GET") return json(await emailStatus(client.id));
      if (method === "PUT") return json(await connectEmail(client.id, await req.json()));
      if (method === "DELETE") {
        await disconnectEmail(client.id);
        return json(await emailStatus(client.id));
      }
    } else if (match[2] === "/email/check") {
      if (method === "POST") return json(await checkEmail(client));
    } else if (match[2] === "/texting") {
      if (method === "GET") return json(await textingState(client));
      if (method === "POST") {
        await enableTexting(client.assistantId);
        return json(await textingState(client));
      }
    } else if (match[2] === "/texting/numbers") {
      if (method === "POST") return json(await connectNumberForTexts((await getClient(client.id)) ?? client, await req.json()));
    } else if (match[2] === "/connect-link") {
      if (method === "POST") return json(await createConnectLink(client));
      if (method === "DELETE") {
        await revokeConnectLink(client);
        return json({ ok: true });
      }
    } else if (match[2] === "/booking") {
      if (method === "GET") return json(await bookingState(client));
      if (method === "POST") return json(await bookingState(await setUpBooking(client, await req.json())), 201);
      if (method === "PUT") return json(await bookingState(await changeBooking(client, await req.json())));
      if (method === "DELETE") return json(await bookingState(await removeBooking(client)));
    } else if (match[2].startsWith("/booking/events/")) {
      if (method === "DELETE") {
        await cancelEvent(client.id, match[2].slice("/booking/events/".length));
        return json(await bookingState(client));
      }
    } else if (match[2] === "/calendar") {
      if (method === "DELETE") {
        await disconnectCalendar(client.id);
        return json(await bookingState(client));
      }
    } else if (match[2].startsWith("/calendar/signin/")) {
      // A link the browser follows, so errors go back to the page rather than as JSON.
      if (method === "GET") {
        const provider = match[2].slice("/calendar/signin/".length) as "google" | "microsoft";
        try {
          return Response.redirect(await dashboardSignInStart(provider, orgId, client), 302);
        } catch (err) {
          return redirectTo(`/clients/${client.id}?error=${encodeURIComponent((err as Error).message)}`);
        }
      }
    } else if (match[2] === "/booking/test") {
      if (method === "POST") {
        if (!client.booking) throw new ValidationError("Set up a calendar first.");
        const date = nextOpenDate(client);
        try {
          return json({ date, result: await availability(client, { date }) });
        } catch (err) {
          if (err instanceof CalendarError) throw new ValidationError(err.message);
          throw err;
        }
      }
    } else if (match[2] === "/simulator/texts") {
      if (method === "POST") return json(await startTextSim(client));
    } else if (match[2] === "/simulator/texts/send") {
      if (method === "POST") return json(await sendSimText(client, await req.json()));
    } else if (match[2] === "/simulator/email") {
      if (method === "POST") return json(await previewEmail(client, await req.json()));
    } else if (match[2] === "/texting/test") {
      if (method === "POST") return json(await sendTestText(client, await req.json()));
    } else if (match[2] === "/number-requests") {
      if (method === "POST") {
        await createRequest(ctx, client.id, client.settings.businessName, await body(req), appUrl(req));
        // Doesn't ask the carrier: the request is saved either way.
        return json({ requests: await requestsForClient(client.id) }, 201);
      }
    } else if (match[2] === "/numbers") {
      if (method === "GET") return json(await numberState(ctx, client));
      if (method === "POST") {
        // Numbers cost us money every month: agencies ask (number-requests), the platform team buys.
        if (!ctx.user.platformAdmin) throw new AuthError("Request a number and we'll set it up.", 403);
        const order = await buyNumber(await voiceAppFor(client.assistantId), client.id, await req.json());
        const state = await numberState(ctx, client);
        // A mobile that's live straight away also takes texts. Others can be added from the texts card.
        if (order.status === "success") {
          const fresh = (await getClient(client.id)) ?? client;
          for (const n of order.phoneNumbers.filter((p) => p.startsWith("+614"))) {
            await connectNumberForTexts(fresh, { phoneNumber: n }).catch((err) =>
              console.error(`[texting ${client.id}] ${n}`, err.message),
            );
          }
        }
        return json({ order, ...state }, 201);
      }
    } else if (method === "GET") {
      if (match[3]) return json(await callDetail(client, match[3]));
      return json({ calls: await listCalls(client.assistantId) });
    }
  }

  return json({ error: "Not found" }, 404);
}

await migrate();
await loadPublicUrl();
// The receptionists' booking tools call PUBLIC_URL. If it changed since the last
// start (e.g. moving to the real domain), point Telnyx at the new address.
if (process.env.PUBLIC_URL) syncAll().catch((err) => console.error("[startup sync]", err.message));

const HOST = process.env.HOST ?? "127.0.0.1";

Bun.serve({
  port: PORT,
  // 127.0.0.1 on a laptop; 0.0.0.0 inside a container behind a load balancer.
  hostname: HOST,
  // Keep error pages plain: the default development page shows source code and stack traces.
  development: false,
  error() {
    return json({ error: "Something went wrong on the server." }, 500);
  },
  // Bun drops a request after 10 quiet seconds by default. Checking a mailbox and
  // writing several replies takes longer than that.
  idleTimeout: 240,
  async fetch(req, server) {
    try {
      return await route(req, server);
    } catch (err) {
      if (err instanceof ValidationError) return json({ error: err.message }, 400);
      if (err instanceof AuthError) return json({ error: err.message }, err.status);
      if (err instanceof TelnyxError) {
        console.error(`[telnyx ${err.status}] ${err.message}`);
        return json({ error: err.message }, err.status >= 500 ? 502 : 400);
      }
      if (err instanceof CalendarError) return json({ error: err.message }, 502);
      if (err instanceof SyntaxError) return json({ error: "Invalid request body." }, 400);
      console.error(err);
      return json({ error: "Something went wrong on the server." }, 500);
    }
  },
});

// Keep call_log filled from the phone provider (server/callsync.ts).
startCallSync();

// Check every connected mailbox once a minute. One at a time, so a slow mail
// server can't pile up connections.
let checking = false;
setInterval(async () => {
  if (checking) return;
  checking = true;
  try {
    for (const id of await connectedClientIds()) {
      const client = await getClient(id);
      if (!client) continue;
      const orgId = await orgOfClient(id);
      if (orgId && (await isSuspended(orgId))) continue;
      await runAsOrg(orgId, () => checkEmail(client)).catch((err) => console.error(`[email ${id}]`, err));
    }
  } finally {
    checking = false;
  }
}, 60_000);

console.log(`Twin Receptionist on http://${HOST}:${PORT} (Telnyx key ${hasKey() ? "loaded" : "MISSING"})`);
