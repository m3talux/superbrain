import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-diskbudget-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("CI disk-budget guard", () => {
  it("50 checkpoints for the same session id produce exactly one snapshot file (no timestamped suffix)", () => {
    const sid = "sid-diskbudget-test";
    const transcriptPath = path.join(dataDir, "live-transcript.jsonl");

    const event = {
      session_id: sid,
      hook_event_name: "PreCompact",
      transcript_path: transcriptPath,
      cwd: process.cwd(),
    };

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SUPERBRAIN_DATA_DIR: dataDir,
      SUPERBRAIN_FAKE_DISTILLER: "1",
    };

    for (let i = 1; i <= 50; i++) {
      fs.writeFileSync(transcriptPath, `{"turn":${i}}\n`);
      const r = spawnSync(
        "node",
        [path.resolve("dist/bin/sb-checkpoint.js")],
        { input: JSON.stringify(event), env, encoding: "utf8" },
      );
      expect(r.status, `run ${i} exited non-zero: ${r.stderr}`).toBe(0);
    }

    const transcriptsDir = path.join(dataDir, "transcripts");
    const files = fs.readdirSync(transcriptsDir).filter(f => f.startsWith(sid));

    // Exactly one snapshot file must exist
    expect(files, "expected exactly one snapshot file").toHaveLength(1);
    expect(files[0]).toBe(`${sid}.jsonl`);

    // No timestamped-suffix files (e.g. sid.1234567890.jsonl)
    const timestamped = files.filter(f => /\.\d{6,}\.jsonl$/.test(f));
    expect(timestamped, "found timestamped snapshot files — overwrite regression").toEqual([]);

    // Snapshot contains the latest turn
    const content = fs.readFileSync(path.join(transcriptsDir, files[0]), "utf8");
    expect(content).toBe('{"turn":50}\n');
  });
});
