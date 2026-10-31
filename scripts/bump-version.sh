#!/usr/bin/env bash
# One version for the whole repo: the CLI, the app and its Rust crates ship together.
#
#   scripts/bump-version.sh 0.2.0          set every version below to 0.2.0
#   scripts/bump-version.sh --check        fail unless every file has the same version (CI runs this)
#   scripts/bump-version.sh --check 0.2.0  ...and that version is 0.2.0 (the release workflow runs this
#                                          with the tag, so a tag can't ship a build with another version)
#
# The files: pyproject.toml, src/roster/__init__.py, uv.lock (the CLI); app/package.json,
# app/package-lock.json, app/src-tauri/tauri.conf.json (the app); app/src-tauri/Cargo.toml,
# crates/roster-core/Cargo.toml, Cargo.lock (the Rust crates). docs/releasing.md has the rest.
set -euo pipefail
cd "$(dirname "$0")/.."

mode=set want=""
case "${1:-}" in
  --check) mode=check; want="${2:-}" ;;
  ""|-h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
  *) want="$1" ;;
esac
if [ -n "$want" ] && ! [[ "$want" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "bump-version: '$want' isn't MAJOR.MINOR.PATCH (no leading v)" >&2
  exit 2
fi

exec python3 -I - "$mode" "$want" <<'PY'
import json, pathlib, re, sys

mode, want = sys.argv[1], sys.argv[2]

# (file, regex whose group 2 is the version; group 1 and 3 are kept). Each must match exactly `count` times.
TOML_PKG = r'(\[package\]\nname = "{name}"\nversion = ")([^"]+)(")'
LOCK_PKG = r'(\[\[package\]\]\nname = "{name}"\nversion = ")([^"]+)(")'
SPOTS = [
    ("pyproject.toml", r'(\[project\]\nname = "roster"\nversion = ")([^"]+)(")', 1),
    ("src/roster/__init__.py", r'(__version__ = ")([^"]+)(")', 1),
    ("uv.lock", LOCK_PKG.format(name="roster"), 1),
    ("app/package.json", r'(\n  "version": ")([^"]+)(")', 1),
    ("app/package-lock.json", r'("name": "roster-app",\n\s*"version": ")([^"]+)(")', 2),
    ("app/src-tauri/tauri.conf.json", r'(\n  "version": ")([^"]+)(")', 1),
    ("app/src-tauri/Cargo.toml", TOML_PKG.format(name="roster-app"), 1),
    ("crates/roster-core/Cargo.toml", TOML_PKG.format(name="roster-core"), 1),
    ("Cargo.lock", LOCK_PKG.format(name="roster-app"), 1),
    ("Cargo.lock", LOCK_PKG.format(name="roster-core"), 1),
]

found, bad = {}, False
for path, pattern, count in SPOTS:
    text = pathlib.Path(path).read_text()
    hits = re.findall(pattern, text)
    if len(hits) != count:
        print(f"bump-version: {path}: expected {count} version line(s), found {len(hits)}", file=sys.stderr)
        bad = True
        continue
    for h in hits:
        found.setdefault(h[1], []).append(path)
if bad:
    sys.exit(1)

if mode == "check":
    if len(found) != 1:
        print("bump-version: the versions differ:", file=sys.stderr)
        for v, paths in sorted(found.items()):
            print(f"  {v}: {', '.join(sorted(set(paths)))}", file=sys.stderr)
        print("Set them all with scripts/bump-version.sh X.Y.Z", file=sys.stderr)
        sys.exit(1)
    (have,) = found
    if want and have != want:
        print(f"bump-version: the files say {have}, expected {want}", file=sys.stderr)
        sys.exit(1)
    print(have)
    sys.exit(0)

for path in dict.fromkeys(p for p, _, _ in SPOTS):
    f = pathlib.Path(path)
    text = f.read_text()
    for p, pattern, _ in SPOTS:
        if p == path:
            text = re.sub(pattern, lambda m: m.group(1) + want + m.group(3), text)
    f.write_text(text)
json.loads(pathlib.Path("app/package.json").read_text())  # still valid JSON
print(f"version {want}: {', '.join(dict.fromkeys(p for p, _, _ in SPOTS))}")
print("Next: commit on a Work branch, open a pull request to dev (docs/releasing.md).")
PY
