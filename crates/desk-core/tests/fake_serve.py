"""Stand-in for `roster serve` in desk-core's tests. JSON-RPC 2.0, one object per line.

The first argument picks a behaviour:
  ok                 answers inventory.info / hosts.list / host.get / session.prepare like roster api 1
  old-api            inventory.info reports api_version 0
  no-inventory       every method returns error code 1, like serve without a roster.yml
  unknown-command    exits 2 at once with argparse's "invalid choice: 'serve'" (a roster from before serve)
  reverse            holds two requests, then answers them in reverse order
  die-on-hosts       exits without answering hosts.list
  locked             session.prepare for a password Host refuses with 14 (vault locked)
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


def answer(req):
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
    if m == "session.prepare":
        name = req.get("params", {}).get("host")
        h = next((h for h in HOSTS if h["name"] == name), None)
        if h is None:
            return {"error": {"code": 2, "message": f"unknown host {name!r}"}}
        if not h["reviewed"]:
            return {"error": {"code": 20, "message": f"{name} is not reviewed yet (reviewed: false in roster.yml) - not logging in"}}
        if h.get("password"):
            if mode == "locked":
                return {"error": {"code": 14, "message": "Bitwarden vault is locked - unlock it first"}}
            global minted
            minted += 1
            return {"result": {
                "argv": ["/usr/bin/ssh", "-o", "NumberOfPasswordPrompts=1",
                         "-o", "PreferredAuthentications=password,keyboard-interactive", name],
                "env": {"SSH_ASKPASS": "/run/user/1000/roster-askpass-x1/askpass", "SSH_ASKPASS_REQUIRE": "force",
                        "ROSTER_ASKPASS_SOCKET": "/run/user/1000/roster-askpass-x1/sock",
                        "ROSTER_ASKPASS_TOKEN": f"{TOKEN}{minted}"},
                "host": name, "auth": "password"}}
        return {"result": {"argv": ["/usr/bin/ssh", "-o", "BatchMode=yes", name], "env": {}, "host": name,
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
        print(json.dumps({"jsonrpc": "2.0", "id": r["id"], **answer(r)}), flush=True)
