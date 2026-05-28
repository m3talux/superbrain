export const INJECT_LIMITS = {
  brief: 150,
  recall: 500,
  preferences: 500,
  openThreads: 200,
  notices: 200,
} as const;

/** Estimate tokens via ~chars/4 heuristic (matches OpenAI/Anthropic rough conventions). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Concatenate lines until adding the next would exceed budget; returns the joined string. */
export function fitToBudget(lines: string[], budgetTokens: number): string {
  const out: string[] = [];
  let total = 0;
  for (const line of lines) {
    const t = estimateTokens(line) + (out.length > 0 ? 1 : 0); // +1 for the \n separator
    if (total + t > budgetTokens) break;
    out.push(line);
    total += t;
  }
  return out.join("\n");
}

/** Truncate a string to fit within a token budget. */
export function truncateToBudget(text: string, budgetTokens: number): string {
  if (estimateTokens(text) <= budgetTokens) return text;
  return text.slice(0, budgetTokens * 4);
}
