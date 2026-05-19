import { it, expect } from "vitest";
import { validateFrontmatter } from "../src/frontmatter";

it("accepts lesson with status and preference without status", () => {
  expect(validateFrontmatter({ type: "lesson", status: "active", created: "2026-05-19" })).toEqual([]);
  expect(validateFrontmatter({ type: "preference", created: "2026-05-19" })).toEqual([]);
});

it("still rejects unknown type and missing status on status-required types", () => {
  expect(validateFrontmatter({ type: "bogus" }).length).toBeGreaterThan(0);
  expect(validateFrontmatter({ type: "decision" }).some((e) => e.includes("status"))).toBe(true);
});
