# SuperBrain — repository rules

Instructions for anyone (human or agent) making changes in this repo. These are
enforced by CI and by `main` branch protection.

## Non-negotiables

- **The gate must stay green.** Every change keeps all of these passing:
  `npm run typecheck` (0 errors), `npm run build`, `npm test` (full suite),
  `git diff --exit-code dist` (a.k.a. `npm run release:check`).
- **`dist/` is committed deliberately.** A marketplace `/plugin install` is a
  bare git clone with no `node_modules`, so the compiled output ships in-repo.
  If you touch `src/` or `bin/`, run `npm run build` and commit the resulting
  `dist/` in the same change, or CI fails.
- **Entrypoints stay import-safe.** Files under `bin/` must load with only Node
  built-ins before dependencies exist. Heavy deps (`better-sqlite3`,
  `@huggingface/transformers`, the MCP SDK, `gray-matter`) are reached only via
  a dynamic `import()` gated behind a `depsPresent()` check. `tests/freshClone
  E2E.test.ts` enforces this — never weaken it.
- **Test-first.** Write or update a failing test before the change; never delete
  or skip a test to make the suite pass.
- **Never disrupt the session.** Hooks always exit 0; data is append-or-create
  with soft-delete; failures surface via the sentinel, not by crashing.

## Public-facing content

- **No phased-delivery / internal-process narrative in public docs.** README and
  other shipped docs describe the product as it is, not the order it was built.
  Don't reference `docs/superpowers/` (internal, gitignored).
- Keep README claims truthful and current (defaults, paths, behavior).

## Versioning

- Pre-1.0, in active development. `package.json`, `.claude-plugin/plugin.json`,
  and the MCP server version stay in lockstep. Don't bump the version casually.

## Workflow

- Branch off `main` (`fix/…`, `feat/…`, `chore/…`); open a PR; CI must be green
  before merge. `main` rejects force-pushes and branch deletion.
- Commit messages: imperative mood, conventional prefix (`feat:`, `fix:`,
  `chore:`, `docs:`, `refactor:`, `test:`).

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contributor-facing version.
