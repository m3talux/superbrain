---
description: Import an existing Obsidian vault into SuperBrain's structure — non-destructive (source is read-only; SuperBrain's vault gets copies). Optional path argument; otherwise Claude finds the vault.
---

You are running the SuperBrain `/superbrain:migrate` command. Your job is to fold the user's
existing Obsidian vault into SuperBrain's category structure **non-destructively**.

The user may have passed an argument: `$ARGUMENTS`.

# Hard invariants — must never be violated

1. **The source vault is READ-ONLY.** Never `Write`, `Edit`, `rm`, `mv`, or otherwise modify any
   file inside the source vault. Use the `Read` tool only. No git operations on the source.
2. **Never overwrite a destination note.** If a destination note already exists for a different
   source path, write the copy to `<basename>-<8-char-hash>.md` and record the collision in the
   final report.
3. **Idempotent on re-run.** A destination note whose frontmatter `migrated_from` matches the
   current source path counts as already migrated — skip it. So re-running this command on the
   same source produces no duplicates and resumes cleanly after an interruption.

# Step 1 — Locate the source vault

Determine the source vault path in this priority order:

1. If `$ARGUMENTS` is a non-empty path:
   - If it's `--dry-run` (no path), set `DRY_RUN=true` and continue without a path.
   - Otherwise: resolve it; if it's an existing directory containing an `.obsidian/` folder OR
     at least one `.md` file at depth ≤ 2, accept it as the source. If `--dry-run` is also in
     `$ARGUMENTS`, set `DRY_RUN=true`.
2. Otherwise, auto-detect by reading Obsidian's vault registry (macOS):
   - `~/Library/Application Support/obsidian/obsidian.json` → its `vaults` object lists
     vaults the user has opened, each with a `path`. Filter to entries whose `path` exists.
3. If the registry produces 0 candidates, scan these common defaults (existence check only):
   - `~/Documents/Obsidian Vault`, `~/Documents/Obsidian/*`, `~/Obsidian`,
   - `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/*` (iCloud).
4. Decision:
   - **0 candidates** → ask the user: *"I couldn't auto-detect an Obsidian vault. Could you give
     me the absolute path?"* Wait for a reply; validate it (directory, contains markdown).
   - **1 candidate** → confirm with the user: *"I found `<path>` — proceed with that?"*. Wait.
   - **>1 candidate** → present the list with brief identifiers and ask the user to pick.

The destination vault is **SuperBrain's own vault**: resolve it by running
`node "${CLAUDE_PLUGIN_ROOT}/dist/bin/sb.js" install` once (idempotent — creates `dataDir`),
then use the SuperBrain vault location, which is `$SUPERBRAIN_VAULT` if set, else the recorded
adopted path (`<dataDir>/vault-path` contents) if present, else `<dataDir>/vault` (default
`~/.superbrain/vault`). The `.superbrain` ownership marker must exist or be created there
(it will be, by `vaultPath()` on the next plugin run; you do not need to write it).

# Step 2 — Enumerate source notes

Recursively list every `.md` file under the source vault, EXCLUDING:

- `.obsidian/` (Obsidian's own config)
- `.trash/`
- any folder starting with `.git`
- attachments (binary files, images, PDFs — anything that isn't `.md`)

For each note, capture: absolute path, basename, top-level folder under the source (a useful
hint for categorization), and parse its frontmatter if any (look for fields like `type`,
`tags`, `date`, `aliases`).

# Step 3 — Categorize each note (your judgment)

Map each source note to one of SuperBrain's categories:

| SuperBrain category | What lands there |
|---|---|
| `projects/` | A note describing a project, repo, product, or workstream. Often `type: project` in frontmatter, or a top-level folder named `projects/` in source. |
| `people/` | A note about a single person — colleague, friend, public figure. Often `type: person`, or a top-level `people/` folder. |
| `decisions/` | An ADR-style note: a recorded decision (often date-prefixed, like `2026-04-15-...`). Frontmatter `type: decision` or filename pattern. |
| `daily/` | A daily journal/log note. Filename matches `YYYY-MM-DD.md` or `type: daily`. |
| `lessons/` | A generalizable rule/learning ("how-to", "always do X", post-mortem-style). |
| `capture/` | Default for anything that doesn't fit cleanly. Better to land here than mis-categorize. |
| `meta/` | Reserved for SuperBrain-managed config (e.g. `preferences.md`). **Do NOT migrate notes into `meta/`**. |

Heuristics priority: explicit frontmatter `type` > source folder name > filename pattern > content. If unsure, prefer `capture/`. Never put anything in `meta/`.

# Step 4 — Plan, then optionally execute

Produce a categorization plan as a Markdown table (counts per category + a few sample mappings).

**If `DRY_RUN` is true:** print the plan and STOP. Do not write anything. Tell the user:
*"Dry run complete. Re-run without `--dry-run` to apply."*

**Otherwise:** ask the user to confirm the plan with a brief prompt: *"Apply this plan? (yes/no)"*.
Wait for confirmation. If `yes`, proceed to Step 5. If `no`, stop.

# Step 5 — Copy notes into the destination

For each source note, in plan order:

1. Read the source note's full content (Read tool).
2. Compute destination path: `<dest-vault>/<category>/<basename>`.
3. **Idempotency check:** if the destination path already exists AND its frontmatter
   `migrated_from` equals this source's absolute path → SKIP and count as already-migrated.
4. **Collision check:** if the destination path exists AND `migrated_from` is missing or
   different → compute an 8-char hash of the source path and write to
   `<basename>-<hash>.md` instead. Log this as a collision.
5. Compose the destination content:
   - Preserve the source frontmatter and body verbatim.
   - **Add/overwrite these frontmatter fields** (without removing any existing ones):
     - `migrated_from: <absolute source path>`
     - `migrated_at: <ISO 8601 timestamp>`
     - `migration_source_vault: <absolute source vault root>`
   - Leave wikilinks (`[[Note]]`) untouched. Obsidian resolves them by basename across the
     whole destination vault; this is the chosen v1 strategy.
6. **Write** the destination file (Write tool).

Periodically (every ~25 notes), report progress: *"Migrated X/N so far…"*.

# Step 6 — Final report

When done, print:

- Source vault path and destination vault path.
- Total notes considered.
- Counts per destination category.
- Skipped (already migrated): N.
- Collisions renamed: N (list the basenames if ≤ 20).
- Errors (per-note failures, if any).
- Closing line: *"Source vault was not modified. Re-running this command is safe and resumes."*

# Tone

Be concise. Don't dump full note contents to the user. Ask questions only when the locate step
genuinely requires user input. Default to action once the plan is confirmed.
