# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it
reaches a tagged release. The project is pre-1.0 and in active development;
behavior may change without notice.

## [Unreleased]

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

[Unreleased]: https://github.com/m3talux/superbrain/compare/main...HEAD
[0.1.0]: https://github.com/m3talux/superbrain
