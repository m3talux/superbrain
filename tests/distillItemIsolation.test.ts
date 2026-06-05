import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-iso-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-iso-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

it("one malformed item drops only itself; the good item still writes and the cursor advances", () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_DATA, "sessions/ISO.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n",
  );

  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stub, JSON.stringify([
    { kind: "capture", title: "Bad item with object body", date: "2026-06-05", links: [], body: { not: "a string" } },
    {
      kind: "lesson",
      title: "Verify live data dir before diagnosing",
      date: "2026-06-05",
      rule: "Resolve the actual data path before inspecting on-disk state.",
      why: "On 2026-05-20 a full misdiagnosis was produced because the source fallback was inspected instead of the live path.",
      whenApplies: "Any time a plugin appears to not be writing data.",
      links: [],
    },
  ]));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/ISO.prompt.json"), "{}");

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "ISO",
      SUPERBRAIN_EMBED_STUB: "1",
    },
    encoding: "utf8",
  });

  const lessonsDir = path.join(TMP_VAULT, "lessons");
  expect(fs.existsSync(lessonsDir)).toBe(true);
  expect(fs.readdirSync(lessonsDir).filter((f) => f.endsWith(".md")).length).toBeGreaterThan(0);

  expect(Number(fs.readFileSync(path.join(TMP_DATA, "sessions/ISO.cursor"), "utf8"))).toBeGreaterThan(0);
});

it("an item that throws during routing is dropped and does not abort siblings", () => {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_DATA, "sessions/ISO2.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n",
  );
  const stub = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stub, JSON.stringify([
    { kind: "capture", title: "Throwing item", date: "2026-06-05", links: { bogus: true }, body: "x" },
    { kind: "capture", title: "Good sibling capture note", date: "2026-06-05", links: [], body: "this should still be written" },
  ]));
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
  fs.writeFileSync(path.join(TMP_DATA, "sessions/ISO2.prompt.json"), "{}");

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "ISO2",
      SUPERBRAIN_EMBED_STUB: "1",
    },
    encoding: "utf8",
  });

  const captureDir = path.join(TMP_VAULT, "capture");
  expect(fs.existsSync(captureDir)).toBe(true);
  const written = fs.readdirSync(captureDir).filter((f) => f.endsWith(".md"));
  expect(written.some((f) => f.includes("good-sibling"))).toBe(true);
  expect(Number(fs.readFileSync(path.join(TMP_DATA, "sessions/ISO2.cursor"), "utf8"))).toBeGreaterThan(0);
});
