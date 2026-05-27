import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-norollup-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-norollup-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

describe("daily rollup synthesizer is gone", () => {
  it("runRollup is no longer exported from distillRun", async () => {
    // Currently fails: src/distillRun.ts exports runRollup.
    // Passes after the deletion in Task 3.
    const mod: any = await import("../src/distillRun");
    expect(mod.runRollup).toBeUndefined();
  });

  it("session-start does not spawn a daily rollup", () => {
    execFileSync("npx", ["tsx", "bin/sb-session-start.ts"], {
      input: JSON.stringify({
        session_id: "S",
        hook_event_name: "SessionStart",
        source: "startup",
        cwd: "/p",
      }),
      env: {
        ...process.env,
        SUPERBRAIN_DATA_DIR: TMP_DATA,
        SUPERBRAIN_VAULT_DIR: TMP_VAULT,
        SUPERBRAIN_FAKE_DISTILLER: "1",
        SUPERBRAIN_EMBED_STUB: "1",
      },
      encoding: "utf8",
    });
    expect(fs.existsSync(path.join(TMP_DATA, "rollup-invoked"))).toBe(false);
  });

  it("a session distill writes no dataDir/logs/<today>.log", () => {
    fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
    fs.writeFileSync(
      path.join(TMP_DATA, "sessions/L.ndjson"),
      JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n",
    );
    const stub = path.join(TMP_DATA, "stub.json");
    fs.writeFileSync(
      stub,
      JSON.stringify([
        {
          kind: "decision",
          title: "Pick X over Y",
          project: "test",
          body:
            "## Decision\nUse X.\n## Why\n- It is better.\n## Alternatives considered\n" +
            "- **Y** — rejected because slower.\n## Consequences\n- Faster pipeline.",
          date: "2026-05-19",
          links: [],
        },
      ]),
    );
    fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });

    execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
      env: {
        ...process.env,
        SUPERBRAIN_DATA_DIR: TMP_DATA,
        SUPERBRAIN_VAULT_DIR: TMP_VAULT,
        SUPERBRAIN_DISTILL_STUB: stub,
        SUPERBRAIN_SESSION_ID: "L",
        SUPERBRAIN_EMBED_STUB: "1",
      },
      encoding: "utf8",
    });

    expect(fs.existsSync(path.join(TMP_DATA, "logs"))).toBe(false);
  });
});
