import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeNote, softDelete } from "../src/vaultWriter";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-vault-"));
  process.env.SUPERBRAIN_VAULT_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("vaultWriter", () => {
  it("creates a note with validated frontmatter", () => {
    const r = writeNote("projects/x.md", { frontmatter: { type: "project", status: "active", project: "x" }, body: "# X", mode: "create" });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(TMP, "projects/x.md"), "utf8")).toContain("type: project");
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
    const t = fs.readFileSync(path.join(TMP, "daily/2026-05-19.md"), "utf8");
    expect(t).toContain("first"); expect(t).toContain("second");
  });
  it("dirty guard: appends instead of clobbering a user-edited note", () => {
    writeNote("projects/z.md", { frontmatter: { type: "project", status: "active", project: "z" }, body: "orig", mode: "create" });
    fs.appendFileSync(path.join(TMP, "projects/z.md"), "\nUSER EDIT\n");
    const r = writeNote("projects/z.md", { frontmatter: { type: "project", status: "active", project: "z" }, body: "machine", mode: "create" });
    expect(r.ok).toBe(true);
    const t = fs.readFileSync(path.join(TMP, "projects/z.md"), "utf8");
    expect(t).toContain("USER EDIT");
    expect(t).toContain("machine");
  });
  it("soft-deletes into .trash", () => {
    writeNote("capture/c.md", { frontmatter: { type: "capture", status: "active" }, body: "x", mode: "create" });
    softDelete("capture/c.md");
    expect(fs.existsSync(path.join(TMP, "capture/c.md"))).toBe(false);
    expect(fs.readdirSync(path.join(TMP, ".trash")).length).toBe(1);
  });
  it("append: skips duplicate body that already appears in the file", () => {
    const fm = { type: "project", status: "active", project: "jarvis" };
    const body = "**SuperBrain v0.5 multi-tenancy is the hard prerequisite gate for Jarvis v0.1** — User explicitly established this sequencing in a planning conversation.";
    writeNote("projects/jarvis.md", { frontmatter: fm, body, mode: "create" });
    const first = fs.readFileSync(path.join(TMP, "projects/jarvis.md"), "utf8");
    const r = writeNote("projects/jarvis.md", { frontmatter: fm, body, mode: "append" });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("duplicate-skipped");
    const second = fs.readFileSync(path.join(TMP, "projects/jarvis.md"), "utf8");
    expect(second).toBe(first);
  });
  it("append: still writes when body differs from existing content", () => {
    const fm = { type: "project", status: "active", project: "jarvis" };
    writeNote("projects/jarvis.md", { frontmatter: fm, body: "fact one with enough words to clear the dedup threshold", mode: "create" });
    const r = writeNote("projects/jarvis.md", { frontmatter: fm, body: "fact two also with enough unique words for dedup", mode: "append" });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
    const text = fs.readFileSync(path.join(TMP, "projects/jarvis.md"), "utf8");
    expect(text).toContain("fact one");
    expect(text).toContain("fact two");
  });
  it("append: dedup is whitespace-insensitive", () => {
    const fm = { type: "project", status: "active", project: "jarvis" };
    writeNote("projects/jarvis.md", { frontmatter: fm, body: "the   precise wording   matters here for the dedup match", mode: "create" });
    const r = writeNote("projects/jarvis.md", { frontmatter: fm, body: "the precise wording matters here for the dedup match", mode: "append" });
    expect(r.reason).toBe("duplicate-skipped");
  });
  it("append: does not dedup very short bodies (avoids false positives)", () => {
    const fm = { type: "project", status: "active", project: "jarvis" };
    writeNote("projects/jarvis.md", { frontmatter: fm, body: "short note", mode: "create" });
    const r = writeNote("projects/jarvis.md", { frontmatter: fm, body: "short note", mode: "append" });
    expect(r.reason).toBeUndefined();
  });
  it("rejects writes into excluded folders regardless of path separator style", () => {
    // These already pass on Linux/macOS because path.resolve uses forward slashes.
    // After the fix they also pass on Windows where path.resolve uses backslashes.
    expect(writeNote(".obsidian/note.md", { frontmatter: { type: "project", status: "active" }, body: "", mode: "create" }).ok).toBe(false);
    expect(writeNote(".git/HEAD.md", { frontmatter: { type: "project", status: "active" }, body: "", mode: "create" }).ok).toBe(false);
    expect(writeNote("subdir/.trash/x.md", { frontmatter: { type: "project", status: "active" }, body: "", mode: "create" }).ok).toBe(false);
  });

  it("project append stays under the 32KB hard ceiling even from a legacy-H2-only note", () => {
    const fm = { type: "project", status: "active", project: "big" };
    let seed = "# Big\n\n## What it is\n\nx\n\n## Recent activity\n";
    for (let i = 0; i < 130; i++) {
      const day = String((i % 27) + 1).padStart(2, "0");
      seed += `\n## 2026-05-${day} 09:0${i % 10}\n\n${"q".repeat(450)}\n`;
    }
    fs.mkdirSync(path.join(TMP, "projects"), { recursive: true });
    fs.writeFileSync(
      path.join(TMP, "projects/big.md"),
      `---\ntype: project\nstatus: active\nproject: big\n---\n\n${seed}`,
    );
    expect(fs.statSync(path.join(TMP, "projects/big.md")).size).toBeGreaterThan(32 * 1024);

    const r = writeNote("projects/big.md", { frontmatter: fm, body: "a brand new distilled fact about the build", mode: "append" });
    expect(r.ok).toBe(true);

    const after = fs.statSync(path.join(TMP, "projects/big.md")).size;
    expect(after).toBeLessThanOrEqual(32 * 1024);
    const text = fs.readFileSync(path.join(TMP, "projects/big.md"), "utf8");
    expect(text).toContain("a brand new distilled fact about the build");
  });

  it("evicted project content lands in projects/_archive tagged with the project slug", () => {
    const fm = { type: "project", status: "active", project: "big2" };
    let seed = "# Big2\n\n## Recent activity\n";
    for (let i = 0; i < 130; i++) {
      const day = String((i % 27) + 1).padStart(2, "0");
      seed += `\n## 2026-05-${day} 09:0${i % 10}\n\n${"w".repeat(450)}\n`;
    }
    fs.mkdirSync(path.join(TMP, "projects"), { recursive: true });
    fs.writeFileSync(
      path.join(TMP, "projects/big2.md"),
      `---\ntype: project\nstatus: active\nproject: big2\n---\n\n${seed}`,
    );

    writeNote("projects/big2.md", { frontmatter: fm, body: "newest fact to force an archive write here", mode: "append" });

    const archiveDir = path.join(TMP, "projects/_archive");
    const files = fs.readdirSync(archiveDir).filter((f) => f.startsWith("big2-"));
    expect(files.length).toBeGreaterThan(0);
    const archive = fs.readFileSync(path.join(archiveDir, files[0]), "utf8");
    expect(archive).toMatch(/^---[\s\S]*\nproject: big2\n[\s\S]*---/m);
  });
});
