import { createFileRoute } from "@tanstack/react-router";
import { ResetPasswordPage } from "@/components/auth/ResetPasswordPage";

// The link in the password-reset email (server/accounts.ts requestReset).
export const Route = createFileRoute("/reset/$token")({
  head: () => ({ meta: [{ title: "Choose a new password — Answered" }, { name: "robots", content: "noindex" }] }),
  component: ResetTokenRoute,
});

function ResetTokenRoute() {
  const { token } = Route.useParams();
  return <ResetPasswordPage token={token} />;
}
