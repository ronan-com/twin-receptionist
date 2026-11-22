import { createFileRoute } from "@tanstack/react-router";
import { ResetPasswordPage } from "@/components/auth/ResetPasswordPage";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  head: () => ({ meta: [{ title: "Choose a new password — Answered" }, { name: "robots", content: "noindex" }] }),
  component: ResetPasswordRoute,
});

function ResetPasswordRoute() {
  const { token } = Route.useSearch();
  return <ResetPasswordPage token={token ?? null} />;
}
