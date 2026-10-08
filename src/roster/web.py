"""`roster web`: HTTP requests to a host's web service, logged in with the service's stored credentials."""

import base64
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urljoin, urlparse

from .common import die
from .providers import get_secret

METHODS = ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow redirects: the Authorization header must not travel to another URL."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def pick_service(h, name):
    if name:
        s = h["services"].get(name)
        if not s:
            die(f"host {h['name']!r} has no service {name!r} (has: {', '.join(h['services']) or 'none'})")
    else:
        name = "web" if "web" in h["services"] else next((n for n, s in h["services"].items()
                                                          if s["url"] == h["web"]), None)
        if not name:
            die(f"host {h['name']!r} has no web service - name one: roster web {h['name']} SERVICE METHOD PATH")
        s = h["services"][name]
    if not s["url"]:
        die(f"host {h['name']!r} service {name!r} has no url (set url:, or scheme: https)")
    return name, s


def target_url(base, path):
    if "://" in path or path.startswith("//"):
        die("give a path like /api/x, not a full URL - credentials only go to the service's own address")
    url = urljoin(base.rstrip("/") + "/", path.lstrip("/"))
    if (urlparse(url).scheme, urlparse(url).netloc) != (urlparse(base).scheme, urlparse(base).netloc):
        die(f"path {path!r} leaves {base}")
    return url


def credentials_header(h, name, s):
    """(header value, strings to mask in output). Errors name the auth reference, never a value."""
    if s["login"] == "none" or s["auth"] is None:
        return None, []
    try:
        secret = get_secret(s["auth"], h["group"])
    except RuntimeError as e:
        die(f"{h['name']} {name}: {e}")
    if secret is None:
        return None, []
    if s["login"] == "bearer":
        return f"Bearer {secret}", [secret]
    if not s["user"]:
        die(f"{h['name']} {name}: basic login needs a user (set user: on the service or host)")
    token = base64.b64encode(f"{s['user']}:{secret}".encode()).decode()
    return f"Basic {token}", [secret, token]


def mask(text, secrets):
    for v in secrets:
        if v:
            text = text.replace(v, "********")
    return text


def request(h, service, method, path, data=None, headers=(), insecure=False, timeout=30):
    """Make the request; returns (status, reason, content type, body text with secrets masked)."""
    if not h["reviewed"]:
        die(f"{h['name']} has reviewed: false - review it in roster.yml first")
    method = method.upper()
    if method not in METHODS:
        die(f"unknown method {method!r} (use {', '.join(METHODS)})")
    name, s = pick_service(h, service)
    url = target_url(s["url"], path)
    if data is not None and data.startswith("@"):
        data = Path(data[1:]).expanduser().read_text()
    req = urllib.request.Request(url, method=method, data=None if data is None else data.encode())
    for hd in headers:
        k, sep, v = hd.partition(":")
        if not sep or not k.strip():
            die(f"bad header {hd!r} (use 'Name: value')")
        if k.strip().lower() == "authorization":
            die("don't pass Authorization - roster adds the service's credentials itself")
        req.add_header(k.strip(), v.strip())
    if data is not None and not req.has_header("Content-type"):
        req.add_header("Content-Type", "application/json" if data.lstrip()[:1] in "{[" else
                       "application/x-www-form-urlencoded")
    auth, secrets = credentials_header(h, name, s)
    if auth:
        req.add_unredirected_header("Authorization", auth)
    ctx = ssl.create_default_context()
    if insecure or not s["verify"]:
        ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=ctx))
    try:
        resp = opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:            # 4xx/5xx and unfollowed 3xx still have a body worth showing
        resp = e
    except (urllib.error.URLError, OSError) as e:
        reason = getattr(e, "reason", e)
        hint = " (self-signed? set verify: false on the service, or pass --insecure)" if "CERTIFICATE" in str(
            reason) else ""
        die(f"{h['name']} {name}: can't reach {url}: {mask(str(reason), secrets)}{hint}")
    with resp:
        body = resp.read().decode(errors="replace")
        status, reason = resp.status, resp.reason
        ctype, location = resp.headers.get("Content-Type", ""), resp.headers.get("Location")
    if location:
        reason = f"{reason} -> {mask(location, secrets)} (not followed)"
    return status, reason, ctype, mask(body, secrets)


def cmd_web(cfg, args):
    words = args.request
    if len(words) not in (3, 4):
        die("usage: roster web HOST [SERVICE] METHOD PATH")
    host, service, method, path = words if len(words) == 4 else (words[0], None, *words[1:])
    h = cfg["hosts"].get(host)
    if not h:
        die(f"unknown host {host!r} (see `roster hosts`)")
    status, reason, ctype, body = request(h, service, method, path, args.data, args.header or (),
                                          args.insecure, args.timeout)
    print(f"HTTP {status} {reason}" + (f"  [{ctype}]" if ctype else ""), file=sys.stderr, flush=True)
    sys.stdout.write(body + ("" if not body or body.endswith("\n") else "\n"))
    return 0 if status < 400 else 1
