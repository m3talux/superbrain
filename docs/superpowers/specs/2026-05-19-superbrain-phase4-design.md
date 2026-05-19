# SuperBrain Phase 4 — Packaging & Migration Hardening (design spec)

- **Date:** 2026-05-19
- **Status:** Draft — pending user review
- **Branch:** `phase-4-packaging`
- **Builds on:** Phases 1–3 (capture spine, search/recall, personalization). No behavior change to those engines.

## 1. Problem & scope

A marketplace `/plugin install superbrain` is a **git clone** — it runs no `npm install`, no build, no lifecycle script. Today that produces a **non-functional plugin**: `dist/` is git-ignored (never shipped/built), `node_modules/` is absent, and the heavy native deps (`better-sqlite3`, `sqlite-vec`, `@huggingface/transformers`) cannot be sanely vendored cross-platform. Hooks point at `${CLAUDE_PLUGIN_ROOT}/dist/bin/*.js` that do not exist; being exit-0/async they fail **silently** → nothing is ever captured. Separately, `vaultPath()` silently adopts any pre-existing `~/vault`, risking co-mingling SuperBrain output with a user's existing notes; and the documented `superbrain install`/`migrate` shell commands are not on PATH after a plugin install.

**P4 (this spec):** make a marketplace-installed plugin actually run, safely, on any machine/OS with any pre-existing vault. Three pillars: (a) runnable artifact + one-time self-healing bootstrap; (b) explicit vault ownership (never silent co-mingle); (c) real Claude Code plugin slash-commands replacing the fake shell-CLI onboarding.

**Deferred → P5 (separate spec→plan→cycle):** the battle-testing & performance suite (happy-path lifecycle E2E, stress, edge/shakeup, efficiency=call-cost, performance=search latency at scale). P4 ships only its own focused tests (incl. a fresh-clone simulation).

## 2. Resolved design forks (decided in brainstorming)

1. **Packaging:** commit the built `dist/` to the repo (un-gitignore, refreshed every release with a maintainer/CI staleness check — explicitly **not** an npm lifecycle hook) **plus** a one-time, guarded, self-healing bootstrap that runs `npm ci --omit=dev` in the plugin dir on first activation. Honest one-time cost; native deps build for the user's own platform; offline thereafter.
2. **Vault ownership:** default to a SuperBrain-**owned** dir it creates at `${dataDir()}/vault` (= `~/.superbrain/vault` by default; follows a `CLAUDE_PLUGIN_DATA` override coherently) carrying a `.superbrain` marker. Delete the `~/vault`-if-exists fallback. Only ever write into a marked/owned dir or one the user explicitly designated (`SUPERBRAIN_VAULT` or `/superbrain:adopt`). An unmarked pre-existing dir is never written.
3. **Onboarding:** "install" is implicit (the bootstrap *is* install). User-facing deliberate ops are real CC plugin **slash-commands** `/superbrain:adopt` and `/superbrain:migrate`, not a shell CLI. `bin/sb.ts` remains usable as `node "${CLAUDE_PLUGIN_ROOT}/dist/bin/sb.js" <cmd>` for power users.
4. **`migrate`:** archive (never destroy) the file-based legacy scribe via **copy-then-unlink** (cross-FS safe), idempotent, re-runnable, `--dry-run`; does not auto-edit user MCP config (prints a manual checklist); is vault-agnostic (owned-path model makes legacy `~/vault` irrelevant; keep-my-vault = `adopt`).

## 3. The load-bearing constraint: entrypoints must load without `node_modules`

ESM `import` is evaluated at module load. Today `bin/sb-session-start.ts` statically `import`s `../src/recall.js` → `searchIndex.js` → `better-sqlite3`. With no `node_modules`, **loading the hook throws before any code runs** — so the hook cannot even detect the missing deps to trigger the bootstrap. Therefore:

- Every `bin/` entrypoint gets a **builtin-only preamble** (only `node:fs`/`node:path`/`node:child_process`/`node:url`) that runs before any heavy import.
- All heavy-dependency logic (recall, searchIndex, indexer, embed, distiller engine, mcp) is loaded via **dynamic `import()`** *after* a deps-presence check, never via top-level static import in an entrypoint.
- If deps are absent: the entrypoint exits 0 immediately (capture/observe/checkpoint/recall become no-ops); `sb-session-start` additionally triggers the bootstrap and emits the one-time notice.
- The committed compiled `dist/bin/*.js` must exhibit the same import-safety (verified by the fresh-clone test loading them with no `node_modules`).

This refactor (static→dynamic heavy imports in `bin/`) is in P4 scope and is the difference between bootstrap working and the hook crashing before it can bootstrap.

## 4. New / changed modules

| File | Change |
|---|---|
| **NEW `src/bootstrap.ts`** | `depsPresent(): boolean` (checks `${pluginRoot}/node_modules/better-sqlite3` exists, builtin-only); `runBootstrap(pluginRoot): void` — detached, lock-serialized (`lockDir("bootstrap")`), recursion-guarded (`SUPERBRAIN_CHILD`) spawn of `npm ci --omit=dev` cwd=pluginRoot; on success writes `${dataDir}/bootstrap-done`; on failure writes the sentinel. Idempotent (no-op if `bootstrap-done` exists or lock held). |
| **NEW `src/vaultMarker.ts`** | `MARKER = ".superbrain"`; `isOwned(dir)`, `markOwned(dir)`, `recordedVaultPath()`/`setRecordedVaultPath(p)` (persisted at `${dataDir}/vault-path`). Builtin-only (no heavy deps). |
| **CHANGE `src/paths.ts`** | `vaultPath()` resolution: 1) `SUPERBRAIN_VAULT` (explicit → ensure marked) → 2) recorded adopted path (from `/superbrain:adopt`) → 3) owned default `${dataDir()}/vault` (create + mark). **Delete the `if (~/vault exists) return ~/vault` branch.** Add `pluginRoot()` (from `CLAUDE_PLUGIN_ROOT` env, else resolved from `import.meta.url`). |
| **CHANGE `bin/sb.ts`** | Replace `migrateLegacy` with a cross-FS-safe, idempotent, `--dry-run`-capable archival (copy+fsync-verify+unlink into `${dataDir}/archived-legacy/<ISO>/`). Add `adopt <path>`: validate dir+writable, refuse a foreign-tool-marked dir, then `markOwned` + `setRecordedVaultPath` (all builtin-only, immediate, always succeed without deps). The existing-notes reconcile is **best-effort**: run it only if `depsPresent()`; otherwise it is naturally picked up by the normal SessionStart reconcile once the bootstrap completes (adopt never blocks on or fails due to absent deps). `install` subcommand becomes a thin "bootstrap status" reporter (bootstrap is automatic). Keep the script-guard pattern. |
| **CHANGE `bin/sb-session-start.ts`** | Builtin-only preamble first. If `!depsPresent()`: `runBootstrap(pluginRoot())`, push a one-time "SuperBrain is finishing first-time setup…" notice, skip the heavy recall/preferences digest, still exit 0. If deps present: dynamic-`import()` the existing Phase-2/3 digest logic unchanged. Additionally, when the active vault is the owned default (no `SUPERBRAIN_VAULT`, no recorded adopt), emit a **one-time universal** notice: "SuperBrain is capturing into its own vault at `<owned path>`; to use an existing Obsidian vault instead, run `/superbrain:adopt <path>` or set `SUPERBRAIN_VAULT`." (This is a generic courtesy notice — it does **not** probe for or special-case `~/vault`, and never affects `vaultPath()` resolution.) |
| **CHANGE `bin/sb-observe.ts`, `bin/sb-checkpoint.ts`, `bin/sb-recall.ts`, `bin/sb-mcp.ts`** | Builtin-only preamble + deps-presence guard; heavy logic moved behind dynamic `import()`. Deps absent → exit 0 (recall/mcp return empty). No behavior change when deps present. |
| **CHANGE `.gitignore`** | Remove the `dist/` line (and keep ignoring `node_modules/`). |
| **CHANGE `package.json`** | Add a `release:check` script = `npm run build && git diff --exit-code dist` (staleness guard run by the maintainer/CI before tagging a release). Deliberately add **no** `prepare`/`postinstall` lifecycle hook (it would not run on a plugin git-clone anyway and would mislead). Keep `bin` for power-user/global use. |
| **CHANGE `.claude-plugin/plugin.json`** | Bump version in lockstep with `package.json` (currently stale 0.2.0); add the `commands` registration for the two slash-commands. |
| **NEW `commands/adopt.md`, `commands/migrate.md`** | CC plugin slash-command definitions invoking `node "${CLAUDE_PLUGIN_ROOT}/dist/bin/sb.js" adopt <path>` / `… migrate [--dry-run]`. (Exact CC command-file format verified against current Claude Code docs during planning.) |
| **COMMIT `dist/`** | The compiled output is committed (import-safe entrypoints + all `dist/src`, `dist/bin`). |
| **CHANGE `README.md`** | Rewrite the Quick start to the truth (add marketplace → install plugin → first session auto-bootstraps once → optional `/superbrain:adopt ~/vault`); fix the stale "52 tests across 21 files"; document owned-vault default + `SUPERBRAIN_VAULT` + adopt + bootstrap. |

## 5. Data flow

```
clone (marketplace): repo has dist/ + package.json, NO node_modules
first SessionStart : sb-session-start preamble (builtin-only) → depsPresent()? NO
                     → runBootstrap (detached, locked, guarded: npm ci --omit=dev)
                     → notice "finishing first-time setup"; exit 0 (no capture yet)
next SessionStart  : depsPresent()? YES → bootstrap-done marker → full Phase-1/2/3
                     behavior via dynamic import; vault = owned default (~/.superbrain
                     /vault, created + .superbrain marker)
keep-my-vault      : user runs /superbrain:adopt ~/vault → validate+mark+record →
                     one-time reconcile indexes existing notes → recall over history
legacy cleanup     : user runs /superbrain:migrate [--dry-run] → copy-then-unlink
                     stop-scribe.sh + scribe skill into archived-legacy/<ISO>/;
                     prints MCP-legacy manual checklist; vault untouched
```

## 6. Error handling (Phase-1 discipline preserved)

- Bootstrap/adopt/migrate failures are **non-fatal**: sentinel-logged, surfaced once at next SessionStart, retried/self-healed. No hook can crash a session (builtin-only preamble + exit-0 + whole-body try/catch).
- Bootstrap is lock-serialized and recursion-guarded (no concurrent/duplicate `npm ci`); no-op once `bootstrap-done` exists.
- `migrate` never unlinks an original until its archived copy is written **and fsync-verified**; idempotent (absent targets / already-archived → no-op); `--dry-run` performs zero filesystem mutation.
- `adopt` refuses: a non-directory, a non-writable path, or a path already marked by a different tool; validates before recording. Marking/recording is builtin-only and always succeeds; the existing-notes reconcile is best-effort (deferred to the next SessionStart reconcile if deps are not yet bootstrapped) so `adopt` never fails due to absent deps.
- `vaultPath()` never returns an unmarked pre-existing directory; the owned default is created+marked atomically before first write.

## 7. Testing (P4-scoped; deep battle-testing is P5)

- **Fresh-clone simulation:** stage a temp copy with `dist/` present but `node_modules` absent; assert every `bin/` entrypoint loads without throwing, exits 0, and `sb-session-start` emits the bootstrap notice and invokes the bootstrap spawn (stubbed `npm`); then with deps "present" assert full behavior resumes. This is the load-bearing test for §3.
- **`vaultPath()` matrix:** `SUPERBRAIN_VAULT` set / recorded-adopted / owned-default-created+marked / pre-existing-unmarked-never-returned. Assert the `~/vault` fallback is gone.
- **`vaultMarker`:** mark/isOwned/record round-trip; foreign-marker detection.
- **`adopt`:** valid dir (marks, records, triggers reconcile), rejects file/non-writable/foreign-marked.
- **`migrate`:** copy-then-unlink, simulated cross-filesystem (no `EXDEV`), idempotent re-run = no-op, `--dry-run` mutates nothing, absent targets safe.
- **Bootstrap:** idempotent (skips when `bootstrap-done`/lock), sentinel on simulated `npm` failure, recursion-guarded.
- **Non-regression:** all Phase 1–3 tests stay green with deps present (dynamic-import refactor must not change behavior); the committed `dist/` matches source (`release:check`).

## 8. Decisions & grounding

| # | Decision | Grounding | Confidence |
|---|---|---|---|
| P4.1 | Commit `dist/` + one-time guarded bootstrap (`npm ci --omit=dev`) | marketplace install = git clone, no npm/build; native deps can't vendor cross-platform; matches "install once" | High |
| P4.2 | Entrypoints builtin-only preamble + dynamic-import heavy logic | static import of native deps crashes the hook before it can bootstrap | High |
| P4.3 | Owned vault default + `.superbrain` marker; delete `~/vault` fallback; explicit `adopt` | universal no-silent-co-mingle guarantee for any pre-existing vault | High |
| P4.4 | Onboarding = CC plugin slash-commands; install implicit | a plugin install provides no global CLI | High |
| P4.5 | `migrate` = copy-then-unlink, idempotent, dry-run, no auto-MCP-edit, vault-agnostic | cross-FS safety; never destroy; don't mutate user MCP config silently | High |
| P4.6 | Battle-testing deferred to P5 | independent subsystem; must test the *fixed* lifecycle | High |

## 9. Phasing

- **P4 (this spec):** §3 import-safety refactor, §4 modules, §5 flow, §7 P4-tests. Independently shippable; delivers a marketplace plugin that actually runs and is safe on any pre-existing vault.
- **P5 (next cycle):** battle-testing & performance suite — happy-path lifecycle E2E, stress, edge/shakeup, efficiency (bounded call counts), performance (search latency over a large synthetic vault). Earns the "battle tested" claim against the now-working P4 lifecycle.

## References

- Builds on `docs/superpowers/specs/2026-05-19-superbrain-phase{1,2,3}-design.md`.
- Claude Code plugin model (marketplace = git clone; hooks/skills/commands/MCP declarative; no npm lifecycle): https://code.claude.com/docs/en/plugins
- Phase-1 lock/sentinel/recursion-guard/exit-0 discipline reused for the bootstrap.
