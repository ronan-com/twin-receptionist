import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT } from "@/lib/app/product";
import { ChannelPage } from "./-channel-page";

export const Route = createFileRoute("/_authenticated/admin/receptionists/email")({
  head: () => ({ meta: [{ title: `AI Email Agent — ${PRODUCT} admin` }] }),
  component: () => <ChannelPage channel="email" />,
});
