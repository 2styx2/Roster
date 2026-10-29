#!/usr/bin/env bash
# One-way sync of this checkout to the Windows build copy (docs/dev/windows-build-loop.md).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/win-lib.sh"
win_local="$(wincmd 'echo %LOCALAPPDATA%' | tr -d '\r')"
dest="$(wslpath "$win_local")/roster-desk-dev/src/"
mkdir -p "$dest"
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude target --exclude dist \
  --exclude src-tauri/gen --exclude test-results --exclude playwright-report \
  "$here/../" "$dest"
echo "synced to $dest"
