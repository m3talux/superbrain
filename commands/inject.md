---
name: inject
description: Inject freeform text into the SuperBrain vault. SuperBrain splits multi-topic input, places each item in the right scope (project / decision / capture / etc.), links related notes, and updates today's daily note. Short single-blob input is preserved verbatim; longer or multi-paragraph input is split via the inject distiller. Provenance (`source: inject`) is recorded on every written note. Use whenever you want to record something the auto-capture hooks didn't observe — side thoughts, meeting summaries (e.g. piped from a mem.ai MCP), ad-hoc notes from any session.
---

# /superbrain:inject

Manual ingestion path. Auto-capture remains the default — this is for content SuperBrain can't observe.

## What it does

1. Validates input (non-empty, alphanumeric, ≤32 KB).
2. Auto-detects mode: **verbatim** for ≤200 chars with no blank-line separator; **distill** otherwise. Flags `--verbatim` / `--distill` override.
3. **Verbatim**: writes a single `capture/<date>-<slug>.md` (or `projects/<slug>.md` append if `--project` is passed). No LLM call.
4. **Distill**: pulls top-5 related vault notes via recall, lists existing project slugs, calls Sonnet 4.6 with the inject-specific prompt, parses the envelope, routes each item via the same `route()` the session distiller uses.
5. Updates today's daily note. Logs to `~/.superbrain/inject.log`.
6. On LLM failure or empty envelope, **falls back to verbatim capture** — input is never lost.

## Safety rails

- Inject NEVER creates a new project note. Unknown project slugs are downgraded to `capture/`. (Project notes are created only by `/superbrain:discover`.)
- Inject NEVER reshapes preferences. Preference items emitted by the model are dropped.
- `--project <slug>` always wins over anything the model emits.
- Concurrent with an active session checkpoint? Inject takes the same lock and waits up to 5 s.

## How to invoke

Step 1 — gather the user's text. The slash command argument string is in `$ARGUMENTS`. If `$ARGUMENTS` is empty, ask the user what they'd like to inject before running the command.

Step 2 — invoke the CLI. Pass the argument string straight through; the CLI parses flags itself.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-inject.js" $ARGUMENTS
```

If the user wants to inject the contents of a file (e.g. a meeting summary they pasted into `~/Downloads/meeting.md`), use `--from-file`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-inject.js" --from-file "<path>"
```

Step 3 — when the call returns, surface the output verbatim (it lists the rel paths of every note written) so the user knows where each piece landed.

If exit code is non-zero, surface the stderr message. Common reasons:

- `empty input` / `no alphanumeric content` / `input exceeds 32 KB` — user fixable.
- `checkpoint in progress` — tell the user to retry in a moment.
- `vault write failed` / other — check `~/.superbrain/last-failure.txt`.

## What this is NOT

- Not a replacement for `/superbrain:discover` — discovery synthesizes a project note from a code repo; inject ingests freeform user content.
- Not a way to edit or delete existing notes — for that, edit the vault directly.
- Not connected to any external system (mem.ai, etc.). The cross-MCP flow is: the user's other MCP server fetches content, the user pipes it into `inject --from-file` or pastes it as the argument.
