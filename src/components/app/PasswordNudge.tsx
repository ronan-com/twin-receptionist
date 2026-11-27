import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { sessionQuery } from "@/lib/app/workspace";

// An owner the install made signed in with a one-time link and has no password yet. Say so once
// (a small pop-up, not a banner) and point at Settings. Shown once per browser, then left alone.
const SEEN = "nudge.password";

export function PasswordNudge() {
  const navigate = useNavigate();
  const s = useQuery(sessionQuery()).data;
  const needs = Boolean(s?.signedIn && s.needsPassword && s.console);
  useEffect(() => {
    if (!needs) return;
    try {
      if (window.localStorage.getItem(SEEN)) return;
      window.localStorage.setItem(SEEN, "1");
    } catch {
      /* private window: it may show again, which is fine */
    }
    toast("Choose a password", {
      description: "You signed in with a one-time link. Set a password so you can sign in next time.",
      duration: 15_000,
      action: { label: "Set password", onClick: () => void navigate({ to: "/admin/settings" }) },
    });
  }, [needs, navigate]);
  return null;
}
