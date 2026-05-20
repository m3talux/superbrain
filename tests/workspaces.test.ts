import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseNpmYarnBunWorkspaces, parsePnpmWorkspace, parseCargoWorkspace,
  parseGoWork, parseMavenModules, parseGradleSettings, parseLernaPackages,
  detectWorkspaces,
} from "../src/workspaces";

const TMP = path.join(os.tmpdir(), `sb-ws-${process.pid}`);

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
});

function mkdir(p: string) { fs.mkdirSync(p, { recursive: true }); }
function write(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

describe("npm / yarn / bun workspaces", () => {
  it("parses the array form and expands packages/* glob", () => {
    const root = path.join(TMP, "npm-ws");
    write(path.join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    for (const n of ["a", "b"]) write(path.join(root, "packages", n, "package.json"), `{"name":"${n}"}`);
    const c = parseNpmYarnBunWorkspaces(root);
    expect(c!.length).toBe(2);
    expect(c!.map(p => path.basename(p)).sort()).toEqual(["a", "b"]);
  });

  it("parses the yarn-classic { packages: [...] } form", () => {
    const root = path.join(TMP, "yarn-classic");
    write(path.join(root, "package.json"), JSON.stringify({ workspaces: { packages: ["apps/*"] } }));
    write(path.join(root, "apps", "web", "package.json"), '{"name":"web"}');
    const c = parseNpmYarnBunWorkspaces(root);
    expect(c!.map(p => path.basename(p))).toEqual(["web"]);
  });

  it("filters out children that lack a package.json", () => {
    const root = path.join(TMP, "npm-filter");
    write(path.join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    mkdir(path.join(root, "packages", "empty-dir"));
    write(path.join(root, "packages", "real", "package.json"), '{"name":"real"}');
    const c = parseNpmYarnBunWorkspaces(root);
    expect(c!.length).toBe(1);
    expect(path.basename(c![0])).toBe("real");
  });

  it("honors negation patterns", () => {
    const root = path.join(TMP, "npm-negate");
    write(path.join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*", "!packages/legacy"] }));
    for (const n of ["a", "legacy"]) write(path.join(root, "packages", n, "package.json"), `{"name":"${n}"}`);
    const c = parseNpmYarnBunWorkspaces(root);
    expect(c!.length).toBe(1);
    expect(path.basename(c![0])).toBe("a");
  });

  it("returns null when no workspaces field exists", () => {
    const root = path.join(TMP, "npm-none");
    write(path.join(root, "package.json"), '{"name":"x"}');
    expect(parseNpmYarnBunWorkspaces(root)).toBeNull();
  });
});

describe("pnpm-workspace.yaml", () => {
  it("parses the packages list", () => {
    const root = path.join(TMP, "pnpm-ws");
    write(path.join(root, "pnpm-workspace.yaml"), `packages:\n  - "packages/*"\n  - "apps/*"\n`);
    for (const p of ["packages/a", "packages/b", "apps/web"]) {
      write(path.join(root, p, "package.json"), `{"name":"${path.basename(p)}"}`);
    }
    const c = parsePnpmWorkspace(root);
    expect(c!.length).toBe(3);
  });

  it("honors negation entries", () => {
    const root = path.join(TMP, "pnpm-negate");
    write(path.join(root, "pnpm-workspace.yaml"), `packages:\n  - "packages/*"\n  - "!packages/old"\n`);
    for (const n of ["new", "old"]) write(path.join(root, "packages", n, "package.json"), `{"name":"${n}"}`);
    const c = parsePnpmWorkspace(root);
    expect(c!.length).toBe(1);
    expect(path.basename(c![0])).toBe("new");
  });
});

describe("Cargo workspaces", () => {
  it("parses [workspace] members with globs", () => {
    const root = path.join(TMP, "cargo-ws");
    write(path.join(root, "Cargo.toml"), `[workspace]\nmembers = ["crates/*", "tools/foo"]\n`);
    for (const p of ["crates/a", "crates/b", "tools/foo"]) {
      write(path.join(root, p, "Cargo.toml"), `[package]\nname="${path.basename(p)}"\n`);
    }
    const c = parseCargoWorkspace(root);
    expect(c!.length).toBe(3);
  });

  it("returns null on a single-crate Cargo.toml (no [workspace])", () => {
    const root = path.join(TMP, "cargo-single");
    write(path.join(root, "Cargo.toml"), '[package]\nname="solo"\n');
    expect(parseCargoWorkspace(root)).toBeNull();
  });
});

describe("Go workspaces (go.work)", () => {
  it("parses the use ( ... ) block form", () => {
    const root = path.join(TMP, "go-ws");
    write(path.join(root, "go.work"), `go 1.22\n\nuse (\n  ./svc-a\n  ./libs/foo\n)\n`);
    for (const p of ["svc-a", "libs/foo"]) write(path.join(root, p, "go.mod"), `module ${p}\n`);
    const c = parseGoWork(root);
    expect(c!.length).toBe(2);
    expect(c!.map(p => path.relative(root, p).replace(/\\/g, "/")).sort()).toEqual(["libs/foo", "svc-a"]);
  });

  it("parses single-line `use ./path` form", () => {
    const root = path.join(TMP, "go-single");
    write(path.join(root, "go.work"), `go 1.22\nuse ./api\n`);
    write(path.join(root, "api", "go.mod"), "module api\n");
    const c = parseGoWork(root);
    expect(c!.length).toBe(1);
  });
});

describe("Maven modules", () => {
  it("parses <modules><module>...</module></modules>", () => {
    const root = path.join(TMP, "maven");
    write(path.join(root, "pom.xml"), `<project>\n<modules>\n<module>service-a</module>\n<module>service-b</module>\n</modules>\n</project>\n`);
    for (const n of ["service-a", "service-b"]) write(path.join(root, n, "pom.xml"), "<project/>\n");
    const c = parseMavenModules(root);
    expect(c!.length).toBe(2);
  });
});

describe("Gradle multi-module", () => {
  it("parses include 'a', 'b:c' from settings.gradle", () => {
    const root = path.join(TMP, "gradle");
    write(path.join(root, "settings.gradle"), `rootProject.name = 'r'\ninclude 'app', 'lib:core'\n`);
    mkdir(path.join(root, "app"));
    mkdir(path.join(root, "lib", "core"));
    const c = parseGradleSettings(root);
    expect(c!.length).toBe(2);
    expect(c!.some(p => p.endsWith("app"))).toBe(true);
    expect(c!.some(p => p.endsWith(path.join("lib", "core")))).toBe(true);
  });

  it("parses include(...) call form from settings.gradle.kts", () => {
    const root = path.join(TMP, "gradle-kts");
    write(path.join(root, "settings.gradle.kts"), `include("a", "b")\n`);
    mkdir(path.join(root, "a"));
    mkdir(path.join(root, "b"));
    const c = parseGradleSettings(root);
    expect(c!.length).toBe(2);
  });
});

describe("Lerna packages", () => {
  it("parses lerna.json packages", () => {
    const root = path.join(TMP, "lerna");
    write(path.join(root, "lerna.json"), JSON.stringify({ packages: ["packages/*"] }));
    for (const n of ["a", "b"]) write(path.join(root, "packages", n, "package.json"), `{"name":"${n}"}`);
    const c = parseLernaPackages(root);
    expect(c!.length).toBe(2);
  });
});

describe("detectWorkspaces (top-level dispatch)", () => {
  it("prefers pnpm-workspace.yaml when both pnpm and npm workspaces are declared", () => {
    const root = path.join(TMP, "dual");
    write(path.join(root, "package.json"), JSON.stringify({ workspaces: ["apps/*"] }));
    write(path.join(root, "pnpm-workspace.yaml"), `packages:\n  - "packages/*"\n`);
    write(path.join(root, "packages", "p1", "package.json"), '{}');
    write(path.join(root, "apps", "a1", "package.json"), '{}');
    const r = detectWorkspaces(root);
    expect(r!.tool).toBe("pnpm");
  });

  it("returns null when no workspace declaration exists", () => {
    const root = path.join(TMP, "none");
    write(path.join(root, "package.json"), '{"name":"x"}');
    expect(detectWorkspaces(root)).toBeNull();
  });
});
