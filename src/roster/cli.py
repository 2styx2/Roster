"""Command-line interface:  roster <command>"""

import argparse
import concurrent.futures as cf
import os
import shlex
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

from . import __version__
from .claude import write_claude_files
from .common import die, say, ssh_config_file, tcp_ok
from .config import access_label, find_config, load_config, matches, selected
from .discover import DEFAULT_SCAN_PORTS, cmd_discover
from .example import EXAMPLE_CONFIG
from .providers import NO_PASSWORD, PROVIDERS, get_secret, setup_providers
from .resources import TYPES, fields, login, summary, wifi_uri
from .sshops import (
    enroll,
    ensure_key,
    password_exec,
    public_key_line,
    record_fingerprints,
    remove_key_script,
    ssh_ok,
    sudo_wrap,
    write_ssh_config,
)
from .web import cmd_web, mask

# ---------------------------------------------------------------- commands

def cmd_init(args):
    path = Path(args.config or "roster.yml").expanduser()
    if path.exists():
        die(f"{path} already exists")
    path.write_text(EXAMPLE_CONFIG)
    say(f"wrote {path} - edit it, then run: roster setup")


def cmd_setup(cfg, args):
    hosts = selected(cfg, args.only)
    waiting = [h for h in hosts if not h["reviewed"]]
    hosts = [h for h in hosts if h["reviewed"]]
    if waiting:
        say(f"skipping     {len(waiting)} hosts with reviewed: false (from discover) - review them in "
            "roster.yml, set reviewed: true, then re-run setup")
    if not hosts:
        return 0
    say(f"roster setup box '{cfg['box']}', {len(hosts)} hosts from {cfg['path']}")
    ensure_key(cfg)
    pub = public_key_line(cfg)
    no_answer = record_fingerprints(cfg, hosts)
    write_ssh_config(cfg)

    key_hosts = [h for h in hosts if h["enroll"] and h["name"] not in no_answer]
    pw_hosts = [h for h in hosts if not h["enroll"]]
    with cf.ThreadPoolExecutor(cfg["workers"]) as ex:
        works = dict(zip([h["name"] for h in key_hosts], ex.map(lambda h: ssh_ok(h["name"]), key_hosts), strict=True))
    todo = [h for h in key_hosts if not works[h["name"]]]
    say(f"key login    {len(key_hosts) - len(todo)} already work, {len(todo)} need the key installed")

    failed = {h["name"]: "no answer on SSH port" for h in hosts if h["name"] in no_answer}
    if args.dry_run:
        for h in todo:
            say(f"  would install key on {h['name']} ({h['user']}@{h['ip']}:{h['port']}, auth {h['auth']})")
        return 0

    for ref, group in sorted({(h["auth"], h["group"]) for h in todo}, key=lambda t: (str(t[0]), t[1])):
        try:
            get_secret(ref, group)          # ask for / fetch passwords up front, one per group
        except RuntimeError as e:
            for h in todo:
                if (h["auth"], h["group"]) == (ref, group):
                    failed[h["name"]] = str(e)
    todo = [h for h in todo if h["name"] not in failed]

    installed = 0
    if todo:
        say(f"installing   key on {len(todo)} hosts...")
        with cf.ThreadPoolExecutor(cfg["workers"]) as ex:
            futs = {ex.submit(enroll, h, pub, cfg["tag_re"]): h for h in todo}
            for f in cf.as_completed(futs):
                h = futs[f]
                try:
                    f.result()
                    installed += 1
                    say(f"  ok    {h['name']}")
                except Exception as e:
                    failed[h["name"]] = str(e)
                    say(f"  FAIL  {h['name']}: {e}")

    write_claude_files(cfg)
    ready = len(key_hosts) - len(todo) + installed
    say()
    say(f"done         {ready} key hosts ready, {len(pw_hosts)} password-only hosts, {len(failed)} failed")
    if failed:
        say("failed hosts (fix, then re-run setup - hosts that already work are skipped):")
        for name, why in sorted(failed.items()):
            say(f"  {name}: {why}")
    return 1 if failed else 0


def cmd_sync(cfg, args):
    write_ssh_config(cfg)
    write_claude_files(cfg)
    say("note: new hosts still need `roster setup` (it only touches hosts that aren't ready)")
    return 0


def cmd_check(cfg, args):
    hosts = selected(cfg, args.only)

    def check(h):
        res = {"ssh": ssh_ok(h["name"]) if h["enroll"] else tcp_ok(h["ip"], h["ssh"]["port"])}
        for name, s in h["services"].items():
            res[name] = tcp_ok(urlparse(s["url"]).hostname if s["url"] else h["ip"], s["port"])
        return h, res

    bad = 0
    width = max(len(h["name"]) for h in hosts)
    with cf.ThreadPoolExecutor(cfg["workers"]) as ex:
        for h, res in sorted(ex.map(check, hosts), key=lambda r: r[0]["name"]):
            line = "  ".join(f"{k}:{'ok' if v else 'FAIL'}" for k, v in res.items())
            bad += not all(res.values())
            say(f"{h['name']:<{width}}  {line}")
    say(f"\n{len(hosts) - bad}/{len(hosts)} hosts fully reachable"
        + ("" if all(h["enroll"] for h in hosts) else "  (password-only hosts: ssh = port open)"))
    return 1 if bad else 0


def logins_label(h):
    """What a person can use on a host, short: 'ssh (key), web (admin), api'."""
    if not h["reviewed"]:
        return "unreviewed"
    no_ssh = h["ssh"]["user"] in ("", "CHANGE-ME")    # discover's placeholder: no SSH login set yet
    parts, seen = [] if no_ssh else [f"ssh ({access_label(h)})"], set()
    for name, s in h["services"].items():
        if not s["url"]:
            continue                                   # a bare port: nothing to log in to
        own = s["override"] or s["login"] not in ("basic", "none")
        label = name if own else "web"
        if label in seen or (label == "web" and any(x.startswith("web") for x in seen)):
            continue
        seen.add(label)
        user = s["user"] if s["user"] not in ("", "CHANGE-ME", h["ssh"]["user"]) else ""
        parts.append(f"{label} ({user})" if user else label)
    return ", ".join(parts)


def cmd_hosts(cfg, args):
    hosts, rs = selected(cfg, args.only, resources=True)
    if args.find:
        hosts = [h for h in hosts if matches(h, args.find)]
        rs = [r for r in rs if resource_matches(r, args.find)]
        if not hosts and not rs:
            say(f"no host matches {args.find!r} (searched name, title, description, type, product, group, ip)")
            return 1
    hosts = sorted(hosts, key=lambda h: (h["group"], h["name"]))
    if args.long:
        rows = [("NAME", "TITLE", "TYPE", "PRODUCT", "ADDRESS", "ACCESS", "WEB", "DESCRIPTION")]
        rows += [(h["name"], h["title"] or "-", h["type"] or "-", h["product"] or "-",
                  f"{h['user']}@{h['ip']}:{h['port']}", access_label(h), h["web"] or "-", h["description"])
                 for h in hosts]
        _table(rows)
        return 0
    hidden = []
    if not (args.all or args.find or args.only):
        hidden = [h for h in hosts if not h["reviewed"]]
        hosts = [h for h in hosts if h["reviewed"]]
    rows = [("NAME", "IP", "USER", "LOGINS", "TITLE")]
    rows += [(h["name"], h["ip"] if h["ssh"]["port"] == 22 else f"{h['ip']}:{h['ssh']['port']}",
              h["ssh"]["user"] if h["ssh"]["user"] not in ("", "CHANGE-ME") else "-",
              logins_label(h) or "-", h["title"] or "-") for h in hosts]
    rows += [(r["name"], "-", r["user"] or "-", r["type"], r["title"] or "-")
             for r in sorted(rs, key=lambda r: (r["type"], r["name"]))]
    _table(rows)
    if hidden:
        say(f"\n{len(hidden)} unreviewed hosts not shown (roster hosts --all). "
            "roster hosts --long shows type, web URL and description.")
    return 0


def _table(rows):
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]) - 1)]
    for r in rows:
        say("  ".join(c.ljust(w) for c, w in zip(r, widths, strict=False)) + "  " + r[-1])


def find_host(cfg, words, resources=False):
    """The host (or, with resources=True, the resource) named by words: exact name, else the one match."""
    name = " ".join(words)
    pool = {**cfg["hosts"], **(cfg["resources"] if resources else {})}
    h = pool.get(name)
    found = [x for x in pool.values() if (matches if "ip" in x else resource_matches)(x, name)]
    if not h and len(found) == 1:
        h = found[0]                       # "info core switch" -> the one host that matches
    if not h:
        found = [x["name"] for x in found]
        what = "host or resource" if resources else "host"
        die(f"unknown {what} {name!r}" + (f" - did you mean: {', '.join(found[:10])}" if found else ""))
    return h


def resource_matches(r, text):
    """Every word appears in one of the resource's fields: 'guest wifi', 'lab'."""
    hay = " ".join(str(v) for _, v in fields(r)).lower()
    words = [w for w in text.lower().replace("_", " ").replace("-", " ").split() if w]
    return bool(words) and all(w in hay for w in words)


def cmd_resources(cfg, args):
    rs = sorted(cfg["resources"].values(), key=lambda r: (r["type"], r["name"]))
    if args.only:
        wanted = {s.strip() for s in args.only.split(",") if s.strip()}
        rs = [r for r in rs if wanted & {r["name"], r["type"], r["group"]}]     # unlike hosts, no match isn't fatal
    if args.find:
        rs = [r for r in rs if resource_matches(r, args.find)]
    if not rs:
        if cfg["resources"]:
            say("no resource matches")
            return 1
        say("no resources in roster.yml. Types you can add under `resources:`:")
        for kind, spec in TYPES.items():
            say(f"  {kind:<8} {spec['help']}")
        return 0
    rows = [("NAME", "TYPE", "GROUP", "DETAILS", "LOGIN", "TITLE")]
    rows += [(r["name"], r["type"], r["group"] or "-", summary(r) or "-", login(r), r["title"] or r["description"])
             for r in rs]
    widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]) - 1)]
    for r in rows:
        say("  ".join(c.ljust(w) for c, w in zip(r, widths, strict=False)) + "  " + r[-1])
    return 0


def show_resource(cfg, r):
    for label, v in fields(r):
        if label == "group" and v:
            g = cfg["groups"].get(v, {})
            v += f" ({g['title']})" if g.get("title") else ""
        say(f"{label:<12} {v if v != '' else '-'}")
    say(f"{'secret':<12} " + (f"roster reveal {r['name']}" if r["auth"] else "none"))
    return 0


def cmd_reveal(cfg, args):
    r = cfg["resources"].get(args.name)
    if not r:
        die(f"unknown resource {args.name!r} (see `roster resources`)")
    if args.wifi and r["type"] != "wifi":
        die(f"{r['name']} is a {r['type']}, not wifi")
    secret = ""
    if r["auth"]:
        try:
            secret = get_secret(r["auth"], r["group"] or "resources")
        except RuntimeError as e:
            die(f"{r['name']}: {e}")
    say(wifi_uri(r, secret) if args.wifi else secret)
    return 0


def cmd_info(cfg, args):
    h = find_host(cfg, args.host, resources=True)
    if "ip" not in h:
        return show_resource(cfg, h)
    g = cfg["groups"].get(h["group"], {})
    fields = [("name", h["name"]), ("title", h["title"]), ("description", h["description"]),
              ("type", h["type"]), ("product", h["product"]),
              ("group", h["group"] + (f" ({g['title']})" if g.get("title") else "")),
              ("address", f"{h['user']}@{h['ip']}:{h['port']}"),
              ("access", "not set up yet (reviewed: false)" if not h["reviewed"] else
               "key: ssh " + h["name"] if h["enroll"] else f"password: roster run {h['name']} -- CMD"),
              ("mac", h["mac"]),
              ("ssh login", login_label(h["ssh"])),
              ("login", login_label(h["login"]) + " (default for services)" if any(h["login"].values()) else ""),
              ("web UI", h["web"])]
    for k, v in fields:
        if v:
            say(f"{k:<12} {v}")
    rows = [(name, str(s["port"]), s["url"] or "-",
             login_label(s) + (" (own login)" if s["override"] else " (host default)" if s["auth"] or s["user"]
                               else "")) for name, s in h["services"].items()]
    widths = [max(len(r[i]) for r in rows) for i in range(3)] if rows else []
    for i, r in enumerate(rows):
        say(f"{'services' if i == 0 else '':<12} " + "  ".join(c.ljust(w) for c, w in zip(r, widths, strict=False))
            + "  " + r[-1])
    return 0


def login_label(s):
    """Who logs in and where the password comes from - the reference only, never a value."""
    if not s.get("user") and not s.get("auth"):
        return "no login"
    return f"{s.get('user') or '(no user)'}, auth {s.get('auth') or 'none'}"


def cmd_run(cfg, args):
    h = cfg["hosts"].get(args.host)
    if not h:
        die(f"unknown host {args.host!r} (see `roster hosts`)")
    words = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not words:
        die("nothing to run: roster run HOST -- COMMAND")
    command = " ".join(words)
    if not h["reviewed"]:
        die(f"{h['name']} is not reviewed yet (reviewed: false in roster.yml) - not logging in")
    if args.sudo:
        return run_sudo(h, command)
    if h["enroll"]:
        os.execvp("ssh", ["ssh", "-o", "BatchMode=yes", h["name"], command])
    try:
        rc, out, err = password_exec(h, command, get_secret(h["ssh"]["auth"], h["group"]))
    except RuntimeError as e:
        die(f"{h['name']}: {e}")
    sys.stdout.write(out)
    sys.stderr.write(err)
    if words[0] == "sudo" and rc != 0 and ("password is required" in err or "terminal is required" in err):
        print(f"hint: sudo wants a password - use  roster run --sudo {h['name']} -- {' '.join(words[1:])}",
              file=sys.stderr)
    return rc if rc >= 0 else 1


def run_sudo(h, command):
    """Run COMMAND as root: sudo gets the host's login password on stdin, never on screen."""
    try:
        secret = get_secret(h["ssh"]["auth"], h["group"])
    except RuntimeError as e:
        die(f"{h['name']}: {e}")
    if not secret:
        die(f"{h['name']}: --sudo needs the login's password, but its auth is {h['ssh']['auth']!r} "
            "(set auth: to the vault item that holds the password)")
    wrapped = sudo_wrap(command)
    if h["enroll"]:
        r = subprocess.run(["ssh", "-o", "BatchMode=yes", h["name"], wrapped], input=secret + "\n",
                           capture_output=True, text=True)
        rc, out, err = r.returncode, r.stdout, r.stderr
    else:
        try:
            rc, out, err = password_exec(h, wrapped, secret, stdin=secret + "\n")
        except RuntimeError as e:
            die(f"{h['name']}: {mask(str(e), [secret])}")
    sys.stdout.write(mask(out, [secret]))
    sys.stderr.write(mask(err, [secret]))
    if "incorrect password" in err or "no password was provided" in err:
        print(f"{h['name']}: sudo refused the password from {h['ssh']['auth']} - "
              f"is {h['ssh']['user']} allowed to sudo there?", file=sys.stderr)
    return rc if rc >= 0 else 1


def cmd_revoke(cfg, args):
    hosts = [h for h in selected(cfg, args.only) if h["enroll"]]
    if not args.yes:
        ans = input(f"Remove key '{cfg['tag']}' from {len(hosts)} hosts? This box loses access. [y/N] ")
        if ans.strip().lower() != "y":
            return 1
    script = "sh -c " + shlex.quote(remove_key_script(cfg["tag_re"]))

    def revoke(h):
        r = subprocess.run(["ssh", "-o", "BatchMode=yes", h["name"], script],
                           stdin=subprocess.DEVNULL, capture_output=True, text=True)
        subprocess.run(["ssh", "-O", "exit", h["name"]], capture_output=True)  # drop cached connection
        return h, "ROSTER_OK" in r.stdout

    bad = 0
    with cf.ThreadPoolExecutor(cfg["workers"]) as ex:
        for h, ok in ex.map(revoke, hosts):
            bad += not ok
            say(f"  {'ok  ' if ok else 'FAIL'}  {h['name']}")
    say(f"\nremoved from {len(hosts) - bad}/{len(hosts)} hosts. "
        f"To finish, delete {cfg['key']}, {cfg['pub']} and {ssh_config_file()} on this box.")
    return 1 if bad else 0


def cmd_providers(cfg, args):
    import shutil
    used = {}
    for h in (cfg or {}).get("hosts", {}).values():
        for ref in {h["ssh"]["auth"], *(s["auth"] for s in h["services"].values())} - {None}:
            used.setdefault(ref.split(":", 1)[0], set()).add(h["group"])
    for r in (cfg or {}).get("resources", {}).values():
        if r["auth"]:
            used.setdefault(r["auth"].split(":", 1)[0], set()).add(r["group"] or "resources")
    say("password providers (use as  auth: NAME:SPEC  in roster.yml):\n")
    for name in sorted(PROVIDERS):
        p = PROVIDERS[name]
        tool = p.get("tool") or ""
        installed = "" if not tool else ("  [tool found]" if shutil.which(tool) else f"  [`{tool}` NOT installed]")
        groups = f"  - used by: {', '.join(sorted(used[name]))}" if name in used else ""
        say(f"  {name:<8} {p['kind']:<10} {p['help']}{installed}{groups}")
    say(f"  {'agent':<8} {'built-in':<10} no password: an SSH key you already have (ssh-agent) gets in")
    unknown = sorted(set(used) - set(PROVIDERS) - set(NO_PASSWORD))
    if unknown:
        say(f"\nUNKNOWN providers used in roster.yml: {', '.join(unknown)}")
        return 1
    return 0


def cmd_auth_check(cfg, args):
    uses = {}                                    # (ref, group) -> [(service, host, user)]
    hosts, resources = selected(cfg, args.only, resources=True)
    for h in hosts:
        for svc, s in [("ssh", h["ssh"]), *h["services"].items()]:
            if svc == "ssh" or s["auth"] is not None:
                uses.setdefault((s["auth"], h["group"]), []).append((svc, h["name"], s["user"]))
    for r in resources:
        if r["auth"]:
            uses.setdefault((r["auth"], r["group"] or "resources"), []).append((r["type"], r["name"], r["user"]))
    bad = 0
    for ref, group in sorted(uses, key=lambda t: (t[1], str(t[0]))):
        users = sorted({u for _, _, u in uses[ref, group] if u})
        label = f"{group:<16} {str(ref):<36} users: {', '.join(users) or '-'}  for: {used_for(uses[ref, group])}"
        if ref == "prompt":
            say(f"  ask   {label}  (asked when setup runs)")
            continue
        try:
            get_secret(ref, group)
            say(f"  ok    {label}")
        except RuntimeError as e:
            bad += 1
            say(f"  FAIL  {label}\n        {e}")
    say("\nok = a value was found. It is not tested against any host here; `setup` does that.")
    return 1 if bad else 0


def used_for(uses):
    """'ssh (12 hosts), https (orion3)' - which services on which hosts use one password source."""
    by_svc = {}
    for svc, host, _ in uses:
        by_svc.setdefault(svc, []).append(host)
    return ", ".join(f"{svc} ({hs[0] if len(hs) == 1 else f'{len(hs)} hosts'})" for svc, hs in by_svc.items())


def cmd_bw(args):
    """The Bitwarden CLI with this box's vault session (~/.config/roster/bw-session), so scripts and
    Claude sessions don't each carry BW_SESSION around. Never prompts: --nointeraction is added."""
    from .providers.bitwarden import load_session_file
    argv = args.args[1:] if args.args[:1] == ["--"] else list(args.args)
    if not argv:
        die("usage: roster bw <bw arguments>   e.g.  roster bw list items --search proxmox")
    load_session_file()
    if "--nointeraction" not in argv:
        argv.append("--nointeraction")
    try:
        return subprocess.run(["bw", *argv]).returncode
    except FileNotFoundError:
        die("bw (the Bitwarden CLI) isn't installed")


def main(argv=None):
    try:
        return _main(argv) or 0
    except KeyboardInterrupt:
        return 130
    except BrokenPipeError:              # output piped into head/grep that closed early
        sys.stdout = None
        os._exit(0)


def _main(argv=None):
    p = argparse.ArgumentParser(prog="roster",
                                description="Give this box (and Claude) access to the hosts in roster.yml.")
    p.add_argument("--version", action="version", version=f"roster {__version__}")
    p.add_argument("-c", "--config", help="path to roster.yml (default: ./roster.yml, then ~/.config/roster/)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init", help="write an example roster.yml")
    s = sub.add_parser("setup", help="one-time setup of this box")
    s.add_argument("--only")
    s.add_argument("--dry-run", action="store_true", help="show what would happen, change nothing remote")
    sub.add_parser("sync", help="rewrite ssh config and Claude files from roster.yml")
    s = sub.add_parser("check", help="test reachability")
    s.add_argument("--only")
    s = sub.add_parser("hosts", help="list hosts")
    s.add_argument("--only")
    s.add_argument("--find", help="search name, title, description, type, product, group, ip")
    s.add_argument("--all", action="store_true", help="include unreviewed (scanned) hosts")
    s.add_argument("--long", action="store_true", help="full table: type, product, web URL, description")
    s = sub.add_parser("resources", help="list Wi-Fi networks, accounts and secrets that aren't hosts")
    s.add_argument("--only", help="resource names, types or groups")
    s.add_argument("--find", help="search every field")
    s = sub.add_parser("reveal", help="print a resource's secret (e.g. a Wi-Fi password) - for people, not Claude")
    s.add_argument("name")
    s.add_argument("--wifi", action="store_true", help="print a WIFI:... string for a QR code instead")
    s = sub.add_parser("info", help="show everything about one host or resource")
    s.add_argument("host", nargs="+")
    s = sub.add_parser("run", help="run a command on a host")
    s.add_argument("--sudo", action="store_true",
                   help="run it as root with sudo; roster gives sudo the login's password (never shown)")
    s.add_argument("host")
    s.add_argument("command", nargs=argparse.REMAINDER)
    s = sub.add_parser("discover", help="scan networks (nmap if installed) and add what's found to roster.yml")
    s.add_argument("targets", nargs="+", metavar="CIDR", help="e.g. 10.0.1.0/24 (several allowed)")
    s.add_argument("--write", action="store_true", help="add new hosts to roster.yml (default: preview only)")
    s.add_argument("--group", help="group name for new hosts (default: discovered-YYYYMMDD)")
    s.add_argument("--ports", default=DEFAULT_SCAN_PORTS, help="TCP ports to scan (default: common server, "
                   "web, database, remote-admin and network-gear ports)")
    s.add_argument("--top-ports", type=int, help="nmap only: scan nmap's N most common ports instead")
    s.add_argument("--no-ping", action="store_true", help="nmap only: scan hosts that don't answer ping (slower)")
    s.add_argument("--os", action="store_true", help="nmap only: OS detection (needs sudo)")
    s.add_argument("--builtin", action="store_true", help="use the built-in scanner even if nmap is installed")
    s.add_argument("--timeout", type=float, default=0.5, help="built-in scanner connect timeout (s)")
    s.add_argument("--force", action="store_true", help="allow scanning more than 4096 addresses")
    s = sub.add_parser("bw", help="run the Bitwarden CLI with this box's vault session (bw-session file)")
    s.add_argument("args", nargs=argparse.REMAINDER, metavar="BW_ARGS")
    sub.add_parser("providers", help="list password providers (built-in, plugins, roster.yml)")
    s = sub.add_parser("auth-check", help="test each group's password source, print nothing secret")
    s.add_argument("--only")
    s = sub.add_parser("web", help="HTTP request to a host's web service, logged in with its stored credentials")
    s.add_argument("request", nargs="+", metavar="HOST [SERVICE] METHOD PATH",
                   help="e.g. esxi GET /folder  or  orion3 https GET /api/status")
    s.add_argument("-d", "--data", help="request body (@FILE reads a file)")
    s.add_argument("-H", "--header", action="append", help="extra header 'Name: value' (repeatable)")
    s.add_argument("-k", "--insecure", action="store_true", help="don't verify the TLS certificate")
    s.add_argument("--timeout", type=float, default=30)
    s = sub.add_parser("revoke", help="remove this box's key from all hosts")
    s.add_argument("--only")
    s.add_argument("-y", "--yes", action="store_true")
    args = p.parse_args(argv)

    if args.cmd == "init":
        return cmd_init(args)
    if args.cmd == "discover":
        return cmd_discover(args)
    if args.cmd == "bw":
        return cmd_bw(args)
    if args.cmd == "providers":
        try:
            cfg = load_config(find_config(args.config))
        except SystemExit:
            cfg = None                              # no roster.yml yet: still list what's available
        setup_providers(cfg)
        return cmd_providers(cfg, args)
    cfg = load_config(find_config(args.config))
    setup_providers(cfg)
    return {"setup": cmd_setup, "sync": cmd_sync, "check": cmd_check, "hosts": cmd_hosts, "info": cmd_info,
            "run": cmd_run, "revoke": cmd_revoke, "resources": cmd_resources, "reveal": cmd_reveal, "auth-check": cmd_auth_check, "web": cmd_web}[args.cmd](cfg, args)
