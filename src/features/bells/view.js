// BELLS AND PLATES, the VIEW (features/bells.js): how they look and swing. Reads the sim (features/bells/sim.js) and its
// events, writes only its own state; with ?views=0 or the feature's look off nothing in play changes.
//   meshes   every post, plate and gallows in ONE static mesh (it never moves: the cached static sun shadow, sScene layers
//            1 + 2; made again when the sim's stands change), each bell a mesh of its own: static while it hangs still, and
//            while it swings gfx casts it per frame (layer 0) until it has been still a moment (gfx.js mesh {static})
//   swing    a ring (bells.ring) kicks its bell along the blow: a damped pendulum about its hook; the clapper inside hangs
//            on its own and lags, and where it meets the bell's wall it strikes it again (bells.toll: audio rings the note
//            softer), so a struck bell rings on a moment as it swings
//   sparks   an arrow glancing off steel (a bullet's: gunfx's ricochet sparks)
//   marks    a nest's standing spot: a faint worn crescent on the ground, facing its plate
//   HD       a chain (bells.chain): a floating line where it ended ("2 bells, one bullet", "3 ricochets"), the session's best
// OWNS: its meshes (host.world.mesh; a rebuilt world disposes them: made again at the next draw), the swings (a typed array),
//   the spark pool, the floats.
// READS: the sim (stands, bells, nests, ver), host (world, G, zoom, point, events, elev).
// EMITS: bells.toll (core/events.js; a view's: nothing in the sim listens).
// BUDGET: frame: a setMatrix per swinging bell, <= 64 spark points, the marks' points when on screen; HD only while a float shows.
import * as THREE from 'three';
import {standsGeometry, bellGeometry, bellDrop} from './models.js';
import {viewRandom} from '../../core/rng.js';
import {rgbOf} from '../../core/color.js';
import {clamp, hypot2} from '../../core/mathx.js';

export const TUNE = {
  swing: {g: 9.8, damp: 1.5, kick: 1.7, max: .45},     // the bell: m/s^2 (its pendulum's), 1/s, rad/s per ring (x k), rad at most
  clapper: {len: .7, damp: .9, lim: .2, e: .35, min: .7, gap: .12},   // x the bell's drop; 1/s; rad off the bell's axis to its wall; restitution; rad/s to toll; s between tolls
  sparks: {max: 64, n: 7, speed: [1.2, 3.2], life: [.12, .3], g: 6},
  float: {life: 1.9, rise: .55},
  mark: {r: .32, n: 7},
};
const SPARK = [rgbOf('#fff6d0'), rgbOf('#ffc860'), rgbOf('#e07a2a')], MARK = rgbOf('#d8cba8'), MARK2 = rgbOf('#a09070');
const FONT = '"Segoe UI", system-ui, sans-serif';
const NSW = 12;   // a swing's record: ax, ay, wx, wy (the bell: tilt rad toward +x / +y, rad/s), cx, cy, vx, vy (the clapper), toll timer, shown ax, ay, -

export function createBellsView(host, S) {
  const V = viewRandom('bells'), VR = (a, b) => a + V() * (b - a);
  let M = null, made = -1, geo = null;   // {stands, bells: []} | null; the sim's ver it was made for (+ the stands up); the stands' geometry
  const SW = new Float64Array(16 * NSW);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _a = new THREE.Vector3(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const upCount = () => { let n = 0; for (let i = 0; i < S.stands.length; i++) if (S.stands[i].up) n++; return n; };
  function make() {
    drop();
    const sig = S.ver * 64 + upCount();
    M = {stands: null, bells: []};
    geo?.dispose(); geo = standsGeometry(S.stands.filter(s => s.up));   // (a one-off: a build, a stand coming up)
    if (geo) M.stands = host.world.mesh(geo, null, {static: true, occlude: true});
    // (static: a still bell's shadow is in the cached static map; swinging, gfx casts it per frame, layer 0, till it is still)
    for (const s of S.bells) M.bells.push(host.world.mesh(bellGeometry(s.note), _m.makeTranslation(s.x, s.h + bellDrop(s.note), s.y), {static: true}));
    for (let i = 0; i < S.bells.length; i++) { SW.fill(0, i * NSW, i * NSW + NSW); SW[i * NSW + 9] = SW[i * NSW + 10] = NaN; }
    made = sig;
  }
  function drop() {
    if (M) { M.stands?.dispose(); for (const m of M.bells) m.dispose(); }
    M = null; made = -1; geo?.dispose(); geo = null;
  }

  // ---- sparks (structure of arrays)
  const NS = TUNE.sparks.max, sx = new Float32Array(NS), sy = new Float32Array(NS), sh = new Float32Array(NS), svx = new Float32Array(NS),
    svy = new Float32Array(NS), svh = new Float32Array(NS), st = new Float32Array(NS), sl = new Float32Array(NS);
  let nS = 0;
  function sparks(e) {
    const T = TUNE.sparks;
    for (let i = 0; i < T.n && nS < NS; i++) {
      const k = nS++, v = VR(T.speed[0], T.speed[1]), a = VR(-.6, .6), c = Math.cos(a), s = Math.sin(a), ux = e.dx || 0, uy = e.dy || 0;
      sx[k] = e.x; sy[k] = e.y; sh[k] = e.h; svx[k] = (ux * c - uy * s) * v; svy[k] = (uy * c + ux * s) * v; svh[k] = (e.dh || 0) * v + VR(0, 1.2);
      st[k] = 0; sl[k] = VR(T.life[0], T.life[1]);
    }
  }
  function stepSparks(dt) {
    const g = TUNE.sparks.g;
    for (let i = nS - 1; i >= 0; i--) {
      st[i] += dt;
      if (st[i] >= sl[i]) { nS--; sx[i] = sx[nS]; sy[i] = sy[nS]; sh[i] = sh[nS]; svx[i] = svx[nS]; svy[i] = svy[nS]; svh[i] = svh[nS]; st[i] = st[nS]; sl[i] = sl[nS]; continue; }
      svh[i] -= g * dt; sx[i] += svx[i] * dt; sy[i] += svy[i] * dt; sh[i] += svh[i] * dt;
    }
  }

  // ---- floats: "2 bells, one bullet" where a chain ended (reused records)
  const floats = [], fpool = [];
  function float(e) {
    const f = fpool.pop() || {x: 0, y: 0, h: 0, t: 0, a: '', b: '', best: false, big: false};
    const what = e.by === 'arrow' ? 'one arrow' : e.by === 'blast' ? 'one blast' : 'one bullet';
    f.a = e.bells >= 2 ? `${e.bells} bells, ${what}` : e.bells === 1 && e.plates >= 1 && e.n === 2 ? 'Bank shot' : `${e.n} ricochets`;
    if (e.bells >= 1 && e.bells < 2 && e.n > 2) f.a = `${e.n} ricochets, a bell`;
    f.b = e.best ? 'new best!' : e.by !== 'blast' && e.rec > 0 ? `best chain ${e.rec}` : '';
    f.best = !!e.best; f.big = e.n >= 4 || e.bells >= 3;
    f.x = e.x; f.y = e.y; f.h = (e.h || 1.2) + .35; f.t = 0;
    floats.push(f); if (floats.length > 6) fpool.push(floats.shift());
  }

  // ---- the swing: a ring kicks its bell; the clapper lags and strikes the wall again
  function kick(i, k, dx, dy) {
    const o = i * NSW, l = hypot2(dx, dy), K = TUNE.swing.kick * k;
    if (l > 1e-3) { SW[o + 2] += dx / l * K; SW[o + 3] += dy / l * K; }
    else { const a = V() * Math.PI * 2; SW[o + 2] += Math.cos(a) * K * .5; SW[o + 3] += Math.sin(a) * K * .5; }
  }
  function swing(i, dt) {
    const o = i * NSW, s = S.bells[i], T = TUNE.swing, C = TUNE.clapper, L = bellDrop(s.note) + .02, w2 = T.g / L, c2 = T.g / (L * C.len);
    if (SW[o] === 0 && SW[o + 1] === 0 && SW[o + 2] === 0 && SW[o + 3] === 0 && SW[o + 4] === 0 && SW[o + 5] === 0 && SW[o + 6] === 0 && SW[o + 7] === 0) return;
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let k = 0; k < n; k++) {
      // the bell about its hook; the clapper (hung near the hook) on its own, lagging
      SW[o + 2] += (-w2 * SW[o] - T.damp * SW[o + 2]) * h; SW[o + 3] += (-w2 * SW[o + 1] - T.damp * SW[o + 3]) * h;
      SW[o] = clamp(SW[o] + SW[o + 2] * h, -T.max, T.max); SW[o + 1] = clamp(SW[o + 1] + SW[o + 3] * h, -T.max, T.max);
      SW[o + 6] += (-c2 * SW[o + 4] - C.damp * SW[o + 6]) * h; SW[o + 7] += (-c2 * SW[o + 5] - C.damp * SW[o + 7]) * h;
      SW[o + 4] += SW[o + 6] * h; SW[o + 5] += SW[o + 7] * h;
      // it meets the wall: back off it (restitution e), and a toll if it came in hard enough
      const rx = SW[o + 4] - SW[o], ry = SW[o + 5] - SW[o + 1], r = hypot2(rx, ry);
      if (r > C.lim) {
        const ux = rx / r, uy = ry / r, vr = (SW[o + 6] - SW[o + 2]) * ux + (SW[o + 7] - SW[o + 3]) * uy;
        SW[o + 4] = SW[o] + ux * C.lim; SW[o + 5] = SW[o + 1] + uy * C.lim;
        if (vr > 0) {
          SW[o + 6] -= (1 + C.e) * vr * ux; SW[o + 7] -= (1 + C.e) * vr * uy;
          if (vr > C.min && SW[o + 8] <= 0) {
            SW[o + 8] = C.gap;
            host.events.push({type: 'bells.toll', x: s.x, y: s.y, h: s.h, k: clamp(vr / 3.2, .12, .7), note: s.note, who: s.p});
          }
        }
      }
    }
    SW[o + 8] = Math.max(0, SW[o + 8] - dt);
    // settled: still
    let e = 0; for (let j = 0; j < 8; j++) e += Math.abs(SW[o + j]);
    if (e < 2e-3) for (let j = 0; j < 8; j++) SW[o + j] = 0;
  }

  // ---- the step
  const bellIndex = p => { const s = S.byProp.get(p); return s && s.kind === 'bell' ? s.i : -1; };
  function view(dt, evs) {
    for (let k = 0; k < evs.length; k++) {
      const e = evs[k];
      switch (e.type) {
        case 'bells.ring': { const i = bellIndex(e.who); if (i >= 0 && i < 16) kick(i, e.k || 1, e.dx || 0, e.dy || 0); break; }
        case 'bells.chain': float(e); break;
        case 'arrow.deflect': if (S.byProp.has(e.who)) sparks(e); break;
      }
    }
    for (let i = 0; i < S.bells.length && i < 16; i++) swing(i, dt);
    stepSparks(dt);
    for (let i = floats.length - 1; i >= 0; i--) { const f = floats[i]; f.t += dt; if (f.t > TUNE.float.life) fpool.push(floats.splice(i, 1)[0]); }
  }

  // ---- the draw
  const PT = [{size: 1, emit: true, alpha: 1}, {size: 1, emit: false, alpha: .7}];
  function frame() {
    if (!S.active) { if (M) drop(); return; }
    if (!M || made !== S.ver * 64 + upCount()) make();
    for (let i = 0; i < M.bells.length && i < 16; i++) {
      const o = i * NSW, ax = SW[o], ay = SW[o + 1];
      if (ax === SW[o + 9] && ay === SW[o + 10]) continue;
      SW[o + 9] = ax; SW[o + 10] = ay;
      const s = S.bells[i], a = hypot2(ax, ay);
      if (a > 1e-6) _q.setFromAxisAngle(_a.set(-ay / a, 0, ax / a), a); else _q.identity();   // (the bell's foot swings toward +x by ax, +y by ay)
      M.bells[i].setVisible(s.up);
      M.bells[i].setMatrix(_m.compose(_p.set(s.x, s.h + bellDrop(s.note), s.y), _q, _s));
    }
    const z = host.zoom || 1;
    PT[0].size = PT[1].size = z;
    for (let i = 0; i < nS; i++) host.point(sx[i], sy[i], sh[i], SPARK[st[i] / sl[i] < .3 ? 0 : st[i] / sl[i] < .65 ? 1 : 2], PT[0]);
    // the nests' standing spots: a worn crescent facing the plate
    const K = TUNE.mark;
    for (const n of S.nests) {
      if (!host.G.onScreen(n.sx, 0, n.sy, 30)) continue;
      const gz = host.elev(n.sx, n.sy) + .015;
      for (let k = 0; k < K.n; k++) {
        const a = n.a + Math.PI + (k / (K.n - 1) - .5) * 2.2;
        host.point(n.sx + Math.cos(a) * K.r, n.sy + Math.sin(a) * K.r, gz, k % 3 === 1 ? MARK2 : MARK, PT[1]);
      }
    }
  }

  // ---- HD: the floats
  const SC = [0, 0, 0];
  function text(q, s, x, y, size, col) {
    q.font = `700 ${Math.round(size)}px ${FONT}`; q.textAlign = 'center'; q.textBaseline = 'alphabetic';
    q.lineJoin = 'round'; q.lineWidth = Math.max(2, size * .22); q.strokeStyle = 'rgba(10,8,12,.9)'; q.strokeText(s, x, y); q.fillStyle = col; q.fillText(s, x, y);
  }
  function hd(q, sc) {
    if (!floats.length) return;
    const u = clamp(sc / 2.6, .7, 2.8), T = TUNE.float;
    for (const f of floats) {
      const k = f.t / T.life, a = k < .08 ? k / .08 : k > .7 ? (1 - k) / .3 : 1;
      host.G.toScreenInto(f.x, f.h + k * T.rise, f.y, SC);
      q.globalAlpha = a;
      text(q, f.a, SC[0] * sc, SC[1] * sc, (f.big ? 17 : 14) * u, f.big ? '#ffb040' : '#f2d27a');
      if (f.b) text(q, f.b, SC[0] * sc, SC[1] * sc + 14 * u, 11 * u, f.best ? '#9af07a' : '#e8e2d2');
      q.globalAlpha = 1;
    }
  }

  return {view, frame, hd, drop, biomeChanged() { M = null; made = -1; geo?.dispose(); geo = null; },   // (the rebuilt world disposed the meshes)
    get busy() { return nS > 0 || floats.length > 0; }, get meshes() { return M; }, get swings() { return SW; }, get floats() { return floats; }};
}
