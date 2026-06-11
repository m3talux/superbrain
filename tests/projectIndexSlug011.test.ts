import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  projectOfNote,
  collectProjectNotes,
  enumerateProjectSlugs,
} from "../src/projectIndex";
import { slug } from "../src/router";
import { reconcile } from "../src/indexer";
import { parseNote } from "../src/frontmatter";

let TMP: string;
let TMP_DATA: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pidx011-vault-"));
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pidx011-data-"));
  process.env.SUPERBRAIN_VAULT_DIR = TMP;
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  fs.mkdirSync(path.join(TMP, "projects"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "decisions"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "maps"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_VAULT_DIR;
  delete process.env.SUPERBRAIN_DATA_DIR;
});

describe("projectIndex slug normalization (011)", () => {
  it("projectOfNote slugifies a non-conformant frontmatter project value", () => {
    expect(projectOfNote("decisions/2026-06-11-hand.md", { project: "Foo Bar!" }))
      .toBe(slug("Foo Bar!"));
  });

  it("collectProjectNotes finds a hand-authored note under the slugified key", () => {
    fs.writeFileSync(
      path.join(TMP, "decisions/2026-06-11-hand.md"),
      "---\ntype: decision\nstatus: active\nproject: \"Foo Bar!\"\n---\n# 2026-06-11 — Hand\n\nbody",
    );
    const notes = collectProjectNotes(TMP, "foo-bar");
    expect(notes.length).toBe(1);
    expect(notes[0].relPath).toBe("decisions/2026-06-11-hand.md");
  });

  it("enumerateProjectSlugs emits only the slugified key, never the raw value", () => {
    fs.writeFileSync(
      path.join(TMP, "decisions/2026-06-11-hand.md"),
      "---\ntype: decision\nstatus: active\nproject: \"Foo Bar!\"\n---\n# 2026-06-11 — Hand\n\nbody",
    );
    const slugs = enumerateProjectSlugs(TMP);
    expect(slugs).toContain("foo-bar");
    expect(slugs).not.toContain("foo bar!");
  });

  it("a non-slug-conformant project filename enumerates as its slug", () => {
    fs.writeFileSync(
      path.join(TMP, "projects/Foo Bar.md"),
      "---\ntype: project\nstatus: active\n---\n# Foo Bar\n",
    );
    const slugs = enumerateProjectSlugs(TMP);
    expect(slugs).toContain("foo-bar");
    expect(slugs).not.toContain("foo bar");
  });

  it("CONTROL: a pre-slugified note is unaffected (still found)", () => {
    fs.writeFileSync(
      path.join(TMP, "decisions/2026-06-11-pre.md"),
      "---\ntype: decision\nstatus: active\nproject: foo-bar\n---\n# 2026-06-11 — Pre\n\nbody",
    );
    expect(collectProjectNotes(TMP, "foo-bar").length).toBe(1);
  });

  it("dir-derived fallback slugifies the project filename", () => {
    fs.writeFileSync(
      path.join(TMP, "projects/Foo Bar.md"),
      "---\ntype: project\nstatus: active\n---\n# Foo Bar\n",
    );
    expect(projectOfNote("projects/Foo Bar.md", {})).toBe("foo-bar");
  });
});

describe("projectIndex reconcile slug normalization (011)", () => {
  beforeEach(() => {
    process.env.SUPERBRAIN_EMBED_STUB = "1";
  });

  afterEach(() => {
    delete process.env.SUPERBRAIN_EMBED_STUB;
  });

  it("reconcile keys the index file on the slugified project (no wrong-slug file)", async () => {
    fs.writeFileSync(
      path.join(TMP, "decisions/2026-06-11-hand.md"),
      "---\ntype: decision\nstatus: active\nproject: \"Foo Bar!\"\n---\n# 2026-06-11 — Hand\n\nbody",
    );
    await reconcile();
    expect(fs.existsSync(path.join(TMP, "maps/foo-bar-index.md"))).toBe(true);
    expect(fs.existsSync(path.join(TMP, "maps/foo bar!-index.md"))).toBe(false);
    const { content } = parseNote(
      fs.readFileSync(path.join(TMP, "maps/foo-bar-index.md"), "utf8"),
    );
    expect(content).toContain("[[decisions/2026-06-11-hand]]");
  });
});
