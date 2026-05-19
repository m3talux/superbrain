# SuperBrain — Design Spec

- **Date:** 2026-05-19
- **Status:** Draft — red-teamed & revised; pending user review
- **Project location:** `/Users/alex/Projects/Vibe/SuperBrain`
- **Distribution:** public GitHub repo + Claude Code plugin marketplace

## 1. Problem

An automatic Claude Code → Obsidian "second brain" exists today as a custom local stack
(custom Stop-hook scribe + `mcpvault` + `obra/knowledge-graph` + `claude-mem`, writing to
`~/vault`, repo `m3talux/mybrain`). It has seven concrete gaps:

1. On multi-day sessions the scribe eventually stops writing.
2. It captures far less than what actually happens.
3. Linking is OK but there are no smart summaries / synthesis docs.
4. No daily / weekly / monthly rollups.
5. No consistent autonomous recall — the user must explicitly ask Claude to look things up.
6. Some vault sections never get filled.
7. No smart, scalable semantic search.

### Root causes (researched)

| Pain | Root cause | Source |
|---|---|---|
| 1 | One fragile per-turn headless call does observe **and** distill; silent death from auth race / rate-limit, not the block cap (see §12 D5). | CC hooks ref; red-team R1 |
| 2 | No continuous observation stream; a single conservative pass with no salience anchoring. | claude-mem hooks-architecture; red-team R3 |
| 3 | No synthesis/lint pass. | Karpathy LLM-Wiki; obsidian-second-brain `/obsidian-synthesize` |
| 4 | Nothing scheduled. | coleam00/claude-memory-compiler (daily compile) |
| 5 | Layer-4 recall hook still "pending" in the current setup. | `projects/mybrain-setup.md` |
| 6 | Schema too rigid; old scribe forbidden from creating `projects/`/`people/`; `capture/` never triaged. | `decisions/2026-05-03-vault-scribe-mcpvault.md` |
| 7 | `obra/knowledge-graph` read path never wired. | `projects/mybrain-setup.md` |

### Market gap (researched, ~23 projects surveyed)

The ecosystem bifurcates: **automatic-but-not-Obsidian** (claude-mem, mcp-memory-service)
vs **Obsidian-but-not-automatic** (basic-memory, claudesidian, obsidian-second-brain).
No mature project unifies: globally-installed CC plugin + automatic capture + plain
Obsidian vault + daily/weekly/monthly rollups + hybrid semantic search + autonomous
recall. SuperBrain targets that gap.

## 2. Goals / Non-goals

**Goals**
- Install once, user-scope, system-wide; zero per-project setup; no API key required;
  reuses the installer's existing Claude Code auth by default.
- Automatic capture that does not degrade on multi-day sessions.
- Plain Obsidian markdown vault (portable, no lock-in) with smart structure.
- Daily/weekly/monthly synthesis + autonomous recall + hybrid semantic search.
- Reproducible: losing the machine → reinstall plugin → state reinstated.

**Non-goals**
- Cloud sync of the vault (git remains the user's choice).
- Code-graph extraction (graphify-style) — out of scope for v1/v2.
- Mobile.

## 3. Architecture

One Claude Code **plugin** (`superbrain`), TypeScript/Node (CC already requires Node;
npx-distributable; enables Transformers.js + sqlite-vec for Phase 2). Distributed via a
public GitHub **marketplace repo**, installed at **user scope** → applies to every
project/session/machine with zero per-project setup. The install path must register
hooks + `.mcp.json` (not merely ship a library — claude-mem documents `npm i -g` as a
footgun that ships code without registering hooks).

Bundled:
- `hooks/hooks.json` — lifecycle hooks (capture; catch-up; Phase-2 recall)
- `bin/` — engine: observer, salience scorer, checkpoint distiller, router, vault writer,
  rollup CLI, catch-up runner
- `skills/superbrain-distill/SKILL.md` — used by the headless capture child
- `skills/superbrain-recall/SKILL.md` — Phase 2, trigger-rich description for autonomous deep recall
- `commands/` — `/sb-recap`, `/sb-search`, `/sb-gc` (manual escape hatches)
- `.mcp.json` — Phase-2 local hybrid-search server
- *(optional, power-user opt-in only)* launchd plist / cron template for same-day-while-idle rollups

Runtime state in `${CLAUDE_PLUGIN_DATA}` (survives plugin upgrades): per-session event
logs, distill cursors, salience markers, rollup `state.json` (source-hash → compiled),
distiller lockfile, failure sentinel, Phase-2 sqlite index. Vault path =
`SUPERBRAIN_VAULT`, default `~/vault` (adopts existing), else `~/Documents/SuperBrain`.

Replaces: custom `stop-scribe.sh`, `scribe` skill, `mcpvault`, `obra/knowledge-graph`,
`claude-mem` — folded into one self-contained plugin.

## 4. Capture pipeline (Phase 1 core)

Decouple **observation** (cheap, continuous, no LLM) from **distillation** (LLM, queued,
at checkpoints, idempotent).

**(a) Observer** — `PostToolUse` + `UserPromptSubmit` hooks, `async`, non-blocking
(<20 ms). Appends one compact JSONL line per event to
`${CLAUDE_PLUGIN_DATA}/sessions/<session_id>.ndjson`. No LLM → cannot rate-limit or stop.

**(b) Salience trigger + evidence pinning** — deterministic scorer inside the Observer
hook. On any cheap signal (N tool-writes since last note, git commit, file-churn
threshold, project/cwd switch, keyword-set delta) it (1) raises a `pending` marker, and
(2) **appends a structured `salient` marker record into the ndjson at that moment**
(`{type:"salient", reason, cwd, files, prompt_excerpt, ts}`). No LLM. This anchoring is
the primary fix for pain #2 — the checkpoint LLM later receives *pinned markers + full
delta*, so the single pass is anchored to the moments that mattered rather than
re-deriving them from noise. (Red-team R3: recovers most of claude-mem's per-observation
fidelity at zero extra LLM calls and no daemon.)

**(c) Checkpoint distiller** — fires at:
- `PreCompact` — **`async`, non-blocking**. Synchronously does only a fast (<100 ms)
  durable **copy** of the transcript segment + cursor, then exits 0; the detached
  distiller consumes the copy. Never blocks compaction (blocking PreCompact is a
  field-confirmed anti-pattern that can wedge a context-full session — MemPalace
  #941/#906; a nested `claude -p` can also exceed the hook timeout and be killed
  mid-write). The transcript file persists regardless, so no context is lost.
- `SessionEnd` — final flush (covers `/clear`, exit, logout; no pre-clear hook exists).
- `Stop` — **only if `pending`**, plus a safety cadence every K turns; async/detached.

It spawns **one detached** distiller process (default: `claude -p` running
`superbrain-distill`; see §8 for the engine + escape hatch) over the ndjson since the
last **cursor**, **serialized by a `flock` lockfile** so concurrent turns/sessions never
spawn overlapping children (this, not the block cap, is what kills the OAuth-refresh
race that actually breaks long-session scribers). Recursion-guarded by
`SUPERBRAIN_CHILD=1`. Advances the cursor on success; on failure writes a sentinel that
SessionStart surfaces to the user once (silent death is the real long-session failure
mode — never fail silently in a memory tool).

`Stop` is async/exit-0 and therefore never interacts with Claude Code's
8-consecutive-block Stop-hook auto-override at all (that cap only counts *blocking*
returns). Per-turn latency stays zero.

Data flow: `tool use → ndjson (+salient markers, always) → pending flag → checkpoint →
1 locked detached distill (pinned markers + delta) → router → vault write +
index.md/log.md → cursor advance | failure sentinel`.

## 5. Vault schema & smart routing

Folders kept: `projects/ people/ decisions/ daily/ capture/ code/`. Added smart layer:

- **`index.md`** — auto-maintained catalog, one summarized line per note, grouped. Primary
  navigation surface; injected compact at SessionStart (Phase 2). (Karpathy LLM-Wiki)
- **`log.md`** — append-only, grep-parseable `## [YYYY-MM-DD HH:MM] <op> | <title> | [[link]]`.
- **`maps/`** — auto-generated Maps-of-Content per active project/topic; regenerated on rollup.
- Generated files (`index.md`, `log.md`, `maps/*`, `summaries/*`) are namespaced/headed
  with a generated marker so the catch-up regenerator overwrites them without ever
  touching user-authored notes.
- **Router** — explicit rules → folder/filename/section/links. Decision →
  `decisions/YYYY-MM-DD-slug.md`; project fact → append `projects/<slug>.md` under right
  `##`; person → `people/<slug>.md`; gotcha → `## Gotchas`; uncategorized → `capture/`
  tagged for triage. **The router may create `projects/`/`people/` stubs** (the old
  scribe could not — root cause of pain 6).
- **AI-first note rules** (obsidian-second-brain): `## For future Claude` 2–3 sentence
  preamble; recency markers; verbatim source links; mandatory `[[wikilinks]]` + auto-stub;
  `confidence:` tag.
- **Vault writer** (replaces mcpvault, in-process): thin policy layer (extension/path
  allowlist, `.obsidian`/`.git`/`node_modules` exclusion, append-or-update never blind
  overwrite, soft-delete to `.trash/`) over **`gray-matter`** for frontmatter round-trip
  (the library `mcpvault` itself uses — we reuse it, not reimplement YAML) + **atomic
  write** (temp → fsync → rename) + a **checksum/mtime dirty-file guard** (basic-memory's
  `DirtyFileError` pattern) so a note the user edited in Obsidian since last read is
  never clobbered.

## 6. Time-based rollups (revised — no self-installed scheduler)

No launchd/cron is installed by default. Rollups run as an **idempotent catch-up** on
`SessionStart` (`async`, never blocks startup) and opportunistically on `SessionEnd`:

For each of {yesterday's daily, last completed week, last completed month}: if the
rollup file is missing **or** its source-log hash changed since last compile
(`state.json`, claude-memory-compiler's exact pattern), regenerate it via a detached
distiller run. Backfill is **capped** (e.g. last 7 daily / 2 weekly / 1 monthly) so a
long-idle machine doesn't melt on first session.

- **Daily**: read `log.md` + that day's `daily/` + `capture/`; write
  `daily/YYYY-MM-DD.md` synthesis; drain `capture/`; refresh `index.md`.
- **Weekly / Monthly**: roll up into `summaries/weekly|monthly/`; regenerate `maps/`;
  run the Karpathy **lint** pass (contradictions, stale claims, orphans, missing xrefs).

This is strictly more robust than cron/launchd (covers asleep, powered-off, Linux, and
"didn't open Claude for days") *and* less code/zero-install. An optional launchd plist is
provided for power users who want same-day rollups while the machine is idle — not the
default. All rollups idempotent and resumable from `log.md`.

## 7. Semantic search + autonomous recall (Phase 2)

**Search:** local hybrid — SQLite **FTS5 (BM25)** + **sqlite-vec** vector KNN fused via
**Reciprocal Rank Fusion**; embeddings from Transformers.js `all-MiniLM-L6-v2` (~22 MB
ONNX, CPU, zero cloud). Lighter than claude-mem's FTS5 + separate ChromaDB sidecar;
grounded in obra/knowledge-graph, proofgeist/obsidian-notes-rag, obsidian-brain (2026).

**Autonomous recall** (three reinforcing mechanisms, claude-mem pattern):
1. `SessionStart` (incl. `source: compact|clear`) injects a **tiered, lightweight**
   digest via `hookSpecificOutput.additionalContext` — excerpts + links + git summary,
   **not** full note bodies (obsidian-mind tiering, controls token cost). Anthropic
   "re-inject after compaction" recipe.
2. `UserPromptSubmit` runs the hybrid query on the prompt, injects top hits as
   `additionalContext` every turn (recall without being asked). 30 s hook budget → fast
   local index mandatory.
3. `superbrain-recall` skill with trigger-rich `description` (model-invoked deep search).

## 8. Distillation engine, distribution, install, migration

**Engine (default + escape hatch):** default is detached `claude -p` reusing the
installer's existing Claude Code auth — zero config, no API key (obsidian-second-brain
precedent). If `ANTHROPIC_API_KEY` (or `SUPERBRAIN_API_KEY`) is present, the distiller
**prefers it** (Agent SDK / API path) — sidesteps the OAuth-refresh race and the dated
constraint below for power users. Single fresh process per checkpoint (no persistent
daemon — validated as the correct fit for a checkpoint-frequency, zero-config plugin;
claude-mem needs a daemon only because it distills per-tool-call, which we deliberately
do not).

> **Dated constraint (must document in README):** from **2026-06-15**, Agent-SDK /
> `claude -p` usage on subscription plans draws from a separate capped monthly credit
> ($20 Pro / $100–200 Max) rather than interactive limits; on exhaustion, background
> distillation can silently throttle. Mitigations shipped: the API-key escape hatch +
> the SessionStart failure sentinel make this visible and survivable.

**Distribution:** one plugin on a GitHub marketplace;
`/plugin marketplace add <user>/superbrain` → `/plugin install superbrain` at **user
scope** → hooks + `.mcp.json` auto-register for every project (official CC plugin docs;
claude-mem proves the model). Optional `~/.claude/settings.json`
`extraKnownMarketplaces` + `enabledPlugins` snippet for scripted machine bootstrap.

**Migration (existing user):** adopt `~/vault`, backfill `index.md`/`log.md` from
current notes, remove old `stop-scribe.sh` + `scribe` skill + `mcpvault`/`obra-kg` MCP
registrations, preserve launchd git auto-sync. Old config archived not deleted.

## 9. Safety / idempotency / error handling

- "Scribe stops" → async/detached + `flock` serialization + failure sentinel (root cause
  is the OAuth-refresh race / silent death, not the block cap).
- Frontmatter clobber / confabulated pages → vault writer policy + `gray-matter` + atomic
  write; dirty-file checksum guard protects user's own Obsidian edits.
- Self-rewriting data loss → append-or-update only; soft-delete to `.trash/`
  (obsidian-second-brain adopted exactly this after hitting the failure).
- Recursion → `SUPERBRAIN_CHILD=1` guard.
- PreCompact never blocks compaction (anti-pattern avoided); transcript copied fast,
  distilled async.
- Security → headless child scoped, **not** `--dangerously-skip-permissions`; writes
  confined to vault path.
- Idempotency → per-session cursor + grep-parseable `log.md` + rollup `state.json` hash;
  every job resumable, missed runs self-heal next session.

## 10. Testing

- Unit: router rules, salience scorer + marker pinning, frontmatter/atomic writer,
  dirty-file guard, RRF fusion (pure).
- Fixture/golden: recorded `.ndjson` (incl. salient markers) → assert exact vault tree +
  frontmatter + links.
- Integration: real headless `claude -p` over a fixture → assert notes + index/log deltas;
  lockfile serialization under concurrent invocation.
- Idempotency: run any stage twice → zero diff; catch-up with stale vs fresh hash.
- CI on the marketplace repo.

## 11. Phasing

- **Phase 1 (first implementation plan):** plugin skeleton + marketplace + install/
  migration, observer + salience/marker pinning, checkpoint distiller (lockfile +
  sentinel + escape hatch), router, vault writer, SessionStart/SessionEnd rollup
  catch-up. Fixes pains 1, 2, 3, 4, 6. Independently shippable.
- **Phase 2:** sqlite-vec + FTS5 search MCP + autonomous recall hooks (tiered injection)
  + `superbrain-recall` skill. Fixes 5, 7.

## 12. Decisions & grounding (post red-team)

| # | Decision | Red-team verdict | Final |
|---|---|---|---|
| D1 | Single user-scope plugin (hooks+skills+mcp+commands), install registers hooks/MCP | KEEP | ✅ High |
| D2/D12 | No-LLM observer + deterministic salience **+ ndjson `salient` marker pinning** + single judge per checkpoint | ADJUST → add marker pinning | ✅ High |
| D3 | `claude -p` default, **+ optional API-key escape hatch + flock + failure sentinel**; document 2026-06-15 credit cap | ADJUST | ✅ High |
| D4 | `PreCompact` **async**, fast transcript copy then distill (no blocking) | RETHINK → no-block | ✅ High |
| D5 | Async `Stop` gated on `pending`; rationale = avoids blocking semantics + zero latency (NOT the 8-block cap) | ADJUST rationale | ✅ High |
| D6 | **SessionStart/SessionEnd idempotent hash-checked catch-up** (no installed scheduler; launchd optional opt-in) | RETHINK → catch-up | ✅ High |
| D7 | Node/TS engine | KEEP | ✅ High |
| D8 | Hybrid FTS5 + sqlite-vec + RRF, Transformers.js MiniLM, local | KEEP (lighter than claude-mem) | ✅ High |
| D9 | Recall via SessionStart (**tiered excerpts+links**) + UserPromptSubmit + skill | KEEP + tiering | ✅ High |
| D10 | Keep folders + `index.md`/`log.md`/`maps/` smart layer (generated files namespaced) | KEEP | ✅ High |
| D11 | In-process vault writer = policy over **`gray-matter`** + atomic write + **dirty-file guard** | KEEP + adjust | ✅ High |

## References

- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code hooks guide: https://code.claude.com/docs/en/hooks-guide
- Claude Code plugins: https://code.claude.com/docs/en/plugins
- Plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces
- Claude Code skills: https://code.claude.com/docs/en/skills
- Claude Code scheduled tasks: https://code.claude.com/docs/en/scheduled-tasks
- Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Subscription/SDK credit change: https://support.claude.com/en/articles/15036540
- claude-mem: https://github.com/thedotmack/claude-mem · https://docs.claude-mem.ai/hooks-architecture · https://docs.claude-mem.ai/architecture/overview
- basic-memory: https://github.com/basicmachines-co/basic-memory (markdown_processor.py — atomic write + DirtyFileError)
- obsidian-second-brain: https://github.com/eugeniughelbur/obsidian-second-brain
- claude-memory-compiler: https://github.com/coleam00/claude-memory-compiler (SessionEnd time-check compile)
- obsidian-mind: https://github.com/breferrari/obsidian-mind (tiered SessionStart injection)
- graphify: https://github.com/safishamsi/graphify
- obra/knowledge-graph: https://github.com/obra/knowledge-graph
- obsidian-notes-rag: https://github.com/proofgeist/obsidian-notes-rag
- mcpvault: https://github.com/bitbonsai/mcpvault
- MemPalace blocking-PreCompact bugs: https://github.com/MemPalace/mempalace/issues/941 · /906
- Karpathy LLM-Wiki gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
