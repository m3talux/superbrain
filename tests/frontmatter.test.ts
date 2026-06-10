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

  it("does not throw when writing without type", () => {
    const out = serializeNote({ created: "2026-05-22", project: "superbrain" }, "body");
    expect(out).toContain("project: superbrain");
  });

  it("does not throw when writing type=project without project field", () => {
    expect(() => serializeNote({ type: "project", created: "2026-05-22", status: "active" }, "body")).not.toThrow();
    expect(() => serializeNote({ type: "daily", date: "2026-05-22" }, "body")).not.toThrow();
    expect(() => serializeNote({ type: "decision", created: "2026-05-22", status: "active" }, "body")).not.toThrow();
    expect(() => serializeNote({ type: "preference", created: "2026-05-22" }, "body")).not.toThrow();
  });

  it("parseNote normalizes wikilink project ([['projects/alpha-proj']]) to string", () => {
    const raw = "---\ntype: project\nstatus: active\nproject:\n  - - projects/alpha-proj\n---\n\nbody";
    const { data } = parseNote(raw);
    expect(data.project).toBe("projects/alpha-proj");
  });

  it("serializeNote on note missing type does not throw and returns markdown", () => {
    const out = serializeNote({ status: "active" }, "some body");
    expect(typeof out).toBe("string");
    expect(out).toContain("status: active");
    expect(out).toContain("some body");
  });

  it("normalizes a quoted date when reading", () => {
    const { data } = parseNote("---\ncreated: '2026-05-22'\ntype: decision\nproject: superbrain\n---\nbody");
    expect(data.created).toBe("2026-05-22");
    expect(typeof data.created).toBe("string");
  });

  it("accepts session_id and agent_role on every note type", () => {
    expect(validateFrontmatter({ type: "lesson", status: "active", created: "2026-05-19", session_id: "S1", agent_role: "engineer" })).toEqual([]);
    expect(validateFrontmatter({ type: "decision", status: "active", created: "2026-05-19", session_id: "S1", agent_role: "engineer" })).toEqual([]);
    expect(validateFrontmatter({ type: "capture", status: "active", created: "2026-05-19", session_id: "S1", agent_role: "engineer" })).toEqual([]);
    expect(validateFrontmatter({ type: "preference", created: "2026-05-19", session_id: "S1" })).toEqual([]);
  });

  it("still rejects a non-serializable attribution value", () => {
    const errs = validateFrontmatter({ type: "lesson", status: "active", created: "2026-05-19", session_id: (() => 1) as any });
    expect(errs.join(" ")).toMatch(/session_id/);
  });

  it("existing notes without attribution remain valid", () => {
    expect(validateFrontmatter({ type: "decision", status: "active", created: "2026-05-19" })).toEqual([]);
  });

  it("serializes and round-trips session_id and agent_role unquoted", () => {
    const out = serializeNote({ type: "lesson", status: "active", created: "2026-05-19", session_id: "S1", agent_role: "engineer" }, "body");
    expect(out).toMatch(/^session_id: S1$/m);
    expect(out).toMatch(/^agent_role: engineer$/m);
    const { data } = parseNote(out);
    expect(data.session_id).toBe("S1");
    expect(data.agent_role).toBe("engineer");
  });
});
