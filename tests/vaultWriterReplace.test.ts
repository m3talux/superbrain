import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { writeNote } from "../src/vaultWriter";
import { parseNote } from "../src/frontmatter";

beforeEach(() => {
  fs.rmSync("/tmp/sb-vwr", { recursive: true, force: true });
  process.env.SUPERBRAIN_VAULT = "/tmp/sb-vwr";
});

it("replace creates when absent", () => {
  const r = writeNote("meta/preferences.md", { frontmatter: { type: "preference", created: "2026-05-19", updated: "2026-05-19" }, body: "- a", mode: "replace" });
  expect(r.ok).toBe(true);
  expect(parseNote(fs.readFileSync("/tmp/sb-vwr/meta/preferences.md", "utf8")).content.trim()).toBe("- a");
});

it("replace overwrites (not appends) and preserves created", () => {
  writeNote("meta/preferences.md", { frontmatter: { type: "preference", created: "2026-05-01", updated: "2026-05-01" }, body: "- a", mode: "replace" });
  writeNote("meta/preferences.md", { frontmatter: { type: "preference", created: "2026-05-19", updated: "2026-05-19" }, body: "- b", mode: "replace" });
  const p = parseNote(fs.readFileSync("/tmp/sb-vwr/meta/preferences.md", "utf8"));
  expect(p.content).toContain("- b");
  expect(p.content).not.toContain("- a");
  expect(p.content).not.toMatch(/## \d{4}-\d\d-\d\d \d\d:\d\d/);
  expect(p.data.created).toBe("2026-05-01");
});

it("replace no-ops when normalized body unchanged (mtime stable)", () => {
  writeNote("meta/preferences.md", { frontmatter: { type: "preference", created: "2026-05-19", updated: "2026-05-19" }, body: "- a\n", mode: "replace" });
  const m1 = fs.statSync("/tmp/sb-vwr/meta/preferences.md").mtimeMs;
  const r = writeNote("meta/preferences.md", { frontmatter: { type: "preference", created: "2026-05-19", updated: "2026-05-20" }, body: "  - a  ", mode: "replace" });
  const m2 = fs.statSync("/tmp/sb-vwr/meta/preferences.md").mtimeMs;
  expect(r.ok).toBe(true);
  expect(m2).toBe(m1);
});

it("create/append modes still behave as before (regression guard)", () => {
  writeNote("projects/x.md", { frontmatter: { type: "project", status: "active", created: "2026-05-19" }, body: "first", mode: "create" });
  writeNote("projects/x.md", { frontmatter: { type: "project", status: "active", created: "2026-05-19" }, body: "second", mode: "append" });
  const c = fs.readFileSync("/tmp/sb-vwr/projects/x.md", "utf8");
  expect(c).toContain("first");
  expect(c).toContain("second");
  expect(c).toMatch(/## \d{4}-\d\d-\d\d \d\d:\d\d/);
});

it("replace does not throw when created is absent on both sides", () => {
  // First create a present file WITHOUT a created field.
  writeNote("meta/preferences.md", { frontmatter: { type: "preference" }, body: "- a", mode: "replace" });
  // Re-replace, also without created — must not throw, must succeed.
  const r = writeNote("meta/preferences.md", { frontmatter: { type: "preference" }, body: "- b", mode: "replace" });
  expect(r.ok).toBe(true);
  const c = fs.readFileSync("/tmp/sb-vwr/meta/preferences.md", "utf8");
  expect(c).toContain("- b");
});
