// What the shared Google / Microsoft app asks for, per purpose. No imports on purpose: the app's server/oauth.ts
// keeps the same list for its own (bring-your-own) app and server/broker.test.ts checks the two stay identical.
export type BrokerProvider = "google" | "microsoft";
export type BrokerPurpose = "mail" | "calendar";
export const BROKER_PROVIDERS: BrokerProvider[] = ["google", "microsoft"];
export const BROKER_PURPOSES: BrokerPurpose[] = ["mail", "calendar"];

export const BROKER_SCOPES: Record<BrokerProvider, Record<BrokerPurpose, string>> = {
  google: {
    mail: "openid email https://mail.google.com/",
    calendar: "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.events.freebusy",
  },
  microsoft: {
    mail: "openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
    calendar: "openid email offline_access https://graph.microsoft.com/Calendars.ReadWrite",
  },
};
