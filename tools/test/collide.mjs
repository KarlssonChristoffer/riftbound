// COLLIDE: the stuck finder (docs/COLLISION.md phase 0). Headless: each case puts the player where the collision has trapped
// him, steps the real game and reports whether he got out, plus how much speed he keeps along walls and past small things.
// Run it before and after a collision change; the numbers go in the commit message.
//   census      a spot just inside each kind of collider (a few of each, spread over the map): teleported there, no input
//               for 40 steps, then a direction away held for 30. STUCK: still inside and moved < .1 m
//   drop        falls that come down in a collider: beside the watchtower's south face as the ladder's Space drops him (.5 / 1
//               / 2 m), beside a field wall, off the lookout's breach at a walk
//   launch      thrown into the arena's north wall (a live loadout: the default set=gunslinger)
//   pass        running at a pot, a post, a brazier, a dummy, a tree: head on and .2 m off centre (progress in 45 steps, % of a free run)
//   slide       along the arena's north wall and a field wall at 0 / 22.5 / 45 / 67.5 deg into it (% of the speed along the
//               wall a perfect slide keeps: cos(angle) of a free run)
//   node tools/test/collide.mjs [--path src/] [--port 8152] [--dbg 9356] [--q set=gunslinger] [--only census,drop,...]
//                               [--n 4 (census spots per kind)] [--out tmp/collide/last.json]
import {spawn} from 'node:child_process';
import {join, dirname} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {launch} from '../lib/chrome.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const PAGE = arg('path', 'src/').replace(/^\/|\/?$/g, '') + '/', PORT = +arg('port', 8152), DBG = +arg('dbg', 9356);
const Q = arg('q', 'set=gunslinger'), ONLY = (arg('only', '') || '').split(',').filter(Boolean), N = +arg('n', 4);
const OUT = join(ROOT, arg('out', 'tmp/collide/last.json'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn('python', [join(ROOT, 'serve.py'), String(PORT)], {stdio: 'ignore'});
const chrome = launch('collide', ['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720',
  `--remote-debugging-port=${DBG}`, 'about:blank']);
let stopped = false;
const stop = () => { if (stopped) return; stopped = true; chrome.kill(); try { server.kill(); } catch {} };
const quit = code => { stop(); process.exit(code); };
process.on('exit', stop); process.on('SIGINT', () => quit(130));
let tabs; for (let i = 0; i < 80; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); if (tabs.find(t => t.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}, logs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
  else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id: i, method, params})); });
const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 900)); return r.result?.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 720, deviceScaleFactor: 1, mobile: false});
await send('Page.addScriptToEvaluateOnNewDocument', {source: 'window.requestAnimationFrame = () => 0;'});   // (frames are stepped here)
await send('Page.navigate', {url: `http://localhost:${PORT}/${PAGE}?mode=sandbox&daymin=0&weather=clear&${Q}`});
let up = false; for (let i = 0; i < 240 && !up; i++) { await sleep(250); try { up = await ev('!!(window.__r3d && window.__r3d.world)'); } catch {} }
if (!up) { console.log('the page did not load', logs.join('\n')); quit(2); }
await sleep(1500);

// ---------------------------------------------------------------- in the page
function lib(W) {
  const R = window.__r3d, H = R.host, P = R.P, keys = R.keys, TAU = Math.PI * 2, BODY = .25;
  R.snap = 0;   // (no easing onto the camera's yaw steps: the cases set their own yaws)
  const step = n => R.step(n);
  const at = () => ({x: R.player.x, y: R.player.y, z: P.z, state: P.state});
  const inside = () => H.blocked(R.player.x, R.player.y, P.z, false);
  const prop = p => !p.broken && !p.gone && !p.outside && (p.rect || p.r > 0);
  // the 8 key sets and the world direction each moves him at the camera's yaw now
  const KEYS = [['d'], ['d', 's'], ['s'], ['a', 's'], ['a'], ['a', 'w'], ['w'], ['d', 'w']];
  function keyDir(ks) { const dx = ks.includes('d') - ks.includes('a'), dy = ks.includes('s') - ks.includes('w'), l = Math.hypot(dx, dy); return R.toWorld(dx / l, dy / l); }
  function keysToward(ux, uy) { let best = null, bd = -2; for (const ks of KEYS) { const [x, y] = keyDir(ks), d = x * ux + y * uy; if (d > bd) { bd = d; best = ks; } } return best; }
  // the yaw at which W moves him along world (ux, uy) / D moves him along it
  const yawW = (ux, uy) => Math.atan2(-ux, -uy), yawD = (ux, uy) => Math.atan2(-uy, ux);
  function reset(x, y, yaw = 0) {
    keys.clear(); R.setYaw(yaw); H.teleport(x, y);
    Object.assign(P, {vx: 0, vy: 0, vz: 0, t: 0, turn: null, skid: 0, curSpeed: 0, lastSpeed: 0, vault: null, climb: null, rollDir: null, blink: 0});
  }
  function hold(ks, n) { keys.clear(); for (const k of ks) keys.add(k); step(n); keys.clear(); }
  // after an event: inside a collider? Then he holds the way out (ux, uy) for n steps: how far he got
  function outcome(ux, uy, n = 30) {
    const a = at(), insideNow = inside();
    hold(keysToward(ux, uy), n); step(2);
    const b = at(), moved = Math.hypot(b.x - a.x, b.y - a.y);
    return {inside: insideNow, moved: +moved.toFixed(3), stuck: insideNow && moved < .1, state: a.state, at: [+a.x.toFixed(2), +a.y.toFixed(2), +a.z.toFixed(2)]};
  }
  const freeGround = (x, y, z) => W.walkable(x, y) && !W.inStream(x, y) && Math.abs(W.elev(x, y) - z) < .3 && !W.steep(x, y);

  // ---- census: a spot just inside each kind of collider
  function census(n) {
    const byKind = new Map();
    for (const p of H.props) if (prop(p) && !p.hunter && p.kind !== 'brute') { if (!byKind.has(p.kind)) byKind.set(p.kind, []); byKind.get(p.kind).push(p); }
    const out = [];
    for (const [kind, list] of [...byKind].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      let tried = 0;
      for (let i = 0; i < list.length && tried < n; i += Math.max(1, Math.floor(list.length / n))) {
        const p = list[i], z = p.z || 0;
        let spot = null;
        for (let k = 0; k < 8 && !spot; k++) {   // (a spot on free ground just inside its shell, the way out along u)
          let x, y, ux, uy;
          if (p.rect) {
            const [x0, y0, x1, y1] = p.rect, side = (i + k) % 4, m = BODY - .1;
            if (side === 0) { x = (x0 + x1) / 2; y = y0 - m; ux = 0; uy = -1; } else if (side === 1) { x = (x0 + x1) / 2; y = y1 + m; ux = 0; uy = 1; }
            else if (side === 2) { x = x0 - m; y = (y0 + y1) / 2; ux = -1; uy = 0; } else { x = x1 + m; y = (y0 + y1) / 2; ux = 1; uy = 0; }
          } else {
            const a = (i * 2.39996 + k * TAU / 8) % TAU, d = p.r + BODY - .1; ux = Math.sin(a); uy = Math.cos(a); x = p.x + ux * d; y = p.y + uy * d;
          }
          if (freeGround(x, y, z) && H.blocked(x, y, W.elev(x, y), false)) spot = {x, y, ux, uy};
        }
        if (!spot) continue;
        tried++;
        reset(spot.x, spot.y);
        if (!inside()) { tried--; continue; }
        step(40);
        out.push({kind, prop: [+p.x.toFixed(2), +p.y.toFixed(2)], ...outcome(spot.ux, spot.uy)});
      }
    }
    return out;
  }
  // ---- drops: a fall from h m at (x, y) with world velocity (vx, vy), then the way out (ux, uy)
  function drop(x, y, h, vx, vy, ux, uy, yaw) {
    reset(x, y, yaw);
    const g = W.elev(x, y), v = R.toView(vx, vy);
    Object.assign(P, {state: 'fall', t: 0, z: g + h, vz: 0, fall0: g + h, vx: v[0], vy: v[1]});
    step(90);
    return outcome(ux, uy);
  }
  const towerClimb = () => W.CLIMBS.find(c => c.hill);
  function drops() {
    const out = [], c = towerClimb();
    if (c) {   // the ladder holds him .1 m out from the wall (ladder.js L.face); Space: off at 1.2 m/s straight out
      for (const h of [.5, 1, 2]) out.push({name: `tower ladder drop ${h} m`, ...drop(c.x + c.nx * .05, c.y + c.ny * .05, h, c.nx * 1.2, c.ny * 1.2, c.nx, c.ny, c.yaw)});
      // the lookout's breach: from the floor at the ladder's top, walking out (Q + the way out) off the edge
      reset(c.x - c.nx * c.reach, c.y - c.ny * c.reach, c.yaw);
      hold(['q', ...keysToward(c.nx, c.ny)], 100); step(60);
      out.push({name: 'walk off the lookout breach', ...outcome(c.nx, c.ny)});
    } else out.push({name: 'tower', skipped: 'no watchtower'});
    const fw = H.props.filter(p => p.kind === 'fieldwall' && prop(p));
    for (let i = 0; i < fw.length && out.length < 7; i += Math.max(1, Math.floor(fw.length / 3))) {   // beside a field wall, from 1.5 m
      const p = fw[i]; let q = null, qd = 1e9;
      for (const o of fw) { const d = Math.hypot(o.x - p.x, o.y - p.y); if (o !== p && d < qd) { qd = d; q = o; } }
      if (!q) continue;
      const lx = (q.x - p.x) / qd, ly = (q.y - p.y) / qd;
      for (const s of [1, -1]) {
        const ux = -ly * s, uy = lx * s, x = p.x + ux * (p.r + BODY - .1), y = p.y + uy * (p.r + BODY - .1);
        if (!freeGround(x, y, p.z || 0)) continue;
        out.push({name: `fall beside a field wall (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`, ...drop(x, y, 1.5, 0, 0, ux, uy, 0)});
        break;
      }
    }
    return out;
  }
  // ---- the arena's north wall: the longest whole run of 'wall_n' segments -> {x0, x1, y (its face)}
  function northWall() {
    const segs = H.props.filter(p => p.kind === 'wall_n' && prop(p) && W.breachTop(p) === null).sort((a, b) => a.x - b.x);
    let best = null, s = 0;
    for (let i = 1; i <= segs.length; i++) {
      if (i < segs.length && Math.abs(segs[i].x - segs[i - 1].x - 1) < .01 && Math.abs(segs[i].rect[3] - segs[s].rect[3]) < .01) continue;
      if (!best || i - s > best.n) best = {n: i - s, x0: segs[s].rect[0], x1: segs[i - 1].rect[2], y: segs[s].rect[3]};
      s = i;
    }
    return best;
  }
  function launches() {
    const w = northWall(); if (!w) return [{name: 'launch', skipped: 'no north wall'}];
    const x = (w.x0 + w.x1) / 2, y = w.y + .9;
    reset(x, y, 0); step(5);
    if (!H.launch(0, -7, 2.5)) return [{name: 'thrown into the north wall', skipped: 'not a live loadout (--q set=gunslinger)'}];
    step(300);
    return [{name: 'thrown into the north wall', ...outcome(0, 1)}];
  }
  // ---- running at small things: progress along u in 45 steps (% of a free run's)
  let free = null;
  function freeRun() {
    if (free) return free;
    const w = northWall(), x = w ? (w.x0 + w.x1) / 2 - 2 : H.layout.spawn.x, y = w ? w.y + 4 : H.layout.spawn.y;
    reset(x, y, yawD(1, 0)); hold(['d'], 45); free = Math.hypot(R.player.x - x, R.player.y - y);
    return free;
  }
  function pass() {
    const out = [], D0 = freeRun();
    for (const kind of ['pot', 'gatepost', 'brazier', 'dummy', 'tree']) {
      const list = H.props.filter(p => p.kind === kind && prop(p) && !(p.r > .6));
      let done = false;
      for (const p of list) {
        if (done) break;
        for (let k = 0; k < 8 && !done; k++) {   // a way past it with free ground before and after (nothing else in the way)
          const a = k * TAU / 8, ux = Math.sin(a), uy = Math.cos(a), z = p.z || 0;
          let ok = true;
          for (let s = -1.6; s <= 2.4 && ok; s += .2) {
            const x = p.x + ux * s, y = p.y + uy * s;
            if (!freeGround(x, y, z)) ok = false;
            else if (Math.abs(s) > p.r + BODY + .05) { for (const off of [-.3, 0, .3]) if (H.blocked(x - uy * off, y + ux * off, z, false)) ok = false; }
          }
          if (!ok) continue;
          done = true;
          for (const off of [0, .2]) {
            const x0 = p.x - ux * 1.5 - uy * off, y0 = p.y - uy * 1.5 + ux * off;
            reset(x0, y0, yawW(ux, uy)); hold(['w'], 45);
            const prog = (R.player.x - x0) * ux + (R.player.y - y0) * uy;
            out.push({name: `run at a ${kind} ${off ? off + ' m off centre' : 'head on'}`, prop: [+p.x.toFixed(2), +p.y.toFixed(2)], progress: +prog.toFixed(2), pct: Math.round(prog / D0 * 100), passed: prog > 1.5 + p.r + BODY});
          }
        }
      }
      if (!done) out.push({name: `run at a ${kind}`, skipped: 'none with a clear way past'});
    }
    return out;
  }
  // ---- sliding along a wall at an angle into it: along-wall distance in 45 steps, % of cos(angle) x a free run
  function slides() {
    const out = [], D0 = freeRun(), w = northWall();
    const run = (name, x, y, ux, uy, nx, ny) => {   // (u: along the wall, n: out of it)
      for (const deg of [0, 22.5, 45, 67.5]) {
        const a = deg * Math.PI / 180, dx = ux * Math.cos(a) - nx * Math.sin(a), dy = uy * Math.cos(a) - ny * Math.sin(a);
        reset(x, y, yawD(dx, dy)); hold(['d'], 45);
        const along = (R.player.x - x) * ux + (R.player.y - y) * uy, ideal = D0 * Math.cos(a);
        out.push({name: `${name} at ${deg} deg`, along: +along.toFixed(2), pct: Math.round(along / ideal * 100)});
      }
    };
    if (w) run('slide along the north wall', w.x0 + 1, w.y + .45, 1, 0, 0, 1);
    else out.push({name: 'north wall', skipped: 'none'});
    const legs = (H.layout.walls || []).filter(L => L.kind === 'fieldwall');
    let found = false;
    for (const L of legs) {
      if (found) break;
      const l = Math.hypot(L.b[0] - L.a[0], L.b[1] - L.a[1]), ux = (L.b[0] - L.a[0]) / l, uy = (L.b[1] - L.a[1]) / l;
      for (let s0 = 1; s0 + 4 < l && !found; s0 += 1) {
        for (const sd of [1, -1]) {
          const nx = -uy * sd, ny = ux * sd, x = L.a[0] + ux * s0 + nx * .65, y = L.a[1] + uy * s0 + ny * .65;
          let ok = freeGround(x, y, W.elev(x, y)) && !H.blocked(x, y, W.elev(x, y), false);
          for (let s = 0; s <= 3.5 && ok; s += .3) {   // the wall unbroken along the way (no doorway), free ground beside it
            const ax = L.a[0] + ux * (s0 + s), ay = L.a[1] + uy * (s0 + s), e = W.elev(ax + nx * .65, ay + ny * .65);
            if (!H.blocked(ax, ay, W.elev(ax, ay), false) || !freeGround(ax + nx * .65, ay + ny * .65, e) || !freeGround(ax + nx * 1.2, ay + ny * 1.2, e)) ok = false;
          }
          if (!ok) continue;
          found = true; run('slide along a field wall', x, y, ux, uy, nx, ny); break;
        }
      }
    }
    if (!found) out.push({name: 'field wall slide', skipped: 'no straight stretch found'});
    return out;
  }
  return {census, drops, launches, pass, slides, flags: () => location.search};
}

// ---------------------------------------------------------------- run
await ev(`import('/${PAGE}world/world.js').then(W => { window.__col = (${lib.toString()})(W); return 1; })`);
const want = k => !ONLY.length || ONLY.includes(k);
const res = {query: await ev('window.__col.flags()'), at: new Date().toISOString()};
const t0 = Date.now();
const show = r => {
  if (r.skipped) return `skip  ${r.name}: ${r.skipped}`;
  if ('stuck' in r) return `${r.stuck ? 'STUCK' : 'ok   '} ${r.name || r.kind + ' ' + JSON.stringify(r.prop)}  inside ${r.inside ? 'yes' : 'no '}  moved ${r.moved} m  (${r.state} at ${r.at.join(', ')})`;
  if ('passed' in r) return `${r.passed ? 'ok   ' : 'STOP '} ${r.name}  ${r.progress} m (${r.pct}% of a free run)`;
  return `      ${r.name}  ${r.along} m along (${r.pct}% of a perfect slide)`;
};
for (const [k, call] of [['census', `window.__col.census(${N})`], ['drop', 'window.__col.drops()'], ['launch', 'window.__col.launches()'], ['pass', 'window.__col.pass()'], ['slide', 'window.__col.slides()']]) {
  if (!want(k)) continue;
  const n0 = logs.length;
  try { res[k] = await ev(call); } catch (e) { res[k] = [{name: k, skipped: 'error ' + e.message.slice(0, 300)}]; }
  console.log(`---- ${k}`); for (const r of res[k]) console.log(show(r));
  if (logs.length > n0) console.log('     ' + logs.slice(n0).join('\n     '));
}
// the totals: census stuck / total, drops + launch stuck, pass stopped, slide mean %
const C = res.census || [], D = [...(res.drop || []), ...(res.launch || [])].filter(r => !r.skipped), PS = (res.pass || []).filter(r => !r.skipped), SL = (res.slide || []).filter(r => !r.skipped && !/ 0 deg/.test(r.name));
res.summary = {censusStuck: `${C.filter(r => r.stuck).length}/${C.length}`, dropStuck: `${D.filter(r => r.stuck).length}/${D.length}`,
  passStopped: `${PS.filter(r => !r.passed).length}/${PS.length}`, slideKept: SL.length ? Math.round(SL.reduce((s, r) => s + r.pct, 0) / SL.length) + '%' : '-'};
console.log(`---- summary (${((Date.now() - t0) / 1000).toFixed(0)} s)`, JSON.stringify(res.summary));
mkdirSync(dirname(OUT), {recursive: true}); writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log('wrote', OUT);
quit(0);
