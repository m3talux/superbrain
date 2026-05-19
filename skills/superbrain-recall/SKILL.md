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
