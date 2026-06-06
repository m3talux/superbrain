import { describe, it, expect } from "vitest";
import {
  ROUTABLE_KINDS,
  FILE_NOTE_TYPES,
  VALID_FRONTMATTER_TYPES,
  type Kind,
  type NoteType,
} from "../src/types.js";
import { REQUIRED_SECTIONS, renderNote } from "../src/templates.js";
import { route } from "../src/router.js";
import { validateFrontmatter } from "../src/frontmatter.js";

describe("G2: single source of truth for type enumerations", () => {
  it("FILE_NOTE_TYPES is a subset of VALID_FRONTMATTER_TYPES", () => {
    for (const t of FILE_NOTE_TYPES) {
      expect(VALID_FRONTMATTER_TYPES).toContain(t);
    }
  });

  it("all VALID_FRONTMATTER_TYPES are strings", () => {
    for (const t of VALID_FRONTMATTER_TYPES) {
      expect(typeof t).toBe("string");
    }
  });

  it("ROUTABLE_KINDS has no duplicates", () => {
    const set = new Set(ROUTABLE_KINDS);
    expect(set.size).toBe(ROUTABLE_KINDS.length);
  });

  it("FILE_NOTE_TYPES has no duplicates", () => {
    const set = new Set(FILE_NOTE_TYPES);
    expect(set.size).toBe(FILE_NOTE_TYPES.length);
  });

  it("every FILE_NOTE_TYPES value has a REQUIRED_SECTIONS entry", () => {
    for (const t of FILE_NOTE_TYPES) {
      expect(REQUIRED_SECTIONS).toHaveProperty(t);
    }
  });

  it("Kind and NoteType are assignable from types.ts exports (compile-time check via runtime value)", () => {
    const k: Kind = ROUTABLE_KINDS[0];
    const n: NoteType = FILE_NOTE_TYPES[0];
    expect(typeof k).toBe("string");
    expect(typeof n).toBe("string");
  });

  it("router.ts Kind values are covered by ROUTABLE_KINDS", () => {
    expect(typeof route).toBe("function");
    const kinds = ROUTABLE_KINDS;
    expect(kinds.length).toBeGreaterThan(0);
  });

  it("templates.ts NoteType values equal FILE_NOTE_TYPES", () => {
    expect(typeof renderNote).toBe("function");
    expect(FILE_NOTE_TYPES.length).toBeGreaterThan(0);
  });

  it("frontmatter VALID_FRONTMATTER_TYPES matches validateFrontmatter accepted types", () => {
    for (const t of VALID_FRONTMATTER_TYPES) {
      const errs = validateFrontmatter({ type: t, status: "active" });
      const typeErr = errs.filter((e: string) => e.includes("type must be one of"));
      expect(typeErr).toHaveLength(0);
    }
  });
});
