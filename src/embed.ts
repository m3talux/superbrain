import crypto from "node:crypto";

export const EMBED_DIM = 384;
export const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

function stubVector(text: string): Float32Array {
  // Deterministic, input-sensitive pseudo-embedding for offline tests only.
  const v = new Float32Array(EMBED_DIM);
  let seed = crypto.createHash("sha256").update(text).digest();
  for (let i = 0; i < EMBED_DIM; i++) v[i] = (seed[i % seed.length] / 255) * 2 - 1;
  let n = Math.hypot(...v) || 1;
  for (let i = 0; i < EMBED_DIM; i++) v[i] /= n;
  return v;
}

let extractorPromise: Promise<any> | null = null;
async function getExtractor(): Promise<any> {
  if (!extractorPromise) {
    extractorPromise = import("@huggingface/transformers").then(({ pipeline, env }) => {
      env.allowRemoteModels = true; // fetched once, cached by the library
      return pipeline("feature-extraction", MODEL_ID);
    });
  }
  return extractorPromise;
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (process.env.SUPERBRAIN_EMBED_FORCE_FAIL === "1") throw new Error("embed forced failure (test)");
  if (process.env.SUPERBRAIN_EMBED_STUB === "1") return texts.map(stubVector);
  const extractor = await getExtractor();
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  const list: number[][] = out.tolist();
  return list.map((a) => Float32Array.from(a));
}
