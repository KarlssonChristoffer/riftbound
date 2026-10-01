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
const LIGHT = (() => { const v = [-0.55, -0.62, 0.56], l = Math.hypot(...v); return v.map(c => c / l); })();  // pixelize's
const HI = .78, LO = .36;
const hex = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
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

export class ClothRig {
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
    this.t = 0; this.acc = 0; this.origin = [0, 0, 0];
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
    return {def: c, rows, cols, n, links, pos: null, prev: null, pin: c.pin_rows * cols, rowLen, seed: this.cloths?.length * 2.1 || 0,
            colours: c.colours.map(hex), bias: c.bias ?? 0, mat: CLOTH_MATERIALS[c.name] || {}};
  }

  // world (metres, the render's frame with the camera fixed) of a pose-space point for facing k at the player's spot
  #place(q, k, org) {
    const a = (this.idx.cam.yaw0 + 360 / this.N * k) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [c * q[0] - s * q[1] + org[0], s * q[0] + c * q[1] + org[1], q[2] + org[2]];
  }
  #pose(M, v) {
    return [M[0] * v[0] + M[1] * v[1] + M[2] * v[2] + M[3], M[4] * v[0] + M[5] * v[1] + M[6] * v[2] + M[7],
            M[8] * v[0] + M[9] * v[1] + M[10] * v[2] + M[11]];
  }

  reset() { for (const C of this.cloths) C.pos = null; }

  update(dt, sim, face, gpos) {
    if (!this.active || !sim) return;
    // the player's ground position in the render's world frame (game x east / y south -> camera right / toward camera)
    const org = [gpos[0] * this.R[0] + gpos[1] * this.T[0], gpos[0] * this.R[1] + gpos[1] * this.T[1], 0];
    const jump = Math.hypot(org[0] - this.origin[0], org[1] - this.origin[1]) > 2;
    // the body's velocity: damping works on the cloth's motion RELATIVE to the body (internal friction), not against
    // the world (that would be a second air drag that makes a heavy cloak stream more)
    this.vel = jump || !dt ? [0, 0, 0] : [(org[0] - this.origin[0]) / dt, (org[1] - this.origin[1]) / dt, 0];
    this.origin = org; this.face = face;
    const caps = sim.caps.map(c => [this.#place(c.slice(0, 3), face, org), this.#place(c.slice(3, 6), face, org), c[6]]);
    for (const C of this.cloths) {
      const M = sim.mats[C.def.bone], target = [], all = !!C.mat.retain;
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
      for (let r = 0; r < C.rows; r++) for (let k = 0; k < C.cols; k++)
        target.push(r < C.def.pin_rows || !C.pos || jump || all ? this.#place(this.#pose(M, C.def.grid[r][k]), face, org) : null);
      C.goal = target;   // the draped shape on the current pose (for the shape-retention spring)
      if (!C.pos || jump) { C.pos = target.map(p => p.slice()); C.prev = target.map(p => p.slice()); }
      C.from = C.pin ? C.pos.slice(0, C.pin).map(p => p.slice()) : []; C.to = target.slice(0, C.pin);
    }
    this.caps = caps;
    // fixed substeps; pinned rows glide from where they were to the new pose over the frame
    const h = 1 / 120; this.acc = Math.min(this.acc + dt, .1);
    const steps = Math.floor(this.acc / h); this.acc -= steps * h;
    for (let i = 0; i < steps; i++) { this.t += h; this.#substep(h, (i + 1) / steps); }
  }

  #wind() {
    const P = CLOTH_PARAMS, t = this.t, g = P.gust * (.55 + .45 * Math.sin(t * .7) * Math.sin(t * 1.9 + 1.3)) * (1 + .35 * Math.sin(t * 5.3));
    const wx = P.wind[0] + g * .6 * Math.sin(t * .31), wy = P.wind[1] + g * .6 * Math.cos(t * .23);
    return [wx * this.R[0] + wy * this.T[0], wx * this.R[1] + wy * this.T[1], .15 * g * Math.sin(t * 2.7)];
  }

  #substep(h, f) {
    const P = CLOTH_PARAMS, wind = this.#wind(), h2 = h * h;
    for (const C of this.cloths) {
      const {pos, prev, rows, cols, pin} = C, M = C.mat, wt = M.weight ?? 1, damp = M.damping ?? P.damping;
      const flut = (M.flutter ?? P.flutter) / wt, wave = M.wave ?? P.wave, drag = P.drag / wt, lift = P.lift / wt;
      for (let i = 0; i < pin; i++) {   // pins follow the animation
        const a = C.from[i], b = C.to[i];
        const q = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
        prev[i] = pos[i]; pos[i] = q;
      }
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
        const i = r * cols + k; if (i < pin) continue;
        const p = pos[i], o = prev[i], v = [(p[0] - o[0]) / h, (p[1] - o[1]) / h, (p[2] - o[2]) / h];
        // surface normal from the neighbours (the panel's local orientation)
        const a = pos[r * cols + Math.min(cols - 1, k + 1)], b = pos[r * cols + Math.max(0, k - 1)];
        const c = pos[Math.min(rows - 1, r + 1) * cols + k], d = pos[Math.max(0, r - 1) * cols + k];
        let n = cross(sub(a, b), sub(c, d)); const nl = Math.hypot(...n) || 1; n = n.map(x => x / nl);
        const rel = sub(v, wind), vn = dot(rel, n), air = Math.hypot(...rel);
        // flap: a wave running from the pinned edge to the hem, a little out of step across the width (the panel twists)
        const fq = (1.4 + .45 * air) / Math.sqrt(wt), ph = 2 * Math.PI * ((r * C.rowLen) / wave - fq * this.t) + k * .5 + C.seed;
        const fl = flut * Math.min(35, air * air) * (r / (rows - 1)) * Math.sin(ph) - lift * vn;
        const acc = [-drag * rel[0] + fl * n[0], -drag * rel[1] + fl * n[1], -P.gravity - drag * rel[2] + fl * n[2]];
        if (M.retain) {   // spring toward the drape, weakening down the cloak (the hem is freest)
          const u = (r - C.def.pin_rows) / Math.max(1, rows - 1 - C.def.pin_rows), K = M.retain[0] + (M.retain[1] - M.retain[0]) * Math.min(1, u * 1.4), G = C.goal[i];
          acc[0] += K * (G[0] - p[0]); acc[1] += K * (G[1] - p[1]); acc[2] += K * (G[2] - p[2]);
        }
        prev[i] = p;
        const bv = this.vel, step = [0, 1, 2].map(j => (p[j] - o[j] - bv[j] * h) * damp + acc[j] * h2);
        const sl = Math.hypot(...step), cap = P.maxSpeed * h;   // relative to the body
        if (sl > cap) for (let j = 0; j < 3; j++) step[j] *= cap / sl;
        pos[i] = [0, 1, 2].map(j => p[j] + bv[j] * h + step[j]);
      }
      for (let it = 0; it < P.iterations; it++) {
        for (const [ia, ib, L, s0] of C.links) {
          const s = s0 < 0 ? (M.bend ?? P.bend) : s0, pa = pos[ia], pb = pos[ib];
          const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2], l = Math.hypot(dx, dy, dz) || 1e-9;
          if (s0 < 0 && l < L && !M.bendBoth) continue;   // light cloth: bend links only resist stretching open (folds free)
          const wa = ia < pin ? 0 : 1, wb = ib < pin ? 0 : 1, w = wa + wb; if (!w) continue;
          const k = (l - L) / l * s / w;
          if (wa) { pa[0] += dx * k * wa; pa[1] += dy * k * wa; pa[2] += dz * k * wa; }
          if (wb) { pb[0] -= dx * k * wb; pb[1] -= dy * k * wb; pb[2] -= dz * k * wb; }
        }
        for (let i = pin; i < pos.length; i++) this.#collide(pos[i]);
      }
      // strain limit after the collisions: overlapping body capsules (a tucked roll) can push neighbours to opposite
      // sides; no structural link may end up longer than 110% (cloth left inside the body is hidden by the depth test)
      for (let it = 0; it < 3; it++) for (const [ia, ib, L, s0] of C.links) {
        if (s0 !== 1) continue;
        const pa = pos[ia], pb = pos[ib], dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2], l = Math.hypot(dx, dy, dz);
        if (l <= L * 1.1) continue;
        const wa = ia < pin ? 0 : 1, wb = ib < pin ? 0 : 1, w = wa + wb; if (!w) continue;
        const k = (l - L * 1.1) / l / w;
        if (wa) { pa[0] += dx * k; pa[1] += dy * k; pa[2] += dz * k; }
        if (wb) { pb[0] -= dx * k; pb[1] -= dy * k; pb[2] -= dz * k; }
      }
    }
  }

  #collide(p) {
    for (const [a, b, r0] of this.caps) {
      const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
      const c = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t], d = sub(p, c), l = Math.hypot(...d), r = r0 + CLOTH_PARAMS.thickness;
      // push out, but at most 4 mm per pass: when the body snaps to a new facing its capsules teleport into the cloth,
      // and a full push-out in one step would fling it (it resolves over a few substeps instead)
      if (l < r && l > 1e-6) { const k = Math.min(r - l, .004) / l; p[0] += d[0] * k; p[1] += d[1] * k; p[2] += d[2] * k; }
    }
    if (p[2] < .01) p[2] = .01;
  }

  // project a world point to sprite pixels (continuous; pixel i spans [i, i+1]) + depth in the body sheet's 0..254 units
  #proj(w) {
    const d = sub(w, this.origin);
    return [this.piv[0] + .5 + dot(d, this.R) / this.upp, this.piv[1] + .5 - dot(d, this.U) / this.upp,
            (50 - dot(d, this.off) - this.idx.cam.near) * this.dz];
  }

  // Does the cloth (as drawn by the LAST draw()) cover sprite pixel (x, y)? x, y are relative to draw()'s left/top.
  // Effects painted from the body's own maps after the cloth (armour glints, reflections) must skip these pixels.
  covers(x, y) {
    const c = this.cover; if (!c) return false;
    const u = x + c.MX, v = y + c.MY;
    return u >= 0 && v >= 0 && u < c.BW && v < c.BH && c.a[v * c.BW + u] === 1;
  }

  // depth = {data: Uint8Array (sheet, 255 = empty), w: sheet width}; the sprite frame for `face` is column face*FW
  draw(g, left, top, depth, face, gn = null) {
    if (!this.active || !this.cloths[0].pos) return;
    const FW = this.idx.w, FH = this.idx.h, MX = 48, MY = 40, BW = FW + 2 * MX, BH = FH + 2 * MY;
    const zb = new Float32Array(BW * BH).fill(1e9), tone = new Int8Array(BW * BH).fill(-1), fam = new Int8Array(BW * BH);
    const NV = gn ? new Float32Array(BW * BH * 3) : null;   // per-pixel normal (only when the host wants them)
    const fold = 6 * this.dz / 100 * 1;   // 6 cm of depth: an overlapping fold gets a line
    this.cloths.forEach((C, ci) => {
      const S = C.pos.map(p => this.#proj(p)), P = C.pos, W = C.cols, H = C.rows;
      // smooth vertex normals (camera space) so waves and folds shade in bands across a facet, not one flat tone
      const VN = P.map((_, i) => {
        const r = Math.floor(i / W), k = i % W;
        const n = cross(sub(P[r * W + Math.min(W - 1, k + 1)], P[r * W + Math.max(0, k - 1)]),
                        sub(P[Math.min(H - 1, r + 1) * W + k], P[Math.max(0, r - 1) * W + k]));
        const l = Math.hypot(...n) || 1; return [dot(n, this.R) / l, dot(n, this.U) / l, dot(n, this.off) / l];
      });
      const tri = (i0, i1, i2) => {
        const a = S[i0], b = S[i1], c = S[i2];
        const n = cross(sub(P[i1], P[i0]), sub(P[i2], P[i0]));
        const sg = dot(n, this.off) < 0 ? -1 : 1, bias = C.bias - (sg < 0 ? .22 : 0);   // the lining: seen from inside, darker
        const A = VN[i0], B = VN[i1], Cn = VN[i2];
        const x0 = Math.max(-MX, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(FW + MX - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
        const y0 = Math.max(-MY, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(FH + MY - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
        const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]); if (Math.abs(den) < 1e-6) return;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const px = x + .5, py = y + .5;
          const u = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den;
          const v = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den, w = 1 - u - v;
          if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
          const z = u * a[2] + v * b[2] + w * c[2], j = (y + MY) * BW + x + MX;
          if (z < zb[j]) {
            const nx = (u * A[0] + v * B[0] + w * Cn[0]) * sg, ny = (u * A[1] + v * B[1] + w * Cn[1]) * sg, nz = (u * A[2] + v * B[2] + w * Cn[2]) * sg;
            const lam = (nx * LIGHT[0] - ny * LIGHT[1] + nz * LIGHT[2]) / (Math.hypot(nx, ny, nz) || 1) + bias;
            zb[j] = z; tone[j] = lam > HI ? 0 : lam > LO ? 1 : 2; fam[j] = ci;
            if (NV) { const l = Math.hypot(nx, ny, nz) || 1; NV[j * 3] = nx / l; NV[j * 3 + 1] = ny / l; NV[j * 3 + 2] = nz / l; }
          }
        }
      };
      for (let r = 0; r + 1 < C.rows; r++) for (let k = 0; k + 1 < C.cols; k++) {
        const i = r * C.cols + k;
        tri(i, i + 1, i + C.cols + 1); tri(i, i + C.cols + 1, i + C.cols);
      }
    });
    // orphan clean-up (as pixelize): a lone tone among 3+ cloth neighbours takes their most common tone
    for (let pass = 0; pass < 2; pass++) {
      const fix = [];
      for (let y = 1; y < BH - 1; y++) for (let x = 1; x < BW - 1; x++) {
        const j = y * BW + x; if (tone[j] < 0) continue;
        const nb = [tone[j - 1], tone[j + 1], tone[j - BW], tone[j + BW]].filter(t => t >= 0);
        if (nb.length >= 3 && !nb.includes(tone[j])) { const c = [0, 0, 0]; nb.forEach(t => c[t]++); fix.push([j, c.indexOf(Math.max(...c))]); }
      }
      for (const [j, t] of fix) tone[j] = t;
    }
    // fold lines where the cloth overlaps itself, then the exterior outline (on empty pixels, nearest neighbour's depth)
    const N4 = [-1, 1, -BW, BW], out = tone.slice(), oz = zb.slice();
    for (let y = 1; y < BH - 1; y++) for (let x = 1; x < BW - 1; x++) {
      const j = y * BW + x;
      if (tone[j] >= 0) { for (const d of N4) if (tone[j + d] >= 0 && zb[j + d] < zb[j] - fold) { out[j] = 3; break; } }
      else for (const d of N4) if (tone[j + d] >= 0 && zb[j + d] < oz[j]) { out[j] = 3; oz[j] = zb[j + d]; fam[j] = fam[j + d]; if (NV) NV.copyWithin(j * 3, (j + d) * 3, (j + d) * 3 + 3); }
    }
    // composite: a pixel shows unless the rendered body is there and nearer
    const img = new ImageData(BW, BH), D = img.data, eps = 2, nimg = NV ? new ImageData(BW, BH) : null, ND = nimg?.data;
    const cover = new Uint8Array(BW * BH);   // which pixels the cloth really shows this frame (see covers())
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
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
    this.cover = {a: cover, BW, BH, MX, MY};
    const cv = this.canvas; if (cv.width !== BW || cv.height !== BH) { cv.width = BW; cv.height = BH; }
    cv.getContext('2d').putImageData(img, 0, 0);
    g.drawImage(cv, left - MX, top - MY);
    if (nimg) {
      const nc = this.ncanvas ??= (c => (c.getContext('2d', {willReadFrequently: true}), c))(document.createElement('canvas')); if (nc.width !== BW || nc.height !== BH) { nc.width = BW; nc.height = BH; }
      nc.getContext('2d').putImageData(nimg, 0, 0);
      gn.drawImage(nc, left - MX, top - MY);
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
