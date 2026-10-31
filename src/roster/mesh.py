"""The Mesh (decision Q63, ticket 39): Host-to-Host access that roster sets up from one Box, with nothing
installed on the Hosts. roster.yml says who may reach whom (`mesh: true` per group, `links:`); this module turns
that into what each Host needs, and makes it so over the Box's own ssh, one connection at a time:

- on each source Host: a key made there (the private key never leaves it), the peers' recorded host keys, an ssh
  config so `ssh PEER` works, and a ROSTER.md of its peers for Claude (imported from ~/.claude/CLAUDE.md);
- on each peer: the source's public key in authorized_keys, tagged `roster-mesh:SOURCE`, with `from="SOURCE IP"`
  and no agent or X11 forwarding.

Everything roster writes is tagged or lives in files roster owns, and only those are ever changed or removed. The
interface is small: graph() (who reaches whom, no connections), run() (plan or apply), cut(), status(), and
drift() for `roster check`. Where things live on Linux and ESXi, and why, is in docs/mesh.md."""

import concurrent.futures as cf
import hashlib
import json
import os
import re
import subprocess

from .common import current_deadline, deadline_at, past_deadline, program_argv, time_left, user_config_dir
from .sshops import hk_name, recorded_host_keys

TAG = "roster-mesh"
OPTIONS = 'from="{ip}",no-agent-forwarding,no-X11-forwarding'
CLAUDE_IMPORT = "@~/ROSTER.md"
MARK = "# roster-mesh: the Mesh's ssh config (roster mesh adds and removes these two lines)"
CONNECT_TIMEOUT = 10
STEP_TIMEOUT = 120          # s: one Host's script, at most
CUT_TIMEOUT = 30            # s: one Host's part of a cut
OUT_OF_TIME = "out of time: not visited (the next roster mesh finishes it)"   # past serve's deadline


# ---------------------------------------------------------------- who reaches whom (no connections)

def graph(cfg):
    """The Mesh roster.yml asks for: {links: [{from, to, kind, skip?}], excluded: {host: why}, sources, visit}.
    kind is "key" (the peer takes the source's key) or "password" (ssh asks the person). A link from a password
    Host is kept with skip="password-source": roster can't write files on a Host it reaches only with a password.
    visit: the Hosts roster logs in to (sources and key peers), in name order."""
    hosts = cfg["hosts"]
    excluded = {}

    def eligible(h):
        if not h["reviewed"]:
            excluded[h["name"]] = "not reviewed (reviewed: false)"
        elif h["mesh"] is False:
            excluded[h["name"]] = "mesh: false"
        else:
            return True
        return False

    pairs = set()
    by_group = {}
    for h in hosts.values():
        by_group.setdefault(h["group"], []).append(h)
    for members in by_group.values():
        meshed = [h["name"] for h in members if h["mesh"] is not None and eligible(h) and h["mesh"]]
        pairs |= {(a, b) for a in meshed for b in meshed if a != b}

    def expand(name):
        return [name] if name in hosts else [h["name"] for h in by_group.get(name, [])]

    for link in cfg.get("links", []):
        for a in expand(link["from"]):
            for b in expand(link["to"]):
                if a != b and eligible(hosts[a]) and eligible(hosts[b]):
                    pairs.add((a, b))
                    if link["both"]:
                        pairs.add((b, a))
    links = []
    for a, b in sorted(pairs):
        link = {"from": a, "to": b, "kind": "key" if hosts[b]["enroll"] else "password"}
        if not hosts[a]["enroll"]:
            link["skip"] = "password-source"
        links.append(link)
    live = [x for x in links if "skip" not in x]
    sources = sorted({x["from"] for x in live})
    visit = sorted(set(sources) | {x["to"] for x in live if x["kind"] == "key"})
    return {"links": links, "excluded": dict(sorted(excluded.items())), "sources": sources, "visit": visit}


def reach(g):
    """{host: how many Hosts it can reach}, from the plan (no connections)."""
    out = {}
    for x in g["links"]:
        if "skip" not in x:
            out[x["from"]] = out.get(x["from"], 0) + 1
    return out


def digest(cfg, g=None):
    """What the Mesh depends on in roster.yml: when it changes, the Mesh is out of date until the next apply."""
    g = g or graph(cfg)
    h = cfg["hosts"]
    parts = [(x["from"], x["to"], x["kind"], h[x["to"]]["ip"], h[x["to"]]["ssh"]["user"], h[x["to"]]["ssh"]["port"],
              h[x["from"]]["ip"]) for x in g["links"] if "skip" not in x]
    return hashlib.sha256(json.dumps(parts).encode()).hexdigest()[:16]


# ---------------------------------------------------------------- what the Box remembers (unfinished work)

def state_file():
    return user_config_dir() / "mesh.json"


def load_state():
    """{members: [hosts roster wrote Mesh entries on], pending: {host: why}, cut: {host: [peers not confirmed]},
    applied: digest of the last complete apply}. Only bookkeeping: the Mesh itself comes from roster.yml."""
    try:
        data = json.loads(state_file().read_text())
    except (OSError, ValueError):
        data = {}
    return {"members": list(data.get("members") or []), "pending": dict(data.get("pending") or {}),
            "cut": dict(data.get("cut") or {}), "applied": data.get("applied")}


def save_state(st):
    f = state_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".new")
    tmp.write_text(json.dumps(st, indent=2, sort_keys=True) + "\n")
    os.replace(tmp, f)


# ---------------------------------------------------------------- the scripts that run on a Host (POSIX sh)

def q(s):
    return "'" + str(s).replace("'", "'\"'\"'") + "'"


def ere(name):
    return re.escape(name).replace("\\-", "-")


# Where things live: Linux keeps the Mesh's files in ~/.ssh/roster-mesh; ESXi's home and /etc are rebuilt at every
# boot, so there they go on a datastore (kept), and authorized_keys is ESXi's own /etc/ssh/keys-USER/ (kept).
WHERE = r"""
if [ "$(uname -s 2>/dev/null)" = VMkernel ]; then
  ESXI=1; AK=/etc/ssh/keys-$U/authorized_keys; R=; P=
  for v in /vmfs/volumes/*; do [ -d "$v/.roster-mesh" ] && { P=$(cd "$v" && pwd -P)/.roster-mesh; break; }; done
  if [ -z "$P" ]; then
    for v in /vmfs/volumes/*; do
      [ -L "$v" ] || continue
      case "${v##*/}" in BOOTBANK*|OSDATA*|LOCKER*|SCRATCH*) continue;; esac
      [ -d "$v" ] && [ -w "$v" ] && { P=$(cd "$v" && pwd -P)/.roster-mesh; break; }
    done
  fi
  [ -n "$P" ] && R=$P/ROSTER.md
else
  ESXI=; AK=$HOME/.ssh/authorized_keys; P=$HOME/.ssh/roster-mesh; R=$HOME/ROSTER.md
fi
"""

PROBE = r"""
umask 077
echo "DIR $P"
[ -n "$ESXI" ] && echo "PLATFORM esxi"
K=$P/id_ed25519
if [ -z "$P" ]; then echo "ERROR no datastore to keep the Mesh's key on (ESXi)"; echo ROSTER_DONE; exit 0; fi
KG=$(command -v ssh-keygen 2>/dev/null || echo /usr/lib/vmware/openssh/bin/ssh-keygen)
if [ "$ROTATE" = 1 ] && [ -f "$K" ]; then
  if [ "$MODE" = apply ]; then rm -f "$K" "$K.pub"; fi
  echo "KEY rotate"
fi
if [ ! -f "$K" ] || [ ! -f "$K.pub" ]; then
  if [ "$MODE" = apply ]; then
    mkdir -p "$P" && rm -f "$K" "$K.pub" && "$KG" -q -t ed25519 -N '' -C "roster-mesh:$NAME" -f "$K" >/dev/null 2>&1 \
      || { echo "ERROR ssh-keygen couldn't make the Mesh's key in $P"; echo ROSTER_DONE; exit 0; }
    echo "KEY made"
  else
    echo "KEY missing"
  fi
fi
[ -f "$K.pub" ] && [ "$MODE" = apply -o "$ROTATE" != 1 ] && echo "PUB $(cat "$K.pub")"
reach() {
  if command -v nc >/dev/null 2>&1; then nc -z -w 5 "$2" "$3" >/dev/null 2>&1 && echo "REACH $1 ok" || echo "REACH $1 fail"
  elif command -v timeout >/dev/null 2>&1 && command -v bash >/dev/null 2>&1; then
    timeout 5 bash -c "exec 3<>/dev/tcp/$2/$3" >/dev/null 2>&1 && echo "REACH $1 ok" || echo "REACH $1 fail"
  else echo "REACH $1 unknown"; fi
}
"""

WRITE = r"""
umask 077
replace() {  # replace PATH < content: a temp file next to it, then mv, so a run cut short leaves PATH as it was;
             # the temp starts as a copy (cp -p), so PATH keeps its mode and owner (and ESXi's sticky bit)
  f=$1; [ -L "$f" ] && f=$(readlink -f "$f" 2>/dev/null || echo "$f")
  n=$f.roster-new; rm -f "$n"
  if { [ ! -f "$f" ] || cp -p "$f" "$n"; } && cat > "$n" && mv -f "$n" "$f"; then return 0; fi
  rm -f "$n"; echo "ERROR couldn't rewrite $1"; return 1
}
put() {  # put PATH LABEL < content: write it when it differs
  t=$(mktemp) || { echo "ERROR mktemp failed"; exit 1; }; cat > "$t"
  if [ -f "$1" ] && cmp -s "$t" "$1"; then echo "SAME $2"
  else echo "CHANGE $2"; [ "$MODE" = apply ] && { mkdir -p "${1%/*}" && replace "$1" < "$t"; }; fi
  rm -f "$t"
}
drop() {  # drop PATH LABEL: remove it if it's there
  [ -e "$1" ] || return 0
  echo "CHANGE $2"; [ "$MODE" = apply ] && rm -f "$1"
}
ours() { [ -f "$1" ] && head -n 1 "$1" | grep -q 'roster-mesh'; }
C=$HOME/.ssh/config; INC="Include $P/config"
"""

SOURCE = r"""
if grep -qxF "$INC" "$C" 2>/dev/null; then echo "SAME include"
else
  echo "CHANGE include"
  if [ "$MODE" = apply ]; then
    mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"; t=$(mktemp)
    { echo "$MARK"; echo "$INC"; grep -vxF -e "$MARK" "$C" 2>/dev/null; } > "$t"; replace "$C" < "$t"; rm -f "$t"
  fi
fi
if [ -n "$R" ] && [ -f "$R" ] && ! ours "$R"; then echo "CONFLICT $R"; fi
if [ -z "$ESXI" ] && [ -d "$HOME/.claude" ]; then
  CM=$HOME/.claude/CLAUDE.md
  if grep -qxF "$IMPORT" "$CM" 2>/dev/null; then echo "SAME claude"
  else
    echo "CHANGE claude"
    if [ "$MODE" = apply ]; then
      t=$(mktemp)
      { cat "$CM" 2>/dev/null; [ -s "$CM" ] && [ -n "$(tail -c 1 "$CM")" ] && echo; echo "$IMPORT"; } > "$t"
      replace "$CM" < "$t"; rm -f "$t"
    fi
  fi
fi
"""

NOT_SOURCE = r"""
if [ -n "$P" ]; then
  for f in id_ed25519 id_ed25519.pub known_hosts config ROSTER.md; do drop "$P/$f" "remove $f"; done
  [ "$MODE" = apply ] && rmdir "$P" 2>/dev/null
fi
if grep -qxF "$INC" "$C" 2>/dev/null; then
  echo "CHANGE remove include"
  if [ "$MODE" = apply ]; then
    t=$(mktemp); grep -vxF -e "$MARK" -e "$INC" "$C" > "$t"; replace "$C" < "$t"; rm -f "$t"; [ -s "$C" ] || rm -f "$C"
  fi
fi
[ -z "$ESXI" ] && ours "$R" && drop "$R" "remove ROSTER.md"
CM=$HOME/.claude/CLAUDE.md
if grep -qxF "$IMPORT" "$CM" 2>/dev/null; then
  echo "CHANGE remove claude"
  if [ "$MODE" = apply ]; then
    t=$(mktemp); grep -vxF "$IMPORT" "$CM" > "$t"; replace "$CM" < "$t"; rm -f "$t"; [ -s "$CM" ] || rm -f "$CM"
  fi
fi
"""

AUTHORIZED = r"""
TAGS=' roster-mesh:[A-Za-z0-9][A-Za-z0-9._-]*$'
H=$(mktemp); grep -E "$TAGS" "$AK" 2>/dev/null > "$H"
[ -n "$KEEP" ] && grep -E " roster-mesh:($KEEP)\$" "$H" >> "$W"
grep -vxFf "$W" "$H" | while read -r l; do echo "DROP ${l##*:}"; done
grep -vxFf "$H" "$W" | while read -r l; do echo "ADD ${l##*:}"; done
S1=$(mktemp); S2=$(mktemp); sort "$H" > "$S1"; sort "$W" > "$S2"
if [ "$MODE" = apply ] && ! cmp -s "$S1" "$S2"; then
  d=${AK%/*}; mkdir -p "$d"; [ -z "$ESXI" ] && chmod 700 "$d"
  t=$(mktemp); grep -vE "$TAGS" "$AK" 2>/dev/null > "$t"; cat "$W" >> "$t"; replace "$AK" < "$t"; rm -f "$t"
  [ -n "$ESXI" ] && [ -x /sbin/auto-backup.sh ] && /sbin/auto-backup.sh >/dev/null 2>&1
fi
rm -f "$H" "$W" "$S1" "$S2"
"""


def preamble(h, mode):
    return (f"NAME={q(h['name'])}\nU={q(h['ssh']['user'])}\nMODE={mode}\nMARK={q(MARK)}\n"
            f"IMPORT={q(CLAUDE_IMPORT)}\n" + WHERE)


def heredoc(text):
    return f"<<'ROSTER_MESH_EOF'\n{text}ROSTER_MESH_EOF\n"


def probe_script(h, peers, mode, rotate):
    """Phase 1 on a source: its key (made on apply), its public key, and whether it reaches each peer's ssh port."""
    lines = [preamble(h, mode), f"ROTATE={1 if rotate else 0}\n", PROBE]
    lines += [f"reach {q(p['name'])} {q(p['ip'])} {p['ssh']['port']}\n" for p in peers]
    return "".join(lines) + "echo ROSTER_DONE\n"


def write_script(h, mode, files, keys, keep):
    """Phase 2 on any Host roster visits: as a source (FILES, {name: text}, or None to remove its source files),
    and as a peer (KEYS: the authorized_keys lines it should hold; KEEP: sources whose lines stay as they are)."""
    s = [preamble(h, mode), WRITE]
    if files is not None:
        s.append(SOURCE)
        for name, text in files.items():
            path = '"$R"' if name == "ROSTER.md" else f'"$P/{name}"'
            guard = 'if [ -n "$R" ] && { [ ! -f "$R" ] || ours "$R"; }; then ' if name == "ROSTER.md" else ""
            s.append(f"{guard}put {path} {q(name)} {heredoc(text)}" + ("fi\n" if guard else ""))
    else:
        s.append(NOT_SOURCE)
    s.append("W=$(mktemp)\ncat > \"$W\" " + heredoc("".join(line + "\n" for line in keys)))
    s.append(f"KEEP={q('|'.join(ere(k) for k in sorted(keep)))}\n")
    s.append(AUTHORIZED)
    return "".join(s) + "echo ROSTER_DONE\n"


def cut_script(h, host, own):
    """On a peer: HOST's key out of authorized_keys. On HOST itself (OWN): every Mesh key out, and its own Mesh files."""
    tag = "[A-Za-z0-9][A-Za-z0-9._-]*" if own else ere(host)
    s = [preamble(h, "apply"), WRITE]
    if own:
        s.append(NOT_SOURCE)
    s.append(f"""T=' roster-mesh:{tag}$'
if [ -f "$AK" ] && grep -qE "$T" "$AK"; then
  t=$(mktemp); grep -vE "$T" "$AK" > "$t"; replace "$AK" < "$t"; rm -f "$t"; echo "CHANGE cut"
  [ -n "$ESXI" ] && [ -x /sbin/auto-backup.sh ] && /sbin/auto-backup.sh >/dev/null 2>&1
fi
grep -qE "$T" "$AK" 2>/dev/null && echo "ERROR a roster-mesh line is still there" || echo ROSTER_DONE
""")
    return "".join(s)


# ---------------------------------------------------------------- running on a Host from the Box

def on_host(h, script, timeout=STEP_TIMEOUT):
    """Run SCRIPT on H over the Box's ssh (its key, roster's ssh config). Returns (report lines, None) or
    (None, why it didn't finish). The script goes as bytes: text mode on Windows would hand sh "\r\n" line ends."""
    try:
        r = subprocess.run(program_argv(["ssh", "-o", "BatchMode=yes", "-o", f"ConnectTimeout={CONNECT_TIMEOUT}",
                                         h["name"], "sh -s"]),
                           input=script.encode(), capture_output=True, timeout=time_left(timeout))
    except subprocess.TimeoutExpired:
        return None, "didn't answer in time"
    except FileNotFoundError:
        return None, "ssh isn't installed on this Box"
    stdout, stderr = r.stdout.decode(errors="replace"), r.stderr.decode(errors="replace")
    lines = stdout.splitlines()
    err = next((x[6:] for x in lines if x.startswith("ERROR ")), None)
    if err:
        return None, err
    if "ROSTER_DONE" not in lines:
        words = (stderr.strip().splitlines() or [f"exit {r.returncode}"])[-1]
        return None, f"no answer: {words}" if r.returncode == 255 else f"stopped part way: {words}"
    return lines, None


def report(lines, prefix):
    return [x[len(prefix):] for x in lines if x.startswith(prefix)]


# ---------------------------------------------------------------- what each source's files say

def host_key_lines(t):
    return [f"{hk_name(t)} {kt} {k.get_base64()}" for kt, k in sorted(recorded_host_keys(t).items())]


def ssh_config(cfg, src, peers, d):
    out = [f"# Written by roster mesh for {src} from {cfg['path'].name}: the Hosts {src} reaches. Don't edit by hand.",
           ""]
    for p in peers:
        out += [f"Host {p['name']}", f"    HostName {p['ip']}", f"    User {p['ssh']['user']}",
                f"    Port {p['ssh']['port']}", f"    UserKnownHostsFile {d}/known_hosts",
                "    StrictHostKeyChecking yes", f"    ConnectTimeout {CONNECT_TIMEOUT}"]
        if p["enroll"]:
            out += [f"    IdentityFile {d}/id_ed25519", "    IdentitiesOnly yes"]
        else:
            out += ["    PubkeyAuthentication no", "    PreferredAuthentications password,keyboard-interactive"]
        out.append("")
    return "\n".join(out)


def roster_md(src, peers, d, esxi):
    ssh = f"ssh -F {d}/config" if esxi else "ssh"
    md = [f"<!-- roster-mesh: written by roster for {src}; roster mesh rewrites it, don't edit by hand -->",
          f"# Hosts {src} can reach", "",
          f"From this Host, `{ssh} <name>` logs in to the Hosts below as their own user. No password or vault is "
          "kept on this Host.", "",
          "- **access = key**: `" + ssh + " <name> '<command>'` works without a password.",
          "- **access = password**: ssh asks for the password. Never ask the user for it and never store it: ask the "
          f"user to log in themselves (`{ssh} <name>` in their own terminal).",
          "- Never read, print or copy the Mesh's private key, and ask before changing anything on another Host.", "",
          "| name | address | access |", "|---|---|---|"]
    md += [f"| {p['name']} | {p['ssh']['user']}@{p['ip']}:{p['ssh']['port']} | {'key' if p['enroll'] else 'password'} |"
           for p in peers]
    return "\n".join(md) + "\n"


def key_line(src, pub):
    parts = pub.split()
    return f"{OPTIONS.format(ip=src['ip'])} {parts[0]} {parts[1]} {TAG}:{src['name']}"


# ---------------------------------------------------------------- plan and apply

def run(cfg, apply=False, rotate=(), say=None):
    """The Mesh as roster.yml asks for it, against what the Hosts hold now, one connection at a time.
    Plan (apply=False) changes nothing anywhere; apply makes it so and remembers what it couldn't finish.
    ROTATE: sources whose key is replaced. Returns the result serve and the CLI show (docs/serve-api.md, mesh.plan)."""
    say = say or (lambda msg: None)
    hosts, mode = cfg["hosts"], "apply" if apply else "check"
    g = graph(cfg)
    st = load_state()
    unknown = [r for r in rotate if r not in g["sources"]]
    if unknown:
        from .errors import NOT_A_SOURCE, Problem
        raise Problem(NOT_A_SOURCE, f"{', '.join(unknown)} isn't a Mesh source, so it has no Mesh key to replace",
                      {"hosts": unknown}, fix="rotate a Host that reaches peers (roster mesh --dry-run lists them)")
    # Hosts roster wrote on before and still knows how to reach: visited too, so what's no longer asked for goes
    ex = sorted(n for n in set(st["members"]) | set(st["pending"]) if n not in g["visit"] and n in hosts
                and hosts[n]["enroll"] and hosts[n]["reviewed"])
    gone = sorted(n for n in set(st["members"]) if n not in hosts)
    links = [dict(x) for x in g["links"]]
    out = {"host": {}, "probe": {}}

    def finish(name, changes, error=None):
        out["host"][name] = {"host": name, "changes": changes,
                             "status": "pending" if error else ("changed" if changes and apply else
                                                                "would-change" if changes else "same"),
                             **({"error": error} if error else {})}

    # phase 1: each source's key, and whether it reaches its peers
    for name in g["sources"]:
        peers = [hosts[x["to"]] for x in links if x["from"] == name and "skip" not in x]
        if past_deadline():
            out["probe"][name] = {"error": OUT_OF_TIME}
            continue
        say(f"  probe  {name}")
        lines, err = on_host(hosts[name], probe_script(hosts[name], peers, mode, name in rotate))
        if err:
            out["probe"][name] = {"error": err}
            continue
        pub = report(lines, "PUB ")
        out["probe"][name] = {"dir": report(lines, "DIR ")[0], "esxi": "PLATFORM esxi" in lines, "pub": pub[0] if pub else None,
                              "key": report(lines, "KEY "),
                              "reach": dict(x.split(" ", 1) for x in report(lines, "REACH "))}

    # each link's status, from what the probe found
    for x in links:
        p = out["probe"].get(x["from"], {})
        t = hosts[x["to"]]
        if "skip" in x:
            x["status"], x["why"] = "skipped", f"{x['from']} is a password Host: roster doesn't write on it"
        elif "error" in p:
            x["status"], x["why"] = "pending", f"{x['from']}: {p['error']}"
        elif not recorded_host_keys(t):
            x["status"] = "no-host-key"
            x["why"] = f"no recorded host key for {x['to']} on this Box (roster setup --only {x['to']})"
        elif p["reach"].get(x["to"]) == "fail":
            x["status"], x["why"] = "unreachable", f"{x['from']} can't reach {t['ip']}:{t['ssh']['port']}"
        else:
            x["status"] = "ok" if p["reach"].get(x["to"]) == "ok" else "untested"
            if x["status"] == "untested":
                x["why"] = f"{x['from']} has no nc or bash to test the port with"
    written = [x for x in links if x["status"] in ("ok", "untested")]

    # phase 2: every Host roster visits, as a source and as a peer
    for name in sorted(set(g["visit"]) | set(ex)):
        h = hosts[name]
        p = out["probe"].get(name)
        if p is not None and "error" in p:
            finish(name, [], p["error"])
            continue
        if past_deadline():
            finish(name, [], OUT_OF_TIME)
            continue
        files = None
        if name in g["sources"]:
            peers = [hosts[x["to"]] for x in written if x["from"] == name]
            d = p["dir"]
            files = {"known_hosts": "".join(line + "\n" for t in peers for line in host_key_lines(t)),
                     "config": ssh_config(cfg, name, peers, d), "ROSTER.md": roster_md(name, peers, d, p["esxi"])}
        keys, keep = [], set()
        for x in links:
            if x["to"] != name or x["kind"] != "key" or "skip" in x:
                continue
            src = out["probe"].get(x["from"], {})
            if x["status"] == "pending":
                keep.add(x["from"])
            elif x["status"] in ("ok", "untested"):
                keys.append(key_line(hosts[x["from"]], src["pub"]) if src.get("pub")
                            else f"new-key {x['from']} {TAG}:{x['from']}")
        say(f"  {'write' if apply else 'check'}  {name}")
        lines, err = on_host(h, write_script(h, mode, files, sorted(keys, key=lambda k: k.rsplit(":", 1)[1]), keep))
        if err:
            finish(name, [], err)
            continue
        changes = key_changes(out["probe"].get(name), apply, name in rotate)
        added, dropped = set(report(lines, "ADD ")), set(report(lines, "DROP "))
        changes += [f"write {x}" for x in report(lines, "CHANGE ") if not x.startswith("remove ")]
        changes += [x for x in report(lines, "CHANGE ") if x.startswith("remove ")]
        changes += [f"replace key from {s}" for s in sorted(added & dropped)]
        changes += [f"add key from {s}" for s in sorted(added - dropped)]
        changes += [f"remove key from {s}" for s in sorted(dropped - added)]
        changes = [c.replace("write include", "write Include in ~/.ssh/config")
                   .replace("write claude", "write the import in ~/.claude/CLAUDE.md")
                   .replace("remove include", "remove the Include from ~/.ssh/config")
                   .replace("remove claude", "remove the import from ~/.claude/CLAUDE.md") for c in changes]
        finish(name, changes)
        for path in report(lines, "CONFLICT "):
            out.setdefault("warnings", []).append(
                f"{name}: {path} isn't roster's, so roster left it alone (move it away and apply again)")

    result = summary(cfg, g, links, out, apply, gone)
    if apply:
        record(cfg, g, st, result, ex)
    result["cut_pending"] = load_state()["cut"] if apply else st["cut"]
    return result


def key_changes(probe, apply, rotate):
    """What happens to a source's own key: [] / ["make key"] / ["replace key"]."""
    if not probe or "key" not in probe:
        return []
    k = probe["key"]
    return ["replace key"] if "rotate" in k else ["make key"] if ("made" in k or "missing" in k) else []


def summary(cfg, g, links, out, apply, gone):
    rows = [out["host"][n] for n in sorted(out["host"])]
    pending = {r["host"]: r["error"] for r in rows if r["status"] == "pending"}
    changed = any(r["changes"] for r in rows)
    warnings = list(out.get("warnings", []))
    warnings += [f"{n} left roster.yml: roster can't reach it any more, so its own Mesh files stay there"
                 for n in gone]
    return {"applied": apply, "links": links, "hosts": rows, "excluded": g["excluded"],
            "reach": {s: sum(1 for x in links if x["from"] == s and x["status"] in ("ok", "untested"))
                      for s in g["sources"]},
            "pending": pending, "already": not changed and not pending, "warnings": warnings}


def record(cfg, g, st, result, ex):
    done = {r["host"] for r in result["hosts"] if r["status"] != "pending"}
    st["pending"] = result["pending"]
    st["members"] = sorted((set(g["visit"]) | set(result["pending"])) - (set(ex) & done))
    for host, peers in list(st["cut"].items()):
        if host in g["visit"]:
            del st["cut"][host]                 # back in the Mesh: the apply made it what roster.yml says
            continue
        st["cut"][host] = [p for p in peers if p not in done]
        if not st["cut"][host]:
            del st["cut"][host]
    st["applied"] = digest(cfg, g) if not result["pending"] else st.get("applied")
    save_state(st)


# ---------------------------------------------------------------- status and drift

def status(cfg):
    """No connections: who reaches whom as roster.yml says, what's unfinished, and whether roster.yml changed the
    Mesh since the last complete apply on this Box."""
    g = graph(cfg)
    st = load_state()
    return {"links": g["links"], "excluded": g["excluded"], "reach": reach(g), "members": g["visit"],
            "pending": st["pending"], "cut_pending": st["cut"],
            "out_of_date": bool(g["links"] or st["members"]) and st["applied"] != digest(cfg, g)}


def drift(cfg):
    """`roster check`'s Mesh part: a plan (read-only, so it connects to each Host roster visits), or None when
    there's no Mesh. Every change it would make is drift: something on a Host isn't what roster wrote."""
    if not graph(cfg)["links"] and not load_state()["members"]:
        return None
    return run(cfg)


# ---------------------------------------------------------------- cut

def cut(cfg, name, workers=16):
    """HOST out of the Mesh now, in parallel: its key off every peer, every peer's key off HOST, HOST's own Mesh
    files gone. The Box's own key (roster-managed) is never touched. Returns {host, confirmed, pending: {host: why}}."""
    hosts = cfg["hosts"]
    h = hosts[name]
    g = graph(cfg)
    st = load_state()
    peers = sorted(n for n in (set(g["visit"]) | set(st["members"]) | set(st["cut"].get(name, [])))
                   if n in hosts and n != name and hosts[n]["enroll"] and hosts[n]["reviewed"])
    todo = [(n, False) for n in peers] + ([(name, True)] if h["enroll"] and h["reviewed"] else [])
    at = current_deadline()                     # serve's, for the worker threads too

    def one(item):
        n, own = item
        with deadline_at(at):
            if past_deadline():
                return n, OUT_OF_TIME
            _, err = on_host(hosts[n], cut_script(hosts[n], name, own), timeout=CUT_TIMEOUT)
        return n, err

    confirmed, pending = [], {}
    with cf.ThreadPoolExecutor(max(1, min(workers, len(todo)))) as ex:
        for n, err in ex.map(one, todo):
            if err:
                pending[n] = err
            else:
                confirmed.append(n)
    st = load_state()
    if pending:
        st["cut"][name] = sorted(pending)
    else:
        st["cut"].pop(name, None)
    # HOST leaves the Mesh's bookkeeping once its own part is done; its peers stay (they still hold each other's keys)
    st["members"] = sorted((set(st["members"]) - {name}) | set(pending))
    st["applied"] = None
    save_state(st)
    return {"host": name, "confirmed": sorted(confirmed), "pending": pending}


def write_cut(cfg, name):
    """`mesh: false` for Host NAME in roster.yml, as a Pending change (edit.py: every other byte kept), so the cut
    survives the next Publish. {written, backup?, note?} or {written: False, error, fix}."""
    from . import changes, edit
    from .errors import NOT_A_REPO, Problem
    if cfg["hosts"][name]["mesh"] is False:
        return {"written": False, "note": f"{name} already has mesh: false in roster.yml"}
    try:
        try:
            repo = changes.Repo(cfg["path"])
        except Problem as e:
            if e.code != NOT_A_REPO:
                raise
            repo = None
        old, new, _ = edit.edited(cfg["path"], name, {"mesh": False})
        backup = repo.backup(old) if repo else None
        edit.replace_file(cfg["path"], new)
    except Problem as e:
        return {"written": False, "error": e.message, "fix": f"set mesh: false for {name} in roster.yml by hand"}
    if repo is None:
        return {"written": True, "backup": None,
                "note": f"{cfg['path']} isn't in a git repo: mesh: false was written straight to it"}
    return {"written": True, "backup": str(backup)}
