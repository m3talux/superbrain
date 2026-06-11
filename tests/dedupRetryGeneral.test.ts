import { it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serializeNote } from "../src/frontmatter";

let TMP: string;
let ABS: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dedup-gen-"));
  process.env.SUPERBRAIN_VAULT_DIR = TMP;
  ABS = path.join(TMP, "daily", "2026-05-19.md");
  fs.mkdirSync(path.dirname(ABS), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SUPERBRAIN_VAULT_DIR;
  fs.rmSync(TMP, { recursive: true, force: true });
});

it("does not stick dedup-skip on the general path across a forced retry", async () => {
  const NEW_BODY = "general note body that comfortably exceeds the forty character dedup floor";

  const seeded = serializeNote(
    { type: "daily", created: "2026-05-19", updated: "2026-05-19" },
    `# 2026-05-19\n\n## 2026-05-19 09:00\n\n${NEW_BODY}\n`,
  );
  fs.writeFileSync(ABS, seeded);

  const peer = serializeNote(
    { type: "daily", created: "2026-05-19", updated: "2026-05-19" },
    `# 2026-05-19\n\n## 2026-05-19 08:00\n\nunrelated earlier note here padding\n`,
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
  const r = writeNote("daily/2026-05-19.md", {
    frontmatter: { type: "daily", created: "2026-05-19" },
    body: NEW_BODY,
    mode: "append",
  });

  const live = fs.readFileSync(ABS, "utf8");
  expect(live).toContain(NEW_BODY);
  expect(r.reason).not.toBe("duplicate-skipped");
});
