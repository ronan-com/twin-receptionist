// The setup wizard no longer has an "ask a person" form (the helper is the AI helper). What stays: the last error each step
// showed is kept on the setup (admin "Set up for them" and old Help tickets read it).
import { now } from "./lib";
import type { SetupData, StepId } from "./store";

/** The step's name, as our admin reads it. */
const STEP_LABEL: Record<StepId, string> = {
  welcome: "Welcome", brand: "Brand", domain: "Domain", server: "DigitalOcean server", railway: "Railway", phones: "Voice", ai: "AI",
  email: "Email", calendars: "Calendars", extras: "Extras", vapi: "Vapi", twilio: "Twilio", install: "Install", done: "Live",
};
export const stepLabel = (id: string) => STEP_LABEL[id as StepId] || "setup";

/** The last error the wizard showed them on this step: a form's red message, or the install's failure. */
export function lastErrorOf(s: SetupData, step: StepId): string {
  const e = s.lastErrors?.[step]?.text || (step === "install" || step === "done" ? s.error || s.update?.error || "" : "");
  return e;
}
/** Kept by server.ts each time a wizard form answers with an error, so a help request can say what went wrong. */
export function noteStepError(s: SetupData, step: StepId, msg: string) {
  s.lastErrors = { ...(s.lastErrors || {}), [step]: { text: msg.slice(0, 300), at: now() } };
}
