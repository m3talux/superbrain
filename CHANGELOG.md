# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it
reaches a tagged release. The project is pre-1.0 and in active development;
behavior may change without notice.

## [Unreleased]

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
  against post-date-strip filenames for 2+ token links. Unresolved
  links are dropped rather than rendered. `runDistill`, `runRollup`,
  and `injectRun`'s distill branch all resolve links before routing.
  The distill prompt also gained an explicit rule about emitting full
  on-disk relative paths. See [PR #25](https://github.com/m3talux/superbrain/pull/25).
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

[Unreleased]: https://github.com/m3talux/superbrain/compare/v0.4.2...HEAD
[0.4.2]: https://github.com/m3talux/superbrain/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/m3talux/superbrain
[0.1.0]: https://github.com/m3talux/superbrain
