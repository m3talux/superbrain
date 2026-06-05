/**
 * Model2Vec / potion-base-8M static embedding inference.
 * Adapted from @yarflam/potion-base-8m (MIT). See LICENSE.attribution.
 *
 * Pipeline: normalize -> WordPiece tokenize -> token row lookup ->
 *           mean-pool non-special tokens -> L2-normalize -> 256-dim Float32Array.
 */
import { loadTokenizerSync, tokenizeSync, type TokenizerData } from "./tokenizer.js";
import { loadSafetensorsSync } from "./tensorLoader.js";
import { ensureModelAssets, modelAssetPath } from "./modelCache.js";

export const STATIC_EMBED_DIM = 256;

interface LoadedModel {
  tok: TokenizerData;
  matrix: Float32Array;
  dim: number;
}

let cached: LoadedModel | null = null;

export function loadModelSync(tokenizerPath: string, safetensorsPath: string): LoadedModel {
  const tok = loadTokenizerSync(tokenizerPath);
  const tensors = loadSafetensorsSync(safetensorsPath);
  const key = Object.keys(tensors).find(
    (k) => k === "embeddings" || k.includes("embeddings.weight") || k.includes("embedding.weight")
  );
  if (!key) throw new Error(`No embeddings tensor found. Keys: ${Object.keys(tensors).join(", ")}`);
  const matrix = tensors[key];
  const vocabSize = Object.keys(tok.vocab).length;
  const dim = matrix.length / vocabSize;
  if (!Number.isInteger(dim)) throw new Error(`Matrix size ${matrix.length} not divisible by vocab size ${vocabSize}`);
  return { tok, matrix, dim };
}

export async function getModel(): Promise<LoadedModel> {
  if (cached) return cached;
  await ensureModelAssets();
  cached = loadModelSync(modelAssetPath("tokenizer.json"), modelAssetPath("model.safetensors"));
  return cached;
}

export function embedWithModel(texts: string[], model: LoadedModel): Float32Array[] {
  const { tok, matrix, dim } = model;
  return texts.map((text) => {
    const ids = tokenizeSync(text, tok);
    const vecs: Float32Array[] = [];
    for (const id of ids) {
      if (!tok.specialTokens.has(id) && id * dim < matrix.length) {
        vecs.push(matrix.subarray(id * dim, id * dim + dim));
      }
    }
    if (vecs.length === 0) return new Float32Array(dim);
    const pooled = new Float32Array(dim);
    for (const v of vecs) for (let i = 0; i < dim; i++) pooled[i] += v[i];
    for (let i = 0; i < dim; i++) pooled[i] /= vecs.length;
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += pooled[i] * pooled[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < dim; i++) pooled[i] /= norm;
    return pooled;
  });
}
