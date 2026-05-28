import { it, expect, beforeEach, afterEach, describe } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-capattr-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-capattr-vault-"));
});
afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

describe("capture cwd attribution", () => {
  it("a capture with no explicit project is attributed to the session's cwd project", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-cap-repo-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "cap-app" }));
      fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
      fs.writeFileSync(
        path.join(TMP_DATA, "sessions/SC.ndjson"),
        [
          { type: "tool", tool: "Write", file: "a.ts", cwd: repoDir, ts: "t1" },
          { type: "prompt", prompt: "noted a thing", cwd: repoDir, ts: "t2" },
        ].map((e) => JSON.stringify(e)).join("\n") + "\n",
      );
      const expectedSlug = path.basename(repoDir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      const stubPath = path.join(TMP_DATA, "stub.json");
      fs.writeFileSync(stubPath, JSON.stringify({
        items: [
          { kind: "capture", title: "Observed flaky retry in CI", date: "2026-05-28", what: "CI retried twice before passing.", whyItMatters: "Signals a flaky test.", links: [] },
        ],
        digest: "noted CI flakiness", openThreads: [], alsoDid: [],
      }));
      fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
      execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
        env: {
          ...process.env,
          SUPERBRAIN_DATA_DIR: TMP_DATA,
          SUPERBRAIN_VAULT_DIR: TMP_VAULT,
          SUPERBRAIN_DISTILL_STUB: stubPath,
          SUPERBRAIN_SESSION_ID: "SC",
          SUPERBRAIN_EMBED_STUB: "1",
          SUPERBRAIN_TEST_BYPASS_BLOCKLIST: "1",
        },
        encoding: "utf8",
      });
      const captureDir = path.join(TMP_VAULT, "capture");
      const files = fs.readdirSync(captureDir).filter((f) => f.endsWith(".md"));
      expect(files.length).toBeGreaterThan(0);
      const content = fs.readFileSync(path.join(captureDir, files[0]), "utf8");
      expect(content).toMatch(new RegExp(`^project: ${expectedSlug}$`, "m"));
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
