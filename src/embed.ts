import crypto from "node:crypto";
import { getModel, embedWithModel } from "./staticEmbed/staticEmbed.js";

export const EMBED_DIM = 256;
export const MODEL_ID = "minishlab/potion-base-8M";

function stubVector(text: string): Float32Array {
  // Deterministic, input-sensitive pseudo-embedding for offline tests only.
  const v = new Float32Array(EMBED_DIM);
  const seed = crypto.createHash("sha256").update(text).digest();
  for (let i = 0; i < EMBED_DIM; i++) v[i] = (seed[i % seed.length] / 255) * 2 - 1;
  let n = Math.hypot(...v) || 1;
  for (let i = 0; i < EMBED_DIM; i++) v[i] /= n;
  return v;
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (process.env.SUPERBRAIN_EMBED_FORCE_FAIL === "1") throw new Error("embed forced failure (test)");
  if (process.env.SUPERBRAIN_EMBED_STUB === "1") return texts.map(stubVector);
  const model = await getModel();
  return embedWithModel(texts, model);
}
