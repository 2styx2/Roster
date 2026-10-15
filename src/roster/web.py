"""`roster web`: HTTP requests to a host's web service, logged in with the service's stored credentials."""

import base64
import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urljoin, urlparse
from xml.sax.saxutils import escape as xml_escape
from xml.sax.saxutils import unescape as xml_unescape

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


def service_secret(h, name, s):
    """The service's password/token, or None. Errors name the auth reference, never a value."""
    if s["login"] == "none" or s["auth"] is None:
        return None
    try:
        secret = get_secret(s["auth"], h["group"])
    except RuntimeError as e:
        die(f"{h['name']} {name}: {e}")
    if secret is not None and s["login"] != "bearer" and not s["user"]:
        die(f"{h['name']} {name}: {s['login']} login needs a user (set user: on the service or host)")
    return secret


def auth_header(s, secret):
    """(Authorization value, strings to mask in output) for basic / bearer logins."""
    if s["login"] == "bearer":
        return f"Bearer {secret}", [secret]
    token = base64.b64encode(f"{s['user']}:{secret}".encode()).decode()
    return f"Basic {token}", [secret, token]


# ---- vSphere (ESXi / vCenter) SOAP sessions

SOAP = ('<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope '
        'xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">'
        '<soapenv:Body>{}</soapenv:Body></soapenv:Envelope>')


def _open(opener, req, timeout):
    try:
        return opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        return e


def soap_action(opener, base, timeout):
    """'urn:vim25/8.0.3.0' - the newest API version the server speaks (no login needed)."""
    with _open(opener, urllib.request.Request(base + "/sdk/vimServiceVersions.xml"), timeout) as r:
        m = re.search(r"<name>urn:vim25</name>\s*<version>([^<]+)</version>", r.read().decode(errors="replace"))
    return f"urn:vim25/{m.group(1)}" if m else "urn:vim25"


def soap(opener, base, action, body, timeout, cookie=None):
    req = urllib.request.Request(base + "/sdk", method="POST", data=SOAP.format(body).encode(),
                                 headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": action})
    if cookie:
        req.add_unredirected_header("Cookie", cookie)
    with _open(opener, req, timeout) as r:
        return r.status, r.read().decode(errors="replace"), r.headers.get_all("Set-Cookie") or []


def soap_fault(text):
    m = re.search(r"<faultstring>([^<]*)</faultstring>", text)
    return xml_unescape(m.group(1)) if m else text.strip()[:200]


def vsphere_login(opener, base, user, secret, timeout):
    """Log in through the SOAP API; returns (cookie header, SOAPAction, logout function)."""
    action = soap_action(opener, base, timeout)
    _, text, _ = soap(opener, base, action, '<urn:RetrieveServiceContent><urn:_this type="ServiceInstance">'
                      'ServiceInstance</urn:_this></urn:RetrieveServiceContent>', timeout)
    m = re.search(r'<sessionManager type="SessionManager">([^<]+)</sessionManager>', text)
    if not m:
        raise RuntimeError("no vSphere API at /sdk (is this ESXi or vCenter?)")
    mgr = f'<urn:_this type="SessionManager">{xml_escape(m.group(1))}</urn:_this>'
    status, text, cookies = soap(opener, base, action, f"<urn:Login>{mgr}<urn:userName>{xml_escape(user)}"
                                 f"</urn:userName><urn:password>{xml_escape(secret)}</urn:password></urn:Login>",
                                 timeout)
    cookie = next((c.split(";")[0] for c in cookies if c.startswith("vmware_soap_session=")), None)
    if status != 200 or not cookie:
        raise RuntimeError(f"vSphere login refused: {soap_fault(text)}")

    def logout():
        soap(opener, base, action, f"<urn:Logout>{mgr}</urn:Logout>", timeout, cookie)
    return cookie, action, logout


# ---- UniFi OS (UDM, Cloud Key, UniFi OS Server) sessions

def unifi_login(opener, base, user, secret, timeout):
    """Log in through /api/auth/login; returns (cookie header, CSRF token, logout function)."""
    req = urllib.request.Request(base + "/api/auth/login", method="POST",
                                 data=json.dumps({"username": user, "password": secret, "rememberMe": False}).encode(),
                                 headers={"Content-Type": "application/json"})
    with _open(opener, req, timeout) as r:
        status, text = r.status, r.read().decode(errors="replace")
        cookies, csrf = r.headers.get_all("Set-Cookie") or [], r.headers.get("X-CSRF-Token")
    cookie = next((c.split(";")[0] for c in cookies if c.startswith("TOKEN=")), None)
    if status != 200 or not cookie:
        try:
            why = json.loads(text).get("message") or text
        except (ValueError, AttributeError):
            why = text
        raise RuntimeError(f"UniFi login refused (HTTP {status}): {str(why).strip()[:200]}")

    def logout():
        out = urllib.request.Request(base + "/api/auth/logout", method="POST", data=b"")
        out.add_unredirected_header("Cookie", cookie)
        if csrf:
            out.add_header("X-CSRF-Token", csrf)
        _open(opener, out, timeout).close()
    return cookie, csrf, logout


# ---- OpenVPN Access Server admin API

def openvpnas_login(opener, base, user, secret, timeout):
    """Log in through /api/auth/login/userpassword; returns the auth token for X-OpenVPN-As-AuthToken.
    Access Server has no logout call - the token simply expires."""
    req = urllib.request.Request(base + "/api/auth/login/userpassword", method="POST",
                                 data=json.dumps({"username": user, "password": secret,
                                                  "request_admin": True}).encode(),
                                 headers={"Content-Type": "application/json"})
    with _open(opener, req, timeout) as r:
        status, text = r.status, r.read().decode(errors="replace")
    try:
        data = json.loads(text)
    except ValueError:
        data = {}
    token = data.get("auth_token") if isinstance(data, dict) else None
    if status != 200 or not token:
        why = data.get("detail") if isinstance(data, dict) and data.get("detail") else text
        raise RuntimeError(f"Access Server login refused (HTTP {status}): {str(why).strip()[:200]}")
    return token


# ---- Hub web API

def hub_login(opener, base, user, secret, timeout):
    """Log in through /api/auth/login; returns the bearer access token. The token expires after an hour,
    and there is no logout call. Send JSON: a form body makes HUB echo the password back in its 422 error."""
    req = urllib.request.Request(base + "/api/auth/login", method="POST",
                                 data=json.dumps({"username": user, "password": secret}).encode(),
                                 headers={"Content-Type": "application/json"})
    with _open(opener, req, timeout) as r:
        status, text = r.status, r.read().decode(errors="replace")
    try:
        data = json.loads(text)
    except ValueError:
        data = {}
    token = data.get("access_token") if isinstance(data, dict) else None
    if status != 200 or not token:
        why = data.get("detail") if isinstance(data, dict) and isinstance(data.get("detail"), str) else text
        raise RuntimeError(f"HUB login refused (HTTP {status}): {mask(str(why).strip()[:200], [secret])}")
    return token


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
    if s["login"] == "vsphere" and data and urlparse(url).path.startswith("/sdk") and ":Envelope" not in data:
        data = SOAP.format(data.strip())             # bare <urn:Call>...</urn:Call> -> full SOAP request
    req = urllib.request.Request(url, method=method, data=None if data is None else data.encode())
    for hd in headers:
        k, sep, v = hd.partition(":")
        if not sep or not k.strip():
            die(f"bad header {hd!r} (use 'Name: value')")
        if k.strip().lower() == "authorization":
            die("don't pass Authorization - roster adds the service's credentials itself")
        req.add_header(k.strip(), v.strip())
    if data is not None and not req.has_header("Content-type"):
        first = data.lstrip()[:1]
        req.add_header("Content-Type", "application/json" if first in ("{", "[") else
                       "text/xml; charset=utf-8" if first == "<" else "application/x-www-form-urlencoded")
    ctx = ssl.create_default_context()
    if insecure or not s["verify"]:
        ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=ctx))
    secret = service_secret(h, name, s)
    secrets, logout = [secret], None
    try:
        if secret is not None and s["login"] == "vsphere":
            u = urlparse(s["url"])
            cookie, action, logout = vsphere_login(opener, f"{u.scheme}://{u.netloc}", s["user"], secret, timeout)
            secrets.append(cookie.split("=", 1)[1].strip('"'))
            req.add_unredirected_header("Cookie", cookie)
            if urlparse(url).path.startswith("/sdk") and not req.has_header("Soapaction"):
                req.add_header("SOAPAction", action)
        elif secret is not None and s["login"] == "unifi":
            u = urlparse(s["url"])
            cookie, csrf, logout = unifi_login(opener, f"{u.scheme}://{u.netloc}", s["user"], secret, timeout)
            secrets += [cookie.split("=", 1)[1], csrf]
            req.add_unredirected_header("Cookie", cookie)
            if csrf:
                req.add_header("X-CSRF-Token", csrf)          # UniFi needs it on every request that changes state
        elif secret is not None and s["login"] == "openvpnas":
            u = urlparse(s["url"])
            token = openvpnas_login(opener, f"{u.scheme}://{u.netloc}", s["user"], secret, timeout)
            secrets.append(token)
            req.add_unredirected_header("X-OpenVPN-As-AuthToken", token)
        elif secret is not None and s["login"] == "hub":
            u = urlparse(s["url"])
            token = hub_login(opener, f"{u.scheme}://{u.netloc}", s["user"], secret, timeout)
            secrets.append(token)
            req.add_unredirected_header("Authorization", f"Bearer {token}")
        elif secret is not None:
            auth, secrets = auth_header(s, secret)
            req.add_unredirected_header("Authorization", auth)
        resp = _open(opener, req, timeout)           # 4xx/5xx and unfollowed 3xx still have a body worth showing
        with resp:
            body = resp.read().decode(errors="replace")
            status, reason = resp.status, resp.reason
            ctype, location = resp.headers.get("Content-Type", ""), resp.headers.get("Location")
    except (urllib.error.URLError, OSError, RuntimeError) as e:
        reason = getattr(e, "reason", e)
        hint = " (self-signed? set verify: false on the service, or pass --insecure)" if "CERTIFICATE" in str(
            reason) else ""
        die(f"{h['name']} {name}: can't reach {url}: {mask(str(reason), secrets)}{hint}"
            if not isinstance(e, RuntimeError) else f"{h['name']} {name}: {mask(str(e), secrets)}")
    finally:
        if logout:
            try:
                logout()
            except (urllib.error.URLError, OSError):
                pass
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
