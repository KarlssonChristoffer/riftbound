// WATCHTOWER: the ruined watchtower on the West Downs' western hill (westland.js TOWER: where it stands, how big), grown in the browser
// by the mason of world/walls3d.js (dressed stones in level courses, toned by the biome's ramps, seamed, outlined and crested by gfx.js
// COMP_FS, moss and grass on what stands, fallen stones in the grass), like the arena's towers but tall and broken. The user's brief
// (2026-10-06): 7-9 m to its broken top, a doorway at its foot facing the track, slit windows, the top broken unevenly with a parapet
// fragment, fallen blocks round its foot, and a LOOKOUT ~4 m up that the player climbs to and looks over the downs from.
//   shell     a square turned TOWER.rot off the camera's axis (two of its faces read at the default yaw), its shell d thick: level courses
//             from under its lowest foot (on the hill's slopes the uphill ones lie buried, the downhill corners show more), a plinth course
//             standing a hair out at the foot, a STRING COURSE (out a hair too) at the lookout's floor; the corners interlock (the faces'
//             rows run past the corner by turns)
//   ruin      the top round the perimeter (TOP_Q): the back faces (north, west) stand tallest, the north-west corner ~8 m over the
//             summit with a fragment of its parapet (a coping and merlons); the east face steps down to the floor; the front (south) is a
//             broken parapet over the lookout, gone down to the floor where the ladder comes up (the BREACH: its stones lie flat)
//   openings  the doorway at the foot of the south face (jambs, a lintel, a step), choked with fallen stones (the stair inside came
//             down: no way in); slit windows in both storeys
//   lookout   flagstones over the shell's inside at the floor's height F, mossy here and there; the grass grows on it (features/grass.js
//             reads elev: the deck); a few stones fallen from the walls lie in its back corners
//   rubble    stones fallen from the broken faces round its foot (most under the east and south faces), some whole blocks half sunk
// THE PLAN (towerPlan, once: layout.js): the frame, the floor's height F, the lookout as a DECK (layout.js BRIDGES: elev is F over the whole
// footprint and nothing walks under it, so from below the tower is solid; drawn here, not as a bridge: own), the LADDER up the south face
// into the breach (layout.js CLIMBS: the climb, the camera turns to face it; cliffs3d.js draws the ladder; `hill`: the ground in front of
// it keeps its slope), the COLLIDERS ('towerwall' props, towerCols): a ring round its foot (the player's body stays off the faces; arrows
// stick in it up to the wall's top) and a ring on the lookout where its walls stand over the floor (none in the breach); plan.fire: where
// features/lights.js puts the WATCH FIRE (a brazier on the lookout, unlit: E or a fire arrow lights it)
//   towerPlan(T, ground) -> plan;  watchtowerRun(plan, o, ground) -> {geo, top (m: its highest point)};  towerCols(plan, ground) -> [{x, y, z, r}]
//   colTop(plan, x, y, z) -> m: how high the wall stands over z there (a collider's own top: world.js topOfProp);  inTower(plan, x, y, m)
//   ground(x, y) -> m: the hill under it (the terrain field, without the deck);  o = {fam, cover} (walls3d.js)
// OWNS: nothing at run time (pure functions of the plan; its prop kinds' material, stone, registered at load: content/materials.js). Frame: world metres; plan points are [x east, y south], the geometry's
// x east, y up, z south.
import {vnoise, clamp} from '../core/mathx.js';
import {mason} from './walls3d.js';
import {sink, cuboid} from './cliffs3d.js';
import {setMaterials} from '../content/materials.js';

setMaterials({watchtower: 'stone', towerwall: 'stone'});   // (bullets glance off it, chip it: sim/projectiles.js, features/gunfx.js)

const PLINTH = [.5, .6], COURSE = [.3, .4], QUOIN = [[.68, .95], [.36, .5]], LEN = [.5, 1.05], SHRINK = .006;
// the broken top round the perimeter: [q, m over the floor], q = 0..4 the faces n, e, s, w in turn from the north-west corner (eased
// between the points; a slow and a quick noise on it); never under PARAPET over the floor but in the breach
const TOP_Q = [[0, 4.1], [.18, 4.0], [.42, 2.9], [.6, 3.4], [.84, 2.45], [1, 2.05], [1.22, 1.35], [1.48, .8], [1.75, .55], [2, .5],
  [2.3, .55], [2.72, .6], [2.9, .95], [3, 1.45], [3.22, 2.15], [3.5, 3.05], [3.8, 3.85], [4, 4.1]];
const PARAPET = .4;
// the doorway (local x of its middle on the south face, width, height), the ladder (local x on the south face, the climb's width, half
// the breach's width), the parapet fragment round the north-west corner (m along the north face from the corner, and the west face)
const DOOR = {at: -.95, w: .95, h: 1.9}, LADDER = {at: 1.15, w: 1.1, gap: .72}, FRAG = {n: 1.35, w: .9};
// slit windows: [face (0 n, 1 e, 2 s, 3 w), m along it from its start corner, 'F' over the floor / 'B' over the summit's ground, bottom, height]
const SLITS = [[0, 2.05, 'F', .85, .95], [3, 3.2, 'F', 1.05, .9], [1, 2.7, 'B', 1.45, .9], [3, 1.85, 'B', 1.75, .9], [0, 3.6, 'B', 1.6, .9]];
// ivy: [face, from, to (m along it), its highest reach (m), stems]
const IVY = [[2, 4.15, 5.25, 3.1, 6], [3, -.05, .75, 2.6, 4], [0, 1.2, 3.3, 5.2, 7], [1, 3.6, 4.7, 1.5, 3]];
// how much moss each face's foot gathers (n e s w: the back faces stand in their own shade)
const DAMP = [.55, .25, .2, .45];
// the colliders: the foot ring CIN m in from the outer face (r CR), the lookout's ring FIN m outside the inner face (r FR), every STEP m
const CIN = .4, CR = .45, FIN = .3, FR = .4, STEP = .5;

export function towerPlan(T, ground) {
  const r = T.rot * Math.PI / 180, ex = [Math.cos(r), Math.sin(r)], ey = [-Math.sin(r), Math.cos(r)], S = T.S, h = S / 2, D = T.d;
  const at = (a, b) => [T.x + a * ex[0] + b * ey[0], T.y + a * ex[1] + b * ey[1]];             // local (a east, b south) -> world [x, y]
  const loc = (x, y) => [(x - T.x) * ex[0] + (y - T.y) * ex[1], (x - T.x) * ey[0] + (y - T.y) * ey[1]];
  // the faces n e s w: their start corner, along, outward (local)
  const faces = [[[-h, -h], [1, 0], [0, -1]], [[h, -h], [0, 1], [1, 0]], [[h, h], [-1, 0], [0, 1]], [[-h, h], [0, -1], [-1, 0]]].map(([c0, u, w]) => ({c0, u, w}));
  const B0 = ground(T.x, T.y), F = B0 + T.floor, sL = h - LADDER.at, sD = h - DOOR.at;
  const qTop = q => {
    q = ((q % 4) + 4) % 4; let i = 0; while (i < TOP_Q.length - 2 && q > TOP_Q[i + 1][0]) i++;
    const [q0, v0] = TOP_Q[i], [q1, v1] = TOP_Q[i + 1], t = clamp((q - q0) / (q1 - q0), 0, 1); return v0 + (v1 - v0) * (1 - Math.cos(Math.PI * t)) / 2;
  };
  const plan = {x: T.x, y: T.y, seed: T.seed, S, h, D, ex, ey, at, loc, faces, B0, F, sL, sD, breach: [sL - LADDER.gap, sL + LADDER.gap]};
  // the top (m, absolute) at perimeter p (0..4 S)
  plan.top = p => F + Math.max(PARAPET, qTop(p / S) + (vnoise(p * .85, 1.5, T.seed) - .5) * .7 + (vnoise(p * 2.6, 4.5, T.seed + 1) - .5) * .3);
  // a point on the perimeter: p, depth (m in from the outer face) -> world [x, y]
  plan.perim = (p, depth) => { const i = Math.min(3, Math.floor(p / S)), s = p - i * S, f = faces[i]; return at(f.c0[0] + f.u[0] * s - f.w[0] * depth, f.c0[1] + f.u[1] * s - f.w[1] * depth); };
  // the lookout: a deck over the whole footprint (layout.js BRIDGES)
  const cs = [at(-h, -h), at(h, -h), at(h, h), at(-h, h)];
  plan.deck = {a: at(-h, 0), b: at(h, 0), w: S, len: S, ux: ex[0], uy: ex[1], h0: F, h1: F, arch: 0, own: 'watchtower',
    box: [Math.min(...cs.map(c => c[0])), Math.min(...cs.map(c => c[1])), Math.max(...cs.map(c => c[0])), Math.max(...cs.map(c => c[1]))]};
  // the ladder: .05 m out from the south face (its stones' faces), up into the breach; h0 the highest ground in front of it (he can start
  // the climb anywhere there: the hill falls away from the tower), the mantle a hand onto the floor past the shell
  const [cx, cy] = at(LADDER.at, h + .05);
  let h0 = -1e9; for (let o = 0; o <= 1.3; o += .1) for (let a = -1; a <= 1.001; a += .25) { const [x, y] = at(LADDER.at + a, h + .05 + o); h0 = Math.max(h0, ground(x, y)); }
  plan.climb = {x: cx, y: cy, nx: ey[0], ny: ey[1], w: LADDER.w, h0: h0 + .01, h1: F, reach: .05 + D + .25, yaw: Math.atan2(ey[0], ey[1]), hill: true};
  // the watch fire's place (features/lights.js: a brazier, unlit): on the floor before the north wall, away from the breach (E there climbs)
  plan.fire = at(.35, -(h - D) + .48);
  return plan;
}

// inside the footprint (grown by m)
export function inTower(plan, x, y, m = 0) { const [a, b] = plan.loc(x, y); return Math.abs(a) < plan.h + m && Math.abs(b) < plan.h + m; }

// the face nearest (x, y) and how far along it: [face, s]
function faceAt(plan, x, y) {
  const [a, b] = plan.loc(x, y), h = plan.h, d = [b + h, h - a, h - b, a + h];
  let i = 0; for (let k = 1; k < 4; k++) if (d[k] < d[i]) i = k;
  return [i, [a + h, b + h, h - a, h - b][i]];
}
const inBreach = (plan, i, s, m = 0) => i === 2 && s > plan.breach[0] - m && s < plan.breach[1] + m;

// how high the wall stands over z at a collider's spot (m): the top there (the breach: broken down to the floor)
export function colTop(plan, x, y, z) {
  const [i, s] = faceAt(plan, x, y), t = inBreach(plan, i, s) ? plan.F : plan.top(i * plan.S + s);
  return Math.max(.1, t - z);
}

// the colliders: [{x, y, z, r}] (layout.js adds a 'towerwall' prop for each)
export function towerCols(plan, ground) {
  const out = [], {S, D, F} = plan;
  for (let i = 0; i < 4; i++) for (let s = STEP / 2; s < S; s += STEP) {
    const p = i * S + s, [x, y] = plan.perim(p, CIN);
    out.push({x, y, z: ground(x, y), r: CR});
    if (inBreach(plan, i, s, .3)) continue;   // (the way up stays open)
    const [fx, fy] = plan.perim(p, D - FIN); out.push({x: fx, y: fy, z: F, r: FR});
  }
  return out;
}

// ONE COURSE along a line (walls3d.js M.row's way, with openings): line = {a: [x, z] its start, u, w (along, outward: 3D unit vectors), L, D};
// y / hk its bottom and height (absolute), k its index (the corner and jamb stones long and short by turns), top(s) the top there (abs),
// opens [[s0, s1], ...] (sorted) where it has no stones; o = {proud (m out of the outer face), tone, flat(s) (no stone knocked askew: the
// breach he walks over, the coping's bed), next (the next course's height: does a stone end its column?), ground (one wholly under it
// is left out), p0 (the line's start on the perimeter), damp (0..1: how much moss its foot gathers: the shaded faces more)}. A stone whose
// column ends goes to M.tops (the moss and the grass lie on it). The faces weather: darker toward the damp foot, in vertical streaks
// (rain running down), a face stone fallen out here and there (a POCKET: the core behind it, in shade), moss creeping up from the
// grass and down from the broken tops
function row(M, B, line, y, hk, k, top, opens, o) {
  const {R, rr} = M, segs = []; let at = 0;
  for (const [o0, o1] of opens) { if (o0 > at + .04) segs.push([at, Math.min(o0, line.L)]); at = Math.max(at, o1); }
  if (line.L - at > .04) segs.push([at, line.L]);
  const pr = o.proud || 0;
  for (const [sa, sb] of segs) {
    const len = sb - sa, lens = [], q0 = QUOIN[k % 2], q1 = QUOIN[(k + 1) % 2];
    if (len < .55) lens.push(len);
    else {
      let s = Math.min(rr(...q0), len * .45); lens.push(s);
      const qe = Math.min(rr(...q1), len - s);
      while (s < len - qe - .2) { const l = Math.min(rr(...LEN), len - qe - s); lens.push(l); s += l; }
      lens.push(len - s);
    }
    let s0 = sa;
    lens.forEach((l, j) => {
      const sc = s0 + l / 2; s0 += l;
      const t = Math.min(top(sc), top(clamp(sc - l * .35, 0, line.L)), top(clamp(sc + l * .35, 0, line.L)));
      if (y + hk * .55 > t) return;                                    // broken off here
      const loose = y + hk > t - .02 && !o.flat?.(sc);                  // (the topmost of a broken column, knocked askew)
      const end = j === 0 || j === lens.length - 1, pocket = !loose && !end && !pr && R() < .055, rec = pocket ? rr(.09, .2) : 0;
      const [U, V, W] = M.axes(line.u, line.w, (R() - .5) * (loose ? .14 : .04), (R() - .5) * (loose ? .12 : .05), (R() - .5) * (loose ? .1 : .025));
      const out = (R() - .5) * (loose ? .05 : .03) + pr / 2 - rec / 2, x = line.a[0] + line.u[0] * sc + line.w[0] * out, z = line.a[1] + line.u[2] * sc + line.w[2] * out;
      const g = o.ground(x, z), p = (o.p0 || 0) + sc, foot = clamp(1 - (y - g) / 1.5, 0, 1);
      const tone = M.tone() + (o.tone || 0) - .1 * foot + (vnoise(p * 1.5, 9.5, 77) - .5) * .16 - (pocket ? .16 : 0);
      if (y + hk < g - .06) return;                                    // (buried: the hill rises over it)
      const hu = l / 2 - SHRINK, hv = hk / 2 - SHRINK, hw = line.D / 2 + pr / 2 - rec / 2;
      cuboid(B, [x, y + hk / 2, z], U, V, W, hu, hv, hw, M.fs, B.part(), tone, R, .06);
      if (!o.next || y + hk + o.next * .55 > top(sc)) M.tops.push({x, z, u: line.u, w: line.w, l, d: line.D, y: y + hk + (loose ? .01 : 0), B, cope: false, broken: true});
      // moss on its face: creeping up from the grass (the shaded faces more), down from a broken top over it
      if (M.fc === null || M.fc === undefined || pocket) return;
      const up = foot > .35 && R() < (o.damp || .2) * foot * 1.4, down = t - (y + hk) < .5 && R() < .3;
      if (!up && !down) return;
      const c = [x, y + hk / 2, z], q = (a, b) => [c[0] + U[0] * a + V[0] * b + W[0] * (hw + .012), c[1] + U[1] * a + V[1] * b + W[1] * (hw + .012), c[2] + U[2] * a + V[2] * b + W[2] * (hw + .012)];
      const a0 = -hu + rr(0, hu * .5), a1 = hu - rr(0, hu * .5), n = 4, edge = [], sg = up ? 1 : -1, base = up ? -hv : hv;
      for (let e = 0; e <= n; e++) edge.push(q(a0 + (a1 - a0) * e / n, base + sg * hk * rr(.25, up ? .9 : .6)));
      B.poly([q(a0, base), q(a1, base), ...edge.reverse()], W, M.fc, B.part(), R() < .5 ? -.2 : 0);
    });
  }
}

// [[a0, a1], ...]: lo..hi cut into pieces of min..max m (the last one no shorter than min * .6: merged into the one before)
function strips(lo, hi, min, max, rr) {
  const out = []; let a = lo;
  while (a < hi - 1e-6) { let b = Math.min(hi, a + rr(min, max)); if (hi - b < min * .6) b = hi; out.push([a, b]); a = b; }
  return out;
}

export function watchtowerRun(plan, o, ground) {
  const B = sink(), M = mason(plan.seed, o), {R, rr} = M, {S, h, D, F, faces, at, ex, ey} = plan, P = 4 * S;
  const v3 = u => [u[0] * ex[0] + u[1] * ey[0], 0, u[0] * ex[1] + u[1] * ey[1]];   // a local direction -> world 3D
  // the lowest ground round its foot; the parapet fragment's stretch round the north-west corner (p from -w to n) and its bed: the top of
  // the highest course that stands whole along it
  let lo = 1e9; for (let p = 0; p < P; p += .2) { const [x, y] = plan.perim(p, -.1); lo = Math.min(lo, ground(x, y)); }
  const inFrag = p => p < FRAG.n || p > P - FRAG.w;
  let fragMin = 1e9; for (let p = -FRAG.w; p <= FRAG.n; p += .05) fragMin = Math.min(fragMin, plan.top((p + P) % P));
  // the course plan: a plinth from under the lowest foot, courses fitted to end at the floor (the last: the string course), then on up
  const C = [], y0 = lo - .22, hp = rr(...PLINTH);
  C.push({y: y0, hk: hp, kind: 'plinth'});
  const n1 = Math.max(2, Math.round((F - y0 - hp) / .4)), hs = Array.from({length: n1}, (_, i) => rr(.85, 1.15) * (1.2 - .35 * i / n1)), sum = hs.reduce((a, b) => a + b, 0);
  let y = y0 + hp;
  for (let i = 0; i < n1; i++) { const hk = i === n1 - 1 ? F - y : hs[i] / sum * (F - y0 - hp); C.push({y, hk, kind: i === n1 - 1 ? 'string' : ''}); y += hk; }
  let topMax = 0; for (let p = 0; p < P; p += .05) topMax = Math.max(topMax, plan.top(p));
  while (y < topMax - .1) { let hk = rr(...COURSE); if (y + hk > topMax - .05) hk = Math.max(.24, topMax - y); C.push({y, hk, kind: ''}); y += hk; }
  let fragY = F; for (const c of C) if (c.y + c.hk <= fragMin - .02 && c.y + c.hk * .55 <= fragMin) fragY = Math.max(fragY, c.y + c.hk);
  const topAt = p => inFrag(p) ? Math.min(plan.top(p), fragY + .001) : plan.top(p);
  // the openings: {i (face), s0, s1 (m along it), y0, y1 (a course whose middle lies in it has none there), lintel (the course over it)}
  const OPEN = [];
  const sD = plan.sD, dw = DOOR.w / 2;
  let thr = -1e9; for (let d = -.1; d <= D + .1; d += .1) for (let a = -dw; a <= dw + 1e-6; a += dw / 2) { const [x, z] = at(DOOR.at + a, h - d); thr = Math.max(thr, ground(x, z)); }
  const door = {i: 2, s0: sD - dw, s1: sD + dw, y0: thr - .05, y1: thr + DOOR.h, lintel: true};
  OPEN.push(door, {i: 2, s0: plan.breach[0], s1: plan.breach[1], y0: F - .01, y1: 1e9});
  for (const [i, s, base, off, hh] of SLITS) { const b = (base === 'F' ? F : plan.B0) + off; OPEN.push({i, s0: s - .085, s1: s + .085, y0: b, y1: b + hh}); }
  for (const O of OPEN) if (O.lintel) O.lc = C.find(c => c.y + c.hk / 2 > O.y1);
  // ---- the courses, face by face (the faces' rows run past the corners by turns: n / s on even courses, e / w on odd)
  C.forEach((c, k) => faces.forEach((f, i) => {
    const trim = (k + i) % 2 === 0 ? 0 : D, u = v3(f.u), w = v3(f.w);
    const [ax, az] = at(f.c0[0] + f.u[0] * trim - f.w[0] * D / 2, f.c0[1] + f.u[1] * trim - f.w[1] * D / 2);
    const line = {a: [ax, az], u, w, L: S - 2 * trim, D}, mid = c.y + c.hk / 2, opens = [];
    let lintel = null;
    for (const O of OPEN) if (O.i === i) {
      if (mid >= O.y0 && mid <= O.y1) opens.push([O.s0 - trim, O.s1 - trim]);
      else if (O.lc === c) { opens.push([O.s0 - .3 - trim, O.s1 + .3 - trim]); lintel = O; }
    }
    opens.sort((a, b) => a[0] - b[0]);
    const top = s => topAt(i * S + trim + s);
    row(M, B, line, c.y, c.hk, k, top, opens, {proud: c.kind === 'plinth' ? .05 : c.kind === 'string' ? .045 : 0, tone: c.kind === 'plinth' ? -.04 : c.kind === 'string' ? .05 : 0,
      flat: s => inBreach(plan, i, s + trim, .25) || inFrag(i * S + trim + s), next: C[k + 1]?.hk || 0, ground, p0: i * S + trim, damp: DAMP[i]});
    if (lintel && top(sD - trim) > c.y + c.hk * .55) {   // the doorway's lintel: one long stone over it, into both jambs
      const [x, z] = at(DOOR.at, h - D / 2), [U, V, W] = M.axes(u, w, (R() - .5) * .02, (R() - .5) * .03, 0);
      cuboid(B, [x, c.y + c.hk / 2, z], U, V, W, dw + .3 - SHRINK, c.hk / 2 - SHRINK, D / 2 + .01, M.fs, B.part(), .08 + (R() - .5) * .06, R, .03);
    }
  }));
  // ---- the parapet fragment round the north-west corner: a coping on the bed course, two merlons and a corner one, a crenel between
  {
    const cope = .1, PT = .34, MH = .55;
    for (const [i, s0, s1] of [[0, 0, FRAG.n], [3, S - FRAG.w, S - D]]) {   // (the north face's coping runs over the corner)
      const f = faces[i], u = v3(f.u), w = v3(f.w);
      for (const [a0, a1] of strips(s0, s1, .4, .7, rr)) {
        const sm = (a0 + a1) / 2, [x, z] = at(f.c0[0] + f.u[0] * sm - f.w[0] * D / 2, f.c0[1] + f.u[1] * sm - f.w[1] * D / 2);
        M.slab(B, [x, fragY + cope / 2, z], u, w, a1 - a0, cope, D + .08, .06);
      }
      // the merlons on the outer edge
      for (const [m0, m1] of i === 0 ? [[0, .5], [.95, 1.3]] : [[S - .85, S - .45]]) {
        const sm = (m0 + m1) / 2, [x, z] = at(f.c0[0] + f.u[0] * sm - f.w[0] * PT / 2, f.c0[1] + f.u[1] * sm - f.w[1] * PT / 2), [U, V, W] = M.axes(u, w, (R() - .5) * .04, (R() - .5) * .05, (R() - .5) * .03);
        cuboid(B, [x, fragY + cope + MH / 2, z], U, V, W, (m1 - m0) / 2 - SHRINK, MH / 2, PT / 2, M.fs, B.part(), M.tone() * .5 + .04, R, .05);
        M.tops.push({x, z, u, w, l: m1 - m0, d: PT, y: fragY + cope + MH, B, cope: false, broken: true});
      }
    }
    topMax = Math.max(topMax, fragY + cope + MH);
  }
  // ---- the lookout's floor: flagstones over the shell's inside (a hair under it), at F
  const fi = h - D + .03;
  for (const [b0, b1] of strips(-fi, fi, .5, .8, rr)) for (const [a0, a1] of strips(-fi, fi, .5, .9, rr)) {
    const [x, z] = at((a0 + a1) / 2, (b0 + b1) / 2), th = .16, [U, V, W] = M.axes(v3([1, 0]), v3([0, 1]), (R() - .5) * .02, (R() - .5) * .012, (R() - .5) * .012);
    cuboid(B, [x, F + .003 - th / 2, z], U, V, W, (a1 - a0) / 2 - SHRINK, th / 2, (b1 - b0) / 2 - SHRINK, M.fs, B.part(), M.tone() * .55 + .03, R, .02);
    if (R() < .35) M.tops.push({x, z, u: v3([1, 0]), w: v3([0, 1]), l: a1 - a0, d: b1 - b0, y: F + .003, B, cope: true, broken: false});
  }
  // stones fallen onto it from the walls over it: in its back corners and along the north wall
  for (const [a, b] of [[-fi + .28, -fi + .3], [-fi + .55, -fi + .22], [fi - .3, -fi + .28], [-fi + .25, -fi + .9]]) { const [x, z] = at(a, b); M.fallen(B, x, z, () => F, rr(.8, 1.1)); }
  // ---- the doorway: a step at its foot (the hill falls away outside it), and the stones of the stair that came down inside it, heaped in
  // the opening and spilling out over the step
  {
    let dTop = -1e9; for (const c of C) if (c.y + c.hk / 2 < door.y0) dTop = Math.max(dTop, c.y + c.hk);   // (the last course under the opening)
    const [gx, gz] = at(DOOR.at, h + .15), gOut = ground(gx, gz), u = v3([-1, 0]), w = v3([0, 1]);
    if (dTop - gOut > .08) { const [x, z] = at(DOOR.at, h + .14), [U, V, W] = M.axes(u, w, (R() - .5) * .04, 0, 0); cuboid(B, [x, (dTop - .015 + gOut - .12) / 2, z], U, V, W, dw + .14, (dTop - .015 - gOut + .12) / 2, .2, M.fs, B.part(), -.06, R, .05); }
    for (let j = 0; j < 14; j++) {
      const a = DOOR.at + (R() - .5) * (DOOR.w - .14), d = rr(-.2, D + .35), k = clamp((d + .2) / (D + .55), 0, 1);   // (d: m in from the outer face)
      const lift = (k * .55 + R() * .12) * (j < 9 ? 1 : 1.2), [x, z] = at(a, h - d);
      M.fallen(B, x, z, () => dTop + lift - .1, j < 5 ? rr(1.3, 1.7) : rr(.9, 1.3));
    }
  }
  // ---- stones fallen round its foot: most under the broken faces (east and south), some whole blocks; the ladder's foot and the
  // doorway's front stay clear
  for (let j = 0; j < 64; j++) {
    const i = R() < .78 ? (R() < .55 ? 2 : 1) : (R() < .5 ? 3 : 0), s = rr(-.3, S + .3), out = .15 + R() * R() * 3.6;
    if (i === 2 && Math.abs(s - plan.sL) < 1.25 && out < 1.9) continue;
    if (i === 2 && Math.abs(s - sD) < .75 && out < 1.3) continue;
    const f = faces[i], [x, z] = at(f.c0[0] + f.u[0] * s + f.w[0] * out, f.c0[1] + f.u[1] * s + f.w[1] * out);
    M.fallen(B, x, z, ground, R() < .26 ? rr(1.7, 2.4) : rr(.85, 1.3));
  }
  // ---- ivy: up the south face's west corner (beside the doorway) and round onto the west face, up the north face, a little at the
  // east face's foot: stems wandering up the stone, thick with leaves (the leaf family: soft, no seams between them)
  const fl = o.fam('leaf');
  for (const [i, s0, s1, hMax, n] of IVY) {
    const f = faces[i], u = v3(f.u), w = v3(f.w);
    for (let k = 0; k < n; k++) {
      let s = rr(s0, s1), hy = 0;
      const hTop = hMax * rr(.45, 1), p = B.part();
      const [gx, gz] = at(f.c0[0] + f.u[0] * s, f.c0[1] + f.u[1] * s), g0 = ground(gx, gz) - .05;
      for (let y = g0; y < g0 + hTop; y += rr(.1, .17)) {
        s = clamp(s + (R() - .5) * .14, s0 - .1, s1 + .1); hy = (y - g0) / hTop;
        const nl = hy > .85 ? 1 : 2 + (R() < .5 ? 1 : 0);
        for (let e = 0; e < nl; e++) {
          const ls = s + (R() - .5) * (.18 + .1 * (1 - hy)), ly = y + (R() - .5) * .1, sz = rr(.075, .12) * (1 - hy * .35), a = R() * Math.PI;
          if (ls < 0 || ls > S) continue;
          const [x, z] = at(f.c0[0] + f.u[0] * ls, f.c0[1] + f.u[1] * ls), off = (ly - g0 < .6 ? .075 : .045) + R() * .025, ca = Math.cos(a) * sz, sa = Math.sin(a) * sz;
          const c = [x + w[0] * off, ly, z + w[2] * off], q = (da, db) => [c[0] + u[0] * da, c[1] + db, c[2] + u[2] * da];
          B.poly([q(-ca, -sa), q(sa, -ca), q(ca, sa), q(-sa, ca)], [w[0] + (R() - .5) * .5, (R() - .2) * .5, w[2] + (R() - .5) * .5], fl, p, (R() - .5) * .3 + (hy > .7 ? .08 : 0));
        }
      }
    }
  }
  for (const T of M.tops) M.moss(T, plan.seed);
  return {geo: B.geometry(), top: topMax};
}
