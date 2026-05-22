import { embed } from "./embed.js";
const DEFAULT_THRESHOLD = 0.85;
export async function dedupAgainstSession(items, threshold = DEFAULT_THRESHOLD) {
    if (items.length === 0)
        return { kept: [], collapsed: [] };
    // Batch-embed all items at once for efficiency.
    const texts = items.map(itemText);
    const vecs = await embed(texts);
    const kept = [];
    const keptVecs = [];
    const collapsed = [];
    for (let idx = 0; idx < items.length; idx++) {
        const v = vecs[idx];
        let bestIdx = -1;
        let bestSim = -Infinity;
        for (let i = 0; i < keptVecs.length; i++) {
            const sim = cosine(v, keptVecs[i]);
            if (sim > bestSim) {
                bestSim = sim;
                bestIdx = i;
            }
        }
        if (bestIdx >= 0 && bestSim >= threshold) {
            collapsed.push({ item: items[idx], intoIndex: bestIdx });
        }
        else {
            kept.push(items[idx]);
            keptVecs.push(v);
        }
    }
    return { kept, collapsed };
}
function itemText(it) {
    const parts = [
        it.title,
        it.body,
        it.decision,
        it.why,
        it.rule,
        it.context,
        it.rationale,
        it.symptom,
        it.rootCause,
        it.fix,
        it.prevention,
        it.consequences,
        it.implementation,
        it.whenApplies,
    ].filter(Boolean);
    return parts.join("\n").trim() || it.title;
}
export async function dedupAgainstVault(item, searchFn, threshold = DEFAULT_THRESHOLD) {
    const query = `${item.title}\n${item.body}`;
    const results = await searchFn(query, { k: 1, type: item.type, project: item.project });
    if (!results.length)
        return {};
    const top = results[0];
    if (top.score >= threshold)
        return { match: top.path, score: top.score };
    return {};
}
function cosine(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0)
        return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
