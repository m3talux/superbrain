import { describe, it, expect } from "vitest";
import { parseNote, serializeNote, validateFrontmatter } from "../src/frontmatter";

describe("frontmatter", () => {
  it("round-trips frontmatter + body", () => {
    const raw = "---\ntype: project\nstatus: active\nproject: test-proj\n---\n\n# Hi\n";
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

  it("emits bare ISO dates (unquoted) on write", () => {
    const out = serializeNote({ created: "2026-05-22", type: "project", project: "superbrain", status: "active" }, "body");
    expect(out).toMatch(/^---\n[\s\S]*created: 2026-05-22\n[\s\S]*---/m);
    expect(out).not.toMatch(/created: '2026-05-22'/);
    expect(out).not.toMatch(/created: "2026-05-22"/);
  });

  it("throws when writing without type", () => {
    expect(() => serializeNote({ created: "2026-05-22", project: "superbrain" }, "body")).toThrow(/required: type/);
  });

  it("throws when writing type=project without project field", () => {
    expect(() => serializeNote({ type: "project", created: "2026-05-22", status: "active" }, "body")).toThrow(/required: project/);
    // Daily exempt (and other types without project: in their template):
    expect(() => serializeNote({ type: "daily", date: "2026-05-22" }, "body")).not.toThrow();
    expect(() => serializeNote({ type: "decision", created: "2026-05-22", status: "active" }, "body")).not.toThrow();
    expect(() => serializeNote({ type: "preference", created: "2026-05-22" }, "body")).not.toThrow();
  });

  it("normalizes a quoted date when reading", () => {
    const { data } = parseNote("---\ncreated: '2026-05-22'\ntype: decision\nproject: superbrain\n---\nbody");
    expect(data.created).toBe("2026-05-22");
    expect(typeof data.created).toBe("string");
  });
});
