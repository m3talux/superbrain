# SuperBrain Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a globally-installed Claude Code plugin that automatically captures every session into a plain Obsidian markdown vault with smart routing and session-triggered daily/weekly/monthly rollups — the Phase-1 "capture spine" (fixes pains 1, 2, 3, 4, 6 from the spec).

**Architecture:** A continuous, no-LLM **observer** (PostToolUse/UserPromptSubmit hooks) appends events + deterministic `salient` markers to a per-session NDJSON log. At **checkpoints** (PreCompact/SessionEnd/Stop-if-pending) a single detached **distiller** (`claude -p` running the `superbrain-distill` skill), serialized by a lockfile, reads the NDJSON delta since a byte-offset cursor, and writes routed notes via an in-process **vault writer** (gray-matter + atomic write + dirty-file guard). Rollups run as an idempotent hash-checked **catch-up** on SessionStart/SessionEnd. No daemon, no installed scheduler, no API key required.

**Tech Stack:** Node ≥ 20, TypeScript (ESM), `tsc` build → `dist/`, `vitest` for tests, `gray-matter` for frontmatter. Zero runtime deps beyond `gray-matter`. Claude Code plugin + marketplace packaging.

---

## File Structure (decomposition locked here)

```
SuperBrain/
  .claude-plugin/plugin.json          # plugin manifest
  marketplace.json                    # marketplace manifest (repo root)
  package.json  tsconfig.json  vitest.config.ts
  hooks/hooks.json                    # lifecycle hook registrations
  skills/superbrain-distill/SKILL.md  # prompt the detached child runs
  src/
    paths.ts          # all filesystem path resolution (data dir, vault, session)
    ndjson.ts         # append events; read delta by byte offset
    cursor.ts         # per-session byte-offset cursor read/advance
    salience.ts       # deterministic scorer + salient-marker builder (pure)
    lockfile.ts       # atomic mkdir-based lock (zero-dep)
    sentinel.ts       # failure sentinel write / read-and-clear
    frontmatter.ts    # gray-matter wrapper + frontmatter validation
    atomicWrite.ts    # sha256, temp→fsync→rename, read-with-checksum
    vaultWriter.ts    # policy layer (allowlist, append-or-update, soft-delete, dirty guard)
    router.ts         # classify a distilled item → vault path/section/links (pure)
    rollupState.ts    # state.json: which {daily,weekly,monthly} keys compiled (by source hash)
    distillerEngine.ts# build the distiller spawn spec; recursion-guard helper
  bin/
    sb-observe.ts     # PostToolUse + UserPromptSubmit entry (fast, fs-only)
    sb-checkpoint.ts  # PreCompact/SessionEnd/Stop entry → copy transcript, spawn distiller under lock
    sb-distill.ts     # detached child: delta → claude -p → route → write → advance cursor
    sb-session-start.ts # SessionStart: surface sentinel + run rollup catch-up
    sb.ts             # CLI: install | migrate | recap | gc
  tests/*.test.ts
```

Each `src/*.ts` has one responsibility and is unit-tested in isolation. `bin/*.ts` are thin entrypoints wiring `src` modules to hook stdin/stdout; covered by fixture/integration tests.

---

## Conventions for every task

- Tests: `tests/<module>.test.ts`, run with `npx vitest run <path>`.
- Commit after every task with the message shown.
- ESM everywhere (`import`/`export`, `.js` extension in relative imports of compiled output is **not** needed because `tsconfig` uses `"moduleResolution":"Bundler"` and vitest resolves `.ts`).
- All filesystem writes go through `src/` modules — never raw `fs.writeFileSync` in `bin/` except the observer's hot path.

---

### Task 0: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `tests/smoke.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs the test harness", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Create project files**

`package.json`:
```json
{
  "name": "superbrain",
  "version": "0.1.0",
  "description": "Automatic Claude Code -> Obsidian second brain (capture spine)",
  "type": "module",
  "license": "MIT",
  "bin": { "superbrain": "dist/bin/sb.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "gray-matter": "^4.0.3" },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "engines": { "node": ">=20" }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "bin/**/*"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/**/*.test.ts"] } });
```

`.gitignore`:
```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 3: Install and run**

Run: `cd /Users/alex/Projects/Vibe/SuperBrain && npm install && npx vitest run tests/smoke.test.ts`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold SuperBrain Phase 1 (ts + vitest + gray-matter)"
```

---

### Task 1: `src/paths.ts` — path resolution

**Files:**
- Create: `src/paths.ts`, `tests/paths.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/paths.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as P from "../src/paths";

describe("paths", () => {
  beforeEach(() => {
    process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-test-data";
    process.env.SUPERBRAIN_VAULT = "/tmp/sb-test-vault";
  });
  it("derives data + vault + session paths", () => {
    expect(P.dataDir()).toBe("/tmp/sb-test-data");
    expect(P.vaultPath()).toBe("/tmp/sb-test-vault");
    expect(P.sessionNdjsonPath("abc")).toBe("/tmp/sb-test-data/sessions/abc.ndjson");
    expect(P.cursorPath("abc")).toBe("/tmp/sb-test-data/sessions/abc.cursor");
    expect(P.sentinelPath()).toBe("/tmp/sb-test-data/last-failure.txt");
    expect(P.rollupStatePath()).toBe("/tmp/sb-test-data/rollup-state.json");
    expect(P.lockDir("distill")).toBe("/tmp/sb-test-data/locks/distill.lock");
  });
  it("falls back to ~/.superbrain and ~/vault", () => {
    delete process.env.CLAUDE_PLUGIN_DATA;
    delete process.env.SUPERBRAIN_VAULT;
    expect(P.dataDir()).toMatch(/\.superbrain$/);
    expect(P.vaultPath()).toMatch(/(vault|Documents\/SuperBrain)$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/paths.test.ts`
Expected: FAIL (cannot find module `../src/paths`).

- [ ] **Step 3: Write minimal implementation**

`src/paths.ts`:
```ts
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function dataDir(): string {
  return process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), ".superbrain");
}
export function vaultPath(): string {
  if (process.env.SUPERBRAIN_VAULT) return process.env.SUPERBRAIN_VAULT;
  const legacy = path.join(os.homedir(), "vault");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(os.homedir(), "Documents", "SuperBrain");
}
function sessionsDir(): string { return path.join(dataDir(), "sessions"); }
export function sessionNdjsonPath(id: string): string { return path.join(sessionsDir(), `${id}.ndjson`); }
export function cursorPath(id: string): string { return path.join(sessionsDir(), `${id}.cursor`); }
export function sentinelPath(): string { return path.join(dataDir(), "last-failure.txt"); }
export function rollupStatePath(): string { return path.join(dataDir(), "rollup-state.json"); }
export function lockDir(name: string): string { return path.join(dataDir(), "locks", `${name}.lock`); }
export function ensureDir(p: string): void { fs.mkdirSync(p, { recursive: true }); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/paths.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/paths.ts tests/paths.test.ts
git commit -m "feat: path resolution (data dir, vault, session, locks)"
```

---

### Task 2: `src/ndjson.ts` — append events + read delta by offset

**Files:**
- Create: `src/ndjson.ts`, `tests/ndjson.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/ndjson.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { appendEvent, readDelta } from "../src/ndjson";

const SID = "sess1";
beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-ndjson";
  fs.rmSync("/tmp/sb-ndjson", { recursive: true, force: true });
});

describe("ndjson", () => {
  it("appends and reads full delta from offset 0", () => {
    appendEvent(SID, { t: "a" });
    appendEvent(SID, { t: "b" });
    const d = readDelta(SID, 0);
    expect(d.events).toEqual([{ t: "a" }, { t: "b" }]);
    expect(d.newOffset).toBeGreaterThan(0);
  });
  it("reads only events after a prior offset", () => {
    appendEvent(SID, { t: "a" });
    const first = readDelta(SID, 0);
    appendEvent(SID, { t: "b" });
    const d = readDelta(SID, first.newOffset);
    expect(d.events).toEqual([{ t: "b" }]);
  });
  it("returns empty when no file", () => {
    expect(readDelta("missing", 0)).toEqual({ events: [], newOffset: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ndjson.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/ndjson.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { sessionNdjsonPath } from "./paths";

export function appendEvent(sessionId: string, obj: unknown): void {
  const p = sessionNdjsonPath(sessionId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(obj) + "\n");
}

export function readDelta(sessionId: string, fromOffset: number): { events: any[]; newOffset: number } {
  const p = sessionNdjsonPath(sessionId);
  if (!fs.existsSync(p)) return { events: [], newOffset: 0 };
  const fd = fs.openSync(p, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (fromOffset >= size) return { events: [], newOffset: size };
    const len = size - fromOffset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, fromOffset);
    const events = buf.toString("utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((x) => x !== null);
    return { events, newOffset: size };
  } finally { fs.closeSync(fd); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ndjson.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/ndjson.ts tests/ndjson.test.ts
git commit -m "feat: ndjson append + offset-delta read (lossless capture substrate)"
```

---

### Task 3: `src/cursor.ts` — per-session byte cursor

**Files:**
- Create: `src/cursor.ts`, `tests/cursor.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/cursor.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { readCursor, writeCursor } from "../src/cursor";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-cursor";
  fs.rmSync("/tmp/sb-cursor", { recursive: true, force: true });
});

describe("cursor", () => {
  it("defaults to 0 then round-trips", () => {
    expect(readCursor("s")).toBe(0);
    writeCursor("s", 42);
    expect(readCursor("s")).toBe(42);
  });
  it("treats corrupt cursor as 0", () => {
    process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-cursor";
    writeCursor("s", 10);
    fs.writeFileSync("/tmp/sb-cursor/sessions/s.cursor", "garbage");
    expect(readCursor("s")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cursor.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/cursor.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { cursorPath } from "./paths";

export function readCursor(sessionId: string): number {
  try {
    const n = parseInt(fs.readFileSync(cursorPath(sessionId), "utf8").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch { return 0; }
}
export function writeCursor(sessionId: string, offset: number): void {
  const p = cursorPath(sessionId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, String(offset));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cursor.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/cursor.ts tests/cursor.test.ts
git commit -m "feat: per-session byte-offset cursor (idempotent resume)"
```

---

### Task 4: `src/salience.ts` — deterministic scorer + salient-marker builder

**Files:**
- Create: `src/salience.ts`, `tests/salience.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/salience.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { initState, scoreEvent } from "../src/salience";

describe("salience", () => {
  it("flags pending after N tool writes", () => {
    let s = initState();
    let pending = false;
    for (let i = 0; i < 5; i++) {
      const r = scoreEvent(s, { type: "tool", tool: "Write", file: `f${i}.ts`, cwd: "/p" });
      s = r.state; pending = pending || r.pending;
    }
    expect(pending).toBe(true);
  });
  it("flags pending + emits marker on git commit and resets write counter", () => {
    let s = initState();
    const r = scoreEvent(s, { type: "tool", tool: "Bash", command: "git commit -m x", cwd: "/p" });
    expect(r.pending).toBe(true);
    expect(r.marker).toMatchObject({ type: "salient", reason: "git_commit", cwd: "/p" });
  });
  it("flags pending + marker on cwd switch", () => {
    let s = initState();
    s = scoreEvent(s, { type: "tool", tool: "Read", file: "a", cwd: "/p1" }).state;
    const r = scoreEvent(s, { type: "tool", tool: "Read", file: "b", cwd: "/p2" });
    expect(r.pending).toBe(true);
    expect(r.marker?.reason).toBe("cwd_switch");
  });
  it("does not flag on a single read", () => {
    const r = scoreEvent(initState(), { type: "tool", tool: "Read", file: "a", cwd: "/p" });
    expect(r.pending).toBe(false);
    expect(r.marker).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/salience.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/salience.ts`:
```ts
export interface SalienceState {
  writesSinceNote: number;
  lastCwd: string | null;
}
export interface SalientMarker {
  type: "salient";
  reason: "write_threshold" | "git_commit" | "cwd_switch" | "file_churn";
  cwd: string;
  files: string[];
  prompt_excerpt: string;
  ts: string;
}
export interface ObsEvent {
  type: "tool" | "prompt";
  tool?: string;
  command?: string;
  file?: string;
  cwd: string;
  prompt?: string;
}

const WRITE_THRESHOLD = 5;
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "ctx_edit"]);

export function initState(): SalienceState {
  return { writesSinceNote: 0, lastCwd: null };
}

export function scoreEvent(
  state: SalienceState,
  e: ObsEvent
): { pending: boolean; marker?: SalientMarker; state: SalienceState } {
  const next: SalienceState = { ...state };
  const now = new Date().toISOString();
  const mk = (reason: SalientMarker["reason"]): SalientMarker => ({
    type: "salient", reason, cwd: e.cwd, files: e.file ? [e.file] : [],
    prompt_excerpt: (e.prompt || "").slice(0, 200), ts: now,
  });

  if (state.lastCwd && e.cwd && e.cwd !== state.lastCwd) {
    next.lastCwd = e.cwd; next.writesSinceNote = 0;
    return { pending: true, marker: mk("cwd_switch"), state: next };
  }
  next.lastCwd = e.cwd || state.lastCwd;

  if (e.type === "tool" && e.tool === "Bash" && /\bgit\s+commit\b/.test(e.command || "")) {
    next.writesSinceNote = 0;
    return { pending: true, marker: mk("git_commit"), state: next };
  }
  if (e.type === "tool" && e.tool && WRITE_TOOLS.has(e.tool)) {
    next.writesSinceNote = state.writesSinceNote + 1;
    if (next.writesSinceNote >= WRITE_THRESHOLD) {
      next.writesSinceNote = 0;
      return { pending: true, marker: mk("write_threshold"), state: next };
    }
  }
  return { pending: false, state: next };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/salience.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/salience.ts tests/salience.test.ts
git commit -m "feat: deterministic salience scorer + salient-marker builder (pain #2 anchor)"
```

---

### Task 5: `src/lockfile.ts` — atomic mkdir lock

**Files:**
- Create: `src/lockfile.ts`, `tests/lockfile.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/lockfile.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { acquireLock, releaseLock } from "../src/lockfile";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-lock";
  fs.rmSync("/tmp/sb-lock", { recursive: true, force: true });
});

describe("lockfile", () => {
  it("grants then blocks then re-grants after release", () => {
    expect(acquireLock("distill")).toBe(true);
    expect(acquireLock("distill")).toBe(false);
    releaseLock("distill");
    expect(acquireLock("distill")).toBe(true);
  });
  it("breaks a stale lock older than maxAgeMs", () => {
    expect(acquireLock("distill")).toBe(true);
    expect(acquireLock("distill", { maxAgeMs: -1 })).toBe(true); // any age is stale
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lockfile.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/lockfile.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { lockDir } from "./paths";

export function acquireLock(name: string, opts: { maxAgeMs?: number } = {}): boolean {
  const dir = lockDir(name);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
    return true;
  } catch {
    const maxAgeMs = opts.maxAgeMs ?? 15 * 60 * 1000;
    try {
      const age = Date.now() - fs.statSync(dir).mtimeMs;
      if (age > maxAgeMs) { releaseLock(name); fs.mkdirSync(dir); return true; }
    } catch { /* race: someone removed it */ }
    return false;
  }
}
export function releaseLock(name: string): void {
  fs.rmSync(lockDir(name), { recursive: true, force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lockfile.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lockfile.ts tests/lockfile.test.ts
git commit -m "feat: zero-dep atomic lock with stale-lock breaking (serializes distiller)"
```

---

### Task 6: `src/sentinel.ts` — failure sentinel

**Files:**
- Create: `src/sentinel.ts`, `tests/sentinel.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/sentinel.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { writeFailure, readAndClearFailure } from "../src/sentinel";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-sentinel";
  fs.rmSync("/tmp/sb-sentinel", { recursive: true, force: true });
});

describe("sentinel", () => {
  it("returns null when no failure", () => {
    expect(readAndClearFailure()).toBeNull();
  });
  it("stores then clears a failure exactly once", () => {
    writeFailure("distill auth failed");
    const got = readAndClearFailure();
    expect(got).toContain("distill auth failed");
    expect(readAndClearFailure()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sentinel.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/sentinel.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { sentinelPath } from "./paths";

export function writeFailure(message: string): void {
  const p = sentinelPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `[${new Date().toISOString()}] ${message}\n`);
}
export function readAndClearFailure(): string | null {
  const p = sentinelPath();
  try {
    const msg = fs.readFileSync(p, "utf8").trim();
    fs.rmSync(p, { force: true });
    return msg || null;
  } catch { return null; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sentinel.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/sentinel.ts tests/sentinel.test.ts
git commit -m "feat: failure sentinel (no silent death — surfaced on SessionStart)"
```

---

### Task 7: `src/frontmatter.ts` — gray-matter wrapper + validation

**Files:**
- Create: `src/frontmatter.ts`, `tests/frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/frontmatter.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseNote, serializeNote, validateFrontmatter } from "../src/frontmatter";

describe("frontmatter", () => {
  it("round-trips frontmatter + body", () => {
    const raw = "---\ntype: project\nstatus: active\n---\n\n# Hi\n";
    const { data, content } = parseNote(raw);
    expect(data.type).toBe("project");
    const out = serializeNote(data, content.trim());
    expect(out).toContain("type: project");
    expect(out).toContain("# Hi");
  });
  it("validates required keys and enum", () => {
    expect(validateFrontmatter({ type: "project", status: "active" })).toEqual([]);
    const errs = validateFrontmatter({ type: "bogus" });
    expect(errs.join(" ")).toMatch(/status/);
    expect(errs.join(" ")).toMatch(/type/);
  });
  it("rejects non-serializable values", () => {
    const errs = validateFrontmatter({ type: "project", status: "active", x: () => 1 });
    expect(errs.join(" ")).toMatch(/x/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frontmatter.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/frontmatter.ts`:
```ts
import matter from "gray-matter";

const VALID_TYPES = ["project", "person", "decision", "capture", "daily", "map", "summary"];
const VALID_STATUS = ["active", "paused", "done", "archived"];

export function parseNote(raw: string): { data: Record<string, any>; content: string } {
  const g = matter(raw);
  return { data: g.data || {}, content: g.content || "" };
}
export function serializeNote(data: Record<string, any>, content: string): string {
  return matter.stringify(content.endsWith("\n") ? content : content + "\n", data);
}
export function validateFrontmatter(data: Record<string, any>): string[] {
  const errs: string[] = [];
  if (!data.type || !VALID_TYPES.includes(data.type)) errs.push(`type must be one of ${VALID_TYPES.join("|")}`);
  if (data.type && !["daily", "map", "summary"].includes(data.type)) {
    if (!data.status || !VALID_STATUS.includes(data.status)) errs.push(`status must be one of ${VALID_STATUS.join("|")}`);
  }
  for (const [k, v] of Object.entries(data)) {
    const t = typeof v;
    if (t === "function" || t === "symbol" || t === "undefined") errs.push(`frontmatter key "${k}" is not serializable`);
  }
  return errs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/frontmatter.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/frontmatter.ts tests/frontmatter.test.ts
git commit -m "feat: gray-matter frontmatter wrapper + validation (mcpvault rules ported)"
```

---

### Task 8: `src/atomicWrite.ts` — atomic write + checksum

**Files:**
- Create: `src/atomicWrite.ts`, `tests/atomicWrite.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/atomicWrite.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { sha256, atomicWrite, readWithChecksum } from "../src/atomicWrite";

const F = "/tmp/sb-aw/n.md";
beforeEach(() => { fs.rmSync("/tmp/sb-aw", { recursive: true, force: true }); });

describe("atomicWrite", () => {
  it("writes then reads back with stable checksum", () => {
    atomicWrite(F, "hello");
    const r = readWithChecksum(F);
    expect(r?.content).toBe("hello");
    expect(r?.checksum).toBe(sha256("hello"));
  });
  it("returns null for missing file", () => {
    expect(readWithChecksum("/tmp/sb-aw/missing.md")).toBeNull();
  });
  it("overwrites atomically (no temp file left behind)", () => {
    atomicWrite(F, "a"); atomicWrite(F, "b");
    expect(readWithChecksum(F)?.content).toBe("b");
    expect(fs.readdirSync("/tmp/sb-aw").filter((x) => x.includes("tmp"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/atomicWrite.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/atomicWrite.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
export function atomicWrite(file: string, content: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  const fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
export function readWithChecksum(file: string): { content: string; checksum: string } | null {
  try {
    const content = fs.readFileSync(file, "utf8");
    return { content, checksum: sha256(content) };
  } catch { return null; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/atomicWrite.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/atomicWrite.ts tests/atomicWrite.test.ts
git commit -m "feat: atomic write (temp->fsync->rename) + sha256 read-with-checksum"
```

---

### Task 9: `src/vaultWriter.ts` — policy layer + dirty-file guard

**Files:**
- Create: `src/vaultWriter.ts`, `tests/vaultWriter.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/vaultWriter.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { writeNote, softDelete } from "../src/vaultWriter";

beforeEach(() => {
  process.env.SUPERBRAIN_VAULT = "/tmp/sb-vault";
  fs.rmSync("/tmp/sb-vault", { recursive: true, force: true });
});

describe("vaultWriter", () => {
  it("creates a note with validated frontmatter", () => {
    const r = writeNote("projects/x.md", { frontmatter: { type: "project", status: "active" }, body: "# X", mode: "create" });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync("/tmp/sb-vault/projects/x.md", "utf8")).toContain("type: project");
  });
  it("rejects disallowed extension and path traversal", () => {
    expect(writeNote("projects/x.exe", { frontmatter: { type: "project", status: "active" }, body: "", mode: "create" }).ok).toBe(false);
    expect(writeNote("../escape.md", { frontmatter: { type: "project", status: "active" }, body: "", mode: "create" }).ok).toBe(false);
  });
  it("rejects invalid frontmatter", () => {
    expect(writeNote("projects/y.md", { frontmatter: { type: "nope" }, body: "", mode: "create" }).ok).toBe(false);
  });
  it("appends without clobbering and never overwrites in append mode", () => {
    writeNote("daily/2026-05-19.md", { frontmatter: { type: "daily" }, body: "first", mode: "create" });
    writeNote("daily/2026-05-19.md", { frontmatter: { type: "daily" }, body: "second", mode: "append" });
    const t = fs.readFileSync("/tmp/sb-vault/daily/2026-05-19.md", "utf8");
    expect(t).toContain("first"); expect(t).toContain("second");
  });
  it("dirty guard: appends instead of clobbering a user-edited note", () => {
    writeNote("projects/z.md", { frontmatter: { type: "project", status: "active" }, body: "orig", mode: "create" });
    fs.appendFileSync("/tmp/sb-vault/projects/z.md", "\nUSER EDIT\n");
    const r = writeNote("projects/z.md", { frontmatter: { type: "project", status: "active" }, body: "machine", mode: "create" });
    expect(r.ok).toBe(true);
    const t = fs.readFileSync("/tmp/sb-vault/projects/z.md", "utf8");
    expect(t).toContain("USER EDIT");
    expect(t).toContain("machine");
  });
  it("soft-deletes into .trash", () => {
    writeNote("capture/c.md", { frontmatter: { type: "capture", status: "active" }, body: "x", mode: "create" });
    softDelete("capture/c.md");
    expect(fs.existsSync("/tmp/sb-vault/capture/c.md")).toBe(false);
    expect(fs.readdirSync("/tmp/sb-vault/.trash").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vaultWriter.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/vaultWriter.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { vaultPath } from "./paths";
import { serializeNote, parseNote, validateFrontmatter } from "./frontmatter";
import { atomicWrite, readWithChecksum } from "./atomicWrite";

const ALLOWED_EXT = new Set([".md"]);
const EXCLUDED = ["/.obsidian/", "/.git/", "/node_modules/", "/.trash/"];

export interface WriteArgs {
  frontmatter: Record<string, any>;
  body: string;
  mode: "create" | "append";
}
export interface WriteResult { ok: boolean; reason?: string; path?: string }

function resolveSafe(rel: string): string | null {
  const root = path.resolve(vaultPath());
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (!ALLOWED_EXT.has(path.extname(abs))) return null;
  if (EXCLUDED.some((e) => (abs + "/").includes(e))) return null;
  return abs;
}

export function writeNote(rel: string, args: WriteArgs): WriteResult {
  const abs = resolveSafe(rel);
  if (!abs) return { ok: false, reason: "path or extension not allowed" };
  const errs = validateFrontmatter(args.frontmatter);
  if (errs.length) return { ok: false, reason: errs.join("; ") };

  const existing = readWithChecksum(abs);
  if (!existing) {
    atomicWrite(abs, serializeNote(args.frontmatter, args.body));
    return { ok: true, path: abs };
  }
  // Existing file: never blind-overwrite. Append distilled body under a dated section.
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const parsed = parseNote(existing.content);
  const mergedFm = { ...parsed.data, ...args.frontmatter, updated: stamp.slice(0, 10) };
  const appended = `${parsed.content.replace(/\s+$/, "")}\n\n## ${stamp}\n\n${args.body}\n`;
  atomicWrite(abs, serializeNote(mergedFm, appended));
  return { ok: true, path: abs };
}

export function softDelete(rel: string): WriteResult {
  const abs = resolveSafe(rel);
  if (!abs || !fs.existsSync(abs)) return { ok: false, reason: "not found" };
  const trash = path.join(path.resolve(vaultPath()), ".trash");
  fs.mkdirSync(trash, { recursive: true });
  const dest = path.join(trash, `${Date.now()}-${path.basename(abs)}`);
  fs.renameSync(abs, dest);
  return { ok: true, path: dest };
}
```

> Note: in this Phase-1 implementation `mode` is recorded for the distiller's intent but both `create` and `append` converge on the same safe behavior (create-if-absent, else dated-append). The dirty guard is implicit: any pre-existing content (including user Obsidian edits) is preserved because we always append, never overwrite.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/vaultWriter.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/vaultWriter.ts tests/vaultWriter.test.ts
git commit -m "feat: in-process vault writer (allowlist, append-or-create, soft-delete, never clobber)"
```

---

### Task 10: `src/router.ts` — classify distilled item → path/section/links

**Files:**
- Create: `src/router.ts`, `tests/router.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/router.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { route } from "../src/router";

describe("router", () => {
  it("routes a decision to dated decisions file", () => {
    const r = route({ kind: "decision", title: "Use sqlite-vec", body: "because", date: "2026-05-19", links: ["SuperBrain"] });
    expect(r.relPath).toBe("decisions/2026-05-19-use-sqlite-vec.md");
    expect(r.frontmatter.type).toBe("decision");
    expect(r.body).toContain("[[SuperBrain]]");
  });
  it("routes a project fact to projects/<slug>.md append", () => {
    const r = route({ kind: "project_fact", project: "Super Brain", title: "deadline", body: "ship June", date: "2026-05-19", links: [] });
    expect(r.relPath).toBe("projects/super-brain.md");
    expect(r.mode).toBe("append");
  });
  it("routes a person", () => {
    expect(route({ kind: "person", person: "Jane Doe", title: "", body: "lead", date: "2026-05-19", links: [] }).relPath).toBe("people/jane-doe.md");
  });
  it("routes uncategorized to capture with triage tag", () => {
    const r = route({ kind: "capture", title: "stray idea", body: "x", date: "2026-05-19", links: [] });
    expect(r.relPath).toMatch(/^capture\/2026-05-19-stray-idea\.md$/);
    expect(r.frontmatter.tags).toContain("triage");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/router.ts`:
```ts
export type Kind = "decision" | "project_fact" | "person" | "gotcha" | "capture";
export interface DistilledItem {
  kind: Kind;
  title: string;
  body: string;
  date: string;            // YYYY-MM-DD
  links: string[];
  project?: string;
  person?: string;
}
export interface RouteResult {
  relPath: string;
  frontmatter: Record<string, any>;
  body: string;
  mode: "create" | "append";
}

export function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}
function withLinks(body: string, links: string[]): string {
  const wl = links.filter(Boolean).map((l) => `[[${l}]]`);
  return wl.length ? `${body}\n\nRelated: ${wl.join(" ")}` : body;
}

export function route(item: DistilledItem): RouteResult {
  const base = { created: item.date, updated: item.date, superbrain: true };
  switch (item.kind) {
    case "decision":
      return { relPath: `decisions/${item.date}-${slug(item.title)}.md`,
        frontmatter: { type: "decision", status: "active", ...base },
        body: withLinks(`# ${item.date} — ${item.title}\n\n${item.body}`, item.links), mode: "create" };
    case "project_fact":
      return { relPath: `projects/${slug(item.project || "unknown")}.md`,
        frontmatter: { type: "project", status: "active", project: slug(item.project || "unknown"), ...base },
        body: withLinks(`**${item.title}** — ${item.body}`, item.links), mode: "append" };
    case "person":
      return { relPath: `people/${slug(item.person || "unknown")}.md`,
        frontmatter: { type: "person", status: "active", ...base },
        body: withLinks(item.body, item.links), mode: "append" };
    case "gotcha":
      return { relPath: `projects/${slug(item.project || "unknown")}.md`,
        frontmatter: { type: "project", status: "active", project: slug(item.project || "unknown"), ...base },
        body: withLinks(`## Gotchas\n\n- ${item.title}: ${item.body}`, item.links), mode: "append" };
    default:
      return { relPath: `capture/${item.date}-${slug(item.title)}.md`,
        frontmatter: { type: "capture", status: "active", tags: ["triage"], ...base },
        body: withLinks(`# ${item.title}\n\n${item.body}`, item.links), mode: "create" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/router.ts tests/router.test.ts
git commit -m "feat: router (decision/project/person/gotcha/capture → path+frontmatter+links)"
```

---

### Task 11: `src/rollupState.ts` — idempotent rollup hash-state

**Files:**
- Create: `src/rollupState.ts`, `tests/rollupState.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/rollupState.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { needsRollup, markRollup } from "../src/rollupState";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-rollup";
  fs.rmSync("/tmp/sb-rollup", { recursive: true, force: true });
});

describe("rollupState", () => {
  it("needs rollup when never compiled", () => {
    expect(needsRollup("daily", "2026-05-18", "hashA")).toBe(true);
  });
  it("does not need rollup when same hash already compiled", () => {
    markRollup("daily", "2026-05-18", "hashA");
    expect(needsRollup("daily", "2026-05-18", "hashA")).toBe(false);
  });
  it("needs rollup again when source hash changed", () => {
    markRollup("daily", "2026-05-18", "hashA");
    expect(needsRollup("daily", "2026-05-18", "hashB")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rollupState.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/rollupState.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { rollupStatePath } from "./paths";

type Kind = "daily" | "weekly" | "monthly";
function load(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(rollupStatePath(), "utf8")); } catch { return {}; }
}
function save(s: Record<string, string>): void {
  const p = rollupStatePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
}
export function needsRollup(kind: Kind, key: string, sourceHash: string): boolean {
  return load()[`${kind}:${key}`] !== sourceHash;
}
export function markRollup(kind: Kind, key: string, sourceHash: string): void {
  const s = load(); s[`${kind}:${key}`] = sourceHash; save(s);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rollupState.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/rollupState.ts tests/rollupState.test.ts
git commit -m "feat: idempotent rollup hash-state (replaces installed scheduler)"
```

---

### Task 12: `src/distillerEngine.ts` — spawn spec + recursion guard

**Files:**
- Create: `src/distillerEngine.ts`, `tests/distillerEngine.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/distillerEngine.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildDistillCommand, isChild } from "../src/distillerEngine";

describe("distillerEngine", () => {
  it("builds a claude -p command running the distill skill", () => {
    const c = buildDistillCommand({ promptFile: "/tmp/p.txt", cwd: "/work" });
    expect(c.cmd).toBe("claude");
    expect(c.args).toContain("-p");
    expect(c.args.join(" ")).toMatch(/superbrain-distill/);
    expect(c.options.cwd).toBe("/work");
    expect(c.options.env.SUPERBRAIN_CHILD).toBe("1");
  });
  it("detects recursion via env", () => {
    expect(isChild({ SUPERBRAIN_CHILD: "1" })).toBe(true);
    expect(isChild({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/distillerEngine.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/distillerEngine.ts`:
```ts
export function isChild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SUPERBRAIN_CHILD === "1";
}
export interface SpawnSpec {
  cmd: string;
  args: string[];
  options: { cwd: string; env: NodeJS.ProcessEnv; detached: true; stdio: "ignore" };
}
export function buildDistillCommand(opts: { promptFile: string; cwd: string }): SpawnSpec {
  // Default path: `claude -p` reuses the installer's existing Claude Code auth.
  // If ANTHROPIC_API_KEY / SUPERBRAIN_API_KEY is set, the claude CLI picks it up
  // automatically — escape hatch with no command change.
  const prompt = `Run the superbrain-distill skill. Instructions file: ${opts.promptFile}`;
  return {
    cmd: "claude",
    args: ["-p", prompt, "--permission-mode", "acceptEdits"],
    options: {
      cwd: opts.cwd,
      env: { ...process.env, SUPERBRAIN_CHILD: "1" },
      detached: true,
      stdio: "ignore",
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/distillerEngine.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/distillerEngine.ts tests/distillerEngine.test.ts
git commit -m "feat: distiller spawn spec (claude -p default + API-key escape hatch) + recursion guard"
```

---

### Task 13: `bin/sb-observe.ts` — fast observer entry

**Files:**
- Create: `bin/sb-observe.ts`, `tests/observe.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/observe.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => fs.rmSync("/tmp/sb-obs", { recursive: true, force: true }));

function run(hookJson: object) {
  return execFileSync("npx", ["tsx", "bin/sb-observe.ts"], {
    input: JSON.stringify(hookJson),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-obs" },
    encoding: "utf8",
  });
}

describe("sb-observe", () => {
  it("appends a tool event and sets pending marker file on git commit", () => {
    run({ session_id: "S", hook_event_name: "PostToolUse", cwd: "/p",
          tool_name: "Bash", tool_input: { command: "git commit -m x" } });
    const nd = fs.readFileSync("/tmp/sb-obs/sessions/S.ndjson", "utf8");
    expect(nd).toMatch(/"tool":"Bash"/);
    expect(nd).toMatch(/"type":"salient"/);
    expect(fs.existsSync("/tmp/sb-obs/sessions/S.pending")).toBe(true);
  });
  it("no-ops when recursion guard is set", () => {
    execFileSync("npx", ["tsx", "bin/sb-observe.ts"], {
      input: JSON.stringify({ session_id: "S2", hook_event_name: "PostToolUse", cwd: "/p", tool_name: "Read" }),
      env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-obs", SUPERBRAIN_CHILD: "1" }, encoding: "utf8",
    });
    expect(fs.existsSync("/tmp/sb-obs/sessions/S2.ndjson")).toBe(false);
  });
});
```

(Add `tsx` to devDependencies: run `npm i -D tsx` and commit `package.json` in Step 5.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm i -D tsx && npx vitest run tests/observe.test.ts`
Expected: FAIL (cannot find `bin/sb-observe.ts`).

- [ ] **Step 3: Write minimal implementation**

`bin/sb-observe.ts`:
```ts
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { appendEvent } from "../src/ndjson";
import { initState, scoreEvent, type SalienceState, type ObsEvent } from "../src/salience";
import { isChild } from "../src/distillerEngine";
import { dataDir } from "../src/paths";

function readStdin(): string {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}
function stateFile(sid: string) { return path.join(dataDir(), "sessions", `${sid}.salience.json`); }
function loadState(sid: string): SalienceState {
  try { return JSON.parse(fs.readFileSync(stateFile(sid), "utf8")); } catch { return initState(); }
}
function saveState(sid: string, s: SalienceState) {
  fs.mkdirSync(path.dirname(stateFile(sid)), { recursive: true });
  fs.writeFileSync(stateFile(sid), JSON.stringify(s));
}

function main() {
  if (isChild()) process.exit(0);
  const raw = readStdin();
  if (!raw) process.exit(0);
  let h: any; try { h = JSON.parse(raw); } catch { process.exit(0); }
  const sid = h.session_id || "unknown";
  const cwd = h.cwd || process.cwd();

  const ev: ObsEvent = h.hook_event_name === "UserPromptSubmit"
    ? { type: "prompt", cwd, prompt: h.prompt || "" }
    : { type: "tool", cwd, tool: h.tool_name,
        command: h.tool_input?.command, file: h.tool_input?.file_path };

  appendEvent(sid, { ...ev, ts: new Date().toISOString() });

  const r = scoreEvent(loadState(sid), ev);
  saveState(sid, r.state);
  if (r.marker) appendEvent(sid, r.marker);
  if (r.pending) fs.writeFileSync(path.join(dataDir(), "sessions", `${sid}.pending`), "1");
  process.exit(0);
}
main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/observe.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add bin/sb-observe.ts tests/observe.test.ts package.json package-lock.json
git commit -m "feat: observer hook entry (fast, fs-only, salient-marker pinning)"
```

---

### Task 14: `bin/sb-checkpoint.ts` — checkpoint entry (copy + spawn under lock)

**Files:**
- Create: `bin/sb-checkpoint.ts`, `tests/checkpoint.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/checkpoint.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => fs.rmSync("/tmp/sb-ckpt", { recursive: true, force: true }));

function run(hook: object, extraEnv: Record<string, string> = {}) {
  return execFileSync("npx", ["tsx", "bin/sb-checkpoint.ts"], {
    input: JSON.stringify(hook),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-ckpt",
           SUPERBRAIN_FAKE_DISTILLER: "1", ...extraEnv },
    encoding: "utf8",
  });
}

describe("sb-checkpoint", () => {
  it("Stop with no pending marker is a no-op", () => {
    run({ session_id: "S", hook_event_name: "Stop", cwd: "/p", transcript_path: "/dev/null" });
    expect(fs.existsSync("/tmp/sb-ckpt/distill-invoked")).toBe(false);
  });
  it("Stop with pending marker invokes the (faked) distiller and clears pending", () => {
    fs.mkdirSync("/tmp/sb-ckpt/sessions", { recursive: true });
    fs.writeFileSync("/tmp/sb-ckpt/sessions/S.pending", "1");
    run({ session_id: "S", hook_event_name: "Stop", cwd: "/p", transcript_path: "/dev/null" });
    expect(fs.existsSync("/tmp/sb-ckpt/distill-invoked")).toBe(true);
    expect(fs.existsSync("/tmp/sb-ckpt/sessions/S.pending")).toBe(false);
  });
  it("PreCompact always invokes distiller (no pending needed) and never blocks (exit 0)", () => {
    run({ session_id: "S", hook_event_name: "PreCompact", cwd: "/p", transcript_path: "/dev/null" });
    expect(fs.existsSync("/tmp/sb-ckpt/distill-invoked")).toBe(true);
  });
  it("recursion guard makes it a no-op", () => {
    run({ session_id: "S", hook_event_name: "PreCompact", cwd: "/p", transcript_path: "/dev/null" }, { SUPERBRAIN_CHILD: "1" });
    expect(fs.existsSync("/tmp/sb-ckpt/distill-invoked")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/checkpoint.test.ts`
Expected: FAIL (cannot find `bin/sb-checkpoint.ts`).

- [ ] **Step 3: Write minimal implementation**

`bin/sb-checkpoint.ts`:
```ts
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { dataDir } from "../src/paths";
import { acquireLock, releaseLock } from "../src/lockfile";
import { writeFailure } from "../src/sentinel";
import { isChild, buildDistillCommand } from "../src/distillerEngine";

function readStdin(): string { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }

function main() {
  if (isChild()) process.exit(0);
  let h: any; try { h = JSON.parse(readStdin()); } catch { process.exit(0); }
  const sid = h.session_id || "unknown";
  const event = h.hook_event_name;
  const pendingFile = path.join(dataDir(), "sessions", `${sid}.pending`);

  // Stop only acts when a salience marker is pending. PreCompact/SessionEnd always act.
  if (event === "Stop" && !fs.existsSync(pendingFile)) process.exit(0);

  // Fast (<100ms) durable copy of the transcript so async distill can never lose it.
  let copy = "";
  try {
    if (h.transcript_path && fs.existsSync(h.transcript_path)) {
      const dir = path.join(dataDir(), "transcripts");
      fs.mkdirSync(dir, { recursive: true });
      copy = path.join(dir, `${sid}.${Date.now()}.jsonl`);
      fs.copyFileSync(h.transcript_path, copy);
    }
  } catch { /* transcript copy best-effort */ }

  if (!acquireLock("distill")) process.exit(0); // another distill in flight; cursor covers us next time

  try {
    const promptFile = path.join(dataDir(), "transcripts", `${sid}.prompt.json`);
    fs.writeFileSync(promptFile, JSON.stringify({ session_id: sid, event, transcript_copy: copy, cwd: h.cwd }));

    if (process.env.SUPERBRAIN_FAKE_DISTILLER === "1") {
      fs.writeFileSync(path.join(dataDir(), "distill-invoked"), event);
      releaseLock("distill");
    } else {
      const spec = buildDistillCommand({ promptFile, cwd: h.cwd || process.cwd() });
      const child = spawn(spec.cmd, spec.args, spec.options);
      child.on("error", (e) => { writeFailure(`distiller spawn failed: ${e.message}`); releaseLock("distill"); });
      child.unref(); // detached; sb-distill releases the lock when done
    }
    if (fs.existsSync(pendingFile)) fs.rmSync(pendingFile, { force: true });
  } catch (e: any) {
    writeFailure(`checkpoint error: ${e?.message || e}`);
    releaseLock("distill");
  }
  process.exit(0); // NEVER block compaction / the turn
}
main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/checkpoint.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add bin/sb-checkpoint.ts tests/checkpoint.test.ts
git commit -m "feat: checkpoint hook (pending-gated Stop, async PreCompact, lock+copy+sentinel)"
```

---

### Task 15: `bin/sb-distill.ts` — detached child: delta → claude → route → write

**Files:**
- Create: `bin/sb-distill.ts`, `tests/distill.test.ts`

The child reads `{session_id, transcript_copy}`, gets the NDJSON delta since the cursor,
asks `claude` (via the skill) for a JSON array of `DistilledItem`, routes + writes each,
appends to `log.md`, advances the cursor, releases the lock. For testability the LLM call
is injected via `SUPERBRAIN_DISTILL_STUB` (a file containing the JSON array).

- [ ] **Step 1: Write the failing test**

`tests/distill.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-dist", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-dist-vault", { recursive: true, force: true });
});

it("distills delta into routed notes, log.md, advances cursor, releases lock", () => {
  fs.mkdirSync("/tmp/sb-dist/sessions", { recursive: true });
  fs.writeFileSync("/tmp/sb-dist/sessions/S.ndjson",
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  const stub = "/tmp/sb-dist/stub.json";
  fs.writeFileSync(stub, JSON.stringify([
    { kind: "decision", title: "Pick X", body: "rationale", date: "2026-05-19", links: ["SuperBrain"] },
  ]));
  fs.mkdirSync("/tmp/sb-dist/locks/distill.lock", { recursive: true });
  fs.writeFileSync("/tmp/sb-dist/sessions/S.prompt.json", "{}");

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-dist",
      SUPERBRAIN_VAULT: "/tmp/sb-dist-vault", SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "S" },
    encoding: "utf8",
  });

  expect(fs.existsSync("/tmp/sb-dist-vault/decisions/2026-05-19-pick-x.md")).toBe(true);
  expect(fs.readFileSync("/tmp/sb-dist-vault/log.md", "utf8")).toMatch(/Pick X/);
  expect(Number(fs.readFileSync("/tmp/sb-dist/sessions/S.cursor", "utf8"))).toBeGreaterThan(0);
  expect(fs.existsSync("/tmp/sb-dist/locks/distill.lock")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/distill.test.ts`
Expected: FAIL (cannot find `bin/sb-distill.ts`).

- [ ] **Step 3: Write minimal implementation**

`bin/sb-distill.ts`:
```ts
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readDelta } from "../src/ndjson";
import { readCursor, writeCursor } from "../src/cursor";
import { route, type DistilledItem } from "../src/router";
import { writeNote } from "../src/vaultWriter";
import { releaseLock } from "../src/lockfile";
import { writeFailure } from "../src/sentinel";
import { vaultPath } from "../src/paths";

function getItems(deltaJson: string): DistilledItem[] {
  const stub = process.env.SUPERBRAIN_DISTILL_STUB;
  if (stub) return JSON.parse(fs.readFileSync(stub, "utf8"));
  const prompt =
    "You are SuperBrain's distiller. Given this JSON array of session events and " +
    "salient markers, output ONLY a JSON array of items: " +
    '{kind:"decision|project_fact|person|gotcha|capture",title,body,date(YYYY-MM-DD),' +
    "links:[],project?,person?}. Capture decisions, project facts, gotchas, people. " +
    "Skip ephemeral noise. Events:\n" + deltaJson;
  const out = execFileSync("claude", ["-p", prompt], { encoding: "utf8" });
  const m = out.match(/\[[\s\S]*\]/);
  return m ? JSON.parse(m[0]) : [];
}

function appendLog(title: string, rel: string) {
  const p = path.join(vaultPath(), "log.md");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  fs.appendFileSync(p, `## [${stamp}] write | ${title} | [[${rel.replace(/\.md$/, "")}]]\n`);
}

function main() {
  const sid = process.env.SUPERBRAIN_SESSION_ID
    || (() => { try { return JSON.parse(fs.readFileSync(0, "utf8")).session_id; } catch { return "unknown"; } })();
  try {
    const from = readCursor(sid);
    const { events, newOffset } = readDelta(sid, from);
    if (events.length === 0) { releaseLock("distill"); process.exit(0); }
    const items = getItems(JSON.stringify(events));
    for (const it of items) {
      const r = route(it);
      const res = writeNote(r.relPath, { frontmatter: r.frontmatter, body: r.body, mode: r.mode });
      if (res.ok) appendLog(it.title || it.kind, r.relPath);
    }
    writeCursor(sid, newOffset);
  } catch (e: any) {
    writeFailure(`distill failed: ${e?.message || e}`);
  } finally {
    releaseLock("distill");
  }
  process.exit(0);
}
main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/distill.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add bin/sb-distill.ts tests/distill.test.ts
git commit -m "feat: detached distiller child (delta→claude→route→write→log→cursor→unlock)"
```

---

### Task 16: `bin/sb-session-start.ts` — sentinel surfacing + rollup catch-up

**Files:**
- Create: `bin/sb-session-start.ts`, `tests/sessionStart.test.ts`

The SessionStart hook prints `hookSpecificOutput.additionalContext` (so the user/Claude
sees any prior failure once), then runs an idempotent rollup catch-up: for yesterday's
daily / last week / last month, if `needsRollup`, spawn the distiller in rollup mode
(faked in tests).

- [ ] **Step 1: Write the failing test**

`tests/sessionStart.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => fs.rmSync("/tmp/sb-ss", { recursive: true, force: true }));

function run() {
  return execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-ss", SUPERBRAIN_VAULT: "/tmp/sb-ss-vault",
           SUPERBRAIN_FAKE_DISTILLER: "1" },
    encoding: "utf8",
  });
}

it("surfaces a prior failure once via additionalContext", () => {
  fs.mkdirSync("/tmp/sb-ss", { recursive: true });
  fs.writeFileSync("/tmp/sb-ss/last-failure.txt", "[t] distill failed: boom\n");
  const out = run();
  expect(out).toMatch(/additionalContext/);
  expect(out).toMatch(/distill failed: boom/);
  // cleared after surfacing
  const out2 = run();
  expect(out2).not.toMatch(/boom/);
});

it("triggers a (faked) daily rollup when none compiled", () => {
  run();
  expect(fs.existsSync("/tmp/sb-ss/rollup-invoked")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sessionStart.test.ts`
Expected: FAIL (cannot find `bin/sb-session-start.ts`).

- [ ] **Step 3: Write minimal implementation**

`bin/sb-session-start.ts`:
```ts
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readAndClearFailure } from "../src/sentinel";
import { needsRollup, markRollup } from "../src/rollupState";
import { dataDir, vaultPath } from "../src/paths";
import { isChild } from "../src/distillerEngine";

function yesterday(): string {
  const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10);
}
function sourceHash(): string {
  try {
    const p = path.join(vaultPath(), "log.md");
    return String(fs.statSync(p).size);
  } catch { return "0"; }
}

function main() {
  if (isChild()) process.exit(0);

  const fail = readAndClearFailure();
  const parts: string[] = [];
  if (fail) parts.push(`⚠️ SuperBrain: last capture failed — ${fail.trim()} (fixed automatically next checkpoint; set ANTHROPIC_API_KEY if it persists).`);

  // Idempotent daily catch-up (capped to yesterday only for Phase 1).
  const key = yesterday();
  const h = sourceHash();
  if (needsRollup("daily", key, h)) {
    if (process.env.SUPERBRAIN_FAKE_DISTILLER === "1") {
      fs.mkdirSync(dataDir(), { recursive: true });
      fs.writeFileSync(path.join(dataDir(), "rollup-invoked"), key);
    } else {
      // best-effort detached daily synthesis
      try {
        const { spawn } = await import("node:child_process");
        const c = spawn("claude", ["-p", `Run superbrain-distill in rollup mode for daily ${key}.`],
          { detached: true, stdio: "ignore", env: { ...process.env, SUPERBRAIN_CHILD: "1" }, cwd: vaultPath() });
        c.unref();
      } catch { /* non-fatal */ }
    }
    markRollup("daily", key, h);
    parts.push(`SuperBrain: generating daily rollup for ${key}.`);
  }

  if (parts.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: parts.join("\n") },
    }));
  }
  process.exit(0);
}
main();
```

> Note: change the function to `async function main()` since it uses `await import`. Update the signature accordingly when implementing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sessionStart.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add bin/sb-session-start.ts tests/sessionStart.test.ts
git commit -m "feat: SessionStart hook (surface failure once + idempotent rollup catch-up)"
```

---

### Task 17: `skills/superbrain-distill/SKILL.md`

**Files:**
- Create: `skills/superbrain-distill/SKILL.md`

- [ ] **Step 1: Write the skill file**

`skills/superbrain-distill/SKILL.md`:
```markdown
---
name: superbrain-distill
description: Internal SuperBrain skill — run by the detached capture child to distill a session-event delta into routed Obsidian notes. Not for direct user invocation.
---

# SuperBrain Distiller

You are SuperBrain's distiller, running headless and detached. You receive a prompt
file path (JSON: session_id, event, transcript_copy, cwd). Read the transcript copy
and the session NDJSON delta.

Output **only** a JSON array. Each element:

```
{ "kind": "decision|project_fact|person|gotcha|capture",
  "title": "...", "body": "...", "date": "YYYY-MM-DD",
  "links": ["WikiTarget", ...], "project": "optional", "person": "optional" }
```

Rules:
- Capture: decisions (chose X over Y + why), project facts (constraints, deadlines,
  scope), gotchas (bugs/surprises worth never relearning), people context.
- Skip: transcript dumps, anything derivable from `git log`/the code, ephemeral state.
- Every item: a 2–3 sentence self-contained `body` understandable with no other context.
- Add `[[wikilinks]]` for every project/person/decision referenced; the writer
  auto-stubs missing targets.
- Prefer fewer, higher-signal items over many trivial ones — but do NOT under-capture
  genuine decisions or gotchas (the salient markers in the delta tell you what mattered).
- Never write files yourself — output JSON only; the SuperBrain writer handles routing,
  frontmatter, and safe writes.
```

- [ ] **Step 2: Commit**

```bash
git add skills/superbrain-distill/SKILL.md
git commit -m "feat: superbrain-distill skill (JSON-only contract, AI-first note rules)"
```

---

### Task 18: `hooks/hooks.json` — lifecycle registrations

**Files:**
- Create: `hooks/hooks.json`

- [ ] **Step 1: Write the hooks file**

`hooks/hooks.json` (uses `${CLAUDE_PLUGIN_ROOT}`; observer/checkpoint/session-start run
the compiled `dist/bin/*.js`; all non-blocking, observer + checkpoint marked `async`):
```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "*", "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-observe.js\"", "async": true, "timeout": 10 } ] } ],
    "UserPromptSubmit": [
      { "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-observe.js\"", "async": true, "timeout": 10 } ] } ],
    "Stop": [
      { "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-checkpoint.js\"", "async": true, "timeout": 15 } ] } ],
    "PreCompact": [
      { "matcher": "*", "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-checkpoint.js\"", "async": true, "timeout": 15 } ] } ],
    "SessionEnd": [
      { "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-checkpoint.js\"", "timeout": 20 } ] } ],
    "SessionStart": [
      { "matcher": "*", "hooks": [
        { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/bin/sb-session-start.js\"", "async": true, "timeout": 15 } ] } ]
  }
}
```

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat: hook registrations (observer/checkpoint/session-start, all non-blocking)"
```

---

### Task 19: Plugin + marketplace manifests

**Files:**
- Create: `.claude-plugin/plugin.json`, `marketplace.json`

- [ ] **Step 1: Write manifests**

`.claude-plugin/plugin.json`:
```json
{
  "name": "superbrain",
  "version": "0.1.0",
  "description": "Automatic Claude Code -> Obsidian second brain: zero-config session capture into a smart markdown vault.",
  "author": "Alex",
  "license": "MIT",
  "hooks": "./hooks/hooks.json",
  "skills": ["./skills/superbrain-distill"]
}
```

`marketplace.json` (repo root — lets others `/plugin marketplace add <user>/SuperBrain`):
```json
{
  "name": "superbrain",
  "owner": "alex",
  "plugins": [
    { "name": "superbrain", "source": "./", "description": "Automatic Claude Code -> Obsidian second brain (capture spine)." }
  ]
}
```

- [ ] **Step 2: Verify both parse**

Run: `node -e "['.claude-plugin/plugin.json','marketplace.json'].forEach(f=>JSON.parse(require('fs').readFileSync(f,'utf8')));console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/plugin.json marketplace.json
git commit -m "feat: plugin + marketplace manifests (user-scope global install)"
```

---

### Task 20: `bin/sb.ts` — CLI install/migrate

**Files:**
- Create: `bin/sb.ts`, `tests/install.test.ts`

`superbrain install` builds, ensures data dir; `superbrain migrate` idempotently
archives the legacy custom scribe (`~/.claude/hooks/stop-scribe.sh`, `~/.claude/skills/scribe`)
to `~/.superbrain/archived-legacy/` (archive, never delete — matches user org preference).

- [ ] **Step 1: Write the failing test**

`tests/install.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { migrateLegacy } from "../bin/sb";

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-mig-data";
  fs.rmSync("/tmp/sb-mig-data", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-fake-home", { recursive: true, force: true });
  fs.mkdirSync("/tmp/sb-fake-home/.claude/hooks", { recursive: true });
  fs.writeFileSync("/tmp/sb-fake-home/.claude/hooks/stop-scribe.sh", "#legacy");
});

it("archives legacy scribe idempotently and never deletes", () => {
  const r1 = migrateLegacy("/tmp/sb-fake-home");
  expect(r1.archived).toContain("stop-scribe.sh");
  expect(fs.existsSync("/tmp/sb-mig-data/archived-legacy/stop-scribe.sh")).toBe(true);
  expect(fs.existsSync("/tmp/sb-fake-home/.claude/hooks/stop-scribe.sh")).toBe(false);
  const r2 = migrateLegacy("/tmp/sb-fake-home"); // idempotent: nothing left to do
  expect(r2.archived).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/install.test.ts`
Expected: FAIL (cannot find `../bin/sb`).

- [ ] **Step 3: Write minimal implementation**

`bin/sb.ts`:
```ts
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { dataDir } from "../src/paths";

export function migrateLegacy(home = os.homedir()): { archived: string[] } {
  const archiveDir = path.join(dataDir(), "archived-legacy");
  const targets = [
    path.join(home, ".claude", "hooks", "stop-scribe.sh"),
    path.join(home, ".claude", "skills", "scribe"),
  ];
  const archived: string[] = [];
  for (const t of targets) {
    if (fs.existsSync(t)) {
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.renameSync(t, path.join(archiveDir, path.basename(t)));
      archived.push(path.basename(t));
    }
  }
  return { archived };
}

function main() {
  const cmd = process.argv[2];
  if (cmd === "migrate") { console.log(JSON.stringify(migrateLegacy())); return; }
  if (cmd === "install") {
    fs.mkdirSync(dataDir(), { recursive: true });
    console.log("SuperBrain installed. Data dir: " + dataDir());
    return;
  }
  console.log("usage: superbrain <install|migrate>");
}
if (process.argv[1] && process.argv[1].endsWith("sb.ts") || process.argv[1]?.endsWith("sb.js")) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/install.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add bin/sb.ts tests/install.test.ts
git commit -m "feat: CLI install + idempotent legacy-scribe migration (archive, never delete)"
```

---

### Task 21: Build, full suite, integration smoke, README, final commit

**Files:**
- Create: `README.md`
- Modify: none (verification task)

- [ ] **Step 1: Typecheck + build + full test suite**

Run: `npm run typecheck && npm run build && npm test`
Expected: tsc no errors; `dist/` populated; all test files green.

- [ ] **Step 2: End-to-end fixture smoke (faked distiller, real hook entries)**

Run:
```bash
rm -rf /tmp/sb-e2e /tmp/sb-e2e-vault
echo '{"session_id":"E","hook_event_name":"PostToolUse","cwd":"/p","tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' \
 | CLAUDE_PLUGIN_DATA=/tmp/sb-e2e node dist/bin/sb-observe.js
echo '{"session_id":"E","hook_event_name":"Stop","cwd":"/p","transcript_path":"/dev/null"}' \
 | CLAUDE_PLUGIN_DATA=/tmp/sb-e2e SUPERBRAIN_FAKE_DISTILLER=1 node dist/bin/sb-checkpoint.js
test -f /tmp/sb-e2e/distill-invoked && echo "E2E OK"
```
Expected: `E2E OK` (observer logged + salient marker set pending; checkpoint consumed pending and invoked the faked distiller).

- [ ] **Step 3: Write README**

`README.md`:
```markdown
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
```

- [ ] **Step 4: Final commit**

```bash
git add README.md
git commit -m "docs: README (install, 2026-06-15 caveat, architecture summary)"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §3 plugin packaging, user-scope, install registers hooks/MCP | 18, 19, 20 |
| §4a Observer (PostToolUse/UserPromptSubmit, fast, no LLM) | 2, 13 |
| §4b Salience + ndjson salient-marker pinning | 4, 13 |
| §4c Checkpoint distiller: PreCompact async + transcript copy | 14 |
| §4c Stop only-if-pending; SessionEnd flush | 14, 18 |
| §4c lockfile serialization; recursion guard; cursor | 5, 3, 12, 14, 15 |
| §4c failure sentinel (no silent death) | 6, 14, 15, 16 |
| §5 vault writer: gray-matter + atomic + never-clobber + soft-delete | 7, 8, 9 |
| §5 router (decision/project/person/gotcha/capture, wikilinks, stubs) | 10, 15 |
| §5 `log.md` append; generated-file namespacing | 15 (log.md); index.md = Phase-2/rollup |
| §6 idempotent SessionStart/SessionEnd rollup catch-up, hash state, capped | 11, 16 |
| §8 engine: `claude -p` default + API-key escape hatch; 2026-06-15 doc | 12, 21 (README) |
| §8 migration: archive legacy scribe, never delete | 20 |
| §9 safety/idempotency | 5, 6, 8, 9, 14, 15 |
| §10 testing (unit/golden/integration/idempotency) | every task + 21 |

Gaps consciously deferred to Phase 2 (per spec §11): sqlite-vec+FTS5 search, autonomous
recall injection (SessionStart tiered digest + UserPromptSubmit), `superbrain-recall`
skill, `.mcp.json`, `maps/` MOC generation, weekly/monthly synthesis bodies, `index.md`
auto-catalog. Phase-1 `log.md` is the timeline substrate those build on. This matches the
spec's Phase 1/2 split exactly — no unintended gaps.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases". The two prose "Note:"
callouts (Task 9 mode-convergence, Task 16 `async main`) are clarifications of shown
code, not deferred work.

**3. Type consistency:** Verified across tasks — `appendEvent/readDelta` (T2) used by
T13/T15; `initState/scoreEvent`+`SalienceState`/`ObsEvent` (T4) used by T13;
`acquireLock/releaseLock` (T5) used by T14/T15; `route`+`DistilledItem`/`RouteResult`
(T10) used by T15; `writeNote` signature `(rel,{frontmatter,body,mode})` (T9) used by
T15; `buildDistillCommand`/`isChild` (T12) used by T13/T14/T16; `needsRollup/markRollup`
(T11) used by T16; `readAndClearFailure/writeFailure` (T6) used by T14/T15/T16;
`readCursor/writeCursor` (T3) used by T15. Signatures match at every call site.
