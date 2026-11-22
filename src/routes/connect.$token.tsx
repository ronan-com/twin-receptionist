import { createFileRoute } from "@tanstack/react-router";
import { ConnectPage } from "@/components/connect/ConnectPage";

// The business's private link to connect its mailbox and calendar (no sign-in).
export const Route = createFileRoute("/connect/$token")({
  head: () => ({ meta: [{ title: "Connect your email — Answered" }, { name: "robots", content: "noindex" }] }),
  component: ConnectRoute,
});

function ConnectRoute() {
  const { token } = Route.useParams();
  return <ConnectPage token={token} />;
}
