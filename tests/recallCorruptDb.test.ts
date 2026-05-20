import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bm25Recall, hybridRecall } from "../src/recall";

let TMP: string;
let prevData: string | undefined;
let prevStub: string | undefined;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sb-corrupt-"));
  // A non-sqlite file at the index path => openIndex()'s WAL pragma throws.
  fs.writeFileSync(path.join(TMP, "index.db"), "this is definitely not a sqlite database");
  prevData = process.env.SUPERBRAIN_DATA_DIR;
  prevStub = process.env.SUPERBRAIN_EMBED_STUB;
  process.env.SUPERBRAIN_DATA_DIR = TMP;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
});

afterEach(() => {
  if (prevData === undefined) delete process.env.SUPERBRAIN_DATA_DIR; else process.env.SUPERBRAIN_DATA_DIR = prevData;
  if (prevStub === undefined) delete process.env.SUPERBRAIN_EMBED_STUB; else process.env.SUPERBRAIN_EMBED_STUB = prevStub;
  // better-sqlite3 briefly retains the file handle on Windows after close();
  // maxRetries+retryDelay rides it out instead of failing with EBUSY.
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

it("bm25Recall returns [] on a corrupt index.db (spec §7), does not throw", async () => {
  await expect(bm25Recall("anything", 5)).resolves.toEqual([]);
});

it("hybridRecall returns [] on a corrupt index.db (spec §7), does not throw", async () => {
  await expect(hybridRecall("anything", 5)).resolves.toEqual([]);
});
