#!/usr/bin/env bash
# One-way sync of this checkout to the Windows build copy (docs/app/dev/windows-build-loop.md).
# The copy gets the Cargo workspace (Cargo.toml, crates/, app/), and docs/app, which the app bundles as
# its `:help` guides; it leaves the Python CLI out.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/app-lib.sh"
win_local="$(wincmd 'echo %LOCALAPPDATA%' | tr -d '\r')"
dest="$(wslpath "$win_local")/$WIN_DIR/src/"
mkdir -p "$dest"
rsync -a --delete \
  --include /Cargo.toml --include /Cargo.lock --include /rustfmt.toml --include /.gitattributes \
  --include /app/ --include /crates/ --include /examples/ \
  --include /docs/ --include /docs/app/ --exclude '/docs/*' \
  --exclude '/*' \
  --exclude .git --exclude node_modules --exclude /target --exclude dist \
  --exclude app/src-tauri/gen --exclude app/src-tauri/tauri.dev-port.json \
  --exclude test-results --exclude playwright-report \
  "$REPO_ROOT/" "$dest"
echo "synced to $dest"
