// The browser side of app/scripts/perf.sh (docs/app/performance.md): drives the app's frontend with
// the fake Backend's perf fixture in Chromium and prints what it costs.
//
//   node app/scripts/perf/browser.mjs http://localhost:5181/ [--json]
//
// Phases: idle (no Sessions), busy (12 Sessions printing 100 lines/s each, the 1,284-Host worst case),
// typing in the Picker, typing in a terminal, Focus mode, and closing every Session (what's left after a
// forced GC). For each: main-thread busy % (CDP Performance.TaskDuration), timer and animation-frame
// callbacks a second, React commits and the components that rendered (a devtools hook counts them), and
// the JS heap. Needs `playwright` resolvable (perf.sh puts it on NODE_PATH) and its Chromium.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://localhost:5181/";
const asJson = process.argv.includes("--json");
const SESSIONS = 12;
const RATE = 100;
const WINDOW_MS = 10_000;

// Before the app loads: count timer and frame callbacks, and React's commits and renders.
function instrument() {
  const counts = { timeout: 0, interval: 0, frame: 0 };
  const wrap = (name, key) => {
    const orig = window[name].bind(window);
    window[name] = (fn, ...rest) =>
      orig(typeof fn === "function" ? (...a) => (counts[key]++, fn(...a)) : fn, ...rest);
  };
  wrap("setTimeout", "timeout");
  wrap("setInterval", "interval");
  wrap("requestAnimationFrame", "frame");
  const renders = new Map();
  const react = { commits: 0, renders };
  window.__perf = { counts, react };
  // A minimal React DevTools hook: React calls onCommitFiberRoot after every commit.
  const named = (f) => {
    const t = f.type;
    if (!t) return null;
    return t.displayName || t.name || t.type?.displayName || t.type?.name || t.render?.name || null;
  };
  const COMPONENT = new Set([0, 1, 11, 14, 15]);
  const PERFORMED_WORK = 1;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(r) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, r);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    onCommitFiberRoot(_id, root) {
      react.commits++;
      // Walk only what this commit touched: a subtree React skipped keeps its old child.
      const stack = [root.current.child];
      while (stack.length) {
        const f = stack.pop();
        if (!f) continue;
        const prev = f.alternate;
        if (COMPONENT.has(f.tag) && (prev === null || (f.flags & PERFORMED_WORK) !== 0)) {
          const n = named(f) ?? "(anonymous)";
          renders.set(n, (renders.get(n) ?? 0) + 1);
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child && (prev === null || f.child !== prev.child)) stack.push(f.child);
      }
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"] });
  const results = {};
  try {
    const run = async (sessions) => {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await page.addInitScript(instrument);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
      await page.goto(`${base}?fixture=perf&sessions=${sessions}&rate=${RATE}&toggle=off`);
      await page.waitForSelector(".sidebar, [class*=sidebar]", { timeout: 30_000 });
      if (sessions > 0) await page.waitForFunction((n) => document.querySelectorAll(".term-host").length >= n, sessions);
      await sleep(3000); // let the start settle (fonts, first fits, the login banners)
      return { page, cdp };
    };

    const metrics = async (cdp) => {
      const { metrics } = await cdp.send("Performance.getMetrics");
      return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
    };
    const snapshot = (page) =>
      page.evaluate(() => ({
        counts: { ...window.__perf.counts },
        commits: window.__perf.react.commits,
        renders: Object.fromEntries(window.__perf.react.renders),
      }));
    // What `during` costs over `ms`: busy %, callbacks a second, commits, renders by component.
    const measure = async (page, cdp, ms, during = () => sleep(ms)) => {
      const m0 = await metrics(cdp);
      const s0 = await snapshot(page);
      const t0 = Date.now();
      await during();
      const elapsed = (Date.now() - t0) / 1000;
      const m1 = await metrics(cdp);
      const s1 = await snapshot(page);
      const renders = {};
      for (const [k, v] of Object.entries(s1.renders)) {
        const d = v - (s0.renders[k] ?? 0);
        if (d > 0) renders[k] = d;
      }
      return {
        seconds: +elapsed.toFixed(1),
        busyPct: +((100 * (m1.TaskDuration - m0.TaskDuration)) / elapsed).toFixed(1),
        scriptPct: +((100 * (m1.ScriptDuration - m0.ScriptDuration)) / elapsed).toFixed(1),
        timeoutsPerS: +((s1.counts.timeout - s0.counts.timeout) / elapsed).toFixed(1),
        intervalsPerS: +((s1.counts.interval - s0.counts.interval) / elapsed).toFixed(1),
        framesPerS: +((s1.counts.frame - s0.counts.frame) / elapsed).toFixed(1),
        commits: s1.commits - s0.commits,
        renders,
        heapMB: +(m1.JSHeapUsedSize / 2 ** 20).toFixed(1),
        nodes: m1.Nodes,
      };
    };
    const gcHeap = async (page, cdp) => {
      await cdp.send("HeapProfiler.collectGarbage");
      await sleep(500);
      await cdp.send("HeapProfiler.collectGarbage");
      const m = await metrics(cdp);
      return { heapMB: +(m.JSHeapUsedSize / 2 ** 20).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners };
    };
    const leader = async (page, ...keys) => {
      await page.keyboard.press("Control+Space");
      for (const k of keys) await page.keyboard.press(k);
    };

    // Idle: the worst-case Inventory, no Sessions.
    {
      const { page, cdp } = await run(0);
      results.idle = await measure(page, cdp, WINDOW_MS);
      results.idle.gc = await gcHeap(page, cdp);
      await page.close();
    }

    // Busy: 12 streaming Sessions, the Sidebar showing them.
    const { page, cdp } = await run(SESSIONS);
    const before = await gcHeap(page, cdp);
    results.busy = await measure(page, cdp, WINDOW_MS);
    results.busy.gc = before;

    // Typing in the Picker over 1,284 Hosts (20 keys, 100 ms apart), while the Sessions print.
    await leader(page, "f");
    await page.waitForSelector(".picker[aria-label=\"Find a Host\"]");
    results.picker = await measure(page, cdp, 0, async () => {
      for (const ch of "linux-server-rack-04") await page.keyboard.type(ch, { delay: 100 });
    });
    results.picker.perKey = perKey(results.picker.renders, 20);
    await page.keyboard.press("Escape");
    await sleep(500);

    // Typing in the active terminal (the fake shell echoes each key).
    await page.click(".term-host >> visible=true");
    results.terminalKeys = await measure(page, cdp, 0, async () => {
      for (const ch of "echo hello world 12345") await page.keyboard.type(ch, { delay: 100 });
    });
    results.terminalKeys.perKey = perKey(results.terminalKeys.renders, 22);

    // Focus mode, busy.
    await leader(page, "m");
    await sleep(1500);
    results.focus = await measure(page, cdp, WINDOW_MS);
    await leader(page, "m");
    await sleep(1000);

    // Closing every Session: what stays behind after a GC.
    for (let i = 0; i < SESSIONS; i++) {
      await leader(page, "d", "d");
      await sleep(150);
    }
    await sleep(1500);
    results.closed = await gcHeap(page, cdp);
    results.closed.terminals = await page.evaluate(() => document.querySelectorAll(".term-host").length);
    results.closed.idle = await measure(page, cdp, 5000);
    results.sessionsHeapMB = +((before.heapMB - results.closed.heapMB) / SESSIONS).toFixed(2);
    await page.close();
  } finally {
    await browser.close();
  }
  if (asJson) console.log(JSON.stringify(results, null, 2));
  else print(results);
}

function perKey(renders, keys) {
  return Object.fromEntries(Object.entries(renders).map(([k, v]) => [k, +(v / keys).toFixed(1)]));
}

function top(renders, n = 8) {
  return Object.entries(renders)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
}

function print(r) {
  const row = (name, m) =>
    console.log(
      `${name.padEnd(14)} busy ${String(m.busyPct).padStart(5)} %  script ${String(m.scriptPct).padStart(5)} %  ` +
        `timeouts ${String(m.timeoutsPerS).padStart(6)}/s  intervals ${String(m.intervalsPerS).padStart(6)}/s  ` +
        `frames ${String(m.framesPerS).padStart(5)}/s  commits ${String(m.commits).padStart(4)}  heap ${m.heapMB} MB`,
    );
  row("idle", r.idle);
  row("busy (12)", r.busy);
  row("picker typing", r.picker);
  row("terminal keys", r.terminalKeys);
  row("focus, busy", r.focus);
  row("after close", r.closed.idle);
  console.log(`renders idle:          ${top(r.idle.renders) || "none"}`);
  console.log(`renders busy (10 s):   ${top(r.busy.renders) || "none"}`);
  console.log(`renders per Picker key: ${top(r.picker.perKey) || "none"}`);
  console.log(`renders per terminal key: ${top(r.terminalKeys.perKey) || "none"}`);
  console.log(`renders focus (10 s):  ${top(r.focus.renders) || "none"}`);
  console.log(
    `heap after GC: idle ${r.idle.gc.heapMB} MB, 12 Sessions ${r.busy.gc.heapMB} MB, all closed ${r.closed.heapMB} MB ` +
      `(${r.sessionsHeapMB} MB a Session); terminals left ${r.closed.terminals}; DOM nodes idle ${r.idle.gc.nodes}, ` +
      `busy ${r.busy.gc.nodes}, closed ${r.closed.nodes}`,
  );
}

await main();
