/**
 * Fetches and caches model assets for potion-base-8M on first use.
 * Model dir is overridable via SUPERBRAIN_MODEL_DIR (used in tests).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import { acquireLock, releaseLock } from "../lockfile.js";

const HF_BASE = "https://huggingface.co/minishlab/potion-base-8M/resolve/main";
const ASSETS = ["model.safetensors", "tokenizer.json"] as const;
const MIN_BYTES: Record<string, number> = { "model.safetensors": 20_000_000, "tokenizer.json": 100_000 };

export function modelDir(): string {
  if (process.env.SUPERBRAIN_MODEL_DIR) return process.env.SUPERBRAIN_MODEL_DIR;
  return path.join(os.homedir(), ".superbrain", "models", "potion-base-8M");
}

export function modelAssetPath(asset: (typeof ASSETS)[number]): string {
  return path.join(modelDir(), asset);
}

function downloadFile(url: string, dest: string, minSize: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmp = dest + ".part";
    const cleanup = () => { try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ } };
    const fail = (e: unknown) => { cleanup(); reject(e instanceof Error ? e : new Error(String(e))); };
    const follow = (u: string, depth: number) => {
      if (depth > 5) { fail(new Error(`too many redirects fetching ${url}`)); return; }
      let req;
      try {
        req = https.get(u, { headers: { "User-Agent": "superbrain/1 (node)" } }, (res) => {
          const code = res.statusCode ?? 0;
          if (code === 301 || code === 302 || code === 307 || code === 308) {
            res.resume();
            const loc = res.headers.location;
            if (!loc) { fail(new Error(`redirect without location fetching ${u}`)); return; }
            // HuggingFace may return a RELATIVE redirect; resolve it against the current url.
            let next: string;
            try { next = new URL(loc, u).toString(); } catch (e) { fail(e); return; }
            follow(next, depth + 1);
            return;
          }
          if (code !== 200) { res.resume(); fail(new Error(`HTTP ${code} fetching ${u}`)); return; }
          const expected = Number(res.headers["content-length"]) || 0;
          const out = fs.createWriteStream(tmp);
          res.on("error", (e) => { out.destroy(); fail(e); });
          out.on("error", (e) => fail(e));
          out.on("finish", () => {
            out.close(() => {
              let size = 0;
              try { size = fs.statSync(tmp).size; } catch { /* part missing */ }
              if (size < minSize || (expected > 0 && size !== expected)) {
                fail(new Error(`incomplete download for ${path.basename(dest)}: got ${size} bytes, expected ${expected || ">= " + minSize}`));
                return;
              }
              try { fs.renameSync(tmp, dest); resolve(); } catch (e) { fail(e); }
            });
          });
          res.pipe(out);
        });
      } catch (e) { fail(e); return; }
      req.setTimeout(60000, () => { req.destroy(new Error(`timeout fetching ${u}`)); });
      req.on("error", (e) => fail(e));
    };
    follow(url, 0);
  });
}

// Single-process lock + size verification so a truncated download can never
// leave a half-written model that silently pins recall to keyword-only.
export async function ensureModelAssets(): Promise<void> {
  const dir = modelDir();
  fs.mkdirSync(dir, { recursive: true });
  if (ASSETS.every((a) => fs.existsSync(path.join(dir, a)))) return;
  if (!acquireLock("model-download", { maxAgeMs: 15 * 60 * 1000 })) {
    throw new Error("model download already in progress in another process");
  }
  try {
    for (const asset of ASSETS) {
      const dest = path.join(dir, asset);
      if (fs.existsSync(dest)) continue;
      try { fs.rmSync(dest + ".part", { force: true }); } catch { /* ignore stale part */ }
      process.stderr.write(`[superbrain] downloading ${asset} from HuggingFace...\n`);
      await downloadFile(`${HF_BASE}/${asset}`, dest, MIN_BYTES[asset] ?? 0);
      process.stderr.write(`[superbrain] cached ${asset}\n`);
    }
  } finally {
    releaseLock("model-download");
  }
}
