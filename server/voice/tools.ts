import type { Settings } from "../../src/lib/shared";

// Which booking tools the receptionist is given. Paused: only take-a-message. The profile's
// booking mode narrows it too: "request" can look at times but not book, move or cancel
// anything, "message_only" only takes messages. (Used by every voice engine.)
export function toolAllowed(s: Settings, name: string): boolean {
  if (s.paused) return name === "request_callback";
  const mode = s.profile?.bookingMode;
  if (mode === "message_only") return name === "request_callback";
  if (mode === "request") return name === "check_availability" || name === "request_callback";
  return true;
}
