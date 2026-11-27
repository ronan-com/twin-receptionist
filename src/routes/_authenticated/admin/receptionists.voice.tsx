import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT } from "@/lib/app/product";
import { ChannelPage } from "./-channel-page";

export const Route = createFileRoute("/_authenticated/admin/receptionists/voice")({
  head: () => ({ meta: [{ title: `Voice agent — ${PRODUCT} admin` }] }),
  component: () => <ChannelPage channel="voice" />,
});
