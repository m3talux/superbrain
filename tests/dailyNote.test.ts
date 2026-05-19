import { it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { upsertDay } from "../src/dailyState";
import { buildDailyNote } from "../src/dailyNote";

beforeEach(() => {
  fs.rmSync("/tmp/sb-dn", { recursive: true, force: true });
  process.env.CLAUDE_PLUGIN_DATA = "/tmp/sb-dn";
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
