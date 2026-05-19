# SuperBrain Phase 3 — Personalization & Journaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add daily journal notes, durable lessons, and an auto-applied preferences profile to the shipped SuperBrain plugin, with no new daemon/hook/MCP entrypoint.

**Architecture:** `lesson` and `preference` become new distilled kinds flowing through the existing observer→distiller→router→vaultWriter path; the daily note is an idempotent synthesis module (`dailyNote.ts`) regenerated from a per-day sidecar (`dailyState.ts`) on every distill and on the SessionStart rollup; preferences are injected via the extended Phase-2 SessionStart digest. SuperBrain never edits the user's `~/.claude/CLAUDE.md`.

**Tech Stack:** Node/TypeScript ESM (NodeNext — every relative import uses an explicit `.js` extension), vitest, gray-matter, the shipped Phase-1/2 modules (atomicWrite, frontmatter, router, vaultWriter, salience, indexer, recall).

**Conventions for every task:**
- Branch is `phase-3-personalization` (already checked out; never switch branches).
- Use ONLY plain Bash/Read/Edit/Write. Do NOT use any lean-ctx/`ctx_*` MCP tools — they mangle git/npm output and corrupt edits. Redirect large command output to a `/tmp` file and read it back.
- All relative imports in `src/`/`bin/` use explicit `.js` extensions (NodeNext).
- Commit author is fixed. Commit with:
  `git -c user.email=alex@weaviate.io -c user.name=alex commit -m "<subject>" -m "<body>" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"`
  (Use repeated `-m` flags — never a `$(cat <<EOF …)` heredoc; the shell wrapper mangles heredocs.)
- TDD: write the failing test, run it, see it fail for the right reason, implement minimally, run until green, commit.
- Spec: `docs/superpowers/specs/2026-05-19-superbrain-phase3-design.md`.

---

## File Structure

**New files:**
- `src/dailyState.ts` — per-day sidecar at `${dataDir}/daily/<date>.json`, keyed by `sessionId`; upsert + read.
- `src/dailyNote.ts` — `buildDailyNote(date)` → deterministic `{ relPath, frontmatter, body }`.
- `src/preferences.ts` — `compileInjectionBlock()` + `normalizeBody()`.
- Test files: `tests/dailyState.test.ts`, `tests/dailyNote.test.ts`, `tests/preferences.test.ts`, `tests/vaultWriterReplace.test.ts`, `tests/routerP3.test.ts`, `tests/saliencePushback.test.ts`, `tests/distillEnvelope.test.ts`, `tests/distillDaily.test.ts`, `tests/sessionStartPrefs.test.ts`, `tests/phase3Distiller.test.ts`, `tests/phase3E2E.test.ts`.

**Modified files:**
- `src/frontmatter.ts` — add `lesson`/`preference` to `VALID_TYPES`; exempt `preference` from status requirement.
- `src/router.ts` — `Kind` += `lesson|preference`; `DistilledItem.rule?`; `RouteResult.mode` += `replace`; new `route()` branches.
- `src/vaultWriter.ts` — `WriteArgs.mode` += `replace`; implement replace + no-op-on-unchanged.
- `src/salience.ts` — `SalientMarker.reason` += `pushback`; detect pushback prompts.
- `bin/sb-distill.ts` — envelope parsing (back-compat) + dailyState/dailyNote integration (delta + rollup) + read current preferences into the prompt.
- `bin/sb-session-start.ts` — extend the digest block with the compiled preferences + today's open threads.
- `skills/superbrain-distill/SKILL.md` — document the envelope contract + new kinds.
- `package.json` — version `0.3.0` (final task).
- `README.md` — Phase 3 shipped (final task).

---

### Task 1: `frontmatter.ts` — allow `lesson` & `preference` types

**Files:**
- Modify: `src/frontmatter.ts:3-4,16`
- Test: `tests/frontmatterP3.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/frontmatterP3.test.ts`:
```ts
import { it, expect } from "vitest";
import { validateFrontmatter } from "../src/frontmatter";

it("accepts lesson with status and preference without status", () => {
  expect(validateFrontmatter({ type: "lesson", status: "active", created: "2026-05-19" })).toEqual([]);
  expect(validateFrontmatter({ type: "preference", created: "2026-05-19" })).toEqual([]);
});

it("still rejects unknown type and missing status on status-required types", () => {
  expect(validateFrontmatter({ type: "bogus" }).length).toBeGreaterThan(0);
  expect(validateFrontmatter({ type: "decision" }).some((e) => e.includes("status"))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frontmatterP3.test.ts 2>&1 | tee /tmp/p3t1.txt`
Expected: FAIL — `lesson`/`preference` not in `VALID_TYPES`.

- [ ] **Step 3: Implement**

In `src/frontmatter.ts` replace lines 3-4:
```ts
const VALID_TYPES = ["project", "person", "decision", "capture", "daily", "map", "summary", "lesson", "preference"];
const VALID_STATUS = ["active", "paused", "done", "archived"];
```
Replace line 16 (the status-exemption list) so `preference` (like `daily`/`map`/`summary`) needs no status:
```ts
  if (data.type && !["daily", "map", "summary", "preference"].includes(data.type)) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/frontmatterP3.test.ts 2>&1 | tee /tmp/p3t1.txt`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/frontmatter.ts tests/frontmatterP3.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p3): allow lesson/preference frontmatter types" -m "preference is status-exempt like daily/map/summary; lesson keeps status." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `vaultWriter.ts` — atomic `replace` mode with no-op-on-unchanged

**Files:**
- Modify: `src/vaultWriter.ts:10-44`
- Test: `tests/vaultWriterReplace.test.ts`

Replace overwrites the whole managed file (not the Phase-1 dated-append). It preserves the original `created`, sets `updated` to the note's own date, and **no-ops when the normalized body is unchanged** (so re-distillation never bumps mtime → no index churn).

- [ ] **Step 1: Write the failing test**

`tests/vaultWriterReplace.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { writeNote } from "../src/vaultWriter";
import { parseNote } from "../src/frontmatter";

beforeEach(() => {
  fs.rmSync("/tmp/sb-vwr", { recursive: true, force: true });
  process.env.SUPERBRAIN_VAULT = "/tmp/sb-vwr";
});

it("replace creates when absent", () => {
  const r = writeNote("meta/preferences.md", { frontmatter: { type: "preference", created: "2026-05-19", updated: "2026-05-19" }, body: "- a", mode: "replace" });
  expect(r.ok).toBe(true);
  expect(parseNote(fs.readFileSync("/tmp/sb-vwr/meta/preferences.md", "utf8")).content.trim()).toBe("- a");
});

it("replace overwrites (not appends) and preserves created", () => {
  writeNote("meta/preferences.md", { frontmatter: { type: "preference", created: "2026-05-01", updated: "2026-05-01" }, body: "- a", mode: "replace" });
  writeNote("meta/preferences.md", { frontmatter: { type: "preference", created: "2026-05-19", updated: "2026-05-19" }, body: "- b", mode: "replace" });
  const p = parseNote(fs.readFileSync("/tmp/sb-vwr/meta/preferences.md", "utf8"));
  expect(p.content).toContain("- b");
  expect(p.content).not.toContain("- a");
  expect(p.content).not.toMatch(/## \d{4}-\d\d-\d\d \d\d:\d\d/); // no dated-append section
  expect(p.data.created).toBe("2026-05-01"); // original created preserved
});

it("replace no-ops when normalized body unchanged (mtime stable)", () => {
  writeNote("meta/preferences.md", { frontmatter: { type: "preference", created: "2026-05-19", updated: "2026-05-19" }, body: "- a\n", mode: "replace" });
  const m1 = fs.statSync("/tmp/sb-vwr/meta/preferences.md").mtimeMs;
  const r = writeNote("meta/preferences.md", { frontmatter: { type: "preference", created: "2026-05-19", updated: "2026-05-20" }, body: "  - a  ", mode: "replace" });
  const m2 = fs.statSync("/tmp/sb-vwr/meta/preferences.md").mtimeMs;
  expect(r.ok).toBe(true);
  expect(m2).toBe(m1); // unchanged normalized body => no write
});

it("create/append modes still behave as before (regression guard)", () => {
  writeNote("projects/x.md", { frontmatter: { type: "project", status: "active", created: "2026-05-19" }, body: "first", mode: "create" });
  writeNote("projects/x.md", { frontmatter: { type: "project", status: "active", created: "2026-05-19" }, body: "second", mode: "append" });
  const c = fs.readFileSync("/tmp/sb-vwr/projects/x.md", "utf8");
  expect(c).toContain("first");
  expect(c).toContain("second");
  expect(c).toMatch(/## \d{4}-\d\d-\d\d \d\d:\d\d/); // dated append preserved
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vaultWriterReplace.test.ts 2>&1 | tee /tmp/p3t2.txt`
Expected: FAIL — `mode: "replace"` currently falls through to the append branch.

- [ ] **Step 3: Implement**

In `src/vaultWriter.ts` change the `WriteArgs` interface (lines 10-14) to:
```ts
export interface WriteArgs {
  frontmatter: Record<string, any>;
  body: string;
  mode: "create" | "append" | "replace";
}
```
Add this helper just below `resolveSafe` (after line 24):
```ts
const normBody = (s: string): string => s.replace(/\s+/g, " ").trim();
```
In `writeNote`, insert the replace branch **before** the existing `const existing = readWithChecksum(abs);` line (i.e., between line 30 and line 32) so create/append are untouched:
```ts
  if (args.mode === "replace") {
    const cur = readWithChecksum(abs);
    if (cur) {
      const prev = parseNote(cur.content);
      if (normBody(prev.content) === normBody(args.body)) return { ok: true, path: abs };
      const fm = { ...args.frontmatter, created: prev.data.created ?? args.frontmatter.created };
      atomicWrite(abs, serializeNote(fm, args.body));
      return { ok: true, path: abs };
    }
    atomicWrite(abs, serializeNote(args.frontmatter, args.body));
    return { ok: true, path: abs };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/vaultWriterReplace.test.ts 2>&1 | tee /tmp/p3t2.txt`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/vaultWriter.ts tests/vaultWriterReplace.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p3): vaultWriter replace mode with no-op-on-unchanged" -m "Preserves original created; overwrites instead of dated-append; skips write when normalized body is unchanged so reconcile never re-embeds." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `router.ts` — `lesson` & `preference` routes

**Files:**
- Modify: `src/router.ts:1-16,26-50`
- Test: `tests/routerP3.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/routerP3.test.ts`:
```ts
import { it, expect } from "vitest";
import { route } from "../src/router";

it("routes a lesson to lessons/ as create with Why and Rule", () => {
  const r = route({ kind: "lesson", title: "Prefer integration tests", body: "User reverted unit-only test.", rule: "Default to integration tests over unit.", date: "2026-05-19", links: ["SuperBrain"] });
  expect(r.relPath).toBe("lessons/2026-05-19-prefer-integration-tests.md");
  expect(r.mode).toBe("create");
  expect(r.frontmatter.type).toBe("lesson");
  expect(r.frontmatter.status).toBe("active");
  expect(r.body).toContain("**Why:**");
  expect(r.body).toContain("**Rule:** Default to integration tests over unit.");
  expect(r.body).toContain("[[SuperBrain]]");
});

it("lesson without rule omits the Rule line", () => {
  const r = route({ kind: "lesson", title: "X", body: "incident", date: "2026-05-19", links: [] });
  expect(r.body).not.toContain("**Rule:**");
});

it("routes a preference to meta/preferences.md as replace, body is the item body verbatim", () => {
  const doc = "## Code\n- No inline comments\n\n## Tests\n- Integration over unit";
  const r = route({ kind: "preference", title: "preferences", body: doc, date: "2026-05-19", links: [] });
  expect(r.relPath).toBe("meta/preferences.md");
  expect(r.mode).toBe("replace");
  expect(r.frontmatter.type).toBe("preference");
  expect(r.frontmatter.status).toBeUndefined();
  expect(r.body).toBe(doc);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/routerP3.test.ts 2>&1 | tee /tmp/p3t3.txt`
Expected: FAIL — `lesson`/`preference` not in `Kind`; routes fall to the `capture` default.

- [ ] **Step 3: Implement**

In `src/router.ts` replace lines 1-16 with:
```ts
export type Kind = "decision" | "project_fact" | "person" | "gotcha" | "capture" | "lesson" | "preference";
export interface DistilledItem {
  kind: Kind;
  title: string;
  body: string;
  date: string;            // YYYY-MM-DD
  links: string[];
  project?: string;
  person?: string;
  rule?: string;           // crisp durable rule for a generalizable lesson
}
export interface RouteResult {
  relPath: string;
  frontmatter: Record<string, any>;
  body: string;
  mode: "create" | "append" | "replace";
}
```
In the `switch (item.kind)` block, add these two cases immediately before `default:` (after the `gotcha` case ends at line 44):
```ts
    case "lesson": {
      const why = `**Why:** ${item.body}`;
      const ruleLine = item.rule ? `\n\n**Rule:** ${item.rule}` : "";
      return { relPath: `lessons/${item.date}-${slug(item.title)}.md`,
        frontmatter: { type: "lesson", status: "active", ...base },
        body: withLinks(`# ${item.title}\n\n${why}${ruleLine}`, item.links), mode: "create" };
    }
    case "preference":
      return { relPath: `meta/preferences.md`,
        frontmatter: { type: "preference", ...base },
        body: item.body, mode: "replace" };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/routerP3.test.ts 2>&1 | tee /tmp/p3t3.txt`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/router.ts tests/routerP3.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p3): route lesson and preference kinds" -m "lesson -> lessons/DATE-slug.md (create, Why+Rule); preference -> meta/preferences.md (replace, body verbatim = full reconciled doc)." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `salience.ts` — pushback salient marker

**Files:**
- Modify: `src/salience.ts:6-12,29-58`
- Test: `tests/saliencePushback.test.ts`

The observer flags a prompt as pushback when the user negates/redirects/reverts, or uses an explicit cue. This only *flags* the turn; the generalizability judgment is the distiller's.

- [ ] **Step 1: Write the failing test**

`tests/saliencePushback.test.ts`:
```ts
import { it, expect } from "vitest";
import { initState, scoreEvent } from "../src/salience";

const ev = (prompt: string) => ({ type: "prompt" as const, cwd: "/p", prompt });

it("flags pushback prompts", () => {
  for (const p of ["No, don't do that", "revert that change", "that's wrong", "actually, use X instead", "lesson: always run the suite"]) {
    const r = scoreEvent(initState(), ev(p));
    expect(r.pending).toBe(true);
    expect(r.marker?.reason).toBe("pushback");
  }
});

it("does not flag neutral prompts", () => {
  const r = scoreEvent(initState(), ev("Add a new endpoint for users"));
  expect(r.pending).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/saliencePushback.test.ts 2>&1 | tee /tmp/p3t4.txt`
Expected: FAIL — no pushback detection.

- [ ] **Step 3: Implement**

In `src/salience.ts` change the `reason` union (line 7) to:
```ts
  reason: "write_threshold" | "git_commit" | "cwd_switch" | "file_churn" | "pushback";
```
Add this constant after line 23 (`const WRITE_TOOLS = …`):
```ts
const PUSHBACK_RE = /\b(no,|don'?t|do not|stop|revert|undo|that'?s wrong|not what i|use .* instead|actually,|why did you)\b|(^|\s)lesson:/i;
```
In `scoreEvent`, add this block immediately after the `mk` closure is defined and before the `cwd_switch` check (i.e., right after line 38, before line 40 `if (state.lastCwd && …`):
```ts
  if (e.type === "prompt" && PUSHBACK_RE.test(e.prompt || "")) {
    next.lastCwd = e.cwd || state.lastCwd;
    return { pending: true, marker: mk("pushback"), state: next };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/saliencePushback.test.ts tests/salience.test.ts 2>&1 | tee /tmp/p3t4.txt`
Expected: PASS — new pushback tests pass AND the existing `tests/salience.test.ts` stays green (the pushback check is prompt-only and returns before the write/cwd logic, so tool-event scoring is unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/salience.ts tests/saliencePushback.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p3): pushback salient marker" -m "Flags user negation/redirection/revert and explicit 'lesson:' cues so the distiller sees the turn; generalizability judgment stays in the distiller." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `src/dailyState.ts` — per-day sidecar (upsert by sessionId)

**Files:**
- Create: `src/dailyState.ts`
- Test: `tests/dailyState.test.ts`

Sidecar lives in the data dir (NOT the vault, so it is never indexed/walked). One JSON file per date; entries keyed by `sessionId` so a rollup catch-up re-distilling a session overwrites (never duplicates) its contribution.

- [ ] **Step 1: Write the failing test**

`tests/dailyState.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { upsertDay, readDay, type DaySessionEntry } from "../src/dailyState";

beforeEach(() => {
  fs.rmSync("/tmp/sb-ds", { recursive: true, force: true });
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-ds";
});

const entry = (over: Partial<DaySessionEntry> = {}): DaySessionEntry =>
  ({ digestLine: "did things", routedRelPaths: ["decisions/a.md"], alsoDid: ["debugged X"], openThreads: ["finish Y"], ...over });

it("upserts and reads back, keyed by sessionId", () => {
  upsertDay("2026-05-19", "S1", entry());
  upsertDay("2026-05-19", "S2", entry({ digestLine: "s2" }));
  const d = readDay("2026-05-19");
  expect(Object.keys(d)).toEqual(["S1", "S2"]);
  expect(d.S2.digestLine).toBe("s2");
});

it("re-upserting the same session overwrites (no duplication)", () => {
  upsertDay("2026-05-19", "S1", entry({ routedRelPaths: ["a.md"] }));
  upsertDay("2026-05-19", "S1", entry({ routedRelPaths: ["a.md", "b.md"] }));
  const d = readDay("2026-05-19");
  expect(Object.keys(d)).toEqual(["S1"]);
  expect(d.S1.routedRelPaths).toEqual(["a.md", "b.md"]);
});

it("readDay returns {} for an unknown date", () => {
  expect(readDay("2099-01-01")).toEqual({});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dailyState.test.ts 2>&1 | tee /tmp/p3t5.txt`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/dailyState.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";

export interface DaySessionEntry {
  digestLine: string;
  routedRelPaths: string[];
  alsoDid: string[];
  openThreads: string[];
}
export type DayState = Record<string, DaySessionEntry>;

function fileFor(date: string): string {
  return path.join(dataDir(), "daily", `${date}.json`);
}

export function readDay(date: string): DayState {
  try { return JSON.parse(fs.readFileSync(fileFor(date), "utf8")) as DayState; }
  catch { return {}; }
}

export function upsertDay(date: string, sessionId: string, entry: DaySessionEntry): void {
  const f = fileFor(date);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const cur = readDay(date);
  cur[sessionId] = entry;
  fs.writeFileSync(f, JSON.stringify(cur));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dailyState.test.ts 2>&1 | tee /tmp/p3t5.txt`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/dailyState.ts tests/dailyState.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p3): per-day sidecar keyed by sessionId" -m "Lives in dataDir (never indexed); session re-distill overwrites its entry so daily aggregation cannot double-count." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `src/dailyNote.ts` — deterministic, idempotent daily note

**Files:**
- Create: `src/dailyNote.ts`
- Test: `tests/dailyNote.test.ts`

`buildDailyNote(date)` composes the hybrid note from the sidecar only — **no `new Date()` / now-stamps anywhere** (so re-running with the same sidecar yields a byte-identical note and the Task-2 no-op guard holds).

- [ ] **Step 1: Write the failing test**

`tests/dailyNote.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { upsertDay } from "../src/dailyState";
import { buildDailyNote } from "../src/dailyNote";

beforeEach(() => {
  fs.rmSync("/tmp/sb-dn", { recursive: true, force: true });
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-dn";
});

it("merges sessions into a hybrid note (links, not bodies)", () => {
  upsertDay("2026-05-19", "S1", { digestLine: "Shipped Phase 2", routedRelPaths: ["decisions/2026-05-19-x.md"], alsoDid: ["reviewed PRs"], openThreads: ["Phase 3 spec"] });
  upsertDay("2026-05-19", "S2", { digestLine: "Designed Phase 3", routedRelPaths: ["projects/superbrain.md"], alsoDid: [], openThreads: [] });
  const r = buildDailyNote("2026-05-19");
  expect(r.relPath).toBe("daily/2026-05-19.md");
  expect(r.mode).toBe("replace");
  expect(r.frontmatter).toEqual({ type: "daily", created: "2026-05-19", updated: "2026-05-19" });
  expect(r.body).toContain("# 2026-05-19");
  expect(r.body).toContain("## Summary");
  expect(r.body).toContain("Shipped Phase 2");
  expect(r.body).toContain("Designed Phase 3");
  expect(r.body).toContain("## Decisions & gotchas");
  expect(r.body).toContain("[[decisions/2026-05-19-x]]");
  expect(r.body).toContain("[[projects/superbrain]]");
  expect(r.body).toContain("## Also did");
  expect(r.body).toContain("reviewed PRs");
  expect(r.body).toContain("## Threads open");
  expect(r.body).toContain("Phase 3 spec");
});

it("is idempotent (same sidecar => byte-identical body)", () => {
  upsertDay("2026-05-19", "S1", { digestLine: "d", routedRelPaths: ["a.md"], alsoDid: ["x"], openThreads: ["y"] });
  expect(buildDailyNote("2026-05-19").body).toBe(buildDailyNote("2026-05-19").body);
});

it("empty day yields a minimal valid note", () => {
  const r = buildDailyNote("2026-05-19");
  expect(r.body).toContain("# 2026-05-19");
  expect(r.frontmatter.type).toBe("daily");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dailyNote.test.ts 2>&1 | tee /tmp/p3t6.txt`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/dailyNote.ts`:
```ts
import { readDay } from "./dailyState.js";

export interface DailyResult {
  relPath: string;
  frontmatter: Record<string, any>;
  body: string;
  mode: "replace";
}

const wl = (rel: string) => `[[${rel.replace(/\.md$/, "")}]]`;

export function buildDailyNote(date: string): DailyResult {
  const day = readDay(date);
  const sessions = Object.keys(day).sort();          // deterministic order
  const digests: string[] = [];
  const links: string[] = [];
  const alsoDid: string[] = [];
  const threads: string[] = [];
  for (const s of sessions) {
    const e = day[s];
    if (e.digestLine) digests.push(e.digestLine.trim());
    for (const p of e.routedRelPaths) if (!links.includes(p)) links.push(p);
    for (const a of e.alsoDid) if (a && !alsoDid.includes(a)) alsoDid.push(a);
    for (const t of e.openThreads) if (t && !threads.includes(t)) threads.push(t);
  }
  const sec = (h: string, lines: string[]) =>
    `## ${h}\n\n` + (lines.length ? lines.map((l) => `- ${l}`).join("\n") : "_none_") + "\n";
  const body = [
    `# ${date}`,
    "",
    `## Summary\n\n${digests.length ? digests.map((d) => `- ${d}`).join("\n") : "_none_"}`,
    "",
    sec("Decisions & gotchas", links.map(wl)),
    sec("Also did", alsoDid),
    sec("Threads open", threads),
  ].join("\n").replace(/\n+$/, "") + "\n";
  return { relPath: `daily/${date}.md`, frontmatter: { type: "daily", created: date, updated: date }, body, mode: "replace" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dailyNote.test.ts 2>&1 | tee /tmp/p3t6.txt`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/dailyNote.ts tests/dailyNote.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p3): deterministic idempotent daily note builder" -m "Hybrid digest+linked-index+also-did+threads from the sidecar only; sorted sessions, no now-stamps => byte-identical re-runs." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `src/preferences.ts` — SessionStart injection block

**Files:**
- Create: `src/preferences.ts`
- Test: `tests/preferences.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/preferences.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { compileInjectionBlock } from "../src/preferences";

beforeEach(() => {
  fs.rmSync("/tmp/sb-pref", { recursive: true, force: true });
  process.env.SUPERBRAIN_VAULT = "/tmp/sb-pref";
});

it("returns '' when preferences.md is absent", () => {
  expect(compileInjectionBlock()).toBe("");
});

it("compiles a compact block from preferences.md body", () => {
  fs.mkdirSync("/tmp/sb-pref/meta", { recursive: true });
  fs.writeFileSync("/tmp/sb-pref/meta/preferences.md",
    "---\ntype: preference\ncreated: 2026-05-19\n---\n\n## Code\n- No inline comments\n\n## Tests\n- Integration over unit\n");
  const b = compileInjectionBlock();
  expect(b).toContain("Your preferences (SuperBrain)");
  expect(b).toContain("No inline comments");
  expect(b).toContain("Integration over unit");
});

it("returns '' for an empty/whitespace body", () => {
  fs.mkdirSync("/tmp/sb-pref/meta", { recursive: true });
  fs.writeFileSync("/tmp/sb-pref/meta/preferences.md", "---\ntype: preference\n---\n\n   \n");
  expect(compileInjectionBlock()).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/preferences.test.ts 2>&1 | tee /tmp/p3t7.txt`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/preferences.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { vaultPath } from "./paths.js";
import { parseNote } from "./frontmatter.js";

export function preferencesPath(): string {
  return path.join(vaultPath(), "meta", "preferences.md");
}

export function normalizeBody(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function compileInjectionBlock(): string {
  let raw: string;
  try { raw = fs.readFileSync(preferencesPath(), "utf8"); } catch { return ""; }
  const body = parseNote(raw).content.trim();
  if (!body) return "";
  return `--- Your preferences (SuperBrain) ---\n${body}\n-------------------------------------`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/preferences.test.ts 2>&1 | tee /tmp/p3t7.txt`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/preferences.ts tests/preferences.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p3): preferences injection-block compiler" -m "Reads meta/preferences.md body into a compact SessionStart block; '' when absent/empty. normalizeBody exported for the no-op guard parity." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `sb-distill.ts` — distiller envelope parsing (back-compatible)

**Files:**
- Modify: `bin/sb-distill.ts:15-27,36-48`
- Test: `tests/distillEnvelope.test.ts`

The distiller output becomes `{ items, digest?, openThreads?, alsoDid? }`. A bare array is treated as `{ items: array }` so the existing `tests/distill.test.ts` (bare-array stub) stays green.

- [ ] **Step 1: Write the failing test**

`tests/distillEnvelope.test.ts`:
```ts
import { it, expect } from "vitest";
import { parseEnvelope } from "../bin/sb-distill";

it("treats a bare array as { items }", () => {
  const e = parseEnvelope(JSON.stringify([{ kind: "decision", title: "x", body: "y", date: "2026-05-19", links: [] }]));
  expect(e.items.length).toBe(1);
  expect(e.digest).toBeUndefined();
  expect(e.openThreads).toEqual([]);
  expect(e.alsoDid).toEqual([]);
});

it("parses an envelope object", () => {
  const e = parseEnvelope(JSON.stringify({ items: [{ kind: "lesson", title: "L", body: "b", date: "2026-05-19", links: [], rule: "R" }], digest: "did things", openThreads: ["t"], alsoDid: ["a"] }));
  expect(e.items[0].kind).toBe("lesson");
  expect(e.digest).toBe("did things");
  expect(e.openThreads).toEqual(["t"]);
  expect(e.alsoDid).toEqual(["a"]);
});

it("tolerates junk -> empty envelope", () => {
  expect(parseEnvelope("not json")).toEqual({ items: [], openThreads: [], alsoDid: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/distillEnvelope.test.ts 2>&1 | tee /tmp/p3t8.txt`
Expected: FAIL — `parseEnvelope` is not exported.

- [ ] **Step 3: Implement**

In `bin/sb-distill.ts`, add the `DistilledEnvelope` type + `parseEnvelope` export directly after the imports (after line 13), and refactor `getItems`/`getRollupItems` to use it. Replace lines 15-27 with:
```ts
export interface DistilledEnvelope {
  items: DistilledItem[];
  digest?: string;
  openThreads: string[];
  alsoDid: string[];
}

export function parseEnvelope(raw: string): DistilledEnvelope {
  let v: any;
  try {
    const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    v = JSON.parse(m ? m[0] : raw);
  } catch { return { items: [], openThreads: [], alsoDid: [] }; }
  if (Array.isArray(v)) return { items: v as DistilledItem[], openThreads: [], alsoDid: [] };
  return {
    items: Array.isArray(v.items) ? v.items as DistilledItem[] : [],
    digest: typeof v.digest === "string" ? v.digest : undefined,
    openThreads: Array.isArray(v.openThreads) ? v.openThreads : [],
    alsoDid: Array.isArray(v.alsoDid) ? v.alsoDid : [],
  };
}

function getEnvelope(deltaJson: string): DistilledEnvelope {
  const stub = process.env.SUPERBRAIN_DISTILL_STUB;
  if (stub) return parseEnvelope(fs.readFileSync(stub, "utf8"));
  const prompt =
    "You are SuperBrain's distiller. Given this JSON array of session events and " +
    "salient markers (including 'pushback' markers), output ONLY a JSON object: " +
    '{"items":[{kind:"decision|project_fact|person|gotcha|capture|lesson|preference",' +
    "title,body,date(YYYY-MM-DD),links:[],project?,person?,rule?}]," +
    '"digest"?:string,"openThreads"?:[string],"alsoDid"?:[string]}. ' +
    "Emit a lesson ONLY if the pushback implies a generalizable rule (skip one-off " +
    "fixes); a generalizable lesson sets rule and ALSO emits exactly one preference " +
    "item whose body is the FULL reconciled preferences doc (you are given the current " +
    "one below). Skip ephemeral noise. Events:\n" + deltaJson;
  const out = execFileSync("claude", ["-p", prompt], { encoding: "utf8" });
  return parseEnvelope(out);
}
```
Then change the delta path in `main()` (line 95) from `const items = getItems(...)` to:
```ts
    const env = getEnvelope(JSON.stringify(events));
    const items = env.items;
```
And in `getRollupItems` (lines 36-48), replace its body so it returns items via `parseEnvelope` (keep the same function name and signature `(logContent, key) => DistilledItem[]`):
```ts
function getRollupItems(logContent: string, key: string): DistilledItem[] {
  const stub = process.env.SUPERBRAIN_DISTILL_STUB;
  if (stub) return parseEnvelope(fs.readFileSync(stub, "utf8")).items;
  const prompt =
    `You are SuperBrain's daily rollup synthesizer. Given this activity log for ${key}, ` +
    'output ONLY a JSON object {"items":[{"kind":"capture","title":"Daily ' + key + '",' +
    `"body":"<synthesis>","date":"${key}","links":[]}]}. Activity log:\n` + logContent;
  const out = execFileSync("claude", ["-p", prompt], { encoding: "utf8" });
  return parseEnvelope(out).items;
}
```
Delete the now-unused old `getItems` function (old lines 15-27 are replaced above; ensure no `getItems` reference remains — `main()` now uses `getEnvelope`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/distillEnvelope.test.ts tests/distill.test.ts tests/distillRollup.test.ts tests/distillIndex.test.ts 2>&1 | tee /tmp/p3t8.txt`
Expected: PASS — new envelope tests pass AND existing distill/distillRollup/distillIndex tests stay green (their bare-array stubs are parsed as `{ items }`).

- [ ] **Step 5: Commit**

```bash
git add bin/sb-distill.ts tests/distillEnvelope.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p3): distiller envelope parsing (back-compatible)" -m "Output is { items, digest?, openThreads?, alsoDid? }; a bare array is treated as { items } so existing stubs/tests stay green. Prompt updated for new kinds + generalizability gate." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `sb-distill.ts` — dailyState upsert + daily note write (delta path)

**Files:**
- Modify: `bin/sb-distill.ts` (imports; `main()` after the route loop)
- Test: `tests/distillDaily.test.ts`

After routing, record this session's contribution and (re)write its daily note. Non-fatal, exactly like the Phase-2 `indexNote` integration.

- [ ] **Step 1: Write the failing test**

`tests/distillDaily.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-dd", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-dd-vault", { recursive: true, force: true });
});

it("writes a daily note aggregating the session's routed items + envelope fields", () => {
  fs.mkdirSync("/tmp/sb-dd/sessions", { recursive: true });
  fs.writeFileSync("/tmp/sb-dd/sessions/S.ndjson",
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  const stub = "/tmp/sb-dd/stub.json";
  fs.writeFileSync(stub, JSON.stringify({
    items: [{ kind: "decision", title: "Pick X", body: "why", date: "2026-05-19", links: [] }],
    digest: "Chose X for the pipeline", openThreads: ["wire Y"], alsoDid: ["cleaned logs"],
  }));
  fs.mkdirSync("/tmp/sb-dd/locks/distill.lock", { recursive: true });

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-dd", SUPERBRAIN_VAULT: "/tmp/sb-dd-vault",
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });

  const daily = fs.readFileSync("/tmp/sb-dd-vault/daily/2026-05-19.md", "utf8");
  expect(daily).toContain("# 2026-05-19");
  expect(daily).toContain("Chose X for the pipeline");
  expect(daily).toContain("[[decisions/2026-05-19-pick-x]]");
  expect(daily).toContain("wire Y");
  expect(daily).toContain("cleaned logs");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/distillDaily.test.ts 2>&1 | tee /tmp/p3t9.txt`
Expected: FAIL — no `daily/` note is written.

- [ ] **Step 3: Implement**

In `bin/sb-distill.ts` add to the imports (after line 13 `import { indexNote } …`):
```ts
import { upsertDay } from "../src/dailyState.js";
import { buildDailyNote } from "../src/dailyNote.js";
```
In `main()`, after Task 8 the relevant region reads:
```ts
    const env = getEnvelope(JSON.stringify(events));
    const items = env.items;
    for (const it of items) { … route/write/index … }
    writeCursor(sid, newOffset);
```
`env` is a `const` in `main()` scope, so the daily block can reference it directly — no carrier needed. Replace the loop region (from `for (const it of items) {` through `writeCursor(sid, newOffset);`) with:
```ts
    const routedByDate: Record<string, string[]> = {};
    for (const it of items) {
      const r = route(it);
      const res = writeNote(r.relPath, { frontmatter: r.frontmatter, body: r.body, mode: r.mode });
      if (res.ok) {
        appendLog(it.title || it.kind, r.relPath);
        try { await indexNote(r.relPath); } catch (e: any) { writeFailure(`index failed: ${e?.message || e}`); }
        (routedByDate[it.date] ||= []).push(r.relPath);
      }
    }
    // Daily journal: record this session's contribution + regenerate the note(s).
    try {
      const dates = Object.keys(routedByDate);
      const today = new Date().toISOString().slice(0, 10);
      for (const d of dates.length ? dates : [today]) {
        upsertDay(d, sid, {
          digestLine: env.digest || "",
          routedRelPaths: routedByDate[d] || [],
          alsoDid: env.alsoDid,
          openThreads: env.openThreads,
        });
        const dn = buildDailyNote(d);
        writeNote(dn.relPath, { frontmatter: dn.frontmatter, body: dn.body, mode: dn.mode });
        try { await indexNote(dn.relPath); } catch (e: any) { writeFailure(`index failed: ${e?.message || e}`); }
      }
    } catch (e: any) { writeFailure(`daily note failed: ${e?.message || e}`); }
    writeCursor(sid, newOffset);
```
(No `globalThis` carrier and no change to the Task-8 lines — `env` is already in scope.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/distillDaily.test.ts tests/distill.test.ts tests/distillIndex.test.ts 2>&1 | tee /tmp/p3t9.txt`
Expected: PASS — daily note written; existing distill/distillIndex tests still green (bare-array stub → `digest/openThreads/alsoDid` empty, daily note still written with just the routed link + a `_none_` Summary).

- [ ] **Step 5: Commit**

```bash
git add bin/sb-distill.ts tests/distillDaily.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p3): distiller writes the daily journal note (delta path)" -m "Upserts the per-session sidecar entry and regenerates daily/<date>.md (replace, non-fatal) per affected date; index the daily note like routed notes." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `sb-distill.ts` — rebuild the daily note on the rollup path

**Files:**
- Modify: `bin/sb-distill.ts` `mainRollup()` (lines 63-73)
- Test: `tests/distillRollupDaily.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/distillRollupDaily.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-rd", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-rd-vault", { recursive: true, force: true });
});

it("rollup path also regenerates the daily note for the rollup key", () => {
  fs.mkdirSync("/tmp/sb-rd-vault", { recursive: true });
  fs.writeFileSync("/tmp/sb-rd-vault/log.md", "## [2026-05-18 10:00] write | Did stuff | [[decisions/x]]\n");
  const stub = "/tmp/sb-rd/stub.json";
  fs.writeFileSync(stub, JSON.stringify({
    items: [{ kind: "capture", title: "Daily 2026-05-18", body: "synthesis", date: "2026-05-18", links: [] }],
    digest: "Rollup synthesis for the day",
  }));
  fs.mkdirSync("/tmp/sb-rd/locks/distill.lock", { recursive: true });

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-rd", SUPERBRAIN_VAULT: "/tmp/sb-rd-vault",
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "rollup-2026-05-18",
      SUPERBRAIN_ROLLUP: "daily:2026-05-18:v1", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });

  const daily = fs.readFileSync("/tmp/sb-rd-vault/daily/2026-05-18.md", "utf8");
  expect(daily).toContain("# 2026-05-18");
  expect(daily).toContain("Rollup synthesis for the day");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/distillRollupDaily.test.ts 2>&1 | tee /tmp/p3t10.txt`
Expected: FAIL — rollup path writes no `daily/` note.

- [ ] **Step 3: Implement**

In `bin/sb-distill.ts` `mainRollup()`, the items loop is at lines 64-71. Replace from `const items = getRollupItems(logContent, key);` through the end of the `for` loop with:
```ts
    const items = getRollupItems(logContent, key);
    const env = parseEnvelope(process.env.SUPERBRAIN_DISTILL_STUB
      ? fs.readFileSync(process.env.SUPERBRAIN_DISTILL_STUB, "utf8") : "{}");
    const routed: string[] = [];
    for (const it of items) {
      const r = route(it);
      const res = writeNote(r.relPath, { frontmatter: r.frontmatter, body: r.body, mode: r.mode });
      if (res.ok) {
        appendLog(it.title || it.kind, r.relPath);
        try { await indexNote(r.relPath); } catch (e: any) { writeFailure(`index failed: ${e?.message || e}`); }
        routed.push(r.relPath);
      }
    }
    try {
      upsertDay(key, `rollup-${key}`, {
        digestLine: env.digest || "", routedRelPaths: routed,
        alsoDid: env.alsoDid || [], openThreads: env.openThreads || [],
      });
      const dn = buildDailyNote(key);
      writeNote(dn.relPath, { frontmatter: dn.frontmatter, body: dn.body, mode: dn.mode });
      try { await indexNote(dn.relPath); } catch (e: any) { writeFailure(`index failed: ${e?.message || e}`); }
    } catch (e: any) { writeFailure(`daily note failed: ${e?.message || e}`); }
```
(`parseEnvelope`, `upsertDay`, `buildDailyNote` are already imported from Tasks 8-9. The non-stub rollup path passes `"{}"` → empty envelope; the rollup synthesis still appears via the routed `capture` note link and the digest when present.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/distillRollupDaily.test.ts tests/distillRollup.test.ts 2>&1 | tee /tmp/p3t10.txt`
Expected: PASS — rollup daily note written; existing `tests/distillRollup.test.ts` stays green.

- [ ] **Step 5: Commit**

```bash
git add bin/sb-distill.ts tests/distillRollupDaily.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p3): rollup path regenerates the daily note" -m "SessionStart catch-up rebuilds daily/<key>.md idempotently (sidecar keyed by rollup-<key>)." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `sb-session-start.ts` — inject preferences + today's open threads

**Files:**
- Modify: `bin/sb-session-start.ts:8-10,60-61`
- Test: `tests/sessionStartPrefs.test.ts`

Extend the Phase-2 digest block (do NOT duplicate it). Best-effort; recursion-guard / exit-0 untouched.

- [ ] **Step 1: Write the failing test**

`tests/sessionStartPrefs.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-ssp", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-ssp-vault", { recursive: true, force: true });
  fs.mkdirSync("/tmp/sb-ssp-vault/meta", { recursive: true });
  fs.writeFileSync("/tmp/sb-ssp-vault/meta/preferences.md",
    "---\ntype: preference\ncreated: 2026-05-19\n---\n\n## Code\n- No inline comments\n");
  const today = new Date().toISOString().slice(0, 10);
  fs.mkdirSync("/tmp/sb-ssp/daily", { recursive: true });
  fs.writeFileSync(`/tmp/sb-ssp/daily/${today}.json`,
    JSON.stringify({ S1: { digestLine: "d", routedRelPaths: [], alsoDid: [], openThreads: ["finish phase 3"] } }));
});

it("SessionStart injects compiled preferences and today's open threads", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-ssp", SUPERBRAIN_VAULT: "/tmp/sb-ssp-vault",
      SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
  expect(out).toMatch(/additionalContext/);
  expect(out).toContain("No inline comments");
  expect(out).toContain("finish phase 3");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sessionStartPrefs.test.ts 2>&1 | tee /tmp/p3t11.txt`
Expected: FAIL — prefs/threads not injected.

- [ ] **Step 3: Implement**

In `bin/sb-session-start.ts` add to imports (after line 10 `import { hybridRecall } …`):
```ts
import { compileInjectionBlock } from "../src/preferences.js";
import { readDay } from "../src/dailyState.js";
```
Immediately after the recall digest block's closing `} catch { /* recall is best-effort */ }` (line 60) and before the reconcile-spawn comment (line 62), insert:
```ts
    // Preferences + today's open threads (best-effort, never blocks startup).
    try {
      const pref = compileInjectionBlock();
      if (pref) parts.push(pref);
      const today = new Date().toISOString().slice(0, 10);
      const day = readDay(today);
      const threads: string[] = [];
      for (const s of Object.keys(day))
        for (const t of day[s].openThreads) if (t && !threads.includes(t)) threads.push(t);
      if (threads.length)
        parts.push("SuperBrain — open threads today:\n" + threads.map((t) => `- ${t}`).join("\n"));
    } catch { /* personalization is best-effort */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sessionStartPrefs.test.ts tests/sessionStartDigest.test.ts tests/sessionStart.test.ts tests/rollupConvergence.test.ts 2>&1 | tee /tmp/p3t11.txt`
Expected: PASS — new prefs/threads injection works AND the Phase-2 `sessionStartDigest`, Phase-1 `sessionStart`, and `rollupConvergence` tests stay green (the block is additive, best-effort, and runs only when `parts` is later flushed).

- [ ] **Step 5: Commit**

```bash
git add bin/sb-session-start.ts tests/sessionStartPrefs.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p3): SessionStart injects preferences + today's open threads" -m "Extends the Phase-2 digest block; best-effort try/catch; recursion-guard and exit-0 untouched; never edits user CLAUDE.md." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: distiller prompt — feed current preferences for reconciliation + SKILL.md

**Files:**
- Modify: `bin/sb-distill.ts` (`getEnvelope` prompt) , `skills/superbrain-distill/SKILL.md`
- Test: `tests/distillPrefReconcile.test.ts`

For real (non-stub) runs the distiller must be handed the **current** `meta/preferences.md` so it can return the full reconciled doc. (Stub tests bypass the prompt; this task makes the real path correct and documents the contract.)

- [ ] **Step 1: Write the failing test**

`tests/distillPrefReconcile.test.ts`:
```ts
import { it, expect } from "vitest";
import fs from "node:fs";

it("the distiller prompt construction includes current preferences when present", () => {
  const src = fs.readFileSync("bin/sb-distill.ts", "utf8");
  expect(src).toMatch(/preferencesPath|meta\/preferences\.md/);
  expect(src).toMatch(/Current preferences/);
});

it("SKILL.md documents the envelope contract and new kinds", () => {
  const s = fs.readFileSync("skills/superbrain-distill/SKILL.md", "utf8");
  expect(s).toMatch(/"items"/);
  expect(s).toMatch(/lesson/);
  expect(s).toMatch(/preference/);
  expect(s).toMatch(/openThreads/);
  expect(s).toMatch(/generaliz/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/distillPrefReconcile.test.ts 2>&1 | tee /tmp/p3t12.txt`
Expected: FAIL — prompt does not yet include current preferences; SKILL.md not updated.

- [ ] **Step 3: Implement**

In `bin/sb-distill.ts` add import (after the Task-9 imports):
```ts
import { preferencesPath } from "../src/preferences.js";
```
In `getEnvelope`, immediately before `const out = execFileSync("claude", ["-p", prompt], …)`, build the prompt with the current preferences appended:
```ts
  let curPrefs = "";
  try { curPrefs = fs.readFileSync(preferencesPath(), "utf8"); } catch { /* none yet */ }
  const fullPrompt = prompt + "\n\nCurrent preferences (reconcile, do not lose existing rules):\n" + (curPrefs || "(none)");
```
and change the exec line to use `fullPrompt`:
```ts
  const out = execFileSync("claude", ["-p", fullPrompt], { encoding: "utf8" });
```
Replace `skills/superbrain-distill/SKILL.md` body (keep the YAML frontmatter `name`/`description` lines 1-4) so the rules section reads:
```markdown
# SuperBrain Distiller

You are SuperBrain's distiller, running headless and detached. You receive session
events + salient markers (including `pushback` markers) and the current preferences.

Output **only** a JSON object:

```
{ "items": [ { "kind": "decision|project_fact|person|gotcha|capture|lesson|preference",
               "title": "...", "body": "...", "date": "YYYY-MM-DD",
               "links": ["WikiTarget"], "project": "?", "person": "?", "rule": "?" } ],
  "digest": "<=1 sentence of the session's arc",
  "openThreads": ["unfinished/deferred work"],
  "alsoDid": ["notable work that did not become a knowledge item"] }
```

Rules:
- decisions / project facts / gotchas / people: as before.
- **lesson**: emit ONLY when a `pushback` implies a rule that generalizes beyond the
  immediate edit (skip one-off local fixes). Set `rule` to the crisp durable rule.
- **Distill-time split**: a generalizable lesson ALSO emits exactly one `preference`
  item whose `body` is the COMPLETE reconciled preferences document — integrate the
  new rule into the current preferences (given below the events), dedupe, resolve
  contradictions newest-wins, group by area as `## Area` markdown headings. Never
  emit more than one preference item.
- `digest`, `openThreads`, `alsoDid` are envelope-level (not items).
- Skip transcript dumps and anything derivable from git/the code.
- Never write files yourself — output JSON only.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/distillPrefReconcile.test.ts 2>&1 | tee /tmp/p3t12.txt`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add bin/sb-distill.ts skills/superbrain-distill/SKILL.md tests/distillPrefReconcile.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p3): feed current preferences into the distiller + document envelope" -m "Real runs hand the distiller the current meta/preferences.md for full-set reconciliation; SKILL.md documents the envelope, new kinds, and the generalizability gate." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: end-to-end — pushback → lesson + preference → injected

**Files:**
- Test: `tests/phase3E2E.test.ts`

Proves the whole chain on the compiled-equivalent path: a distiller envelope with a lesson + paired preference is routed (lessons/ create, meta/preferences.md replace), indexed by the Phase-2 path, then surfaced at SessionStart.

- [ ] **Step 1: Write the failing test**

`tests/phase3E2E.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-e3", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-e3-vault", { recursive: true, force: true });
});

it("pushback session yields a lesson note + reconciled preferences, injected next start", () => {
  fs.mkdirSync("/tmp/sb-e3/sessions", { recursive: true });
  fs.writeFileSync("/tmp/sb-e3/sessions/S.ndjson",
    JSON.stringify({ type: "prompt", cwd: "/p", prompt: "No, stop adding inline comments" }) + "\n");
  const stub = "/tmp/sb-e3/stub.json";
  fs.writeFileSync(stub, JSON.stringify({
    items: [
      { kind: "lesson", title: "No inline comments", body: "User reverted commented code.", rule: "Do not add inline comments unless non-obvious.", date: "2026-05-19", links: [] },
      { kind: "preference", title: "preferences", body: "## Code\n- No inline comments unless non-obvious", date: "2026-05-19", links: [] },
    ],
    digest: "Learned a code-style preference", openThreads: [],
  }));
  fs.mkdirSync("/tmp/sb-e3/locks/distill.lock", { recursive: true });

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-e3", SUPERBRAIN_VAULT: "/tmp/sb-e3-vault",
      SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });

  expect(fs.existsSync("/tmp/sb-e3-vault/lessons/2026-05-19-no-inline-comments.md")).toBe(true);
  const pref = fs.readFileSync("/tmp/sb-e3-vault/meta/preferences.md", "utf8");
  expect(pref).toContain("No inline comments unless non-obvious");
  expect(pref).not.toMatch(/## \d{4}-\d\d-\d\d \d\d:\d\d/); // replace, not dated-append

  const out = execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S2", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-e3", SUPERBRAIN_VAULT: "/tmp/sb-e3-vault",
      SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });
  expect(out).toContain("No inline comments unless non-obvious");
});
```

- [ ] **Step 2: Run test to verify it fails / passes**

Run: `npx vitest run tests/phase3E2E.test.ts 2>&1 | tee /tmp/p3t13.txt`
Expected: PASS if Tasks 1-12 are correct. If it FAILS, fix the responsible task's code (do not weaken this test). This is the integration gate for the whole phase.

- [ ] **Step 3: Commit**

```bash
git add tests/phase3E2E.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "test(p3): end-to-end pushback -> lesson + preferences -> SessionStart inject" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Build, full suite, real-path E2E, version 0.3.0, README

**Files:**
- Modify: `package.json`, `README.md`

- [ ] **Step 1: Typecheck + build + full suite**

Run:
```bash
cd /Users/alex/Projects/Vibe/SuperBrain
npm run typecheck 2>&1 | tee /tmp/p3-tc.txt
npm run build 2>&1 | tee /tmp/p3-build.txt
npx vitest run 2>&1 | tee /tmp/p3-suite.txt
```
Expected: 0 TS errors; build OK; `dist/src/{dailyState,dailyNote,preferences}.js` present; ALL tests green (Phase 1 + 2 + 3). Record the exact "Tests M passed" count. If any pre-existing test regressed, STOP and report BLOCKED (do not weaken tests).

- [ ] **Step 2: Real-path E2E (compiled, stub embed only)**

Run:
```bash
cd /Users/alex/Projects/Vibe/SuperBrain
rm -rf /tmp/sbP3 /tmp/sbP3-vault && mkdir -p /tmp/sbP3/sessions
printf '%s\n' '{"type":"prompt","cwd":"/p","prompt":"No, do not add inline comments"}' > /tmp/sbP3/sessions/S.ndjson
printf '{"items":[{"kind":"lesson","title":"No inline comments","body":"reverted","rule":"No inline comments unless non-obvious","date":"2026-05-19","links":[]},{"kind":"preference","title":"preferences","body":"## Code\\n- No inline comments unless non-obvious","date":"2026-05-19","links":[]}],"digest":"style pref","openThreads":["ship phase 3"]}' > /tmp/sbP3/stub.json
mkdir -p /tmp/sbP3/locks/distill.lock
CLAUDE_PLUGIN_DATA=/tmp/sbP3 SUPERBRAIN_VAULT=/tmp/sbP3-vault SUPERBRAIN_DISTILL_STUB=/tmp/sbP3/stub.json SUPERBRAIN_SESSION_ID=S SUPERBRAIN_EMBED_STUB=1 node dist/bin/sb-distill.js
echo '{"session_id":"S2","hook_event_name":"SessionStart","source":"startup","cwd":"/p"}' | CLAUDE_PLUGIN_DATA=/tmp/sbP3 SUPERBRAIN_VAULT=/tmp/sbP3-vault SUPERBRAIN_FAKE_DISTILLER=1 SUPERBRAIN_EMBED_STUB=1 node dist/bin/sb-session-start.js
```
Expected: `lessons/2026-05-19-no-inline-comments.md`, `meta/preferences.md`, and `daily/2026-05-19.md` exist under `/tmp/sbP3-vault`; the final command prints JSON with `additionalContext` containing `No inline comments unless non-obvious` and `ship phase 3`. If not, STOP and report BLOCKED with `find /tmp/sbP3-vault -name '*.md'`.

- [ ] **Step 3: Version + README**

Set `"version": "0.3.0"` in `package.json` (edit only that line).
In `README.md`: change the Status badge `phase%202-search%20%26%20recall` → `phase%203-personalization`; set the Tests badge to the exact count from Step 1; under Features add:
```markdown
**Phase 3 — personalization & journaling (shipped, v0.3.0):**

- ✅ Daily notes — hybrid digest + linked index, idempotently regenerated per day
- ✅ Lessons — durable, generalizable rules learned from your pushback
- ✅ Preferences — a deduplicated profile auto-injected at SessionStart (never edits your `CLAUDE.md`)
```
and change the roadmap Phase-3 row status to `✅ Shipped (v0.3.0)`.

- [ ] **Step 4: Final commit**

```bash
git add package.json README.md
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "docs(p3): version 0.3.0 + README for Phase 3" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage**

| Phase-3 spec section | Task(s) |
|---|---|
| §2.1 prefs owned file + SessionStart inject, never edit CLAUDE.md | 7, 11 |
| §2.2 daily hybrid shape | 6, 9, 10 |
| §2.3 lesson detection (pushback marker + explicit, generalizable-gated) | 4, 8, 12 |
| §2.4 lesson→pref distill-time split | 8, 12, 13 |
| §2.5 Approach A (kinds + synthesis module) | 3, 5, 6, 9, 10 |
| §3 vault layout (lessons/preferences/daily paths + modes) | 2, 3, 6 |
| §4 dailyNote / dailyState / preferences modules | 5, 6, 7 |
| §4 router/vaultWriter/salience/frontmatter changes | 1, 2, 3, 4 |
| §5 distiller envelope + SKILL.md + sb-distill + sb-session-start | 8, 9, 10, 11, 12 |
| §7 error handling (non-fatal, atomic replace, no-op guard, sessionId upsert) | 2, 5, 9, 10, 11 |
| §8 testing (unit/integration/idempotency/Phase-1+2 green) | every task; 6 idempotency; 9/10/11 regression guards; 14 full suite |
| §9 no new deps | (none added in any task) |
| §11 version 0.3.0 | 14 |

No gap. `frontmatter.ts` `VALID_TYPES` (a real blocker the spec implied) is explicitly handled in Task 1.

**2. Placeholder scan:** No TBD/TODO. Every code step shows complete code; every test step shows the full test; every command has expected output.

**3. Type consistency:** `DistilledItem` gains `rule?` (Task 3) — consumed by `route()` lesson branch (Task 3) and emitted by the distiller prompt (Tasks 8, 12). `RouteResult.mode`/`WriteArgs.mode` both extended to `"create"|"append"|"replace"` (Tasks 2, 3) — consistent. `DistilledEnvelope { items, digest?, openThreads, alsoDid }` (Task 8) is referenced directly in `main()` scope by the Task-9 daily block (no carrier) and rebuilt via `parseEnvelope` in the Task-10 rollup block. `DaySessionEntry { digestLine, routedRelPaths, alsoDid, openThreads }` (Task 5) produced by Tasks 9/10 and consumed by `buildDailyNote` (Task 6) and the SessionStart threads block (Task 11) — fields match at every site. `compileInjectionBlock()`/`preferencesPath()`/`normalizeBody()` (Task 7) used by Tasks 11/12. `parseEnvelope`/`buildDailyNote`/`upsertDay`/`readDay` names are identical across Tasks 5-12.
