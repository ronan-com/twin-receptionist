import { createFileRoute, redirect } from "@tanstack/react-router";

// Branding is a tab of Settings.
export const Route = createFileRoute("/_authenticated/admin/branding")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/settings", search: { tab: "branding" }, replace: true });
  },
});
