"""Stand-in for `roster serve` in roster-core's tests. JSON-RPC 2.0, one object per line.

The first argument picks a behaviour:
  ok                 answers inventory.info / hosts.list / host.get / session.prepare like roster api 1
  old-api            inventory.info reports api_version 0
  unknown-key        session.prepare refuses with 44 until host.trust_key records esxi-02's key (host.scan_key shows it)
  quick              quick.prepare (Quick Connect, ticket 14): FINGERPRINT goes through, any other is 23; a
                     password gets an askpass token in env, and the password itself is never echoed back;
                     save: true (ticket 15) adds held: "q1" and the LocalCommand options
  no-inventory       every method returns error code 1, like serve without a roster.yml
  unknown-command    exits 2 at once with argparse's "invalid choice: 'serve'" (a roster from before serve)
  reverse            holds two requests, then answers them in reverse order
  die-on-hosts       exits without answering hosts.list
  locked             session.prepare for a password Host refuses with 14 (vault locked)
  missing-item       session.prepare for a password Host refuses with 32 (no such vault item), data.near/fix
  notify             before answering inventory.watch, sends an inventory.changed notification
  bad-prepare        session.prepare for a password Host answers a numeric askpass token (a malformed result)
Arguments after it are echoed back by inventory.info as `argv`, so tests can see what was passed.
"""
import json
import sys

mode = sys.argv[1] if len(sys.argv) > 1 else "ok"
if mode == "unknown-command":
    print("usage: roster [-h] [--version] [-c CONFIG] {init,setup,hosts} ...", file=sys.stderr)
    print("roster: error: argument cmd: invalid choice: 'serve' (choose from init, setup, hosts)", file=sys.stderr)
    sys.exit(2)

HOSTS = [
    {"name": "esxi-02", "ip": "10.19.77.10", "group": "lab", "type": "esxi", "product": "", "title": "ESXi lab",
     "reviewed": True},
    {"name": "scan-1", "ip": "10.19.77.99", "group": "lab", "type": "linux", "product": "", "title": "",
     "reviewed": False},
    {"name": "sw-core", "ip": "10.19.1.2", "group": "lab", "type": "switch", "product": "", "title": "",
     "reviewed": True, "password": True},
]

# A password Session's token: a new one per session.prepare, like roster's (tests check it never
# shows up in Debug or errors, and that every open asks for a fresh one).
TOKEN = "tok-3b1f9e2a7c-"
minted = 0
FINGERPRINT = "SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8"
trusted = mode != "unknown-key"


def answer(req):
    global minted, trusted
    m = req["method"]
    if mode == "no-inventory":
        return {"error": {"code": 1, "message": "no roster.yml found here or in ~/.config/roster/",
                          "data": {"path": None, "roster_version": "0.1.0", "api_version": 1}}}
    if m == "inventory.info":
        return {"result": {"path": "/home/u/infra/roster.yml", "box": "box1", "host_count": len(HOSTS),
                           "providers": ["bw"], "roster_version": "0.1.0",
                           "api_version": 0 if mode == "old-api" else 1, "argv": sys.argv[2:]}}
    if m == "hosts.list":
        if mode == "die-on-hosts":
            sys.exit(5)
        return {"result": {"hosts": HOSTS, "groups": {"lab": {"title": "Lab", "description": ""}}}}
    if m == "host.get":
        for h in HOSTS:
            if h["name"] == req.get("params", {}).get("name"):
                return {"result": h}
        return {"error": {"code": 2, "message": f"unknown host {req['params'].get('name')!r}"}}
    if m == "host.scan_key":
        return {"result": {"host": "esxi-02", "address": "10.19.77.10", "port": 22, "key_type": "ssh-ed25519",
                           "fingerprint": FINGERPRINT, "recorded": "match" if trusted else "none"}}
    if m == "host.trust_key":
        if req["params"].get("fingerprint") != FINGERPRINT:
            return {"error": {"code": 23, "message": "esxi-02's host key changed while roster was asking - nothing was recorded"}}
        was, trusted = trusted, True
        return {"result": {"host": "esxi-02", "address": "10.19.77.10", "port": 22, "key_type": "ssh-ed25519",
                           "fingerprint": FINGERPRINT, "recorded": not was}}
    if m == "quick.prepare":
        p = req.get("params", {})
        label = f"{p.get('user')}@{p.get('address')}:{p.get('port')}"
        if p.get("fingerprint") != FINGERPRINT:
            return {"error": {"code": 23, "message": f"{label}'s host key changed while roster was asking - not connecting",
                              "data": {"asked": p.get("fingerprint"), "offered": FINGERPRINT}}}
        base = ["/usr/bin/ssh", "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlias=roster-quick-q1"]
        common = {"host": label, "quick": "q1", "user": p.get("user"), "address": p.get("address"),
                  "port": p.get("port"), "key_type": "ssh-ed25519", "fingerprint": FINGERPRINT}
        tail = ["-p", str(p.get("port")), "-l", p.get("user"), "--", p.get("address")]
        if "password" not in p:
            return {"result": {"argv": [*base, "-o", "BatchMode=yes", *tail], "env": {}, "auth": "key", **common}}
        minted += 1
        held = {"held": "q1"} if p.get("save") is True else {}
        local = ["-o", "PermitLocalCommand=yes", "-o", "LocalCommand=/run/user/1000/roster-askpass-x1/logged-in"] if held else []
        return {"result": {"argv": [*base, "-o", "NumberOfPasswordPrompts=1", *local, *tail], "auth": "password", **common, **held,
                           "env": {"SSH_ASKPASS": "/run/user/1000/roster-askpass-x1/askpass",
                                   "SSH_ASKPASS_REQUIRE": "force",
                                   "ROSTER_ASKPASS_SOCKET": "/run/user/1000/roster-askpass-x1/sock",
                                   "ROSTER_ASKPASS_TOKEN": f"{TOKEN}{minted}"}}}
    if m == "session.prepare":
        name = req.get("params", {}).get("host")
        h = next((h for h in HOSTS if h["name"] == name), None)
        if h is None:
            return {"error": {"code": 2, "message": f"unknown host {name!r}"}}
        if not h["reviewed"]:
            return {"error": {"code": 20, "message": f"{name} is not reviewed yet (reviewed: false in roster.yml) - not logging in"}}
        if not trusted:
            return {"error": {"code": 44, "message": f"roster hasn't seen {name}'s host key before",
                              "data": {"address": h["ip"], "port": 22}}}
        if h.get("password"):
            if mode == "locked":
                return {"error": {"code": 14, "message": "Bitwarden vault is locked - unlock it first"}}
            if mode == "missing-item":
                return {"error": {"code": 32, "message": f"no vault item named '{name} shh' (ssh Login of {name})",
                                  "data": {"near": [f"{name} ssh"], "fix": "fix the name in auth:"}}}
            if mode == "bad-prepare":
                return {"result": {"argv": ["/usr/bin/ssh", name], "host": name, "auth": "password",
                                   "env": {"SSH_ASKPASS_REQUIRE": "force", "ROSTER_ASKPASS_TOKEN": 987654321}}}
            minted += 1
            return {"result": {
                "argv": ["/usr/bin/ssh", "-o", "StrictHostKeyChecking=yes", "-o", "NumberOfPasswordPrompts=1",
                         "-o", "PreferredAuthentications=password,keyboard-interactive", name],
                "env": {"SSH_ASKPASS": "/run/user/1000/roster-askpass-x1/askpass", "SSH_ASKPASS_REQUIRE": "force",
                        "ROSTER_ASKPASS_SOCKET": "/run/user/1000/roster-askpass-x1/sock",
                        "ROSTER_ASKPASS_TOKEN": f"{TOKEN}{minted}"},
                "host": name, "auth": "password"}}
        return {"result": {"argv": ["/usr/bin/ssh", "-o", "StrictHostKeyChecking=yes", "-o", "BatchMode=yes", name],
                           "env": {}, "host": name,
                           "auth": "key"}}
    return {"error": {"code": -32601, "message": f"unknown method {m!r}"}}


held = []
for line in sys.stdin:
    req = json.loads(line)
    if mode == "reverse":
        held.append(req)
        if len(held) < 2:
            continue
        reqs, held = list(reversed(held)), []
    else:
        reqs = [req]
    for r in reqs:
        if mode == "notify" and r["method"] == "inventory.watch":
            print(json.dumps({"jsonrpc": "2.0", "method": "inventory.changed", "params": {"applied": True}}), flush=True)
            print(json.dumps({"jsonrpc": "2.0", "id": r["id"], "result": {"watching": True}}), flush=True)
            continue
        print(json.dumps({"jsonrpc": "2.0", "id": r["id"], **answer(r)}), flush=True)
