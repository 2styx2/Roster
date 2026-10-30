# Sourced by the win-*.sh scripts. Runs a Windows exe from WSL, even when the WSLInterop binfmt
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
# The Windows build copy lives in %LOCALAPPDATA%\$WIN_DIR. Set ROSTER_DESK_WIN_DIR to give a
# parallel worktree its own copy (and its own `target/`), e.g. roster-desk-dev-05.
WIN_DIR="${ROSTER_DESK_WIN_DIR:-roster-desk-dev}"
