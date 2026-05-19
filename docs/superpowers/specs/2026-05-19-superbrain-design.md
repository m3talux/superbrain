# SuperBrain — Design Spec

- **Date:** 2026-05-19
- **Status:** Draft (pending post-write red-team research + user review)
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
| 1 | One fragile per-turn headless call does observe **and** distill; `Stop` hook auto-overrides after 8 consecutive blocks (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`). | CC hooks reference (code.claude.com/docs/en/hooks) |
| 2 | No continuous observation stream; a single conservative Stop prompt. | claude-mem hooks-architecture (continuous `PostToolUse` capture) |
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
- Install once, user-scope, system-wide; zero per-project setup; no API key; reuses
  the installer's existing Claude Code auth.
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
project/session/machine with zero per-project setup.

Bundled:
- `hooks/hooks.json` — lifecycle hooks (capture; Phase-2 recall)
- `bin/` — engine: observer, salience scorer, checkpoint distiller, router, vault writer, rollup CLI
- `skills/superbrain-distill/SKILL.md` — used by the headless capture child
- `skills/superbrain-recall/SKILL.md` — Phase 2, trigger-rich description for autonomous deep recall
- `commands/` — `/sb-recap`, `/sb-search`, `/sb-gc` (manual escape hatches)
- `.mcp.json` — Phase-2 local hybrid-search server
- launchd plist / cron templates (auto-installed first run)

Runtime state in `${CLAUDE_PLUGIN_DATA}` (survives plugin upgrades): per-session event
logs, distill cursors, salience markers, Phase-2 sqlite index. Vault path =
`SUPERBRAIN_VAULT`, default `~/vault` (adopts existing), else `~/Documents/SuperBrain`.

Replaces: custom `stop-scribe.sh`, `scribe` skill, `mcpvault`, `obra/knowledge-graph`,
`claude-mem` — folded into one self-contained plugin.

## 4. Capture pipeline (Phase 1 core)

Decouple **observation** (cheap, continuous, no LLM) from **distillation** (LLM, queued,
at checkpoints, idempotent).

**(a) Observer** — `PostToolUse` + `UserPromptSubmit` hooks, `async`, non-blocking
(<20 ms). Appends one compact JSONL line per event to
`${CLAUDE_PLUGIN_DATA}/sessions/<session_id>.ndjson`. No LLM → cannot rate-limit or stop.

**(b) Salience trigger** — deterministic scorer inside the Observer hook. Raises a
`pending` marker when any cheap signal trips: N tool-writes since last note, git commit,
file-churn threshold, project/cwd switch, or cheap keyword-set delta. No LLM.

**(c) Checkpoint distiller** — fires at:
- `PreCompact` — synchronous, the critical pre-context-loss point;
- `SessionEnd` — final flush (covers `/clear`, exit, logout; no pre-clear hook exists);
- `Stop` — **only if `pending`**, plus a safety cadence every K turns.

Spawns **one detached** `claude -p` running `superbrain-distill` over the ndjson since
the last **cursor**, recursion-guarded by `SUPERBRAIN_CHILD=1`, then advances the cursor.
The LLM "is this worth a note / which folder / which links" judge runs **here, once per
checkpoint** (chosen layered model: cheap deterministic signals + one LLM judge at
checkpoints).

**Long-session fix:** `Stop` almost always no-ops; heavy work is detached/async, so the
turn never blocks → the 8-consecutive-block auto-override never triggers. ndjson + cursor
make a skipped/killed distill lossless — next checkpoint covers everything since cursor.

Data flow: `tool use → ndjson (always) → salience flag → checkpoint → 1 headless distill
→ router → vault write + index.md/log.md → cursor advance`.

## 5. Vault schema & smart routing

Folders kept: `projects/ people/ decisions/ daily/ capture/ code/`. Added smart layer:

- **`index.md`** — auto-maintained catalog, one summarized line per note, grouped. Primary
  navigation surface; injected compact at SessionStart (Phase 2). (Karpathy LLM-Wiki)
- **`log.md`** — append-only, grep-parseable `## [YYYY-MM-DD HH:MM] <op> | <title> | [[link]]`.
- **`maps/`** — auto-generated Maps-of-Content per active project/topic; regenerated on rollup.
- **Router** — explicit rules → folder/filename/section/links. Decision →
  `decisions/YYYY-MM-DD-slug.md`; project fact → append `projects/<slug>.md` under right
  `##`; person → `people/<slug>.md`; gotcha → `## Gotchas`; uncategorized → `capture/`
  tagged for triage. **The router may create `projects/`/`people/` stubs** (the old
  scribe could not — root cause of pain 6).
- **AI-first note rules** (obsidian-second-brain): `## For future Claude` 2–3 sentence
  preamble; recency markers; verbatim source links; mandatory `[[wikilinks]]` + auto-stub;
  `confidence:` tag.
- **Vault writer** (replaces mcpvault): frontmatter validation, extension + path
  allowlist, soft-delete to `.trash/`, append-or-update (never blind overwrite).

## 6. Time-based rollups

launchd (macOS) / cron (Linux), auto-installed via an idempotent marker-block installer
(graphify `hooks.py` pattern: delimited, re-runnable, rebase-safe).

- **Daily** (quiet hour): headless `claude -p` reads `log.md` + that day's `daily/` +
  `capture/`, writes `daily/YYYY-MM-DD.md` synthesis, drains `capture/`, refreshes `index.md`.
- **Weekly / Monthly**: roll up into `summaries/weekly|monthly/`, regenerate `maps/`,
  run the Karpathy **lint** pass (contradictions, stale claims, orphans, missing xrefs).

All idempotent and resumable from `log.md`; missed runs self-heal next cycle.

## 7. Semantic search + autonomous recall (Phase 2)

**Search:** local hybrid — SQLite **FTS5 (BM25)** + **sqlite-vec** vector KNN fused via
**Reciprocal Rank Fusion**; embeddings from Transformers.js `all-MiniLM-L6-v2` (~22 MB
ONNX, CPU, zero cloud). Grounded in obra/knowledge-graph, proofgeist/obsidian-notes-rag,
obsidian-brain (all on sqlite-vec + RRF in 2026).

**Autonomous recall** (three reinforcing mechanisms, claude-mem pattern):
1. `SessionStart` (incl. `source: compact|clear`) injects a compact index/pointer digest
   via `hookSpecificOutput.additionalContext` (Anthropic "re-inject after compaction" recipe).
2. `UserPromptSubmit` runs the hybrid query on the prompt, injects top hits as
   `additionalContext` every turn (recall without being asked). 30 s hook budget → fast
   local index mandatory.
3. `superbrain-recall` skill with trigger-rich `description` (model-invoked deep search).

## 8. Distribution, install, migration

- One plugin on a GitHub marketplace; `/plugin marketplace add <user>/superbrain` →
  `/plugin install superbrain` at **user scope** → hooks + `.mcp.json` auto-register for
  every project (official CC plugin docs; claude-mem proves the model at scale).
- Zero-config defaults; `${CLAUDE_PLUGIN_DATA}` state; vault auto-detected/created.
  Optional `~/.claude/settings.json` `extraKnownMarketplaces` + `enabledPlugins` snippet
  for scripted machine bootstrap.
- **Migration (existing user):** adopt `~/vault`, backfill `index.md`/`log.md` from
  current notes, remove old `stop-scribe.sh` + `scribe` skill + `mcpvault`/`obra-kg` MCP
  registrations, preserve launchd git auto-sync. Old config archived not deleted.

## 9. Safety / idempotency / error handling

- "Scribe stops" → async/detached + Stop-only-on-pending avoids the 8-block cap.
- Frontmatter clobber / confabulated pages → vault writer validation + path allowlist.
- Self-rewriting data loss → append-or-update only; soft-delete to `.trash/`
  (obsidian-second-brain adopted exactly this constraint after hitting the failure).
- Recursion → `SUPERBRAIN_CHILD=1` guard.
- Security → headless child scoped, **not** `--dangerously-skip-permissions`; writes
  confined to vault path.
- Idempotency → per-session cursor + grep-parseable `log.md`; every job resumable.

## 10. Testing

- Unit: router rules, salience scorer, frontmatter validator, RRF fusion (pure).
- Fixture/golden: recorded `.ndjson` → assert exact vault tree + frontmatter + links.
- Integration: real headless `claude -p` over a fixture → assert notes + index/log deltas.
- Idempotency: run any stage twice → zero diff. CI on the marketplace repo.

## 11. Phasing

- **Phase 1 (first implementation plan):** plugin skeleton + marketplace, observer,
  salience, checkpoint distiller, router, vault writer, rollups, migration. Fixes pains
  1, 2, 3, 4, 6. Independently shippable.
- **Phase 2:** sqlite-vec + FTS5 search MCP + autonomous recall hooks +
  `superbrain-recall` skill. Fixes 5, 7.

## 12. Decisions & grounding (red-team targets)

Confidence reflects pre-research conviction; the post-write red-team pass challenges each.

| # | Decision | Grounded in | Confidence |
|---|---|---|---|
| D1 | Single user-scope CC **plugin** bundling hooks+skills+MCP+commands | Official CC plugin/marketplace docs; claude-mem distribution | High |
| D2 | **Decouple** continuous observer (no LLM) from checkpoint distiller (LLM) | claude-mem hooks-architecture | High |
| D3 | Distill via **headless `claude -p`** reusing CC auth (no API key) | obsidian-second-brain bg-agent; user constraint | Medium |
| D4 | `PreCompact` **synchronous** distill to prevent context loss | CC hooks ref (PreCompact blockable, pre-loss) | Medium |
| D5 | `Stop` acts **only on `pending`** + async → avoids 8-block cap | CC hooks ref (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`) | Medium |
| D6 | Rollups via **launchd/cron** | coleam00/claude-memory-compiler | Medium |
| D7 | **Node/TS** engine | CC plugin norms; Transformers.js/sqlite-vec | High |
| D8 | Hybrid **FTS5 + sqlite-vec + RRF**, Transformers.js MiniLM, local | obra/kg, obsidian-notes-rag, obsidian-brain (2026) | High |
| D9 | Autonomous recall via SessionStart + UserPromptSubmit `additionalContext` + skill | claude-mem; Anthropic compaction recipe | High |
| D10 | Keep folders + add `index.md`/`log.md`/`maps/` smart layer | Karpathy LLM-Wiki; obsidian-second-brain | High |
| D11 | In-process **vault writer** replacing mcpvault | continuity of 2026-05-03 decision | Medium |
| D12 | Layered salience: cheap signals + one LLM judge at checkpoint | user choice; balances cost vs fidelity | Medium |

## References

- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code hooks guide: https://code.claude.com/docs/en/hooks-guide
- Claude Code plugins: https://code.claude.com/docs/en/plugins
- Plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces
- Claude Code skills: https://code.claude.com/docs/en/skills
- claude-mem: https://github.com/thedotmack/claude-mem · https://docs.claude-mem.ai/hooks-architecture
- basic-memory: https://github.com/basicmachines-co/basic-memory
- obsidian-second-brain: https://github.com/eugeniughelbur/obsidian-second-brain
- claude-memory-compiler: https://github.com/coleam00/claude-memory-compiler
- graphify: https://github.com/safishamsi/graphify
- obra/knowledge-graph: https://github.com/obra/knowledge-graph
- obsidian-notes-rag: https://github.com/proofgeist/obsidian-notes-rag
- Karpathy LLM-Wiki gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
