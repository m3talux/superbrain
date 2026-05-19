import { describe, it, expect } from "vitest";
import { initState, scoreEvent } from "../src/salience";

describe("salience", () => {
  it("flags pending after N tool writes", () => {
    let s = initState();
    let pending = false;
    for (let i = 0; i < 5; i++) {
      const r = scoreEvent(s, { type: "tool", tool: "Write", file: `f${i}.ts`, cwd: "/p" });
      s = r.state; pending = pending || r.pending;
    }
    expect(pending).toBe(true);
  });
  it("flags pending + emits marker on git commit and resets write counter", () => {
    let s = initState();
    const r = scoreEvent(s, { type: "tool", tool: "Bash", command: "git commit -m x", cwd: "/p" });
    expect(r.pending).toBe(true);
    expect(r.marker).toMatchObject({ type: "salient", reason: "git_commit", cwd: "/p" });
  });
  it("flags pending + marker on cwd switch", () => {
    let s = initState();
    s = scoreEvent(s, { type: "tool", tool: "Read", file: "a", cwd: "/p1" }).state;
    const r = scoreEvent(s, { type: "tool", tool: "Read", file: "b", cwd: "/p2" });
    expect(r.pending).toBe(true);
    expect(r.marker?.reason).toBe("cwd_switch");
  });
  it("does not flag on a single read", () => {
    const r = scoreEvent(initState(), { type: "tool", tool: "Read", file: "a", cwd: "/p" });
    expect(r.pending).toBe(false);
    expect(r.marker).toBeUndefined();
  });
});
