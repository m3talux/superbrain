import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openIndex } from "../src/searchIndex.js";
import { hybridRecall, isArchivePath } from "../src/recall.js";
import { handleSearch } from "../src/mcpSearch.js";
import { embed } from "../src/embed.js";

let TMP: string;
beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-arch-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
});
afterEach(() => {
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_EMBED_STUB;
  delete process.env.SUPERBRAIN_ARCHIVE_PENALTY;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("archive penalty — path detection", () => {
  it("detects archive paths", () => {
    expect(isArchivePath("projects/_archive/alfred-2026-Q2.md")).toBe(true);
    expect(isArchivePath("knowledge/_archive/x.md")).toBe(true);
    expect(isArchivePath("projects/alfred.md")).toBe(false);
    expect(isArchivePath("decisions/2026-05-01-vec.md")).toBe(false);
  });
});

describe("archive penalty — ordering", () => {
  async function seedLiveAndArchive() {
    const text = "alfred project recall ranking design decision notes";
    const [vec] = await embed([text]);
    const newer = new Date().toISOString();
    const older = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const ix = openIndex();
    ix.upsertNote(
      "projects/alfred.md", 1, "h-live",
      [{ headingPath: "", anchor: "root", text }],
      [vec], "global", older,
    );
    ix.upsertNote(
      "projects/_archive/alfred-2026-Q2.md", 1, "h-arch",
      [{ headingPath: "", anchor: "root", text }],
      [vec], "global", newer,
    );
    ix.close();
    return text;
  }

  it("live note outranks its archive for identical content", async () => {
    const text = await seedLiveAndArchive();
    const results = await hybridRecall(text, 5);
    const liveIdx = results.findIndex((r) => r.relPath === "projects/alfred.md");
    const archIdx = results.findIndex((r) => r.relPath === "projects/_archive/alfred-2026-Q2.md");
    expect(liveIdx).toBeGreaterThanOrEqual(0);
    expect(archIdx).toBeGreaterThanOrEqual(0);
    expect(liveIdx).toBeLessThan(archIdx);
  });

  it("archive still surfaces when no live note matches", async () => {
    const [vec] = await embed(["lonely archived content only"]);
    const ix = openIndex();
    ix.upsertNote(
      "projects/_archive/old-q1.md", 1, "h-only",
      [{ headingPath: "", anchor: "root", text: "lonely archived content only" }],
      [vec], "global",
    );
    ix.close();
    const results = await hybridRecall("lonely archived content only", 5);
    expect(results.map((r) => r.relPath)).toContain("projects/_archive/old-q1.md");
  });

  it("applies on the unscoped injection path", async () => {
    const text = await seedLiveAndArchive();
    const results = await hybridRecall(text, 5);
    const liveIdx = results.findIndex((r) => r.relPath === "projects/alfred.md");
    const archIdx = results.findIndex((r) => r.relPath === "projects/_archive/alfred-2026-Q2.md");
    expect(liveIdx).toBeLessThan(archIdx);
  });
});

describe("archive penalty — MCP search", () => {
  it("applies on the MCP search path", async () => {
    const text = "alfred mcp search ranking identical content";
    const [vec] = await embed([text]);
    const older = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const newer = new Date().toISOString();
    const ix = openIndex();
    ix.upsertNote(
      "projects/alfred.md", 1, "h-l",
      [{ headingPath: "", anchor: "root", text }], [vec], "global", older,
    );
    ix.upsertNote(
      "projects/_archive/alfred-2026-Q2.md", 1, "h-a",
      [{ headingPath: "", anchor: "root", text }], [vec], "global", newer,
    );
    ix.close();
    const out = await handleSearch({ query: text, k: 8 });
    const body = out.content[0].text;
    const livePos = body.indexOf("projects/alfred");
    const archPos = body.indexOf("projects/_archive/alfred-2026-Q2");
    expect(livePos).toBeGreaterThanOrEqual(0);
    expect(archPos).toBeGreaterThanOrEqual(0);
    expect(livePos).toBeLessThan(archPos);
  });
});

describe("archive penalty — project-scoped path (hybridRecallWithProject)", () => {
  it("live note outranks archive on project-scoped injection path", async () => {
    const text = "project scoped recall fallback archive ordering test";
    const [vec] = await embed([text]);
    const older = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const newer = new Date().toISOString();
    const ix = openIndex();
    ix.upsertNote(
      "projects/alfred.md", 1, "h-live",
      [{ headingPath: "", anchor: "root", text }], [vec], "alfred", older,
    );
    ix.upsertNote(
      "projects/_archive/alfred-2026-Q2.md", 1, "h-arch",
      [{ headingPath: "", anchor: "root", text }], [vec], "global", newer,
    );
    ix.close();
    const results = await hybridRecall(text, 5, { projectSlug: "alfred" });
    const liveIdx = results.findIndex((r) => r.relPath === "projects/alfred.md");
    const archIdx = results.findIndex((r) => r.relPath === "projects/_archive/alfred-2026-Q2.md");
    expect(liveIdx).toBeGreaterThanOrEqual(0);
    expect(archIdx).toBeGreaterThanOrEqual(0);
    expect(liveIdx).toBeLessThan(archIdx);
  });

  it("fallback fill respects archive penalty", async () => {
    const liveText = "alpha bravo charlie delta global live note";
    const archText = "alpha bravo charlie delta global archive note";
    const [liveVec] = await embed([liveText]);
    const [archVec] = await embed([archText]);
    const older = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const newer = new Date().toISOString();
    const ix = openIndex();
    ix.upsertNote(
      "projects/global-live.md", 1, "h-live",
      [{ headingPath: "", anchor: "root", text: liveText }], [liveVec], "global", older,
    );
    ix.upsertNote(
      "projects/_archive/global-arch-q1.md", 1, "h-arch",
      [{ headingPath: "", anchor: "root", text: archText }], [archVec], "global", newer,
    );
    ix.close();
    process.env.SUPERBRAIN_EMBED_FORCE_FAIL = "1";
    const results = await hybridRecall("xyz nomatch query zyxwv", 8, { projectSlug: "alfred" });
    delete process.env.SUPERBRAIN_EMBED_FORCE_FAIL;
    const liveIdx = results.findIndex((r) => r.relPath === "projects/global-live.md");
    const archIdx = results.findIndex((r) => r.relPath === "projects/_archive/global-arch-q1.md");
    expect(liveIdx).toBeGreaterThanOrEqual(0);
    expect(archIdx).toBeGreaterThanOrEqual(0);
    expect(liveIdx).toBeLessThan(archIdx);
  });
});

describe("archive penalty — configuration", () => {
  async function seedLiveAndArchive() {
    const text = "config test identical archive content ranking";
    const [vec] = await embed([text]);
    const older = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const newer = new Date().toISOString();
    const ix = openIndex();
    ix.upsertNote("projects/alfred.md", 1, "h-l",
      [{ headingPath: "", anchor: "root", text }], [vec], "global", older);
    ix.upsertNote("projects/_archive/alfred-2026-Q2.md", 1, "h-a",
      [{ headingPath: "", anchor: "root", text }], [vec], "global", newer);
    ix.close();
    return text;
  }

  it("default penalty is 0.1", async () => {
    delete process.env.SUPERBRAIN_ARCHIVE_PENALTY;
    const text = await seedLiveAndArchive();
    const results = await hybridRecall(text, 5);
    const liveIdx = results.findIndex((r) => r.relPath === "projects/alfred.md");
    const archIdx = results.findIndex((r) => r.relPath === "projects/_archive/alfred-2026-Q2.md");
    expect(liveIdx).toBeLessThan(archIdx);
  });

  it("penalty is overridable via env", async () => {
    process.env.SUPERBRAIN_ARCHIVE_PENALTY = "1";
    const text = await seedLiveAndArchive();
    const results = await hybridRecall(text, 5);
    const liveIdx = results.findIndex((r) => r.relPath === "projects/alfred.md");
    const archIdx = results.findIndex((r) => r.relPath === "projects/_archive/alfred-2026-Q2.md");
    expect(archIdx).toBeLessThanOrEqual(liveIdx);
  });
});
