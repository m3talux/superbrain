import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-attr-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-attr-vault-"));
});
afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

function seedSession(sid: string) {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_DATA, `sessions/${sid}.ndjson`),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n",
  );
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, `sessions/${sid}.prompt.json`), "{}");
}

const STUB_ITEMS = [
  { kind: "decision", title: "Pick X", project: "attrproj",
    body: "## Decision\nPick X.\n## Why\n- Best fit.\n## Alternatives considered\n- **Alt A** — rejected because cost.\n## Consequences\n- Trade-offs apply.",
    date: "2026-05-19", links: [] },
  { kind: "lesson", title: "Always verify the live path",
    rule: "Resolve the real data dir before claiming breakage.",
    why: "A full misdiagnosis came from inspecting the fallback path.",
    whenApplies: "Whenever a plugin appears not to be writing data.",
    date: "2026-05-19", links: [] },
  { kind: "project_fact", title: "Single writer", project: "attrproj",
    body: "The distiller is the only writer for vault notes.",
    date: "2026-05-19", links: [] },
];

it("stamps session_id and agent_role on create- and append-mode notes when both env vars present", () => {
  seedSession("SESS-AAA");
  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stub, JSON.stringify(STUB_ITEMS));

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT, SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "SESS-AAA", SUPERBRAIN_AGENT_ROLE: "engineer",
      SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });

  const dec = fs.readFileSync(path.join(TMP_VAULT, "decisions/2026-05-19-pick-x.md"), "utf8");
  expect(dec).toMatch(/^session_id: SESS-AAA$/m);
  expect(dec).toMatch(/^agent_role: engineer$/m);

  const lessonDir = path.join(TMP_VAULT, "lessons");
  const lessonFile = fs.readdirSync(lessonDir).find((f) => f.endsWith(".md"))!;
  const les = fs.readFileSync(path.join(lessonDir, lessonFile), "utf8");
  expect(les).toMatch(/^session_id: SESS-AAA$/m);
  expect(les).toMatch(/^agent_role: engineer$/m);

  const proj = fs.readFileSync(path.join(TMP_VAULT, "projects/attrproj.md"), "utf8");
  expect(proj).toMatch(/^session_id: SESS-AAA$/m);
  expect(proj).toMatch(/^agent_role: engineer$/m);

  const daily = fs.readFileSync(path.join(TMP_VAULT, "daily/2026-05-19.md"), "utf8");
  expect(daily).not.toMatch(/session_id|agent_role/);
});

it("stamps session_id only and omits agent_role when SUPERBRAIN_AGENT_ROLE is unset", () => {
  seedSession("SESS-BBB");
  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stub, JSON.stringify(STUB_ITEMS));

  const env = { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA,
    SUPERBRAIN_VAULT_DIR: TMP_VAULT, SUPERBRAIN_DISTILL_STUB: stub,
    SUPERBRAIN_SESSION_ID: "SESS-BBB", SUPERBRAIN_EMBED_STUB: "1" } as NodeJS.ProcessEnv;
  delete env.SUPERBRAIN_AGENT_ROLE;

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], { env, encoding: "utf8" });

  const dec = fs.readFileSync(path.join(TMP_VAULT, "decisions/2026-05-19-pick-x.md"), "utf8");
  expect(dec).toMatch(/^session_id: SESS-BBB$/m);
  expect(dec).not.toMatch(/agent_role/);
});
