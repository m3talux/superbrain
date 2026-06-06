export const INJECT_LIMITS = {
    brief: 150,
    recall: 500,
    preferences: 500,
    openThreads: 200,
    notices: 200,
    // B4 — 4-slot weighted brief budget
    briefProject: 400,
    briefGlobal: 100,
    prefCore: 250,
    miniBrief: 200,
};
/** Per-note token cap: limits any single note's contribution to the injection window. */
export const PER_NOTE_TOKEN_CAP = 120;
/** Estimate tokens via ~chars/4 heuristic (matches OpenAI/Anthropic rough conventions). */
export function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
/** Concatenate lines until adding the next would exceed budget; returns the joined string. */
export function fitToBudget(lines, budgetTokens) {
    const out = [];
    let total = 0;
    for (const line of lines) {
        const t = estimateTokens(line) + (out.length > 0 ? 1 : 0); // +1 for the \n separator
        if (total + t > budgetTokens)
            break;
        out.push(line);
        total += t;
    }
    return out.join("\n");
}
/** Truncate a string to fit within a token budget. */
export function truncateToBudget(text, budgetTokens) {
    if (estimateTokens(text) <= budgetTokens)
        return text;
    return text.slice(0, budgetTokens * 4);
}
/**
 * Cap a single note's text contribution to a fixed per-note token budget.
 * Prevents one large note from crowding out all others in the injection window.
 */
export function capNoteContribution(text, cap = PER_NOTE_TOKEN_CAP) {
    return truncateToBudget(text, cap);
}
