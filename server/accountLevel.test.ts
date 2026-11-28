// Telnyx's "not permitted at this account level" becomes a message that says what to do.
import { expect, test } from "bun:test";
import { ACCOUNT_LEVEL_MSG, telnyxProblem } from "./telnyxProblem";

test("an account that isn't verified or upgraded enough is said plainly, whatever was being done", () => {
  expect(telnyxProblem("This feature is not permitted at this account level.")).toBe(ACCOUNT_LEVEL_MSG);
  expect(ACCOUNT_LEVEL_MSG).toMatch(/verification or an upgrade.*Account Level/);
  expect(telnyxProblem("Something else.")).toBe("The phone service said: Something else.");
});
