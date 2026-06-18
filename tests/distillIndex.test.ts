import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openIndex } from "../src/searchIndex";
import { embed, EMBED_DIM } from "../src/embed";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-di-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-di-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

it("a note written by the distiller is searchable in the index (BM25 and vector arms)", async () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/S.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stub, JSON.stringify([
    { kind: "decision", title: "Adopt sqlite-vec", project: "test",
      body: "## Decision\nAdopt sqlite-vec.\n## Why\n- Fast local KNN.\n## Alternatives considered\n- **Alt A** — rejected because slower.\n## Consequences\n- Better search.",
      date: "2026-05-19", links: [] },
  ]));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
  const ix = openIndex();
  // BM25 arm
  expect(ix.bm25("sqlite-vec", 5).length).toBeGreaterThan(0);

  // Vector arm (cross-version incident follow-up: the old assertion stopped
  // at bm25(), so an index whose vec_chunks rows were missing or mis-typed
  // still passed). The captured decision must be reachable via KNN ...
  const [qv] = await embed(["Adopt sqlite-vec fast local KNN"]);
  const knnHits = ix.vectorKNN(qv, 5);
  expect(knnHits.some((h) => h.relPath.startsWith("decisions/"))).toBe(true);

  // ... and every chunk of the captured note must carry an int8 vector of
  // exactly EMBED_DIM (256) bytes.
  const decisionPaths = ix.allIndexedPaths().filter((p) => p.startsWith("decisions/"));
  expect(decisionPaths.length).toBeGreaterThan(0);
  for (const rel of decisionPaths) {
    const lens = ix.db.prepare(`
      SELECT length(v.embedding) AS len
      FROM chunks c JOIN vec_chunks v ON v.chunk_id = c.id
      WHERE c.rel_path = ?
    `).all(rel) as { len: number }[];
    const chunkCount = (ix.db.prepare("SELECT count(*) AS c FROM chunks WHERE rel_path=?").get(rel) as { c: number }).c;
    expect(lens.length).toBe(chunkCount);
    expect(lens.length).toBeGreaterThan(0);
    for (const { len } of lens) expect(len).toBe(EMBED_DIM);
  }
  ix.close();
});
