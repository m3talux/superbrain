import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { basenameSlug } from "../src/projectDetect.js";

let TMP_DATA: string;
let TMP_VAULT: string;
let FIXTURE_PROJECT: string;
let FIXTURE_SLUG: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ssp-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ssp-vault-"));
  // Create a fixture project dir so classifyPath returns "single" — requires BYPASS flag.
  FIXTURE_PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-ssp-proj-"));
  fs.writeFileSync(path.join(FIXTURE_PROJECT, "package.json"), JSON.stringify({ name: "test-app" }), "utf8");
  FIXTURE_SLUG = basenameSlug(FIXTURE_PROJECT);

  fs.mkdirSync(path.join(TMP_VAULT, "meta"), { recursive: true });
  fs.writeFileSync(path.join(TMP_VAULT, "meta/preferences.md"),
    "---\ntype: preference\ncreated: 2026-05-19\n---\n\n## Code\n- No inline comments\n");
  const today = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(path.join(TMP_DATA, "daily"), { recursive: true });
  // Write the open-thread entry scoped to the fixture project so it passes through scoping.
  fs.writeFileSync(path.join(TMP_DATA, `daily/${today}.json`),
    JSON.stringify({ S1: { digestLine: "d", routedRelPaths: [], alsoDid: [], openThreads: ["finish phase 3"], project: FIXTURE_SLUG } }));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  fs.rmSync(FIXTURE_PROJECT, { recursive: true, force: true });
});

it("SessionStart injects compiled preferences and today's open threads", () => {
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
  expect(out).toContain("No inline comments");
  expect(out).toContain("finish phase 3");
});
