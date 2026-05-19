import { it, expect } from "vitest";
import { parseEnvelope } from "../src/distillRun";

it("treats a bare array as { items }", () => {
  const e = parseEnvelope(JSON.stringify([{ kind: "decision", title: "x", body: "y", date: "2026-05-19", links: [] }]));
  expect(e.items.length).toBe(1);
  expect(e.digest).toBeUndefined();
  expect(e.openThreads).toEqual([]);
  expect(e.alsoDid).toEqual([]);
});

it("parses an envelope object", () => {
  const e = parseEnvelope(JSON.stringify({ items: [{ kind: "lesson", title: "L", body: "b", date: "2026-05-19", links: [], rule: "R" }], digest: "did things", openThreads: ["t"], alsoDid: ["a"] }));
  expect(e.items[0].kind).toBe("lesson");
  expect(e.digest).toBe("did things");
  expect(e.openThreads).toEqual(["t"]);
  expect(e.alsoDid).toEqual(["a"]);
});

it("tolerates junk -> empty envelope", () => {
  expect(parseEnvelope("not json")).toEqual({ items: [], openThreads: [], alsoDid: [] });
});
