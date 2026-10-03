// PERF VSYNC: the game as the player sees it: a real, visible, full-screen Chrome window at the display's refresh rate
// (vsync on; the browser's compositor and Windows' DWM in the loop), counting the frames that missed their vsync. The
// bench measures headless with no frame cap (how much work a frame is); this measures the result: at 164 Hz every frame
// has 6.1 ms, and one that takes longer shows the previous picture twice (a hitch).
//
//   node tools/perf/vsync.mjs                 every scenario; a full-screen window on the main display, ~15 s each
//   options: --only day,horde  --secs 10 (measured per scenario)  --settle 3
//
// Per scenario: the refresh rate (the median frame interval: rAF times are vsync times), the frames, the MISSED vsyncs
// (an interval of n periods missed n - 1; a frame within 1.5 periods counts as on time), the longest interval, the 99th
// percentile, and the main thread's JS per frame (core/perf.js). Leave the machine alone while it runs: the window takes
// the screen and keyboard focus, and anything else drawing makes misses that aren't the game's.
// Ports: HTTP 8136, Chrome debug 9345.
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const SECS = +arg('secs', 10), SETTLE = +arg('settle', 3), ONLY = arg('only', ''), PORT = 8136, DBG = 9345;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SPAWN = `(() => { const R = window.__r3d, C = R.host.feature('combat').core, x = R.host.player.x, y = R.host.player.y; C.immune = () => true;
  for (let i = 0; i < 60; i++) { const r = 3.5 + (i % 4) * 1.6, a = i * 2.39996; C.spawnBrute({x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * .7, hp: 1e6, dmg: 0, type: 'brute', name: 'Brute', coins: [0, 0]}); } })()`;
const WALK = `(() => { const R = window.__r3d; let i = 0; window.__drive = setInterval(() => { R.keys.clear(); R.keys.add('wasd'[(i++ >> 4) % 4]); }, 60); })()`;
const SCENARIOS = [
  {name: 'day',         q: 'mode=sandbox'},
  {name: 'walk',        q: 'mode=sandbox', drive: WALK},
  {name: 'night-fires', q: 'mode=sandbox&biome=ember&time=night'},
  {name: 'storm',       q: 'mode=sandbox&weather=storm&season=summer'},
  {name: 'horde',       q: 'mode=sandbox', drive: SPAWN},
  {name: 'zoomed-out',  q: 'mode=sandbox', drive: `(() => { window.__r3d.zoom = .5; })()`},
].filter(s => !ONLY || ONLY.split(',').some(o => s.name.includes(o)));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn('python', [join(ROOT, 'serve.py'), String(PORT)], {stdio: 'ignore', cwd: ROOT});
const prof = mkdtempSync(join(tmpdir(), 'vsync-chrome-'));
// a real window (no --headless), full screen without browser UI, never treated as hidden or in the background
const chrome = spawn(CHROME, ['--kiosk', '--window-position=0,0', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check',
  '--disable-features=CalculateNativeWinOcclusion', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  `--remote-debugging-port=${DBG}`, '--user-data-dir=' + prof, 'about:blank'], {stdio: 'ignore'});
let stopped = false;
const stop = () => { if (stopped) return; stopped = true; try { chrome.kill(); } catch {} try { server.kill(); } catch {}
  for (let k = 0; k < 20; k++) { try { rmSync(prof, {recursive: true, force: true}); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); } } };
const quit = c => { stop(); process.exit(c); };
process.on('exit', stop); process.on('SIGINT', () => quit(130));

let tabs; for (let k = 0; k < 80; k++) { try { tabs = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); if (tabs.find(t => t.type === 'page')) break; } catch {} await sleep(250); }
if (!tabs) { console.error('vsync: Chrome did not start (set CHROME=...)'); quit(2); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}, logs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (pend[m.id]) { pend[m.id](m); delete pend[m.id]; } else if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id: i, method, params})); });
const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); return r.result?.exceptionDetails ? {err: r.result.exceptionDetails.text} : r.result?.result?.value; };
await send('Page.enable'); await send('Runtime.enable');

const rows = [];
for (const sc of SCENARIOS) {
  logs.length = 0;
  await send('Page.navigate', {url: `http://localhost:${PORT}/src/?${sc.q}&bench=1`});
  let ok = false; for (let i = 0; i < 240; i++) { await sleep(250); if (await ev('!!(window.__r3d && window.__r3d.perf)')) { ok = true; break; } }
  if (!ok) { rows.push({name: sc.name, error: 'did not load: ' + logs.slice(-2).join(' | ')}); continue; }
  await send('Page.bringToFront');
  if (sc.drive) await ev(sc.drive);
  await sleep(SETTLE * 1000);
  await ev('window.__r3d.perf.reset(); 0');
  // every rAF time for SECS (they are the vsync times the frames were shown at), the window's size
  const r = await ev(`new Promise(res => { const t = [], end = performance.now() + ${SECS * 1000};
    const f = now => { t.push(now); if (now < end) requestAnimationFrame(f); else res({t, w: innerWidth * devicePixelRatio, h: innerHeight * devicePixelRatio, js: window.__r3d.perf.report().js}); };
    requestAnimationFrame(f); })`);
  const iv = []; for (let k = 1; k < r.t.length; k++) iv.push(r.t[k] - r.t[k - 1]);
  const s = [...iv].sort((a, b) => a - b), per = s[s.length >> 1];
  let missed = 0, late = 0; for (const v of iv) { const n = Math.round(v / per); if (v > per * 1.5) { late++; missed += Math.max(1, n - 1); } }
  rows.push({name: sc.name, hz: 1000 / per, frames: iv.length, late, missed, pct: 100 * missed / (iv.length + missed), longest: s[s.length - 1], p99: s[Math.floor(s.length * .99)], js: r.js, size: `${r.w}x${r.h}`, errors: logs.slice(0, 2)});
}
console.log(`\nwindowed, vsync on · ${SECS} s per scenario · ${rows.find(r => r.size)?.size || '?'} px`);
console.log('scenario      refresh  frames  missed  (%)    late frames  longest   p99    | JS avg  p95');
for (const r of rows) {
  if (r.error) { console.log(r.name.padEnd(12), r.error); continue; }
  console.log(`${r.name.padEnd(12)}${r.hz.toFixed(0).padStart(5)} Hz ${String(r.frames).padStart(7)} ${String(r.missed).padStart(7)}  ${r.pct.toFixed(2).padStart(5)}% ${String(r.late).padStart(8)}     ${r.longest.toFixed(1).padStart(6)}  ${r.p99.toFixed(1).padStart(5)}  | ${r.js.avg.toFixed(2).padStart(5)}  ${r.js.p95.toFixed(2).padStart(5)}`);
  if (r.errors?.length) console.log('   errors:', r.errors.join(' | '));
}
quit(0);
