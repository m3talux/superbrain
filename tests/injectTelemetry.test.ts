import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { logInject, readInjectLog, summarize } from "../src/injectTelemetry.js";

describe("injectTelemetry", () => {
  beforeEach(() => {
    delete process.env.SUPERBRAIN_DATA_DIR;
    process.env.SUPERBRAIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sit-"));
  });

  afterEach(() => {
    delete process.env.SUPERBRAIN_DATA_DIR;
  });

  it("appends a record with computed ts and total", () => {
    logInject({ hook: "SessionStart", sid: "s1", tokens: { recall: 100, preferences: 200, openThreads: 50, notices: 0 }});
    const records = readInjectLog();
    expect(records.length).toBe(1);
    expect(records[0].total).toBe(350);
    expect(records[0].ts).toMatch(/^\d{4}-/);
  });

  it("readInjectLog tails to limit", () => {
    for (let i = 0; i < 60; i++) logInject({ hook: "SessionStart", sid: `s${i}`, tokens: { recall: i, preferences: 0, openThreads: 0, notices: 0 }});
    const r = readInjectLog(10);
    expect(r.length).toBe(10);
    expect(r[r.length - 1].sid).toBe("s59");
  });

  it("returns [] when file missing", () => {
    process.env.SUPERBRAIN_DATA_DIR = "/tmp/sb-nope-" + Math.random();
    expect(readInjectLog()).toEqual([]);
  });

  it("skips malformed lines", () => {
    const dir = process.env.SUPERBRAIN_DATA_DIR!;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "inject.log"), `not-json\n{"ts":"2026-01-01","hook":"SessionStart","sid":"a","tokens":{"recall":1,"preferences":2,"openThreads":3,"notices":4},"total":10}\n`);
    expect(readInjectLog().length).toBe(1);
  });

  it("inject.log lands in SUPERBRAIN_DATA_DIR when env var is set", () => {
    const tmpDir = process.env.SUPERBRAIN_DATA_DIR!;
    const uniqueSid = "s-g21-" + Date.now();
    logInject({ hook: "SessionStart", sid: uniqueSid, tokens: { recall: 10, preferences: 0, openThreads: 0, notices: 0 } });
    const expectedLog = path.join(tmpDir, "inject.log");
    expect(fs.existsSync(expectedLog), "inject.log must exist in SUPERBRAIN_DATA_DIR").toBe(true);
    const logContent = fs.readFileSync(expectedLog, "utf8");
    expect(logContent.includes(uniqueSid), "inject.log in SUPERBRAIN_DATA_DIR must contain the written record").toBe(true);
    const homeLog = path.join(os.homedir(), ".superbrain", "inject.log");
    const contaminatedHome = fs.existsSync(homeLog) &&
      fs.readFileSync(homeLog, "utf8").includes(uniqueSid);
    expect(contaminatedHome, "inject.log must not write to ~/.superbrain when SUPERBRAIN_DATA_DIR is set").toBe(false);
  });

  it("summarize groups by hook and averages", () => {
    logInject({ hook: "SessionStart", sid: "s1", tokens: { recall: 100, preferences: 200, openThreads: 0, notices: 0 }});
    logInject({ hook: "SessionStart", sid: "s2", tokens: { recall: 200, preferences: 200, openThreads: 0, notices: 0 }});
    logInject({ hook: "UserPromptSubmit", sid: "u1", tokens: { recall: 50, preferences: 0, openThreads: 0, notices: 0 }});
    const s = summarize(readInjectLog());
    expect(s.byHook["SessionStart"].count).toBe(2);
    expect(s.byHook["SessionStart"].avg.recall).toBe(150);
    expect(s.byHook["SessionStart"].avgTotal).toBe(350);
    expect(s.byHook["UserPromptSubmit"].count).toBe(1);
  });
});
