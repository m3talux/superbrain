import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  inferType,
  inferProject,
  normalizeFrontmatter,
  planBackfill,
} from "../scripts/backfill-frontmatter.js";

// ---------------------------------------------------------------------------
// inferType
// ---------------------------------------------------------------------------

describe("inferType", () => {
  it("decisions/ → decision", () => {
    expect(inferType("decisions/2026-05-20-foo.md")).toBe("decision");
  });

  it("lessons/ → lesson", () => {
    expect(inferType("lessons/2026-05-20-bar.md")).toBe("lesson");
  });

  it("capture/ → capture", () => {
    expect(inferType("capture/some-note.md")).toBe("capture");
  });

  it("projects/ → project", () => {
    expect(inferType("projects/my-project.md")).toBe("project");
  });

  it("projects/_archive/ → project", () => {
    expect(inferType("projects/_archive/my-project-2025-Q4.md")).toBe("project");
  });

  it("daily/ → daily", () => {
    expect(inferType("daily/2026-05-20.md")).toBe("daily");
  });

  it("people/ → person", () => {
    expect(inferType("people/jane-doe.md")).toBe("person");
  });

  it("meta/ → preference", () => {
    expect(inferType("meta/preferences.md")).toBe("preference");
  });

  it("unknown folder → null", () => {
    expect(inferType("random/note.md")).toBeNull();
  });

  it("top-level file → null", () => {
    expect(inferType("note.md")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// inferProject
// ---------------------------------------------------------------------------

describe("inferProject", () => {
  const knownProjects = ["superbrain", "weddy", "theweproject", "lean-ctx"];

  it("projects/ folder → basename as project slug", () => {
    expect(inferProject("projects/superbrain.md", "", knownProjects)).toBe("superbrain");
  });

  it("projects/_archive/ → basename prefix before -YYYY-Q*", () => {
    expect(inferProject("projects/_archive/weddy-2025-Q4.md", "", knownProjects)).toBe("weddy");
  });

  it("projects/_archive/ → basename prefix before -YYYY (no quarter)", () => {
    expect(inferProject("projects/_archive/lean-ctx-2025-Q1.md", "", knownProjects)).toBe("lean-ctx");
  });

  it("daily/ → no project (null)", () => {
    expect(inferProject("daily/2026-05-20.md", "", knownProjects)).toBeNull();
  });

  it("people/ → no project (null)", () => {
    expect(inferProject("people/jane.md", "", knownProjects)).toBeNull();
  });

  it("meta/ → no project (null)", () => {
    expect(inferProject("meta/preferences.md", "", knownProjects)).toBeNull();
  });

  it("decisions/ → global (not derived from body)", () => {
    const bodyWithSlug = "We decided to use TypeScript for theweproject frontend.";
    expect(inferProject("decisions/2026-05-20-foo.md", bodyWithSlug, knownProjects)).toBe("global");
  });

  it("lessons/ → global regardless of body content", () => {
    const bodyWithSlug = "Related to Superbrain indexing pipeline.";
    expect(inferProject("lessons/some-lesson.md", bodyWithSlug, knownProjects)).toBe("global");
  });

  it("capture/ body mentioning a slug → global (no body scan)", () => {
    const bodyWithSlug = "Working on lean-ctx today, got some ideas.";
    expect(inferProject("capture/idea.md", bodyWithSlug, knownProjects)).toBe("global");
  });

  it("capture/ body containing inject marker mentioning a project → global, not that project", () => {
    const bodyWithMarker = "<!-- superbrain:inject project=superbrain -->\nsome content about lean-ctx";
    expect(inferProject("capture/idea.md", bodyWithMarker, knownProjects)).toBe("global");
  });

  it("empty knownProjects → global", () => {
    expect(inferProject("decisions/foo.md", "some content", [])).toBe("global");
  });
});

// ---------------------------------------------------------------------------
// normalizeFrontmatter
// ---------------------------------------------------------------------------

describe("normalizeFrontmatter", () => {
  it("strips quotes from created date", () => {
    const raw = `---\ntype: decision\ncreated: '2026-05-22'\nproject: global\n---\n\nbody\n`;
    const result = normalizeFrontmatter(raw);
    expect(result.changed).toBe(true);
    expect(result.newRaw).toContain("created: 2026-05-22");
    expect(result.newRaw).not.toContain("'2026-05-22'");
  });

  it("strips quotes from date field", () => {
    const raw = `---\ntype: lesson\ndate: "2026-01-01"\n---\n\nbody\n`;
    const result = normalizeFrontmatter(raw);
    expect(result.changed).toBe(true);
    expect(result.newRaw).toContain("date: 2026-01-01");
  });

  it("strips quotes from last_touched field", () => {
    const raw = `---\ntype: capture\nlast_touched: '2025-12-31'\n---\n\nbody\n`;
    const result = normalizeFrontmatter(raw);
    expect(result.changed).toBe(true);
    expect(result.newRaw).toContain("last_touched: 2025-12-31");
  });

  it("strips quotes from updated field", () => {
    const raw = `---\ntype: lesson\nupdated: '2026-05-01'\n---\n\nbody\n`;
    const result = normalizeFrontmatter(raw);
    expect(result.changed).toBe(true);
    expect(result.newRaw).toContain("updated: 2026-05-01");
  });

  it("leaves already-bare dates unchanged", () => {
    const raw = `---\ntype: decision\ncreated: 2026-05-22\nproject: global\n---\n\nbody\n`;
    const result = normalizeFrontmatter(raw);
    expect(result.changed).toBe(false);
  });

  it("reports changes array for quoted dates", () => {
    const raw = `---\ntype: lesson\ncreated: '2026-05-22'\n---\n\nbody\n`;
    const result = normalizeFrontmatter(raw);
    expect(result.changes.some(c => c.field === "created")).toBe(true);
  });

  it("no changes when frontmatter is already clean", () => {
    const raw = `---\ntype: decision\ncreated: 2026-05-22\nproject: global\nstatus: active\n---\n\nbody\n`;
    const result = normalizeFrontmatter(raw);
    expect(result.changed).toBe(false);
    expect(result.changes).toHaveLength(0);
  });

  it("handles note with no frontmatter (returns unchanged)", () => {
    const raw = `# Just a heading\n\nsome content\n`;
    const result = normalizeFrontmatter(raw);
    expect(result.changed).toBe(false);
    expect(result.newRaw).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// planBackfill (fixture vault)
// ---------------------------------------------------------------------------

describe("planBackfill", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-test-"));
    // Create folder structure
    for (const dir of ["decisions", "lessons", "capture", "projects", "daily", "people", "meta", "projects/_archive"]) {
      fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeNote(relPath: string, content: string) {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  it("proposes adding type to a decision note missing it", () => {
    writeNote("decisions/2026-05-20-foo.md", `---\nproject: global\nstatus: active\n---\n\nbody\n`);
    const proposals = planBackfill(tmpDir);
    const p = proposals.find(p => p.file.includes("foo.md"));
    expect(p).toBeDefined();
    expect(p!.changes.some(c => c.field === "type" && c.value === "decision")).toBe(true);
  });

  it("proposes adding project to a decision note missing it", () => {
    writeNote("decisions/2026-05-20-bar.md", `---\ntype: decision\nstatus: active\n---\n\nbody\n`);
    const proposals = planBackfill(tmpDir);
    const p = proposals.find(p => p.file.includes("bar.md"));
    expect(p).toBeDefined();
    expect(p!.changes.some(c => c.field === "project")).toBe(true);
  });

  it("skips a note that already has all required fields with bare dates", () => {
    writeNote("decisions/2026-05-20-good.md", `---\ntype: decision\nproject: global\nstatus: active\ncreated: 2026-05-20\n---\n\nbody\n`);
    const proposals = planBackfill(tmpDir);
    const p = proposals.find(p => p.file.includes("good.md"));
    expect(p).toBeUndefined();
  });

  it("proposes date normalization for quoted dates", () => {
    writeNote("lessons/2026-05-19-lesson.md", `---\ntype: lesson\nstatus: active\ncreated: '2026-05-19'\n---\n\nsome lesson\n`);
    const proposals = planBackfill(tmpDir);
    const p = proposals.find(p => p.file.includes("lesson.md"));
    expect(p).toBeDefined();
    expect(p!.changes.some(c => c.field === "created")).toBe(true);
  });

  it("uses basename as project for projects/ folder notes", () => {
    writeNote("projects/myapp.md", `---\nstatus: active\n---\n\nbody\n`);
    const proposals = planBackfill(tmpDir);
    const p = proposals.find(p => p.file.includes("myapp.md"));
    expect(p).toBeDefined();
    expect(p!.changes.some(c => c.field === "type" && c.value === "project")).toBe(true);
    expect(p!.changes.some(c => c.field === "project" && c.value === "myapp")).toBe(true);
  });

  it("sets no project for daily/ notes", () => {
    writeNote("daily/2026-05-20.md", `---\n---\n\nbody\n`);
    const proposals = planBackfill(tmpDir);
    const p = proposals.find(p => p.file.includes("2026-05-20.md"));
    if (p) {
      expect(p.changes.some(c => c.field === "project")).toBe(false);
    }
  });

  it("sets no project for people/ notes", () => {
    writeNote("people/jane.md", `---\n---\n\nbody\n`);
    const proposals = planBackfill(tmpDir);
    const p = proposals.find(p => p.file.includes("jane.md"));
    if (p) {
      expect(p.changes.some(c => c.field === "project")).toBe(false);
    }
  });

  it("capture/ body mentioning a known project slug → project is global, not the slug", () => {
    writeNote("projects/superbrain.md", `---\ntype: project\nproject: superbrain\n---\n\n`);
    writeNote("capture/idea.md", `---\n---\n\nIdeas for Superbrain indexing.\n`);
    const proposals = planBackfill(tmpDir);
    const p = proposals.find(p => p.file.includes("idea.md"));
    expect(p).toBeDefined();
    expect(p!.changes.some(c => c.field === "project" && c.value === "global")).toBe(true);
    expect(p!.changes.some(c => c.field === "project" && c.value === "superbrain")).toBe(false);
  });

  it("capture/ body containing inject marker → project is global, not the marker's project", () => {
    writeNote("projects/superbrain.md", `---\ntype: project\nproject: superbrain\n---\n\n`);
    writeNote("capture/injected.md", `---\n---\n\n<!-- superbrain:inject project=superbrain -->\nsome content\n`);
    const proposals = planBackfill(tmpDir);
    const p = proposals.find(p => p.file.includes("injected.md"));
    expect(p).toBeDefined();
    expect(p!.changes.some(c => c.field === "project" && c.value === "global")).toBe(true);
    expect(p!.changes.some(c => c.field === "project" && c.value === "superbrain")).toBe(false);
  });

  it("returns no proposals for an empty vault", () => {
    const proposals = planBackfill(tmpDir);
    expect(proposals).toHaveLength(0);
  });

  it("handles _archive subfolder correctly", () => {
    writeNote("projects/_archive/weddy-2025-Q4.md", `---\nstatus: archived\n---\n\nbody\n`);
    const proposals = planBackfill(tmpDir);
    const p = proposals.find(p => p.file.includes("weddy-2025-Q4.md"));
    expect(p).toBeDefined();
    expect(p!.changes.some(c => c.field === "type" && c.value === "project")).toBe(true);
    expect(p!.changes.some(c => c.field === "project" && c.value === "weddy")).toBe(true);
  });
});
