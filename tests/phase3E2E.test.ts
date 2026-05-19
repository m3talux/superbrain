import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-e3", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-e3-vault", { recursive: true, force: true });
});

it("pushback session yields a lesson note + reconciled preferences, injected next start", () => {
  fs.mkdirSync("/tmp/sb-e3/sessions", { recursive: true });
  fs.writeFileSync("/tmp/sb-e3/sessions/S.ndjson",
    JSON.stringify({ type: "prompt", cwd: "/p", prompt: "No, stop adding inline comments" }) + "\n");
  const stub = "/tmp/sb-e3/stub.json";
  fs.writeFileSync(stub, JSON.stringify({
    items: [
      { kind: "lesson", title: "No inline comments", body: "User reverted commented code.", rule: "Do not add inline comments unless non-obvious.", date: "2026-05-19", links: [] },
      { kind: "preference", title: "preferences", body: "## Code\n- No inline comments unless non-obvious", date: "2026-05-19", links: [] },
    ],
    digest: "Learned a code-style preference", openThreads: [],
  }));
  fs.mkdirSync("/tmp/sb-e3/locks/distill.lock", { recursive: true });

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-e3", SUPERBRAIN_VAULT: "/tmp/sb-e3-vault",
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });

  expect(fs.existsSync("/tmp/sb-e3-vault/lessons/2026-05-19-no-inline-comments.md")).toBe(true);
  const pref = fs.readFileSync("/tmp/sb-e3-vault/meta/preferences.md", "utf8");
  expect(pref).toContain("No inline comments unless non-obvious");
  expect(pref).not.toMatch(/## \d{4}-\d\d-\d\d \d\d:\d\d/);

  const out = execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S2", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-e3", SUPERBRAIN_VAULT: "/tmp/sb-e3-vault",
      SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
  expect(out).toContain("No inline comments unless non-obvious");
});
