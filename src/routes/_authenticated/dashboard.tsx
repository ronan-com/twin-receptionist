import { createFileRoute, redirect } from "@tanstack/react-router";

// Answered's /dashboard was an internal live-calls monitor fed by its old voice
// provider. Here it sends each person to their own home (console or workspace).
export const Route = createFileRoute("/_authenticated/dashboard")({
  beforeLoad: ({ context }) => {
    throw redirect({ to: context.session.console ? "/admin" : "/app", replace: true });
  },
});
