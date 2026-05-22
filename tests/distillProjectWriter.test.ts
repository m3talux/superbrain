/**
 * Integration tests for the T16 wiring: when distillRun writes a project_fact
 * or gotcha (mode="append" to projects/<slug>.md), it goes through
 * appendDatedSectionWithArchive rather than raw append.
 *
 * These tests exercise the vaultWriter.writeNote seam directly — no LLM call,
 * no spawn. The SUPERBRAIN_DISTILL_STUB path is NOT used here; instead we call
 * writeNote() directly from tests.
 */
import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-projw-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-projw-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

// Helper: run sb-distill with a stub envelope and return the vault dir.
function runDistill(stub: object, sessionId = "S"): void {
  const stubPath = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stubPath, JSON.stringify(stub));
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_DATA, `sessions/${sessionId}.ndjson`),
    JSON.stringify({ type: "tool", tool: "Write", file: "a.ts", cwd: "/p", ts: "t" }) + "\n",
  );
  fs.writeFileSync(path.join(TMP_DATA, `sessions/${sessionId}.prompt.json`), "{}");
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stubPath,
      SUPERBRAIN_SESSION_ID: sessionId,
      SUPERBRAIN_EMBED_STUB: "1",
    },
    encoding: "utf8",
  });
}

it("project_fact appends under a dated ### subsection inside ## Recent activity", () => {
  // Pre-create the project note WITH ## Recent activity
  const projectsDir = path.join(TMP_VAULT, "projects");
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectsDir, "myapp.md"),
    `---\ntype: project\nproject: myapp\ncreated: 2026-05-20\nsuperbrain: true\n---\n\n# myapp\n\n## Recent activity\n`,
  );

  runDistill([
    { kind: "project_fact", title: "DB is Postgres", project: "myapp",
      body: "We decided to use Postgres as the primary database.", date: "2026-05-22", links: [] },
  ]);

  const content = fs.readFileSync(path.join(projectsDir, "myapp.md"), "utf8");
  // Must have ## Recent activity section
  expect(content).toContain("## Recent activity");
  // Must have a ### YYYY-MM-DD subsection (date from the item)
  expect(content).toMatch(/### \d{4}-\d{2}-\d{2}/);
  // Must contain the fact body
  expect(content).toContain("DB is Postgres");
  // Must NOT use the old "## HH:MM" timestamp format
  expect(content).not.toMatch(/## \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
});

it("initializes ## Recent activity when existing note lacks it, then appends dated subsection", () => {
  // Pre-create a project note WITHOUT ## Recent activity (legacy format)
  const projectsDir = path.join(TMP_VAULT, "projects");
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectsDir, "legacy.md"),
    `---\ntype: project\nproject: legacy\ncreated: 2026-01-01\nsuperbrain: true\n---\n\n# Legacy Project\n\n## Architecture\n\nMono-repo.\n`,
  );

  runDistill([
    { kind: "project_fact", title: "Uses mono-repo", project: "legacy",
      body: "The codebase is a mono-repo managed by pnpm workspaces.", date: "2026-05-22", links: [] },
  ], "S2");

  const content = fs.readFileSync(path.join(projectsDir, "legacy.md"), "utf8");
  // The section must now exist
  expect(content).toContain("## Recent activity");
  // And a dated subsection must be present
  expect(content).toMatch(/### \d{4}-\d{2}-\d{2}/);
  expect(content).toContain("Uses mono-repo");
  // Legacy content must be preserved
  expect(content).toContain("## Architecture");
});

it("creates project note from scratch when file does not exist, with ## Recent activity", () => {
  runDistill([
    { kind: "project_fact", title: "Service owns auth", project: "authsvc",
      body: "The auth-service is the sole owner of the JWT signing key.", date: "2026-05-22", links: [] },
  ], "S3");

  const filePath = path.join(TMP_VAULT, "projects", "authsvc.md");
  expect(fs.existsSync(filePath)).toBe(true);
  const content = fs.readFileSync(filePath, "utf8");
  expect(content).toContain("## Recent activity");
  expect(content).toMatch(/### \d{4}-\d{2}-\d{2}/);
  expect(content).toContain("Service owns auth");
});

it("archives oldest dated subsection to projects/_archive/<slug>-<year>-Q<n>.md when file exceeds 20KB", () => {
  // Build a project note that's already >19KB so one more append tips it over
  const projectsDir = path.join(TMP_VAULT, "projects");
  fs.mkdirSync(projectsDir, { recursive: true });

  // Fill ## Recent activity with content to push file size well over cap.
  // The initial note alone must already exceed 20KB so any new append triggers archiving.
  const bigChunk = "x".repeat(20_800);
  const existingNote = [
    "---",
    "type: project",
    "project: bigapp",
    "created: 2026-01-01",
    "superbrain: true",
    "---",
    "",
    "# bigapp",
    "",
    "## Recent activity",
    "",
    "### 2026-01-01",
    "",
    bigChunk,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(projectsDir, "bigapp.md"), existingNote);

  runDistill([
    { kind: "project_fact", title: "New fact", project: "bigapp",
      body: "New architectural fact added today.", date: "2026-05-22", links: [] },
  ], "S4");

  // The archive directory must exist
  const archiveDir = path.join(projectsDir, "_archive");
  expect(fs.existsSync(archiveDir)).toBe(true);

  // At least one archive file for bigapp must exist
  const archiveFiles = fs.readdirSync(archiveDir).filter(f => f.startsWith("bigapp-"));
  expect(archiveFiles.length).toBeGreaterThan(0);

  // The main file must still contain Recent activity and the new fact
  const main = fs.readFileSync(path.join(projectsDir, "bigapp.md"), "utf8");
  expect(main).toContain("## Recent activity");
  expect(main).toContain("New fact");
});
