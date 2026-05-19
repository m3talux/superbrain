import { it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { bm25Recall, hybridRecall } from "../src/recall";

const DIR = "/tmp/sb-corrupt";
let prevData: string | undefined;
let prevStub: string | undefined;

beforeEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  // A non-sqlite file at the index path => openIndex()'s WAL pragma throws.
  fs.writeFileSync(`${DIR}/index.db`, "this is definitely not a sqlite database");
  prevData = process.env.CLAUDE_PLUGIN_DATA;
  prevStub = process.env.SUPERBRAIN_EMBED_STUB;
  process.env.CLAUDE_PLUGIN_DATA = DIR;
  process.env.SUPERBRAIN_EMBED_STUB = "1";
});

afterEach(() => {
  if (prevData === undefined) delete process.env.CLAUDE_PLUGIN_DATA; else process.env.CLAUDE_PLUGIN_DATA = prevData;
  if (prevStub === undefined) delete process.env.SUPERBRAIN_EMBED_STUB; else process.env.SUPERBRAIN_EMBED_STUB = prevStub;
  fs.rmSync(DIR, { recursive: true, force: true });
});

it("bm25Recall returns [] on a corrupt index.db (spec §7), does not throw", async () => {
  await expect(bm25Recall("anything", 5)).resolves.toEqual([]);
});

it("hybridRecall returns [] on a corrupt index.db (spec §7), does not throw", async () => {
  await expect(hybridRecall("anything", 5)).resolves.toEqual([]);
});
