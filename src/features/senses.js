// SENSES (view only): what the player notices, for the live hero's reactions (view/livehero.js REACTIONS: the head's
// look, the flinches; docs/exp/livereact.md). Each frame it gathers what is worth a look into a small pool of stimuli
// (where, how interesting, how long it stays so), and keeps the one he looks at:
//   a gunman aiming at him        foes' sim (act 'aim'; the glint, 'locked', more), for as long as he aims
//   a shot near him               foe.shoot / player hurt by a gunman: the shooter, fading
//   an explosion                  combat.explode, equip.blast, hazard.burst 'blast' within EXPLODE m
//   a bullet landing close        a gunman's bullet.impact within NEAR_MISS m of him (not in him): the spot
//   the nearest hunter            brutes and gunmen within HUNTER m (entities.near, 4 times a second)
//   birds                         a flock scattering, a bird landing on / leaving a top near him, the nearest bird flying
//                                 past (the wildlife's birds, 4 times a second)
//   a hit                         its source: where the push came from
// And the weather where he stands (S.wx, for the live hero's WEATHER): the wind's strength (W.strength: 1 a breeze's full
// gust, ~3 a gale's) and the way it blows, the rain and the snow at his spot (env.skyAt: a front passing over counts where
// it is), less under cover (a tree's crown within COVER x its scale: a few times a second), and the cold (snowing, or winter
// in the frost biome).
// The look (S.look) has hysteresis: another stimulus takes over only if it is clearly more interesting (LOOK.over), and
// not within LOOK.hold s of the last change unless it is urgent (LOOK.urgent more). And the hits on him (S.hit: a count,
// the push's direction in the world, its strength) for the flinches.
// Positions: the world (x east, y south), h the height in metres over sea level (the ground's elev included).
// READS: the frame's events, host.player, host.feature('foes').sim.gang, host.entities.near, the wildlife's birds.
// WRITES: only its own state (S). No per-frame allocation: the pool and the outputs are made once; the wildlife's list
// object (its `_` getter makes one) is read 4 times a second.
// SPOTS (the live hero's context moves, view/livehero.js IDLES): F.spot() looks once, when he settles, for a place within
// reach of where he stands: the water's edge to drink at, a seat at hip height, a wall at his back (spot() below).
// And when he has stood calm a while with nothing to look at, a glance now and then (a stimulus of its own: 'glance').
// CONTRACT: create(host) -> F with view(dt, evs); F.S the state the live hero reads (app.feat('senses').S); F.spot().
import {topOfProp, waterSample} from '../world/world.js';
const POOL = 12;
const EXPLODE = 22, SHOT = 26, NEAR_MISS = 2.6, HUNTER = 12, BIRD = 7, PERCH = 9, SCATTER = 12;
// interest (0..~1.2) and how long (s) each kind holds it (a transient fades linearly over its life)
const W = {aim: 1, locked: 1.2, explode: 1.05, shot: .85, hit: 1.1, miss: .8, hunter: .55, scatter: .5, perch: .42, bird: .3};
const LIFE = {explode: 1.6, shot: 1.1, hit: 1.2, miss: .8, scatter: 1.3, perch: 1.8};
const LOOK = {min: .18, over: .15, urgent: .4, hold: .5};
// the glances of a calm idle: after `after` s standing, every 4-8 s, a point 6 m off round him (50-110 deg either side)
const GLANCE = {after: 3, every: [4, 8], w: .25, life: 1.6};
W.glance = GLANCE.w; LIFE.glance = GLANCE.life;
// SPOTS: seats (their top .32-.78 m over his feet: these kinds), the tall things to lean on (1.05 m and up), how far the body
// may be drawn from where the sim has him (reach), the pose's measures (the seated feet .42 m before the hips, his back .24 m
// behind his body's origin, the drinking hand .62 m ahead)
const SEATS = new Set(['fieldwall', 'wall_n', 'wall_s', 'wall_w', 'wall_e', 'parapet', 'bench', 'trough', 'stock_tank', 'menhir_part',
  'woodpile', 'rock', 'crate']);
const LEANS = new Set(['wall_n', 'wall_s', 'wall_w', 'wall_e', 'fieldwall', 'tower', 'gatepost', 'towerwall', 'menhir', 'rock_big', 'tree']);
const SPOT = {seat: [.32, .78], lean: 1.05, reach: .72, feet: .42, back: .24, hand: .62, rad: 1.5};
const SCAN_HZ = 4, COVER = 1.9;   // (a tree covers him within COVER m x its scale of its trunk)

// ORDER (core/features.js): after the foes (their gang's acts this step) and the wildlife (its birds moved this frame)
export const order = {after: ['foes', 'wildlife', 'combat']};
export async function create(host) {
  const PL = host.player;
  // the pool: kind '' = free. src: a live record whose x / y / h follow it (a gunman's, a bird's), else fixed
  const pool = Array.from({length: POOL}, () => ({kind: '', x: 0, y: 0, h: 0, w: 0, life: 0, age: 0, src: null, keep: false}));
  const S = {
    look: {on: false, kind: '', x: 0, y: 0, h: 0, k: 0, n: 0},   // n: counts the changes of target
    hit: {n: 0, dx: 0, dy: 0, k: 0, t: 99},                      // dx, dy: the push (unit, world; 0, 0: none known); t: s since
    aimedAt: 0,                                                  // how many gunmen aim at him now
    wx: {wind: 0, wdx: 0, wdy: 0, rain: 0, snow: 0, cold: 0, cover: false},   // the weather at his spot (wdx, wdy: the way it blows, world)
  };
  let cur = null, curT = 99, scanT = 0, wl = null, wind = null, glT = 0, glNext = 5;
  const SP = {kind: '', x: 0, y: 0, h: 0, face: 0, wx: 0, wy: 0, wh: 0, d: 0}, WS = {}, NEAR2 = [];
  // the near point of prop p's footprint to (x, y) and its outward normal (from the footprint toward him) -> into E or false
  const E = {x: 0, y: 0, nx: 0, ny: 0};
  function edgeOf(p, x, y) {
    if (p.rect) {
      const r = p.rect, ex = Math.max(r[0], Math.min(r[2], x)), ey = Math.max(r[1], Math.min(r[3], y)), l = Math.hypot(x - ex, y - ey);
      if (l < 1e-3) return false; E.x = ex; E.y = ey; E.nx = (x - ex) / l; E.ny = (y - ey) / l; return true;
    }
    const l = Math.hypot(x - p.x, y - p.y); if (l < 1e-3) return false;
    const r = p.r > 0 ? p.r : p.kind === 'rock' ? .22 : 0; if (!r) return false;
    E.nx = (x - p.x) / l; E.ny = (y - p.y) / l; E.x = p.x + E.nx * r; E.y = p.y + E.ny * r; return true;
  }
  const dryAt = (x, y, z) => !host.inStream(x, y) && Math.abs(host.elev(x, y) - z) < .25 && (waterSample(x, y, WS), !WS.kind);
  function set(kind, x, y, h, nx, ny, d) { SP.kind = kind; SP.x = x; SP.y = y; SP.h = h; SP.face = Math.atan2(nx, ny); SP.d = d; return SP; }
  // the place to drink: the nearest water round him (12 ways, out to 1.15 m) with dry, level ground before it, the body's
  // origin SPOT.hand before the water so the dipping hand reaches it
  function drinkSpot(px, py, pz) {
    let best = null, bd = 9;
    for (let k = 0; k < 12; k++) {
      const a = k * Math.PI / 6, dx = Math.sin(a), dy = Math.cos(a);
      for (let d = .35; d <= 1.15; d += .2) {
        const x = px + dx * d, y = py + dy * d; waterSample(x, y, WS); const wet = WS.kind > 0 || host.inStream(x, y); if (!wet) continue;
        const ox = x - dx * SPOT.hand, oy = y - dy * SPOT.hand, od = Math.hypot(ox - px, oy - py);
        if (od <= SPOT.reach && d < bd && dryAt(ox, oy, pz)) { bd = d; best = {x: ox, y: oy, dx, dy, wx: x, wy: y}; }
        break;
      }
    }
    if (!best) return null;
    const wh = host.elev(best.wx, best.wy) + (host.inStream(best.wx, best.wy) ? host.world.waterH || 0 : 0);
    set('drink', best.x, best.y, host.elev(best.x, best.y), best.dx, best.dy, bd); SP.wx = best.wx; SP.wy = best.wy; SP.wh = wh;
    return SP;
  }
  // a seat: a prop's top or a ledge at hip height, its edge within reach; he sits on it facing away from it, his feet on
  // level ground before it
  function seatSpot(px, py, pz) {
    let best = null, bd = 9;
    host.entities.near(px, py, SPOT.rad, NEAR2);
    for (let i = 0; i < NEAR2.length; i++) {
      const p = NEAR2[i]; if (!SEATS.has(p.kind) || p.gone || p.broken || p.tip || p.hunter) continue;
      const t = topOfProp(p); const top = t === undefined || t === null ? (p.kind === 'rock' ? .34 : p.kind === 'bench' || p.kind === 'trough' ? .5 : p.kind === 'crate' ? .76 : -1) : t;
      const h = (p.z ?? host.elev(p.x, p.y)) + top; if (top < 0 || h - pz < SPOT.seat[0] || h - pz > SPOT.seat[1] || !edgeOf(p, px, py)) continue;
      const sx = E.x - E.nx * .1, sy = E.y - E.ny * .1, d = Math.hypot(sx - px, sy - py), fx = sx + E.nx * SPOT.feet, fy = sy + E.ny * SPOT.feet;
      if (d <= SPOT.reach && d < bd && dryAt(fx, fy, pz)) { bd = d; best = {x: sx, y: sy, h, nx: E.nx, ny: E.ny}; }
    }
    NEAR2.length = 0;
    if (!best) for (let k = 0; k < 8 && !best; k++) {   // (a ledge: the ground rising to hip height and level on top)
      const a = k * Math.PI / 4, dx = Math.sin(a), dy = Math.cos(a);
      for (let d = .3; d <= .7; d += .1) {
        const e = host.elev(px + dx * d, py + dy * d), r = e - pz; if (r < SPOT.seat[0]) continue; if (r > SPOT.seat[1]) break;
        if (Math.abs(host.elev(px + dx * (d + .25), py + dy * (d + .25)) - e) > .06) break;
        const sx = px + dx * (d + .1), sy = py + dy * (d + .1), dd = Math.hypot(sx - px, sy - py);
        if (dd <= SPOT.reach && dryAt(sx - dx * (SPOT.feet + .1), sy - dy * (SPOT.feet + .1), pz)) best = {x: sx, y: sy, h: e, nx: -dx, ny: -dy};
        break;
      }
    }
    return best ? set('sit', best.x, best.y, best.h, best.nx, best.ny, bd) : null;
  }
  // a wall (or a tower, a standing stone, a big rock, a tree) at his back: its face within reach, him leaning on it facing out
  function leanSpot(px, py, pz) {
    let best = null, bd = 9;
    host.entities.near(px, py, SPOT.rad, NEAR2);
    for (let i = 0; i < NEAR2.length; i++) {
      const p = NEAR2[i]; if (!LEANS.has(p.kind) || p.gone || p.broken) continue;
      const t = topOfProp(p), top = p.kind === 'tree' ? 9 : t ?? (p.kind === 'rock_big' ? 1.1 : -1);
      if ((p.z ?? host.elev(p.x, p.y)) + top - pz < SPOT.lean || !edgeOf(p, px, py)) continue;
      const ox = E.x + E.nx * SPOT.back, oy = E.y + E.ny * SPOT.back, d = Math.hypot(ox - px, oy - py);
      if (d <= SPOT.reach && d < bd && dryAt(ox, oy, pz)) { bd = d; best = {x: ox, y: oy, nx: E.nx, ny: E.ny}; }
    }
    NEAR2.length = 0;
    return best ? set('lean', best.x, best.y, host.elev(best.x, best.y), best.nx, best.ny, bd) : null;
  }
  const near = [];

  function put(kind, x, y, h, src = null, keep = false) {   // a stimulus: a keyed one (keep) updates its slot, else the weakest goes
    let s = null, weakest = null, ws = 1e9;
    for (let i = 0; i < POOL; i++) {
      const p = pool[i];
      if (keep && p.kind === kind) { s = p; break; }
      if (!p.kind) { if (!s) s = p; continue; }
      const v = score(p); if (p !== cur && v < ws) { ws = v; weakest = p; }
    }
    if (!s) s = weakest; if (!s) return null;
    s.kind = kind; s.x = x; s.y = y; s.h = h; s.w = W[kind] ?? .3; s.life = LIFE[kind] ?? 0; s.age = 0; s.src = src; s.keep = keep;
    return s;
  }
  const score = p => !p.kind ? 0 : p.life > 0 ? p.w * Math.max(0, 1 - p.age / p.life) : p.w;
  const d2 = (x, y) => (x - PL.x) * (x - PL.x) + (y - PL.y) * (y - PL.y);
  const ground = (x, y) => host.elev(x, y);

  // the continuous ones, SCAN_HZ times a second: the nearest hunter, the nearest bird flying past; dropped when gone
  function scan() {
    let hb = null, hd = HUNTER * HUNTER;
    host.entities.near(PL.x, PL.y, HUNTER, near);
    for (let i = 0; i < near.length; i++) { const p = near[i]; if (!p.hunter || p.gone || p.broken || !(p.hp > 0)) continue; const d = d2(p.x, p.y); if (d < hd) { hd = d; hb = p; } }
    near.length = 0;
    keyed('hunter', hb, hb ? 1 - .5 * Math.sqrt(hd) / HUNTER : 0);
    wl ??= host.feature('wildlife');
    const birds = wl?._?.birds; let bb = null, bd = BIRD * BIRD;
    if (birds) for (let i = 0; i < birds.length; i++) { const b = birds[i]; if (b.st !== 'fly') continue; const d = d2(b.x, b.y); if (d < bd) { bd = d; bb = b; } }
    keyed('bird', bb, 1);
    // cover: a tree's crown over him (its trunk within COVER x its scale)
    let cov = false; host.entities.near(PL.x, PL.y, COVER * 1.6, near);
    for (let i = 0; i < near.length && !cov; i++) { const p = near[i]; if (p.kind === 'tree' && !p.gone && d2(p.x, p.y) < (COVER * (p.scale || 1)) ** 2) cov = true; }
    near.length = 0; S.wx.cover = cov;
  }
  function keyed(kind, src, k) {
    let s = null; for (let i = 0; i < POOL; i++) if (pool[i].kind === kind) { s = pool[i]; break; }
    if (!src) { if (s) s.kind = ''; return; }
    s = put(kind, src.x, src.y, 0, src, true); if (s) s.w = (W[kind] ?? .3) * k;
  }
  function follow(p) {   // a live source's position now (a gunman's chest, a bird)
    const r = p.src; if (!r) return;
    if (r.gone || r.hp <= 0) { p.kind = ''; return; }
    p.x = r.x; p.y = r.y; p.h = p.kind === 'bird' ? r.h : (r.z ?? ground(r.x, r.y)) + (r.h || 0) + 1.45;
  }

  const F = {
    on: true, S,
    view(dt, evs) {
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i], t = e.type;
        if (t === 'player.hit') {
          const v = Math.hypot(e.vx || 0, e.vy || 0), H = S.hit;
          H.n++; H.t = 0; H.dx = v > 1e-3 ? e.vx / v : 0; H.dy = v > 1e-3 ? e.vy / v : 0; H.k = Math.max(.3, Math.min(1, v / 5));
          if (v > 1e-3) put('hit', PL.x - H.dx * 3, PL.y - H.dy * 3, PL.z + 1.2);
        } else if (t === 'player.hurt') {
          const H = S.hit, by = e.by, src = by && typeof by === 'object' && by.x !== undefined ? by : null;
          if (H.t === 0) H.k = Math.min(1.3, H.k * Math.max(.75, Math.min(1.4, .7 + (e.dmg || 0) / 40)));   // (with this step's push)
          else if ((e.dmg || 0) >= 4) {   // hurt with no push (a blast, a drain): from its source if it has one
            const d = src ? Math.hypot(PL.x - src.x, PL.y - src.y) : 0;
            H.n++; H.t = 0; H.dx = d > .05 ? (PL.x - src.x) / d : 0; H.dy = d > .05 ? (PL.y - src.y) / d : 0; H.k = Math.max(.35, Math.min(1, e.dmg / 25));
          }
          if (src && src.hunter) put('shot', src.x, src.y, (src.z ?? ground(src.x, src.y)) + 1.45);
        } else if (t === 'foe.shoot') {
          if (d2(e.x, e.y) < SHOT * SHOT) put('shot', e.x, e.y, (e.h ?? ground(e.x, e.y) + 1.3));
        } else if (t === 'combat.explode' || t === 'equip.blast' || (t === 'hazard.burst' && e.style === 'blast')) {
          if (d2(e.x, e.y) < EXPLODE * EXPLODE) put('explode', e.x, e.y, ground(e.x, e.y) + .6);
        } else if (t === 'bullet.impact') {
          if (e.foe && e.surf !== 'player' && d2(e.x, e.y) < NEAR_MISS * NEAR_MISS) put('miss', e.x, e.y, e.h ?? ground(e.x, e.y));   // (a gunman's: not his own)
        } else if (t === 'wildlife.birds_scatter') {
          if (d2(e.x, e.y) < SCATTER * SCATTER) put('scatter', e.x, e.y, ground(e.x, e.y) + 1.5);
        } else if (t === 'wildlife.bird_perch') {
          if (d2(e.x, e.y) < PERCH * PERCH) put('perch', e.x, e.y, e.h ?? ground(e.x, e.y) + 1);
        }
      }
      S.hit.t += dt;
      // the weather at his spot
      const X = S.wx, env = host.env; wind ??= host.feature('wind');
      if (wind && wind.on && wind.dir) { X.wind = wind.strength || 0; X.wdx = wind.dir[0]; X.wdy = wind.dir[1]; } else X.wind = 0;
      if (env && env.skyAt) {
        const c = X.cover ? .15 : 1;
        X.rain = (env.skyAt(PL.x, PL.y, 'rain') || 0) * c; X.snow = (env.skyAt(PL.x, PL.y, 'snow') || 0) * (X.cover ? .4 : 1);
        X.cold = Math.max(X.snow, env.season === 'winter' && host.biome?.id === 'frost' ? .5 : 0);
      }
      // the gunmen aiming at him: the one aiming hardest (the glint), live
      const gang = host.feature('foes')?.sim?.gang; let ga = null, gw = 0; S.aimedAt = 0;
      if (gang) for (let i = 0; i < gang.length; i++) {
        const g = gang[i];
        if (g.down || g.p.gone || !(g.p.hp > 0) || (g.act !== 'aim' && g.act !== 'fire')) continue;
        S.aimedAt++; const w = (g.locked ? W.locked : W.aim) * (1 - .3 * Math.min(1, Math.sqrt(d2(g.p.x, g.p.y)) / 30));
        if (w > gw) { gw = w; ga = g.p; }
      }
      keyed('aim', ga, ga ? gw / W.aim : 0);
      scanT -= dt; if (scanT <= 0) { scanT = 1 / SCAN_HZ; scan(); }
      // a calm idle's glances: nothing else to look at, standing a while: a point off to one side now and then
      if (PL.state === 'idle' && PL.t > GLANCE.after && !(cur && cur.kind)) {
        if ((glT += dt) > glNext) {
          glT = 0; glNext = GLANCE.every[0] + Math.random() * (GLANCE.every[1] - GLANCE.every[0]);
          const a = PL.faceAngle + (Math.random() < .5 ? -1 : 1) * (50 + Math.random() * 60) * Math.PI / 180;
          put('glance', PL.x + Math.sin(a) * 6, PL.y + Math.cos(a) * 6, PL.z + 1.2 + (Math.random() - .3) * 2);
        }
      } else glT = 0;
      // age the pool; the most interesting one, against the one he looks at now
      let best = null, bs = LOOK.min;
      for (let i = 0; i < POOL; i++) {
        const p = pool[i]; if (!p.kind) continue;
        p.age += dt; if (p.life > 0 && p.age >= p.life) { p.kind = ''; continue; }
        follow(p); if (!p.kind) continue;
        const v = score(p); if (v > bs) { bs = v; best = p; }
      }
      curT += dt;
      const cs = cur && cur.kind ? score(cur) : 0;
      if (!cur || !cur.kind || cs < LOOK.min) { cur = best; curT = 0; if (best) S.look.n++; }
      else if (best && best !== cur && (bs > cs + LOOK.urgent || (bs > cs + LOOK.over && curT > LOOK.hold))) { cur = best; curT = 0; S.look.n++; }
      const L = S.look;
      if (cur && cur.kind) { L.on = true; L.kind = cur.kind; L.x = cur.x; L.y = cur.y; L.h = cur.h; L.k = score(cur); }
      else { L.on = false; L.kind = ''; L.k = 0; }
    },
    // a place for his context move where he stands now: the water to drink at, else a seat, else a wall at his back ->
    // {kind 'drink' | 'sit' | 'lean', x, y (world: his body's origin there), h (the seat's top / the ground), face (the world
    // angle his front faces: atan2(dx, dy)), wx, wy, wh (drink: the water's point and surface), d} (one object, reused) or
    // null. `prefer` (optional) tries that kind first
    spot(prefer = '') {
      const px = PL.x, py = PL.y, pz = PL.z;
      const order = prefer === 'sit' ? [seatSpot, drinkSpot, leanSpot] : prefer === 'lean' ? [leanSpot, seatSpot, drinkSpot] : [drinkSpot, seatSpot, leanSpot];
      for (const f of order) { const r = f(px, py, pz); if (r) return r; }
      return null;
    },
    // (dev / tests) what is in the pool now
    dbg: () => pool.filter(p => p.kind).map(p => `${p.kind} ${score(p).toFixed(2)}${p === cur ? ' *' : ''}`).join(', '),
  };
  return F;
}
