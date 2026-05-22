import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-si-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_DATA_DIR;
});

describe("sessionInjected", () => {
  it("returns [] when file missing", async () => {
    const { getInjectedSlugs } = await import("../src/sessionInjected.js");
    expect(getInjectedSlugs("nonexistent-sid")).toEqual([]);
  });

  it("appends and deduplicates", async () => {
    const { appendInjectedSlugs, getInjectedSlugs } = await import("../src/sessionInjected.js");
    appendInjectedSlugs("sid-test", ["a", "b"]);
    appendInjectedSlugs("sid-test", ["b", "c"]);
    expect(new Set(getInjectedSlugs("sid-test"))).toEqual(new Set(["a", "b", "c"]));
  });

  it("writes to the sessions subdir of dataDir", async () => {
    const { appendInjectedSlugs } = await import("../src/sessionInjected.js");
    appendInjectedSlugs("sid-path", ["x"]);
    const expected = path.join(TMP, "sessions", "sid-path.injected.json");
    expect(fs.existsSync(expected)).toBe(true);
  });

  it("handles empty slugs array without error", async () => {
    const { appendInjectedSlugs, getInjectedSlugs } = await import("../src/sessionInjected.js");
    appendInjectedSlugs("sid-empty", []);
    expect(getInjectedSlugs("sid-empty")).toEqual([]);
  });

  it("is idempotent across multiple append calls with same slugs", async () => {
    const { appendInjectedSlugs, getInjectedSlugs } = await import("../src/sessionInjected.js");
    appendInjectedSlugs("sid-idem", ["z"]);
    appendInjectedSlugs("sid-idem", ["z"]);
    expect(getInjectedSlugs("sid-idem")).toEqual(["z"]);
  });
});
