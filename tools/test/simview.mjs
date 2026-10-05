// SIM vs VIEW: proves the simulation doesn't depend on its presentation (docs/ARCHITECTURE.md rule 4, phase 4's exit
// check). Each scenario runs twice in a fresh, deterministic page (golden.mjs's shim: seeded Math.random, a virtual
// clock, no rAF): once whole, once with ?views=0 (no feature view() steps, no cloak, no drawing: the sim alone, the
// camera still following because the cursor is read through it). The same scripted input must give the same SIM state,
// compared every 30 steps (a trace, so a difference in timing shows, not only in the end state): the player, every prop
// (position, hp, broken, gone), arrows, enemies, gold, the run, the clock and the weather.
// A difference means some sim decision reads presentation state or draws from Math.random (core/rng.js).
// Camera feel (flow) and screen shake move the cursor's frame, so both runs turn them off.
// FRAME RATE (the fixed step, phase 4.3): the 'keys' scenario (keyboard and world-space input only: the cursor is read
// through a camera that moves differently at another frame rate) also runs at 240 and 30 frames a second: the sim
// must come out the same as at 60 (its inputs change on even sixtieths, where every rate has a frame).
//   node tools/test/simview.mjs            options: --only sandbox,run --port 8142 --path src/ (the page folder, as golden.mjs)
import {spawn} from 'node:child_process';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch} from '../lib/chrome.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const PORT = +arg('port', 8142), ONLY = arg('only', ''), PAGE = arg('path', 'src/').replace(/^\/|\/?$/g, '') + '/';
const SHIM = `(() => {
  let s = 0x2545F491 | 0;
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let T = 1000; performance.now = () => T; Date.now = () => 1790000000000 + Math.floor(T);
  window.__clock = {advance(ms) { T += ms; }}; window.requestAnimationFrame = () => 0;
})();`;

// the input script (R = window.__r3d; frames(n) steps n x 1/60 s). Aims are set in world terms through the camera
const AIM = `const aimAt = (x, y, h) => { const s = R.G.toScreen(x, h, y), z = R.zoomState.zoom || 1; R.mouse.x = R.G.VW / 2 + (s[0] - R.G.VW / 2) / z; R.mouse.y = R.G.VH / 2 + (s[1] - R.G.VH / 2) / z; };
  const shoot = async (x, y, h, hold = 40) => { aimAt(x, y, h); R.PL.press(); R.mouse.down = true; await frames(hold); R.PL.release(); R.mouse.down = false; await frames(30); };
  const key = k => { window.dispatchEvent(new KeyboardEvent('keydown', {key: k})); window.dispatchEvent(new KeyboardEvent('keyup', {key: k})); };`;
const SCENARIOS = [
  // the yard: walking, the bow at dummies and crates, a fire arrow dipped in a brazier into the crates, the abilities
  ['sandbox', 'mode=sandbox&daymin=0&hour=11&weather=fair&flow=0', `
    await frames(30);
    R.keys.add('d'); await frames(40); R.keys.delete('d'); R.keys.add('s'); await frames(30); R.keys.delete('s'); await frames(10);
    const W = R.world, dummies = W.props.filter(p => p.kind === 'dummy'), crates = W.props.filter(p => p.kind === 'crate' && !p.broken);
    const dm = dummies.sort((a, b) => a.x - b.x)[0]; R.host.teleport(dm.x, dm.y + 4); await frames(20);
    for (let k = 0; k < 3; k++) await shoot(dm.x, dm.y, (dm.z || 0) + .9);
    // a fire arrow into the thickest cluster of crates: it catches, spreads to its neighbours, they burn through to ash
    const near = c => crates.filter(o => o !== c && Math.hypot(o.x - c.x, o.y - c.y) < 1.4).length, cr = crates.sort((a, b) => near(b) - near(a))[0];
    R.host.teleport(cr.x - 3.5, cr.y); await frames(20);
    R.host.spawnArrow({x: cr.x - 2.5, y: cr.y, h: (cr.z || 0) + .5, vx: 22, vy: 0, vh: .4, dmg: 1, fire: 1}); await frames(90);
    window.__fire1 = R.host.feature('lights').hud();
    await frames(600);                                // they burn, spread, burn through
    const c2 = crates.find(p => !p.broken) || cr; R.host.teleport(c2.x - 3, c2.y + 2); await frames(20);
    aimAt(c2.x, c2.y, .4); key('1'); await frames(90); key('2'); await frames(180); key('3'); await frames(60);
    for (let k = 0; k < 4; k++) await shoot(c2.x + k * .3, c2.y, .5, 20);
    R.keys.add('w'); await frames(60); R.keys.delete('w'); key(' '); await frames(120);`],
  // a run: the first waves (enemies hop at you, you shoot back at them)
  ['run', 'mode=run&daymin=0&weather=fair&flow=0', `
    await frames(240);
    for (let k = 0; k < 12; k++) {
      const core = R.host.feature('combat').core, e = core.enemies[0];
      if (e) await shoot(e.x, e.y, (e.z || 0) + .9, 30); else await frames(60);
      R.keys.add(k % 2 ? 'a' : 'd'); await frames(20); R.keys.clear();
    }
    await frames(300);`],
  // keyboard + world-space input only, so it can run at any frame rate: walking, sprinting, the sparring brutes hop at
  // you, a fire arrow (spawned, not aimed) into the crate cluster, a roll
  ['keys', 'mode=sandbox&daymin=0&hour=11&weather=fair&flow=0', `
    await frames(30);
    R.keys.add('d'); await frames(60); R.keys.delete('d'); R.keys.add('s'); await frames(40); R.keys.delete('s');
    R.keys.add('shift'); R.keys.add('a'); await frames(80); R.keys.clear(); await frames(20);
    const bru = R.world.props.find(p => p.kind === 'brute'); R.host.teleport(bru.x + 2, bru.y); await frames(240);
    const crates = R.world.props.filter(p => p.kind === 'crate' && !p.broken), near = c => crates.filter(o => o !== c && Math.hypot(o.x - c.x, o.y - c.y) < 1.4).length;
    const cr = crates.sort((a, b) => near(b) - near(a))[0]; R.host.teleport(cr.x - 3.5, cr.y); await frames(20);
    R.host.spawnArrow({x: cr.x - 2.5, y: cr.y, h: (cr.z || 0) + .5, vx: 22, vy: 0, vh: .4, dmg: 1, fire: 1}); await frames(600);
    R.keys.add('w'); await frames(40); key(' '); await frames(60); R.keys.clear(); await frames(100);`, [240, 30]],
].filter(s => !ONLY || ONLY.split(',').includes(s[0]));

const DIGEST = `(() => { const R = window.__r3d, core = R.host.feature('combat')?.core, g = R.game, f5 = v => typeof v === 'number' ? +v.toFixed(5) : v;
  return JSON.stringify({
    player: [R.P.x, R.P.y, R.P.z, R.P.state, R.P.face].map(f5),
    props: R.world.props.map(p => [p.kind, f5(p.x || 0), f5(p.y || 0), f5(p.z || 0), p.hp ?? '', p.broken ? 1 : 0, p.gone ? 1 : 0, p.stage ?? ''].join(',')),
    arrows: R.arrows.map(a => [f5(a.x), f5(a.y), f5(a.h), a.stuck ? 1 : 0, a.fire ? 1 : 0].join(',')), hits: R.host.hits,
    enemies: core ? core.enemies.map(b => [b.type, f5(b.x), f5(b.y), b.hp].join(',')) : [], gold: core?.gold,
    game: [g.mode, g.phase, g.run ? [g.run.stage, g.run.kills, f5(g.run.time), g.run.wave] : null, g.stats?.S.hp],
    env: [f5(R.env.hour), R.env.weather],
    fire: (R.host.feature('lights')?.hud?.() || '').match(/burning ([0-9]+) · ash ([0-9]+)/)?.slice(1)});   // (not the event queue: views emit too, wildlife's calls, fire crackles)
})()`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn('python', [join(ROOT, 'serve.py'), String(PORT)], {stdio: 'ignore'});
// Chrome's throwaway profile goes with it (tools/lib/chrome.mjs, whose next launch also sweeps any that a killed run left
// behind). 'exit' also covers an uncaught error, Ctrl+C goes through quit
const chrome = launch('simview', ['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1920,1080',
  '--remote-debugging-port=9352', 'about:blank']);
let stopped = false;
const stop = () => { if (stopped) return; stopped = true; chrome.kill(); try { server.kill(); } catch {} };
const quit = code => { stop(); process.exit(code); };
process.on('exit', stop); process.on('SIGINT', () => quit(130));
let tabs; for (let k = 0; k < 80; k++) { try { tabs = await (await fetch('http://127.0.0.1:9352/json')).json(); if (tabs.find(t => t.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}, logs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
  else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id: i, method, params})); });
const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800)); return r.result?.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false});
await send('Page.addScriptToEvaluateOnNewDocument', {source: SHIM});

async function runOnce(q, body, fps = 60) {
  logs.length = 0;
  await send('Page.navigate', {url: `http://localhost:${PORT}/${PAGE}?${q}`});
  let ok = false; for (let k = 0; k < 240; k++) { await sleep(250); try { if (await ev('!!(window.__r3d && window.__r3d.world)')) { ok = true; break; } } catch {} }
  if (!ok) return {error: 'load'};
  await sleep(2500);
  await ev(`(async () => {
    const R = window.__r3d; R.opt.shake = false;
    const trace = window.__trace = [], digest = () => ${DIGEST.replace(/`/g, '\`')};
    // frames(n): n sixtieths of a second, stepped as frames of 1 / FPS (a frame lands on every even sixtieth at 30 fps)
    let k = 0, f = 0; const FPS = ${fps};
    const frames = async n => { for (let i = 0; i < n; i++) { k++; while (f / FPS < k / 60 - 1e-9) { window.__clock.advance(1000 / FPS); R.step(1, 1 / FPS); f++; } if (k % 30 === 0) trace.push(digest()); } };
    ${AIM}
    ${body}
  })()`);
  const fire = await ev(`window.__fire1 || window.__r3d.host.feature('lights')?.hud?.() || ''`);
  return {digest: await ev(DIGEST), trace: await ev('window.__trace'), fire, logs: logs.slice()};
}

let fail = 0;
async function compare(name, a, b, label) {
  if (a.error || b.error) { console.log(`${name}: did not load (${a.error || b.error})`); fail++; return; }
  const A = JSON.parse(a.digest), B = JSON.parse(b.digest), bad = Object.keys(A).filter(k => JSON.stringify(A[k]) !== JSON.stringify(B[k]));
  const broke = A.props.filter(p => p.split(',')[5] === '1').length, at = a.trace.findIndex((t, i) => t !== b.trace[i]);
  if (at >= 0 && !bad.length) bad.push('trace');
  console.log(`${name} (${label}): ${bad.length ? 'SIM DIFFERS in ' + bad.join(', ') + (at >= 0 ? ` (first at step ${(at + 1) * 30})` : '') : 'sim identical'} · ${a.trace.length} trace points, ${A.hits} hits, ${broke} props broken, ${A.enemies.length} enemies, gold ${A.gold}, game ${JSON.stringify(A.game)}`);
  const fireOf = t => t.map(x => (JSON.parse(x).fire || []).join('/')).filter((v, i, s) => v !== s[i - 1]).join(' ');
  console.log(`    fire (burning / ash) over time: views ${fireOf(a.trace)} | no views ${fireOf(b.trace)}`);
  console.log(`    views: ${a.fire.replace(/^.*?· (fire arrows)/, '$1')} | no views: ${b.fire.replace(/^.*?· (fire arrows)/, '$1')}`);
  const show = at >= 0 ? [JSON.parse(a.trace[at]), JSON.parse(b.trace[at])] : [A, B];
  for (const k of Object.keys(show[0]).filter(k => JSON.stringify(show[0][k]) !== JSON.stringify(show[1][k]))) {
    const x = [].concat(show[0][k]), y = [].concat(show[1][k]); let shown = 0;
    for (let i = 0; i < Math.max(x.length, y.length) && shown < 4; i++) if (JSON.stringify(x[i]) !== JSON.stringify(y[i])) { console.log(`    ${k}[${i}]: views ${JSON.stringify(x[i])}  vs  no views ${JSON.stringify(y[i])}`); shown++; }
  }
  for (const l of [...a.logs, ...b.logs].slice(0, 4)) console.log('    ' + l);
  if (bad.length) fail++;
}
for (const [name, q, body, rates = []] of SCENARIOS) {
  const a = await runOnce(q, body);
  await compare(name, a, await runOnce(q + '&views=0', body), 'vs no views');
  for (const fps of rates) await compare(name, a, await runOnce(q, body, fps), `vs ${fps} fps`);
}
console.log(fail ? `\n${fail} comparison(s) differ: the sim depends on its views or the frame rate` : '\nthe sim is independent of its views and of the frame rate');
ws.close(); quit(fail ? 1 : 0);
