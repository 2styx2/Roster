// The Windows side of app/scripts/perf.sh (docs/app/performance.md). Run by Windows' node, from the
// perf build copy: starts roster-app.exe against the stand-in serve (app/scripts/perf/serve.py) with its
// own State, Config and WebView2 folders, drives it over the DevTools protocol, samples every process it
// started, prints the numbers, and kills what it started (only that: the process tree of the PID it got).
//
//   PERF_ROSTER="python3 /…/serve.py --rate 100" node drive.mjs --exe PATH --scratch DIR --distro NAME
//                  [--port 9338] [--sessions 12] [--seconds 20] [--json]
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") ? "1" : (all[i + 1] ?? "1")]] : [])),
);
const PORT = Number(args.port ?? 9338);
const SESSIONS = Number(args.sessions ?? 12);
const SECONDS = Number(args.seconds ?? 20);
const scratch = args.scratch;
const roster = args.roster ?? process.env.PERF_ROSTER;
if (!args.exe || !scratch || !args.distro || !roster) throw new Error("need --exe, --scratch, --distro and PERF_ROSTER");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("perf:", ...a);

// ---- the app, on its own folders
for (const d of ["appdata", "state", "webview"]) mkdirSync(join(scratch, d), { recursive: true });
const env = {
  ...process.env,
  APPDATA: join(scratch, "appdata"), // the Config (init.lua): none, so the defaults
  ROSTER_APP_STATE_DIR: join(scratch, "state"),
  WEBVIEW2_USER_DATA_FOLDER: join(scratch, "webview"),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
  ROSTER_APP_ROSTER: roster,
  ROSTER_APP_WSL_DISTRO: args.distro,
};
const app = spawn(args.exe, [], { env, detached: true, stdio: "ignore" });
log(`started ${args.exe} (pid ${app.pid})`);
let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  try {
    execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    // already gone
  }
  log(`stopped pid ${app.pid} and its children`);
}
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

// ---- the DevTools protocol, just enough of it
let ws;
let nextId = 1;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((ok, fail) => ((ws.onopen = ok), (ws.onerror = fail)));
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data);
          const p = pending.get(m.id);
          if (!p) return;
          pending.delete(m.id);
          if (m.error) p.fail(new Error(m.error.message));
          else p.ok(m.result);
        };
        return;
      }
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error("the app's DevTools port never answered");
}
const send = (method, params = {}) =>
  new Promise((ok, fail) => {
    const id = nextId++;
    pending.set(id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

async function key(k, code, vk, modifiers = 0, text) {
  await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
}
const char = (c) => key(c, c >= "a" && c <= "z" ? `Key${c.toUpperCase()}` : "", c.toUpperCase().charCodeAt(0), 0, c);
async function leader(...keys) {
  await key(" ", "Space", 32, 2); // Ctrl+Space
  for (const k of keys) await char(k);
}
const enter = () => key("Enter", "Enter", 13, 0, "\r");
const escape = () => key("Escape", "Escape", 27);

// ---- sampling: the app's process tree on Windows, serve and the Sessions' shells in WSL
function windowsSample() {
  const ps = `
$root = ${app.pid}
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine
$tree = @($root); $grew = $true
while ($grew) { $grew = $false; foreach ($p in $all) { if ($tree -contains $p.ParentProcessId -and -not ($tree -contains $p.ProcessId)) { $tree += $p.ProcessId; $grew = $true } } }
$filter = ($tree | ForEach-Object { "IDProcess=$_" }) -join " OR "
$switches = @{}
Get-CimInstance Win32_PerfRawData_PerfProc_Thread -Filter $filter | ForEach-Object { $switches[[int]$_.IDProcess] += [double]$_.ContextSwitchesPersec }
$out = foreach ($id in $tree) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) {
  $cmd = ($all | Where-Object ProcessId -eq $id).CommandLine
  $type = if ($cmd -match '--type=([a-z-]+)') { $Matches[1] } else { "" }
  [pscustomobject]@{ pid = $id; name = $p.ProcessName; type = $type; cpu = $p.TotalProcessorTime.TotalSeconds; ws = $p.WorkingSet64; priv = $p.PrivateMemorySize64; cs = $switches[[int]$id] } } }
@($out) | ConvertTo-Json -Compress`;
  const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  const list = JSON.parse(out || "[]");
  return Array.isArray(list) ? list : [list];
}
// serve and the Sessions' shells (both perf/serve.py) in WSL: CPU in clock ticks (100 a second), RSS.
function wslSample() {
  const sh = 'for p in $(pgrep -f perf/serve.py); do [ -r /proc/$p/stat ] || continue; ' +
    'echo "$p $(cut -d" " -f14,15 /proc/$p/stat) $(awk \'/VmRSS/ {print $2}\' /proc/$p/status) $(tr "\\0" " " < /proc/$p/cmdline)"; done';
  const out = execFileSync("wsl.exe", ["-d", args.distro, "--exec", "sh", "-c", sh], { encoding: "utf8" });
  return out
    .split("\n")
    .filter((l) => /python/.test(l.trim().split(/\s+/)[4] ?? "")) // not this sh, whose script names serve.py too
    .map((l) => {
      const [pid, utime, stime, rss, ...rest] = l.trim().split(/\s+/);
      return { pid: Number(pid), cpu: (Number(utime) + Number(stime)) / 100, rss: Number(rss) * 1024, kind: rest.join(" ").includes("--stream") ? "shell" : "serve" };
    });
}
const group = (p) =>
  p.name === "roster-app"
    ? "roster-app.exe"
    : p.name === "msedgewebview2"
      ? `WebView2 ${p.type || "browser"}`
      : `${p.name}.exe`;
async function measure(seconds, during) {
  const w0 = windowsSample();
  const l0 = wslSample();
  const t0 = Date.now();
  const frames = during ? await during() : (await sleep(seconds * 1000), null);
  const elapsed = (Date.now() - t0) / 1000;
  const w1 = windowsSample();
  const l1 = wslSample();
  const heap = await send("Performance.getMetrics").then((r) => Object.fromEntries(r.metrics.map((m) => [m.name, m.value])));
  const groups = {};
  const add = (g, cpuS, ws, priv, cs, count = 1) => {
    const x = (groups[g] ??= { procs: 0, cpuPct: 0, wsMB: 0, privMB: 0, wakeups: 0 });
    x.procs += count;
    x.cpuPct += (100 * cpuS) / elapsed;
    x.wsMB += ws / 2 ** 20;
    x.privMB += priv / 2 ** 20;
    x.wakeups += cs / elapsed;
  };
  for (const p of w1) {
    const before = w0.find((q) => q.pid === p.pid);
    add(group(p), p.cpu - (before?.cpu ?? 0), p.ws, p.priv, Math.max(0, (p.cs ?? 0) - (before?.cs ?? 0)));
  }
  for (const p of l1) {
    const before = l0.find((q) => q.pid === p.pid);
    add(p.kind === "serve" ? "serve (WSL)" : "shells (WSL)", p.cpu - (before?.cpu ?? 0), p.rss, p.rss, 0);
  }
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  return {
    seconds: Math.round(elapsed),
    groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, round(v)])),
    heapMB: Math.round((heap.JSHeapUsedSize / 2 ** 20) * 10) / 10,
    domNodes: heap.Nodes,
    ...(frames ? { frames } : {}),
  };
}
// Frame intervals in the webview over `ms`: p50, p95, the longest, and how many took over 50 ms.
const frames = (ms) =>
  evaluate(`new Promise((done) => { const t = []; const end = performance.now() + ${ms};
    const f = (now) => { t.push(now); if (now < end) requestAnimationFrame(f); else {
      const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b); const q = (p) => d[Math.min(d.length - 1, Math.floor(p * d.length))] ?? 0;
      done({ p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +(d[d.length - 1] ?? 0).toFixed(1), over50: d.filter((x) => x > 50).length }); } };
    requestAnimationFrame(f); })`);

// The Hosts serve.py makes that open: reviewed Linux ones with a key login.
function hostNames(n) {
  const kinds = ["linux", "linux", "linux", "esxi", "switch", "windows"];
  const names = [];
  for (let i = 0; names.length < n; i++) {
    if (kinds[i % 6] === "linux" && i % 40 !== 0) names.push(`linux-${String(i + 1).padStart(4, "0")}`);
  }
  return names;
}

async function main() {
  await connect();
  await send("Runtime.enable");
  await send("Performance.enable");
  for (let i = 0; i < 120; i++) {
    if (await evaluate(`document.querySelectorAll(".sb-row, [role=treeitem]").length > 0`)) break;
    await sleep(500);
  }
  log("the app is up; settling");
  await sleep(5000);
  const r = {};
  log(`idle, ${SECONDS} s`);
  r.idle = await measure(SECONDS);

  log(`opening ${SESSIONS} Sessions`);
  for (const name of hostNames(SESSIONS)) {
    await leader("f");
    await sleep(300);
    await send("Input.insertText", { text: name });
    await sleep(300);
    await enter();
    await sleep(700);
  }
  await sleep(5000);
  r.open = await evaluate(`document.querySelectorAll(".term-host").length`);
  log(`busy (${r.open} Sessions), ${SECONDS} s`);
  r.busy = await measure(SECONDS, () => frames(SECONDS * 1000));

  log("typing in the Picker");
  await leader("f");
  await sleep(300);
  r.picker = await measure(0, async () => {
    for (const c of "linux-0123") {
      await char(c);
      await sleep(150);
    }
    return frames(1000);
  });
  await escape();
  await sleep(1000);

  log(`Focus mode, ${SECONDS / 2} s`);
  await leader("m");
  await sleep(2000);
  r.focus = await measure(SECONDS / 2, () => frames((SECONDS / 2) * 1000));
  await leader("m");
  await sleep(1000);

  log("closing every Session");
  for (let i = 0; i < r.open; i++) {
    await leader("d", "d");
    await sleep(300);
  }
  await sleep(5000);
  await send("HeapProfiler.collectGarbage");
  await sleep(1000);
  r.left = await evaluate(`document.querySelectorAll(".term-host").length`);
  log(`after closing, ${SECONDS} s`);
  r.after = await measure(SECONDS);
  return r;
}

try {
  const r = await main();
  if (args.json) console.log(JSON.stringify(r, null, 2));
  else print(r);
} finally {
  ws?.close();
  stop();
}

function print(r) {
  const phases = { idle: r.idle, [`busy (${r.open})`]: r.busy, "picker keys": r.picker, focus: r.focus, "after close": r.after };
  for (const [name, m] of Object.entries(phases)) {
    const total = Object.values(m.groups).reduce((a, x) => ({ cpu: a.cpu + x.cpuPct, priv: a.priv + x.privMB, wake: a.wake + x.wakeups }), { cpu: 0, priv: 0, wake: 0 });
    console.log(
      `${name}: total CPU ${total.cpu.toFixed(1)} % of a core, private ${Math.round(total.priv)} MB, ${Math.round(total.wake)} wake-ups/s; ` +
        `JS heap ${m.heapMB} MB, ${m.domNodes} DOM nodes` +
        (m.frames ? `; frames p50 ${m.frames.p50} p95 ${m.frames.p95} max ${m.frames.max} ms (${m.frames.over50} over 50 ms)` : ""),
    );
    for (const [g, x] of Object.entries(m.groups).sort((a, b) => b[1].cpuPct - a[1].cpuPct)) {
      console.log(`  ${g.padEnd(22)} ${String(x.procs).padStart(3)} proc  CPU ${String(x.cpuPct).padStart(6)} %  WS ${String(x.wsMB).padStart(7)} MB  private ${String(x.privMB).padStart(7)} MB  ${String(Math.round(x.wakeups)).padStart(6)} wake-ups/s`);
    }
  }
  console.log(`terminals left after closing: ${r.left}`);
}
