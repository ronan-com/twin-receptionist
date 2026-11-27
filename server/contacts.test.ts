// Contacts: one contact per number (0491… and +61491… are the same), first name kept, cancelled/moved shown.
//   DATABASE_URL=postgres://unused@localhost/unused bun test server/contacts.test.ts
import { describe, expect, test } from "bun:test";
import { assembleContacts } from "./routes/workspaceMore";
import { outcomeOf } from "./routes/workspace";

const req = (id: string, at: string, over: any = {}): any => ({ id, kind: "booking", at, channel: "call", name: "", phone: "", service: "Consult", start: "2026-12-01T10:00:00+11:00", status: "booked", note: "", ...over });
const build = (requests: any[], notes: any[] = []) => assembleContacts({ requests, calls: [], chats: [], notes });

describe("contacts", () => {
  test("old local-format rows and new +61 rows are one contact, shown in +61", () => {
    // requests arrive newest first
    const list = build([
      req("b", "2026-11-20T00:00:00Z", { phone: "+61491570006", name: "Jo" }),
      req("a", "2026-11-10T00:00:00Z", { phone: "0491570006", name: "Jo" }),
    ]);
    expect(list.length).toBe(1);
    expect(list[0].phone).toBe("+61491570006");
    expect(list[0].counts.bookings).toBe(2);
  });
  test("the first known name is kept; later names appear in the timeline", () => {
    const list = build([
      req("c", "2026-11-22T00:00:00Z", { kind: "callback", status: "saved", phone: "+61491570006", name: "Jonathan" }),
      req("b", "2026-11-20T00:00:00Z", { phone: "+61491570006", name: "Joanne" }),
      req("a", "2026-11-10T00:00:00Z", { phone: "0491570006", name: "" }),
    ]);
    expect(list[0].name).toBe("Joanne");
    expect(list[0].timeline.some((e) => e.title.includes("(as Jonathan)"))).toBe(true);
  });
  test("a later name fills in when the contact had none", () => {
    const list = build([req("b", "2026-11-20T00:00:00Z", { phone: "+61491570006", name: "Jo" }), req("a", "2026-11-10T00:00:00Z", { phone: "0491570006" })]);
    expect(list[0].name).toBe("Jo");
  });
  test("cancelled and moved bookings are labelled", () => {
    const list = build([
      req("b", "2026-11-20T00:00:00Z", { phone: "+61491570006", status: "cancelled", apptStatus: "cancelled" }),
      req("a", "2026-11-10T00:00:00Z", { phone: "+61491570006", rescheduledFrom: "2026-11-30T09:00:00+11:00" }),
    ]);
    const titles = list[0].timeline.map((e) => e.title).join("|");
    expect(titles).toContain("(cancelled)");
    expect(titles).toContain("(moved)");
    expect(titles).toContain("moved from 2026-11-30 09:00");
  });
});

describe("call outcome", () => {
  const call: any = { from_number: "+61491570006", started_at: "2026-11-10T00:00:00Z", ended_at: "2026-11-10T00:05:00Z", outcome: "booked" };
  test("a call whose booking was cancelled is no longer booked", () => {
    expect(outcomeOf(call, [req("a", "2026-11-10T00:01:00Z", { status: "cancelled" })])).toBe("resolved");
    expect(outcomeOf(call, [req("a", "2026-11-10T00:01:00Z")])).toBe("booked");
    expect(outcomeOf({ ...call, outcome: null }, [req("a", "2026-11-10T00:01:00Z")])).toBe("booked");
  });
});
