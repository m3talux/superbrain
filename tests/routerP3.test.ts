import { it, expect } from "vitest";
import { route } from "../src/router";

it("routes a lesson to lessons/ as create with Why and Rule", () => {
  const r = route({ kind: "lesson", title: "Prefer integration tests", body: "User reverted unit-only test.", rule: "Default to integration tests over unit.", date: "2026-05-19", links: ["SuperBrain"] });
  expect(r.relPath).toBe("lessons/2026-05-19-prefer-integration-tests.md");
  expect(r.mode).toBe("create");
  expect(r.frontmatter.type).toBe("lesson");
  expect(r.frontmatter.status).toBe("active");
  expect(r.body).toContain("**Why:**");
  expect(r.body).toContain("**Rule:** Default to integration tests over unit.");
  expect(r.body).toContain("[[SuperBrain]]");
});

it("lesson without rule omits the Rule line", () => {
  const r = route({ kind: "lesson", title: "X", body: "incident", date: "2026-05-19", links: [] });
  expect(r.body).not.toContain("**Rule:**");
});

it("routes a preference to meta/preferences.md as replace, body is the item body verbatim", () => {
  const doc = "## Code\n- No inline comments\n\n## Tests\n- Integration over unit";
  const r = route({ kind: "preference", title: "preferences", body: doc, date: "2026-05-19", links: [] });
  expect(r.relPath).toBe("meta/preferences.md");
  expect(r.mode).toBe("replace");
  expect(r.frontmatter.type).toBe("preference");
  expect(r.frontmatter.status).toBeUndefined();
  expect(r.body).toBe(doc);
});
