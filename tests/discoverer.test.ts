import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  projectSlug, projectNotePath, isUnknownProject, looksLikeCodeProject,
  buildDiscoveryPrompt, runDiscover,
} from "../src/discoverer";

const TMP = path.join(os.tmpdir(), `sb-discover-${process.pid}`);

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  process.env.SUPERBRAIN_DATA_DIR = path.join(TMP, "data");
  process.env.SUPERBRAIN_VAULT_DIR = path.join(TMP, "vault");
  // Tests below use /tmp paths as fake projects; bypass the blocklist gate so
  // classifyPath doesn't reject them just for living under /tmp.
  process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
});

describe("discoverer — gates", () => {
  it("projectSlug uses the basename, hyphenated and lowercased", () => {
    expect(projectSlug("/Users/alex/Projects/Vibe/SuperBrain")).toBe("superbrain");
    expect(projectSlug("/tmp/My Cool Repo")).toBe("my-cool-repo");
  });

  it("isUnknownProject is true when no project note exists", () => {
    const proj = path.join(TMP, "fresh-project");
    fs.mkdirSync(proj, { recursive: true });
    expect(isUnknownProject(proj)).toBe(true);
  });

  it("isUnknownProject is false when a project note already exists", () => {
    const proj = path.join(TMP, "existing-project");
    fs.mkdirSync(proj, { recursive: true });
    const notePath = projectNotePath(proj);
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    fs.writeFileSync(notePath, "# existing\n");
    expect(isUnknownProject(proj)).toBe(false);
  });

  it("looksLikeCodeProject recognizes a .git dir", () => {
    const proj = path.join(TMP, "git-project");
    fs.mkdirSync(path.join(proj, ".git"), { recursive: true });
    expect(looksLikeCodeProject(proj)).toBe(true);
  });

  it("looksLikeCodeProject recognizes a package.json", () => {
    const proj = path.join(TMP, "npm-project");
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, "package.json"), "{}\n");
    expect(looksLikeCodeProject(proj)).toBe(true);
  });

  it("looksLikeCodeProject rejects a plain directory with no manifests", () => {
    const proj = path.join(TMP, "not-a-project");
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, "random.txt"), "hello\n");
    expect(looksLikeCodeProject(proj)).toBe(false);
  });
});

describe("discoverer — prompt construction", () => {
  it("includes every required section heading the model must produce", () => {
    const prompt = buildDiscoveryPrompt({
      projectDir: "/tmp/x", manifests: [], paths: ["a.ts"], truncated: false,
    });
    for (const heading of ["## Stack", "## Architecture", "## Top-level folders",
      "## Key files", "## Docs", "## Conventions", "## Open questions"]) {
      expect(prompt).toContain(heading);
    }
  });

  it("inlines each manifest's content as a code block in the prompt", () => {
    const prompt = buildDiscoveryPrompt({
      projectDir: "/tmp/x",
      manifests: [{ name: "package.json", content: '{"name":"foo"}' }],
      paths: [],
      truncated: false,
    });
    expect(prompt).toContain("## package.json");
    expect(prompt).toContain('{"name":"foo"}');
  });

  it("flags truncation in the source-paths section when the walk was capped", () => {
    const prompt = buildDiscoveryPrompt({
      projectDir: "/tmp/x", manifests: [], paths: ["a.ts", "b.ts"], truncated: true,
    });
    expect(prompt).toContain("TRUNCATED");
  });
});

describe("discoverer — runDiscover (stubbed)", () => {
  it("writes a project note with discovered:true frontmatter on success", async () => {
    const proj = path.join(TMP, "stub-project");
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, "package.json"), '{"name":"stub"}\n');

    const stubBody = "# Stub Project\n\n> A test project.\n\n## Stack\n- TypeScript\n";
    const stubPath = path.join(TMP, "discover-stub.md");
    fs.writeFileSync(stubPath, stubBody);
    process.env.SUPERBRAIN_DISCOVER_STUB = stubPath;

    try {
      await runDiscover(proj);
      const notePath = projectNotePath(proj);
      expect(fs.existsSync(notePath)).toBe(true);
      const written = fs.readFileSync(notePath, "utf8");
      expect(written).toContain("discovered: true");
      expect(written).toContain("# Stub Project");
      expect(written).toContain(`project: stub-project`);
    } finally {
      delete process.env.SUPERBRAIN_DISCOVER_STUB;
    }
  });

  it("does NOT overwrite an existing project note (idempotent)", async () => {
    const proj = path.join(TMP, "existing-project-2");
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, ".git"), "");  // dummy file so looksLike passes
    const notePath = projectNotePath(proj);
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    const original = "# existing user content — must not be clobbered\n";
    fs.writeFileSync(notePath, original);

    const stubPath = path.join(TMP, "discover-stub2.md");
    fs.writeFileSync(stubPath, "# discovered\n");
    process.env.SUPERBRAIN_DISCOVER_STUB = stubPath;
    try {
      await runDiscover(proj);
      expect(fs.readFileSync(notePath, "utf8")).toBe(original);
    } finally {
      delete process.env.SUPERBRAIN_DISCOVER_STUB;
    }
  });

  it("does not run on a non-code directory", async () => {
    const proj = path.join(TMP, "not-code");
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, "notes.txt"), "hi\n");
    const stubPath = path.join(TMP, "discover-stub3.md");
    fs.writeFileSync(stubPath, "# discovered\n");
    process.env.SUPERBRAIN_DISCOVER_STUB = stubPath;
    try {
      await runDiscover(proj);
      expect(fs.existsSync(projectNotePath(proj))).toBe(false);
    } finally {
      delete process.env.SUPERBRAIN_DISCOVER_STUB;
    }
  });
});

describe("discoverer — umbrella fan-out", () => {
  it("fans out into one note per sub-project, prefixing each slug with the umbrella name, NO umbrella note", async () => {
    const root = path.join(TMP, "the-we-project");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "CLAUDE.md"), "umbrella\n");
    for (const name of ["backend", "app", "frontend"]) {
      const sub = path.join(root, name);
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, "go.mod"), `module ${name}\n`);
    }
    const stubPath = path.join(TMP, "discover-umbrella-stub.md");
    fs.writeFileSync(stubPath, "# child\n\n> a sub-project\n\n## Stack\n- Go\n");
    process.env.SUPERBRAIN_DISCOVER_STUB = stubPath;
    try {
      await runDiscover(root);
      const vault = process.env.SUPERBRAIN_VAULT_DIR!;
      // Three child notes — prefixed by umbrella basename slug.
      for (const child of ["backend", "app", "frontend"]) {
        const note = path.join(vault, "projects", `the-we-project-${child}.md`);
        expect(fs.existsSync(note)).toBe(true);
        const content = fs.readFileSync(note, "utf8");
        expect(content).toContain("umbrella: the-we-project");
      }
      // NO umbrella note for the root itself.
      expect(fs.existsSync(path.join(vault, "projects", "the-we-project.md"))).toBe(false);
    } finally {
      delete process.env.SUPERBRAIN_DISCOVER_STUB;
    }
  });

  it("when opened directly inside a sub-project, prefixes the slug with the umbrella's name", async () => {
    const root = path.join(TMP, "umbrella2");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "CLAUDE.md"), "u\n");
    for (const name of ["a", "b", "c"]) {
      fs.mkdirSync(path.join(root, name), { recursive: true });
      fs.writeFileSync(path.join(root, name, "package.json"), `{"name":"${name}"}`);
    }
    const stubPath = path.join(TMP, "discover-direct-stub.md");
    fs.writeFileSync(stubPath, "# a\n");
    process.env.SUPERBRAIN_DISCOVER_STUB = stubPath;
    try {
      // User opens Claude inside the sub-project a/ directly.
      await runDiscover(path.join(root, "a"));
      const vault = process.env.SUPERBRAIN_VAULT_DIR!;
      expect(fs.existsSync(path.join(vault, "projects", "umbrella2-a.md"))).toBe(true);
      // No bare "a.md" — the umbrella prefix prevents the slug collision.
      expect(fs.existsSync(path.join(vault, "projects", "a.md"))).toBe(false);
    } finally {
      delete process.env.SUPERBRAIN_DISCOVER_STUB;
    }
  });

  it("hard-passes (no note, no spawn) on a blocked path", async () => {
    delete process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST;
    const stubPath = path.join(TMP, "blocked-stub.md");
    fs.writeFileSync(stubPath, "# x\n");
    process.env.SUPERBRAIN_DISCOVER_STUB = stubPath;
    try {
      // /tmp is on the prefix blocklist when bypass is off.
      await runDiscover("/tmp");
      const vault = process.env.SUPERBRAIN_VAULT_DIR!;
      // No projects/ directory should have been created.
      expect(fs.existsSync(path.join(vault, "projects"))).toBe(false);
    } finally {
      delete process.env.SUPERBRAIN_DISCOVER_STUB;
      process.env.SUPERBRAIN_TEST_BYPASS_BLOCKLIST = "1";
    }
  });
});
