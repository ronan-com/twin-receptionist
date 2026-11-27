import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/app/workspace";
import type { SignedIn } from "@/lib/api/auth";

// A buyer's own copy (SINGLE_AGENCY) installed with no phone key: the owner skipped the phone step in
// setup (Telnyx can take a day or two to approve an account) and connects it later in Connections.
// Until then the console says so at the top, and every "New receptionist" is switched off with the
// same message and a link. Business users (clients) never see any of it.

export const PHONE_NEEDED = "Connect your phone provider to start making receptionists";

/** No phone account yet on a single-agency install (session.telnyx is "none" only when nothing is connected). */
export const phoneKeyNeeded = (s: Pick<SignedIn, "singleAgency" | "console" | "telnyx"> | null | undefined): boolean =>
  Boolean(s?.singleAgency && s.console === "agency" && s.telnyx === "none");

export function usePhoneKeyNeeded(): boolean {
  const ws = useWorkspace();
  return phoneKeyNeeded(ws.session);
}

/** The top banner, for the agency's owners and admins. */
export function ConnectPhoneBanner() {
  const ws = useWorkspace();
  const needed = usePhoneKeyNeeded();
  const role = ws.session?.role;
  if (!needed || ws.viewing || (role !== "owner" && role !== "admin")) return null;
  return (
    <div className="border-b border-[#ffe1b0] bg-[#fff9ee] px-4 py-2.5 text-[12.5px] text-[#8a4b00]" data-banner="connect-phone">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>
          <span className="font-semibold">{PHONE_NEEDED}.</span> Paste your Telnyx API key once Telnyx has approved your account. Until then you can set up your brand, team and clients.
        </span>
        <Button asChild size="sm" className="h-7 shrink-0 self-start text-[12px] sm:self-auto">
          <Link to="/admin/connections" data-cta="connect-phone">
            <Plug className="mr-1 h-3.5 w-3.5" /> Open Connections
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Wraps a "New receptionist" button. Before a phone provider is connected it shows the same label,
 * switched off, with the message and a link to Connections.
 */
export function NeedsPhone({ children, label, size = "sm", className }: { children: ReactNode; label: ReactNode; size?: "sm" | "default"; className?: string }) {
  const needed = usePhoneKeyNeeded();
  if (!needed) return <>{children}</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-gated="phone-provider">
      <Button size={size} className={className} disabled title={PHONE_NEEDED} aria-describedby="phone-needed-hint">
        {label}
      </Button>
      <Link to="/admin/connections" id="phone-needed-hint" className="text-[12px] font-medium text-indigo hover:underline">
        {PHONE_NEEDED}
      </Link>
    </span>
  );
}

/** Shown instead of the receptionist wizard (deep links, the Get started guides). */
export function ConnectPhoneFirst() {
  return (
    <div className="mx-auto max-w-[560px] rounded-[12px] border border-[#ffe1b0] bg-[#fff9ee] p-6 text-center" data-page="connect-phone-first">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-[10px] bg-white text-[#b45309]" aria-hidden>
        <Plug className="h-5 w-5" />
      </span>
      <h1 className="mt-3 text-[18px] font-semibold text-ink">{PHONE_NEEDED}</h1>
      <p className="mt-1 text-[13px] text-ink-muted">Receptionists answer on your own phone account. Paste your Telnyx API key in Connections and you can make your first one straight away.</p>
      <Button asChild className="mt-4">
        <Link to="/admin/connections">Open Connections</Link>
      </Button>
    </div>
  );
}
