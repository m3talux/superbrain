import { openIndex, rrfWithScores } from "./searchIndex.js";
import { embed } from "./embed.js";
const VECTOR_DISTANCE_CUTOFF = 1.0;
function toPointers(hits) {
    return hits.map((h) => ({
        relPath: h.relPath, headingPath: h.headingPath, anchor: h.anchor,
        excerpt: h.text.replace(/\s+/g, " ").trim().slice(0, 160),
    }));
}
const keyOf = (h) => `${h.relPath}#${h.anchor}`;
/**
 * Fail-closed: when a project is active, notes with NULL project are treated as
 * cross-project (excluded). After backfill all notes are tagged; during the
 * transition window excluding ambiguous notes is the safe choice.
 */
function isCrossProject(noteProject, projectSlug) {
    if (noteProject == null)
        return true; // untagged = unknown origin = exclude
    return noteProject !== "global" && noteProject !== projectSlug;
}
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
        // --- Embed the query (always; bm25Only is removed) ---
        let qv;
        try {
            [qv] = await embed([query]);
        }
        catch { /* degrade to bm25-only if embedding fails */ }
        if (opts?.projectSlug) {
            return await hybridRecallWithProject(ix, query, k, opts.projectSlug, opts.excludeSlugs ?? [], qv);
        }
        return hybridRecallUnscoped(ix, query, k, opts?.excludeSlugs ?? [], qv);
    }
    catch {
        return [];
    }
    finally {
        ix?.close();
    }
}
/**
 * Unscoped recall: no project filter, all k slots go to the best-matching notes.
 * No background reservation when projectSlug is absent.
 */
function hybridRecallUnscoped(ix, query, k, excludeSlugs, qv) {
    const bm = ix.bm25(query, k * 2);
    let vec = [];
    if (qv) {
        const raw = ix.vectorKNN(qv, k * 2);
        // Gate fix: when BM25 also returned results, apply the distance cutoff to
        // filter noise. When BM25 returned nothing, skip the cutoff so vector
        // neighbours can surface even for queries with no lexical overlap.
        vec = bm.length > 0
            ? raw.filter((h) => h.distance == null || h.distance <= VECTOR_DISTANCE_CUTOFF)
            : raw;
    }
    // Gate fix: return empty only when BOTH arms return nothing.
    if (bm.length === 0 && vec.length === 0)
        return [];
    return applyFusionAndFilter(ix, bm, vec, k, excludeSlugs, undefined);
}
/**
 * Project-scoped recall: foreground (75%) from project notes + background (25%)
 * from a separate global-restricted query. The background is RESERVED — it is
 * filled even when project notes dominate and would otherwise fill all k slots.
 */
async function hybridRecallWithProject(ix, query, k, projectSlug, excludeSlugs, qv) {
    const fgSlots = Math.round(k * 0.75);
    const bgSlots = k - fgSlots;
    // Foreground: project-scoped query
    const bm = ix.bm25(query, fgSlots * 2);
    let vec = [];
    if (qv) {
        const raw = ix.vectorKNN(qv, fgSlots * 2);
        vec = raw.filter((h) => h.distance == null || h.distance <= VECTOR_DISTANCE_CUTOFF);
    }
    // Gate fix: if BM25 empty and vec empty, fall through to background only
    let foreground = [];
    if (bm.length > 0 || vec.length > 0) {
        foreground = applyFusionAndFilter(ix, bm, vec, fgSlots, excludeSlugs, projectSlug);
    }
    // Background: separate global-restricted query (always runs, never starved).
    // When the hybrid query yields fewer than bgSlots results, fill remaining
    // slots from any available global notes (most recently created first).
    let background = [];
    try {
        const bgBm = ix.bm25Global(query, bgSlots * 3);
        let bgVec = [];
        if (qv) {
            // Use full candidate set (no distance cutoff) to ensure background fills
            bgVec = ix.vectorKNNGlobal(qv, bgSlots * 3);
        }
        if (bgBm.length > 0 || bgVec.length > 0) {
            background = applyFusionAndFilter(ix, bgBm, bgVec, bgSlots, excludeSlugs, undefined);
        }
        // Fill remaining background slots from any available global notes.
        if (background.length < bgSlots) {
            const fgAndBgKeys = new Set([
                ...foreground.map((p) => `${p.relPath}#${p.anchor}`),
                ...background.map((p) => `${p.relPath}#${p.anchor}`),
            ]);
            const need = bgSlots - background.length;
            const fallbackHits = ix.globalFallbackNotes(need + fgAndBgKeys.size);
            const extra = toPointers(fallbackHits.filter((h) => !fgAndBgKeys.has(`${h.relPath}#${h.anchor}`) &&
                !excludeSlugs.includes(h.relPath))).slice(0, need);
            background = [...background, ...extra];
        }
    }
    catch { /* background is best-effort */ }
    // Merge: deduplicate background against foreground by relPath#anchor key
    const fgKeys = new Set(foreground.map((p) => `${p.relPath}#${p.anchor}`));
    const dedupedBg = background.filter((p) => !fgKeys.has(`${p.relPath}#${p.anchor}`));
    // Fill background up to bgSlots, then combine
    const finalBg = dedupedBg.slice(0, bgSlots);
    const combined = [...foreground, ...finalBg].slice(0, k);
    return combined;
}
/**
 * Apply RRF fusion of bm25 and vector arms, then filter, score, and slice to k.
 * When projectSlug is set, the isCrossProject filter is applied (fail-closed).
 */
function applyFusionAndFilter(ix, bm, vec, k, excludeSlugs, projectSlug) {
    if (bm.length === 0 && vec.length === 0)
        return [];
    if (vec.length === 0) {
        // BM25-only degradation path
        const exclude = new Set(excludeSlugs);
        const relPaths = [...new Set(bm.map((h) => h.relPath))];
        const projects = projectSlug ? ix.getProjectsForPaths(relPaths) : new Map();
        const created = ix.getCreatedForPaths(relPaths);
        const now = Date.now();
        const scored = bm
            .filter((h) => !exclude.has(h.relPath))
            .filter((h) => !projectSlug || !isCrossProject(projects.get(h.relPath), projectSlug))
            .map((h) => {
            let score = boostScore(1, projects.get(h.relPath), projectSlug);
            score *= decayFactor(created.get(h.relPath), now);
            return { h, score };
        })
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
        return toPointers(scored.map((e) => e.h));
    }
    if (bm.length === 0) {
        // Vector-only path (gate fix: BM25 empty does not suppress vector results)
        const exclude = new Set(excludeSlugs);
        const relPaths = [...new Set(vec.map((h) => h.relPath))];
        const projects = projectSlug ? ix.getProjectsForPaths(relPaths) : new Map();
        const created = ix.getCreatedForPaths(relPaths);
        const now = Date.now();
        const scored = vec
            .filter((h) => h.distance == null || h.distance <= VECTOR_DISTANCE_CUTOFF)
            .filter((h) => !exclude.has(h.relPath))
            .filter((h) => !projectSlug || !isCrossProject(projects.get(h.relPath), projectSlug))
            .map((h) => {
            let score = boostScore(1, projects.get(h.relPath), projectSlug);
            score *= decayFactor(created.get(h.relPath), now);
            return { h, score };
        })
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
        return toPointers(scored.map((e) => e.h));
    }
    // Full RRF fusion
    const byKey = new Map();
    [...bm, ...vec].forEach((h) => byKey.set(keyOf(h), h));
    const fused = rrfWithScores([bm.map(keyOf), vec.map(keyOf)], k * 2);
    const candidateRelPaths = [...new Set(fused.map((e) => byKey.get(e.id)).filter(Boolean).map((h) => h.relPath))];
    const projects = projectSlug
        ? ix.getProjectsForPaths(candidateRelPaths)
        : new Map();
    const created = ix.getCreatedForPaths(candidateRelPaths);
    const now = Date.now();
    const exclude = new Set(excludeSlugs);
    const decayed = fused
        .map((e) => {
        const hit = byKey.get(e.id);
        if (!hit)
            return null;
        if (exclude.has(hit.relPath))
            return null;
        if (projectSlug && isCrossProject(projects.get(hit.relPath), projectSlug))
            return null;
        let score = boostScore(e.score, projects.get(hit.relPath), projectSlug);
        score *= decayFactor(created.get(hit.relPath), now);
        return { id: e.id, score };
    })
        .filter((e) => e !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    return toPointers(decayed.map((e) => byKey.get(e.id)).filter(Boolean));
}
function boostScore(score, noteProject, projectSlug) {
    if (!projectSlug)
        return score;
    if (noteProject === projectSlug || noteProject === "global")
        return score * 2;
    return score;
}
function decayFactor(created, nowMs) {
    if (!created)
        return 1;
    const createdMs = Date.parse(created);
    if (isNaN(createdMs))
        return 1;
    const ageDays = (nowMs - createdMs) / 86_400_000;
    return Math.exp(-ageDays / 90);
}
