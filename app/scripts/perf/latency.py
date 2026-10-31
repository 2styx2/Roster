"""The `latency` Session of the stand-in `roster serve` (serve.py --latency): measures the terminal path from
inside the Session, so no devtools or window automation is needed (docs/app/dev/linux.md, ticket 20).

Each measurement ends with a cursor-position request (CSI 6 n). xterm.js answers it only after it has parsed
everything printed before it, so the time from the first byte written to the answer read back is the whole
trip: PTY, the core, the IPC channel, xterm's parser, and back. (Drawing happens on the next frame after
that; the answer doesn't wait for it.)

    python3 latency.py OUT_DIR [--paste-kb N]   what the Session runs: the measurements, then a JSON file
                                                 latency-<time>.json in OUT_DIR and a summary on screen
    python3 latency.py --paste-text N           prints the N KB the paste check expects (linux-run.sh puts
                                                 it on the clipboard)
    python3 latency.py --report FILE            a results file as table rows for docs/app/performance.md

Measurements: idle round trip (a keystroke's echo minus drawing), a 2 MB coloured log (parse throughput),
an htop-like full-screen redraw (per frame and frames a second at this window's size), and a large paste
(Ctrl+Shift+V: the app's clipboard, bracketed paste, the PTY): time from first to last byte, and whether
every byte arrived.
"""
import fcntl
import json
import os
import select
import struct
import sys
import termios
import time
import tty

IN = sys.stdin.fileno()
OUT = sys.stdout.buffer


def paste_text(kb):
    """N KB of numbered lines, the same every time, so the Session can check what it got."""
    lines, size, n = [], 0, 0
    while size < kb * 1024:
        n += 1
        line = f"{n:07d} the quick brown fox jumps over the lazy dog 0123456789 {'x' * (n % 23)}\n"
        lines.append(line)
        size += len(line)
    return "".join(lines)


def write(b):
    OUT.write(b)
    OUT.flush()


_pending = b""


def read_until(end, timeout):
    """Bytes from the terminal up to and including `end` (what came after it is kept for the next read),
    or None after `timeout` seconds."""
    global _pending
    buf, _pending = _pending, b""
    deadline = time.monotonic() + timeout
    while end not in buf:
        left = deadline - time.monotonic()
        if left <= 0 or not select.select([IN], [], [], left)[0]:
            _pending = buf
            return None
        chunk = os.read(IN, 65536)
        if not chunk:
            return None
        buf += chunk
    i = buf.index(end) + len(end)
    buf, _pending = buf[:i], buf[i:]
    return buf


def round_trip(payload=b""):
    """ms from writing `payload` + CSI 6 n to reading the terminal's answer (CSI row ; col R)."""
    t0 = time.perf_counter()
    write(payload + b"\x1b[6n")
    if read_until(b"R", 10) is None:
        return None
    return (time.perf_counter() - t0) * 1000


def stats(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None

    def pick(q):
        return round(xs[min(len(xs) - 1, int(q * len(xs)))], 2)

    return {"n": len(xs), "p50": pick(0.5), "p95": pick(0.95), "max": round(xs[-1], 2)}


def size():
    rows, cols, _, _ = struct.unpack("HHHH", fcntl.ioctl(1, termios.TIOCGWINSZ, b"\0" * 8))
    return rows or 24, cols or 80


def idle():
    times = []
    for _ in range(50):
        times.append(round_trip())
        time.sleep(0.02)
    return stats(times)


def log(total=2 * 1024 * 1024):
    line = (b"\x1b[2m%08d\x1b[0m \x1b[32mINFO\x1b[0m worker-07 handled request in 12 ms "
            b"path=/api/v1/items/42 status=200 bytes=5120\r\n")
    block, n = [], 0
    while sum(map(len, block)) < 64 * 1024:
        n += 1
        block.append(line % n)
    block = b"".join(block)
    t0 = time.perf_counter()
    sent = 0
    while sent < total:
        write(block)
        sent += len(block)
    if round_trip() is None:
        return None
    ms = (time.perf_counter() - t0) * 1000
    return {"bytes": sent, "ms": round(ms, 1), "mb_per_s": round(sent / 1024 / 1024 / (ms / 1000), 1)}


def redraw(frames=200):
    """An htop-like screen: every row rewritten each frame, bars and numbers in colour."""
    rows, cols = size()
    times = []
    t0 = time.perf_counter()
    for f in range(frames):
        out = [b"\x1b[H"]
        for r in range(rows - 1):
            pct = (r * 7 + f * 3) % 100
            bar = int((cols - 30) * pct / 100)
            head = b"\x1b[1;36m%3d\x1b[0m [\x1b[32m" % r
            out.append(head + b"|" * bar + b"\x1b[0m" + b" " * max(0, cols - 30 - bar)
                       + b"] \x1b[33m%5.1f%%\x1b[0m pid %6d\x1b[K\r\n" % (pct, 1000 + r * 13 + f))
        times.append(round_trip(b"".join(out)))
    secs = time.perf_counter() - t0
    return {"rows": rows, "cols": cols, "frame": stats(times), "frames_per_s": round(frames / secs, 1)}


def paste(kb, timeout=180):
    want = paste_text(kb).replace("\n", "\r").encode()
    write(b"\x1b[?2004h\r\n\x1b[1mPaste now\x1b[0m (Ctrl+Shift+V): the clipboard should hold %d KB. "
          b"Waiting %d s.\r\n" % (kb, timeout))
    start = read_until(b"\x1b[200~", timeout)
    if start is None:
        write(b"\x1b[?2004l")
        return None
    t0 = time.perf_counter()
    got = read_until(b"\x1b[201~", 60)
    ms = (time.perf_counter() - t0) * 1000
    write(b"\x1b[?2004l")
    if got is None:
        return {"kb": kb, "complete": False}
    body = got[: -len(b"\x1b[201~")]
    return {"kb": kb, "ms": round(ms, 1), "complete": body == want, "bytes": len(body)}


def report(path):
    """The results as rows in docs/app/performance.md's format."""
    with open(path) as f:
        r = json.load(f)
    rows = []
    if r.get("idle_round_trip_ms"):
        i = r["idle_round_trip_ms"]
        rows.append(("Idle round trip (a keystroke's echo, without drawing) p50 / p95", f"{i['p50']} / {i['p95']} ms"))
    if r.get("log_2mb"):
        lg = r["log_2mb"]
        rows.append(("2 MB coloured log: parsed in, throughput", f"{lg['ms']} ms, {lg['mb_per_s']} MB/s"))
    if r.get("redraw") and r["redraw"].get("frame"):
        rd = r["redraw"]
        rows.append((f"htop-like redraw ({rd['cols']}×{rd['rows']}): per frame p50 / p95",
                     f"{rd['frame']['p50']} / {rd['frame']['p95']} ms"))
        rows.append(("… frames a second (as fast as it goes)", f"{rd['frames_per_s']}"))
    p = r.get("paste")
    if p and "ms" in p:
        rows.append((f"Paste {p['kb']} KB (Ctrl+Shift+V): first to last byte, every byte arrived",
                     f"{p['ms']} ms, {'yes' if p['complete'] else 'NO'}"))
    else:
        rows.append(("Paste", "not done (nothing pasted)" if p is None else "incomplete"))
    rows.append(("Picker open (`:info`'s \"Picker opened in\")", "read it off `:info`"))
    rows.append(("Renderer (`:info`)", "read it off `:info`"))
    print(f"Results of {r['when']} ({os.path.basename(path)}):\n")
    print("| Linux | Now |\n|---|---:|")
    for k, v in rows:
        print(f"| {k} | {v} |")


def main():
    if "--report" in sys.argv:
        report(sys.argv[sys.argv.index("--report") + 1])
        return
    if "--paste-text" in sys.argv:
        sys.stdout.write(paste_text(int(sys.argv[sys.argv.index("--paste-text") + 1])))
        return
    out_dir = sys.argv[1]
    kb = int(sys.argv[sys.argv.index("--paste-kb") + 1]) if "--paste-kb" in sys.argv else 1024
    old = termios.tcgetattr(IN)
    tty.setraw(IN)
    try:
        write(b"\x1b[2J\x1b[Hlatency: idle round trips...\r\n")
        result = {"when": time.strftime("%Y-%m-%dT%H:%M:%S"), "idle_round_trip_ms": idle()}
        result["log_2mb"] = log()
        result["redraw"] = redraw()
        write(b"\x1b[2J\x1b[H")
        result["paste"] = paste(kb)
    finally:
        termios.tcsetattr(IN, termios.TCSADRAIN, old)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"latency-{int(time.time())}.json")
    with open(path, "w") as f:
        json.dump(result, f, indent=2)
    print("\r\n" + json.dumps(result, indent=2).replace("\n", "\r\n"))
    print(f"\r\nSaved to {path}. Close this Session when you're done.\r")
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
