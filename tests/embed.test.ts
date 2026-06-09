import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { embed, EMBED_DIM } from "../src/embed";

const FIXTURE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures");

describe("embed (stub seam)", () => {
  beforeEach(() => { process.env.SUPERBRAIN_EMBED_STUB = "1"; });

  it("returns one EMBED_DIM vector per input, deterministic and input-sensitive", async () => {
    const [a1] = await embed(["hello world"]);
    const [a2] = await embed(["hello world"]);
    const [b1] = await embed(["totally different"]);
    expect(a1.length).toBe(EMBED_DIM);
    expect(Array.from(a1)).toEqual(Array.from(a2));   // deterministic
    expect(Array.from(a1)).not.toEqual(Array.from(b1)); // input-sensitive
  });
});

/**
 * Wrong-model-dim seam (C1 hardening): if the model directory holds a model
 * whose dimension differs from EMBED_DIM (corrupt assets, wrong model swapped
 * in, future model change), embed() used to return wrong-width vectors and
 * the failure surfaced later as a cryptic sqlite-vec insert error deep inside
 * indexNote(). The guard must fail fast in embed() with an attributed error.
 */
describe("embed dim guard (real model path, 8-dim fixture model)", () => {
  let TMP_DATA: string;
  let TMP_VAULT: string;

  beforeEach(() => {
    delete process.env.SUPERBRAIN_EMBED_STUB;
    process.env.SUPERBRAIN_MODEL_DIR = FIXTURE_DIR; // fixture model is 8-dim; EMBED_DIM is 256
    TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dimguard-data-"));
    TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dimguard-vault-"));
    process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
    process.env.SUPERBRAIN_VAULT_DIR = TMP_VAULT;
  });

  afterEach(() => {
    process.env.SUPERBRAIN_EMBED_STUB = "1";
    delete process.env.SUPERBRAIN_MODEL_DIR;
    delete process.env.SUPERBRAIN_VAULT_DIR;
    fs.rmSync(TMP_DATA, { recursive: true, force: true });
    fs.rmSync(TMP_VAULT, { recursive: true, force: true });
  });

  it("embed() rejects with an attributed dim-mismatch error", async () => {
    await expect(embed(["hello world"])).rejects.toThrow(/embedding model dimension mismatch/);
    await expect(embed(["hello world"])).rejects.toThrow(new RegExp(`8.*${EMBED_DIM}|${EMBED_DIM}.*8`));
  });

  it("indexNote() surfaces the attributed error instead of dying inside sqlite-vec", async () => {
    fs.mkdirSync(path.join(TMP_VAULT, "decisions"), { recursive: true });
    fs.writeFileSync(path.join(TMP_VAULT, "decisions/a.md"), "## Decisions\nhello world content");
    const { indexNote } = await import("../src/indexer");
    await expect(indexNote("decisions/a.md")).rejects.toThrow(/embedding model dimension mismatch/);
  });
});
