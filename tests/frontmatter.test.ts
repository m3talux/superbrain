import { describe, it, expect } from "vitest";
import { parseNote, serializeNote, validateFrontmatter } from "../src/frontmatter";

describe("frontmatter", () => {
  it("round-trips frontmatter + body", () => {
    const raw = "---\ntype: project\nstatus: active\n---\n\n# Hi\n";
    const { data, content } = parseNote(raw);
    expect(data.type).toBe("project");
    const out = serializeNote(data, content.trim());
    expect(out).toContain("type: project");
    expect(out).toContain("# Hi");
  });
  it("validates required keys and enum", () => {
    expect(validateFrontmatter({ type: "project", status: "active" })).toEqual([]);
    const errs = validateFrontmatter({ type: "bogus" });
    expect(errs.join(" ")).toMatch(/status/);
    expect(errs.join(" ")).toMatch(/type/);
  });
  it("rejects non-serializable values", () => {
    const errs = validateFrontmatter({ type: "project", status: "active", x: () => 1 });
    expect(errs.join(" ")).toMatch(/x/);
  });
});
