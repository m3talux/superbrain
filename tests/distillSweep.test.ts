import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sweep-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sweep-vault-"));
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

function substantiveNdjson(): string {
  return JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n";
}

function writeStub(file: string) {
  fs.writeFileSync(file, JSON.stringify([
    { kind: "decision", title: "Pick X", project: "test",
      body: "## Decision\nPick X.\n## Why\n- Best fit.\n## Alternatives considered\n- **Alt A** — rejected because cost.\n## Consequences\n- Trade-offs apply.",
      date: "2026-05-19", links: [] },
  ]));
}

function runDistillFor(sid: string, stub: string) {
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: sid,
      SUPERBRAIN_EMBED_STUB: "1",
    },
    encoding: "utf8",
  });
}

it("next successful distill sweeps a flagged orphan session", () => {
  const bNdjson = path.join(TMP_DATA, "sessions/B.ndjson");
  fs.writeFileSync(bNdjson, substantiveNdjson());
  fs.writeFileSync(path.join(TMP_DATA, "sessions/B.needs-distill"), "1");
  fs.writeFileSync(path.join(TMP_DATA, "sessions/C.ndjson"), substantiveNdjson());

  const stub = path.join(TMP_DATA, "stub.json");
  writeStub(stub);

  runDistillFor("C", stub);

  const bSize = fs.statSync(bNdjson).size;
  const bCursor = path.join(TMP_DATA, "sessions/B.cursor");
  expect(fs.existsSync(bCursor)).toBe(true);
  expect(parseInt(fs.readFileSync(bCursor, "utf8").trim(), 10)).toBe(bSize);
  expect(fs.existsSync(path.join(TMP_DATA, "sessions/B.needs-distill"))).toBe(false);
});

it("re-distill of a swept session is a no-op (cursor unchanged, no new notes)", () => {
  const bNdjson = path.join(TMP_DATA, "sessions/B.ndjson");
  fs.writeFileSync(bNdjson, substantiveNdjson());
  fs.writeFileSync(path.join(TMP_DATA, "sessions/B.needs-distill"), "1");
  fs.writeFileSync(path.join(TMP_DATA, "sessions/C.ndjson"), substantiveNdjson());
  const stub = path.join(TMP_DATA, "stub.json");
  writeStub(stub);

  runDistillFor("C", stub);
  const cursorAfter1 = fs.readFileSync(path.join(TMP_DATA, "sessions/B.cursor"), "utf8").trim();
  const countNotes = () => {
    let n = 0;
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else if (e.name.endsWith(".md")) n++;
      }
    };
    walk(TMP_VAULT); return n;
  };
  const notesAfter1 = countNotes();

  fs.writeFileSync(path.join(TMP_DATA, "sessions/C2.ndjson"), substantiveNdjson());
  runDistillFor("C2", stub);

  expect(fs.readFileSync(path.join(TMP_DATA, "sessions/B.cursor"), "utf8").trim()).toBe(cursorAfter1);
  expect(countNotes()).toBeGreaterThanOrEqual(notesAfter1);
});

it("sweep clears the flag for an empty-delta flagged session", () => {
  const bNdjson = path.join(TMP_DATA, "sessions/B.ndjson");
  fs.writeFileSync(bNdjson, substantiveNdjson());
  fs.writeFileSync(path.join(TMP_DATA, "sessions/B.cursor"), String(fs.statSync(bNdjson).size));
  fs.writeFileSync(path.join(TMP_DATA, "sessions/B.needs-distill"), "1");
  fs.writeFileSync(path.join(TMP_DATA, "sessions/C.ndjson"), substantiveNdjson());
  const stub = path.join(TMP_DATA, "stub.json");
  writeStub(stub);

  runDistillFor("C", stub);
  expect(fs.existsSync(path.join(TMP_DATA, "sessions/B.needs-distill"))).toBe(false);
});

import { sweepPendingDistills, flagPath } from "../src/distillSweep.js";

it("a throwing flagged session is isolated; host distill and siblings unaffected", async () => {
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  fs.writeFileSync(flagPath("BAD"), "1");
  fs.writeFileSync(flagPath("GOOD"), "1");
  const seen: string[] = [];
  await sweepPendingDistills("HOST", async (sid) => {
    seen.push(sid);
    if (sid === "BAD") throw new Error("boom");
  });
  expect(seen.sort()).toEqual(["BAD", "GOOD"]);
  expect(fs.existsSync(flagPath("GOOD"))).toBe(false);
  expect(fs.existsSync(flagPath("BAD"))).toBe(true);
  delete process.env.SUPERBRAIN_DATA_DIR;
});
