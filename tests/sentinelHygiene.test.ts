/**
 * Failure-sentinel diagnosability (C1 hardening).
 *
 * Incident follow-up (2026-06-09): during the cross-version index incident
 * the sentinel was nearly useless for diagnosis —
 *  - no clue WHICH plugin version wrote a failure line (multiple plugin
 *    caches were writing to the same ~/.superbrain),
 *  - last-failure.txt is read-and-clear, so each failure destroyed the
 *    previous one (no history),
 *  - SessionStart appended "set ANTHROPIC_API_KEY" to EVERY failure,
 *    including index errors, steering diagnosis toward auth/quota.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { writeFailure, MAX_FAILURE_LOG_LINES } from "../src/sentinel";
import { openIndex } from "../src/searchIndex";

const PKG_VERSION: string = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
).version;

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sentl-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sentl-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_VAULT_DIR;
});

describe("sentinel version stamp", () => {
  it("every failure line carries the writing plugin's package version", () => {
    writeFailure("index failed: boom");
    const line = fs.readFileSync(path.join(TMP_DATA, "last-failure.txt"), "utf8");
    expect(line).toContain(`[v${PKG_VERSION}]`);
    expect(line).toContain("index failed: boom");
  });
});

describe("failure history (failures.log)", () => {
  it("appends every failure (sentinel overwrite no longer destroys history)", () => {
    writeFailure("first failure");
    writeFailure("second failure");
    writeFailure("third failure");
    const log = fs.readFileSync(path.join(TMP_DATA, "failures.log"), "utf8");
    const lines = log.split("\n").filter(Boolean);
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("first failure");
    expect(lines[2]).toContain("third failure");
    for (const l of lines) expect(l).toContain(`[v${PKG_VERSION}]`);
    // last-failure.txt still holds only the most recent one
    expect(fs.readFileSync(path.join(TMP_DATA, "last-failure.txt"), "utf8"))
      .toContain("third failure");
  });

  it(`stays bounded to the last ${100} lines`, () => {
    for (let i = 1; i <= MAX_FAILURE_LOG_LINES + 20; i++) writeFailure(`failure number ${i}`);
    const lines = fs.readFileSync(path.join(TMP_DATA, "failures.log"), "utf8")
      .split("\n").filter(Boolean);
    expect(MAX_FAILURE_LOG_LINES).toBe(100);
    expect(lines.length).toBe(MAX_FAILURE_LOG_LINES);
    expect(lines[0]).toContain("failure number 21");
    expect(lines[lines.length - 1]).toContain(`failure number ${MAX_FAILURE_LOG_LINES + 20}`);
  });
});

describe("SessionStart hint scoping", () => {
  function runSessionStart(): string {
    return execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
      input: JSON.stringify({ session_id: "S", hook_event_name: "SessionStart", source: "startup", cwd: "/p" }),
      env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT,
             SUPERBRAIN_FAKE_DISTILLER: "1", SUPERBRAIN_EMBED_STUB: "1" },
      encoding: "utf8",
    });
  }

  it("does NOT append the ANTHROPIC_API_KEY hint to index failures", () => {
    fs.writeFileSync(path.join(TMP_DATA, "last-failure.txt"),
      "[t] [v0.7.1] index failed: expected int8, but a float32 vector was provided\n");
    const out = runSessionStart();
    expect(out).toMatch(/index failed/);
    expect(out).not.toContain("ANTHROPIC_API_KEY");
  });

  it("keeps the ANTHROPIC_API_KEY hint for distill failures", () => {
    fs.writeFileSync(path.join(TMP_DATA, "last-failure.txt"),
      "[t] [v0.8.1] distill failed: usage limit reached\n");
    const out = runSessionStart();
    expect(out).toMatch(/distill failed/);
    expect(out).toContain("ANTHROPIC_API_KEY");
  });
});

describe("capture-failure surfacing (index error during distill)", () => {
  it("a broken vec_chunks does not lose the note: .md written, exit 0, sentinel says index failed", () => {
    // Establish a healthy store, then corrupt vec_chunks to a wrong dim while
    // leaving embed_meta intact — every vector insert now throws inside
    // sqlite-vec, exactly like the cross-version incident did.
    const ix = openIndex();
    ix.db.exec("DROP TABLE vec_chunks");
    ix.db.exec("CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id integer primary key, embedding int8[8])");
    ix.close();

    fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(TMP_DATA, "sessions/S.ndjson"),
      JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
    const stub = path.join(TMP_DATA, "stub.json");
    fs.writeFileSync(stub, JSON.stringify([
      { kind: "decision", title: "Adopt sqlite-vec", project: "alpha-proj",
        body: "## Decision\nAdopt sqlite-vec.\n## Why\n- Fast local KNN.\n## Alternatives considered\n- **Alt A** — rejected because slower.\n## Consequences\n- Better search.",
        date: "2026-06-09", links: [] },
    ]));
    fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });

    // execFileSync throws on non-zero exit — surviving this call IS the exit-0 assertion.
    execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
      env: { ...process.env, SUPERBRAIN_DATA_DIR: TMP_DATA, SUPERBRAIN_VAULT_DIR: TMP_VAULT,
        SUPERBRAIN_DISTILL_STUB: stub, SUPERBRAIN_SESSION_ID: "S", SUPERBRAIN_EMBED_STUB: "1" },
      encoding: "utf8",
    });

    // The note .md must still have been written despite the index failure.
    const mdFiles: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".md")) mdFiles.push(p);
      }
    };
    walk(TMP_VAULT);
    const decision = mdFiles.find((f) => fs.readFileSync(f, "utf8").includes("Adopt sqlite-vec"));
    expect(decision).toBeTruthy();

    // And the sentinel attributes the failure to the index, with a version stamp.
    const sentinel = fs.readFileSync(path.join(TMP_DATA, "last-failure.txt"), "utf8");
    expect(sentinel).toContain("index failed");
    expect(sentinel).toContain(`[v${PKG_VERSION}]`);
  });
});
