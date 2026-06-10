export function parentSessionId(env = process.env) {
    const v = env.SUPERBRAIN_PARENT_SESSION_ID;
    if (typeof v !== "string")
        return undefined;
    const t = v.trim();
    return t ? t : undefined;
}
export function attributionFields(env = process.env) {
    const p = parentSessionId(env);
    return p ? { parent_session_id: p } : {};
}
