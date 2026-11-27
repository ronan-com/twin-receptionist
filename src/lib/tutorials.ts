// The Tutorials page (/admin/tutorials) and the businesses' "How it works" page
// (/app/how-it-works), as plain data. To add a video to a tutorial, fill in its
// `video` with a YouTube, Loom, Vimeo or .mp4 link: the page shows a player for it,
// and shows nothing when it is empty. The help assistant (server/assistantKnowledge.ts)
// reads the same list so it can link to a tutorial (/admin/tutorials#<id>).
//
// Wording rules: button and menu names exactly as on screen, in **bold**. Never name
// the product here; write {product} if it is needed and the screens fill it in. The
// business version says {agency} for whoever set them up.

/** An animated "Watch how" guide from src/components/onboarding/Guides.tsx. */
export type TutorialGuide = "receptionist" | "testcall" | "invite";

/** Something the page does instead of (or as well as) linking. */
export type TutorialAction = "tour" | "support";

export interface Tutorial {
  /** Stable: used in links (/admin/tutorials#id). Don't rename. */
  id: string;
  group: string;
  title: string;
  summary: string;
  steps: string[];
  /** The real page, for the "Go there" button. Empty = no button (the action is the way in). */
  to: string;
  toLabel?: string;
  /** A YouTube, Loom, Vimeo or .mp4/.webm link. Empty = no player. */
  video?: string;
  guide?: TutorialGuide;
  action?: TutorialAction;
  /** Phone set-up it applies to: "own" = the agency's own phone account, "managed" = numbers are requested. Missing = everyone. */
  phone?: "own" | "managed";
  /** Only on a copy the agency runs itself (SINGLE_AGENCY). */
  singleAgency?: boolean;
  /** Extra words for search. */
  keywords?: string;
}

export const TUTORIAL_GROUPS: { id: string; title: string }[] = [
  { id: "start", title: "Getting started" },
  { id: "clients", title: "Clients" },
  { id: "numbers", title: "Phone numbers" },
  { id: "receptionist", title: "Receptionist settings" },
  { id: "automations", title: "Automations" },
  { id: "webchat", title: "Website chat" },
  { id: "email", title: "Email" },
  { id: "brand", title: "Your brand" },
  { id: "support", title: "Updates & support" },
];

const OPEN_RECEPTIONIST = "Open **Receptionists**, press **Open client**, then **Open and edit**.";
const OPEN_AUTOMATIONS = "Open **Receptionists**, then **Open and edit**, then **Settings** and **Automations**.";

export const TUTORIALS: Tutorial[] = [
  // ---- Getting started
  {
    id: "tour",
    group: "start",
    title: "Take the tour again",
    summary: "A quick look around.",
    steps: [
      "Press **Take the tour**.",
      "Press **Next** to move on.",
      "Press **Skip** to stop any time.",
    ],
    to: "/admin",
    toLabel: "Open Overview",
    action: "tour",
    keywords: "tour walkthrough intro",
  },
  {
    id: "connect-phone",
    group: "start",
    title: "Connect your phone provider",
    summary: "Link the phone account your receptionists answer on.",
    steps: [
      "Open **Connections**.",
      "Press **Connect your key**, choose Telnyx and paste your API key.",
      "Press **Check and save**. Keep credit topped up.",
    ],
    to: "/admin/connections",
    toLabel: "Open Connections",
    phone: "own",
    keywords: "telnyx vapi twilio api key provider account credit",
  },
  {
    id: "first-receptionist",
    group: "start",
    title: "Make your first receptionist from a template",
    summary: "Pick a business type and it is ready to answer.",
    steps: [
      "Open **Clients** and press **New receptionist**.",
      "Pick a template and answer a few questions.",
      "Press **Create receptionist**.",
    ],
    to: "/admin/clients/new",
    toLabel: "New receptionist",
    guide: "receptionist",
    keywords: "create new template wizard setup",
  },
  {
    id: "test-call",
    group: "start",
    title: "Make a test call",
    summary: "Talk to a receptionist from your browser.",
    steps: [
      "Open **Clients** and choose the client.",
      "Press **Talk to this receptionist** and speak.",
      "Read the result in **Calls**.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    guide: "testcall",
    keywords: "test try browser microphone call",
  },

  // ---- Clients
  {
    id: "invite-client",
    group: "clients",
    title: "Invite a client",
    summary: "Give a business owner a login.",
    steps: [
      "Open **Clients** and press **Add client**.",
      "Choose **Send the client an onboarding link** and fill in the details.",
      "Press **Create and get link**.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    guide: "invite",
    keywords: "invite onboarding link login customer access manager viewer",
  },
  {
    id: "see-what-they-see",
    group: "clients",
    title: "See what your client sees",
    summary: "See a client's dashboard as they do.",
    steps: [
      "Open **Clients** and choose the client.",
      "Press **See what <client> sees**.",
      "Press **Exit view** to come back.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    keywords: "view as customer preview client view",
  },
  {
    id: "delete-client",
    group: "clients",
    title: "Delete a client",
    summary: "Remove a client for good.",
    steps: [
      "Open **Clients** and choose the client.",
      "Want a break instead? Press **Pause**.",
      "Press **Delete client**, type the name and confirm.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    keywords: "remove delete pause resume cancel",
  },

  // ---- Phone numbers
  {
    id: "buy-number",
    group: "numbers",
    title: "Buy an Australian number",
    summary: "Give a receptionist its own number.",
    steps: [
      "Open **Clients** and choose the client.",
      "Press **Add a number**, then **Buy a new number** and pick one.",
      "Press **Buy for** (the price shows first).",
      "Australian numbers need proof of address. Approval takes 1 to 3 days.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    phone: "own",
    keywords: "buy purchase number mobile local proof of address id regulatory",
  },
  {
    id: "own-number",
    group: "numbers",
    title: "Use a number you already own",
    summary: "Use a number already on your phone account.",
    steps: [
      "Open **Clients** and choose the client.",
      "Press **Add a number**, then **Use a number I already have**.",
      "Pick the number and press **Connect number**.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    phone: "own",
    keywords: "existing bring port import own number",
  },
  {
    id: "twilio-numbers",
    group: "numbers",
    title: "Twilio numbers on Vapi",
    summary: "Twilio numbers for receptionists on Vapi.",
    steps: [
      "In **Connections**, open **Other options (backup)** and connect Twilio.",
      "Press **Add a number** on the receptionist.",
      "Choose **Buy a new Twilio number** or **A Twilio number I already have**.",
    ],
    to: "/admin/connections",
    toLabel: "Open Connections",
    phone: "own",
    keywords: "twilio vapi regulatory bundle backup",
  },
  {
    id: "texts-switch",
    group: "numbers",
    title: "Turn texts on or off",
    summary: "Let a receptionist answer texts.",
    steps: [
      "Open **Clients** and choose the client.",
      "Under the number, use the **Texts** switch.",
      "If it says **Not connected**, press **Try again**.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    keywords: "texts sms text messages switch on off mobile number approval",
  },
  {
    id: "request-number",
    group: "numbers",
    title: "Get a phone number for a client",
    summary: "Ask for a number. We connect it.",
    steps: [
      "Open **Clients** and choose the client.",
      "Under **Request a number**, choose the type and press **Request number**.",
      "Track it under **Numbers**.",
    ],
    to: "/admin/number-requests",
    toLabel: "Open Numbers",
    phone: "managed",
    keywords: "request number mobile local proof of address",
  },

  // ---- Receptionist settings
  {
    id: "hours",
    group: "receptionist",
    title: "Opening hours and 24/7",
    summary: "When the business is open.",
    steps: [
      OPEN_RECEPTIONIST,
      "Open the **Hours & voicemail** tab and set each day under **Opening hours**.",
      "Press **Save changes**.",
    ],
    to: "/admin/receptionists",
    toLabel: "Open Receptionists",
    keywords: "hours open closed 24/7 holidays closures",
  },
  {
    id: "greeting",
    group: "receptionist",
    title: "Change the greeting",
    summary: "The first thing callers hear.",
    steps: [
      OPEN_RECEPTIONIST,
      "Edit **Greeting** on the **Persona & voice** tab.",
      "Press **Save changes**.",
    ],
    to: "/admin/receptionists",
    toLabel: "Open Receptionists",
    keywords: "greeting hello welcome voice name persona",
  },
  {
    id: "call-handling",
    group: "receptionist",
    title: "How it handles calls",
    summary: "Tone, bookings and what to collect.",
    steps: [
      OPEN_RECEPTIONIST,
      "Use the **Conversation** and **Booking & leads** tabs.",
      "Press **Save changes**.",
    ],
    to: "/admin/receptionists",
    toLabel: "Open Receptionists",
    keywords: "tone booking prices collect services profile",
  },
  {
    id: "knowledge",
    group: "receptionist",
    title: "FAQs and knowledge",
    summary: "Teach it the answers callers ask for.",
    steps: [
      OPEN_RECEPTIONIST,
      "Press **Settings**, then **Answers to common questions**, then **Add knowledge**.",
      "Write the question and answer, then press **Add**.",
    ],
    to: "/admin/receptionists",
    toLabel: "Open Receptionists",
    keywords: "faq knowledge base questions answers",
  },
  {
    id: "transfers",
    group: "receptionist",
    title: "Transfers and urgent calls",
    summary: "Put callers through to a person.",
    steps: [
      OPEN_RECEPTIONIST,
      "Open the **Transfers** tab, turn on **Transfer calls** and enter the number.",
      "Pick when to transfer and press **Save changes**.",
    ],
    to: "/admin/receptionists",
    toLabel: "Open Receptionists",
    keywords: "transfer forward urgent emergency person staff",
  },
  {
    id: "after-hours",
    group: "receptionist",
    title: "After-hours",
    summary: "What it does when you're closed.",
    steps: [
      OPEN_RECEPTIONIST,
      "Open the **Hours & voicemail** tab and choose what happens under **When it answers**.",
      "Press **Save changes**.",
    ],
    to: "/admin/receptionists",
    toLabel: "Open Receptionists",
    keywords: "after hours closed night weekend messages voicemail",
  },

  // ---- Automations
  {
    id: "text-after-calls",
    group: "automations",
    title: "Text after calls",
    summary: "Text the caller when a call ends.",
    steps: [
      OPEN_AUTOMATIONS,
      "Turn on **Text-back after calls** and pick when.",
      "Press **Save changes**.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    keywords: "sms text message after call",
  },
  {
    id: "reminders",
    group: "automations",
    title: "Appointment reminders",
    summary: "Remind customers before their booking.",
    steps: [
      OPEN_AUTOMATIONS,
      "Turn on **Appointment reminders** and pick text, email and timing.",
      "Press **Save changes**.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    keywords: "reminder appointment booking no show",
  },
  {
    id: "missed-call",
    group: "automations",
    title: "Missed-call text-back",
    summary: "Follow up callers who hung up.",
    steps: [
      OPEN_AUTOMATIONS,
      "Turn on **Missed-call follow-up**.",
      "Press **Save changes**.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    keywords: "missed call text back follow up",
  },
  {
    id: "reviews",
    group: "automations",
    title: "Review requests",
    summary: "Ask happy customers for a review.",
    steps: [
      OPEN_AUTOMATIONS,
      "Turn on **Review requests** and paste the review link.",
      "Press **Save changes**.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    keywords: "review google rating feedback",
  },

  // ---- Website chat
  {
    id: "webchat-on",
    group: "webchat",
    title: "Turn on website chat",
    summary: "Let website visitors chat.",
    steps: [
      "Open **Clients** and choose the client.",
      "Turn on **Website chat on** and add the website.",
      "Press **Save**.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    keywords: "web chat widget website bot",
  },
  {
    id: "webchat-snippet",
    group: "webchat",
    title: "Add the chat to a website",
    summary: "One snippet puts the chat on a website.",
    steps: [
      "Under **Website chat**, press **Copy** on the snippet.",
      "Paste it before </body>, or into the site's custom code area.",
      "Press **Preview** to check.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    keywords: "snippet embed code script install wordpress wix squarespace",
  },

  // ---- Email
  {
    id: "email",
    group: "email",
    title: "Connect email",
    summary: "So invites and booking emails are sent for you.",
    steps: [
      "Open **Help**, then **Settings**, then **Email and calendars**.",
      "Enter the mail server and **Send from** address.",
      "Press **Save**, then **Send test email**.",
    ],
    to: "/admin/settings?tab=email",
    toLabel: "Open Email and calendars",
    keywords: "email smtp ses resend invites mail",
  },

  // ---- Your brand
  {
    id: "brand",
    group: "brand",
    title: "Your logo and colour",
    summary: "Your logo and colours.",
    steps: [
      "Open **Brand**.",
      "Upload your logo and pick a colour.",
      "Press **Save colours**. Clients can have their own on their page.",
    ],
    to: "/admin/branding",
    toLabel: "Open Branding",
    keywords: "logo colour color brand white label",
  },

  // ---- Updates & support
  {
    id: "contact-support",
    group: "support",
    title: "Contact support",
    summary: "Ask for a hand.",
    steps: [
      "Open the **?** menu and choose **Contact support**.",
      "Write what's wrong and press **Send request**.",
      "The reply shows under **Your requests**.",
    ],
    to: "/admin/support-requests",
    toLabel: "Open Support requests",
    action: "support",
    keywords: "help support contact ticket problem",
  },
  {
    id: "help-tickets",
    group: "support",
    title: "Help tickets",
    summary: "Your requests and your clients'.",
    steps: [
      "Open **Help**, then **Support**.",
      "Open a request, write a reply and press **Send reply**.",
      "Press **Mark as solved** when done.",
    ],
    to: "/admin/support-requests",
    toLabel: "Open Support requests",
    keywords: "tickets requests inbox client requests reply",
  },
  {
    id: "support-access",
    group: "support",
    title: "Support access",
    summary: "Let your setup provider help you.",
    steps: [
      "Open **Help**, then **Settings**, then **Support**.",
      "Turn **Support access** on or off and pick how long.",
      "Everything they do is listed under **Support activity**.",
    ],
    to: "/admin/settings?tab=support",
    toLabel: "Open Support settings",
    singleAgency: true,
    keywords: "support access sign in permission audit",
  },
  {
    id: "updates",
    group: "support",
    title: "Automatic updates",
    summary: "New features without lifting a finger.",
    steps: [
      "Open **Help**, then **Settings**, then **Updates**.",
      "Turn on **Keep this agency up to date automatically**.",
      "Pick a time and you're done.",
    ],
    to: "/admin/settings?tab=updates",
    toLabel: "Open Updates",
    singleAgency: true,
    keywords: "update upgrade new version",
  },
];

/** The tutorials for this agency: hides phone set-up that isn't theirs and pages their copy doesn't have. */
export function tutorialsFor(phone: "own" | "platform" | "none" | undefined, singleAgency: boolean): Tutorial[] {
  const own = singleAgency || phone !== "platform";
  return TUTORIALS.filter((t) => (t.phone === "own" ? own : t.phone === "managed" ? !own : true) && (!t.singleAgency || singleAgency));
}

/** For a business on /app/how-it-works. {agency} = whoever set them up. */
export const CLIENT_TUTORIALS: Tutorial[] = [
  {
    id: "calls",
    group: "client",
    title: "See your calls",
    summary: "What happened on each call.",
    steps: [
      "Press **Inbox**.",
      "Tap a call for the summary, transcript and recording.",
    ],
    to: "/app/inbox",
    toLabel: "Open Inbox",
  },
  {
    id: "bookings",
    group: "client",
    title: "Your bookings",
    summary: "Appointments made for you.",
    steps: [
      "Press **Calendar**.",
      "Approve or decline requests at the top, if you use approvals.",
      "Tap **All bookings** to add a note or cancel.",
    ],
    to: "/app/calendar",
    toLabel: "Open Calendar",
  },
  {
    id: "messages",
    group: "client",
    title: "Messages to return",
    summary: "People who left a message.",
    steps: [
      "Press **Home**.",
      "Look under **Needs your attention**.",
      "Press **Call back**, or **Done** when handled.",
    ],
    to: "/app",
    toLabel: "Open Home",
  },
  {
    id: "hours-greeting",
    group: "client",
    title: "Change your hours or greeting",
    summary: "When you're open and what callers hear.",
    steps: [
      "Press **Settings**.",
      "Open **Business hours** or **Greeting**.",
      "Edit and press **Save**.",
    ],
    to: "/app/settings",
    toLabel: "Open Settings",
  },
  {
    id: "contact",
    group: "client",
    title: "Contact {agency}",
    summary: "Need a change? Ask {agency}.",
    steps: [
      "Press the **?** button.",
      "Choose **Contact support** and press **Send request**.",
      "{agency} replies there.",
    ],
    to: "",
    action: "support",
  },
];

/** How to play a tutorial's video: an iframe (YouTube, Loom, Vimeo) or a <video> file. Null = unknown or empty, show nothing. */
export function videoEmbed(url: string | undefined | null): { kind: "iframe" | "file"; src: string } | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const id = (s: string | null | undefined) => (s && /^[A-Za-z0-9_-]{6,64}$/.test(s) ? s : null);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    const v = id(u.searchParams.get("v")) ?? (["embed", "shorts", "live"].includes(parts[0]) ? id(parts[1]) : null);
    return v ? { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${v}` } : null;
  }
  if (host === "youtu.be") {
    const v = id(u.pathname.split("/")[1]);
    return v ? { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${v}` } : null;
  }
  if (host === "loom.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    const v = ["share", "embed"].includes(parts[0]) ? id(parts[1]) : null;
    return v ? { kind: "iframe", src: `https://www.loom.com/embed/${v}` } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const v = u.pathname.split("/").filter(Boolean).find((p) => /^\d{4,}$/.test(p));
    return v ? { kind: "iframe", src: `https://player.vimeo.com/video/${v}` } : null;
  }
  if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return { kind: "file", src: u.toString() };
  return null;
}

/** Fill {product} and {agency}. */
export const fillTutorial = (text: string, names: { product?: string; agency?: string }) =>
  text.replaceAll("{product}", names.product ?? "").replaceAll("{agency}", names.agency ?? "your agency");

/** Strip **bold** for plain text (search, the help assistant). */
export const plainTutorial = (text: string) => text.replace(/\*\*([^*]+)\*\*/g, "$1");
