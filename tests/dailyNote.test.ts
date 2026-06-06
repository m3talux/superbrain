import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { upsertDay } from "../src/dailyState";
import { buildDailyNote } from "../src/dailyNote";
import { validateNote } from "../src/templates";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dn-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

it("merges sessions into a hybrid note (links, not bodies)", () => {
  upsertDay("2026-05-19", "S1", { digestLine: "Shipped Phase 2", routedRelPaths: ["decisions/2026-05-19-x.md"], alsoDid: ["reviewed PRs"], openThreads: ["Phase 3 spec"] });
  upsertDay("2026-05-19", "S2", { digestLine: "Designed Phase 3", routedRelPaths: ["projects/superbrain.md"], alsoDid: [], openThreads: [] });
  const r = buildDailyNote("2026-05-19");
  expect(r.relPath).toBe("daily/2026-05-19.md");
  expect(r.mode).toBe("replace");
  expect(r.frontmatter).toEqual({ type: "daily", created: "2026-05-19", updated: "2026-05-19" });
  expect(r.body).toContain("# 2026-05-19");
  expect(r.body).toContain("## Summary");
  expect(r.body).toContain("Shipped Phase 2");
  expect(r.body).toContain("Designed Phase 3");
  expect(r.body).toContain("## Decisions & gotchas");
  expect(r.body).toContain("[[decisions/2026-05-19-x]]");
  expect(r.body).toContain("[[projects/superbrain]]");
  expect(r.body).toContain("## Also did");
  expect(r.body).toContain("reviewed PRs");
  expect(r.body).toContain("## Threads open");
  expect(r.body).toContain("Phase 3 spec");
});

it("is idempotent (same sidecar => byte-identical body)", () => {
  upsertDay("2026-05-19", "S1", { digestLine: "d", routedRelPaths: ["a.md"], alsoDid: ["x"], openThreads: ["y"] });
  expect(buildDailyNote("2026-05-19").body).toBe(buildDailyNote("2026-05-19").body);
});

it("empty day yields a minimal valid note", () => {
  const r = buildDailyNote("2026-05-19");
  expect(r.body).toContain("# 2026-05-19");
  expect(r.frontmatter.type).toBe("daily");
});

it("round-trip: buildDailyNote body passes validateNote('daily')", () => {
  upsertDay("2026-05-20", "S1", {
    digestLine: "Implemented search index",
    routedRelPaths: ["decisions/2026-05-20-use-sqlite.md"],
    alsoDid: ["reviewed code"],
    openThreads: ["plan next sprint"],
  });
  const r = buildDailyNote("2026-05-20");
  const vr = validateNote("daily", r.body);
  expect(vr.valid).toBe(true);
  expect(vr.errors).toHaveLength(0);
});

it("round-trip: empty day body also passes validateNote('daily')", () => {
  const r = buildDailyNote("2026-05-21");
  const vr = validateNote("daily", r.body);
  expect(vr.valid).toBe(true);
  expect(vr.errors).toHaveLength(0);
});
