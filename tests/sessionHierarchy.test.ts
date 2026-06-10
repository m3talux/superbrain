import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { upsertDay, childrenOf } from "../src/dailyState.js";

let TMP_DATA: string;
beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-hier-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
});
afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_DATA_DIR;
});

it("childrenOf filters by parent, ordered, empty + missing-file safe", () => {
  upsertDay("2026-06-11", "cZ", { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: ["t1"], parentSessionId: "P" });
  upsertDay("2026-06-11", "cA", { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: ["t2"], parentSessionId: "P" });
  upsertDay("2026-06-11", "other", { digestLine: "", routedRelPaths: [], alsoDid: [], openThreads: [], parentSessionId: "Q" });
  const kids = childrenOf("2026-06-11", "P");
  expect(kids.map(k => k.sessionId)).toEqual(["cA", "cZ"]);
  expect(kids[0].entry.openThreads).toEqual(["t2"]);
  expect(childrenOf("2026-06-11", "ZZZ")).toEqual([]);
  expect(childrenOf("1999-01-01", "P")).toEqual([]);
});

function runDistill(env: Record<string, string>, data: string, vault: string, stub: string) {
  fs.mkdirSync(path.join(data, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(data, "sessions/S.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  fs.mkdirSync(path.join(data, "locks/distill.lock"), { recursive: true });
  const merged = { ...process.env, SUPERBRAIN_DATA_DIR: data, SUPERBRAIN_VAULT_DIR: vault,
    SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1", ...env };
  if (!("SUPERBRAIN_PARENT_SESSION_ID" in env)) delete merged.SUPERBRAIN_PARENT_SESSION_ID;
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], { env: merged, encoding: "utf8" });
}

const STUB_ITEM = {
  items: [{ kind: "decision", title: "Pick X", project: "test",
    body: "## Decision\nPick X.\n## Why\n- Best fit.", date: "2026-05-19", links: [] }],
  digest: "Chose X", openThreads: ["wire Y"], alsoDid: [],
};

it("records parent in daily state and stamps notes when env set", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "sb-h-d-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "sb-h-v-"));
  const stub = path.join(data, "stub.json");
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(stub, JSON.stringify(STUB_ITEM));
  runDistill({ SUPERBRAIN_PARENT_SESSION_ID: "P" }, data, vault, stub);
  const day = JSON.parse(fs.readFileSync(path.join(data, "daily/2026-05-19.json"), "utf8"));
  expect(day.S.parentSessionId).toBe("P");
  const note = fs.readFileSync(path.join(vault, "decisions/2026-05-19-pick-x.md"), "utf8");
  expect(note).toMatch(/^parent_session_id: P$/m);
  fs.rmSync(data, { recursive: true, force: true });
  fs.rmSync(vault, { recursive: true, force: true });
});

it("omits parentage entirely when env unset", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "sb-h-d2-"));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "sb-h-v2-"));
  const stub = path.join(data, "stub.json");
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(stub, JSON.stringify(STUB_ITEM));
  runDistill({}, data, vault, stub);
  const day = JSON.parse(fs.readFileSync(path.join(data, "daily/2026-05-19.json"), "utf8"));
  expect("parentSessionId" in day.S).toBe(false);
  const note = fs.readFileSync(path.join(vault, "decisions/2026-05-19-pick-x.md"), "utf8");
  expect(note).not.toMatch(/parent_session_id/);
  fs.rmSync(data, { recursive: true, force: true });
  fs.rmSync(vault, { recursive: true, force: true });
});
