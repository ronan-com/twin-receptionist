import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/app/phone-numbers")({
  head: () => ({ meta: [{ title: "Phone numbers — Answered" }] }),
  component: PhoneNumbersPage,
});

function PhoneNumbersPage() {
  return <PagePlaceholder title="Call handling" description="Your numbers and how calls reach your receptionist." />;
}
