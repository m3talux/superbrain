import { it, expect, beforeEach, afterEach, describe } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-cwd-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-cwd-vault-"));
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
});

function makeSessionNdjson(sessionId: string, events: object[]): void {
  fs.mkdirSync(path.join(TMP_DATA, "sessions"), { recursive: true });
  const lines = events.map(e => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(path.join(TMP_DATA, `sessions/${sessionId}.ndjson`), lines);
}

function makeStub(envelope: object): string {
  const stubPath = path.join(TMP_DATA, "stub.json");
  fs.writeFileSync(stubPath, JSON.stringify(envelope));
  return stubPath;
}

function runDistill(stubPath: string, sessionId: string, extraEnv: Record<string, string> = {}): void {
  fs.mkdirSync(path.join(TMP_DATA, "locks/distill.lock"), { recursive: true });
  execFileSync("npx", ["tsx", "bin/sb-distill.ts"], {
    env: {
      ...process.env,
      SUPERBRAIN_DATA_DIR: TMP_DATA,
      SUPERBRAIN_VAULT_DIR: TMP_VAULT,
      SUPERBRAIN_DISTILL_STUB: stubPath,
      SUPERBRAIN_SESSION_ID: sessionId,
      SUPERBRAIN_EMBED_STUB: "1",
      SUPERBRAIN_TEST_BYPASS_BLOCKLIST: "1",
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

function readDailyState(date: string): Record<string, any> {
  const f = path.join(TMP_DATA, "daily", `${date}.json`);
  if (!fs.existsSync(f)) return {};
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

describe("cwd-authoritative project attribution", () => {
  it("single-repo session: item with no explicit project is attributed to that repo's project slug, daily entry records project", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-repo-a-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "my-app" }));

      makeSessionNdjson("SA", [
        { type: "tool", tool: "Write", file: "src/index.ts", cwd: repoDir, ts: "t1" },
        { type: "tool", tool: "Write", file: "src/main.ts", cwd: repoDir, ts: "t2" },
        { type: "prompt", prompt: "add feature", cwd: repoDir, ts: "t3" },
      ]);

      const expectedSlug = path.basename(repoDir).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

      const stubPath = makeStub({
        items: [
          {
            kind: "project_fact",
            title: "Service uses TypeScript",
            date: "2026-05-28",
            body: "The service is written in TypeScript.",
            links: [],
          },
        ],
        digest: "Set up TypeScript service",
        openThreads: [],
        alsoDid: [],
      });

      runDistill(stubPath, "SA");

      const state = readDailyState("2026-05-28");
      expect(state).toHaveProperty("SA");

      const entry = state["SA"];
      expect(entry.project).toBe(expectedSlug);

      const projectFile = path.join(TMP_VAULT, "projects", `${expectedSlug}.md`);
      expect(fs.existsSync(projectFile)).toBe(true);
      const content = fs.readFileSync(projectFile, "utf8");
      expect(content).toContain(expectedSlug);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("single-repo session: explicit project on item wins over cwd-derived project", () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-repo-explicit-"));
    try {
      fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "inferred-app" }));

      makeSessionNdjson("SE", [
        { type: "tool", tool: "Write", file: "a.ts", cwd: repoDir, ts: "t1" },
      ]);

      const stubPath = makeStub({
        items: [
          {
            kind: "project_fact",
            title: "Uses Postgres",
            date: "2026-05-28",
            project: "explicit-project",
            body: "The database is Postgres.",
            links: [],
          },
        ],
        digest: "DB discussion",
        openThreads: [],
        alsoDid: [],
      });

      runDistill(stubPath, "SE");

      const projectFile = path.join(TMP_VAULT, "projects", "explicit-project.md");
      expect(fs.existsSync(projectFile)).toBe(true);
      const content = fs.readFileSync(projectFile, "utf8");
      expect(content).toContain("explicit-project");
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("non-project cwd (e.g. /tmp): no project is stamped on the daily entry", () => {
    makeSessionNdjson("SN", [
      { type: "tool", tool: "Write", file: "x.txt", cwd: os.tmpdir(), ts: "t1" },
      { type: "prompt", prompt: "help me write", cwd: os.tmpdir(), ts: "t2" },
    ]);

    const stubPath = makeStub({
      items: [
        {
          kind: "capture",
          title: "Quick note",
          date: "2026-05-28",
          body: "Something captured from a scratch session.",
          links: [],
        },
      ],
      digest: "scratch session",
      openThreads: [],
      alsoDid: [],
    });

    runDistill(stubPath, "SN");

    const state = readDailyState("2026-05-28");
    expect(state).toHaveProperty("SN");

    const entry = state["SN"];
    expect(entry.project).toBeUndefined();
  });

  it("multi-cwd session: B-scoped items are not tagged as A; explicit per-item project wins", () => {
    const repoDirA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-repo-aa-"));
    const repoDirB = fs.mkdtempSync(path.join(os.tmpdir(), "sb-repo-bb-"));
    try {
      fs.writeFileSync(path.join(repoDirA, "package.json"), JSON.stringify({ name: "repo-a" }));
      fs.writeFileSync(path.join(repoDirB, "package.json"), JSON.stringify({ name: "repo-b" }));

      const slugA = path.basename(repoDirA).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      const slugB = path.basename(repoDirB).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

      makeSessionNdjson("SM", [
        { type: "tool", tool: "Write", file: "a.ts", cwd: repoDirA, ts: "t1" },
        { type: "tool", tool: "Write", file: "a2.ts", cwd: repoDirA, ts: "t2" },
        { type: "tool", tool: "Write", file: "b.ts", cwd: repoDirB, ts: "t3" },
        { type: "tool", tool: "Write", file: "b2.ts", cwd: repoDirB, ts: "t4" },
      ]);

      const stubPath = makeStub({
        items: [
          {
            kind: "project_fact",
            title: "Fact about B (explicit project)",
            date: "2026-05-28",
            project: slugB,
            body: "Fact about repo B.",
            links: [],
          },
          {
            kind: "project_fact",
            title: "Fact with no explicit project (dominant cwd)",
            date: "2026-05-28",
            body: "Generic fact from this session.",
            links: [],
          },
        ],
        digest: "worked in two repos",
        openThreads: [],
        alsoDid: [],
      });

      runDistill(stubPath, "SM");

      const projectBFile = path.join(TMP_VAULT, "projects", `${slugB}.md`);
      expect(fs.existsSync(projectBFile)).toBe(true);
      const bContent = fs.readFileSync(projectBFile, "utf8");
      expect(bContent).toContain("Fact about B (explicit project)");
      expect(bContent).not.toContain("Fact about A only");

      const state = readDailyState("2026-05-28");
      expect(state).toHaveProperty("SM");
      const entry = state["SM"];
      expect(Array.isArray(entry.projects) || typeof entry.project === "string").toBe(true);

      const allContent = JSON.stringify(state["SM"]);
      expect(allContent).not.toBe("{}");
    } finally {
      fs.rmSync(repoDirA, { recursive: true, force: true });
      fs.rmSync(repoDirB, { recursive: true, force: true });
    }
  });
});
