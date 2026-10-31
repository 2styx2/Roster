#!/usr/bin/env bash
# Measure what the app costs: CPU, memory, wake-ups, frame time, React renders (docs/app/performance.md).
#
#   app/scripts/perf.sh browser            the frontend in Chromium (Vite + Playwright, the fake Backend's
#                                          perf fixture): idle, 12 busy Sessions, Picker and terminal keys,
#                                          Focus mode, closing every Session; renders per component
#   app/scripts/perf.sh windows [--build]  the release build on Windows against a stand-in `roster serve`
#                                          (app/scripts/perf/serve.py: 1,284 made-up Hosts, Sessions that print
#                                          a busy log): every process it starts, idle and busy
#   app/scripts/perf.sh serve              the real `roster serve` (this checkout) idle on the example
#                                          Inventory: wake-ups a second, without and with inventory.watch
#
# Options (env): PERF_PORT (Vite, default 5181), PERF_CDP_PORT (WebView2 DevTools, default 9338),
# PERF_SESSIONS (12), PERF_RATE (log lines a second per Session, 100), PERF_SECONDS (20), PERF_JSON=1,
# PERF_PROFILE=1 (windows: also the webview main thread's top functions while busy).
#
# The Windows run never touches the real app or its data: its own build copy (%LOCALAPPDATA%\roster-app-perf,
# or $ROSTER_APP_WIN_DIR), and under it its own Config (APPDATA), State (ROSTER_APP_STATE_DIR) and WebView2
# profile; no Inventory, vault or Host is reached (the stand-in serve answers everything). It kills only the
# process tree it started, then app/scripts/app-stop.sh for that copy. It opens a window on the desktop.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export ROSTER_APP_WIN_DIR="${ROSTER_APP_WIN_DIR:-roster-app-perf}"
what="${1:-}"
shift || true
json=(); [ "${PERF_JSON:-}" = 1 ] && json=(--json)

case "$what" in
  browser)
    cd "$here/.."
    [ -d node_modules ] || npm ci
    port="${PERF_PORT:-5181}"
    # Playwright isn't one of the app's packages: borrow it from npm's cache (fetched once).
    nm="$(npm exec --yes --package=playwright@1.64.0 -- sh -c 'cd "$(dirname "$(command -v playwright)")/.." && pwd')"
    npm exec --yes --package=playwright@1.64.0 -- playwright install chromium >/dev/null 2>&1 || true
    npx vite --port "$port" --strictPort >/dev/null 2>&1 &
    vite=$!
    trap 'kill $vite 2>/dev/null || true' EXIT
    for _ in $(seq 60); do curl -s "http://localhost:$port/" >/dev/null && break; sleep 0.5; done
    NODE_PATH="$nm" node scripts/perf/browser.mjs "http://localhost:$port/" "${json[@]}"
    ;;
  windows)
    . "$here/app-lib.sh"
    if [ "${1:-}" = "--build" ]; then "$here/app-build.sh" >&2; else "$here/app-sync.sh" >&2; fi
    win_local="$(wincmd 'echo %LOCALAPPDATA%' | tr -d '\r')"
    copy="$win_local\\$WIN_DIR"
    exe="$copy\\src\\target\\release\\roster-app.exe"
    [ -e "$(wslpath "$exe")" ] || { echo "no release build in $copy yet: run with --build" >&2; exit 1; }
    serve="$(cd "$here/perf" && pwd)/serve.py"
    # Through the environment: cmd.exe would mangle the quotes of an argument with spaces.
    export PERF_ROSTER="python3 $serve --hosts 1284 --rate ${PERF_RATE:-100}"
    export WSLENV="${WSLENV:+$WSLENV:}PERF_ROSTER"
    trap '"$here/app-stop.sh" >/dev/null 2>&1 || true' EXIT
    wincmd "cd /d $copy\\src\\app\\scripts\\perf && node drive.mjs --exe $exe --scratch $copy\\run \
      --distro ${WSL_DISTRO_NAME:-} --port ${PERF_CDP_PORT:-9338} --sessions ${PERF_SESSIONS:-12} \
      --seconds ${PERF_SECONDS:-20} ${json[*]} ${PERF_PROFILE:+--profile}"
    ;;
  serve)
    python3 "$here/perf/serve_idle.py" "$(cd "$here/../.." && pwd)" "${PERF_SECONDS:-10}"
    ;;
  *)
    sed -n '2,21p' "$0" >&2
    exit 2
    ;;
esac
