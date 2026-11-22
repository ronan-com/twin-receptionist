import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/app/PagePlaceholder";

// Placeholder from the foundation; the area that owns this page replaces it.
export const Route = createFileRoute("/_authenticated/app/bookings")({
  validateSearch: (search: Record<string, unknown>): { booking?: string } => ({
    booking: typeof search["booking"] === "string" && search["booking"] ? String(search["booking"]) : undefined,
  }),
  head: () => ({ meta: [{ title: "Bookings | Answered" }] }),
  component: BookingsPage,
});

function BookingsPage() {
  return <PagePlaceholder title="Bookings" description="Appointments your receptionist booked." />;
}
