"""Loading and querying roster.yml."""

import os
import re
import socket
from pathlib import Path

import yaml

from .common import KEY_TAG, LEGACY_KEY_TAGS, NAME_RE, die, oneline, user_config_dir

HOST_DEFAULTS = {"user": None, "port": 22, "enroll": True, "auth": "prompt",
                 "web": None, "services": {}, "notes": "",
                 "title": "", "description": "", "type": "", "product": "", "reviewed": True, "mac": ""}
TEXT_FIELDS = ("title", "description", "type", "product")
GROUP_ONLY = ("hosts", "title", "description")   # describe the group itself, not copied onto hosts


# ---------------------------------------------------------------- config

def find_config(arg):
    if arg:
        return Path(arg).expanduser()
    if os.environ.get("ROSTER_CONFIG"):
        return Path(os.environ["ROSTER_CONFIG"]).expanduser()
    for p in (Path.cwd() / "roster.yml", user_config_dir() / "roster.yml"):
        if p.exists():
            return p
    die("no roster.yml found here or in ~/.config/roster/ - run `roster init`, "
        "or pass -c PATH / set ROSTER_CONFIG")


def load_config(path):
    path = Path(path).expanduser().resolve()
    if not path.exists():
        die(f"{path} not found - run `roster init` to create one")
    try:
        raw = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as e:
        die(f"{path} is not valid YAML:\n{e}")
    defaults = {**HOST_DEFAULTS, **(raw.get("defaults") or {})}
    hosts, groups = {}, {}
    for gname, group in (raw.get("groups") or {}).items():
        group = group or {}
        gset = {k: v for k, v in group.items() if k not in GROUP_ONLY}
        groups[str(gname)] = {k: oneline(group.get(k)) for k in ("title", "description")}
        for hname, h in (group.get("hosts") or {}).items():
            hname = str(hname)
            h = {"ip": h} if isinstance(h, str) else (h or {})
            if not NAME_RE.match(hname):
                die(f"bad host name {hname!r} (use letters, digits, . _ -)")
            if hname in hosts:
                die(f"host {hname!r} is listed twice")
            m = {**defaults, **gset, **h, "name": hname, "group": str(gname)}
            if not m.get("ip"):
                die(f"host {hname!r} has no ip")
            if not m.get("user"):
                die(f"host {hname!r} has no user (set it on the host, its group, or defaults)")
            m["ip"], m["user"] = str(m["ip"]).strip(), str(m["user"]).strip()
            if re.search(r"\s", m["ip"] + m["user"]):
                die(f"host {hname!r}: ip/user can't contain spaces")
            m["port"] = int(m["port"])
            m["enroll"] = bool(m["enroll"])
            m["reviewed"] = bool(m["reviewed"])
            m["services"] = m.get("services") or {}
            m["auth"] = None if m.get("auth") is None else str(m["auth"])
            for k in TEXT_FIELDS:
                m[k] = oneline(m.get(k))
            m["description"] = m["description"] or oneline(m.get("notes"))   # old name for it
            hosts[hname] = m
    if not hosts:
        die(f"{path} defines no hosts")
    box = re.sub(r"[^A-Za-z0-9_-]", "-", str(raw.get("box_name") or socket.gethostname().split(".")[0]))
    key = Path(os.path.expanduser(str(raw.get("key_path") or "~/.ssh/roster_ed25519")))
    # matches this box's key line in authorized_keys, including tags from older versions
    tag_re = f" ({'|'.join((KEY_TAG,) + LEGACY_KEY_TAGS)}):{box}$"
    return {"path": path, "box": box, "tag": f"{KEY_TAG}:{box}", "tag_re": tag_re, "key": key,
            "pub": Path(str(key) + ".pub"), "workers": int(raw.get("workers") or 32),
            "inline_limit": int(raw.get("claude_inline_limit") or 60), "hosts": hosts, "groups": groups,
            "providers": providers_conf(raw), "provider_dirs": list(raw.get("provider_dirs") or [])}


def providers_conf(raw):
    conf = dict(raw.get("providers") or {})
    if raw.get("bitwarden"):                      # older roster.yml: `bitwarden: { sync: ... }`
        conf["bw"] = {**(raw["bitwarden"] or {}), **(conf.get("bw") or {})}
    return conf


def access_label(h):
    if not h["reviewed"]:
        return "unreviewed"
    return "key" if h["enroll"] else "password"

def matches(h, text):
    """Every word in text appears somewhere in the host's identity: 'orion dev', 'core-switch'."""
    hay = " ".join(str(h[k]) for k in ("name", "group", "ip", *TEXT_FIELDS)).lower()
    words = [w for w in re.split(r"[\s_-]+", text.lower()) if w]
    return bool(words) and all(w in hay for w in words)


def selected(cfg, only):
    hosts = list(cfg["hosts"].values())
    if not only:
        return hosts
    wanted = {s.strip() for s in only.split(",") if s.strip()}
    picked = [h for h in hosts if wanted & {h["name"], h["group"], h["type"], h["product"]}]
    if not picked:
        die(f"--only {only!r} matched no host, group, type or product")
    return picked
