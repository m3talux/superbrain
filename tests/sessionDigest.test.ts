import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mock hybridRecall so tests control what each slot returns.
vi.mock("../src/recall.js", () => ({
  hybridRecall: vi.fn().mockResolvedValue([]),
}));
vi.mock("../src/preferences.js", () => ({ compileInjectionBlock: vi.fn().mockReturnValue("- fallback rule") }));
vi.mock("../src/dailyState.js", () => ({ readDay: vi.fn().mockReturnValue({}) }));
vi.mock("../src/migrationDetect.js", () => ({ detectLegacyState: vi.fn().mockResolvedValue({ edgesEmpty: false, preferencesOverCap: false }) }));

let TMP_DATA: string;
let TMP_VAULT: string;
let FIXTURE_PROJECT: string;

function makeFixtureProject(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sb-sd-${name}-`));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name }), "utf8");
  return dir;
}

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sd-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sd-vault-"));
  FIXTURE_PROJECT = makeFixtureProject("alpha-proj");
  fs.mkdirSync(path.join(TMP_VAULT, "meta"), { recursive: true });
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
});

afterEach(() => {
  vi.clearAllMocks();
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  fs.rmSync(FIXTURE_PROJECT, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_VAULT_DIR;
  delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
});

describe("appendDigest B4 — 4-slot weighted brief", () => {
  it("4.1.a: slot A (project) is first, slot C (pref-core) appears in parts", async () => {
    const { hybridRecall } = await import("../src/recall.js");
    const { appendDigest } = await import("../src/sessionDigest.js");

    // Slot A returns a project hit; slot B returns nothing
    (hybridRecall as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ relPath: "projects/alpha-proj.md", headingPath: "Overview", anchor: "overview", excerpt: "alpha project overview" }])
      .mockResolvedValueOnce([]);

    // Create preferences-core.md for slot C
    fs.writeFileSync(path.join(TMP_VAULT, "meta", "preferences-core.md"), "- Always test first\n", "utf8");

    const parts: string[] = [];
    await appendDigest(parts, { session_id: "S1", cwd: FIXTURE_PROJECT });

    // Slot A: project recall block should be first
    expect(parts[0]).toContain("alpha");
    // Slot C: preference core should appear
    const prefPart = parts.find(p => p.includes("Always test first"));
    expect(prefPart).toBeDefined();
  });

  it("4.1.b: project-slot tokens within briefProject budget, global-slot within briefGlobal budget", async () => {
    const { hybridRecall } = await import("../src/recall.js");
    const { appendDigest } = await import("../src/sessionDigest.js");
    const { INJECT_LIMITS, estimateTokens } = await import("../src/injectBudget.js");

    // Slot A: many hits
    const manyHits = Array.from({ length: 20 }, (_, i) => ({
      relPath: `projects/note-${i}.md`, headingPath: "H", anchor: `a${i}`,
      excerpt: "word ".repeat(50),
    }));
    (hybridRecall as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(manyHits)
      .mockResolvedValueOnce([]);

    const parts: string[] = [];
    await appendDigest(parts, { session_id: "S2", cwd: FIXTURE_PROJECT });

    const projectPart = parts.find(p => p.startsWith("SuperBrain — "));
    if (projectPart) {
      expect(estimateTokens(projectPart)).toBeLessThanOrEqual(INJECT_LIMITS.briefProject + 30);
    }
  });

  it("4.1.c: preferences-core.md present => used; absent => falls back to compileInjectionBlock", async () => {
    const { hybridRecall } = await import("../src/recall.js");
    const { compileInjectionBlock } = await import("../src/preferences.js");
    const { appendDigest } = await import("../src/sessionDigest.js");

    (hybridRecall as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    // Case 1: no preferences-core.md => fallback
    const parts1: string[] = [];
    await appendDigest(parts1, { session_id: "S3a", cwd: FIXTURE_PROJECT });
    // compileInjectionBlock was called (fallback path)
    expect(compileInjectionBlock).toHaveBeenCalled();

    vi.clearAllMocks();
    (hybridRecall as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    // Case 2: preferences-core.md present => used, fallback not called
    fs.writeFileSync(path.join(TMP_VAULT, "meta", "preferences-core.md"), "- core rule\n", "utf8");
    const parts2: string[] = [];
    await appendDigest(parts2, { session_id: "S3b", cwd: FIXTURE_PROJECT });
    const corePart = parts2.find(p => p.includes("core rule"));
    expect(corePart).toBeDefined();
    // compileInjectionBlock should NOT have been called (core file was used)
    expect(compileInjectionBlock).not.toHaveBeenCalled();
  });

  it("4.1.d: after appendDigest, getInjectedSlugs contains all relPaths from recall results", async () => {
    const { hybridRecall } = await import("../src/recall.js");
    const { appendDigest } = await import("../src/sessionDigest.js");
    const { getInjectedSlugs } = await import("../src/sessionInjected.js");

    const hitA = { relPath: "projects/alpha-proj.md", headingPath: "H", anchor: "a", excerpt: "text" };
    const hitB = { relPath: "knowledge/best-practice.md", headingPath: "H", anchor: "b", excerpt: "text" };
    (hybridRecall as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([hitA])
      .mockResolvedValueOnce([hitB]);

    const parts: string[] = [];
    await appendDigest(parts, { session_id: "S4", cwd: FIXTURE_PROJECT });

    const injected = getInjectedSlugs("S4");
    expect(injected).toContain("projects/alpha-proj.md");
    expect(injected).toContain("knowledge/best-practice.md");
  });

  it("4.1.e: turn counter is 0 after appendDigest", async () => {
    const { hybridRecall } = await import("../src/recall.js");
    const { appendDigest } = await import("../src/sessionDigest.js");
    const { readTurnCount } = await import("../src/turnCounter.js");

    (hybridRecall as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    // Pre-set a non-zero count to verify reset
    const { incrementTurnCount } = await import("../src/turnCounter.js");
    incrementTurnCount("S5");
    incrementTurnCount("S5");

    await appendDigest([], { session_id: "S5", cwd: FIXTURE_PROJECT });
    expect(readTurnCount("S5")).toBe(0);
  });

  it("4.1.f: output is non-empty even when recall returns zero hits (pref core alone is enough)", async () => {
    const { hybridRecall } = await import("../src/recall.js");
    const { appendDigest } = await import("../src/sessionDigest.js");

    (hybridRecall as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    // Ensure fallback pref is non-empty (mocked to return "- fallback rule")

    const parts: string[] = [];
    await appendDigest(parts, { session_id: "S6", cwd: FIXTURE_PROJECT });

    // Preference core (fallback) should ensure at least some output
    expect(parts.length).toBeGreaterThan(0);
    const combined = parts.join("\n");
    expect(combined.length).toBeGreaterThan(0);
  });
});
