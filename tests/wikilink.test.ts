import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveLinks } from "../src/wikilink.js";

let vault: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "sb-wikilink-"));
  for (const f of ["projects", "decisions", "lessons", "capture", "people", "daily"]) {
    fs.mkdirSync(path.join(vault, f), { recursive: true });
  }
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

function touch(rel: string) {
  fs.writeFileSync(path.join(vault, rel), "---\ntype: x\n---\n");
}

describe("resolveLinks", () => {
  it("returns empty for empty input", () => {
    expect(resolveLinks([], vault)).toEqual([]);
  });

  it("passes through valid full relative-path links", () => {
    touch("projects/superbrain.md");
    expect(resolveLinks(["projects/superbrain"], vault)).toEqual(["projects/superbrain"]);
  });

  it("strips [[ ]] wrappers and .md suffix before resolving", () => {
    touch("projects/superbrain.md");
    expect(resolveLinks(["[[projects/superbrain.md]]"], vault)).toEqual(["projects/superbrain"]);
  });

  it("resolves a bare basename to its real folder", () => {
    touch("projects/jarvis.md");
    expect(resolveLinks(["jarvis"], vault)).toEqual(["projects/jarvis"]);
  });

  it("resolves a bare basename by token-subset match against date-prefixed files", () => {
    touch("capture/2026-05-20-jarvis-founding-vision-claude-code-orchestrator-with-avenger.md");
    expect(resolveLinks(["jarvis-vision"], vault)).toEqual([
      "capture/2026-05-20-jarvis-founding-vision-claude-code-orchestrator-with-avenger",
    ]);
  });

  it("drops links with no real target", () => {
    touch("projects/superbrain.md");
    expect(resolveLinks(["jarvis-architecture-decision", "project_jarvis_orchestrator"], vault)).toEqual([]);
  });

  it("drops a relative-path link when the file does not exist", () => {
    expect(resolveLinks(["projects/does-not-exist"], vault)).toEqual([]);
  });

  it("dedups equivalent resolutions", () => {
    touch("projects/superbrain.md");
    expect(resolveLinks(["superbrain", "projects/superbrain", "[[superbrain]]"], vault)).toEqual([
      "projects/superbrain",
    ]);
  });

  it("prefers projects/ over capture/ when basename matches multiple files", () => {
    touch("projects/jarvis.md");
    touch("capture/2026-05-20-jarvis-side-thought.md");
    expect(resolveLinks(["jarvis"], vault)).toEqual(["projects/jarvis"]);
  });

  it("does not match on a single shared token", () => {
    touch("capture/2026-05-20-jarvis-founding-vision.md");
    expect(resolveLinks(["jarvis"], vault)).toEqual([]);
  });

  it("returns empty on a non-existent vault root without crashing", () => {
    expect(resolveLinks(["anything"], path.join(vault, "does-not-exist"))).toEqual([]);
  });

  it("resolves links case-insensitively (Alpha-proj -> projects/alpha-proj)", () => {
    touch("projects/alpha-proj.md");
    expect(resolveLinks(["Alpha-proj"], vault)).toEqual(["projects/alpha-proj"]);
    expect(resolveLinks(["ALPHA-PROJ"], vault)).toEqual(["projects/alpha-proj"]);
    expect(resolveLinks(["[[Engram]]"], vault)).toEqual([]);
  });

  it("resolves case-insensitive full relative paths (Projects/Alpha-proj -> projects/alpha-proj)", () => {
    touch("projects/alpha-proj.md");
    expect(resolveLinks(["Projects/Alpha-proj"], vault)).toEqual(["projects/alpha-proj"]);
  });

  it("strips leading ../ and ./ from links before resolving", () => {
    touch("people/thomas.md");
    expect(resolveLinks(["../people/thomas"], vault)).toEqual(["people/thomas"]);
    expect(resolveLinks(["./people/thomas"], vault)).toEqual(["people/thomas"]);
    expect(resolveLinks(["../../people/thomas"], vault)).toEqual(["people/thomas"]);
  });

  it("strips pipe alias before resolving (Obsidian [[target|alias]] form)", () => {
    touch("projects/alpha-proj.md");
    expect(resolveLinks(["alpha-proj|the alpha-proj project"], vault)).toEqual(["projects/alpha-proj"]);
    expect(resolveLinks(["[[alpha-proj|Alpha-proj]]"], vault)).toEqual(["projects/alpha-proj"]);
  });
});
