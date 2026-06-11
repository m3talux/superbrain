// tests/transcriptTail.test.ts
import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLastAssistantText } from "../src/transcriptTail.js";

function tmpTranscript(lines: any[]): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sb-tt-")), "t.jsonl");
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return p;
}

it("returns the last assistant text block", () => {
  const p = tmpTranscript([
    { type: "user", message: { content: "hi" } },
    { type: "assistant", message: { content: [{ type: "text", text: "first" }] } },
    { type: "user", message: { content: "more" } },
    { type: "assistant", message: { content: [{ type: "text", text: "final answer" }] } },
  ]);
  expect(readLastAssistantText(p)).toBe("final answer");
});

it("skips assistant entries with no text content", () => {
  const p = tmpTranscript([
    { type: "assistant", message: { content: [{ type: "text", text: "kept" }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } },
  ]);
  expect(readLastAssistantText(p)).toBe("kept");
});

it("tolerates junk lines and string content", () => {
  const p = tmpTranscript([
    { type: "assistant", message: { content: "plain string reply" } },
  ]);
  fs.appendFileSync(p, "not json at all\n");
  expect(readLastAssistantText(p)).toBe("plain string reply");
});

it("returns empty string for missing or undefined path", () => {
  expect(readLastAssistantText("/nonexistent/nowhere.jsonl")).toBe("");
  expect(readLastAssistantText(undefined)).toBe("");
});
