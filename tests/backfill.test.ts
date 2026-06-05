import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openIndex } from "../src/searchIndex.js";
import { backfillProjectNulls } from "../src/indexer.js";

const STUB_VEC = Float32Array.from(Array(256).fill(0.5));

let TMP: string;
let VAULT: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-bf-"));
  VAULT = path.join(TMP, "vault");
  fs.mkdirSync(VAULT, { recursive: true });
  process.env.SUPERBRAIN_DATA_DIR = TMP;
  process.env.SUPERBRAIN_VAULT_DIR = VAULT;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
});

afterEach(() => {
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_VAULT_DIR;
  delete process.env.SUPERBRAIN_EMBED_STUB;
  fs.rmSync(TMP, { recursive: true, force: true });
});

function writeNote(relPath: string, content: string): void {
  const abs = path.join(VAULT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function indexNote(relPath: string, project?: string): void {
  const ix = openIndex();
  // Seed with project=undefined to simulate a NULL note
  ix.upsertNote(
    relPath, 1, `hash-${relPath}`,
    [{ headingPath: "", anchor: "root", text: "test content for " + relPath }],
    [STUB_VEC],
    project,
  );
  ix.close();
}

function getNoteProject(relPath: string): string | null {
  const ix = openIndex();
  const row = (ix.db.prepare("SELECT project FROM notes WHERE rel_path=?").get(relPath) as any);
  ix.close();
  return row ? row.project : null;
}

describe("backfillProjectNulls", () => {
  it("F1: note with no frontmatter project -> assigned global after backfill", async () => {
    writeNote("daily/2026-01-01.md", "# No project\nSome content here.\n");
    indexNote("daily/2026-01-01.md");
    // Verify it starts as NULL
    expect(getNoteProject("daily/2026-01-01.md")).toBeNull();

    const result = await backfillProjectNulls();
    expect(result.repaired).toBeGreaterThanOrEqual(1);
    expect(getNoteProject("daily/2026-01-01.md")).toBe("global");
  });

  it("F2: note at projects/myproj.md with no frontmatter project -> assigned myproj", async () => {
    writeNote("projects/myproj.md", "# My Project\nSome project info.\n");
    indexNote("projects/myproj.md");
    expect(getNoteProject("projects/myproj.md")).toBeNull();

    const result = await backfillProjectNulls();
    expect(result.repaired).toBeGreaterThanOrEqual(1);
    expect(getNoteProject("projects/myproj.md")).toBe("myproj");
  });

  it("F3: note with project in frontmatter already in index -> not touched", async () => {
    writeNote("decisions/arch.md", "---\nproject: foo\n---\n# Arch\nDecision content.\n");
    indexNote("decisions/arch.md", "foo");
    expect(getNoteProject("decisions/arch.md")).toBe("foo");

    const result = await backfillProjectNulls();
    // The note already has a project — repaired count should not include it
    expect(getNoteProject("decisions/arch.md")).toBe("foo");
    void result; // result.repaired counts only NULL rows
  });

  it("F4: after backfill, getProjectsForPaths returns non-empty map for all previously-NULL paths", async () => {
    writeNote("daily/2026-01-02.md", "# Daily\nContent.\n");
    writeNote("meta/preferences.md", "# Prefs\nContent.\n");
    indexNote("daily/2026-01-02.md");
    indexNote("meta/preferences.md");

    await backfillProjectNulls();

    const ix = openIndex();
    const map = ix.getProjectsForPaths(["daily/2026-01-02.md", "meta/preferences.md"]);
    ix.close();
    expect(map.size).toBe(2);
    expect(map.get("daily/2026-01-02.md")).toBeTruthy();
    expect(map.get("meta/preferences.md")).toBeTruthy();
  });

  it("F5: running backfill twice is idempotent (second run repairs 0 rows)", async () => {
    writeNote("knowledge/arch.md", "# Architecture\nContent.\n");
    indexNote("knowledge/arch.md");

    const r1 = await backfillProjectNulls();
    expect(r1.repaired).toBeGreaterThanOrEqual(1);

    const r2 = await backfillProjectNulls();
    expect(r2.repaired).toBe(0);
  });
});
