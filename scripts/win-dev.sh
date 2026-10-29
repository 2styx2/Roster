#!/usr/bin/env bash
# Sync, then run `tauri dev` on Windows (opens the app window on the Windows desktop).
# First run, or after package-lock.json changes: scripts/win-dev.sh --ci
# ROSTER_DESK_ROSTER, if set in this shell, is passed through to the app.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/win-lib.sh"
"$here/win-sync.sh"
if [ "${1:-}" = "--ci" ]; then
  wincmd "cd /d %LOCALAPPDATA%\\${WIN_DIR}\\src && npm ci"
fi
export WSLENV="${WSLENV:+$WSLENV:}ROSTER_DESK_ROSTER"
# ROSTER_DESK_WIN_PORT: run Vite on another port than 1420, so two worktrees can run side by side.
extra=""
if [ -n "${ROSTER_DESK_WIN_PORT:-}" ]; then
  win_local="$(wincmd 'echo %LOCALAPPDATA%' | tr -d '\r')"
  cat > "$(wslpath "$win_local")/$WIN_DIR/src/src-tauri/tauri.dev-port.json" <<JSON
{"build": {"devUrl": "http://localhost:$ROSTER_DESK_WIN_PORT",
           "beforeDevCommand": "npm run dev -- --port $ROSTER_DESK_WIN_PORT"}}
JSON
  extra=" -- --config src-tauri/tauri.dev-port.json"
fi
wincmd "cd /d %LOCALAPPDATA%\\${WIN_DIR}\\src && npm run tauri dev${extra}"
