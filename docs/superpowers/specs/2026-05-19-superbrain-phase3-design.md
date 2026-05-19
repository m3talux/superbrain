# SuperBrain Phase 3 — Personalization & Journaling (design spec)

- **Date:** 2026-05-19
- **Status:** Draft — pending user review
- **Branch:** `phase-3-personalization`
- **Builds on:** Phase 1 (capture spine: observer → distiller → router → vaultWriter; idempotent SessionStart rollup) and Phase 2 (search + autonomous recall; the synchronous SessionStart digest block in `bin/sb-session-start.ts`).

## 1. Scope

**P3 (this spec):** three capabilities, layered on the shipped pipeline with **no new daemon, no new hook entrypoint, no new MCP server**:

1. **Lessons** — durable, generalizable rules learned from user pushback.
2. **Preferences** — a deduplicated user profile that is auto-applied every session.
3. **Daily notes** — a per-day journal that captures the chronological flow and connective tissue the topic router discards.

**Explicitly out of scope (deferred):** repo code-structure / per-repo knowledge graph (a different subsystem — repo introspection, not session distillation; a later phase). P2.1 (calibrated vector-distance threshold, auto-MOC `maps/`) remains independent and unaffected by this spec.

## 2. Resolved design forks (decided during brainstorming)

1. **Preferences delivery:** SuperBrain owns `meta/preferences.md` as the deduplicated source of truth; a compact compiled block is injected at **SessionStart** (extending the Phase-2 digest block). SuperBrain **never** mutates the user's `~/.claude/CLAUDE.md` (no auto-merge; reversible; self-contained).
2. **Daily note shape:** hybrid — a short `## Summary` digest, a `## Decisions & gotchas` linked index (links, never duplicates, the day's routed notes), an `## Also did` list of salient events that never topic-routed, and `## Threads open`. Accumulates across all of a day's sessions; finalized by the SessionStart rollup.
3. **Lesson detection:** inferred **and** explicit, generalizable-gated. The observer emits a new **pushback** salient marker (user negates / redirects / reverts a prior Claude action, or an explicit `lesson:` / "remember for next time" cue). The distiller emits a lesson **only** if it implies a generalizable rule; one-off local fixes are skipped.
4. **Lesson → preference coupling:** distill-time split. A generalizable lesson emits **both** a `lesson` item (incident + **Why**) **and** a paired `preference` item (the crisp rule). Situational lessons stay lesson-only. No fragile recurrence-counting.
5. **Architecture:** Approach A — `lesson` and `preference` become new distilled `Kind`s flowing through the existing observer → distiller → router → vaultWriter path; the daily note is a separate idempotent **synthesis** module (regeneration, not a per-item kind), mirroring how Phase 2 separates indexing from recall.

## 3. Vault layout (new locations)

| Path | Capability | Write mode |
|---|---|---|
| `lessons/YYYY-MM-DD-{slug}.md` | one note per lesson incident | `create` |
| `meta/preferences.md` | single deduplicated profile | `replace` (full reconciled set) |
| `daily/YYYY-MM-DD.md` | one journal note per day | `replace` (idempotent regeneration) |

Existing routes (`decisions/`, `projects/`, `people/`, `capture/`) are unchanged.

## 4. New / changed `src/` modules

| Module | Responsibility | Depends on |
|---|---|---|
| **NEW `src/dailyNote.ts`** | `buildDailyNote(date) → RouteResult` (mode `replace`). Deterministic composition of `## Summary` (from accumulated per-session digest lines), `## Decisions & gotchas` (wikilinks to that day's routed notes), `## Also did` (non-routed salient events), `## Threads open`. Same inputs → byte-identical output (idempotent / self-healing). | `dailyState` (sidecar), `router` (slug), `frontmatter`, `paths` |
| **NEW `src/dailyState.ts`** | Per-day sidecar at `${dataDir}/daily/YYYY-MM-DD.json`, keyed **by `sessionId`** (upsert per session, never blind-append) holding `{ digestLine, routedRelPaths[], alsoDid[], openThreads[] }`. `routedRelPaths` come from the `RouteResult`s the writer just produced (deterministic); `digestLine` / `alsoDid` / `openThreads` come from the distiller envelope (§5). Re-distilling the same session (rollup catch-up) overwrites that session's entry → no double-count. | `paths` |
| **NEW `src/preferences.ts`** | `compileInjectionBlock(): string` — read `meta/preferences.md`, emit the compact SessionStart block (empty string if absent). `parsePreferences(raw)` / `normalize(set)` for the no-op-on-unchanged guard. Reconciliation itself is the distiller LLM's job, not this module's. | `paths`, `frontmatter` |
| **CHANGE `src/router.ts`** | `Kind` gains `"lesson" \| "preference"`. `DistilledItem` gains one optional `rule?` (the crisp durable rule extracted from a generalizable lesson). New `route()` branches: `lesson → lessons/${date}-${slug(title)}.md` (`create`, body = incident + `**Why:**` + `**Rule:** {rule}`-if-present + links); `preference → meta/preferences.md` (`replace`, body = the single `preference` item's `body`, which **is** the complete reconciled preferences document, grouped by area as plain markdown headings — not assembled from multiple items). New `RouteResult` `mode: "replace"`. | (none new) |
| **CHANGE `src/vaultWriter.ts`** | Add atomic `mode: "replace"`: full managed-file overwrite preserving frontmatter via existing `atomicWrite`; never partial. **No-ops if the normalized new body equals the existing body** (prevents churn from LLM re-distillation). | `atomicWrite`, `frontmatter` |
| **CHANGE `src/salience.ts`** | Add a **pushback** salient-marker type: detect user negation / redirection / revert of a prior Claude action, plus explicit `lesson:` / "remember for next time" cues. | (none new) |

`dailyNote.ts` and `preferences.ts` are isolated synthesis/read modules; the per-turn Phase-2 recall path never imports them (boundary discipline preserved from Phase 2 §3).

## 5. Entrypoint / skill changes (extend, do not duplicate)

- **EXTEND `skills/superbrain-distill/SKILL.md`** — distiller prompt additions. **The distiller output changes from a bare JSON array to an envelope object** `{ "items": DistilledItem[], "digest"?: string, "openThreads"?: string[], "alsoDid"?: string[] }` so session-level fields have a home (`items` carries the same per-item objects as today). Specifics:
  - New kinds `lesson` / `preference` in the item schema; one new optional per-item field `rule` (used by the `lesson` route).
  - **Generalizability gate:** emit a `lesson` only when the pushback implies a rule that generalizes beyond the immediate edit; skip one-off local corrections.
  - **Distill-time split:** when a lesson is generalizable, emit the `lesson` item (incident + Why, with `rule` set) **and exactly one** paired `preference` item.
  - **Preference reconciliation:** whenever a `preference` item is emitted, the distiller is handed the **current `meta/preferences.md` contents** in its prompt and must return **exactly one** `preference` item whose `body` is the **complete reconciled preferences document** — the new rule integrated, duplicates removed, contradictions resolved newest-wins (superseding older entries), grouped by area as plain markdown headings. (Single item, full document — never multiple preference items.)
  - `digest` (≤1 sentence, the session's arc → daily `## Summary`), `openThreads` (unfinished/explicitly-deferred work → daily `## Threads open`), and `alsoDid` (notable "what I did" that did not become a knowledge item → daily `## Also did`) are emitted at the **envelope** level, not as items.
- **EXTEND `bin/sb-distill.ts`** — parse the new envelope (**back-compatible:** a bare array is treated as `{ items: array }`). After routing `items`: (a) upsert this session's `dailyState` entry — `routedRelPaths` from the `RouteResult`s just written, `digestLine`/`alsoDid`/`openThreads` from the envelope; (b) call `dailyNote.buildDailyNote(date)` and write it (`replace`). Both wrapped per-call in `try/catch → writeFailure` (non-fatal, sentinel-logged), identical to the Phase-2 `indexNote` integration. The existing Phase-2 `indexNote` call is preserved (lessons/daily/prefs get indexed by it / by `reconcile`).
- **EXTEND `bin/sb-session-start.ts`** — the Phase-2 synchronous digest block is **extended** (not duplicated) to also append: (a) the compiled preferences block from `preferences.compileInjectionBlock()`; (b) today's `## Threads open` from the current-day sidecar. Wrapped in the same best-effort `try/catch` as the Phase-2 recall digest; recursion-guard / exit-0 unchanged. The existing SessionStart rollup additionally rebuilds the caught-up date(s)' daily notes (idempotent).

No `hooks.json`, `.mcp.json`, or `plugin.json` changes are required (no new entrypoints). `package.json` version → `0.3.0` at the final task.

## 6. Data flow

```
capture  : observer → salient markers (NEW pushback marker) → NDJSON
distill  : checkpoint/Stop/PreCompact → detached sb-distill → distiller LLM
             returns envelope { items, digest?, openThreads?, alsoDid? }:
             lesson / preference (generalizable-gated; generalizable lesson ⇒
             one paired preference item whose body = full reconciled
             preferences doc); existing kinds unchanged
route    : lesson      → lessons/DATE-slug.md       (create)
           preference  → meta/preferences.md        (replace, full set)
           decision/project_fact/gotcha/person      (unchanged)
synthesis: sb-distill upserts dailyState[sessionId] → buildDailyNote(DATE)
             → daily/DATE.md (replace, idempotent)
heal     : SessionStart rollup → re-distill caught-up date(s) + rebuild their
             daily notes; Phase-2 reconcile indexes new lessons/daily/prefs
surface  : SessionStart digest (Phase-2) EXTENDED: + compiled preferences
             + today's open threads. Lessons surface via Phase-2 recall and
             the daily index.
```

## 7. Error handling (Phase-1/2 discipline preserved)

- All new work is non-fatal: dailyNote / dailyState / preference failures are sentinel-logged and self-heal on the next checkpoint or SessionStart (idempotent regeneration, same contract as Phase-2 `reconcile`).
- `replace` writes are **atomic** (existing `atomicWrite`): a malformed/failed reconcile leaves the prior `meta/preferences.md` (or `daily/*.md`) byte-intact. The writer validates the distiller's reconciled preference set (non-empty, frontmatter-parseable) before replacing; on failure it keeps the old file and writes the sentinel.
- Missing `meta/preferences.md` → SessionStart injects nothing for preferences (silent, not an error). Missing a daily note → built on the next trigger.
- Preferences injection is best-effort `try/catch`, like the Phase-2 recall digest — never blocks SessionStart; SessionStart still exits 0.
- **LLM-nondeterminism guard:** `meta/preferences.md` is rewritten only when the distiller actually emits `preference` items, and `vaultWriter`'s `replace` mode **no-ops when the normalized new body equals the existing body** — so re-distillation cannot churn the file or the index.
- **Lesson over-capture guard:** the generalizability gate lives in the distiller prompt; when in doubt the distiller emits a lesson-only item (no paired preference), keeping `meta/preferences.md` high-signal.
- `dailyState` is keyed by `sessionId` (upsert, not append) so rollup catch-up re-distilling a session cannot double-count its contributions to the daily note.

## 8. Testing

- **Unit:** `dailyNote` golden fixtures (multi-session day; empty-day → minimal valid note; re-run with same sidecar → byte-identical); `dailyState` upsert-by-sessionId (re-distill same session → no duplication); `router` new branches (`lesson` with/without `rule`; `preference` → `replace`); `vaultWriter` `replace` atomicity **and** no-op-on-unchanged; `preferences.compileInjectionBlock` (present / absent / malformed); `salience` pushback-marker detection (positive + negative cases); distiller-**stub** fixtures for lesson / preference / paired emission / generalizability gate (reuse the existing `SUPERBRAIN_DISTILLER` stub seam).
- **Integration:** pushback marker → stub distiller emits lesson + paired preference → router writes `lessons/` (create) + `meta/preferences.md` (replace) → Phase-2 `reconcile` indexes them → SessionStart injects the compiled prefs block + Phase-2 recall surfaces the lesson; daily note across **two same-day sessions** = correctly merged index + accumulated summary, idempotent on re-run.
- **Idempotency / non-regression:** `buildDailyNote` twice → zero delta; re-distill with no new preferences → zero `preferences.md` / index churn (no-op guard); **all Phase 1 + Phase 2 tests stay green** — in particular the SessionStart digest extension must not regress `tests/sessionStartDigest.test.ts` or the Phase-2 recall tests, and must keep `tests/rollupConvergence.test.ts` green.
- **Offline:** reuse `SUPERBRAIN_EMBED_STUB` + the distiller stub seam; no network at test time.

## 9. New dependencies

None. Phase 3 reuses the shipped stack (`better-sqlite3` / `sqlite-vec` / `@huggingface/transformers` for indexing lessons & daily notes via the existing Phase-2 path; `gray-matter` for frontmatter; the existing atomic-write, lock, sentinel, rollup-state machinery).

## 10. Decisions & grounding

| # | Decision | Grounding | Confidence |
|---|---|---|---|
| P3.1 | Prefs = owned `meta/preferences.md` + SessionStart inject; never edit user `CLAUDE.md` | reversible, self-contained, reuses the Phase-2 digest-injection pattern; avoids mutating a user-curated file | High |
| P3.2 | Daily = hybrid (digest + linked index + also-did + threads), idempotent regeneration | the topic router can't serve a time-indexed journal; regeneration avoids the append-duplication bug class (same rationale as Phase-2 `reconcile`) | High |
| P3.3 | Lessons = inferred (pushback marker) + explicit, generalizable-gated | balances the "lessons are lost" gap against noise; reuses the Phase-1 salient-marker mechanism | High |
| P3.4 | Lesson→pref distill-time split (lesson logs incident, generalizable rule upserts prefs) | closes the loop (you stop re-teaching) without fragile fuzzy recurrence-clustering | High |
| P3.5 | Preference dedup via LLM full-set rewrite (distiller given current set) | matches the existing distiller pattern; avoids a bespoke structured merge engine; no-op guard prevents churn | Medium |
| P3.6 | Approach A: lesson/preference as kinds + separate dailyNote synthesis module | smallest blast radius; reuses observer/distiller/router/lock/rollup/recall; mirrors Phase-2 capture-vs-synthesis split | High |

## 11. Phasing

- **P3 (this spec):** modules §4, entrypoint/skill extensions §5, vault layout §3, tests §8. Independently shippable; delivers automatic daily journaling + learned, auto-applied preferences + durable lessons. `package.json` → `0.3.0`.
- **Later (separate spec→plan→review):** repo code-structure / per-repo knowledge graph. Independent of P2.1 (calibrated vector threshold, auto-MOC).

## References

- Builds on `docs/superpowers/specs/2026-05-19-superbrain-design.md` (Phase 1) and `docs/superpowers/specs/2026-05-19-superbrain-phase2-design.md` (Phase 2 SessionStart digest block, capture-vs-synthesis separation, stub seams).
- Phase 1 salient-marker mechanism (observer) — extended here with the pushback marker.
- Phase 2 idempotent `reconcile` self-heal pattern — reused as the dailyNote regeneration contract.
