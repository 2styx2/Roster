"""vault.logout: signing the vault CLI out from the app, to sign in to another account (ticket 42). Driven as the
app drives it, through `roster serve`, against the fake bw (tests/fakes/bw); never a real `bw logout`. Everything
secret serve holds (askpass tokens, typed passwords held for "Save to vault", session keys, cached lookups) is
forgotten before the CLI logs out, and no secret reaches a command line, a response or serve's stderr."""

import json
import os

import pytest
from conftest import WINDOWS

from roster import askpass, providers
from roster import serve as rpc

INVENTORY = """\
groups:
  lab:
    user: ops
    auth: bw:lab ssh
    hosts:
      esx-02: {ip: 10.0.0.5}
"""

EMAIL, OTHER, PASSWORD = "you@example.com", "other@example.com", "hunter2"
SECRETS = [PASSWORD, "fake-session-key", "typed-pw-xyzzy"]


@pytest.fixture
def bw(write_config, fakes, isolated, monkeypatch):
    """A logged-in, locked fake bw (account EMAIL), its state and argv files."""
    write_config(INVENTORY)
    tmp = isolated["home"].parent
    files = {"state": tmp / "bw-state.json", "argv": tmp / "bw-argv.log"}
    files["state"].write_text(json.dumps({"logged_in": True, "server": None, "email": EMAIL}))
    monkeypatch.setenv("FAKE_BW_STATE", str(files["state"]))
    monkeypatch.setenv("FAKE_ARGV_LOG", str(files["argv"]))
    return files


def bw_calls(files):
    return [json.loads(line) for line in files["argv"].read_text().splitlines()] if files["argv"].exists() else []


def no_secrets(s, files):
    code, out, err = s.close()
    assert code == 0 and out == ""
    transcript = "".join(s.responses) + err
    argv = files["argv"].read_text() if files["argv"].exists() else ""
    for secret in SECRETS:
        assert secret not in transcript, secret
        assert secret not in argv, secret
    assert EMAIL not in argv and OTHER not in argv


# ---- vault.status names the account, so the app can ask "Sign out of ...?"

def test_status_names_the_account_and_says_it_can_sign_out(bw, serve):
    s = serve()
    st = s.call("vault.status")["result"]
    assert st["status"] == "locked"
    assert st["account"] == {"email": EMAIL, "server": None}
    assert st["can_sign_out"] is True
    no_secrets(s, bw)


def test_a_self_hosted_server_is_named(bw, serve):
    bw["state"].write_text(json.dumps({"logged_in": True, "server": "https://vault.example.com", "email": EMAIL}))
    s = serve()
    assert s.call("vault.status")["result"]["account"] == {"email": EMAIL, "server": "https://vault.example.com"}
    no_secrets(s, bw)


def test_a_logged_out_cli_has_no_account(bw, serve):
    bw["state"].write_text(json.dumps({"logged_in": False, "server": None}))
    s = serve()
    st = s.call("vault.status")["result"]
    assert st["status"] == "not-logged-in" and "account" not in st
    no_secrets(s, bw)


# ---- vault.logout

def test_logout_signs_the_cli_out_and_offers_the_sign_in(bw, serve):
    s = serve()
    assert "result" in s.call("vault.unlock", {"password": PASSWORD})
    r = s.call("vault.logout")["result"]
    assert r["provider"] == "bw" and r["status"] == "not-logged-in"
    assert r["signed_out"] == {"email": EMAIL, "server": None}
    assert r["sign_in"] == {"methods": ["password", "apikey", "sso"], "server": None}
    assert ["logout", "--nointeraction"] in bw_calls(bw)
    st = s.call("vault.status")["result"]
    assert st["status"] == "not-logged-in" and "account" not in st
    assert json.loads(bw["state"].read_text())["logged_in"] is False
    no_secrets(s, bw)


def test_logout_works_from_the_lock_screen_too(bw, serve):
    s = serve()
    assert s.call("vault.logout")["result"]["status"] == "not-logged-in"
    no_secrets(s, bw)


def test_already_signed_out(bw, serve):
    s = serve()
    assert "result" in s.call("vault.logout")
    err = s.call("vault.logout")["error"]
    assert err["code"] == 15
    assert err["message"] == "the Bitwarden CLI isn't signed in on this box - there's no account to sign out of"
    assert err["data"]["fix"] == "sign in from the lock screen"
    no_secrets(s, bw)


@pytest.mark.skipif(WINDOWS, reason="signing in with a password needs a PTY: not on native Windows yet")
def test_a_different_account_signs_in_afterwards(bw, serve, monkeypatch):
    monkeypatch.setenv("FAKE_BW_ACCOUNT", json.dumps({"email": OTHER, "password": PASSWORD}))
    s = serve()
    assert "result" in s.call("vault.unlock", {"password": PASSWORD})
    assert "result" in s.call("vault.logout")
    done = s.call("vault.login", {"email": OTHER, "password": PASSWORD})["result"]
    assert done["step"] == "done"
    st = s.call("vault.status")["result"]
    assert st["status"] == "unlocked" and st["account"]["email"] == OTHER
    no_secrets(s, bw)


@pytest.mark.parametrize("provider, words", [
    ("kp", "change vault.kp.database in init.lua"),
    ("cmd", "has no account to sign out of"),
    ("env", "has no account to sign out of"),
])
def test_providers_without_an_account_say_why(bw, serve, provider, words):
    s = serve()
    err = s.call("vault.logout", {"provider": provider})["error"]
    assert err["code"] == 13 and words in err["message"]
    assert not any(c[0] == "logout" for c in bw_calls(bw))
    no_secrets(s, bw)


def test_status_says_kp_cant_sign_out(write_config, fakes, isolated, serve):
    write_config(INVENTORY.replace("bw:lab ssh", "kp:lab ssh"))
    s = serve()
    st = s.call("vault.status")["result"]
    assert st["provider"] == "kp" and st["can_sign_out"] is False and "account" not in st
    s.close()


def test_bad_provider_param(bw, serve):
    s = serve()
    assert s.call("vault.logout", {"provider": 7})["error"]["code"] == -32602
    no_secrets(s, bw)


# ---- the order: every secret is forgotten before the CLI logs out

def test_every_secret_is_forgotten_before_the_cli_logs_out(bw, isolated, monkeypatch):
    state = rpc.State(str(isolated["work"] / "roster.yml"))

    def call(method, params=None):
        return rpc.handle(state, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}))

    assert "result" in call("vault.unlock", {"password": PASSWORD})
    assert os.environ.get("BW_SESSION") == "fake-session-key"
    seen = {}
    real_logout = providers.PROVIDERS["bw"]["logout"]

    def watching_logout(ctx):
        seen.update(tokens=dict(state.askpass.tokens), handed=dict(state.askpass.handed), held=dict(state.held),
                    typed=typed.password, session=os.environ.get("BW_SESSION"), cached=dict(providers._secrets),
                    unlocked=set(state.unlocked), login=state.login)
        return real_logout(ctx)

    monkeypatch.setitem(providers.PROVIDERS["bw"], "logout", watching_logout)
    with askpass.Channel(rpc.askpass_lookup) as state.askpass:
        state.askpass.mint("bw:lab ssh", "esx-02")
        typed = askpass.Typed("typed-pw-xyzzy")
        rpc.hold(state, "held-1", typed, "quick", "root@10.0.0.5")
        providers._secrets["bw:lab ssh"] = "pw-cached"
        r = call("vault.logout")
    assert r["result"]["status"] == "not-logged-in"
    assert seen == {"tokens": {}, "handed": {}, "held": {}, "typed": None, "session": None, "cached": {},
                    "unlocked": set(), "login": None}
