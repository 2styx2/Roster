"""`roster web` against a local HTTP server: credentials arrive, never show up in output."""

import base64
import http.server
import threading

import pytest

from roster.cli import main

SECRET = "hunter2-TOPSECRET"


class Handler(http.server.BaseHTTPRequestHandler):
    seen = []

    def do_GET(self):  # noqa: N802
        Handler.seen.append((self.command, self.path, self.headers.get("Authorization"), None))
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "http://elsewhere.example/steal")
            self.end_headers()
            return
        body = b"echo " + SECRET.encode() if self.path == "/echo" else b'{"ok": true}'
        self.send_response(401 if self.path == "/denied" else 200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):  # noqa: N802
        data = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        Handler.seen.append((self.command, self.path, self.headers.get("Authorization"), data))
        self.send_response(201)
        self.end_headers()
        self.wfile.write(b"created")

    def log_message(self, *a):
        pass


@pytest.fixture
def server():
    Handler.seen = []
    srv = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1]
    srv.shutdown()


@pytest.fixture
def cfg(write_config, server, monkeypatch):
    monkeypatch.setenv("WEB_PW", SECRET)
    write_config(f"""\
groups:
  g:
    user: sshuser
    auth: env:NOT_USED_FOR_WEB
    hosts:
      box:
        ip: 127.0.0.1
        services:
          gui: {{url: "http://127.0.0.1:{server}", user: webadmin, auth: env:WEB_PW}}
          api: {{url: "http://127.0.0.1:{server}/api", auth: env:WEB_PW, login: bearer}}
          open: {{url: "http://127.0.0.1:{server}", login: none}}
      hidden: {{ip: 127.0.0.1, reviewed: false, services: {{gui: {{url: "http://127.0.0.1:{server}"}}}}}}
""")


def run(capsys, *argv):
    rc = main(["web", *argv])
    out = capsys.readouterr()
    return rc, out.out, out.err


def test_basic_login_sent_never_shown(capsys, cfg):
    rc, out, err = run(capsys, "box", "gui", "GET", "/status")
    assert rc == 0 and '{"ok": true}' in out and "HTTP 200" in err
    _, path, auth, _ = Handler.seen[-1]
    assert path == "/status" and auth == "Basic " + base64.b64encode(f"webadmin:{SECRET}".encode()).decode()
    assert SECRET not in out + err and "Basic" not in out + err and auth.split()[1] not in out + err


def test_default_service_is_the_web_ui(capsys, cfg):
    rc, out, _ = run(capsys, "box", "GET", "/")      # gui is the first service with a url
    assert rc == 0 and Handler.seen[-1][2].startswith("Basic ")


def test_bearer_and_base_path(capsys, cfg):
    rc, _, _ = run(capsys, "box", "api", "GET", "v1/things")
    assert rc == 0 and Handler.seen[-1][1:3] == ("/api/v1/things", f"Bearer {SECRET}")


def test_login_none_sends_nothing(capsys, cfg):
    run(capsys, "box", "open", "GET", "/")
    assert Handler.seen[-1][2] is None


def test_post_body_and_status(capsys, cfg):
    rc, out, err = run(capsys, "box", "gui", "POST", "/things", "-d", '{"a": 1}')
    assert rc == 0 and out.strip() == "created" and "HTTP 201" in err
    assert Handler.seen[-1][3] == '{"a": 1}'


def test_error_status_exits_1(capsys, cfg):
    rc, out, err = run(capsys, "box", "gui", "GET", "/denied")
    assert rc == 1 and "HTTP 401" in err


def test_secret_echoed_by_server_is_masked(capsys, cfg):
    _, out, _ = run(capsys, "box", "gui", "GET", "/echo")
    assert SECRET not in out and "echo ********" in out


def test_redirect_not_followed(capsys, cfg):
    rc, _, err = run(capsys, "box", "gui", "GET", "/redirect")
    assert rc == 0 and "302" in err and "not followed" in err
    assert len(Handler.seen) == 1                    # nothing went to the Location


@pytest.mark.parametrize("argv, err", [
    (("box", "gui", "GET", "http://evil.example/x"), "not a full URL"),
    (("box", "gui", "GET", "//evil.example/x"), "not a full URL"),
    (("box", "gui", "GET", "/", "-H", "Authorization: x"), "don't pass Authorization"),
    (("box", "gui", "FETCH", "/"), "unknown method"),
    (("box", "nope", "GET", "/"), "no service 'nope'"),
    (("hidden", "GET", "/"), "reviewed: false"),
    (("ghost", "GET", "/"), "unknown host"),
])
def test_refusals(cfg, argv, err):
    with pytest.raises(SystemExit, match=err):
        main(["web", *argv])
    assert Handler.seen == []


def test_unreachable_names_reference_not_value(write_config, monkeypatch):
    monkeypatch.setenv("WEB_PW", SECRET)
    write_config("groups:\n  g:\n    user: u\n    hosts:\n      box:\n        ip: 127.0.0.1\n"
                 "        services: {gui: {url: 'http://127.0.0.1:1', user: w, auth: env:WEB_PW}}\n")
    with pytest.raises(SystemExit) as e:
        main(["web", "box", "GET", "/"])
    assert "can't reach" in str(e.value) and SECRET not in str(e.value)


def test_bad_login_setting(write_config):
    write_config("groups:\n  g:\n    user: u\n    hosts:\n      box:\n        ip: 127.0.0.1\n"
                 "        services: {gui: {port: 443, login: form}}\n")
    with pytest.raises(SystemExit, match="login: 'form'"):
        main(["hosts"])


class FakeVsphere(http.server.BaseHTTPRequestHandler):
    """Just enough of the ESXi SOAP API: versions, service content, Login/Logout, one call."""
    calls = []
    COOKIE = 'vmware_soap_session="sess-abc123"'

    def do_GET(self):  # noqa: N802
        self.reply(200, "<namespaces><namespace><name>urn:vim25</name><version>8.0.3.0</version></namespace>"
                        "</namespaces>")

    def do_POST(self):  # noqa: N802
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        op = next((o for o in ("RetrieveServiceContent", "Login", "Logout", "RetrieveProperties")
                   if f"<urn:{o}" in body), "?")
        FakeVsphere.calls.append((op, self.headers.get("SOAPAction"), self.headers.get("Cookie"), body))
        if op == "RetrieveServiceContent":
            return self.reply(200, '<returnval><sessionManager type="SessionManager">ha-sessionmgr</sessionManager>'
                                   "</returnval>")
        if op == "Login":
            if f"<urn:password>{SECRET}</urn:password>" not in body or "<urn:userName>root</urn:userName>" not in body:
                return self.reply(500, "<faultstring>Cannot complete login due to an incorrect user name or "
                                       "password.</faultstring>")
            return self.reply(200, "<returnval><userName>root</userName></returnval>",
                              {"Set-Cookie": self.COOKIE + "; Path=/; HttpOnly; Secure"})
        if self.headers.get("Cookie") != self.COOKIE:
            return self.reply(500, "<faultstring>The session is not authenticated.</faultstring>")
        self.reply(200, f"<returnval>{op} ok, echo {SECRET} sess-abc123</returnval>")

    def reply(self, code, text, headers=None):
        self.send_response(code)
        self.send_header("Content-Type", "text/xml")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(text.encode())

    def log_message(self, *a):
        pass


@pytest.fixture
def esxi(write_config, monkeypatch):
    FakeVsphere.calls = []
    srv = http.server.HTTPServer(("127.0.0.1", 0), FakeVsphere)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("ESXI_PW", SECRET)
    write_config("groups:\n  g:\n    user: root\n    auth: env:ESXI_PW\n    hosts:\n      esxi:\n        ip: 127.0.0.1\n"
                 f"        services: {{https: {{url: 'http://127.0.0.1:{srv.server_address[1]}', login: vsphere}}}}\n")
    yield
    srv.shutdown()


def test_vsphere_session_login_call_logout(capsys, esxi):
    rc, out, err = run(capsys, "esxi", "POST", "/sdk", "-d", "<urn:RetrieveProperties>x</urn:RetrieveProperties>")
    assert rc == 0 and "RetrieveProperties ok" in out
    assert [c[0] for c in FakeVsphere.calls] == ["RetrieveServiceContent", "Login", "RetrieveProperties", "Logout"]
    call = FakeVsphere.calls[2]
    assert call[1] == "urn:vim25/8.0.3.0" and call[2] == FakeVsphere.COOKIE    # SOAPAction added, session sent
    assert SECRET not in out + err and "sess-abc123" not in out + err and out.count("********") == 2


def test_vsphere_wrong_password_names_fault_not_value(esxi, monkeypatch):
    monkeypatch.setenv("ESXI_PW", "wrong-" + SECRET)
    with pytest.raises(SystemExit, match="vSphere login refused: Cannot complete login") as e:
        main(["web", "esxi", "POST", "/sdk", "-d", "<x/>"])
    assert SECRET not in str(e.value)
    assert [c[0] for c in FakeVsphere.calls] == ["RetrieveServiceContent", "Login"]
