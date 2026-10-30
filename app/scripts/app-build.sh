#!/usr/bin/env bash
# The regular (release) build on Windows: optimised, no dev code (no fixtures, no fake backend,
# no devtools, no hot reload). This is the app to use day to day; scripts/win-dev.sh is for
# working on roster-desk itself.
#
#   scripts/win-build.sh              build roster-desk.exe (no installer), print where it is
#   scripts/win-build.sh --run        ...and start it
#   scripts/win-build.sh --installer  also build the Windows installers (NSIS setup .exe and .msi)
#   scripts/win-build.sh --ci         run `npm ci` on the Windows side first (first build, or after
#                                     package-lock.json changes)
#
# The release copy lives in %LOCALAPPDATA%\roster-desk-release (separate from the dev copy, so a
# release build never fights a running `tauri dev`). Stop it with: scripts/win-stop.sh --release
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export ROSTER_DESK_WIN_DIR="${ROSTER_DESK_WIN_DIR:-roster-desk-release}"
. "$here/win-lib.sh"
run=0 installer=0 ci=0
for arg in "$@"; do
  case "$arg" in
    --run) run=1 ;;
    --installer) installer=1 ;;
    --ci) ci=1 ;;
    *) echo "unknown option: $arg (see the top of $0)" >&2; exit 2 ;;
  esac
done
"$here/win-sync.sh"
src="%LOCALAPPDATA%\\${WIN_DIR}\\src"
# A fresh copy has no node_modules yet.
win_local="$(wincmd 'echo %LOCALAPPDATA%' | tr -d '\r')"
if [ "$ci" = 1 ] || [ ! -d "$(wslpath "$win_local")/$WIN_DIR/src/node_modules" ]; then
  wincmd "cd /d $src && npm ci"
fi
if [ "$installer" = 1 ]; then
  wincmd "cd /d $src && npm run tauri build"
else
  wincmd "cd /d $src && npm run tauri build -- --no-bundle"
fi
exe="$win_local\\$WIN_DIR\\src\\target\\release\\roster-desk.exe"
echo
echo "built: $exe"
if [ "$installer" = 1 ]; then
  echo "installers: $win_local\\$WIN_DIR\\src\\target\\release\\bundle\\ (nsis\\*-setup.exe, msi\\*.msi)"
fi
if [ "$run" = 1 ]; then
  wincmd "start \"\" \"$exe\""
fi
