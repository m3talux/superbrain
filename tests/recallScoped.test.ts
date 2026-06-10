import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openIndex } from "../src/searchIndex.js";
import { hybridRecall } from "../src/recall.js";
import { embed } from "../src/embed.js";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rs-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
});

afterEach(() => {
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_EMBED_STUB;
  fs.rmSync(TMP, { recursive: true, force: true });
});

const isoDate = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
};

describe("recallScoped", () => {
  it("type filter keeps only matching note type", async () => {
    const [v] = await embed(["common query text"]);
    const ix = openIndex();
    ix.upsertNote("a.md", 1, "ha", [{ headingPath: "", anchor: "", text: "common query text decision" }], [v], "global", undefined, "decision", undefined);
    ix.upsertNote("b.md", 1, "hb", [{ headingPath: "", anchor: "", text: "common query text capture" }], [v], "global", undefined, "capture", undefined);
    ix.close();

    const results = await hybridRecall("common query text", 10, { type: "decision" });
    const paths = results.map((r) => r.relPath);
    expect(paths).toContain("a.md");
    expect(paths).not.toContain("b.md");
  });

  it("since filter drops notes older than the cutoff", async () => {
    const [v] = await embed(["time filter test note"]);
    const ix = openIndex();
    ix.upsertNote("recent.md", 1, "hr", [{ headingPath: "", anchor: "", text: "time filter test note recent" }], [v], "global", isoDate(10), undefined, undefined);
    ix.upsertNote("old.md", 1, "ho", [{ headingPath: "", anchor: "", text: "time filter test note old" }], [v], "global", isoDate(400), undefined, undefined);
    ix.upsertNote("undated.md", 1, "hu", [{ headingPath: "", anchor: "", text: "time filter test note undated" }], [v], "global", undefined, undefined, undefined);
    ix.close();

    const cutoff = isoDate(30);
    const results = await hybridRecall("time filter test note", 10, { since: cutoff });
    const paths = results.map((r) => r.relPath);
    expect(paths).toContain("recent.md");
    expect(paths).not.toContain("old.md");
    expect(paths).not.toContain("undated.md");
  });

  it("role filter keeps only matching agent_role", async () => {
    const [v] = await embed(["role filter test query"]);
    const ix = openIndex();
    ix.upsertNote("p.md", 1, "hp", [{ headingPath: "", anchor: "", text: "role filter test query planner" }], [v], "global", undefined, undefined, "planner");
    ix.upsertNote("e.md", 1, "he", [{ headingPath: "", anchor: "", text: "role filter test query engineer" }], [v], "global", undefined, undefined, "engineer");
    ix.close();

    const results = await hybridRecall("role filter test query", 10, { role: "planner" });
    const paths = results.map((r) => r.relPath);
    expect(paths).toContain("p.md");
    expect(paths).not.toContain("e.md");
  });

  it("role filter is a no-op when no note carries agent_role", async () => {
    const [v] = await embed(["role noop test query"]);
    const ix = openIndex();
    ix.upsertNote("x.md", 1, "hx", [{ headingPath: "", anchor: "", text: "role noop test query xray" }], [v], "global", undefined, undefined, undefined);
    ix.upsertNote("y.md", 1, "hy", [{ headingPath: "", anchor: "", text: "role noop test query yankee" }], [v], "global", undefined, undefined, undefined);
    ix.close();

    const withRole = await hybridRecall("role noop test query", 10, { role: "planner" });
    const withoutRole = await hybridRecall("role noop test query", 10);
    expect(withRole.map((r) => r.relPath).sort()).toEqual(withoutRole.map((r) => r.relPath).sort());
    expect(withRole.length).toBeGreaterThan(0);
  });

  it("project + type + since compose", async () => {
    const [v] = await embed(["compose filter test query"]);
    const cutoff = isoDate(30);
    const ix = openIndex();
    ix.upsertNote("match.md", 1, "hm", [{ headingPath: "", anchor: "", text: "compose filter test query match" }], [v], "alpha", isoDate(10), "decision", undefined);
    ix.upsertNote("wrong-proj.md", 1, "hwp", [{ headingPath: "", anchor: "", text: "compose filter test query wrong proj" }], [v], "beta", isoDate(10), "decision", undefined);
    ix.upsertNote("wrong-type.md", 1, "hwt", [{ headingPath: "", anchor: "", text: "compose filter test query wrong type" }], [v], "alpha", isoDate(10), "capture", undefined);
    ix.upsertNote("wrong-date.md", 1, "hwd", [{ headingPath: "", anchor: "", text: "compose filter test query wrong date" }], [v], "alpha", isoDate(400), "decision", undefined);
    ix.close();

    const results = await hybridRecall("compose filter test query", 10, {
      projectSlug: "alpha", type: "decision", since: cutoff,
    });
    const paths = results.map((r) => r.relPath);
    expect(paths).toContain("match.md");
    expect(paths).not.toContain("wrong-proj.md");
    expect(paths).not.toContain("wrong-type.md");
    expect(paths).not.toContain("wrong-date.md");
  });
});
