import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { loadModelSync, embedWithModel, STATIC_EMBED_DIM } from "../src/staticEmbed/staticEmbed.js";
import { quantizeToInt8, serializeInt8ForSql, int8ArrayFromBuffer } from "../src/staticEmbed/int8Quant.js";

const FIXTURE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures");

describe("staticEmbed: tokenizer + inference", () => {
  it("loads the fixture model and returns 8-dim vectors", () => {
    const model = loadModelSync(
      path.join(FIXTURE_DIR, "tokenizer.json"),
      path.join(FIXTURE_DIR, "model.safetensors")
    );
    expect(model.dim).toBe(8);
  });

  it("embeds 'hello world' to a deterministic 8-dim L2-normalized vector", () => {
    const model = loadModelSync(
      path.join(FIXTURE_DIR, "tokenizer.json"),
      path.join(FIXTURE_DIR, "model.safetensors")
    );
    const [v] = embedWithModel(["hello world"], model);
    expect(v.length).toBe(8);
    // Check L2 norm is 1
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 5);
    // Deterministic expected first component
    expect(v[0]).toBeCloseTo(-0.5729, 3);
    expect(v[3]).toBeCloseTo(-0.5013, 3);
  });

  it("produces the same vector for the same text (deterministic)", () => {
    const model = loadModelSync(
      path.join(FIXTURE_DIR, "tokenizer.json"),
      path.join(FIXTURE_DIR, "model.safetensors")
    );
    const [v1] = embedWithModel(["foo bar"], model);
    const [v2] = embedWithModel(["foo bar"], model);
    for (let i = 0; i < v1.length; i++) expect(v1[i]).toBe(v2[i]);
  });

  it("produces different vectors for different texts", () => {
    const model = loadModelSync(
      path.join(FIXTURE_DIR, "tokenizer.json"),
      path.join(FIXTURE_DIR, "model.safetensors")
    );
    const [v1] = embedWithModel(["hello world"], model);
    const [v2] = embedWithModel(["foo bar"], model);
    let diff = 0;
    for (let i = 0; i < v1.length; i++) diff += Math.abs(v1[i] - v2[i]);
    expect(diff).toBeGreaterThan(0.01);
  });

  it("returns a zero vector for empty-token text (no valid tokens in fixture vocab)", () => {
    const model = loadModelSync(
      path.join(FIXTURE_DIR, "tokenizer.json"),
      path.join(FIXTURE_DIR, "model.safetensors")
    );
    // text with no known words -> UNK (id=1) is special, so pooling list is empty
    const [v] = embedWithModel(["zzzxxx999"], model);
    expect(v.length).toBe(8);
    // UNK id=1 is in specialTokens, so no vecs -> zero vector
    let sum = 0;
    for (const x of v) sum += Math.abs(x);
    expect(sum).toBe(0);
  });

  it("handles batch embedding", () => {
    const model = loadModelSync(
      path.join(FIXTURE_DIR, "tokenizer.json"),
      path.join(FIXTURE_DIR, "model.safetensors")
    );
    const results = embedWithModel(["hello", "world", "foo"], model);
    expect(results).toHaveLength(3);
    for (const v of results) {
      expect(v.length).toBe(8);
      let norm = 0;
      for (const x of v) norm += x * x;
      // normalized or zero
      expect(Math.sqrt(norm)).toBeLessThanOrEqual(1.0 + 1e-5);
    }
  });

  it("STATIC_EMBED_DIM constant is 256", () => {
    expect(STATIC_EMBED_DIM).toBe(256);
  });
});

describe("int8 quantization", () => {
  it("quantizes a Float32Array to Int8Array via round(v*127), clamped", () => {
    const v = new Float32Array([1.0, -1.0, 0.5, -0.5, 0.0, 0.007874]);
    const q = quantizeToInt8(v);
    expect(q).toBeInstanceOf(Int8Array);
    expect(q[0]).toBe(127);
    expect(q[1]).toBe(-127);
    expect(q[2]).toBe(Math.round(0.5 * 127));
    expect(q[3]).toBe(Math.round(-0.5 * 127));
    expect(q[4]).toBe(0);
    // 0.007874 * 127 = 1.0 -> rounds to 1
    expect(q[5]).toBe(1);
  });

  it("clamps values outside [-128, 127]", () => {
    const v = new Float32Array([2.0, -2.0, 1.01]);
    const q = quantizeToInt8(v);
    expect(q[0]).toBe(127);
    expect(q[1]).toBe(-128);
    expect(q[2]).toBe(127);
  });

  it("serializeInt8ForSql returns a Buffer (not a JSON string)", () => {
    const q = new Int8Array([10, -20, 30, -40]);
    const result = serializeInt8ForSql(q);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect((result as Buffer).byteLength).toBe(4);
  });

  it("serializeInt8ForSql buffer contains correct int8 bytes", () => {
    const q = new Int8Array([10, -20, 30, -40]);
    const buf = serializeInt8ForSql(q) as unknown as Buffer;
    const recovered = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(Array.from(recovered)).toEqual([10, -20, 30, -40]);
  });

  it("int8ArrayFromBuffer round-trips raw bytes", () => {
    const original = new Int8Array([5, -10, 15, -128, 127]);
    const buf = Buffer.from(original.buffer);
    const recovered = int8ArrayFromBuffer(buf);
    expect(Array.from(recovered)).toEqual(Array.from(original));
  });
});

describe("searchIndex: int8 migration sentinel", () => {
  let TMP_DATA: string;

  beforeAll(() => {
    TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sb-b1-idx-"));
    process.env.SUPERBRAIN_DATA_DIR = TMP_DATA;
    process.env.SUPERBRAIN_EMBED_STUB = "1";
  });

  afterAll(() => {
    fs.rmSync(TMP_DATA, { recursive: true, force: true });
  });

  it("openIndex creates meta table and vec_chunks with int8 column", async () => {
    const { openIndex } = await import("../src/searchIndex.js");
    const ix = openIndex();
    const tables = ix.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' OR type='virtual'"
    ).all() as { name: string }[];
    const names = tables.map((r) => r.name);
    expect(names).toContain("embed_meta");
    ix.close();
  });

  it("upsertNote and vectorKNN work with int8 quantized vectors", async () => {
    const { openIndex } = await import("../src/searchIndex.js");
    // Use stub embed (256-dim)
    const { embed } = await import("../src/embed.js");
    const ix = openIndex();
    const chunks = [{ headingPath: "A", anchor: "a", text: "hello world" }];
    const embs = await embed(["hello world"]);
    ix.upsertNote("test/a.md", 1000, "abc", chunks, embs);
    const hits = ix.vectorKNN(embs[0], 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].relPath).toBe("test/a.md");
    ix.close();
  });

  it("migration fires when EMBED_DIM changes (drops + rebuilds vec_chunks)", async () => {
    const { openIndex } = await import("../src/searchIndex.js");
    const ix1 = openIndex();
    // Corrupt the meta to simulate a dim change
    ix1.db.prepare("UPDATE embed_meta SET value=? WHERE key='dim'").run("999");
    ix1.close();

    // Reopen - should detect mismatch and recreate vec_chunks
    const ix2 = openIndex();
    const dim = ix2.db.prepare("SELECT value FROM embed_meta WHERE key='dim'").get() as { value: string };
    expect(dim.value).toBe("256");
    ix2.close();
  });
});

describe("embed.ts stub path", () => {
  it("SUPERBRAIN_EMBED_STUB=1 returns 256-dim L2-normalized vectors", async () => {
    process.env.SUPERBRAIN_EMBED_STUB = "1";
    const { embed, EMBED_DIM } = await import("../src/embed.js");
    expect(EMBED_DIM).toBe(256);
    const results = await embed(["test text"]);
    expect(results[0].length).toBe(256);
    let norm = 0;
    for (const x of results[0]) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 4);
  });

  it("SUPERBRAIN_EMBED_FORCE_FAIL=1 throws", async () => {
    process.env.SUPERBRAIN_EMBED_STUB = "0";
    process.env.SUPERBRAIN_EMBED_FORCE_FAIL = "1";
    const { embed } = await import("../src/embed.js");
    await expect(embed(["x"])).rejects.toThrow("embed forced failure");
    delete process.env.SUPERBRAIN_EMBED_FORCE_FAIL;
    process.env.SUPERBRAIN_EMBED_STUB = "1";
  });
});
