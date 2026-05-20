---
name: discover
description: Generate a substantive project note for the current (or specified) repo. Forces a fresh discovery — if a project note already exists, appends a new `## SuperBrain discovery (date)` section without clobbering existing content. Use when SuperBrain didn't auto-discover (e.g., the project's slug collided with a note migrated from a legacy vault), or to refresh an out-of-date project note.
---

# /superbrain:discover

Manual project discovery. Auto-discovery only fires on first session in a project with **no existing note** — this command bypasses that gate.

## What it does

1. Walks the project tree (bounded: 600 files, depth 5, vendored/build dirs skipped).
2. Reads manifests + `CLAUDE.md` + `README` + `Dockerfile` (each capped at 8 KB).
3. Invokes one detached `claude -p sonnet-4-6` call with the gathered context.
4. Writes a structured project note covering: stack, architecture, top-level folders, key files, docs, conventions, open questions.
5. **If the project note already exists**, appends a fresh `## SuperBrain discovery (YYYY-MM-DD)` section at the bottom — never overwrites user content. **If no note exists**, creates one with full `discovered: true` frontmatter.

## How to invoke

Step 1 — determine the target project directory:

- If an argument was passed to the slash command, treat it as an absolute path (or relative to the current working directory). Verify it exists and is a directory.
- Otherwise, default to `$CLAUDE_PROJECT_DIR` (the project the current session opened in).

Step 2 — invoke the discoverer binary. The plugin classifies the target through the four-stage detection cascade (blocklist → strong-signal → workspace declaration → implicit umbrella) and handles single-project vs umbrella fan-out internally.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-discover.js" --force "<project_dir>"
```

If the user explicitly asked to refresh every sub-project under an umbrella (not just the missing ones), pass `--all` too:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-discover.js" --force --all "<project_dir>"
```

What the binary actually does given `<project_dir>`:

- **Blocked path** (HOME, Documents, Library, /tmp, etc.) → silent skip, no note. Tell the user the path is on the blocklist and discovery cannot run there.
- **No strong project signal** (just a README or LICENSE, no real manifest) → silent skip. Tell the user the directory doesn't look like a code project.
- **Single project** → one note at `~/.superbrain/vault/projects/<slug>.md`. If the note already exists, a fresh `## SuperBrain discovery (date)` section is appended.
- **Umbrella / monorepo** (workspace declaration or ≥2 sibling sub-projects detected) → one note per detected child (capped at 8), each named `<umbrella-slug>-<child-slug>.md` with `umbrella: <umbrella-slug>` frontmatter. Without `--all`, only children whose note doesn't exist yet are written; with `--all`, every child's note gets a fresh appended section.
- **Sub-project of an umbrella, opened directly** → discovery treats it as a single project but with umbrella context, so the slug is correctly prefixed.

Discovery decisions and skip reasons are written to `~/.superbrain/discovery.log` for traceability.

Step 3 — when the call returns, tell the user:

- For single-project discovery: the path of the project note that was written or updated.
- For umbrella fan-out: the umbrella name, how many children were detected, and the paths of the notes that were written (or skipped because they already exist and `--all` was not passed). If any children were dropped because they exceeded the cap (>8), surface that and suggest running `/superbrain:discover <child>` on each.
- If discovery was a no-op (blocked or no-signal), explain the gate that fired by reading the last line(s) of `~/.superbrain/discovery.log`.
- If `claude -p` itself failed (rare), check `~/.superbrain/last-failure.txt` and surface the message.

## What this is NOT

- Not a replacement for `/superbrain:migrate` — migrate imports an existing Obsidian vault into SuperBrain's structure; discover synthesizes a project note from a code repo.
- Not a refresh of all known projects — runs against one project at a time. Re-run on each one as needed.
- Not a vault-wide rebuild — does not touch `index.db`, `sessions/`, daily notes, or any other note.
