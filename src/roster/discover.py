"""Network discovery with nmap (or a built-in scanner) feeding roster.yml."""

import concurrent.futures as cf
import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess
from pathlib import Path

import yaml

from .common import die, oneline, say, tcp_ok
from .config import find_config, load_config

# ---------------------------------------------------------------- discover (network scan)

DEFAULT_SCAN_PORTS = ("21,22,23,25,53,80,111,135,139,389,443,445,515,631,830,873,1433,1521,2049,2222,"
                      "2375,2376,3000,3306,3389,5000,5432,5601,5900,5985,5986,6379,6443,8000,8006,8080,"
                      "8081,8443,8888,9000,9090,9100,9200,9443,10000,11211,27017")
NETWORK_HINTS = ("cisco", "juniper", "junos", "arista", "ubiquiti", "unifi", "edgeos", "mikrotik", "routeros",
                 "aruba", "fortinet", "fortigate", "pfsense", "opnsense", "netgear", "tp-link", "procurve",
                 "extreme networks", "palo alto", "pan-os", "sonicwall", "meraki", "brocade", "dell emc networking",
                 "vyos", "openwrt", "cumulus", "mellanox", "huawei", "zyxel", "draytek", "watchguard")
BMC_HINTS = ("idrac", "ilo ", "integrated lights-out", "supermicro", "ipmi", "megarac", "bmc", "xclarity")
DB_SERVICES = {"postgresql", "mysql", "ms-sql-s", "oracle-tns", "mongodb", "mongod", "redis", "memcache",
               "elasticsearch", "cassandra", "couchdb"}
WEB_ORDER = ((443, "https"), (8443, "https"), (9443, "https"), (80, "http"), (8080, "http"), (8000, "http"),
             (3000, "http"), (5000, "http"), (8006, "https"), (9090, "http"), (10000, "https"))


def nmap_scan(targets, args):
    cmd = ["nmap", "-oX", "-", "-T4", "--open", "-sV", "--version-light", "--script", "http-title"]
    cmd += ["--top-ports", str(args.top_ports)] if args.top_ports else ["-p", args.ports]
    if args.no_ping:
        cmd.append("-Pn")
    if args.os:
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            cmd.append("-O")
        else:
            say("note         --os needs root (sudo); skipping OS detection")
    cmd += targets
    say(f"nmap         {' '.join(cmd)}")
    say("             (this can take a few minutes on a big network)")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        die(f"nmap failed: {(r.stderr or r.stdout).strip()[:400]}")
    return parse_nmap_xml(r.stdout)


def parse_nmap_xml(text):
    """nmap -oX output -> [{ip, hostname, mac, vendor, os, ports: [{port, name, product, title, ssl}]}]"""
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        die(f"couldn't read nmap's output: {e}")
    found = []
    for host in root.findall("host"):
        status = host.find("status")
        if status is None or status.get("state") != "up":
            continue
        rec = {"ip": "", "hostname": "", "mac": "", "vendor": "", "os": "", "ports": []}
        for a in host.findall("address"):
            if a.get("addrtype") in ("ipv4", "ipv6"):
                rec["ip"] = a.get("addr", "")
            elif a.get("addrtype") == "mac":
                rec["mac"], rec["vendor"] = a.get("addr", ""), a.get("vendor", "")
        hn = host.find("hostnames/hostname")
        rec["hostname"] = hn.get("name", "") if hn is not None else ""
        ostypes = []
        for p in host.findall("ports/port"):
            st = p.find("state")
            if st is None or st.get("state") != "open" or p.get("protocol") != "tcp":
                continue
            sv = p.find("service")
            sv = sv.attrib if sv is not None else {}
            title = ""
            for sc in p.findall("script"):
                out = (sc.get("output") or "").strip()
                if sc.get("id") == "http-title" and not out.startswith(("Site doesn't have a title",
                                                                         "Did not follow redirect")):
                    title = out.splitlines()[0][:80] if out else ""
            if sv.get("ostype"):
                ostypes.append(sv["ostype"])
            product = " ".join(x for x in (sv.get("product"), sv.get("version"),
                                           f"({sv['extrainfo']})" if sv.get("extrainfo") else "") if x)
            rec["ports"].append({"port": int(p.get("portid")), "name": sv.get("name", "") or "unknown",
                                 "product": product, "title": title,
                                 "ssl": sv.get("tunnel") == "ssl" or sv.get("name") in ("https", "ssl")})
        osm = host.find("os/osmatch")
        rec["os"] = osm.get("name", "") if osm is not None else (ostypes[0] if ostypes else "")
        if rec["ip"]:
            found.append(rec)
    return found


def builtin_scan(targets, args):
    """No nmap: plain TCP connect scan, plus SSH banners and reverse DNS."""
    nets = [ipaddress.ip_network(t, strict=False) for t in targets]
    ips = [str(ip) for n in nets for ip in (n.hosts() if n.num_addresses > 2 else n)]
    ports = [int(p) for p in args.ports.split(",") if p.strip()]
    say(f"scanning     {len(ips)} addresses x {len(ports)} ports with the built-in scanner "
        "(install nmap for service versions and web page titles)")
    open_ports = {}
    with cf.ThreadPoolExecutor(256) as ex:
        pairs = [(ip, p) for ip in ips for p in ports]
        for (ip, p), ok in zip(pairs, ex.map(lambda t: tcp_ok(t[0], t[1], timeout=args.timeout), pairs), strict=False):
            if ok:
                open_ports.setdefault(ip, []).append(p)

    def describe(ip):
        rec = {"ip": ip, "hostname": "", "mac": "", "vendor": "", "os": "", "ports": []}
        try:
            rec["hostname"] = socket.gethostbyaddr(ip)[0]
        except OSError:
            pass
        for p in sorted(open_ports[ip]):
            try:
                name = socket.getservbyport(p, "tcp")
            except OSError:
                name = "unknown"
            product = ""
            if p in (22, 2222) or name == "ssh":
                try:
                    with socket.create_connection((ip, p), timeout=2) as s:
                        banner = s.recv(200).decode(errors="replace").strip()
                    if banner.startswith("SSH-"):
                        name, product = "ssh", banner.split("-", 2)[-1].replace("_", " ")
                except OSError:
                    pass
            rec["ports"].append({"port": p, "name": name, "product": product, "title": "",
                                 "ssl": p in (443, 8443, 9443, 8006, 10000)})
        return rec

    with cf.ThreadPoolExecutor(64) as ex:
        return list(ex.map(describe, sorted(open_ports, key=ipaddress.ip_address)))


def guess_identity(rec):
    """Best guess at what a scanned box is. Always reviewed by a human before use."""
    names = {p["name"] for p in rec["ports"]}
    nums = {p["port"] for p in rec["ports"]}
    text = " ".join([rec["vendor"], rec["os"], rec["hostname"]]
                    + [p["product"] + " " + p["title"] for p in rec["ports"]]).lower()
    ssh = next((p for p in rec["ports"] if p["name"] == "ssh" and p["port"] == 22), None) \
        or next((p for p in rec["ports"] if p["name"] == "ssh"), None)
    if any(h in text for h in BMC_HINTS):
        kind = "bmc"
    elif any(h in text for h in NETWORK_HINTS) or ("telnet" in names and not ssh) or 830 in nums:
        kind = "network"
    elif "microsoft" in text or "windows" in text or (nums & {3389, 5985, 5986} and not ssh):
        kind = "windows"
    elif names & DB_SERVICES:
        kind = "db"
    elif ssh:
        kind = "server"
    elif names & {"http", "https", "http-proxy", "https-alt", "http-alt"} or nums & {80, 443, 8080, 8443}:
        kind = "appliance"
    else:
        kind = "unknown"
    return kind, ssh


def scan_entry(rec, taken, today):
    kind, ssh = guess_identity(rec)
    base = re.sub(r"[^a-z0-9-]+", "-", rec["hostname"].split(".")[0].lower()).strip("-")
    base = base or f"{kind}-{rec['ip'].replace('.', '-').replace(':', '-')}"
    name, n = base, 2
    while name in taken:
        name, n = f"{base}-{n}", n + 1
    taken.add(name)

    page_title = next((p["title"] for p in rec["ports"] if p["title"]), "")
    entry = {"ip": rec["ip"], "title": page_title, "type": kind}   # web page title is a good first guess
    if ssh and ssh["port"] != 22:
        entry["port"] = ssh["port"]
    # Only plain servers get a key installed by default; switches, BMCs and Windows log in by password.
    entry["enroll"] = bool(ssh) and kind in ("server", "db")
    ports = {p["port"]: p for p in rec["ports"]}
    web = next((f"{'https' if ports[p]['ssl'] or s == 'https' else 'http'}://{rec['ip']}"
                f"{'' if p in (80, 443) else f':{p}'}" for p, s in WEB_ORDER if p in ports), None)
    if web:
        entry["web"] = web
    services = {}
    for p in rec["ports"]:
        if ssh and p["port"] == ssh["port"]:
            continue
        key = re.sub(r"[^a-z0-9_-]", "-", p["name"].lower()) or "port"
        services[key if key not in services else f"{key}-{p['port']}"] = p["port"]
    if services:
        entry["services"] = services

    seen = [f"scan {today}"]
    if rec["os"]:
        seen.append(rec["os"])
    if rec["vendor"]:
        seen.append(f"hw: {rec['vendor']}")
    for p in rec["ports"]:
        bit = f"{p['port']}/{p['name']}" + (f" {p['product']}" if p["product"] else "") \
              + (f" \"{p['title']}\"" if p["title"] else "")
        seen.append(bit)
    entry["description"] = oneline("; ".join(seen))[:400]
    if rec["mac"]:
        entry["mac"] = rec["mac"]
    return name, entry


def yaml_scalar(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    return json.dumps(str(v))          # a JSON string is a valid YAML double-quoted string


def render_group(group, entries, note, needs_user, indent):
    i1, i2, i3, i4 = (" " * (indent * k) for k in (1, 2, 3, 4))
    out = [f"{i1}{group}:",
           f"{i2}title: {yaml_scalar(note)}",
           f"{i2}reviewed: false        # setup ignores these hosts until this says true",
           f"{i2}auth: prompt"]
    if needs_user:
        out.append(f"{i2}user: CHANGE-ME         # login user for these hosts (or set it per host)")
    out.append(f"{i2}hosts:")
    for name, e in entries:
        out.append(f"{i3}{name}:")
        for k, v in e.items():
            if k == "services":
                v = "{ " + ", ".join(f"{sk}: {sv}" for sk, sv in v.items()) + " }"
                out.append(f"{i4}{k}: {v}")
            else:
                hint = "   # guessed - fix if wrong" if k == "type" else ""
                out.append(f"{i4}{k}: {yaml_scalar(v)}{hint}")
    return out


def cmd_discover(args):
    import datetime
    targets = args.targets
    total = 0
    for t in targets:
        try:
            total += ipaddress.ip_network(t, strict=False).num_addresses
        except ValueError:
            die(f"{t!r} isn't an IP address or network (e.g. 10.0.1.0/24)")
    if total > 4096 and not args.force:
        die(f"that's {total} addresses; narrow it down or pass --force")

    cfg_path, cfg = None, None
    if args.config and not Path(args.config).expanduser().exists():
        cfg_path = Path(args.config).expanduser()          # --write will create it
    else:
        try:
            cfg_path = find_config(args.config)
            cfg = load_config(cfg_path)
        except SystemExit:
            if args.config:
                raise
    known_ips = {h["ip"] for h in cfg["hosts"].values()} if cfg else set()
    taken = set(cfg["hosts"]) if cfg else set()

    use_nmap = not args.builtin and shutil.which("nmap") is not None
    if not use_nmap and not args.builtin:
        say("note         nmap isn't installed - using the built-in scanner. For service versions,")
        say("             web page titles and hardware vendors: apt install nmap / brew install nmap")
    found = nmap_scan(targets, args) if use_nmap else builtin_scan(targets, args)

    quiet = [r for r in found if not r["ports"]]
    found = [r for r in found if r["ports"]]
    already = [r for r in found if r["ip"] in known_ips]
    new = [r for r in found if r["ip"] not in known_ips]
    new.sort(key=lambda r: ipaddress.ip_address(r["ip"]))
    today = datetime.date.today().isoformat()
    entries = [scan_entry(r, taken, today) for r in new]
    say(f"\nfound        {len(found)} hosts with open ports: {len(new)} new, {len(already)} already in roster.yml"
        + (f" ({len(quiet)} more answered but had none of the scanned ports open)" if quiet else ""))
    if not entries:
        return 0
    kinds = {}
    for _, e in entries:
        kinds[e["type"]] = kinds.get(e["type"], 0) + 1
    say("guessed      " + ", ".join(f"{k} {v}" for k, v in sorted(kinds.items())))

    group = args.group or f"discovered-{today.replace('-', '')}"
    existing_groups = set(cfg["groups"]) if cfg else set()
    base, n = group, 2
    while group in existing_groups:
        group, n = f"{base}-{n}", n + 1
    note = f"Found by scanning {', '.join(targets)} on {today} - rename, fill in titles, then set reviewed: true"
    needs_user = not _defaults_user(cfg_path)   # the new group inherits only from defaults

    if not args.write:
        say("\n# preview - nothing written. Re-run with --write to add this to roster.yml:\ngroups:")
        say("\n".join(render_group(group, entries, note, needs_user, 2)))
        return 0
    write_discovered(cfg_path, group, entries, note, needs_user, today)
    return 0


def _defaults_user(cfg_path):
    if not cfg_path or not Path(cfg_path).exists():
        return None
    raw = yaml.safe_load(Path(cfg_path).read_text()) or {}
    return (raw.get("defaults") or {}).get("user")


def write_discovered(cfg_path, group, entries, note, needs_user, today):
    path = Path(cfg_path or "roster.yml").expanduser()
    if path.exists():
        text = path.read_text()
    else:
        text = (f"# roster.yml - started by `roster discover` on {today}. NO PASSWORDS IN THIS FILE.\n"
                "# Every option, with comments:  roster -c example.yml init\n\n"
                "box_name: \"\"\nkey_path: ~/.ssh/roster_ed25519\n\n"
                "defaults:\n  auth: prompt\n\ngroups:\n")
    m = re.search(r"(?m)^groups:[ \t]*(#.*)?$", text)
    if not m:
        if re.search(r"(?m)^groups:", text):
            die("roster.yml has `groups:` written inline (e.g. groups: {}); switch it to block style first")
        text = text.rstrip("\n") + "\n\ngroups:\n"
        m = re.search(r"(?m)^groups:[ \t]*(#.*)?$", text)
    after = text[m.end():]
    child = re.search(r"(?m)^( +)\S", after)
    indent = len(child.group(1)) if child and not after[:child.start()].strip(" \t\n#") else 2
    block = "\n".join(render_group(group, entries, note, needs_user, indent)) + "\n"
    insert_at = m.end() + 1 if text[m.end():m.end() + 1] == "\n" else m.end()
    new_text = text[:insert_at] + ("" if text[insert_at - 1:insert_at] == "\n" else "\n") + block + text[insert_at:]

    tmp = path.with_name(path.name + ".new")
    tmp.write_text(new_text)
    try:
        load_config(tmp)                          # refuse to write a file roster can't read back
    except SystemExit as e:
        tmp.unlink()
        die(f"the merged roster.yml didn't validate, nothing written ({e})")
    if path.exists():
        backup = path.with_name(path.name + ".bak")
        backup.write_text(text)
        say(f"backup       {backup}")
    tmp.replace(path)
    say(f"wrote        {len(entries)} hosts into group '{group}' in {path}")
    say(f"next         open {path.name}: rename hosts (e.g. orion-dev-01), add titles/descriptions,")
    say("             set the login user, move hosts into the right groups if you like,")
    say(f"             then set `reviewed: true` and run:  roster setup --only {group}")
