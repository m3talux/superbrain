import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-ssp", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-ssp-vault", { recursive: true, force: true });
  fs.mkdirSync("/tmp/sb-ssp-vault/meta", { recursive: true });
  fs.writeFileSync("/tmp/sb-ssp-vault/meta/preferences.md",
    "---\ntype: preference\ncreated: 2026-05-19\n---\n\n## Code\n- No inline comments\n");
  const today = new Date().toISOString().slice(0, 10);
  fs.mkdirSync("/tmp/sb-ssp/daily", { recursive: true });
  fs.writeFileSync(`/tmp/sb-ssp/daily/${today}.json`,
    JSON.stringify({ S1: { digestLine: "d", routedRelPaths: [], alsoDid: [], openThreads: ["finish phase 3"] } }));
});

it("SessionStart injects compiled preferences and today's open threads", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, SUPERBRAIN_DATA_DIR: "/tmp/sb-ssp", SUPERBRAIN_VAULT_DIR: "/tmp/sb-ssp-vault",
      SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
  expect(out).toMatch(/additionalContext/);
  expect(out).toContain("No inline comments");
  expect(out).toContain("finish phase 3");
});
