"""Ticket 11 through `roster serve`: host.scan_key, host.add (verified adds, decision Q43) and host.review, against
the scratch infra repo, the stand-in bw and the local paramiko Host from test_changes. No network."""
# ruff: noqa: F811 (test_changes' fixtures, imported by name, are the tests' arguments)

import json
import socket

import paramiko
import pytest
from conftest import ALL_SECRETS, SECRET
from test_changes import app, box, git, infra, result, sshd  # noqa: F401 (fixtures)

from roster import edit
from roster import serve as rpc
from roster.sshops import fingerprint


def items(vault):
    return [i["name"] for i in json.loads(vault.read_text())]


def known_hosts(isolated):
    return isolated["home"] / ".ssh" / "roster_known_hosts"


def add(app, **params):
    return app.call("host.add", {"group": "lab", "user": "root", "address": "127.0.0.1", **params})


def nothing_written(box, vault, isolated, before_items=None, before_known=None):
    assert git(box, "status", "--porcelain") == ""
    assert items(vault) == (before_items or ["esx ssh", "dup ssh", "dup ssh", "nopw ssh"])
    if before_known is not None:
        assert known_hosts(isolated).read_text() == before_known


# ---------------------------------------------------------------- Hosts without a Login: unreviewed, no network

def test_a_host_without_a_login_is_added_unreviewed_without_touching_the_network(app, box, sshd):
    r = result(add(app, name="nas", address="10.0.0.50", type="nas", title="The NAS"))
    assert r["added"] and r["verify"] is None and r["item"] is None
    h = r["host"]
    assert h["group"] == "lab" and h["reviewed"] is False and h["type"] == "nas" and h["ssh"]["auth"] == "prompt"
    assert sshd.accepts == 0
    text = box.yml.read_text()
    assert "      nas:\n        ip: 10.0.0.50\n        reviewed: false\n" in text and "# the ESXi box" in text
    assert result(app.call("changes.diff"))["hosts"] == [{"host": "nas", "change": "added", "fields": []}]
    assert "nas" in {h["name"] for h in result(app.call("hosts.list"))["hosts"]}


@pytest.mark.parametrize("params,code,field", [({"name": "esx"}, 81, None), ({"name": "bad name"}, 80, "name"),
                                               ({"name": "x", "group": "a b"}, 80, "group"),
                                               ({"name": "x", "address": "a b"}, -32602, None),
                                               ({"name": "x", "port": 0}, -32602, None),
                                               ({"name": "x", "auth": "bw:x", "password": "p"}, -32602, None)])
def test_bad_adds_are_refused_and_nothing_is_written(app, box, vault, isolated, params, code, field):
    err = add(app, **params)["error"]
    assert err["code"] == code, err
    if field:
        assert err["data"]["field"] == field
    if code == 81:
        assert err["message"] == "host 'esx' is already in the Inventory (group lab)"
    nothing_written(box, vault, isolated)


# ---------------------------------------------------------------- the host key, scanned and confirmed first

def test_scan_key_shows_the_hosts_key_and_records_nothing(app, box, sshd, isolated):
    known_hosts(isolated).write_text("")
    r = result(app.call("host.scan_key", {"address": "127.0.0.1", "port": sshd.port}))
    assert r == {"address": "127.0.0.1", "port": sshd.port, "key_type": sshd.key.get_name(),
                 "fingerprint": fingerprint(sshd.key), "recorded": "none"}
    assert known_hosts(isolated).read_text() == "" and sshd.attempts == []


def test_scan_key_says_when_the_key_is_already_recorded_or_differs(app, box, sshd, isolated):
    r = result(app.call("host.scan_key", {"address": "127.0.0.1", "port": sshd.port}))
    assert r["recorded"] == "match"
    other = paramiko.ECDSAKey.generate()
    known_hosts(isolated).write_text(f"[127.0.0.1]:{sshd.port} {other.get_name()} {other.get_base64()}\n")
    r = result(app.call("host.scan_key", {"address": "127.0.0.1", "port": sshd.port}))
    assert r["recorded"] == "changed" and r["fingerprint"] == fingerprint(sshd.key)


def test_scan_key_of_an_unreachable_address(app):
    s = socket.create_server(("127.0.0.1", 0))
    closed = s.getsockname()[1]
    s.close()
    assert app.call("host.scan_key", {"address": "127.0.0.1", "port": closed})["error"]["code"] == 41


# ---------------------------------------------------------------- verified adds (Q43)

def test_a_typed_password_is_tested_then_saved_then_the_host_added(app, box, sshd, vault, isolated):
    known_hosts(isolated).write_text("")
    r = result(add(app, name="nas", port=sshd.port, password=SECRET, enroll=False, host_key=fingerprint(sshd.key)))
    assert r["verify"]["ok"] and sshd.accepts == 1 and sshd.attempts == [("password", "root")]
    assert r["item"]["name"] == "nas ssh" and r["item"]["provider"] == "bw"
    made = next(i for i in json.loads(vault.read_text()) if i["name"] == "nas ssh")
    assert made["login"]["username"] == "root" and made["login"]["uris"] == [{"uri": f"ssh://127.0.0.1:{sshd.port}", "match": None}]
    h = r["host"]
    assert h["reviewed"] is True and h["ssh"] == {"user": "root", "port": sshd.port, "auth": "bw:nas ssh"}
    assert f"[127.0.0.1]:{sshd.port} {sshd.key.get_name()} {sshd.key.get_base64()}" in known_hosts(isolated).read_text()
    pending = box.yml.read_text() + result(app.call("changes.diff"))["diff"]
    assert SECRET not in pending and "auth: bw:nas ssh" in pending
    # and it works as any other Host's Login now
    assert result(app.call("host.verify_login", {"host": "nas", "changes": {"title": "x"}}))["ok"]


def test_the_item_name_can_be_chosen(app, box, sshd, vault):
    r = result(add(app, name="nas", port=sshd.port, password=SECRET, enroll=False, item="nas ssh+web"))
    assert r["host"]["ssh"]["auth"] == "bw:nas ssh+web" and "nas ssh+web" in items(vault)


def test_an_existing_vault_item_is_tested_and_the_host_added(app, box, sshd, vault):
    r = result(add(app, name="esx2", port=sshd.port, auth="bw:esx ssh", enroll=False))
    assert r["verify"]["ok"] and r["item"] is None and r["host"]["reviewed"] is True
    assert items(vault) == ["esx ssh", "dup ssh", "dup ssh", "nopw ssh"]


@pytest.mark.parametrize("change,code,step", [({"password": "wrong"}, 45, "auth"), ({"user": "admin"}, 45, "auth"),
                                              ({"auth": "bw:esx shh"}, 32, "vault-item")])
def test_a_failed_test_login_writes_nothing(app, box, sshd, vault, isolated, change, code, step):
    before = known_hosts(isolated).read_text()
    params = {"name": "nas", "port": sshd.port, "enroll": False, "password": SECRET, **change}
    if "auth" in change:
        del params["password"]
    err = add(app, **params)["error"]
    assert err["code"] == code and err["data"]["step"] == step, err
    assert [s["step"] for s in err["data"]["steps"]] == ["user", "provider", "vault-item", "dns", "tcp", "host-key",
                                                          "auth"]
    assert "nothing was saved" in err["message"]
    nothing_written(box, vault, isolated, before_known=before)


def test_an_unreachable_host_writes_nothing(app, box, vault, isolated):
    s = socket.create_server(("127.0.0.1", 0))
    closed = s.getsockname()[1]
    s.close()
    err = add(app, name="nas", port=closed, password=SECRET, enroll=False)["error"]
    assert err["code"] == 41 and err["data"]["step"] == "tcp"
    nothing_written(box, vault, isolated)


def test_an_unconfirmed_or_refused_host_key_writes_nothing(app, box, sshd, vault, isolated):
    known_hosts(isolated).write_text("")
    err = add(app, name="nas", port=sshd.port, password=SECRET, enroll=False)["error"]
    assert err["code"] == 44 and err["data"]["step"] == "host-key"
    other = fingerprint(paramiko.ECDSAKey.generate())
    err = add(app, name="nas", port=sshd.port, password=SECRET, enroll=False, host_key=other)["error"]
    assert err["code"] == 43 and err["data"]["step"] == "host-key"
    assert sshd.attempts == []                              # never a login over a key nobody confirmed
    nothing_written(box, vault, isolated, before_known="")


def test_a_vault_that_refuses_the_item_writes_nothing(serve, box, sshd, vault, isolated, monkeypatch):
    monkeypatch.setenv("FAKE_BW_WRITE_FAIL", "policy says no")
    s = serve("-c", str(box.yml))
    s.call("vault.unlock", {"password": "hunter2"})
    err = add(s, name="nas", port=sshd.port, password=SECRET, enroll=False)["error"]
    assert err["code"] == 62 and "policy says no" in err["message"]
    nothing_written(box, vault, isolated)
    _, out, errout = s.close()
    assert SECRET not in "".join(s.responses) + out + errout


def test_a_locked_vault_fails_before_the_network(serve, box, sshd, vault, isolated):
    s = serve("-c", str(box.yml))
    err = add(s, name="nas", port=sshd.port, password=SECRET, enroll=False)["error"]
    assert err["code"] == 14 and err["data"]["step"] == "provider" and sshd.accepts == 0
    nothing_written(box, vault, isolated)


def test_a_failure_adding_the_host_takes_the_new_item_back_out(box, sshd, vault, isolated, fakes, monkeypatch):
    state = rpc.State(str(box.yml))
    assert "result" in json.loads(json.dumps(rpc.handle(state, json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": "vault.unlock", "params": {"password": "hunter2"}}))))
    real, calls = edit.add_text, []

    def second_add_breaks(text, *a):            # the dry run before the test login works; the real write doesn't
        calls.append(1)
        return real(text, *a) if len(calls) == 1 else text.replace("groups:", "groups: [", 1)
    monkeypatch.setattr(edit, "add_text", second_add_breaks)
    r = rpc.handle(state, json.dumps({"jsonrpc": "2.0", "id": 2, "method": "host.add", "params": {
        "name": "nas", "group": "lab", "address": "127.0.0.1", "port": sshd.port, "user": "root",
        "password": SECRET, "enroll": False}}))
    err = r["error"]
    assert err["code"] == 74 and "the vault item 'nas ssh' was taken back out" in err["message"]
    assert err["data"]["undone"]["name"] == "nas ssh"
    nothing_written(box, vault, isolated)
    assert SECRET not in json.dumps(r)


def test_the_typed_password_never_reaches_any_output(app, box, sshd, vault):
    add(app, name="nas", port=sshd.port, password=SECRET, enroll=False)
    add(app, name="nas2", port=sshd.port, password="wrong-" + SECRET, enroll=False)
    # (the app fixture checks every response, stdout and stderr for SECRET when it closes)
    assert all(s not in box.yml.read_text() for s in ALL_SECRETS)


# ---------------------------------------------------------------- host.review

def test_marking_a_host_reviewed_flips_only_that_flag(app, box):
    result(add(app, name="nas", address="10.0.0.50"))
    before = box.yml.read_text()
    r = result(app.call("host.review", {"host": "nas"}))
    assert r["changed"] and r["host"]["reviewed"] is True
    assert box.yml.read_text() == before.replace("        reviewed: false\n", "        reviewed: true\n")
    assert result(app.call("host.review", {"host": "nas"}))["changed"] is False
    assert app.call("host.review", {"host": "nope"})["error"]["code"] == 2
