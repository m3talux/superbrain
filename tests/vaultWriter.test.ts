import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { writeNote, softDelete } from "../src/vaultWriter";

beforeEach(() => {
  process.env.SUPERBRAIN_VAULT = "/tmp/sb-vault";
  fs.rmSync("/tmp/sb-vault", { recursive: true, force: true });
});

describe("vaultWriter", () => {
  it("creates a note with validated frontmatter", () => {
    const r = writeNote("projects/x.md", { frontmatter: { type: "project", status: "active" }, body: "# X", mode: "create" });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync("/tmp/sb-vault/projects/x.md", "utf8")).toContain("type: project");
  });
  it("rejects disallowed extension and path traversal", () => {
    expect(writeNote("projects/x.exe", { frontmatter: { type: "project", status: "active" }, body: "", mode: "create" }).ok).toBe(false);
    expect(writeNote("../escape.md", { frontmatter: { type: "project", status: "active" }, body: "", mode: "create" }).ok).toBe(false);
  });
  it("rejects invalid frontmatter", () => {
    expect(writeNote("projects/y.md", { frontmatter: { type: "nope" }, body: "", mode: "create" }).ok).toBe(false);
  });
  it("appends without clobbering and never overwrites in append mode", () => {
    writeNote("daily/2026-05-19.md", { frontmatter: { type: "daily" }, body: "first", mode: "create" });
    writeNote("daily/2026-05-19.md", { frontmatter: { type: "daily" }, body: "second", mode: "append" });
    const t = fs.readFileSync("/tmp/sb-vault/daily/2026-05-19.md", "utf8");
    expect(t).toContain("first"); expect(t).toContain("second");
  });
  it("dirty guard: appends instead of clobbering a user-edited note", () => {
    writeNote("projects/z.md", { frontmatter: { type: "project", status: "active" }, body: "orig", mode: "create" });
    fs.appendFileSync("/tmp/sb-vault/projects/z.md", "\nUSER EDIT\n");
    const r = writeNote("projects/z.md", { frontmatter: { type: "project", status: "active" }, body: "machine", mode: "create" });
    expect(r.ok).toBe(true);
    const t = fs.readFileSync("/tmp/sb-vault/projects/z.md", "utf8");
    expect(t).toContain("USER EDIT");
    expect(t).toContain("machine");
  });
  it("soft-deletes into .trash", () => {
    writeNote("capture/c.md", { frontmatter: { type: "capture", status: "active" }, body: "x", mode: "create" });
    softDelete("capture/c.md");
    expect(fs.existsSync("/tmp/sb-vault/capture/c.md")).toBe(false);
    expect(fs.readdirSync("/tmp/sb-vault/.trash").length).toBe(1);
  });
});
