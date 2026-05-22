import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../bin/sb-recall.ts"),
  "utf8"
);

describe("sb-recall hook uses hybridRecall", () => {
  it("imports hybridRecall from recall.js", () => {
    expect(SRC).toMatch(/hybridRecall/);
  });

  it("does not call bm25Recall", () => {
    expect(SRC).not.toMatch(/bm25Recall/);
  });
});
