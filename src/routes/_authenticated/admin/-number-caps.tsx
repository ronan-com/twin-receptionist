import { MessageSquareText, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

/** What a number can do, at a glance: "Calls + Texts" or "Calls only" (Australian landlines can't text). */
export function NumberCaps({ sms, className }: { sms: boolean; className?: string }) {
  return (
    <span data-caps={sms ? "calls-texts" : "calls"} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium", sms ? "bg-[color-mix(in_srgb,var(--green)_16%,var(--card))] text-[#0b6142] dark:text-[#6fe0b3]" : "bg-canvas-2 text-ink-muted", className)}>
      <Phone className="h-3 w-3" />
      {sms ? <MessageSquareText className="h-3 w-3" /> : null}
      {sms ? "Calls + Texts" : "Calls only"}
    </span>
  );
}

export const PROVIDER_LABEL = { telnyx: "Telnyx", twilio: "Twilio", vapi: "Vapi" } as const;

/** Telnyx numbers: only Australian mobiles text through our Telnyx path (landlines can't; US ones need 10DLC). */
export const telnyxCanText = (phoneNumber: string) => /^\+614\d{8}$/.test(phoneNumber);
