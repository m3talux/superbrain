import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reconcile } from "../src/indexer";
import { buildProjectIndex } from "../src/projectIndex";
import { parseNote } from "../src/frontmatter";

let TMP_DATA: string;
let TMP_VAULT: string;

beforeEach(() => {
  TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pidx-rec-data-"));
  TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-pidx-rec-vault-"));
  process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
  process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  process.env.SUPERBRAIN_EMBED_STUB = "1";

  fs.mkdirSync(path.join(TMP_VAULT, "projects"), { recursive: true });
  fs.mkdirSync(path.join(TMP_VAULT, "decisions"), { recursive: true });
  fs.mkdirSync(path.join(TMP_VAULT, "maps"), { recursive: true });

  fs.writeFileSync(
    path.join(TMP_VAULT, "projects/alpha.md"),
    "---\ntype: project\nstatus: active\nproject: alpha\n---\n# Alpha\n\n## Recent activity\n",
  );
  fs.writeFileSync(
    path.join(TMP_VAULT, "decisions/2026-01-01-pick-raft.md"),
    "---\ntype: decision\nstatus: active\nproject: alpha\n---\n# 2026-01-01 — Pick raft\n\nchose raft",
  );
});

afterEach(() => {
  fs.rmSync(TMP_DATA, { recursive: true, force: true });
  fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  delete process.env.SUPERBRAIN_DATA_DIR;
  delete process.env.SUPERBRAIN_VAULT_DIR;
  delete process.env.SUPERBRAIN_EMBED_STUB;
});

describe("projectIndexReconcile", () => {
  it("reconcile heals drift", async () => {
    fs.writeFileSync(
      path.join(TMP_VAULT, "maps/alpha-index.md"),
      "---\ntype: map\nproject: alpha\nsuperbrain: true\ngenerated: true\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n# alpha — index\n\n## Decisions\n\n- [[decisions/ghost]] — Ghost (stale)\n\n",
    );

    const expectedBody = buildProjectIndex("alpha");
    const expectedContent = parseNote(
      fs.readFileSync(path.join(TMP_VAULT, "maps/alpha-index.md"), "utf8"),
    ).content;

    fs.writeFileSync(
      path.join(TMP_VAULT, "maps/alpha-index.md"),
      "---\ntype: map\nproject: alpha\nsuperbrain: true\ngenerated: true\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n# alpha — index\n\n## Decisions\n\n- [[decisions/ghost]] — Ghost (stale)\n\n",
    );

    await reconcile();

    const { content: freshContent } = parseNote(
      fs.readFileSync(path.join(TMP_VAULT, "maps/alpha-index.md"), "utf8"),
    );

    expect(freshContent).toBe(expectedContent);
    expect(freshContent).toContain("[[decisions/2026-01-01-pick-raft]]");
    expect(freshContent).not.toContain("[[decisions/ghost]]");
    void expectedBody;

    fs.rmSync(path.join(TMP_VAULT, "maps/alpha-index.md"));
    await reconcile();
    expect(fs.existsSync(path.join(TMP_VAULT, "maps/alpha-index.md"))).toBe(true);
  });

  it("reconcile is idempotent on current index", async () => {
    await reconcile();

    expect(fs.existsSync(path.join(TMP_VAULT, "maps/alpha-index.md"))).toBe(true);
    const mtime1 = fs.statSync(path.join(TMP_VAULT, "maps/alpha-index.md")).mtimeMs;
    const body1 = parseNote(
      fs.readFileSync(path.join(TMP_VAULT, "maps/alpha-index.md"), "utf8"),
    ).content;

    await new Promise((r) => setTimeout(r, 20));

    await reconcile();

    const mtime2 = fs.statSync(path.join(TMP_VAULT, "maps/alpha-index.md")).mtimeMs;
    const body2 = parseNote(
      fs.readFileSync(path.join(TMP_VAULT, "maps/alpha-index.md"), "utf8"),
    ).content;

    expect(mtime2).toBe(mtime1);
    expect(body2).toBe(body1);
  });
});
