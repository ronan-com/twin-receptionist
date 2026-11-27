import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT } from "@/lib/app/product";
import { ChannelPage } from "./-channel-page";

export const Route = createFileRoute("/_authenticated/admin/receptionists/voice")({
  head: () => ({ meta: [{ title: `AI Voice Agent — ${PRODUCT} admin` }] }),
  component: () => <ChannelPage channel="voice" />,
});
