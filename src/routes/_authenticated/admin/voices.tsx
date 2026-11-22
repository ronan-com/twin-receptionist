import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/admin/voices")({
  head: () => ({ meta: [{ title: "Voices — Answered admin" }] }),
  component: VoicesPage,
});

function VoicesPage() {
  return <PagePlaceholder title="Voices" description="The voices receptionists can use." />;
}
