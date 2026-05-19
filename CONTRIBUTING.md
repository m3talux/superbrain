# Contributing to SuperBrain

Thanks for your interest in improving SuperBrain. This project is in active
development; issues, ideas, and pull requests are all welcome.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).
For security issues, **do not** open a public issue — see [SECURITY.md](SECURITY.md).

## Prerequisites

- Node.js **≥ 20**
- npm (the repo ships a `package-lock.json`; use `npm ci` for reproducible installs)

## Setup

```bash
git clone https://github.com/m3talux/superbrain
cd superbrain
npm ci
```

## Development workflow

This codebase is test-first. Every change should keep the full gate green:

```bash
npm run typecheck     # tsc --noEmit — zero errors
npm run build         # compile → dist/
npm test              # full suite (unit + integration + fresh-clone E2E)
npm run release:check  # build is reproducible: committed dist/ == source
```

**`dist/` is committed on purpose.** A marketplace `/plugin install` is a bare
git clone with no `node_modules`, so the runnable compiled output must live in
the repo. If you change anything under `src/` or `bin/`, you **must**
`npm run build` and commit the resulting `dist/` in the same change — otherwise
`release:check` (and CI) will fail.

Entrypoints under `bin/` must stay **import-safe**: they have to load with only
Node built-ins before dependencies are installed. Heavy dependencies
(`better-sqlite3`, `@huggingface/transformers`, the MCP SDK, `gray-matter`) may
only be reached through a dynamic `import()` gated behind a `depsPresent()`
check. The `tests/freshCloneE2E.test.ts` test enforces this — do not weaken it.

## Pull requests

1. Branch off `main` (e.g. `fix/...`, `feat/...`, `chore/...`).
2. Make focused commits with clear messages (imperative mood, e.g. `fix: ...`).
3. Add or update tests for the behavior you change.
4. Ensure the full gate above is green locally.
5. Open a PR against `main`. CI runs the same gate on every PR and must pass
   before the PR can be merged. `main` is protected: no force-pushes, no branch
   deletion, and a green CI run is required.
6. Keep the PR description focused on *what* changed and *why*, plus how you
   verified it.

## Reporting bugs / requesting features

Use the GitHub issue templates. For bugs, include your OS, Node version, and the
exact steps and observed vs. expected behavior. For features, describe the
problem first, then the proposed solution.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
