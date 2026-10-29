#!/usr/bin/env bash
# Sync, then run `tauri dev` on Windows (opens the app window on the Windows desktop).
# First run, or after package-lock.json changes: scripts/win-dev.sh --ci
# ROSTER_DESK_ROSTER, if set in this shell, is passed through to the app.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/win-lib.sh"
"$here/win-sync.sh"
if [ "${1:-}" = "--ci" ]; then
  wincmd 'cd /d %LOCALAPPDATA%\roster-desk-dev\src && npm ci'
fi
export WSLENV="${WSLENV:+$WSLENV:}ROSTER_DESK_ROSTER"
wincmd 'cd /d %LOCALAPPDATA%\roster-desk-dev\src && npm run tauri dev'
