# SuperBrain Phase 2 Implementation Plan (search + autonomous recall)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local hybrid (FTS5 + sqlite-vec, RRF) search index over the Obsidian vault with tiered autonomous recall — BM25 injected on every prompt, full hybrid on session start and via an MCP-backed `superbrain-recall` skill.

**Architecture:** Five new single-responsibility `src/` modules (chunker, embed, searchIndex, indexer, recall) + a pure MCP search handler. A new synchronous `UserPromptSubmit` hook (`sb-recall`, BM25 only, no model load) runs alongside the existing async observer. `sb-session-start` becomes synchronous (also fixes a latent Phase-1 injection gap), adds a hybrid digest, and kicks a detached index reconcile. The distiller incrementally indexes notes it writes. A stdio MCP server exposes hybrid search for the skill.

**Tech Stack:** Existing (Node ≥20, TS ESM/NodeNext, vitest, gray-matter) + `better-sqlite3` (SQLite+FTS5), `sqlite-vec` (vector ext), `@huggingface/transformers` (Transformers.js v3, all-MiniLM-L6-v2, 384-dim), `@modelcontextprotocol/sdk`.

---

## Conventions (same as Phase 1)

- Branch: `phase-2-search-recall` (already created; spec already committed there).
- NodeNext: every relative import in `src/`/`bin/` ends in `.js`. Bare package imports do not.
- TDD: write failing test → see it fail → minimal impl → see it pass → commit.
- All hooks: recursion-guard first, whole body in try/catch, **always exit 0**.
- Offline tests: the embedding model is never downloaded in unit tests — an
  `SUPERBRAIN_EMBED_STUB=1` seam returns deterministic pseudo-vectors (mirrors Phase-1's
  distiller-stub discipline). The real model path is exercised only by one env-guarded
  integration test that is skipped when the model/stub isn't present.
- Commit message footer line: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- Author identity: `git -c user.email=alex@weaviate.io -c user.name=alex commit ...`
- Vector dim: **384** (all-MiniLM-L6-v2).

## File Structure

```
src/
  chunker.ts        # pure: note → per-heading section chunks
  embed.ts          # lazy Transformers.js MiniLM; SUPERBRAIN_EMBED_STUB seam
  searchIndex.ts    # better-sqlite3 + sqlite-vec: schema + upsert/delete/bm25/vectorKNN/rrf
  indexer.ts        # indexNote (incremental) + reconcile (mtime/hash drift)
  recall.ts         # bm25Recall (no embed) + hybridRecall (embed→vec+fts→RRF, degrades)
  mcpSearch.ts      # pure handler: {query,k} → formatted hybrid results
bin/
  sb-recall.ts      # NEW sync UserPromptSubmit hook (BM25 pointers)
  sb-mcp.ts          # NEW stdio MCP server (wires mcpSearch)
  sb-distill.ts     # MODIFY: indexNote after each writeNote
  sb-session-start.ts# MODIFY: sync + hybrid digest + detached reconcile
hooks/hooks.json     # MODIFY: add sync sb-recall UserPromptSubmit; SessionStart → sync
.claude-plugin/plugin.json  # MODIFY: add recall skill + mcp
.mcp.json            # NEW
skills/superbrain-recall/SKILL.md  # NEW
```

---

### Task 1: Dependency spike — verify native modules load

**Files:**
- Modify: `package.json`
- Create: `tests/deps.test.ts`

Native-module risk (spec §9): confirm `better-sqlite3` + `sqlite-vec` load and FTS5 +
vec0 work in this environment **before** building the schema layer.

- [ ] **Step 1: Install deps**

Run:
```bash
cd /Users/alex/Projects/Vibe/SuperBrain
npm i better-sqlite3@^11 sqlite-vec@^0.1 @huggingface/transformers@^3 @modelcontextprotocol/sdk@^1
npm i -D @types/better-sqlite3@^7
```

- [ ] **Step 2: Write the probe test**

`tests/deps.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

describe("native deps", () => {
  it("better-sqlite3 has FTS5 and sqlite-vec loads vec0", () => {
    const db = new Database(":memory:");
    sqliteVec.load(db);
    db.exec("CREATE VIRTUAL TABLE f USING fts5(t)");
    db.prepare("INSERT INTO f(t) VALUES (?)").run("hello world");
    const hit = db.prepare("SELECT t FROM f WHERE f MATCH ?").get("hello") as any;
    expect(hit.t).toBe("hello world");
    db.exec("CREATE VIRTUAL TABLE v USING vec0(id integer primary key, e float[3])");
    db.prepare("INSERT INTO v(id,e) VALUES (1,?)").run(JSON.stringify([0.1, 0.2, 0.3]));
    const row = db.prepare(
      "SELECT id, distance FROM v WHERE e MATCH ? ORDER BY distance LIMIT 1"
    ).get(JSON.stringify([0.1, 0.2, 0.3])) as any;
    expect(row.id).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run tests/deps.test.ts`
Expected: PASS.

**If it fails to install/load** (native ABI mismatch, no prebuilt for host): STOP and
report BLOCKED with the exact error. Do not hand-patch. The controller will decide the
documented fallback (Node ≥22 `node:sqlite` + a JS cosine fallback for the vector tier),
which changes Tasks 4–6 only.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tests/deps.test.ts
git commit -m "chore: add + verify Phase-2 native deps (better-sqlite3, sqlite-vec, transformers, mcp sdk)"
```

---

### Task 2: `src/chunker.ts` — per-heading section chunks

**Files:**
- Create: `src/chunker.ts`, `tests/chunker.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/chunker.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { chunkNote } from "../src/chunker";

describe("chunkNote", () => {
  it("splits body at ## / ### headings with breadcrumb headingPath", () => {
    const raw = [
      "---", "type: project", "status: active", "---",
      "preamble line",
      "## Decisions",
      "chose X over Y",
      "### Detail",
      "because Z",
      "## Gotchas",
      "- bug: never relearn",
    ].join("\n");
    const c = chunkNote(raw);
    expect(c.map((x) => x.headingPath)).toEqual(["", "Decisions", "Decisions > Detail", "Gotchas"]);
    expect(c[0].text).toContain("preamble line");
    expect(c[1].text).toContain("chose X over Y");
    expect(c[3].anchor).toBe("gotchas");
    expect(c.every((x) => x.text.trim().length > 0)).toBe(true);
  });
  it("a note with no headings yields a single chunk", () => {
    const c = chunkNote("---\ntype: capture\nstatus: active\n---\njust body text");
    expect(c.length).toBe(1);
    expect(c[0].headingPath).toBe("");
    expect(c[0].text).toContain("just body text");
  });
  it("drops empty sections", () => {
    const c = chunkNote("# A\n\n## B\n\ncontent");
    expect(c.find((x) => x.headingPath === "A")).toBeUndefined();
    expect(c.find((x) => x.headingPath === "A > B")?.text).toContain("content");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/chunker.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/chunker.ts`:
```ts
import { parseNote } from "./frontmatter.js";

export interface Chunk { headingPath: string; anchor: string; text: string; }

function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function chunkNote(raw: string): Chunk[] {
  const { content } = parseNote(raw);
  const lines = content.split("\n");
  const out: Chunk[] = [];
  const stack: { level: number; title: string }[] = [];
  let buf: string[] = [];
  let curPath = "";
  let curAnchor = "";

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) out.push({ headingPath: curPath, anchor: curAnchor, text });
    buf = [];
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      const title = m[2].trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
      curPath = stack.map((s) => s.title).join(" > ");
      curAnchor = slug(title);
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/chunker.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/chunker.ts tests/chunker.test.ts
git commit -m "feat: per-heading section chunker"
```

---

### Task 3: `src/embed.ts` — lazy embeddings + stub seam

**Files:**
- Create: `src/embed.ts`, `tests/embed.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/embed.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { embed, EMBED_DIM } from "../src/embed";

beforeEach(() => { process.env.SUPERBRAIN_EMBED_STUB = "1"; });

describe("embed (stub seam)", () => {
  it("returns one 384-dim unit-ish vector per input, deterministically", async () => {
    const [a1] = await embed(["hello world"]);
    const [a2] = await embed(["hello world"]);
    const [b1] = await embed(["totally different"]);
    expect(a1.length).toBe(EMBED_DIM);
    expect(Array.from(a1)).toEqual(Array.from(a2));   // deterministic
    expect(Array.from(a1)).not.toEqual(Array.from(b1)); // input-sensitive
  });
  it("batches", async () => {
    const v = await embed(["a", "b", "c"]);
    expect(v.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/embed.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/embed.ts`:
```ts
import crypto from "node:crypto";

export const EMBED_DIM = 384;
export const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

function stubVector(text: string): Float32Array {
  // Deterministic, input-sensitive pseudo-embedding for offline tests only.
  const v = new Float32Array(EMBED_DIM);
  let seed = crypto.createHash("sha256").update(text).digest();
  for (let i = 0; i < EMBED_DIM; i++) v[i] = (seed[i % seed.length] / 255) * 2 - 1;
  let n = Math.hypot(...v) || 1;
  for (let i = 0; i < EMBED_DIM; i++) v[i] /= n;
  return v;
}

let extractorPromise: Promise<any> | null = null;
async function getExtractor(): Promise<any> {
  if (!extractorPromise) {
    extractorPromise = import("@huggingface/transformers").then(({ pipeline, env }) => {
      env.allowRemoteModels = true; // fetched once, cached by the library
      return pipeline("feature-extraction", MODEL_ID);
    });
  }
  return extractorPromise;
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (process.env.SUPERBRAIN_EMBED_STUB === "1") return texts.map(stubVector);
  const extractor = await getExtractor();
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  const list: number[][] = out.tolist();
  return list.map((a) => Float32Array.from(a));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/embed.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/embed.ts tests/embed.test.ts
git commit -m "feat: lazy MiniLM embeddings with deterministic offline stub seam"
```

---

### Task 4: `src/searchIndex.ts` — sqlite schema + ops

**Files:**
- Create: `src/searchIndex.ts`, `tests/searchIndex.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/searchIndex.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { openIndex, rrf } from "../src/searchIndex";

beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-idx"; fs.rmSync("/tmp/sb-idx", { recursive: true, force: true }); });

const vec = (n: number) => Float32Array.from(Array(384).fill(n));

describe("searchIndex", () => {
  it("upsert → bm25 + vectorKNN; re-upsert replaces; delete removes", () => {
    const ix = openIndex();
    ix.upsertNote("projects/x.md", 1, "h1", [
      { headingPath: "Decisions", anchor: "decisions", text: "chose sqlite-vec for vectors" },
    ], [vec(0.1)]);
    ix.upsertNote("people/y.md", 1, "h2", [
      { headingPath: "", anchor: "", text: "Jane leads the search team" },
    ], [vec(0.9)]);

    const bm = ix.bm25("sqlite-vec", 5);
    expect(bm[0].relPath).toBe("projects/x.md");
    const kn = ix.vectorKNN(vec(0.1), 1);
    expect(kn[0].relPath).toBe("projects/x.md");

    ix.upsertNote("projects/x.md", 2, "h1b", [
      { headingPath: "Decisions", anchor: "decisions", text: "switched to lancedb" },
    ], [vec(0.2)]);
    expect(ix.bm25("sqlite-vec", 5).length).toBe(0);
    expect(ix.bm25("lancedb", 5)[0].relPath).toBe("projects/x.md");

    ix.deleteNote("projects/x.md");
    expect(ix.bm25("lancedb", 5).length).toBe(0);
    ix.close();
  });
  it("rrf fuses ranked id lists", () => {
    expect(rrf([["a", "b", "c"], ["c", "a"]], 2)).toEqual(["a", "c"]);
  });
  it("tracks note hash/mtime for reconcile diffing", () => {
    const ix = openIndex();
    ix.upsertNote("a.md", 5, "hashA", [{ headingPath: "", anchor: "", text: "t" }], [vec(0.3)]);
    expect(ix.getNoteMeta("a.md")).toEqual({ mtime: 5, hash: "hashA" });
    expect(ix.getNoteMeta("missing.md")).toBeNull();
    expect(ix.allIndexedPaths()).toEqual(["a.md"]);
    ix.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/searchIndex.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/searchIndex.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { dataDir } from "./paths.js";
import { EMBED_DIM } from "./embed.js";

export interface Hit { relPath: string; headingPath: string; anchor: string; text: string; }

export interface Index {
  upsertNote(relPath: string, mtime: number, hash: string,
             chunks: { headingPath: string; anchor: string; text: string }[],
             embeddings: Float32Array[]): void;
  deleteNote(relPath: string): void;
  bm25(query: string, k: number): Hit[];
  vectorKNN(v: Float32Array, k: number): Hit[];
  getNoteMeta(relPath: string): { mtime: number; hash: string } | null;
  allIndexedPaths(): string[];
  close(): void;
}

export function rrf(lists: string[][], k: number, c = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists)
    list.forEach((id, i) => score.set(id, (score.get(id) || 0) + 1 / (c + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id);
}

export function openIndex(): Index {
  const dbPath = path.join(dataDir(), "index.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (rel_path TEXT PRIMARY KEY, mtime INTEGER, hash TEXT);
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY, rel_path TEXT, heading_path TEXT, anchor TEXT, text TEXT);
    CREATE INDEX IF NOT EXISTS chunks_rel ON chunks(rel_path);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, content='');
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      chunk_id integer primary key, embedding float[${EMBED_DIM}]);
  `);

  const delByPath = db.transaction((relPath: string) => {
    const rows = db.prepare("SELECT id FROM chunks WHERE rel_path=?").all(relPath) as { id: number }[];
    for (const r of rows) {
      db.prepare("DELETE FROM chunks_fts WHERE rowid=?").run(r.id);
      db.prepare("DELETE FROM vec_chunks WHERE chunk_id=?").run(r.id);
    }
    db.prepare("DELETE FROM chunks WHERE rel_path=?").run(relPath);
    db.prepare("DELETE FROM notes WHERE rel_path=?").run(relPath);
  });

  const insChunk = db.prepare("INSERT INTO chunks(rel_path,heading_path,anchor,text) VALUES (?,?,?,?)");
  const insFts = db.prepare("INSERT INTO chunks_fts(rowid,text) VALUES (?,?)");
  const insVec = db.prepare("INSERT INTO vec_chunks(chunk_id,embedding) VALUES (?,?)");
  const insNote = db.prepare("INSERT OR REPLACE INTO notes(rel_path,mtime,hash) VALUES (?,?,?)");

  const upsert = db.transaction((relPath: string, mtime: number, hash: string,
      chunks: { headingPath: string; anchor: string; text: string }[], embs: Float32Array[]) => {
    delByPath(relPath);
    chunks.forEach((c, i) => {
      const id = insChunk.run(relPath, c.headingPath, c.anchor, c.text).lastInsertRowid as number;
      insFts.run(id, c.text);
      insVec.run(id, JSON.stringify(Array.from(embs[i])));
    });
    insNote.run(relPath, mtime, hash);
  });

  const hydrate = (ids: number[]): Hit[] => ids.map((id) => {
    const r = db.prepare("SELECT rel_path,heading_path,anchor,text FROM chunks WHERE id=?").get(id) as any;
    return r ? { relPath: r.rel_path, headingPath: r.heading_path, anchor: r.anchor, text: r.text } : null;
  }).filter(Boolean) as Hit[];

  return {
    upsertNote: (rp, mt, h, c, e) => upsert(rp, mt, h, c, e),
    deleteNote: (rp) => delByPath(rp),
    bm25: (q, k) => {
      const rows = db.prepare(
        "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?"
      ).all(q.replace(/[^\w\s]/g, " ").trim() || '""', k) as { rowid: number }[];
      return hydrate(rows.map((r) => r.rowid));
    },
    vectorKNN: (v, k) => {
      const rows = db.prepare(
        "SELECT chunk_id FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT ?"
      ).all(JSON.stringify(Array.from(v)), k) as { chunk_id: number }[];
      return hydrate(rows.map((r) => r.chunk_id));
    },
    getNoteMeta: (rp) => {
      const r = db.prepare("SELECT mtime,hash FROM notes WHERE rel_path=?").get(rp) as any;
      return r ? { mtime: r.mtime, hash: r.hash } : null;
    },
    allIndexedPaths: () =>
      (db.prepare("SELECT rel_path FROM notes ORDER BY rel_path").all() as any[]).map((r) => r.rel_path),
    close: () => db.close(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/searchIndex.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/searchIndex.ts tests/searchIndex.test.ts
git commit -m "feat: sqlite-vec + FTS5 search index (upsert/delete/bm25/knn/rrf, reconcile meta)"
```

---

### Task 5: `src/recall.ts` — tiered recall

**Files:**
- Create: `src/recall.ts`, `tests/recall.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/recall.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { openIndex } from "../src/searchIndex";
import { bm25Recall, hybridRecall } from "../src/recall";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-recall";
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  fs.rmSync("/tmp/sb-recall", { recursive: true, force: true });
  const ix = openIndex();
  ix.upsertNote("decisions/2026-05-01-vec.md", 1, "h", [
    { headingPath: "", anchor: "", text: "we chose sqlite-vec over chromadb for local vectors" },
  ], [Float32Array.from(Array(384).fill(0.5))]);
  ix.close();
});

describe("recall", () => {
  it("bm25Recall returns pointers without loading embeddings", async () => {
    const r = await bm25Recall("sqlite-vec", 3);
    expect(r[0].relPath).toBe("decisions/2026-05-01-vec.md");
    expect(r[0].text).toContain("sqlite-vec");
  });
  it("hybridRecall returns pointers (embed via stub)", async () => {
    const r = await hybridRecall("local vector database", 3);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].relPath).toBe("decisions/2026-05-01-vec.md");
  });
  it("hybridRecall degrades to bm25 if embedding throws", async () => {
    delete process.env.SUPERBRAIN_EMBED_STUB; // forces real model; we simulate failure via bad model id env
    process.env.SUPERBRAIN_EMBED_FORCE_FAIL = "1";
    const r = await hybridRecall("sqlite-vec", 3);
    expect(r[0].relPath).toBe("decisions/2026-05-01-vec.md");
    delete process.env.SUPERBRAIN_EMBED_FORCE_FAIL;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/recall.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Add the force-fail seam to `embed.ts`, then write `recall.ts`**

In `src/embed.ts`, at the very top of `embed()` (before the stub check) add:
```ts
  if (process.env.SUPERBRAIN_EMBED_FORCE_FAIL === "1") throw new Error("embed forced failure (test)");
```

`src/recall.ts`:
```ts
import { openIndex, rrf, type Hit } from "./searchIndex.js";
import { embed } from "./embed.js";

export interface Pointer { relPath: string; headingPath: string; anchor: string; excerpt: string; }

function toPointers(hits: Hit[]): Pointer[] {
  return hits.map((h) => ({
    relPath: h.relPath, headingPath: h.headingPath, anchor: h.anchor,
    excerpt: h.text.replace(/\s+/g, " ").trim().slice(0, 160),
  }));
}
const keyOf = (h: Hit) => `${h.relPath}#${h.anchor}`;

export async function bm25Recall(query: string, k: number): Promise<Pointer[]> {
  const ix = openIndex();
  try { return toPointers(ix.bm25(query, k)); }
  catch { return []; }
  finally { ix.close(); }
}

export async function hybridRecall(query: string, k: number): Promise<Pointer[]> {
  const ix = openIndex();
  try {
    const bm = ix.bm25(query, k * 2);
    let vec: Hit[] = [];
    try {
      const [qv] = await embed([query]);
      vec = ix.vectorKNN(qv, k * 2);
    } catch { /* degrade to bm25-only */ }
    if (vec.length === 0) return toPointers(bm.slice(0, k));
    const byKey = new Map<string, Hit>();
    [...bm, ...vec].forEach((h) => byKey.set(keyOf(h), h));
    const fused = rrf([bm.map(keyOf), vec.map(keyOf)], k);
    return toPointers(fused.map((kk) => byKey.get(kk)!).filter(Boolean));
  } catch { return []; }
  finally { ix.close(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/recall.test.ts tests/embed.test.ts`
Expected: recall 3 passed; embed still 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/recall.ts src/embed.ts tests/recall.test.ts
git commit -m "feat: tiered recall (bm25Recall no-embed; hybridRecall RRF, degrades to bm25)"
```

---

### Task 6: `src/indexer.ts` — indexNote + reconcile

**Files:**
- Create: `src/indexer.ts`, `tests/indexer.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/indexer.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { indexNote, reconcile } from "../src/indexer";
import { openIndex } from "../src/searchIndex";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-indexer";
  process.env.SUPERBRAIN_VAULT = "/tmp/sb-indexer-vault";
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  fs.rmSync("/tmp/sb-indexer", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-indexer-vault", { recursive: true, force: true });
  fs.mkdirSync("/tmp/sb-indexer-vault/decisions", { recursive: true });
});

describe("indexer", () => {
  it("indexNote indexes a single file's chunks", async () => {
    fs.writeFileSync("/tmp/sb-indexer-vault/decisions/a.md",
      "---\ntype: decision\nstatus: active\n---\n## D\npicked raft over paxos");
    await indexNote("decisions/a.md");
    const ix = openIndex();
    expect(ix.bm25("raft", 5)[0].relPath).toBe("decisions/a.md");
    ix.close();
  });
  it("reconcile adds new, updates changed, deletes removed, no-ops unchanged", async () => {
    const f = "/tmp/sb-indexer-vault/decisions/b.md";
    fs.writeFileSync(f, "---\ntype: decision\nstatus: active\n---\noriginal alpha");
    let s = await reconcile();
    expect(s).toMatchObject({ added: 1 });
    s = await reconcile(); // unchanged
    expect(s).toMatchObject({ added: 0, updated: 0, deleted: 0 });
    fs.writeFileSync(f, "---\ntype: decision\nstatus: active\n---\nrewritten beta");
    s = await reconcile();
    expect(s).toMatchObject({ updated: 1 });
    const ix = openIndex();
    expect(ix.bm25("alpha", 5).length).toBe(0);
    expect(ix.bm25("beta", 5)[0].relPath).toBe("decisions/b.md");
    ix.close();
    fs.rmSync(f);
    s = await reconcile();
    expect(s).toMatchObject({ deleted: 1 });
  });
  it("reconcile skips .trash and .obsidian", async () => {
    fs.mkdirSync("/tmp/sb-indexer-vault/.trash", { recursive: true });
    fs.writeFileSync("/tmp/sb-indexer-vault/.trash/old.md", "## x\ntrashed");
    await reconcile();
    const ix = openIndex();
    expect(ix.bm25("trashed", 5).length).toBe(0);
    ix.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/indexer.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/indexer.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { vaultPath } from "./paths.js";
import { chunkNote } from "./chunker.js";
import { embed } from "./embed.js";
import { openIndex } from "./searchIndex.js";

const EXCLUDED = new Set([".trash", ".obsidian", ".git", "node_modules"]);

function walk(dir: string, root: string, acc: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (EXCLUDED.has(e.name)) continue;
      walk(path.join(dir, e.name), root, acc);
    } else if (e.name.endsWith(".md")) {
      acc.push(path.relative(root, path.join(dir, e.name)));
    }
  }
}
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

async function indexInto(ix: ReturnType<typeof openIndex>, relPath: string) {
  const abs = path.join(vaultPath(), relPath);
  const raw = fs.readFileSync(abs, "utf8");
  const chunks = chunkNote(raw);
  if (chunks.length === 0) { ix.deleteNote(relPath); return; }
  const embs = await embed(chunks.map((c) => c.text));
  ix.upsertNote(relPath, Math.floor(fs.statSync(abs).mtimeMs), sha(raw), chunks, embs);
}

export async function indexNote(relPath: string): Promise<void> {
  const ix = openIndex();
  try { await indexInto(ix, relPath); } finally { ix.close(); }
}

export async function reconcile(): Promise<{ added: number; updated: number; deleted: number }> {
  const root = vaultPath();
  const ix = openIndex();
  const res = { added: 0, updated: 0, deleted: 0 };
  try {
    if (!fs.existsSync(root)) return res;
    const present: string[] = [];
    walk(root, root, present);
    const presentSet = new Set(present);
    for (const rel of present) {
      const raw = fs.readFileSync(path.join(root, rel), "utf8");
      const meta = ix.getNoteMeta(rel);
      const h = sha(raw);
      if (!meta) { await indexInto(ix, rel); res.added++; }
      else if (meta.hash !== h) { await indexInto(ix, rel); res.updated++; }
    }
    for (const rel of ix.allIndexedPaths())
      if (!presentSet.has(rel)) { ix.deleteNote(rel); res.deleted++; }
    return res;
  } finally { ix.close(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/indexer.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/indexer.ts tests/indexer.test.ts
git commit -m "feat: indexer (indexNote incremental + idempotent reconcile with drift detection)"
```

---

### Task 7: `bin/sb-recall.ts` — synchronous UserPromptSubmit recall hook

**Files:**
- Create: `bin/sb-recall.ts`, `tests/sbRecall.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/sbRecall.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { openIndex } from "../src/searchIndex";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-rh";
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  fs.rmSync("/tmp/sb-rh", { recursive: true, force: true });
  const ix = openIndex();
  ix.upsertNote("projects/super-brain.md", 1, "h",
    [{ headingPath: "Decisions", anchor: "decisions", text: "we picked RRF hybrid fusion for recall" }],
    [Float32Array.from(Array(384).fill(0.4))]);
  ix.close();
});

function run(hook: object, extraEnv: Record<string, string> = {}) {
  return execFileSync("npx", ["tsx", "bin/sb-recall.ts"], {
    input: JSON.stringify(hook),
    env: { ...process.env, ...extraEnv }, encoding: "utf8",
  });
}

describe("sb-recall", () => {
  it("injects additionalContext pointers for a relevant prompt", () => {
    const out = run({ session_id: "S", hook_event_name: "UserPromptSubmit", cwd: "/p",
                       prompt: "how did we do recall fusion?" });
    expect(out).toMatch(/additionalContext/);
    expect(out).toMatch(/super-brain/);
  });
  it("emits nothing for an empty prompt and exits 0", () => {
    const out = run({ session_id: "S", hook_event_name: "UserPromptSubmit", cwd: "/p", prompt: "" });
    expect(out.trim()).toBe("");
  });
  it("recursion guard makes it a silent no-op", () => {
    const out = run({ session_id: "S", hook_event_name: "UserPromptSubmit", cwd: "/p", prompt: "recall" },
                     { SUPERBRAIN_CHILD: "1" });
    expect(out.trim()).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sbRecall.test.ts`
Expected: FAIL (cannot find `bin/sb-recall.ts`).

- [ ] **Step 3: Write minimal implementation**

`bin/sb-recall.ts`:
```ts
#!/usr/bin/env node
import fs from "node:fs";
import { isChild } from "../src/distillerEngine.js";
import { bm25Recall } from "../src/recall.js";

function readStdin(): string { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }

async function main() {
  if (isChild()) process.exit(0);
  try {
    let h: any; try { h = JSON.parse(readStdin()); } catch { process.exit(0); }
    const prompt = (h?.prompt || "").trim();
    if (!prompt) process.exit(0);
    const hits = await bm25Recall(prompt, 5);
    if (hits.length) {
      const lines = hits.map((p) => `- [[${p.relPath.replace(/\.md$/, "")}]]${p.headingPath ? " › " + p.headingPath : ""} — ${p.excerpt}`);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "SuperBrain recall (your vault may already answer this):\n" + lines.join("\n"),
        },
      }));
    }
  } catch { /* never disrupt the turn */ }
  process.exit(0);
}
main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sbRecall.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add bin/sb-recall.ts tests/sbRecall.test.ts
git commit -m "feat: synchronous UserPromptSubmit recall hook (BM25 pointers, exit-0 safe)"
```

---

### Task 8: `src/mcpSearch.ts` — pure MCP search handler

**Files:**
- Create: `src/mcpSearch.ts`, `tests/mcpSearch.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/mcpSearch.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { openIndex } from "../src/searchIndex";
import { handleSearch } from "../src/mcpSearch";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-mcps";
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  fs.rmSync("/tmp/sb-mcps", { recursive: true, force: true });
  const ix = openIndex();
  ix.upsertNote("decisions/x.md", 1, "h",
    [{ headingPath: "", anchor: "", text: "adopted mcpvault then replaced it with an in-process writer" }],
    [Float32Array.from(Array(384).fill(0.2))]);
  ix.close();
});

describe("handleSearch", () => {
  it("returns formatted text content for a query", async () => {
    const r = await handleSearch({ query: "in-process writer", k: 3 });
    expect(r.content[0].type).toBe("text");
    expect(r.content[0].text).toMatch(/decisions\/x/);
  });
  it("returns a no-results message, never throws", async () => {
    const r = await handleSearch({ query: "nonexistent zzzzz", k: 3 });
    expect(r.content[0].text).toMatch(/no results/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcpSearch.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/mcpSearch.ts`:
```ts
import { hybridRecall } from "./recall.js";

export interface McpText { content: { type: "text"; text: string }[]; }

export async function handleSearch(args: { query: string; k?: number }): Promise<McpText> {
  const q = (args?.query || "").trim();
  const k = Math.min(Math.max(args?.k ?? 8, 1), 20);
  if (!q) return { content: [{ type: "text", text: "No query provided." }] };
  let hits;
  try { hits = await hybridRecall(q, k); } catch { hits = []; }
  if (!hits.length) return { content: [{ type: "text", text: `No results for "${q}".` }] };
  const body = hits.map((p, i) =>
    `${i + 1}. [[${p.relPath.replace(/\.md$/, "")}]]${p.headingPath ? " › " + p.headingPath : ""}\n   ${p.excerpt}`
  ).join("\n");
  return { content: [{ type: "text", text: `SuperBrain results for "${q}":\n${body}` }] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcpSearch.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/mcpSearch.ts tests/mcpSearch.test.ts
git commit -m "feat: pure MCP search handler over hybridRecall"
```

---

### Task 9: `bin/sb-mcp.ts` — stdio MCP server

**Files:**
- Create: `bin/sb-mcp.ts`, `tests/sbMcp.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/sbMcp.test.ts` (drives the server over stdio with two JSON-RPC messages):
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { openIndex } from "../src/searchIndex";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-mcp";
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  fs.rmSync("/tmp/sb-mcp", { recursive: true, force: true });
  const ix = openIndex();
  ix.upsertNote("projects/p.md", 1, "h",
    [{ headingPath: "", anchor: "", text: "the daily rollup converges with a stable v1 gate" }],
    [Float32Array.from(Array(384).fill(0.7))]);
  ix.close();
});

it("responds to initialize, tools/list, and tools/call over stdio", () => {
  const msgs = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "superbrain_search", arguments: { query: "rollup converges", k: 3 } } },
  ].map((m) => JSON.stringify(m)).join("\n") + "\n";
  const out = execFileSync("npx", ["tsx", "bin/sb-mcp.ts"], { input: msgs, encoding: "utf8", timeout: 30000 });
  expect(out).toMatch(/"superbrain_search"/);     // tools/list
  expect(out).toMatch(/projects\/p/);             // tools/call result
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sbMcp.test.ts`
Expected: FAIL (cannot find `bin/sb-mcp.ts`).

- [ ] **Step 3: Write minimal implementation**

`bin/sb-mcp.ts`:
```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { handleSearch } from "../src/mcpSearch.js";

const server = new McpServer({ name: "superbrain", version: "0.2.0" });

server.tool(
  "superbrain_search",
  "Search the user's SuperBrain Obsidian vault (past decisions, projects, people, gotchas).",
  { query: z.string(), k: z.number().optional() },
  async ({ query, k }) => handleSearch({ query, k }),
);

const transport = new StdioServerTransport();
server.connect(transport).catch(() => process.exit(1));
```

> If `McpServer`'s `.tool(name, desc, schema, handler)` signature differs in the
> installed SDK version, adapt to the installed API (check
> `node_modules/@modelcontextprotocol/sdk` types) — the contract that must hold: a tool
> named `superbrain_search` taking `{query, k?}` returning `handleSearch(...)`. `zod` is
> a transitive dep of the SDK; if it is not resolvable, add `npm i zod`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sbMcp.test.ts`
Expected: PASS (tools/list shows the tool; tools/call returns the indexed note).
If the test times out, the server likely didn't flush on stdin EOF — ensure the process
stays attached to the transport (no manual `process.exit(0)` before responses are
written); the test sends EOF after the 3 messages and reads accumulated stdout.

- [ ] **Step 5: Commit**

```bash
git add bin/sb-mcp.ts tests/sbMcp.test.ts package.json package-lock.json
git commit -m "feat: stdio MCP server exposing superbrain_search"
```

---

### Task 10: Wire incremental indexing into the distiller

**Files:**
- Modify: `bin/sb-distill.ts`
- Create: `tests/distillIndex.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/distillIndex.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { openIndex } from "../src/searchIndex";

beforeEach(() => {
  fs.rmSync("/tmp/sb-di", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-di-vault", { recursive: true, force: true });
});

it("a note written by the distiller is searchable in the index", () => {
  fs.mkdirSync("/tmp/sb-di/sessions", { recursive: true });
  fs.writeFileSync("/tmp/sb-di/sessions/S.ndjson",
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  const stub = "/tmp/sb-di/stub.json";
  fs.writeFileSync(stub, JSON.stringify([
    { kind: "decision", title: "Adopt sqlite-vec", body: "fast local KNN", date: "2026-05-19", links: [] },
  ]));
  fs.mkdirSync("/tmp/sb-di/locks/distill.lock", { recursive: true });
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-di", SUPERBRAIN_VAULT: "/tmp/sb-di-vault",
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
  const ix = openIndex();
  expect(ix.bm25("sqlite-vec", 5).length).toBeGreaterThan(0);
  ix.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/distillIndex.test.ts`
Expected: FAIL (note written but not indexed).

- [ ] **Step 3: Modify `bin/sb-distill.ts`**

Add the import near the other `../src/*.js` imports:
```ts
import { indexNote } from "../src/indexer.js";
```
In the delta-distill loop, immediately after the existing successful-write +
`appendLog(...)` for a routed note, add an index call. The existing loop body looks like:
```ts
      const res = writeNote(r.relPath, { frontmatter: r.frontmatter, body: r.body, mode: r.mode });
      if (res.ok) appendLog(it.title || it.kind, r.relPath);
```
Change it to:
```ts
      const res = writeNote(r.relPath, { frontmatter: r.frontmatter, body: r.body, mode: r.mode });
      if (res.ok) {
        appendLog(it.title || it.kind, r.relPath);
        try { await indexNote(r.relPath); } catch (e: any) { writeFailure(`index failed: ${e?.message || e}`); }
      }
```
Apply the **same** wrapping to the rollup-mode write path (where the rollup item is
written) so rollup notes are indexed too. Indexing failure is non-fatal (sentinel-logged;
`reconcile` heals later). `main()` is already `async` in sb-distill — confirm `await`
compiles; if the loop is not inside an async function, make the enclosing function
`async` and `await main()` at the bottom (it already is, per Phase 1).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/distillIndex.test.ts tests/distill.test.ts tests/distillRollup.test.ts`
Expected: distillIndex 1 passed; the two existing distill tests still green.

- [ ] **Step 5: Commit**

```bash
git add bin/sb-distill.ts tests/distillIndex.test.ts
git commit -m "feat: distiller incrementally indexes notes it writes"
```

---

### Task 11: SessionStart → synchronous + hybrid digest + detached reconcile

**Files:**
- Modify: `bin/sb-session-start.ts`
- Create: `tests/sessionStartDigest.test.ts`

This fixes the latent Phase-1 gap (async SessionStart's `additionalContext` was never
injected) and adds the recall digest + a detached reconcile.

- [ ] **Step 1: Write the failing test**

`tests/sessionStartDigest.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { openIndex } from "../src/searchIndex";

beforeEach(() => {
  fs.rmSync("/tmp/sb-ssd", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-ssd-vault", { recursive: true, force: true });
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  const old = process.env.CLAUDE_PLUGIN_DATA; process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-ssd";
  const ix = openIndex();
  ix.upsertNote("projects/super-brain.md", 1, "h",
    [{ headingPath: "Status", anchor: "status", text: "phase 1 shipped; phase 2 adds hybrid search" }],
    [Float32Array.from(Array(384).fill(0.6))]);
  ix.close(); process.env.CLAUDE_PLUGIN_DATA = old;
});

it("SessionStart emits a hybrid recall digest in additionalContext", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-ssd", SUPERBRAIN_VAULT: "/tmp/sb-ssd-vault",
           SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
  expect(out).toMatch(/additionalContext/);
  expect(out).toMatch(/super-brain/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sessionStartDigest.test.ts`
Expected: FAIL (no recall digest emitted).

- [ ] **Step 3: Modify `bin/sb-session-start.ts`**

Add imports:
```ts
import { hybridRecall } from "../src/recall.js";
import { reconcile } from "../src/indexer.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
```
In `main()`, after the existing failure-sentinel + rollup `parts` logic and before the
`if (parts.length) { ...stdout.write... }`, add a recall digest and a detached reconcile:
```ts
    // Hybrid recall digest (cwd/recent-topic seeded). Tiered: pointers, not bodies.
    try {
      const seed = `${h.cwd || ""} recent work decisions gotchas`.trim();
      const hits = await hybridRecall(seed, 5);
      if (hits.length) {
        parts.push("SuperBrain memory — relevant past notes:\n" +
          hits.map((p) => `- [[${p.relPath.replace(/\.md$/, "")}]] — ${p.excerpt}`).join("\n"));
      }
    } catch { /* recall is best-effort */ }

    // Detached, recursion-guarded index reconcile so Obsidian/git drift self-heals
    // without blocking startup. Uses the same node-spawn pattern as the distiller.
    if (process.env.SUPERBRAIN_FAKE_DISTILLER !== "1") {
      try {
        const reconciler = fileURLToPath(new URL("./sb-reconcile.js", import.meta.url));
        spawn(process.execPath, [reconciler], {
          detached: true, stdio: "ignore",
          env: { ...process.env, SUPERBRAIN_CHILD: "1" }, cwd: vaultPath(),
        }).unref();
      } catch { /* non-fatal */ }
    }
```
Create the tiny detached reconcile entry `bin/sb-reconcile.ts`:
```ts
#!/usr/bin/env node
import { reconcile } from "../src/indexer.js";
import { writeFailure } from "../src/sentinel.js";
reconcile().catch((e: any) => writeFailure(`reconcile failed: ${e?.message || e}`)).finally(() => process.exit(0));
```
(`reconcile` import in sb-session-start.ts is only needed if you inline it instead of
spawning; the spawn approach above keeps SessionStart fast — keep the spawn approach and
you may drop the `reconcile` import from sb-session-start to avoid an unused import.
`main()` is already `async` in Phase 1, so `await hybridRecall` compiles.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sessionStartDigest.test.ts tests/sessionStart.test.ts tests/rollupConvergence.test.ts`
Expected: digest test 1 passed; **existing sessionStart + rollupConvergence still green**
(the digest is additive; fake-distiller path unchanged; reconcile skipped under fake env).

- [ ] **Step 5: Commit**

```bash
git add bin/sb-session-start.ts bin/sb-reconcile.ts tests/sessionStartDigest.test.ts
git commit -m "feat: SessionStart hybrid recall digest + detached index reconcile"
```

---

### Task 12: `hooks/hooks.json` — register sync recall hook; SessionStart → sync

**Files:**
- Modify: `hooks/hooks.json`
- Create: `tests/hooksConfig.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/hooksConfig.test.ts`:
```ts
import { it, expect } from "vitest";
import fs from "node:fs";

it("UserPromptSubmit has a sync sb-recall entry; SessionStart is synchronous", () => {
  const h = JSON.parse(fs.readFileSync("hooks/hooks.json", "utf8"));
  const ups = h.hooks.UserPromptSubmit.flatMap((g: any) => g.hooks);
  const recall = ups.find((x: any) => x.command.includes("sb-recall.js"));
  expect(recall).toBeTruthy();
  expect(recall.async).not.toBe(true);            // sync so additionalContext injects
  const observer = ups.find((x: any) => x.command.includes("sb-observe.js"));
  expect(observer.async).toBe(true);              // observer stays async
  const ss = h.hooks.SessionStart.flatMap((g: any) => g.hooks)
    .find((x: any) => x.command.includes("sb-session-start.js"));
  expect(ss.async).not.toBe(true);                // SessionStart now synchronous
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooksConfig.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modify `hooks/hooks.json`**

Add a second `UserPromptSubmit` group for the synchronous recall hook, and remove
`"async": true` from the `SessionStart` entry. The full file becomes:
```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "*", "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-observe.js\"", "async": true, "timeout": 10 } ] } ],
    "UserPromptSubmit": [
      { "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-observe.js\"", "async": true, "timeout": 10 } ] },
      { "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-recall.js\"", "timeout": 12 } ] } ],
    "Stop": [
      { "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-checkpoint.js\"", "async": true, "timeout": 15 } ] } ],
    "PreCompact": [
      { "matcher": "*", "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-checkpoint.js\"", "async": true, "timeout": 15 } ] } ],
    "SessionEnd": [
      { "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-checkpoint.js\"", "timeout": 20 } ] } ],
    "SessionStart": [
      { "matcher": "*", "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-session-start.js\"", "timeout": 20 } ] } ]
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooksConfig.test.ts`
Expected: PASS. Also: `node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8'));console.log('valid')"` → `valid`.

- [ ] **Step 5: Commit**

```bash
git add hooks/hooks.json tests/hooksConfig.test.ts
git commit -m "feat: register sync sb-recall UserPromptSubmit; make SessionStart synchronous"
```

---

### Task 13: `.mcp.json` + plugin manifest + `superbrain-recall` skill

**Files:**
- Create: `.mcp.json`, `skills/superbrain-recall/SKILL.md`
- Modify: `.claude-plugin/plugin.json`
- Create: `tests/phase2Manifest.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/phase2Manifest.test.ts`:
```ts
import { it, expect } from "vitest";
import fs from "node:fs";

it("plugin manifest registers the recall skill + mcp; .mcp.json is valid; skill name matches dir", () => {
  const p = JSON.parse(fs.readFileSync(".claude-plugin/plugin.json", "utf8"));
  expect(p.skills).toContain("./skills/superbrain-recall");
  expect(p.mcpServers || p.mcp).toBeTruthy();
  const m = JSON.parse(fs.readFileSync(".mcp.json", "utf8"));
  const srv = m.mcpServers.superbrain;
  expect(srv.command).toBe("node");
  expect(srv.args.join(" ")).toMatch(/sb-mcp\.js/);
  const skill = fs.readFileSync("skills/superbrain-recall/SKILL.md", "utf8");
  expect(skill).toMatch(/^name:\s*superbrain-recall/m);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/phase2Manifest.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create/modify the files**

`.mcp.json`:
```json
{
  "mcpServers": {
    "superbrain": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-mcp.js"]
    }
  }
}
```

`skills/superbrain-recall/SKILL.md`:
```markdown
---
name: superbrain-recall
description: Search the user's SuperBrain second-brain vault. Use whenever the user references past work, prior decisions, "how did we", "did we already", earlier sessions, a project's history, or anything that may already be recorded — before answering from scratch.
---

# SuperBrain Recall

When the user's question may already be answered by their accumulated notes, call the
`superbrain_search` MCP tool (server `superbrain`) with a focused `query` (and optional
`k`, default 8).

- Lead with what the vault says; cite every claim with the returned `[[wikilink]]`.
- If results are empty or irrelevant, say so plainly and answer normally — never
  fabricate a citation or invent a note.
- Prefer one well-formed query over many noisy ones.
```

Modify `.claude-plugin/plugin.json` — add the skill to `skills` and an `mcpServers`
pointer. Resulting file:
```json
{
  "name": "superbrain",
  "version": "0.2.0",
  "description": "Automatic Claude Code -> Obsidian second brain: zero-config session capture into a smart markdown vault.",
  "author": "Alex",
  "license": "MIT",
  "hooks": "./hooks/hooks.json",
  "skills": ["./skills/superbrain-distill", "./skills/superbrain-recall"],
  "mcpServers": "./.mcp.json"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/phase2Manifest.test.ts`
Expected: PASS. Also validate all three JSON files parse:
`node -e "['.mcp.json','.claude-plugin/plugin.json'].forEach(f=>JSON.parse(require('fs').readFileSync(f,'utf8')));console.log('ok')"` → `ok`.

- [ ] **Step 5: Commit**

```bash
git add .mcp.json skills/superbrain-recall/SKILL.md .claude-plugin/plugin.json tests/phase2Manifest.test.ts
git commit -m "feat: register superbrain-recall skill + MCP server; bump plugin to 0.2.0"
```

---

### Task 14: Build, full suite, real-path E2E, README, final commit

**Files:**
- Modify: `README.md`, `package.json` (version → 0.2.0)

- [ ] **Step 1: Typecheck + build + full suite**

Run:
```bash
cd /Users/alex/Projects/Vibe/SuperBrain
npm run typecheck && npm run build && npx vitest run
```
Expected: zero TS errors; `dist/` includes `dist/bin/sb-recall.js`, `dist/bin/sb-mcp.js`,
`dist/bin/sb-reconcile.js`, `dist/src/{chunker,embed,searchIndex,indexer,recall,mcpSearch}.js`;
ALL test files green (Phase 1 + Phase 2). If any pre-existing test regressed, STOP and
report BLOCKED (do not weaken tests).

- [ ] **Step 2: Real-path E2E (compiled, stub embed, no other fakes)**

Run:
```bash
cd /Users/alex/Projects/Vibe/SuperBrain
rm -rf /tmp/sbP2 /tmp/sbP2-vault /tmp/sbP2-bin && mkdir -p /tmp/sbP2-bin /tmp/sbP2/sessions
printf '#!/usr/bin/env bash\necho '\''[{"kind":"decision","title":"Phase2 hybrid recall","body":"sqlite-vec plus fts5 rrf","date":"2026-05-19","links":[]}]'\''\n' > /tmp/sbP2-bin/claude && chmod +x /tmp/sbP2-bin/claude
printf '%s\n' '{"type":"tool","tool":"Write","file":"a.ts","cwd":"/p","ts":"t"}' > /tmp/sbP2/sessions/S.ndjson
printf '1' > /tmp/sbP2/sessions/S.pending
echo '{"session_id":"S","hook_event_name":"Stop","cwd":"/p","transcript_path":"/dev/null"}' | PATH=/tmp/sbP2-bin:$PATH CLAUDE_PLUGIN_DATA=/tmp/sbP2 SUPERBRAIN_VAULT=/tmp/sbP2-vault SUPERBRAIN_EMBED_STUB=1 node dist/bin/sb-checkpoint.js
sleep 3
echo '{"session_id":"S2","hook_event_name":"UserPromptSubmit","cwd":"/p","prompt":"how did we do hybrid recall?"}' | CLAUDE_PLUGIN_DATA=/tmp/sbP2 SUPERBRAIN_EMBED_STUB=1 node dist/bin/sb-recall.js
```
Expected: the final command prints JSON containing `additionalContext` and the
`[[decisions/2026-05-19-phase2-hybrid-recall]]` pointer — proving capture → index →
per-turn recall works end to end on the real compiled path. If not, STOP and report
BLOCKED with `find /tmp/sbP2-vault -name '*.md'` and `ls /tmp/sbP2/index.db`.

- [ ] **Step 3: Bump version + update README**

In `package.json` set `"version": "0.2.0"`.

In `README.md`: move the Phase-2 bullets from "planned" to shipped and update the badge.
Replace the Features section's Phase blocks with:
```markdown
**Phase 1 — capture spine (shipped):** _(unchanged list)_

**Phase 2 — search & recall (shipped, v0.2.0):**

- ✅ Local hybrid search — FTS5 (BM25) + sqlite-vec, fused with Reciprocal Rank Fusion
- ✅ Tiered autonomous recall: BM25 pointers injected on **every prompt** (no model load, no daemon); full hybrid digest on session start
- ✅ `superbrain-recall` skill + stdio MCP server (`superbrain_search`) for model-invoked deep search
- ✅ Incremental index on write + self-healing reconcile on session start (Obsidian-edit / git-pull drift)
- ✅ All-local embeddings (MiniLM, fetched once & cached); automatic BM25 fallback — search is never hard-down

**Phase 2.1 — planned:** auto-generated Maps-of-Content (`maps/`) + Karpathy lint pass.
```
Change the status badge line from `phase%201-capture%20spine` to
`phase%202-search%20%26%20recall` and the tests badge to the new total
(run `npx vitest run` and read the "Tests N passed" count; use that N).

- [ ] **Step 4: Final commit**

```bash
git add README.md package.json
git commit -m "docs: README + version 0.2.0 for Phase 2 (search + autonomous recall)"
```

---

## Self-Review

**1. Spec coverage**

| Phase-2 spec section | Task(s) |
|---|---|
| §2.1 tiered recall (BM25 per-turn, hybrid on demand) | 5 (recall), 7 (sb-recall BM25), 11 (SessionStart hybrid), 9 (MCP hybrid) |
| §2.2 incremental-on-write + SessionStart reconcile | 10 (distiller indexNote), 11 (detached reconcile), 6 (reconcile) |
| §2.3 per-heading chunks | 2 (chunker) |
| §2.4 hooks use in-proc lib; MCP for skill | 7 (hook→recall lib), 8/9 (MCP), 13 (skill+.mcp.json) |
| §3 modules chunker/embed/searchIndex/indexer/recall | 2,3,4,6,5 |
| §4 sb-recall / sb-session-start / sb-distill / sb-mcp | 7,11,10,9 |
| §5 skill + manifests + hooks.json | 12,13 |
| §5/§11 P5 SessionStart async→sync (Phase-1 fix) | 11,12 |
| §7 error handling (index missing→[], embed fail→BM25, exit-0) | 5 (degrade), 7 (exit-0), 8 (no-throw), 4 (open creates schema) |
| §8 testing (unit/integration/idempotency/Phase-1 green) | every task; 6 idempotency; 10/11 assert Phase-1 green; 14 full suite |
| §9 native deps + caveat + fetch-once + BM25 fallback | 1 (spike+BLOCKED path), 3 (lazy+stub), 5 (degrade) |
| §10 P2.0 only (MOC deferred) | scope: no MOC task present (correctly P2.1) |

No gap. MOC/`maps/` intentionally absent (P2.1, per spec §10).

**2. Placeholder scan:** No TBD/TODO. The two prose "If … differs, adapt" notes (Task 9
SDK signature, Task 1 BLOCKED fallback) are explicit contingency instructions with a
defined contract + escalation path, not deferred work.

**3. Type consistency:** Verified across tasks — `chunkNote→Chunk{headingPath,anchor,text}`
(T2) consumed by indexer (T6) and searchIndex.upsertNote chunk arg (T4); `embed→Float32Array[]`
(T3) used by indexer (T6) + recall (T5); `openIndex():Index` with `upsertNote/deleteNote/
bm25/vectorKNN/getNoteMeta/allIndexedPaths/close` (T4) used by recall (T5), indexer (T6),
tests; `rrf(string[][],k)` (T4) used by recall (T5); `Hit{relPath,headingPath,anchor,text}`
(T4) → `Pointer{relPath,headingPath,anchor,excerpt}` (T5) used by sb-recall (T7),
mcpSearch (T8), SessionStart digest (T11); `handleSearch({query,k?})→{content:[{type,text}]}`
(T8) used by sb-mcp (T9); `indexNote(relPath)` (T6) used by distiller (T10); `reconcile()`
(T6) used by sb-reconcile (T11); `isChild()` (Phase-1) reused by sb-recall (T7). Signatures
match at every call site.
