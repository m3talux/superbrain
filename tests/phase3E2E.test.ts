import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-e3-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-e3-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

it("pushback session yields a lesson note + reconciled preferences, injected next start", () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/S.ndjson"),
    JSON.stringify({ type: "prompt", cwd: "/p", prompt: "No, stop adding inline comments" }) + "\n");
  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stub, JSON.stringify({
    items: [
      { kind: "lesson", title: "No inline comments", project: "test",
        rule: "Do not add inline comments unless non-obvious.",
        why: "User reverted commented code on 2026-05-19.",
        whenApplies: "Whenever writing code.",
        date: "2026-05-19", links: [] },
      { kind: "preference", title: "preferences", body: "## Code\n- No inline comments unless non-obvious", date: "2026-05-19", links: [] },
    ],
    digest: "Learned a code-style preference", openThreads: [],
  }));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });

  expect(fs.existsSync(path.join(TMP_VAULT, "lessons/2026-05-19-no-inline-comments.md"))).toBe(true);
  const pref = fs.readFileSync(path.join(TMP_VAULT, "meta/preferences.md"), "utf8");
  expect(pref).toContain("No inline comments unless non-obvious");
  expect(pref).not.toMatch(/## \d{4}-\d\d-\d\d \d\d:\d\d/);

  const out = execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S2", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
  expect(out).toContain("No inline comments unless non-obvious");
});
