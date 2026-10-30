#!/usr/bin/env bash
# Sync, then run `tauri dev` on Windows (opens the app window on the Windows desktop).
# First run, or after package-lock.json changes: app/scripts/app-dev.sh --ci
# ROSTER_APP_ROSTER and ROSTER_APP_WSL_DISTRO, if set in this shell, are passed through to the app.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/app-lib.sh"
"$here/app-sync.sh"
app="%LOCALAPPDATA%\\${WIN_DIR}\\src\\app"
if [ "${1:-}" = "--ci" ]; then
  wincmd "cd /d $app && npm ci"
fi
export WSLENV="${WSLENV:+$WSLENV:}ROSTER_APP_ROSTER:ROSTER_APP_WSL_DISTRO"
# ROSTER_APP_WIN_PORT: run Vite on another port than 1420, so two worktrees can run side by side.
extra=""
if [ -n "${ROSTER_APP_WIN_PORT:-}" ]; then
  win_local="$(wincmd 'echo %LOCALAPPDATA%' | tr -d '\r')"
  cat > "$(wslpath "$win_local")/$WIN_DIR/src/app/src-tauri/tauri.dev-port.json" <<JSON
{"build": {"devUrl": "http://localhost:$ROSTER_APP_WIN_PORT",
           "beforeDevCommand": "npm run dev -- --port $ROSTER_APP_WIN_PORT"}}
JSON
  extra=" -- --config src-tauri/tauri.dev-port.json"
fi
wincmd "cd /d $app && npm run tauri dev${extra}"
