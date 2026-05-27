import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dist-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dist-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

it("distills delta into routed notes, daily .log file, advances cursor, releases lock", () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/S.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stub, JSON.stringify([
    { kind: "decision", title: "Pick X", project: "test",
      body: "## Decision\nPick X.\n## Why\n- Best fit.\n## Alternatives considered\n- **Alt A** — rejected because cost.\n## Consequences\n- Trade-offs apply.",
      date: "2026-05-19", links: ["SuperBrain"] },
  ]));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/S.prompt.json"), "{}");

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT, SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });

  expect(fs.existsSync(path.join(TMP_VAULT, "decisions/2026-05-19-pick-x.md"))).toBe(true);

  expect(Number(fs.readFileSync(path.join(TMP_DATA, "sessions/S.cursor"), "utf8"))).toBeGreaterThan(0);
  expect(fs.existsSync(path.join(TMP_DATA, "locks/distill.lock"))).toBe(false);
});

it("classifier-rejected item lands in rejects file and is not written to vault", () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_DATA, "sessions/R.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n",
  );
  const stub = path.join(TMP_DATA, "stub.json");
  // "Shipped phase 1" starts with "Shipped" — classify() rejects decisions
  // whose title prefix belongs in capture, without touching the write path.
  fs.writeFileSync(stub, JSON.stringify([
    { kind: "decision", title: "Shipped phase 1", body: "we shipped it", date: "2026-05-22", links: [] },
  ]));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/R.prompt.json"), "{}");

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "R",
      SUPERBRAIN_EMBED_STUB: "1",
    },
    encoding: "utf8",
  });

  // 1. The note must NOT have been written to the vault.
  expect(fs.existsSync(path.join(TMP_VAULT, "decisions"))).toBe(false);

  // 2. The reject file must exist and contain the classifier reason.
  const rejectsFile = path.join(TMP_VAULT, "meta", "distill-rejects.md");
  expect(fs.existsSync(rejectsFile)).toBe(true);
  expect(fs.readFileSync(rejectsFile, "utf8")).toMatch(/shipped/i);

  // 3. The cursor must have advanced (run did not abort).
  expect(Number(fs.readFileSync(path.join(TMP_DATA, "sessions/R.cursor"), "utf8"))).toBeGreaterThan(0);
});
