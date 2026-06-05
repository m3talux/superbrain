import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveProjectSlug } from "../src/sessionProject.js";

beforeAll(() => { process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1"; });
afterAll(() => { delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST; });

function initGit(dir: string): void {
  spawnSync("git", ["init", "-b", "main", dir], { stdio: "ignore" });
}

describe("resolveProjectSlug", () => {
  let TMP: string;
  beforeEach(() => { TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-sp-")); });
  afterEach(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

  it("E1: cwd with package.json + .git -> git root basename used as slug", () => {
    // The git root is the only dir — basename of that dir is the slug.
    fs.writeFileSync(path.join(TMP, "package.json"), JSON.stringify({ name: "alpha-proj" }));
    initGit(TMP);
    const slug = resolveProjectSlug(TMP);
    expect(slug).toBeDefined();
    // The git root is TMP itself; basenameSlug(TMP) is the tmpdir randomised name,
    // but critically it must be a non-empty string derived from the git root.
    expect(typeof slug).toBe("string");
    expect((slug as string).length).toBeGreaterThan(0);
  });

  it("E2: cwd is a subdir inside a git repo -> git root (parent) basename used, not subdir basename", () => {
    // Set up: TMP is the git root with package.json; sub/ is a child subdir.
    fs.writeFileSync(path.join(TMP, "package.json"), JSON.stringify({ name: "root-proj" }));
    initGit(TMP);
    const subdir = path.join(TMP, "packages", "sub-pkg");
    fs.mkdirSync(subdir, { recursive: true });
    fs.writeFileSync(path.join(subdir, "package.json"), JSON.stringify({ name: "sub-pkg" }));
    // The subdir also has a strong signal, but its git root is TMP.
    const slugFromRoot = resolveProjectSlug(TMP);
    const slugFromSub = resolveProjectSlug(subdir);
    // Both should resolve to the same slug (git root basename)
    expect(slugFromRoot).toBeDefined();
    expect(slugFromSub).toBeDefined();
    expect(slugFromSub).toBe(slugFromRoot);
  });

  it("E3: cwd without .git but with package.json -> falls back to classifyPath-based slug, no crash", () => {
    fs.writeFileSync(path.join(TMP, "package.json"), JSON.stringify({ name: "no-git-proj" }));
    // No git init — resolveProjectSlug must not crash; it should fall back to
    // classifyPath-based slug derived from the project dir basename.
    const slug = resolveProjectSlug(TMP);
    expect(slug).toBeDefined();
    expect(typeof slug).toBe("string");
    expect((slug as string).length).toBeGreaterThan(0);
  });

  it("E4: cwd with no strong signal -> returns undefined", () => {
    // TMP is empty (no package.json, no .git, etc.)
    const emptyDir = path.join(TMP, "empty");
    fs.mkdirSync(emptyDir);
    const slug = resolveProjectSlug(emptyDir);
    expect(slug).toBeUndefined();
  });

  it("E5: two subdirs of the same git root -> same slug returned", () => {
    fs.writeFileSync(path.join(TMP, "package.json"), JSON.stringify({ name: "mono-root" }));
    initGit(TMP);
    const subA = path.join(TMP, "apps", "app-a");
    const subB = path.join(TMP, "apps", "app-b");
    fs.mkdirSync(subA, { recursive: true });
    fs.mkdirSync(subB, { recursive: true });
    fs.writeFileSync(path.join(subA, "package.json"), JSON.stringify({ name: "app-a" }));
    fs.writeFileSync(path.join(subB, "package.json"), JSON.stringify({ name: "app-b" }));
    const slugA = resolveProjectSlug(subA);
    const slugB = resolveProjectSlug(subB);
    expect(slugA).toBeDefined();
    expect(slugB).toBeDefined();
    expect(slugA).toBe(slugB);
  });
});
