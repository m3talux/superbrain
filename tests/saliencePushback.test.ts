import { it, expect } from "vitest";
import { initState, scoreEvent } from "../src/salience";

const ev = (prompt: string) => ({ type: "prompt" as const, cwd: "/p", prompt });

it("flags pushback prompts", () => {
  for (const p of ["No, don't do that", "revert that change", "that's wrong", "actually, use X instead", "lesson: always run the suite"]) {
    const r = scoreEvent(initState(), ev(p));
    expect(r.pending).toBe(true);
    expect(r.marker?.reason).toBe("pushback");
  }
});

it("does not flag neutral prompts", () => {
  const r = scoreEvent(initState(), ev("Add a new endpoint for users"));
  expect(r.pending).toBe(false);
});
