import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureModelAssets } from "../src/staticEmbed/modelCache.js";

it("ensureModelAssets is a no-op when both assets already exist (no download, no re-validation)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-model-"));
  // Deliberately tiny files: if ensureModelAssets re-validated existing assets
  // against MIN_BYTES it would delete or reject these; it must not.
  fs.writeFileSync(path.join(dir, "model.safetensors"), "x");
  fs.writeFileSync(path.join(dir, "tokenizer.json"), "y");
  const prev = process.env.SUPERBRAIN_MODEL_DIR;
  process.env.SUPERBRAIN_MODEL_DIR = dir;
  try {
    await expect(ensureModelAssets()).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(dir, "model.safetensors"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "tokenizer.json"))).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.SUPERBRAIN_MODEL_DIR;
    else process.env.SUPERBRAIN_MODEL_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
