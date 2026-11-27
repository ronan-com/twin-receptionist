import { createFileRoute, redirect } from "@tanstack/react-router";

// The receptionist wizard moved to its own page, under AI Receptionist. Old links land there.
export const Route = createFileRoute("/_authenticated/admin/clients/new")({
  validateSearch: (s: Record<string, unknown>): { company?: string } => (typeof s.company === "string" && /^[a-f0-9-]{36}$/.test(s.company) ? { company: s.company } : {}),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/admin/receptionists/new", search, replace: true });
  },
});
