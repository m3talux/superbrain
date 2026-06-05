import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planRollup, applyRollup, type RollupPlan } from "../scripts/rollup-runaway-notes.js";

let TMP: string;
const CAP = 32 * 1024;

function bigLegacyNote(slug: string, sections: number): string {
  let body = `---\ntype: project\nstatus: active\nproject: ${slug}\n---\n\n# ${slug}\n\n## What it is\n\nx\n\n## Recent activity\n`;
  for (let i = 0; i < sections; i++) {
    const day = String((i % 27) + 1).padStart(2, "0");
    body += `\n## 2026-05-${day} 10:0${i % 10}\n\n${"z".repeat(500)}\n`;
  }
  return body;
}

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rollup-"));
  fs.mkdirSync(path.join(TMP, "projects"), { recursive: true });
});
afterEach(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

describe("planRollup", () => {
  it("flags only project notes over the cap", () => {
    fs.writeFileSync(path.join(TMP, "projects/huge.md"), bigLegacyNote("huge", 130));
    fs.writeFileSync(path.join(TMP, "projects/small.md"), bigLegacyNote("small", 2));
    const plan = planRollup(TMP, CAP);
    const slugs = plan.notes.map((n) => n.slug);
    expect(slugs).toContain("huge");
    expect(slugs).not.toContain("small");
  });

  it("reports a non-empty archive payload and a projected size at or under cap", () => {
    fs.writeFileSync(path.join(TMP, "projects/huge.md"), bigLegacyNote("huge", 130));
    const plan = planRollup(TMP, CAP);
    const note = plan.notes.find((n) => n.slug === "huge")!;
    expect(note.archivedSectionCount).toBeGreaterThan(0);
    expect(Buffer.byteLength(note.newBody, "utf8")).toBeLessThanOrEqual(CAP);
  });

  it("is a pure plan: planRollup does NOT modify any file", () => {
    const p = path.join(TMP, "projects/huge.md");
    fs.writeFileSync(p, bigLegacyNote("huge", 130));
    const before = fs.readFileSync(p, "utf8");
    planRollup(TMP, CAP);
    expect(fs.readFileSync(p, "utf8")).toBe(before);
  });
});

describe("applyRollup", () => {
  it("rewrites the live note <= cap, writes a project-tagged archive, snapshots original to .trash", () => {
    const p = path.join(TMP, "projects/huge.md");
    fs.writeFileSync(p, bigLegacyNote("huge", 130));
    const plan = planRollup(TMP, CAP);
    applyRollup(TMP, plan);

    expect(fs.statSync(p).size).toBeLessThanOrEqual(CAP);

    const archiveDir = path.join(TMP, "projects/_archive");
    const archives = fs.readdirSync(archiveDir).filter((f) => f.startsWith("huge-"));
    expect(archives.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(archiveDir, archives[0]), "utf8")).toContain("project: huge");

    const trash = fs.readdirSync(path.join(TMP, ".trash"));
    expect(trash.some((f) => f.includes("huge"))).toBe(true);
  });
});
