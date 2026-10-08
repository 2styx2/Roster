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
