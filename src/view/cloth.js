// Runtime cloth for pre-rendered pixel sprites (cloaks, scarf tails).
// Blender leaves the cloth out of the sprite and exports, per pose, the matrix of the bone it hangs from plus a few
// collision capsules (pixel_rig + wardrobe.SIM_CLOTH). Here the cloth is a Verlet particle grid in world metres:
// its pinned rows ride on that bone, everything else has inertia, gravity, air drag against the body's real motion,
// wind, and collides with the body. It is drawn back into the sprite's own pixel language: the family's hi/base/shade
// bands under the same top-left light, flat facets, fold lines, a dark exterior outline, and per-pixel occlusion
// against the rendered body's depth sheet (so arms and legs pass in front of or behind it correctly).
//
//   const rig = new ClothRig(poses_json);
//   rig.update(dt, meta.sim, faceIndex, [xMetres, yMetres]);        // after the game moved the player
//   rig.draw(ctx, spriteLeft, spriteTop, depthSheet, faceIndex);    // right after drawing the body sprite
//   rig.draw(ctx, left, top, depth, face, nctx)   // + the cloth's normals (linear, +x right +y up +z to the viewer, as
//                                                  // pixelize's body_normals) into nctx at the same spot, so the host
//                                                  // can light body + cloth together (arena: lighting.drawSprite)
import {hexRaw255 as hex} from '../core/color.js';
import {hypot2, hypot3} from '../core/mathx.js';   // Math.hypot without its per-call garbage (bit for bit)
const LIGHT = (() => { const v = [-0.55, -0.62, 0.56], l = Math.hypot(...v); return v.map(c => c / l); })();  // pixelize's
const HI = .78, LO = .36;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// 3x3 matrices as row-major arrays of 9
const mul3 = (A, B) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]));
const tr3 = A => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const mv3 = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
const rotZ = a => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
function axisAngle(R) {
  const ang = Math.acos(Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2)));
  let ax = [R[7] - R[5], R[2] - R[6], R[3] - R[1]], l = Math.hypot(...ax);
  if (l < 1e-6) {   // ~0 or ~180 deg: the axis is the column of R + I with the largest norm
    const c = [0, 1, 2].map(k => [R[k] + (k === 0), R[3 + k] + (k === 1), R[6 + k] + (k === 2)]);
    ax = c.reduce((a, b) => Math.hypot(...b) > Math.hypot(...a) ? b : a); l = Math.hypot(...ax) || 1;
  }
  return [ax.map(x => x / l), ang];
}
function axisRot([x, y, z], a) {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// the wind the cloth feels (the hero sets it each sim step: the wind feature's numbers or a calm breeze)
export function setClothWind({wind, gust}) { CLOTH_PARAMS.wind = wind; CLOTH_PARAMS.gust = gust; }
export const CLOTH_PARAMS = {
  gravity: 9.8,
  drag: 1.1,        // 1/s, all directions: the cloth trails behind motion
  lift: 4.5,        // 1/s, along the cloth's normal: a panel catching the air (streams, billows)
  flutter: 1.0,     // travelling flap waves driven by the airflow (grow with airspeed^2): a flat drag sheet never flaps
  wave: .55,        // m, flap wavelength along the cloth
  damping: .992,    // velocity kept per 1/120 s substep
  iterations: 7,
  bend: .35,        // stiffness of the skip-one constraints (0 = silk, 1 = felt)
  wind: [0.7, 0.25], gust: 1.1,   // m/s on the ground plane (game x east, y south) + gust strength
  thickness: .02,   // m kept between cloth and body
  turnLag: .25,     // share of a facing snap the cloth lags behind (the rest turns with the body, rigidly)
  maxSpeed: 7,      // m/s cap on the cloth's speed relative to the body (a safety net against flings)
};

// per cloth (by exported name): weight divides the air forces (a heavy wool cloak streams less and flaps slower than a
// light scarf), bend/damping/flutter override the shared params
export const CLOTH_MATERIALS = {
  // heavy wool: streams less, flaps slow, settles fast. retain = spring (1/s^2) toward its draped shape on the torso,
  // [at the shoulders, at the hem]: thick cloth holds its rounded drape instead of collapsing into a ribbon.
  // bendBoth: folds resist crumpling as well as stretching open.
  Cloak: {weight: 2, bend: .9, damping: .985, flutter: .2, wave: 1, retain: [140, 18], bendBoth: true},
};

const CAP = 12;   // floats per body capsule in ClothRig.capF
export class ClothRig {
  // PERFORMANCE (docs/ARCHITECTURE.md): update + draw run every frame, so they allocate nothing in steady state. Particles
  // are persistent [x, y, z] arrays moved in place, links and capsules are flat typed arrays, and draw() keeps its pixel
  // buffers between frames and works only inside the box the cloth covers (a few thousand of the 192 x 160 pixels).
  // The arithmetic is the same, in the same order, as the allocating version it replaced: the output is bit-identical.
  constructor(idx) {
    this.idx = idx;
    this.cloths = (idx.sim?.cloths || []).map(c => this.#makeCloth(c));
    if (!this.cloths.length) return;   // a set with its cloth baked into the sprites
    const y = idx.cam.yaw * Math.PI / 180, p = idx.pitch * Math.PI / 180;
    this.off = [Math.sin(y) * Math.cos(p), -Math.cos(y) * Math.cos(p), Math.sin(p)];   // toward the camera
    this.R = [Math.cos(y), Math.sin(y), 0];                                            // screen right
    this.U = [-Math.sin(p) * this.off[0] / Math.cos(p), -Math.sin(p) * this.off[1] / Math.cos(p), (1 - Math.sin(p) * this.off[2]) / Math.cos(p)];
    this.T = [Math.sin(y), -Math.cos(y), 0];                                           // ground toward the camera = game south
    this.upp = idx.units_per_px; this.piv = idx.pivot; this.N = idx.dirs.length;
    this.dz = 254 / (idx.cam.far - idx.cam.near);
    this.t = 0; this.acc = 0; this.origin = [0, 0, 0]; this.vel = [0, 0, 0];
    this.wnd = [0, 0, 0];                       // the substep's wind (#wind writes it)
    this.capF = new Float64Array(CAP * 16); this.nCap = 0;   // capsules: a, b - a, |b - a|^2 (or 1), radius, centre, half length
    this.canvas = document.createElement('canvas');
    this.canvas.getContext('2d', {willReadFrequently: true});   // CPU-backed: cheap to composite into a host's CPU canvas
  }
  get active() { return this.cloths.length > 0; }

  #makeCloth(c) {
    const rows = c.grid.length, cols = c.grid[0].length, n = rows * cols, links = [];
    const id = (r, k) => r * cols + k;
    const L = (a, b, s) => { const [ra, ka] = a, [rb, kb] = b, pa = c.grid[ra][ka], pb = c.grid[rb][kb];
      links.push([id(ra, ka), id(rb, kb), Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]), s]); };
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      if (k + 1 < cols) L([r, k], [r, k + 1], 1);
      if (r + 1 < rows) L([r, k], [r + 1, k], 1);
      if (r + 1 < rows && k + 1 < cols) { L([r, k], [r + 1, k + 1], .7); L([r, k + 1], [r + 1, k], .7); }
      if (k + 2 < cols) L([r, k], [r, k + 2], -1);   // bend (stiffness from params)
      if (r + 2 < rows) L([r, k], [r + 2, k], -1);
    }
    const g = c.grid, rowLen = Math.hypot(...sub(g[rows - 1][0], g[0][0])) / (rows - 1);
    const nl = links.length, lA = new Int32Array(nl), lB = new Int32Array(nl), lL = new Float64Array(nl), lS = new Float64Array(nl);
    links.forEach(([a, b, l, s], i) => { lA[i] = a; lB[i] = b; lL[i] = l; lS[i] = s; });
    const pin = c.pin_rows * cols;
    return {def: c, rows, cols, n, links, lA, lB, lL, lS, pos: null, prev: null, pin, rowLen, seed: this.cloths?.length * 2.1 || 0,
            colours: c.colours.map(hex), bias: c.bias ?? 0, mat: CLOTH_MATERIALS[c.name] || {},
            goal: Array.from({length: n}, () => [0, 0, 0]), from: Array.from({length: pin}, () => [0, 0, 0])};
  }

  // world (metres, the render's frame with the camera fixed) of a pose-space point for facing k at the player's spot
  #place(q, k, org) {
    const a = (this.idx.cam.yaw0 + 360 / this.N * k) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [c * q[0] - s * q[1] + org[0], s * q[0] + c * q[1] + org[1], q[2] + org[2]];
  }

  reset() { for (const C of this.cloths) C.pos = null; }

  update(dt, sim, face, gpos) {
    if (!this.active || !sim) return;
    // the player's ground position in the render's world frame (game x east / y south -> camera right / toward camera)
    const O = this.origin, ox = gpos[0] * this.R[0] + gpos[1] * this.T[0], oy = gpos[0] * this.R[1] + gpos[1] * this.T[1];
    const jump = hypot2(ox - O[0], oy - O[1]) > 2;
    // the body's velocity: damping works on the cloth's motion RELATIVE to the body (internal friction), not against
    // the world (that would be a second air drag that makes a heavy cloak stream more)
    const V = this.vel;
    if (jump || !dt) { V[0] = 0; V[1] = 0; V[2] = 0; } else { V[0] = (ox - O[0]) / dt; V[1] = (oy - O[1]) / dt; V[2] = 0; }
    O[0] = ox; O[1] = oy; O[2] = 0; this.face = face;
    const org = O;
    // the facing's turn (the same cos / sin #place computes)
    const fa = (this.idx.cam.yaw0 + 360 / this.N * face) * Math.PI / 180, fc = Math.cos(fa), fs = Math.sin(fa);
    // body capsules -> a, b - a, |b - a|^2 (|| 1), radius
    const caps = sim.caps, nc = caps.length;
    if (this.capF.length < nc * CAP) this.capF = new Float64Array(nc * CAP * 2);
    const F = this.capF;
    for (let i = 0; i < nc; i++) {
      const c = caps[i], o = i * CAP;
      const ax = fc * c[0] - fs * c[1] + ox, ay = fs * c[0] + fc * c[1] + oy, az = c[2] + 0;
      const bx = fc * c[3] - fs * c[4] + ox, by = fs * c[3] + fc * c[4] + oy, bz = c[5] + 0;
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      F[o] = ax; F[o + 1] = ay; F[o + 2] = az; F[o + 3] = abx; F[o + 4] = aby; F[o + 5] = abz;
      F[o + 6] = abx * abx + aby * aby + abz * abz || 1; F[o + 7] = c[6];
      F[o + 8] = ax + abx / 2; F[o + 9] = ay + aby / 2; F[o + 10] = az + abz / 2; F[o + 11] = Math.sqrt(abx * abx + aby * aby + abz * abz) / 2;
    }
    this.nCap = nc;
    for (const C of this.cloths) {
      const M = sim.mats[C.def.bone], all = !!C.mat.retain;
      // snaps: facing steps (360/N, a reversal is 180 deg in 1-2 frames) and pose switches (a 90 deg torso twist for a
      // moving shot) turn the bone the cloth hangs from in ONE frame. Turn the whole cloth with it about the bone
      // (pos and prev together: no velocity injected), keeping only turnLag of the turn as real lag; small per-frame
      // rotations (the gait) stay fully physical.
      const Rb = mul3(rotZ((this.idx.cam.yaw0 + 360 / this.N * face) * Math.PI / 180), [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]]);
      const head = this.#place([M[3], M[7], M[11]], face, org);
      if (C.pos && C.rot && !jump) {
        const [ax, ang] = axisAngle(mul3(Rb, tr3(C.rot)));
        if (ang > 8 * Math.PI / 180) {
          const Q = axisRot(ax, ang * (1 - CLOTH_PARAMS.turnLag));
          const rot = p => { const d = [p[0] - head[0], p[1] - head[1], p[2] - head[2]], q = mv3(Q, d); p[0] = head[0] + q[0]; p[1] = head[1] + q[1]; p[2] = head[2] + q[2]; };
          C.pos.forEach(rot); C.prev.forEach(rot);
        }
        // and pose snaps that shift the bone relative to the body (a turn's plant frame drops and leans the chest)
        const rel = [head[0] - org[0], head[1] - org[1], head[2]], d = sub(rel, C.head), dl = Math.hypot(...d);
        if (dl > .04) {
          const k = 1 - CLOTH_PARAMS.turnLag, sh = p => { p[0] += d[0] * k; p[1] += d[1] * k; p[2] += d[2] * k; };
          C.pos.forEach(sh); C.prev.forEach(sh);
        }
      }
      C.rot = Rb; C.head = [head[0] - org[0], head[1] - org[1], head[2]];
      // the draped shape on the current pose (the pins' targets; all of it for the shape-retention spring)
      const G = C.goal, grid = C.def.grid, cols = C.cols, fresh = !C.pos || jump;
      for (let r = 0; r < C.rows; r++) {
        if (!(r < C.def.pin_rows || fresh || all)) continue;
        for (let k = 0; k < cols; k++) {
          const v = grid[r][k], g = G[r * cols + k];
          const px = M[0] * v[0] + M[1] * v[1] + M[2] * v[2] + M[3], py = M[4] * v[0] + M[5] * v[1] + M[6] * v[2] + M[7], pz = M[8] * v[0] + M[9] * v[1] + M[10] * v[2] + M[11];
          g[0] = fc * px - fs * py + ox; g[1] = fs * px + fc * py + oy; g[2] = pz + 0;
        }
      }
      if (!C.pos) { C.pos = G.map(p => p.slice()); C.prev = G.map(p => p.slice()); }
      else if (jump) for (let i = 0; i < C.n; i++) { const g = G[i], p = C.pos[i], q = C.prev[i]; p[0] = q[0] = g[0]; p[1] = q[1] = g[1]; p[2] = q[2] = g[2]; }
      for (let i = 0; i < C.pin; i++) { const p = C.pos[i], f = C.from[i]; f[0] = p[0]; f[1] = p[1]; f[2] = p[2]; }   // the pins glide from here to the goal
    }
    // fixed substeps; pinned rows glide from where they were to the new pose over the frame
    const h = 1 / 120; this.acc = Math.min(this.acc + dt, .1);
    const steps = Math.floor(this.acc / h); this.acc -= steps * h;
    for (let i = 0; i < steps; i++) { this.t += h; this.#substep(h, (i + 1) / steps); }
  }

  #wind() {
    const P = CLOTH_PARAMS, t = this.t, g = P.gust * (.55 + .45 * Math.sin(t * .7) * Math.sin(t * 1.9 + 1.3)) * (1 + .35 * Math.sin(t * 5.3));
    const wx = P.wind[0] + g * .6 * Math.sin(t * .31), wy = P.wind[1] + g * .6 * Math.cos(t * .23), w = this.wnd;
    w[0] = wx * this.R[0] + wy * this.T[0]; w[1] = wx * this.R[1] + wy * this.T[1]; w[2] = .15 * g * Math.sin(t * 2.7);
    return w;
  }

  #substep(h, f) {
    const P = CLOTH_PARAMS, wind = this.#wind(), h2 = h * h, bv = this.vel, cap = P.maxSpeed * h;
    const w0 = wind[0], w1 = wind[1], w2 = wind[2], bv0 = bv[0], bv1 = bv[1], bv2 = bv[2];
    for (const C of this.cloths) {
      const {pos, prev, rows, cols, pin} = C, M = C.mat, wt = M.weight ?? 1, damp = M.damping ?? P.damping;
      const flut = (M.flutter ?? P.flutter) / wt, wave = M.wave ?? P.wave, drag = P.drag / wt, lift = P.lift / wt;
      for (let i = 0; i < pin; i++) {   // pins follow the animation
        const a = C.from[i], b = C.goal[i], q = pos[i], o = prev[i];
        o[0] = q[0]; o[1] = q[1]; o[2] = q[2];
        q[0] = a[0] + (b[0] - a[0]) * f; q[1] = a[1] + (b[1] - a[1]) * f; q[2] = a[2] + (b[2] - a[2]) * f;
      }
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
        const i = r * cols + k; if (i < pin) continue;
        const p = pos[i], o = prev[i], v0 = (p[0] - o[0]) / h, v1 = (p[1] - o[1]) / h, v2 = (p[2] - o[2]) / h;
        // surface normal from the neighbours (the panel's local orientation)
        const a = pos[r * cols + Math.min(cols - 1, k + 1)], b = pos[r * cols + Math.max(0, k - 1)];
        const c = pos[Math.min(rows - 1, r + 1) * cols + k], d = pos[Math.max(0, r - 1) * cols + k];
        const u0 = a[0] - b[0], u1 = a[1] - b[1], u2 = a[2] - b[2], s0 = c[0] - d[0], s1 = c[1] - d[1], s2 = c[2] - d[2];
        let n0 = u1 * s2 - u2 * s1, n1 = u2 * s0 - u0 * s2, n2 = u0 * s1 - u1 * s0;
        const nl = hypot3(n0, n1, n2) || 1; n0 /= nl; n1 /= nl; n2 /= nl;
        const r0 = v0 - w0, r1 = v1 - w1, r2 = v2 - w2, vn = r0 * n0 + r1 * n1 + r2 * n2, air = hypot3(r0, r1, r2);
        // flap: a wave running from the pinned edge to the hem, a little out of step across the width (the panel twists)
        const fq = (1.4 + .45 * air) / Math.sqrt(wt), ph = 2 * Math.PI * ((r * C.rowLen) / wave - fq * this.t) + k * .5 + C.seed;
        const fl = flut * Math.min(35, air * air) * (r / (rows - 1)) * Math.sin(ph) - lift * vn;
        let a0 = -drag * r0 + fl * n0, a1 = -drag * r1 + fl * n1, a2 = -P.gravity - drag * r2 + fl * n2;
        if (M.retain) {   // spring toward the drape, weakening down the cloak (the hem is freest)
          const u = (r - C.def.pin_rows) / Math.max(1, rows - 1 - C.def.pin_rows), K = M.retain[0] + (M.retain[1] - M.retain[0]) * Math.min(1, u * 1.4), G = C.goal[i];
          a0 += K * (G[0] - p[0]); a1 += K * (G[1] - p[1]); a2 += K * (G[2] - p[2]);
        }
        let t0 = (p[0] - o[0] - bv0 * h) * damp + a0 * h2, t1 = (p[1] - o[1] - bv1 * h) * damp + a1 * h2, t2 = (p[2] - o[2] - bv2 * h) * damp + a2 * h2;
        const sl = hypot3(t0, t1, t2);   // relative to the body
        if (sl > cap) { t0 *= cap / sl; t1 *= cap / sl; t2 *= cap / sl; }
        const x = p[0] + bv0 * h + t0, y = p[1] + bv1 * h + t1, z = p[2] + bv2 * h + t2;
        o[0] = p[0]; o[1] = p[1]; o[2] = p[2]; p[0] = x; p[1] = y; p[2] = z;
      }
      const {lA, lB, lL, lS} = C, nl = lA.length, bend = M.bend ?? P.bend, both = !!M.bendBoth;
      for (let it = 0; it < P.iterations; it++) {
        for (let li = 0; li < nl; li++) {
          const ia = lA[li], ib = lB[li], L = lL[li], s0 = lS[li];
          const s = s0 < 0 ? bend : s0, pa = pos[ia], pb = pos[ib];
          const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2], l = hypot3(dx, dy, dz) || 1e-9;
          if (s0 < 0 && l < L && !both) continue;   // light cloth: bend links only resist stretching open (folds free)
          const wa = ia < pin ? 0 : 1, wb = ib < pin ? 0 : 1, w = wa + wb; if (!w) continue;
          const k = (l - L) / l * s / w;
          if (wa) { pa[0] += dx * k * wa; pa[1] += dy * k * wa; pa[2] += dz * k * wa; }
          if (wb) { pb[0] -= dx * k * wb; pb[1] -= dy * k * wb; pb[2] -= dz * k * wb; }
        }
        for (let i = pin; i < pos.length; i++) this.#collide(pos[i]);
      }
      // strain limit after the collisions: overlapping body capsules (a tucked roll) can push neighbours to opposite
      // sides; no structural link may end up longer than 110% (cloth left inside the body is hidden by the depth test)
      for (let it = 0; it < 3; it++) for (let li = 0; li < nl; li++) {
        if (lS[li] !== 1) continue;
        const ia = lA[li], ib = lB[li], L = lL[li];
        const pa = pos[ia], pb = pos[ib], dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2], l = hypot3(dx, dy, dz);
        if (l <= L * 1.1) continue;
        const wa = ia < pin ? 0 : 1, wb = ib < pin ? 0 : 1, w = wa + wb; if (!w) continue;
        const k = (l - L * 1.1) / l / w;
        if (wa) { pa[0] += dx * k; pa[1] += dy * k; pa[2] += dz * k; }
        if (wb) { pb[0] -= dx * k; pb[1] -= dy * k; pb[2] -= dz * k; }
      }
    }
  }

  #collide(p) {
    const F = this.capF, th = CLOTH_PARAMS.thickness;
    for (let ci = 0, o = 0; ci < this.nCap; ci++, o += CAP) {
      // too far to touch? (outside the capsule's bounding sphere, a hair larger: the exact test below can't push it then.
      // Skips most of the ~4000 hypot() calls per substep without changing any result)
      const ex = p[0] - F[o + 8], ey = p[1] - F[o + 9], ez = p[2] - F[o + 10], R = F[o + 11] + F[o + 7] + th + 1e-6;
      if (ex * ex + ey * ey + ez * ez > R * R) continue;
      const ax = F[o], ay = F[o + 1], az = F[o + 2], abx = F[o + 3], aby = F[o + 4], abz = F[o + 5];
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * abx + (p[1] - ay) * aby + (p[2] - az) * abz) / F[o + 6]));
      const d0 = p[0] - (ax + abx * t), d1 = p[1] - (ay + aby * t), d2 = p[2] - (az + abz * t), l = hypot3(d0, d1, d2), r = F[o + 7] + th;
      // push out, but at most 4 mm per pass: when the body snaps to a new facing its capsules teleport into the cloth,
      // and a full push-out in one step would fling it (it resolves over a few substeps instead)
      if (l < r && l > 1e-6) { const k = Math.min(r - l, .004) / l; p[0] += d0 * k; p[1] += d1 * k; p[2] += d2 * k; }
    }
    if (p[2] < .01) p[2] = .01;
  }

  // Does the cloth (as drawn by the LAST draw()) cover sprite pixel (x, y)? x, y are relative to draw()'s left/top.
  // Effects painted from the body's own maps after the cloth (armour glints, reflections) must skip these pixels.
  covers(x, y) {
    const c = this.cover; if (!c) return false;
    const u = x + c.MX, v = y + c.MY;
    return u >= 0 && v >= 0 && u < c.BW && v < c.BH && c.a[v * c.BW + u] === 1;
  }

  // the pixel buffers draw() keeps between frames (BW x BH: the sprite frame + the margins the cloth may swing into)
  #buffers(BW, BH) {
    let B = this.buf;
    if (B && B.BW === BW && B.BH === BH) return B;
    const N = BW * BH;
    B = this.buf = {BW, BH, zb: new Float32Array(N).fill(1e9), tone: new Int8Array(N).fill(-1), fam: new Int8Array(N), NV: new Float32Array(N * 3),
      out: new Int8Array(N), oz: new Float32Array(N), cover: new Uint8Array(N), fixJ: new Int32Array(N), fixT: new Int8Array(N),
      img: new ImageData(BW, BH), nimg: new ImageData(BW, BH), S: new Float64Array(0), VN: new Float64Array(0),
      box: null, cbox: null};   // box: last raster box [x0, x1, y0, y1] (to clear), cbox: last composite box (cover to clear)
    this.cover = {a: B.cover, BW, BH, MX: 48, MY: 40};
    return B;
  }

  // depth = {data: Uint8Array (sheet, 255 = empty), w: sheet width}; the sprite frame for `face` is column face*FW
  draw(g, left, top, depth, face, gn = null) {
    if (!this.active || !this.cloths[0].pos) return;
    const FW = this.idx.w, FH = this.idx.h, MX = 48, MY = 40, BW = FW + 2 * MX, BH = FH + 2 * MY;
    const B = this.#buffers(BW, BH), {zb, tone, fam, out, oz, cover} = B;
    const NV = gn ? B.NV : null;   // per-pixel normal (only when the host wants them)
    // forget the last call's cloth: depth + tones where it rasterised, coverage where it composited
    if (B.box) { const [x0, x1, y0, y1] = B.box; for (let y = y0; y <= y1; y++) { zb.fill(1e9, y * BW + x0, y * BW + x1 + 1); tone.fill(-1, y * BW + x0, y * BW + x1 + 1); } B.box = null; }
    if (B.cbox) { const [x0, x1, y0, y1] = B.cbox; for (let y = y0; y <= y1; y++) cover.fill(0, y * BW + x0, y * BW + x1 + 1); B.cbox = null; }
    const fold = 6 * this.dz / 100 * 1;   // 6 cm of depth: an overlapping fold gets a line
    const O = this.origin, R = this.R, U = this.U, off = this.off, upp = this.upp, piv = this.piv, near = this.idx.cam.near, dz = this.dz;
    let bx0 = BW, bx1 = -1, by0 = BH, by1 = -1;   // the raster box (buffer px): the union of the triangles' boxes
    this.cloths.forEach((C, ci) => {
      const P = C.pos, W = C.cols, H = C.rows, n = P.length;
      if (B.S.length < n * 3) { B.S = new Float64Array(n * 3); B.VN = new Float64Array(n * 3); }
      const S = B.S, VN = B.VN;
      for (let i = 0; i < n; i++) {   // project to sprite pixels (continuous; pixel i spans [i, i+1]) + depth in the body sheet's 0..254 units
        const w = P[i], d0 = w[0] - O[0], d1 = w[1] - O[1], d2 = w[2] - O[2];
        S[i * 3] = piv[0] + .5 + (d0 * R[0] + d1 * R[1] + d2 * R[2]) / upp;
        S[i * 3 + 1] = piv[1] + .5 - (d0 * U[0] + d1 * U[1] + d2 * U[2]) / upp;
        S[i * 3 + 2] = (50 - (d0 * off[0] + d1 * off[1] + d2 * off[2]) - near) * dz;
      }
      // smooth vertex normals (camera space) so waves and folds shade in bands across a facet, not one flat tone
      for (let i = 0; i < n; i++) {
        const r = Math.floor(i / W), k = i % W;
        const a = P[r * W + Math.min(W - 1, k + 1)], b = P[r * W + Math.max(0, k - 1)], c = P[Math.min(H - 1, r + 1) * W + k], d = P[Math.max(0, r - 1) * W + k];
        const u0 = a[0] - b[0], u1 = a[1] - b[1], u2 = a[2] - b[2], s0 = c[0] - d[0], s1 = c[1] - d[1], s2 = c[2] - d[2];
        const n0 = u1 * s2 - u2 * s1, n1 = u2 * s0 - u0 * s2, n2 = u0 * s1 - u1 * s0, l = hypot3(n0, n1, n2) || 1;
        VN[i * 3] = (n0 * R[0] + n1 * R[1] + n2 * R[2]) / l; VN[i * 3 + 1] = (n0 * U[0] + n1 * U[1] + n2 * U[2]) / l; VN[i * 3 + 2] = (n0 * off[0] + n1 * off[1] + n2 * off[2]) / l;
      }
      const tri = (i0, i1, i2) => {
        const a0 = S[i0 * 3], a1 = S[i0 * 3 + 1], a2 = S[i0 * 3 + 2], b0 = S[i1 * 3], b1 = S[i1 * 3 + 1], b2 = S[i1 * 3 + 2], c0 = S[i2 * 3], c1 = S[i2 * 3 + 1], c2 = S[i2 * 3 + 2];
        const p0 = P[i0], p1 = P[i1], p2 = P[i2];
        const e0 = p1[0] - p0[0], e1 = p1[1] - p0[1], e2 = p1[2] - p0[2], f0 = p2[0] - p0[0], f1 = p2[1] - p0[1], f2 = p2[2] - p0[2];
        const m0 = e1 * f2 - e2 * f1, m1 = e2 * f0 - e0 * f2, m2 = e0 * f1 - e1 * f0;
        const sg = m0 * off[0] + m1 * off[1] + m2 * off[2] < 0 ? -1 : 1, bias = C.bias - (sg < 0 ? .22 : 0);   // the lining: seen from inside, darker
        const A = i0 * 3, Bn = i1 * 3, Cn = i2 * 3;
        const x0 = Math.max(-MX, Math.floor(Math.min(a0, b0, c0))), x1 = Math.min(FW + MX - 1, Math.ceil(Math.max(a0, b0, c0)));
        const y0 = Math.max(-MY, Math.floor(Math.min(a1, b1, c1))), y1 = Math.min(FH + MY - 1, Math.ceil(Math.max(a1, b1, c1)));
        const den = (b1 - c1) * (a0 - c0) + (c0 - b0) * (a1 - c1); if (Math.abs(den) < 1e-6) return;
        if (x0 > x1 || y0 > y1) return;
        if (x0 + MX < bx0) bx0 = x0 + MX; if (x1 + MX > bx1) bx1 = x1 + MX; if (y0 + MY < by0) by0 = y0 + MY; if (y1 + MY > by1) by1 = y1 + MY;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const px = x + .5, py = y + .5;
          const u = ((b1 - c1) * (px - c0) + (c0 - b0) * (py - c1)) / den;
          const v = ((c1 - a1) * (px - c0) + (a0 - c0) * (py - c1)) / den, w = 1 - u - v;
          if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
          const z = u * a2 + v * b2 + w * c2, j = (y + MY) * BW + x + MX;
          if (z < zb[j]) {
            const nx = (u * VN[A] + v * VN[Bn] + w * VN[Cn]) * sg, ny = (u * VN[A + 1] + v * VN[Bn + 1] + w * VN[Cn + 1]) * sg, nz = (u * VN[A + 2] + v * VN[Bn + 2] + w * VN[Cn + 2]) * sg;
            const hl = hypot3(nx, ny, nz) || 1, lam = (nx * LIGHT[0] - ny * LIGHT[1] + nz * LIGHT[2]) / hl + bias;
            zb[j] = z; tone[j] = lam > HI ? 0 : lam > LO ? 1 : 2; fam[j] = ci;
            if (NV) { NV[j * 3] = nx / hl; NV[j * 3 + 1] = ny / hl; NV[j * 3 + 2] = nz / hl; }
          }
        }
      };
      for (let r = 0; r + 1 < C.rows; r++) for (let k = 0; k + 1 < C.cols; k++) {
        const i = r * C.cols + k;
        tri(i, i + 1, i + C.cols + 1); tri(i, i + C.cols + 1, i + C.cols);
      }
    });
    if (bx1 < 0) return;   // nothing on the sprite
    B.box = [bx0, bx1, by0, by1];
    // orphan clean-up (as pixelize): a lone tone among 3+ cloth neighbours takes their most common tone
    const ix0 = Math.max(1, bx0), ix1 = Math.min(BW - 2, bx1), iy0 = Math.max(1, by0), iy1 = Math.min(BH - 2, by1), {fixJ, fixT} = B;
    for (let pass = 0; pass < 2; pass++) {
      let nf = 0;
      for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
        const j = y * BW + x, t = tone[j]; if (t < 0) continue;
        let cnt = 0, same = false, c0 = 0, c1 = 0, c2 = 0;
        for (let q = 0; q < 4; q++) {
          const tv = tone[q === 0 ? j - 1 : q === 1 ? j + 1 : q === 2 ? j - BW : j + BW]; if (tv < 0) continue;
          cnt++; if (tv === t) same = true; if (tv === 0) c0++; else if (tv === 1) c1++; else c2++;
        }
        if (cnt >= 3 && !same) { fixJ[nf] = j; fixT[nf++] = c0 >= c1 && c0 >= c2 ? 0 : c1 >= c2 ? 1 : 2; }
      }
      for (let q = 0; q < nf; q++) tone[fixJ[q]] = fixT[q];
    }
    // fold lines where the cloth overlaps itself, then the exterior outline (on empty pixels, nearest neighbour's depth)
    const cx0 = Math.max(0, bx0 - 1), cx1 = Math.min(BW - 1, bx1 + 1), cy0 = Math.max(0, by0 - 1), cy1 = Math.min(BH - 1, by1 + 1);   // the composite box
    for (let y = cy0; y <= cy1; y++) { const r1 = y * BW + cx1 + 1; for (let j = y * BW + cx0; j < r1; j++) { out[j] = tone[j]; oz[j] = zb[j]; } }   // (a loop: subarray() made 2 views per row)
    const ox0 = Math.max(1, cx0), ox1 = Math.min(BW - 2, cx1), oy0 = Math.max(1, cy0), oy1 = Math.min(BH - 2, cy1);
    for (let y = oy0; y <= oy1; y++) for (let x = ox0; x <= ox1; x++) {
      const j = y * BW + x;
      if (tone[j] >= 0) { for (let q = 0; q < 4; q++) { const jd = q === 0 ? j - 1 : q === 1 ? j + 1 : q === 2 ? j - BW : j + BW; if (tone[jd] >= 0 && zb[jd] < zb[j] - fold) { out[j] = 3; break; } } }
      else for (let q = 0; q < 4; q++) {
        const jd = q === 0 ? j - 1 : q === 1 ? j + 1 : q === 2 ? j - BW : j + BW;
        if (tone[jd] >= 0 && zb[jd] < oz[j]) { out[j] = 3; oz[j] = zb[jd]; fam[j] = fam[jd]; if (NV) NV.copyWithin(j * 3, jd * 3, jd * 3 + 3); }
      }
    }
    // composite: a pixel shows unless the rendered body is there and nearer. The images are cleared and uploaded only
    // over the composite box + a 1 px transparent margin (the put / draw rectangle)
    const D = B.img.data, ND = NV ? B.nimg.data : null, eps = 2;
    const qx0 = Math.max(0, cx0 - 1), qx1 = Math.min(BW - 1, cx1 + 1), qy0 = Math.max(0, cy0 - 1), qy1 = Math.min(BH - 1, cy1 + 1);
    for (let y = qy0; y <= qy1; y++) { D.fill(0, (y * BW + qx0) * 4, (y * BW + qx1 + 1) * 4); if (ND) ND.fill(0, (y * BW + qx0) * 4, (y * BW + qx1 + 1) * 4); }
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      const j = y * BW + x; if (out[j] < 0) continue;
      const sx = x - MX, sy = y - MY;
      if (depth && sx >= 0 && sy >= 0 && sx < FW && sy < FH) {
        const bd = depth.data[sy * depth.w + face * FW + sx];
        if (bd < 255 && bd < oz[j] - eps) continue;
      }
      cover[j] = 1;
      const col = this.cloths[fam[j]].colours[out[j]];
      D[j * 4] = col[0]; D[j * 4 + 1] = col[1]; D[j * 4 + 2] = col[2]; D[j * 4 + 3] = 255;
      if (ND) { ND[j * 4] = (NV[j * 3] * .5 + .5) * 255 + .5; ND[j * 4 + 1] = (NV[j * 3 + 1] * .5 + .5) * 255 + .5; ND[j * 4 + 2] = (NV[j * 3 + 2] * .5 + .5) * 255 + .5; ND[j * 4 + 3] = 255; }
    }
    B.cbox = [cx0, cx1, cy0, cy1];
    const qw = qx1 - qx0 + 1, qh = qy1 - qy0 + 1;
    const cv = this.canvas; if (cv.width !== BW || cv.height !== BH) { cv.width = BW; cv.height = BH; }
    cv.getContext('2d').putImageData(B.img, 0, 0, qx0, qy0, qw, qh);
    g.drawImage(cv, qx0, qy0, qw, qh, left - MX + qx0, top - MY + qy0, qw, qh);
    if (ND) {
      const nc = this.ncanvas ??= (c => (c.getContext('2d', {willReadFrequently: true}), c))(document.createElement('canvas')); if (nc.width !== BW || nc.height !== BH) { nc.width = BW; nc.height = BH; }
      nc.getContext('2d').putImageData(B.nimg, 0, 0, qx0, qy0, qw, qh);
      gn.drawImage(nc, qx0, qy0, qw, qh, left - MX + qx0, top - MY + qy0, qw, qh);
    }
  }
}

// the body's depth sheet as bytes (decoded once per pose)
export function depthOf(img) {
  if (img._bytes) return img._bytes;
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const q = c.getContext('2d', {willReadFrequently: true}); q.drawImage(img, 0, 0);
  const rgba = q.getImageData(0, 0, img.width, img.height).data, data = new Uint8Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
  return (img._bytes = {data, w: img.width});
}
