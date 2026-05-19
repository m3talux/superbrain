# SuperBrain

Automatic Claude Code → Obsidian second brain. Install once at user scope; every
session is captured into a plain Obsidian vault with smart routing and
session-triggered daily/weekly/monthly rollups. No API key required (reuses your
Claude Code auth); optional `ANTHROPIC_API_KEY` escape hatch.

> **Heads-up (2026-06-15):** background `claude -p`/Agent-SDK usage on subscription
> plans draws from a separate capped monthly credit after this date. If captures
> stop, SuperBrain surfaces a one-time notice on session start; set
> `ANTHROPIC_API_KEY` to use the API path instead.

## Install
```
/plugin marketplace add <user>/SuperBrain
/plugin install superbrain
```
Then run `superbrain install` (and `superbrain migrate` if upgrading from the legacy
custom scribe — it archives, never deletes).

## How it works
Observer hooks (no LLM) → NDJSON + salient markers → checkpoint (PreCompact/SessionEnd/
Stop-if-pending) → one detached `claude -p` distiller (lock-serialized) → routed notes
+ `log.md`/`index.md`. Rollups run as an idempotent catch-up on session start.

See `docs/superpowers/specs/2026-05-19-superbrain-design.md` for the full design and the
research/red-team rationale behind every decision.

Phase 2 (planned): local sqlite-vec + FTS5 hybrid search + autonomous recall injection.
