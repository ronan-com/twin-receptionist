import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT } from "@/lib/app/product";
import { ChannelPage } from "./-channel-page";

export const Route = createFileRoute("/_authenticated/admin/receptionists/email")({
  head: () => ({ meta: [{ title: `Email agent — ${PRODUCT} admin` }] }),
  component: () => <ChannelPage channel="email" />,
});
