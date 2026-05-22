import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planRetro, applyRetro } from "../scripts/retro-collapse-duplicates.js";

describe("retroCollapseDuplicates", () => {
  let vault: string;
  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "rcd-"));
    fs.mkdirSync(path.join(vault, "capture"), { recursive: true });
    fs.mkdirSync(path.join(vault, "daily"), { recursive: true });
  });

  it("identifies a duplicate cluster by similar slug prefix", () => {
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-superbrain-manual-inject-a.md"), "body A");
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-superbrain-manual-inject-b.md"), "body B");
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-superbrain-manual-inject-c.md"), "body C");
    const plan = planRetro(vault);
    expect(plan.collapses.length).toBeGreaterThan(0);
    const cluster = plan.collapses[0];
    expect(cluster.canonical).toMatch(/superbrain-manual-inject/);
    expect(cluster.duplicates.length).toBe(2);
  });

  it("moves capture/*-daily-* to daily/ when not already present", () => {
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-daily-2026-05-20.md"), "today's work");
    const plan = planRetro(vault);
    const dr = plan.dailyRoutes.find(p => p.source.includes("daily-2026-05-20"));
    expect(dr?.action).toBe("move");
    expect(dr?.target).toBe("daily/2026-05-20.md");
  });

  it("deletes capture/*-daily-* when daily/<date>.md exists", () => {
    fs.writeFileSync(path.join(vault, "daily", "2026-05-20.md"), "real daily");
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-daily-2026-05-20.md"), "stale capture");
    const plan = planRetro(vault);
    const dr = plan.dailyRoutes.find(p => p.source.includes("daily-2026-05-20"));
    expect(dr?.action).toBe("delete");
  });

  it("applyRetro collapses duplicates and removes them from disk", () => {
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-foo-bar-aaa.md"), "A");
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-foo-bar-bbb.md"), "B");
    const plan = planRetro(vault);
    applyRetro(vault, plan);
    // One file should remain (the canonical); the other gone
    const remaining = fs.readdirSync(path.join(vault, "capture"));
    expect(remaining.length).toBe(1);
    const text = fs.readFileSync(path.join(vault, "capture", remaining[0]), "utf8");
    expect(text).toContain("Original from"); // merged content marker
  });

  it("does not create spurious clusters from dissimilar slugs", () => {
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-alpha-concept.md"), "alpha");
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-beta-concept.md"), "beta");
    const plan = planRetro(vault);
    expect(plan.collapses.length).toBe(0);
  });

  it("applyRetro moves a mis-routed daily capture when daily does not exist", () => {
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-daily-2026-05-20.md"), "today's work");
    const plan = planRetro(vault);
    applyRetro(vault, plan);
    expect(fs.existsSync(path.join(vault, "daily", "2026-05-20.md"))).toBe(true);
    expect(fs.existsSync(path.join(vault, "capture", "2026-05-20-daily-2026-05-20.md"))).toBe(false);
  });

  it("applyRetro deletes a mis-routed daily capture when real daily exists", () => {
    fs.writeFileSync(path.join(vault, "daily", "2026-05-20.md"), "real daily");
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-daily-2026-05-20.md"), "stale capture");
    const plan = planRetro(vault);
    applyRetro(vault, plan);
    expect(fs.existsSync(path.join(vault, "capture", "2026-05-20-daily-2026-05-20.md"))).toBe(false);
    expect(fs.readFileSync(path.join(vault, "daily", "2026-05-20.md"), "utf8")).toBe("real daily");
  });

  it("selects the longest file as canonical", () => {
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-foo-bar-aaa.md"), "short");
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-foo-bar-bbb.md"), "much longer body content here");
    const plan = planRetro(vault);
    expect(plan.collapses.length).toBe(1);
    expect(plan.collapses[0].canonical).toContain("bbb");
  });

  it("handles multiple folders independently", () => {
    fs.mkdirSync(path.join(vault, "decisions"), { recursive: true });
    // Two duplicates in capture
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-jarvis-vision-overview.md"), "cap A");
    fs.writeFileSync(path.join(vault, "capture", "2026-05-20-jarvis-vision-summary.md"), "cap B");
    // Unrelated in decisions — should not cross-folder merge
    fs.writeFileSync(path.join(vault, "decisions", "2026-05-20-jarvis-vision-decision.md"), "dec A");
    const plan = planRetro(vault);
    // Should find a collapse within capture only
    const capCollapse = plan.collapses.find(c => c.canonical.startsWith("capture/"));
    expect(capCollapse).toBeDefined();
    // decisions file should not be in any collapse's duplicates list
    const allDups = plan.collapses.flatMap(c => c.duplicates);
    expect(allDups.some(d => d.startsWith("decisions/"))).toBe(false);
  });
});
