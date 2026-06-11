import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serializeNote } from "../src/frontmatter";

let TMP: string;
let ABS: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dedup-proj-"));
  process.env.SUPERBRAIN_VAULT_DIR = TMP;
  process.env.SUPERBRAIN_PROJECT_NOTE_CAP_BYTES = "8192";
  ABS = path.join(TMP, "projects", "demo.md");
  fs.mkdirSync(path.dirname(ABS), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SUPERBRAIN_VAULT_DIR;
  delete process.env.SUPERBRAIN_PROJECT_NOTE_CAP_BYTES;
  fs.rmSync(TMP, { recursive: true, force: true });
});

it("does not stick dedup-skip / drops no archive across a forced casWrite retry", async () => {
  const NEW_BODY = "fresh activity line that is well over forty characters long indeed";
  const FILLER = "x".repeat(9000);

  const seeded = serializeNote(
    { type: "project", status: "active", project: "demo", created: "2026-05-19", updated: "2026-05-19" },
    `# demo\n\n## Recent activity\n\n### 2026-05-01\n\n${FILLER}\n\n### 2026-05-19\n\n${NEW_BODY}\n`,
  );
  fs.writeFileSync(ABS, seeded);

  const peer = serializeNote(
    { type: "project", status: "active", project: "demo", created: "2026-05-19", updated: "2026-05-19" },
    `# demo\n\n## Recent activity\n\n### 2026-05-01\n\n${FILLER}\n`,
  );

  const realRead = fs.readFileSync.bind(fs);
  let absReads = 0;
  vi.spyOn(fs, "readFileSync").mockImplementation(((p: any, ...rest: any[]) => {
    if (typeof p === "string" && path.resolve(p) === path.resolve(ABS)) {
      absReads += 1;
      if (absReads === 3) fs.writeFileSync(ABS, peer);
    }
    return (realRead as any)(p, ...rest);
  }) as any);

  const { writeNote } = await import("../src/vaultWriter");
  const r = writeNote("projects/demo.md", {
    frontmatter: { type: "project", status: "active", project: "demo", created: "2026-05-19" },
    body: NEW_BODY,
    mode: "append",
  });

  const live = fs.readFileSync(ABS, "utf8");
  const archiveDir = path.join(TMP, "projects", "_archive");
  const archiveFiles = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir) : [];

  expect(live).toContain(NEW_BODY);
  expect(r.reason).not.toBe("duplicate-skipped");
  expect(archiveFiles.length).toBeGreaterThan(0);
});

it("control: genuine duplicate with no contention still dedup-skips and writes no archive", async () => {
  const NEW_BODY = "fresh activity line that is well over forty characters long indeed";
  const seeded = serializeNote(
    { type: "project", status: "active", project: "demo", created: "2026-05-19", updated: "2026-05-19" },
    `# demo\n\n## Recent activity\n\n### 2026-05-19\n\n${NEW_BODY}\n`,
  );
  fs.writeFileSync(ABS, seeded);
  const before = fs.readFileSync(ABS, "utf8");

  const { writeNote } = await import("../src/vaultWriter");
  const r = writeNote("projects/demo.md", {
    frontmatter: { type: "project", status: "active", project: "demo", created: "2026-05-19" },
    body: NEW_BODY,
    mode: "append",
  });

  expect(r.reason).toBe("duplicate-skipped");
  expect(fs.readFileSync(ABS, "utf8")).toBe(before);
  expect(fs.existsSync(path.join(TMP, "projects", "_archive"))).toBe(false);
});
