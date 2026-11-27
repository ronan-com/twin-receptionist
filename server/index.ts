import { countryForTimezone, defaultHours, typeOfNumber, type Business, type IndustryKey, type NumberState, type Settings, type Voice } from "../src/lib/shared";
import { existsSync, readFileSync, statSync } from "node:fs";
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
  memberResetLink,
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
  singleAgency,
  switchOrg,
  team,
  updateProfile,
  type Ctx,
} from "./accounts";
import { isLocal } from "./auth";
import { migrate, sql } from "./db";
import { checkEmail, connectEmail, connectedClientIds, disconnectEmail, emailStatus } from "./email";
import { SAMPLE_OWNED, attachNumber, detachNumber, ownedUnassigned, sampleOwned } from "./ownNumbers";
import { checkBuyable, sampleNumbers, searchFor } from "./numbers";
import { ValidationError, buildInstructions, greetingOf, knowledgeFor, normaliseSettings } from "./prompt";
import { clientsWithBooking, getClient, getOrgClient, insertClient, listClients, orgOfClient, removeClient, saveClient } from "./store";
import { TelnyxError, enterOrg, hasKey, runAsOrg, telnyx } from "./telnyx";
import { createTestLogins, ensureSandbox, fakeProvider, isDemo, resetSandbox, sandboxOrgId } from "./sandbox";
import { callDetail, listCalls } from "./calls";
import { startCallSync } from "./callsync";
import { industryKeyOf, workspaceBusinesses } from "./answered";
import { audit } from "./audit";
import { deleteAgency, deleteOwnAccount, previewAgencyDelete } from "./deletion";
import { supportSeller } from "./supportAccess";
import { readOnlyView, supportGate } from "./supportChanges";
import { startSupportSync, supportPublicRoutes, supportSettingsRoute } from "./supportSync";
import { startTicketSync, ticketRoutes } from "./tickets";
import { startAutoUpdate, updatesRoute } from "./autoUpdate";
import { installLogCapture } from "./problems";
import { OTHER_BRAND, UI_PRODUCT, brandedIndex } from "./product";
import { agencySnapshot, consoleRoutes, isClientPaused } from "./routes/console";
import { assistantRoute } from "./assistant";
import { webchatAdmin, webchatPublic } from "./webchat";
import { manageRoutes, setManageDeps } from "./routes/manage";
import { signupRoutes } from "./routes/signup";
import { automationHooks, automationRoutes } from "./routes/automations";
import { applyAutomations, bookingBlocked, startAutomations, withAutomations } from "./automations";
import { workspaceRoutes } from "./routes/workspace";
import type { ClientAccess, RouteArgs } from "./routes/http";
import { changeBrand, ownBrand, serveAsset, uploadAsset } from "./brand";
import { accessibleClients, customerClientId, setFollowUpStage, customersFor, inviteCustomer, removeCustomer, revokeCustomerInvite } from "./customers";
import { createRequest, declineRequest, listRequests, markDone, pendingCount, pendingRequest, requestsForClient, settleRequests } from "./numberRequests";
import { createAgency, exitView, inviteAgencyOwner, viewAs, isSuspended, listAgencies, telnyxSettings, updateAgency } from "./agencies";
import { canBuyNumbers, canUseOwnNumbers, canUseTwilio, checkKey, checkVapiKeys, connectPhoneAccount, connectTwilio, countCheck, disconnectPhoneAccount, disconnectTwilio, phoneAccount, pretendAccount, requirePhoneAccount, testTwilio, twilioAccount } from "./phoneAccount";
import { availableTwilioNumbers, isTestTwilio, requireTwilio, twilioNumbersFor, twilioRegulatory } from "./twilio";
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
  callback,
  loadPublicUrl,
  newToken,
  publicUrl,
  requestsFor,
  savePublicUrl,
  tokenMatches,
} from "./booking";
import { CalendarError, calendarLink, cancelEvent, disconnectCalendar, providerOf, upcomingEvents } from "./calendars";
import { mailerReady, startOutbox } from "./mailer";
import { checkEmailAddress, checkWebhookUrl, webhookSecret } from "./notify";
import { oauthAvailable } from "./oauth";
import { refresh as loadPlatformSettings } from "./platformSettings";
import { platformSettingsRoutes } from "./platformSettingsApi";
import { emailSettingsRoutes } from "./emailSettings";
import type { BookingProvider, BookingState } from "../src/lib/shared";
import { connectNumberForTexts, enableTexting, sendTestText, textingState } from "./texting";
import { BOOKING_TOOL_DEFS } from "./booking";
import { VapiError, installProvider, providerOfClient } from "./voice/config";
import { voiceFor, voiceForOrg } from "./voice";
import type { VoiceProvider } from "./voice/provider";
import { toolAllowed } from "./voice/tools";
import { startVapiHours } from "./voice/vapiHours";
import { vapiEvents, vapiToolHook } from "./voice/vapiWebhook";

// The last 200 log lines (scrubbed) and a problem list for the support heartbeat (server/problems.ts).
installLogCapture();

const PORT = Number(process.env.API_PORT ?? 8791);
// The voices on offer: the agency's voice engine's list (Telnyx's Australian voices, or Vapi's).
async function loadVoices(): Promise<Voice[]> {
  return (await voiceForOrg()).voices();
}

async function voiceNames(provider: VoiceProvider): Promise<Map<string, string>> {
  return new Map((await provider.voices()).map((v) => [v.id, v.name]));
}

// The script, with the business's published knowledge items (server/routes/manage.ts).
async function instructionsFor(client: Business, settings = client.settings): Promise<string> {
  return buildInstructions(settings, bookingLive(client) ? { minutes: client.booking!.minutes } : null, await knowledgeFor(client.id));
}

// Pushes the script and tools that match the client's booking setup to the voice engine.
// A demo receptionist has no assistant: its script is only saved.
async function syncAssistant(client: Business): Promise<Business> {
  if (isDemo(client.assistantId)) {
    const next = { ...client, instructions: await instructionsFor(client), updatedAt: new Date().toISOString() };
    await saveClient(next);
    return next;
  }
  const instructions = await instructionsFor(client);
  // Paused by the business: only the take-a-message tool stays (server/prompt.ts).
  const allowed = BOOKING_TOOL_DEFS.map((d) => d.name).filter((n) => toolAllowed(client.settings, n));
  await voiceFor(client).syncAssistant(client, instructions, allowed);
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

const nearestMinutes = (n: number) => MINUTES.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));

async function setUpBooking(client: Business, input: any) {
  if (client.booking) throw new ValidationError("This receptionist already has a calendar. Remove it first to switch.");
  const provider: BookingProvider = PROVIDERS.includes(input?.provider) ? input.provider : "builtin";
  if (provider !== "builtin" && !oauthAvailable()[provider]) {
    throw new ValidationError(`${provider === "google" ? "Google" : "Outlook"} Calendar isn't set up on this server yet.`);
  }
  // An explicit length wins; otherwise the profile's default appointment length (snapped to
  // the lengths the calendar offers), otherwise 30.
  const fromProfile = client.settings.profile?.appointmentMinutes;
  const minutes = MINUTES.includes(Number(input?.minutes)) ? Number(input.minutes) : fromProfile ? nearestMinutes(fromProfile) : 30;
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
  // One business paused from the console (clients.paused_at).
  if (await isClientPaused(clientId)) return json({ error: "This service is paused. Take a message instead." });
  enterOrg(orgId);
  if (client.settings.paused && action !== "callback") return json({ error: "The receptionist is paused, so nothing can be booked. Take a message with request_callback instead." });
  if (!client.booking!.enabled) return json({ error: "Booking is switched off. Offer to take a message instead." });
  const mode = client.settings.profile?.bookingMode;
  if (action === "book" && (mode === "request" || mode === "message_only")) return json({ error: "Bookings aren't made directly. Use request_callback so the team can confirm." });
  if (action === "availability" && mode === "message_only") return json({ error: "Bookings aren't offered. Take a message with request_callback instead." });
  const closed = action === "callback" ? null : await bookingBlocked(client);
  if (closed) return json({ error: closed });
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

// Also used by the self-serve business sign-up (server/routes/signup.ts). A "quick"
// create (sign-up, or "Create a business" in the Answered UI) fills what a short form
// doesn't ask: Answered's industry label becomes ours, the industry's usual hours,
// and the first recommended voice. With the fake provider key of the local tests,
// the receptionist is a demo one (no provider calls).
async function createClient(orgId: string, input: unknown, opts: { quick?: boolean } = {}): Promise<Business> {
  // An agency that must bring its own phone account connects it first (Setup).
  await requirePhoneAccount(orgId);
  const provider = await voiceForOrg(orgId);
  const voices = await voiceNames(provider);
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
  const id = crypto.randomUUID();
  const assistantId = await provider.createAssistant(settings, instructions, id);

  const now = new Date().toISOString();
  const client: Business = {
    id,
    assistantId,
    settings,
    instructions,
    ...(provider.id === "vapi" ? { voiceProvider: "vapi" as const } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await insertClient(orgId, client);
  return client;
}

async function updateClient(existing: Business, input: unknown): Promise<Business> {
  const settings = normaliseSettings(input, await voiceNames(voiceFor(existing)), existing.settings);
  const instructions = await instructionsFor(existing, settings);
  // (The demo receptionist has no assistant.)
  if (!isDemo(existing.assistantId)) await voiceFor(existing).updateAssistant(existing, settings, instructions);
  const client: Business = { ...existing, settings, instructions, updatedAt: new Date().toISOString() };
  await saveClient(client);
  return client;
}

async function numberState(ctx: Ctx, client: Business): Promise<NumberState> {
  // The demo receptionist never asks the carrier.
  if (isDemo(client.assistantId)) {
    const recorded = (client.phoneNumbers ?? []).map((n) => ({ id: n, phoneNumber: n, status: "active", type: typeOfNumber(n) }));
    return { numbers: recorded, pending: [], balance: null, canBuy: await canBuyNumbers(ctx), canUseOwn: await canUseOwnNumbers(ctx), requests: await requestsForClient(client.id) };
  }
  const engine = voiceFor(client);
  const { numbers, pending, balance } = await engine.numbers.state(ctx, client);
  // Remember the connected numbers so the client list can show them without asking Telnyx again.
  const current = numbers.map((n) => n.phoneNumber);
  if (JSON.stringify(current) !== JSON.stringify(client.phoneNumbers ?? [])) {
    await saveClient({ ...client, phoneNumbers: current });
  }
  return { provider: engine.id, support: engine.numbers.support(), numbers, pending, balance, canBuy: await canBuyNumbers(ctx), canUseOwn: engine.id === "telnyx" && (await canUseOwnNumbers(ctx)), requests: await requestsForClient(client.id) };
}

// Numbers on the agency's own Telnyx account that none of its receptionists answers.
async function ownedNumbers(ctx: Ctx, orgId: string) {
  if (!(await canUseOwnNumbers(ctx))) throw new AuthError("Only an owner or admin of an agency on its own Telnyx account can use numbers it already owns.", 403);
  if (await pretendAccount(orgId)) return sampleOwned(await listClients(orgId));
  return ownedUnassigned(await listClients(orgId));
}

// Numbers on the agency's connected Twilio account, with the receptionist that answers each, and
// where Australian numbers stand with Twilio's regulatory bundle (the "waiting for approval" part).
async function twilioNumbers(ctx: Ctx, orgId: string) {
  if (!(await canUseTwilio(ctx))) throw new AuthError("Only an owner or admin of an agency with a Twilio account connected can use its numbers. Connect Twilio under Connections.", 403);
  const creds = await requireTwilio(orgId);
  const taken = new Map<string, string>();
  for (const c of await listClients(orgId)) {
    for (const n of c.phoneNumbers ?? []) taken.set(n, c.settings.receptionistName || c.settings.businessName || "another receptionist");
  }
  const [numbers, reg] = await Promise.all([twilioNumbersFor(creds, taken), twilioRegulatory(creds, "AU")]);
  return { numbers, regulatory: { approved: reg.approved, inReview: reg.inReview, consoleUrl: reg.consoleUrl }, test: isTestTwilio(creds) };
}

// Connects or releases a number the agency already owns, then refreshes the receptionist's
// script and tools (the transfer and greeting lines mention its number).
async function changeOwnNumber(ctx: Ctx, orgId: string, client: Business, action: "attach" | "detach", input: any) {
  if (!(await canUseOwnNumbers(ctx))) throw new AuthError("Only an owner or admin of an agency on its own Telnyx account can use numbers it already owns.", 403);
  requireRole(ctx, "admin");
  if (providerOfClient(client) !== "telnyx") throw new ValidationError("This receptionist runs on Vapi. Bring a Twilio number under Call handling instead.");
  let movedFrom = "";
  if (isDemo(client.assistantId)) {
    // A demo receptionist (local test servers): the number is only recorded.
    const sample = SAMPLE_OWNED.find((n) => n.id === String(input?.numberId));
    const number = sample?.phoneNumber ?? client.phoneNumbers?.find((n) => n === String(input?.numberId));
    if (!number) throw new ValidationError("Choose one of your numbers from the list.");
    const numbers = action === "attach" ? [...new Set([...(client.phoneNumbers ?? []), number])] : (client.phoneNumbers ?? []).filter((n) => n !== number);
    await saveClient({ ...client, phoneNumbers: numbers, updatedAt: new Date().toISOString() });
    await audit(ctx, `number.${action}`, { number, demo: true }, { clientId: client.id });
  } else if (action === "attach") {
    const res = await attachNumber(await listClients(orgId), client, input);
    movedFrom = res.movedFrom;
    await audit(ctx, "number.attach", { number: res.number.phoneNumber, movedFrom }, { clientId: client.id });
  } else {
    const num = await detachNumber(client, input);
    await audit(ctx, "number.detach", { number: num.phoneNumber }, { clientId: client.id });
  }
  const state = await numberState(ctx, client);
  const fresh = (await getClient(client.id)) ?? client;
  const automationsError = await applyAutomations(fresh, { syncAssistant });
  return { ...state, movedFrom, ...(automationsError ? { automationsError } : {}) };
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

let ownIndex: { at: number; html: string } | null = null;

// Team demo: many agencies share one copy, so each sees its own name where the product's would be.
async function demoPage(path: string, req: Request): Promise<Response> {
  if (path.includes(".")) return page(path);
  const invited = path.match(/^\/invite\/([A-Za-z0-9_-]+)$/);
  let name = "";
  if (invited) name = (await inviteInfo(invited[1]).catch(() => null))?.orgName ?? "";
  else {
    const ctx = await sessionFrom(req).catch(() => null);
    if (ctx?.org && !ctx.user.platformAdmin) name = ctx.org.name;
  }
  if (!name) name = decodeURIComponent((req.headers.get("cookie") ?? "").match(/demo_brand=([^;]+)/)?.[1] ?? "");
  if (!name || !existsSync(join(DIST, "index.html"))) return page(path);
  return new Response(brandedIndex(readFileSync(join(DIST, "index.html"), "utf8"), name), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "same-origin", "Set-Cookie": `demo_brand=${encodeURIComponent(name)}; Path=/; SameSite=Lax; Max-Age=2592000` },
  });
}

function page(path: string): Response {
  if (!existsSync(join(DIST, "index.html"))) {
    return new Response("The dashboard hasn't been built yet. Run: bun run build", { status: 503 });
  }
  const wanted = normalize(join(DIST, path));
  // normalize() resolves any "../", so anything outside dist is refused here.
  const inside = wanted.startsWith(DIST + "/") && existsSync(wanted) && statSync(wanted).isFile();
  const hashed = inside && path.startsWith("/assets/");
  const index = join(DIST, "index.html");
  const file = inside ? wanted : index;
  // A copy sold under another name gets that name written into the page.
  if (file === index && OTHER_BRAND) {
    const at = statSync(index).mtimeMs;
    if (ownIndex?.at !== at) ownIndex = { at, html: brandedIndex(readFileSync(index, "utf8")) };
    return new Response(ownIndex.html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" },
    });
  }
  return new Response(Bun.file(file), {
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
  // Vapi: its tool calls (the same hook behind an envelope) and its end-of-call reports.
  const vapiTool = path.match(/^\/hooks\/([a-f0-9-]{36})\/vapi\/(availability|book|callback)$/);
  if (vapiTool && method === "POST") return vapiToolHook(req, vapiTool[1], vapiTool[2], hook);
  const vapiEvent = path.match(/^\/hooks\/vapi\/([a-f0-9-]{36})$/);
  if (vapiEvent && method === "POST") return vapiEvents(req, vapiEvent[1]);
  if (path.startsWith("/hooks/automations/")) return (await automationHooks(req, path)) ?? json({ error: "Not found" }, 404);
  // The website chat widget's public API (CORS-limited to the business's own websites).
  if (path.startsWith("/api/webchat/")) return (await webchatPublic(req, path, undefined, server)) ?? json({ error: "Not found" }, 404);

  // Logos and backgrounds: public by random id.
  const brandAsset = path.match(/^\/brand\/([a-f0-9-]{36})$/);
  if (brandAsset && (method === "GET" || method === "HEAD")) return serveAsset(brandAsset[1]);

  if (!path.startsWith("/api/")) {
    if (method !== "GET" && method !== "HEAD") return json({ error: "Not found" }, 404);
    return process.env.DEMO_ROUTES === "1" ? await demoPage(path, req) : page(path);
  }

  // A browser sends its cookie with any request, so refuse changes that come
  // from a form on some other website.
  if (method !== "GET" && method !== "HEAD") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && new URL(origin).host !== host) return json({ error: "Not allowed." }, 403);
  }

  if (path === "/api/health") return json({ ok: true });

  // The setup provider's side of the heartbeat and Support access: a shared token, or a one-time link (server/supportSync.ts).
  if (path.startsWith("/api/support/") && path !== "/api/support/settings") return (await supportPublicRoutes(req, path, method)) ?? json({ error: "Not found" }, 404);

  // ---- Signing in and out (no session needed) ----
  if (path === "/api/session" && method === "GET") {
    const ctx = await sessionFrom(req);
    if (ctx) return json({ signedIn: true, ...(await account(ctx)) });
    const { open, firstRun } = await signupOpen();
    return json({ signedIn: false, signupOpen: open, firstRun, singleAgency: singleAgency() });
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
    return json({ ok: true, ...(await requestReset(await body(req), appUrl(req))) });
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

  // A support sign-in (the setup provider's person, with the owner's permission) looks, and (unless the owner
  // switched "Support can make changes" off) can fix things, but never keys, billing, the owner or exports
  // (server/supportChanges.ts). Every change is written to the owner's audit log.
  const gate = supportGate(ctx, method, path, supportSeller());
  if (gate.action === "deny") return json({ error: gate.error }, 403);
  if (gate.action === "audit") await audit(ctx, "support.change", { summary: gate.summary });
  // Settings, "Support": the owner's switches for sharing stats and Support access.
  if (path === "/api/support/settings") return supportSettingsRoute(req, method, ctx);
  // The help menu's "Contact support": requests to the setup provider, or from a business to its agency (server/tickets.ts).
  if (path === "/api/tickets" || path.startsWith("/api/tickets/")) return (await ticketRoutes({ req, url, path, method, ctx, orgId: ctx.org?.id ?? "", appUrl: appUrl(req) })) ?? json({ error: "Not found" }, 404);
  // Settings, "Updates": the owner's automatic-updates switch (server/autoUpdate.ts).
  if (path === "/api/updates/settings" || path === "/api/updates/check") return updatesRoute(req, method, path, ctx);

  // The Answered workspace: the businesses this person works with, in Answered's shapes.
  if (path === "/api/session/businesses" && method === "GET") return json(await workspaceBusinesses(ctx));

  // A person deleting their own account (Settings, Account): they're signed out as it goes.
  if (path === "/api/account" && method === "DELETE") {
    await deleteOwnAccount(ctx, await body(req));
    return withCookie({ ok: true }, clearCookie(req));
  }
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
    // Email sender and Google/Microsoft apps (Settings, "Email and calendars").
    // Settings, "Email": main and backup sender, test email, recent emails.
    if (path.startsWith("/api/admin/email-settings")) return (await emailSettingsRoutes(req, path, method, ctx)) ?? json({ error: "Not found" }, 404);
    if (path.startsWith("/api/admin/platform-settings")) return (await platformSettingsRoutes(req, path, method, ctx)) ?? json({ error: "Not found" }, 404);
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
        const client = await getClient(r.client_id);
        if (!client) throw new ValidationError("That receptionist no longer exists.");
        // The number is bought in the receptionist's country (from its time zone).
        const country = countryForTimezone(client.settings.timezone);
        const picked = String(input.phoneNumber ?? "");
        if (checkBuyable(picked) !== country) {
          throw new ValidationError(`Pick ${country === "US" ? "a US" : "an Australian"} number: this receptionist is in ${country === "US" ? "the US" : "Australia"}.`);
        }
        // Australia: a mobile for a mobile request, a landline for a local one. In the
        // US there are no mobiles to buy, so any US number answers either.
        const wantMobile = r.kind === "mobile";
        if (country === "AU" && wantMobile !== picked.startsWith("+614")) {
          throw new ValidationError(`Pick a ${wantMobile ? "mobile" : "local"} number to match the request.`);
        }
        // The test lab's demo receptionist: nothing is bought, the number is only recorded.
        if (isDemo(client.assistantId)) {
          const fake = String(input.phoneNumber);
          await markDone(r.id, fake);
          await saveClient({ ...client, phoneNumbers: [fake], updatedAt: new Date().toISOString() });
          return json({ requests: await listRequests(ctx), pending: await pendingCount() });
        }
        // Bought on our account; each agency's receptionist still lives under its own team.
        const order = await voiceFor(client).numbers.buy(client, input);
        await markDone(r.id, order.phoneNumbers[0] ?? String(input.phoneNumber));
        if (order.status === "success" && voiceFor(client).id === "telnyx") {
          const fresh = (await getClient(client.id)) ?? client;
          // Australian mobiles only: US numbers need 10DLC registration in Telnyx before they can text.
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
    // Team demo: make the agency with the logo and colour typed into the setup wizard.
    if (path === "/api/admin/demo-agency" && method === "POST" && process.env.DEMO_ROUTES === "1") {
      const input = await body(req);
      const made = await createAgency(ctx, input, appUrl(req));
      const [o] = await sql`select id from orgs where created_by = ${ctx.user.id} and name = ${String(input.name ?? "").trim()} order by created_at desc limit 1`;
      if (o) {
        const asOwner = { ...ctx, org: { ...ctx.org!, id: o.id }, role: "owner" as const };
        const scope = { orgId: o.id as string, clientId: null };
        const logo = String(input.logo ?? "").split(",")[1];
        if (logo) await uploadAsset(asOwner, scope, "logo", new Uint8Array(Buffer.from(logo, "base64"))).catch((e) => console.error("[demo logo]", e.message));
        if (input.colour) await changeBrand(asOwner, scope, { primaryColor: input.colour, accentColor: input.colour }).catch((e) => console.error("[demo colour]", e.message));
      }
      return json(made, 201);
    }
    const agencyDelete = path.match(/^\/api\/admin\/agencies\/([a-f0-9-]{36})(\/delete-preview)?$/);
    if (agencyDelete && agencyDelete[2] && method === "GET") return json(await previewAgencyDelete(ctx, agencyDelete[1]));
    if (agencyDelete && !agencyDelete[2] && method === "DELETE") {
      const done = await deleteAgency(ctx, agencyDelete[1], await body(req));
      return json({ ...done, agencies: await listAgencies(ctx) });
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
  if (readOnlyView(ctx) && method !== "GET" && method !== "HEAD") {
    return json({ error: `You're viewing ${ctx.viewing!.org} (read-only). Exit the view to make changes.` }, 403);
  }

  if (!ctx.org) return json({ error: "You're not in a team yet. Ask the platform team for an invite." }, 403);
  const orgId = ctx.org.id;
  if (!ctx.user.platformAdmin && (await isSuspended(orgId))) {
    return json({ error: "This account is paused. Contact the platform team." }, 403);
  }
  // Everything below that talks to Telnyx uses this team's own account.
  enterOrg(orgId);

  // The agency's Twilio account (Connections, optional): checked with Twilio before it's saved.
  if (path === "/api/twilio-account" || path === "/api/twilio-account/test") {
    if (ctx.role === "customer" && !ctx.user.platformAdmin) return json({ error: "Not allowed." }, 403);
    if (path.endsWith("/test")) {
      if (method !== "POST") return json({ error: "Not found" }, 404);
      return json(await testTwilio(ctx, await body(req)));
    }
    if (method === "GET") return json(await twilioAccount(ctx));
    if (method === "PUT") return json(await connectTwilio(ctx, await body(req)));
    if (method === "DELETE") return json(await disconnectTwilio(ctx));
    return json({ error: "Not found" }, 404);
  }

  // The agency's own phone account (Setup and Connections): its Telnyx key, checked
  // against Telnyx before it's saved. Not for business users.
  if (path === "/api/phone-account" || path === "/api/phone-account/test") {
    if (ctx.role === "customer" && !ctx.user.platformAdmin) return json({ error: "Not allowed." }, 403);
    if (path.endsWith("/test")) {
      if (method !== "POST") return json({ error: "Not found" }, 404);
      requireRole(ctx, "admin");
      countCheck(orgId);
      const input = await body(req);
      if (input?.provider === "vapi") {
        await checkVapiKeys(input.key, input.publicKey);
        return json({ ok: true, balance: null });
      }
      const checked = await checkKey(input.key);
      return json({ ok: true, balance: checked.balance });
    }
    if (method === "GET") return json(await phoneAccount(ctx));
    if (method === "PUT") return json(await connectPhoneAccount(ctx, await body(req)));
    if (method === "DELETE") return json(await disconnectPhoneAccount(ctx));
    return json({ error: "Not found" }, 404);
  }

  // The agency help assistant (AI answers about the dashboard, streamed from OpenRouter).
  if (path === "/api/assistant") {
    return assistantRoute(req, ctx, {
      product: UI_PRODUCT,
      snapshot: async () => {
        const phone = (await account(ctx)).telnyx;
        return agencySnapshot(ctx, phone, singleAgency());
      },
    });
  }

  // ---- The Answered UI's route modules (server/routes/*), wired once here ----
  if (path.startsWith("/api/automations/")) return (await automationRoutes({ req, url, path, method, ctx, orgId, appUrl: appUrl(req) }, { clientAccessFor, syncAssistant })) ?? json({ error: "Not found" }, 404);
  if (path.startsWith("/api/website-chat/")) return (await webchatAdmin({ req, url, path, method, ctx, orgId, appUrl: appUrl(req) }, { clientAccessFor, publicUrl })) ?? json({ error: "Not found" }, 404);
  const area = path.match(/^\/api\/(workspace|manage|console)(\/.*)?$/);
  if (area) {
    const base: RouteArgs = { req, url, path, method, ctx, orgId, appUrl: appUrl(req) };
    if (area[1] === "console") {
      // Agency staff and the platform team only.
      if (ctx.role === "customer" && !ctx.user.platformAdmin) return json({ error: "Not allowed." }, 403);
      return (await consoleRoutes(base, { createClient })) ?? json({ error: "Not found" }, 404);
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
      // Paused from the console: the business can look but not change anything.
      if (access === "manager" && method !== "GET" && method !== "HEAD" && (await isClientPaused(client!.id))) {
        return json({ error: "This business is paused. Contact your agency to resume it." }, 403);
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
      const calls = (await listCalls(client, 100)).filter((c) => !c.simulated && c.channel !== "web");
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
  const teamReset = path.match(/^\/api\/team\/members\/([a-f0-9-]{36})\/reset-link$/);
  if (teamReset && method === "POST") return json(await memberResetLink(ctx, teamReset[1], appUrl(req)));
  const teamMember = path.match(/^\/api\/team\/members\/([a-f0-9-]{36})$/);
  if (teamMember) {
    if (method === "PUT") {
      await changeRole(ctx, teamMember[1], await body(req));
      return json(await team(ctx));
    }
    if (method === "DELETE") {
      const { userDeleted } = await removeMember(ctx, teamMember[1], await body(req));
      return json({ ...(await team(ctx)), userDeleted });
    }
  }

  if (path === "/api/voices" && method === "GET") return json({ voices: await loadVoices() });

  // What the browser test call needs: Telnyx's agent id, or Vapi's public key and assistant id.
  const webCall = path.match(/^\/api\/clients\/([a-f0-9-]{36})\/web-call$/);
  if (webCall && method === "GET") {
    const found = await clientAccessFor(ctx, orgId, webCall[1]);
    if (!found) return json({ error: "That business isn't shared with you." }, 404);
    if (found.orgId !== orgId) enterOrg(found.orgId);
    return json(await voiceFor(found.client).webCall(found.client.assistantId));
  }

  if (path === "/api/public-url" && method === "GET") return json({ url: publicUrl() });

  if (path === "/api/numbers/available" && method === "GET") {
    // Searching shows prices: the platform team, or an agency paying from its own phone account.
    if (!(await canBuyNumbers(ctx))) throw new AuthError("Request a number and we'll set it up.", 403);
    // ?country=AU (the default) or US; ?type= one that country has (AU: mobile, local; US: local, toll_free).
    const { country, type } = searchFor(url.searchParams.get("country"), url.searchParams.get("type"));
    // Local test servers with a pretend phone account: sample numbers, nothing asked of Telnyx.
    if (await pretendAccount(orgId)) return json({ numbers: sampleNumbers(type, country) });
    return json({ numbers: await (await voiceForOrg(orgId)).numbers.search(type, country) });
  }

  // Numbers the agency already owns on its Telnyx account (not answering for any receptionist yet).
  if (path === "/api/numbers/owned" && method === "GET") return json({ numbers: await ownedNumbers(ctx, orgId) });

  // Twilio: the agency's connected account (optional). Its numbers, and numbers it can buy there.
  if (path === "/api/numbers/twilio" && method === "GET") return json(await twilioNumbers(ctx, orgId));
  if (path === "/api/numbers/twilio/available" && method === "GET") {
    if (!(await canUseTwilio(ctx))) throw new AuthError("Connect your Twilio account under Connections first.", 403);
    const { country, type } = searchFor(url.searchParams.get("country"), url.searchParams.get("type"));
    return json({ numbers: await availableTwilioNumbers(await requireTwilio(orgId), type, country) });
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
    /^\/api\/clients\/([a-f0-9-]{36})(\/calls(?:\/([^/]+)\/messages)?|\/numbers|\/numbers\/(?:owned|attach|detach)|\/number-requests|\/email|\/email\/check|\/texting|\/texting\/numbers|\/texting\/test|\/simulator\/texts|\/simulator\/texts\/send|\/simulator\/email|\/booking|\/booking\/test|\/booking\/events\/[a-f0-9-]{36}|\/calendar|\/calendar\/signin\/(?:google|microsoft)|\/connect-link)?$/,
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
        if (!isDemo(client.assistantId)) await voiceFor(client).deleteAssistant(client);
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
      // Texting is a Telnyx feature: a Vapi receptionist has none.
      if (providerOfClient(client) === "vapi") {
        if (method === "GET") return json({ enabled: false, numbers: [], waiting: [] });
        throw new ValidationError("Telnyx texting isn't used with Vapi. Follow-up texts go out from a Twilio number instead.");
      }
      if (method === "GET") return json(await textingState(client));
      if (method === "POST") {
        await enableTexting(client.assistantId);
        return json(await textingState(client));
      }
    } else if (match[2] === "/texting/numbers") {
      if (providerOfClient(client) === "vapi") throw new ValidationError("Telnyx texting isn't used with Vapi. Follow-up texts go out from a Twilio number instead.");
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
          return redirectTo(`/admin/clients/${client.id}?error=${encodeURIComponent((err as Error).message)}`);
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
    } else if ((match[2] === "/simulator/texts" || match[2] === "/simulator/texts/send" || match[2] === "/texting/test") && providerOfClient(client) === "vapi") {
      // The text simulator and test texts run on Telnyx's chat and messaging.
      throw new ValidationError("Telnyx texting isn't used with Vapi. Follow-up texts go out from a Twilio number instead.");
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
    } else if (match[2] === "/numbers/owned") {
      if (method === "GET") return json({ numbers: await ownedNumbers(ctx, orgId) });
    } else if (match[2] === "/numbers/attach" || match[2] === "/numbers/detach") {
      if (method === "POST") return json(await changeOwnNumber(ctx, orgId, client, match[2] === "/numbers/attach" ? "attach" : "detach", await req.json()));
    } else if (match[2] === "/numbers") {
      if (method === "GET") return json(await numberState(ctx, client));
      if (method === "POST") {
        // Numbers cost money every month. On the platform's account, agencies ask
        // (number-requests) and the platform team buys; on its own account an agency buys.
        const input = (await req.json()) as { source?: unknown; accountSid?: unknown; apiKeySid?: unknown; phoneNumber?: unknown; number?: unknown; confirm?: unknown };
        // A Twilio number on the agency's connected Twilio account: the agency pays Twilio, so it's the
        // agency's owners and admins whatever the phone account behind the voice engine is.
        const fromTwilio = typeof input?.source === "string" && input.source.startsWith("twilio") && !input.accountSid && !input.apiKeySid;
        if (fromTwilio) {
          if (!isDemo(client.assistantId) && providerOfClient(client) !== "vapi") throw new ValidationError("Twilio numbers work with the Vapi voice engine. This receptionist runs on Telnyx.");
          if (!(await canUseTwilio(ctx))) throw new AuthError("Connect your Twilio account under Connections first. Owners and admins can do that.", 403);
        } else if (!(await canBuyNumbers(ctx))) throw new AuthError("Request a number and we'll set it up.", 403);
        requireRole(ctx, "admin");
        // A demo receptionist (test lab, local test servers): nothing is bought, the number is only recorded.
        if (isDemo(client.assistantId)) {
          const picked = input;
          const number = String(picked.phoneNumber ?? picked.number ?? "");
          checkBuyable(number);
          // A number the agency already has costs nothing new; a purchase needs its confirmation.
          if (input.source !== "twilio" && picked.confirm !== true) throw new ValidationError("Confirm the purchase first.");
          const withNumber = { ...client, phoneNumbers: [...new Set([...(client.phoneNumbers ?? []), number])], updatedAt: new Date().toISOString() };
          await saveClient(withNumber);
          if (singleAgency()) await settleRequests(client.id, number);
          await audit(ctx, "number.buy", { number, demo: true }, { clientId: client.id });
          return json({ order: { id: `demo-${number}`, status: "success", requirementsMet: true, phoneNumbers: [number], createdAt: withNumber.updatedAt }, ...(await numberState(ctx, withNumber)) }, 201);
        }
        // Vapi: a number the agency already has is brought over (import); Telnyx: bought.
        const order = await (voiceFor(client).id === "vapi" ? voiceFor(client).numbers.attach(client, input) : voiceFor(client).numbers.buy(client, input));
        await audit(ctx, "number.buy", { number: order.phoneNumbers[0] ?? "" }, { clientId: client.id });
        if (singleAgency() && order.phoneNumbers[0]) await settleRequests(client.id, order.phoneNumbers[0]);
        const state = await numberState(ctx, client);
        // A mobile that's live straight away also takes texts. Others can be added from the texts card.
        // (Texting is Telnyx's: a Vapi receptionist has none.)
        if (order.status === "success" && voiceFor(client).id === "telnyx") {
          const fresh = (await getClient(client.id)) ?? client;
          // Australian mobiles only: US numbers need 10DLC registration in Telnyx before they can text.
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
      return json({ calls: await listCalls(client) });
    }
  }

  return json({ error: "Not found" }, 404);
}

await migrate();
await loadPublicUrl();
await loadPlatformSettings();
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
      if (err instanceof VapiError) {
        console.error(`[vapi ${err.status}] ${err.message}`);
        return json({ error: err.message }, err.status >= 500 ? 502 : 400);
      }
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
// Text-back after calls (server/automations.ts).
startAutomations();
// Vapi receptionists: rewrite the greeting when the business opens or closes (server/voice/vapiHours.ts).
startVapiHours();
// Health and usage counts to the setup provider, unless the owner turned it off (server/supportSync.ts).
startSupportSync();
startTicketSync();
// The owner's automatic updates, with this agency's own Railway project token (server/autoUpdate.ts).
startAutoUpdate();
// Account emails that failed on every sender are tried again (server/mailer.ts).
startOutbox();

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

console.log(`Twin Receptionist on http://${HOST}:${PORT} (voice engine ${installProvider()}; Telnyx key ${hasKey() ? "loaded" : "MISSING"}${installProvider() === "vapi" ? `; Vapi key ${process.env.VAPI_API_KEY ? "loaded" : "MISSING"}` : ""})`);
