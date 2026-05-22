import { describe, it, expect } from "vitest";
import { estimateTokens, fitToBudget, truncateToBudget, INJECT_LIMITS } from "../src/injectBudget.js";

describe("injectBudget", () => {
  it("estimates tokens at ~chars/4", () => {
    expect(estimateTokens("x".repeat(400))).toBe(100);
    expect(estimateTokens("")).toBe(0);
  });

  it("INJECT_LIMITS sum is ≤1400", () => {
    const sum = INJECT_LIMITS.recall + INJECT_LIMITS.preferences + INJECT_LIMITS.openThreads + INJECT_LIMITS.notices;
    expect(sum).toBeLessThanOrEqual(1400);
  });

  it("fitToBudget truncates lines to fit token cap", () => {
    const lines = Array.from({ length: 20 }, () => "x".repeat(120));  // each ~30 tokens
    const out = fitToBudget(lines, 100);
    expect(estimateTokens(out)).toBeLessThanOrEqual(100);
  });

  it("fitToBudget returns all lines when under budget", () => {
    const lines = ["a", "b", "c"];
    expect(fitToBudget(lines, 10000)).toBe("a\nb\nc");
  });

  it("truncateToBudget slices a long string", () => {
    const t = "x".repeat(10000);
    const out = truncateToBudget(t, 100);
    expect(estimateTokens(out)).toBeLessThanOrEqual(100);
  });

  it("truncateToBudget passes through under budget", () => {
    const t = "short";
    expect(truncateToBudget(t, 1000)).toBe(t);
  });
});
