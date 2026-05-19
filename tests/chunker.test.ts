import { describe, it, expect } from "vitest";
import { chunkNote } from "../src/chunker";

describe("chunkNote", () => {
  it("splits body at ## / ### headings with breadcrumb headingPath", () => {
    const raw = [
      "---", "type: project", "status: active", "---",
      "preamble line",
      "## Decisions",
      "chose X over Y",
      "### Detail",
      "because Z",
      "## Gotchas",
      "- bug: never relearn",
    ].join("\n");
    const c = chunkNote(raw);
    expect(c.map((x) => x.headingPath)).toEqual(["", "Decisions", "Decisions > Detail", "Gotchas"]);
    expect(c[0].text).toContain("preamble line");
    expect(c[1].text).toContain("chose X over Y");
    expect(c[3].anchor).toBe("gotchas");
    expect(c.every((x) => x.text.trim().length > 0)).toBe(true);
  });
  it("a note with no headings yields a single chunk", () => {
    const c = chunkNote("---\ntype: capture\nstatus: active\n---\njust body text");
    expect(c.length).toBe(1);
    expect(c[0].headingPath).toBe("");
    expect(c[0].text).toContain("just body text");
  });
  it("drops empty sections", () => {
    const c = chunkNote("# A\n\n## B\n\ncontent");
    expect(c.find((x) => x.headingPath === "A")).toBeUndefined();
    expect(c.find((x) => x.headingPath === "A > B")?.text).toContain("content");
  });
});
