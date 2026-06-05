import { describe, it, expect, beforeEach } from "vitest";
import { embed, EMBED_DIM } from "../src/embed";

beforeEach(() => { process.env.SUPERBRAIN_EMBED_STUB = "1"; });

describe("embed (stub seam)", () => {
  it("returns one 256-dim unit-ish vector per input, deterministically", async () => {
    const [a1] = await embed(["hello world"]);
    const [a2] = await embed(["hello world"]);
    const [b1] = await embed(["totally different"]);
    expect(a1.length).toBe(EMBED_DIM);
    expect(Array.from(a1)).toEqual(Array.from(a2));   // deterministic
    expect(Array.from(a1)).not.toEqual(Array.from(b1)); // input-sensitive
  });
  it("batches", async () => {
    const v = await embed(["a", "b", "c"]);
    expect(v.length).toBe(3);
  });
});
