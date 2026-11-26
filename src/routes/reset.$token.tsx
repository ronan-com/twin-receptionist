import { createFileRoute } from "@tanstack/react-router";
import { ResetPasswordPage } from "@/components/auth/ResetPasswordPage";
import { named } from "@/lib/app/product";

// The link in the password-reset email (server/accounts.ts requestReset).
export const Route = createFileRoute("/reset/$token")({
  head: () => ({ meta: [{ title: named("Choose a new password — Answered") }, { name: "robots", content: "noindex" }] }),
  component: ResetTokenRoute,
});

function ResetTokenRoute() {
  const { token } = Route.useParams();
  return <ResetPasswordPage token={token} />;
}
