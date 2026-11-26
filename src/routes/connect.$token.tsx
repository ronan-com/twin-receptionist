import { createFileRoute } from "@tanstack/react-router";
import { ConnectPage } from "@/components/connect/ConnectPage";
import { named } from "@/lib/app/product";

// The business's private link to connect its mailbox and calendar (no sign-in).
export const Route = createFileRoute("/connect/$token")({
  head: () => ({ meta: [{ title: named("Connect your email — Answered") }, { name: "robots", content: "noindex" }] }),
  component: ConnectRoute,
});

function ConnectRoute() {
  const { token } = Route.useParams();
  return <ConnectPage token={token} />;
}
