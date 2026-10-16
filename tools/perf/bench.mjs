// PERF BENCH: the game's frame budget, checked like a test (docs/ARCHITECTURE.md, "Performance").
// Starts its own dev server and a headless Chrome on the real GPU (ANGLE / D3D11, no vsync, no frame cap), loads each
// scenario, lets it settle, then reads the in-game profiler (src/core/perf.js) for `--secs` seconds plus
// GPU time (timer queries round G.render). Prints one row per scenario, compares with tools/perf/baseline.json and
// exits 1 when a scenario is over budget (JS, its groups, the p95 frame, the GPU) or a system got clearly slower than
// the baseline. It renders at the dev display's size (3440x1440: the HD pass and the GPU work scale with it).
// Under each row, what the frame asks of WebGL and the heap (core/perf.js counts: draws, uniform calls, texture uploads
// from a canvas / from an array, buffer bytes, the heap's growth a frame) and the GC's pauses (a short trace after the
// measured window: the MinorGC / MajorGC events, ms a second and the longest).
//
//   node tools/perf/bench.mjs                      all scenarios, compare with the baseline
//   node tools/perf/bench.mjs --only night         one scenario (substring match)
//   node tools/perf/bench.mjs --save               ... and write the results as the new baseline
//   options: --secs 6 --port 8139 --res 3440x1440 --no-fail --runs N (median of N fresh loads; --save uses 3)
//            --horde 60   enemies in the horde scenario (what more life costs: how many fit in the frame)
//            --q inst=0   extra URL parameters for every scenario (an A/B of a switch)   --only day,run   several
//            --throttle 3 (the CPU slowed 3x, ~a mid laptop: a look at weaker machines, not the target; checks only
//                          p95 <= 16.7 ms, no baseline compare)   --no-gc (skip the GC trace)
//            env CHROME = path to chrome.exe
//   --path src_ab/   bench another copy of the page (an A/B: the old version of a file in a copied folder)
//
// Run it before committing anything that touches the frame (a feature, the renderer, the host). Headless Chrome on the
// dev machine is ~10-20% faster than a visible window; the budgets in perf.js already account for that.
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {cpus} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch, PYTHON} from '../lib/chrome.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'), BASE = join(ROOT, 'tools', 'perf', 'baseline.json');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; }, flag = k => process.argv.includes('--' + k);
const HORDE = +arg('horde', 60);
const PAGE = arg('path', 'src/').replace(/^\/|\/?$/g, '') + '/', RUNS = Math.max(1, +arg('runs', flag('save') ? 3 : 1)), THROTTLE = +arg('throttle', 1), EXTRA = arg('q', ''), SECS = +arg('secs', 6), PORT = +arg('port', 8139), [W, H] = arg('res', '3440x1440').split('x').map(Number), ONLY = arg('only', '');

// ---- scenarios: a page query + an optional driver (runs in the page once it's ready)
const WALK = `(() => { const R = window.__r3d; let i = 0; window.__drive = setInterval(() => { R.keys.clear(); R.keys.add('wasd'[(i++ >> 4) % 4]); }, 60); })()`;
// the horde: N enemies on rings 3.5-8.3 m round the player, who is made immune (the bench overrides game.js's hook) so
// the fight goes on without hits and hitstops
const SPAWN = `(() => { const R = window.__r3d, C = R.host.feature('combat').core, x = R.host.player.x, y = R.host.player.y; C.immune = () => true;
  for (let i = 0; i < ${HORDE}; i++) { const r = 3.5 + (i % 4) * 1.6, a = i * 2.39996; C.spawnBrute({x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * .7, hp: 1e6, dmg: 0, type: 'brute', name: 'Brute', coins: [0, 0]}); } })()`;
// zoomed out as far as the wheel goes (render/camera.js: half the window's scale): the worst case for the view's cost
const ZOOM_OUT = `(() => { window.__r3d.zoom = .5; })()`;
const SCENARIOS = [
  {name: 'day',         q: 'mode=sandbox',                            note: 'ruins, day: sun shadows, 3D trees'},
  {name: 'night-fires', q: 'mode=sandbox&biome=ember&time=night',     note: 'ember, night: every fire and light'},
  {name: 'walk',        q: 'mode=sandbox', drive: WALK,               note: 'ruins, day, walking a square'},
  {name: 'run',         q: 'mode=run', settle: 9,                     note: 'a run: stage 1 arriving + first wave'},
  {name: 'basic-cloak', q: 'mode=sandbox&set=basic',                  note: 'day without the cloth sim (A/B)'},
  {name: 'storm',       q: 'mode=sandbox&weather=storm&season=summer', note: 'ruins, summer storm: rain, splashes, lightning'},
  {name: 'snow',        q: 'mode=sandbox&weather=snow&season=winter', note: 'ruins, winter: snowfall, bare crowns'},
  {name: 'horde',       q: 'mode=sandbox', drive: SPAWN, whole: true, note: `ruins, day: ${HORDE} enemies round the player`},
  {name: 'zoomed-out',  q: 'mode=sandbox', drive: ZOOM_OUT,             note: 'ruins, day, zoomed all the way out: the most world on screen'},
].filter(s => !ONLY || ONLY.split(',').some(o => s.name.includes(o)));

const sleep = ms => new Promise(r => setTimeout(r, ms));
// a fixed slice of JS work, timed before and after: other sessions rendering, baking or capturing on this machine can
// make every number 2-4x worse, which would read as a regression. The calibration says whether the machine was quiet
const calib = () => { const t = performance.now(); let a = 0; for (let k = 0; k < 2e7; k++) a += Math.sin(k * 1e-3) * Math.sqrt(k); return [performance.now() - t, a]; };
const CAL0 = calib()[0];
// ... and the whole machine's CPU use over a second (other sessions' headless Chrome with software GL can take 10 cores
// without slowing a single-thread calibration much, yet doubles every frame number)
async function cpuBusy(ms = 1500) {
  const snap = () => cpus().reduce((a, c) => { const t = c.times; a.idle += t.idle; a.all += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, {idle: 0, all: 0});
  const a = snap(); await new Promise(r => setTimeout(r, ms)); const b = snap();
  return 1 - (b.idle - a.idle) / Math.max(1, b.all - a.all);
}
const LOAD0 = await cpuBusy();
const server = spawn(PYTHON, [join(ROOT, 'serve.py'), String(PORT)], {stdio: 'ignore'});
// Chrome's throwaway profile goes with it (tools/lib/chrome.mjs, whose next launch also sweeps any that a killed run left
// behind). 'exit' also covers an uncaught error, Ctrl+C goes through quit
const chrome = launch('bench', ['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-precise-memory-info',
  `--window-size=${W},${H}`, '--remote-debugging-port=9342', 'about:blank']);
let stopped = false;
const stop = () => { if (stopped) return; stopped = true; chrome.kill(); try { server.kill(); } catch {} };
const quit = code => { stop(); process.exit(code); };
process.on('exit', stop); process.on('SIGINT', () => quit(130));

let tabs; for (let k = 0; k < 80; k++) { try { tabs = await (await fetch('http://127.0.0.1:9342/json')).json(); if (tabs.find(t => t.type === 'page')) break; } catch {} await sleep(250); }
if (!tabs) { console.error('bench: Chrome did not start (set CHROME=...)'); quit(2); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}, logs = [], trace = {ev: [], done: null};
ws.onmessage = e => { const m = JSON.parse(e.data); if (pend[m.id]) { pend[m.id](m); delete pend[m.id]; } else if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  else if (m.method === 'Tracing.dataCollected') { for (const t of m.params.value) if ((t.name === 'MinorGC' || t.name === 'MajorGC') && t.ph === 'X') trace.ev.push(t); }
  else if (m.method === 'Tracing.tracingComplete') trace.done?.(); };
// the GC's pauses over `secs`: the renderer's MinorGC / MajorGC (devtools.timeline), ms a second, the longest, how many
async function gcPauses(secs) {
  trace.ev.length = 0;
  await send('Tracing.start', {transferMode: 'ReportEvents', traceConfig: {recordMode: 'recordContinuously', includedCategories: ['devtools.timeline', 'v8.gc', 'disabled-by-default-v8.gc']}});
  await sleep(secs * 1000);
  const done = new Promise(r => trace.done = r); await send('Tracing.end'); await done;
  const ms = trace.ev.map(t => t.dur / 1000), sum = ms.reduce((a, v) => a + v, 0);
  return {msPerSec: +(sum / secs).toFixed(2), max: +Math.max(0, ...ms).toFixed(2), perSec: +(ms.length / secs).toFixed(1), major: trace.ev.filter(t => t.name === 'MajorGC').length};
}
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id: i, method, params})); });
const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); return r.result?.exceptionDetails ? {err: r.result.exceptionDetails.text} : r.result?.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {width: W, height: H, deviceScaleFactor: 1, mobile: false});

const GPU = `(() => {   // GPU time of G.render via EXT_disjoint_timer_query_webgl2 (results arrive a few frames late)
  const R = window.__r3d, gl = R.G.renderer.getContext(), X = gl.getExtension('EXT_disjoint_timer_query_webgl2'), g = window.__gpu = {ms: [], pend: []};
  if (!X) return 'none';
  const r0 = R.G.render; R.G.render = function (...a) { const q = gl.createQuery(); gl.beginQuery(X.TIME_ELAPSED_EXT, q); try { return r0.apply(this, a); } finally { gl.endQuery(X.TIME_ELAPSED_EXT); g.pend.push(q);
    while (g.pend.length && gl.getQueryParameter(g.pend[0], gl.QUERY_RESULT_AVAILABLE)) { const q0 = g.pend.shift(); if (!gl.getParameter(X.GPU_DISJOINT_EXT)) g.ms.push(gl.getQueryParameter(q0, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q0); } } };
  return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
})()`;

const results = {};
let gpuName = '';
// RUNS: each scenario is loaded fresh RUNS times and the run with the median JS time is kept. The same code swings
// ~1.5x between runs (CPU boost / thermal state, with EVERY system scaling together), so one run can't make a baseline
for (const sc of SCENARIOS) {
  const runs = [];
  for (let k = 0; k < RUNS; k++) {
    logs.length = 0;
    await send('Page.navigate', {url: `http://localhost:${PORT}/${PAGE}?${sc.q}&bench=1${EXTRA ? '&' + EXTRA : ''}`});
    let ok = false; for (let i = 0; i < 240; i++) { await sleep(250); if (await ev('!!(window.__r3d && window.__r3d.perf)')) { ok = true; break; } }
    if (!ok) { console.error(`bench: ${sc.name} did not load`, logs.slice(-3).join(' | ')); continue; }
    gpuName = await ev(GPU);
    await send('Emulation.setCPUThrottlingRate', {rate: THROTTLE});   // --throttle 3: a laptop-class CPU (the phase-5 exit check)
    if (sc.drive) await ev(sc.drive);
    await sleep((sc.settle ?? 3) * 1000);
    await ev('window.__r3d.perf.reset(); window.__gpu.ms.length = 0; 0');
    await sleep(SECS * 1000);
    const r = await ev(`(() => { const r = window.__r3d.perf.report(), g = window.__gpu.ms.slice().sort((a, b) => a - b);
      r.gpu = g.length ? {p50: +g[g.length >> 1].toFixed(2), p95: +g[Math.floor(g.length * .95)].toFixed(2)} : null; r.draws = window.__r3d.G.stats.calls; return r; })()`);
    if (!flag('no-gc')) r.gc = await gcPauses(3);
    if (logs.length) r.errors = logs.slice(0, 3);
    runs.push(r);
  }
  if (!runs.length) { results[sc.name] = {error: 'load'}; continue; }
  runs.sort((a, b) => a.js.avg - b.js.avg);
  const r = runs[(runs.length - 1) >> 1];
  if (runs.length > 1) r.runs = runs.map(x => x.js.avg);
  results[sc.name] = r;
}

// ---- report
const CAL1 = calib()[0], CAL = Math.max(CAL0, CAL1);
const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')) : null;
const busy = (base?.calib ? CAL > base.calib * 1.35 : false) || LOAD0 > .2, laptop = THROTTLE > 1;
const B = (await ev('window.__r3d?.perf?.BUDGET')) || {};
let fail = 0;
const f = (v, w = 6, d = 2) => (v ?? 0).toFixed(d).padStart(w), mark = (v, b) => v > b ? '!' : ' ';
console.log(`\nGPU: ${gpuName} · ${W}x${H} · ${SECS} s per scenario${laptop ? ` · CPU THROTTLED ${THROTTLE}x (target: p95 <= 16.7 ms)` : ''} · CPU calibration ${CAL0.toFixed(0)} / ${CAL1.toFixed(0)} ms${base?.calib ? ` (baseline ${base.calib.toFixed(0)})` : ''} · machine load before the run ${(LOAD0 * 100).toFixed(0)}%`);
if (busy) console.log('WARNING: the machine is BUSY (load over 20% before the run, or calibration over 1.35x the baseline): other work is competing for the CPU, so these numbers are not comparable. Re-run when it is quiet.');
console.log(`budget (ms): JS ${B.frame} · p95 frame ${B.p95} · GPU p95 ${B.gpu} · sim ${B.sim} · char ${B.char} · view ${B.view} · render ${B.render} · ui ${B.ui}\n`);
console.log('scenario      fps   p50    p95  | JS avg |  sim   char   view  render   ui  | GPU p95 | draws | top systems');
for (const sc of SCENARIOS) {
  const r = results[sc.name]; if (!r || r.error) { console.log(sc.name.padEnd(12), 'FAILED to load'); fail++; continue; }
  const g = Object.fromEntries(r.groups.map(x => [x.group, x.avg]));
  const over = laptop ? [r.frame.p95 > 16.7 && 'p95 > 16.7 ms (60 fps)'].filter(Boolean)   // throttled: only the 60 fps target counts
    : [r.frame.p95 > B.p95 && 'p95', r.js.avg > B.frame && 'JS', r.gpu && B.gpu && r.gpu.p95 > B.gpu && 'GPU',
      ...(sc.whole ? [] : r.groups.filter(x => x.avg > x.budget).map(x => x.group))].filter(Boolean);   // (whole: the horde shifts time into render; judged on the frame)
  if (over.length) fail++;
  console.log(`${sc.name.padEnd(12)}${f(r.fps, 5, 0)} ${f(r.frame.p50, 5)} ${f(r.frame.p95, 5)}${mark(r.frame.p95, B.p95)}|${f(r.js.avg, 6)}${mark(r.js.avg, B.frame)}|` +
    ['sim', 'char', 'view', 'render', 'ui'].map(k => f(g[k], 6) + mark(g[k], B[k])).join('') + `| ${f(r.gpu?.p95, 6)}${mark(r.gpu?.p95 ?? 0, B.gpu ?? Infinity)} | ${String(r.draws).padStart(4)}  | ` +
    r.systems.slice(0, 4).map(s => `${s.label} ${s.avg.toFixed(2)}`).join(', ') + (over.length ? `   OVER: ${over.join(', ')}` : ''));
  if (r.runs) console.log(`   ${r.runs.length} runs, JS avg: ${r.runs.map(v => v.toFixed(2)).join(' / ')} (the median run is shown)`);
  const c = r.counts;
  if (c) console.log(`   draws ${c.draws.toFixed(0)} (max ${c.drawsMax}) · uniforms ${c.uniforms.toFixed(0)} · uploads ${c.texCanvas.toFixed(1)} canvas + ${c.texData.toFixed(1)} array (${c.texKB.toFixed(0)} KB)` +
    ` · buffers ${c.bufKB.toFixed(0)} KB · heap +${c.heapKB.toFixed(0)} KB/frame` + (r.gc ? ` · GC ${r.gc.msPerSec.toFixed(1)} ms/s (${r.gc.perSec}/s, longest ${r.gc.max.toFixed(1)} ms${r.gc.major ? `, ${r.gc.major} major` : ''})` : ''));
  if (r.errors) console.log('   errors:', r.errors.join(' | '));
  // regressions against the baseline: a system 25% and 0.1 ms slower, or the JS frame 15% slower
  const b = laptop || base?.res !== `${W}x${H}` ? null : base?.results?.[sc.name];   // (another resolution: nothing to compare)
  if (b && !b.error) {
    const prev = Object.fromEntries(b.systems.map(s => [s.label, s.avg])), slower = [];
    for (const s of r.systems) { const p = prev[s.label] ?? 0; if (s.avg - p > .1 && s.avg > p * 1.25) slower.push(`${s.label} ${p.toFixed(2)} -> ${s.avg.toFixed(2)}`); }
    if (r.js.avg > b.js.avg * 1.15 && r.js.avg - b.js.avg > .15) slower.unshift(`JS ${b.js.avg.toFixed(2)} -> ${r.js.avg.toFixed(2)}`);
    if (slower.length) { console.log('   slower than baseline:', slower.join(' · ')); if (!busy) fail++; }
  }
}
if (base) console.log(`\n(baseline: ${base.date} ${base.commit || ''} at ${base.res}${base.res !== `${W}x${H}` ? `: not compared, this run is ${W}x${H} (--save one at this size)` : ''})`);
if (flag('save') && laptop) console.log('not saving a baseline from a throttled run');
else if (flag('save')) {
  let commit = ''; try { commit = (await new Promise(r => { const g = spawn('git', ['rev-parse', '--short', 'HEAD'], {cwd: ROOT}); let o = ''; g.stdout.on('data', d => o += d); g.on('close', () => r(o.trim())); })); } catch {}
  if (busy) console.log('not saving a baseline from a busy machine');
  else { writeFileSync(BASE, JSON.stringify({date: new Date().toISOString().slice(0, 16), commit, gpu: gpuName, res: `${W}x${H}`, calib: CAL, results}, null, 1)); console.log('saved the baseline:', BASE); }
}
ws.close();
quit(fail && !flag('no-fail') ? 1 : 0);
