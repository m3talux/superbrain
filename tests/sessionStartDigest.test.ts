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

describe("appendDigest — project-aware seed", () => {
  afterEach(() => vi.clearAllMocks());

  it("passes projectSlug option when cwd matches a known project", async () => {
    const { hybridRecall } = await import("../src/recall.js");
    const { appendDigest } = await import("../src/sessionDigest.js");

    // Use the repo's own directory — it has package.json so classifyPath returns "single"
    // and basenameSlug("SuperBrain") === "superbrain".
    const repoDir = path.resolve(__dirname, "..");
    const parts: string[] = [];
    await appendDigest(parts, { cwd: repoDir });

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

    // Use HOME — classifyPath returns "blocked", so no slug.
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

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ssd-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ssd-vault-"));
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  const ix = openIndex();
  // Fixture text includes "superbrain" so BM25 matches when the seed is the project
  // slug (basenameSlug("SuperBrain") === "superbrain"). hybridRecall is BM25-gated in
  // P2.0 — zero lexical hits → returns [] immediately.
  ix.upsertNote("projects/super-brain.md", 1, "h",
    [{ headingPath: "Status", anchor: "status", text: "superbrain phase 1 shipped; phase 2 adds hybrid search" }],
    [Float32Array.from(Array(384).fill(0.6))]);
  ix.close();
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

it("SessionStart emits a hybrid recall digest in additionalContext", () => {
  // Pass the repo root as cwd — classifyPath detects it as a single project with
  // slug "superbrain", which BM25-matches the fixture note text.
  const repoDir = path.resolve(__dirname, "..");
  const out = execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: repoDir }),
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT,
           SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
  expect(out).toMatch(/additionalContext/);
  expect(out).toMatch(/super-brain/);
});
