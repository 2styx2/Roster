#!/usr/bin/env bash
# Stop everything the Windows build copy started (node/vite, the tauri CLI, the app).
# Killing the WSL-side job leaves them running and holding port 1420.
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/win-lib.sh"
cd /mnt/c && winexe powershell.exe -NoProfile -Command '$d="$env:LOCALAPPDATA\roster-desk-dev"; Get-CimInstance Win32_Process | ? { $_.CommandLine -like "*$d*" -or $_.ExecutablePath -like "$d*" } | % { Stop-Process -Id $_.ProcessId -Force }'
