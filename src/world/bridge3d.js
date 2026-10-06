// BRIDGE3D: the brook's stone arch bridge where it crosses the West Downs' track, its stepping stones and the rocks in its water,
// laid in the browser with the mason of world/walls3d.js (the arena walls' look: dressed stones, each its own part, toned its own way,
// moss on the tops). ONE geometry (world.js shows it as one static mesh). The layout's numbers come from world/brook.js (lay: its
// BRIDGE, the deck that layout.js deckAt walks on, the stones' tops):
//   ring      a segmental arch of wedge stones (VOUSSOIRS) over the brook, a proud keystone at its crown, the springers resting on
//             the abutments; through the barrel (the bridge's width) each course in a face stone, two long ones and a face stone
//   faces     the SPANDRELS and abutments on both faces: courses of stones from below the ground to the deck, cut round the ring (a
//             stone over the ring follows its back in strips), the opening left clear down to the water
//   deck      paving slabs across the road between the parapets, each laid on the deck's hump (its top is the walked deck)
//   parapets  low walls along both sides on the hump: stones laid to its slope, a coping of long slabs (the odd one gone), an end
//             block at each corner; moss and grass on the copings
//   stones    the stepping stones (flat rocks, their tops the decks you stand on)
// bridgeGeometry(B, o) -> BufferGeometry | null. B = world/brook.js BROOK (after lay), o = {fam(name) -> family index, cover: the moss
// family or null, ground(x, z) -> m: the drawn ground}. Frame: world metres, x east, y up, z south.
import {mason} from './walls3d.js';
import {sink, cuboid} from './cliffs3d.js';
import {clamp} from '../core/mathx.js';
import {mulberry32} from '../core/rng.js';

const UP = [0, 1, 0], SHRINK = .006;

export function bridgeGeometry(BK, o) {
  const D = BK?.bridge; if (!D && !BK?.stones.length) return null;
  const B = sink(), M = mason(907, o), {R, rr} = M, fs = M.fs, fr = o.fam('rock'), ground = o.ground || (() => 0);
  if (D) {
    const ux = D.ux, uy = D.uy, u = [ux, 0, uy], w = [-uy, 0, ux], L = D.len, W = D.w, sc = L / 2;
    const P = (s, v, y) => [D.a[0] + ux * s - uy * v, y, D.a[1] + uy * s + ux * v];
    const deck = s => D.h0 + (D.h1 - D.h0) * s / L + D.arch * Math.sin(Math.PI * s / L);
    const slope = s => (D.h1 - D.h0) / L + D.arch * Math.PI / L * Math.cos(Math.PI * s / L);
    // the arch: springing ys, span S, rise r: radius Rr round (sc, yc); the ring's back at Ro; phiI / phiO: where the inner / outer
    // circle meet the springing line (from the vertical); Se: how far out the ring's back meets it
    const ys = D.spring, S = D.span, r = D.rise, Rr = (S * S / 4 + r * r) / (2 * r), yc = ys + r - Rr, Ro = Rr + D.ring;
    const phiI = Math.asin(S / 2 / Rr), phiO = Math.acos(clamp((ys - yc) / Ro, -1, 1)), Se = Ro * Math.sin(phiO);
    const ext = s => { const d = s - sc; return Math.abs(d) < Ro ? yc + Math.sqrt(Ro * Ro - d * d) : -1e9; };
    const FD = .34, PD = D.para.d, PH = D.para.h, COPE = .1;
    // a stone as a prism across the bridge (v0 .. v1) over a span of s whose bottom / top follow bot(s) / top(s): in strips where its
    // bottom curves (over the ring), one quad each way otherwise. out: the outward face's sign along w (the face it shows), proud: m
    // the face stands out of the wall's line. Ends drawn only at the stone's ends
    function strip(s0, s1, v0, v1, bot, top, k, f = fs, tone = M.tone(), proud = 0, out = 0) {
      let hmax = 0; for (let i = 0; i <= 4; i++) { const s = s0 + (s1 - s0) * i / 4; hmax = Math.max(hmax, top(s) - bot(s)); }
      if (hmax < .05) return false;
      const p = B.part(), vo = out > 0 ? v1 + proud : v1, vi = out < 0 ? v0 - proud : v0;
      const pts = []; for (let i = 0; i <= k; i++) { const s = s0 + (s1 - s0) * i / k, b = bot(s), t = Math.max(b, top(s)); pts.push([s, b + SHRINK, t - SHRINK]); }
      for (let i = 0; i < k; i++) {
        const [sa, ba, ta] = pts[i], [sb, bb, tb] = pts[i + 1];
        if (ta - ba < .004 && tb - bb < .004) continue;
        const sa2 = i === 0 ? sa + SHRINK : sa, sb2 = i === k - 1 ? sb - SHRINK : sb;
        B.poly([P(sa2, vo, ba), P(sb2, vo, bb), P(sb2, vo, tb), P(sa2, vo, ta)], w, f, p, tone);
        B.poly([P(sa2, vi, ba), P(sb2, vi, bb), P(sb2, vi, tb), P(sa2, vi, ta)], [-w[0], 0, -w[2]], f, p, tone);
        B.poly([P(sa2, vi, ta), P(sb2, vi, tb), P(sb2, vo, tb), P(sa2, vo, ta)], UP, f, p, tone + .02);
        B.poly([P(sa2, vi, ba), P(sb2, vi, bb), P(sb2, vo, bb), P(sa2, vo, ba)], [0, -1, 0], f, p, tone - .04);
      }
      const [s0e, b0, t0] = pts[0], [s1e, b1, t1] = pts[k];
      if (t0 - b0 > .004) B.poly([P(s0e + SHRINK, vi, b0), P(s0e + SHRINK, vo, b0), P(s0e + SHRINK, vo, t0), P(s0e + SHRINK, vi, t0)], [-u[0], 0, -u[2]], f, p, tone);
      if (t1 - b1 > .004) B.poly([P(s1e - SHRINK, vi, b1), P(s1e - SHRINK, vo, b1), P(s1e - SHRINK, vo, t1), P(s1e - SHRINK, vi, t1)], u, f, p, tone);
      return true;
    }
    // a convex prism (a voussoir): its outline [[s, y], ...] across v0 .. v1, every face turned away from its centre
    function prism(Q, v0, v1, f, tone) {
      const p = B.part(), n = Q.length; let cs = 0, cy = 0; for (const [s, y] of Q) { cs += s; cy += y; } cs /= n; cy /= n;
      const c = P(cs, (v0 + v1) / 2, cy);
      B.polyC(Q.map(([s, y]) => P(s, v1, y)), c, f, p, tone); B.polyC(Q.map(([s, y]) => P(s, v0, y)), c, f, p, tone);
      for (let i = 0; i < n; i++) { const [sa, ya] = Q[i], [sb, yb] = Q[(i + 1) % n]; B.polyC([P(sa, v0, ya), P(sb, v0, yb), P(sb, v1, yb), P(sa, v1, ya)], c, f, p, tone + (yb - ya > 0 ? .02 : -.02)); }
    }
    // ---- the ring: N voussoirs (odd: a keystone at the crown); the first and last (the springers) reach down the ring's back to the
    // springing line. Through the barrel: a face stone (deep or shallow by turns), two long ones, a face stone
    const N = Math.max(7, Math.round(2 * phiI * Rr / .2) | 1), at = (rad, a) => [sc + rad * Math.sin(a), yc + rad * Math.cos(a)];
    for (let k = 0; k < N; k++) {
      const a0 = -phiI + 2 * phiI * k / N + .006, a1 = -phiI + 2 * phiI * (k + 1) / N - .006, key = k === (N - 1) >> 1, ro = key ? Ro + .05 : Ro;
      let Q = [at(Rr, a0), at(Rr, a1), at(ro, a1), at(ro, a0)];
      if (k === 0) Q = [[sc - S / 2, ys], at(Rr, a1), at(Ro, a1), at(Ro, (a1 - phiO) / 2), [sc - Se, ys]];
      else if (k === N - 1) Q = [at(Rr, a0), [sc + S / 2, ys], [sc + Se, ys], at(Ro, (a0 + phiO) / 2), at(Ro, a0)];
      const d0 = k % 2 ? .3 : .47, d1 = k % 2 ? .46 : .31, mid = -W / 2 + d0 + (W - d0 - d1) * rr(.42, .58), proud = key ? .03 : rr(0, .012);
      prism(Q, -W / 2 - proud, -W / 2 + d0, fs, M.tone() + (key ? .06 : 0));
      prism(Q, -W / 2 + d0 + .004, mid, fs, M.tone() - .06);
      prism(Q, mid + .004, W / 2 - d1 - .004, fs, M.tone() - .06);
      prism(Q, W / 2 - d1, W / 2 + proud, fs, M.tone() + (key ? .06 : 0));
    }
    // ---- the faces: spandrels over the ring, abutments under the springing line, down into the ground; the opening stays clear
    const gAt = (s, v) => { const q = P(s, v, 0); return ground(q[0], q[2]); };
    let lowest = 1e9; for (let i = 0; i <= 24; i++) for (const v of [-W / 2, W / 2]) lowest = Math.min(lowest, gAt(L * i / 24, v) - .14);
    const below = Math.max(1, Math.round((ys - lowest) / .3)), courses = [];
    for (let i = 0; i < below; i++) courses.push([lowest + (ys - lowest) * i / below, lowest + (ys - lowest) * (i + 1) / below]);
    for (let y = ys, top = Math.max(...Array.from({length: 25}, (_, i) => deck(L * i / 24))); y < top - .02;) { const h = rr(.24, .34); courses.push([y, Math.min(top, y + h)]); y += h; }
    for (const sd of [-1, 1]) {
      const v0 = sd > 0 ? W / 2 - FD : -W / 2, v1 = sd > 0 ? W / 2 : -W / 2 + FD, vm = (v0 + v1) / 2;
      const g = s => gAt(s, vm) - .12;
      courses.forEach(([y0, y1], ci) => {
        const under = y1 <= ys + 1e-6;   // (a course under the springing line: the opening is clear down to the water)
        const runs = under ? [[0, sc - S / 2], [sc + S / 2, L]] : [[0, L]];
        for (const [ra, rb] of runs) {
          for (let s = ra; s < rb - .02;) {
            const first = s === ra, l = Math.min(first ? rr(.45, .7) : rr(.3, .66), rb - s), s0 = s, s1 = s + l; s = s1;
            const bot = q => Math.max(y0, g(q), under ? -1e9 : ext(q));
            const top = q => Math.min(y1, deck(q));
            const curved = !under && s1 > sc - Ro && s0 < sc + Ro;
            strip(s0, s1, v0, v1, bot, top, curved ? Math.max(1, Math.ceil(l / .06)) : 1, fs, M.tone() + (ci === 0 ? -.05 : 0), rr(0, .014), sd);
          }
        }
      });
    }
    // the opening's sides (the abutments' faces toward the water, across the barrel), under the springing line
    for (const e of [-1, 1]) {
      const sm = e < 0 ? sc - S / 2 - .15 : sc + S / 2 + .15;
      for (let v = -W / 2 + FD; v < W / 2 - FD - .02;) {
        const l = Math.min(rr(.35, .55), W / 2 - FD - v), q = P(sm, v + l / 2, 0), gy = ground(q[0], q[2]) - .1;
        if (ys - gy > .04) { const [U, V, Wv] = M.axes(u, w, 0, 0, 0); cuboid(B, [q[0], (ys + gy) / 2, q[2]], U, V, Wv, .15 - SHRINK, (ys - gy) / 2 - SHRINK, l / 2 - SHRINK, fs, B.part(), M.tone() - .08, R, .04); }
        v += l;
      }
    }
    // ---- the deck: paving slabs across the road, laid on the hump (their tops the deck walked on)
    const RW = W / 2 - PD;
    for (let s = .05; s < L - .05;) {
      const l = Math.min(rr(.3, .44), L - .05 - s), sm = s + l / 2, roll = Math.atan(slope(sm)); s += l;
      const n = R() < .5 ? 2 : 3, cuts = [-RW]; for (let i = 1; i < n; i++) cuts.push(-RW + 2 * RW * (i + rr(-.2, .2)) / n); cuts.push(RW);
      for (let i = 0; i < n; i++) {
        const va = cuts[i], vb = cuts[i + 1], [U, V, Wv] = M.axes(u, w, (R() - .5) * .03, 0, roll), hk = .1, q = P(sm, (va + vb) / 2, deck(sm) - hk / 2);
        cuboid(B, q, U, V, Wv, l / 2 / Math.cos(roll) - SHRINK, hk / 2, (vb - va) / 2 - SHRINK, fs, B.part(), M.tone() * .6 - .1, R, .03);
      }
    }
    // ---- the parapets: stones laid to the hump's slope, a coping of long slabs, an end block at each corner
    for (const sd of [-1, 1]) {
      const vm = sd * (W / 2 - PD / 2);
      for (let s = .32; s < L - .32;) {
        const l = Math.min(rr(.34, .58), L - .32 - s), sm = s + l / 2, roll = Math.atan(slope(sm)); s += l;
        const [U, V, Wv] = M.axes(u, w, (R() - .5) * .02, (R() - .5) * .03, roll), q = P(sm, vm, deck(sm) + PH / 2);
        cuboid(B, q, U, V, Wv, l / 2 / Math.cos(roll) - SHRINK, PH / 2 - SHRINK, PD / 2 - SHRINK, fs, B.part(), M.tone(), R, .05);
      }
      for (let s = .32; s < L - .32;) {
        const l = Math.min(rr(.5, .78), L - .32 - s), sm = s + l / 2, roll = Math.atan(slope(sm)); s += l;
        if (R() < .07) continue;   // (a coping stone gone)
        const [U, V, Wv] = M.axes(u, w, (R() - .5) * .03, (R() - .5) * .03, roll), y = deck(sm) + PH + COPE / 2, q = P(sm, vm, y);
        cuboid(B, q, U, V, Wv, l / 2 / Math.cos(roll) - SHRINK, COPE / 2, PD / 2 + .03, fs, B.part(), M.tone() * .5 + .05, R, .04);
        const c = P(sm, vm, 0); M.tops.push({x: c[0], z: c[2], u: U, w: Wv, l, d: PD, y: y + COPE / 2, B, cope: true, broken: false});
      }
      for (const s of [.16, L - .16]) {   // the end blocks
        const h = PH + COPE + .16, [U, V, Wv] = M.axes(u, w, (R() - .5) * .04, 0, 0), q = P(s, vm, deck(s) + h / 2 - .04);
        cuboid(B, q, U, V, Wv, .17, h / 2, PD / 2 + .04, fs, B.part(), M.tone() * .5 + .02, R, .05);
        const c = P(s, vm, 0); M.tops.push({x: c[0], z: c[2], u: U, w: Wv, l: .3, d: PD, y: deck(s) + h - .04, B, cope: true, broken: false});
      }
    }
    for (const T of M.tops) M.moss(T, 907);
  }
  // ---- the stepping stones: flat-topped rocks, worn round, their tops the decks
  for (const s of BK.stones) {
    const r = mulberry32(s.seed), tx = s.tx, ty = s.ty, bed = s.top - .26, hk = s.top - bed;
    const U = [tx, 0, ty], Wv = [-ty, 0, tx], a = (r() - .5) * .5, c = Math.cos(a), si = Math.sin(a);
    const U2 = [U[0] * c + Wv[0] * si, 0, U[2] * c + Wv[2] * si], W2 = [Wv[0] * c - U[0] * si, 0, Wv[2] * c - U[2] * si];
    cuboid(B, [s.x, bed + hk / 2, s.y], U2, UP, W2, s.r * 1.04, hk / 2, s.r * .86, fr, B.part(), (r() - .5) * .12 + .04, r, .2, .74);
  }
  return B.geometry();
}
