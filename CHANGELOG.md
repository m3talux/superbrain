# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it
reaches a tagged release. The project is pre-1.0 and in active development;
behavior may change without notice.

## [Unreleased]

## 0.8.0: semantic recall returns, a ~400MB lighter install, and always-on working memory

**Semantic recall is back, on every path.** The 0.7.x hooks had fallen back to keyword-only (BM25) recall to dodge a native crash in the embedding library. That stack is gone: the ~428MB onnxruntime/transformers dependency is replaced by a vendored pure-JavaScript static embedding (a Model2Vec "potion" model), so the install is roughly 400MB smaller, has no native build step, and starts faster. Keyword and meaning-based recall are fused again everywhere, including the short-lived session-start and per-prompt hooks. The vector index moves to a compact int8 form and re-embeds itself once on upgrade.

**Recall behaves more like a brain: focus without isolation.** Recall is dominated by the project you are in, but a reserved background slice guarantees cross-cutting, global, and recent context is always present too, rather than hard-isolating each project. Projects are now keyed by git root (fixing slug collisions between same-named directories), and the cross-project filter fails closed with a one-time backfill so untagged notes cannot leak.

**No more silently dropped notes.** A distiller crash that could zero out a whole session is fixed, and each item is isolated so one bad item cannot drop the rest. The project-note writer gets a real byte ceiling with archive-on-overflow; the previous cap never actually fired, so once a project note grew past a threshold its new facts were silently discarded. Startup index drift is also corrected.

**Always-on working memory.** A richer, weighted session-start brief; per-turn injection that now rides the fused (semantic) recall with your hard preferences pinned on every turn; a periodic mini-brief; and a re-fire of the brief after context compaction.

**Cleaner preferences.** Project-specific rules no longer leak into your universal preferences on every reconcile; a lean `preferences-core.md` of universal hard-rules is emitted for downstream use.

**Housekeeping.** Confirmed dead code removed, append logs bounded, and old session files garbage-collected.

**Upgrading:** on the first run after updating, the plugin downloads a ~30MB model once and re-embeds your vault into the new index. This is automatic and self-healing; expect a slightly longer first session.

## 0.7.1: session brief reliability (Node-version-independent hooks)

The session-start brief and per-prompt recall hooks no longer load the embedding model. On some Node runtimes (observed on Node 25.x) the native embedding library aborted the process on exit, so the SessionStart hook crashed and Claude Code dropped its injected context, and the brief never appeared. The short-lived hooks now use lexical (BM25) recall only and always exit cleanly; embedding-based search keeps running in the long-lived MCP server and the background distiller. Session start is also faster (no model load), and project scoping is unchanged.

## 0.7.0: cross-project isolation, lossless capture, and the session brief

**Cross-project isolation.** Recall is now scoped to the project you are working in. The session-start brief, the per-prompt BM25 pointers, and inject-time recall all filter to the current repo, so one project's notes never surface in another. This closes the cross-project contamination reported in #42.

**Lossless capture.** The distiller no longer silently discards lessons or captures. An item the classifier cannot place is coerced to the closest valid kind (a lesson, or otherwise a triaged `capture`) with the matching frontmatter type, and logged to `meta/distill-rejects.md`, rather than dropped or written malformed into a structured folder. A project-required item with no resolvable project lands in an explicit `unknown` bucket instead of vanishing.

**User-visible session brief.** Session start now surfaces a short, project-scoped recap of recent activity (recent notes and open threads) for the repo you just opened, so SuperBrain's state is visible rather than silent. It is budget-capped and degrades to nothing when there is no history.

**Working-directory project attribution.** Project is derived authoritatively from the working directory. In a session that spans multiple repos, an item with no explicit project is no longer mis-tagged to the session's dominant project. Daily state is tracked per project.

**Frontmatter hardening.** A non-scalar `project` value (a YAML list, or a wikilink object) is coerced to a plain string at both parse and index time, and the serializer no longer throws on an unexpected shape. The search index is force-rebuilt once after upgrade so it reflects the corrected frontmatter.

**Self-healing upgrade and recovery tools.** On the first session after upgrading, SuperBrain runs the cheap, non-LLM repair steps automatically: it re-derives the project for mis-attributed notes from recorded session history, and removes duplicated daily mirrors. `sb-doctor migrate-all` now orchestrates seven steps behind a single prompt with a dry-run preview, including the new `reattribute-from-history`, `cleanup-daily-mirrors`, and `recover-lessons` (which re-mines past sessions for lessons dropped by the pre-0.7 capture bug).

## 0.6.0: daily-rollup simplification

Removed the redundant daily-rollup synthesizer. The daily note is rebuilt deterministically from per-session state on each distill, with no separate LLM rollup pass.

## 0.5.1 — Auto-migration UX

Upgrading from <0.5 now auto-detects legacy vault state. Frontmatter backfill runs automatically (detached, ~30 s, idempotent). A one-time notice in SessionStart inject context surfaces a `sb-doctor migrate-all` command that orchestrates the four migration scripts behind a single y/N prompt with dry-run preview. Sentinel at `~/.superbrain/migration-prompted-<version>.txt` ensures the notice appears once per upgraded version.

## [0.5.0] — Vault quality and scale

**Disk:** transcript snapshots no longer accumulate — `bin/sb-checkpoint.ts` overwrites one `<sid>.jsonl` per session, and successful distills GC their snapshot. `auto-sync.sh` adds a weekly transcript/.trash sweep + monthly vault gc. New `sb-doctor disk` command for inspection.

**Format:** Six per-type templates (`decision`, `lesson`, `capture`, `project`, `daily`, `person`) with code validators. Word ceilings (350/300/200) and required sections enforced at write time. Frontmatter normalization: bare-ISO dates, mandatory `type`. Body `## See also` sections forbidden — graph edges live in frontmatter.

**Distiller:** Items now flow through `classify → dedup-session → dedup-vault → validate → write OR reject`. Rejected items go to `meta/distill-rejects.md` with reason; vault and session never block.

**Recall:** UserPromptSubmit upgraded from `bm25Recall` to `hybridRecall`. Project-scoped 2× boost. Recency decay (`exp(-ageDays/90)`). Cross-hook deduplication via `sessions/<sid>.injected.json`. Explicit per-channel token budgets (~1.4k total ceiling) with regression-test guard.

**Preferences:** Two-tier system — small auto-injected core (capped at 3KB/500 tokens) + `meta/preferences-candidates.md` queue with auto-promotion when ≥3 imperative cross-project observations accumulate. `scripts/retro-prune-preferences.ts` helps demote situational entries.

**Graph:** Frontmatter-derived edges persisted to `vault_edges` SQLite table. Stale edges cleared on re-index. Indexer populates the table from `project:`, `created:`, `related:`, `superseded_by:` fields.

**Projects:** New `projectWriter` appends dated subsections under `## Recent activity` with 20KB auto-archive to `projects/_archive/<slug>-<year>-Q<n>.md`.

**Retro-clean scripts (vault, user-applied):** `scripts/backfill-frontmatter.ts` (add missing type/project, normalize dates), `scripts/retro-collapse-duplicates.ts` (collapse known clusters), `scripts/retro-prune-preferences.ts`.

**Observability:** `sb-doctor` CLI with `disk` and `inject` subcommands. Inject token telemetry logged to `~/.superbrain/inject.log`.

**Internal:** 506 tests, all green. CI gates: inject-budget guard (worst-case ≤1500 tokens) + disk-budget guard (1 snapshot per session id).

## [0.4.3]

Cross-platform foundations for native Windows (no WSL) support. The product
code is platform-clean; the CI matrix to enforce it is a planned follow-up
(the existing test suite has implicit POSIX assumptions that need a real
refactor before macOS/Windows can be required-green).

### Added

- **`src/claudeCli.ts`** — cross-platform `execFile("claude", ...)`
  wrapper. On Windows, sets `shell: true` so the `claude.cmd` shim
  resolves; on macOS/Linux, leaves shell unset. The three call sites in
  `distillRun.ts`, `injectRun.ts`, and `discoverer.ts` all route through
  this single helper.
- **Platform-aware bootstrap failure hints** (`bin/sb-bootstrap.ts`). Each
  of the three bootstrap steps (npm ci, npm rebuild better-sqlite3,
  binding-load verify) now has its own try/catch with an actionable
  message: Visual Studio Build Tools + Python 3 on Windows;
  build-essential on Linux; Xcode CLT on macOS.
- **Public docs**: README has a "Supported platforms" section and an
  "Install troubleshooting" subsection mapping bootstrap failures to
  fixes per platform.

### Fixed

- **Cross-platform path handling** (PR #27). `vaultWriter.resolveSafe`
  normalizes backslashes before the EXCLUDED-folder check so writes into
  `.obsidian/`, `.git/`, `.trash/`, `node_modules/` are correctly
  rejected on Windows. `commands/migrate.md` Obsidian vault auto-detect
  now covers macOS, Linux, and Windows registry paths.
  `projectDetect.homedir` no longer short-circuits via `process.env.HOME`.
- **Indexer relpath normalization** (`src/indexer.ts`). `walk()` now
  emits forward-slash-delimited vault relpaths regardless of host OS, so
  the index doesn't mix `\`-separated and `/`-separated forms.
- **`projectDetect` blocklist separator normalization**. Prefix matching
  normalizes separators on both sides before comparison, so
  HOME-relative blocks (`~/.cache/`, `~/.ssh/`, etc.) fire correctly on
  Windows where `path.join(HOME, ".cache")` returns a `\`-separated
  string but the blocklist literals are `/`-separated.
- **Test suite portability** (PR #28): every hardcoded `/tmp/<x>` test
  path replaced with `fs.mkdtempSync(path.join(os.tmpdir(), ...))`. 42
  test files touched.

## [0.4.2]

### Added

- `/superbrain:inject` — manual freeform note ingestion. Auto-detects
  **verbatim** mode (short single-paragraph input) vs **distill** mode
  (longer or multi-topic input); passes through the existing
  route → write → index → daily-upsert pipeline with inject-specific
  provenance (`source: inject`, `injected_at`, `inject_mode`).
  Recall-augmented placement context for distill mode. Safety rails:
  inject never creates new project notes (reserved for
  `/superbrain:discover`), never reshapes preferences, and falls back
  to verbatim capture on any LLM failure — user input is never lost.
  Supports `--from-file <path>`, stdin, `--verbatim` / `--distill`
  overrides, and `--project <slug>` (overrides whatever project the
  model emits). See [PR #24](https://github.com/m3talux/superbrain/pull/24).

### Fixed

- **Distiller wikilink resolution** (#23). The distill prompt asked
  for `links (related-note slugs)`, and the model would emit short
  conceptual slugs like `[[jarvis-vision]]` that did not match any
  on-disk filename — Obsidian renders these as broken links. The new
  `resolveLinks` helper walks the vault once per call and matches each
  emitted link by (1) exact relative-path, (2) exact basename
  (preferring `projects/` → `decisions/` → ...), or (3) token-subset
  against post-date-strip filenames for 2+ token links. Resolution is
  **case-insensitive** (so `[[Alpha-proj]]` matches `projects/alpha-proj.md`)
  and strips leading `./`, `../`, and pipe-aliases (`[[target|alias]]`)
  before matching. Unresolved links are dropped rather than rendered.
  `runDistill`, `runRollup`, and `injectRun`'s distill branch all
  resolve links before routing. The distill prompt also gained an
  explicit rule about emitting full on-disk relative paths.
  See [PR #25](https://github.com/m3talux/superbrain/pull/25) and
  [PR #26](https://github.com/m3talux/superbrain/pull/26).
- **`writeNote` append dedup** (#23). The distiller can re-emit the
  same `project_fact` / `gotcha` across adjacent checkpoints because
  the LLM has no memory of prior emissions; identical sections were
  landing twice in project notes minutes apart. The append branch now
  skips when the normalized new body already appears in the file
  content. A 40-character floor avoids generic-phrase false positives.
  Also benefits inject's distill path. See
  [PR #25](https://github.com/m3talux/superbrain/pull/25).

## [0.4.1]

### Changed

- The detached `claude -p` distill and rollup spawns now **pin the model**
  (default `claude-sonnet-4-6`) instead of inheriting the user's session
  model. Prevents the legacy-scribe failure mode where a user on Opus burned
  the daily quota in hours. Override via the new `SUPERBRAIN_MODEL`
  environment variable (e.g. `claude-haiku-4-5-20251001` for cheaper, or
  `claude-opus-4-7` with `ANTHROPIC_API_KEY` for higher quality on the API
  path).
- `/superbrain:migrate` redesigned. The previous implementation archived a
  maintainer-specific legacy "scribe" setup — that was wrong for a public plugin
  (it only made sense on one machine). The new command is a **non-destructive
  import** of an existing Obsidian vault into SuperBrain's category structure:
  auto-locates the source via Obsidian's own vault registry (with interactive
  fallback), classifies each note, and **copies** into SuperBrain's vault with
  `migrated_from`/`migrated_at` frontmatter; idempotent on re-run; collision
  rename (never overwrite); `--dry-run` previews the plan. The source vault is
  never modified.

### Removed

- `migrateLegacy()` / `archiveCopyThenUnlink()` and the `sb migrate` CLI
  subcommand in `bin/sb.ts` (and their tests in `tests/install.test.ts` +
  `tests/sbAdoptMigrate.test.ts`). The migrate flow is now LLM-driven entirely
  from `commands/migrate.md`.

## [0.1.0]

Initial development baseline.

### Added

- Zero-config, globally-installed automatic capture of Claude Code sessions into
  a plain Obsidian vault (no API key, no daemon, no per-project setup).
- Smart router and append-or-create vault writer with soft-delete; self-healing
  daily/weekly/monthly rollup catch-up.
- Local hybrid search (FTS5 BM25 + sqlite-vec, Reciprocal Rank Fusion) with
  tiered autonomous recall and a stdio MCP search server.
- Personalization & journaling: daily notes, lessons learned from pushback, and
  a deduplicated preference profile injected at session start.
- Owned default vault (`~/.superbrain/vault`) with an ownership marker; explicit
  `/superbrain:adopt` and `/superbrain:migrate` commands; committed `dist/` plus
  a one-time guarded dependency bootstrap so a marketplace install works from a
  bare clone.

[Unreleased]: https://github.com/m3talux/superbrain/compare/v0.4.3...HEAD
[0.4.3]: https://github.com/m3talux/superbrain/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/m3talux/superbrain/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/m3talux/superbrain
[0.1.0]: https://github.com/m3talux/superbrain
