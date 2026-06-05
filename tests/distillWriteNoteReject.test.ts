import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../src/vaultWriter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/vaultWriter.js")>();
  return {
    ...actual,
    writeNote: vi.fn(actual.writeNote),
  };
});

vi.mock("../src/indexer.js", () => ({
  indexNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/embed.js", () => ({
  embed: vi.fn().mockResolvedValue([[0.1, 0.2]]),
}));

vi.mock("../src/searchIndex.js", () => ({
  openIndex: vi.fn().mockReturnValue({
    vectorKNN: vi.fn().mockReturnValue([]),
    close: vi.fn(),
  }),
}));

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-g18-"));
  fs.mkdirSync(path.join(TMP, "vault", "meta"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "vault", "projects"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "data", "sessions"), { recursive: true });
  process.env.SUPERBRAIN_VAULT_DIR = path.join(TMP, "vault");
  process.env.SUPERBRAIN_DATA_DIR = path.join(TMP, "data");
});

afterEach(() => {
  vi.clearAllMocks();
  fs.rmSync(TMP, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_VAULT_DIR;
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_DISTILL_STUB;
});

describe("G18: writeNote ok:false routes to the reject queue", () => {
  it("create-path: rejected writeNote (ok:false) appears in distill-rejects.md", async () => {
    const vaultWriter = await import("../src/vaultWriter.js");
    const { distillFromEvents } = await import("../src/distillRun.js");

    (vaultWriter.writeNote as ReturnType<typeof vi.fn>).mockImplementation(
      (rel: string, _args: unknown) => {
        if (rel.startsWith("capture/")) {
          return { ok: false, reason: "path not allowed" };
        }
        return { ok: true, path: rel };
      },
    );

    process.env.SUPERBRAIN_DISTILL_STUB = path.join(TMP, "stub.json");
    fs.writeFileSync(
      process.env.SUPERBRAIN_DISTILL_STUB,
      JSON.stringify({
        items: [
          {
            kind: "capture",
            title: "Static embed quality metrics",
            date: "2026-06-05",
            what: "The static Model2Vec embed achieves P@10 of 0.72 on the held-out eval set.",
            whyItMatters: "Validates the quality bar needed for v1.0.0 release.",
            links: [],
          },
        ],
        openThreads: [],
        alsoDid: [],
      }),
    );

    await distillFromEvents("g18-test-session", [
      { type: "tool", tool: "Write", file: "x.ts", cwd: "/proj", ts: "t" },
    ]);

    const rejectsFile = path.join(TMP, "vault", "meta", "distill-rejects.md");
    expect(fs.existsSync(rejectsFile)).toBe(true);
    const content = fs.readFileSync(rejectsFile, "utf8");
    expect(content).toMatch(/writeNote rejected/i);
    expect(content).toMatch(/path not allowed/i);
  });

  it("non-create-path: rejected writeNote (ok:false) appears in distill-rejects.md", async () => {
    const vaultWriter = await import("../src/vaultWriter.js");
    const { distillFromEvents } = await import("../src/distillRun.js");

    (vaultWriter.writeNote as ReturnType<typeof vi.fn>).mockImplementation(
      (rel: string, args: { mode: string }) => {
        if (args.mode === "replace" && rel.startsWith("meta/")) {
          return { ok: false, reason: "frontmatter validation error: type is invalid" };
        }
        return { ok: true, path: rel };
      },
    );

    process.env.SUPERBRAIN_DISTILL_STUB = path.join(TMP, "stub.json");
    fs.writeFileSync(
      process.env.SUPERBRAIN_DISTILL_STUB,
      JSON.stringify({
        items: [
          {
            kind: "preference",
            title: "Preferences",
            date: "2026-06-05",
            body: "## Code style\n\n- Always use TypeScript strict mode.\n",
          },
        ],
        openThreads: [],
        alsoDid: [],
      }),
    );

    await distillFromEvents("g18-test-session-b", [
      { type: "tool", tool: "Write", file: "x.ts", cwd: "/proj", ts: "t" },
    ]);

    const rejectsFile = path.join(TMP, "vault", "meta", "distill-rejects.md");
    expect(fs.existsSync(rejectsFile)).toBe(true);
    const content = fs.readFileSync(rejectsFile, "utf8");
    expect(content).toMatch(/writeNote rejected/i);
    expect(content).toMatch(/frontmatter validation error/i);
  });
});
