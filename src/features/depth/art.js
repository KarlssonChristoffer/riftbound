// DEPTH ART: the arena's foreground kit, copied as it is from concepts/sprites/arena/depth.js (painters, palettes,
// shaft / water / puddle colours), so the 3D page paints exactly the same pieces. features/depth.js uses it.
// Nothing here knows about the camera: tone maps (Sil) in sprite px, coloured per mood by the feature.
import {clamp, hash3 as hsh, vnoise as vn} from '../../core/mathx.js';
import {mulberry32 as rng} from '../../core/rng.js';
import {hex255 as rgb} from '../../core/color.js';
const TAU = Math.PI * 2;
const mod = (a, n) => ((a % n) + n) % n;
function mk(w, h, opts) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); const q = c.getContext('2d', opts); q.imageSmoothingEnabled = false; return [c, q]; }
function fit(c, q, w, h) { w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h)); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; q.imageSmoothingEnabled = false; return true; } return false; }
// deterministic hash / value noise (same as biomes.js: the frost floes below are re-derived from it)
const css = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

const BARK = 1, LEAF = 2, STONE = 3, METAL = 4, SNOW = 5, ICE = 6, ROCK = 7, CRYS = 8;
const PAL = {
  ruins: {[BARK]: ['#29221d', '#3a3029', '#665446'], [LEAF]: ['#233026', '#314236', '#56705a'], [STONE]: ['#2b2a26', '#3c3a34', '#6c675b']},
  ember: {[BARK]: ['#1e1616', '#2c2020', '#6e3a2c'], [METAL]: ['#1e1d23', '#2d2a33', '#625b67'], [ROCK]: ['#221718', '#322526', '#654040']},
  frost: {[BARK]: ['#1e1815', '#2c2420', '#54463c'], [LEAF]: ['#15252a', '#20363a', '#406660'], [SNOW]: ['#627288', '#7a8ba2', '#adbcd0'],
          [ICE]: ['#2e4666', '#3f5c82', '#86a6c8'], [ROCK]: ['#1c2330', '#2a3342', '#56637a']},
  rift: {[ROCK]: ['#1c1430', '#2a1e44', '#5a4290'], [CRYS]: ['#341a54', '#4c2878', '#b474ee']},
};
for (const b in PAL) for (const m in PAL[b]) PAL[b][m] = PAL[b][m].map(rgb);
// light shafts: additive core colour (0..255) per biome / time; edge = half, motes = x2.4
const SHAFT = {
  ruins: {day: [24, 22, 15], dusk: [50, 27, 10]},
  ember: {day: [24, 16, 9], dusk: [52, 22, 8]},
  frost: {day: [17, 21, 27], dusk: [42, 27, 23], night: [9, 13, 24]},
  rift: {day: [17, 12, 25], dusk: [38, 15, 40], night: [13, 8, 26]},
};
// water: the reflection's tint (the water's dark tone) and the faint sky glint band (additive before the light)
const WATER = {
  ruins: {tint: '#33556a', lake: '#1f323c', sky: {day: [18, 24, 26], dusk: [26, 16, 8], night: [4, 6, 12]}},
  frost: {tint: '#1e3654', sky: {day: [16, 22, 30], dusk: [22, 14, 16], night: [4, 6, 12]}},
};
// ruins puddles (metres; rx, ry): outside the movement ring, near the pillars, a lane dummy, a brazier, a torch
const PUDDLES = [[11.3, 15.25, .62, .34], [11.7, 19.35, .5, .3], [18.5, 9.6, .55, .3], [31.4, 18.85, .55, .32], [32.4, 13.95, .4, .28], [23.4, 23.15, .52, .3]];
const PUD_COL = {   // the puddle mirrors the sky: pale by day, warm at dusk, dark at night
  day: {in: '#7a9092', hi: '#adc8c9', lo: '#4b5452', glint: '#d6e8e8'},
  dusk: {in: '#98826f', hi: '#cda88a', lo: '#4b4644', glint: '#efcfa6'},
  night: {in: '#35414c', hi: '#586b7a', lo: '#262b2a', glint: '#7e94a4'},
};

// ============================================================ silhouette painting (tone maps)
// Sil: material (0 = empty) + tone (1 dark, 2 mid / lit face, 3 forced rim) per pixel; coloured later per mood
class Sil {
  constructor(w, h) { this.w = w | 0; this.h = h | 0; this.m = new Uint8Array(this.w * this.h); this.t = new Uint8Array(this.w * this.h); }
  idx(x, y) { x = Math.floor(x); y = Math.floor(y); return x < 0 || y < 0 || x >= this.w || y >= this.h ? -1 : y * this.w + x; }
  p(x, y, m, t = 1) { const i = this.idx(x, y); if (i >= 0) { this.m[i] = m; this.t[i] = t; } }
  on(x, y) { const i = this.idx(x, y); return i >= 0 && this.m[i] !== 0; }
  mat(x, y) { const i = this.idx(x, y); return i < 0 ? 0 : this.m[i]; }
  disk(cx, cy, r, m, t = 1) { for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= r * r + .2) this.p(x, y, m, t); }
  // jagged ellipse (leaf clump, boulder); tone 2 on the part facing the top-left light
  blob(cx, cy, rx, ry, m, s = 0, jag = .45, lit = .3) {
    for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry + 1); y++) for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry, r2 = dx * dx + dy * dy;
      if (r2 > 1 + (vn(x / 2.3, y / 2.3, s) - .5) * jag * 2) continue;
      const l = -dx * .55 - dy * .8 + (vn(x / 3, y / 3, s + 5) - .5) * .5;
      this.p(x, y, m, l > lit ? 2 : 1);
    }
  }
  // a tapered stroke along a curve pt(k), k 0..1 (limbs, trunks, blades)
  stroke(pt, w0, w1, m, t = 1, k0 = 0, k1 = 1) {
    const [ax, ay] = pt(k0), [bx, by] = pt(k1), n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) * 2.2));
    for (let i = 0; i <= n; i++) { const k = k0 + (k1 - k0) * i / n, [x, y] = pt(k), r = (w0 + (w1 - w0) * i / n) / 2; if (r < .75) this.p(x, y, m, t); else this.disk(x, y, r, m, t); }
  }
  seg(x0, y0, x1, y1, w0, w1, m, bend = 0, t = 1) { this.stroke(curve(x0, y0, x1, y1, bend), w0, w1, m, t); }
  poly(pts, fn) {   // scanline fill at pixel centres
    let y0 = 1e9, y1 = -1e9; for (const q of pts) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const yc = y + .5, xs = [];
      for (let i = 0; i < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]; if ((ay <= yc) !== (by <= yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax)); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) fn(x, y);
    }
  }
  lowest(x) { for (let y = this.h - 1; y >= 0; y--) if (this.m[y * this.w + x]) return y; return -1; }
  highest(x) { for (let y = 0; y < this.h; y++) if (this.m[y * this.w + x]) return y; return -1; }
  mirror() { const S = new Sil(this.w, this.h), w = this.w; for (let y = 0; y < this.h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, j = y * w + (w - 1 - x); S.m[j] = this.m[i]; S.t[j] = this.t[i]; } return S; }
}
// quadratic curve from (x0, y0) to (x1, y1), bent sideways by `bend` px at the middle (sag)
function curve(x0, y0, x1, y1, bend = 0) {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
  return k => { const b = 4 * k * (1 - k) * bend; return [x0 + (x1 - x0) * k + nx * b, y0 + (y1 - y0) * k + ny * b]; };
}
// a hanging strand (ivy, needles): a 1 px wavy stem with little leaves alternating sides, a tuft at the tip
function strand(S, x0, y0, len, m, seed, leaf = true, stem = m) {
  const ph = hsh(seed, 1) * 6, amp = .6 + hsh(seed, 2) * 1.3;
  let x = x0;
  for (let k = 0; k < len; k++) {
    x = Math.round(x0 + Math.sin(k * .12 + ph) * amp * Math.min(1, k / 8));
    S.p(x, y0 + k, stem, 1);
    if (leaf && k > 2 && (k + seed) % 3 === 0) {   // a leaf every 3 px, alternating sides (2-3 px, lit tip)
      const s = (((k / 3) | 0) + seed) & 1 ? 1 : -1, big = hsh(seed, k) < .35, y = y0 + k;
      S.p(x + s, y, m, 1); S.p(x + 2 * s, y, m, 1); S.p(x + 2 * s, y - 1, m, 2); S.p(x + s, y + 1, m, 1);
      if (big) { S.p(x + 3 * s, y - 1, m, 2); S.p(x + 3 * s, y, m, 1); S.p(x + 2 * s, y + 1, m, 1); }
    }
  }
  if (leaf) S.blob(x, y0 + len, 2.2, 2.6, m, seed + 7, .3);
}
// a crystal prism: w wide, h long from base (up or down), pointed over its last 30 %, left facet lit
function crystal(S, x, base, w, h, lean, m, up = true) {
  for (let k = 0; k < h; k++) {
    const t = k / h, y = up ? base - k : base + k, cx = x + lean * t, half = t > .7 ? w / 2 * (1 - (t - .7) / .3) : w / 2;
    if (half < .3) { S.p(cx, y, m, 2); continue; }
    for (let xx = Math.round(cx - half); xx < Math.round(cx + half); xx++) S.p(xx, y, m, xx + .5 < cx ? 2 : 1);
  }
}

// ---------------------------------------------------------------- piece painters (seeded; W x H px)
// N pieces hang from their top row, S pieces stand on their bottom row, side pieces enter from their LEFT column
function pLeafyBranch(seed) {
  const r = rng(seed), W = 150 + (r() * 32 | 0), H = 92 + (r() * 20 | 0), S = new Sil(W, H);
  const pt = curve(4 + r() * 12, -10, W - 30 - r() * 14, 26 + r() * 14, 12 + r() * 8);
  S.stroke(pt, 9, 2, BARK);
  for (let i = 0; i < 4; i++) {   // twigs with their own small clumps
    const k = .25 + i * .18 + r() * .08, [x, y] = pt(k), ex = x + (r() - .3) * 16, ey = y + 12 + r() * 14;
    S.seg(x, y, ex, ey, 2.5, 1, BARK, 3); S.blob(ex, ey + 3, 7 + r() * 5, 5 + r() * 3, LEAF, seed + 40 + i);
  }
  const n = 10 + (r() * 4 | 0);
  for (let i = 0; i < n; i++) { if (r() < .18) continue; const k = .16 + .84 * (i + r() * .7) / n, [x, y] = pt(k), big = r() < .4; S.blob(x + (r() - .5) * 12, y + (r() - .3) * 16, (big ? 13 : 8) + r() * 6 + k * 4, (big ? 9 : 6) + r() * 4 + k * 2, LEAF, seed * 7 + i); }
  const [tx, ty] = pt(1); S.blob(tx + 6, ty + 5, 15, 10, LEAF, seed + 99);
  const ns = 7 + (r() * 4 | 0);
  for (let i = 0; i < ns; i++) { const x = 14 + (r() * (W - 22) | 0), y = S.lowest(x); if (y > 4 && y < H - 14) strand(S, x, y + 1, Math.min(H - y - 6, 8 + (r() * r() * (H - y) | 0)), LEAF, seed + 60 + i); }
  return S;
}
function pIvy(seed) {
  const r = rng(seed), W = 60 + (r() * 32 | 0), H = 90 + (r() * 30 | 0), S = new Sil(W, H);
  for (let x = -4; x < W + 4; x += 6) S.blob(x + r() * 4, 1 + r() * 4, 6 + r() * 4, 4 + r() * 4, LEAF, seed + x);   // the mat it hangs from
  for (let x = 4; x < W - 4; x += 11) S.blob(x + r() * 6, 9 + r() * 5, 5 + r() * 3, 3.5 + r() * 2.5, LEAF, seed + x + 500);
  const n = 5 + (r() * 3 | 0);
  for (let i = 0; i < n; i++) { const x = Math.round(5 + (W - 10) * (i + .2 + r() * .6) / n), y = Math.max(6, S.lowest(clamp(x, 0, W - 1)) - 1); strand(S, x, y, 20 + (r() * (H - y - 26) | 0), LEAF, seed * 3 + i); }
  return S;
}
function pArch(seed) {
  const r = rng(seed), W = 104 + (r() * 14 | 0), H = 112 + (r() * 12 | 0), S = new Sil(W, H);
  const pw = 20 + (r() * 5 | 0), px0 = 6, pTop = H - 64 - (r() * 10 | 0), Ri = 22 + (r() * 5 | 0), Ro = Ri + 12;
  const lit = x => x < px0 + Math.round(pw * .4);
  for (let y = pTop; y < H; y++) for (let x = px0; x < px0 + pw; x++) {   // the pier: lit left face, shaded right, coursed joints
    const course = Math.floor((y - pTop) / 9), joint = (y - pTop) % 9 === 8 || (x - px0 + course * 7) % 14 === 0;
    S.p(x, y, STONE, lit(x) && !joint ? 2 : 1);
  }
  for (let i = 0; i < 3; i++) { const y = pTop + 12 + (r() * (H - pTop - 20) | 0), side = r() < .5; for (let k = 0; k < 3; k++) S.p(side ? px0 : px0 + pw - 1, y + k, 0); }   // chips
  for (let y = pTop - 5; y < pTop; y++) for (let x = px0 - 2; x < px0 + pw + 2; x++) S.p(x, y, STONE, y === pTop - 5 || x < px0 + 3 ? 2 : 1);   // impost
  // the arch ring springs from the pier's right part and breaks off on the way over (jagged)
  const cx = px0 + pw - 2 + Ri, cy = pTop - 5, brk = 66 + r() * 30;
  for (let y = 0; y < cy + 1; y++) for (let x = px0; x < W; x++) {
    const dx = x + .5 - cx, dy = cy - (y + .5), R = Math.hypot(dx, dy), a = Math.atan2(dy, dx) * 180 / Math.PI;
    if (R < Ri || R > Ro || a > 180 || a < brk + (vn(R / 2.5, 3, seed) - .5) * 22) continue;
    const vous = Math.abs(((a - 180) % 11 + 11) % 11) < 1.1;
    S.p(x, y, STONE, R > Ri + 5 && !vous ? 2 : 1);
  }
  for (let x = px0 - 1; x < px0 + pw - 6; x++) { const top = pTop - 5 - Math.round(4 + vn(x / 4, 7, seed) * 10); for (let y = top; y < pTop - 5; y++) if (!S.on(x, y)) S.p(x, y, STONE, (y - top) < 2 ? 2 : 1); }   // rubble spandrel
  const qx = W - 26 + (r() * 6 | 0), qw = 16 + (r() * 5 | 0), qt = H - 46 - (r() * 26 | 0);   // a smaller broken pier
  for (let x = qx; x < qx + qw; x++) { const top = qt + Math.round(Math.abs(x - qx - qw * .3) * .7 + vn(x / 3, 2, seed) * 5); for (let y = top; y < H; y++) S.p(x, y, STONE, x < qx + 5 && (y - top) % 9 !== 8 ? 2 : 1); }
  for (let i = 0; i < 6; i++) { const a = (180 - (180 - brk) * i / 6) * Math.PI / 180, R = Ro + 1; S.blob(cx + Math.cos(a) * R, cy - Math.sin(a) * R + 2, 5 + r() * 4, 3.5 + r() * 2.5, LEAF, seed + 10 + i); }
  S.blob(px0 + 6, pTop - 12, 8, 5, LEAF, seed + 30); S.blob(qx + 4, S.highest(qx + 4) + 1, 6, 4, LEAF, seed + 31);
  for (let i = 0; i < 5; i++) { const x = px0 + 2 + (r() * (pw + 14) | 0), y = S.lowest(x) < 0 ? pTop : Math.min(pTop - 4, S.highest(x) + 6); strand(S, x, Math.max(2, y), 12 + (r() * 34 | 0), LEAF, seed + 20 + i); }
  clump(S, r, W * .55, H, 26, 30, LEAF, seed + 70);
  return S;
}
function pStump(seed) {
  const r = rng(seed), cw = 22 + (r() * 5 | 0), W = cw + 22, H = 84 + (r() * 26 | 0), S = new Sil(W, H), x0 = 11, sl = (r() - .5) * 1.8, base = 6 + r() * 22;
  for (let x = x0; x < x0 + cw; x++) {
    const top = Math.round(base + sl * (x - x0) + (vn(x / 2.5, 1, seed) - .5) * 9), u = (x - x0) / cw, flute = (x - x0) % 4 === 3;
    for (let y = Math.max(0, top); y < H; y++) {
      const dj = (y - Math.round(base) + 270) % 27, face = (u < .4 && !flute) || (u >= .4 && flute && u < .7);
      S.p(x, y, STONE, y - top < 2 ? 2 : dj === 0 ? 1 : dj === 1 ? 2 : face ? 2 : 1);
    }
  }
  for (let i = 0; i < 4; i++) { const y = Math.round(base + 14 + r() * (H - base - 40)), side = r() < .5, d = 1 + (r() * 2 | 0); for (let k = 0; k < 3 + d; k++) for (let j = 0; j < d; j++) S.p(side ? x0 + j : x0 + cw - 1 - j, y + k, 0); }   // chips
  for (let y = H - 20; y < H - 13; y++) for (let x = x0 - 4; x < x0 + cw + 4; x++) S.p(x, y, STONE, y === H - 20 || x < x0 - 1 ? 2 : 1);   // base moulding
  for (let x = x0 - 1; x < x0 + cw + 1; x++) { const t = S.highest(clamp(x, 0, W - 1)); if (t >= 0 && hsh(x, seed) < .45) { S.p(x, t - 1, LEAF, 2); if (hsh(x, seed, 2) < .4) S.p(x, t - 2, LEAF, 1); } }   // moss on the break
  const sx = x0 + 2 + (r() * 6 | 0); strand(S, sx, S.highest(sx) + 1, 18 + (r() * 30 | 0), LEAF, seed + 5);
  clump(S, r, W / 2, H, W * .6, 26, LEAF, seed + 9);
  return S;
}
// a low mound of leaves / blades at the foot of a piece (x centre, bottom row y, width, blade height)
function clump(S, r, cx, y, w, h, m, seed, reeds = false) {
  for (let i = 0; i < 9; i++) {
    const x0 = cx - w / 2 + r() * w, hh = h * (.35 + r() * .65), lean = (r() - .45) * 14;
    if (!reeds && r() < .35) blade(S, x0, y - 4, lean, hh, 3 + r() * 2, m, r() < .5 ? 2 : 1);
    else S.stroke(k => [x0 + lean * k * k, y - 4 - hh * k], r() < .5 ? 2 : 3, 1, m, r() < .3 ? 2 : 1);
  }
  for (let i = 0; i < 3; i++) S.blob(cx - w / 2 + w * (i + .5) / 3 + (r() - .5) * 6, y + 2, w / 5 + r() * 5, 6 + r() * 4, m === BARK ? ROCK : m, seed + i, .5);
}
// a lanceolate leaf / broad blade rising from (x0, y0)
function blade(S, x0, y0, lean, h, wmax, m, t) {
  const n = Math.ceil(h * 1.4);
  for (let i = 0; i <= n; i++) {
    const k = i / n, x = x0 + lean * k * k, y = y0 - h * k, w = Math.max(1, wmax * Math.sin(Math.PI * Math.min(1, .12 + k * .95)));
    for (let j = 0; j < Math.round(w); j++) S.p(x - w / 2 + j, y, m, j < w / 2 ? t : 1);
  }
}
function pClump(seed, m = LEAF, tall = 1, reeds = false) {
  const r = rng(seed), W = 70 + (r() * 32 | 0), H = Math.round((66 + r() * 30) * tall), S = new Sil(W, H), n = 12 + (r() * 8 | 0);
  for (let i = 0; i < n; i++) {
    const x0 = 6 + r() * (W - 12), h = (H - 10) * (.4 + r() * .6), lean = (r() - .45) * 24;
    if (!reeds && r() < .35) blade(S, x0, H - 8, lean, h * .8, 4 + r() * 2.5, m, r() < .5 ? 2 : 1);
    else S.stroke(k => [x0 + lean * k * k, H - 8 - h * k], r() < .5 ? 2 : 3, 1, m, r() < .3 ? 2 : 1);
    if (reeds && r() < .45) { const tx = x0 + lean, ty = H - 8 - h; for (let j = 0; j < 4; j++) S.p(tx + (j & 1), ty - j, m, j < 2 ? 2 : 1); }   // seed heads
  }
  const nb = 3 + (r() * 2 | 0);
  for (let i = 0; i < nb; i++) S.blob(W * (i + .5) / nb + (r() - .5) * 8, H - 1 + r() * 4, 13 + r() * 8, 9 + r() * 6, reeds ? ROCK : m, seed + 30 + i, .5);
  return S;
}
function pSideLeafy(seed) {
  const r = rng(seed), W = 140 + (r() * 26 | 0), H = 108 + (r() * 24 | 0), S = new Sil(W, H), y0 = H * .3 + r() * 10;
  const pt = curve(-10, y0, W - 30, y0 + 14 + r() * 16, 10 + r() * 6);
  S.stroke(pt, 11, 2, BARK);
  for (let i = 0; i < 3; i++) { const k = .3 + i * .2 + r() * .1, [x, y] = pt(k), ex = x + 6 + r() * 14, ey = y + (r() < .5 ? -1 : 1) * (10 + r() * 12); S.seg(x, y, ex, ey, 3, 1, BARK, 2); S.blob(ex + 3, ey, 8 + r() * 5, 6 + r() * 3, LEAF, seed + 40 + i); }
  const n = 10 + (r() * 4 | 0);
  for (let i = 0; i < n; i++) { const k = .12 + .88 * (i + r() * .7) / n, [x, y] = pt(k); S.blob(x + (r() - .5) * 10, y + (r() - .55) * 16, 10 + r() * 7 - k * 2, 7 + r() * 5, LEAF, seed * 5 + i); }
  for (let i = 0; i < 4; i++) S.blob(r() * 18, H * (.05 + i * .2) + r() * 8, 14 + r() * 6, 12 + r() * 6, LEAF, seed + 77 + i);   // the crown's edge
  const ns = 6 + (r() * 3 | 0);
  for (let i = 0; i < ns; i++) { const x = 8 + (r() * (W - 20) | 0), y = S.lowest(x); if (y > 4 && y < H - 10) strand(S, x, y + 1, Math.min(H - y - 4, 6 + (r() * 24 | 0)), LEAF, seed + 50 + i); }
  return S;
}
function pCharBranch(seed, side = false) {
  const r = rng(seed), W = side ? 140 + (r() * 20 | 0) : 150 + (r() * 30 | 0), H = side ? 104 + (r() * 16 | 0) : 92 + (r() * 18 | 0), S = new Sil(W, H);
  const br = (x, y, a, len, th, d) => {
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    S.seg(x, y, ex, ey, th, Math.max(1, th * .62), BARK, (r() - .5) * len * .2);
    if (d < 5 && len > 5) { br(ex, ey, a - .28 - r() * .45, len * (.6 + r() * .16), th * .62, d + 1); if (r() < .8) br(ex, ey, a + .3 + r() * .55, len * (.52 + r() * .16), th * .56, d + 1); }
    else if (r() < .5) S.seg(ex, ey, ex + (r() - .5) * 6, ey + 3 + r() * 5, 1, 1, BARK);   // a snapped twig hanging
  };
  if (side) br(-8, H * .38, .12 + r() * .2, 58 + r() * 12, 11, 0);
  else br(6 + r() * 16, -10, .85 + r() * .3, 54 + r() * 14, 11, 0);
  return S;
}
function pChains(seed) {
  const r = rng(seed), n = 1 + (r() * 3 | 0), W = 10 + n * 12, H = 84 + (r() * 44 | 0), S = new Sil(W, H);
  for (let i = 0; i < n; i++) {
    const x = 6 + i * 12 + (r() * 3 | 0), end = r(), len = Math.round((H - (end < .7 ? 18 : 4)) * (.45 + r() * .55));
    for (let y = 0; y < len; y++) {
      const k = (y + i * 3) % 8;
      if (k < 5) { if (k === 0 || k === 4) S.p(x, y, METAL, 1); else { S.p(x - 1, y, METAL, k === 1 ? 2 : 1); S.p(x + 1, y, METAL, 1); } }
      else S.p(x, y, METAL, 1);
    }
    if (end < .4) { for (let j = 0; j < 5; j++) S.p(x, len + j, METAL, 1); S.p(x + 1, len + 5, METAL, 1); S.p(x + 2, len + 4, METAL, 1); S.p(x + 3, len + 3, METAL, 1); S.p(x + 3, len + 2, METAL, 2); }
    else if (end < .7) {   // a cage / lantern frame
      const cw = 9, ch = 12, x0 = x - 4, y0 = len + 2;
      for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) if (yy === 0 || yy === ch - 1 || xx === 0 || xx === cw - 1 || xx === 4) S.p(x0 + xx, y0 + yy, METAL, xx === 0 || yy === 0 ? 2 : 1);
      for (let xx = 2; xx < cw - 2; xx++) S.p(x0 + xx, y0 - 1, METAL, 1); S.p(x, y0 - 2, METAL, 1);
      for (let xx = 1; xx < cw - 1; xx++) S.p(x0 + xx, y0 + ch, METAL, 1);
    }
  }
  return S;
}
function pBasalt(seed) {
  const r = rng(seed), W = 90 + (r() * 40 | 0), H = 80 + (r() * 40 | 0), S = new Sil(W, H);
  let x = 1 + (r() * 4 | 0), ci = 0;
  while (x < W - 5) {
    const cw = 7 + (r() * 9 | 0), env = Math.sin(Math.PI * clamp((x + cw / 2) / W, 0, 1)), h = Math.round((.3 + .7 * env) * (H - 4) * (.55 + r() * .45));
    const top0 = H - h, sl = (r() - .5) * 1.1, spike = r() < .35;
    for (let xx = 0; xx < cw && x + xx < W; xx++) {
      const top = Math.round(top0 + sl * xx + (spike ? Math.abs(xx - cw * .55) * 1.4 : 0));
      for (let y = Math.max(0, top); y < H; y++) { const joint = (y - top0 + ci * 5) % 14 === 0; S.p(x + xx, y, ROCK, y - top < 2 ? 2 : xx < 3 && !joint ? 2 : 1); }
    }
    x += cw + (r() < .25 ? 1 : 0); ci++;
  }
  for (let i = 0; i < 3; i++) S.blob(r() * W, H + 2, 12 + r() * 8, 8 + r() * 4, ROCK, seed + 60 + i, .6);   // scree at the foot
  return S;
}
// one drooping needle spray (a small pine tier) hanging from (x, y): widening downward, serrated hem, snow on its
// shoulders (thicker on the lit left), an icicle or two under it
function spray(S, x, y, hw, dh, seed, ice) {
  for (let yy = 0; yy <= dh; yy++) {
    const t = yy / dh, half = hw * (.2 + .8 * Math.sqrt(t)), cy = Math.round(y + yy);
    for (let xx = Math.round(x - half); xx <= Math.round(x + half); xx++) {
      const u = Math.abs(xx + .5 - x) / hw, droop = u > .6 ? Math.round((u - .6) * 6) : 0;   // the tips hang lower
      if (yy >= dh - 2 && (xx + seed) % 3 === 0) continue;   // needle teeth
      S.p(xx, cy + droop, LEAF, xx + .5 < x - half * .3 && t < .75 ? 2 : 1);
    }
  }
  for (let xx = Math.round(x - hw); xx <= Math.round(x + hw * .75); xx++) {
    let yy = Math.floor(y - 1); while (yy < y + dh && S.mat(xx, yy) !== LEAF) yy++;
    if (yy >= y + dh - 3) continue;
    const d = (xx < x ? 3 : 2) + (vn(xx / 3, y, seed) * 2.5 | 0);
    for (let j = 0; j < d; j++) S.p(xx, yy - 1 + j, SNOW, j === 0 ? 2 : 1);
  }
  if (ice) for (let j = 0; j < 2; j++) { const ix = Math.round(x - hw * .6 + hsh(seed, j) * hw * 1.2), iy = S.lowest(Math.max(0, Math.min(S.w - 1, ix))), len = 2 + (hsh(seed, j, 3) * 7 | 0); if (iy > 0) for (let q = 1; q <= len; q++) S.p(ix, iy + q, ICE, q === 1 ? 2 : 1); }
}
function pBough(seed, side = false) {
  const r = rng(seed), W = side ? 140 + (r() * 20 | 0) : 150 + (r() * 30 | 0), H = side ? 100 + (r() * 20 | 0) : 90 + (r() * 20 | 0), S = new Sil(W, H);
  const pt = side ? curve(-10, H * .28 + r() * 8, W - 20, H * .42 + r() * 12, 10) : curve(6 + r() * 10, -10, W - 24, 26 + r() * 16, 12);
  S.stroke(pt, 8, 2, BARK);
  const n = 6 + (r() * 3 | 0), spr = [];
  for (let i = 0; i < n; i++) {   // along the limb, alternating a little above / below it
    const k = .1 + .9 * (i + r() * .5) / n, [x, y] = pt(k);
    spr.push([x + (r() - .5) * 6, y - 4 + (i & 1) * 5, 13 + r() * 8 + k * 6, 13 + r() * 7 + k * 5]);
    if (r() < .55) spr.push([x + 5 + r() * 9, y + 12 + r() * 9, 10 + r() * 5, 10 + r() * 5]);   // a lower spray on a side twig
  }
  spr.sort((a, b) => b[1] - a[1]);   // lower ones first: the upper sprays overlap them
  spr.forEach(([x, y, hw, dh], i) => spray(S, x, y, hw, dh, seed * 13 + i, r() < .35));
  return S;
}
function pIcicles(seed) {
  const r = rng(seed), W = 88 + (r() * 40 | 0), H = 64 + (r() * 36 | 0), S = new Sil(W, H);
  const lip = x => 9 + Math.round(vn(x / 9, 1, seed) * 8);
  for (let x = 0; x < W; x++) { const b = lip(x); for (let y = 0; y < b; y++) S.p(x, y, y >= b - 2 ? ICE : y < 4 ? SNOW : ROCK, y === b - 2 ? 2 : 1); }
  for (let x = 1 + (r() * 3 | 0); x < W - 2; x += 2 + (r() * 5 | 0)) {
    const b = lip(x), len = 3 + Math.round(r() * r() * (H - b - 3)), w0 = 1 + (r() * 3 | 0);
    for (let k = 0; k < len; k++) { const ww = Math.max(1, Math.round(w0 * (1 - k / len))); for (let j = 0; j < ww; j++) S.p(x + j, b + k, ICE, j === 0 && ww > 1 ? 2 : 1); }
  }
  return S;
}
function pPines(seed) {
  const r = rng(seed), n = r() < .6 ? 2 : 1, W = 64 + n * 34, H = 112 + (r() * 28 | 0), S = new Sil(W, H);
  for (let i = 0; i < n; i++) {
    const cx = n === 1 ? W / 2 : 30 + i * (W - 60), top = 4 + (r() * 26 | 0) + i * 18, tiers = 6 + (r() * 2 | 0), th = (H - top) / tiers;
    for (let k = tiers; k >= 0; k--) {
      const yT = top + k * th * .78, yB = yT + th * 1.4, hw = 7 + k * 5.4;
      for (let y = Math.floor(yT); y < Math.min(H, yB); y++) {
        const t = (y - yT) / (yB - yT), half = hw * t;
        for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) { if (y > yB - 3 && (x + k) % 3 === 0) continue; S.p(x, y, LEAF, x < cx - half * .35 && t < .85 ? 2 : 1); }
      }
      for (let x = Math.round(cx - hw); x < cx + hw * .45; x++) {   // snow on the tier's shoulder
        let y = Math.floor(yT); while (y < yB && S.mat(x, y) !== LEAF) y++;
        if (y >= yB) continue; const d = 1 + (vn(x / 3, k, seed) * 3 | 0);
        for (let j = 0; j < d; j++) S.p(x, y + j, SNOW, j === 0 ? 2 : 1);
      }
    }
  }
  return S;
}
function pSnowRocks(seed) {
  const r = rng(seed), W = 80 + (r() * 30 | 0), H = 58 + (r() * 20 | 0), S = new Sil(W, H), n = 2 + (r() * 2 | 0);
  for (let i = 0; i < n; i++) { const rx = 13 + r() * 13, ry = 12 + r() * 10, cx = rx + r() * (W - 2 * rx), cy = H - ry * .5; S.blob(cx, cy, rx, ry, ROCK, seed + i, .3, .25); }
  for (let x = 0; x < W; x++) { const y = S.highest(x); if (y < 0) continue; const d = 3 + (vn(x / 5, 0, seed) * 5 | 0); for (let j = 0; j < d; j++) S.p(x, y + j, SNOW, j < d - 2 ? 2 : 1); }
  for (let i = 0; i < 7; i++) { const x = r() * W, h = 6 + r() * 14; S.seg(x, H, x + (r() - .5) * 6, H - h, 2, 1, LEAF, 0, 1); }
  return S;
}
function pShard(seed) {
  const r = rng(seed), W = 60 + (r() * 30 | 0), H = 84 + (r() * 30 | 0), S = new Sil(W, H), cx = W / 2 + (r() - .5) * 6, top = 24 + (r() * 8 | 0), hw = W / 2 - 4;
  const R = [], L = [];
  for (let i = 1; i <= 5; i++) { const k = i / 6; R.push([cx + hw * (1 - k) * (.65 + r() * .45), top + (H - 4 - top) * (k * .9 + r() * .08)]); L.push([cx - hw * (1 - k) * (.65 + r() * .45), top + (H - 4 - top) * (k * .9 + r() * .08)]); }
  const pts = [[cx - hw, top + (r() * 3 | 0)], [cx + hw, top + (r() * 3 | 0)], ...R, [cx + (r() - .5) * 6, H - 2], ...L.reverse()];
  S.poly(pts, (x, y) => S.p(x, y, ROCK, x + .5 < cx - hw * .25 ? 2 : 1));
  for (let x = 0; x < W; x++) { const t = S.highest(x); if (t >= 0) { S.p(x, t, ROCK, 2); S.p(x, t + 1, ROCK, 2); } }
  for (let y = top + 8; y < H; y += 7 + (r() * 4 | 0)) for (let x = 0; x < W; x++) if (S.mat(x, y) === ROCK && hsh(x >> 2, y, seed) < .7) S.p(x, y, ROCK, 1);
  const nc = 1 + (r() < .7 ? 1 : 0);
  for (let k = 0; k < nc; k++) crystal(S, cx - 9 + k * 13 + (r() * 4 | 0), top + 1, 5 + (r() * 3 | 0), 14 + r() * 16, (r() - .5) * 5, CRYS, true);
  return S;
}
function pSpires(seed) {
  const r = rng(seed), W = 70 + (r() * 30 | 0), H = 104 + (r() * 32 | 0), S = new Sil(W, H), n = 3 + (r() * 2 | 0);
  const order = Array.from({length: n}, (_, i) => i).sort(() => r() - .5);
  for (const i of order) { const x = 10 + (W - 20) * (i + .5) / n + (r() - .5) * 6, h = H * (.4 + r() * .58), w = 9 + (r() * 7 | 0); crystal(S, x, H - 1, w, h, (r() - .5) * 14, CRYS, true); }
  S.blob(W * .5, H + 4, W * .5, 14, ROCK, seed + 9, .5);
  return S;
}
function pHangCrystals(seed) {
  const r = rng(seed), W = 90 + (r() * 30 | 0), H = 86 + (r() * 26 | 0), S = new Sil(W, H);
  for (let x = 0; x < W; x++) { const b = 10 + Math.round(vn(x / 8, 2, seed) * 12); for (let y = 0; y < b; y++) S.p(x, y, ROCK, y === b - 1 || y === b - 2 ? 2 : 1); }
  const n = 4 + (r() * 3 | 0);
  for (let i = 0; i < n; i++) { const x = 8 + (W - 16) * (i + r() * .7) / n, h = 16 + r() * (H - 26), w = 5 + (r() * 6 | 0); crystal(S, x, 12, w, h, (r() - .5) * 8, CRYS, false); }
  return S;
}
// per biome: templates for the N (hang from the top), S (rise from the bottom) and side (W / E) edges.
// [painter, sway ('hang' | 'rise' | 'side' | 'bob' | null), sway amplitude px, sway exponent, parallax]
const KIT = {
  ruins: {N: [[pLeafyBranch, 'hang', 2, 1.4, 1.45], [pIvy, 'hang', 2, 1.3, 1.3], [pLeafyBranch, 'hang', 2, 1.4, 1.5], [pIvy, 'hang', 2, 1.3, 1.35]],
          S: [[pArch, null, 0, 1, 1.5], [pClump, 'rise', 2, 1.4, 1.3], [pStump, null, 0, 1, 1.4], [pClump, 'rise', 2, 1.4, 1.35]],
          side: [[pSideLeafy, 'side', 1, 1.3, 1.4], [pSideLeafy, 'side', 1, 1.3, 1.45]]},
  ember: {N: [[s => pCharBranch(s), 'hang', 1, 1.5, 1.45], [pChains, 'hang', 2, 1, 1.3], [s => pCharBranch(s), 'hang', 1, 1.5, 1.5], [pChains, 'hang', 2, 1, 1.35]],
          S: [[pBasalt, null, 0, 1, 1.45], [s => pClump(s, BARK, .9, true), 'rise', 1, 1.4, 1.3], [pBasalt, null, 0, 1, 1.35], [s => pClump(s, BARK, .8, true), 'rise', 1, 1.4, 1.35]],
          side: [[s => pCharBranch(s, true), 'side', 1, 1.3, 1.4], [s => pCharBranch(s, true), 'side', 1, 1.3, 1.45]]},
  frost: {N: [[s => pBough(s), 'hang', 1, 1.4, 1.45], [pIcicles, null, 0, 1, 1.3], [s => pBough(s), 'hang', 1, 1.4, 1.5], [pIcicles, null, 0, 1, 1.35]],
          S: [[pPines, 'rise', 1, 1.5, 1.5], [pSnowRocks, null, 0, 1, 1.3], [pPines, 'rise', 1, 1.5, 1.4], [pSnowRocks, null, 0, 1, 1.35]],
          side: [[s => pBough(s, true), 'side', 1, 1.3, 1.4], [s => pBough(s, true), 'side', 1, 1.3, 1.45]]},
  rift: {N: [[pHangCrystals, 'bob', 2, 1, 1.45], [pShard, 'bob', 2, 1, 1.3], [pHangCrystals, 'bob', 2, 1, 1.5]],
         S: [[pSpires, null, 0, 1, 1.45], [pShard, 'bob', 2, 1, 1.3], [pSpires, null, 0, 1, 1.35], [pShard, 'bob', 2, 1, 1.4]],
         side: [[pShard, 'bob', 2, 1, 1.4], [pShard, 'bob', 2, 1, 1.35]]},
};
const SEED = {ruins: 11, ember: 23, frost: 37, rift: 51};

export {TAU, clamp, mod, mk, fit, hsh, vn, rng, rgb, css, PAL, SHAFT, WATER, PUDDLES, PUD_COL, Sil, KIT, SEED, BARK, LEAF, STONE, METAL, SNOW, ICE, ROCK, CRYS};
