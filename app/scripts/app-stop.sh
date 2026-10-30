#!/usr/bin/env bash
# Stop everything one Windows build copy started (node/vite, the tauri CLI, the app).
# Killing the WSL-side job leaves them running and holding port 1420.
#   scripts/win-stop.sh            the dev copy (%LOCALAPPDATA%\roster-desk-dev, or $ROSTER_DESK_WIN_DIR)
#   scripts/win-stop.sh --release  the release copy (%LOCALAPPDATA%\roster-desk-release)
# Matches the copy's own directory exactly (with a trailing \), so roster-desk-dev never stops
# roster-desk-dev-05 or the release copy.
here="$(cd "$(dirname "$0")" && pwd)"
[ "${1:-}" = "--release" ] && export ROSTER_DESK_WIN_DIR=roster-desk-release
. "$here/win-lib.sh"
cd /mnt/c && winexe powershell.exe -NoProfile -Command '$d="$env:LOCALAPPDATA\'"$WIN_DIR"'\"; Get-CimInstance Win32_Process | ? { $_.CommandLine -like "*$d*" -or $_.ExecutablePath -like "$d*" } | % { Stop-Process -Id $_.ProcessId -Force }'
