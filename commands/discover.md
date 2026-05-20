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

Step 2 — invoke the discoverer binary directly. This must use the plugin's own dist so the prompt and model are consistent with auto-discovery:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-discover.js" --force "<project_dir>"
```

The process is detached internally and finishes in ~10-30 seconds depending on project size. The resulting note will appear at `~/.superbrain/vault/projects/<slug>.md` where `<slug>` is the lowercased, hyphenated basename of the project directory.

Step 3 — when the call returns, tell the user:

- The path of the project note that was written/updated.
- Whether discovery created a new note or appended a `## SuperBrain discovery` section to an existing one (check the note's contents to confirm).
- If the file was not produced (rare — usually means `claude -p` itself failed), check `~/.superbrain/last-failure.txt` and surface the message.

## What this is NOT

- Not a replacement for `/superbrain:migrate` — migrate imports an existing Obsidian vault into SuperBrain's structure; discover synthesizes a project note from a code repo.
- Not a refresh of all known projects — runs against one project at a time. Re-run on each one as needed.
- Not a vault-wide rebuild — does not touch `index.db`, `sessions/`, daily notes, or any other note.
