"""Editing one Host in roster.yml as text (ticket 10), so comments, order, quoting and every other entry stay
byte-for-byte, the way `discover --write` adds a group. PyYAML's node marks say where each value sits in the
text; only those spans change. A result that doesn't load, that loads to anything but the values asked for, or
that changes any other Host, group or resource is refused, and nothing is written."""

import json
import os
import re
import shutil
import tempfile
from pathlib import Path

import yaml

from .config import load_config
from .errors import INVALID_EDIT, Problem

TEXT = ("title", "description", "type")
LOGIN_FIELDS = ("ip", "user", "port", "auth")       # an edit to these needs a test login first (decision Q43)
EDITABLE = TEXT + LOGIN_FIELDS
SSH_KEYS = ("user", "port", "auth")                 # can live in the Host's ssh: block


def current(h):
    """The editable fields of a loaded Host, as the edit form shows them."""
    return {"title": h["title"], "description": h["description"], "type": h["type"], "ip": h["ip"],
            "user": h["ssh"]["user"], "port": h["ssh"]["port"], "auth": h["ssh"]["auth"]}


def check_value(field, v):
    """A value from the app for FIELD, or a ValueError saying what's wrong with it."""
    if field not in EDITABLE:
        raise ValueError(f"{field!r} can't be edited here (only {', '.join(EDITABLE)})")
    if field == "port":
        if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= 65535:
            raise ValueError("port must be a number from 1 to 65535")
        return v
    if not isinstance(v, str):
        raise ValueError(f"{field} must be a string")
    if "\n" in v or "\r" in v:
        raise ValueError(f"{field} must be one line")
    v = " ".join(v.split())                 # as roster.yml's loader reads text (oneline)
    if field in ("ip", "user") and (not v or re.search(r"\s", v)):
        raise ValueError(f"{field} can't be empty or contain spaces")
    return v


# ---------------------------------------------------------------- rendering a value

def render(v, style=None):
    """V as YAML text: plain when that reads back as the same string, else double-quoted (JSON is valid YAML).
    STYLE is the replaced value's quoting, kept when it can hold V."""
    if v is None:
        return "null"
    if isinstance(v, int):
        return str(v)
    if style == "'" and "\n" not in v:
        return "'" + v.replace("'", "''") + "'"
    if style != '"' and v and v == v.strip() and not re.match(r"[-?:,\[\]{}#&*!|>'\"%@`]", v) \
            and ": " not in v and " #" not in v and not v.endswith(":") and reads_back(v):
        return v
    return json.dumps(v, ensure_ascii=False)


def reads_back(text):
    try:
        return yaml.safe_load(f"k: {text}\n") == {"k": text}
    except yaml.YAMLError:
        return False


# ---------------------------------------------------------------- finding the Host in the text

def child(mapping, key):
    """(key node, value node) of KEY in a MappingNode, or (None, None)."""
    for k, v in mapping.value:
        if isinstance(k, yaml.ScalarNode) and k.value == key:
            return k, v
    return None, None


def find_host(text, name):
    """(key node, value node) of Host NAME under groups: -> GROUP -> hosts:."""
    root = yaml.compose(text)
    if not isinstance(root, yaml.MappingNode):
        raise refuse("roster.yml isn't a mapping")
    _, groups = child(root, "groups")
    for _, group in (groups.value if isinstance(groups, yaml.MappingNode) else []):
        if not isinstance(group, yaml.MappingNode):
            continue
        _, hosts = child(group, "hosts")
        if isinstance(hosts, yaml.MappingNode):
            k, v = child(hosts, name)
            if k is not None:
                if v.start_mark.index < k.end_mark.index:      # an alias: the value sits at its anchor
                    raise refuse(f"{name} is a YAML alias (*), so editing it would edit another entry too")
                return k, v
    raise refuse(f"can't find {name} under groups: in roster.yml")


def refuse(why, details=None):
    return Problem(INVALID_EDIT, f"can't make that edit: {why} - nothing was written",
                   fix="edit roster.yml by hand, or undo the hand edit that confused it", details=details)


# ---------------------------------------------------------------- the edits, as spans of text

class Text:
    """The file's text plus edits as (start, end, replacement), applied right to left."""

    def __init__(self, text):
        self.text, self.edits = text, []
        self.nl = "\r\n" if "\r\n" in text else "\n"

    def replace(self, start, end, new):
        self.edits.append((start, end, len(self.edits), new))

    def result(self):
        out = self.text
        for start, end, _, new in sorted(self.edits, reverse=True):     # same place: in the order they came
            out = out[:start] + new + out[end:]
        return out

    def line_start(self, i):
        return self.text.rfind("\n", 0, i) + 1

    def line_end(self, i):
        j = self.text.find("\n", i)
        j = len(self.text) if j < 0 else j
        return j - 1 if j > 0 and self.text[j - 1] == "\r" else j


def set_scalar(t, node, value):
    if not isinstance(node, yaml.ScalarNode):
        raise refuse(f"its value at line {node.start_mark.line + 1} isn't a single value")
    new = render(value, node.style if node.style in ("'", '"') else None)
    if node.style in ("|", ">"):            # a block scalar's span ends after its last line break
        new += t.nl
    elif node.start_mark.index == node.end_mark.index:      # `key:` with nothing after it
        new = " " + new
    t.replace(node.start_mark.index, node.end_mark.index, new)


def add_key(t, mapping, key, value):
    """Add KEY: VALUE to a mapping node that doesn't have KEY."""
    line = f"{key}: {render(value)}"
    if mapping.flow_style:
        close = mapping.end_mark.index - 1
        if t.text[close] != "}":
            raise refuse(f"unexpected text at line {mapping.end_mark.line + 1}")
        t.replace(close, close, (", " if mapping.value else "") + line)
        return
    if not mapping.value:
        raise refuse(f"an empty mapping at line {mapping.start_mark.line + 1}")
    first = mapping.value[0][0]
    indent = first.start_mark.column
    if t.text[t.line_start(first.start_mark.index):first.start_mark.index].strip():
        raise refuse(f"the mapping at line {first.start_mark.line + 1} doesn't start on its own line")
    # after the last entry that fits on one line, so new keys follow the ones there; else first
    one_line = [(k, v) for k, v in mapping.value if k.start_mark.line == v.end_mark.line
                and not (isinstance(v, yaml.ScalarNode) and v.style in ("|", ">"))]
    if one_line:
        at = t.line_end(one_line[-1][1].end_mark.index)
        t.replace(at, at, t.nl + " " * indent + line)
    else:
        at = t.line_start(first.start_mark.index)
        t.replace(at, at, " " * indent + line + t.nl)


def remove_key(t, mapping, key):
    """Drop KEY's line from a block mapping, when it has one line to itself. False if it can't."""
    k, v = child(mapping, key)
    if k is None or mapping.flow_style or len(mapping.value) < 2 or k.start_mark.line != v.end_mark.line:
        return False
    start, end = t.line_start(k.start_mark.index), t.line_end(v.end_mark.index)
    if t.text[start:k.start_mark.index].strip() or t.text[v.end_mark.index:end].strip():
        return False                        # something else on the line (a comment stays with its value)
    end = t.text.find("\n", end)
    t.replace(start, len(t.text) if end < 0 else end + 1, "")
    return True


def set_key(t, mapping, key, value):
    _, v = child(mapping, key)
    if v is None:
        add_key(t, mapping, key, value)
    else:
        set_scalar(t, v, value)


def expand_short(t, key, node, fields):
    """`NAME: 10.0.0.1` with more than its address to set: becomes a block mapping, comment kept on the key line."""
    step = 2
    indent = key.start_mark.column + step
    start = node.start_mark.index
    while start > 0 and t.text[start - 1] in " \t":
        start -= 1
    after = t.text[node.end_mark.index:t.line_end(node.end_mark.index)]
    lines = [f"{' ' * indent}{k}: {render(v)}" for k, v in fields.items()]
    t.replace(start, t.line_end(node.end_mark.index), (after.rstrip() if after.strip() else "") + t.nl
              + t.nl.join(lines))


def edit_text(text, name, changes, drop_empty=True):
    """roster.yml's TEXT with Host NAME's fields set to CHANGES ({field: value}). DROP_EMPTY removes a text field's
    line instead of writing "" where it can."""
    try:
        key, node = find_host(text, name)
    except yaml.YAMLError as e:
        raise refuse("roster.yml doesn't parse", str(e)) from None
    t = Text(text)
    if isinstance(node, yaml.ScalarNode):
        if node.value == "" and node.style is None:
            raise refuse(f"{name} has no value in roster.yml")
        if set(changes) <= {"ip"}:
            set_scalar(t, node, changes["ip"])
            return t.result()
        fields = {"ip": changes.get("ip", node.value), **{k: v for k, v in changes.items() if k != "ip"}}
        expand_short(t, key, node, fields)
        return t.result()
    if not isinstance(node, yaml.MappingNode):
        raise refuse(f"{name}'s entry isn't a mapping")
    _, ssh = child(node, "ssh")
    for field, value in changes.items():
        # the Host's ssh: block, if it has one, is where its login lives (unless the Host sets it plainly)
        in_ssh = field in SSH_KEYS and isinstance(ssh, yaml.MappingNode) and \
            (child(ssh, field)[0] is not None or child(node, field)[0] is None)
        target = ssh if in_ssh else node
        if drop_empty and field in TEXT and value == "" and remove_key(t, target, field):
            continue
        set_key(t, target, field, value)
    return t.result()


# ---------------------------------------------------------------- checking and writing

def read_text(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write_text(path, text):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def replace_file(path, text):
    """Write TEXT to PATH all at once (a temporary file beside it, then a rename), keeping PATH's mode."""
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".new", dir=path.parent)
    os.close(fd)
    try:
        write_text(tmp, text)
        shutil.copymode(path, tmp)
        os.replace(tmp, path)
    finally:
        Path(tmp).unlink(missing_ok=True)


def load_text(path, text):
    """load_config of TEXT as if it were PATH (a temporary file beside it). Raises Problem(INVALID_EDIT)."""
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".new", dir=path.parent)
    os.close(fd)
    try:
        write_text(tmp, text)
        return load_config(tmp)
    except SystemExit as e:
        msg = str(e.code).removeprefix("error: ")
        raise refuse("the result wouldn't load", msg.replace(str(Path(tmp).resolve()), path.name)) from None
    finally:
        Path(tmp).unlink(missing_ok=True)


def same_except(before, after, name):
    """Nothing but Host NAME changed between two loaded configs."""
    keep = ("hosts", "groups", "resources", "box", "providers")
    hb = {k: v for k, v in before["hosts"].items() if k != name}
    ha = {k: v for k, v in after["hosts"].items() if k != name}
    return hb == ha and list(before["hosts"]) == list(after["hosts"]) and \
        all(before[k] == after[k] for k in keep if k != "hosts")


def edited(path, name, changes):
    """The new text of PATH with Host NAME edited, checked: it loads, Host NAME has exactly CHANGES, and nothing
    else changed. Returns (old text, new text, the new Host)."""
    text = read_text(path)
    before = load_text(path, text)
    last = None
    for drop_empty in (True, False):
        new_text = edit_text(text, name, changes, drop_empty)
        new = load_text(path, new_text)
        h = new["hosts"].get(name)
        if h is not None and all(current(h)[k] == v for k, v in changes.items()) and same_except(before, new, name):
            return text, new_text, h
        last = h
    got = ", ".join(f"{k} {current(last)[k]!r}" for k in changes if current(last)[k] != changes[k]) if last else ""
    raise refuse(f"the result loads differently than asked ({got or 'other entries changed'})")
