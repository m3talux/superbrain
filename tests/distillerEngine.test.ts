import { describe, it, expect } from "vitest";
import { buildDistillCommand, isChild, distillScriptPath } from "../src/distillerEngine";

describe("distillerEngine", () => {
  it("spawns node running the sb-distill writer (not bare claude)", () => {
    const c = buildDistillCommand({ sessionId: "S", cwd: "/work" });
    expect(c.cmd).toBe(process.execPath);
    expect(c.args[0]).toMatch(/sb-distill\.js$/);
    expect(c.options.cwd).toBe("/work");
    expect(c.options.env.SUPERBRAIN_CHILD).toBe("1");
    expect(c.options.env.SUPERBRAIN_SESSION_ID).toBe("S");
  });

  it("detects recursion via env", () => {
    expect(isChild({ SUPERBRAIN_CHILD: "1" })).toBe(true);
    expect(isChild({})).toBe(false);
  });
  it("resolves a sb-distill.js path", () => {
    expect(distillScriptPath()).toMatch(/bin\/sb-distill\.js$/);
  });
});
