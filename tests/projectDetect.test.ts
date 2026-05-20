import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { classifyPath, isBlockedPath, hasStrongSignal } from "../src/projectDetect";

const TMP = path.join(os.tmpdir(), `sb-pd-${process.pid}`);
const HOME = process.env.HOME || os.homedir();

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  // Most tests want to use /tmp paths without the blocklist firing.
  process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
});

describe("strong-signal detection", () => {
  it("recognizes .git as a strong signal (directory)", () => {
    const p = path.join(TMP, "a");
    fs.mkdirSync(path.join(p, ".git"), { recursive: true });
    expect(hasStrongSignal(p)).toBe(true);
  });
  it("recognizes .git as a strong signal (submodule gitlink file)", () => {
    const p = path.join(TMP, "submodule");
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, ".git"), "gitdir: ../.git/modules/sub\n");
    expect(hasStrongSignal(p)).toBe(true);
  });
  it.each([
    ["package.json", "{}"],
    ["pyproject.toml", "[tool.poetry]\nname=\"x\"\n"],
    ["go.mod", "module x\n"],
    ["Cargo.toml", "[package]\nname=\"x\"\n"],
    ["pom.xml", "<project/>"],
    ["Gemfile", "source 'x'\n"],
    ["CLAUDE.md", "# project\n"],
    [".mcp.json", "{}"],
  ])("recognizes %s as a strong signal", (file, content) => {
    const p = path.join(TMP, "x");
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, file), content);
    expect(hasStrongSignal(p)).toBe(true);
  });
  it("rejects README + LICENSE + Makefile (weak signals only, no manifest)", () => {
    const p = path.join(TMP, "weak");
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "README.md"), "# notes\n");
    fs.writeFileSync(path.join(p, "LICENSE"), "MIT\n");
    fs.writeFileSync(path.join(p, "Makefile"), "all:\n");
    expect(hasStrongSignal(p)).toBe(false);
  });
  it("recognizes a .xcodeproj bundle (suffix match)", () => {
    const p = path.join(TMP, "ios-proj");
    fs.mkdirSync(path.join(p, "MyApp.xcodeproj"), { recursive: true });
    expect(hasStrongSignal(p)).toBe(true);
  });
});

describe("blocklist (no bypass)", () => {
  beforeEach(() => { delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST; });

  // The literal "/" entry and the "/tmp/" prefix only exist on POSIX. On
  // Windows path.resolve("/") yields the current drive root, which is not in
  // the blocklist (correctly — Windows has no semantic equivalent here). The
  // HOME-relative paths (Documents, Downloads, etc.) DO exist on Windows so
  // they stay in the parameterized list either way.
  if (process.platform !== "win32") {
    it.each([
      "/",
      HOME,
      path.join(HOME, "Documents"),
      path.join(HOME, "Downloads"),
      path.join(HOME, "Desktop"),
      path.join(HOME, "Music"),
    ])("blocks exact path %s", (p) => {
      expect(isBlockedPath(p).blocked).toBe(true);
    });

    it("blocks /tmp prefix children", () => {
      expect(isBlockedPath("/tmp/anything").blocked).toBe(true);
    });
  } else {
    // Windows-equivalent: confirm HOME-relative exact paths still block.
    it.each([
      HOME,
      path.join(HOME, "Documents"),
      path.join(HOME, "Downloads"),
      path.join(HOME, "Desktop"),
      path.join(HOME, "Music"),
    ])("blocks exact path %s", (p) => {
      expect(isBlockedPath(p).blocked).toBe(true);
    });
  }

  it("blocks ~/.cache prefix children", () => {
    expect(isBlockedPath(path.join(HOME, ".cache", "anything")).blocked).toBe(true);
  });

  it("blocks ~/.ssh and ~/.aws (credential roots)", () => {
    expect(isBlockedPath(path.join(HOME, ".ssh", "stuff")).blocked).toBe(true);
    expect(isBlockedPath(path.join(HOME, ".aws", "credentials")).blocked).toBe(true);
  });

  it("blocks the cloud-sync provider roots but ALLOWS nested projects", () => {
    expect(isBlockedPath(path.join(HOME, "Library", "CloudStorage", "iCloudDrive")).blocked).toBe(true);
    // Anything under /Library is blocked by the prefix rule, so the subdir
    // case really applies to ~/Dropbox/projects/foo style — see next test.
  });

  it("allows ~/Dropbox subdir (cloud sync at $HOME root)", () => {
    expect(isBlockedPath(path.join(HOME, "Dropbox", "projects", "foo")).blocked).toBe(false);
    // But blocks ~/Dropbox itself.
    expect(isBlockedPath(path.join(HOME, "Dropbox")).blocked).toBe(true);
  });

  it("allows a normal Projects directory", () => {
    expect(isBlockedPath(path.join(HOME, "Projects", "anything")).blocked).toBe(false);
  });
});

describe("classifyPath cascade", () => {
  it("returns blocked when path is on the blocklist", () => {
    delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
    const c = classifyPath(HOME);
    expect(c.kind).toBe("blocked");
  });

  it("returns skip when no strong signal present (just README)", () => {
    const p = path.join(TMP, "no-signal");
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "README.md"), "# hi\n");
    const c = classifyPath(p);
    expect(c.kind).toBe("skip");
  });

  it("returns single when strong signal present and no umbrella", () => {
    const p = path.join(TMP, "solo");
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "package.json"), '{"name":"solo"}');
    const c = classifyPath(p);
    expect(c.kind).toBe("single");
    if (c.kind !== "single") return;
    expect(c.projectDir).toBe(path.resolve(p));
    expect(c.umbrella).toBeUndefined();
  });

  it("returns umbrella when ≥2 sub-projects are detected by heuristic", () => {
    const root = path.join(TMP, "the-we-project");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "CLAUDE.md"), "umbrella\n");  // root signal
    for (const name of ["backend", "app", "frontend"]) {
      const sub = path.join(root, name);
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, "package.json"), `{"name":"${name}"}`);
    }
    const c = classifyPath(root);
    expect(c.kind).toBe("umbrella");
    if (c.kind !== "umbrella") return;
    expect(c.children.length).toBe(3);
    expect(c.children.map(p => path.basename(p)).sort()).toEqual(["app", "backend", "frontend"]);
    expect(c.tool).toBe("implicit");
  });

  it("returns umbrella when an explicit pnpm workspace declaration exists", () => {
    const root = path.join(TMP, "pnpm-mono");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"root"}');
    fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
    for (const name of ["a", "b", "c"]) {
      const sub = path.join(root, "packages", name);
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, "package.json"), `{"name":"${name}"}`);
    }
    const c = classifyPath(root);
    expect(c.kind).toBe("umbrella");
    if (c.kind !== "umbrella") return;
    expect(c.tool).toBe("pnpm");
    expect(c.children.length).toBe(3);
  });

  it("treats a single subdir with a manifest as a single project, not an umbrella", () => {
    const root = path.join(TMP, "almost-umbrella");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"r"}');
    // Just one sub-project — should NOT trigger umbrella mode.
    const onlyChild = path.join(root, "tools");
    fs.mkdirSync(onlyChild, { recursive: true });
    fs.writeFileSync(path.join(onlyChild, "package.json"), '{"name":"tools"}');
    const c = classifyPath(root);
    expect(c.kind).toBe("single");
  });

  it("when opened directly inside an umbrella's sub-project, encodes umbrella context", () => {
    const root = path.join(TMP, "the-we-project-2");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "CLAUDE.md"), "umbrella\n");
    for (const name of ["backend", "app", "frontend"]) {
      const sub = path.join(root, name);
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, "go.mod"), `module ${name}\n`);
    }
    // User opens Claude directly in backend/ — we should still know the umbrella.
    const c = classifyPath(path.join(root, "backend"));
    expect(c.kind).toBe("single");
    if (c.kind !== "single") return;
    expect(c.umbrella).toBeDefined();
    expect(c.umbrella!.slug).toBe("the-we-project-2");
  });
});
