#!/usr/bin/env bash
set -euo pipefail

# bump-version.sh <new-version>
# Updates the four version files atomically.
# Called by the npm "version" lifecycle hook (package.json scripts.version).

NEW_VERSION="${npm_new_version:-${1:-}}"
if [ -z "$NEW_VERSION" ]; then
  echo "usage: bump-version.sh <new-version>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# package.json is handled by npm itself; we only update the companion files.

# .claude-plugin/plugin.json
node -e "
  const fs = require('fs');
  const f = '$ROOT/.claude-plugin/plugin.json';
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.version = '$NEW_VERSION';
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
"

# .claude-plugin/marketplace.json
node -e "
  const fs = require('fs');
  const f = '$ROOT/.claude-plugin/marketplace.json';
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.plugins[0].version = '$NEW_VERSION';
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
"

# bin/sb-mcp.ts
node -e "
  const fs = require('fs');
  const f = '$ROOT/bin/sb-mcp.ts';
  const src = fs.readFileSync(f, 'utf8');
  const updated = src.replace(
    /(new McpServer\s*\(\s*\{\s*name\s*:\s*[\"'][^\"']+[\"']\s*,\s*version\s*:\s*[\"'])[^\"']+([\"\'])/,
    '\$1$NEW_VERSION\$2'
  );
  fs.writeFileSync(f, updated);
"

# sync package-lock.json (no install, just update the version field)
npm install --package-lock-only --ignore-scripts 2>/dev/null || true

# stage the files we changed so npm version includes them in the commit
git add \
  "$ROOT/.claude-plugin/plugin.json" \
  "$ROOT/.claude-plugin/marketplace.json" \
  "$ROOT/bin/sb-mcp.ts" \
  "$ROOT/package-lock.json" \
  || true
