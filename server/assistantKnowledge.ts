import { TEMPLATES } from "../src/lib/templates";

// What the in-app help assistant knows about the agency console. Written from the
// handoff docs (handoff-content/after-install.md and buyer-pack/owner-quickstart.md),
// the sidebar and the pages behind it, the new-receptionist wizard (src/lib/profile.ts,
// src/lib/templates) and the automations (server/automations.ts). Kept compact on
// purpose: it is sent with every question. Update it when those screens change.

export type PhoneMode = "own" | "platform" | "none";

const templateList = (() => {
  const groups = new Map<string, string[]>();
  for (const t of TEMPLATES) groups.set(t.group, [...(groups.get(t.group) ?? []), t.label]);
  return [...groups].map(([g, labels]) => `${g}: ${labels.join(", ")}`).join("\n");
})();

/** The pages an agency owner or admin can open, with the in-app path to link to. */
export const PAGES = `Sidebar (agency console, paths are relative links you may use):
- Overview /admin : calls, bookings and "Needs attention" across all clients, plus the Get started checklist (brand, first receptionist, test call, invite a client, connect a number). The ? menu in the top bar has Get started, Take the tour and Ask AI.
- Clients /admin/clients : the businesses the agency looks after. A client's page (/admin/clients/<id>) is the hub: its receptionists and automations, Talk to this receptionist (browser test call), numbers, Customers with access (invite as Manager or Viewer), Send onboarding link, Branding for that client, recent calls, bookings and follow-ups, changes. Buttons: Add receptionist, Send onboarding link, Edit, Pause or Resume.
- New receptionist /admin/clients/new : the setup wizard (see below).
- Calls /admin/calls : every call and text with outcome and transcript. Browser test calls show here too. Failed calls are highlighted.
- AI Receptionists /admin/receptionists : every receptionist in one list; open one to change its greeting, hours, call handling, knowledge and automations.
- Voices /admin/voices : the Australian voices on offer and which receptionist uses each.
- Phone Numbers /admin/phone-numbers : numbers that are connected, and orders still waiting.
- Number Requests /admin/number-requests : (only where numbers are requested rather than bought) ask for a number for a client and track it.
- Connections /admin/connections : the phone account, calendars and email, with a set-up check.
- Usage /admin/usage : call minutes and activity per client.
- System / QA /admin/system : failed calls and background problems found automatically.
- Audit Log /admin/audit : who changed what.
- Settings /admin/settings : tabs Team (/admin/settings), Branding (/admin/settings?tab=branding), Account (/admin/settings?tab=account), and for owners Email and calendars (/admin/settings?tab=email).`;

export const WIZARD = `New receptionist wizard (Clients > New receptionist), six short steps. Everything can be changed afterwards:
1. Client and business: pick an existing client or "New client (named after the business)", business name, how to say the name, business type or a niche template (prefills about, services, greeting, hours and call handling), what the business does, suburb, time zone, address.
2. Hours and services: when the receptionist is active (set specific times, or always), closures and public holidays, what callers can ask for (chips), anything else callers often ask. It only offers bookings inside these hours.
3. How it handles calls: the detailed profile. Tone (warm, professional, upbeat, calm, casual); booking mode (book straight into the calendar, take a request for staff to confirm, or messages only); appointment length, buffer, minimum notice and how far ahead callers can book; services with minutes and prices; how to answer price questions (exact, "from", rough range, or offer a call back); what to collect on every call (name, phone, email, reason, preferred time, new or existing, plus niche fields like Medicare, rego, pet name); whether new customers are welcome, waitlist only or existing only; emergencies (put through to staff, tell them to call 000 then take a message, take an urgent message); cancellation policy, payment methods, parking, accessibility, languages, service area; FAQs (they become published knowledge); things to always do and never do.
4. Voice: the receptionist's name, how it should sound, an Australian voice, the greeting (ready-made greetings or write your own; keep the part saying it is an AI receptionist).
5. Urgent calls: an Australian mobile or landline number to put callers through to, whose number it is ("putting you through to ..."), whether to also transfer when callers ask for a person, and topics to pass to staff instead of discussing. This turns on the transfer automation.
6. Review: check every line, then Create receptionist (takes a few seconds). You land on the client's page.
Niche templates (${TEMPLATES.length}) by group:
${templateList}`;

export const AUTOMATIONS = `Automations (on each receptionist, each has a switch and an honest status):
- Put callers through to a person (transfer): needs an Australian phone number to transfer to (mobile or landline, like 0412 345 678 or 07 3123 4567). It only works on phone calls (not browser test calls or texts), and the receptionist must have its own Australian phone number connected, because the transfer is made from that number, and the transfer number must differ from the receptionist's own number. Choose when: only while open, or always; and why: caller asks for a person, it is urgent, or it can't help. If the transfer reaches voicemail it can come back and take a message. A browser test call won't transfer. Common reasons "it isn't transferring": automation is off, no number connected yet or the number still awaiting approval, no transfer number, it's outside hours with "only while open" selected, the reason (asks for a person / urgent / can't help) isn't ticked, or the test was a browser call instead of a real phone call.
- Text back: texts after a call or after a missed call, from the receptionist's Australian mobile number. Needs an Australian mobile number.
- Call recording with a spoken notice, language (Australian English, or English plus the caller's language), and call limits (maximum minutes, idle seconds before hanging up).
- After-hours mode: when closed, the receptionist uses a closed greeting and either takes messages only, or messages and bookings. Open and closed come from the hours set in the wizard and the time zone.`;

export const NUMBERS_PLATFORM = `Phone numbers on this account: the agency does not buy numbers itself. On a client's page, request a number (Number Requests page shows progress); the platform team connects it. Never name the phone provider and never mention prices or costs of numbers. Australian numbers need proof of address, and mobiles also need ID, so approval takes about 1 to 3 days. Until then a number shows as ordered, not connected. Browser test calls work without any number.`;

export const NUMBERS_OWN = `Phone numbers on this account: the agency has its own phone account (Telnyx), connected under Connections (or set during install). To get a number, open the client's page and click Buy a number; the monthly price is shown before confirming and is charged to the agency's own phone account, so keep credit topped up (auto recharge helps). Australian numbers need proof of address in Telnyx, and mobiles also need ID; approval takes about 1 to 3 days. Until then a number shows as ordered, not connected. Browser test calls work without any number. Once a number is connected, ring it from a mobile to test, and only then forward the client's public number to it (note the client's original forwarding first so it can be restored).`;

export const NUMBERS_NONE = `Phone numbers on this account: the agency has not connected its phone account yet. It must connect one first (Connections, or the Setup screen) before numbers can be bought. Australian numbers need proof of address, and mobiles also need ID; approval takes about 1 to 3 days. Browser test calls work without any number.`;

export const HOWTOS = `Common how-tos:
- First receptionist: Clients > New receptionist, pick a niche template, fill the six steps, Create receptionist. Then press Talk to this receptionist on the client's page for a browser test call (allow the microphone). Test calls appear under Calls.
- Give a client their own login: open the client's page, under Customers with access enter their email, choose Manager (can change receptionists) or Viewer (look only), click Invite customer. Or click Send onboarding link so they finish setting up in their own workspace. The link is emailed if email is set up and is always shown so you can copy and send it. Use See what <client> sees to check their view. Clients then have Dashboard, Calls, Bookings, Follow-ups, Receptionist, Reports and Settings.
- Branding: Settings > Branding: logo and colours (primary, accent, sidebar, background); shows on clients' screens unless a client has its own branding on its page. Team name and invites are on Settings > Team (owners and admins invite; members work on clients).
- Hear it without a call: Receptionist > Hear a sample plays a recorded example; Talk to this receptionist is the live call from the browser.
- Calendar for bookings: in the client's workspace, Settings > Integrations: connect Google or Outlook calendar (these appear once set up under Settings > Email and calendars) or use the built-in calendar; set appointment length and "Email each booking to". If a booking fails the receptionist takes a callback instead (see Follow-ups).
- Email: invite and reset links are shown on screen for copying until email is set up under Settings > Email and calendars (owner only).
- Calls stop or something breaks: check phone credit/account, the number is connected, the receptionist or client isn't Paused (click Resume), then System / QA and Overview > Needs attention. While down, clients can forward back to their original route.
- Every day: check failed or missed calls and open follow-ups. Every week: place a test call to each client and review unanswered questions.`;

export function numbersFor(mode: PhoneMode, singleAgency: boolean): string {
  if (singleAgency || mode === "own") return NUMBERS_OWN;
  if (mode === "platform") return NUMBERS_PLATFORM;
  return NUMBERS_NONE;
}
