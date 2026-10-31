"""Ticket 10: editing one Host in roster.yml as text. Comments, order, quoting and every other entry stay byte for
byte; a result that doesn't load, or loads to anything but what was asked, is refused."""

import difflib

import pytest

from roster import edit
from roster.config import load_config
from roster.errors import INVALID_EDIT, Problem

INVENTORY = """\
# The lab. NO PASSWORDS IN THIS FILE.
defaults:
  auth: prompt   # ask once per group

groups:
  lab:
    title: Lab gear
    user: ops            # the team account
    hosts:
      short: 10.0.0.1    # the old switch
      flow: {ip: 10.0.0.2, title: "Flow box"}
      block:
        ip: 10.0.0.3     # moved in May
        title: 'Block box'
        description: |
          Two lines
          of notes.
        type: esxi
        services:
          web: 443
      sshd:
        ip: 10.0.0.4
        ssh:
          user: root
          port: 2222
      plain:
        ip: 10.0.0.5
        user: admin
        auth: bw:plain ssh
  # a comment between groups
  other:
    type: switch
    hosts:
      sw1: {ip: 10.0.1.1, user: net}
"""


def changed_lines(old, new):
    """The - and + lines of a diff between two texts."""
    return [ln for ln in difflib.unified_diff(old.splitlines(), new.splitlines(), lineterm="", n=0)
            if ln[:1] in "+-" and not ln.startswith(("+++", "---"))]


@pytest.fixture
def inv(write_config):
    return write_config(INVENTORY)


def edit_of(path, host, **changes):
    old, new, h = edit.edited(path, host, changes)
    assert old == INVENTORY
    return changed_lines(old, new), h


def test_a_block_hosts_title_changes_on_its_own_line_keeping_its_quotes(inv):
    lines, h = edit_of(inv, "block", title="Big box")
    assert lines == ["-        title: 'Block box'", "+        title: 'Big box'"]
    assert h["title"] == "Big box"


def test_a_value_with_a_comment_keeps_the_comment(inv):
    lines, h = edit_of(inv, "block", ip="10.0.0.33")
    assert lines == ["-        ip: 10.0.0.3     # moved in May", "+        ip: 10.0.0.33     # moved in May"]


def test_a_block_scalar_becomes_one_line(inv):
    lines, h = edit_of(inv, "block", description="One line now")
    assert lines == ["-        description: |", "-          Two lines", "-          of notes.",
                     "+        description: One line now"]


def test_a_new_field_goes_after_the_last_one_line_entry(inv):
    lines, h = edit_of(inv, "plain", title="Plain box: the one")
    assert lines == ['+        title: "Plain box: the one"']
    assert h["title"] == "Plain box: the one"


def test_a_flow_mapping_gets_the_new_key_inside_its_braces(inv):
    lines, h = edit_of(inv, "flow", type="nas", title="Flow")
    assert lines == ['-      flow: {ip: 10.0.0.2, title: "Flow box"}', '+      flow: {ip: 10.0.0.2, title: "Flow", type: nas}']


def test_a_short_form_host_only_changing_its_address_stays_short(inv):
    lines, _ = edit_of(inv, "short", ip="10.0.0.11")
    assert lines == ["-      short: 10.0.0.1    # the old switch", "+      short: 10.0.0.11    # the old switch"]


def test_a_short_form_host_grows_into_a_block_with_its_comment_on_the_key_line(inv):
    lines, h = edit_of(inv, "short", title="Old switch")
    assert lines == ["-      short: 10.0.0.1    # the old switch", "+      short:    # the old switch",
                     "+        ip: 10.0.0.1", "+        title: Old switch"]
    assert h["ip"] == "10.0.0.1" and h["user"] == "ops"


def test_the_login_goes_into_the_hosts_ssh_block(inv):
    lines, h = edit_of(inv, "sshd", user="admin", auth="bw:sshd ssh")
    assert lines == ["-          user: root", "+          user: admin", "+          auth: bw:sshd ssh"]
    assert h["ssh"] == {"user": "admin", "port": 2222, "auth": "bw:sshd ssh"}


def test_an_inherited_user_is_set_on_the_host(inv):
    lines, h = edit_of(inv, "block", user="root", port=2200)
    assert lines == ["+        user: root", "+        port: 2200"]
    assert h["ssh"]["user"] == "root" and h["ssh"]["port"] == 2200


def test_emptying_a_field_drops_its_line_or_writes_empty_when_the_group_sets_it(inv):
    lines, h = edit_of(inv, "block", type="")
    assert lines == ["-        type: esxi"] and h["type"] == ""
    lines, h = edit_of(inv, "sw1", type="")                 # the group's type: switch would come back
    assert lines == ["-      sw1: {ip: 10.0.1.1, user: net}", '+      sw1: {ip: 10.0.1.1, user: net, type: ""}']
    assert h["type"] == ""


def test_every_other_byte_stays(inv):
    old, new, _ = edit.edited(inv, "plain", {"title": "x", "user": "y", "auth": "bw:z", "ip": "10.9.9.9"})
    assert changed_lines(old, new) == ["-        ip: 10.0.0.5", "-        user: admin", "-        auth: bw:plain ssh",
                                       "+        ip: 10.9.9.9", "+        user: y", "+        auth: bw:z",
                                       "+        title: x"]
    before = load_config(inv)
    inv.write_text(new)
    after = load_config(inv)
    assert {k: v for k, v in before["hosts"].items() if k != "plain"} == \
        {k: v for k, v in after["hosts"].items() if k != "plain"}


@pytest.mark.parametrize("value", ["a: b", "#hash", "- dash", "yes", "1.5", "null", " pad", "quote's", 'say "hi"',
                                   "ünïcødé ✓", "tab\there", "[x]", "{y}", "*star", "&amp", "100%"])
def test_any_text_reads_back_as_itself(inv, value):
    _, h = edit_of(inv, "block", title=edit.check_value("title", value))
    assert h["title"] == " ".join(value.split())


def test_a_result_that_wouldnt_load_is_refused_and_nothing_is_written(inv, monkeypatch):
    monkeypatch.setattr(edit, "edit_text", lambda text, *a: text.replace("groups:", "groups: [", 1))
    with pytest.raises(Problem) as e:
        edit.edited(inv, "block", {"title": "x"})
    assert e.value.code == INVALID_EDIT and "wouldn't load" in e.value.message and e.value.details
    assert inv.read_text() == INVENTORY
    assert sorted(p.name for p in inv.parent.iterdir()) == ["roster.yml"]       # no temporary file left


def test_an_edit_that_would_change_another_host_is_refused(write_config):
    path = write_config(INVENTORY.replace("      flow: {ip: 10.0.0.2", "      flow: &f {ip: 10.0.0.2")
                        .replace("        auth: bw:plain ssh\n", "        auth: bw:plain ssh\n      copy: *f\n"))
    with pytest.raises(Problem) as e:
        edit.edited(path, "copy", {"title": "x"})
    assert e.value.code == INVALID_EDIT and "alias" in e.value.message
    with pytest.raises(Problem) as e:
        edit.edited(path, "flow", {"title": "x"})        # copy is the same node: it would change too
    assert e.value.code == INVALID_EDIT and "loads differently" in e.value.message


def test_crlf_files_stay_crlf(write_config):
    path = write_config("")
    path.write_bytes(INVENTORY.replace("\n", "\r\n").encode())
    old, new, _ = edit.edited(path, "plain", {"title": "x"})
    assert "\r\n" in new and "\n" not in new.replace("\r\n", "")
    assert new.replace("\r\n", "\n") == INVENTORY.replace("        auth: bw:plain ssh\n",
                                                          "        auth: bw:plain ssh\n        title: x\n")


@pytest.mark.parametrize("field,value,why", [("ip", "", "empty"), ("ip", "a b", "spaces"), ("port", 0, "1 to 65535"),
                                             ("port", "22", "1 to 65535"), ("title", "a\nb", "one line"),
                                             ("name", "x", "can't be edited"), ("title", 5, "string")])
def test_bad_values(field, value, why):
    with pytest.raises(ValueError, match=why):
        edit.check_value(field, value)


# ---------------------------------------------------------------- adding a Host (ticket 11)

def add_of(path, group, name, **fields):
    old, new, h = edit.added(path, group, name, fields)
    assert old == INVENTORY
    return changed_lines(old, new), new, h


def test_an_added_host_goes_at_the_end_of_its_group_with_only_what_it_doesnt_inherit(inv):
    lines, new, h = add_of(inv, "lab", "nas", ip="10.0.0.8", user="ops", auth="bw:nas ssh", enroll=False,
                           title="The NAS")
    assert lines == ["+      nas:", "+        ip: 10.0.0.8", "+        auth: bw:nas ssh", "+        enroll: false",
                     "+        title: The NAS"]
    assert new.index("auth: bw:plain ssh") < new.index("nas:") < new.index("# a comment between groups")
    assert h["group"] == "lab" and h["ssh"] == {"user": "ops", "port": 22, "auth": "bw:nas ssh"}
    assert h["reviewed"] is True and h["enroll"] is False and h["title"] == "The NAS"


def test_a_group_of_flow_entries_gets_a_flow_entry(inv):
    lines, _, h = add_of(inv, "other", "sw2", ip="10.0.1.2", user="net", reviewed=False)
    assert lines == ["+      sw2: {ip: 10.0.1.2, user: net, reviewed: false}"]
    assert h["type"] == "switch" and h["reviewed"] is False


def test_a_new_group_goes_after_the_last_group(inv):
    lines, new, h = add_of(inv, "dmz", "web1", ip="10.0.2.1", user="www", port=2222)
    assert lines == ["+  dmz:", "+    hosts:", "+      web1:", "+        ip: 10.0.2.1", "+        user: www",
                     "+        port: 2222"]
    assert new.endswith("      sw1: {ip: 10.0.1.1, user: net}\n  dmz:\n    hosts:\n      web1:\n"
                        "        ip: 10.0.2.1\n        user: www\n        port: 2222\n")
    assert h["group"] == "dmz" and h["ssh"]["port"] == 2222


def test_an_added_host_after_a_block_scalar(write_config):
    path = write_config(INVENTORY.replace("        services:\n          web: 443\n", "")
                        .replace("      sshd:", "      tail:\n        ip: 10.0.0.9\n        description: |\n"
                                 "          last\n      sshd:"))
    path.write_text(path.read_text().replace("  other:\n    type: switch\n    hosts:\n      sw1: {ip: 10.0.1.1, user: net}\n",
                                             "").replace("  # a comment between groups\n", ""))
    text = path.read_text()
    old, new, h = edit.added(path, "lab", "z", {"ip": "10.0.0.10"})
    assert new == text + "      z:\n        ip: 10.0.0.10\n" and h["ip"] == "10.0.0.10"


@pytest.mark.parametrize("name,why", [("plain", "host 'plain' is already in the Inventory (group lab)"),
                                      ("sw1", "host 'sw1' is already in the Inventory (group other)"),
                                      ("bad name", "bad host name 'bad name' (use letters, digits, . _ -)"),
                                      ("-x", "bad host name '-x'")])
def test_a_duplicate_or_invalid_name_is_refused_with_rosters_wording(inv, name, why):
    with pytest.raises(Problem) as e:
        edit.added(inv, "lab", name, {"ip": "10.0.0.8"})
    assert why in e.value.message and e.value.code in (80, 81)
    assert inv.read_text() == INVENTORY


def test_a_bad_group_name_is_refused(inv):
    with pytest.raises(Problem) as e:
        edit.added(inv, "a group", "x", {"ip": "10.0.0.8"})
    assert e.value.code == 80 and "bad group name 'a group'" in e.value.message


def test_a_new_host_without_a_user_anywhere_is_refused(write_config):
    path = write_config("groups:\n  g:\n    hosts:\n      a: {ip: 10.0.0.1, user: x}\n")
    with pytest.raises(Problem) as e:
        edit.added(path, "g", "b", {"ip": "10.0.0.2"})
    assert e.value.code == 80 and "no user" in e.value.message


def test_marking_reviewed_flips_only_that_flag(write_config):
    path = write_config(INVENTORY.replace("  other:\n    type: switch\n", "  other:\n    type: switch\n    reviewed: false\n    user: net\n")
                        .replace("      sw1: {ip: 10.0.1.1, user: net}", "      sw1: {ip: 10.0.1.1, user: net}\n"
                                 "      sw2: 10.0.1.2   # spare\n      sw3:\n        ip: 10.0.1.3\n        reviewed: false"))
    for name, want in [("sw1", ["-      sw1: {ip: 10.0.1.1, user: net}", "+      sw1: {ip: 10.0.1.1, user: net, reviewed: true}"]),
                       ("sw2", ["-      sw2: 10.0.1.2   # spare", "+      sw2:   # spare", "+        ip: 10.0.1.2",
                                "+        reviewed: true"]),
                       ("sw3", ["-        reviewed: false", "+        reviewed: true"])]:
        old, new, h = edit.edited(path, name, {"reviewed": True})
        assert changed_lines(old, new) == want and h["reviewed"] is True
