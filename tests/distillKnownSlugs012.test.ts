import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readKnownProjectSlugs } from "../src/distillRun";
import { filterToUniversal } from "../src/preferenceClassify";
import { slug } from "../src/router";

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-distill012-vault-"));
  fs.mkdirSync(path.join(TMP, "projects"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_KNOWN_SLUGS_OVERRIDE;
});

const BODY = `## Editor

- for my-app: use 2-space indent
- always run the linter before commit
`;

describe("readKnownProjectSlugs slug normalization (012)", () => {
  it("filename branch: a slug-collapsing project filename enumerates as its slug, not raw lowercase", () => {
    fs.writeFileSync(path.join(TMP, "projects/My_App.md"), "---\ntype: project\n---\n");
    const slugs = readKnownProjectSlugs(TMP);
    expect(slugs.has("my-app")).toBe(true);
    expect(slugs.has("my_app")).toBe(false);
  });

  it("REPRO: a `for my-app:` rule is demoted (not globalized) for projects/My_App.md", () => {
    fs.writeFileSync(path.join(TMP, "projects/My_App.md"), "---\ntype: project\n---\n");
    const knownSlugs = readKnownProjectSlugs(TMP);
    const { universalBody, demoted } = filterToUniversal(BODY, knownSlugs);
    expect(demoted).toEqual([
      { text: "for my-app: use 2-space indent", projectSlug: "my-app" },
    ]);
    expect(universalBody).toContain("always run the linter before commit");
    expect(universalBody).not.toContain("for my-app");
  });

  it("a `.`-bearing filename (my.app.md) also normalizes to my-app and demotes", () => {
    fs.writeFileSync(path.join(TMP, "projects/my.app.md"), "---\ntype: project\n---\n");
    const knownSlugs = readKnownProjectSlugs(TMP);
    expect(knownSlugs.has("my-app")).toBe(true);
    const { demoted } = filterToUniversal(BODY, knownSlugs);
    expect(demoted.map(d => d.projectSlug)).toContain("my-app");
  });

  it("CONTROL: an already-slugified filename (data-pipeline.md) is unaffected and still demotes", () => {
    fs.writeFileSync(path.join(TMP, "projects/data-pipeline.md"), "---\ntype: project\n---\n");
    const knownSlugs = readKnownProjectSlugs(TMP);
    expect(knownSlugs.has("data-pipeline")).toBe(true);
    const body = "## Editor\n\n- for data-pipeline: use tabs\n- be nice\n";
    const { demoted } = filterToUniversal(body, knownSlugs);
    expect(demoted).toEqual([
      { text: "for data-pipeline: use tabs", projectSlug: "data-pipeline" },
    ]);
  });

  it("override branch: a non-slug override value normalizes through slug()", () => {
    process.env.SUPERBRAIN_KNOWN_SLUGS_OVERRIDE = "My_App, Data Pipeline";
    const slugs = readKnownProjectSlugs(TMP);
    expect(slugs.has("my-app")).toBe(true);
    expect(slugs.has("data-pipeline")).toBe(true);
    expect(slugs.has("my_app")).toBe(false);
  });

  it("override branch: blank/empty segments are dropped, no \"untitled\" leaks in", () => {
    process.env.SUPERBRAIN_KNOWN_SLUGS_OVERRIDE = "alpha,, ,beta";
    const slugs = readKnownProjectSlugs(TMP);
    expect([...slugs].sort()).toEqual(["alpha", "beta"]);
    expect(slugs.has("untitled")).toBe(false);
  });
});
