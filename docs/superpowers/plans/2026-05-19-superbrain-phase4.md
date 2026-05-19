# SuperBrain Phase 4 — Packaging & Migration Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a marketplace-installed SuperBrain plugin actually run (commit `dist/` + one-time self-healing bootstrap; entrypoints loadable without `node_modules`) and be safe on any pre-existing vault (owned default + `.superbrain` marker + explicit adopt), with real Claude Code slash-command onboarding.

**Architecture:** Add builtin-only `src/vaultMarker.ts` + `src/bootstrap.ts` + a dedicated builtin-only `bin/sb-bootstrap.ts`. Rewrite `paths.ts` vault resolution. Refactor the four entrypoints that statically import native deps (`sb-recall`, `sb-mcp`, `sb-distill`, `sb-session-start`) to a builtin-only preamble + deps-gated dynamic `import()`; `sb-session-start`'s heavy digest moves into a dynamically-imported `src/sessionDigest.ts`. Rewrite `bin/sb.ts` (`adopt`/`migrate`). Commit `dist/`. No behavior change to Phase 1–3 engines when deps are present.

**Tech Stack:** Node/TypeScript ESM (NodeNext — explicit `.js` import extensions), vitest. The plugin runtime deps (`better-sqlite3`, `sqlite-vec`, `@huggingface/transformers`, `gray-matter`, `@modelcontextprotocol/sdk`) are installed by the bootstrap, never statically imported by an entrypoint module top-level.

**Conventions for every task:**
- Branch `phase-4-packaging` (already checked out; never switch branches).
- ONLY plain Bash/Read/Edit/Write. NO lean-ctx/`ctx_*` MCP tools (they mangle git/npm output and corrupt edits). Redirect large output to `/tmp` and read it back.
- All relative imports in `src/`/`bin/` use explicit `.js` extensions (NodeNext).
- A module is **builtin-only** if it transitively imports ONLY `node:*` builtins and other builtin-only `src/` modules (`paths.ts`, `sentinel.ts`, `rollupState.ts`, `ndjson.ts`, `cursor.ts`, `salience.ts`, `lockfile.ts`, `atomicWrite.ts`, `distillerEngine.ts`, and the new `vaultMarker.ts`/`bootstrap.ts`). It must NOT import `frontmatter.ts` (→`gray-matter`), `vaultWriter.ts`, `searchIndex.ts`, `embed.ts`, `recall.ts`, `indexer.ts`, `mcpSearch.ts`, `chunker.ts`, `preferences.ts`, or any `node_modules` package.
- Commit with repeated `-m` flags (NEVER a `$(cat <<EOF)` heredoc — the shell wrapper mangles heredocs):
  `git -c user.email=alex@weaviate.io -c user.name=alex commit -m "<subject>" -m "<body>" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"`
- TDD: write the failing test, run it, see it fail for the right reason, implement minimally, run until green, commit.
- Spec: `docs/superpowers/specs/2026-05-19-superbrain-phase4-design.md`.

---

## File Structure

**New:** `src/vaultMarker.ts` (marker + recorded path, builtin-only), `src/bootstrap.ts` (`depsPresent`/`runBootstrap`, builtin-only), `bin/sb-bootstrap.ts` (detached npm-ci runner, builtin-only), `src/sessionDigest.ts` (the heavy SessionStart digest extracted from `sb-session-start.ts`).

**Modified:** `src/paths.ts` (vault resolution + `pluginRoot()`), `bin/sb-recall.ts` / `bin/sb-mcp.ts` / `bin/sb-distill.ts` / `bin/sb-session-start.ts` (import-safety), `bin/sb.ts` (`adopt`/`migrate`/`install`), `.gitignore`, `package.json`, `.claude-plugin/plugin.json`, `README.md`, plus committed `dist/`.

**New tests:** `tests/vaultMarker.test.ts`, `tests/pathsResolution.test.ts`, `tests/bootstrap.test.ts`, `tests/manifestP4.test.ts`, `tests/sbRecallNoDeps.test.ts`, `tests/sbDistillNoDeps.test.ts`, `tests/sessionStartBootstrap.test.ts`, `tests/sbAdoptMigrate.test.ts`, `tests/freshCloneE2E.test.ts`.

---

### Task 1: `src/vaultMarker.ts` — ownership marker + recorded path

**Files:** Create `src/vaultMarker.ts`; Test: `tests/vaultMarker.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/vaultMarker.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { MARKER, isOwned, markOwned, recordedVaultPath, setRecordedVaultPath } from "../src/vaultMarker";

beforeEach(() => {
  fs.rmSync("/tmp/sb-vm", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-vm-data", { recursive: true, force: true });
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-vm-data";
});

it("markOwned writes the marker; isOwned detects it", () => {
  fs.mkdirSync("/tmp/sb-vm", { recursive: true });
  expect(isOwned("/tmp/sb-vm")).toBe(false);
  markOwned("/tmp/sb-vm");
  expect(fs.existsSync(`/tmp/sb-vm/${MARKER}`)).toBe(true);
  expect(isOwned("/tmp/sb-vm")).toBe(true);
});

it("recorded vault path round-trips and is undefined when unset", () => {
  expect(recordedVaultPath()).toBeUndefined();
  setRecordedVaultPath("/tmp/sb-vm");
  expect(recordedVaultPath()).toBe("/tmp/sb-vm");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vaultMarker.test.ts 2>&1 | tee /tmp/p4t1.txt`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/vaultMarker.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";

export const MARKER = ".superbrain";

export function isOwned(dir: string): boolean {
  try { return fs.existsSync(path.join(dir, MARKER)); } catch { return false; }
}

export function markOwned(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, MARKER), "superbrain-owned\n");
}

function recordFile(): string { return path.join(dataDir(), "vault-path"); }

export function recordedVaultPath(): string | undefined {
  try { const p = fs.readFileSync(recordFile(), "utf8").trim(); return p || undefined; }
  catch { return undefined; }
}

export function setRecordedVaultPath(p: string): void {
  fs.mkdirSync(path.dirname(recordFile()), { recursive: true });
  fs.writeFileSync(recordFile(), p);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/vaultMarker.test.ts 2>&1 | tee /tmp/p4t1.txt`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/vaultMarker.ts tests/vaultMarker.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p4): vault ownership marker + recorded path" -m "Builtin-only: .superbrain marker read/write and persisted adopted vault path." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `src/paths.ts` — owned-vault resolution + `pluginRoot()`

**Files:** Modify `src/paths.ts`; Test: `tests/pathsResolution.test.ts`

Current `src/paths.ts` `vaultPath()` is:
```ts
export function vaultPath(): string {
  if (process.env.SUPERBRAIN_VAULT) return process.env.SUPERBRAIN_VAULT;
  const legacy = path.join(os.homedir(), "vault");
  if (fs.existsSync(legacy)) return legacy;
  return path.join(os.homedir(), "Documents", "SuperBrain");
}
```

- [ ] **Step 1: Write the failing test**

`tests/pathsResolution.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vaultPath, pluginRoot } from "../src/paths";
import { setRecordedVaultPath, isOwned } from "../src/vaultMarker";

beforeEach(() => {
  fs.rmSync("/tmp/sb-pr-data", { recursive: true, force: true });
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-pr-data";
  delete process.env.SUPERBRAIN_VAULT;
  delete process.env.CLAUDE_PLUGIN_ROOT;
});

it("SUPERBRAIN_VAULT wins and is marked", () => {
  fs.mkdirSync("/tmp/sb-pr-explicit", { recursive: true });
  process.env.SUPERBRAIN_VAULT = "/tmp/sb-pr-explicit";
  expect(vaultPath()).toBe("/tmp/sb-pr-explicit");
  expect(isOwned("/tmp/sb-pr-explicit")).toBe(true);
});

it("recorded adopted path is used when no env", () => {
  fs.mkdirSync("/tmp/sb-pr-adopted", { recursive: true });
  setRecordedVaultPath("/tmp/sb-pr-adopted");
  expect(vaultPath()).toBe("/tmp/sb-pr-adopted");
});

it("owned default is dataDir/vault, created + marked; never ~/vault", () => {
  const home = os.homedir();
  // Even if ~/vault exists, it must NOT be chosen.
  const v = vaultPath();
  expect(v).toBe(path.join("/tmp/sb-pr-data", "vault"));
  expect(v).not.toBe(path.join(home, "vault"));
  expect(isOwned(v)).toBe(true);
});

it("pluginRoot honors CLAUDE_PLUGIN_ROOT", () => {
  process.env.CLAUDE_PLUGIN_ROOT = "/tmp/sb-pr-root";
  expect(pluginRoot()).toBe("/tmp/sb-pr-root");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pathsResolution.test.ts 2>&1 | tee /tmp/p4t2.txt`
Expected: FAIL — `pluginRoot` undefined; `vaultPath` still returns `~/vault`/`~/Documents/SuperBrain`.

- [ ] **Step 3: Implement**

In `src/paths.ts` add to the top imports: `import { fileURLToPath } from "node:url";` and `import { markOwned, recordedVaultPath } from "./vaultMarker.js";`. The `paths`↔`vaultMarker` import cycle is **benign**: neither module executes anything at module-init (only `import` statements + function declarations); the imported bindings are read only inside function bodies called later, which ESM handles correctly. (Do NOT use `createRequire`/`require` — under `tsx`/vitest a created `require` bypasses the TS loader and fails to resolve the `.js` specifier.) Replace the `vaultPath` function with:
```ts
export function vaultPath(): string {
  if (process.env.SUPERBRAIN_VAULT) {
    const p = process.env.SUPERBRAIN_VAULT;
    markOwned(p);
    return p;
  }
  const rec = recordedVaultPath();
  if (rec) return rec;
  const owned = path.join(dataDir(), "vault");
  markOwned(owned);
  return owned;
}

export function pluginRoot(): string {
  if (process.env.CLAUDE_PLUGIN_ROOT) return process.env.CLAUDE_PLUGIN_ROOT;
  // dist/src/paths.js -> plugin root is the dir containing package.json above it.
  let d = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(d, "package.json"))) return d;
    d = path.dirname(d);
  }
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pathsResolution.test.ts 2>&1 | tee /tmp/p4t2.txt`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/paths.ts tests/pathsResolution.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p4): owned-vault resolution; drop ~/vault fallback; add pluginRoot()" -m "vaultPath: SUPERBRAIN_VAULT(+mark) -> recorded adopt -> owned dataDir/vault(+mark). ~/vault is never silently adopted." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `src/bootstrap.ts` — deps presence + bootstrap launcher

**Files:** Create `src/bootstrap.ts`; Test: `tests/bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/bootstrap.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { depsPresent, bootstrapDone, markBootstrapDone } from "../src/bootstrap";

beforeEach(() => {
  fs.rmSync("/tmp/sb-bs", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-bs-data", { recursive: true, force: true });
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-bs-data";
});

it("depsPresent is false without node_modules/better-sqlite3, true with it", () => {
  fs.mkdirSync("/tmp/sb-bs", { recursive: true });
  expect(depsPresent("/tmp/sb-bs")).toBe(false);
  fs.mkdirSync("/tmp/sb-bs/node_modules/better-sqlite3", { recursive: true });
  expect(depsPresent("/tmp/sb-bs")).toBe(true);
});

it("bootstrapDone reflects the marker", () => {
  expect(bootstrapDone()).toBe(false);
  markBootstrapDone();
  expect(bootstrapDone()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bootstrap.test.ts 2>&1 | tee /tmp/p4t3.txt`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src/bootstrap.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dataDir } from "./paths.js";

export function depsPresent(pluginRoot: string): boolean {
  try { return fs.existsSync(path.join(pluginRoot, "node_modules", "better-sqlite3")); }
  catch { return false; }
}

function doneFile(): string { return path.join(dataDir(), "bootstrap-done"); }
export function bootstrapDone(): boolean { return fs.existsSync(doneFile()); }
export function markBootstrapDone(): void {
  fs.mkdirSync(path.dirname(doneFile()), { recursive: true });
  fs.writeFileSync(doneFile(), new Date().toISOString());
}

// Detached, fire-and-forget. The dedicated bin/sb-bootstrap.js runs `npm ci`
// under a lock and writes bootstrap-done / the sentinel itself.
export function runBootstrap(pluginRoot: string): void {
  if (bootstrapDone()) return;
  try {
    const runner = fileURLToPath(new URL("../bin/sb-bootstrap.js", import.meta.url));
    spawn(process.execPath, [runner], {
      detached: true, stdio: "ignore",
      env: { ...process.env, SUPERBRAIN_CHILD: "1", SUPERBRAIN_PLUGIN_ROOT: pluginRoot },
      cwd: pluginRoot,
    }).unref();
  } catch { /* non-fatal; retried next SessionStart */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bootstrap.test.ts 2>&1 | tee /tmp/p4t3.txt`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/bootstrap.ts tests/bootstrap.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p4): bootstrap deps-presence + detached launcher" -m "Builtin-only: depsPresent(pluginRoot), bootstrap-done marker, detached spawn of bin/sb-bootstrap.js." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `bin/sb-bootstrap.ts` — locked, idempotent npm-ci runner

**Files:** Create `bin/sb-bootstrap.ts`; Test: extend `tests/bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/bootstrap.test.ts`:
```ts
import { execFileSync } from "node:child_process";

it("sb-bootstrap is idempotent: no-op when bootstrap-done exists", () => {
  markBootstrapDone();
  // FAKE npm so a real install never runs; presence of marker must short-circuit first.
  const out = execFileSync("npx", ["tsx", "bin/sb-bootstrap.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-bs-data",
      SUPERBRAIN_PLUGIN_ROOT: "/tmp/sb-bs", SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
  });
  expect(out).toMatch(/already done/);
});

it("sb-bootstrap (fake) writes bootstrap-done on success", () => {
  fs.mkdirSync("/tmp/sb-bs", { recursive: true });
  execFileSync("npx", ["tsx", "bin/sb-bootstrap.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-bs-data",
      SUPERBRAIN_PLUGIN_ROOT: "/tmp/sb-bs", SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
  });
  expect(bootstrapDone()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bootstrap.test.ts 2>&1 | tee /tmp/p4t4.txt`
Expected: FAIL — `bin/sb-bootstrap.ts` does not exist.

- [ ] **Step 3: Implement**

`bin/sb-bootstrap.ts`:
```ts
#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { acquireLock, releaseLock } from "../src/lockfile.js";
import { bootstrapDone, markBootstrapDone } from "../src/bootstrap.js";
import { writeFailure } from "../src/sentinel.js";

function main() {
  if (bootstrapDone()) { console.log("bootstrap already done"); process.exit(0); }
  if (!acquireLock("bootstrap", { maxAgeMs: 20 * 60 * 1000 })) { process.exit(0); }
  try {
    const root = process.env.SUPERBRAIN_PLUGIN_ROOT || process.cwd();
    if (process.env.SUPERBRAIN_BOOTSTRAP_FAKE === "1") {
      markBootstrapDone();
    } else {
      execFileSync("npm", ["ci", "--omit=dev"], { cwd: root, stdio: "ignore" });
      markBootstrapDone();
    }
  } catch (e: any) {
    writeFailure(`bootstrap (npm ci) failed: ${e?.message || e}`);
  } finally {
    releaseLock("bootstrap");
  }
  process.exit(0);
}
if ((process.argv[1] && process.argv[1].endsWith("sb-bootstrap.ts")) || process.argv[1]?.endsWith("sb-bootstrap.js")) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bootstrap.test.ts 2>&1 | tee /tmp/p4t4.txt`
Expected: PASS (4 passed total).

- [ ] **Step 5: Commit**

```bash
git add bin/sb-bootstrap.ts tests/bootstrap.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p4): locked idempotent npm-ci bootstrap runner" -m "Lock-serialized, no-op once bootstrap-done, sentinel on failure; SUPERBRAIN_BOOTSTRAP_FAKE seam for tests." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `bin/sb-recall.ts` — import-safe (no node_modules → exit 0)

**Files:** Modify `bin/sb-recall.ts`; Test: `tests/sbRecallNoDeps.test.ts`

Current `bin/sb-recall.ts` statically `import`s `../src/recall.js` (→ `searchIndex` → `better-sqlite3`), so it throws at load with no `node_modules`.

- [ ] **Step 1: Write the failing test**

`tests/sbRecallNoDeps.test.ts`:
```ts
import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";

it("sb-recall exits 0 (no crash) when deps are absent", () => {
  // Point pluginRoot at an empty dir → depsPresent() false → must not import recall.
  const out = execFileSync("npx", ["tsx", "bin/sb-recall.ts"], {
    input: JSON.stringify({ prompt: "anything" }),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: "/tmp/sb-nodeps-empty" },
    encoding: "utf8",
  });
  expect(out).toBe(""); // no additionalContext, no throw
});
```
(Create the empty dir in the test setup: add `import fs from "node:fs";` and a `beforeEach` doing `fs.mkdirSync("/tmp/sb-nodeps-empty",{recursive:true})`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sbRecallNoDeps.test.ts 2>&1 | tee /tmp/p4t5.txt`
Expected: it currently still passes ONLY because the dev `node_modules` is present (static import resolves). To make the failure real, the test must assert no static heavy import. Instead assert via a grep guard in Step 4. Treat Step 2 as: confirm the current file statically imports `recall.js` (`grep -n "from \"../src/recall" bin/sb-recall.ts` → matches) — that is the defect.

- [ ] **Step 3: Implement**

Replace `bin/sb-recall.ts` entirely with:
```ts
#!/usr/bin/env node
import fs from "node:fs";
import { isChild } from "../src/distillerEngine.js";
import { depsPresent } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";

function readStdin(): string { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }

async function main() {
  if (isChild()) process.exit(0);
  try {
    if (!depsPresent(pluginRoot())) process.exit(0); // search not bootstrapped yet
    let h: any; try { h = JSON.parse(readStdin()); } catch { process.exit(0); }
    const prompt = (h?.prompt || "").trim();
    if (!prompt) process.exit(0);
    const { bm25Recall } = await import("../src/recall.js"); // deferred: only after deps check
    const hits = await bm25Recall(prompt, 5);
    if (hits.length) {
      const lines = hits.map((p: any) => `- [[${p.relPath.replace(/\.md$/, "")}]]${p.headingPath ? " › " + p.headingPath : ""} — ${p.excerpt}`);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "SuperBrain recall (your vault may already answer this):\n" + lines.join("\n"),
        },
      }));
    }
  } catch { /* never disrupt the turn */ }
  process.exit(0);
}
main();
```
`bootstrap.ts` and `paths.ts` are builtin-only, so this file is now load-safe without `node_modules`; `recall.js` is reached only via the post-check dynamic `import()`.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
grep -n 'import .* from "../src/recall' bin/sb-recall.ts | tee /tmp/p4t5g.txt   # must be EMPTY (no static import)
grep -n 'await import("../src/recall.js")' bin/sb-recall.ts | tee -a /tmp/p4t5g.txt  # must MATCH
npx vitest run tests/sbRecallNoDeps.test.ts tests/sbRecall.test.ts 2>&1 | tee /tmp/p4t5.txt
```
Expected: `/tmp/p4t5g.txt` shows no static recall import + the dynamic import present; the no-deps test passes (exit 0, empty) AND the existing `tests/sbRecall.test.ts` still passes (deps present in dev → dynamic import resolves, recall works unchanged).

- [ ] **Step 5: Commit**

```bash
git add bin/sb-recall.ts tests/sbRecallNoDeps.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p4): sb-recall import-safe without node_modules" -m "Builtin-only preamble + depsPresent gate; recall.js loaded via deferred dynamic import only after the deps check. exit-0 when not bootstrapped." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `bin/sb-mcp.ts` — import-safe (no node_modules → clean exit)

**Files:** Modify `bin/sb-mcp.ts`; Test: `tests/sbMcpNoDeps.test.ts`

Current `bin/sb-mcp.ts` statically imports `@modelcontextprotocol/sdk/*`, `zod`, `mcpSearch.js` → crashes with no `node_modules`.

- [ ] **Step 1: Write the failing test**

`tests/sbMcpNoDeps.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => { fs.mkdirSync("/tmp/sb-mcp-empty", { recursive: true }); });

it("sb-mcp exits 0 cleanly when deps absent (no MCP, no crash)", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-mcp.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: "/tmp/sb-mcp-empty" },
    encoding: "utf8", timeout: 10000,
  });
  expect(out).toMatch(/SuperBrain search not ready/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sbMcpNoDeps.test.ts 2>&1 | tee /tmp/p4t6.txt`
Expected: FAIL — the current file would attempt to import the SDK; with `CLAUDE_PLUGIN_ROOT` empty there is no gate, so it does not emit the readiness line (and in a real no-deps clone it would throw at import).

- [ ] **Step 3: Implement**

Replace `bin/sb-mcp.ts` entirely with:
```ts
#!/usr/bin/env node
import { depsPresent } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";

async function main() {
  if (!depsPresent(pluginRoot())) {
    // No stdio MCP handshake possible without the SDK; exit cleanly so Claude Code
    // simply sees no server. A one-time notice is surfaced by SessionStart instead.
    process.stdout.write("SuperBrain search not ready (first-time setup in progress).\n");
    process.exit(0);
  }
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { z } = await import("zod");
  const { handleSearch } = await import("../src/mcpSearch.js");
  const server = new McpServer({ name: "superbrain", version: "0.3.0" });
  server.tool(
    "superbrain_search",
    "Search the user's SuperBrain Obsidian vault (past decisions, projects, people, gotchas).",
    { query: z.string(), k: z.number().optional() },
    async ({ query, k }: { query: string; k?: number }) => (await handleSearch({ query, k })) as any,
  );
  const transport = new StdioServerTransport();
  server.connect(transport).catch(() => process.exit(1));
}
main();
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
grep -n 'await import("@modelcontextprotocol' bin/sb-mcp.ts | tee /tmp/p4t6g.txt   # must MATCH (dynamic)
grep -nc '^import .*@modelcontextprotocol' bin/sb-mcp.ts | tee -a /tmp/p4t6g.txt   # must be 0 (no static SDK import)
npx vitest run tests/sbMcpNoDeps.test.ts tests/sbMcp.test.ts 2>&1 | tee /tmp/p4t6.txt
```
Expected: no static SDK/zod/mcpSearch import; no-deps test passes (readiness line, exit 0); existing `tests/sbMcp.test.ts` still passes (deps present → dynamic import works, server answers).

- [ ] **Step 5: Commit**

```bash
git add bin/sb-mcp.ts tests/sbMcpNoDeps.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p4): sb-mcp import-safe without node_modules" -m "Deps-gated dynamic import of the MCP SDK + mcpSearch; clean exit 0 when not bootstrapped." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `bin/sb-distill.ts` — import-safe (no node_modules → release lock, exit 0)

**Files:** Modify `bin/sb-distill.ts`; Test: `tests/sbDistillNoDeps.test.ts`

`bin/sb-distill.ts` statically imports `router`/`vaultWriter`(→`gray-matter`)/`indexer`(→`better-sqlite3`)/etc. It is spawned detached by checkpoint/SessionStart. If deps are absent it must release the distill lock and exit 0 (not crash and leak the lock).

- [ ] **Step 1: Write the failing test**

`tests/sbDistillNoDeps.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-dnd", { recursive: true, force: true });
  fs.mkdirSync("/tmp/sb-dnd/locks/distill.lock", { recursive: true });
  fs.mkdirSync("/tmp/sb-dnd-empty", { recursive: true });
});

it("sb-distill releases the lock and exits 0 when deps absent", () => {
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-dnd",
      CLAUDE_PLUGIN_ROOT: "/tmp/sb-dnd-empty", SUPERBRAIN_SESSION_ID: "S" },
    encoding: "utf8",
  });
  expect(fs.existsSync("/tmp/sb-dnd/locks/distill.lock")).toBe(false); // lock released
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sbDistillNoDeps.test.ts 2>&1 | tee /tmp/p4t7.txt`
Expected: FAIL (currently no deps-gate; with dev node_modules present it would proceed; the assertion captures the required new behavior — make it fail first by confirming there is no `depsPresent` guard yet via `grep -n depsPresent bin/sb-distill.ts` → empty).

- [ ] **Step 3: Implement**

At the very top of `bin/sb-distill.ts`, BEFORE the existing heavy imports, the file currently has `#!/usr/bin/env node` then `import fs ...; import path ...; import { execFileSync } ...; import { readDelta } ...` etc. Convert it so the ONLY static imports are builtin-only, and the heavy work is a dynamic import. Concretely: keep `import fs from "node:fs";`, `import path from "node:path";`, `import { execFileSync } from "node:child_process";`, `import { releaseLock } from "../src/lockfile.js";`, `import { writeFailure } from "../src/sentinel.js";`, `import { isChild } from "../src/distillerEngine.js";`, `import { depsPresent } from "../src/bootstrap.js";`, `import { pluginRoot } from "../src/paths.js";`. MOVE everything that is the current `main()`/`mainRollup()`/`getEnvelope`/`parseEnvelope`/`route`/`writeNote`/`indexNote`/`buildDailyNote`/`upsertDay` logic into a NEW file `src/distillRun.ts` exporting `export async function runDistill(): Promise<void>` (the body of the current `main()`'s non-guard logic) and `export async function runRollup(rollupEnv: string): Promise<void>` (current `mainRollup`). `src/distillRun.ts` keeps the heavy static imports (it is only ever loaded via dynamic import, after the deps check). `bin/sb-distill.ts` becomes:
```ts
#!/usr/bin/env node
import { releaseLock } from "../src/lockfile.js";
import { writeFailure } from "../src/sentinel.js";
import { depsPresent } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";

// sb-distill.js is only ever spawned as the distill child (its own dedicated
// script), so it has no isChild() guard — matching the pre-P4 behavior.
async function main() {
  if (!depsPresent(pluginRoot())) {
    try { writeFailure("distill skipped: dependencies not yet installed (bootstrap pending)"); } catch { /* noop */ }
    try { releaseLock("distill"); } catch { /* noop */ }
    process.exit(0);
  }
  try {
    const run = await import("../src/distillRun.js");
    const rollupEnv = process.env.SUPERBRAIN_ROLLUP;
    if (rollupEnv) await run.runRollup(rollupEnv);
    else await run.runDistill();
  } catch (e: any) {
    try { writeFailure(`distill failed: ${e?.message || e}`); } catch { /* noop */ }
    try { releaseLock("distill"); } catch { /* noop */ }
  }
  process.exit(0);
}
if ((process.argv[1] && process.argv[1].endsWith("sb-distill.ts")) || process.argv[1]?.endsWith("sb-distill.js")) main();
```
Move the existing `main()` body (the cursor read/delta/getEnvelope/route loop/daily wiring/writeCursor + `finally releaseLock`) verbatim into `src/distillRun.ts` `runDistill()` (drop its own `process.exit(0)` — let the entrypoint exit), and `mainRollup` body into `runRollup(rollupEnv)`. Keep `parseEnvelope` exported from `src/distillRun.ts` (the existing `tests/distillEnvelope.test.ts` imports it from `../bin/sb-distill` — update that test's import to `../src/distillRun` as part of this task; this is a mechanical import-path move, no assertion change).

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
grep -nE '^import .*(router|vaultWriter|indexer|dailyNote|dailyState|cursor|ndjson|rollupState)' bin/sb-distill.ts | tee /tmp/p4t7g.txt  # must be EMPTY
npx vitest run tests/sbDistillNoDeps.test.ts tests/distill.test.ts tests/distillRollup.test.ts tests/distillDaily.test.ts tests/distillRollupDaily.test.ts tests/distillIndex.test.ts tests/distillEnvelope.test.ts tests/distillPrefReconcile.test.ts 2>&1 | tee /tmp/p4t7.txt
```
Expected: no heavy static imports remain in `bin/sb-distill.ts`; the no-deps test passes (lock released, exit 0); ALL existing distill suites stay green (deps present → dynamic import of `distillRun` → identical behavior). The `distillPrefReconcile` test asserted `bin/sb-distill.ts` contains `preferencesPath`/`Current preferences`/`meta/preferences.md` — since that prompt logic moved to `src/distillRun.ts`, update that test to read `src/distillRun.ts` instead (mechanical path change, assertions unchanged).

- [ ] **Step 5: Commit**

```bash
git add bin/sb-distill.ts src/distillRun.ts tests/sbDistillNoDeps.test.ts tests/distillEnvelope.test.ts tests/distillPrefReconcile.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p4): sb-distill import-safe; heavy logic -> src/distillRun.ts" -m "Entrypoint is builtin-only + deps-gated; runDistill/runRollup dynamically imported only when deps present. No-deps: release lock, sentinel, exit 0. Behavior unchanged when deps present." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: extract `src/sessionDigest.ts` (heavy SessionStart body)

**Files:** Create `src/sessionDigest.ts`; Modify `bin/sb-session-start.ts` (extract only — no behavior change yet); Test: existing `tests/sessionStartDigest.test.ts` + `tests/sessionStartPrefs.test.ts` stay green

Current `bin/sb-session-start.ts` (post-P3) statically imports `recall.js` + `preferences.js` (heavy). This task ONLY extracts the heavy digest body into a module, still statically imported, so behavior is identical and the existing tests prove the extraction is faithful. Task 9 then makes the import dynamic + adds bootstrap.

- [ ] **Step 1:** Create `src/sessionDigest.ts` exporting `export async function appendDigest(parts: string[], h: any): Promise<void>` containing EXACTLY the current lines of `sb-session-start.ts` from the `// Hybrid recall digest` block through the end of the `// Preferences + today's open threads` block (the two `try { … } catch { … }` blocks that push into `parts`), with `hybridRecall`, `compileInjectionBlock`, `readDay` imported at the top of `sessionDigest.ts`.

- [ ] **Step 2:** In `bin/sb-session-start.ts` replace those two inlined blocks with `await appendDigest(parts, h);` and change the imports: remove `import { hybridRecall } from "../src/recall.js";`, `import { compileInjectionBlock } from "../src/preferences.js";`, `import { readDay } from "../src/dailyState.js";`; add `import { appendDigest } from "../src/sessionDigest.js";`.

- [ ] **Step 3: Run tests to verify no regression**

Run: `npx vitest run tests/sessionStartDigest.test.ts tests/sessionStartPrefs.test.ts tests/sessionStart.test.ts tests/rollupConvergence.test.ts 2>&1 | tee /tmp/p4t8.txt`
Expected: ALL green — byte-identical behavior; this is a pure extraction.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tee /tmp/p4t8b.txt`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/sessionDigest.ts bin/sb-session-start.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "refactor(p4): extract heavy SessionStart digest into src/sessionDigest.ts" -m "Pure extraction (still statically imported); existing sessionStart tests prove behavior is unchanged. Sets up the deps-gated dynamic import in the next task." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `bin/sb-session-start.ts` — import-safe + bootstrap trigger + notices

**Files:** Modify `bin/sb-session-start.ts`; Test: `tests/sessionStartBootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/sessionStartBootstrap.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-ssb", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-ssb-empty", { recursive: true, force: true });
  fs.mkdirSync("/tmp/sb-ssb-empty", { recursive: true });
});

it("no deps: emits first-time-setup notice, exits 0, does NOT crash", () => {
  const out = execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-ssb", CLAUDE_PLUGIN_ROOT: "/tmp/sb-ssb-empty",
      SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_BOOTSTRAP_FAKE: "1" },
    encoding: "utf8",
  });
  expect(out).toMatch(/first-time setup/i);
  expect(out).toMatch(/additionalContext/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sessionStartBootstrap.test.ts 2>&1 | tee /tmp/p4t9.txt`
Expected: FAIL — no bootstrap/notice path yet (and with an empty plugin root the heavy static import path from Task 8 would still be in play).

- [ ] **Step 3: Implement**

Edit `bin/sb-session-start.ts`. It already statically imports `fs`, `path`, and `{ dataDir, vaultPath }` from `../src/paths.js` (all builtin-only). Remove `import { appendDigest } from "../src/sessionDigest.js";` (it is heavy). Add three builtin-only static imports: `import { depsPresent, runBootstrap } from "../src/bootstrap.js";`, `import { pluginRoot } from "../src/paths.js";` (extend the existing paths import to `{ dataDir, vaultPath, pluginRoot }`), and `import { recordedVaultPath } from "../src/vaultMarker.js";`. Replace the single `await appendDigest(parts, h);` call site with:
```ts
    const root = pluginRoot();
    if (!depsPresent(root)) {
      runBootstrap(root);
      parts.push("SuperBrain is finishing first-time setup (installing search dependencies). Capture resumes automatically next session.");
    } else {
      const { appendDigest } = await import("../src/sessionDigest.js"); // deferred heavy import
      await appendDigest(parts, h);
    }
    // One-time courtesy notice when using the owned default vault (no explicit/adopted vault).
    try {
      if (!process.env.SUPERBRAIN_VAULT && !recordedVaultPath()) {
        const flag = path.join(dataDir(), "owned-vault-notice");
        if (!fs.existsSync(flag)) {
          parts.push("SuperBrain is capturing into its own vault. To use an existing Obsidian vault instead, run `/superbrain:adopt <path>` or set SUPERBRAIN_VAULT.");
          fs.mkdirSync(path.dirname(flag), { recursive: true }); fs.writeFileSync(flag, "1");
        }
      }
    } catch { /* courtesy notice is best-effort */ }
```
(All three new imports are builtin-only, so the entrypoint stays load-safe without `node_modules`; `sessionDigest.js` is reached only via the post-deps-check dynamic `import()`. The detached reconcile spawn that exists later in the file must be gated: wrap it as `if (depsPresent(root)) { …existing reconcile spawn… }` so `sb-reconcile` is never spawned before bootstrap.)

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
grep -nE '^import .*(recall|preferences|sessionDigest|dailyState)' bin/sb-session-start.ts | tee /tmp/p4t9g.txt  # must be EMPTY (all heavy imports gone/dynamic)
npx vitest run tests/sessionStartBootstrap.test.ts tests/sessionStartDigest.test.ts tests/sessionStartPrefs.test.ts tests/sessionStart.test.ts tests/rollupConvergence.test.ts 2>&1 | tee /tmp/p4t9.txt
```
Expected: no heavy static imports in `bin/sb-session-start.ts`; the no-deps bootstrap test passes; all existing sessionStart/digest/prefs/rollupConvergence tests stay green (deps present in dev → dynamic `appendDigest` import → identical behavior; the new one-time owned-vault notice fires only when neither `SUPERBRAIN_VAULT` nor a recorded path is set — those existing tests set `SUPERBRAIN_VAULT`, so the notice is suppressed and their assertions are unaffected). If a digest test does NOT set `SUPERBRAIN_VAULT`, set it in that test's env (additive env-only change, mirrors the Phase-2/3 stub-env precedent) so the courtesy notice stays suppressed there.

- [ ] **Step 5: Commit**

```bash
git add bin/sb-session-start.ts tests/sessionStartBootstrap.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p4): SessionStart import-safe + bootstrap trigger + notices" -m "Builtin-only entrypoint; deps-gated dynamic appendDigest; first-run bootstrap + one-time setup notice; one-time owned-vault courtesy notice; reconcile spawn gated on deps. Recursion-guard/exit-0 intact." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `bin/sb.ts` — universal `adopt` + safe `migrate`

**Files:** Modify `bin/sb.ts`; Test: `tests/sbAdoptMigrate.test.ts`

Current `bin/sb.ts` `migrateLegacy` uses `renameSync` (EXDEV-unsafe) and `main` has trivial `install`/`migrate`.

- [ ] **Step 1: Write the failing test**

`tests/sbAdoptMigrate.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

beforeEach(() => {
  fs.rmSync("/tmp/sb-am", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-am-home", { recursive: true, force: true });
  fs.rmSync("/tmp/sb-am-vault", { recursive: true, force: true });
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-am";
});

function run(args: string[], env: Record<string,string> = {}) {
  return execFileSync("npx", ["tsx", "bin/sb.ts", ...args], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: "/tmp/sb-am", ...env }, encoding: "utf8" });
}

it("adopt marks + records a writable dir, refuses a file", () => {
  fs.mkdirSync("/tmp/sb-am-vault", { recursive: true });
  run(["adopt", "/tmp/sb-am-vault"]);
  expect(fs.existsSync("/tmp/sb-am-vault/.superbrain")).toBe(true);
  expect(fs.readFileSync("/tmp/sb-am/vault-path", "utf8")).toBe("/tmp/sb-am-vault");
  fs.writeFileSync("/tmp/sb-am-file", "x");
  expect(() => run(["adopt", "/tmp/sb-am-file"])).toThrow();
});

it("migrate copies-then-unlinks legacy scribe, idempotent, dry-run is inert", () => {
  const hooks = "/tmp/sb-am-home/.claude/hooks";
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(`${hooks}/stop-scribe.sh`, "#legacy\n");
  run(["migrate", "--dry-run"], { HOME: "/tmp/sb-am-home" });
  expect(fs.existsSync(`${hooks}/stop-scribe.sh`)).toBe(true); // dry-run: untouched
  run(["migrate"], { HOME: "/tmp/sb-am-home" });
  expect(fs.existsSync(`${hooks}/stop-scribe.sh`)).toBe(false); // moved
  const archived = fs.readdirSync("/tmp/sb-am/archived-legacy");
  expect(archived.length).toBe(1);
  const r2 = run(["migrate"], { HOME: "/tmp/sb-am-home" }); // idempotent
  expect(r2).toMatch(/nothing to migrate|no legacy/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sbAdoptMigrate.test.ts 2>&1 | tee /tmp/p4t10.txt`
Expected: FAIL — no `adopt`; `migrate` has no `--dry-run`/copy-then-unlink/idempotent message.

- [ ] **Step 3: Implement**

Replace `bin/sb.ts` entirely with:
```ts
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { dataDir } from "../src/paths.js";
import { isOwned, markOwned, setRecordedVaultPath, MARKER } from "../src/vaultMarker.js";
import { depsPresent, bootstrapDone } from "../src/bootstrap.js";
import { pluginRoot } from "../src/paths.js";

function archiveCopyThenUnlink(src: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(src));
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.cpSync(src, dest, { recursive: true });
  } else {
    fs.copyFileSync(src, dest);
    const fd = fs.openSync(dest, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  fs.rmSync(src, { recursive: true, force: true });
}

export function migrateLegacy(home = os.homedir(), dryRun = false): { archived: string[]; dryRun: boolean } {
  const targets = [
    path.join(home, ".claude", "hooks", "stop-scribe.sh"),
    path.join(home, ".claude", "skills", "scribe"),
  ].filter((t) => fs.existsSync(t));
  if (dryRun) return { archived: targets.map((t) => path.basename(t)), dryRun: true };
  const archived: string[] = [];
  if (targets.length) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destDir = path.join(dataDir(), "archived-legacy", stamp);
    for (const t of targets) { archiveCopyThenUnlink(t, destDir); archived.push(path.basename(t)); }
  }
  return { archived, dryRun: false };
}

function doAdopt(target: string): void {
  const abs = path.resolve(target);
  const st = fs.existsSync(abs) ? fs.statSync(abs) : null;
  if (!st || !st.isDirectory()) throw new Error(`adopt: ${abs} is not a directory`);
  try { fs.accessSync(abs, fs.constants.W_OK); } catch { throw new Error(`adopt: ${abs} is not writable`); }
  // Refuse a directory marked by a different tool (foreign marker contents).
  const mk = path.join(abs, MARKER);
  if (fs.existsSync(mk) && !fs.readFileSync(mk, "utf8").includes("superbrain-owned"))
    throw new Error(`adopt: ${abs} is marked by another tool`);
  markOwned(abs);
  setRecordedVaultPath(abs);
  console.log(`Adopted ${abs} as the SuperBrain vault.`);
  if (depsPresent(pluginRoot())) {
    import("../src/indexer.js").then((m) => m.reconcile()).catch(() => { /* best-effort; SessionStart reconcile heals */ });
  } // else: the normal SessionStart reconcile will index existing notes post-bootstrap
}

function main() {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);
  if (cmd === "adopt") {
    if (!args[0]) { console.log("usage: superbrain adopt <path>"); process.exit(2); }
    doAdopt(args[0]); return;
  }
  if (cmd === "migrate") {
    const r = migrateLegacy(os.homedir(), args.includes("--dry-run"));
    if (r.dryRun) console.log(r.archived.length ? `[dry-run] would archive: ${r.archived.join(", ")}` : "[dry-run] nothing to migrate");
    else console.log(r.archived.length ? `Archived: ${r.archived.join(", ")} -> ${path.join(dataDir(), "archived-legacy")}` : "Nothing to migrate (no legacy scribe found).");
    console.log("Note: legacy MCP layers (mcpvault / claude-mem / obra knowledge-graph) are configured in your Claude settings, not files. Disable them there manually if desired.");
    return;
  }
  if (cmd === "install") {
    fs.mkdirSync(dataDir(), { recursive: true });
    console.log(bootstrapDone() ? "SuperBrain ready." : "SuperBrain installed; first-time dependency setup runs automatically on next Claude Code session.");
    return;
  }
  console.log("usage: superbrain <adopt <path>|migrate [--dry-run]|install>");
}
if ((process.argv[1] && process.argv[1].endsWith("sb.ts")) || process.argv[1]?.endsWith("sb.js")) main();
```
(`indexer.js` is reached only via a guarded dynamic import after `depsPresent`, so `bin/sb.ts` stays load-safe without `node_modules`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sbAdoptMigrate.test.ts 2>&1 | tee /tmp/p4t10.txt`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add bin/sb.ts tests/sbAdoptMigrate.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p4): universal adopt + cross-FS-safe idempotent migrate" -m "adopt: validate+refuse-foreign+mark+record, best-effort deps-gated reconcile. migrate: copy-then-fsync-then-unlink into timestamped archive, --dry-run, idempotent, MCP-legacy checklist. install: bootstrap-status reporter." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: plugin slash-commands + manifest version

**Files:** Create `commands/adopt.md`, `commands/migrate.md`; Modify `.claude-plugin/plugin.json`; Test: `tests/manifestP4.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/manifestP4.test.ts`:
```ts
import { it, expect } from "vitest";
import fs from "node:fs";

it("plugin.json version matches package.json and references commands", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const plg = JSON.parse(fs.readFileSync(".claude-plugin/plugin.json", "utf8"));
  expect(plg.version).toBe(pkg.version);
  expect(plg.commands).toBe("./commands");
});

it("slash-command files invoke the sb.js CLI", () => {
  const adopt = fs.readFileSync("commands/adopt.md", "utf8");
  const migrate = fs.readFileSync("commands/migrate.md", "utf8");
  expect(adopt).toMatch(/sb\.js" adopt/);
  expect(migrate).toMatch(/sb\.js" migrate/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manifestP4.test.ts 2>&1 | tee /tmp/p4t11.txt`
Expected: FAIL — command files absent; `plugin.json` version 0.2.0 ≠ package 0.3.0; no `commands` key.

- [ ] **Step 3: Implement**

`commands/adopt.md`:
```markdown
---
description: Adopt an existing directory as the SuperBrain vault (marks it, indexes existing notes).
---

Run this exact command and report its output to the user:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/bin/sb.js" adopt "$ARGUMENTS"
```
```

`commands/migrate.md`:
```markdown
---
description: Archive a legacy custom scribe (stop-scribe.sh / scribe skill). Add --dry-run to preview.
---

Run this exact command and report its output to the user:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/bin/sb.js" migrate $ARGUMENTS
```
```

In `.claude-plugin/plugin.json` set `"version": "0.3.0"` and add `"commands": "./commands"` (keep all existing keys). Resulting file:
```json
{
  "name": "superbrain",
  "version": "0.3.0",
  "description": "Automatic Claude Code -> Obsidian second brain: zero-config session capture, hybrid search, autonomous recall, daily/lessons/preferences.",
  "author": "Alex",
  "license": "MIT",
  "hooks": "./hooks/hooks.json",
  "skills": ["./skills/superbrain-distill", "./skills/superbrain-recall"],
  "mcpServers": "./.mcp.json",
  "commands": "./commands"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manifestP4.test.ts 2>&1 | tee /tmp/p4t11.txt` then `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8'));console.log('valid')"`
Expected: PASS (2 passed) and `valid`.

- [ ] **Step 5: Commit**

```bash
git add commands/adopt.md commands/migrate.md .claude-plugin/plugin.json tests/manifestP4.test.ts
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "feat(p4): /superbrain:adopt + /superbrain:migrate slash-commands; manifest 0.3.0" -m "Real CC plugin command surface wrapping dist/bin/sb.js; plugin.json version now tracks package.json." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: ship `dist/` + `.gitignore` + `release:check`

**Files:** Modify `.gitignore`, `package.json`; commit built `dist/`; Test: `tests/distShipped.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/distShipped.test.ts`:
```ts
import { it, expect } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

it(".gitignore no longer ignores dist/", () => {
  const gi = fs.readFileSync(".gitignore", "utf8").split(/\r?\n/);
  expect(gi).not.toContain("dist/");
  expect(gi).toContain("node_modules/");
});

it("key compiled entrypoints are tracked in git", () => {
  const tracked = execFileSync("git", ["ls-files", "dist"], { encoding: "utf8" });
  for (const f of ["dist/bin/sb-session-start.js", "dist/bin/sb-distill.js", "dist/bin/sb-bootstrap.js", "dist/bin/sb.js", "dist/src/paths.js"])
    expect(tracked).toContain(f);
});

it("package.json has a release:check script", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  expect(pkg.scripts["release:check"]).toMatch(/build.*git diff --exit-code dist/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/distShipped.test.ts 2>&1 | tee /tmp/p4t12.txt`
Expected: FAIL — `dist/` still git-ignored/untracked; no `release:check`.

- [ ] **Step 3: Implement**

Edit `.gitignore` — remove the line `dist/` (keep `node_modules/`, `*.log`, `.DS_Store`). In `package.json` `scripts` add: `"release:check": "npm run build && git diff --exit-code dist"`. Then build and stage the compiled output:
```bash
npm run build
git add -f dist .gitignore package.json tests/distShipped.test.ts
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/distShipped.test.ts 2>&1 | tee /tmp/p4t12.txt`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "build(p4): ship compiled dist/; un-ignore dist; add release:check" -m "Marketplace install is a git clone, so the runnable dist/ must be in-repo. release:check (build + git diff --exit-code dist) prevents stale dist; deliberately no npm lifecycle hook." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: fresh-clone simulation E2E + README quick-start rewrite

**Files:** Create `tests/freshCloneE2E.test.ts`; Modify `README.md`

- [ ] **Step 1: Write the failing test**

`tests/freshCloneE2E.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const CLONE = "/tmp/sb-fresh";
beforeEach(() => {
  fs.rmSync(CLONE, { recursive: true, force: true });
  fs.mkdirSync(CLONE, { recursive: true });
  // Simulate a marketplace clone: committed dist/ + manifests, NO node_modules.
  for (const d of ["dist", ".claude-plugin", "hooks"])
    fs.cpSync(d, path.join(CLONE, d), { recursive: true });
  fs.copyFileSync("package.json", path.join(CLONE, "package.json"));
});

it("every hook entrypoint loads + exits 0 with NO node_modules; SessionStart bootstraps", () => {
  const dataDir = "/tmp/sb-fresh-data";
  fs.rmSync(dataDir, { recursive: true, force: true });
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: CLONE, CLAUDE_PLUGIN_DATA: dataDir,
    SUPERBRAIN_BOOTSTRAP_FAKE: "1", SUPERBRAIN_FAKE_DISTILLER: "1" };
  for (const b of ["sb-observe", "sb-checkpoint", "sb-recall", "sb-distill"]) {
    const r = execFileSync(process.execPath, [path.join(CLONE, "dist/bin", `${b}.js`)], {
      input: JSON.stringify({ session_id: "S", prompt: "x", hook_event_name: "Stop" }),
      env, encoding: "utf8" }); // must not throw
    expect(typeof r).toBe("string");
  }
  const ss = execFileSync(process.execPath, [path.join(CLONE, "dist/bin/sb-session-start.js")], {
    input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
    env, encoding: "utf8" });
  expect(ss).toMatch(/first-time setup/i);
});
```

- [ ] **Step 2: Run test to verify it fails / passes**

Run: `npx vitest run tests/freshCloneE2E.test.ts 2>&1 | tee /tmp/p4t13.txt`
Expected: PASS if Tasks 1–12 are correct (this is the load-bearing §3 proof). If any entrypoint throws "Cannot find module 'better-sqlite3'/'gray-matter'/SDK", fix that entrypoint's import-safety (do not weaken this test).

- [ ] **Step 3: Rewrite README quick-start**

Replace the `## Quick start` fenced block (the `/plugin marketplace add` … `superbrain migrate` block) with:
```markdown
## Quick start

```text
# In Claude Code:
/plugin marketplace add m3talux/superbrain
/plugin install superbrain
```

That's it. On the **first session** the plugin runs a one-time setup (installs its
search dependencies in the background) and tells you it's doing so; capture is fully
active from the next session. By default SuperBrain writes to its own vault at
`~/.superbrain/vault`. To use an existing Obsidian vault instead, run
`/superbrain:adopt /path/to/your/vault` (or set `SUPERBRAIN_VAULT`). Optional:
`/superbrain:migrate` archives a legacy custom scribe (never deletes; `--dry-run` to preview).
```
Also fix the stale dev line: change `npm test              # 52 tests across 21 files` to `npm test              # full suite (unit + integration + fresh-clone E2E)`.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/freshCloneE2E.test.ts 2>&1 | tee /tmp/p4t13.txt` and `grep -n "52 tests across 21 files\|superbrain install" README.md | tee /tmp/p4t13b.txt`
Expected: E2E green; `/tmp/p4t13b.txt` empty (no stale test count, no fake `superbrain install` shell step).

- [ ] **Step 5: Commit**

```bash
git add tests/freshCloneE2E.test.ts README.md
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "test(p4): fresh-clone E2E (no node_modules) + truthful README quick-start" -m "Proves every entrypoint loads + exits 0 from a marketplace-like clone and SessionStart bootstraps; quick-start now matches reality." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: full suite, release:check, version coherence, dist refresh, final commit

**Files:** rebuild + commit `dist/`; final verification

- [ ] **Step 1: Typecheck + full suite**

Run:
```bash
cd /Users/alex/Projects/Vibe/SuperBrain
npx tsc --noEmit 2>&1 | tee /tmp/p4-tc.txt
npx vitest run 2>&1 | tee /tmp/p4-suite.txt
```
Expected: 0 TS errors; ALL tests green (Phase 1–4). Record exact Test Files / Tests counts. If any pre-existing test regressed → STOP, report BLOCKED.

- [ ] **Step 2: Refresh + verify shipped `dist/`**

Run:
```bash
npm run build
git add dist
git status --porcelain dist | tee /tmp/p4-diststat.txt
npm run release:check 2>&1 | tee /tmp/p4-relcheck.txt ; echo "relcheck-exit=$?"
```
Expected: after `git add dist`, `release:check` (`build` then `git diff --exit-code dist`) exits 0 — committed `dist/` exactly matches a fresh build of the final source. If `/tmp/p4-diststat.txt` shows staged dist changes, they must be committed in Step 4.

- [ ] **Step 3: Version coherence check**

Run: `node -e "const p=require('./package.json'),m=require('./.claude-plugin/plugin.json');if(p.version!==m.version||p.version!=='0.3.0')throw new Error('version mismatch '+p.version+' vs '+m.version);console.log('versions ok '+p.version)"`
Expected: `versions ok 0.3.0`.

- [ ] **Step 4: Final commit**

```bash
git add dist
git -c user.email=alex@weaviate.io -c user.name=alex commit -m "build(p4): refresh shipped dist for final Phase 4 state" -m "release:check green: committed dist matches source. Phase 4 complete." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
(If Step 2 produced no dist delta, skip the commit and report "dist already current".)

---

## Self-Review

**1. Spec coverage**

| Phase-4 spec section | Task(s) |
|---|---|
| §2.1 commit dist + one-time bootstrap | 3, 4, 12, 14 |
| §2.2 owned vault + marker + drop ~/vault + adopt | 1, 2, 10 |
| §2.3 onboarding = slash-commands, install implicit | 10, 11, 13 |
| §2.4 migrate copy-then-unlink/idempotent/dry-run/no-MCP-edit | 10 |
| §3 entrypoints loadable without node_modules | 5 (recall), 6 (mcp), 7 (distill), 8+9 (session-start), 13 (fresh-clone proof) |
| §4 vaultMarker / bootstrap / sb-bootstrap / sessionDigest / paths / sb.ts / manifests / gitignore / dist / README | 1,2,3,4,8,9,10,11,12,13 |
| §5 data flow (clone→bootstrap→owned vault→adopt→migrate) | 9, 10, 13 |
| §6 error handling (non-fatal, lock, fsync-before-unlink, adopt validation, never unmarked write) | 2,3,4,7,9,10 |
| §7 P4 tests (fresh-clone, vault matrix, marker, adopt, migrate, bootstrap, non-regression) | 1,2,3,4,10,13,14 |
| §8 decisions | all |
| §9 P4 only; battle-testing = P5 | scope: no stress/perf task (correctly deferred) |

No gap. Battle-testing intentionally absent (P5, per spec §9).

**2. Placeholder scan:** No TBD/TODO. Every code step shows complete file/edit content; every command has expected output. The two slash-command files and the README block are given verbatim. Task 7's "move main() body into runDistill" specifies exactly which file/exports and that it is a verbatim move with the two mechanical test-import-path updates enumerated — not a vague instruction.

**3. Type consistency:** `pluginRoot()` (Task 2) consumed by `bootstrap.depsPresent`/`runBootstrap` (Task 3) and entrypoints (5,6,7,9,10). `depsPresent(pluginRoot: string)` signature identical at every call site. `MARKER`/`isOwned`/`markOwned`/`recordedVaultPath`/`setRecordedVaultPath` (Task 1) used by `paths.ts` (2), `sb.ts` (10), `sb-session-start` (9). `bootstrapDone`/`markBootstrapDone` (Task 3) used by `bin/sb-bootstrap.ts` (4) and `sb.ts` install (10). `appendDigest(parts, h)` (Task 8) called dynamically in Task 9. `runDistill`/`runRollup`/`parseEnvelope` (Task 7, `src/distillRun.ts`) consumed by `bin/sb-distill.ts` (7) and the relocated `distillEnvelope`/`distillPrefReconcile` tests. Names consistent across all tasks.
