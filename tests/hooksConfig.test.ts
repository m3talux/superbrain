import { it, expect } from "vitest";
import fs from "node:fs";

it("UserPromptSubmit has a sync sb-recall entry; SessionStart is synchronous", () => {
  const h = JSON.parse(fs.readFileSync("hooks/hooks.json", "utf8"));
  const ups = h.hooks.UserPromptSubmit.flatMap((g: any) => g.hooks);
  const recall = ups.find((x: any) => x.command.includes("sb-recall.js"));
  expect(recall).toBeTruthy();
  expect(recall.async).not.toBe(true);            // sync so additionalContext injects
  const observer = ups.find((x: any) => x.command.includes("sb-observe.js"));
  expect(observer.async).toBe(true);              // observer stays async
  const ss = h.hooks.SessionStart.flatMap((g: any) => g.hooks)
    .find((x: any) => x.command.includes("sb-session-start.js"));
  expect(ss.async).not.toBe(true);                // SessionStart now synchronous
});
