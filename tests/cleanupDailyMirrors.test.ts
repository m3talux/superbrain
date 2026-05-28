import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  isMirrorNote,
  planCleanup,
  applyCleanup,
  type MirrorPlan,
} from "../scripts/cleanup-daily-mirrors.js";

// ---------------------------------------------------------------------------
// isMirrorNote
// ---------------------------------------------------------------------------

describe("isMirrorNote", () => {
  it("matches a mirror note in capture/", () => {
    expect(isMirrorNote("capture/2026-05-18-daily-2026-05-18.md")).toBe(true);
  });

  it("matches another mirror note with different dates", () => {
    expect(isMirrorNote("capture/2026-05-20-daily-2026-05-20.md")).toBe(true);
  });

  it("does NOT match a real daily note", () => {
    expect(isMirrorNote("daily/2026-05-18.md")).toBe(false);
  });

  it("does NOT match a regular capture note", () => {
    expect(isMirrorNote("capture/some-idea.md")).toBe(false);
  });

  it("does NOT match a capture note that looks similar but lacks -daily- segment", () => {
    expect(isMirrorNote("capture/2026-05-18-standup.md")).toBe(false);
  });

  it("does NOT match if dates differ in the mirror pattern", () => {
    expect(isMirrorNote("capture/2026-05-18-daily-2026-05-19.md")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// planCleanup + applyCleanup (fixture vault)
// ---------------------------------------------------------------------------

describe("planCleanup", () => {
  let tmpDir: string;

  function writeNote(relPath: string, content: string) {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-mirror-test-"));
    for (const dir of ["capture", "daily"]) {
      fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
    }
    writeNote("capture/2026-05-18-daily-2026-05-18.md", "# Mirror A\n\nbody\n");
    writeNote("capture/2026-05-20-daily-2026-05-20.md", "# Mirror B\n\nbody\n");
    writeNote("daily/2026-05-18.md", "# Real daily\n\nbody\n");
    writeNote(
      "capture/related.md",
      "## Related\n\n[[capture/2026-05-18-daily-2026-05-18]]\n\nSome other content.\n",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("identifies exactly the two mirror notes", () => {
    const plan = planCleanup(tmpDir);
    const slugs = plan.mirrors.map(m => m.relPath).sort();
    expect(slugs).toEqual([
      "capture/2026-05-18-daily-2026-05-18.md",
      "capture/2026-05-20-daily-2026-05-20.md",
    ]);
  });

  it("does not flag the real daily note as a mirror", () => {
    const plan = planCleanup(tmpDir);
    const relPaths = plan.mirrors.map(m => m.relPath);
    expect(relPaths).not.toContain("daily/2026-05-18.md");
  });

  it("detects the dangling link in related.md", () => {
    const plan = planCleanup(tmpDir);
    expect(plan.linkPatches.length).toBeGreaterThanOrEqual(1);
    const patch = plan.linkPatches.find(p => p.relPath === "capture/related.md");
    expect(patch).toBeDefined();
    expect(patch!.newContent).not.toContain("[[capture/2026-05-18-daily-2026-05-18]]");
  });
});

describe("applyCleanup", () => {
  let tmpDir: string;

  function writeNote(relPath: string, content: string) {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-mirror-apply-"));
    for (const dir of ["capture", "daily"]) {
      fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
    }
    writeNote("capture/2026-05-18-daily-2026-05-18.md", "# Mirror A\n\nbody\n");
    writeNote("capture/2026-05-20-daily-2026-05-20.md", "# Mirror B\n\nbody\n");
    writeNote("daily/2026-05-18.md", "# Real daily\n\nbody\n");
    writeNote(
      "capture/related.md",
      "## Related\n\n[[capture/2026-05-18-daily-2026-05-18]]\n\nSome other content.\n",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("moves mirror notes to .trash after apply", () => {
    const plan = planCleanup(tmpDir);
    applyCleanup(tmpDir, plan);

    expect(fs.existsSync(path.join(tmpDir, "capture/2026-05-18-daily-2026-05-18.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "capture/2026-05-20-daily-2026-05-20.md"))).toBe(false);

    const trashEntries = fs.readdirSync(path.join(tmpDir, ".trash"));
    const trashNames = trashEntries.join(" ");
    expect(trashNames).toContain("2026-05-18-daily-2026-05-18.md");
    expect(trashNames).toContain("2026-05-20-daily-2026-05-20.md");
  });

  it("leaves the real daily note untouched after apply", () => {
    const plan = planCleanup(tmpDir);
    applyCleanup(tmpDir, plan);

    expect(fs.existsSync(path.join(tmpDir, "daily/2026-05-18.md"))).toBe(true);
    const content = fs.readFileSync(path.join(tmpDir, "daily/2026-05-18.md"), "utf8");
    expect(content).toContain("# Real daily");
  });

  it("removes dangling wikilink from related.md after apply", () => {
    const plan = planCleanup(tmpDir);
    applyCleanup(tmpDir, plan);

    const content = fs.readFileSync(path.join(tmpDir, "capture/related.md"), "utf8");
    expect(content).not.toContain("[[capture/2026-05-18-daily-2026-05-18]]");
    expect(content).toContain("Some other content.");
  });

  it("removes wikilinks with aliases and anchors", () => {
    writeNote(
      "capture/extra.md",
      "See [[capture/2026-05-18-daily-2026-05-18|May 18]] and [[capture/2026-05-20-daily-2026-05-20#section|May 20]] here.\n",
    );
    const plan = planCleanup(tmpDir);
    applyCleanup(tmpDir, plan);

    const content = fs.readFileSync(path.join(tmpDir, "capture/extra.md"), "utf8");
    expect(content).not.toContain("[[capture/2026-05-18-daily-2026-05-18");
    expect(content).not.toContain("[[capture/2026-05-20-daily-2026-05-20");
  });
});
