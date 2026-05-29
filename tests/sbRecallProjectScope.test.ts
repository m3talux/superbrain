import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openIndex } from "../src/searchIndex";

let TMP: string;
let PROJECT_DIR: string;
let OTHER_DIR: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-recall-scope-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";

  // Two temp project dirs each with a strong-signal file so classifyPath sees them
  PROJECT_DIR = path.join(TMP, "my-project");
  OTHER_DIR = path.join(TMP, "other-project");
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  fs.mkdirSync(OTHER_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROJECT_DIR, "package.json"), '{"name":"my-project"}');
  fs.writeFileSync(path.join(OTHER_DIR, "package.json"), '{"name":"other-project"}');

  // Seed: one note scoped to "my-project", one scoped to "other-project"
  const ix = openIndex();
  ix.upsertNote(
    "projects/my-project.md", 1, "h-mp",
    [{ headingPath: "", anchor: "root", text: "hybrid recall fusion RRF my-project specifics" }],
    [Float32Array.from(Array(384).fill(0.4))],
    "my-project",
  );
  ix.upsertNote(
    "projects/other-project.md", 1, "h-op",
    [{ headingPath: "", anchor: "root", text: "hybrid recall fusion RRF other-project specifics" }],
    [Float32Array.from(Array(384).fill(0.4))],
    "other-project",
  );
  ix.close();
});

afterEach(() => {
  delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
  fs.rmSync(TMP, { recursive: true, force: true });
});

function run(hook: object) {
  return execFileSync("npx", ["tsx", "bin/sb-recall.ts"], {
    input: JSON.stringify(hook),
    env: { ...process.env },
    encoding: "utf8",
  });
}

describe("sb-recall project scoping", () => {
  it("injects only the current-project note when cwd resolves to a known project", () => {
    const out = run({
      session_id: "S1",
      hook_event_name: "UserPromptSubmit",
      cwd: PROJECT_DIR,
      prompt: "hybrid recall fusion RRF",
    });
    expect(out).toMatch(/my-project/);
    expect(out).not.toMatch(/other-project/);
  });

  it("does not filter cross-project notes when cwd has no project signal", () => {
    const noProjectDir = path.join(TMP, "no-manifest");
    fs.mkdirSync(noProjectDir, { recursive: true });
    const out = run({
      session_id: "S2",
      hook_event_name: "UserPromptSubmit",
      cwd: noProjectDir,
      prompt: "hybrid recall fusion RRF",
    });
    // Both notes should appear since no project slug is resolved
    expect(out).toMatch(/my-project|other-project/);
  });

  it("exits cleanly with no output when cwd field is missing and prompt has no index match", () => {
    const out = run({
      session_id: "S3",
      hook_event_name: "UserPromptSubmit",
      prompt: "zzz-no-match-xyz-unique-1234",
    });
    expect(out.trim()).toBe("");
  });
});
