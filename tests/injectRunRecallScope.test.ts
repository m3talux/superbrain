import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../src/recall.js", () => ({
  hybridRecall: vi.fn().mockResolvedValue([]),
}));

// Keep other injectRun deps quiet
vi.mock("../src/preferences.js", () => ({ compileInjectionBlock: vi.fn().mockReturnValue("") }));
vi.mock("../src/dailyState.js", () => ({ readDay: vi.fn().mockReturnValue({}), upsertDay: vi.fn() }));

let TMP: string;
let PROJECT_DIR: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-inject-scope-"));
  fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "vault"), { recursive: true });

  process.env.SUPERBRAIN_DATA_DIR = path.join(TMP, "data");
  process.env.SUPERBRAIN_VAULT_DIR = path.join(TMP, "vault");
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";

  PROJECT_DIR = path.join(TMP, "alpha-svc");
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROJECT_DIR, "package.json"), '{"name":"alpha-svc"}');
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
  delete process.env.SUPERBRAIN_DISTILL_STUB;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("runInject — gatherRecall project scoping", () => {
  it("passes projectSlug to hybridRecall when opts.cwd resolves to a known project", async () => {
    const { hybridRecall } = await import("../src/recall.js");
    const { runInject } = await import("../src/injectRun.js");

    // Short text → verbatim mode (no recall call). Use long text to trigger distill,
    // but stub the LLM so it returns quickly.
    const stub = path.join(TMP, "data", "stub.json");
    fs.writeFileSync(stub, JSON.stringify({ items: [] }));
    process.env.SUPERBRAIN_DISTILL_STUB = stub;

    const longText = "alpha-svc recall scoping test " + "x".repeat(200);
    await runInject(longText, { cwd: PROJECT_DIR });

    expect(hybridRecall).toHaveBeenCalled();
    const calls = (hybridRecall as ReturnType<typeof vi.fn>).mock.calls;
    const recallCall = calls.find(([_text, _k, opts]: any[]) => opts !== undefined);
    expect(recallCall).toBeDefined();
    const opts = recallCall![2];
    expect(opts?.projectSlug).toBe("alpha-svc");
  });

  it("omits projectSlug from hybridRecall when opts.cwd has no strong project signal", async () => {
    const { hybridRecall } = await import("../src/recall.js");
    const { runInject } = await import("../src/injectRun.js");

    const stub = path.join(TMP, "data", "stub.json");
    fs.writeFileSync(stub, JSON.stringify({ items: [] }));
    process.env.SUPERBRAIN_DISTILL_STUB = stub;

    const noProjectDir = path.join(TMP, "no-manifest");
    fs.mkdirSync(noProjectDir, { recursive: true });

    const longText = "cross-project recall test " + "y".repeat(200);
    await runInject(longText, { cwd: noProjectDir });

    if ((hybridRecall as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
      const calls = (hybridRecall as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of calls) {
        const opts = call[2];
        expect(opts?.projectSlug).toBeUndefined();
      }
    }
  });

  it("omits projectSlug from hybridRecall when no cwd provided", async () => {
    const { hybridRecall } = await import("../src/recall.js");
    const { runInject } = await import("../src/injectRun.js");

    const stub = path.join(TMP, "data", "stub.json");
    fs.writeFileSync(stub, JSON.stringify({ items: [] }));
    process.env.SUPERBRAIN_DISTILL_STUB = stub;

    const longText = "no-cwd recall test " + "z".repeat(200);
    await runInject(longText, {});

    if ((hybridRecall as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
      const calls = (hybridRecall as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of calls) {
        const opts = call[2];
        expect(opts?.projectSlug).toBeUndefined();
      }
    }
  });
});
