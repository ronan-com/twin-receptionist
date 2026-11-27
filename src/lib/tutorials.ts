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

const OPEN_RECEPTIONIST = "Open **AI Receptionists**, press **Open client** next to the receptionist, then **Open and edit**.";
const OPEN_AUTOMATIONS = "Open the client's page from **Clients**, press **Open and edit** on the receptionist, then go to **Settings** and choose **Automations** (under For the agency).";

export const TUTORIALS: Tutorial[] = [
  // ---- Getting started
  {
    id: "tour",
    group: "start",
    title: "Take the tour again",
    summary: "A one-minute look at every part of your dashboard.",
    steps: [
      "Press **Take the tour** on this page, or open the **?** menu in the top bar and choose **Take the tour**.",
      "Each step points at a part of the sidebar. Press **Next** (or the right arrow key) to move on.",
      "Press **Back** to go back, or **Skip** to stop at any time.",
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
    summary: "Link the phone account your receptionists answer on: Telnyx, or Vapi with Twilio numbers.",
    steps: [
      "Open **Connections** in the sidebar.",
      "Press **Connect your key** (or **Finish set-up**), choose Telnyx (recommended) and paste your Telnyx API key (in Telnyx: API Keys).",
      "Press **Check and save**. The card turns to Connected and shows your credit.",
      "Rather use Vapi with Twilio numbers? Open **Other options (backup)** and press **Use Vapi**, then paste your Vapi keys and press **Check and save**.",
      "For Twilio numbers, press **Connect Twilio** on the Twilio account card, enter your Account SID and Auth Token (or an API Key) and press **Check and save**.",
      "Keep credit topped up (switch on Auto Recharge in Telnyx). If it runs out, receptionists stop answering.",
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
    summary: "Pick the business type, answer a few questions and it is ready to answer.",
    steps: [
      "Open **Clients** and press **New receptionist**.",
      "Pick a template that fits the business (dentist, plumber, salon and more). It fills in services, greeting, hours and call handling.",
      "Go through the steps: hours and services, how it handles calls, voice and greeting, and urgent calls. Everything can be changed later.",
      "On the last step check each line, then press **Create receptionist**. You land on the client's page.",
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
    summary: "Talk to a receptionist from your browser. No phone number needed.",
    steps: [
      "Open **Clients** and choose the client.",
      "On the receptionist, press **Talk to this receptionist**.",
      "Allow the microphone, then talk like a customer would: ask a question or book something.",
      "Hang up and open **Calls** to read the transcript and what happened.",
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
    summary: "Send a business owner a link so they can sign in and see their calls.",
    steps: [
      "Open **Clients** and press **Add client**.",
      "Choose **Send the client an onboarding link**, then fill in Company name, Industry and Client's email.",
      "Press **Create and get link**. It is emailed if email is set up; you can always copy the link and send it yourself.",
      "Already set them up? On the client's page, under **Customers with access**, enter their email, choose **Manager** or **Viewer** and press **Invite customer**.",
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
    summary: "Look at a client's dashboard exactly as they see it.",
    steps: [
      "Open **Clients** and choose the client.",
      "On the receptionist, press **See what <client> sees**.",
      "You see their dashboard, read only. Nothing you click changes anything.",
      "Press **Exit view** in the banner at the top to come back.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    keywords: "view as customer preview client view",
  },
  {
    id: "delete-client",
    group: "clients",
    title: "Delete a client",
    summary: "Remove a client and everything under it, for good.",
    steps: [
      "Open **Clients** and choose the client.",
      "Just want to stop it for a while? Press **Pause** instead. Nothing is deleted and **Resume** switches it back on.",
      "To remove it, press **Delete client** and read the list of what goes.",
      "Type the client's name and press **Delete client for good**. This can't be undone.",
      "Its phone numbers are not deleted. They stay on your phone account, so release them there if you don't want them.",
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
    summary: "Give a receptionist its own number so real callers get through.",
    steps: [
      "Open **Clients**, choose the client and find the receptionist's **Phone number**.",
      "Press **Add a number** and stay on **Buy a new number**.",
      "Pick the country and number type. Choose a mobile if it should send texts.",
      "Pick a number and press **Buy for … a month**. It is charged to your phone account.",
      "Proof of address: Australian numbers need proof of address on your Telnyx account, and mobiles also need ID. Approval takes about 1 to 3 days and the number shows **Waiting for Telnyx approval** until then.",
      "When it is Connected, ring it from a mobile to test before the client forwards their own number to it.",
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
    summary: "Point a number that's already on your phone account at a receptionist.",
    steps: [
      "Open **Clients**, choose the client and find the receptionist's **Phone number**.",
      "Press **Add a number**, then **Use a number I already have**.",
      "Pick the number. Only numbers no receptionist answers yet are listed.",
      "On a Vapi receptionist, choose where the number is (**A number on my Telnyx account** or **A Twilio number I already have**) and press **Connect number**.",
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
    summary: "Buy or bring Twilio numbers for receptionists that run on Vapi.",
    steps: [
      "In **Connections**, open **Other options (backup)**: press **Use Vapi**, then **Connect Twilio** with your Account SID and Auth Token.",
      "Australian Twilio numbers need an approved regulatory bundle (business details and proof of address) in the Twilio console first. It usually takes 1 to 3 business days.",
      "On a Vapi receptionist's page press **Add a number**, choose **Buy a new Twilio number** (or **A Twilio number I already have**) and press **Buy and connect** or **Connect number**.",
      "A Twilio mobile number also sends that receptionist's follow-up texts. You pay Twilio directly.",
    ],
    to: "/admin/connections",
    toLabel: "Open Connections",
    phone: "own",
    keywords: "twilio vapi regulatory bundle backup",
  },
  {
    id: "request-number",
    group: "numbers",
    title: "Get a phone number for a client",
    summary: "Ask for a number for a receptionist. We connect it for you.",
    steps: [
      "Open **Clients**, choose the client and find the receptionist's **Phone number**.",
      "Under **Request a number**, choose **Mobile (calls and texts)** or **Local (calls only)** and add a note if you like.",
      "Press **Request number**. Track it on **Number Requests**.",
      "Australian numbers need proof of address, and mobiles also need ID, so approval takes about 1 to 3 days. Browser test calls work meanwhile.",
      "When it is ready it shows under **Phone Numbers**.",
    ],
    to: "/admin/number-requests",
    toLabel: "Open Number Requests",
    phone: "managed",
    keywords: "request number mobile local proof of address",
  },

  // ---- Receptionist settings
  {
    id: "hours",
    group: "receptionist",
    title: "Opening hours and 24/7",
    summary: "Set when the business is open, or answer every call around the clock.",
    steps: [
      OPEN_RECEPTIONIST,
      "Go to **Settings** and open **Business hours**.",
      "Turn on **Answer calls 24/7**, or set each day's open and close times.",
      "Add holidays under **Days you're closed**, one per line, then press **Save**.",
      "Bookings are only offered inside these hours.",
    ],
    to: "/admin/receptionists",
    toLabel: "Open AI Receptionists",
    keywords: "hours open closed 24/7 holidays closures",
  },
  {
    id: "greeting",
    group: "receptionist",
    title: "Change the greeting",
    summary: "The first thing every caller hears.",
    steps: [
      OPEN_RECEPTIONIST,
      "On the **Persona & voice** tab, find **Greeting**.",
      "Write a short, warm greeting. Keep the part that says it's an AI receptionist.",
      "Press **Save changes**. Callers hear it from the next call.",
    ],
    to: "/admin/receptionists",
    toLabel: "Open AI Receptionists",
    keywords: "greeting hello welcome voice name persona",
  },
  {
    id: "call-handling",
    group: "receptionist",
    title: "How it handles calls",
    summary: "Tone, bookings, prices, what to collect and what never to discuss.",
    steps: [
      OPEN_RECEPTIONIST,
      "**Conversation** tab: how it answers questions and things never to discuss.",
      "**Booking & leads** tab: services, **Allow bookings on calls**, appointment length, **Email each booking to** and what to collect.",
      "For the full profile (prices, emergencies, policies), go to **Settings**, then **Call handling details**.",
      "Press **Save changes**.",
    ],
    to: "/admin/receptionists",
    toLabel: "Open AI Receptionists",
    keywords: "tone booking prices collect services profile",
  },
  {
    id: "knowledge",
    group: "receptionist",
    title: "FAQs and knowledge",
    summary: "Teach the receptionist answers to the questions callers ask.",
    steps: [
      OPEN_RECEPTIONIST,
      "Go to **Settings** and choose **Answers to common questions**.",
      "Press **Add knowledge**, write the question and the answer, and leave it **Published**.",
      "Press **Add**. Check **Questions your receptionist couldn't answer** now and then and answer those too.",
    ],
    to: "/admin/receptionists",
    toLabel: "Open AI Receptionists",
    keywords: "faq knowledge base questions answers",
  },
  {
    id: "transfers",
    group: "receptionist",
    title: "Transfers and urgent calls",
    summary: "Put callers through to a person when they ask, it's urgent, or it can't help.",
    steps: [
      OPEN_RECEPTIONIST,
      "On the **Transfers** tab, turn on **Transfer calls**.",
      "Enter the **Transfer to number** (an Australian mobile or landline) and **Who answers**.",
      "Choose **When to transfer** and tick the reasons: asks for a person, urgent, or can't help.",
      "Press **Save changes**. Transfers only happen on real phone calls to a connected number, not browser test calls.",
    ],
    to: "/admin/receptionists",
    toLabel: "Open AI Receptionists",
    keywords: "transfer forward urgent emergency person staff",
  },
  {
    id: "after-hours",
    group: "receptionist",
    title: "After-hours",
    summary: "What the receptionist does when the business is closed.",
    steps: [
      OPEN_RECEPTIONIST,
      "On the **Hours & voicemail** tab, find **When it answers**.",
      "Choose **Same all the time**, **Messages after hours** or **Bookings after hours**.",
      "Write the **After-hours greeting** if you want a different one, then press **Save changes**.",
    ],
    to: "/admin/receptionists",
    toLabel: "Open AI Receptionists",
    keywords: "after hours closed night weekend messages voicemail",
  },

  // ---- Automations
  {
    id: "text-after-calls",
    group: "automations",
    title: "Text after calls",
    summary: "Send the caller a text when a call ends.",
    steps: [
      OPEN_AUTOMATIONS,
      "Turn on **Text-back after calls**.",
      "Choose when: **After a call**, **After a missed or dropped call**, or **Booking confirmation**, and edit the message.",
      "Press **Save changes**. Texts are sent from the receptionist's Australian mobile number.",
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
      "Turn on **Appointment reminders**.",
      "Tick **Send a text** and/or **Send an email**, and choose when under **Send it**.",
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
    summary: "Follow up callers who hung up or never got a call back.",
    steps: [
      OPEN_AUTOMATIONS,
      "Turn on **Missed-call follow-up**.",
      "Choose **After a very short call** and/or **When a callback hasn't happened**, and set **Hours to wait for a callback**.",
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
    summary: "Ask happy customers for a review after their visit.",
    steps: [
      OPEN_AUTOMATIONS,
      "Turn on **Review requests** and paste **Your review link** (for example the business's Google review link).",
      "Choose when to **Ask**, and whether to send a text or an email.",
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
    summary: "Let website visitors chat with the receptionist: questions, messages and bookings.",
    steps: [
      "Open **Clients** and choose the client.",
      "Under the receptionist, find **Website chat** and turn on **Website chat on**.",
      "Add the client's website under **Websites that can show the chat**, and a **First message** if you like.",
      "Press **Save**. Chats show under **Website chats** on the same card.",
    ],
    to: "/admin/clients",
    toLabel: "Open Clients",
    keywords: "web chat widget website bot",
  },
  {
    id: "webchat-snippet",
    group: "webchat",
    title: "Add the chat to a website",
    summary: "Paste one snippet into the site and the chat bubble appears.",
    steps: [
      "Open **Clients**, choose the client and find **Website chat** (turn it on first).",
      "Under **Snippet**, press **Copy**.",
      "Paste it into the website just before the closing </body> tag, or into the site builder's custom code or footer area (WordPress, Wix, Squarespace and the like all have one).",
      "Press **Preview** to check it, then open the website and look for the chat bubble.",
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
    summary: "So invites, password resets and booking emails are sent for you.",
    steps: [
      "Open **Settings** and choose the **Email and calendars** tab (owners only).",
      "Under **Account emails**, enter the **Mail server address** from your email service (Amazon SES, Resend or any SMTP).",
      "Enter **Send from**: a name and an address your email service has verified.",
      "Press **Save**, then **Send test email** to check it arrives.",
      "Until email is set up, invite and reset links are shown on screen for you to copy and send.",
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
    summary: "Put your brand on your dashboard and your clients' dashboards.",
    steps: [
      "Open **Settings** and choose the **Branding** tab.",
      "Press **Upload logo** (PNG, JPEG or WebP).",
      "Pick your colours and press **Save colours**.",
      "Your clients see your brand. To give one client its own, use the **Branding** panel on that client's page.",
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
    summary: "Ask for a hand. The reply shows up right here.",
    steps: [
      "Open the **?** menu in the top bar and choose **Contact support**.",
      "Write a **Subject** and **What's wrong?**. **Attach a screenshot** if it helps.",
      "Press **Send request**. You'll see the reply under **Your requests**.",
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
    summary: "Your requests and your clients' requests, in one place.",
    steps: [
      "Open **Support requests** in the sidebar. A number shows there when something is new.",
      "Open a request to read it. Requests from your clients are listed too.",
      "Write your answer and press **Send reply**.",
      "Press **Mark as solved** when it's done. A reply reopens it.",
    ],
    to: "/admin/support-requests",
    toLabel: "Open Support requests",
    keywords: "tickets requests inbox client requests reply",
  },
  {
    id: "support-access",
    group: "support",
    title: "Support access",
    summary: "Let whoever set this up sign in and help you, and see what they did.",
    steps: [
      "Open **Settings** and choose the **Support** tab (owners can change it).",
      "Turn **Support access** on or off and choose how long: **For 24 hours**, **For 7 days** or **Until I turn it off**.",
      "**Support can make changes**: off means they can look but not change anything.",
      "Every sign-in and change is listed under **Support activity** and in the audit log.",
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
    summary: "Get new features and fixes without lifting a finger.",
    steps: [
      "Open **Settings** and choose the **Updates** tab.",
      "Turn on **Keep this agency up to date automatically**.",
      "Choose **When**: as soon as it's available, or overnight (2 to 4am your time).",
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
    summary: "Every call your receptionist answered, with what happened.",
    steps: [
      "Press **Calls** in the menu.",
      "Search by name, number or what they wanted, or pick what to show.",
      "Tap a call to see **What happened**, the **Transcript** and, if it's on, the **Recording**.",
    ],
    to: "/app/calls",
    toLabel: "Open Calls",
  },
  {
    id: "bookings",
    group: "client",
    title: "Your bookings",
    summary: "Appointments your receptionist made for you.",
    steps: [
      "Press **Bookings** in the menu.",
      "Upcoming bookings are listed first. Switch to past ones with the **Show** menu.",
      "Tap a booking to see the details, add a note for the team, or cancel it.",
    ],
    to: "/app/bookings",
    toLabel: "Open Bookings",
  },
  {
    id: "messages",
    group: "client",
    title: "Messages to return",
    summary: "Callers who left a message or asked for a call back.",
    steps: [
      "Press **Home** in the menu.",
      "Look under **Needs your attention**: each message says who called and what they wanted.",
      "Press **Call back** to ring them, or tap the message for the full details.",
      "Want messages by email too? Go to **Settings**, **Where messages go**.",
    ],
    to: "/app",
    toLabel: "Open Home",
  },
  {
    id: "hours-greeting",
    group: "client",
    title: "Change your hours or greeting",
    summary: "When you're open, and the first thing callers hear.",
    steps: [
      "Press **Settings** in the menu.",
      "Open **Business hours**: turn on **Answer calls 24/7** or set each day's times, then press **Save**.",
      "Open **Greeting**, write a short welcome and press **Save**. Callers hear it from the next call.",
    ],
    to: "/app/settings",
    toLabel: "Open Settings",
  },
  {
    id: "contact",
    group: "client",
    title: "Contact {agency}",
    summary: "Need a change or something isn't right? Ask {agency}.",
    steps: [
      "Press the **?** button at the top of the screen.",
      "Choose **Contact support**, write what you need and press **Send request**.",
      "{agency} replies there. You'll see a dot on the **?** when they do.",
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
