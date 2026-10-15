"""Loading and querying roster.yml."""

import os
import re
import socket
from pathlib import Path
from urllib.parse import urlparse

import yaml

from .common import KEY_TAG, LEGACY_KEY_TAGS, NAME_RE, die, oneline, user_config_dir

HOST_DEFAULTS = {"user": None, "port": 22, "enroll": True, "auth": "prompt",
                 "web": None, "services": {}, "notes": "",
                 "title": "", "description": "", "type": "", "product": "", "reviewed": True, "mac": ""}
TEXT_FIELDS = ("title", "description", "type", "product")
GROUP_ONLY = ("hosts", "title", "description")   # describe the group itself, not copied onto hosts
LOGIN = ("user", "auth")
SSH_KEYS = ("port", "user", "auth")
SERVICE_KEYS = ("port", "url", "scheme", "user", "auth", "verify", "login")
WEB_LOGINS = ("basic", "bearer", "vsphere", "unifi", "openvpnas", "hub", "none")          # how `roster web` sends the service's credentials
SERVICE_RE = re.compile(r"^[A-Za-z0-9._-]+$")
HTTPS_PORTS, HTTP_PORTS = (443, 8443), (80, 8000, 8008, 8080, 8888)


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
            m["ip"] = str(m["ip"]).strip()
            layers = [h, gset, raw.get("defaults") or {}]        # most specific first
            m["ssh"] = resolve_ssh(hname, layers)
            if not m["ssh"]["user"]:
                die(f"host {hname!r} has no user (set it on the host, its group, or defaults)")
            if re.search(r"\s", m["ip"] + m["ssh"]["user"]):
                die(f"host {hname!r}: ip/user can't contain spaces")
            # user/port/auth stay as the resolved SSH login, so code that predates ssh: blocks keeps working
            m["user"], m["port"], m["auth"] = m["ssh"]["user"], m["ssh"]["port"], m["ssh"]["auth"]
            m["login"] = {k: first(layers, k) for k in LOGIN}    # default login for the host's services
            m["services"], m["web"] = resolve_services(hname, m, layers)
            m["enroll"] = bool(m["enroll"])
            m["reviewed"] = bool(m["reviewed"])
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


# ---------------------------------------------------------------- ssh and services

def first(layers, key, default=None):
    """The value from the most specific layer that sets key (an explicit null counts)."""
    return next((layer[key] for layer in layers if key in layer), default)


def as_auth(v):
    return None if v is None else str(v)


def as_user(v):
    return None if v is None else str(v).strip()


def check_port(where, v):
    if isinstance(v, bool) or not str(v).strip().isdigit() or not 1 <= int(v) <= 65535:
        die(f"{where}: bad port {v!r} (use a number from 1 to 65535)")
    return int(v)


def ssh_block(hname, layer):
    blk = layer.get("ssh")
    if blk is None:
        return {}
    if not isinstance(blk, dict) or set(blk) - set(SSH_KEYS):
        die(f"host {hname!r}: ssh: must be a mapping with only {', '.join(SSH_KEYS)}")
    return blk


def resolve_ssh(hname, layers):
    """SSH login. Per layer (host, group, defaults) its ssh: block beats its plain user/auth/port."""
    flat = [x for layer in layers for x in (ssh_block(hname, layer), layer)] + [HOST_DEFAULTS]
    return {"port": check_port(f"host {hname!r} ssh", first(flat, "port")),
            "user": as_user(first(flat, "user")), "auth": as_auth(first(flat, "auth"))}


def service_entry(where, v):
    if isinstance(v, dict):
        extra = set(map(str, v)) - set(SERVICE_KEYS)
        if extra:
            die(f"{where}: unknown setting {', '.join(sorted(extra))} (allowed: {', '.join(SERVICE_KEYS)})")
        return dict(v)
    if isinstance(v, str) and "://" in v:
        return {"url": v}
    return {"port": v}                                    # short form  postgres: 5432


def resolve_services(hname, m, layers):
    """Service entries merge per name, field by field: defaults <- group <- host. Returns (services, web URL)."""
    merged = {"web": {"url": str(m["web"])}} if m.get("web") else {}   # old style  web: "https://..."
    for layer in reversed(layers):
        svcs = layer.get("services") or {}
        if not isinstance(svcs, dict):
            die(f"host {hname!r}: services: must be a mapping of name: port or name: {{port, url, user, auth}}")
        for name, v in svcs.items():
            name = str(name)
            if not SERVICE_RE.match(name):
                die(f"host {hname!r}: bad service name {name!r} (use letters, digits, . _ -)")
            merged.setdefault(name, {}).update(service_entry(f"host {hname!r} service {name!r}", v))
    services = {name: normalize_service(f"host {hname!r} service {name!r}", name, e, m)
                for name, e in merged.items()}
    # the web UI: an explicit web service, else the first service given a url (never a guessed one)
    web = next((services[n]["url"] for n in ("web", *merged) if n in merged and "url" in merged[n]), None)
    return services, web


def normalize_service(where, name, e, m):
    port, url, scheme = e.get("port"), e.get("url"), e.get("scheme")
    if url:
        url = str(url).strip()
        url = url if "://" in url else "https://" + url
        u = urlparse(url)
        try:
            url_port = u.port
        except ValueError:
            die(f"{where}: bad url {url!r}")
        if u.scheme not in ("http", "https") or not u.hostname or re.search(r"\s", url):
            die(f"{where}: bad url {url!r} (expected http(s)://host[:port][/path])")
        scheme, url_port = u.scheme, url_port or (443 if u.scheme == "https" else 80)
        if port is not None and check_port(where, port) != url_port:
            die(f"{where}: port {port} doesn't match url {url!r}")
        port = url_port
    elif port is None:
        die(f"{where}: needs a port or a url")
    else:
        port = check_port(where, port)
        scheme = scheme or ("https" if name.startswith("https") or port in HTTPS_PORTS else
                            "http" if name.startswith("http") or port in HTTP_PORTS else None)
        if scheme in ("http", "https"):
            url = f"{scheme}://{m['ip']}" + ("" if port == (443 if scheme == "https" else 80) else f":{port}")
    return {"port": port, "url": url, "scheme": scheme,
            "user": as_user(e.get("user", m["login"]["user"])),
            "auth": as_auth(e["auth"] if "auth" in e else m["login"]["auth"]),
            "verify": bool(e.get("verify", True)), "login": web_login(where, e.get("login", "basic")),
            "override": any(k in e for k in LOGIN)}       # False = inherits the host's default login


def web_login(where, v):
    if str(v) not in WEB_LOGINS:
        die(f"{where}: login: {v!r} - use one of {', '.join(WEB_LOGINS)}")
    return str(v)


def service_credentials(h, name):
    """(user, auth reference) for one of the host's services, or for "ssh"."""
    s = h["ssh"] if name == "ssh" else h["services"].get(name)
    if s is None:
        die(f"host {h['name']!r} has no service {name!r} (has: {', '.join(['ssh', *h['services']])})")
    return s["user"], s["auth"]


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
