import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openIndex } from "../src/searchIndex";
import { handleSearch } from "../src/mcpSearch";
import { embed } from "../src/embed";

let TMP: string;

beforeEach(async () => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-msc-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
});

afterEach(() => {
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_EMBED_STUB;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("handleSearch scoped", () => {
  it("project param routes through scoped recall", async () => {
    const [v] = await embed(["scoped recall project test note"]);
    const ix = openIndex();
    ix.upsertNote("projects/alpha/a.md", 1, "ha", [{ headingPath: "", anchor: "", text: "scoped recall project test note alpha" }], [v], "alpha");
    ix.upsertNote("projects/beta/b.md", 1, "hb", [{ headingPath: "", anchor: "", text: "scoped recall project test note beta" }], [v], "beta");
    ix.close();

    const r = await handleSearch({ query: "scoped recall project test note", project: "alpha" });
    const text = r.content[0].text;
    expect(text).toMatch(/alpha/);
    expect(text).not.toMatch(/beta/);
  });

  it("type param filters", async () => {
    const [v] = await embed(["type filter mcp search note"]);
    const ix = openIndex();
    ix.upsertNote("decisions/d.md", 1, "hd", [{ headingPath: "", anchor: "", text: "type filter mcp search note decision" }], [v], "global", undefined, "decision");
    ix.upsertNote("captures/c.md", 1, "hc", [{ headingPath: "", anchor: "", text: "type filter mcp search note capture" }], [v], "global", undefined, "capture");
    ix.close();

    const r = await handleSearch({ query: "type filter mcp search note", type: "decision" });
    const text = r.content[0].text;
    expect(text).toMatch(/decisions\/d/);
    expect(text).not.toMatch(/captures\/c/);
  });

  it("k cap stays 20 under scoped params", async () => {
    const [v] = await embed(["k cap test alpha note"]);
    const ix = openIndex();
    for (let i = 0; i < 25; i++) {
      ix.upsertNote(`projects/alpha/n${i}.md`, 1, `h${i}`, [{ headingPath: "", anchor: "", text: `k cap test alpha note ${i}` }], [v], "alpha");
    }
    ix.close();

    const r = await handleSearch({ query: "k cap test alpha note", k: 999, project: "alpha" });
    const text = r.content[0].text;
    const matches = text.match(/^\d+\. /gm) ?? [];
    expect(matches.length).toBeLessThanOrEqual(20);
  });
});
