import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT } from "@/lib/app/product";
import { ChannelPage } from "./-channel-page";

export const Route = createFileRoute("/_authenticated/admin/receptionists/messages")({
  head: () => ({ meta: [{ title: `AI Messages Agent — ${PRODUCT} admin` }] }),
  component: () => <ChannelPage channel="messages" />,
});
