"""Filling a password prompt in a Session from the vault (ticket 119, decision Q129): `session.fill` says which of a
Host's Logins answers the prompt the Session shows, or why none may, and hands the password to the app's core only.
The prompt is text off the Session's screen, so it's the Host's word: it can only narrow what roster fills."""

import json

import pytest

from roster.config import load_config_text
from roster.errors import Problem
from roster.fill import FILL_REFUSED, NOTHING_TO_FILL, login_for

INVENTORY = """\
groups:
  lab:
    user: ops
    auth: bw:Network gear
    hosts:
      esx: {ip: 10.0.0.6, enroll: false}
      box: {ip: 10.0.0.5, sudo: {auth: "bw:Network gear (old)"}}
      keyed: {ip: 10.0.0.7, auth: agent}
      keyed-sudo: {ip: 10.0.0.8, auth: agent, sudo: {auth: "bw:Network gear (old)"}}
      typed: {ip: 10.0.0.9, auth: prompt}
  found:
    reviewed: false
    user: ops
    auth: bw:Network gear
    hosts:
      server-10-0-0-20: {ip: 10.0.0.20}
"""
PASSWORD, SUDO_PASSWORD = "pw-netops", "stale"      # what the fake bw holds for the two items


def fill(name, prompt, text=INVENTORY):
    """login_for Host NAME of TEXT at PROMPT, with its sudo: reference as serve passes it."""
    cfg = load_config_text(text, "/tmp/roster.yml")
    return login_for(cfg["hosts"][name], prompt, cfg["sudo"].get(name))


@pytest.mark.parametrize("prompt", ["[sudo] password for ops: ", "Password: ", "password:", "Password for ops:"])
def test_a_sudo_or_su_prompt_takes_the_ssh_login_by_default(prompt):
    assert fill("esx", prompt) == ("ssh", "bw:Network gear")


@pytest.mark.parametrize("prompt", ["[sudo] password for ops: ", "Password: "])
def test_a_sudo_override_answers_sudo_and_su(prompt):
    assert fill("box", prompt) == ("sudo", "bw:Network gear (old)")


@pytest.mark.parametrize("prompt", ["ops@esx's password: ", "ops@10.0.0.6's password:", "ops@localhost's password: "])
def test_a_nested_ssh_to_the_same_host_and_user_takes_the_ssh_login(prompt):
    assert fill("esx", prompt) == ("ssh", "bw:Network gear")


def test_a_nested_ssh_takes_the_ssh_login_even_with_a_sudo_override():
    assert fill("box", "ops@10.0.0.5's password: ") == ("ssh", "bw:Network gear")


@pytest.mark.parametrize("prompt, says", [
    ("root@10.0.0.6's password: ", "root@10.0.0.6"),
    ("ops@10.0.0.99's password: ", "ops@10.0.0.99"),
    ("ops@esx-02's password: ", "ops@esx-02"),
    ("[sudo] password for root: ", "root's password"),
    ("Password for admin: ", "admin's password"),
])
def test_a_prompt_for_another_host_or_account_is_refused(prompt, says):
    with pytest.raises(Problem) as e:
        fill("esx", prompt)
    assert e.value.code == FILL_REFUSED and says in e.value.message and "esx" in e.value.message


@pytest.mark.parametrize("prompt", ["Enter passphrase for key '/home/ops/.ssh/id_ed25519': ", "Username: ",
                                    "$ ", "password: hunter2", "Verification code: ", ""])
def test_what_isnt_a_password_prompt_is_refused(prompt):
    with pytest.raises(Problem) as e:
        fill("esx", prompt)
    assert e.value.code == FILL_REFUSED and "isn't a password prompt" in e.value.message


def test_only_the_line_at_the_cursor_counts():
    assert fill("esx", "some output\r\n[sudo] password for ops: ") == ("ssh", "bw:Network gear")


@pytest.mark.parametrize("name, says", [("keyed", "auth: agent"), ("typed", "auth: prompt")])
def test_a_login_with_no_saved_password_has_nothing_to_fill(name, says):
    with pytest.raises(Problem) as e:
        fill(name, "[sudo] password for ops: ")
    assert e.value.code == NOTHING_TO_FILL and says in e.value.message and "sudo:" in e.value.fix


def test_a_key_host_with_a_sudo_override_fills_it():
    assert fill("keyed-sudo", "[sudo] password for ops: ") == ("sudo", "bw:Network gear (old)")


def test_a_key_host_has_nothing_for_a_nested_ssh_even_with_a_sudo_override():
    with pytest.raises(Problem) as e:
        fill("keyed-sudo", "ops@10.0.0.8's password: ")
    assert e.value.code == NOTHING_TO_FILL


# ---------------------------------------------------------------- roster.yml's sudo: block

def test_sudo_cascades_from_the_group_and_stays_off_the_host():
    text = INVENTORY.replace("    auth: bw:Network gear\n    hosts:\n      esx",
                             "    auth: bw:Network gear\n    sudo: {auth: bw:lab sudo}\n    hosts:\n      esx", 1)
    cfg = load_config_text(text, "/tmp/roster.yml")
    assert cfg["sudo"]["esx"] == "bw:lab sudo" and cfg["sudo"]["box"] == "bw:Network gear (old)"
    assert "sudo" not in cfg["hosts"]["esx"]            # host.get and the Plugin API's Host are as they were


@pytest.mark.parametrize("block, says", [
    ("sudo: bw:x", "sudo: must be a mapping"),
    ("sudo: {auth: bw:x, user: root}", "sudo: must be a mapping"),
    ("sudo: {auth: prompt}", "a vault reference"),
    ("sudo: {auth: agent}", "a vault reference"),
])
def test_a_bad_sudo_block_says_how(block, says):
    with pytest.raises(SystemExit) as e:
        load_config_text(INVENTORY.replace("{ip: 10.0.0.6, enroll: false}", f"{{ip: 10.0.0.6, {block}}}"),
                         "/tmp/roster.yml")
    assert says in str(e.value.code)


# ---------------------------------------------------------------- session.fill, as the app's core calls it

def unlocked(serve, write_config):
    write_config(INVENTORY)
    s = serve()
    assert s.call("vault.unlock", {"password": "hunter2"})["result"]["status"] == "unlocked"
    return s


def test_session_fill_hands_the_core_the_logins_password(serve, write_config, fakes):
    s = unlocked(serve, write_config)
    assert s.call("session.fill", {"host": "esx", "prompt": "[sudo] password for ops: "})["result"] == {
        "host": "esx", "login": "ssh", "password": PASSWORD}
    assert s.call("session.fill", {"host": "box", "prompt": "Password: "})["result"] == {
        "host": "box", "login": "sudo", "password": SUDO_PASSWORD}
    code, _, err = s.close()
    assert code == 0 and PASSWORD not in err and SUDO_PASSWORD not in err


def test_session_fill_refuses_before_looking_anything_up(serve, write_config, fakes):
    s = unlocked(serve, write_config)
    refused = s.call("session.fill", {"host": "esx", "prompt": "root@10.0.0.9's password: "})["error"]
    assert refused["code"] == FILL_REFUSED and PASSWORD not in json.dumps(refused)
    assert s.call("session.fill", {"host": "keyed", "prompt": "Password: "})["error"]["code"] == NOTHING_TO_FILL
    assert s.call("session.fill", {"host": "nope", "prompt": "Password: "})["error"]["code"] == 2
    assert s.call("session.fill", {"host": "server-10-0-0-20", "prompt": "Password: "})["error"]["code"] == 20
    assert s.call("session.fill", {"host": "esx"})["error"]["code"] == -32602
    assert s.call("session.fill", {"host": "esx", "prompt": 3})["error"]["code"] == -32602


def test_session_fill_while_locked_says_unlock_first(serve, write_config, fakes):
    write_config(INVENTORY)
    err = serve().call("session.fill", {"host": "esx", "prompt": "Password: "})["error"]
    assert (err["code"], err["message"]) == (14, "bw vault is locked - unlock it first")


def test_session_fill_names_the_sudo_login_when_its_item_is_missing(serve, write_config, fakes):
    write_config(INVENTORY.replace("bw:Network gear (old)", "bw:no such item"))
    s = serve()
    s.call("vault.unlock", {"password": "hunter2"})
    err = s.call("session.fill", {"host": "box", "prompt": "Password: "})["error"]
    assert err["code"] == 32 and "sudo Login of box" in err["message"]
