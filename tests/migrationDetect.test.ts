import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectLegacyState } from "../src/migrationDetect.js";

let tmpDir: string;
let vaultDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-migdetect-"));
  vaultDir = path.join(tmpDir, "vault");
  dbPath = path.join(tmpDir, "index.db");
  // Create vault folder structure
  for (const dir of ["decisions", "lessons", "capture", "people", "meta", "daily", "projects"]) {
    fs.mkdirSync(path.join(vaultDir, dir), { recursive: true });
  }
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeNote(relPath: string, content: string) {
  const full = path.join(vaultDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

describe("detectLegacyState — frontmatterMissing", () => {
  it("returns 0 when vault is empty", async () => {
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.frontmatterMissing).toBe(0);
  });

  it("counts notes missing type field", async () => {
    writeNote("decisions/foo.md", "---\nproject: global\n---\n\nbody\n");
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.frontmatterMissing).toBeGreaterThanOrEqual(1);
  });

  it("counts notes missing project field (non-people folder)", async () => {
    writeNote("decisions/bar.md", "---\ntype: decision\n---\n\nbody\n");
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.frontmatterMissing).toBeGreaterThanOrEqual(1);
  });

  it("does not count notes with both type and project", async () => {
    writeNote("decisions/good.md", "---\ntype: decision\nproject: global\n---\n\nbody\n");
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.frontmatterMissing).toBe(0);
  });

  it("does not require project for people/ notes", async () => {
    writeNote("people/jane.md", "---\ntype: person\n---\n\nbody\n");
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.frontmatterMissing).toBe(0);
  });

  it("counts people/ notes missing type", async () => {
    writeNote("people/jane.md", "---\nstatus: active\n---\n\nbody\n");
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.frontmatterMissing).toBeGreaterThanOrEqual(1);
  });

  it("handles notes with no frontmatter at all", async () => {
    writeNote("capture/raw.md", "# Just a heading\n\nsome content\n");
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.frontmatterMissing).toBeGreaterThanOrEqual(1);
  });

  it("scans all 4 target folders", async () => {
    writeNote("decisions/d.md", "---\ntype: decision\n---\n\nbody\n"); // missing project
    writeNote("lessons/l.md", "---\ntype: lesson\n---\n\nbody\n");    // missing project
    writeNote("capture/c.md", "---\ntype: capture\n---\n\nbody\n");   // missing project
    writeNote("people/p.md", "---\nstatus: active\n---\n\nbody\n");   // missing type
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.frontmatterMissing).toBe(4);
  });

  it("does not scan daily/ or projects/ or meta/", async () => {
    writeNote("daily/2026-05-22.md", "# daily\n\nbody\n"); // no frontmatter, should be ignored
    writeNote("projects/myapp.md", "# project\n\nbody\n"); // ignored
    writeNote("meta/preferences.md", "# prefs\n\nbody\n"); // ignored
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.frontmatterMissing).toBe(0);
  });
});

describe("detectLegacyState — edgesEmpty", () => {
  it("returns edgesEmpty=true when db does not exist", async () => {
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.edgesEmpty).toBe(true);
  });

  it("returns edgesEmpty=true when vault is empty and no db", async () => {
    const state = await detectLegacyState(vaultDir, "/nonexistent/path.db");
    expect(state.edgesEmpty).toBe(true);
  });
});

describe("detectLegacyState — preferencesOverCap", () => {
  it("returns false when preferences.md does not exist", async () => {
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.preferencesOverCap).toBe(false);
  });

  it("returns false when preferences.md is under 5KB", async () => {
    writeNote("meta/preferences.md", "---\ntype: preference\n---\n\n" + "x".repeat(100));
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.preferencesOverCap).toBe(false);
  });

  it("returns true when preferences.md exceeds 5KB", async () => {
    writeNote("meta/preferences.md", "---\ntype: preference\n---\n\n" + "x".repeat(6000));
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.preferencesOverCap).toBe(true);
  });
});

describe("detectLegacyState — totalLegacyNotes", () => {
  it("returns 0 when vault is clean", async () => {
    // edgesEmpty will be true (no db), so total >= 1
    writeNote("decisions/good.md", "---\ntype: decision\nproject: global\n---\n\nbody\n");
    const state = await detectLegacyState(vaultDir, dbPath);
    // totalLegacyNotes = frontmatterMissing(0) + edgesEmpty(1) + preferencesOverCap(0) = 1
    expect(state.totalLegacyNotes).toBe(1);
    expect(state.frontmatterMissing).toBe(0);
  });

  it("sums all signals", async () => {
    writeNote("capture/missing.md", "# no frontmatter\n\nbody\n"); // frontmatter +1
    writeNote("meta/preferences.md", "x".repeat(6000));            // prefs over cap +1
    // edgesEmpty = true (no db) → +1
    const state = await detectLegacyState(vaultDir, dbPath);
    expect(state.frontmatterMissing).toBe(1);
    expect(state.preferencesOverCap).toBe(true);
    expect(state.edgesEmpty).toBe(true);
    expect(state.totalLegacyNotes).toBe(3);
  });
});

describe("detectLegacyState — nonexistent vault", () => {
  it("handles nonexistent vault gracefully", async () => {
    const state = await detectLegacyState("/nonexistent/vault", "/nonexistent/db");
    expect(state.frontmatterMissing).toBe(0);
    expect(state.edgesEmpty).toBe(true);
    expect(state.preferencesOverCap).toBe(false);
  });
});
