import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { openIndex } from "../src/searchIndex";
import { handleSearch } from "../src/mcpSearch";

beforeEach(() => {
  process.env.SUPERBRAIN_DATA_DIR = "/tmp/sb-mcps";
  process.env.SUPERBRAIN_EMBED_STUB = "1";
  fs.rmSync("/tmp/sb-mcps", { recursive: true, force: true });
  const ix = openIndex();
  ix.upsertNote("decisions/x.md", 1, "h",
    [{ headingPath: "", anchor: "", text: "adopted mcpvault then replaced it with an in-process writer" }],
    [Float32Array.from(Array(384).fill(0.2))]);
  ix.close();
});

describe("handleSearch", () => {
  it("returns formatted text content for a query", async () => {
    const r = await handleSearch({ query: "in-process writer", k: 3 });
    expect(r.content[0].type).toBe("text");
    expect(r.content[0].text).toMatch(/decisions\/x/);
  });
  it("returns a no-results message, never throws", async () => {
    const r = await handleSearch({ query: "nonexistent zzzzz", k: 3 });
    expect(r.content[0].text).toMatch(/no results/i);
  });
});
