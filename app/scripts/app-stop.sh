#!/usr/bin/env bash
# Stop everything one Windows build copy started (node/vite, the tauri CLI, the app).
# Killing the WSL-side job leaves them running and holding port 1420.
#   app/scripts/app-stop.sh            the dev copy (%LOCALAPPDATA%\roster-app-dev, or $ROSTER_APP_WIN_DIR)
#   app/scripts/app-stop.sh --release  the release copy (%LOCALAPPDATA%\roster-app-release)
# Matches the copy's own directory exactly (with a trailing \), so roster-app-dev never stops
# roster-app-dev-05 or the release copy.
here="$(cd "$(dirname "$0")" && pwd)"
[ "${1:-}" = "--release" ] && export ROSTER_APP_WIN_DIR=roster-app-release
. "$here/app-lib.sh"
cd /mnt/c && winexe powershell.exe -NoProfile -Command '$d="$env:LOCALAPPDATA\'"$WIN_DIR"'\"; Get-CimInstance Win32_Process | ? { $_.CommandLine -like "*$d*" -or $_.ExecutablePath -like "$d*" } | % { Stop-Process -Id $_.ProcessId -Force }'
