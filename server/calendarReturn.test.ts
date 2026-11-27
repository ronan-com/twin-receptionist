import { describe, expect, test } from "bun:test";
import { safeReturn, withOutcome } from "./connect";

// Where the browser lands after a calendar sign-in: the client dashboard, or the agency's receptionist editor.
describe("calendar sign-in return", () => {
  test("keeps app and admin paths, and the editor's tab", () => {
    expect(safeReturn("/app/integrations")).toBe("/app/integrations");
    expect(safeReturn("/admin/clients/abc-123")).toBe("/admin/clients/abc-123");
    expect(safeReturn("/admin/receptionists/abc-123?tab=booking")).toBe("/admin/receptionists/abc-123?tab=booking");
  });
  test("drops anything else", () => {
    for (const bad of ["https://evil.example/x", "//evil.example", "/other/page", "/admin/x?next=http://evil", "/admin/x?tab=a&b=c", undefined]) expect(safeReturn(bad)).toBeUndefined();
  });
  test("adds the outcome with ? or & as needed", () => {
    expect(withOutcome("/app/integrations", "calendar=1")).toBe("/app/integrations?calendar=1");
    expect(withOutcome("/admin/receptionists/abc?tab=booking", "calendar=1")).toBe("/admin/receptionists/abc?tab=booking&calendar=1");
    expect(withOutcome("/admin/receptionists/abc?tab=booking", "error=x")).toBe("/admin/receptionists/abc?tab=booking&error=x");
  });
});
