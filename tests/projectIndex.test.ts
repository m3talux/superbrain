import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildProjectIndex, projectIndexRelPath } from "../src/projectIndex";
import { parseNote } from "../src/frontmatter";

let TMP: string;
let TMP_DATA: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pidx-vault-"));
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pidx-data-"));
  process.env.SUPERBRAIN_VAULT_DIR = TMP;
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;

  fs.mkdirSync(path.join(TMP, "projects"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "decisions"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "lessons"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "maps"), { recursive: true });

  fs.writeFileSync(
    path.join(TMP, "projects/alpha.md"),
    "---\ntype: project\nstatus: active\nproject: alpha\n---\n# Alpha\n\n## Recent activity\n",
  );
  fs.writeFileSync(
    path.join(TMP, "decisions/2026-01-01-pick-raft.md"),
    "---\ntype: decision\nstatus: active\nproject: alpha\n---\n# 2026-01-01 — Pick raft\n\nchose raft",
  );
  fs.writeFileSync(
    path.join(TMP, "lessons/2026-01-02-verify-first.md"),
    "---\ntype: lesson\nstatus: active\nproject: alpha\n---\n# Verify first\n\n## Rule\n\nverify",
  );
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_VAULT_DIR;
  delete process.env.SUPERBRAIN_DATA_DIR;
});

describe("projectIndex", () => {
  it("writes maps/<slug>-index.md", () => {
    buildProjectIndex("alpha");
    expect(fs.existsSync(path.join(TMP, "maps/alpha-index.md"))).toBe(true);
  });

  it("frontmatter marks ownership", () => {
    buildProjectIndex("alpha");
    const raw = fs.readFileSync(path.join(TMP, "maps/alpha-index.md"), "utf8");
    const { data } = parseNote(raw);
    expect(data.type).toBe("map");
    expect(data.project).toBe("alpha");
    expect(data.superbrain).toBe(true);
    expect(data.generated).toBe(true);
  });

  it("groups by type with wikilink and hook", () => {
    buildProjectIndex("alpha");
    const raw = fs.readFileSync(path.join(TMP, "maps/alpha-index.md"), "utf8");
    const { content } = parseNote(raw);
    expect(content).toContain("## Decisions");
    expect(content).toContain("- [[decisions/2026-01-01-pick-raft]] — 2026-01-01 — Pick raft");
    expect(content).toContain("## Lessons");
    expect(content).toContain("- [[lessons/2026-01-02-verify-first]] — Verify first");
  });

  it("excludes archived decision (indexed type) at every depth", () => {
    fs.mkdirSync(path.join(TMP, "projects/_archive"), { recursive: true });
    fs.writeFileSync(
      path.join(TMP, "projects/_archive/pick-raft-archived.md"),
      "---\ntype: decision\nstatus: active\nproject: alpha\n---\n# Archived decision\n\nshould not appear",
    );
    buildProjectIndex("alpha");
    const raw = fs.readFileSync(path.join(TMP, "maps/alpha-index.md"), "utf8");
    const { content } = parseNote(raw);
    expect(content).not.toContain("pick-raft-archived");
  });

  it("excludes archive, self, and other projects", () => {
    fs.mkdirSync(path.join(TMP, "projects/_archive"), { recursive: true });
    fs.writeFileSync(
      path.join(TMP, "projects/_archive/alpha-2026-Q1.md"),
      "---\ntype: summary\nproject: alpha\n---\n# archive",
    );
    fs.writeFileSync(
      path.join(TMP, "decisions/2026-01-03-beta-thing.md"),
      "---\ntype: decision\nstatus: active\nproject: beta\n---\n# Beta thing",
    );
    fs.writeFileSync(
      path.join(TMP, "maps/alpha-index.md"),
      "---\ntype: map\nproject: alpha\nsuperbrain: true\ngenerated: true\n---\n# old index",
    );
    buildProjectIndex("alpha");
    const raw = fs.readFileSync(path.join(TMP, "maps/alpha-index.md"), "utf8");
    const { content } = parseNote(raw);
    expect(content).not.toContain("projects/_archive/alpha-2026-Q1");
    expect(content).not.toContain("2026-01-03-beta-thing");
    expect(content).not.toContain("maps/alpha-index");
  });

  it("deterministic, no LLM", () => {
    buildProjectIndex("alpha");
    const body1 = parseNote(fs.readFileSync(path.join(TMP, "maps/alpha-index.md"), "utf8")).content;
    buildProjectIndex("alpha");
    const body2 = parseNote(fs.readFileSync(path.join(TMP, "maps/alpha-index.md"), "utf8")).content;
    expect(body1).toBe(body2);
  });

  it("overwrites manual edits, never appends", () => {
    fs.writeFileSync(
      path.join(TMP, "maps/alpha-index.md"),
      "---\ntype: map\nproject: alpha\nsuperbrain: true\ngenerated: true\n---\n# Alpha — index\n\nMANUAL EDIT MARKER\n",
    );
    buildProjectIndex("alpha");
    const raw = fs.readFileSync(path.join(TMP, "maps/alpha-index.md"), "utf8");
    const { content } = parseNote(raw);
    expect(content).not.toContain("MANUAL EDIT MARKER");
    expect(content).not.toMatch(/## \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it("single-note project does not crash", () => {
    fs.mkdirSync(path.join(TMP, "projects"), { recursive: true });
    fs.writeFileSync(
      path.join(TMP, "projects/solo.md"),
      "---\ntype: project\nstatus: active\nproject: solo\n---\n# Solo\n",
    );
    expect(() => buildProjectIndex("solo")).not.toThrow();
    const raw = fs.readFileSync(path.join(TMP, "maps/solo-index.md"), "utf8");
    const { content } = parseNote(raw);
    expect(content).toContain("[[projects/solo]]");
  });
});
