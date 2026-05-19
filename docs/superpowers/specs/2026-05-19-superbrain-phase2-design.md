# SuperBrain Phase 2 — Design Spec (search + autonomous recall)

- **Date:** 2026-05-19
- **Status:** Draft — pending user review
- **Branch:** `phase-2-search-recall`
- **Builds on:** `2026-05-19-superbrain-design.md` §7 (Phase-2 architecture, already red-teamed: D8 hybrid FTS5+sqlite-vec+RRF/MiniLM KEPT, D9 recall-injection pattern KEPT)

## 1. Scope

**P2.0 (this spec):** local hybrid search index + tiered autonomous recall + MCP server
+ `superbrain-recall` skill.

**Deferred → P2.1 (separate spec→plan→review cycle):** auto-MOC / `maps/` generation
(synthesis, closer to rollups than retrieval).

## 2. Resolved implementation forks (this is what §7 left open)

1. **Recall tiering:** every-turn `UserPromptSubmit` recall is **BM25/FTS5-only** (no
   embedding-model load, ms-fast, no daemon). Full vector+FTS5+RRF **hybrid** runs only
   where latency is acceptable: the once-per-session `SessionStart` digest and the
   model-invoked `superbrain-recall` skill (MCP). Preserves Phase-1's validated
   no-daemon principle while still giving recall on every prompt.
2. **Index freshness:** incremental upsert on the distiller write path + an idempotent
   `reconcile` on `SessionStart` (mtime/hash drift from Obsidian edits / `git pull`).
   Same self-healing pattern as rollups.
3. **Chunk granularity:** per-heading section (`##`/`###`), matching the vault's
   dated-section / `## Gotchas` structure (obsidian-brain precedent).
4. **Search surface split:** hooks call the in-process recall lib directly (hooks cannot
   be MCP clients); the MCP server exposes hybrid search for the model-invoked skill.

## 3. New `src/` modules (single responsibility, unit-tested)

| Module | Responsibility | Depends on |
|---|---|---|
| `chunker.ts` | Pure: `parseNote` → `{headingPath, text, anchor}[]` split at `##`/`###` | `frontmatter.ts` |
| `embed.ts` | Lazy Transformers.js `all-MiniLM-L6-v2`; model cached at `${CLAUDE_PLUGIN_DATA}/models`; `embed(texts)→Float32Array[]` | `@huggingface/transformers`, `paths.ts` |
| `searchIndex.ts` | `better-sqlite3`+`sqlite-vec` at `${CLAUDE_PLUGIN_DATA}/index.db`: schema (`chunks` + FTS5 + `vec0`), `upsertNote`, `deleteNote`, `bm25(q,k)`, `vectorKNN(v,k)`, `rrf(lists,k)` | `better-sqlite3`, `sqlite-vec`, `paths.ts` |
| `indexer.ts` | `reconcile(vault)` (walk md, mtime/hash diff, re-chunk/embed/upsert/delete); `indexNote(relPath)` incremental | `chunker`, `embed`, `searchIndex`, `paths` |
| `recall.ts` | `bm25Recall(q,k)` (no embed); `hybridRecall(q,k)` (embed→vec+fts→RRF) | `searchIndex`, `embed` |

`embed.ts` is isolated so the per-turn path (`recall.bm25Recall` → `searchIndex.bm25`)
never transitively imports the embedding model.

## 4. Hook / entrypoint changes

- **NEW `bin/sb-recall.ts`** — **synchronous** `UserPromptSubmit` hook, registered as a
  second `UserPromptSubmit` entry alongside the existing async observer. stdin prompt →
  `bm25Recall` → `{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext}}`
  with tiered **pointers** (title · path · 1-line excerpt — not bodies). Recursion-guarded;
  whole body try/catch → exit 0 always; hard result cap; no embed import.
- **EXTEND `bin/sb-session-start.ts`** —
  (a) **change its hook registration from `async:true` to synchronous** so its
  `additionalContext` actually reaches the model. *This also fixes a latent Phase-1
  defect:* the sentinel/rollup notices on an async SessionStart hook were never injected.
  (b) add a `hybridRecall` digest (cwd/recent-topic seeded, tiered: excerpts+links) to
  `additionalContext`.
  (c) kick a **detached** `indexer.reconcile` so drift self-heals without blocking
  startup (digest uses the index as-is; eventually consistent — acceptable).
  Recursion guard, exit-0 discipline, and the existing sentinel/rollup behavior are
  preserved.
- **EXTEND `bin/sb-distill.ts`** — after each successful `writeNote`, call
  `indexer.indexNote(relPath)` (chunk→embed→upsert) in the detached child where latency
  is fine. Failure to index is non-fatal (sentinel-logged; reconcile heals later).
- **NEW `bin/sb-mcp.ts`** — stdio MCP server. Tool `superbrain_search(query, k)` →
  `hybridRecall`. Registered via new **`.mcp.json`** (`${CLAUDE_PLUGIN_ROOT}` path).

## 5. Skill + manifests

- **NEW `skills/superbrain-recall/SKILL.md`** — trigger-rich `description` ("use when the
  user references past work, prior decisions, 'how did we…', project history, an earlier
  session"). Body: call `superbrain_search`, cite results by `[[wikilink]]`, never
  fabricate.
- **`.claude-plugin/plugin.json`** — add `skills: [..., "./skills/superbrain-recall"]`
  and `mcpServers`/`.mcp.json` reference.
- **`hooks/hooks.json`** — add the synchronous `sb-recall` `UserPromptSubmit` entry;
  flip the `SessionStart` entry to synchronous (drop `async:true`).

## 6. Data flow

```
write    : distiller → indexNote (chunk → embed new → FTS5 + vec upsert)
heal     : SessionStart → detached reconcile (mtime/hash drift: Obsidian edits, git pull)
per-turn : UserPromptSubmit → sb-recall → bm25Recall → inject pointers   (no model load)
session  : SessionStart → hybridRecall digest → inject (sync, ~once/session)
deep     : superbrain-recall skill → MCP superbrain_search → hybridRecall
```

## 7. Error handling (Phase-1 discipline preserved)

- Missing/corrupt `index.db` → recall returns `[]`; hook still exits 0 (never disrupts
  the turn). A corrupt db is rebuilt by the next reconcile.
- Embedding model absent / fetch fails → `hybridRecall` **degrades to BM25**; logged to
  the failure sentinel (surfaced once on next SessionStart).
- MCP server error → skill degrades to "no results found," never fabricates.
- `reconcile` idempotent (run-twice = zero delta) and resumable.

## 8. Testing

- **Unit:** `chunker` (pure, golden fixtures incl. no-heading + nested headings); `rrf`
  fusion; `searchIndex` over a fixture db (bm25 + vectorKNN); `indexer.reconcile`
  add/modify/delete/no-op; `recall` tiering (bm25 path must not load embed).
- **Integration:** `sb-recall` emits real `additionalContext` over a built index;
  distiller `indexNote` on write; `sb-mcp` answers a `superbrain_search` call;
  SessionStart digest injection (synchronous) end-to-end with a **stub embed** seam
  (`SUPERBRAIN_EMBED_STUB`) mirroring Phase-1's distiller-stub pattern.
- **Idempotency:** `reconcile` twice → zero delta; re-index unchanged note → no rows
  churned.
- All Phase-1 tests must remain green (esp. the SessionStart async→sync change must not
  regress `tests/sessionStart.test.ts` / `tests/rollupConvergence.test.ts`).

## 9. New dependencies (all local, zero cloud at query time)

- `better-sqlite3` — synchronous SQLite with bundled FTS5. **Native module:** ships
  prebuilt binaries for common platforms, but the plan must verify resolution under a
  marketplace-installed plugin (`${CLAUDE_PLUGIN_ROOT}` cache dir) and define the
  fallback if no prebuilt matches the host (graceful: index disabled, recall returns
  `[]`, BM25/hybrid both no-op rather than crash a hook — never hard-down). If native
  resolution proves fragile, the plan's first task evaluates a pure-JS/WASM SQLite
  (e.g. `node:sqlite` on Node ≥22, or a WASM build) before committing the schema layer.
- `sqlite-vec` — prebuilt loadable vector extension (same native-resolution caveat;
  vector tier degrades to BM25-only if the extension can't load).
- `@huggingface/transformers` — Transformers.js v3; `all-MiniLM-L6-v2` (~22 MB ONNX)
  fetched **once** on first index, cached in `${CLAUDE_PLUGIN_DATA}/models`. Bundling the
  model in-repo is rejected (repo bloat); the resilience story is cache-on-first-use +
  automatic BM25 fallback if the model is unavailable, so search is never hard-down.

## 10. Phasing

- **P2.0 (this spec):** modules §3, entrypoints §4, skill/manifests §5, tests §8.
  Independently shippable; delivers autonomous recall + searchable memory.
- **P2.1 (next cycle):** auto-MOC / `maps/` generation + Karpathy lint pass; calibrated vector-distance threshold in vectorKNN/hybridRecall (relax/remove the BM25 precision-gate so semantic-only recall returns while garbage still yields []).

### Known limitation (P2.0) — semantic-only recall deferred

`hybridRecall` hard-gates on BM25 having ≥1 lexical hit (`src/recall.ts`). Rationale:
`searchIndex.vectorKNN` has no distance/similarity threshold (always returns k nearest),
so an ungated hybrid path would inject k irrelevant pointers into every auto-injected
per-turn prompt — constant, actively harmful noise where the false-positive cost is paid
every turn. The gate makes irrelevant queries correctly return nothing. **Tradeoff:**
pure-semantic-only matches (zero lexical overlap + high embedding similarity — D8's
headline value) are structurally disabled in P2.0. A correctly *calibrated* vector
threshold must be tuned against the real `all-MiniLM-L6-v2` model (not the test stub),
so it is deferred to P2.1 rather than shipped untuned (an untuned cutoff is a worse,
silent regression than a transparent precision gate).

## 11. Decisions & grounding

| # | Decision | Grounding | Confidence |
|---|---|---|---|
| P1 | Tiered recall: BM25 per-turn, hybrid on demand | resolves §7 30s-budget vs no-daemon tension | High |
| P2 | Incremental-on-write + SessionStart reconcile | mirrors Phase-1 rollup self-heal; handles Obsidian/git drift | High |
| P3 | Per-heading-section chunks | obsidian-brain; matches vault structure | High |
| P4 | Hooks use in-process lib; MCP only for skill | hooks can't be MCP clients (CC docs) | High |
| P5 | SessionStart → synchronous | async hooks' additionalContext is not injected (CC docs); also fixes latent Phase-1 gap | High |
| P6 | better-sqlite3 + sqlite-vec + Transformers.js v3 | spec §7 D8 (KEPT in red-team); 2026 local-first consensus | High |
| P7 | MiniLM fetch-once-cache + BM25 fallback | avoids repo bloat; search never hard-down | Medium |

## References

- Builds on `docs/superpowers/specs/2026-05-19-superbrain-design.md` §7, §12 (D8, D9)
- Claude Code hooks (async vs sync `additionalContext`): https://code.claude.com/docs/en/hooks
- sqlite-vec: https://github.com/asg017/sqlite-vec
- Transformers.js: https://github.com/huggingface/transformers.js
- obsidian-brain (heading-granularity hybrid RRF): https://mcpservers.org/servers/sweir1/obsidian-brain
- proofgeist/obsidian-notes-rag (sqlite-vec migration): https://github.com/proofgeist/obsidian-notes-rag
