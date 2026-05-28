import { it, describe, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planRecovery, applyRecovery } from "../scripts/recover-lessons.js";
import type { RecoverySession } from "../scripts/recover-lessons.js";

let TMP_DATA: string;
let TMP_VAULT: string;
let SESSIONS_DIR: string;
let STUB_PATH: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-recover-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-recover-vault-"));
  SESSIONS_DIR = path.join(TMP_DATA, "sessions");
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  STUB_PATH = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(
    STUB_PATH,
    JSON.stringify({
      items: [
        {
          kind: "lesson",
          title: "Verify live data dir before diagnosing plugin issues",
          date: "2026-05-22",
          rule: "Resolve the actual data path before inspecting on-disk state.",
          why: "On 2026-05-22 a misdiagnosis was produced because the source fallback was inspected instead of the live path.",
          whenApplies: "Any time a plugin appears to not be writing data.",
          links: [],
        },
      ],
      digest: "Investigated plugin data dir issue.",
      openThreads: [],
      alsoDid: [],
    }),
  );
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

function writeSession(sid: string, firstEventDate: string, extraEvents: object[] = []) {
  const firstEvent = {
    type: "tool",
    tool: "Write",
    file: "a.ts",
    cwd: "/p",
    ts: `${firstEventDate}T10:00:00.000Z`,
  };
  const lines = [firstEvent, ...extraEvents].map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(path.join(SESSIONS_DIR, `${sid}.ndjson`), lines);
}

describe("planRecovery", () => {
  it("includes sessions whose first event is on/after the since date", () => {
    writeSession("IN-1", "2026-05-22");
    writeSession("IN-2", "2026-05-25");
    writeSession("OUT-1", "2026-05-21");

    const plan = planRecovery(SESSIONS_DIR, "2026-05-22");
    const sids = plan.sessions.map((s: RecoverySession) => s.sid);
    expect(sids).toContain("IN-1");
    expect(sids).toContain("IN-2");
    expect(sids).not.toContain("OUT-1");
  });

  it("returns an empty list when sessionsDir does not exist", () => {
    const plan = planRecovery(path.join(TMP_DATA, "no-such-dir"), "2026-05-22");
    expect(plan.sessions).toHaveLength(0);
  });

  it("ignores non-.ndjson files", () => {
    fs.writeFileSync(path.join(SESSIONS_DIR, "S.cursor"), "42");
    const plan = planRecovery(SESSIONS_DIR, "2026-05-22");
    expect(plan.sessions).toHaveLength(0);
  });

  it("sorts sessions by first event date ascending", () => {
    writeSession("B", "2026-05-24");
    writeSession("A", "2026-05-22");
    const plan = planRecovery(SESSIONS_DIR, "2026-05-22");
    const sids = plan.sessions.map((s: RecoverySession) => s.sid);
    expect(sids.indexOf("A")).toBeLessThan(sids.indexOf("B"));
  });

  it("skips sessions whose ndjson has no parseable first line", () => {
    fs.writeFileSync(path.join(SESSIONS_DIR, "BAD.ndjson"), "not json\n");
    const plan = planRecovery(SESSIONS_DIR, "2026-05-22");
    expect(plan.sessions.map((s: RecoverySession) => s.sid)).not.toContain("BAD");
  });
});

describe("applyRecovery", () => {
  it("calls distillFn for in-window session and accumulates results", async () => {
    writeSession("S1", "2026-05-22");

    const plan = planRecovery(SESSIONS_DIR, "2026-05-22");
    const calls: string[] = [];
    const stubDistill = async (sid: string, _events: any[]) => {
      calls.push(sid);
      return { notesWritten: 2 };
    };

    const results = await applyRecovery(plan, stubDistill);
    expect(calls).toEqual(["S1"]);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ sid: "S1", notesWritten: 2 });
  });

  it("processes multiple sessions in order", async () => {
    writeSession("A", "2026-05-22");
    writeSession("B", "2026-05-24");

    const plan = planRecovery(SESSIONS_DIR, "2026-05-22");
    const order: string[] = [];
    const stubDistill = async (sid: string, _events: any[]) => {
      order.push(sid);
      return { notesWritten: 1 };
    };

    await applyRecovery(plan, stubDistill);
    expect(order).toEqual(["A", "B"]);
  });

  it("passes all events from the ndjson to distillFn", async () => {
    writeSession("EV", "2026-05-22", [
      { type: "prompt", content: "hello", ts: "2026-05-22T11:00:00.000Z" },
    ]);

    const plan = planRecovery(SESSIONS_DIR, "2026-05-22");
    let capturedEvents: any[] = [];
    const stubDistill = async (_sid: string, events: any[]) => {
      capturedEvents = events;
      return { notesWritten: 0 };
    };

    await applyRecovery(plan, stubDistill);
    expect(capturedEvents).toHaveLength(2);
    expect(capturedEvents[0].type).toBe("tool");
    expect(capturedEvents[1].type).toBe("prompt");
  });
});

describe("end-to-end with real distillFromEvents", () => {
  it("writes lesson note for in-window session, skips out-of-window", async () => {
    process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
    process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
    process.env.SUPERBRAIN_DISTILL_STUB = STUB_PATH;
    process.env.SUPERBRAIN_EMBED_STUB = "1";

    writeSession("IN", "2026-05-22");
    writeSession("OLD", "2026-05-21");

    try {
      const { distillFromEvents } = await import("../src/distillRun.js");
      const plan = planRecovery(SESSIONS_DIR, "2026-05-22");

      expect(plan.sessions.map((s: RecoverySession) => s.sid)).toContain("IN");
      expect(plan.sessions.map((s: RecoverySession) => s.sid)).not.toContain("OLD");

      const results = await applyRecovery(plan, distillFromEvents);
      expect(results).toHaveLength(1);
      expect(results[0].sid).toBe("IN");
      expect(results[0].notesWritten).toBeGreaterThan(0);

      const lessonsDir = path.join(TMP_VAULT, "lessons");
      expect(fs.existsSync(lessonsDir)).toBe(true);
      const lessonFiles = fs.readdirSync(lessonsDir).filter((f) => f.endsWith(".md"));
      expect(lessonFiles.length).toBeGreaterThan(0);

      const lessonContent = fs.readFileSync(path.join(lessonsDir, lessonFiles[0]), "utf8");
      expect(lessonContent).toMatch(/type: lesson/);
      expect(lessonContent).toMatch(/Verify live data dir/i);

      // cursor for "IN" must NOT have been advanced by recovery
      expect(fs.existsSync(path.join(SESSIONS_DIR, "IN.cursor"))).toBe(false);
    } finally {
      delete process.env.SUPERBRAIN_DATA_DIR;
      delete process.env.SUPERBRAIN_VAULT_DIR;
      delete process.env.SUPERBRAIN_DISTILL_STUB;
      delete process.env.SUPERBRAIN_EMBED_STUB;
    }
  });

  it("second --apply run writes nothing new (idempotent via vault dedup)", async () => {
    process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
    process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
    process.env.SUPERBRAIN_DISTILL_STUB = STUB_PATH;
    process.env.SUPERBRAIN_EMBED_STUB = "1";

    writeSession("IDEM", "2026-05-22");

    try {
      const { distillFromEvents } = await import("../src/distillRun.js");
      const plan = planRecovery(SESSIONS_DIR, "2026-05-22");

      await applyRecovery(plan, distillFromEvents);

      const lessonsDir = path.join(TMP_VAULT, "lessons");
      const countAfterFirst = fs.existsSync(lessonsDir)
        ? fs.readdirSync(lessonsDir).filter((f) => f.endsWith(".md")).length
        : 0;
      expect(countAfterFirst).toBeGreaterThan(0);

      const results2 = await applyRecovery(plan, distillFromEvents);
      const countAfterSecond = fs.readdirSync(lessonsDir).filter((f) => f.endsWith(".md")).length;
      expect(countAfterSecond).toBe(countAfterFirst);
      expect(results2[0].notesWritten).toBe(0);
    } finally {
      delete process.env.SUPERBRAIN_DATA_DIR;
      delete process.env.SUPERBRAIN_VAULT_DIR;
      delete process.env.SUPERBRAIN_DISTILL_STUB;
      delete process.env.SUPERBRAIN_EMBED_STUB;
    }
  });
});
