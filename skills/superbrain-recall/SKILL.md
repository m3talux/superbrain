---
name: superbrain-recall
description: Search the user's SuperBrain second-brain vault. Use whenever the user references past work, prior decisions, "how did we", "did we already", earlier sessions, a project's history, or anything that may already be recorded — before answering from scratch.
---

# SuperBrain Recall

When the user's question may already be answered by their accumulated notes, call the
`superbrain_search` MCP tool (server `superbrain`) with a focused `query` (and optional
`k`, default 8).

- Lead with what the vault says; cite every claim with the returned `[[wikilink]]`.
- If results are empty or irrelevant, say so plainly and answer normally — never
  fabricate a citation or invent a note.
- Prefer one well-formed query over many noisy ones.

## Gap sensing — when memory looks stale

Recalled memory can lag reality: a session may have crashed before its last
checkpoint distilled, or the machine slept mid-conversation. Before answering
questions about recent work, check for staleness signals:

- git history shows commits NEWER than the latest memory for this project
- the user references recent work you have no recall of

When you suspect a gap:

1. List `sessions/` in the vault, filtered to this project's slug, newest
   first (the filename embeds a unix timestamp: `{project}-{ts}.md`).
2. Read the newest note that is not the current session: the `## Digest`
   line summarizes the session as of its last checkpoint; the `## Turn log`
   carries the raw prompt/reply trail beyond it.
3. If finer detail is needed and the session is recent (~30 days), the raw
   Claude transcript can be derived — `~/.claude/projects/<cwd with "/" and
   "." replaced by "-">/`, newest `.jsonl` by mtime. Read its tail rather
   than the whole file. Where resuming would genuinely help, offer
   `claude --resume <session-id>` to the user; never resume on your own.
4. State plainly which parts of your answer come from the flight recorder
   versus distilled memory.
