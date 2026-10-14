// THE BIRDS IN THE CROWNS (view; part of features/fauna.js): now and then a tree has birds up in it you never see, until something
// startles them: a shot, an axe in the trunk, a tree coming down, something breaking. Then a little flock of chaffinches bursts out
// of the top of the crown (or a wood pigeon or two, with a clatter), the crown shakes and lets a leaf go (wind.js, as for the
// arena's birds), and they beat away from the noise, climbing, and are gone.
//   which trees: each tree has birds or not by a hash of where it stands and the clock (a new draw every 20 game minutes), by
//   day only; the tree you chop is likelier (TUNE.crown.own). A tree that has just emptied stays empty a while (cd, real s), so the
//   first shot in a stretch of woods empties a crown or two and the next ones mostly find them gone
//   const C = createCrownBirds(host, TUNE, emit); C.events(evs) (in the view step); C.step(dt); C.frame(); C.hideAll(); C.drop()
// OWNS: its flying birds and their meshes (a pool, made the first time). READS: host.entities.near (trees round a noise),
// host.itemOf (a tree's crown height), host.env.hour, host.elev, G.onScreen. EMITS (through fauna's emit, near the player):
// wildlife.birds_scatter, wildlife.wings; and wildlife.bird_perch {off: true, scared: true} for the wind's crown shake.
// BUDGET: nothing until a noise; a noise looks at the trees within its reach (entities.near); a few matrices a frame per bird.
import * as THREE from 'three';
import {hash3, clamp} from '../../core/mathx.js';
import {recipeGeo} from '../../world/recipe3d.js';

const POOL = {finch: 18, woodpigeon: 4};
export function createCrownBirds(host, TUNE, emit) {
  const T = TUNE.crown, R = Math.random, rr = (a, b) => a + (b - a) * R();
  const NB = [], empty = new Map();   // fid -> game time (s) it emptied
  const birds = [];   // the pool: {sp, m (mesh), on, x, y, h, vx, vy, vz, flap, t}
  let built = false;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
  function build() {
    built = true;
    for (const sp in POOL) {
      const g = recipeGeo(sp, 0, null, host.biome?.id || 'ruins'); if (!g) continue;
      for (let i = 0; i < POOL[sp]; i++) {
        const m = host.world.mesh(g.geo); m.sm.layers.disable(1); m.setVisible(false);
        birds.push({sp, m, on: false, x: 0, y: 0, h: 0, vx: 0, vy: 0, vz: 0, flap: 0, t: 0, ph: 0});
      }
    }
  }
  let clock = 0;   // s (real: the step's), for the empty trees' wait
  const now = () => clock;
  // has this tree birds in it now (by day; a draw every 20 game minutes)
  function holds(p, own) {
    const hr = host.env?.hour ?? 12; if (hr < T.hours[0] || hr > T.hours[1]) return false;
    const e = empty.get(p.fid); if (e !== undefined && now() - e < T.cd) return false;
    return hash3(Math.round(p.x * 10), Math.round(p.y * 10), Math.floor(hr * 3)) < (own ? T.own : T.chance);
  }
  function crownTop(p) {
    const ps = host.itemOf?.(p)?.pose, C = ps?.crown;   // (the model's crown: its top, x the model's scale, as woodcut.js reads it)
    return host.elev(p.x, p.y) + (C ? C.y1 * (ps.scale || 1) * .92 : 6 * (p.scale || 1));
  }
  // a noise at (x, y) with this reach: the trees in reach that hold birds let them go (the nearer, the likelier); own: the tree hit
  function noise(x, y, r, own = null) {
    let n = 0;
    if (own && own.fid && holds(own, true)) { burst(own, x, y); n++; }
    for (const p of host.entities.near(x, y, r, NB)) {
      if (n >= T.max) break;
      if (p === own || p.kind !== 'tree' || p.gone || typeof p.fid !== 'string' || !holds(p, false)) continue;
      if (R() > 1 - Math.hypot(p.x - x, p.y - y) / r * .7) continue;   // (the far ones less often)
      burst(p, x, y); n++;
    }
  }
  function burst(p, fx, fy) {
    if (!built) build();
    empty.set(p.fid, now()); if (empty.size > 300) empty.clear();
    const pigeon = R() < T.pigeon, sp = pigeon ? 'woodpigeon' : 'finch', n = pigeon ? (R() < .5 ? 1 : 2) : 3 + (R() * 5 | 0);
    const top = crownTop(p), away = Math.atan2(p.y - fy, p.x - fx) + (fx === p.x && fy === p.y ? R() * 6.28 : 0);
    let got = 0;
    for (const b of birds) {
      if (got >= n) break;
      if (b.on || b.sp !== sp) continue;
      const a = away + rr(-.9, .9), v = pigeon ? rr(7, 9) : rr(5.5, 8);
      b.on = true; b.t = 0; b.ph = R() * 6.28; b.flap = 0;
      b.x = p.x + rr(-.8, .8); b.y = p.y + rr(-.8, .8); b.h = top + rr(-.6, .3);
      b.vx = Math.cos(a) * v; b.vy = Math.sin(a) * v; b.vz = rr(2, 3.5);
      got++;
    }
    if (!got) return;
    emit(pigeon ? 'wildlife.wings' : 'wildlife.birds_scatter', p, pigeon ? null : {n: got});
    if (host.events) host.events.push({type: 'wildlife.bird_perch', x: p.x, y: p.y, h: top, prop: p, off: true, big: pigeon, scared: true});
  }
  // the view step's events: what startles them
  function events(evs) {
    if (!evs) return;
    for (const e of evs) {
      if (e.x === undefined) continue;
      switch (e.type) {
        case 'player.shoot': case 'foe.shoot': noise(e.x, e.y, T.shot); break;
        case 'tree.chop': noise(e.x, e.y, T.chop, e.who || null); break;
        case 'tree.fell': noise(e.x, e.y, T.fell, e.who || null); break;   // (its own birds go as it starts to fall)
        case 'prop.break': case 'arrow.hit': noise(e.x, e.y, T.brk); break;
        case 'bullet.impact': if (e.surf === 'tree' || e.surf === 'prop') noise(e.x, e.y, T.brk); break;
        case 'combat.explode': noise(e.x, e.y, T.blast); break;
      }
    }
  }
  function step(dt) {
    clock += dt;
    for (const b of birds) {
      if (!b.on) continue;
      b.t += dt;
      b.vz += ((b.sp === 'woodpigeon' ? 1.2 : 1.6) - b.vz) * Math.min(1, dt * 1.5);   // (a steady climb after the burst)
      const turn = Math.sin(b.t * 2 + b.ph) * .6 * dt, c = Math.cos(turn), s = Math.sin(turn), vx = b.vx;
      b.vx = vx * c - b.vy * s; b.vy = vx * s + b.vy * c;   // (a little weave)
      b.x += b.vx * dt; b.y += b.vy * dt; b.h += b.vz * dt;
      b.flap += dt * (b.sp === 'woodpigeon' ? 14 : 24);
      if (b.t > 7 || (b.t > 1.5 && !host.G.onScreen(b.x, b.h, b.y, 30))) { b.on = false; b.m.setVisible(false); }
    }
  }
  function frame() {
    for (const b of birds) {
      if (!b.on) continue;
      const k = b.t > 6.4 ? clamp((7 - b.t) / .6, 0, 1) : 1, beat = .35 + .65 * Math.abs(Math.cos(b.flap));   // (wings: the span beats)
      Q.setFromEuler(E.set(Math.sin(b.flap) * .15, -Math.atan2(b.vy, b.vx), clamp(b.vz * .08, -.3, .4), 'YZX'));
      M.compose(V.set(b.x, b.h, b.y), Q, S.set(k, k, k * beat));
      b.m.setMatrix(M); b.m.setVisible(true);
    }
  }
  return {
    events, step, frame, noise, birds,   // (birds: for tests)
    hideAll() { for (const b of birds) { b.on = false; b.m.setVisible(false); } },
    drop() { birds.length = 0; built = false; },   // (the world's rebuild disposed the meshes)
    get flying() { let n = 0; for (const b of birds) if (b.on) n++; return n; },
  };
}
