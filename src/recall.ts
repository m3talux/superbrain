import { openIndex, rrf, type Hit } from "./searchIndex.js";
import { embed } from "./embed.js";

export interface Pointer { relPath: string; headingPath: string; anchor: string; excerpt: string; }

function toPointers(hits: Hit[]): Pointer[] {
  return hits.map((h) => ({
    relPath: h.relPath, headingPath: h.headingPath, anchor: h.anchor,
    excerpt: h.text.replace(/\s+/g, " ").trim().slice(0, 160),
  }));
}
const keyOf = (h: Hit) => `${h.relPath}#${h.anchor}`;

export async function bm25Recall(query: string, k: number): Promise<Pointer[]> {
  const ix = openIndex();
  try { return toPointers(ix.bm25(query, k)); }
  catch { return []; }
  finally { ix.close(); }
}

export async function hybridRecall(query: string, k: number): Promise<Pointer[]> {
  const ix = openIndex();
  try {
    const bm = ix.bm25(query, k * 2);
    let vec: Hit[] = [];
    try {
      const [qv] = await embed([query]);
      vec = ix.vectorKNN(qv, k * 2);
    } catch { /* degrade to bm25-only */ }
    if (vec.length === 0) return toPointers(bm.slice(0, k));
    const byKey = new Map<string, Hit>();
    [...bm, ...vec].forEach((h) => byKey.set(keyOf(h), h));
    const fused = rrf([bm.map(keyOf), vec.map(keyOf)], k);
    return toPointers(fused.map((kk) => byKey.get(kk)!).filter(Boolean));
  } catch { return []; }
  finally { ix.close(); }
}
