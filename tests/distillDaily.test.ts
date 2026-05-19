import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-dd", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-dd-vault", { recursive: true, force: true });
});

it("writes a daily note aggregating the session's routed items + envelope fields", () => {
  fs.mkdirSync("/tmp/sb-dd/sessions", { recursive: true });
  fs.writeFileSync("/tmp/sb-dd/sessions/S.ndjson",
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  const stub = "/tmp/sb-dd/stub.json";
  fs.writeFileSync(stub, JSON.stringify({
    items: [{ kind: "decision", title: "Pick X", body: "why", date: "2026-05-19", links: [] }],
    digest: "Chose X for the pipeline", openThreads: ["wire Y"], alsoDid: ["cleaned logs"],
  }));
  fs.mkdirSync("/tmp/sb-dd/locks/distill.lock", { recursive: true });

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-dd", SUPERBRAIN_VAULT: "/tmp/sb-dd-vault",
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });

  const daily = fs.readFileSync("/tmp/sb-dd-vault/daily/2026-05-19.md", "utf8");
  expect(daily).toContain("# 2026-05-19");
  expect(daily).toContain("Chose X for the pipeline");
  expect(daily).toContain("[[decisions/2026-05-19-pick-x]]");
  expect(daily).toContain("wire Y");
  expect(daily).toContain("cleaned logs");
});
