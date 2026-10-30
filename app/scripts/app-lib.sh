# Sourced by the app-*.sh scripts. Runs a Windows exe from WSL, even when the WSLInterop binfmt
# entry is gone (another distro's systemd-binfmt can wipe it; then `cmd.exe` fails with
# "Exec format error"). /init is what that binfmt entry runs anyway.
winexe() {
  local exe; exe="$(command -v "$1")"; shift
  if [ -e /proc/sys/fs/binfmt_misc/WSLInterop ] || [ -e /proc/sys/fs/binfmt_misc/WSLInterop-late ]; then
    "$exe" "$@"
  else
    /init "$exe" "$@"
  fi
}
# cmd.exe can't start in a \\wsl.localhost path, so always run Windows tools from /mnt/c.
wincmd() { (cd /mnt/c && winexe cmd.exe /c "$@"); }
# The old roster-desk names of the env vars (ROSTER_DESK_*) still work when the new ones aren't set.
for _v in WIN_DIR WIN_PORT ROSTER WSL_DISTRO; do
  if [ -z "$(eval echo "\${ROSTER_APP_$_v:-}")" ] && [ -n "$(eval echo "\${ROSTER_DESK_$_v:-}")" ]; then
    eval "export ROSTER_APP_$_v=\"\$ROSTER_DESK_$_v\""
  fi
done
unset _v
# The Windows build copy lives in %LOCALAPPDATA%\$WIN_DIR. Set ROSTER_APP_WIN_DIR to give a
# parallel worktree its own copy (and its own `target/`), e.g. roster-app-dev-05.
WIN_DIR="${ROSTER_APP_WIN_DIR:-roster-app-dev}"
# The repo root: the Cargo workspace (crates/roster-core, app/src-tauri) and the app (app/).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
