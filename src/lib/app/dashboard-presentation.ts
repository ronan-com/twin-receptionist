import type { AttentionItem } from "./business-logic";
import type { Appointment, CallListRow } from "./types";

/** Presentation only. Never infer a successful connection or change stored records. */
export function customerAttention(
  item: AttentionItem,
  calls: CallListRow[],
): AttentionItem {
  if (item.kind === "call") {
    const call = calls.find((c) => c.id === item.search?.call);
    const caller =
      call?.contact?.full_name || call?.from_number || "This caller";
    return {
      ...item,
      detail: `${caller}. Review the call and check whether a callback is needed.`,
    };
  }
  if (item.kind === "sync" && !item.search?.booking) {
    return {
      ...item,
      detail:
        "Updates may not be reaching this connected tool. Review the connection to see what needs fixing.",
    };
  }
  return item;
}

export function splitAttention(items: AttentionItem[]) {
  return {
    tasks: items.filter(
      (i) =>
        i.kind !== "number" &&
        (i.kind !== "sync" || Boolean(i.search?.booking)),
    ),
    connections: items.filter(
      (i) => i.kind === "number" || (i.kind === "sync" && !i.search?.booking),
    ),
  };
}

export function upcomingAppointments<
  T extends Pick<Appointment, "starts_at" | "status">,
>(rows: T[], now: Date, limit = 3): T[] {
  return rows
    .filter(
      (a) =>
        (a.status === "confirmed" || a.status === "pending") &&
        new Date(a.starts_at).getTime() >= now.getTime(),
    )
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    )
    .slice(0, limit);
}
