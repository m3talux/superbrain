import { openIndex, rrfWithScores } from "./searchIndex.js";
import { embed } from "./embed.js";
function toPointers(hits) {
    return hits.map((h) => ({
        relPath: h.relPath, headingPath: h.headingPath, anchor: h.anchor,
        excerpt: h.text.replace(/\s+/g, " ").trim().slice(0, 160),
    }));
}
const keyOf = (h) => `${h.relPath}#${h.anchor}`;
export async function bm25Recall(query, k) {
    let ix;
    try {
        ix = openIndex();
        return toPointers(ix.bm25(query, k));
    }
    catch {
        return [];
    }
    finally {
        ix?.close();
    }
}
export async function hybridRecall(query, k, opts) {
    let ix;
    try {
        ix = openIndex();
        const bm = ix.bm25(query, k * 2);
        let vec = [];
        try {
            const [qv] = await embed([query]);
            vec = ix.vectorKNN(qv, k * 2);
        }
        catch { /* degrade to bm25-only */ }
        // INTENTIONAL precision gate (Phase 2): if BM25 has zero lexical hits we return
        // nothing rather than vector-only neighbours. vectorKNN has no distance threshold
        // yet, so an ungated path would inject k irrelevant pointers into EVERY auto-
        // injected prompt (constant noise). Tradeoff: pure-semantic-only recall (zero
        // lexical overlap + high embedding similarity) is disabled until P2.1 adds a
        // calibrated vector-distance threshold. See docs/superpowers/specs/2026-05-19-superbrain-phase2-design.md §"Known limitation".
        if (bm.length === 0)
            return [];
        if (vec.length === 0) {
            const hits = bm.slice(0, k);
            if (!opts?.projectSlug)
                return toPointers(hits);
            const projects = ix.getProjectsForPaths([...new Set(hits.map((h) => h.relPath))]);
            const boosted = hits
                .map((h) => ({ h, score: boostScore(1, projects.get(h.relPath), opts.projectSlug) }))
                .sort((a, b) => b.score - a.score)
                .map((e) => e.h);
            return toPointers(boosted);
        }
        const byKey = new Map();
        [...bm, ...vec].forEach((h) => byKey.set(keyOf(h), h));
        const fused = rrfWithScores([bm.map(keyOf), vec.map(keyOf)], k * 2);
        if (opts?.projectSlug) {
            // Batch-lookup project for all candidate relPaths
            const candidateRelPaths = [...new Set(fused.map((e) => byKey.get(e.id)).filter(Boolean).map((h) => h.relPath))];
            const projects = ix.getProjectsForPaths(candidateRelPaths);
            const boosted = fused
                .map((e) => {
                const hit = byKey.get(e.id);
                if (!hit)
                    return null;
                return { id: e.id, score: boostScore(e.score, projects.get(hit.relPath), opts.projectSlug) };
            })
                .filter((e) => e !== null)
                .sort((a, b) => b.score - a.score)
                .slice(0, k);
            return toPointers(boosted.map((e) => byKey.get(e.id)).filter(Boolean));
        }
        return toPointers(fused.slice(0, k).map((e) => byKey.get(e.id)).filter(Boolean));
    }
    catch {
        return [];
    }
    finally {
        ix?.close();
    }
}
function boostScore(score, noteProject, projectSlug) {
    if (!projectSlug)
        return score;
    if (noteProject === projectSlug || noteProject === "global")
        return score * 2;
    return score;
}
