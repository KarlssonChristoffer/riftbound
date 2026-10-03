// PERF A/B: two versions of the page in ONE headless Chrome on the GPU, compared on the main thread's cost per frame.
// Use it to tell whether a change made the frame cheaper, especially on a busy machine: both pages have their rAF loops
// off and are stepped by hand (__r3d.step: the sim, the views, the draw, G.render) in alternating slices, so whatever
// else the machine is doing hits both alike. bench.mjs answers "is it within budget"; this answers "is B cheaper than A".
//
//   node tools/perf/ab.mjs --a git:HEAD~1                 the last commit against the working tree (src/)
//   node tools/perf/ab.mjs --a src-old/ --b src/           a copied folder against src/ (copies sit next to src/: the page
//                                                          loads ../concepts/...)
//   options: --q "mode=sandbox&time=night" (both pages)  --qa / --qb (one page: an A/B of a switch, --a src/ --qb cards=0)
//            --drive horde | zoomed-out | "<js run in each page>"   --slices 14 --frames 150 --res 3440x1440
//            --sys G.render,world.update (systems to compare; default G.render + the 6 biggest)   --warm 2 (rounds not counted)
//
// Prints each slice's B / A, the median ms per frame of each page, B vs A, the systems' medians and the counts (draws,
// uniforms, uploads: core/perf.js). A slice's first frames run after the other page's slice: keep --frames >= 100.
// The tool's own bias: --a src/ --b src/ (the same code on both sides) should come out near 1.00.
// A git:REV side is extracted (git archive of its src/) to src-ab-REV/ next to src/ and removed at the end.
// Ports: HTTP 8137, Chrome debug 9344 (bench 9342, golden 9351, simview 9352, smoke 9354).
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const Q = arg('q', 'mode=sandbox'), QA = arg('qa', ''), QB = arg('qb', ''), DRIVE = arg('drive', ''), SL = +arg('slices', 14), NF = +arg('frames', 150);
const [W, H] = arg('res', '3440x1440').split('x').map(Number), PORT = 8137, DBG = 9344;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!arg('a')) { console.log('usage: node tools/perf/ab.mjs --a <folder | git:REV> [--b src/] [--q ...]   (see the header)'); process.exit(2); }

// a side: a folder next to src/, or git:REV extracted there
const made = [];
function side(s) {
  if (!s.startsWith('git:')) { const d = s.replace(/^\/|\/?$/g, ''); if (!existsSync(join(ROOT, d))) { console.error(`ab: no folder ${d}`); process.exit(2); } return d; }
  const rev = s.slice(4), sh = spawnSync('git', ['rev-parse', '--short', rev], {cwd: ROOT, encoding: 'utf8'}).stdout.trim();
  if (!sh) { console.error(`ab: no revision ${rev}`); process.exit(2); }
  const d = `src-ab-${sh}`;
  if (!existsSync(join(ROOT, d))) {
    const tar = spawnSync('git', ['archive', '--format=tar', `--prefix=${d}/`, `${sh}:src`], {cwd: ROOT, maxBuffer: 1 << 30});
    const x = spawnSync('tar', ['-xf', '-', '-C', ROOT], {input: tar.stdout});
    if (tar.status || x.status) { console.error('ab: could not extract', rev, String(tar.stderr || x.stderr)); process.exit(2); }
    made.push(join(ROOT, d));
  }
  return d;
}
const A = side(arg('a')), B = side(arg('b', 'src/'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn('python', [join(ROOT, 'serve.py'), String(PORT)], {stdio: 'ignore', cwd: ROOT});
const prof = mkdtempSync(join(tmpdir(), 'ab-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit',
  '--enable-precise-memory-info', `--window-size=${W},${H}`, `--remote-debugging-port=${DBG}`, '--user-data-dir=' + prof, 'about:blank'], {stdio: 'ignore'});
let stopped = false;
const stop = () => {
  if (stopped) return; stopped = true; try { chrome.kill(); } catch {} try { server.kill(); } catch {}
  for (const d of [...made, prof]) for (let k = 0; k < 20; k++) { try { rmSync(d, {recursive: true, force: true}); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); } }
};
const quit = c => { stop(); process.exit(c); };
process.on('exit', stop); process.on('SIGINT', () => quit(130));

let ver; for (let k = 0; k < 80; k++) { try { ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); break; } catch {} await sleep(250); }
if (!ver) { console.error('ab: Chrome did not start (set CHROME=...)'); quit(2); }
async function page(url) {   // a tab of its own, its rAF off (we step it)
  const t = await (await fetch(`http://127.0.0.1:${DBG}/json/new?about:blank`, {method: 'PUT'})).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}; ws.onmessage = e => { const m = JSON.parse(e.data); pend[m.id]?.(m); delete pend[m.id]; };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id: i, method, params})); });
  const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); return r.result?.exceptionDetails ? {err: r.result.exceptionDetails.exception?.description} : r.result?.result?.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: W, height: H, deviceScaleFactor: 1, mobile: false});
  await send('Emulation.setFocusEmulationEnabled', {enabled: true});
  await send('Page.addScriptToEvaluateOnNewDocument', {source: 'window.requestAnimationFrame = () => 0;'});
  await send('Page.navigate', {url});
  for (let i = 0; i < 240; i++) { await sleep(250); if (await ev('!!(window.__r3d && window.__r3d.perf)')) return {send, ev}; }
  throw new Error('ab: did not load ' + url);
}
const DRIVES = {
  horde: `(() => { const R = window.__r3d, C = R.host.feature('combat').core, x = R.host.player.x, y = R.host.player.y; C.immune = () => true;
    for (let i = 0; i < 60; i++) { const r = 3.5 + (i % 4) * 1.6, a = i * 2.39996; C.spawnBrute({x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * .7, hp: 1e6, dmg: 0, type: 'brute', name: 'Brute', coins: [0, 0]}); } })()`,
  'zoomed-out': `(() => { window.__r3d.zoom = .5; })()`,
};
const P = {};
for (const [k, dir, qx] of [['A', A, QA], ['B', B, QB]]) {
  P[k] = await page(`http://localhost:${PORT}/${dir}/?${Q}&bench=1${qx ? '&' + qx : ''}`);
  if (DRIVE) await P[k].ev(DRIVES[DRIVE] || DRIVE);
  for (let w = 0; w < 6; w++) await P[k].ev('window.__r3d.step(150, 1 / 164); 0');   // settle: 900 frames (the JIT warm, the zoom eased)
}
const ms = {A: [], B: []}, sys = {A: [], B: []}, cnt = {A: [], B: []};
// (the first WARM rounds are thrown away: the page that settled first ran its first slices slow, whichever code it held)
const WARM = +arg('warm', 2);
for (let s = -WARM; s < SL; s++) for (const k of ((s + WARM) % 2 ? ['B', 'A'] : ['A', 'B'])) {
  await P[k].send('Page.bringToFront');   // (each slice in the front tab: a background tab ran slower for many slices, which read as B faster)
  await P[k].ev('window.__r3d.perf.reset(); 0');
  const v = await P[k].ev(`(() => { const R = window.__r3d, t = performance.now(); for (let i = 0; i < ${NF}; i++) { R.perf.frameStart(); R.step(1, 1 / 164); R.perf.frameEnd(); } return (performance.now() - t) / ${NF}; })()`);
  if (s < 0) continue;
  ms[k].push(v);
  const r = await P[k].ev('(() => { const r = window.__r3d.perf.report(); return {s: Object.fromEntries(r.systems.map(s => [s.label, s.avg])), c: r.counts}; })()');
  sys[k].push(r.s); if (r.c) cnt[k].push(r.c);
}
const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
const ratio = ms.A.map((a, i) => ms.B[i] / a);
console.log(`\n${Q}${QA ? ` · A +${QA}` : ''}${QB ? ` · B +${QB}` : ''}${DRIVE ? ` · drive ${DRIVES[DRIVE] ? DRIVE : 'custom'}` : ''} · ${W}x${H} · ${SL} slices x ${NF} frames, alternating`);
console.log('slice B / A:', ratio.map(r => r.toFixed(2)).join(' '), ' median', med(ratio).toFixed(3));
for (const k of ['A', 'B']) console.log(`${k} ${(k === 'A' ? A : B).padEnd(18)} ms/frame median ${med(ms[k]).toFixed(3)}   slices ${ms[k].map(v => v.toFixed(2)).join(' ')}`);
console.log(`B vs A: ${((med(ms.B) / med(ms.A) - 1) * 100).toFixed(1)}% (median of the slices)\n`);
const SYS = arg('sys') ? arg('sys').split(',') : ['G.render', ...Object.entries(sys.B.at(-1) || {}).sort((a, b) => b[1] - a[1]).map(([l]) => l).filter(l => l !== 'G.render').slice(0, 6)];
for (const l of SYS) { const a = med(sys.A.map(o => o[l] || 0)), b = med(sys.B.map(o => o[l] || 0)); console.log(`  ${l.padEnd(18)} A ${a.toFixed(3)}  B ${b.toFixed(3)} ms   ${a ? ((b / a - 1) * 100).toFixed(0).padStart(4) + '%' : ''}`); }
const cm = (k, f) => med(cnt[k].map(c => c[f] ?? 0));
if (cnt.A.length && cnt.B.length) {
  console.log('');
  for (const [f, label] of [['draws', 'draws'], ['uniforms', 'uniform calls'], ['texCanvas', 'canvas uploads'], ['texData', 'array uploads'], ['texKB', 'upload KB'], ['heapKB', 'heap KB/frame']])
    console.log(`  ${label.padEnd(18)} A ${cm('A', f).toFixed(1).padStart(7)}  B ${cm('B', f).toFixed(1).padStart(7)}`);
}
quit(0);
