import { describe, it, expect } from "vitest";
import { route, asText } from "../src/router.js";
import type { DistilledItem } from "../src/router.js";

describe("asText", () => {
  it("returns strings unchanged", () => {
    expect(asText("hello")).toBe("hello");
    expect(asText("")).toBe("");
  });
  it("coerces null/undefined to empty string", () => {
    expect(asText(null)).toBe("");
    expect(asText(undefined)).toBe("");
  });
  it("coerces numbers and booleans via String", () => {
    expect(asText(5)).toBe("5");
    expect(asText(0)).toBe("0");
    expect(asText(true)).toBe("true");
  });
  it("coerces objects and arrays via JSON.stringify (never throws)", () => {
    expect(asText({ a: 1 })).toBe('{"a":1}');
    expect(asText([1, 2])).toBe("[1,2]");
  });
});

describe("route() survives non-string body/title", () => {
  it("does not throw when capture body is a number", () => {
    const item = { kind: "capture", title: "T", date: "2026-06-05", links: [], body: 5 } as unknown as DistilledItem;
    expect(() => route(item)).not.toThrow();
    const r = route(item);
    expect(r.body).toContain("5");
  });
  it("does not throw when a decision body is an object", () => {
    const item = { kind: "decision", title: "D", date: "2026-06-05", links: [], body: { x: 1 } } as unknown as DistilledItem;
    expect(() => route(item)).not.toThrow();
  });
  it("does not throw when a lesson legacy body is an array", () => {
    const item = { kind: "lesson", title: "L", date: "2026-06-05", links: [], body: [1, 2] } as unknown as DistilledItem;
    expect(() => route(item)).not.toThrow();
    expect(route(item).body).toContain("**Why:**");
  });
  it("does not throw when the title is a number (slug path)", () => {
    const item = { kind: "capture", title: 42, date: "2026-06-05", links: [] } as unknown as DistilledItem;
    expect(() => route(item)).not.toThrow();
    expect(route(item).relPath).toBe("capture/2026-06-05-42.md");
  });
  it("leaves normal string output unchanged (regression guard)", () => {
    const r = route({ kind: "capture", title: "Note title here", date: "2026-06-05", links: [], body: "plain body" });
    expect(r.body).toContain("# Note title here");
    expect(r.body).toContain("plain body");
  });
});

import { coerceCapture, coerceLesson } from "../src/distillRun.js";

describe("coercers survive non-string body", () => {
  it("coerceCapture does not throw when body is a number", () => {
    const item = { kind: "capture", title: "T", date: "2026-06-05", links: [], body: 7 } as unknown as DistilledItem;
    expect(() => coerceCapture(item, "")).not.toThrow();
    expect(coerceCapture(item, "")).toContain("## What");
  });
  it("coerceCapture falls back to routedBody when title is an object", () => {
    const item = { kind: "capture", title: { x: 1 }, date: "2026-06-05", links: [] } as unknown as DistilledItem;
    expect(() => coerceCapture(item, "routed text here")).not.toThrow();
  });
  it("coerceLesson does not throw when rule/why are non-strings", () => {
    const item = { kind: "lesson", title: "L", date: "2026-06-05", links: [], rule: 1, why: [2], body: { a: 1 } } as unknown as DistilledItem;
    expect(() => coerceLesson(item, "")).not.toThrow();
    expect(coerceLesson(item, "")).toContain("## Rule");
  });
});
