// DEPTH: near / mid / far. OWNER: ambience session ("Game demo improvements brainstorm"), depth agent. SHOW ONLY.
//
//   foreground   overhanging branches, hanging vines, broken arch tops (per biome: charred branches + chains in ember,
//                snow-laden boughs + icicles in frost, floating rock shards / crystal spires in the rift) along the
//                edges of the view, drawn NEAR the camera: they move faster than the ground (parallax > 1), darker and
//                calmer than the playfield, and fade out when the player is behind them
//   clouds       cloud shadows drifting across the whole scene with the wind (host.wind.at / W.dir), day and dusk only
//                (strength follows the mood's sun shadow: mood.shadow.a); 1-2 hard-edged levels, never a gradient
//   shafts       light shafts: slanted additive bands from the sun's side (mood.sun.az / el) through the pillar grove,
//                the gates and gaps in the trees, with slow dust motes turning inside them; strongest at dusk, none at night
//   reflections  the stream mirrors what stands in / over / beside it (the Ranger, bushes, rocks, trees, stepping
//                stones, a leaping player) plus a sky tint; ripples break the mirror up (whole-pixel row offsets).
//                A few puddles in the ruins floor catch the brazier / torch light. Water only (ruins, frost); the ember
//                lava gets a heat-haze shimmer above it instead (the rift crack: nothing yet)
//
// CONTRACT (the host, arena.html, calls exactly these):
//   export function createDepth(ctx, host) -> D
//   D.on / D.toggle()            key 7; ?depth=0 starts off
//   D.ms                         rolling average cost per frame (ms)
//   D.setBiome(id), D.setTime(name)
//   D.update(dt, evs)            every simulation step
//   D.drawGround(g, cam)         after the ground canvas + atmos ground, before shadows / sprites: reflections, puddles
//   D.drawClouds(g, cam)         after all sprites, BEFORE lighting.apply: cloud shadows over ground and sprites alike
//   D.drawAfterLight(g, cam)     after lighting.apply (+ x-ray): shafts and motes (additive), heat haze, then the
//                                foreground layer on top of everything in the pixel canvas
//   D.emitters(cam) -> [{img, x, y}]     glowing pixels added after lighting (a flame's glow mirrored in a puddle, ...)
// EXTRAS (tests / tuning, nothing in the host needs them): D.TUNE (live tunables, see TUNE below), D.debug (HUD-style
//   string: pieces / shafts / haze rows drawn this frame), D._dbg = {FG, SH, WA, CL} (internal state for test scripts)
//
// host: see the AMBIENCE HOST block in arena.html (player() / drawPlayer() for the Ranger's reflection, spriteOf(p) for
// props, mood() for the sun, wind for drift). ctx = {PPM, PPMY, PPMH, toS(x, y, h), WM, HM, WPX, HPX, VW, VH, PLAY,
// layout}; view px = toS(...) - [cam.x, cam.y]. layout.stream = {cx(y), w(y), stones, narrows}, layout.inStream(x, y).
// ctx.PPMY changes when the player presses P (ground projection): rebuild anything keyed on it.
//
// ART RULES (same as biomes.js / atmos.js): 1 texel = 1 screen px, no AA / dither / gradients on the pixel canvas;
// 4-tone ramps; the foreground is a SILHOUETTE layer (2-3 dark tones in the biome's own hue + a 1 px rim on the lit
// side), the environment stays calmer than the character. NEVER call getImageData on the #screen canvas (it drops the
// canvas to software rendering: ~600 ms / frame); copy view pixels with drawImage(g.canvas, ...) if you need them.
//
// HOW IT WORKS (implementation notes)
//   foreground   pieces are painted once per biome as tone maps (Sil: material + tone per pixel), coloured per time of
//                day (body x mood.amb, rim x the sun / moon colour; the rim goes on the sun side, from mood.sun.az) and
//                anchored in WORLD px along the four world edges. Screen = (anchor - cam - V/2) * par + V/2 per axis,
//                i.e. at the clamped camera a top piece hangs d px above the view, a bottom piece stands d px below it;
//                everywhere else they have slid out faster than the ground. Foliage sways in whole-pixel bands with
//                host.wind.at(); a piece over the player fades 1 -> .66 -> .34 in two steps (FG.fade).
//   clouds       one tileable level map (40 x 30 m of value noise, 3 periodic octaves, histogram thresholds -> core /
//                edge), rebuilt per projection; a coloured copy per mood (multiply colours from mood.shadow.c scaled by
//                mood.shadow.a); per frame <= 4 drawImage('multiply') at the wind-drifted world offset.
//   shafts       feet anchored in the world (pillar gaps, the W / N gates, gaps between trail-side trees); each one a
//                pre-rasterised parallelogram (2 levels: core / edge, the source end and the foot edge-only) along the
//                sun's screen direction, drawn 'lighter'; motes live in shaft-local coordinates, so they only exist
//                inside the beam.
//   reflections  a WORLD-px water mask (stream row spans minus stones / frost floes / the ice shelf, + ruins puddles)
//                built per biome / projection. Flipped sprites (about their ground contact row; airborne = dropped by
//                2 x height) go into a view scratch, rippled by whole-pixel row bands, clipped by the mask, tinted
//                toward the water's dark tone and laid on the ground at one alpha level. Flame emit canvases near
//                water / puddles are mirrored into a 1.25 x view emitter layer (lighting treats it as ground).
//   heat haze    ember only: the view strip over the lava stream copied once (drawImage(g.canvas)), then drawn back in
//                2-row bands shifted +-1 px by a slow travelling sine.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mod = (a, n) => ((a % n) + n) % n;
function mk(w, h, opts) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); const q = c.getContext('2d', opts); q.imageSmoothingEnabled = false; return [c, q]; }
function fit(c, q, w, h) { w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h)); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; q.imageSmoothingEnabled = false; return true; } return false; }
// deterministic hash / value noise (same as biomes.js: the frost floes below are re-derived from it)
const hsh = (a, b = 0, c = 0) => {
  let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 0) / 4294967296;
};
const vn = (x, y, s = 0) => {
  const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hsh(xi, yi, s), b = hsh(xi + 1, yi, s), c = hsh(xi, yi + 1, s), d = hsh(xi + 1, yi + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};
const rng = seed => { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const rgb = s => { const n = parseInt(s.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const css = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

// ============================================================ tunables (live: __demo.depth.TUNE)
const TUNE = {
  fg: {on: true, fade: [1, .66, .34], fadeStep: .09, body: [-10, -50, 10, 2], sway: 1},
  clouds: {on: true, tileM: [40, 30], cover: .31, core: .19, s: [.24, .12], time: {day: 1, dusk: .55, night: 0}, speed: 1.9, none: ['rift']},
  shafts: {on: true, max: 5, lenMax: 120, el: [38, 62], time: {day: .85, dusk: 1, night: .5}, night: ['frost', 'rift'], motes: 9},
  refl: {on: true, alpha: .6, tint: .38, ripple: 1, reach: 2.5, glowDim: .5},
  haze: {on: true},
};
// foreground palettes: [dark, mid, rim] per material, BEFORE the mood tint (they are multiplied by mood.amb)
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
  ruins: {tint: '#33556a', sky: {day: [18, 24, 26], dusk: [26, 16, 8], night: [4, 6, 12]}},
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

export function createDepth(ctx, host) {
  const Q = new URLSearchParams(location.search);
  const D = {on: Q.get('depth') !== '0', ms: 0, TUNE, debug: ''};
  let biome = 'ruins', T = 0;
  const hist = new Float32Array(60); let hN = 0, acc = 0;
  const tick = t0 => { acc += performance.now() - t0; };
  const mood = () => host.mood?.() || null;
  const timeName = () => host.time?.() || 'day';
  const camX = cam => (cam.fx ?? cam.x) + (cam.x - Math.round(cam.fx ?? cam.x));   // sub-pixel camera + shake
  const camY = cam => (cam.fy ?? cam.y) + (cam.y - Math.round(cam.fy ?? cam.y));
  const windAt = (x, y) => { const W = host.wind; return (W && W.on && W.at) ? W.at(x, y) : null; };

  // ================================================================ FOREGROUND
  const FG = {key: '', biome: '', tpls: [], pieces: [], cache: {}};   // cache: painted pieces per biome
  function buildPieces() {
    const K = KIT[biome]; FG.biome = biome; FG.tpls = []; FG.pieces = [];
    if (!K) return;
    const r = rng(SEED[biome] || 3), mkT = (e, i, j) => { const [fn, sway, amp, exp, par] = e, S = fn(SEED[biome] * 101 + i * 17 + j * 5); const t = {S, sway, amp, exp, par, cv: [null, null], mir: null}; FG.tpls.push(t); return t; };
    const lists = {N: K.N.map((e, i) => [mkT(e, i, 1), mkT(e, i, 2)]).flat(), S: K.S.map((e, i) => [mkT(e, i + 10, 1), mkT(e, i + 10, 2)]).flat(), side: K.side.map((e, i) => [mkT(e, i + 20, 1), mkT(e, i + 20, 2)]).flat()};
    const {WM, HM} = ctx;
    for (const edge of ['N', 'S']) {
      let x = 1 + r() * 3, i = 0;
      while (x < WM - 1) {
        const t = lists[edge][(i * 3 + (r() * 2 | 0)) % lists[edge].length];
        FG.pieces.push({tpl: t, mir: r() < .5, edge, along: x, d: Math.round(r() * (edge === 'N' ? 8 : 12)), par: t.par + (r() - .5) * .08, ph: r() * TAU, k: 0, ft: 0, want: 0});
        x += 3.2 + r() * 2.8; i++;
      }
    }
    for (const edge of ['W', 'E']) {
      let y = 1.5 + r() * 3, i = 0;
      while (y < HM - 1) {
        const t = lists.side[(i + (r() * 2 | 0)) % lists.side.length];
        FG.pieces.push({tpl: t, mir: edge === 'E', edge, along: y, d: Math.round(r() * 10), par: t.par + (r() - .5) * .08, ph: r() * TAU, k: 0, ft: 0, want: 0});
        y += 3.8 + r() * 2.8; i++;
      }
    }
    FG.pieces.sort((a, b) => a.par - b.par);   // nearer (faster) pieces on top
  }
  // colour a tone map for the current mood: body x amb, rim x (amb + sun) on the sun side and on top
  function colour(S, pal, side, tint, rimT, attach) {
    const [c, q] = mk(S.w, S.h), im = q.createImageData(S.w, S.h), d = im.data, {w, h, m, t} = S;
    const empty = (x, y) => y < 0 ? attach !== 'N' : x < 0 ? attach !== 'W' : x >= w ? attach !== 'E' : y >= h ? attach !== 'S' : !m[y * w + x];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, mm = m[i]; if (!mm) continue;
      const P = pal[mm] || Object.values(pal)[0], rim = t[i] === 3 || empty(x, y - 1) || (side && empty(x + side, y));
      const col = rim ? P[2] : P[t[i] === 2 ? 1 : 0], k = rim ? rimT : tint;
      d[i * 4] = col[0] * k[0]; d[i * 4 + 1] = col[1] * k[1]; d[i * 4 + 2] = col[2] * k[2]; d[i * 4 + 3] = 255;
    }
    q.putImageData(im, 0, 0); return c;
  }
  function ensureFG() {
    if (FG.biome !== biome) {
      const c = FG.cache[biome];
      if (c) { FG.biome = biome; FG.tpls = c.tpls; FG.pieces = c.pieces; } else { buildPieces(); FG.cache[biome] = {tpls: FG.tpls, pieces: FG.pieces}; }
      FG.key = '';
    }
    const M = mood(), key = biome + '|' + timeName() + '|' + (M ? M.sun.az : 0);
    if (key === FG.key) return;
    FG.key = key;
    const pal = PAL[biome] || PAL.ruins, amb = M ? M.amb : [1, 1, 1], sc = M ? M.sun.c : [1, 1, 1], night = timeName() === 'night';
    const tint = amb.map(v => Math.min(1.05, v)), rimT = amb.map((v, i) => Math.min(1.1, v * .45 + sc[i] * .55 * (night ? .7 : 1)));
    const sx = M ? Math.sin(M.sun.az * Math.PI / 180) : -.8, side = sx < -.25 ? -1 : sx > .25 ? 1 : 0;
    for (const t of FG.tpls) t.cv = [null, null];
    for (const pc of FG.pieces) {
      const t = pc.tpl, attach = pc.edge === 'N' ? 'N' : pc.edge === 'S' ? 'S' : pc.edge;
      const mi = pc.mir ? 1 : 0;
      if (!t.cvKey) t.cvKey = {};
      const ck = attach + mi;
      if (!t.cvKey[ck] || t.cvKey[ck].key !== key) {
        const S = pc.mir ? (t.mir ||= t.S.mirror()) : t.S;
        t.cvKey[ck] = {key, cv: colour(S, pal, side, tint, rimT, attach), S};
      }
      pc.cv = t.cvKey[ck].cv; pc.S = t.cvKey[ck].S;
    }
  }
  function playerBox() {
    const p = host.player?.(); if (!p) return null; const b = TUNE.fg.body;
    return [p.sx + b[0], p.sy + b[1], p.sx + b[2], p.sy + b[3]];
  }
  function covers(pc, X, Y, pb) {
    if (!pb) return false;
    const S = pc.S, x0 = Math.max(X, pb[0]), y0 = Math.max(Y, pb[1]), x1 = Math.min(X + S.w, pb[2]), y1 = Math.min(Y + S.h, pb[3]);
    if (x0 >= x1 || y0 >= y1) return false;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) if (S.m[(y - Y) * S.w + (x - X)]) return true;
    return false;
  }
  function drawFG(g, cam) {
    ensureFG();
    const {VW, VH, PPM, PPMY, WPX, HPX} = ctx, cx = camX(cam), cy = camY(cam), mX = WPX - VW, mY = HPX - VH, pb = playerBox(), A = TUNE.fg.fade;
    let n = 0;
    for (const pc of FG.pieces) {
      const cv = pc.cv; if (!cv) continue;
      const w = cv.width, h = cv.height, t = pc.tpl;
      let X, Y;
      if (pc.edge === 'N' || pc.edge === 'S') {
        X = (pc.along * PPM - cx - VW / 2) * pc.par + VW / 2 - w / 2;
        Y = pc.edge === 'N' ? -pc.d - cy * pc.par : VH + pc.d + (mY - cy) * pc.par - h;
      } else {
        Y = (pc.along * PPMY - cy - VH / 2) * pc.par + VH / 2 - h / 2;
        X = pc.edge === 'W' ? -pc.d - cx * pc.par : VW + pc.d + (mX - cx) * pc.par - w;
      }
      if (t.sway === 'bob') Y += Math.sin(T * .55 + pc.ph) * t.amp;
      X = Math.round(X); Y = Math.round(Y);
      if (X >= VW || Y >= VH || X + w <= 0 || Y + h <= 0) { pc.vis = false; pc.k = 0; continue; }
      pc.vis = true; n++;
      pc.want = covers(pc, X, Y, pb) ? 2 : 0;
      g.globalAlpha = A[pc.k];
      // sway: whole-pixel bands, the free end moving most (wind at the piece's anchor, else a slow idle breeze)
      let amp = 0;
      if (t.sway && t.sway !== 'bob' && TUNE.fg.sway) {
        const wx = pc.edge === 'N' || pc.edge === 'S' ? pc.along : pc.edge === 'W' ? 1 : ctx.WM - 1, wy = pc.edge === 'N' ? 1 : pc.edge === 'S' ? ctx.HM - 1 : pc.along;
        const W = windAt(wx, wy), gust = W ? W.g || 0 : 0, wv = W ? W.x : 0;
        amp = clamp(wv * .45 + Math.sin(T * (1.1 + gust) + pc.ph) * (.75 + gust * 1.2) + gust * .8 * Math.sign(wv || 1), -1, 1) * t.amp * TUNE.fg.sway;
      }
      if (!amp) { g.drawImage(cv, X, Y); continue; }
      if (t.sway === 'side') {   // column bands, the far end bobbing
        const far = pc.edge === 'E' ? 0 : w, off = c => Math.round(amp * .8 * Math.pow(Math.abs(c - (w - far)) / w, t.exp));
        let c0 = 0, o0 = off(0);
        for (let c = 1; c <= w; c++) { const o = c < w ? off(c) : NaN; if (o !== o0) { g.drawImage(cv, c0, 0, c - c0, h, X + c0, Y + o0, c - c0, h); c0 = c; o0 = o; } }
      } else {
        const off = t.sway === 'hang' ? r => Math.round(amp * Math.pow(r / h, t.exp)) : r => Math.round(amp * Math.pow(1 - r / h, t.exp));
        let r0 = 0, o0 = off(0);
        for (let r = 1; r <= h; r++) { const o = r < h ? off(r) : NaN; if (o !== o0) { g.drawImage(cv, 0, r0, w, r - r0, X + o0, Y + r0, w, r - r0); r0 = r; o0 = o; } }
      }
    }
    g.globalAlpha = 1;
    return n;
  }
  function stepFG(dt) {
    for (const pc of FG.pieces) {
      if (!pc.vis) continue;
      if (pc.k === pc.want) { pc.ft = 0; continue; }
      if ((pc.ft += dt) >= TUNE.fg.fadeStep) { pc.ft = 0; pc.k += pc.want > pc.k ? 1 : -1; }
    }
  }

  // ================================================================ CLOUD SHADOWS
  const CL = {ppmy: 0, ppm: 0, lv: null, TW: 0, TH: 0, key: '', cv: null, x: 0, y: 0};
  function buildCloudLevels() {
    const {PPM, PPMY} = ctx, [TWm, THm] = TUNE.clouds.tileM, TW = Math.round(TWm * PPM), TH = Math.round(THm * PPMY);
    const oct = [[3, 2, .56], [7, 5, .29], [15, 11, .15]].map(([nx, ny, w], k) => ({nx, ny, w, v: Float32Array.from({length: nx * ny}, (_, i) => hsh(i, k, 404))}));
    const val = new Float32Array(TW * TH), H = new Uint32Array(1024);
    const sm = t => t * t * (3 - 2 * t);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      let v = 0;
      for (const o of oct) {
        const fx = x / TW * o.nx, fy = y / TH * o.ny, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
        const x0 = ix % o.nx, x1 = (ix + 1) % o.nx, y0 = (iy % o.ny) * o.nx, y1 = ((iy + 1) % o.ny) * o.nx, V = o.v;
        v += o.w * ((V[y0 + x0] * (1 - tx) + V[y0 + x1] * tx) * (1 - ty) + (V[y1 + x0] * (1 - tx) + V[y1 + x1] * tx) * ty);
      }
      val[y * TW + x] = v; H[Math.min(1023, v * 1024 | 0)]++;
    }
    const q = f => { let n = 0; const want = val.length * (1 - f); for (let i = 0; i < 1024; i++) { n += H[i]; if (n >= want) return (i + 1) / 1024; } return 1; };
    const tE = q(TUNE.clouds.cover), tC = q(TUNE.clouds.core), lv = new Uint8Array(TW * TH);
    for (let i = 0; i < lv.length; i++) lv[i] = val[i] >= tC ? 2 : val[i] >= tE ? 1 : 0;
    Object.assign(CL, {lv, TW, TH, ppm: PPM, ppmy: PPMY, key: ''});
  }
  function cloudTile() {
    if (CL.ppmy !== ctx.PPMY || CL.ppm !== ctx.PPM) buildCloudLevels();
    const M = mood(), tn = timeName(), k = (TUNE.clouds.time[tn] ?? 0) * (TUNE.clouds.none.includes(biome) ? 0 : 1);
    const a = M ? M.shadow.a : 0, s = Math.min(1.2, a / .46) * k;
    if (s <= .01) return null;
    const c = M.shadow.c, key = biome + tn + s.toFixed(3) + c.join();
    if (CL.key === key && CL.cv) return CL.cv;
    CL.key = key;
    const [cv, q] = CL.cv && CL.cv.width === CL.TW && CL.cv.height === CL.TH ? [CL.cv, CL.cv.getContext('2d')] : mk(CL.TW, CL.TH);
    const im = q.createImageData(CL.TW, CL.TH), d = im.data, lv = CL.lv;
    const col = sk => c.map(v => Math.round(255 * (1 - sk * s * (1 - v))));
    const C = [null, col(TUNE.clouds.s[1]), col(TUNE.clouds.s[0])];
    for (let i = 0; i < lv.length; i++) { const L = lv[i]; if (!L) continue; const o = i * 4, cc = C[L]; d[o] = cc[0]; d[o + 1] = cc[1]; d[o + 2] = cc[2]; d[o + 3] = 255; }
    q.putImageData(im, 0, 0);
    return (CL.cv = cv);
  }
  function drawClouds(g, cam) {
    const tile = cloudTile(); if (!tile) return;
    const {VW, VH} = ctx, TW = CL.TW, TH = CL.TH, ox = cam.x - Math.round(CL.x), oy = cam.y - Math.round(CL.y);
    const x0 = -mod(ox, TW), y0 = -mod(oy, TH);
    g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 1;
    for (let y = y0; y < VH; y += TH) for (let x = x0; x < VW; x += TW) {
      const sx = Math.max(0, -x), sy = Math.max(0, -y), w = Math.min(TW - sx, VW - Math.max(0, x)), h = Math.min(TH - sy, VH - Math.max(0, y));
      if (w > 0 && h > 0) g.drawImage(tile, sx, sy, w, h, x + sx, y + sy, w, h);
    }
    g.restore();
  }

  // ================================================================ LIGHT SHAFTS + MOTES
  const SH = {feet: null, key: '', list: [], col: null};
  function shaftFeet() {
    const out = [], r = rng(77), props = host.props || [], P = ctx.PLAY, cx = (P.x0 + P.x1) / 2, cy = (P.y0 + P.y1) / 2;
    const pil = props.filter(p => p.kind === 'pillar' || p.kind === 'pillar_broken');
    for (let i = 0; i < pil.length; i++) for (let j = i + 1; j < pil.length; j++) {   // the pillar grove: between neighbours
      const a = pil[i], b = pil[j], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 1.8 || d > 3.1) continue;
      out.push({x: (a.x + b.x) / 2 + .35, y: (a.y + b.y) / 2 + .45, H: 2.2 + r() * 1, w: 5 + (r() * 7 | 0)});
    }
    out.push({x: P.x0 + 1.1, y: cy + .35, H: 3.2, w: 12}, {x: P.x0 + .9, y: cy - .9, H: 2.8, w: 6});   // the west gate
    out.push({x: cx + .7, y: P.y0 + 1.1, H: 3, w: 11});                                              // the north gate
    const TR = ctx.layout?.trail, trees = props.filter(p => p.kind === 'tree' && TR);   // gaps between trees by the trail
    const near = t => t.x > TR.x0 - 4 && t.x < TR.x1 + 4 && t.y > TR.y0 - 4 && t.y < TR.y1 + 4;
    const cand = trees.filter(near);
    for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
      const a = cand[i], b = cand[j], d = Math.hypot(a.x - b.x, a.y - b.y); if (d < 2.2 || d > 7) continue;
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2 + .6; if (out.some(f => Math.hypot(f.x - x, f.y - y) < 2.5)) continue;
      out.push({x: clamp(x, TR.x0 + .5, TR.x1 - .5), y: clamp(y, TR.y0 + .3, TR.y1 - .3), H: 3 + r() * 1, w: 6 + (r() * 8 | 0)});
    }
    const lone = props.find(p => p.kind === 'tree' && p.z > 0); if (lone) out.push({x: lone.x - 1.6, y: lone.y + 1.4, H: 3.4, w: 9});
    for (const f of out) { f.z = ctx.layout?.elev ? ctx.layout.elev(f.x, f.y) : 0; f.ph = r() * TAU; f.motes = Array.from({length: TUNE.shafts.motes}, () => ({a: r(), c: r() * 2 - 1, va: .01 + r() * .03, ph: r() * TAU, tw: .8 + r() * 1.6})); }
    return out;
  }
  // one shaft: a parallelogram from its source (top, toward the sun) to its foot; 2 levels, the source end and the
  // last stretch before the ground are edge-only (light in air, not a stripe on the floor), a small pool at the foot
  function shaftCanvas(L, w, ux, uy, core, edge, seed) {
    const px = -uy, py = ux, hw = w / 2;
    const cs = [[0, 0], [ux * L, uy * L]].flatMap(([x, y]) => [[x + px * hw * 1.2, y + py * hw * 1.2], [x - px * hw * 1.2, y - py * hw * 1.2]]);
    const prx = hw * 1.4 + 2, pry = Math.max(1.5, prx * .38);
    cs.push([ux * L - prx, uy * L - pry], [ux * L + prx, uy * L + pry]);
    const x0 = Math.floor(Math.min(...cs.map(c => c[0]))) - 1, y0 = Math.floor(Math.min(...cs.map(c => c[1]))) - 1, x1 = Math.ceil(Math.max(...cs.map(c => c[0]))) + 1, y1 = Math.ceil(Math.max(...cs.map(c => c[1]))) + 1;
    const W = x1 - x0, H = y1 - y0, [c, q] = mk(W, H), im = q.createImageData(W, H), d = im.data, ew = Math.max(1, Math.round(w * .22));
    const fx = ux * L - x0, fy = uy * L - y0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const vx = x + .5 + x0, vy = y + .5 + y0, a = vx * ux + vy * uy, cc = vx * px + vy * py, t = a / L;
      let lv = 0;
      const start = .05 + vn(cc / 2, 1, seed) * .1, hwA = hw * (.85 + .3 * t);
      if (t >= start && t <= 1 && Math.abs(cc) <= hwA) lv = t > .24 && t < .84 && Math.abs(cc) <= hwA - ew ? 2 : 1;
      const ex = (x + .5 - fx) / prx, ey = (y + .5 - fy) / pry;
      if (!lv && ex * ex + ey * ey <= 1) lv = 1;
      if (!lv) continue;
      const col = lv === 2 ? core : edge, o = (y * W + x) * 4;
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
    }
    q.putImageData(im, 0, 0);
    return {cv: c, fx: Math.round(fx), fy: Math.round(fy), L, w, ux, uy, x0, y0, hw, ew};
  }
  function ensureShafts() {
    if (!SH.feet) SH.feet = shaftFeet();
    const M = mood(), tn = timeName();
    const key = biome + tn + ctx.PPMY + (M ? M.sun.az + ',' + M.sun.el : '');
    if (key === SH.key) return;
    SH.key = key; SH.col = null;
    const base = SHAFT[biome]?.[tn], k = TUNE.shafts.time[tn] ?? 0;
    if (!base || !M || !k || (tn === 'night' && !TUNE.shafts.night.includes(biome))) { for (const f of SH.feet) f.tpl = null; return; }
    const core = base.map(v => Math.round(v * k)), edge = core.map(v => Math.round(v / 2));
    SH.col = {core, edge, mote: core.map(v => Math.min(255, Math.round(v * 2.4 + 8)))};
    const az = M.sun.az * Math.PI / 180, el = clamp(M.sun.el, TUNE.shafts.el[0], TUNE.shafts.el[1]) * Math.PI / 180, cot = Math.cos(el) / Math.sin(el);
    const {PPM, PPMY, PPMH} = ctx;
    for (const f of SH.feet) {   // toward the sun from the foot, over the source height H
      const dx = Math.sin(az) * cot * f.H * PPM, dy = (-Math.cos(az) * cot * PPMY - PPMH) * f.H, L0 = Math.hypot(dx, dy), L = Math.min(TUNE.shafts.lenMax, L0);
      f.tpl = shaftCanvas(L, f.w, -dx / L0, -dy / L0, core, edge, (f.x * 7 + f.y * 13) | 0);
    }
  }
  function drawShafts(g, cam) {
    if (!TUNE.shafts.on) return;
    ensureShafts(); if (!SH.col) return;
    const {VW, VH} = ctx; let n = 0;
    g.save(); g.globalCompositeOperation = 'lighter';
    const mc = css(SH.col.mote), ec = css(SH.col.edge.map(v => v * 2));
    for (const f of SH.feet) {
      const t = f.tpl; if (!t) continue;
      const [sx, sy] = ctx.toS(f.x, f.y, f.z), X = Math.round(sx - cam.x) - t.fx, Y = Math.round(sy - cam.y) - t.fy;
      f.vis = !(X >= VW || Y >= VH || X + t.cv.width <= 0 || Y + t.cv.height <= 0);
      if (!f.vis || n >= TUNE.shafts.max) { f.vis = false; continue; }
      n++;
      const br = Math.sin(T * .35 + f.ph) + .5 * Math.sin(T * .83 + f.ph * 2);   // slow breathing in 3 steps
      g.globalAlpha = br > .6 ? 1 : br > -.4 ? .85 : .7;
      g.drawImage(t.cv, X, Y);
      // motes: shaft-local (a along, c across), only drawn inside the beam
      g.globalAlpha = 1;
      const ox = X - t.x0 - t.ux * 0, oy = Y - t.y0, px = -t.uy, py = t.ux;
      for (const m of f.motes) {
        const a = m.a * t.L, cc = m.c * (t.hw * (.85 + .3 * m.a) - .5);
        if (m.a < .12 || m.a > .95) continue;
        const inCore = m.a > .24 && m.a < .84 && Math.abs(cc) <= t.hw * (.85 + .3 * m.a) - t.ew;
        const tw = Math.sin(T * m.tw + m.ph);
        if (tw < -.2) continue;   // turned edge-on: not catching the light
        g.fillStyle = inCore && tw > .45 ? mc : ec;
        g.fillRect(Math.round(ox + t.ux * a + px * cc - .5), Math.round(oy + t.uy * a + py * cc - .5), 1, 1);
      }
    }
    g.restore();
    return n;
  }
  function stepMotes(dt) {
    if (!SH.feet) return;
    const W = host.wind, dir = W?.dir || [.94, .34], gust = (W && W.on && W.gust) || 0;
    for (const f of SH.feet) {
      if (!f.vis) continue;
      for (const m of f.motes) {
        m.a += (m.va * (Math.sin(T * .4 + m.ph) * .6 + .5) + gust * .03) * dt;
        m.c += (Math.sin(T * .7 + m.ph * 3) * .07 + dir[0] * gust * .05) * dt;
        if (m.a > 1) m.a -= 1; if (m.a < 0) m.a += 1;
        if (m.c > 1) { m.c = 1; m.ph += 1; } else if (m.c < -1) { m.c = -1; m.ph += 1; }
      }
    }
  }

  // ================================================================ WATER: mask, puddles, reflections
  const WA = {key: '', mask: null, mq: null, spans: null, yEnd: 0, puddles: [], near: [], flames: [], used: false};
  const [RA, ra] = mk(1, 1), [RB, rb] = mk(1, 1), [PS, ps] = mk(1, 1), [EM, em] = mk(1, 1);
  function puddleSprite(rxp, ryp, seed, PC) {
    const W = Math.ceil(rxp * 2) + 4, H = Math.ceil(ryp * 2) + 4, cx = W / 2, cy = H / 2, inside = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = (x + .5 - cx) / rxp, dy = (y + .5 - cy) / ryp; if (dx * dx + dy * dy <= 1 + (vn(x / 3.2, y / 2, seed) - .5) * .55) inside[y * W + x] = 1; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {   // no stray pixels: keep those with >= 2 inside 4-neighbours
      const i = y * W + x; if (!inside[i]) continue;
      const n = (x > 0 && inside[i - 1]) + (x < W - 1 && inside[i + 1]) + (y > 0 && inside[i - W]) + (y < H - 1 && inside[i + W]);
      if (n < 2) inside[i] = 0;
    }
    const [c, q] = mk(W, H), [mc, mq] = mk(W, H), I = (x, y) => x >= 0 && y >= 0 && x < W && y < H && inside[y * W + x];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!I(x, y)) continue;
      const up = !I(x, y - 1), lf = !I(x - 1, y), dn = !I(x, y + 1), rt = !I(x + 1, y);
      let col = PC.in;
      if (up || (lf && y < cy)) col = PC.hi; else if (dn || (rt && y > cy)) col = PC.lo;
      else { mq.fillStyle = '#fff'; mq.fillRect(x, y, 1, 1); }
      q.fillStyle = col; q.fillRect(x, y, 1, 1);
    }
    const gx = Math.round(cx - rxp * .35), gy = Math.round(cy - ryp * .25);   // a short sky glint
    q.fillStyle = PC.glint; q.fillRect(gx, gy, 3, 1); q.fillRect(gx + 5, gy + 1, 1, 1);
    return {cv: c, mask: mc, W, H};
  }
  function buildWater() {
    const key = biome + '|' + ctx.PPM + '|' + ctx.PPMY;
    if (WA.key === key) return;
    WA.key = key; WA.mask = null; WA.puddles = []; WA.near = []; WA.flames = [];
    const S = ctx.layout?.stream; if (!(biome === 'ruins' || biome === 'frost')) return;
    const {PPM, PPMY, WPX, HPX, HM} = ctx;
    const [c, q] = mk(WPX, HPX); WA.mask = c; WA.mq = q; q.fillStyle = '#fff';
    const spans = WA.spans = new Int32Array(HPX * 2).fill(-1);
    WA.yEnd = biome === 'ruins' ? 27.85 : HM;   // the ruins stream falls over the ravine edge (~27.9 m)
    const shrink = biome === 'frost' ? .1 : .02;   // frost: the thin ice shelf along the banks is not water
    if (S) for (let y = 0; y < HPX; y++) {
      const my = (y + .5) / PPMY; if (my > WA.yEnd) continue;
      const cx = S.cx(my), hw = S.w(my) / 2 - shrink, x0 = Math.ceil((cx - hw) * PPM - .5), x1 = Math.floor((cx + hw) * PPM - .5) + 1;
      if (x1 <= x0) continue; spans[y * 2] = x0; spans[y * 2 + 1] = x1; q.fillRect(x0, y, x1 - x0, 1);
    }
    q.globalCompositeOperation = 'destination-out';
    const cut = (cx, cy, rx, ry, below = 0) => { for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + below + 1); y++) { const dy = y + .5 - cy, t = dy > 0 ? Math.max(0, dy - below) : dy, k = 1 - (t / (ry + 1)) ** 2; if (k <= 0) continue; const hw = (rx + 1.5) * Math.sqrt(k); q.fillRect(Math.floor(cx - hw), y, Math.ceil(hw * 2) + 1, 1); } };
    if (S) for (const st of S.stones || []) cut(st.x * PPM, st.y * PPMY, st.r * PPM, st.r / 1.3 * PPMY, biome === 'frost' ? 5 : 4);
    if (S && biome === 'frost') for (let y = .8; y < HM; y += 2.1) {   // the broken floes (same seeds as biomes.js)
      if (Math.abs(y - S.narrows.y) < 2.6 || S.stones.some(t => Math.abs(y - t.y) < 1.3)) continue;
      const k = y * 10 | 0, hw = S.w(y) / 2, fx = S.cx(y) + (hsh(k, 1) - .5) * hw * .9, r0 = (.14 + hsh(k, 2) * .14) * PPM;
      cut(fx * PPM, y * PPMY, r0 * 1.1, r0 * .7, 1);
    }
    q.globalCompositeOperation = 'source-over';
    WA.ptime = '';
    if (biome === 'ruins') for (let i = 0; i < PUDDLES.length; i++) {
      const [x, y, rx, ry] = PUDDLES[i], sp = puddleSprite(rx * PPM, ry * PPMY, 300 + i, PUD_COL.day), X = Math.round(x * PPM - sp.W / 2), Y = Math.round(y * PPMY - sp.H / 2);
      q.drawImage(sp.mask, X, Y); WA.puddles.push({x, y, X, Y, rxp: rx * PPM, ryp: ry * PPMY, seed: 300 + i, ...sp});
    }
    // what can show up in the water: props near the stream / north of a puddle (fetched per frame: sprites change)
    for (const p of host.props || []) {
      if ((p.z || 0) > .05 || /^wall_/.test(p.kind)) continue;
      const nearStream = S && p.y < WA.yEnd + 1 && Math.abs(p.x - S.cx(p.y)) - S.w(p.y) / 2 < TUNE.refl.reach;
      const nearPud = WA.puddles.some(u => Math.abs(p.x - u.x) < 2.6 && p.y > u.y - 3.4 && p.y < u.y + .3);
      if (nearStream || nearPud) WA.near.push(p);
    }
  }
  // is any water in the view rect (view px)? stream spans (every 2nd row) + puddle boxes
  function waterIn(x0, y0, x1, y1, cam) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(ctx.VW, x1); y1 = Math.min(ctx.VH, y1);
    if (x0 >= x1 || y0 >= y1) return false;
    const sp = WA.spans, HPX = ctx.HPX;
    if (sp) for (let y = y0; y < y1; y += 2) { const wy = y + cam.y; if (wy < 0 || wy >= HPX) continue; const a = sp[wy * 2]; if (a >= 0 && a - cam.x < x1 && sp[wy * 2 + 1] - cam.x > x0) return true; }
    for (const u of WA.puddles) if (u.X - cam.x < x1 && u.X + u.W - cam.x > x0 && u.Y - cam.y < y1 && u.Y + u.H - cam.y > y0) return true;
    return false;
  }
  function drawReflections(g, cam) {
    WA.used = false;   // (set again below when a flame is mirrored this frame)
    buildWater(); if (!WA.mask) return;
    const {VW, VH, toS} = ctx;
    if (!waterIn(0, 0, VW, VH, cam)) return;
    // puddles on the floor first (their colours follow the sky: repainted when the time of day changes)
    const tn = timeName();
    if (WA.ptime !== tn) { WA.ptime = tn; for (const u of WA.puddles) u.cv = puddleSprite(u.rxp, u.ryp, u.seed, PUD_COL[tn] || PUD_COL.day).cv; }
    for (const u of WA.puddles) { const X = u.X - cam.x, Y = u.Y - cam.y; if (X < VW && Y < VH && X + u.W > 0 && Y + u.H > 0) g.drawImage(u.cv, X, Y); }
    if (!TUNE.refl.on) return;
    fit(RA, ra, VW, VH); fit(RB, rb, VW, VH);
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    const grow = (x0, y0, x1, y1) => { bx0 = Math.min(bx0, x0); by0 = Math.min(by0, y0); bx1 = Math.max(bx1, x1); by1 = Math.max(by1, y1); };
    ra.setTransform(1, 0, 0, 1, 0, 0); ra.globalCompositeOperation = 'source-over'; ra.globalAlpha = 1; ra.clearRect(0, 0, VW, VH);
    // mirror a sprite about its ground-contact row gy (view px): y -> 2 gy - y (+1: the contact row maps onto itself)
    const mirror = (img, sx, sy, sw, sh, dx, dy, gy) => {
      const top = 2 * gy + 1 - (dy + sh), bot = 2 * gy + 1 - dy;
      if (!waterIn(dx, top, dx + sw, bot, cam)) return false;
      ra.setTransform(1, 0, 0, -1, 0, 2 * gy + 1); ra.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh); ra.setTransform(1, 0, 0, 1, 0, 0);
      grow(dx, top, dx + sw, bot); return true;
    };
    WA.flames.length = 0;
    for (const p of WA.near) {
      const sp = host.spriteOf(p); if (!sp || !sp.img) continue;
      const z = p.z || 0, [gx, gyw] = toS(p.x, p.y, z + (p.h || 0)), sx = Math.round(gx - cam.x), sy = Math.round(gyw - cam.y);
      const gy = Math.round(toS(p.x, p.y, z)[1] - cam.y), dx = sx - sp.pivot[0], dy = sy - sp.pivot[1];
      if (dx > VW || dx + sp.img.width < 0) continue;
      if (mirror(sp.img, 0, 0, sp.img.width, sp.img.height, dx, dy, gy) && sp.emit) WA.flames.push({p, sp, dx, dy, gy});
    }
    // the Ranger: body + cloak albedo, flipped about the ground under him (airborne: 2 x height lower)
    const P = host.P, pl = host.player?.();
    if (P && pl && !(P.sink > 0) && !(P.blink && Math.floor(P.blink * 12) % 2)) {
      const ground = host.elev ? host.elev(P.x, P.y) : 0, gy = Math.round(toS(P.x, P.y, ground)[1] - cam.fy);
      const MX = 16, MY = 12, dx = pl.sx - pl.pivot[0], dy = pl.sy - pl.pivot[1];
      const top = 2 * gy + 1 - (dy + pl.h + MY), bot = 2 * gy + 1 - (dy - MY);
      if (waterIn(dx - MX, top, dx + pl.w + MX, bot, cam)) {
        fit(PS, ps, pl.w + 2 * MX, pl.h + 2 * MY); ps.clearRect(0, 0, PS.width, PS.height);
        host.drawPlayer(ps, MX, MY);
        mirror(PS, 0, 0, PS.width, PS.height, dx - MX, dy - MY, gy);
      }
    }
    if (bx1 > bx0) {
      bx0 = Math.max(0, bx0 - 2); by0 = Math.max(0, by0); bx1 = Math.min(VW, bx1 + 2); by1 = Math.min(VH, by1);
      if (bx1 > bx0 && by1 > by0) {
        const w = bx1 - bx0, h = by1 - by0;
        rb.globalCompositeOperation = 'source-over'; rb.globalAlpha = 1; rb.clearRect(0, 0, VW, VH);
        rippleCopy(RA, rb, bx0, by0, w, h, cam);
        rb.globalCompositeOperation = 'destination-in'; rb.drawImage(WA.mask, cam.x + bx0, cam.y + by0, w, h, bx0, by0, w, h);
        rb.globalCompositeOperation = 'source-atop'; rb.globalAlpha = TUNE.refl.tint; rb.fillStyle = WATER[biome].tint; rb.fillRect(bx0, by0, w, h);
        rb.globalAlpha = 1; rb.globalCompositeOperation = 'source-over';
        g.save(); g.globalAlpha = TUNE.refl.alpha; g.drawImage(RB, bx0, by0, w, h, bx0, by0, w, h); g.restore();
      }
    }
    skyBand(g, cam);
    // flames mirrored into the water / puddles: an emitter layer 1.25 x the view (lighting treats it as ground)
    WA.used = false;
    if (WA.flames.length) {
      const EW = Math.ceil(VW * 1.25);
      fit(EM, em, EW, VH); em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'source-over'; em.globalAlpha = 1; em.clearRect(0, 0, EW, VH);
      for (const f of WA.flames) {
        const W = host.wind, live = W && W.on && W.emitOf ? W.emitOf(f.p, f.sp) : null, img = live || f.sp.emit;
        em.setTransform(1, 0, 0, -1, 0, 2 * f.gy + 1); em.drawImage(img, f.dx, f.dy); em.setTransform(1, 0, 0, 1, 0, 0);
      }
      em.globalCompositeOperation = 'destination-in'; em.drawImage(WA.mask, cam.x, cam.y, VW, VH, 0, 0, VW, VH);
      em.globalCompositeOperation = 'source-atop'; em.globalAlpha = TUNE.refl.glowDim; em.fillStyle = '#000'; em.fillRect(0, 0, EW, VH);
      em.globalAlpha = 1; em.globalCompositeOperation = 'source-over';
      WA.used = true;
    }
  }
  // whole-pixel ripple: rows shifted by round(amp * sin), world-anchored phase, stronger downstream and in gusts
  function rippleCopy(src, dq, x, y, w, h, cam) {
    const W = host.wind, gust = (W && W.on && W.gust) || 0, R = TUNE.refl.ripple, PPMY = ctx.PPMY;
    const off = row => {
      const wy = row + cam.y, my = wy / PPMY, sp = WA.spans, onStream = sp && wy >= 0 && wy < ctx.HPX && sp[wy * 2] >= 0;
      const amp = onStream ? R * (.8 + .5 * clamp((my - 10) / 14, 0, 1) + .6 * gust) : R * (.25 + .8 * gust);
      return Math.round(amp * Math.sin(wy * .55 - T * 2.1) * (.6 + .4 * Math.sin(wy * .13 + T * .7)));
    };
    let r0 = y, o0 = off(y);
    for (let r = y + 1; r <= y + h; r++) {
      const o = r < y + h ? off(r) : NaN;
      if (o !== o0) { dq.drawImage(src, x, r0, w, r - r0, x + o0, r0, w, r - r0); r0 = r; o0 = o; }
    }
  }
  // a faint band of sky glinting across the stream (world-anchored rows, broken into dashes, clipped to the spans)
  function skyBand(g, cam) {
    const sky = WATER[biome]?.sky[timeName()]; if (!sky || !WA.spans) return;
    const {VW, VH, HPX} = ctx, sp = WA.spans, P = 150;
    g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = css(sky);
    const y0 = Math.max(0, cam.y), y1 = Math.min(HPX, cam.y + VH);
    for (let wy = y0; wy < y1; wy++) {
      const k = mod(wy + 40, P); if (k > 2) continue;
      const a = sp[wy * 2], b = sp[wy * 2 + 1]; if (a < 0) continue;
      const w = b - a, s = Math.round(Math.sin(wy * .55 - T * 2.1)), band = Math.floor((wy + 40) / P);
      for (let i = 0; i < 3; i++) {   // three dashes, gaps between
        const u0 = .12 + i * .28 + hsh(band, i, 5) * .06 - k * .02, u1 = u0 + .14 + hsh(band, i, 6) * .08 - (k === 1 ? .04 : k === 2 ? .08 : 0);
        const xa = Math.round(a + w * u0) + s - cam.x, xb = Math.round(a + w * u1) + s - cam.x;
        if (xb > xa && xb > 0 && xa < VW) g.fillRect(xa, wy - cam.y, xb - xa, 1);
      }
    }
    g.restore();
  }

  // ================================================================ HEAT HAZE (ember lava stream)
  const [HZ, hz] = mk(1, 1);
  function drawHaze(g, cam) {
    const S = ctx.layout?.stream; if (!S || !TUNE.haze.on) return 0;
    const {VW, VH, PPM, PPMY} = ctx, rows = [];
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let y = 0; y < VH; y += 2) {
      const my = (y + cam.y + 1) / PPMY; if (my < 0 || my > 27.6) continue;
      const cx = S.cx(my), hw = S.w(my) / 2 + .18, a = Math.max(0, Math.round((cx - hw) * PPM - cam.x)), b = Math.min(VW, Math.round((cx + hw) * PPM - cam.x));
      if (b <= a) continue;
      const wy = y + cam.y, s = Math.round(Math.sin(wy * .21 - T * 2.6) * Math.max(0, Math.sin(wy * .047 + T * .9)) * 1.45);
      if (!s) continue;
      rows.push(y, a, b, s); x0 = Math.min(x0, a); x1 = Math.max(x1, b); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 2);
    }
    if (!rows.length) return 0;
    y1 = Math.min(VH, y1);
    fit(HZ, hz, VW, VH); hz.clearRect(x0, y0, x1 - x0, y1 - y0);
    hz.drawImage(g.canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    g.save(); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    for (let i = 0; i < rows.length; i += 4) { const y = rows[i], a = rows[i + 1], b = rows[i + 2], s = rows[i + 3], h = Math.min(2, VH - y); g.drawImage(HZ, a, y, b - a, h, a + s, y, b - a, h); }
    g.restore();
    return rows.length / 4;
  }

  // ================================================================ contract
  Object.assign(D, {
    toggle() { D.on = !D.on; return D.on; },
    setBiome(id) { if (id !== biome) { biome = id; SH.key = ''; CL.key = ''; } },
    setTime() { SH.key = ''; },
    update(dt) {
      T += dt;
      const W = host.wind, dir = W?.dir || [.94, .34], gust = (W && W.on && W.gust) || 0, v = TUNE.clouds.speed * (1 + .5 * gust);
      if (CL.TW) { CL.x = mod(CL.x + dir[0] * v * dt * ctx.PPM, CL.TW); CL.y = mod(CL.y + dir[1] * v * dt * ctx.PPMY, CL.TH); }
      if (!D.on) return;
      stepFG(dt); stepMotes(dt);
    },
    drawGround(g, cam) {
      if (!D.on) { WA.used = false; return; }
      const t0 = performance.now();
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      try { drawReflections(g, cam); } finally { g.restore(); }
      tick(t0);
    },
    drawClouds(g, cam) {
      if (!D.on || !TUNE.clouds.on) return;
      const t0 = performance.now();
      drawClouds(g, cam);
      tick(t0);
    },
    drawAfterLight(g, cam) {
      if (D.on) {
        const t0 = performance.now();
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
        let ns = 0, nh = 0, nf = 0;
        try {
          ns = drawShafts(g, cam) || 0;
          if (biome === 'ember') nh = drawHaze(g, cam);
          if (TUNE.fg.on) nf = drawFG(g, cam);
        } finally { g.restore(); }
        tick(t0);
        D.debug = `fg ${nf} · shafts ${ns} · haze ${nh} · refl ${WA.used ? 'glow' : ''}`;
      }
      hist[hN++ % hist.length] = acc; acc = 0;
      let s = 0; const n = Math.min(hN, hist.length); for (let i = 0; i < n; i++) s += hist[i]; D.ms = s / n;
    },
    emitters() { return D.on && WA.used ? [{img: EM, x: 0, y: 0}] : []; },
  });
  D._dbg = {FG, SH, WA, CL};   // debug handles (tests)
  return D;
}
