// FAUNA (plan): where the forest's animals live, grown from the forest's own plan (world/forest.js) and its seed. Pure: no
// Math.random, no DOM, no game state, so every player (and a server, one day) gets the same herds in the same glades from the
// same seed without anything being sent. What they DO from moment to moment is the view's (features/fauna.js).
//   const A = faunaPlan(F)   A.animals: [{id, sp, x, y, home: {x, y, r}, group, seed, ...}]   A.groups: [{sp, x, y, r, cover?, den?, rock?}]
// THE CAST (docs/FAUNA.md; Småland woods and the fell above them):
//   roe        roe deer in twos and threes at the forest's edges: a glade's rim, the open ground beside thick trees; a bed in
//              the thick of the trees near by (cover)
//   fox        a fox or two, its den under a rock outcrop or a big boulder in the home woods; it roams far round it
//   hare       mountain hares on the open ground among bushes and tufts, and a couple on the fell's bare top
//   squirrel   red squirrels in the pine stands, each with a home tree (fid) and the trees round it
//   raven      a pair round the high country's rock (the fell's tors, the crags), wandering over the woods
//   capercaillie  the big grouse on the floor of the old pine woods
// THE MORNING TRAILS (trailOf, below; docs/FAUNA.md "Tracks"): after a wet night, the way each herd walked to its bed, each fox round
// to its den, each hare to its form, as lines of places and hours: the same on every client from the seed and the day.
// THE FINDS (antlersOf, feathersOf, below; docs/FAUNA.md "Finds"): each buck's shed antlers, each cock's feathers after a lek morning
// and in his summer moult, as places and hours: the same on every client from the seed and the clock.
// OWNS: nothing at run time (plain data, cached per seed). READS: world/forest.js (RECT, HOME), core/mathx.js, content/animals.js
//   (TRAIL, SHED, LEK), sim/env.js (SEASONS: the year's order).
import {hash3} from '../core/mathx.js';
import {RECT, HOME} from './forest.js';
import {TRAIL, SHED, LEK} from '../content/animals.js';
import {SEASONS} from '../sim/env.js';

export const FAUNA_TUNE = {
  roe: {groups: [3, 4], high: 1, n: [2, 3], r: 9, apart: 26},     // herds in the home woods (+ high in the high country), deer a herd, roam r (m)
  fox: {n: [1, 2], r: 26},
  hare: {n: [5, 7], fell: 2, r: 6, apart: 9},
  squirrel: {n: [5, 7], r: 7, apart: 12},
  raven: {pairs: 1, r: 40},
  capercaillie: {n: [2, 3], r: 7, apart: 18},
};

const rngOf = seed => { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const mix = (seed, a, b = 0) => (hash3(seed | 0, a, b) * 4294967296) | 0;
const plans = new WeakMap();

export function faunaPlan(F) {
  if (!F) return null;
  let A = plans.get(F); if (A) return A;
  const T = FAUNA_TUNE, R = rngOf(mix(F.seed, 7001)), rr = (a, b) => a + R() * (b - a), ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  // the trees in 4 m cells: how thick the wood is round a spot, and how much of it is pine
  const C = 4, cells = new Map(), key = (i, j) => i * 4096 + j;
  for (const p of F.props) if (p[0] === 'tree') {
    const k = key(Math.floor(p[1] / C), Math.floor(p[2] / C)); let c = cells.get(k); if (!c) cells.set(k, c = {n: 0, pine: 0, list: []});
    c.n++; if (p[3].species === 'pine') c.pine++; c.list.push(p);
  }
  const around = (x, y, r, out) => {   // trees within r m: {n, pine}, and their props into out (if given)
    let n = 0, pine = 0; const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((y - r) / C), j1 = Math.floor((y + r) / C);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const c = cells.get(key(i, j)); if (!c) continue;
      for (const p of c.list) if (Math.hypot(p[1] - x, p[2] - y) < r) { n++; if (p[3].species === 'pine') pine++; if (out) out.push(p); }
    }
    return {n, pine};
  };
  const slope = (x, y) => Math.hypot(F.height(x + .5, y) - F.height(x - .5, y), F.height(x, y + .5) - F.height(x, y - .5));
  const o = {};
  const wet = (x, y, m) => { if (F.inLake(x, y, m)) return true; F.at(x, y, o); if (o.d < o.hw + m) return true; return false; };
  const rock = (x, y, m) => F.outcrops.some(q => Math.hypot(q.x - x, q.y - y) < q.r + m);
  const settle = (x, y, m) => F.clearing && Math.hypot(F.clearing.x - x, F.clearing.y - y) < F.clearing.r + m;   // (the settlement's clearing: animals keep off)
  const canyon = (x, y) => F.canyon && F.canyon.pts.some(([cx, cy]) => Math.hypot(cx - x, cy - y) < 6);
  const ok = (x, y, m = 1) => x > RECT.x0 + 4 && x < RECT.x1 - 4 && y > RECT.y0 + 4 && y < RECT.y1 - 5 && !wet(x, y, 1.5) && !rock(x, y, m) && slope(x, y) < .45 && !canyon(x, y);
  const home = y => y > HOME.y0;
  // a spot: the best of `tries` random points in [x0..x1, y0..y1] by score (null: none good)
  function best(tries, box, score) {
    let bs = -1e9, bx = 0, by = 0;
    for (let t = 0; t < tries; t++) {
      const x = rr(box.x0, box.x1), y = rr(box.y0, box.y1); if (!ok(x, y)) continue;
      const s = score(x, y); if (s > bs) { bs = s; bx = x; by = y; }
    }
    return bs > -1e8 ? {x: +bx.toFixed(2), y: +by.toFixed(2), s: bs} : null;
  }
  const far = (list, x, y, d) => list.every(q => Math.hypot(q.x - x, q.y - y) > d);
  const groups = [], animals = [];
  const add = (sp, g, x, y, extra = {}) => {
    const id = sp + animals.length;
    animals.push({id, sp, x: +x.toFixed(2), y: +y.toFixed(2), home: {x: g.x, y: g.y, r: g.r}, group: groups.indexOf(g), seed: mix(F.seed, 7100, animals.length), ...extra});
  };
  const HIGH = {x0: RECT.x0, y0: RECT.y0, x1: RECT.x1, y1: HOME.y0};
  // ROE: an edge (open here, thick wood within 12 m), away from the settlement and the other herds; a bed in the thick of it
  const nRoe = ri(...T.roe.groups);
  for (let g = 0; g < nRoe + T.roe.high; g++) {
    const box = g < nRoe ? HOME : HIGH, roes = groups.filter(q => q.sp === 'roe');
    const s = best(70, box, (x, y) => {
      if (settle(x, y, 10) || !far(roes, x, y, T.roe.apart) || F.fellK(x, y) > .5) return -1e9;
      const here = around(x, y, 4).n, wood = around(x, y, 12).n;
      return -here * 1.4 + Math.min(wood, 18) * .25 + R();
    });
    if (!s) continue;
    const cov = best(30, {x0: s.x - 14, y0: s.y - 14, x1: s.x + 14, y1: s.y + 14}, (x, y) => around(x, y, 4).n * 2 - Math.hypot(x - s.x, y - s.y) * .1 + R());
    const G = {sp: 'roe', x: s.x, y: s.y, r: T.roe.r, cover: cov ? {x: cov.x, y: cov.y} : {x: s.x, y: s.y}};
    groups.push(G);
    const n = ri(...T.roe.n);
    for (let i = 0; i < n; i++) { const a = R() * Math.PI * 2, d = rr(1, 4); add('roe', G, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, {buck: i === 0 && R() < .6, kid: i === n - 1 && n === 3}); }
  }
  // FOX: a den under an outcrop or a block in the home woods (else anywhere quiet), a wide round
  const dens = F.outcrops.filter(q => home(q.y) && q.kind !== 'crag' && q.kind !== 'tor').map(q => ({x: q.x, y: q.y, r: q.r}));
  if (F.boulders && home(F.boulders.y)) dens.push({x: F.boulders.x, y: F.boulders.y, r: F.boulders.r});
  const nFox = ri(...T.fox.n);
  for (let i = 0; i < nFox; i++) {
    let s = null;
    for (let k = 0; k < 12 && !s && dens.length; k++) {
      const d = dens[ri(0, dens.length - 1)], a = R() * Math.PI * 2, x = d.x + Math.cos(a) * (d.r + 1.2), y = d.y + Math.sin(a) * (d.r + 1.2);
      if (ok(x, y, .2) && !settle(x, y, 12) && far(groups.filter(q => q.sp === 'fox'), x, y, 30)) s = {x, y, rock: d};
    }
    s ||= best(40, HOME, (x, y) => settle(x, y, 14) ? -1e9 : around(x, y, 6).n + R());
    if (!s) continue;
    const G = {sp: 'fox', x: +s.x.toFixed(2), y: +s.y.toFixed(2), r: T.fox.r, den: {x: +s.x.toFixed(2), y: +s.y.toFixed(2)}, rock: s.rock ? {x: s.rock.x, y: s.rock.y, r: s.rock.r} : null};   // (rock: the one the den is under: sim/foxden.js its mouth)
    groups.push(G); add('fox', G, s.x, s.y);
  }
  // HARES: open ground with a little cover (bushes, tufts), a few on the fell's bare top
  const nHare = ri(...T.hare.n), hares = [];
  for (let i = 0; i < nHare + T.hare.fell; i++) {
    const onFell = i >= nHare, box = onFell ? HIGH : (R() < .8 ? HOME : HIGH);
    const s = best(40, box, (x, y) => {
      if (settle(x, y, 5) || !far(hares, x, y, T.hare.apart)) return -1e9;
      if (onFell) return F.fellK(x, y) > .55 ? F.fellK(x, y) + R() : -1e9;
      const n = around(x, y, 5).n; return (n >= 1 && n <= 4 ? 2 : n === 0 ? 1 : 0) + R();
    });
    if (!s) continue;
    const G = {sp: 'hare', x: s.x, y: s.y, r: T.hare.r}; groups.push(G); hares.push(G); add('hare', G, s.x, s.y, {fell: onFell});
  }
  // SQUIRRELS: a pine with pines round it; its home tree and its neighbours are its world
  const nSq = ri(...T.squirrel.n), sqs = [], near = [];
  for (let i = 0; i < nSq; i++) {
    const s = best(50, R() < .75 ? HOME : HIGH, (x, y) => {
      if (settle(x, y, 2) || !far(sqs, x, y, T.squirrel.apart)) return -1e9;
      const t = around(x, y, 7); return t.pine * 1.2 + t.n * .3 + R();
    });
    if (!s) continue;
    near.length = 0; around(s.x, s.y, T.squirrel.r, near);
    const trees = near.filter(p => p[3].species !== 'willow' && p[3].species !== 'dead').map(p => [p[1], p[2], p[3].fid]); if (trees.length < 2) continue;
    const G = {sp: 'squirrel', x: s.x, y: s.y, r: T.squirrel.r, trees}; groups.push(G); sqs.push(G);
    const t0 = trees[ri(0, trees.length - 1)]; add('squirrel', G, t0[0] + .5, t0[1] + .3, {tree: t0[2]});
  }
  // RAVENS: a pair round the high country's rock (a tor on the fell's top, else a crag, else an outcrop)
  const perches = [...(F.tors || []).map(q => ({x: q.x, y: q.y, r: q.r || 1.5, h: q.h || 2})), ...F.outcrops.map(q => ({x: q.x, y: q.y, r: q.r, h: q.h}))];
  for (let k = 0; k < T.raven.pairs && perches.length; k++) {
    const p = perches[ri(0, Math.min(perches.length, 3) - 1)];
    const G = {sp: 'raven', x: +p.x.toFixed(2), y: +p.y.toFixed(2), r: T.raven.r, perches: perches.map(q => [+q.x.toFixed(2), +q.y.toFixed(2)])};
    groups.push(G); add('raven', G, p.x - .6, p.y); add('raven', G, p.x + .6, p.y + .3);
  }
  // CAPERCAILLIE: the floor of the thickest pine
  const nCap = ri(...T.capercaillie.n), caps = [];
  for (let i = 0; i < nCap; i++) {
    const s = best(50, R() < .6 ? HOME : HIGH, (x, y) => {
      if (settle(x, y, 12) || !far(caps, x, y, T.capercaillie.apart)) return -1e9;
      const t = around(x, y, 6), here = around(x, y, 1.2).n; return here ? -1e9 : t.pine * 1.5 - (t.n - t.pine) * .5 + R();
    });
    if (!s) continue;
    const G = {sp: 'capercaillie', x: s.x, y: s.y, r: T.capercaillie.r}; groups.push(G); caps.push(G); add('capercaillie', G, s.x, s.y, {hen: R() < .4});
  }
  // (at least one cock a world, for the lek: hen drawn as before, then the first one overridden, so no other animal moves)
  const cocks = animals.filter(q => q.sp === 'capercaillie'); if (cocks.length && cocks.every(q => q.hen)) cocks[0].hen = false;
  A = {groups, animals, around: (x, y, r, out) => around(x, y, r, out)};
  plans.set(F, A);
  return A;
}

// THE MORNING TRAIL of group g (an index in faunaPlan(F).groups) on in-game day `day` (sim/env.js E.day): the roe herd's walk in
// to its bed, one line a deer, side by side and crossing; the fox's round in to its den; the hare's loop to its form. Each line:
// pts = [x, y, hour (of the world clock, E.t), ...] a metre apart, from TRAIL.from to the line's end hour. Its own generator
// (mix(seed, 7300 + g, day)): the plan's R is never touched, so no animal moves. null: a group that leaves no trail (or no room).
// A line keeps to ground an animal walks: in the forest's rect, out of the lake, a wide stream, the rock and the clearing.
//   trailOf(F, g, day) -> {sp, g, lines: [{pts: Float32Array, n}]} | null      (cached: the last few asked)
const trails = new Map();
export function trailOf(F, g, day) {
  const A = faunaPlan(F); if (!A) return null;
  const G = A.groups[g]; if (!G || !TRAIL[G.sp]) return null;
  const key = F.seed + ':' + g + ':' + day; let T = trails.get(key); if (T !== undefined) return T;
  if (trails.size > 64) trails.clear();
  const C = TRAIL[G.sp], R = rngOf(mix(F.seed, 7300 + g, day)), rr = (a, b) => a + R() * (b - a);
  const end = G.sp === 'roe' ? G.cover : G.sp === 'fox' ? G.den : {x: G.x, y: G.y};
  const o = {};
  const bad = (x, y) => x < RECT.x0 + 3 || x > RECT.x1 - 3 || y < RECT.y0 + 3 || y > RECT.y1 - 4 || F.inLake(x, y, 1) || (F.at(x, y, o), o.d < o.hw - .2 && o.hw > 1.6)   // (a brook they splash over; not a river)
    || F.outcrops.some(q => Math.hypot(q.x - x, q.y - y) < q.r + .5) || (F.clearing && Math.hypot(F.clearing.x - x, F.clearing.y - y) < F.clearing.r + 2);
  // the way: from a start len m out, walked toward the end with a wandering heading (a fox's round swings wide), turned off bad ground
  const len = rr(...C.len), a0 = R() * Math.PI * 2;
  const way = [];
  let x = end.x + Math.cos(a0) * len * (G.sp === 'fox' ? .55 : .8), y = end.y + Math.sin(a0) * len * (G.sp === 'fox' ? .55 : .8);
  for (let k = 0; k < 12 && bad(x, y); k++) { const a = R() * Math.PI * 2; x = end.x + Math.cos(a) * len * .7; y = end.y + Math.sin(a) * len * .7; }
  if (bad(x, y)) { trails.set(key, null); return null; }
  const swing = G.sp === 'fox' ? 1.1 : G.sp === 'hare' ? .9 : .55, ph = R() * 10;
  let hd = Math.atan2(end.y - y, end.x - x) + (R() - .5) * swing * 2, walked = 0;
  way.push(x, y);
  for (let i = 0; i < 400; i++) {
    const d = Math.hypot(end.x - x, end.y - y); if (d < 1) break;
    const left = Math.max(0, len - walked), want = Math.atan2(end.y - y, end.x - x);
    // late in the walk it heads in; early it wanders (a fox's round, a herd browsing its way)
    const pull = left < d * 1.1 ? 1 : clamp01(1 - left / len) * .6 + .15;
    let dd = want - hd; dd -= Math.round(dd / (Math.PI * 2)) * Math.PI * 2;
    hd += dd * pull * .5 + Math.sin(ph + walked * .21) * swing * .18 + (R() - .5) * swing * .2;
    let nx = x + Math.cos(hd), ny = y + Math.sin(hd);
    const near = d < 4;   // (its last few metres: the bed / den / form itself may be by water or rock)
    for (let k = 0; k < 10 && !near && bad(nx, ny); k++) { hd += (k & 1 ? -1 : 1) * (k + 1) * .4; nx = x + Math.cos(hd); ny = y + Math.sin(hd); }
    if (!near && bad(nx, ny)) break;
    x = nx; y = ny; walked++; way.push(x, y);
  }
  const n = way.length / 2;
  if (n < 6) { trails.set(key, null); return null; }
  // the lines: a roe herd one a deer (side by side, the gap wandering, each a few minutes apart); a fox, a hare one
  const deer = G.sp === 'roe' ? A.animals.filter(q => q.group === g).length || 1 : 1, lines = [];
  const t0 = day * 24 + TRAIL.from, t1 = day * 24 + C.end;
  for (let l = 0; l < deer; l++) {
    const pts = new Float32Array(n * 3), gap = l ? rr(...C.gap) * (l & 1 ? 1 : -1) * Math.ceil(l / 2) : 0, lag = l * rr(.05, .12), wph = R() * 6;
    const s0 = t0 + rr(0, .4) + lag, s1 = t1 - rr(0, .3) + lag * .3;
    for (let i = 0; i < n; i++) {
      const j = Math.min(n - 1, i + 1), k = Math.max(0, i - 1), tx = way[j * 2] - way[k * 2], ty = way[j * 2 + 1] - way[k * 2 + 1], tl = Math.hypot(tx, ty) || 1;
      const tail = Math.min(1, (n - 1 - i) / 6), off = gap * (.6 + .4 * Math.sin(wph + i * .17)) * tail;   // (the lines meet at the bed)
      pts[i * 3] = way[i * 2] - ty / tl * off; pts[i * 3 + 1] = way[i * 2 + 1] + tx / tl * off;
      pts[i * 3 + 2] = s0 + (s1 - s0) * (i / (n - 1));
    }
    lines.push({pts, n});
  }
  T = {sp: G.sp, g, day, lines};
  trails.set(key, T);
  return T;
}
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
// where line `l` of a trail is at world hour h ({x, y, hd} into out; false before it starts or after it ends)
export function trailAt(T, l, h, out) {
  const L = T?.lines[l]; if (!L) return false;
  const P = L.pts, n = L.n; if (h < P[2] || h > P[(n - 1) * 3 + 2]) return false;
  let i = Math.floor((h - P[2]) / (P[(n - 1) * 3 + 2] - P[2]) * (n - 1)); i = Math.max(0, Math.min(n - 2, i));
  const a = i * 3, b = a + 3, k = (h - P[a + 2]) / ((P[b + 2] - P[a + 2]) || 1);
  out.x = P[a] + (P[b] - P[a]) * k; out.y = P[a + 1] + (P[b + 1] - P[a + 1]) * k; out.hd = Math.atan2(P[b + 1] - P[a + 1], P[b] - P[a]);
  return true;
}

// ---------------------------------------------------------------- THE FINDS (features/animalfinds.js; content/animals.js SHED, LEK)
// Pure functions of the plan, the animal and the clock (sd: sim/env.js TUNE.seasonDays, a season's days); each generator its own
// mix of the animal's seed, never the plan's R. A find: {id, kind (an item id), x, y, yaw, t0, t1}: it lies from in-game hour t0
// until t1. ok(x, y) -> bool: may one lie here (the caller's ground test; a few seeded tries, then the spot as it is).
//   antlersOf(A, a, Y, sd, ok, out)   a buck's SHED.per antlers of year Y (0, 1, ...; -1: the winter before the world began), each
//        on its own seeded hour in the shed window, within SHED.r m of his herd's bed, lying till the end of the next spring
//   feathersOf(A, a, day, season, ok, out)   a cock's of that day: after a lek morning (LEK.season) LEK.feathers where he sang,
//        from the lek's end; in the summer's moult one every LEK.moult days where he spends his day; LEK.lie days each
//   seasonOfDay(day, sd)   the season that day's morning is in (by the clock alone)
export const seasonOfDay = (day, sd) => SEASONS[Math.floor((((day + .25) / sd) % 4 + 4) % 4)];
const TAU = Math.PI * 2;
function layAt(R, cx, cy, r, ok) {
  let x = cx, y = cy;
  for (let k = 0; k < 6; k++) { const a = R() * TAU, d = Math.sqrt(R()) * r; x = cx + Math.cos(a) * d; y = cy + Math.sin(a) * d; if (!ok || ok(x, y)) break; }
  return [+x.toFixed(2), +y.toFixed(2)];
}
export function antlersOf(A, a, Y, sd, ok, out = []) {
  if (a.sp !== 'roe' || !a.buck) return out;
  const G = A.groups[a.group], bed = G.cover || G, W = SHED.window, sH = sd * 24, yH = sH * 4;
  const lo = (SEASONS.indexOf(W[0][0]) + W[0][1]) * sH, hi = (SEASONS.indexOf(W[W.length - 1][0]) + W[W.length - 1][2]) * sH;
  const t1 = (Y + 1) * yH + (SEASONS.indexOf(SHED.last[0]) + SHED.last[1]) * sH;
  const R = rngOf(mix(a.seed, 7300, Y));
  for (let i = 0; i < SHED.per; i++) {
    const t0 = Y * yH + lo + R() * (hi - lo), [x, y] = layAt(R, bed.x, bed.y, SHED.r, ok);
    out.push({id: `antler:${a.id}:${Y}:${i}`, kind: 'roe_antler', x, y, yaw: R() * TAU, t0, t1});
  }
  return out;
}
export function feathersOf(A, a, day, season, ok, out = []) {
  if (a.sp !== 'capercaillie' || a.hen) return out;
  const G = A.groups[a.group];
  if (season === LEK.season) {
    const R = rngOf(mix(a.seed, 7400, day)), n = LEK.feathers[0] + Math.floor(R() * (LEK.feathers[1] - LEK.feathers[0] + 1)), t0 = day * 24 + LEK.hours[1];
    for (let i = 0; i < n; i++) { const [x, y] = layAt(R, G.x, G.y, 1.2, ok); out.push({id: `feather:${a.id}:${day}:${i}`, kind: 'caper_feather', x, y, yaw: R() * TAU, t0, t1: t0 + LEK.lie * 24}); }
  } else if (season === 'summer' && ((day % LEK.moult) + LEK.moult) % LEK.moult === 0) {
    const R = rngOf(mix(a.seed, 7500, day)), t0 = day * 24 + 10, [x, y] = layAt(R, G.x, G.y, G.r * .7, ok);
    out.push({id: `feather:${a.id}:${day}:m`, kind: 'caper_feather', x, y, yaw: R() * TAU, t0, t1: t0 + LEK.lie * 24});
  }
  return out;
}
