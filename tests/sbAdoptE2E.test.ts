import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

// End-to-end verification of /superbrain:adopt's load-bearing claim: after
// adopting a vault, subsequent hook-driven WRITES must land in the adopted
// directory, not in the default ~/.superbrain/vault. The existing
// tests/sbAdopt.test.ts proves the CLI creates the marker + records the
// path; this test proves the recorded path is actually honored by the
// distiller write pipeline.

const TMP = path.join(os.tmpdir(), `sb-adopt-e2e-${process.pid}`);

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
});

it("after adopt, the distiller writes to the adopted vault, NOT the default dataDir/vault", () => {
  const dataDir = path.join(TMP, "data");
  const adopted = path.join(TMP, "adopted-vault");
  fs.mkdirSync(adopted, { recursive: true });

  // Step 1: adopt the external dir. The CLI writes <dataDir>/vault-path with
  // the adopted location and marks <adopted>/.superbrain.
  execFileSync("npx", ["tsx", "bin/sb.ts", "adopt", adopted], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: dataDir }, encoding: "utf8",
  });
  expect(fs.existsSync(path.join(adopted, ".superbrain"))).toBe(true);
  expect(fs.readFileSync(path.join(dataDir, "vault-path"), "utf8")).toBe(adopted);

  // Step 2: run the distiller with a stub envelope. Critically, do NOT set
  // SUPERBRAIN_VAULT_DIR — that env-var test seam would short-circuit the
  // recordedVaultPath() lookup and the test wouldn't actually exercise the
  // adopt code path. With only SUPERBRAIN_DATA_DIR set, vaultPath() must
  // resolve via the recorded marker → adopted dir.
  fs.mkdirSync(path.join(dataDir, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "sessions", "S.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  const stub = path.join(TMP, "stub.json");
  fs.writeFileSync(stub, JSON.stringify([
    { kind: "decision", title: "Adopt Routing Works", body: "asserted", date: "2026-05-20", links: [] },
  ]));
  fs.mkdirSync(path.join(dataDir, "locks", "distill.lock"), { recursive: true });
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env,
      SUPERBRAIN_DATA_DIR: dataDir,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "S",
      SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });

  // Step 3: assert the decision landed in the ADOPTED dir.
  const adoptedNote = path.join(adopted, "decisions", "2026-05-20-adopt-routing-works.md");
  expect(fs.existsSync(adoptedNote)).toBe(true);

  // Step 4: assert it did NOT land in the default dataDir/vault location —
  // adopt would be silently broken if BOTH locations got written.
  const fallbackNote = path.join(dataDir, "vault", "decisions", "2026-05-20-adopt-routing-works.md");
  expect(fs.existsSync(fallbackNote)).toBe(false);

  // Step 5: the daily/<today>.log lives at dataDir/logs/, not in the vault —
  // verify it still wrote there (system telemetry stays in dataDir even
  // when vault is adopted elsewhere).
  const today = new Date().toISOString().slice(0, 10);
  expect(fs.readFileSync(path.join(dataDir, "logs", `${today}.log`), "utf8")).toMatch(/Adopt Routing Works/);
});

it("after adopt + a subsequent re-adopt to a different dir, writes go to the LATEST adopted dir", () => {
  const dataDir = path.join(TMP, "data2");
  const firstAdopt = path.join(TMP, "first-vault");
  const secondAdopt = path.join(TMP, "second-vault");
  fs.mkdirSync(firstAdopt, { recursive: true });
  fs.mkdirSync(secondAdopt, { recursive: true });

  // Adopt the first.
  execFileSync("npx", ["tsx", "bin/sb.ts", "adopt", firstAdopt], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: dataDir }, encoding: "utf8",
  });
  // Adopt a different dir — must replace the recorded path, not append.
  execFileSync("npx", ["tsx", "bin/sb.ts", "adopt", secondAdopt], {
    env: { ...process.env, SUPERBRAIN_DATA_DIR: dataDir }, encoding: "utf8",
  });
  expect(fs.readFileSync(path.join(dataDir, "vault-path"), "utf8")).toBe(secondAdopt);

  // Distill — must write to the SECOND dir, not the first.
  fs.mkdirSync(path.join(dataDir, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "sessions", "S.ndjson"),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n");
  const stub = path.join(TMP, "stub2.json");
  fs.writeFileSync(stub, JSON.stringify([
    { kind: "decision", title: "Re-Adopt Replaces", body: "yes", date: "2026-05-20", links: [] },
  ]));
  fs.mkdirSync(path.join(dataDir, "locks", "distill.lock"), { recursive: true });
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: { ...process.env,
      SUPERBRAIN_DATA_DIR: dataDir,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "S",
      SUPERBRAIN_EMBED_STUB: "1" },
    encoding: "utf8",
  });

  expect(fs.existsSync(path.join(secondAdopt, "decisions", "2026-05-20-re-adopt-replaces.md"))).toBe(true);
  expect(fs.existsSync(path.join(firstAdopt, "decisions"))).toBe(false);
});
