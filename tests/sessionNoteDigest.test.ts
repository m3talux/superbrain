import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-snd-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-snd-vault-"));
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

it("a distill rewrites the session note digest and routed links", () => {
  fs.writeFileSync(
    path.join(TMP_DATA, "sessions/D1.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n",
  );
  fs.writeFileSync(path.join(TMP_DATA, "sessions/D1.note"), "sessions/unscoped-1700000000.md");
  fs.mkdirSync(path.join(TMP_VAULT, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_VAULT, "sessions/unscoped-1700000000.md"),
    "---\ntype: session\nsession: D1\ncreated: 2026-06-11\nupdated: 2026-06-11\nsuperbrain: true\n---\n\n# Session D1\n\n## Digest\n\n(no checkpoint yet)\n\n## Notes routed\n\n## Turn log\n- 10:00 ▸ work\n",
  );
  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stub, JSON.stringify({
    items: [
      { kind: "decision", title: "Pick X", project: "test",
        body: "## Decision\nPick X.\n## Why\n- Best fit.\n## Alternatives considered\n- **Alt A** — rejected because cost.\n## Consequences\n- Trade-offs apply.",
        date: "2026-06-11", links: [] },
    ],
    digest: "Chose X over Alt A for the frobnicator",
  }));
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "D1",
      SUPERBRAIN_EMBED_STUB: "1",
    },
    encoding: "utf8",
  });
  const raw = fs.readFileSync(path.join(TMP_VAULT, "sessions/unscoped-1700000000.md"), "utf8");
  expect(raw).toContain("## Digest\n\nChose X over Alt A for the frobnicator");
  expect(raw).not.toContain("(no checkpoint yet)");
  expect(raw).toMatch(/## Notes routed\n- \[\[decisions\//);
  expect(raw).toContain("## Turn log\n- 10:00 ▸ work");
});
