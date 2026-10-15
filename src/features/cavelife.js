// CAVE LIFE (docs/CAVELIFE.md): the cave's living dark, from the cave's plan (world/caves.js darkPlan: C.soot, C.critters,
// C.hollows). The numbers: content/cavelife.js.
//   ROCK-THINGS  loose rocks by the passages' walls that aren't rocks: stand within CRITTER.wake m of one a moment and it unrolls
//                on many pale legs, trots a few metres off into the dark and curls up again, a rock once more. A VIEW: each player's
//                own (they sit in seeded spots, so friends see roughly the same), from the view's generator. While he trips on the
//                fly agaric broth (features/trip.js) their legs show even curled up.
//   SOOT THINGS  small soot-black fluttering things that roost in the cave's far rooms, come at a lit lantern, circle its bearer's
//                head and put it out (features/caves.js snuff), and keep out of a Crystal Lamp's or a burning fire's light. Their
//                rules are sim/cavelife.js: run here offline (this feature's own generator), by the co-op server online (their
//                places in its snapshots: coop.net.soot; a snuff is an event in coop.mail). Drawn as a black body and two wings
//                flapping, with two pale eye glints while they hunt.
//   THE TELLS    of a hollow wall not yet open (features/mining.js: C.hollows): within a few metres his lantern's flame leans
//                toward it (F.lean: render/lighting.js moves the lantern's light by it) and now and then dust trickles down it.
// MULTIPLAYER: the soot things are the server's (one flock for everyone: they go for whichever of you is lit); the rock-things and
//   the tells are each player's own view.
// OWNS: the soot things offline (their state), the rock-things (view), F.lean, the dust, their meshes.
// READS: host.world.cave, host.player, caves (lit, snuff), builds (shining), coop (online, net, mail), mining (isSpent), trip
//   (tripping). EMITS: critter.wake.
// BUDGET: sim: the soot rules (2-4 things, a few hypots each) a step offline. View: a matrix per rock-thing and soot thing within
//   sight; the tells' distance checks (1-2 hollows). No allocation per step or frame.
import * as THREE from 'three';
import {SOOT, CRITTER} from '../content/cavelife.js';
import {createSoot} from '../sim/cavelife.js';
import {flags} from '../core/flags.js';
import {simRandom, viewRandom} from '../core/rng.js';
import {geoOf, box, along} from '../world/kit3d.js';

const ON = flags.get('cavelife') !== '0';
const SNUFFERS = (v => v === null || v === '' || !isFinite(+v) ? undefined : Math.max(0, +v))(flags.get('snuffers'));
const SIGHT = 22;     // m: things farther from him aren't moved or drawn
const LEAN = {r: 5, m: .22};   // the lantern's lean: within r m of a closed hollow wall, up to m metres toward it
const DUST = {r: 7, every: [2.5, 5.5]};   // dust down a closed hollow wall while he is within r m: every s (min, max)

export const order = {after: ['coop', 'caves', 'builds', 'mining', 'trip']};

export async function create(host) {
  const R = simRandom('cavelife'), VR = viewRandom('cavelife');
  const game = () => host.feature('game'), coop = () => host.feature('coop'), caves = () => host.feature('caves');
  const online = () => !!coop()?.online;
  const active = () => ON && !!C && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  let C = null, S = null, marks = flags.get('gathermarks') === '1';
  const ME = {id: 0, x: 0, y: 0, z: 0, lit: false}, PLS = [ME], SHINE = [];
  const F = {name: 'cavelife', label: 'Cave life', on: ON, lean: {x: 0, y: 0}, get soot() { return S; }};   // (soot: tests)

  // ---------------------------------------------------------------- the plan's things (another cave: made again)
  const crit = [];   // {x, y, z, yaw, mode (0 curled, 1 unrolling, 2 trotting, 3 curling), t, rest, tx, ty, near, m (body), l (legs), v}
  function index() {
    const c = host.world?.cave || null; if (c === C) return;
    C = c; S = C ? createSoot(C, R, SNUFFERS) : null;
    for (const k of crit) { k.m?.dispose(); k.l?.dispose(); } crit.length = 0;
    for (const s of soot) { s.m?.dispose(); } soot.length = 0;
    for (const q of C?.critters || []) crit.push({x: q.x, y: q.y, z: 0, yaw: VR() * 6.28, mode: 0, t: 0, rest: 0, tx: 0, ty: 0, near: 0, m: null, l: null, v: q.v, leg: 0});
  }

  // ---------------------------------------------------------------- the sim: the soot things offline, a snuff online
  F.update = (dt) => {
    if (!ON) return;
    index();
    if (!active() || !S) return;
    const cv = caves(), c = coop();
    if (online()) {
      if (c.mail) for (let k = 0; k < c.mail.length; k++) { const m = c.mail[k]; if (m.k === 'ev' && m.a === 'snuff' && m.id === c.net?.id) cv?.snuff?.(); }
      return;
    }
    const P = host.player; ME.x = P.x; ME.y = P.y; ME.z = P.z; ME.lit = !!cv?.lit;
    host.feature('builds')?.shining?.(SHINE);
    const ev = S.step(dt, PLS, SHINE);
    for (let k = 0; k < ev.length; k++) if (ev[k].a === 'snuff' && ev[k].id === 0) cv?.snuff?.();
  };

  // ---------------------------------------------------------------- the view: shapes
  // a rock-thing: a lumpy grey stone (its own rock family, as the loose rocks are), and its legs (two strides: A, B; curled: tucked)
  const GEO = {};
  const bodyGeo = v => GEO['b' + v] ??= geoOf([
    box('rock', [.42, .24, .34], [0, .13, 0], [.1 + v * .2, v * .7, .08]),
    box('rock', [.3, .2, .28], [.07 - v * .05, .2, -.04], [.4, .3 + v, .2]),
    box('stone', [.18, .1, .16], [-.12, .25, .07], [.2, v, .5]),
  ]);
  const legsGeo = k => GEO['l' + k] ??= geoOf(Array.from({length: 8}, (_, i) => {
    const side = i % 2 ? 1 : -1, row = (i >> 1) - 1.5, ph = (i + (i >> 1)) % 2 === k % 2 ? 1 : -1;
    if (k === 2) return {...along([side * .12, .08, row * .08], [side * .22, .02, row * .1], .018, .014, 4), fam: 'elkleg'};   // (tucked)
    const fx = side * .36, fz = row * .12 + ph * .08;
    return {...along([side * .14, .14, row * .08], [fx, 0, fz], .022, .016, 4), fam: 'elkleg'};
  }));
  // a soot thing: a sooty puff of a body, its wings up or down
  const sootGeo = k => GEO['s' + k] ??= geoOf([
    box('plumage', [.16, .13, .19], [0, 0, 0], [.2, 0, .1]),
    box('char', [.1, .09, .1], [0, .03, .12], [.3, .2, 0]),
    box('plumage', [.26, .02, .15], [.19, k ? .09 : -.06, 0], [0, 0, k ? .55 : -.35]),
    box('plumage', [.26, .02, .15], [-.19, k ? .09 : -.06, 0], [0, 0, k ? -.55 : .35]),
  ]);
  const soot = [];   // {m, k (wing), t}
  const MX = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), V3 = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  const place = (m, x, h, y, yaw, s = 1) => m.setMatrix(MX.compose(V3.set(x, h, y), Q4.setFromAxisAngle(UP, yaw), ONE.set(s, s, s)));

  // ---------------------------------------------------------------- rock-things
  function stepCrit(k, dt, P, trip) {
    const d = Math.hypot(P.x - k.x, P.y - k.y);
    k.rest = Math.max(0, k.rest - dt);
    if (k.mode === 0) {
      k.near = d < CRITTER.wake && Math.abs(P.z - k.z) < 1.2 && !k.rest ? k.near + dt : 0;
      if (k.near > .6 && pickSpot(k, P)) { k.mode = 1; k.t = 0; emit(k); }
    } else if (k.mode === 1) { if ((k.t += dt) > .35) { k.mode = 2; k.t = 0; } }
    else if (k.mode === 2) {
      k.t += dt; const dx = k.tx - k.x, dy = k.ty - k.y, l = Math.hypot(dx, dy), st = Math.min(l, CRITTER.speed * dt);
      if (l > .02) { k.x += dx / l * st; k.y += dy / l * st; k.yaw = Math.atan2(dx, dy); }
      k.leg = (k.leg + dt * 9) % 2;
      if (l < .05 || k.t > 4) { k.mode = 3; k.t = 0; }
    } else if ((k.t += dt) > .35) { k.mode = 0; k.rest = CRITTER.rest; k.near = 0; }
    k.z = host.elev(k.x, k.y);
  }
  function pickSpot(k, P) {   // away from him, on open floor a few metres off, not up or down a step
    const a0 = Math.atan2(k.x - P.x, k.y - P.y), T = CRITTER.trot;
    for (let n = 0; n < 8; n++) {
      const a = a0 + (VR() - .5) * (n < 4 ? 1.4 : 3.2), r = T[0] + VR() * (T[1] - T[0]), x = k.x + Math.sin(a) * r, y = k.y + Math.cos(a) * r;
      if (C.inside(x, y) > -.3 || C.inside((x + k.x) / 2, (y + k.y) / 2) > -.2 || Math.abs(host.elev(x, y) - k.z) > .5) continue;
      k.tx = x; k.ty = y; return true;
    }
    return false;
  }
  let wakeCd = 0;
  function emit(k) { if (wakeCd > 0 || !host.events) return; wakeCd = .5; host.events.push({type: 'critter.wake', x: k.x, y: k.y, i: crit.indexOf(k)}); }
  function drawCrit(k, trip) {
    if (!k.m) { k.m = host.world.mesh(bodyGeo(k.v), new THREE.Matrix4()); k.l = host.world.mesh(legsGeo(2), new THREE.Matrix4()); k.lk = 2; }
    // curled: on the floor; unrolling / curling: rising on its legs; trotting: up, bobbing
    const up = k.mode === 1 ? k.t / .35 : k.mode === 3 ? 1 - k.t / .35 : k.mode === 2 ? 1 : 0, bob = k.mode === 2 ? Math.abs(Math.sin(k.leg * Math.PI)) * .025 : 0;
    const lk = up > .5 ? (k.mode === 2 ? (k.leg < 1 ? 0 : 1) : 0) : 2;
    if (lk !== k.lk) { k.lk = lk; k.l.setGeometry(legsGeo(lk)); }
    place(k.m, k.x, k.z + up * .17 + bob, k.y, k.yaw, 1.2);
    place(k.l, k.x, k.z + up * .17 + bob, k.y, k.yaw, 1.2);
    k.m.setVisible(true); k.l.setVisible(up > 0 || trip);
  }

  // ---------------------------------------------------------------- soot things: offline from S.things, online from the snapshots
  const SMP = {x: 0, y: 0, z: 0, phi: 0, s: 0, pose: '', w: null, ls: null};
  function drawSoot(dt, P) {
    const ol = online(), net = coop()?.net, n = ol ? (net?.soot?.length || 0) : S.things.length;
    for (let i = 0; i < n; i++) {
      let x, y, h, mode;
      if (ol) { if (!net.sample(net.soot[i], SMP)) continue; x = SMP.x; y = SMP.y; h = SMP.z; mode = SMP.s | 0; }
      else { const t = S.things[i]; x = t.x; y = t.y; h = t.h; mode = t.mode; }
      const o = soot[i] ??= {m: null, k: 0, t: VR(), px: x, py: y, yaw: 0};
      if (!o.m) o.m = host.world.mesh(sootGeo(0), new THREE.Matrix4());
      const far = Math.abs(x - P.x) > SIGHT || Math.abs(y - P.y) > SIGHT; o.m.setVisible(!far); if (far) continue;
      o.t += dt * (mode === 0 ? 5 : 11);
      const k = (o.t % 1) < .5 ? 1 : 0; if (k !== o.k) { o.k = k; o.m.setGeometry(sootGeo(k)); }
      const vx = x - o.px, vy = y - o.py; if (vx * vx + vy * vy > 1e-6) o.yaw = Math.atan2(vx, vy); o.px = x; o.py = y;
      const jx = Math.sin(o.t * 7.3) * .03, jy = Math.cos(o.t * 6.1) * .03, jh = Math.sin(o.t * 9.7) * .04;
      place(o.m, x + jx, h + jh, y + jy, o.yaw);
      if (mode === 1 || mode === 2) {   // the hunt: two pale eye glints, a speck of soot shed now and then
        const ex = Math.cos(o.yaw) * .04, ey = -Math.sin(o.yaw) * .04, fx = Math.sin(o.yaw) * .11, fy = Math.cos(o.yaw) * .11;
        host.point(x + jx + fx + ex, y + jy + fy + ey, h + jh + .03, '#e6dcb4'); host.point(x + jx + fx - ex, y + jy + fy - ey, h + jh + .03, '#e6dcb4');
        if (VR() < dt * 6) dust(x, y, h, 1, '#141216', -.4);
      }
    }
  }

  // ---------------------------------------------------------------- the tells of a closed hollow wall: the lean, the dust
  const DP = [];   // {x, y, h, vx, vy, vh, t, life, col, g}
  function dust(x, y, h, n, col, g) {
    for (let i = 0; i < n && DP.length < 80; i++) DP.push({x: x + (VR() - .5) * .3, y: y + (VR() - .5) * .3, h, vx: (VR() - .5) * .1, vy: (VR() - .5) * .1, vh: 0, t: 0, life: 1.2 + VR() * 1.2, col, g});
  }
  let dustT = 2, viewT = 0;
  function tells(dt, P) {
    const L = F.lean, mn = host.feature('mining'); let best = null, bd = 1e9;
    for (const h of C.hollows || []) {
      if (mn?.isSpent?.(h.vein)) continue;
      const d = Math.hypot(h.x - P.x, h.y - P.y); if (d < bd) { bd = d; best = h; }
    }
    let tx = 0, ty = 0;
    if (best && bd < LEAN.r && caves()?.lit) {   // the flame leans toward the draught through the rubble, flickering
      const k = (1 - bd / LEAN.r) * LEAN.m * (.75 + .25 * Math.sin(viewT * 5.3) * Math.sin(viewT * 2.1));
      tx = (best.x - P.x) / (bd || 1) * k; ty = (best.y - P.y) / (bd || 1) * k;
    }
    L.x += (tx - L.x) * Math.min(1, dt * 4); L.y += (ty - L.y) * Math.min(1, dt * 4);
    if (best && bd < DUST.r && (dustT -= dt) <= 0) {   // a trickle of dust down the plug
      dustT = DUST.every[0] + VR() * (DUST.every[1] - DUST.every[0]);
      const tx2 = best.ny, ty2 = -best.nx, a = (VR() - .5) * 1.4, z = host.elev(best.x + best.nx * .4, best.y + best.ny * .4);
      dust(best.x + tx2 * a + best.nx * .05, best.y + ty2 * a + best.ny * .05, z + 2.2 + VR() * .8, 6 + (VR() * 6 | 0), '#9a8c72', 1.2);
    }
  }

  F.view = (dt, evs) => {
    if (!ON) return;
    if (!active() || !host.world?.mesh) { F.lean.x = F.lean.y = 0; hideAll(); return; }
    const P = host.player, trip = !!host.feature('trip')?.tripping;
    wakeCd -= dt; viewT += dt;
    for (const k of crit) {
      if (Math.abs(k.x - P.x) > SIGHT || Math.abs(k.y - P.y) > SIGHT) { if (k.m) { k.m.setVisible(false); k.l.setVisible(false); } continue; }
      stepCrit(k, dt, P, trip); drawCrit(k, trip);
    }
    if (S) drawSoot(dt, P);
    tells(dt, P);
    for (let i = 0; i < evs.length; i++) if (evs[i].type === 'mine.open') { const e = evs[i]; for (let j = 0; j < 4; j++) dust(e.cx + (VR() - .5), e.cy + (VR() - .5), host.elev(e.cx, e.cy) + 1 + VR(), 8, '#a89a80', .3); }
    for (let i = DP.length - 1; i >= 0; i--) {
      const c = DP[i]; c.t += dt; if (c.t > c.life) { DP.splice(i, 1); continue; }
      c.vh -= c.g * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.h += c.vh * dt;
      const g = host.elev(c.x, c.y); if (c.h < g) { c.h = g; c.vh = 0; c.vx = c.vy = 0; }
    }
  };
  function hideAll() { for (const k of crit) if (k.m) { k.m.setVisible(false); k.l.setVisible(false); } for (const o of soot) o?.m?.setVisible(false); }
  F.frame = () => {
    for (let i = 0; i < DP.length; i++) { const c = DP[i]; host.point(c.x, c.y, c.h, c.col); }
    if (!marks || !active()) return;   // ?gathermarks=1: dev dots (pale: a rock-thing, black-red: a soot roost)
    const P = host.player;
    for (const k of crit) if (Math.abs(k.x - P.x) < 16 && Math.abs(k.y - P.y) < 12) host.point(k.x, k.y, k.z + .7, '#e8dcc0');
    for (const r of C.soot || []) if (Math.abs(r.x - P.x) < 16 && Math.abs(r.y - P.y) < 12) host.point(r.x, r.y, r.h + 3, '#a02020');
  };
  F.menu = () => {
    if (!ON || game()?.mode !== 'sandbox' || !C) return [];
    return [
      {label: `Cave life: marks ${marks ? '(on)' : '(off)'}`, run: () => { marks = !marks; }},
      {label: 'Cave life: to the soot things\' roost', run: () => { const r = C.soot?.[0]; if (r) host.teleport(r.x, r.y + 1); }},
      {label: 'Cave life: to a rock-thing', run: () => { const k = crit[hop++ % (crit.length || 1)]; if (k) host.teleport(k.x, k.y + 2.4); }},
    ];
  };
  let hop = 0;
  F.hud = () => {
    if (!active() || !S) return '';
    const ol = online(), n = ol ? coop()?.net?.soot?.length || 0 : S.things.length;
    return `cavelife soot ${n}${ol ? ' (server)' : ' ' + S.things.map(t => 'rscb'[t.mode]).join('')} · rock-things ${crit.length} · lean ${Math.hypot(F.lean.x, F.lean.y).toFixed(2)}`;
  };
  F.biomeChanged = () => { for (const k of crit) { k.m = null; k.l = null; } for (const o of soot) if (o) o.m = null; };   // (the rebuild disposed the world's meshes)
  return F;
}
