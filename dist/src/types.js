// Single source of truth for the three type enumerations used across
// router.ts (Kind), templates.ts (NoteType), and frontmatter.ts (VALID_TYPES).
/** Kinds the router dispatches to a named route (create/append/replace). */
export const ROUTABLE_KINDS = [
    "decision",
    "project_fact",
    "person",
    "gotcha",
    "capture",
    "lesson",
    "preference",
    "daily",
];
/** Types that produce a persisted file with a template (NoteType). */
export const FILE_NOTE_TYPES = [
    "decision",
    "lesson",
    "capture",
    "project",
    "daily",
    "person",
];
/**
 * Types the frontmatter validator accepts.
 * FILE_NOTE_TYPES plus structural/internal types (map, summary, preference)
 * that the router/templates do not generate but the vault may contain.
 * Invariant: VALID_FRONTMATTER_TYPES superset of FILE_NOTE_TYPES.
 */
export const VALID_FRONTMATTER_TYPES = [
    ...FILE_NOTE_TYPES,
    "map",
    "summary",
    "preference",
];
