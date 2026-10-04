// GOLDEN FRAMES: proves a restructure changed nothing (docs/ARCHITECTURE.md, migration phases 2-3).
// The page runs DETERMINISTICALLY: Math.random is seeded, performance.now / Date.now are a virtual clock, the game's own
// requestAnimationFrame loop is off and this script steps it (__r3d.step), so the same code renders byte-identical frames.
// A scripted tour (walk, turn, zoom, debug views, shoot a dummy, break a crate, night fires, a storm, a run's first wave)
// saves the WebGL canvas, the HD overlay and a state digest at each stop. Run it before a refactor (--save), again after
// (--compare): every capture must match exactly. A mismatch names the capture; its images are kept for a look.
//
//   node tools/test/golden.mjs --save tmp/golden/base                       capture the reference (current code)
//   node tools/test/golden.mjs --compare tmp/golden/base                    capture again and compare
//   options: --path src/ (the page folder: src/, or concepts/render3d/ in commits before the move) --only day,run --port 8141
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const SAVE = arg('save'), CMP = arg('compare'), OUT = SAVE || join(ROOT, 'tmp', 'golden', 'last');
const PAGE = arg('path', existsSync(join(ROOT, 'src', 'index.html')) ? 'src/' : 'concepts/render3d/').replace(/^\/|\/?$/g, '') + '/';
const PORT = +arg('port', 8141), ONLY = arg('only', '');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!SAVE && !CMP) { console.log('usage: --save <dir> | --compare <dir>'); process.exit(2); }

// in the page, before any script: seeded random, a virtual clock, no rAF loop
const SHIM = `(() => {
  let s = 0x2545F491 | 0;
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let T = 1000;
  performance.now = () => T; Date.now = () => 1790000000000 + Math.floor(T);
  window.__clock = {advance(ms) { T += ms; }, get t() { return T; }};
  window.requestAnimationFrame = () => 0;
  // every scenario starts clean: the world clock keeps its weather in localStorage (sim/env.js 'rb.env.v1', saved on its
  // first step and on pagehide), and whether the previous scenario's pagehide save landed was a race (the run captures flickered)
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
})();`;

// the tour: [scenario, query, async steps(R, cap, frames)] - cap(name) captures, frames(n) steps n frames of 1/60 s
const SCENARIOS = [
  ['day', 'mode=sandbox&daymin=0&hour=11&weather=fair', `
    await frames(30); await cap('idle');
    R.keys.add('d'); await frames(40); R.keys.delete('d'); await frames(10); await cap('walked');
    R.setYaw(Math.PI / 3); await frames(12); await cap('yaw60');
    R.setYaw(0); await frames(6);
    // shoot the nearest dummy: stand south of it, aim at its chest on screen (the player reads the mouse at zoom 1), loose
    const W = R.world, dm = W.props.filter(p => p.kind === 'dummy').sort((a, b) => a.x - b.x)[0];
    R.host.teleport(dm.x, dm.y + 4); await frames(30);
    const s = R.G.toScreen(dm.x, (dm.z || 0) + .9, dm.y), z = R.zoomState.zoom || 1, VW = R.G.VW, VH = R.G.VH;
    R.mouse.x = VW / 2 + (s[0] - VW / 2) / z; R.mouse.y = VH / 2 + (s[1] - VH / 2) / z;
    R.PL.press(); R.mouse.down = true; await frames(40); R.PL.release(); R.mouse.down = false; await frames(50); await cap('shot');
    // break a crate (its stage swap loads a model: wait for it in real time)
    const cr = W.props.filter(p => p.kind === 'crate' && !p.broken)[0], core = R.host.feature('combat').core;
    R.host.teleport(cr.x - 2.5, cr.y + 1.5); await frames(10);
    for (let k = 0; k < 6 && !cr.broken; k++) { core.damage(cr, 99, {}); await frames(2); }
    await real(600); await frames(20); await cap('crate');
    R.setYaw(Math.PI / 3); await frames(12);
    for (const v of [1, 2, 4, 5]) { R.opt.debug = v; R.applyOpts(); await frames(1); await cap('debug' + v); }
    R.opt.debug = 0; R.applyOpts(); R.setYaw(0); await frames(6);
    R.zoom = 2; await frames(40); await cap('zoom2'); R.zoom = 1; await frames(40);`],
  ['night', 'mode=sandbox&biome=ember&time=night&daymin=0&weather=clear', `await frames(90); await cap('fires'); R.setYaw(-Math.PI / 4); await frames(30); await cap('fires_yaw');`],
  ['storm', 'mode=sandbox&weather=storm&season=summer&daymin=0&hour=11', `await frames(90); await cap('rain');`],
  ['snow', 'mode=sandbox&weather=snow&season=winter&daymin=0&hour=11', `await frames(90); await cap('snow');`],
  ['run', 'mode=run&daymin=0&weather=fair', `await frames(60); await cap('arrive'); await frames(420); await cap('wave');`],
].filter(s => !ONLY || ONLY.split(',').includes(s[0]));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn('python', [join(ROOT, 'serve.py'), String(PORT)], {stdio: 'ignore'});
const PROFILE = mkdtempSync(join(tmpdir(), 'golden-'));
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1920,1080',
  '--remote-debugging-port=9351', '--user-data-dir=' + PROFILE, 'about:blank'], {stdio: 'ignore'});
// the throwaway profile (100-150 MB in %TEMP%) goes with Chrome, which lets go of its files a moment after the kill; if a
// Chrome child process is slow to die (a busy machine), a detached node keeps trying for two minutes. 'exit' also
// covers an uncaught error, Ctrl+C goes through quit
const rmProfile = () => { for (let k = 0; k < 20; k++) { try { return rmSync(PROFILE, {recursive: true, force: true}); } catch {} Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }
  spawn(process.execPath, ['-e', 'for (let k = 0; k < 120; k++) { try { require("fs").rmSync(process.argv[1], {recursive: true, force: true}); break; } catch {} Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); }', PROFILE], {detached: true, stdio: 'ignore', windowsHide: true}).unref(); };
let stopped = false;
const stop = () => { if (stopped) return; stopped = true; try { chrome.kill(); } catch {} try { server.kill(); } catch {} rmProfile(); };
const quit = code => { stop(); process.exit(code); };
process.on('exit', stop); process.on('SIGINT', () => quit(130));
let tabs; for (let k = 0; k < 80; k++) { try { tabs = await (await fetch('http://127.0.0.1:9351/json')).json(); if (tabs.find(t => t.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}, logs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
  else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
  else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) logs.push(m.params.type + ' ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id: i, method, params})); });
const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800)); return r.result?.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false});
await send('Page.addScriptToEvaluateOnNewDocument', {source: SHIM});

mkdirSync(OUT, {recursive: true});
const sha = b => createHash('sha1').update(b).digest('hex').slice(0, 16);
const manifest = {};
for (const [name, q, body] of SCENARIOS) for (let attempt = 0; attempt < 3; attempt++) {
  logs.length = 0;
  await send('Page.navigate', {url: `http://localhost:${PORT}/${PAGE}?${q}`});
  let ok = false; for (let k = 0; k < 240; k++) { await sleep(250); try { if (await ev('!!(window.__r3d && window.__r3d.world)')) { ok = true; break; } } catch {} }
  if (!ok) { console.log(`${name}: did not load`, logs.slice(-3).join(' | ')); manifest[name] = {error: 'load'}; continue; }
  await sleep(2500);   // async model loads settle (no frames run meanwhile: the clock is ours)
  await ev(`window.__caps = []; 0`);
  const run = `(async () => {
    const R = window.__r3d, caps = window.__caps;
    const frames = async n => { for (let i = 0; i < n; i++) { window.__clock.advance(1000 / 60); R.step(1, 1 / 60); } };
    const real = ms => new Promise(r => setTimeout(r, ms));
    const digest = () => JSON.stringify({p: [R.P.x, R.P.y, R.P.z, R.P.state, R.P.face].map(v => typeof v === 'number' ? +v.toFixed(5) : v), yaw: +R.yaw.toFixed(5),
      props: R.world.props.map(p => [p.kind, +(p.x || 0).toFixed(4), +(p.y || 0).toFixed(4), +(p.z || 0).toFixed(4), p.hp ?? '', p.broken ? 1 : 0, p.gone ? 1 : 0, p.stage ?? '']).join(';'),
      arrows: R.arrows.length, hits: R.host.hits});
    const cap = async tag => { caps.push({tag, gl: document.querySelector('#screen').toDataURL('image/png'), hd: document.querySelector('#hd')?.toDataURL('image/png') || '', state: digest()}); };
    ${body}
    return caps.length;
  })()`;
  try { await ev(run); } catch (e) { console.log(`${name}: script error`, String(e).slice(0, 500)); manifest[name] = {error: 'script'}; continue; }
  const n = await ev('window.__caps.length');
  manifest[name] = {captures: {}, logs: logs.slice(0, 5)};
  for (let k = 0; k < n; k++) {
    const c = await ev(`(() => { const c = window.__caps[${k}]; return {tag: c.tag, gl: c.gl, hd: c.hd, state: c.state}; })()`);
    const gl = Buffer.from(c.gl.split(',')[1], 'base64'), hd = c.hd ? Buffer.from(c.hd.split(',')[1], 'base64') : Buffer.alloc(0);
    const key = `${name}_${c.tag}`;
    writeFileSync(join(OUT, key + '_gl.png'), gl); if (hd.length) writeFileSync(join(OUT, key + '_hd.png'), hd);
    manifest[name].captures[c.tag] = {gl: sha(gl), hd: sha(hd), state: sha(Buffer.from(c.state)), stateText: c.state.length > 4000 ? undefined : c.state};
    writeFileSync(join(OUT, key + '_state.json'), c.state);
  }
  const flaky = logs.some(l => /Failed to fetch|ERR_|net::/.test(l));
  console.log(`${name}: ${n} captures${logs.length ? ' · ' + logs.length + ' console errors/warnings: ' + logs.slice(0, 2).join(' | ') : ''}${flaky ? ' -> a load failed, retrying' : ''}`);
  if (!flaky) break;
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({page: PAGE, date: new Date().toISOString(), manifest}, null, 1));

let fail = 0;
if (CMP) {
  const ref = JSON.parse(readFileSync(join(CMP, 'manifest.json'), 'utf8')).manifest;
  console.log(`\ncompare ${PAGE} with ${CMP}:`);
  for (const [name, r] of Object.entries(ref)) {
    const m = manifest[name];
    if (!m || m.error || r.error) { if (!ONLY || ONLY.split(',').includes(name)) { console.log(`  ${name}: ${m?.error || 'missing'} (reference: ${r.error || 'ok'})`); fail++; } continue; }
    for (const [tag, c] of Object.entries(r.captures)) {
      const d = m.captures[tag]; if (!d) { console.log(`  ${name}/${tag}: missing`); fail++; continue; }
      const bad = ['gl', 'hd', 'state'].filter(k => c[k] !== d[k]);
      if (bad.length) { fail++; console.log(`  ${name}/${tag}: DIFFERS in ${bad.join(', ')}  (${OUT} vs ${CMP})`); }
      else console.log(`  ${name}/${tag}: identical`);
    }
  }
  console.log(fail ? `\n${fail} capture(s) differ` : '\nall captures identical');
}
ws.close();
quit(fail ? 1 : 0);
