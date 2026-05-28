import { it, describe, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openIndex } from "../src/searchIndex.js";

// ---------------------------------------------------------------------------
// Unit-level tests for appendDigest seed construction (vi.mock)
// ---------------------------------------------------------------------------

// Mock hybridRecall so we can inspect what query/opts it receives.
vi.mock("../src/recall.js", () => ({
  hybridRecall: vi.fn().mockResolvedValue([]),
}));
// Mock compileInjectionBlock + readDay to keep appendDigest focused on recall.
vi.mock("../src/preferences.js", () => ({ compileInjectionBlock: vi.fn().mockReturnValue("") }));
vi.mock("../src/dailyState.js", () => ({ readDay: vi.fn().mockReturnValue({}) }));

// ---------------------------------------------------------------------------
// Helpers: create a temp fixture project dir with a package.json so
// classifyPath returns "single". SUPERBRAIN_TEST_BYPASS_BLOCKLIST=1 ensures
// /tmp paths are not blocked. Tests are thus independent of checkout location.
// ---------------------------------------------------------------------------

function makeFixtureProject(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sb-test-proj-${name}-`));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name }), "utf8");
  return dir;
}

describe("appendDigest — project-aware seed", () => {
  let fixtureProjectDir: string;

  beforeEach(() => {
    fixtureProjectDir = makeFixtureProject("my-app");
    process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(fixtureProjectDir, { recursive: true, force: true });
    delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
  });

  it("passes projectSlug option when cwd matches a known project", async () => {
    const { hybridRecall } = await import("../src/recall.js");
    const { appendDigest } = await import("../src/sessionDigest.js");

    const parts: string[] = [];
    await appendDigest(parts, { cwd: fixtureProjectDir });

    expect(hybridRecall).toHaveBeenCalledOnce();
    const [query, _k, opts] = (hybridRecall as ReturnType<typeof vi.fn>).mock.calls[0];
    // Must NOT contain the old keyword soup
    expect(query).not.toMatch(/decisions/);
    expect(query).not.toMatch(/gotchas/);
    // Must pass projectSlug option
    expect(opts).toBeDefined();
    expect(opts.projectSlug).toBeTruthy();
  });

  it("falls back to cwd basename with no projectSlug when path is blocked", async () => {
    const { hybridRecall } = await import("../src/recall.js");
    const { appendDigest } = await import("../src/sessionDigest.js");

    // Use HOME — classifyPath returns "blocked" (bypass flag is off here).
    delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
    const parts: string[] = [];
    await appendDigest(parts, { cwd: os.homedir() });

    expect(hybridRecall).toHaveBeenCalledOnce();
    const [query, _k, opts] = (hybridRecall as ReturnType<typeof vi.fn>).mock.calls[0];
    // Query should be just the basename — no keyword soup
    expect(query).not.toMatch(/decisions/);
    expect(query).not.toMatch(/gotchas/);
    // No projectSlug option
    expect(opts?.projectSlug).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Session brief tests
// ---------------------------------------------------------------------------

describe("appendDigest — project-scoped session brief", () => {
  let projectDir: string;
  let readDayMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    projectDir = makeFixtureProject("my-widget");
    process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";

    const { readDay } = await import("../src/dailyState.js");
    readDayMock = readDay as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(projectDir, { recursive: true, force: true });
    delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
  });

  it("prepends a brief containing the last-session digestLine when project is known", async () => {
    const { appendDigest } = await import("../src/sessionDigest.js");
    const slug = path.basename(projectDir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

    // today returns nothing; yesterday has a matching entry with a digestLine
    readDayMock.mockImplementation((date: string) => {
      const today = new Date().toISOString().slice(0, 10);
      if (date === today) return {};
      return {
        "s1": { digestLine: "Shipped the widget auth flow", routedRelPaths: ["projects/my-widget/auth.md"], alsoDid: [], openThreads: [], project: slug },
      };
    });

    const parts: string[] = [];
    await appendDigest(parts, { cwd: projectDir });

    const brief = parts[0];
    expect(brief).toBeDefined();
    expect(brief).toContain("widget auth flow");
    expect(brief).toMatch(/SuperBrain/);
    // Brief must be first
    expect(parts.indexOf(brief)).toBe(0);
  });

  it("includes recent routed note slugs in the brief when available", async () => {
    const { appendDigest } = await import("../src/sessionDigest.js");
    const slug = path.basename(projectDir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

    readDayMock.mockImplementation((date: string) => {
      const today = new Date().toISOString().slice(0, 10);
      if (date === today) return {};
      return {
        "s1": {
          digestLine: "Refactored widget pipeline",
          routedRelPaths: ["projects/my-widget/pipeline.md", "projects/my-widget/types.md"],
          alsoDid: [], openThreads: [], project: slug,
        },
      };
    });

    const parts: string[] = [];
    await appendDigest(parts, { cwd: projectDir });

    const brief = parts[0];
    expect(brief).toBeDefined();
    expect(brief).toContain("pipeline");
  });

  it("emits no brief when cwd is not a known project", async () => {
    const { appendDigest } = await import("../src/sessionDigest.js");
    delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;

    readDayMock.mockReturnValue({});

    const parts: string[] = [];
    await appendDigest(parts, { cwd: os.homedir() });

    const brief = parts.find(p => p.startsWith("SuperBrain —") && p.includes("Last session:"));
    expect(brief).toBeUndefined();
  });

  it("emits no brief when no prior digestLine is found for this project", async () => {
    const { appendDigest } = await import("../src/sessionDigest.js");
    const slug = path.basename(projectDir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

    // All days have entries but none have a digestLine for this project
    readDayMock.mockImplementation((_date: string) => ({
      "s1": { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: [], project: slug },
      "s2": { digestLine: "Other project work", routedRelPaths: [], alsoDid: [], openThreads: [], project: "completely-different" },
    }));

    const parts: string[] = [];
    await appendDigest(parts, { cwd: projectDir });

    const brief = parts.find(p => p.includes("Last session:"));
    expect(brief).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Open-threads scoping tests
// ---------------------------------------------------------------------------

describe("appendDigest — open-threads scoping", () => {
  let projectADir: string;
  let projectBDir: string;
  let readDayMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    projectADir = makeFixtureProject("project-alpha");
    projectBDir = makeFixtureProject("project-beta");
    process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";

    // Grab the mocked readDay so each test can set its return value.
    const { readDay } = await import("../src/dailyState.js");
    readDayMock = readDay as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(projectADir, { recursive: true, force: true });
    fs.rmSync(projectBDir, { recursive: true, force: true });
    delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
  });

  it("includes threads from the current project and unscoped entries", async () => {
    const { appendDigest } = await import("../src/sessionDigest.js");
    const alphaSlug = path.basename(projectADir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

    readDayMock.mockReturnValue({
      "s1": { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: ["thread-alpha-1"], project: alphaSlug },
      "s2": { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: ["thread-unscoped"], /* no project */ },
      "s3": { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: ["thread-beta-1"], project: "project-beta" },
    });

    const parts: string[] = [];
    await appendDigest(parts, { cwd: projectADir });

    const openThreadsPart = parts.find(p => p.startsWith("SuperBrain — open threads today:"));
    expect(openThreadsPart).toBeDefined();
    expect(openThreadsPart).toContain("thread-alpha-1");
    expect(openThreadsPart).toContain("thread-unscoped");
    expect(openThreadsPart).not.toContain("thread-beta-1");
  });

  it("excludes threads from a different concrete project", async () => {
    const { appendDigest } = await import("../src/sessionDigest.js");

    readDayMock.mockReturnValue({
      "s1": { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: ["thread-beta-only"], project: "project-beta" },
    });

    const parts: string[] = [];
    await appendDigest(parts, { cwd: projectADir });

    const openThreadsPart = parts.find(p => p.startsWith("SuperBrain — open threads today:"));
    expect(openThreadsPart).toBeUndefined();
  });

  it("emits no open-threads block when cwd has no project (blocked/skip)", async () => {
    const { appendDigest } = await import("../src/sessionDigest.js");
    delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;

    readDayMock.mockReturnValue({
      "s1": { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: ["some-thread"], project: "some-project" },
    });

    const parts: string[] = [];
    // HOME is blocked
    await appendDigest(parts, { cwd: os.homedir() });

    const openThreadsPart = parts.find(p => p.startsWith("SuperBrain — open threads today:"));
    expect(openThreadsPart).toBeUndefined();
  });

  it("includes only unscoped threads when no entry matches current project", async () => {
    const { appendDigest } = await import("../src/sessionDigest.js");

    readDayMock.mockReturnValue({
      "s1": { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: ["thread-unscoped-2"] },
      "s2": { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: ["thread-other"], project: "completely-different" },
    });

    const parts: string[] = [];
    await appendDigest(parts, { cwd: projectADir });

    const openThreadsPart = parts.find(p => p.startsWith("SuperBrain — open threads today:"));
    expect(openThreadsPart).toBeDefined();
    expect(openThreadsPart).toContain("thread-unscoped-2");
    expect(openThreadsPart).not.toContain("thread-other");
  });
});

// ---------------------------------------------------------------------------
// Integration test: SessionStart hook emits additionalContext
// ---------------------------------------------------------------------------

let TMP_DATA: string;
let TMP_VAULT: string;
let FIXTURE_PROJECT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ssd-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ssd-vault-"));
  FIXTURE_PROJECT = makeFixtureProject("superbrain-fixture");
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  const ix = openIndex();
  // Fixture text includes "superbrain" so BM25 matches when the seed is the project
  // slug (basenameSlug("superbrain-fixture") === "superbrain-fixture"). hybridRecall
  // is BM25-gated in P2.0 — zero lexical hits → returns [] immediately.
  ix.upsertNote("projects/super-brain.md", 1, "h",
    [{ headingPath: "Status", anchor: "status", text: "superbrain phase 1 shipped; phase 2 adds hybrid search" }],
    [Float32Array.from(Array(384).fill(0.6))]);
  ix.close();
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  fs.rmSync(FIXTURE_PROJECT, { recursive: true, force: true });
});

it("SessionStart emits a hybrid recall digest in additionalContext", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: FIXTURE_PROJECT }),
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_FAKE_DISTILLER: "1",
      SUPERBRAIN_EMBED_STUB: "1",
      SUPERBRAIN_TEST_BYPASS_BLOCKLIST: "1",
    },
    encoding: "utf8",
  });
  expect(out).toMatch(/additionalContext/);
  expect(out).toMatch(/super-brain/);
});
