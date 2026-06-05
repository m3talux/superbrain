import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP: string;
let DATA_DIR: string;
let VAULT_DIR: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-guard-"));
  DATA_DIR = path.join(TMP, "data");
  VAULT_DIR = path.join(TMP, "vault");
  fs.mkdirSync(path.join(DATA_DIR, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "locks", "distill.lock"), { recursive: true });
  fs.mkdirSync(path.join(VAULT_DIR, "meta"), { recursive: true });
  fs.mkdirSync(path.join(VAULT_DIR, "projects"), { recursive: true });
  // Write a minimal cursor so readDelta finds an empty delta (stub overrides)
  fs.writeFileSync(path.join(DATA_DIR, "sessions", "test-session.ndjson"),
    JSON.stringify({ type: "prompt", cwd: "/tmp/proj", prompt: "test" }) + "\n");
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

function runDistill(items: object[], extraEnv: Record<string, string> = {}): void {
  const stub = path.join(TMP, "stub.json");
  const envelope = { items, openThreads: [], alsoDid: [] };
  fs.writeFileSync(stub, JSON.stringify(envelope));

  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: DATA_DIR,
      SUPERBRAIN_VAULT_DIR: VAULT_DIR,
      SUPERBRAIN_DISTILL_STUB: stub,
      SUPERBRAIN_SESSION_ID: "test-session",
      SUPERBRAIN_EMBED_STUB: "1",
      ...extraEnv,
    },
    encoding: "utf8",
    timeout: 30000,
  });
}

describe("producer guard — preference kind filtering", () => {
  it("strips project-scoped lines from a preference item before write", () => {
    // Create the project note so the classifier recognises the slug as known
    const alphaNote = path.join(VAULT_DIR, "projects", "alpha-proj.md");
    fs.writeFileSync(alphaNote, "---\ntype: project\n---\n");
    const body = `## Code style

- Never push directly to main.
- For alpha-proj: use the event-sourcing pattern.
- Always sort imports alphabetically.
`;
    runDistill([
      {
        kind: "preference",
        title: "Preferences",
        date: "2026-01-01",
        links: [],
        body,
      },
    ]);

    const prefsPath = path.join(VAULT_DIR, "meta", "preferences.md");
    expect(fs.existsSync(prefsPath)).toBe(true);
    const written = fs.readFileSync(prefsPath, "utf8");
    expect(written).toContain("Never push directly to main");
    expect(written).toContain("Always sort imports alphabetically");
    expect(written).not.toContain("For alpha-proj");
  });

  it("routes demoted project-scoped rule to projects/<slug>.md", () => {
    // Create the project note so the classifier recognises the slug as known
    const svcNote = path.join(VAULT_DIR, "projects", "test-svc.md");
    fs.writeFileSync(svcNote, "---\ntype: project\n---\n");
    const body = `## Code style

- Never push directly to main.
- For test-svc: always add integration tests.
`;
    runDistill([
      {
        kind: "preference",
        title: "Preferences",
        date: "2026-01-01",
        links: [],
        body,
      },
    ]);

    const projectNote = path.join(VAULT_DIR, "projects", "test-svc.md");
    expect(fs.existsSync(projectNote)).toBe(true);
    const content = fs.readFileSync(projectNote, "utf8");
    expect(content).toContain("always add integration tests");
  });

  it("does not write meta/preferences.md when entire filtered body is empty", () => {
    // Create both project notes so all bullets demote and body becomes empty
    fs.writeFileSync(path.join(VAULT_DIR, "projects", "alpha-proj.md"), "---\ntype: project\n---\n");
    fs.writeFileSync(path.join(VAULT_DIR, "projects", "test-svc.md"), "---\ntype: project\n---\n");
    const body = `## Code style

- For alpha-proj: use the event-sourcing pattern.
- For test-svc: use the internal test harness.
`;
    runDistill([
      {
        kind: "preference",
        title: "Preferences",
        date: "2026-01-01",
        links: [],
        body,
      },
    ]);

    const prefsPath = path.join(VAULT_DIR, "meta", "preferences.md");
    expect(fs.existsSync(prefsPath)).toBe(false);
  });

  it("emits meta/preferences-core.md after a successful preference write", () => {
    const body = `## Code style

- Never push directly to main.
- Always sort imports alphabetically.
`;
    runDistill([
      {
        kind: "preference",
        title: "Preferences",
        date: "2026-01-01",
        links: [],
        body,
      },
    ]);

    const corePath = path.join(VAULT_DIR, "meta", "preferences-core.md");
    expect(fs.existsSync(corePath)).toBe(true);
    const core = fs.readFileSync(corePath, "utf8");
    expect(core).toContain("Never push directly to main");
  });
});

describe("producer guard — Blocker 2: demoted rule with missing project note goes to reject queue", () => {
  it("sends a demoted rule to the reject queue when the project note does not exist", () => {
    // Use the slug override seam to make the classifier demote the rule even
    // though projects/no-note-proj.md does not exist on disk.
    const body = `## Code style

- Never push directly to main.
- For no-note-proj: use domain-driven design.
`;
    runDistill(
      [
        {
          kind: "preference",
          title: "Preferences",
          date: "2026-01-01",
          links: [],
          body,
        },
      ],
      { SUPERBRAIN_KNOWN_SLUGS_OVERRIDE: "no-note-proj" },
    );

    // The project note must NOT have been auto-created
    const projectNote = path.join(VAULT_DIR, "projects", "no-note-proj.md");
    expect(fs.existsSync(projectNote)).toBe(false);

    // The rejected rule must appear in the distill-rejects log
    const rejectsPath = path.join(VAULT_DIR, "meta", "distill-rejects.md");
    expect(fs.existsSync(rejectsPath)).toBe(true);
    const rejectsContent = fs.readFileSync(rejectsPath, "utf8");
    expect(rejectsContent).toContain("project note missing");
    expect(rejectsContent).toContain("no-note-proj");

    // Universal rules are still written normally
    const prefsPath = path.join(VAULT_DIR, "meta", "preferences.md");
    expect(fs.existsSync(prefsPath)).toBe(true);
    const prefsContent = fs.readFileSync(prefsPath, "utf8");
    expect(prefsContent).toContain("Never push directly to main");
  });
});
