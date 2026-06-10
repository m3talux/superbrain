export function parentSessionId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env.SUPERBRAIN_PARENT_SESSION_ID;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

export function attributionFields(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const p = parentSessionId(env);
  return p ? { parent_session_id: p } : {};
}
