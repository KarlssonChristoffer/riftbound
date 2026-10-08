// WALLS3D: the arena's masonry as live 3D stone, grown in the browser from a seed (as trees3d.js grows trees and cliffs3d.js rock), in
// place of the Blender kit's pieces (tools/blender/props3d.py: 1 m wall segments with even courses and a coping on every metre in
// four variants, a crenellated tower, a gatepost). The user's brief (2026-10-06): the walls as RUINS like the reference images:
// broken to uneven heights, big irregular blocks, moss and grass on the tops, fallen stones in the grass.
//   courses  rows of dressed stones; the foot course a plinth of big blocks a hair proud of the faces, the rows above .27-.4 m. A
//            stone is a box through the masonry's thickness, its corners a little uneven, turned and leaning a hair its own way, so
//            the art light (gfx.js uLArt) tones it its own way; a few stones lighter, some darker (weathered): an old wall's
//            patchwork. Every stone is its own part: the composite draws the joints as seams, a stone standing proud as an occlusion
//            line, and the light crest along a stone's top edge where it shows (gfx.js COMP_FS)
//   ends     corner stones, a long and a short one by turns (a wall's ends at a gate or a tower); a tower's corners interlock: its
//            faces' rows run past the corner by turns
//   damage   the top along the masonry (a wall's profile; a tower's round its perimeter): where it stands whole, a COPING (long flat
//            slabs a little proud of the faces, the odd one gone); where it's broken the top steps down course by course, a stone is
//            there only if most of it stands under the line, and the topmost loose ones are knocked askew
//   growth   moss lying on the tops (the biome's cover family), hanging a little over the faces, and blades of grass in it
//   rubble   stones fallen from the broken stretches, lying in the grass at the foot, tilted, half sunk (a collapsed tower's all round)
// wallRun(run, o) -> {geos: [BufferGeometry | null, ...], tops: [m, ...]}: a run cut into PIECES at run.cuts (s, m from a: [0, ...,
//   length]): a stone, its moss and its fallen stones go to the piece its centre lies in; tops: each piece's highest standing point.
//   (world.js gives each 1 m wall prop its piece as its mesh: collision, perches, arrows and the rest keep working per segment)
//   run = {a: [x, z], b: [x, z] (its line, m; x east, z south), h (its full height), d (its thickness), ruin (0..1: how much of it is
//          broken), keep: [[s0, s1], ...] (stretches held whole: mounts, a gate's jambs, the towers' sides), seed, cuts,
//          ground(x, z) -> m (the ground under it: 0 when omitted), gaps: [[s0, s1], ...] (no stones: a doorway; broken down to it
//          over .5 m either side), sink (m: where its foot course starts, under the ground: -.06; a field wall on a slope deeper),
//          rough (1: how unevenly its stones lie: a dry-stone field wall's more), pulls: [[s0, s1, dh, side], ...] (stretches whose top
//          course was PULLED down by the lasso, docs/exp/brawl.md: dh m lower, its stones fallen to that side: +1 along w, -1 against;
//          every random draw is made as without them, so the rest of the run comes out stone for stone the same)}
// towerRun(t, o) -> {geo, top}: a square tower round (t.x, t.z): t.S (its side), t.h (to its stone floor), t.d (its shell), t.ruin,
//   t.stump (m: collapsed down to about this, 0: standing), t.out ([dx, dz]: the way its fallen stones spread most), seed, ground;
//   a parapet of merlons round its floor (some gone); top: its highest standing point over its foot
// postRun(t, o) -> {geo, top}: a gatepost round (t.x, t.z): t.S, t.h (to its capstones), t.broken (its top courses and cap gone), seed
//   o = {fam(name) -> family index (world.js FAMS), cover: the moss's family or null}
//   profile(run) -> s => the top's height there (m)
// Frame: world metres, x east, y up, z south (world.js moves each piece to its prop's own frame).
import {vnoise, clamp, smooth} from '../core/mathx.js';
import {mulberry32} from '../core/rng.js';
import {sink, cuboid} from './cliffs3d.js';

const PLINTH = [.42, .5], COURSE = [.27, .4], LEN0 = [.62, 1.05], LEN = [.36, .8], QUOIN = [[.58, .74], [.3, .4]];
const COPE = .1, SHRINK = .006, UP = [0, 1, 0];

// the run's top along it: full height but where its noise breaks it (by `ruin`), never in a keep stretch (fading back up over 1.2 m
// beyond one); a break goes down to under a third of the height
export function profile(run) {
  const {h, ruin = 0, keep = [], seed = 0, gaps = [], pulls = null} = run;
  const base = s => {
    let g = 1;   // (a gap: nothing in it, the wall broken down to it either side)
    for (const [s0, s1] of gaps) { const d = s < s0 ? s0 - s : s > s1 ? s - s1 : 0; g = Math.min(g, d <= 0 ? 0 : .25 + .75 * smooth(d / .5)); }
    if (g <= 0) return 0;
    return g * whole(s);
  };
  if (!pulls || !pulls.length) return base;
  const top = s => {   // (pulled: the notch, its sides easing over .3 m)
    let t = base(s);
    for (const [s0, s1, dh] of pulls) { const d = s < s0 ? s0 - s : s > s1 ? s - s1 : 0; if (d < .3) t -= dh * (1 - smooth(d / .3)); }
    return Math.max(0, t);
  };
  top.base = base;
  return top;
  function whole(s) {
    let k = 1;
    for (const [s0, s1] of keep) { const d = s < s0 ? s0 - s : s > s1 ? s - s1 : 0; k = Math.min(k, smooth(d / 1.2)); }
    if (k <= 0 || ruin <= 0) return h;
    const n = vnoise(s * .3, .5, seed) * .65 + vnoise(s * 1.05, 2.5, seed + 1) * .35;
    return h - h * .72 * smooth((n - (1 - ruin)) / .2) * k;
  }
}
// a course plan up to `top`: [[y, h], ...] from just under the ground (a plinth, then courses; the last fills up to top)
function coursesTo(top, R, y0 = -.06) {
  const out = []; let y = y0, k = 0;
  while (y < top - .12) {
    let hk = k === 0 ? PLINTH[0] + (PLINTH[1] - PLINTH[0]) * R() : COURSE[0] + (COURSE[1] - COURSE[0]) * R();
    if (y + hk > top - .14) hk = top - y;
    out.push([y, hk]); y += hk; k++;
  }
  return out;
}

// THE MASON: one build's random, families and sinks, and the ways it lays stone (world space; a frame is a line's u (along) and w
// (across), unit vectors on the ground). Exported: world/stonecircle.js lays its moss and its fallen chips with it; world/watchtower.js
// (the West Downs' watchtower) its courses round openings; world/bridge3d.js the brook's bridge
export function mason(seed, o) {
  const R = mulberry32((seed | 0) * 7919 + 13), rr = (a, b) => a + (b - a) * R(), fs = o.fam('stone'), fc = o.cover;
  const M = {R, rr, fs, fc, tops: []};   // tops: the stones and slabs that end a column (the moss and the grass lie on them)
  let VOID = null; M.void = () => VOID ??= sink();   // (where a pulled stone is built: its draws made, its geometry thrown away)
  // a stone's tone: most of them the masonry's own, some lighter (a cleaner block), some darker (weathered)
  M.tone = () => { const q = R(); return q < .12 ? .26 + R() * .06 : q < .34 ? -.22 - R() * .06 : (R() - .5) * .14; };
  // a stone's own axes on a frame: turned (yaw) about the vertical, leaning (pitch) about its length, rolled about its depth
  M.axes = (u, w, yaw, pitch, roll) => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    let U = [u[0] * cy + w[0] * sy, 0, u[2] * cy + w[2] * sy], W = [w[0] * cy - u[0] * sy, 0, w[2] * cy - u[2] * sy], V = [0, 1, 0];
    const cr = Math.cos(roll), sr = Math.sin(roll); [U, V] = [[U[0] * cr + V[0] * sr, U[1] * cr + V[1] * sr, U[2] * cr + V[2] * sr], [V[0] * cr - U[0] * sr, V[1] * cr - U[1] * sr, V[2] * cr - U[2] * sr]];
    const cp = Math.cos(pitch), sp = Math.sin(pitch); [V, W] = [[V[0] * cp + W[0] * sp, V[1] * cp + W[1] * sp, V[2] * cp + W[2] * sp], [W[0] * cp - V[0] * sp, W[1] * cp - V[1] * sp, W[2] * cp - V[2] * sp]];
    return [U, V, W];
  };
  // ONE COURSE along a line: L.a [x, z] its start, L.u / L.w its frame, L.L its length, L.D the depth; corner stones at its ends (long
  // and short by turns with the course k, so the ends interlock); top(s) the masonry's top there, H its full height (a stone under a
  // broken top is knocked askew), next: the next course's height (0: the last course), ground(x, z), pieceOf(s), off: the line's
  // centre shifted across it (m)
  M.row = (L, y, hk, k, next, top, H, ground, pieceOf, proud = 0) => {
    const tb = top.base || top;   // (pulled, docs/exp/brawl.md: the draws as without the pull; a stone over the pulled top is built into the void)
    const lens = [], q0 = QUOIN[k % 2], q1 = QUOIN[(k + 1) % 2], len = L.L;
    if (len < .5) lens.push(len);
    else {
      let s = Math.min(rr(...q0), len * .45); lens.push(s);
      const qEnd = Math.min(rr(...q1), len - s);
      while (s < len - qEnd - .2) { const l = Math.min(k === 0 ? rr(...LEN0) : rr(...LEN), len - qEnd - s); lens.push(l); s += l; }
      lens.push(len - s);
    }
    let s0 = 0;
    for (const l of lens) {
      const sc = s0 + l / 2; s0 += l;
      const t = Math.min(tb(sc), tb(clamp(sc - l * .35, 0, len)), tb(clamp(sc + l * .35, 0, len)));
      if (y + hk * .55 > t) continue;                              // broken off here
      const tp = tb === top ? t : Math.min(top(sc), top(clamp(sc - l * .35, 0, len)), top(clamp(sc + l * .35, 0, len))), gone = y + hk * .55 > tp;
      const loose = y + hk > tp - .02 && tp < H - .02, rg = L.rough || 1;   // (loose: the topmost of a broken column, knocked askew)
      const [U, V, W] = M.axes(L.u, L.w, (R() - .5) * (loose ? .14 : .04) * rg, (R() - .5) * (loose ? .12 : .05) * rg, (R() - .5) * (loose ? .1 : .025) * rg);
      const out = (R() - .5) * (loose ? .05 : .025) * rg + (L.off || 0), x = L.a[0] + L.u[0] * sc + L.w[0] * out, z = L.a[1] + L.u[2] * sc + L.w[2] * out, g = ground(x, z);
      const B = gone ? M.void() : pieceOf(sc);
      cuboid(B, [x, g + y + hk / 2, z], U, V, W, l / 2 - SHRINK, hk / 2 - SHRINK, L.D / 2 + proud, fs, B.part(), M.tone() + (k === 0 ? -.04 : 0), R, .06 * rg);
      // (it ends its column where the next course is broken off over it; in the last course, where no coping lies on it)
      if (next ? y + hk + next * .55 > tb(sc) : t < H - .01) M.tops.push({x, z, u: L.u, w: L.w, l, d: L.D, y: g + y + hk + (loose ? .01 : 0), B, cope: false, broken: t < H - .02});
    }
  };
  // a flat slab (a coping stone, a floor, a capstone) centred at c on the frame, sizes along / up / across
  M.slab = (B, c, u, w, l, h, d, tone = .06) => {
    const [U, V, W] = M.axes(u, w, (R() - .5) * .03, (R() - .5) * .03, 0);
    cuboid(B, c, U, V, W, l / 2 - SHRINK, h / 2, d / 2, fs, B.part(), tone + (R() - .5) * .1, R, .05);
  };
  // MOSS on a top (a blanket over most of it: its long edges at the faces, its ends ragged, a bite out of it now and then, hanging a
  // little over the faces; half of it in the light tone, half a shade down) and blades of GRASS in it (fins: a face either way)
  M.moss = (T, seedK) => {
    if (fc === null || fc === undefined) return;
    if (R() > (T.broken ? .55 : .2) + vnoise(T.x * .8, T.z * .8 + 7.5, seedK | 0) * .45) return;
    const B = T.B, p = B.part(), u = T.u, w = T.w, half = T.l / 2 * rr(.55, 1), sc = (R() - .5) * (T.l / 2 - half), y0 = T.y + .012, hw = T.d / 2 + (T.cope ? .03 : 0) + .012;
    const at = (s, off, y) => [T.x + u[0] * s + w[0] * off, y, T.z + u[2] * s + w[2] * off];
    const e0 = rr(.04, .12), e1 = rr(.04, .12), bite = R() < .4 ? rr(.06, .16) : 0, side = R() < .5 ? -1 : 1, mid = sc + (R() - .5) * half;
    B.poly([at(sc - half, -hw, y0), at(mid, -hw + (side < 0 ? bite : 0), y0), at(sc + half, -hw, y0), at(sc + half + e1, 0, y0),
      at(sc + half, hw, y0), at(mid, hw - (side > 0 ? bite : 0), y0), at(sc - half, hw, y0), at(sc - half - e0, 0, y0)], UP, fc, p, R() < .55 ? -.22 : .02);
    for (const sd of [-1, 1]) for (let a = sc - half; a < sc + half - .04;) {
      const b = Math.min(sc + half, a + rr(.08, .2)), hang = R() < .35 ? 0 : rr(.02, .13);
      if (hang > 0) B.poly([at(a, sd * hw, y0), at(b, sd * hw, y0), at(b, sd * hw, y0 - hang), at(a, sd * hw, y0 - hang * rr(.5, 1))], [w[0] * sd, 0, w[2] * sd], fc, p, sd > 0 ? 0 : -.1);
      a = b;
    }
    if (R() < (T.broken ? .7 : .35)) {
      const n = 2 + (R() * 3 | 0);
      for (let i = 0; i < n; i++) {
        const s = sc + (R() - .5) * half * 1.6, off = (R() - .5) * T.d * .7, hgt = rr(.08, .22), lean = (R() - .5) * .08, wd = rr(.02, .035);
        const A = at(s - wd, off, y0), C = at(s + wd, off, y0), Tp = at(s + lean, off + (R() - .5) * .05, y0 + hgt), q = B.part();
        B.poly([A, C, Tp], [w[0], .2, w[2]], fc, q, .08); B.poly([C, A, Tp], [-w[0], .2, -w[2]], fc, q, -.05);
      }
    }
  };
  // a FALLEN STONE lying at (x, z): weathered (darker), tilted, half sunk in the grass
  M.fallen = (B, x, z, ground, big = 1) => {
    const l = rr(.2, .44) * big, hk = rr(.1, .22) * big, dd = rr(.18, .32) * big, g = ground(x, z);
    const [U, V, W] = M.axes([1, 0, 0], [0, 0, 1], R() * Math.PI, (R() - .5) * .45, (R() - .5) * .35);
    cuboid(B, [x, g + hk * .18, z], U, V, W, l / 2, hk / 2, dd / 2, fs, B.part(), -.2 + M.tone() * .4, R, .14);
  };
  return M;
}

export function wallRun(run, o) {
  const [ax, az] = run.a, [bx, bz] = run.b, L = Math.hypot(bx - ax, bz - az); if (L < .05) return {geos: [], tops: []};
  const u = [(bx - ax) / L, 0, (bz - az) / L], w = [-u[2], 0, u[0]], H = run.h, D = run.d, M = mason(run.seed, o), {R, rr} = M;
  const ground = run.ground || (() => 0), top = profile(run), tb = top.base || top;
  const cuts = run.cuts || [0, L], sinks = cuts.slice(1).map(() => sink());
  const pieceOf = s => { let i = 0; while (i < sinks.length - 1 && s >= cuts[i + 1]) i++; return sinks[i]; };
  const line = {a: [ax, az], u, w, L, D, rough: run.rough || 1};
  // ---- the courses
  const C = coursesTo(H - COPE, R, run.sink ?? -.06);
  C.forEach(([y, hk], k) => M.row(line, y, hk, k, C[k + 1]?.[1] || 0, top, H, ground, pieceOf, k === 0 ? .025 : 0));
  // ---- the coping where the wall stands whole: long slabs a little proud of both faces, the odd one gone
  for (let s = 0; s < L - .05;) {
    const l = Math.min(rr(.45, .78), L - s), sc = s + l / 2; s += l;
    if (tb(s - l + .04) < H - .01 || tb(s - .04) < H - .01 || R() < .1) continue;
    const x = ax + u[0] * sc, z = az + u[2] * sc, g = ground(x, z), B = top(s - l + .04) < H - .01 || top(s - .04) < H - .01 ? M.void() : pieceOf(sc);   // (pulled: gone)
    M.slab(B, [x, g + H - COPE / 2, z], u, w, l, COPE, D + .06);
    M.tops.push({x, z, u, w, l, d: D, y: g + H, B, cope: true, broken: false});
  }
  for (const T of M.tops) { const pulled = tb !== top && T.y - ground(T.x, T.z) > top(clamp((T.x - ax) * u[0] + (T.z - az) * u[2], 0, L)) + .05; if (pulled) T.B = M.void(); M.moss(T, run.seed); }
  // ---- rubble: stones fallen from the broken stretches, in the grass at the foot (more on one side)
  for (let s = .2; s < L - .2; s += .45) {
    const drop = H - tb(s); if (drop < .35 || R() > drop / H * 1.3) continue;
    const n = 1 + (R() < .35 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const side = R() < .6 ? 1 : -1, off = side * (D / 2 + rr(.1, .65)), sc = clamp(s + (R() - .5) * .4, 0, L - 1e-3);
      M.fallen(pieceOf(sc), ax + u[0] * sc + w[0] * off, az + u[2] * sc + w[2] * off, ground);
    }
  }
  // the PULLED stones (docs/exp/brawl.md): on the ground at the foot, the side they were pulled to (their own draws, after all the rest)
  if (run.pulls) { const Rp = mulberry32((run.seed | 0) * 31 + 977), rp = (a, b) => a + (b - a) * Rp();
    for (const [s0, s1, dh, side] of run.pulls) for (let i = 0, n = 3 + Math.round(dh * 6); i < n; i++) {
      const sc = clamp(rp(s0, s1), 0, L - 1e-3), off = (side || 1) * (D / 2 + rp(.15, 1.1)), x = ax + u[0] * sc + w[0] * off, z = az + u[2] * sc + w[2] * off, g = ground(x, z);
      const l = rp(.3, .6), hk = rp(.2, .34), dd = rp(.25, .4), [U, V, W] = M.axes([1, 0, 0], [0, 0, 1], Rp() * Math.PI, (Rp() - .5) * .5, (Rp() - .5) * .4);
      const B = pieceOf(sc); cuboid(B, [x, g + hk * .3, z], U, V, W, l / 2, hk / 2, dd / 2, M.fs, B.part(), M.tone() * .5 - .05, Rp, .1);
    }
  }
  // each piece's highest standing point (arrows, gadgets and the lasso read it: world.js topOfProp)
  const tops = sinks.map((_, i) => { let m = 0; for (let k = 0; k <= 6; k++) m = Math.max(m, top(cuts[i] + (cuts[i + 1] - cuts[i]) * k / 6)); return m; });
  return {geos: sinks.map(B => B.geometry()), tops};
}

// a square tower: its four faces' courses (the rows running past the corner by turns: N / S full on even courses, E / W on odd), a
// rubble core in its shell, its stone floor and a parapet of merlons where it stands whole; broken round its top (ruin), or fallen
// to a stump (t.stump: its stones all round its foot, most of them the way t.out points)
export function towerRun(t, o) {
  const B = sink(), M = mason(t.seed, o), {R, rr} = M, ground = t.ground || (() => 0), S = t.S, half = S / 2, D = t.d, H = t.h;
  const P = 4 * S, ruin = t.ruin || 0;
  // the top round its perimeter (p: 0 .. 4 S, the N face west to east, then E, S, W), whole where its noise allows
  const topP = p => {
    const n = vnoise(p * .55, .5, t.seed) * .7 + vnoise(p * 1.6, 3.5, t.seed + 1) * .3;
    if (t.stump) return Math.min(H, t.stump + (n - .4) * 1.6);   // (a jagged stump: one corner standing higher)
    return H - H * .45 * smooth((n - (1 - ruin)) / .22);
  };
  // the faces as lines (start, along, outward), each laid inward of its outer face by half the shell
  const F = [
    {a: [t.x - half, t.z - half + D / 2], u: [1, 0, 0], w: [0, 0, -1]}, {a: [t.x + half - D / 2, t.z - half], u: [0, 0, 1], w: [1, 0, 0]},
    {a: [t.x + half, t.z + half - D / 2], u: [-1, 0, 0], w: [0, 0, 1]}, {a: [t.x - half + D / 2, t.z + half], u: [0, 0, -1], w: [-1, 0, 0]}];
  const C = coursesTo(H, R), allTop = Math.min(...Array.from({length: 24}, (_, i) => topP(i * P / 24)));
  C.forEach(([y, hk], k) => F.forEach((f, i) => {
    const full = (k + i) % 2 === 0, trim = full ? 0 : D;   // (the even faces run past the corner on even courses: the odd ones between them)
    const line = {a: [f.a[0] + f.u[0] * trim, f.a[1] + f.u[2] * trim], u: f.u, w: f.w, L: S - 2 * trim, D};
    M.row(line, y, hk, k, C[k + 1]?.[1] || 0, s => topP(i * S + trim + s), H, ground, () => B, k === 0 ? .03 : 0);
  }));
  // the core inside the shell: rubble fill, a little under the lowest of the top (a broken tower shows it; a whole one floors it over)
  const ci = half - D, coreTop = Math.max(.3, allTop - .25);
  for (let i = 0; i < 5; i++) {
    const x = t.x + (R() - .5) * ci * 1.4, z = t.z + (R() - .5) * ci * 1.4, l = rr(.22, .4), h = rr(.16, .3);
    const [U, V, W] = M.axes([1, 0, 0], [0, 0, 1], R() * Math.PI, (R() - .5) * .3, (R() - .5) * .3);
    cuboid(B, [x, ground(t.x, t.z) + coreTop - h * .4, z], U, V, W, l / 2, h / 2, l / 2, M.fs, B.part(), -.24 + M.tone() * .3, R, .14);
  }
  let top = Math.max(...Array.from({length: 24}, (_, i) => topP(i * P / 24)));
  // the floor and the parapet, where it stands whole all round
  if (!t.stump && allTop >= H - .01) {
    const g = ground(t.x, t.z), y0 = g + H;
    M.slab(B, [t.x, y0 + .06, t.z], [1, 0, 0], [0, 0, 1], S + .06, .12, S + .06, .04);
    M.tops.push({x: t.x, z: t.z, u: [1, 0, 0], w: [0, 0, 1], l: S * .7, d: S * .7, y: y0 + .12, B, cope: true, broken: false});
    const PH = .28, MH = .34, MW = .28, PT = .26;
    F.forEach((f, i) => {
      const ox = f.a[0] + f.w[0] * (D / 2 - PT / 2), oz = f.a[1] + f.w[2] * (D / 2 - PT / 2);   // (the parapet on the outer edge)
      for (let s = 0; s < S - .02;) {   // its wall: long stones, a stretch broken off now and then (ruin)
        const l = Math.min(rr(.35, .6), S - s), sc = s + l / 2; s += l;
        if (R() < ruin * .55) continue;
        M.slab(B, [ox + f.u[0] * sc, y0 + .12 + PH / 2, oz + f.u[2] * sc], f.u, f.w, l, PH, PT, M.tone() * .5);
        if (Math.abs(sc - S / 2) < .3 || R() < .3) M.tops.push({x: ox + f.u[0] * sc, z: oz + f.u[2] * sc, u: f.u, w: f.w, l, d: PT, y: y0 + .12 + PH, B, cope: false, broken: true});
      }
      for (let m = 0; m < 3; m++) {   // the merlons, the odd one gone (more of them on a broken tower) or fallen at its foot
        const sc = .22 + m * (S - .44) / 2;
        if (R() < .15 + ruin * .6) { if (R() < .5) M.fallen(B, t.x + f.w[0] * (half + rr(.3, 1.2)) + f.u[0] * (sc - half), t.z + f.w[2] * (half + rr(.3, 1.2)) + f.u[2] * (sc - half), ground); continue; }
        M.slab(B, [ox + f.u[0] * sc, y0 + .12 + PH + MH / 2, oz + f.u[2] * sc], f.u, f.w, MW, MH, PT + .02, M.tone() * .5 + .04);
        top = Math.max(top, H + .12 + PH + MH);
      }
    });
  }
  for (const T of M.tops) M.moss(T, t.seed);
  // fallen stones: round a broken top's foot; a stump's all round, most of them its way out (its collapse)
  const nFall = t.stump ? 22 : Math.round((H - allTop) * 4);
  const ox = t.out ? t.out[0] : 0, oz = t.out ? t.out[1] : 0;
  for (let i = 0; i < nFall; i++) {
    let a = R() * Math.PI * 2, d = half + rr(.2, t.stump ? 2.4 : 1.1);
    if (t.stump && R() < .65) a = Math.atan2(oz, ox) + (R() - .5) * 1.6;
    M.fallen(B, t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, ground, t.stump && R() < .4 ? 1.5 : 1);
  }
  return {geo: B.geometry(), top};
}

// a gatepost: courses of two blocks each (split one way, then the other), and its capstones (a broad one, a narrower one on it);
// broken (t.broken): its top courses and its cap gone, the cap at its foot
export function postRun(t, o) {
  const B = sink(), M = mason(t.seed, o), {R, rr} = M, ground = t.ground || (() => 0), S = t.S, H = t.h, g = ground(t.x, t.z);
  const stand = t.broken ? H - rr(.5, .8) : H, C = coursesTo(stand, R);
  C.forEach(([y, hk], k) => {
    const alongX = k % 2 === 0, u = alongX ? [1, 0, 0] : [0, 0, 1], w = alongX ? [0, 0, 1] : [1, 0, 0];
    for (const sd of [-1, 1]) {
      const [U, V, W] = M.axes(u, w, (R() - .5) * .04, (R() - .5) * .05, (R() - .5) * .025);
      cuboid(B, [t.x + w[0] * sd * S / 4, g + y + hk / 2, t.z + w[2] * sd * S / 4], U, V, W, S / 2 + (k === 0 ? .03 : 0) - SHRINK, hk / 2 - SHRINK, S / 4 - SHRINK, M.fs, B.part(), M.tone() + (k === 0 ? -.04 : 0), R, .06);
    }
  });
  let top = stand;
  if (!t.broken) {
    M.slab(B, [t.x, g + H + .07, t.z], [1, 0, 0], [0, 0, 1], S + .16, .14, S + .16);
    M.slab(B, [t.x, g + H + .19, t.z], [1, 0, 0], [0, 0, 1], S - .1, .1, S - .1);
    M.tops.push({x: t.x, z: t.z, u: [1, 0, 0], w: [0, 0, 1], l: S - .1, d: S - .1, y: g + H + .24, B, cope: true, broken: false});
    top = H + .24;
  } else {
    M.tops.push({x: t.x, z: t.z, u: [1, 0, 0], w: [0, 0, 1], l: S, d: S, y: g + stand, B, cope: false, broken: true});
    M.fallen(B, t.x + rr(.5, .9) * (R() < .5 ? -1 : 1), t.z + rr(.4, .8), ground, 1.6);   // (its capstone)
  }
  for (const T of M.tops) M.moss(T, t.seed);
  return {geo: B.geometry(), top};
}
