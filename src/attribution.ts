export interface Attribution {
  session_id?: string;
  agent_role?: string;
}

export function attributionFromEnv(): Attribution {
  const out: Attribution = {};
  const sid = process.env.SUPERBRAIN_SESSION_ID;
  const role = process.env.SUPERBRAIN_AGENT_ROLE;
  if (sid) out.session_id = sid;
  if (role) out.agent_role = role;
  return out;
}
