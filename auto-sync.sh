#!/usr/bin/env bash
# Auto-commit + push the SuperBrain vault. Idempotent. No-op if no changes.
# Triggered every 30s by ~/Library/LaunchAgents/com.alex.vault-sync.plist
set -euo pipefail

VAULT="$HOME/.superbrain/vault"
cd "$VAULT" || exit 0

# Pull first (cheap if up to date)
/usr/bin/git pull --rebase --autostash --quiet origin main 2>/dev/null || true

# Anything to commit?
if /usr/bin/git diff --quiet && /usr/bin/git diff --cached --quiet && [ -z "$(/usr/bin/git ls-files --others --exclude-standard)" ]; then
  exit 0
fi

/usr/bin/git add -A
/usr/bin/git commit -m "auto: $(date -Iseconds)" --quiet || exit 0
/usr/bin/git push --quiet origin main 2>&1 | tail -5 >> "$HOME/.superbrain/sync.log" || true

# --- Weekly maintenance (idempotent; safe to run more often) ---
# Removes transcript snapshots older than 7d (T2 already overwrites per-session;
# this catches stale snapshots from interrupted/failed sessions).
TRANSCRIPTS_DIR="$HOME/.superbrain/transcripts"
TRASH_DIR="$HOME/.superbrain/vault/.trash"
VAULT_DIR="$HOME/.superbrain/vault"

if [ -d "$TRANSCRIPTS_DIR" ]; then
  find "$TRANSCRIPTS_DIR" -type f -name "*.jsonl" -mtime +7 -delete 2>/dev/null || true
fi
if [ -d "$TRASH_DIR" ]; then
  find "$TRASH_DIR" -type f -mtime +7 -delete 2>/dev/null || true
fi
# Monthly vault gc on day-1 to bound cost
if [ -d "$VAULT_DIR/.git" ] && [ "$(date +%d)" = "01" ]; then
  git -C "$VAULT_DIR" gc --aggressive --prune=now --quiet 2>/dev/null || true
fi
