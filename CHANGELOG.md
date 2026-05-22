# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it
reaches a tagged release. The project is pre-1.0 and in active development;
behavior may change without notice.

## [Unreleased]

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
  **case-insensitive** (so `[[Weddy]]` matches `projects/weddy.md`)
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
