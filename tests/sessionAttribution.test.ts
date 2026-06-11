import { it, expect } from "vitest";
import { parentSessionId, attributionFields } from "../src/sessionAttribution.js";

it("parentSessionId returns trimmed value when set", () => {
  expect(parentSessionId({ SUPERBRAIN_PARENT_SESSION_ID: "  P  " })).toBe("P");
});
it("parentSessionId returns undefined when unset/blank", () => {
  expect(parentSessionId({})).toBeUndefined();
  expect(parentSessionId({ SUPERBRAIN_PARENT_SESSION_ID: "" })).toBeUndefined();
  expect(parentSessionId({ SUPERBRAIN_PARENT_SESSION_ID: "   " })).toBeUndefined();
});
it("attributionFields is additive and a no-op when absent", () => {
  expect(attributionFields({ SUPERBRAIN_PARENT_SESSION_ID: "P" })).toEqual({ parent_session_id: "P" });
  expect(attributionFields({})).toEqual({});
  expect({ a: 1, ...attributionFields({}) }).toEqual({ a: 1 });
});
