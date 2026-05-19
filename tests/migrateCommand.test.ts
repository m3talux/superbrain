import { it, expect } from "vitest";
import fs from "node:fs";

// /superbrain:migrate is fully LLM-driven (commands/migrate.md), so unit tests
// on its runtime behavior are impractical. Instead, lock the hard invariants
// into the instruction text — a future edit that drops these will fail CI.

const SRC = fs.readFileSync("commands/migrate.md", "utf8");

it("the migrate slash-command declares 'non-destructive' / read-only-source intent", () => {
  expect(SRC.toLowerCase()).toMatch(/non-destructive/);
  expect(SRC).toMatch(/source\s+(vault\s+)?is\s+READ-ONLY/i);
});

it("the migrate slash-command forbids overwriting destination notes (collision rename rule)", () => {
  expect(SRC).toMatch(/never overwrite/i);
  expect(SRC).toMatch(/-<8-char-hash>/);
});

it("the migrate slash-command guarantees idempotency on re-run", () => {
  expect(SRC.toLowerCase()).toMatch(/idempotent/);
  expect(SRC).toMatch(/migrated_from/);
});

it("the migrate slash-command auto-locates via Obsidian's vault registry + interactive fallback", () => {
  expect(SRC).toMatch(/obsidian\.json/);
  expect(SRC.toLowerCase()).toMatch(/auto-detect|auto detect/);
  expect(SRC).toMatch(/ask the user/i);
});

it("the migrate slash-command supports --dry-run", () => {
  expect(SRC).toMatch(/--dry-run/);
  expect(SRC).toMatch(/DRY_RUN|dry run complete/i);
});

it("the migrate slash-command never lands notes in meta/", () => {
  // meta/ is reserved for SuperBrain-managed config (preferences.md).
  expect(SRC).toMatch(/Do NOT migrate notes into `meta\/`/);
});
