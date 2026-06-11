import { it, expect, afterEach } from "vitest";
import { attributionFromEnv } from "../src/attribution";

const SAVED = { ...process.env };
afterEach(() => {
  delete process.env.SUPERBRAIN_SESSION_ID;
  delete process.env.SUPERBRAIN_AGENT_ROLE;
  Object.assign(process.env, SAVED);
});

it("returns both fields when both env vars are set", () => {
  process.env.SUPERBRAIN_SESSION_ID = "S1";
  process.env.SUPERBRAIN_AGENT_ROLE = "engineer";
  expect(attributionFromEnv()).toEqual({ session_id: "S1", agent_role: "engineer" });
});

it("omits agent_role when SUPERBRAIN_AGENT_ROLE is unset", () => {
  process.env.SUPERBRAIN_SESSION_ID = "S1";
  delete process.env.SUPERBRAIN_AGENT_ROLE;
  const r = attributionFromEnv();
  expect(r).toEqual({ session_id: "S1" });
  expect("agent_role" in r).toBe(false);
});

it("returns an empty object when neither env var is set", () => {
  delete process.env.SUPERBRAIN_SESSION_ID;
  delete process.env.SUPERBRAIN_AGENT_ROLE;
  expect(Object.keys(attributionFromEnv())).toHaveLength(0);
});

it("omits session_id when only agent_role is set", () => {
  delete process.env.SUPERBRAIN_SESSION_ID;
  process.env.SUPERBRAIN_AGENT_ROLE = "qa";
  const r = attributionFromEnv();
  expect("session_id" in r).toBe(false);
  expect(r.agent_role).toBe("qa");
});

it("treats empty-string env values as unset", () => {
  process.env.SUPERBRAIN_SESSION_ID = "";
  process.env.SUPERBRAIN_AGENT_ROLE = "";
  expect(Object.keys(attributionFromEnv())).toHaveLength(0);
});
