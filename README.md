<div align="center">

# 🧠 SuperBrain

**Automatic Claude Code → Obsidian second brain. Install once, lift no finger.**

Every Claude Code session — across every project, on every machine — is captured into a plain Obsidian vault with smart routing and self-healing daily/weekly/monthly rollups. No API key. No daemon. No per-project setup.

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-black.svg)](package.json)
[![CI](https://github.com/m3talux/superbrain/actions/workflows/ci.yml/badge.svg)](https://github.com/m3talux/superbrain/actions/workflows/ci.yml)
[![Storage](https://img.shields.io/badge/storage-plain%20Obsidian%20markdown-blueviolet.svg)](#vault-structure)

</div>

---

> **Status:** in active development. Interfaces and behavior may change before a tagged release.

## Why

The Claude Code memory ecosystem has split in two, and neither half is what you actually want:

- **Automatic but opaque** (claude-mem, mcp-memory-service): great zero-config capture, but it lives in a SQLite/Chroma blob you can't browse, edit, or own.
- **Obsidian but manual** (basic-memory, claudesidian, obsidian-second-brain): a beautiful markdown vault, but *you* have to remember to run commands or hope the model decides to call a tool.

**No mature tool does all of:** globally installed → automatic capture → into a plain Obsidian vault → with time-based rollups → that you fully own and can `git`-sync. SuperBrain is that missing bridge.

This isn't vibes: ~23 prior-art projects and the current Claude Code platform were surveyed, and every architectural decision was challenged before a line was written.

## Quick start

```text
# In Claude Code:
/plugin marketplace add m3talux/superbrain
/plugin install superbrain
```

That's it. On the **first session** the plugin runs a one-time setup (installs its
search dependencies in the background) and tells you it's doing so; capture is fully
active from the next session. By default SuperBrain writes to its own vault at
`~/.superbrain/vault`. To use an existing Obsidian vault instead, run
`/superbrain:adopt /path/to/your/vault` (or set `SUPERBRAIN_VAULT`). Optional:
`/superbrain:migrate` archives a legacy custom scribe (never deletes; `--dry-run` to preview).

Installed at **user scope**, the plugin's hooks register for *every* project automatically — there is nothing else to do, ever.

## How it works

```mermaid
flowchart LR
  A[Tool use / prompt] -->|PostToolUse, UserPromptSubmit<br/>async, no LLM| B[NDJSON log<br/>+ salient markers]
  B --> C{Checkpoint?<br/>PreCompact / SessionEnd /<br/>Stop if pending}
  C -->|detached, lock-serialized| D[sb-distill<br/>claude -p]
  D --> E[Router]
  E --> F[(Obsidian vault<br/>notes • log.md)]
  C -.->|byte cursor| B
  G[SessionStart] -->|idempotent catch-up| H[Daily / weekly / monthly rollup]
  H --> F
```

1. **Observe** — `PostToolUse` / `UserPromptSubmit` hooks append a compact event line to a per-session NDJSON log. **No LLM** on this path, so it can never rate-limit, stall, or disrupt your turn.
2. **Pin salience** — a deterministic scorer drops a structured marker into the log at the moments that matter (a commit, a file-churn spike, a context switch), so the later summary is anchored to *what happened* instead of re-derived from noise.
3. **Distill at checkpoints** — at `PreCompact`, `SessionEnd`, or a pending-gated `Stop`, one detached, lock-serialized `claude -p` reads the delta since a byte-offset cursor, classifies it, and writes routed notes via an in-process vault writer.
4. **Roll up** — on session start, missing daily/weekly/monthly summaries are caught up idempotently. Miss a day, sleep the laptop, skip a week — it self-heals on the next session.

## Features

**Capture**

- ✅ Globally installed, zero per-project setup, **no API key** (reuses your Claude Code auth)
- ✅ Automatic capture that does **not** degrade on multi-day sessions
- ✅ Plain Obsidian markdown — wikilinks, frontmatter, fully `git`-portable, zero lock-in
- ✅ Smart router: decisions / project facts / people / gotchas / triage capture
- ✅ Self-healing daily/weekly/monthly rollup catch-up — no cron, no daemon
- ✅ Append-or-create, **never** blind-overwrites a note you edited in Obsidian; soft-delete to `.trash/`
- ✅ Idempotent & resumable (byte cursor + `log.md`); silent failures surface once on next session
- ✅ One-command migration off a legacy custom scribe (archives, never deletes)

**Search & recall**

- ✅ Local hybrid search — FTS5 (BM25) + sqlite-vec, fused with Reciprocal Rank Fusion
- ✅ Tiered autonomous recall: BM25 pointers injected on **every prompt** (no model load, no daemon); full hybrid digest on session start
- ✅ `superbrain-recall` skill + stdio MCP server (`superbrain_search`) for model-invoked deep search
- ✅ Incremental index on write + self-healing reconcile on session start (Obsidian-edit / git-pull drift)
- ✅ All-local embeddings (MiniLM, fetched once & cached); automatic BM25 fallback — search is never hard-down

**Personalization & journaling**

- ✅ Daily notes — hybrid digest + linked index, idempotently regenerated per day
- ✅ Lessons — durable, generalizable rules learned from your pushback
- ✅ Preferences — a deduplicated profile auto-injected at SessionStart (never edits your `CLAUDE.md`)

**Planned**

- Auto-generated Maps-of-Content (`maps/`) + a lint pass.

## Vault structure

```
~/.superbrain/vault/
├── projects/      one note per project — status, decisions, current focus
├── people/        one note per person — role, context, threads
├── decisions/     atomic, date-prefixed ADR-style notes
├── daily/         auto-written daily activity
├── lessons/       durable, generalizable rules learned from your pushback
├── capture/       raw inbound, triaged by rollups
├── meta/          preferences.md — deduplicated profile auto-injected at SessionStart
├── maps/          auto-generated Maps-of-Content   (planned)
├── index.md       catalog — the primary navigation surface
└── log.md         append-only, grep-parseable timeline
```

Generated files are namespaced so the rollup regenerator never touches notes you authored.

## Configuration

All optional — sensible defaults mean a clean install needs none.

| Variable | Default | Purpose |
|---|---|---|
| `SUPERBRAIN_VAULT` | `~/.superbrain/vault` | Where notes are written |
| `CLAUDE_PLUGIN_DATA` | `~/.superbrain` | Runtime state (cursors, queue, rollup state) |
| `ANTHROPIC_API_KEY` | *(unset)* | Optional escape hatch — distillation uses the API path instead of your subscription |

> **Heads-up (2026-06-15):** background `claude -p` / Agent-SDK usage on subscription plans draws from a separate capped monthly credit after this date. If captures stop, SuperBrain surfaces a one-time notice on session start — set `ANTHROPIC_API_KEY` to switch to the API path.

## Design principles

Enforced, tested invariants — not aspirations:

- **Never disrupt the session.** Every hook exits 0 no matter what; `PreCompact` never blocks compaction; a crashing hook is impossible by construction.
- **Never lose data.** Append-or-create only; a note you edited in Obsidian is never clobbered; deletes go to `.trash/`.
- **Never silently die.** Failures land in a sentinel surfaced once on the next `SessionStart`.
- **Idempotent & self-healing.** Byte cursor + grep-parseable log + hash-gated rollups; a missed or killed run is recovered next session.
- **No daemon, no scheduler, no API key.** One detached process per checkpoint — nothing to supervise, nothing to leak.

## Development

```bash
npm ci
npm run typecheck     # tsc --noEmit, zero errors
npm run build         # → dist/
npm test              # full suite (unit + integration + fresh-clone E2E)
npm run release:check # build is reproducible: committed dist/ matches source
```

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgements

Standing on the shoulders of: Andrej Karpathy's *LLM Wiki* pattern, [claude-mem](https://github.com/thedotmack/claude-mem) (global-plugin distribution + context injection), [basic-memory](https://github.com/basicmachines-co/basic-memory) (Obsidian-native markdown memory), [obsidian-second-brain](https://github.com/eugeniughelbur/obsidian-second-brain) (AI-first note rules), and [claude-memory-compiler](https://github.com/coleam00/claude-memory-compiler) (session-triggered rollups).

## License

[MIT](LICENSE) © m3talux
