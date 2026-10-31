"""Ticket 35: where "Save to vault" puts new Vault items - the personal vault or an organization's collection
(Bitwarden), or a group (KeePassXC). A setting in roster.yml (the team's default), init.lua's `vault.save_to` over it
(through vault.configure), and a choice at save time over both. Driven through `roster serve` and the stand-in bw,
whose organizations come from FAKE_BW_ORGS."""

import json

import pytest

ORGS = [
    {"id": "0rg-team", "name": "My Team", "status": 2, "type": 2, "enabled": True,
     "collections": [{"id": "c0l-infra", "name": "Infra logins"},
                     {"id": "c0l-audit", "name": "Audit", "readOnly": True}]},
    {"id": "0rg-other", "name": "Other Org", "status": 2, "type": 2, "enabled": True,
     "collections": [{"id": "c0l-misc", "name": "Misc"}]},
    {"id": "0rg-invited", "name": "Not Yet", "status": 0, "type": 2, "enabled": True,      # invited, not confirmed
     "collections": [{"id": "c0l-later", "name": "Later"}]},
]

NEW_PW = "n3w-s4ve-to-pw"               # handed to bw on stdin only: never in argv, a response or stderr

TEAM = {"organization": "My Team", "collection": "Infra logins"}

INVENTORY = """\
providers:
  bw:
    save_to: {save_to}
groups:
  lab:
    user: ops
    auth: bw:lab ssh
    hosts:
      box: {{ip: 10.0.0.5}}
"""


@pytest.fixture
def bw(vault, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_BW_ORGS", json.dumps(ORGS))
    monkeypatch.setenv("FAKE_ARGV_LOG", str(tmp_path / "argv.log"))
    return vault


def start(serve, write_config, save_to="personal"):
    write_config(INVENTORY.format(save_to=json.dumps(save_to)))
    s = serve()
    s.call("vault.unlock", {"password": "hunter2"})
    return s


def item(vault, name):
    return next(i for i in json.loads(vault.read_text()) if i["name"] == name)


def no_secret(s, tmp_path):
    code, out, err = s.close()
    assert code == 0 and out == ""
    for where in (json.dumps(s.responses), err, (tmp_path / "argv.log").read_text()):
        assert NEW_PW not in where


PERSONAL = {"id": "personal", "kind": "personal", "label": "Personal vault", "save_to": "personal"}
INFRA = {"id": "collection:c0l-infra", "kind": "collection", "label": "My Team / Infra logins",
         "organization": "My Team", "collection": "Infra logins",
         "save_to": {"organization": "0rg-team", "collection": "c0l-infra"}}


def test_the_default_is_the_personal_vault(serve, write_config, bw, tmp_path):
    s = start(serve, write_config)
    made = s.call("vault.create_item", {"name": "box ssh", "password": NEW_PW})["result"]
    assert made["target"] == {"id": "personal", "kind": "personal", "label": "Personal vault"}
    saved = item(bw, "box ssh")
    assert saved["organizationId"] is None and not saved.get("collectionIds")
    no_secret(s, tmp_path)


def test_targets_list_the_personal_vault_and_the_collections_and_the_default(serve, write_config, bw, tmp_path):
    s = start(serve, write_config, TEAM)
    targets = s.call("vault.targets")["result"]
    assert targets["provider"] == "bw" and targets["default"] == "collection:c0l-infra"
    assert targets["from"] == "roster.yml" and targets["problem"] is None
    assert targets["targets"][:2] == [PERSONAL, INFRA]
    # every collection of the organizations you're confirmed in, never one you're only invited to
    assert [t["label"] for t in targets["targets"]] == ["Personal vault", "My Team / Infra logins", "My Team / Audit",
                                                       "Other Org / Misc"]


def test_a_collection_from_roster_yml_by_name_or_id(serve, write_config, bw, tmp_path):
    s = start(serve, write_config, TEAM)
    made = s.call("vault.create_item", {"name": "box ssh", "password": NEW_PW})["result"]
    assert made["target"] == {k: v for k, v in INFRA.items() if k != "save_to"}
    saved = item(bw, "box ssh")
    assert (saved["organizationId"], saved["collectionIds"]) == ("0rg-team", ["c0l-infra"])
    assert saved["login"]["password"] == NEW_PW
    # ids work as well as names
    s2 = start(serve, write_config, {"organization": "0rg-other", "collection": "c0l-misc"})
    s2.call("vault.create_item", {"name": "nas ssh", "password": NEW_PW})
    assert item(bw, "nas ssh")["collectionIds"] == ["c0l-misc"]
    no_secret(s, tmp_path)


def test_init_lua_wins_over_roster_yml_and_the_choice_at_save_time_over_both(serve, write_config, bw, tmp_path):
    s = start(serve, write_config, TEAM)
    assert s.call("vault.configure", {"save_to": "personal"})["result"]["locked"] == []
    targets = s.call("vault.targets")["result"]
    assert (targets["default"], targets["from"]) == ("personal", "init.lua")
    status = s.call("vault.status")["result"]
    assert status["save_to"] == {"setting": "personal", "from": "init.lua"}
    s.call("vault.create_item", {"name": "a ssh", "password": NEW_PW})
    assert item(bw, "a ssh")["organizationId"] is None
    made = s.call("vault.create_item", {"name": "b ssh", "password": NEW_PW,
                                        "save_to": {"organization": "0rg-team", "collection": "c0l-infra"}})["result"]
    assert made["target"]["id"] == "collection:c0l-infra" and item(bw, "b ssh")["collectionIds"] == ["c0l-infra"]
    s.call("vault.configure", {})                                       # init.lua leaves it out: roster.yml's again
    assert s.call("vault.status")["result"]["save_to"] == {"setting": TEAM, "from": "roster.yml"}
    no_secret(s, tmp_path)


@pytest.mark.parametrize("where, save_to, field", [
    ("roster.yml", {"organization": "My Tem", "collection": "Infra logins"},
     "providers: bw: save_to: organization: in roster.yml"),
    ("roster.yml", {"organization": "My Team", "collection": "Infra"},
     "providers: bw: save_to: collection: in roster.yml"),
    ("roster.yml", {"organization": "Not Yet", "collection": "Later"},
     "providers: bw: save_to: organization: in roster.yml"),
    ("init.lua", {"organization": "Nobody", "collection": "x"}, "vault.save_to.organization in init.lua"),
    ("choice", {"organization": "My Team", "collection": "Nope"}, "save_to.collection"),
])
def test_a_name_that_doesnt_resolve_is_a_clean_error_naming_the_field(serve, write_config, bw, tmp_path, where,
                                                                      save_to, field):
    s = start(serve, write_config, save_to if where == "roster.yml" else "personal")
    params = {"name": "box ssh", "password": NEW_PW}
    if where == "init.lua":
        s.call("vault.configure", {"save_to": save_to})
    if where == "choice":
        params["save_to"] = save_to
    before = bw.read_text()
    err = s.call("vault.create_item", params)["error"]
    assert err["code"] == 64 and field in err["message"], err
    assert err["data"]["fix"]
    assert bw.read_text() == before                                     # nothing saved
    if where != "choice":                                               # the default can't be shown, but the list can
        targets = s.call("vault.targets")["result"]
        assert targets["default"] is None and field in targets["problem"]["message"]
        assert targets["problem"]["code"] == 64 and targets["targets"][0] == PERSONAL
    no_secret(s, tmp_path)


def test_a_read_only_collection_is_refused_and_nothing_is_left_behind(serve, write_config, bw, tmp_path):
    s = start(serve, write_config, {"organization": "My Team", "collection": "Audit"})
    before = bw.read_text()
    err = s.call("vault.create_item", {"name": "box ssh", "password": NEW_PW})["error"]
    assert err["code"] == 65 and "Audit" in err["message"] and err["data"]["fix"], err
    assert bw.read_text() == before                                     # bw saved it outside the collection: taken out
    # from then on it's not offered
    assert "collection:c0l-audit" not in [t["id"] for t in s.call("vault.targets")["result"]["targets"]]
    no_secret(s, tmp_path)


def test_undo_takes_a_collection_item_back_out(serve, write_config, bw, tmp_path):
    s = start(serve, write_config, TEAM)
    made = s.call("vault.create_item", {"name": "box ssh", "password": NEW_PW})["result"]
    assert s.call("vault.undo_create", {"id": made["id"]})["result"] == {"provider": "bw", "id": made["id"]}
    assert "box ssh" not in [i["name"] for i in json.loads(bw.read_text())]
    no_secret(s, tmp_path)


@pytest.mark.parametrize("save_to", ["shared", {"organization": "My Team"}, {"collection": "x"}, {"group": 3},
                                     {"organization": "a", "collection": "b", "group": "c"}, 7])
def test_a_save_to_of_the_wrong_shape_is_refused(serve, write_config, bw, save_to):
    s = start(serve, write_config)
    assert s.call("vault.create_item", {"name": "x ssh", "password": NEW_PW, "save_to": save_to})["error"]["code"] \
        == -32602
    r = s.call("vault.configure", {"save_to": save_to})["result"]          # left out alone, the rest still applies
    assert [x["setting"] for x in r["refused"]] == ["save_to"] and "save_to" in r["refused"][0]["message"]
    assert s.call("vault.status")["result"]["save_to"]["from"] != "init.lua"


def test_a_bad_save_to_in_roster_yml_is_a_config_error(serve, write_config, bw):
    s = start(serve, write_config, "shared")
    err = s.call("vault.create_item", {"name": "x ssh", "password": NEW_PW})["error"]
    assert err["code"] == 64 and "providers: bw: save_to: in roster.yml" in err["message"]


def test_targets_need_the_vault_unlocked(serve, write_config, bw):
    write_config(INVENTORY.format(save_to='"personal"'))
    assert serve().call("vault.targets")["error"]["code"] == 14


# ---- KeePassXC: the target is a group

def test_keepassxc_saves_to_a_group(serve, write_config, fakes, isolated, tmp_path):
    from test_keepassxc import KP_INVENTORY, MASTER, entries, make_db
    db = make_db(isolated["work"] / "roster.kdbx", [{"path": "Lab/esx ssh", "Password": "pw"}], groups=["Lab", "Ops"])
    write_config(KP_INVENTORY.replace("kp: {database: roster.kdbx}", "kp: {database: roster.kdbx, group: Lab}"))
    s = serve()
    s.call("vault.unlock", {"password": MASTER})
    targets = s.call("vault.targets")["result"]
    assert [t["id"] for t in targets["targets"]] == ["personal", "group:Lab", "group:Ops"]
    assert (targets["default"], targets["from"]) == ("group:Lab", "roster.yml")
    assert targets["targets"][0]["label"] == "Top level" and targets["targets"][2]["save_to"] == {"group": "Ops"}
    made = s.call("vault.create_item", {"name": "a ssh", "password": NEW_PW})["result"]
    assert made["id"] == "Lab/a ssh" and made["target"]["id"] == "group:Lab"
    s.call("vault.configure", {"save_to": {"group": "Ops"}})
    assert s.call("vault.create_item", {"name": "b ssh", "password": NEW_PW})["result"]["id"] == "Ops/b ssh"
    made = s.call("vault.create_item", {"name": "c ssh", "password": NEW_PW, "save_to": "personal"})["result"]
    assert made["id"] == "c ssh" and set(entries(db)) >= {"Lab/a ssh", "Ops/b ssh", "c ssh"}
    err = s.call("vault.create_item", {"name": "d ssh", "password": NEW_PW, "save_to": {"group": "Nope"}})["error"]
    assert err["code"] == 64 and "save_to.group" in err["message"]
    # a Bitwarden collection means nothing to KeePassXC, and the reverse
    err = s.call("vault.create_item", {"name": "e ssh", "password": NEW_PW, "save_to": TEAM})["error"]
    assert err["code"] == 64 and "KeePassXC" in err["message"]
