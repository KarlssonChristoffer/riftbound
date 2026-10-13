// CLIFFS3D: the world's rock faces as live 3D rock: the plateau's sides (the mesa's cliffs), terraces' and ramps' walls and the south ravine's wall (world.js lays the
// runs). ONE geometry per cliff with the prop pipeline's attributes (aPart / aFam / aBias / aFixed, as trees3d.js), so it is
// toned by the biome's ramps, outlined, seamed and shadowed like the kit's rocks, and it reads right at every yaw.
//   strata  a face is cut into horizontal LAYERS (.3-.6 m) whose bedding lines wander a little up and down along the face.
//           Each layer breaks into BLOCKS at slanting joints: long ones in the hard layers, short broken ones in the soft
//           layers. A block is a slab running back into the bank; its front is a row of FACETS (a crease every .25-.5 m, each
//           turned its own way), so the art light (gfx.js uLArt, from the north-west and above) splits it into lit and
//           shaded planes in the three tones, the way a painted rock is cut. Its front leans (back at the top: lit; out: an
//           overhang in shade), its top front edge is bevelled (the lit lip every painted layer had), and it stands in or out of
//           the face line by its layer's profile: hard layers stand out, soft ones weather back under them, a block now and
//           then is gone (a dark hollow). Every block is its own part, so the composite draws the joints as seams and the steps
//           between blocks as occlusion lines (gfx.js COMP_FS: the pixelizer's rules); a facet's crease is only a change of tone
//   cap     the top layer never weathers back past the face line (the ground's edge never overhangs as a paper-thin sheet). Its
//           top lies a few mm under the ground and slopes down into the bank (no fighting with the flat ground over it); where
//           it stands out it shows as a rocky rim, with the biome's cover (moss, snow, ash) on what faces up (gfx.js MESH_FS)
//   lip     tufts of the cover hanging over the cap's front and lying on its rim (the painted face's grass hang)
//   talus   loose stones at the foot of a run whose foot is dry ground (the plateau's)
//   ladder  a wooden ladder against a face (a climb spot: layout.js CLIMBS)
//   bridge  a wooden footbridge (layout.js BRIDGES); stairs: stone steps up a ramp
// cliffGeometry(runs, o) -> BufferGeometry | null (no rock at all)
//   run = {pts: [[x, z], ...] the face line (m; x east, z south), travelled so the OUTSIDE lies at (-tz, tx) of the direction
//          of travel (east along a south face), top (m: the ground above), bot(x, z) -> the foot's height there (minBot: its
//          lowest along the run - .05), base (m, 0): added to every block's offset (the ravine stands its rock in front of the
//          ground's own steep cells), relief (1): how far in and out the layers, blocks and facets stand,
//          skip(x, z) -> true where there is no rock (a waterfall over the edge), keep(x, z) -> the most the rock may stand out
//          there (m) or null (a waterfall's sheet, a ladder), talus: stones at the foot, avoid(x, z) -> true where no stone
//          may lie (props, water), lip: the cover hangs over the cap, dark(y) -> extra tone bias by height (a deep ravine
//          shades toward its floor), massive: rock in thick, wavy, broken beds (MASSIVE: a gully's weathered
//          bedrock, not a quarried face), seed}
//   o = {fam(name) -> family index (world.js FAMS), rockB: a second family for alternate layers (the desert's bands) or null,
//        cover: the lip's family or null, ladders: [{x, z, h, y0, nx, nz}] (foot centre, top height, the foot's height (0), the outward normal),
//        bridges: layout.js BRIDGES, stairs: [{pts: [a, b], w, h0, h1, n}] (a stepped ramp's line, width, heights, treads)}
// Frame: world metres, x east, y up, z south (the geometry is placed with an identity matrix). Built once per world.
import * as THREE from 'three';
import {vnoise, clamp} from '../core/mathx.js';
import {mulberry32} from '../core/rng.js';

const LAYER = [.3, .6], DEPTH = .6, EXT = .12, CAP_SINK = .005, CAP_SLOPE = .08;
const JOINT_HARD = [1.1, 3.2], JOINT_SOFT = [.45, 1.3], FACET = [.25, .5], EXAG = 1.8;
const MASSIVE = {layer: [.55, 1.25], amp: [.14, .3], joint: [.5, 1.6], slant: .9};   // (run.massive: thick beds, waving, broken often, joints aslant)

// the geometry being built: flat-shaded polygons, each turned to face along a hint direction (or away from a centre)
export function sink() {   // (walls3d.js builds its stones with it too)
  const pos = [], nrm = [], part = [], fam = [], bias = [], fixed = [];
  let pid = 0;
  const B = {
    part() { pid = (pid + 1) % 64; return pid; },
    // v: 3+ corners [x, y, z] in order round the face; h: a direction the face should look along (it's turned to agree).
    // ex > 1: the SHADING normal turns ex times as far from h as the face does (a facet a little askew takes a whole tone:
    // modest relief, painted-rock planes)
    poly(v, h, f, p, b, fx = -1, ex = 1) {
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < v.length; i++) {
        const a = v[i], d = v[(i + 1) % v.length];
        nx += (a[1] - d[1]) * (a[2] + d[2]); ny += (a[2] - d[2]) * (a[0] + d[0]); nz += (a[0] - d[0]) * (a[1] + d[1]);
      }
      const l = Math.hypot(nx, ny, nz); if (l < 1e-7) return;
      nx /= l; ny /= l; nz /= l;
      const flip = nx * h[0] + ny * h[1] + nz * h[2] < 0;
      if (flip) { nx = -nx; ny = -ny; nz = -nz; }
      if (ex !== 1) {
        const hl = Math.hypot(h[0], h[1], h[2]) || 1, hx = h[0] / hl, hy = h[1] / hl, hz = h[2] / hl;
        nx = hx + (nx - hx) * ex; ny = hy + (ny - hy) * ex; nz = hz + (nz - hz) * ex; const m = Math.hypot(nx, ny, nz) || 1; nx /= m; ny /= m; nz /= m;
      }
      for (let i = 1; i + 1 < v.length; i++) {
        const t = flip ? [v[0], v[i + 1], v[i]] : [v[0], v[i], v[i + 1]];
        for (const q of t) { pos.push(q[0], q[1], q[2]); nrm.push(nx, ny, nz); part.push(p); fam.push(f); bias.push(b); fixed.push(fx); }
      }
    },
    // a face of a small convex solid: turned away from its centre c
    polyC(v, c, f, p, b) {
      let mx = 0, my = 0, mz = 0; for (const q of v) { mx += q[0]; my += q[1]; mz += q[2]; }
      B.poly(v, [mx / v.length - c[0], my / v.length - c[1], mz / v.length - c[2]], f, p, b);
    },
    geometry() {
      if (!pos.length) return null;
      const g = new THREE.BufferGeometry(), A = (n, a, k) => g.setAttribute(n, new THREE.Float32BufferAttribute(a, k));
      A('position', pos, 3); A('normal', nrm, 3); A('aPart', part, 1); A('aFam', fam, 1); A('aBias', bias, 1); A('aFixed', fixed, 1);
      g.computeBoundingSphere(); g.computeBoundingBox(); return g;
    },
  };
  return B;
}

// a run's frame: s metres along the face line (extrapolated past its ends), o metres out from it, y up
function frame(pts) {
  const n = pts.length, L = [0], N = [];
  for (let i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const segN = [];
  for (let i = 0; i + 1 < n; i++) { const tx = pts[i + 1][0] - pts[i][0], tz = pts[i + 1][1] - pts[i][1], l = Math.hypot(tx, tz) || 1; segN.push([-tz / l, tx / l]); }
  for (let i = 0; i < n; i++) {   // a vertex's normal: the mean of its segments' (the face bends smoothly round a curve)
    const a = segN[Math.max(0, i - 1)], b = segN[Math.min(n - 2, i)], x = a[0] + b[0], z = a[1] + b[1], l = Math.hypot(x, z) || 1;
    N.push([x / l, z / l]);
  }
  const total = L[n - 1];
  const seg = s => { let lo = 0, hi = n - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L[m] <= s) lo = m; else hi = m - 1; } return lo; };
  // -> [x, z, nx, nz] at s (straight on past the ends)
  const at = (s, out) => {
    const i = seg(clamp(s, 0, total)), l = L[i + 1] - L[i] || 1, t = (s - L[i]) / l, tc = clamp(t, 0, 1);
    const a = pts[i], b = pts[i + 1];
    out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t;
    const nx = N[i][0] + (N[i + 1][0] - N[i][0]) * tc, nz = N[i][1] + (N[i + 1][1] - N[i][1]) * tc, k = Math.hypot(nx, nz) || 1;
    out[2] = nx / k; out[3] = nz / k; return out;
  };
  const _f = [0, 0, 0, 0];
  const P = (s, o, y) => { at(s, _f); return [_f[0] + _f[2] * o, y, _f[1] + _f[3] * o]; };
  const out = s => { at(s, _f); return [_f[2], 0, _f[3]]; };           // the outward normal (a hint for the fronts)
  const along = s => { at(s, _f); return [_f[3], 0, -_f[2]]; };        // the direction of travel
  return {total, at, P, out, along};
}

// where along a run the rock changes (skip / keep zones begin or end): joints are put there (upright), so a zone never sits
// under a block that runs past it
function cutsOf(run, fr) {
  const out = [], o = [0, 0, 0, 0];
  if (!run.skip && !run.keep) return out;
  let prev = null;
  for (let s = -EXT; s <= fr.total + EXT; s += .05) {
    fr.at(s, o);
    const k = (run.skip?.(o[0], o[1]) ? 's' : '') + (run.keep?.(o[0], o[1]) ?? '');
    if (prev !== null && k !== prev) out.push(s);
    prev = k;
  }
  return out;
}

// a box on its own axes (unit vectors u, v up, w) round centre c, half sizes hu, hv, hw; jit: corner jitter (a stone), taper: the
// top's corners drawn in toward the centre
export function cuboid(B, c, u, v, w, hu, hv, hw, f, p, b, R = null, jit = 0, taper = 1) {
  const C = [];
  for (const sv of [-1, 1]) for (const sw of [-1, 1]) for (const su of [-1, 1]) {
    const k = sv > 0 ? taper : 1, ju = R ? 1 + (R() - .5) * jit : 1, jv = R ? 1 + (R() - .5) * jit : 1, jw = R ? 1 + (R() - .5) * jit : 1;
    const a = su * hu * k * ju, e = sv * hv * jv, d = sw * hw * k * jw;
    C.push([c[0] + u[0] * a + v[0] * e + w[0] * d, c[1] + u[1] * a + v[1] * e + w[1] * d, c[2] + u[2] * a + v[2] * e + w[2] * d]);
  }
  // corners: index = (sv > 0) * 4 + (sw > 0) * 2 + (su > 0)
  for (const q of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]) B.polyC(q.map(i => C[i]), c, f, p, b);
}

export function cliffGeometry(runs, o) {
  const B = sink(), famRock = o.fam('rock'), famB = o.rockB ?? null, famCover = o.cover ?? null, famWood = o.fam('wood');
  const at = [0, 0, 0, 0], UP = [0, 1, 0];
  for (const run of runs) {
    const R = mulberry32(run.seed | 0), fr = frame(run.pts), P = fr.P, cuts = cutsOf(run, fr), base = run.base || 0, rel = run.relief ?? 1;
    // top: a height, or (x, z) -> the height there (a wall along a ramp: its blocks clipped under it; a clipped block is the cap there)
    const S0 = -EXT, S1 = fr.total + EXT, topF = typeof run.top === 'function' ? run.top : null;
    let top = topF ? -1e9 : run.top;
    if (topF) for (let s = S0; s <= S1 + 1e-6; s += .25) { fr.at(Math.min(s, S1), at); top = Math.max(top, topF(at[0], at[1])); }
    // the layers, top down, to below the deepest foot; their bedding lines (bnd[j](s): the top of layer j) wander along the face
    const layers = [];
    for (let y = top, i = 0; i < 60; i++) {
      const LY = run.massive ? MASSIVE.layer : LAYER, th = (i === 0 ? .25 + R() * .15 : LY[0] + R() * (LY[1] - LY[0])), hard = i === 0 || R() < .38;
      const off = i === 0 ? .02 + R() * .07 : hard ? -.01 + R() * .09 : -.07 - R() * .14;
      layers.push({yt: y, i, hard, off, f: famB !== null && i > 0 && R() < .45 ? famB : famRock, wave: R() * 100, amp: run.massive ? MASSIVE.amp[0] + R() * (MASSIVE.amp[1] - MASSIVE.amp[0]) : .04 + R() * .06});
      y -= th;
      if (y < run.minBot) { layers.push({yt: y, i: i + 1, end: true, wave: R() * 100, amp: .03}); break; }
    }
    const bnd = j => {   // the bedding line on top of layer j (the cap's top is flat: the ground)
      const L = layers[j];
      if (j === 0) return () => top - CAP_SINK;
      return s => L.yt + L.amp * (vnoise(s * .32 + L.wave, j, run.seed) - .5) * 2 + .03 * (vnoise(s * 1.3, j + 40, run.seed) - .5);
    };
    for (let j = 0; j + 1 < layers.length; j++) {
      const Ly = layers[j], yTop = bnd(j), yBot = bnd(j + 1), last = j + 2 === layers.length, cap = j === 0;
      // the joints: [s at the bottom, s at the top] (they slant); upright at the zones' edges
      const J = [];
      for (let s = S0 - R() * 1.2; s < S1;) {
        const JW = run.massive ? MASSIVE.joint : Ly.hard ? JOINT_HARD : JOINT_SOFT, w = JW[0] + R() * (JW[1] - JW[0]);
        if (s > S0) J.push([s, s + (R() - .5) * (run.massive ? MASSIVE.slant : .3)]);
        s += w;
      }
      for (const c of cuts) { for (let k = J.length - 1; k >= 0; k--) if (Math.abs(J[k][0] - c) < .2 || Math.abs(J[k][1] - c) < .2) J.splice(k, 1); J.push([c, c]); }
      J.push([S0, S0], [S1, S1]); J.sort((a, b) => a[0] - b[0]);
      for (let k = 0; k + 1 < J.length; k++) {
        const [b0, t0] = J[k], [b1, t1] = J[k + 1]; if (b1 - b0 < .05) continue;
        const sm = (b0 + b1 + t0 + t1) / 4;
        fr.at(sm, at); if (run.skip?.(at[0], at[1])) continue;
        let lim = Infinity;
        for (const q of [Math.min(b0, t0) + .03, sm, Math.max(b1, t1) - .03]) { fr.at(q, at); const kk = run.keep?.(at[0], at[1]); if (kk !== null && kk !== undefined) lim = Math.min(lim, kk); }
        // the block's character
        const hollow = !Ly.hard && R() < .1 ? -.2 : 0, proud = Ly.hard && !cap && R() < .12 ? .07 : 0;
        const o0 = (Ly.off + (vnoise(sm * .45, Ly.wave, run.seed) - .5) * .1 + (R() - .5) * .06 + hollow + proud) * rel + base;
        const lean = (R() < .25 ? -.16 - R() * .12 : (R() - .6) * .2) * rel, turn = (R() - .5) * .2 * rel;
        const amp = (Ly.hard ? .03 + R() * .04 : .06 + R() * .07) * rel, bev = Ly.hard ? .05 + R() * .07 : .025 + R() * .04;
        const bias = (R() - .5) * .14 + (Ly.hard ? .04 : -.05) + (hollow ? -.12 : 0);
        // the facets: K across the block, the creases at jittered fractions, each vertex standing its own way in or out
        const width = Math.max(b1 - b0, t1 - t0), K = Math.max(1, Math.round(width / (FACET[0] + R() * (FACET[1] - FACET[0]))));
        const V = [];
        for (let i = 0; i <= K; i++) {
          const u = i === 0 || i === K ? i / K : (i + (R() - .5) * .5) / K;
          const sb = b0 + (b1 - b0) * u, st = t0 + (t1 - t0) * u, oo = o0 + turn * (u - .5) + (i > 0 && i < K ? (R() - .5) * 2 * amp : 0);
          let oT = oo + lean * .5 + (R() - .5) * .04 * rel, oB = oo - lean * .5;
          V.push({sb, st, oT, oB});
        }
        // heights: the bedding lines (the foot where the ground is higher than the layer's bottom, or under the last layer); a top
        // that follows the ground clips them
        let gone = true, clipped = false;
        for (const v of V) {
          v.yt = yTop(v.st); v.yb = yBot(v.sb);
          if (topF) { fr.at(v.st, at); const tt = topF(at[0], at[1]) - CAP_SINK; if (v.yt > tt) { v.yt = tt; clipped = true; } }
          if (last || v.yb < 0 || topF) {
            fr.at(v.sb, at); const foot = run.bot(at[0], at[1]) - .04;
            if (last || v.yb < foot) v.yb = foot;
          }
          if (v.yt > v.yb + .03) gone = false; else v.yb = v.yt - .001;
        }
        const capB = cap || clipped;
        if (capB) { const m = Math.min(...V.map(v => Math.min(v.oT, v.oB))); if (m < base) for (const v of V) { v.oT += base - m; v.oB += base - m; } }   // the cap stands at or out of the line
        if (lim < Infinity) for (const v of V) { v.oT = Math.min(v.oT, lim); v.oB = Math.min(v.oB, lim); }
        if (gone) continue;   // (the whole layer lies under the ground here)
        const p = B.part(), f = Ly.f, b = bias + (run.dark ? run.dark((V[0].yt + V[0].yb) / 2) : 0), slope = capB ? CAP_SLOPE : 0;
        const bv = Math.min(bev, Math.min(...V.map(v => v.yt - v.yb)) * .4);
        for (let i = 0; i < K; i++) {
          const A = V[i], C = V[i + 1], h = fr.out((A.sb + C.sb) / 2), fb = (R() - .5) * .06;
          B.poly([P(A.sb, A.oB, A.yb), P(C.sb, C.oB, C.yb), P(C.st, C.oT, C.yt - bv), P(A.st, A.oT, A.yt - bv)], h, f, p, b + fb, -1, EXAG);
          if (bv > .005) B.poly([P(A.st, A.oT, A.yt - bv), P(C.st, C.oT, C.yt - bv), P(C.st, C.oT - bv * .8, C.yt), P(A.st, A.oT - bv * .8, A.yt)], [h[0], 1, h[2]], f, p, b + fb);
          B.poly([P(A.st, A.oT - bv * .8, A.yt), P(C.st, C.oT - bv * .8, C.yt), P(C.st, -DEPTH, C.yt - slope), P(A.st, -DEPTH, A.yt - slope)], UP, f, p, b);
        }
        const L0 = V[0], L1 = V[K], tl = fr.along(L0.sb), tr = fr.along(L1.sb);
        B.poly([P(L0.sb, -DEPTH, L0.yb), P(L0.sb, L0.oB, L0.yb), P(L0.st, L0.oT, L0.yt - bv), P(L0.st, L0.oT - bv * .8, L0.yt), P(L0.st, -DEPTH, L0.yt - slope)], [-tl[0], 0, -tl[2]], f, p, b);
        B.poly([P(L1.sb, -DEPTH, L1.yb), P(L1.st, -DEPTH, L1.yt - slope), P(L1.st, L1.oT - bv * .8, L1.yt), P(L1.st, L1.oT, L1.yt - bv), P(L1.sb, L1.oB, L1.yb)], tr, f, p, b);
        // the lip: the cover hanging over the cap's front in tufts, and lying along its rim
        if (capB && run.lip && famCover !== null && lim > base - .02) {
          for (let i = 0; i < K; i++) {
            const A = V[i], C = V[i + 1], h = fr.out((A.st + C.st) / 2);
            for (let t = 0; t < 1; t += .3 + R() * .5) {
              if (vnoise(((A.st + C.st) / 2 + t) * 1.6, 3, run.seed) < .42 || R() < .25) continue;
              const tw = Math.min(1 - t, .25 + R() * .4), lp = B.part(), u0 = t, u1 = t + tw;
              const s0 = A.st + (C.st - A.st) * u0, s1 = A.st + (C.st - A.st) * u1;
              const f0 = A.oT + (C.oT - A.oT) * u0 + .014, f1 = A.oT + (C.oT - A.oT) * u1 + .014;
              const y0 = A.yt + (C.yt - A.yt) * u0, y1 = A.yt + (C.yt - A.yt) * u1, hang = .03 + R() * R() * .26;
              B.poly([P(s0, f0, y0 - bv * .3 + .01), P(s1, f1, y1 - bv * .3 + .01), P(s1, f1, y1 - bv * .3 - hang * (.5 + R() * .5)), P(s0, f0, y0 - bv * .3 - hang)], h, famCover, lp, R() * .1);
              B.poly([P(s0, f0, y0 + .004), P(s1, f1, y1 + .004), P(s1, f1 - .22, y1 + .004), P(s0, f0 - .22, y0 + .004)], UP, famCover, lp, .05);
            }
          }
        }
      }
    }
    // talus: stones fallen to the foot, in small clusters
    if (run.talus) {
      for (let s = R() * 1.5; s < fr.total; s += 1 + R() * 2.4) {
        const n = 1 + (R() * R() * 4 | 0);
        for (let k = 0; k < n; k++) {
          const t = s + (R() - .5) * .9, off = .08 + R() * .42 + base;
          fr.at(t, at); const x = at[0] + at[2] * off, z = at[1] + at[3] * off;
          if (run.skip?.(at[0], at[1]) || (run.keep?.(at[0], at[1]) ?? null) !== null || run.avoid?.(x, z)) continue;
          const hu = .06 + R() * .12, hv = .04 + R() * .08, hw = .06 + R() * .1, yaw = R() * Math.PI, y = run.bot(x, z) + hv * .5;
          const u = [Math.cos(yaw), 0, -Math.sin(yaw)], w = [Math.sin(yaw), 0, Math.cos(yaw)];
          cuboid(B, [x, y, z], u, UP, w, hu, hv, hw, famRock, B.part(), (R() - .5) * .14, R, .5, .7);
        }
      }
    }
  }
  // ladders: two rails and rungs, standing against the face (their foot a little sunk) from y0 (the ground at the foot, 0 if unset)
  for (const L of o.ladders || []) {
    const u = [-L.nz, 0, L.nx], w = [L.nx, 0, L.nz], y0 = L.y0 || 0, H = L.h - y0 + .32, rail = .028;
    for (const sx of [-1, 1]) cuboid(B, [L.x + u[0] * .3 * sx + w[0] * .02, y0 + H / 2 - .04, L.z + u[2] * .3 * sx + w[2] * .02], u, UP, w, rail, H / 2, rail, famWood, B.part(), 0);
    for (let y = y0 + .26; y < L.h + .1; y += .3) cuboid(B, [L.x + w[0] * .025, y, L.z + w[2] * .025], u, UP, w, .3, .02, .02, famWood, B.part(), .06);
  }
  // bridges (layout.js BRIDGES): planks across a deck rising in a gentle arch, a stringer under each side, a post at each corner and a
  // rail along each side
  for (const D of o.bridges || []) {
    if (D.own) continue;   // (a deck its owner draws: the watchtower's lookout, world/watchtower.js)
    const R = mulberry32(D.seed || 17), u = [D.ux, 0, D.uy], v = [-D.uy, 0, D.ux], hw = D.w / 2;
    const deck = s => D.h0 + (D.h1 - D.h0) * s / D.len + D.arch * Math.sin(Math.PI * s / D.len), at3 = (s, side, y) => [D.a[0] + D.ux * s - D.uy * side, y, D.a[1] + D.uy * s + D.ux * side];
    for (let s = .08; s < D.len - .02; s += .155) cuboid(B, at3(s + (R() - .5) * .02, (R() - .5) * .03, deck(s) - .025), u, UP, v, .066, .022, hw + (R() - .5) * .05, famWood, B.part(), (R() - .5) * .14);
    for (const sd of [-1, 1]) {
      for (let s = 0; s < D.len - .01; s += .35) { const e = Math.min(D.len, s + .35), m = (s + e) / 2; cuboid(B, at3(m, sd * (hw - .08), deck(m) - .085), u, UP, v, (e - s) / 2 + .01, .04, .05, famWood, B.part(), -.05); }
      for (const s of [.04, D.len - .04]) { const y0 = deck(s) - .35, y1 = deck(s) + .78; cuboid(B, at3(s, sd * (hw + .02), (y0 + y1) / 2), u, UP, v, .045, (y1 - y0) / 2, .045, famWood, B.part(), .04); }
      for (let s = .04; s < D.len - .05; s += .25) { const e = Math.min(D.len - .04, s + .25), m = (s + e) / 2; cuboid(B, at3(m, sd * (hw + .02), deck(m) + .7), u, UP, v, (e - s) / 2 + .01, .022, .025, famWood, B.part(), .02); }
    }
  }
  // stairs: stone steps up a stepped ramp (terrain.js steps: the ground's treads are the stones' tops), each a slab a little askew
  for (const S of o.stairs || []) {
    const [a, b] = S.pts, L = Math.hypot(b[0] - a[0], b[1] - a[1]), u = [(b[0] - a[0]) / L, 0, (b[1] - a[1]) / L], v = [-u[2], 0, u[0]];
    const n = S.n, run = L / n, R = mulberry32(S.seed || 29);
    for (let k = 0; k < n; k++) {
      const sm = (k + .5) * run, top = S.h0 + (S.h1 - S.h0) * (k + 1) / n - .005, bot = S.h0 - .2;
      cuboid(B, [a[0] + u[0] * sm, (top + bot) / 2, a[1] + u[2] * sm], u, UP, v, run / 2 + .02, (top - bot) / 2, S.w / 2 + (R() - .5) * .08, famRock, B.part(), (R() - .5) * .16 + (k & 1 ? .04 : 0), R, .06);
    }
  }
  return B.geometry();
}
