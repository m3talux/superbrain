import { describe, it, expect } from "vitest";
import { buildDistillCommand, isChild } from "../src/distillerEngine";

describe("distillerEngine", () => {
  it("builds a claude -p command running the distill skill", () => {
    const c = buildDistillCommand({ promptFile: "/tmp/p.txt", cwd: "/work" });
    expect(c.cmd).toBe("claude");
    expect(c.args).toContain("-p");
    expect(c.args.join(" ")).toMatch(/superbrain-distill/);
    expect(c.options.cwd).toBe("/work");
    expect(c.options.env.SUPERBRAIN_CHILD).toBe("1");
  });
  it("detects recursion via env", () => {
    expect(isChild({ SUPERBRAIN_CHILD: "1" })).toBe(true);
    expect(isChild({})).toBe(false);
  });
});
