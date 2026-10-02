// BIOMES: how the arena looks. OWNER: biomes agent.
//
// CONTRACT (the host, arena.html, relies on exactly this):
//   export const BIOMES = [biome, ...]      // index 0..3 = keys 1..4: ruins, ember, frost, rift
//   biome = {
//     id, name,
//     paintGround(q, ctx)                   // paint the WHOLE ground canvas (ctx.WPX x ctx.HPX world px), including the
//                                           // surroundings outside PLAY and the floor markings in ctx.layout.marks
//     sprite(prop, ctx) -> {img, pivot: [x, y], emit?, lights?} | null
//        img    canvas, drawn with its pivot at the prop's ground point (toS(x, y))
//        emit   optional canvas, same size: emissive pixels only (drawn additively AFTER lighting, so they glow in the dark)
//        lights optional [{dx, dy, h, color: '#rrggbb', radius: metres, intensity: 0..2, flicker: 0..1}]
//               dx, dy metres on the ground relative to the prop, h metres above ground
//        cache per (kind, variant) inside the biome; called every frame
//   }
//   prop = {kind, x, y, variant, ...}  kinds used by layout.js: wall_n wall_s wall_w wall_e tower gatepost pillar
//     pillar_broken rubble dummy brazier torch bush rock tuft tree rock_big
//   ctx = {PPM, PPMY, PPMH, toS(x, y, h), WM, HM, WPX, HPX, PLAY, layout}   (see arena.html makeCtx)
//
// OPTIONAL EXTRAS (the host may use them; nothing breaks if it doesn't):
//   biome.dust          false = no brown footstep dust (frost)
//   biome.groundEmit    canvas (WPX x HPX) or null, refreshed by paintGround: glowing ground pixels (lava, runes).
//                       Host: emitters.push({img: biome.groundEmit, x: -cam.x, y: -cam.y}) before lighting.apply
//   biome.groundLights  [{x, y, h, color, radius, intensity, flicker}] metres, refreshed by paintGround (lava pools,
//                       rune circle). Host: concat into the frame's lights.
//
// ART RULES: 1 texel = 1 screen px, no AA / dither / gradients. Every material is a 4-tone ramp
// [highlight, base, shade, outline]; light from the top-left; selective outlines (shade tone on lit edges, darkest
// tone on the shadow side). The environment stays calmer than the character: narrow value ranges, big calm areas,
// detail at edges and focal points. Glow = emissive pixels (emit canvas) + lights; no bloom.
import {hash3 as hsh, vnoise as vn} from '../core/mathx.js';
import {mulberry32 as rng} from '../core/rng.js';
import {hexU32 as hex} from '../core/color.js';
import {speciesOf} from './trees3d.js';   // which tree a prop is (the painted cards draw the same species as the 3D ones)

// ============================================================ pixel toolkit
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
const mixHex = (a, b, k) => {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16), c = s => Math.round(((A >> s) & 255) * (1 - k) + ((B >> s) & 255) * k);
  return '#' + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0');
};
const RAMPS = [null];
const ramp = (...h) => { const R = {id: RAMPS.length, c: h.map(hex), h}; RAMPS.push(R); return R; };
const LX = -.55, LY = -.62, LZ = .56;   // light: from the top-left, a bit toward the viewer
const PI2 = Math.PI * 2;

// deterministic hash / value noise (no Math.random anywhere: the same seed always paints the same world)
const fbm = (x, y, s) => vn(x, y, s) * .62 + vn(x * 2.3 + 17, y * 2.3 + 5, s + 1) * .28 + vn(x * 5.1 + 3, y * 5.1 + 9, s + 2) * .1;
// voronoi: nearest two feature points (metres). Results in VO to avoid allocations in per-pixel loops.
const VO = {d1: 0, d2: 0, id: 0, x: 0, y: 0};
function vor(mx, my, cell, seed) {
  const gx = Math.floor(mx / cell), gy = Math.floor(my / cell); let d1 = 1e9, d2 = 1e9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = gx + i, cy = gy + j, px = (cx + .12 + hsh(cx, cy, seed) * .76) * cell, py = (cy + .12 + hsh(cx, cy, seed + 1) * .76) * cell;
    const d = Math.hypot(mx - px, my - py);
    if (d < d1) { d2 = d1; d1 = d; VO.id = cx * 7919 + cy * 131; VO.x = px; VO.y = py; } else if (d < d2) d2 = d;
  }
  VO.d1 = d1; VO.d2 = d2; return VO;
}

// A pixel buffer that remembers which ramp + tone each pixel has (for outlines and tone shifts).
class Pix {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint32Array(w * h); this.m = new Uint8Array(w * h); this.t = new Uint8Array(w * h); this.used = false; }
  i(x, y) { x = Math.floor(x); y = Math.floor(y); return x < 0 || y < 0 || x >= this.w || y >= this.h ? -1 : y * this.w + x; }
  p(x, y, R, t = 1) { const i = this.i(x, y); if (i < 0) return; this.d[i] = R.c[t]; this.m[i] = R.id; this.t[i] = t; this.used = true; }
  c(x, y, col) { const i = this.i(x, y); if (i < 0) return; this.d[i] = col; this.m[i] = 0; this.used = true; }
  on(x, y) { const i = this.i(x, y); return i >= 0 && this.d[i] !== 0; }
  mat(x, y) { const i = this.i(x, y); return i < 0 ? 0 : this.m[i]; }
  tone(x, y) { const i = this.i(x, y); return i < 0 ? -1 : this.t[i]; }
  off(x, y) { const i = this.i(x, y); if (i >= 0) { this.d[i] = 0; this.m[i] = 0; } }
  rect(x, y, w, h, R, t) { for (let j = y; j < y + h; j++) for (let k = x; k < x + w; k++) this.p(k, j, R, t); }
  shift(x, y, dt, max = 3) {
    const i = this.i(x, y); if (i < 0 || !this.m[i]) return;
    const R = RAMPS[this.m[i]], t = Math.max(0, Math.min(max, this.t[i] + dt)); this.d[i] = R.c[t]; this.t[i] = t;
  }
  retone(x, y, R, t) { if (this.on(x, y)) this.p(x, y, R, t); }
  // selective outline: the silhouette gets the darkest tone on the shadow side (bottom/right), the shade tone on the lit side
  outline({sel = true, wrapX = false, wrapTop = false, only = null} = {}) {
    const {w, h, d, m} = this, L = [], [wl, wr] = Array.isArray(wrapX) ? wrapX : [wrapX, wrapX];
    const empty = (x, y) => x < 0 ? !wl : x >= w ? !wr : y < 0 ? !wrapTop : y >= h ? true : !d[y * w + x];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!d[i] || !m[i] || (only && !only.includes(m[i]))) continue;
      if (empty(x, y + 1) || empty(x + 1, y)) L.push(i, 3); else if (empty(x, y - 1) || empty(x - 1, y)) L.push(i, sel ? 2 : 3);
    }
    for (let k = 0; k < L.length; k += 2) { const i = L[k]; this.t[i] = L[k + 1]; d[i] = RAMPS[m[i]].c[L[k + 1]]; }
  }
  // shaded ellipse: tone from a fake sphere normal against the top-left light, low-frequency jitter = clusters
  blob(cx, cy, rx, ry, R, {s = 1, j = .22, edge = 0, bias = 0, hi = .72, lo = .14, top = null} = {}) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry, r2 = dx * dx + dy * dy;
      if (r2 > 1 + (edge ? (vn(x / 2.2, y / 2.2, s) - .5) * edge : 0)) continue;
      if (top !== null && y + .5 < top) continue;
      const nz = Math.sqrt(Math.max(0, 1 - r2)), dot = LX * dx + LY * dy + LZ * nz + bias + (j ? (vn(x / 3, y / 3, s + 9) - .5) * j : 0);
      this.p(x, y, R, dot > hi ? 0 : dot > lo ? 1 : 2);
    }
  }
  poly(pts, fn) {   // scanline fill at pixel centres
    let y0 = 1e9, y1 = -1e9; for (const q of pts) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const yc = y + .5, xs = [];
      for (let i = 0; i < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]; if ((ay <= yc) !== (by <= yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax)); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) fn(x, y);
    }
  }
  disk(cx, cy, r, fn) { for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= r * r + .25) fn(x, y); }
  line(x0, y0, x1, y1, fn) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy, n = 0;
    for (;;) { fn(x0, y0, n++); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  // round-ish forms from runs: horizontal runs give a left-lit cylinder, wide+short runs a top-lit slab
  runShade(Rs, {jit = 0, s = 3, flat = 1.6} = {}) {
    const {w, h, m} = this, ids = new Set(Rs.map(R => R.id)), U = new Float32Array(w * h), HL = new Uint16Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w;) {
      if (!ids.has(m[y * w + x]) || !this.d[y * w + x]) { x++; continue; }
      let b = x; while (b + 1 < w && ids.has(m[y * w + b + 1]) && this.d[y * w + b + 1]) b++;
      for (let k = x; k <= b; k++) { U[y * w + k] = 2 * (k - x + .5) / (b - x + 1) - 1; HL[y * w + k] = b - x + 1; }
      x = b + 1;
    }
    for (let x = 0; x < w; x++) for (let y = 0; y < h;) {
      if (!ids.has(m[y * w + x]) || !this.d[y * w + x]) { y++; continue; }
      let b = y; while (b + 1 < h && ids.has(m[(b + 1) * w + x]) && this.d[(b + 1) * w + x]) b++;
      for (let k = y; k <= b; k++) {
        const i = k * w + x, R = RAMPS[m[i]], len = b - y + 1, j = jit ? (vn(x / 3, k / 3, s) - .5) * jit : 0;
        let t;
        if (HL[i] > len * flat && len >= 2) { const v = 2 * (k - y + .5) / len - 1 + j; t = v < -.35 ? 0 : v > .5 ? 2 : 1; }
        else { const u = U[i] + j; t = HL[i] >= 8 && u < -.8 ? 1 : u < -.15 ? 0 : u < .42 ? 1 : 2; }
        this.d[i] = R.c[t]; this.t[i] = t;
      }
      y = b + 1;
    }
  }
  canvas() { const c = mk(this.w, this.h); c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(this.d.buffer), this.w, this.h), 0, 0); return c; }
}
const glowAt = (P, E, x, y, col, crust) => { E.c(x, y, hex(col)); if (crust) P.c(x, y, hex(crust)); };
const flameCols = c => [mixHex(c, '#ffffff', .6), mixHex(c, '#ffffff', .12), c, mixHex(c, '#000000', .35)];
// a flame: emissive only (no base pixels), teardrop with a hot core
function flame(E, cx, by, w, h, col, lean = 0) {
  const C = flameCols(col).map(hex);
  for (let y = Math.floor(by - h); y < by; y++) {
    const t = (by - y - .5) / h, hw = w / 2 * (t < .32 ? Math.sqrt(t / .32) : Math.pow(Math.max(0, 1 - t) / .68, .9)), x0 = cx + lean * t * t;
    for (let x = Math.round(x0 - hw); x < Math.round(x0 + hw); x++) {
      const u = Math.abs(x + .5 - x0) / Math.max(.5, hw), z = u + t * .9;
      E.c(x, y, C[z < .38 ? 0 : z < .8 ? 1 : z < 1.25 ? 2 : 3]);
    }
  }
}
function build(w, h, pivot, paint) {
  const P = new Pix(w, h), E = new Pix(w, h), extra = paint(P, E) || {};
  return {img: P.canvas(), pivot, emit: E.used ? E.canvas() : undefined, lights: extra.lights};
}
// running-bond joints aligned to WORLD px so consecutive wall segments continue each other's pattern
function joints(k, gx, w, seed, bw) {
  const J = new Set(); let x = -bw[1] - Math.floor(hsh(k, 7, seed) * bw[1]), n = 0, prev = x;
  while (x < gx + w) { if (x >= gx) J.add(x - gx); else prev = x; x += bw[0] + Math.floor(hsh(k, n++, seed) * (bw[1] - bw[0] + 1)); }
  return {J, prev};
}
// stone courses on a front face. Courses count from the ground up; blocks get an id (their world start x)
function masonry(P, x, y, w, h, S, gx, {ch = 9, bw = [15, 24], seed = 1, R = S.wall, RB = S.wallB, onBlock = null} = {}) {
  for (let k = 0; k * ch < h; k++) {
    const {J, prev} = joints(k + seed * 31, gx, w, seed, bw), yb = y + h - k * ch, ya = Math.max(y, yb - ch);
    let bid = prev, bx = prev - gx;
    for (let i = 0; i < w; i++) {
      if (J.has(i)) { bid = gx + i; bx = i; }
      const alt = hsh(bid, k, seed + 5), Rb = alt < .24 ? RB : R;
      for (let r = ya; r < yb; r++) {
        const rr = r - ya, mortar = rr === 0 || J.has(i);
        const bevel = rr === 1 && i - bx > 0 && i - bx < 6 && alt > .55;
        P.p(x + i, r, Rb, mortar ? 2 : bevel ? 0 : 1);
      }
      if (onBlock && J.has(i)) onBlock(bid, k, i, ya, yb);
    }
  }
}

// ============================================================ biome styles
const RED = ramp('#d8573e', '#a8342b', '#72222a', '#3e1420');
const STYLES = {
  ruins: {
    id: 'ruins', name: 'Overgrown Ruins', wallH: 1.2, lowH: .45,
    floor: ramp('#8b8472', '#787161', '#645e51', '#4a453c'), floorB: ramp('#85826f', '#716f5f', '#5d5c4f', '#44433a'),
    earth: ramp('#6f6352', '#5e5244', '#4c4238', '#362e27'), grass: ramp('#687c60', '#53664f', '#425343', '#303d34'),
    inlay: ramp('#b5ac94', '#a0977f', '#817a66', '#5a5444'), pad: ramp('#948d7c', '#857e6d', '#6c665a', '#4e4a41'),
    wall: ramp('#928e82', '#7a776e', '#625f59', '#42403c'), wallB: ramp('#8a897c', '#707066', '#5a5b52', '#3d3e38'),
    wood: ramp('#8c6c4a', '#70543a', '#543e2b', '#35271c'), metal: ramp('#a08650', '#7a6438', '#56452a', '#352a1c'),
    straw: ramp('#cdb577', '#ad935a', '#877043', '#594a2b'), cloth: ramp('#bca985', '#9e8d6b', '#7d6f53', '#514836'),
    leaf: ramp('#6f8c68', '#577154', '#435a45', '#2e3f33'), bark: ramp('#75654f', '#5d4f40', '#473c32', '#2d2621'),
    // the other trees (trees3d.js, world.js FAMS birch / aspen / berry): the birch's white bark, the aspen's grey-green bark, the rowan's berries
    birch: ramp('#f3f0e7', '#d6d4ca', '#abaaa1', '#5e5c58'), aspen: ramp('#a9b19b', '#838e78', '#646f5d', '#3b453b'), berry: ramp('#ffb066', '#fc5a24', '#cc3a1e', '#701a14'),
    // the berries through the year (MESH_FS steps the rowan's berry family: scarlet when ripe, then these): orange as they ripen, a fresh yellow-green while unripe, the spring's creamy flowers
    berryOrange: ramp('#ffd884', '#f9a83e', '#c8742a', '#6e3c1c'), berryGreen: ramp('#a3ba7c', '#83a064', '#637f50', '#344a2f'), berryCream: ramp('#fffbe9', '#efe5c4', '#c8b98e', '#74694c'),
    clay: ramp('#c8845a', '#a8643e', '#7e472c', '#4e2a1c'), gem: ramp('#e4ffc8', '#9ad878', '#58a060', '#2a5a3c'), gemGlow: ['#eaffd8', '#8aff6a'], gemInner: '#1e4a20',
    brute: ramp('#bca985', '#9e8d6b', '#7d6f53', '#514836'),
    rock: ramp('#7e786b', '#666056', '#504b44', '#35322d'), water: ramp('#9cc2c4', '#6e9ca4', '#4f7c8a', '#33556a'),
    torch: '#ffc850', braz: ['#ffb04a', '#7fc8ff', '#a8ff6a'],
    // the green banks (damp ground, clover, moss, reeds, cattail heads, ferns): clearly green, so the season turns them
    damp: ramp('#587c5a', '#46664c', '#355040', '#243a30'), lush: ramp('#9bc464', '#76a04c', '#57803f', '#355432'), moss: ramp('#8fbb5e', '#6c9a49', '#4f7a3e', '#33502f'),
    reed: ramp('#b3cc6a', '#86a64e', '#5f8441', '#355133'), cattail: ramp('#a5753f', '#80522c', '#5a3822', '#34211a'), fern: ramp('#8fc16a', '#69a050', '#4a7e3f', '#2f5233'),
    // THE PLANTS' AUTUMN (world.js plantOf hands a card its path; gfx.js CARD_FS turns it patch by patch, by render/gfx.js U.autumn).
    // `ramp` is the painted green the card is made of (its pixels are recognised by it). A path = four stages, the first colour ..
    // the dying one, each [light, base, shade, dark] like the ramp it replaces (stage 0 is the painted green itself, so summer is
    // untouched). `w` how many plants take it, `delay` when its first patch starts (0 .. 1 of autumn: higher = stays green later),
    // `alt` the path a fifth of its patches follow instead (a spray of another colour). The red shrubs (barberry, burning bush) go
    // first and furthest; the green straggler hardly starts before the others are done; tufts and reeds dry to straw and tan,
    // ferns to rust. The photos: yellow-green sprays, orange and scarlet ones, brown at the end
    plantAutumn: {
      bush: {ramp: 'leaf', paths: [
        {name: 'crimson', w: .22, delay: [0, .1], alt: 1, stages: [
          ['#e9a84c', '#d27c38', '#a1572f', '#5f3224'], ['#ea6a3c', '#cc4630', '#92302b', '#541c22'],
          ['#d84e4a', '#ac2f3a', '#76222f', '#43151f'], ['#8c4a3e', '#68342e', '#48262a', '#2d171b']]},
        {name: 'orange', w: .22, delay: [.03, .15], alt: 0, stages: [
          ['#eec650', '#dba43a', '#aa7830', '#694b26'], ['#eea646', '#d87e34', '#a35628', '#5f3320'],
          ['#d98c42', '#ba6330', '#85432a', '#4d2920'], ['#9b6b3d', '#754d2e', '#53371f', '#33221a']]},
        {name: 'yellow', w: .4, delay: [.07, .2], alt: 1, stages: [
          ['#c6ca5a', '#a6ae48', '#7e8a38', '#4b5b30'], ['#ecd65a', '#d6ba46', '#a28c34', '#5f5130'],
          ['#e2b24c', '#c29038', '#906b2e', '#534022'], ['#b2925b', '#8c714a', '#675139', '#3e3125']]},
        {name: 'late', w: .16, delay: [.3, .34], alt: 2, stages: [
          ['#8ca561', '#6f8b4d', '#576f43', '#3b5135'], ['#b2ba59', '#8f9b46', '#6b7b3a', '#445530'],
          ['#d2b24f', '#b28d3c', '#826b30', '#4f4122'], ['#9c7c4b', '#795f3d', '#57452f', '#362b21']]},
      ]},
      tuft: {ramp: 'grass', paths: [
        {name: 'straw', w: .4, delay: [0, .22], alt: 1, stages: [
          ['#9fae62', '#85974e', '#677c40', '#46583a'], ['#c6bd6a', '#a8a354', '#82823f', '#545a33'],
          ['#d6c283', '#b8a066', '#8f7a4c', '#5e4f31'], ['#cfbf98', '#b0a07a', '#8a7c5c', '#5a5040']]},
        {name: 'tan', w: .35, delay: [.05, .3], alt: 0, stages: [
          ['#a6ad6c', '#8a9456', '#6c7a46', '#48563c'], ['#bcb072', '#9f9460', '#7c744b', '#524b36'],
          ['#c8b488', '#a99870', '#857650', '#585038'], ['#b8aa8c', '#988c70', '#756c56', '#4e483a']]},
        {name: 'bleached', w: .25, delay: [.12, .38], alt: 1, stages: [
          ['#a8b074', '#8c9660', '#6e7a50', '#4c573f'], ['#b8b484', '#9c9870', '#7a7658', '#524f3c'],
          ['#c0b698', '#a39a80', '#80775f', '#555040'], ['#aca898', '#8e8a7c', '#6c6a5e', '#47463e']]},
      ]},
      fern: {ramp: 'fern', paths: [
        {name: 'rust', w: .55, delay: [.05, .25], alt: 1, stages: [
          ['#b8c05e', '#98a64a', '#788a3e', '#4a5a34'], ['#dba84a', '#bd8a38', '#926a2e', '#5a4224'],
          ['#cf7e3c', '#ae5e2e', '#82442a', '#4e2a20'], ['#9a6a42', '#78503a', '#573a2e', '#38251f']]},
        {name: 'ochre', w: .45, delay: [.12, .32], alt: 0, stages: [
          ['#c4c264', '#a4a850', '#808c42', '#4e5c36'], ['#e0b852', '#c29a40', '#977434', '#5c4826'],
          ['#d29a48', '#b27a38', '#865a2e', '#533826'], ['#a07e4e', '#7e6040', '#5c4632', '#3a2c22']]},
      ]},
      reed: {ramp: 'reed', paths: [
        {name: 'straw', w: .55, delay: [.02, .24], alt: 1, stages: [
          ['#c4cc6a', '#a2ae54', '#7e8c42', '#4c5a36'], ['#d6ca72', '#b8aa5c', '#8f8446', '#585234'],
          ['#d8c47c', '#bba463', '#907c4a', '#5c4e32'], ['#cebe94', '#ae9e76', '#88795a', '#584e3c']]},
        {name: 'tan', w: .45, delay: [.1, .32], alt: 0, stages: [
          ['#b8c470', '#98a85a', '#788a48', '#4c5c3a'], ['#cdc480', '#aca368', '#867f4c', '#565038'],
          ['#cdb98a', '#ad9c74', '#88785a', '#5a4e3a'], ['#bcae92', '#9c9078', '#7a705c', '#524a3e']]},
      ]},
    },
  },
  ember: {
    id: 'ember', name: 'Ember Wastes', wallH: 1.2, lowH: .45,
    floor: ramp('#72675f', '#635953', '#534a46', '#3b3432'), floorB: ramp('#5e5450', '#4f4643', '#413a38', '#2e2827'),
    wall: ramp('#604c4c', '#483839', '#362a2c', '#221a1c'), wallB: ramp('#584a4e', '#423539', '#31272b', '#1e1719'),
    ash: ramp('#8c827b', '#79716b', '#655e59', '#4a4441'), lava: ramp('#ffe08a', '#ffa040', '#e0541e', '#6e1c12'),
    inlay: ramp('#6c6272', '#4a4252', '#36303c', '#221e27'), pad: ramp('#6f6660', '#645b56', '#554d49', '#3d3735'),
    wood: ramp('#5a4a40', '#43362f', '#30261f', '#1c1512'), metal: ramp('#6c666a', '#4d484d', '#363237', '#211e22'),
    rock: ramp('#5f4b4b', '#483839', '#362a2c', '#221a1c'), crust: '#2a1512',
    clay: ramp('#6a6078', '#463e52', '#2e2838', '#18141e'), gem: ramp('#ffe0a8', '#ffa050', '#d0502a', '#5e1c14'), gemGlow: ['#fff0c0', '#ff8a3a'], gemInner: '#5a1a0c',
    brute: ramp('#7a5a48', '#5c4234', '#422e24', '#261a14'),
    torch: '#ff9a40', braz: ['#ffb04a', '#7fc8ff', '#ff5a3a'],
  },
  frost: {
    id: 'frost', name: 'Frost Hollow', wallH: 1.2, lowH: .45, dust: false,
    floor: ramp('#8595ad', '#708199', '#5d6d87', '#445069'), floorB: ramp('#7d8fa9', '#697c96', '#576984', '#404d67'),
    snow: ramp('#e2e9f2', '#c8d3e2', '#a9b8ce', '#8191ae'), ice: ramp('#cdeeff', '#9dd2ef', '#70a8d4', '#44709c'),
    wall: ramp('#7586a1', '#5d6e8b', '#4b5975', '#323d55'), wallB: ramp('#6f82a1', '#576a87', '#455673', '#2e3a53'),
    inlay: ramp('#b6d6ea', '#8fb8d6', '#6d94b8', '#4a6a90'), lake: ramp('#b9d3e6', '#98b8d2', '#7c9cbc', '#56769a'), pad: ramp('#8e9db3', '#8292aa', '#6c7c96', '#4d5a74'),
    pine: ramp('#4f756b', '#3a5a52', '#2a4540', '#1a2d2b'), bark: ramp('#6c5c53', '#544640', '#3f3532', '#282120'),
    wood: ramp('#8a7c6e', '#6d6055', '#534841', '#362f2b'), metal: ramp('#9ea8b8', '#768093', '#586275', '#39404f'),
    straw: ramp('#c9bd94', '#a99c74', '#857a58', '#58503a'), cloth: ramp('#b8b2a0', '#9a9482', '#7a7566', '#504c43'),
    rock: ramp('#717e90', '#5a6679', '#475264', '#2f3747'), melt: ramp('#7a9ebb', '#50789a', '#34587a', '#1e3654'),
    clay: ramp('#cfdcea', '#a0b6d0', '#7690b0', '#4a5e80'), gem: ramp('#e8fbff', '#9fe0f5', '#5aa8d8', '#2c5c8c'), gemGlow: ['#f0ffff', '#86d9ff'], gemInner: '#1a4a78',
    brute: ramp('#dfe6ee', '#bcc8d6', '#8e9fb6', '#5a6a86'),
    torch: '#86d9ff', braz: ['#ffb04a', '#86d9ff', '#9affd8'],
    cattail: ramp('#9a7a52', '#76583a', '#523b28', '#2f2118'),
  },
  rift: {
    id: 'rift', name: 'The Rift', wallH: 1.2, lowH: .45,
    floor: ramp('#4a3d6a', '#3a2f56', '#2d2445', '#1e1830'), floorB: ramp('#443a68', '#352c52', '#292242', '#1b152d'),
    wall: ramp('#56467c', '#403460', '#30274c', '#1d1731'), wallB: ramp('#4e4476', '#3a315a', '#2c2548', '#1b152e'),
    crystal: ramp('#ffc6f2', '#ea7ee4', '#ad48bd', '#5c2474'), metal: ramp('#6c5c8c', '#4f4372', '#3b3158', '#251e39'),
    inlay: ramp('#6c5c94', '#56487c', '#42375f', '#2b2341'), pad: ramp('#4e4270', '#463b66', '#3a305a', '#282042'),
    rock: ramp('#4f4270', '#3c3158', '#2d2545', '#1c1730'), wood: ramp('#6a5680', '#4e3e66', '#392d4e', '#221a31'),
    clay: ramp('#7a64a8', '#5a4886', '#433466', '#2a2044'), gem: ramp('#ffc6f2', '#ea7ee4', '#ad48bd', '#5c2474'), gemGlow: ['#ffe0fa', '#ff8ae8'], gemInner: '#5a2468',
    brute: ramp('#5e5082', '#463a68', '#342a52', '#201a35'),
    rune: '#ff8ae8', runeDim: '#8a4ad8', torch: '#d68cff', braz: ['#ffb04a', '#7fc8ff', '#e070ff'],
  },
};

// ============================================================ ground
function kit(q, ctx) {
  const {PPM, PPMY, WPX, HPX, PLAY} = ctx, cx = (PLAY.x0 + PLAY.x1) / 2, cy = (PLAY.y0 + PLAY.y1) / 2;
  const K = {...ctx, G: new Pix(WPX, HPX), E: new Pix(WPX, HPX), lights: [], cx, cy,
    X: m => Math.round(m * PPM), Y: m => Math.round(m * PPMY),
    inside: (mx, my, pad = 0) => mx > PLAY.x0 - pad && mx < PLAY.x1 + pad && my > PLAY.y0 - pad && my < PLAY.y1 + pad,
    edgeD: (mx, my) => Math.min(mx - PLAY.x0, PLAY.x1 - mx, my - PLAY.y0, PLAY.y1 - my),
    // distance (m) from the roads that lead out of the four gates
    pathD(mx, my) {
      let d = 1e9;
      if (my < PLAY.y0) d = Math.min(d, Math.abs(mx - cx - Math.sin(my * .7) * .5));
      if (my > PLAY.y1) d = Math.min(d, Math.abs(mx - cx - Math.sin(my * .8 + 1) * .5));
      if (mx < PLAY.x0) d = Math.min(d, Math.abs(my - cy - Math.sin(mx * .6) * .4));
      return d;   // (east: the trail's path marks replace the road)
    },
    // the marks area: keep lava / snow / decals away from them
    nearMark(mx, my, pad = .6) {
      for (const m of ctx.layout.marks) {
        if (m.r !== undefined && Math.abs(Math.hypot(mx - m.x, my - m.y) - (m.type === 'pad' ? 0 : m.r)) < (m.type === 'pad' ? m.r + pad : pad)) return true;
        if (m.type === 'mark' && Math.hypot(mx - m.x, my - m.y) < .6 + pad) return true;
        if ((m.type === 'lane' || m.type === 'rail') && mx > m.x0 - pad && mx < m.x1 + pad && Math.abs(my - m.y) < pad) return true;
      }
      return false;
    },
  };
  // the trail east of the arena (playable, kept calm), the stream and the plateau (from layout)
  const L = ctx.layout; K.trail = L.trail; K.stream = L.stream; K.plats = L.plateaus || [];
  K.inTrail = (mx, my, pad = 0) => !!K.trail && mx > K.trail.x0 - pad && mx < K.trail.x1 + pad && my > K.trail.y0 - pad && my < K.trail.y1 + pad;
  K.calm = (mx, my, pad = 0) => K.inside(mx, my, pad) || K.inTrail(mx, my, pad);
  // keep a south-edge feature (cliff, lake) below the trail: pushed to >= trail.y1 + .45 along the trail's x range
  K.clampEdge = (mx, y) => { if (!K.trail) return y; const d = Math.max(K.trail.x0 - 1.5 - mx, mx - K.trail.x1 - 1.5, 0), k = Math.max(0, 1 - d / 2.5); return y + (Math.max(y, K.trail.y1 + .45) - y) * k; };
  K.streamE = (mx, my) => K.stream ? Math.abs(mx - K.stream.cx(my)) - K.stream.w(my) / 2 : 9;   // < 0 in the water
  K.fill = fn => { for (let y = 0; y < HPX; y++) { const my = y / PPMY; for (let x = 0; x < WPX; x++) fn(x, y, x / PPM, my); } };
  // a height field (one value per px) and its slope toward the light: > 0 faces north-west (lit), < 0 faces the camera
  K.field = fn => { const F = new Float32Array(WPX * HPX); K.fill((x, y, mx, my) => { F[y * WPX + x] = fn(mx, my); }); return F; };
  K.slope = (F, x, y) => {
    const ry = Math.max(1, Math.round(.3 * PPMY)), rx = Math.round(.3 * PPM), yn = Math.max(0, y - ry), ys = Math.min(HPX - 1, y + ry), xw = Math.max(0, x - rx), xe = Math.min(WPX - 1, x + rx);
    return (F[ys * WPX + x] - F[yn * WPX + x]) + (F[y * WPX + xe] - F[y * WPX + xw]) * .5;
  };
  K.finish = biome => {
    q.putImageData(new ImageData(new Uint8ClampedArray(K.G.d.buffer), WPX, HPX), 0, 0);
    biome.groundEmit = K.E.used ? K.E.canvas() : null; biome.groundLights = K.lights;
  };
  return K;
}
// rows of flagstones (metres); each stone {x0, y0, x1, y1, v (0..1 random), r (row), k (index)}
function flagstones(x0, y0, x1, y1, seed, rowH, colW) {
  const out = []; let y = y0, r = 0;
  while (y < y1) {
    const h = rowH[0] + hsh(r, 0, seed) * (rowH[1] - rowH[0]); let x = x0 - hsh(r, 1, seed) * colW[1], k = 0;
    while (x < x1) { const w = colW[0] + hsh(r, k + 2, seed) * (colW[1] - colW[0]); out.push({x0: x, y0: y, x1: x + w, y1: y + h, v: hsh(r, k + 99, seed), r, k}); x += w; k++; }
    y += h; r++;
  }
  return out;
}
// paint one flagstone. pick(x, y, joint, edgeTone) may repaint a pixel (moss, snow) and return true
function stone(K, s, R, base, pick) {
  const {G, X, Y} = K, xa = X(s.x0), xb = X(s.x1), ya = Y(s.y0), yb = Y(s.y1);
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
    const corner = (x === xa || x === xb - 2) && (y === ya || y === yb - 2), joint = x === xb - 1 || y === yb - 1 || corner;
    if (pick && pick(x, y, joint)) continue;
    G.p(x, y, R, joint ? 2 : base);
  }
  return [xa, ya, xb, yb];
}
function crack(K, x, y, len, R, t, seed) {
  const r = rng(seed); let dx = r() < .5 ? 1 : -1;
  for (let i = 0; i < len; i++) { K.G.p(x, y, R, t); if (r() < .6) x += dx; else y += 1; if (r() < .2) dx = -dx; }
}
// darken the ground along the foot of the walls (contact shadow), inside the play area
function wallAO(K) {
  const {G, X, Y, PLAY} = K, x0 = X(PLAY.x0), x1 = X(PLAY.x1), y0 = Y(PLAY.y0), y1 = Y(PLAY.y1);
  for (let x = x0; x < x1; x++) { G.shift(x, y0, 1); G.shift(x, y0 + 1, 1); G.shift(x, y0 + 2, hsh(x, 3) < .5 ? 1 : 0); G.shift(x, y1 - 1, 1); G.shift(x, Y(PLAY.y1 + .5), 1); }
  for (let y = y0; y < y1; y++) { G.shift(x0, y, 1); G.shift(x0 + 1, y, 1); G.shift(x1 - 1, y, 1); }
}

// ---- floor markings: part of the world, but readable for range testing ----
function marks(K, S, style) {
  const {G, E, X, Y, PPM, PPMY} = K;
  for (const m of K.layout.marks) {
    if (m.type === 'ring' || m.type === 'pad') {
      const r = m.r, bx0 = X(m.x - r - .5), bx1 = X(m.x + r + .5), by0 = Y(m.y - r - .5), by1 = Y(m.y + r + .5);
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        const dx = (x + .5) / PPM - m.x, dy = (y + .5) / PPMY - m.y, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        if (m.type === 'ring') style.ring(x, y, d - r, a, d);
        else style.pad(x, y, d, r, a);
      }
    } else if (m.type === 'lane') {
      const y = Y(m.y);
      for (let x = X(m.x0); x <= X(m.x1); x++) style.groove(x, y, x - X(m.x0));
      for (const d of m.ticks) style.tick(X(m.x0 + d), y, d / 4 | 0);
      style.tick(X(m.x1), y, 0, true);
    } else if (m.type === 'mark') style.mark(X(m.x), Y(m.y));
    else if (m.type === 'rail') style.rail(X(m.x0), X(m.x1), Y(m.y));
    else if (m.type === 'path' && style.path) paintPath(K, m, style.path);
  }
}
// a worn trail along a polyline: fn(x, y, d, hw, mx, my) for every pixel closer than the (ragged) half width
function paintPath(K, m, fn) {
  const {PPM, PPMY} = K, pts = m.pts, pad = m.w / 2 + .4;
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  for (let y = Math.floor((Math.min(...ys) - pad) * PPMY); y <= (Math.max(...ys) + pad) * PPMY; y++)
    for (let x = Math.floor((Math.min(...xs) - pad) * PPM); x <= (Math.max(...xs) + pad) * PPM; x++) {
      const mx = (x + .5) / PPM, my = (y + .5) / PPMY; let d = 1e9;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1], vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((mx - ax) * vx + (my - ay) * vy) / (vx * vx + vy * vy)));
        d = Math.min(d, Math.hypot(mx - ax - vx * t, my - ay - vy * t));
      }
      const hw = m.w / 2 + (vn(mx * 1.4, my * 1.4, 88) - .5) * .4;
      if (d < hw) fn(x, y, d, hw, mx, my);
    }
}
// the default inlay style: pale cut stone set into the floor, bordered by a dark carved groove
function inlayStyle(K, S, o = {}) {
  const {G} = K, IN = o.inlay || S.inlay, GR = o.groove || S.floor, gt = o.grooveTone ?? 3, seg = o.seg ?? 34;
  const joint = (a, n) => ((a / PI2 * n) % 1 + 1) % 1 < .05;
  const st = {
    ring(x, y, dd, a) {
      const ad = Math.abs(dd);
      if (ad < .085) G.p(x, y, IN, joint(a, seg) ? 2 : (dd < -.02 && Math.sin(a) < .2) ? 1 : (dd > .02 && Math.sin(a) > .5) ? 2 : 1);
      else if (ad < .14) G.p(x, y, GR, gt);
    },
    pad(x, y, d, r, a) {
      const dd = d - r;
      if (Math.abs(dd) < .09) G.p(x, y, IN, joint(a, 24) ? 2 : 1);
      else if (Math.abs(dd) < .15) G.p(x, y, GR, gt);
      else if (d < r - .15) {
        const inner = d < r * .45, j = inner ? Math.abs(d - r * .45) < .05 || (d > .3 && joint(a + .2, 4)) : Math.abs(d - r * .45) < .05 || joint(a, 8);
        const PD = o.pad || S.pad;
        G.p(x, y, PD, d < .26 ? (d < .2 ? 0 : 2) : j ? 2 : 1);
      }
    },
    groove(x, y, i) { G.p(x, y - 1, GR, gt); G.p(x, y, GR, 2); G.p(x, y + 1, IN, 1); },
    tick(x, y, n, end) {
      const hw = end ? 3 : 5, hh = end ? 3 : 4;
      for (let j = -hh - 1; j <= hh + 1; j++) for (let i = -hw - 1; i <= hw + 1; i++) {
        const edge = Math.abs(i) === hw + 1 || Math.abs(j) === hh + 1;
        if (edge) { if (!(Math.abs(i) === hw + 1 && Math.abs(j) === hh + 1)) G.p(x + i, y + j, GR, gt); }
        else G.p(x + i, y + j, IN, j === -hh ? 0 : j === hh ? 2 : 1);
      }
      for (let k = 0; k < n; k++) { const nx = x - (n - 1) + k * 2; for (let j = -hh + 1; j <= hh - 1; j++) G.p(nx, y + j, GR, gt); }
    },
    mark(x, y) {
      for (let j = -6; j <= 6; j++) for (let i = -8; i <= 8; i++) {
        const edge = Math.abs(i) === 8 || Math.abs(j) === 6;
        if (edge) { if (!(Math.abs(i) === 8 && Math.abs(j) === 6)) G.p(x + i, y + j, GR, gt); continue; }
        const cross = (i === 0 && Math.abs(j) < 5) || (j === 0 && Math.abs(i) < 6);
        G.p(x + i, y + j, IN, cross ? 3 : j === -5 ? 0 : j === 5 ? 2 : 1);
      }
    },
    rail(xa, xb, y) {
      const WD = o.sleeper || S.wood || IN;
      for (let x = xa - 4; x <= xb + 4; x += 15) for (let j = -3; j <= 4; j++) for (let i = 0; i < 4; i++) G.p(x + i, y + j, WD, j === -3 ? 0 : j === 4 || i === 3 ? 2 : 1);
      for (let x = xa - 6; x <= xb + 6; x++) { G.p(x, y - 1, GR, gt); G.p(x, y, GR, 3); G.p(x, y + 1, IN, 0); }
      for (const x of [xa - 8, xb + 8]) for (let j = -3; j <= 2; j++) for (let i = -2; i <= 2; i++) G.p(x + i, y + j, IN, j === -3 ? 0 : Math.abs(i) === 2 || j === 2 ? 2 : 1);
    },
  };
  return Object.assign(st, o.over || {});
}

// ---------------------------------------------------------------- trail features: stream, stepping stones, plateau
// copy a small Pix onto the ground (ramp + tone kept, so later shifts/outlines still work)
function stamp(G, P, ox, oy) {
  for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
    const i = y * P.w + x; if (!P.d[i]) continue; const j = G.i(ox + x, oy + y); if (j < 0) continue;
    G.d[j] = P.d[i]; G.m[j] = P.m[i]; G.t[j] = P.t[i]; G.used = true;
  }
}
// the stream: st.px(x, y, e, side, mx, my, c, hw) for every pixel within 0.45 m of the banks (e < 0 = water, metres
// from the bank; side -1 west / +1 east); rows below stop(mx) (a cliff edge) are left to the edge painter
function paintStream(K, st) {
  const SM = K.stream; if (!SM) return;
  const {PPM, PPMY, HPX} = K;
  for (let y = 0; y < HPX; y++) {
    const my = (y + .5) / PPMY, c = SM.cx(my), hw = SM.w(my) / 2;
    if (st.stop && my > st.stop(c)) continue;
    for (let x = Math.floor((c - hw - .45) * PPM); x <= Math.ceil((c + hw + .45) * PPM); x++) {
      const mx = (x + .5) / PPM, e = Math.abs(mx - c) - hw + (vn(x / 4, y / 3, 71) - .5) * .05;
      if (e < .45) st.px(x, y, e, mx < c ? -1 : 1, mx, my, c, hw);
    }
  }
  for (const s of SM.stones) st.stone(s);
}
// a flat rock slab seen from the front: lit top ellipse, a short front face, outline; ring = its waterline
function slab(K, s, R, {fh = 3, ring = null, top = null, rim = null} = {}) {
  const rx = s.r * K.PPM, ry = s.r / 1.3 * K.PPMY, w = Math.ceil(rx * 2) + 6, h = Math.ceil(ry * 2) + fh + 6, P = new Pix(w, h), E2 = new Pix(w, h);
  const cx = w / 2, cy = ry + 3, inE = (x, y, a, b) => ((x + .5 - cx) / a) ** 2 + ((y + .5 - cy) / b) ** 2 <= 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (ring && inE(x, y - fh + 1, rx + 2, ry + 1.5) && !inE(x, y - fh, rx, ry) && y > cy) ring(P, E2, x, y);
    let face = false; for (let k = 1; k <= fh; k++) if (inE(x, y - k, rx, ry)) face = true;
    if (inE(x, y, rx, ry)) { const u = (x + .5 - cx) / rx + (y + .5 - cy) / ry; P.p(x, y, R, u < -.5 ? 0 : 1); if (top) top(P, E2, x, y, u); }
    else if (face) P.p(x, y, R, 2);
  }
  P.outline({only: [R.id]});
  if (rim) rim(P, E2, cx, cy, rx, ry);
  const ox = Math.round(s.x * K.PPM - cx), oy = Math.round(s.y * K.PPMY - cy);
  stamp(K.G, P, ox, oy); stamp(K.E, E2, ox, oy);
}
// the plateau: its top surface lifted by h (hides the ground behind it), the south cliff face, the climb spot
function paintPlateau(K, st) {
  const {G, X, Y, PPM, PPMY, PPMH} = K;
  for (const q of K.plats) {
    const hp = Math.round(q.h * PPMH), xa = X(q.x0), xb = X(q.x1), yt = Y(q.y0) - hp, yf = Y(q.y1) - hp, yb = Y(q.y1);
    const climbX = x => q.climbs.some(c => x >= X(c.x - c.w / 2) - 2 && x < X(c.x + c.w / 2) + 2);
    for (let y = Math.max(0, yt); y < yf; y++) for (let x = xa; x < xb; x++) st.top(x, y, (x + .5) / PPM, (y + hp + .5) / PPMY, yf - 1 - y, climbX(x));
    for (let x = xa; x < xb; x++) for (let r = 0; r < hp; r++) st.face(x, yf + r, r, hp, (x + .5) / PPM);
    for (const c of q.climbs) {
      const ca = X(c.x - c.w / 2), cb = X(c.x + c.w / 2);
      for (let x = ca; x < cb; x++) for (let r = 0; r < hp; r++) st.climb(x, yf + r, r, hp, x - ca, cb - ca);
    }
    // outlines: the far edge, both ends, the foot; a contact shadow on the ground below
    for (let x = xa; x < xb; x++) { if (yt >= 0) G.shift(x, yt, 3); G.shift(x, yb - 1, 3); G.shift(x, yb, 1); G.shift(x, yb + 1, 1); if (hsh(x, 5) < .5) G.shift(x, yb + 2, 1); }
    for (let y = Math.max(0, yt); y < yb; y++) { G.shift(xa, y, 3); G.shift(xb - 1, y, 3); if (y >= yf) G.shift(xa + 1, y, -1); }
    if (st.after) st.after(q, hp, xa, xb, yt, yf, yb);
  }
}
// the plateau is in front of anything standing just north of it: those props would seem to stand on its top
const behindPlateau = (ctx, x, y) => (ctx.layout.plateaus || []).some(q => x > q.x0 - .3 && x < q.x1 + .3 && y < q.y0 && y * ctx.PPMY > q.y0 * ctx.PPMY - q.h * ctx.PPMH - 4);

// horizontal rock strata (tone for column x, row r of a face fh tall): lit layer lips, shaded undersides, a few cracks
function strata(x, r, fh, s = 0) {
  const ly = r + Math.round((vn(x / 14, s, 94) - .5) * 5), layer = Math.floor(ly / 9), inL = ((ly % 9) + 9) % 9;
  const crackX = hsh(Math.floor(x / 11), layer, 96 + s) < .35 && x % 11 === (hsh(layer, Math.floor(x / 11), 97 + s) * 11 | 0);
  return r === fh - 1 ? 3 : inL === 0 ? (hsh(layer, 5 + s) < .5 ? 0 : 1) : inL >= 7 ? 2 : crackX ? 2 : hsh(layer, 9 + s) < .3 ? 2 : 1;
}
// basalt columns of varying width (5..9 px): tone for column x, row r
function basaltT(x, r, fh) {
  let ci = 0, cx = 0, cw = 7; { let a = 0; for (;;) { const w = 5 + Math.floor(hsh(ci, 1, 86) * 5); if (a + w > x) { cx = x - a; cw = w; break; } a += w; ci++; } }
  const capY = Math.floor(hsh(ci, 3, 84) * 5), joint = (r + ci * 5) % 13 === 0 && hsh(ci, r, 87) < .7;
  if (r < capY) return -1;
  return r === capY ? (cx === cw - 1 ? 1 : 0) : r === fh - 1 ? 3 : cx === cw - 1 ? 3 : joint ? 2 : cx === 0 ? 0 : cx >= cw - 2 ? 2 : 1;
}
// a small boulder stamped onto the ground (bank rocks)
function boulder(K, mx, my, rx, ry, R, seed, cap = null) {
  const w = Math.ceil(rx * 2) + 4, h = Math.ceil(ry * 2) + 4, P = new Pix(w, h);
  P.blob(w / 2, h / 2, rx, ry, R, {s: seed, j: .25, hi: .6});
  if (cap) for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (P.on(x, y) && !P.on(x, y - 1)) { P.p(x, y, cap, 0); if (P.on(x, y + 1)) P.p(x, y + 1, cap, 1); break; }
  P.outline();
  stamp(K.G, P, Math.round(mx * K.PPM - w / 2), Math.round(my * K.PPMY - h + 2));
}
const narrowRocks = (K, R, cap) => {   // rocks on both banks where the stream pinches: "jump here"
  const SM = K.stream; if (!SM) return;
  for (const [dy, side, sz] of [[-1.3, -1, 1], [-.5, -1, .8], [.6, -1, 1.1], [1.4, -1, .7], [-1.1, 1, .9], [-.2, 1, .7], [.9, 1, 1.1], [1.6, 1, .8]]) {
    const y = SM.narrows.y + dy, x = SM.cx(y) + side * (SM.w(y) / 2 + .28 + sz * .12);
    boulder(K, x, y, 5 * sz + 2, 3.2 * sz + 1.5, R, (dy * 10 | 0) + side * 7, cap);
  }
};

// the banks: damp, lusher ground along the water (features/riverside.js stands the reeds on it). From 0.3 m outside the
// water's edge (paintStream's own earth line and worn lip stay) out to a wavy 0.55-1.05 m: darker, cooler grass laid over
// whatever tone the ground had (the relief stays), with clover and small-flower speckles. Left alone: the narrows (the path
// and the leap), the east bank under the plateau (a pool's place) and the ravine lip
function dampBanks(K, S, cliff) {
  const SM = K.stream; if (!SM) return;
  const {G, PPM, PPMY, HPX} = K, D = S.damp, L = S.lush, FL = [hex('#f1ecde'), hex('#f0d968'), hex('#c8a6e8'), hex('#f2b9c9')];
  for (let y = 0; y < HPX; y++) {
    const my = (y + .5) / PPMY, c = SM.cx(my), hw = SM.w(my) / 2;
    if (my > cliff(c) - .6 || my < 2.2 || Math.abs(my - SM.narrows.y) < 2.7) continue;
    for (const side of [-1, 1]) {
      if (side > 0 && my < 12.4) continue;
      const xa = Math.floor((c + side * (hw + .25)) * PPM), xb = Math.ceil((c + side * (hw + 1.1)) * PPM);
      for (let x = Math.min(xa, xb); x <= Math.max(xa, xb); x++) {
        const mx = (x + .5) / PPM, e = Math.abs(mx - c) - hw + (vn(x / 4, y / 3, 71) - .5) * .05;   // (paintStream's own edge)
        if (e < .3 || e > .55 + vn(x / 9, y / 7, 62) * .5) continue;
        const m0 = G.mat(x, y); if (m0 !== S.grass.id && m0 !== S.earth.id) continue;
        if (e < .42 && hsh(x, y, 63) < .45) continue;   // a ragged inner edge: bare earth shows between the lip and the damp grass
        G.p(x, y, D, Math.min(2, Math.max(0, G.tone(x, y))));
        if (hsh(x, y, 65) < .013) { G.p(x, y, L, 0); G.p(x + 1, y, L, 1); G.p(x, y + 1, L, 2); }   // clover
        else if (hsh(x, y, 66) < .0035) G.c(x, y, FL[hsh(x, y, 67) * 4 | 0]);   // a small flower
      }
    }
  }
}

// ---------------------------------------------------------------- the plateau's water (layout.js SPRING / RILL / FALL / POOL / OUTFLOW)
// paintRill: st.px(x, y, e, side, mx, my, o) for every pixel of the plateau's top within .45 m of the rill's edge (e < 0 in the water, metres
// from the edge; side -1 where the nearest bank is north / west of the pixel, the shadow side, +1 south / east; o = rillAt's {d, a, l, hw}: o.a metres
// across the rill (+ to the left of the flow: south of a westward stretch), o.l metres from the spring). The spring's basin is the rill's round
// head. Rows south of the plateau's face are the pool's, not the rill's
function paintRill(K, st) {
  const L = K.layout; if (!L.rill) return;
  const {PPM, PPMY} = K, o = {d: 0, a: 0, l: 0, hw: 0};
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [px, py] of L.rill.pts) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  for (let y = Math.floor((y0 - .9) * PPMY); y <= Math.ceil((y1 + .9) * PPMY); y++) for (let x = Math.floor((x0 - .9) * PPM); x <= Math.ceil((x1 + .9) * PPM); x++) {
    const mx = (x + .5) / PPM, my = (y + .5) / PPMY; if (my >= L.fall.y) continue;
    L.rillAt(mx, my, o);
    const e = o.d - o.hw + (vn(x / 4, y / 3, 73) - .5) * .05;
    if (e < .45) st.px(x, y, e, o.a < 0 ? -1 : 1, mx, my, o);
  }
}
// paintPool: the stream's own px (paintStream's st.px) for the pool at the foot of the plateau's south face: the water, and its banks on dry land
// (the face counts as a bank, on its shadow side: the plateau's top, y < the face line, is paintPlateau's / paintRill's). It lies clear of the
// river, so the deep middle is told as c = mx - (how far from the pool's centre, 0..1) with hw = 1
function paintPool(K, st) {
  const L = K.layout, P = L.pool; if (!P) return;
  const {PPM, PPMY} = K;
  for (let y = Math.floor(P.clip * PPMY); y <= Math.ceil((P.y + P.ry + .6) * PPMY); y++) for (let x = Math.floor((P.x - P.rx - .6) * PPM); x <= Math.ceil((P.x + P.rx + .6) * PPM); x++) {
    const mx = (x + .5) / PPM, my = (y + .5) / PPMY; if (my < P.clip) continue;
    const eP = L.poolEdge(mx, my); if (eP < -.45) continue;
    const u = (mx - P.x) / P.rx, v = (my - P.y) / P.ry, rho = Math.hypot(u, v), face = eP > 0 && my - P.clip <= eP + 1e-9;   // (the face is the nearest bank)
    const gx = u / P.rx, gy = v / P.ry, gl = Math.hypot(gx, gy) || 1, nx = face ? 0 : gx / gl, ny = face ? -1 : gy / gl;   // (outward: toward the nearest bank)
    st.px(x, y, -eP + (vn(x / 4, y / 3, 71) - .5) * .05, nx + ny < 0 ? -1 : 1, mx, my, mx - rho, 1);
  }
}
// paintOutflow: st.px(x, y, e, side, mx, my, o) for the pixels within .45 m of the outflow's edge that lie neither in the river's water nor in the
// pool's (o = outflowAt's {d, a, l, hw}; a < 0 north of the axis). Painted after the pool and the river: where it opens into them its water
// replaces their banks. chan(st) turns a river painter into one for a channel (c = the axis, so its "deep middle" is the channel's middle)
const chan = st => ({px: (x, y, e, side, mx, my, o) => st.px(x, y, e, side, mx, my, mx - o.a, o.hw)});
function paintOutflow(K, st) {
  const L = K.layout, C = L.outflow, SM = K.stream; if (!C || !SM) return;
  const {PPM, PPMY} = K, o = {d: 0, a: 0, l: 0, hw: 0};
  let y0 = 1e9, y1 = -1e9; for (const [, py] of C.pts) { y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  for (let y = Math.floor((y0 - .9) * PPMY); y <= Math.ceil((y1 + .9) * PPMY); y++) for (let x = Math.floor((C.x1 - .9) * PPM); x <= Math.ceil((C.x0 + .9) * PPM); x++) {
    const mx = (x + .5) / PPM, my = (y + .5) / PPMY; if (my < L.fall.y) continue;
    L.outflowAt(mx, my, o);
    const e = o.d - o.hw + (vn(x / 4, y / 3, 74) - .5) * .05;
    if (e >= .45 || K.streamE(mx, my) < 0 || L.poolEdge(mx, my) > 0) continue;
    st.px(x, y, e, o.a < 0 ? -1 : 1, mx, my, o);
  }
}
// fn(x, y, r, mx, my) for every pixel within .6 m of where the fall lands (r = a little squashed distance), south of the face
function fallFoot(K, fn) {
  const F = K.layout.fall, {PPM, PPMY} = K;
  for (let y = Math.floor(F.y * PPMY); y <= Math.ceil((F.foot.y + .8) * PPMY); y++) for (let x = Math.floor((F.x - .8) * PPM); x <= Math.ceil((F.x + .8) * PPM); x++) {
    const mx = (x + .5) / PPM, my = (y + .5) / PPMY; if (my < F.y) continue;
    const r = Math.hypot(mx - F.foot.x, (my - F.foot.y) * 1.25);
    if (r < .6) fn(x, y, r, mx, my);
  }
}
// the damp, lusher ground round the pool's and the outflow's dry banks (dampBanks' band: 0.3 m out from the edge to a wavy 0.55-1.05 m). Not on the
// path (or .15 m of it), not nearer the river than the water, not on the plateau's top
function dampPool(K, S) {
  const L = K.layout, P = L.pool, C = L.outflow, SM = K.stream; if (!P || !C || !SM) return;
  const {G, PPM, PPMY} = K, D = S.damp, LU = S.lush, FL = [hex('#f1ecde'), hex('#f0d968'), hex('#c8a6e8'), hex('#f2b9c9')], o = {d: 0, a: 0, l: 0, hw: 0};
  const paths = L.marks.filter(m => m.type === 'path'), onPath = (mx, my) => {
    for (const m of paths) for (let i = 0; i < m.pts.length - 1; i++) {
      const a = m.pts[i], b = m.pts[i + 1], vx = b[0] - a[0], vy = b[1] - a[1], t = Math.max(0, Math.min(1, ((mx - a[0]) * vx + (my - a[1]) * vy) / (vx * vx + vy * vy)));
      if (Math.hypot(mx - a[0] - vx * t, my - a[1] - vy * t) < m.w / 2 + .15) return true;
    }
    return false;
  };
  let y1 = P.y + P.ry; for (const [, py] of C.pts) y1 = Math.max(y1, py + .6);
  for (let y = Math.floor(P.clip * PPMY); y <= Math.ceil((y1 + 1.2) * PPMY); y++) {
    const my = (y + .5) / PPMY; if (my < P.clip) continue;
    for (let x = Math.floor((C.x1 - .8) * PPM); x <= Math.ceil((P.x + P.rx + 1.2) * PPM); x++) {
      const mx = (x + .5) / PPM, eR = Math.abs(mx - SM.cx(my)) - SM.w(my) / 2;
      L.outflowAt(mx, my, o);
      const e = Math.min(-L.poolEdge(mx, my), o.d - o.hw) + (vn(x / 4, y / 3, 71) - .5) * .05;
      if (e < .3 || e > .55 + vn(x / 9, y / 7, 62) * .5 || eR < e) continue;   // (out of the band, or nearer the river than the water)
      const m0 = G.mat(x, y); if (m0 !== S.grass.id && m0 !== S.earth.id) continue;
      if (e < .42 && hsh(x, y, 63) < .45) continue;
      if (onPath(mx, my)) continue;
      G.p(x, y, D, Math.min(2, Math.max(0, G.tone(x, y))));
      if (hsh(x, y, 65) < .013) { G.p(x, y, LU, 0); G.p(x + 1, y, LU, 1); G.p(x, y + 1, LU, 2); }
      else if (hsh(x, y, 66) < .0035) G.c(x, y, FL[hsh(x, y, 67) * 4 | 0]);
    }
  }
}

// ---------------------------------------------------------------- RUINS ground
function cliffRuins(K) { return mx => K.HM - 2.2 + (vn(mx * .3, .5, 91) - .5) * 1.3; }
function groundRuins(q, ctx, B) {
  const K = kit(q, ctx), S = STYLES.ruins, {G, PLAY, X, Y, PPMH} = K, cliff0 = cliffRuins(K), cliff = mx => K.clampEdge(mx, cliff0(mx));
  const F = K.field((mx, my) => fbm(mx * .2, my * .2, 14));
  K.fill((x, y, mx, my) => {
    const ins = K.inside(mx, my, .6), pd = K.pathD(mx, my);
    const g = fbm(mx * .2, my * .2, 11) + (ins ? -.32 : .12) - (pd < 1.5 ? .6 - pd * .2 : 0), sl = K.slope(F, x, y);
    const th = K.inTrail(mx, my) ? .03 : 0;   // the trail is playable: flatter meadow
    if (g > .5) G.p(x, y, S.grass, g < .52 ? 2 : sl > .05 + th ? 0 : sl < -.065 - th ? 2 : 1);
    else G.p(x, y, S.earth, g > .47 ? 1 : sl > .06 ? 0 : sl < -.07 ? 2 : 1);
  });
  // grass tufts on the meadows (sparse clusters)
  const rt = rng(72);
  for (let i = 0; i < 700; i++) {
    const mx = rt() * K.WM, my = rt() * K.HM, x = X(mx), y = Y(my); if (K.inside(mx, my, .8) || G.mat(x, y) !== S.grass.id) continue;
    for (const [a, b, t] of [[0, 0, 1], [1, -1, 0], [2, 0, 1], [-1, -1, 0], [1, 1, 2]]) G.p(x + a, y + b, S.grass, t);
  }
  // pebbles outside (sparse)
  const r = rng(71);
  for (let i = 0; i < 260; i++) {
    const mx = r() * K.WM, my = r() * K.HM; if (K.calm(mx, my, 1)) continue;
    const x = X(mx), y = Y(my), w = 2 + (r() * 2 | 0);
    for (let k = 0; k < w; k++) G.p(x + k, y, S.rock, k === 0 ? 0 : 1); for (let k = 0; k < w; k++) G.p(x + k, y + 1, S.rock, 3);
  }
  // old road stones leading out of the gates
  for (const s of flagstones(0, 0, K.WM, K.HM, 13, [.6, .8], [.6, 1.1])) {
    const mx = (s.x0 + s.x1) / 2, my = (s.y0 + s.y1) / 2;
    if (K.inside(mx, my, .3) || K.pathD(mx, my) > .95 || s.v < .35) continue;
    stone(K, s, s.v > .8 ? S.floorB : S.floor, s.v > .9 ? 0 : 1);
  }
  // the paving: big worn flagstones, broken toward the walls; grass in the gaps
  for (const s of flagstones(PLAY.x0 - .5, PLAY.y0 - .5, PLAY.x1 + .5, PLAY.y1 + .5, 5, [.8, 1.05], [.9, 1.7])) {
    const mx = (s.x0 + s.x1) / 2, my = (s.y0 + s.y1) / 2, ed = K.edgeD(mx, my);
    const wear = fbm(mx * .4, my * .4, 3) + Math.max(0, 1.8 - ed) * .2 - (Math.hypot(mx - K.cx, my - K.cy - .5) < 5.5 ? .25 : 0);
    if (wear > .74) continue;
    const moss = ed < 2.4 || wear > .6, sx0 = X(s.x0), sx1 = X(s.x1) - 1, sy0 = Y(s.y0), sy1 = Y(s.y1) - 1;
    const [xa, ya] = stone(K, s, s.v < .2 ? S.floorB : S.floor, s.v > .88 ? 0 : 1, (x, y, j) => {
      if (!moss) return false;
      // moss grows out of the joints: thick in the corners, a thin rim along the edges, never spots in the middle
      const dj = Math.min(x - sx0, sx1 - x, (y - sy0) * 1.3, (sy1 - y) * 1.3), mm = vn(x / 6, y / 5, 17) + Math.max(0, 2.4 - ed) * .14 + wear * .2;
      const reach = mm > .98 ? 4 : mm > .88 ? 2.5 : mm > .78 ? 1.2 : mm > .66 && j ? .5 : -1;
      if (dj <= reach) { G.p(x, y, S.grass, j ? 2 : dj >= reach - 1 && dj > .5 ? 1 : dj < 1 ? 2 : 1); return true; }
      return false;
    });
    if (s.v > .45 && s.v < .56) crack(K, xa + 4 + (s.v * 97 % 12 | 0), ya + 2, 7, S.floor, 2, s.r * 31 + s.k);
  }
  marks(K, S, inlayStyle(K, S, {over: {path(x, y, d, hw, mx, my) {   // a worn earth trail, darker at its ragged edge
    const n = vn(mx * 1.1, my * 1.1, 33);
    G.p(x, y, S.earth, hw - d < .09 ? 2 : n > .7 ? 0 : 1);
  }}}));
  wallAO(K);
  // low foundations of older buildings outside the walls
  const found = [[1.2, 3.2, 4.5], [34.2, 1.4, 3.4], [1.5, 11.5, 3.2], [1.2, 26, 3.6], [11, 1.6, 5], [26, 2.2, 3.4]];
  for (const [fx, fy, len] of found) {
    let x = X(fx); const y = Y(fy), xe = X(fx + len), bh = 4, td = 3;
    while (x < xe) {
      const w = 12 + (hsh(x, 5) * 9 | 0); if (hsh(x, 9) < .22) { x += w; continue; }
      for (let i = 0; i < w - 1; i++) {
        for (let j = 0; j < td; j++) G.p(x + i, y - bh - td + j, S.wall, i === 0 || j === 0 ? 1 : 0);
        for (let j = 0; j < bh; j++) G.p(x + i, y - bh + j, S.wall, j === bh - 1 ? 3 : i === w - 2 ? 2 : 1);
        if (vn((x + i) / 6, fy, 5) > .6) G.p(x + i, y - bh - td, S.grass, 1);
      }
      x += w;
    }
  }
  // the stream: teal water between dark earth banks; flow streaks; the west bank's shadow on the water
  const W = S.water;
  const riverSt = {
    stop: c => cliff(c) - .02,
    px(x, y, e, side, mx, my, c, hw) {
      if (e >= 0) { if (e < .06) G.p(x, y, S.earth, 3); else if (e < .18) G.p(x, y, S.earth, side < 0 ? 2 : 1); else if (e < .3 && hsh(x, y, 4) < .45) G.p(x, y, S.grass, 2); return; }
      const d = -e, streak = hsh(x, Math.floor(my * 3), 5) < .07;
      G.p(x, y, W, side < 0 && d < .14 ? 3 : side > 0 && d < .05 ? 0 : streak ? 0 : Math.abs(mx - c) < hw * .45 ? 2 : 1);
    },
    stone: st => slab(K, st, S.rock, {ring: (P, E, x, y) => P.p(x, y, W, 0)}),
  };
  paintStream(K, riverSt);
  paintPool(K, riverSt);   // the pool at the foot of the plateau's south face: the same water, the same banks
  paintOutflow(K, chan(riverSt));   // and its shallow outflow to the stream
  fallFoot(K, (x, y, r, mx, my) => { if (G.mat(x, y) === W.id && hsh(x, y, 12) < .8 * (1 - Math.max(0, r - .1) / .45)) G.p(x, y, W, 0); });   // foam where the fall lands (held as painted)
  dampBanks(K, S, cliff);
  dampPool(K, S);
  narrowRocks(K, S.rock, S.moss);   // (moss on the rocks where the stream pinches)
  // the south edge: the ground breaks off into a ravine (the stream falls over it)
  const Rk = S.rock, abyss = hex('#1a211d'), abyss2 = hex('#222c26'), SM = K.stream;
  for (let x = 0; x < K.WPX; x++) {
    const mx = x / K.PPM, ey = Y(cliff(mx)), fh = Math.round((1.1 + vn(mx * .5, 3, 92) * .7) * PPMH);
    const fall = SM ? Math.abs(mx - SM.cx(cliff(mx))) - SM.w(cliff(mx)) / 2 : 9;
    for (let y = ey; y < K.HPX; y++) {
      const r2 = y - ey;
      if (fall < 0) {   // waterfall: streaks down the face, foam at the foot, spray into the dark
        if (r2 < fh) G.p(x, y, W, fall > -.08 ? 2 : hsh(x, 17) < .3 ? 0 : 1);
        else if (r2 < fh + 5) G.p(x, y, W, hsh(x, y) < .5 ? 0 : 1);
        else G.c(x, y, hsh(x, y, 3) < .15 ? W.c[2] : abyss2);
        continue;
      }
      if (r2 < 2 && hsh(x, 3) < .6 - r2 * .3) { G.p(x, y, S.grass, r2 ? 2 : 1); continue; }
      if (r2 < fh) {
        // horizontal rock strata: each layer has a lit upper lip and a shaded underside; a few vertical cracks
        const ly = r2 + Math.round((vn(x / 14, 0, 94) - .5) * 5), layer = Math.floor(ly / 9), inL = ((ly % 9) + 9) % 9;
        const crackX = hsh(Math.floor(x / 11), layer, 96) < .35 && x % 11 === (hsh(layer, Math.floor(x / 11), 97) * 11 | 0);
        G.p(x, y, Rk, r2 === fh - 1 ? 3 : inL === 0 ? (hsh(layer, 5) < .5 ? 0 : 1) : inL >= 7 ? 2 : crackX ? 2 : hsh(layer, 9) < .3 ? 2 : 1);
      } else G.c(x, y, vn(x / 26, y / 9, 95) > .62 ? abyss2 : abyss);
    }
  }
  // the plateau: meadow on top, layered rock face, an ivy curtain (with pegs) at the climb spot
  paintPlateau(K, {
    top(x, y, mx, my, rs, climb) {
      if (climb && rs < 6) { G.p(x, y, S.earth, rs === 0 ? 0 : 1); return; }
      const sl = fbm(mx * .3, (my + .3) * .3, 15) - fbm(mx * .3, (my - .3) * .3, 15) + (fbm((mx + .3) * .3, my * .3, 15) - fbm((mx - .3) * .3, my * .3, 15)) * .5;
      G.p(x, y, S.grass, rs === 0 ? 0 : sl > .08 ? 0 : sl < -.09 ? 2 : 1);
    },
    face(x, y, r, hp) {
      const hang = vn(x / 6, 2, 8) > .45 ? 1 + (hsh(x, 7) * 4 | 0) : 1;
      if (r < hang) { G.p(x, y, S.grass, r === hang - 1 ? 2 : r ? 1 : 0); return; }
      if (hsh(x, 31) < .025 && r < hang + 6 + (hsh(x, 32) * 12 | 0)) { G.p(x, y, S.bark, 2); return; }   // hanging roots
      G.p(x, y, S.rock, strata(x, r, hp, 2));
    },
    climb(x, y, r, hp, i, n) {
      if (r < 2) return;
      // a wooden ladder pinned to the face, ivy growing over it
      const rail = i === 6 || i === n - 7, inner = i > 6 && i < n - 7, rung = r % 7 === 4 && inner, under = r % 7 === 5 && inner;
      if (rail || rung || under) { G.p(x, y, S.wood, rung ? 0 : under ? 3 : i === 6 ? 1 : 2); if (!(vn(x / 2.6, y / 2.2, 40) > .62)) return; }
      const stem = Math.abs(i - (Math.floor(i / 7) * 7 + 3) - Math.round(Math.sin(r * .35 + i) * 1.2)) < 1;
      const leaf = vn(x / 2.6, y / 2.2, 40) > .5 - (i < 5 || i > n - 6 ? .12 : -.08);
      const peg = r % 11 === 6 && (i === 5 || i === n - 6);
      if (peg) { G.p(x, y, S.wood, 0); G.p(x + 1, y, S.wood, 1); G.p(x, y + 1, S.wood, 3); }
      else if (leaf) G.p(x, y, S.leaf, hsh(x, y, 41) < .45 ? 0 : vn(x / 2, y / 2, 42) > .6 ? 2 : 1);
      else if (stem) G.p(x, y, S.bark, 1);
    },
  });
  // the plateau's spring and the rill it feeds: water welling up in a basin of mossy stones (ripple rings held as painted), then a
  // shallow channel west and south to the plateau's south edge between dark earth banks, with white riffles where it narrows (waterSample holds
  // those too), a foam lip at the edge; the fall, the pool and the outflow below are painted with the stream
  const SP = K.layout.spring;
  paintRill(K, {px(x, y, e, side, mx, my, o) {
    if (e >= 0) { if (e < .05) G.p(x, y, S.earth, 3); else if (e < .13) G.p(x, y, S.earth, side < 0 ? 2 : 1); else if (e < .24 && hsh(x, y, 4) < .5) G.p(x, y, S.damp, 1); return; }
    const d = -e, rs = Math.hypot(mx - SP.x, my - SP.y);
    let t;
    if (rs < SP.r + .03) t = rs < .07 || (rs > .15 && rs < .19 && hsh(x, y, 8) < .85) || (rs > .29 && rs < .33 && hsh(x, y, 9) < .6) ? 0 : side < 0 && d < .1 ? 3 : side > 0 && d < .04 ? 0 : rs < .22 ? 2 : 1;
    else {
      const cell = Math.floor(o.l * K.PPM / 8), ph = o.l * K.PPM / 8 - cell, riff = K.layout.rill.riffle(o.l, o.hw) && hsh(cell, 3) < .5 && ph < .06 + hsh(cell, 4) * .1 && Math.abs(o.a + (hsh(cell, 6) - .5) * o.hw) < o.hw * (.15 + hsh(cell, 5) * .4) && hsh(x, y, 10) < .9;   // (crests across the flow, short and uneven)
      t = riff ? 0 : side < 0 && d < .09 ? 3 : side > 0 && d < .04 ? 0 : Math.abs(o.a) < o.hw * .45 ? 2 : 1;
      if (my > K.layout.fall.y - .1 && hsh(x, y, 13) < .8) t = 0;   // the foam lip (held as painted)
    }
    G.p(x, y, W, t);
  }});
  for (const [a, r, sz, v] of [[-2.25, .56, 1, 1], [-1.55, .52, .9, 2], [-.85, .56, 1.1, 3], [-.1, .6, .9, 4], [.6, .62, 1, 5], [1.3, .62, 1.1, 6], [2.0, .6, .8, 7]])
    boulder(K, SP.x + Math.cos(a) * r, SP.y + Math.sin(a) * r, 5 * sz + 1.5, 3.2 * sz + 1, S.rock, v * 13, S.moss);
  K.finish(B);
  B.hole = (x, y, c) => y > cliff(x) - .3 || K.streamE(x, y) < .4 || (c && behindPlateau(c, x, y));
}

// ---------------------------------------------------------------- EMBER ground
function groundEmber(q, ctx, B) {
  const K = kit(q, ctx), S = STYLES.ember, {G, E, PLAY, X, Y, PPMH} = K, L = S.lava;
  const cliff = mx => K.clampEdge(mx, K.HM - 2.4 + (vn(mx * .28, .5, 81) - .5) * 1.4);
  const pools = [[3.2, 3.6, 1.6], [34.8, 1.2, .8], [2.6, 20.5, 1.2], [61.3, 15.5, .6], [15.5, 2.4, 1.1], [29.5, 2.8, 1.4]];
  const inPool = (mx, my) => { for (const [px, py, pr] of pools) { const d = Math.hypot(mx - px, (my - py) * 1.25) / pr; if (d < 1.25) return d; } return 9; };
  const F = K.field((mx, my) => fbm(mx * .3, my * .3, 21));
  K.fill((x, y, mx, my) => {
    const ins = K.calm(mx, my, .4), pd = K.pathD(mx, my), sl = K.slope(F, x, y);
    // basalt plates where the ash is thin (outside only; the arena and the trail stay calm ash)
    const v = ins ? null : vor(mx, my, 1.7, 22), plate = !ins && !K.calm(v.x, v.y, -.2) && hsh(v.id, 3) * .8 + fbm(mx * .15, my * .15, 23) * .9 + (ins ? -.2 : 0) - (pd < 1.3 ? .6 : 0) > .9;
    if (plate) {
      const e = v.d2 - v.d1;
      G.p(x, y, hsh(v.id, 4) < .3 ? S.wallB : S.wall, e < .06 ? 3 : e < .1 ? (my < v.y ? 0 : 2) : 1);
    } else G.p(x, y, ins || pd < 1.2 ? S.floor : S.floorB, sl > .1 ? 0 : sl < -.11 ? 2 : 1);
    const pdist = inPool(mx, my);
    if (pdist < 1.25) {
      if (pdist > 1) G.p(x, y, S.wall, pdist > 1.12 ? 1 : 3);
      else { const cv = vor(mx, my, .55, 24), e = cv.d2 - cv.d1;
        if (e < .05) { G.p(x, y, L, e < .022 ? 0 : 1); E.c(x, y, L.c[e < .022 ? 0 : 1]); } else G.c(x, y, hex(e < .09 ? '#5a1a10' : S.crust)); }
    }
  });
  // lava fissures: random walks. Inside the walls only a few thin ones, away from the marks
  const fiss = (x, y, n, seed, inside) => {
    const r = rng(seed); let dx = r() < .5 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const mx = x / K.PPM, my = y / K.PPMY;
      if (inside && (!K.inside(mx, my, -1.2) || K.nearMark(mx, my, .8) || Math.hypot(mx - K.cx, my - K.cy - .5) < 5.6)) return;
      for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (G.mat(x + a, y + b) !== L.id) G.c(x + a, y + b, hex(S.crust));
      G.p(x, y, L, i % 7 === 3 ? 0 : 1); E.c(x, y, L.c[i % 7 === 3 ? 0 : 1]);
      if (r() < .62) x += dx; else y += r() < .5 ? 1 : -1;
      if (r() < .12) dx = -dx;
    }
  };
  const r = rng(29);
  for (let i = 0; i < 9; i++) fiss(X(PLAY.x0 + 1.5 + r() * (PLAY.x1 - PLAY.x0 - 3)), Y(PLAY.y0 + 1.5 + r() * (PLAY.y1 - PLAY.y0 - 3)), 20 + r() * 30 | 0, 300 + i, true);
  for (let i = 0; i < 34; i++) { const mx = r() * K.WM, my = r() * K.HM; if (!K.calm(mx, my, 1.4) && K.streamE(mx, my) > 1) fiss(X(mx), Y(my), 30 + r() * 70 | 0, 400 + i, false); }
  // ash drifts on the paving near the walls are left to the ground noise; the ring is a band of obsidian
  marks(K, S, inlayStyle(K, S, {sleeper: S.wood, over: {path(x, y, d, hw, mx, my) {   // trodden ash: lighter, packed
    const n = vn(mx * 1.2, my * 1.2, 34); G.p(x, y, S.floor, hw - d < .09 ? 2 : n > .5 ? 0 : 1);
  }}}));
  wallAO(K);
  // the lava stream: a basalt-lined channel, crust plates drifting on bright lava, a hot seam along each bank
  const riverSt = {
    stop: c => cliff(c) - .02,
    px(x, y, e, side, mx, my) {
      E.off(x, y);
      if (e >= 0) { if (e < .07) G.p(x, y, S.wall, 3); else if (e < .2) G.p(x, y, S.wall, side < 0 ? 1 : 0); else if (e < .32 && hsh(x, y, 4) < .5) G.p(x, y, S.wall, 2); return; }
      // crust rafts stretched along the flow, thin glowing seams between them, a hot band along each bank
      const d = -e, v = vor(mx * 1.1, my * .55, .45, 25), b = v.d2 - v.d1, seam = b < .022;
      if (d < .05) { G.p(x, y, L, 0); E.c(x, y, L.c[0]); }                           // white-hot where it licks the banks
      else if (d < .13 || seam) { const t = d < .13 && !seam ? 2 : b < .01 ? 1 : 2; G.p(x, y, L, t); E.c(x, y, L.c[t]); }
      else G.c(x, y, hex(b < .045 ? '#5a1a10' : hsh(v.id, 3) < .3 ? '#3a1410' : S.crust));   // drifting crust
    },
    stone: st => slab(K, st, S.wall, {top: (P, E2, x, y, u) => P.p(x, y, u < -.3 ? S.ash : S.wall, u < -.3 ? 0 : 0), ring: (P, E2, x, y) => { P.p(x, y, L, 0); E2.c(x, y, L.c[0]); }}),
  };
  paintStream(K, riverSt);
  paintPool(K, riverSt);   // the pool at the foot of the plateau's south face: the same stream, the same banks
  paintOutflow(K, chan(riverSt));   // and its shallow outflow to the stream
  fallFoot(K, (x, y, r) => { if (hsh(x, y, 12) < .85 * (1 - Math.max(0, r - .08) / .45)) { const k = r < .22 ? 0 : 1; G.p(x, y, L, k); E.c(x, y, L.c[k]); } });   // white-hot splash where the fall lands
  if (K.layout.fall) K.lights.push({x: K.layout.fall.foot.x, y: K.layout.fall.foot.y + .5, h: .4, color: '#ff7a2e', radius: 2.6, intensity: .7, flicker: .25});
  if (K.stream) for (let y = 1.5; y < K.HM - 2; y += 3.4) K.lights.push({x: K.stream.cx(y), y, h: .3, color: '#ff7a2e', radius: 2.4, intensity: .6, flicker: .2});
  narrowRocks(K, S.wall, S.ash);
  // the south edge: basalt cliff down to a lava sea (the stream pours over it)
  for (let x = 0; x < K.WPX; x++) {
    const mx = x / K.PPM, ey = Y(cliff(mx)), fh = Math.round((1.2 + vn(mx * .5, 3, 82) * .8) * PPMH), fall = K.streamE(mx, cliff(mx) - .01);
    for (let y = ey; y < K.HPX; y++) {
      const r2 = y - ey;
      if (fall < 0 && r2 < fh) { const t = fall > -.06 ? 2 : hsh(x, 17) < .35 ? 0 : 1; G.p(x, y, L, t); E.c(x, y, L.c[t]); continue; }
      if (r2 < fh) {
        // basalt columns: 7 px wide, lit left edge, shaded right side, each column top at its own height
        // columns of varying width: boundaries from a hashed sequence (5..9 px)
        let ci = 0, cx = 0, cw = 7; { let a = 0; while (true) { const w = 5 + Math.floor(hsh(ci, 1, 86) * 5); if (a + w > x) { cx = x - a; cw = w; break; } a += w; ci++; } }
        const capY = Math.floor(hsh(ci, 3, 84) * 5);
        if (r2 < capY) { G.p(x, y, S.floorB, 1); continue; }
        const joint = (r2 + ci * 5) % 13 === 0 && hsh(ci, r2, 87) < .7;
        G.p(x, y, S.wall, r2 === capY ? (cx === cw - 1 ? 1 : 0) : r2 === fh - 1 ? 3 : cx === cw - 1 ? 3 : joint ? 2 : cx === 0 ? 0 : cx >= cw - 2 ? 2 : 1);
        if (r2 > fh - 4 && cx < cw - 2) { G.p(x, y, L, r2 === fh - 2 ? 2 : 3); if (r2 === fh - 2) E.c(x, y, L.c[2]); }
      } else {
        const my = y / K.PPMY, v = vor(mx, my * 1.3, .9, 85), e = v.d2 - v.d1;
        if (e < .06) { G.p(x, y, L, e < .03 ? 0 : 1); E.c(x, y, L.c[e < .03 ? 0 : 1]); }
        else if (e < .1) { G.p(x, y, L, 2); E.c(x, y, L.c[2]); }
        else G.c(x, y, hex(hsh(v.id, 2) < .3 ? '#4a1810' : S.crust));
      }
    }
  }
  for (const [px, py, pr] of pools) K.lights.push({x: px, y: py, h: .3, color: '#ff7a2e', radius: pr * 2.2, intensity: .8, flicker: .25});
  // the plateau: ash on top, a basalt-column face, iron rungs hammered in at the climb spot
  paintPlateau(K, {
    top(x, y, mx, my, rs, climb) {
      if (rs === 0) { G.p(x, y, S.ash, 0); return; }
      const v = vor(mx, my, 1.6, 27);
      if (hsh(v.id, 3) < .28) { const e = v.d2 - v.d1; G.p(x, y, S.wall, e < .06 ? 3 : e < .1 ? (my < v.y ? 0 : 2) : 1); return; }
      const sl = fbm(mx * .3, (my + .3) * .3, 26) - fbm(mx * .3, (my - .3) * .3, 26);
      G.p(x, y, S.floor, climb && rs < 6 ? 0 : sl > .08 ? 0 : sl < -.09 ? 2 : 1);
    },
    face(x, y, r, hp) {
      if (r < 2) { G.p(x, y, S.ash, r ? 1 : 0); return; }
      const t = basaltT(x, r - 2, hp - 2); G.p(x, y, t < 0 ? S.ash : S.wall, t < 0 ? 1 : t);
      if (r > hp - 4 && t >= 0 && t < 3 && hsh(x, r, 89) < .05) glowAt(G, E, x, y, '#e0541e', S.crust);
    },
    climb(x, y, r, hp, i, n) {
      if (r < 3) return;
      const inner = i > 4 && i < n - 5, k = r % 8, chain = (i === 2 || i === n - 3) && (r & 1);
      if (k === 5 && inner) G.p(x, y, S.metal, i < n / 2 ? 0 : 1);           // rung
      else if (k === 6 && inner) G.p(x, y, S.wall, 3);                       // its shadow
      else if ((i === 4 || i === n - 5) && k >= 4 && k <= 6) G.p(x, y, S.metal, 2);   // the stakes
      else if (chain) G.p(x, y, S.metal, (r >> 1) & 1 ? 0 : 2);               // chains down both sides
      else if (inner && hsh(x, y, 9) < .2) G.p(x, y, S.wall, 0);              // scuffed rock
    },
  });
  // the plateau's spring: lava seeping up in a ring of basalt, a thin trickle in the stream's own colours (crust rafts, a hot seam along
  // each bank) to the south edge, then a glowing fall into the pool, and a trickle on from the pool to the stream
  {
    const SP = K.layout.spring, top = K.plats[0].h;
    paintRill(K, {px(x, y, e, side, mx, my, o) {
      if (e >= 0) { E.off(x, y); if (e < .07) G.p(x, y, S.wall, 3); else if (e < .15) G.p(x, y, S.wall, side < 0 ? 1 : 0); else if (e < .24 && hsh(x, y, 4) < .5) G.p(x, y, S.wall, 2); return; }
      const rs = Math.hypot(mx - SP.x, my - SP.y);
      if (rs < SP.r + .03) { const t = rs < .12 ? 0 : rs < .3 ? 1 : 2; E.off(x, y); G.p(x, y, L, t); E.c(x, y, L.c[t]); return; }   // the basin: white-hot in the middle
      if (my > K.layout.fall.y - .1) { E.off(x, y); G.p(x, y, L, 0); E.c(x, y, L.c[0]); return; }   // white-hot at the lip
      riverSt.px(x, y, e, side, mx, my);
    }});
    for (const [a, r, sz, v] of [[-2.25, .56, 1, 1], [-1.55, .52, .9, 2], [-.85, .56, 1.1, 3], [-.1, .6, .9, 4], [.6, .62, 1, 5], [1.3, .62, 1.1, 6], [2.0, .6, .8, 7]])
      boulder(K, SP.x + Math.cos(a) * r, SP.y + Math.sin(a) * r, 5 * sz + 1.5, 3.2 * sz + 1, S.wall, v * 13, S.ash);
    for (const [x, y, rad, k] of [[SP.x, SP.y, 2.2, .7], [50.4, 6.9, 2, .45], [45.6, 9.7, 2, .5]]) K.lights.push({x, y, h: top + .3, color: '#ff7a2e', radius: rad, intensity: k, flicker: .22});
  }
  K.finish(B);
  B.hole = (x, y, c) => y > cliff(x) - .3 || inPool(x, y) < 1.3 || K.streamE(x, y) < .4 || (c && behindPlateau(c, x, y));
}

// ---------------------------------------------------------------- FROST ground
function groundFrost(q, ctx, B) {
  const K = kit(q, ctx), S = STYLES.frost, {G, PLAY, X, Y} = K, SN = S.snow, IC = S.ice;
  const lake = mx => K.clampEdge(mx, K.HM - 3.3 + (vn(mx * .25, .5, 61) - .5) * 1.6);
  const snowAt = (mx, my) => fbm(mx * .3, my * .3, 41) + Math.max(0, 2.2 - K.edgeD(mx, my)) * .22 - (Math.hypot(mx - K.cx, my - K.cy - .5) < 5.4 ? .12 : 0);
  const F = K.field((mx, my) => fbm(mx * .34, my * .34, 42) + Math.max(0, 3 - Math.abs(K.edgeD(mx, my))) * .05);
  K.fill((x, y, mx, my) => {
    if (my > lake(mx)) return;
    // snowfield: rolling drifts shaded from a height field (lit north-west slopes, blue slopes facing the camera)
    const pd = K.pathD(mx, my), sl = K.slope(F, x, y);
    const th = K.inTrail(mx, my) ? .02 : 0;
    G.p(x, y, SN, pd < .75 ? 2 : pd < 1 ? 1 : sl > .065 + th ? 0 : sl < -.07 - th ? 2 : 1);
  });
  // stones poking out of the snow outside
  const r = rng(43);
  for (let i = 0; i < 90; i++) {
    const mx = r() * K.WM, my = r() * K.HM; if (K.calm(mx, my, 1.2) || my > lake(mx) - .4 || K.streamE(mx, my) < .6) continue;
    const x = X(mx), y = Y(my), w = 3 + (r() * 5 | 0);
    for (let k = 0; k < w; k++) { G.p(x + k, y, S.rock, 1); G.p(x + k, y + 1, S.rock, 3); if (k > 0 && k < w - 1) G.p(x + k, y - 1, SN, 0); }
  }
  // paving: large blue flagstones, snow gathered against the walls, a few frozen puddles
  for (const s of flagstones(PLAY.x0 - .5, PLAY.y0 - .5, PLAY.x1 + .5, PLAY.y1 + .5, 9, [.9, 1.2], [1.1, 1.8])) {
    stone(K, s, s.v < .25 ? S.floorB : S.floor, s.v > .9 ? 0 : 1, (x, y, j) => {
      const mx = x / K.PPM, my = y / K.PPMY, sn = snowAt(mx, my);
      if (sn > .7) { const below = snowAt(mx, my + .12) <= .7; G.p(x, y, SN, below ? 2 : sn > .82 ? 0 : 1); return true; }
      return false;
    });
  }
  const puddles = [[12.5, 18.4, 1.1], [27.6, 9.4, .9], [10.2, 13.2, .7], [24.5, 21.2, .8]], IP = S.lake;
  for (const [px, py, pr] of puddles) {
    for (let y = Y(py - pr); y <= Y(py + pr); y++) for (let x = X(px - pr * 1.4); x <= X(px + pr * 1.4); x++) {
      const dx = (x + .5) / K.PPM - px, dy = (y + .5) / K.PPMY - py, d = Math.hypot(dx / 1.4, dy) / pr + (vn(x / 5, y / 4, 44) - .5) * .35;
      if (d > 1) continue;
      const streak = Math.abs((dx * 1.2 + dy * 1.6) - .1) < .06 && d < .75;
      G.p(x, y, IP, d > .88 ? 2 : streak ? 0 : 1);
    }
  }
  marks(K, S, inlayStyle(K, S, {sleeper: S.wood, groove: S.floor, over: {path(x, y, d, hw, mx, my) {   // trampled snow
    G.p(x, y, SN, hw - d < .1 ? 0 : 2);
  }}}));
  wallAO(K);
  // the frozen lake to the south: flat ice, long cracks, a snowy shore
  for (let x = 0; x < K.WPX; x++) {
    const mx = x / K.PPM, ey = Y(lake(mx));
    for (let y = ey; y < K.HPX; y++) {
      const my = y / K.PPMY, r2 = y - ey;
      if (r2 < 2) { G.p(x, y, SN, r2 === 0 ? 2 : 3); continue; }
      const v = vor(mx * .8, my * 1.4, 2.2, 62), e = v.d2 - v.d1, deep = fbm(mx * .2, my * .3, 63) > .6;
      const streak = Math.abs(((mx * .9 + my * 1.7) % 3.1) - 1.5) < .05 && vn(mx * .6, my, 64) > .55;
      G.p(x, y, S.lake, e < .025 && hsh(v.id, 1) < .3 ? 2 : streak ? 0 : deep ? 2 : 1);
    }
  }
  // the meltwater stream: dark cold water between snow banks, a thin jagged ice shelf, small broken floes (no footing)
  const MW = S.melt;
  const riverSt = {
    px(x, y, e, side, mx, my) {
      if (e >= 0) { if (e < .06) G.p(x, y, SN, 3); else if (e < .18) G.p(x, y, SN, 2); else if (e < .28 && side < 0) G.p(x, y, SN, 1); return; }
      const d = -e;
      if (d < .07 + (vn(x / 3, y / 2, 72) - .5) * .08) { G.p(x, y, IC, d < .025 ? 3 : hsh(x, y, 73) < .35 ? 0 : 1); return; }
      G.p(x, y, MW, side < 0 && d < .26 ? 3 : hsh(x, Math.floor(my * 3), 74) < .06 ? 1 : 2);
    },
    stone: st => slab(K, st, S.rock, {fh: 4, ring: (P, E2, x, y) => P.p(x, y, IC, 0), top: (P, E2, x, y, u) => { if (u < .2) P.p(x, y, SN, u < -.5 ? 0 : 1); }}),
  };
  paintStream(K, riverSt);
  paintPool(K, riverSt);   // the pool at the foot of the plateau's south face: the same stream, the same banks
  fallFoot(K, (x, y, r) => { if (G.mat(x, y) === MW.id && hsh(x, y, 12) < .75 * (1 - Math.max(0, r - .1) / .45)) G.p(x, y, IC, r < .3 ? 0 : 1); });   // ice crumbs where the (frozen) fall lands
  if (K.stream) for (let y = .8; y < K.HM; y += 2.1) {
    if (Math.abs(y - K.stream.narrows.y) < 2.6 || K.stream.stones.some(t => Math.abs(y - t.y) < 1.3)) continue;
    // a broken, jagged floe riding low in the water: flat, no side face, cracked; clearly not something to stand on
    const k = y * 10 | 0, hw = K.stream.w(y) / 2, fx = K.stream.cx(y) + (hsh(k, 1) - .5) * hw * .9, r0 = (.14 + hsh(k, 2) * .14) * K.PPM, n = 7;
    const pts = []; for (let i = 0; i < n; i++) { const a = i / n * PI2 + hsh(k, i + 3) * .5, rr = r0 * (.55 + hsh(k, i + 11) * .6); pts.push([fx * K.PPM + Math.cos(a) * rr, y * K.PPMY + Math.sin(a) * rr * .6]); }
    const cxp = fx * K.PPM, cyp = y * K.PPMY;
    G.poly(pts.map(([a, c]) => [a, c + 1]), (x, yy) => G.p(x, yy, MW, 3));
    G.poly(pts, (x, yy) => G.p(x, yy, IC, (x - cxp) + (yy - cyp) * 1.5 < -r0 * .3 ? 0 : 1));
    G.line(cxp - r0 * .4, cyp - 1, cxp + r0 * .3, cyp + 2, (x, yy) => { if (G.mat(x, yy) === IC.id) G.p(x, yy, IC, 2); });
  }
  narrowRocks(K, S.rock, SN);
  // the plateau: snow on top, blue rock and ice on the face, icicles under the lip, a rope ladder at the climb spot
  paintPlateau(K, {
    top(x, y, mx, my, rs, climb) {
      const sl = fbm(mx * .34, (my + .3) * .34, 46) - fbm(mx * .34, (my - .3) * .34, 46);
      G.p(x, y, SN, rs === 0 ? 0 : climb && rs < 6 ? 2 : sl > .08 ? 0 : sl < -.09 ? 2 : 1);
    },
    face(x, y, r, hp) {
      const ov = 2 + (vn(x / 5, 1, 42) * 3 | 0);
      if (r < ov) { G.p(x, y, SN, r === ov - 1 ? 2 : r ? 1 : 0); return; }
      if (hsh(x, 43) < .18 && r < ov + 2 + (hsh(x, 44) * 7 | 0)) { G.p(x, y, IC, r < ov + 2 ? 0 : 1); return; }
      const t = strata(x, r, hp, 4), ice = vn(x / 5, r / 16, 45) > .74;
      G.p(x, y, ice ? IC : S.rock, ice && t < 3 ? Math.min(t + 1, 2) : t);
    },
    climb(x, y, r, hp, i, n) {
      if (r < 1) return;
      const rope = i === 5 || i === n - 6, inner = i > 5 && i < n - 6, k = r % 6;
      if (rope) G.p(x, y, S.straw, (r & 1) ? 1 : 2);
      else if (k === 3 && inner) G.p(x, y, r % 12 === 3 && i < n / 2 ? SN : S.wood, 0);
      else if (k === 4 && inner) G.p(x, y, S.rock, 3);
    },
  });
  // the plateau's spring is frozen: a dome of ice in a ring of snowy stones, a glassy ribbon winding to the south edge (no flow), and the
  // fall hangs over the face as a curtain of icicles; the outflow from the pool is frozen too
  {
    const SP = K.layout.spring;
    const ribbon = (x, y, e, side, mx, my, o, rs = 9) => {   // a glassy ribbon of ice between snowy banks (the outflow's too)
      if (e >= 0) { if (e < .05) G.p(x, y, SN, 3); else if (e < .14) G.p(x, y, SN, 2); else if (e < .22 && side < 0) G.p(x, y, SN, 1); return; }
      const d = -e;
      if (rs < SP.r + .03) { G.p(x, y, IC, d < .05 ? 3 : rs < .13 ? 0 : rs > .27 && rs < .3 ? 2 : 1); return; }
      const crack = Math.abs(((mx * 1.1 + my * 1.9) % .7) - .35) < .012 && d > .05 && vn(mx * .8, my * .8, 75) > .35;
      G.p(x, y, IC, d < .04 ? 3 : crack ? 2 : side < 0 && d < .1 ? 2 : Math.abs(o.a) < o.hw * .5 ? (hsh(x >> 1, y >> 1, 76) < .2 ? 1 : 0) : 1);
    };
    paintRill(K, {px: (x, y, e, side, mx, my, o) => ribbon(x, y, e, side, mx, my, o, Math.hypot(mx - SP.x, my - SP.y))});
    paintOutflow(K, {px: (x, y, e, side, mx, my, o) => ribbon(x, y, e, side, mx, my, o)});
    for (const [a, r, sz, v] of [[-2.25, .56, 1, 1], [-1.55, .52, .9, 2], [-.85, .56, 1.1, 3], [-.1, .6, .9, 4], [.6, .62, 1, 5], [1.3, .62, 1.1, 6], [2.0, .6, .8, 7]])
      boulder(K, SP.x + Math.cos(a) * r, SP.y + Math.sin(a) * r, 5 * sz + 1.5, 3.2 * sz + 1, S.rock, v * 13, SN);
  }
  K.finish(B);
  B.hole = (x, y, c) => y > lake(x) - .35 || K.streamE(x, y) < .4 || (c && behindPlateau(c, x, y));
}

// ---------------------------------------------------------------- RIFT ground
function groundRift(q, ctx, B) {
  const K = kit(q, ctx), S = STYLES.rift, {G, E, PLAY, X, Y, PPMH} = K;
  const reach = (mx, my) => 2.2 + fbm(mx * .25, my * .25, 51) * 2.2 - (K.pathD(mx, my) < 1.6 ? -1.2 : 0);
  const rectD = (mx, my, Q) => Math.hypot(Math.max(Q.x0 - mx, mx - Q.x1, 0), Math.max(Q.y0 - my, my - Q.y1, 0));
  const onPlat = (mx, my) => Math.min(rectD(mx, my, PLAY), K.trail ? rectD(mx, my, K.trail) : 99) < reach(mx, my);
  const RUNE = hex(S.rune), DIM = hex(S.runeDim), LEY = hex('#643a9e'), LEYE = hex('#3a2268'), voidC = [hex('#0c0816'), hex('#120b20'), hex('#3a2a5c'), hex('#8a6ac8')];
  const tile = 1.5, ox = K.cx % tile, oy = (K.cy + .5) % tile;
  // stepping stones floating out from the gates
  const steps = [];
  for (const [ax, ay, dx, dy] of [[K.cx, PLAY.y0 - 3.2, 0, -1], [K.cx, PLAY.y1 + 3.2, 0, 1], [PLAY.x0 - 3.2, K.cy, -1, 0]])
    for (let i = 0; i < 4; i++) steps.push([ax + dx * i * 1.3 + (hsh(i, ax | 0) - .5) * .6, ay + dy * i * 1.1 + (hsh(i, ay | 0) - .5) * .4, .45 - i * .05]);
  const onStep = (mx, my) => steps.some(([sx, sy, sr]) => Math.hypot(mx - sx, (my - sy) * 1.4) < sr);
  const PL = new Uint8Array(K.WPX * K.HPX);   // platform mask (raw-colour pixels like runes have no ramp id, so G.m can't tell)
  K.fill((x, y, mx, my) => {
    if ((onPlat(mx, my) || onStep(mx, my)) && K.layout.inStream && K.layout.inStream(mx, my)) {   // the rift crack
      PL[y * K.WPX + x] = 2; const h = hsh(x, y, 55);
      G.c(x, y, h < .003 ? voidC[3] : h < .012 ? voidC[2] : voidC[0]); return;
    }
    if (onPlat(mx, my) || onStep(mx, my)) {
      PL[y * K.WPX + x] = 1;
      const tx = Math.floor((mx - ox) / tile), ty = Math.floor((my - oy) / tile), fx = (mx - ox) / tile - tx, fy = (my - oy) / tile - ty;
      const seam = fx < .018 || fy < .025, v = hsh(tx, ty, 52), ins = K.inside(mx, my);
      const broken = !K.calm(mx, my) && vn(mx * .6, my * .6, 53) > .66;
      if (seam) {
        G.p(x, y, S.floor, fx < .018 && fy < .025 ? 3 : 2);
        // ley lines: the seams on the axes through the centre glow faintly, leading to the gates
        const axis = (Math.abs(mx - K.cx) < .3 && fx < .018) || (Math.abs(my - K.cy - .5) < .3 && fy < .025);
        if (axis && ins && ((fx < .018 ? my : mx) * 2.2 % 1) < .7) { G.c(x, y, LEY); E.c(x, y, LEYE); }
      } else G.p(x, y, v < .22 ? S.floorB : S.floor, broken ? 2 : fy < .08 && v > .5 ? 0 : 1);
      return;
    }
    const n = fbm(mx * .3, my * .3, 54), h = hsh(x, y, 55);
    G.c(x, y, h < .0015 ? voidC[3] : h < .006 ? voidC[2] : n > .62 ? voidC[1] : voidC[0]);
  });
  // faint engraved glyphs on some tiles inside
  for (let ty = Math.floor((PLAY.y0 - oy) / tile); ty * tile + oy < PLAY.y1; ty++) for (let tx = Math.floor((PLAY.x0 - ox) / tile); tx * tile + ox < PLAY.x1; tx++) {
    if (hsh(tx, ty, 58) > .1) continue;
    const mx = (tx + .5) * tile + ox, my = (ty + .5) * tile + oy; if (K.nearMark(mx, my, 1)) continue;
    const x = X(mx), y = Y(my); glyph((a, b) => G.p(x + a - 2, y + b - 3, S.floor, 2), tx * 3 + ty);
  }
  // rune circle: a dark carved band with glowing glyphs
  const st = inlayStyle(K, S, {groove: S.floor, over: {
    path(x, y, d, hw) {   // lighter slabs laid over the tiles (seams kept), dark border
      if (PL[y * K.WPX + x] !== 1 || (G.mat(x, y) === S.floor.id && G.tone(x, y) >= 2)) return;
      G.p(x, y, S.inlay, hw - d < .08 ? 3 : 1);
    },
    ring(x, y, dd, a) {   // a carved band framed by two glowing lines, runes between them
      const ad = Math.abs(dd); if (ad > .17) return;
      G.p(x, y, S.floor, 3);
      const n = 40, f = a / PI2 * n, k = ((f % 1) + 1) % 1, gi = Math.floor(((f % n) + n) % n);
      const rune = ad < .09 && k > .28 && k < .72 && glyphPx(gi, (k - .28) / .44, (dd + .09) / .18), line = Math.abs(ad - .14) < .022;
      if (rune || line) { const c = rune ? RUNE : DIM; G.c(x, y, c); E.c(x, y, c); }
    },
    groove(x, y, i) { G.p(x, y - 1, S.floor, 3); G.p(x, y, S.floor, 3); G.p(x, y + 1, S.inlay, 0); if (i % 8 < 5) { G.c(x, y, DIM); E.c(x, y, DIM); } },
  }});
  marks(K, S, st);
  for (const m of K.layout.marks) {   // runes glow at the tick plates and the mark
    if (m.type === 'lane') for (const d of m.ticks) { const x = X(m.x0 + d), y = Y(m.y); G.c(x, y - 5, RUNE); E.c(x, y - 5, RUNE); }
    if (m.type === 'mark') { const x = X(m.x), y = Y(m.y); for (const [a, b] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) { G.c(x + a, y + b, RUNE); E.c(x + a, y + b, RUNE); } }
    if (m.type === 'ring') K.lights.push({x: m.x, y: m.y - m.r, h: .1, color: '#c070ff', radius: 2.5, intensity: .5, flicker: .1});
  }
  wallAO(K);
  // platform edges: the ground's underside hangs into the void (floating island), stepping stones too
  for (let x = 0; x < K.WPX; x++) {
    let D = 0, k = 0;
    for (let y = 1; y < K.HPX; y++) {
      const above = PL[(y - 1) * K.WPX + x], here = PL[y * K.WPX + x];
      if (here) { D = 0; continue; }
      if (above === 1 && !D) {
        const small = onStep((x + .5) / K.PPM, (y - 3) / K.PPMY);
        D = Math.round((.45 + vn(x / 10, y / 40, 56) * 1.1) * PPMH * (small ? .4 : 1)) + (hsh(x >> 1, 7) < .25 ? -2 : 0); k = 0;
      }
      if (D > 0 && k < D) {
        // the island's underside: a shaded edge face, then rock strata tapering to a ragged bottom
        if (k < 3) G.p(x, y, S.floor, k === 0 ? 1 : 2);
        else G.p(x, y, S.rock, k === D - 1 ? 3 : (k + (vn(x / 6, 0, 57) * 4 | 0)) % 7 === 0 ? 3 : vn(x / 4, k / 9, 57) < .33 ? 1 : 2);
        if (k > 3 && hsh(x, y, 59) < .0012) { G.c(x, y, RUNE); E.c(x, y, RUNE); }
        k++;
      }
    }
  }
  // the crack: glowing rims, a sliver of rock under the west lip; floating stepping slabs with a rune each
  const riverSt = {
    px(x, y, e, side) {
      if (x < 0 || x >= K.WPX) return;
      const i = y * K.WPX + x;
      if (e >= 0) { if (PL[i] === 1 && e < .045) { G.c(x, y, DIM); E.c(x, y, DIM); } else if (PL[i] === 1 && e < .11) G.p(x, y, S.floor, 3); return; }
      if (PL[i] === 2 && side < 0 && -e < .09) G.p(x, y, S.rock, -e < .03 ? 1 : 2);
    },
    stone: t => slab(K, t, S.rock, {fh: 6, top: (P, E2, x, y, u) => P.p(x, y, S.floor, u < -.5 ? 0 : 1),
      rim: (P, E2, cx, cy) => { for (const [a, b] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) glowAt(P, E2, Math.round(cx) + a, Math.round(cy) + b, a || b ? S.runeDim : S.rune, null); }}),
  };
  paintStream(K, riverSt);
  paintPool(K, riverSt);   // the pool at the foot of the plateau's south face: the same stream, the same banks
  fallFoot(K, (x, y, r) => { if (PL[y * K.WPX + x] === 2 && hsh(x, y, 12) < .4 * (1 - r / .55)) { G.c(x, y, DIM); E.c(x, y, DIM); } });   // motes of light where the fall lands in the crack
  if (K.stream) for (let y = 3; y < K.HM; y += 6) K.lights.push({x: K.stream.cx(y), y, h: .1, color: '#b060ff', radius: 2.2, intensity: .45, flicker: .15});
  // the plateau: tiles on top with a rune-lit lip, violet strata with glowing veins, rune handholds at the climb spot
  paintPlateau(K, {
    top(x, y, mx, my, rs, climb) {
      if (rs === 0) { G.c(x, y, DIM); E.c(x, y, LEYE); return; }
      const tx = Math.floor((mx - ox) / tile), ty = Math.floor((my - oy) / tile), fx = (mx - ox) / tile - tx, fy = (my - oy) / tile - ty;
      G.p(x, y, hsh(tx, ty, 52) < .22 ? S.floorB : S.floor, fx < .018 || fy < .025 ? 2 : climb && rs < 6 ? 0 : 1);
    },
    face(x, y, r, hp) {
      if (r < 2) { G.p(x, y, S.floor, r ? 2 : 1); return; }
      G.p(x, y, S.rock, strata(x, r, hp, 6));
      const vx = Math.floor(x / 13); if (hsh(vx, 1, 60) < .3 && r > 5 && r < hp - 5 && x % 13 === 6 + Math.round(Math.sin(r * .35 + vx) * 1.5)) { G.c(x, y, DIM); E.c(x, y, LEYE); }
    },
    climb(x, y, r, hp, i, n) {
      if (r < 3) return;
      const k = Math.floor((r - 3) / 7), rr = (r - 3) % 7, col = k % 2 ? n - 13 : 7, slot = i >= col && i < col + 6;
      if (slot && rr === 2) G.p(x, y, S.rock, 0);
      else if (slot && rr === 3) G.p(x, y, S.rock, 3);
      else if (slot && rr === 4) { G.c(x, y, RUNE); E.c(x, y, RUNE); }
      else if (i === n >> 1 && (r & 1)) { G.c(x, y, DIM); E.c(x, y, LEYE); }
    },
  });
  // the plateau's spring: a rune ring where the ley line surfaces and the line itself, a dashed glowing seam to the south edge, pouring
  // down the face as light into the crack, and on from the pool to the river's crack
  {
    const SP = K.layout.spring, top = K.plats[0].h;
    paintRill(K, {px(x, y, e, side, mx, my, o) {
      if (e >= 0) return;
      const rs = Math.hypot(mx - SP.x, my - SP.y), ad = Math.abs(o.a);
      if (rs < SP.r + .03) { if ((rs > .37 && rs < .43) || rs < .08 || (rs > .2 && rs < .23 && hsh(x, y, 8) < .7)) { G.c(x, y, rs < .08 ? RUNE : DIM); E.c(x, y, rs < .08 ? RUNE : DIM); } else G.p(x, y, S.floor, 3); return; }
      if (ad < .035 && Math.floor(o.l * K.PPM / 5) % 4 !== 3) { const c = ad < .014 ? DIM : LEY, ec = ad < .014 ? DIM : LEYE; G.c(x, y, c); E.c(x, y, ec); }
    }});
    paintOutflow(K, {px(x, y, e, side, mx, my, o) {   // the ley line runs on, west from the pool to the crack
      if (e >= 0) return;
      const ad = Math.abs(o.a);
      if (ad < .035 && Math.floor(o.l * K.PPM / 5) % 4 !== 3) { const c = ad < .014 ? DIM : LEY, ec = ad < .014 ? DIM : LEYE; G.c(x, y, c); E.c(x, y, ec); }
    }});
    for (const [x, y, rad, k] of [[SP.x, SP.y, 2.4, .55], [47.5, 7.9, 2, .35]]) K.lights.push({x, y, h: top + .3, color: '#c070ff', radius: rad, intensity: k, flicker: .15});
    if (K.layout.fall) K.lights.push({x: K.layout.fall.foot.x, y: K.layout.fall.foot.y + .5, h: .4, color: '#c070ff', radius: 2.4, intensity: .5, flicker: .15});
  }
  K.finish(B);
  B.hole = (x, y, c) => !!(c && behindPlateau(c, x, y));
}
// 5x6 glyphs (pseudo runes) from a seed
function glyph(fn, seed) {
  const r = rng(seed * 97 + 3), strokes = 2 + (r() * 2 | 0);
  fn(2, 0); for (let i = 0; i < 6; i++) fn(2, i);
  for (let s = 0; s < strokes; s++) { const y = 1 + (r() * 4 | 0), d = r() < .5 ? -1 : 1; fn(2 + d, y); fn(2 + d * 2, y + (r() < .5 ? 1 : 0)); }
}
function glyphPx(i, u, v) {   // sampled rune for the rune circle: a stem with one or two side strokes; u, v in 0..1
  const gx = Math.min(4, Math.floor(u * 5)), gy = Math.min(2, Math.floor(v * 3));
  if (gx === 2) return true;
  if (hsh(i, gy, 8) > .5) return false;
  return hsh(i, gy, 9) < .5 ? gx < 2 : gx > 2;
}

// ============================================================ props
const M = ctx => ({W: m => Math.round(m * ctx.PPM), H: m => Math.round(m * ctx.PPMH), D: m => Math.max(2, Math.round(m * ctx.PPM * .35))});

// ---- wall decorations per biome (applied to the top face strip and the front face)
function topCover(P, S, x, y, w, h, gx, gy) {   // the top surface: moss / ash / snow / rune seam
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const wx = gx + i, wy = gy + j; if (!P.on(x + i, y + j)) continue;
    if (S.id === 'ember') P.p(x + i, y + j, S.ash, h > 8 ? (vn(wx / 5, wy / 6, 3) > .62 ? 1 : 2) : P.tone(x + i, y + j) === 0 ? (vn(wx / 5, wy / 4, 3) > .7 ? 1 : 0) : 1);
    else if (S.id === 'frost') P.p(x + i, y + j, S.snow, j === 0 || (i === w - 1) ? 1 : vn(wx / 6, wy / 5, 4) > .72 ? 1 : 0);
    else if (S.id === 'ruins') { const m = vn(wx / 6, wy / 5, 31) + (h > 8 && (i === 0 || i === w - 1) ? .1 : 0); if (m > .72) P.p(x + i, y + j, S.grass, m > .76 ? 0 : 1); }
  }
}
function frontDecor(P, E, S, x, y, w, h, gx, {low = false, base = true} = {}) {
  for (let i = 0; i < w; i++) {
    const wx = gx + i;
    if (S.id === 'ruins') {
      const m = vn(wx / 10, 0, 31);
      if (m > .56) { const L = Math.floor((m - .56) * 16 + hsh(wx, 1) * 3); for (let r = 0; r < L; r++) P.p(x + i, y + r, S.grass, r === L - 1 ? 2 : r < 1 ? 0 : 1); }
      if (m > .64) { const up = m > .72 ? 2 : 1; for (let r = 1; r <= up; r++) P.p(x + i, y - r - 0, S.grass, 0); }
      if (!low && hsh(wx, 3) < .07 && m > .38) {   // hanging ivy
        const L = 8 + (hsh(wx, 4) * (h - 8) | 0);
        for (let r = 0; r < L; r++) { const sx = x + i + Math.round(Math.sin(r * .45 + wx) * .7); P.p(sx, y + r, S.grass, r % 4 === 1 ? 2 : 1); if (r % 3 === 0) P.p(sx + (r % 6 ? 1 : -1), y + r, S.grass, r % 2 ? 1 : 0); }
      }
      if (base) { const g = vn(wx / 6, 5, 32); if (g > .52) { const gh = Math.floor((g - .52) * 14) + (i % 2); for (let r = 0; r < gh; r++) P.p(x + i, y + h - 1 - r, S.grass, r === gh - 1 ? 0 : 1); } }
    } else if (S.id === 'ember') {
      if (hsh(wx, 1) < .3) P.p(x + i, y, S.ash, 1);
      if (hsh(wx, 2) < .08) P.p(x + i, y + 1, S.ash, 2);
      if (base) for (let r = 0; r < 3; r++) if (vn(wx / 5, r, 6) > .45) P.shift(x + i, y + h - 1 - r, 1, 2);
      if (!low && hsh(wx, 11) < .03) {   // a glowing crack up from the foot of the wall
        let cx = x + i; const L = 4 + (hsh(wx, 12) * 8 | 0);
        for (let r = 0; r < L; r++) { glowAt(P, E, cx, y + h - 2 - r, r < 2 ? '#ffb050' : '#e0541e', S.crust); if (hsh(wx, r) < .4) cx += hsh(wx, r + 9) < .5 ? -1 : 1; }
      }
    } else if (S.id === 'frost') {
      const ov = 1 + Math.floor(vn(wx / 5, 1, 42) * 3);
      for (let r = 0; r < ov; r++) P.p(x + i, y + r, S.snow, r === ov - 1 ? 2 : 1);
      const up = Math.floor(vn(wx / 7, 0, 41) * 3.4); for (let r = 1; r <= up; r++) P.p(x + i, y - r, S.snow, r === up ? 1 : 0);
      if (!low && hsh(wx, 43) < .16) { const L = 2 + (hsh(wx, 44) * 6 | 0); for (let r = 0; r < L; r++) P.p(x + i, y + ov + r, S.ice, r === L - 1 ? 2 : r < 2 ? 0 : 1); }
      if (base) { const dh = Math.floor(vn(wx / 8, 7, 45) * 7) - 2; for (let r = 0; r < dh; r++) P.p(x + i, y + h - 1 - r, S.snow, r === dh - 1 ? 0 : 1); }
    } else if (S.id === 'rift') {
      if (vn(wx / 8, 2, 51) > .66) { glowAt(P, E, x + i, y, S.runeDim, null); }
    }
  }
}
function runeBlocks(P, E, S, x, y) { return (bid, k, i, ya, yb) => {
  if (S.id !== 'rift' || k < 1 || hsh(bid, k, 77) > .14 || yb - ya < 7) return;
  glyph((a, b) => glowAt(P, E, x + i + 4 + a - 2, ya + 1 + b, b % 2 ? S.rune : mixHex(S.rune, '#ffffff', .3), '#1d1731'), bid);
}; }

function wallEW(p, ctx, S, low) {   // wall_n / wall_s: 1 m segments along x, world-aligned pattern
  const {PPM, PPMY} = ctx, m = M(ctx), xa = Math.round((p.x - .5) * PPM), xb = Math.round((p.x + .5) * PPM), w = xb - xa;
  const h = m.H(low ? S.lowH : S.wallH), td = m.D(.5), up = 3, H = up + td + h;
  const off = Math.round((p.y + .25) * PPMY) - Math.round(p.y * PPMY);
  return build(w, H, [Math.round(p.x * PPM) - xa, H - off], (P, E) => {
    for (let j = 0; j < td; j++) for (let i = 0; i < w; i++) { const J = joints(99, xa, w, 3, [16, 26]).J; P.p(i, up + j, S.wall, J.has(i) || j === 0 ? 1 : 0); }
    topCover(P, S, 0, up, w, td, xa, 0);
    masonry(P, 0, up + td, w, h, S, xa, {ch: low ? 7 : 9, seed: low ? 2 : 1, onBlock: runeBlocks(P, E, S, 0, up + td)});
    frontDecor(P, E, S, 0, up + td, w, h, xa, {low});
    const nb = dx => ctx.layout.props.some(q => q.kind === p.kind && Math.abs(q.x - p.x - dx) < .01 && q.y === p.y);
    P.outline({wrapX: [nb(-1), nb(1)]});   // run ends (gates) get an outline, joins between segments don't
  });
}
function wallNS(p, ctx, S) {   // wall_w / wall_e: seen edge-on: a long top strip + the front (south) end face
  const {PPM, PPMY} = ctx, m = M(ctx), ya = Math.round((p.y - .5) * PPMY), yb = Math.round((p.y + .5) * PPMY), span = yb - ya;
  const xa = Math.round((p.x - .25) * PPM), xb = Math.round((p.x + .25) * PPM), w = xb - xa, h = m.H(S.wallH), H = span + h;
  return build(w, H, [Math.round(p.x * PPM) - xa, Math.round(p.y * PPMY) - (ya - h)], (P, E) => {
    // capstones along the run, joints aligned to world y
    let cap = 0;
    for (let j = 0; j < span; j++) {
      const wy = ya + j, joint = Math.floor(wy / 19 + hsh(Math.floor(wy / 19), 1) * .3) !== Math.floor((wy - 1) / 19 + hsh(Math.floor((wy - 1) / 19), 1) * .3);
      for (let i = 0; i < w; i++) P.p(i, j, S.wall, joint ? 1 : i === 0 ? 0 : i === w - 1 ? 1 : 0);
    }
    topCover(P, S, 0, 0, w, span, xa, ya);
    if (S.id === 'rift') for (let j = 0; j < span; j++) if (vn(ya + j, 3, 52) > .6 || (ya + j) % 19 === 0) glowAt(P, E, w >> 1, j, S.runeDim, null);
    // only the last segment of a run shows its front face; the others are covered by the next segment, and emissive
    // pixels are added after all sprites, so glow on a hidden face would shine through
    const last = !ctx.layout.props.some(q => q.kind === p.kind && q.x === p.x && Math.abs(q.y - p.y - 1) < .01), EF = last ? E : new Pix(w, H);
    masonry(P, 0, span, w, h, S, xa, {seed: 4, onBlock: runeBlocks(P, EF, S, 0, span)});
    frontDecor(P, EF, S, 0, span, w, h, xa, {base: true});
    P.outline({wrapTop: true});
  });
}
// a box with a top face and a stone front (towers, gateposts, plinths)
function block(P, E, S, x, y, w, td, h, gx, o = {}) {
  for (let j = 0; j < td; j++) for (let i = 0; i < w; i++) P.p(x + i, y + j, o.R || S.wall, j === 0 || i === w - 1 ? 1 : 0);
  if (o.cover !== false) topCover(P, S, x, y, w, td, gx, y * 7);
  masonry(P, x, y + td, w, h, S, gx, {ch: o.ch || 8, bw: o.bw || [9, 15], seed: o.seed || 6, R: o.R || S.wall, RB: o.RB || S.wallB, onBlock: runeBlocks(P, E, S, x, y + td)});
}
function tower(p, ctx, S) {
  const m = M(ctx), w = m.W(1.5), td = m.D(1.5), h = m.H(2.3), mh = 7, up = S.id === 'rift' ? 20 : 4, H = up + mh + td + h, off = Math.round(.45 * ctx.PPMY);
  const gx = Math.round(p.x * ctx.PPM) - (w >> 1);
  return build(w, H, [w >> 1, H - off], (P, E) => {
    const y0 = up + mh;   // top of the tower's roof face
    for (let j = 0; j < td; j++) for (let i = 0; i < w; i++) P.p(i, y0 + j, S.wall, j < 3 || i < 3 ? 3 : 2);   // roof floor, in the parapet's shade
    const merl = i => { const k = Math.floor((i - 1) / 8); return (i - 1) % 8 < 5 && i > 0 && i < w - 1 && !(S.id === 'ruins' && hsh(k, p.x | 0) < .3 && k > 0); };
    for (let i = 0; i < w; i++) {   // back parapet: a continuous rim with merlons on it
      for (let j = 0; j < 3; j++) P.p(i, y0 - 3 + j, S.wall, j === 0 ? 0 : 1);
      if (merl(i)) for (let j = 0; j < mh - 4; j++) P.p(i, y0 - mh + 1 + j, S.wall, j === 0 ? 0 : 1);
    }
    masonry(P, 0, y0 + td, w, h, S, gx, {ch: 8, bw: [9, 15], seed: 7, onBlock: runeBlocks(P, E, S, 0, y0 + td)});
    for (let i = 0; i < w; i++) {   // front parapet: merlons on the front edge + a ledge course
      if (merl(i)) for (let j = 0; j < mh; j++) P.p(i, y0 + td - mh + j, S.wall, j === 0 ? 0 : j === 1 ? 0 : 1);
      P.p(i, y0 + td, S.wall, 0); P.p(i, y0 + td + 1, S.wall, 2);
    }
    // a dark arrow slit
    const sx = (w >> 1) - 1, sy = y0 + td + 14;
    for (let j = 0; j < 10; j++) for (let i = 0; i < 2; i++) P.p(sx + i, sy + j, S.wall, 3);
    if (S.id === 'ember') for (let j = 2; j < 9; j++) glowAt(P, E, sx + (j % 3 === 0 ? 1 : 0), sy + j, j > 5 ? '#ffb050' : '#e0641e', S.crust);
    for (let i = 0; i < w; i++) if (merl(i)) topCover(P, S, i, y0 + td - mh, 1, 1, gx + i, 0);
    topCover(P, S, 0, y0 - mh + 2, w, 1, gx, 3);
    frontDecor(P, E, S, 0, y0 + td + 2, w, h - 2, gx, {});
    P.outline();
    if (S.id === 'rift') {   // a crystal hovering over the tower
      crystal(P, E, S, w >> 1, 1, 5, 15, 11);
      return {lights: [{dx: 0, dy: 0, h: (H - off - 9) / ctx.PPMH, color: '#d070ff', radius: 3, intensity: .7, flicker: .15}]};
    }
  });
}
function gatepost(p, ctx, S) {
  const m = M(ctx), w = m.W(.72), td = m.D(.72), h = m.H(1.7), cap = 5, extra = S.id === 'rift' ? 16 : S.id === 'ruins' ? 6 : 3;
  const W = w + 4, H = extra + cap + td + h, off = Math.round(.25 * ctx.PPMY), gx = Math.round(p.x * ctx.PPM) - (w >> 1);
  return build(W, H, [W >> 1, H - off], (P, E) => {
    const y0 = extra;
    block(P, E, S, 2, y0 + cap, w, td, h, gx, {ch: 9, seed: 8, cover: false});
    // cap stone: a slab wider than the post
    for (let j = 0; j < cap; j++) for (let i = 0; i < W; i++) P.p(i, y0 + j + td - 2, S.wall, j === 0 ? 0 : j === cap - 1 ? 2 : 1);
    for (let j = 0; j < td - 2; j++) for (let i = 1; i < W - 1; i++) P.p(i, y0 + j, S.wall, 0);
    topCover(P, S, 1, y0, W - 2, td - 2, gx, 5);
    if (S.id === 'ruins') { for (let k = 0; k < 3; k++) for (let i = 3 + k * 2; i < W - 3 - k * 2; i++) P.p(i, y0 - 1 - k, S.wall, k === 2 || i === 3 + k * 2 ? 0 : i >= W - 5 - k * 2 ? 2 : 1); for (let i = 3; i < W - 3; i++) if (vn(i / 3, 0, p.x) > .5) P.p(i, y0 - (i % 3 ? 0 : 1), S.grass, i % 2 ? 0 : 1); }
    frontDecor(P, E, S, 2, y0 + cap + td, w, h, gx, {});
    if (S.id === 'ember') for (let j = 0; j < 6; j++) glowAt(P, E, W >> 1, y0 + cap + td + 8 + j, j < 3 ? '#ffb050' : '#e0541e', S.crust);
    P.outline();
    if (S.id === 'rift') crystal(P, E, S, W >> 1, 1, 4, 11, 12 + (p.x | 0));
  });
}
// a crystal: elongated hexagonal prism, pointed at both ends; lit left facet, emissive core and a faint inner glow
function crystal(P, E, S, cx, top, hw, h, seed, o = {}) {
  const R = o.R || S.crystal, glow = o.glow || ['#ffe0fa', S.rune], inner = hex(o.inner || '#5a2468'), lean = o.lean || 0;
  const cap = Math.min(h / 2.2, hw * 1.3), sh = (x, y) => [x + lean * (1 - (y - top) / h), y];
  const pts = [[cx, top], [cx + hw, top + cap], [cx + hw, top + h - cap], [cx, top + h], [cx - hw, top + h - cap], [cx - hw, top + cap]].map(([x, y]) => sh(x, y));
  const mid = y => cx + lean * (1 - (y + .5 - top) / h);
  P.poly(pts, (x, y) => P.p(x, y, R, x + .5 < mid(y) - hw / 3 ? 0 : x + .5 < mid(y) + hw / 3 ? 1 : 2));
  P.outline({only: [R.id]});
  if (o.dim === 2) return pts;
  P.poly(pts, (x, y) => { if (P.mat(x, y) === R.id && P.tone(x, y) < 3) E.c(x, y, inner); });
  if (!o.dim) for (let y = Math.round(top + cap * .6); y < top + h - cap * .6; y++) glowAt(P, E, Math.round(mid(y) - .5) - (hw > 3 ? 1 : 0), y, y < top + h * .45 ? glow[0] : glow[1], null);
  return pts;
}

// ---- pillars
function column(P, E, S, cx, base, shaftH, o = {}) {
  const pw = o.pw || 27, sw = o.sw || 19, ph = 8, ptd = 5, cw = o.cw || 25;
  const R = S.wall, RB = S.wallB;
  // plinth
  for (let j = 0; j < ptd; j++) for (let i = 0; i < pw; i++) P.p(cx - (pw >> 1) + i, base - ph - ptd + j, R, 0);
  for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) P.p(cx - (pw >> 1) + i, base - ph + j, R, j === 0 ? 2 : i >= pw - 3 ? 2 : 1);
  // shaft: cylinder bands + flutes
  const top = base - ph - ptd - shaftH;
  for (let y = top; y < base - ph - ptd + 2; y++) {
    const broken = o.jag ? o.jag(y - top) : 0;
    for (let i = 0; i < sw; i++) {
      if (broken && (i < broken[0] || i >= sw - broken[1])) continue;
      const u = 2 * (i + .5) / sw - 1, flute = i % 4 === 2 && i > 1 && i < sw - 2;
      let t = u < -.82 ? 1 : u < -.2 ? 0 : u < .45 ? 1 : 2; if (flute) t = Math.min(2, t + 1);
      P.p(cx - (sw >> 1) + i, y, (o.alt && hsh(y >> 3, 1) < .3) ? RB : R, t);
    }
  }
  // drums: a thin joint every ~0.6 m
  for (let y = base - ph - ptd - 16; y > top + 3; y -= 17) for (let i = 1; i < sw - 1; i++) if (P.on(cx - (sw >> 1) + i, y)) P.p(cx - (sw >> 1) + i, y, R, 2);
  if (!o.jag) {   // capital: echinus + abacus
    for (let j = 0; j < 3; j++) for (let i = -2; i < sw + 2; i++) P.p(cx - (sw >> 1) + i, top - j - 1, R, j === 2 ? 0 : 1);
    for (let j = 0; j < 4; j++) for (let i = 0; i < cw; i++) P.p(cx - (cw >> 1) + i, top - 4 - 4 + j, R, j === 0 ? 0 : j === 3 ? 2 : i >= cw - 2 ? 2 : 1);
    for (let j = 0; j < 4; j++) for (let i = 1; i < cw - 1; i++) P.p(cx - (cw >> 1) + i, top - 8 - 4 + j, R, 0);
  }
  return top;
}
function pillar(p, ctx, S, broken) {
  const m = M(ctx), H0 = m.H(broken ? 1.25 : 3), w = broken ? 44 : 31, top = broken ? 6 : 18, H = H0 + top + 4, base = H - 2;
  const v = p.variant | 0;
  return build(w, H, [broken ? 14 : w >> 1, H - 3], (P, E) => {
    const cx = broken ? 14 : w >> 1, shaftH = H0 - 13 - (broken ? 0 : 12);
    const jag = broken ? (r => r < 7 ? [Math.max(0, 7 - r - (hsh(r, 3) * 3 | 0)) + (r < 3 ? 3 : 0), r < 5 ? 2 + (hsh(r, 4) * 4 | 0) : 0] : 0) : null;
    const ttop = column(P, E, S, cx, base, shaftH, {jag, alt: true});
    if (broken) {   // a fallen drum lying beside it
      const fx = 27, fy = base - 7;
      for (let j = 0; j < 9; j++) for (let i = 0; i < 16; i++) P.p(fx + i, fy - 4 + j, S.wall, j < 2 ? 0 : j > 6 ? 2 : 1);
      for (let j = 0; j < 9; j++) for (let i = 0; i < 3; i++) P.p(fx + 16 + i, fy - 4 + j, S.wall, i === 0 ? 1 : 2);
      for (const [a, b] of [[20, 4], [23, 5], [40, 3]]) P.p(a, base - b + 3, S.wall, 1);
    }
    if (S.id === 'ruins') {   // ivy up the shaft, moss on the capital
      const r = rng(v * 7 + 11 + (broken ? 5 : 0)), vx = cx - 6 + (r() * 5 | 0);
      let x = vx; for (let y = base - 10; y > ttop + 8 + r() * 30; y--) { x += Math.round(Math.sin(y * .23 + v) * .6); P.p(x, y, S.grass, 1); if (y % 3 === 0) P.p(x + (y % 2 ? 1 : -1), y, S.grass, y % 6 ? 0 : 2); if (y % 7 === 0) P.p(x + 1, y - 1, S.grass, 0); }
      for (let i = -12; i < 12; i++) if (vn(i / 3, v, 9) > .45) { const d = 1 + (vn(i / 2, v, 10) * 3 | 0); for (let j = 0; j < d; j++) P.p(cx + i, (broken ? ttop : ttop - 12) + j, S.grass, j ? 1 : 0); }
      for (let i = -13; i < 14; i++) if (vn(i / 3, 2, v) > .5) P.p(cx + i, base - 1 - (i & 1), S.grass, 0);
    } else if (S.id === 'ember') {
      topCover(P, S, cx - 12, broken ? ttop : ttop - 12, 24, 3, v * 13, 0);
      for (let k = 0; k < 2; k++) { let x = cx - 4 + k * 7, y = base - 14 - (hsh(v, k) * 20 | 0); for (let r = 0; r < 9; r++) { glowAt(P, E, x, y - r, r < 3 ? '#ffb050' : '#e0541e', S.crust); if (hsh(v, r + k * 9) < .4) x += hsh(r, k) < .5 ? -1 : 1; } }
    } else if (S.id === 'frost') {
      for (let i = -12; i < 13; i++) { const d = 1 + (vn(i / 3, v, 9) * 3 | 0); for (let j = 0; j < d; j++) P.p(cx + i, (broken ? ttop : ttop - 12) - 1 + j, S.snow, j ? 1 : 0); if (!broken && hsh(i, v) < .2) for (let j = 0; j < 2 + hsh(i, 5) * 4; j++) P.p(cx + i, ttop - 4 + j, S.ice, j < 2 ? 0 : 1); }
      for (let i = -14; i < 14; i++) { const d = vn(i / 4, 3, v) * 6 | 0; for (let j = 0; j < d; j++) P.p(cx + i, base - 1 - j, S.snow, j === d - 1 ? 0 : 1); }
    }
    P.outline();
    if (S.id === 'rift') {   // rune rings around the shaft
      for (const ry of [base - 30, base - 58]) if (ry > ttop + 4) for (let i = 1; i < 18; i++) if ((i + v) % 4 !== 0) glowAt(P, E, cx - 9 + i, ry, i % 2 ? S.rune : S.runeDim, null);
      if (!broken) crystal(P, E, S, cx, 1, 4, 12, v + 40);
    }
  });
}
function rubble(p, ctx, S) {
  return build(40, 22, [20, 20], (P, E) => {
    const r = rng(17 + (p.variant | 0));
    const blocks = [[4, 13, 11, 6], [15, 9, 13, 10], [27, 14, 9, 6], [10, 17, 8, 4], [29, 18, 7, 3]];
    for (const [x, y, w, h] of blocks) {
      const td = Math.max(2, h >> 1);
      for (let j = 0; j < td; j++) for (let i = 0; i < w; i++) P.p(x + i, y - td + j, S.wall, 0);
      for (let j = 0; j < h - td; j++) for (let i = 0; i < w; i++) P.p(x + i, y + j, r() < .12 ? S.wallB : S.wall, i === w - 1 ? 2 : 1);
    }
    for (let i = 0; i < 8; i++) P.p(2 + r() * 36, 19 + r() * 3, S.wall, 2);
    for (let y = 0; y < 22; y++) for (let x = 0; x < 40; x++) if (P.on(x, y) && P.tone(x, y) === 0) {   // only the top faces get ash / snow / moss
      if (S.id === 'ember') P.p(x, y, S.ash, hsh(x, y) < .3 ? 1 : 0);
      else if (S.id === 'frost') P.p(x, y, S.snow, 0);
      else if (S.id === 'ruins' && vn(x / 4, y / 3, 6) > .55) P.p(x, y, S.grass, 1);
    }
    P.outline();
    if (S.id === 'ember') for (let i = 0; i < 5; i++) glowAt(P, E, 16 + i, 20 - (i & 1), '#e0541e', S.crust);
    if (S.id === 'rift') crystal(P, E, S, 21, 2, 2, 6, 5);
  });
}

// ---- dummies (~1.5 m, pivot at the feet)
function dummy(p, ctx, S) {
  const m = M(ctx), H = m.H(1.5) + 2, W = 26;
  return build(W, H, [13, H], (P, E) => {
    const cx = 13, b = H - 1, headY = b - 38;
    if (S.id === 'rift') {
      for (let y = b - 16; y <= b; y++) for (let i = 0; i < 4; i++) P.p(cx - 2 + i, y, S.wall, i === 0 ? 0 : i === 3 ? 2 : 1);
      for (let i = -5; i <= 5; i++) for (let j = 0; j < 3; j++) P.p(cx + i, b - 2 + j - 1, S.wall, j === 0 ? 0 : 1);
      P.outline();
      crystal(P, E, S, cx, headY - 2, 7, 26, 3);
      for (const [dx, dy] of [[-9, 8], [9, 12], [-7, 20]]) crystal(P, E, S, cx + dx, headY + dy, 2, 6, dx);
      for (let k = -2; k <= 2; k++) glowAt(P, E, cx + k, headY + 11, '#ffffff', null);
      glowAt(P, E, cx, headY + 10, '#ffffff', null); glowAt(P, E, cx, headY + 12, '#ffffff', null);
      return;
    }
    const post = S.id === 'ember' ? S.wood : S.wood;
    for (let y = headY + 8; y <= b; y++) for (let i = 0; i < 3; i++) P.p(cx - 1 + i, y, post, i === 0 ? 0 : i === 2 ? 2 : 1);
    for (let i = -6; i <= 6; i++) { P.p(cx + i, b, post, 2); P.p(cx + i, b - 1, post, 1); }
    for (let i = -11; i <= 11; i++) for (let j = 0; j < 2; j++) P.p(cx + i, headY + 13 + j, post, j === 0 ? 0 : 2);   // arms
    if (S.id === 'ember') {   // charred planks + iron helmet and breastplate
      for (let y = headY + 10; y < headY + 30; y++) for (let i = -6; i <= 6; i++) { const plank = (i + 6) % 4 === 3; P.p(cx + i, y, S.wood, plank ? 3 : i < -3 ? 0 : i > 3 ? 2 : 1); }
      P.blob(cx, headY + 18, 7, 6, S.metal, {s: 5, top: headY + 13});
      P.blob(cx, headY + 4, 6, 6, S.metal, {s: 6});
      for (let i = -4; i <= 4; i++) P.p(cx + i, headY + 5, S.metal, 3);
    } else {
      const body = S.straw;
      P.blob(cx, headY + 20, 7, 10, body, {s: 3, j: .3});
      for (let i = -7; i <= 7; i++) { if (P.on(cx + i, headY + 14)) P.p(cx + i, headY + 14, S.cloth, 2); if (P.on(cx + i, headY + 26)) P.p(cx + i, headY + 26, S.cloth, 2); }
      P.blob(cx, headY + 5, 5, 6, S.cloth, {s: 4});
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) P.p(cx + s * (12 + (k & 1)), headY + 12 + k, body, k === 1 ? 0 : 1);
    }
    // painted target on the chest
    const ty = headY + 20;
    P.disk(cx + .5, ty + .5, 3.2, (x, y) => P.p(x, y, RED, 1)); P.disk(cx + .5, ty + .5, 1.6, (x, y) => P.p(x, y, S.id === 'ember' ? S.ash : S.cloth, 0)); P.p(cx, ty, RED, 0);
    if (S.id === 'frost') {   // frozen: ice crust over the straw, snow on the head and shoulders, icicles
      for (let y = headY; y < b - 12; y++) for (let x = 0; x < W; x++) if (P.on(x, y) && P.mat(x, y) !== RED.id && vn(x / 3, y / 4, 8) > .58) P.p(x, y, S.ice, P.tone(x, y) === 2 ? 2 : 1);
      for (let i = -5; i <= 5; i++) P.p(cx + i, headY - 1 + (Math.abs(i) > 3 ? 1 : 0), S.snow, 0);
      for (let i = -11; i <= 11; i++) if (Math.abs(i) > 3) P.p(cx + i, headY + 12, S.snow, 0);
      for (const i of [-10, -7, 6, 9]) for (let j = 0; j < 3 + (i & 1) * 2; j++) P.p(cx + i, headY + 15 + j, S.ice, j < 1 ? 0 : 1);
    }
    P.outline();
    if (S.id === 'ember') for (const [x, y] of [[cx - 4, headY + 26], [cx + 3, headY + 12], [cx + 5, headY + 27], [cx - 1, b - 6]]) glowAt(P, E, x, y, '#ff8a3a', S.crust);
  });
}

// ---- light sources
function brazier(p, ctx, S) {   // p.model (the 3D view): the bowl and tripod are a real 3D model there; this paints the
  // coals and a fuller, three-tongue flame only (same pivot and heights, so the model's rim meets the coals)
  const m = M(ctx), col = S.braz[(p.light | 0) % 3], bowlH = m.H(.95), W = 22, H = bowlH + (p.model ? 26 : 18);
  return build(W, H, [11, H], (P, E) => {
    const b = H - 1, by = b - bowlH, cx = 11, R = S.metal;
    if (!p.model) {
      // bowl
      for (let y = by; y < by + 7; y++) { const hw = 9 - Math.max(0, y - by - 2) * 1.2; for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) P.p(x, y, R, y === by ? 0 : x < cx - hw + 3 ? 0 : x > cx + hw - 3 ? 2 : 1); }
      for (let x = cx - 9; x < cx + 9; x++) P.p(x, by - 1, R, 1);
      P.outline({only: [R.id]});
      // tripod legs (drawn after the outline so they stay 1 px lines)
      P.line(cx - 5, by + 7, cx - 8, b, (x, y) => P.p(x, y, R, 2)); P.line(cx + 5, by + 7, cx + 8, b, (x, y) => P.p(x, y, R, 3));
      P.line(cx, by + 7, cx, b - 1, (x, y) => P.p(x, y, R, 2)); P.line(cx - 6, by + 16, cx + 6, by + 16, (x, y) => P.p(x, y, R, 3));
    }
    // coals + flame (emissive); p.unlit: cold ash, no flame, no light
    const c0 = cx - 7, c1 = p.model ? cx + 8 : cx + 7;   // (the 3D bowl is a pixel wider)
    // (p.fx: the host's 3D bowl has its own coal bed and glowing coals, so no painted coal row: it read as a flat line)
    if (p.unlit) { if (!p.fx) for (let x = c0; x < c1; x++) P.p(x, by - 1, R, hsh(x, 3) < .4 ? 2 : 3); return; }
    if (!p.fx) for (let x = c0; x < c1; x++) glowAt(P, E, x, by - 1, hsh(x, 3) < .4 ? mixHex(col, '#ffffff', .5) : mixHex(col, '#000000', .35), '#2a1a18');
    if (p.fx) { /* p.fx: the host draws a live flame here (render3d lights.js), so only the coals */ }
    else if (p.model) {   // side tongues first, the tall middle one over them (its hot core wins)
      flame(E, cx - 3, by - 1, 6, 11, col, -2); flame(E, cx + 4, by - 1, 6, 13, col, 2);
      flame(E, cx + .5, by - 1, 11, 22, col, (p.light | 0) - 1);
    } else flame(E, cx + .5, by - 1, 10, 16, col, (p.light | 0) - 1);
    // the halo sits on the flame's middle: h = its height above the pivot (the pivot row is H)
    return {lights: [{dx: 0, dy: 0, h: (H - (by - 8)) / ctx.PPMH, color: col, radius: 3.5, intensity: 1, flicker: S.id === 'rift' && (p.light | 0) === 2 ? .15 : .45}]};
  });
}
function torch(p, ctx, S) {   // wall torch: the bracket reaches right to the east wall
  // p.sconce (the 3D view): stick + cup only; its bracket is a real 3D arm there, so it reads right from every side.
  // p.unlit: a charred tip, no flame, no light (a fire arrow lights it)
  const m = M(ctx), reach = p.sconce ? 0 : Math.round(.6 * ctx.PPM), W = Math.max(9, reach + 6), H = m.H(1.85), sx = 4;
  return build(W, H, [sx, H], (P, E) => {
    const b = H - 1, ay = b - m.H(1.05), ty = b - m.H(1.5);
    if (!p.sconce) {
      P.line(sx + 1, ay, reach + 1, ay, (x, y) => P.p(x, y, S.metal || STYLES.ruins.metal, 1)); P.line(sx + 2, ay + 5, reach, ay - 1, (x, y) => P.p(x, y, S.metal || STYLES.ruins.metal, 2));
      for (let j = -3; j <= 3; j++) for (let i = 0; i < 3; i++) P.p(reach + i, ay + j, S.metal || STYLES.ruins.metal, i === 0 ? 0 : 1);
    }
    const WD = S.wood || STYLES.ruins.wood;
    for (let y = ty; y <= ay + 3; y++) for (let i = 0; i < 3; i++) P.p(sx - 1 + i, y, WD, i === 0 ? 0 : i === 2 ? 2 : 1);
    for (let i = -2; i <= 2; i++) P.p(sx + i, ty, S.metal || STYLES.ruins.metal, 1);
    if (p.unlit) for (let i = -1; i <= 1; i++) P.p(sx + i, ty - 1, WD, 3);
    P.outline();
    if (p.unlit) return;
    if (!p.fx) flame(E, sx + .5, ty, 7, 12, S.torch, 1);   // p.fx: the host draws a live flame here
    return {lights: [{dx: 0, dy: 0, h: (H - (ty - 6)) / ctx.PPMH, color: S.torch, radius: 4, intensity: .9, flicker: .6}]};
  });
}

// ---- small scatter
function bush(p, ctx, S) {
  const v = p.variant | 0;
  return build(26, 20, [13, 19], (P, E) => {
    const r = rng(v * 17 + 5);
    if (S.id === 'ruins') {
      const bl = [[8, 12, 6, 5], [16, 11, 7, 6], [12, 8, 6, 5], [19, 14, 5, 4]].slice(0, 3 + (v % 2));
      for (const [x, y, a, b] of bl) P.blob(x, y, a, b, S.leaf, {s: x + v, j: .35, edge: .5, bias: -(y - 10) * .03});
      P.outline();
    } else if (S.id === 'ember') {   // a dead thorn shrub, a few twigs still smouldering
      const tw = (x, y, a, l, d) => { const ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l; P.line(x, y, ex, ey, (px, py) => P.p(px, py, S.wood, d ? 1 : 2)); if (d < 2) { tw(ex, ey, a - .5, l * .6, d + 1); tw(ex, ey, a + .45, l * .55, d + 1); } else if (hsh(ex, ey) < .35) glowAt(P, E, ex, ey, '#ff8a3a', S.crust); };
      for (let k = 0; k < 4; k++) tw(13 + k - 2, 19, -Math.PI / 2 + (k - 1.5) * .45, 7 + r() * 3, 0);
    } else if (S.id === 'frost') {
      P.blob(13, 13, 9, 6, S.pine, {s: v + 3, j: .3, edge: .5});
      for (let x = 3; x < 23; x++) { const d = 2 + (vn(x / 3, v, 4) * 3 | 0); for (let j = 0; j < d; j++) { const y = 7 + j + Math.round(Math.abs(x - 13) * .35); if (P.on(x, y) || j === 0) P.p(x, y, S.snow, j === 0 ? 0 : 1); } }
      P.outline();
    } else {   // rift: a cluster of void coral with glowing tips
      for (let k = 0; k < 5; k++) { let x = 7 + k * 3 + (r() * 2 | 0), y = 19; const L = 6 + (r() * 9 | 0); for (let i = 0; i < L; i++) { P.p(x, y - i, S.wall, i % 3 === 0 ? 0 : 1); if (hsh(k, i) < .25) x += k < 2 ? -1 : 1; } glowAt(P, E, x, y - L, k % 2 ? S.rune : '#ffd8f8', null); }
      P.outline();
    }
  });
}
function rock(p, ctx, S) {
  const v = p.variant | 0;
  return build(20, 14, [10, 13], (P, E) => {
    const R = S.rock;
    P.blob(9 + v, 8, 7 - v * .6, 5, R, {s: v + 7, j: .25, hi: .62});
    P.blob(14, 10, 4, 3, R, {s: v + 8, j: .2});
    if (S.id === 'frost') for (let x = 2; x < 18; x++) for (let y = 0; y < 14; y++) if (P.on(x, y) && !P.on(x, y - 1)) { P.p(x, y, S.snow, 0); P.p(x, y + 1, S.snow, 1); break; }
    if (S.id === 'ruins') for (let x = 2; x < 18; x++) for (let y = 0; y < 14; y++) if (P.on(x, y) && !P.on(x, y - 1)) { if (vn(x / 3, v, 5) > .5) P.p(x, y, S.grass, 0); break; }
    P.outline();
    if (S.id === 'rift' && v === 1) crystal(P, E, S, 9, 0, 2, 6, 9);
  });
}
function tuft(p, ctx, S) {
  const v = p.variant | 0;
  if (S.id === 'ruins') return build(9, 8, [4, 7], P => {
    const bl = [[1, 4], [3, 6], [4, 7], [6, 5], [8, 3]].slice(v % 2, 5 - (v === 2 ? 1 : 0));
    for (const [x, h] of bl) for (let j = 0; j < h; j++) P.p(x + (j > 3 ? (x < 4 ? -1 : 1) : 0), 7 - j, S.grass, j === h - 1 ? 0 : j < 2 ? 2 : 1);
  });
  if (S.id === 'ember') return build(12, 5, [6, 3], (P, E) => {   // a small vent in the ash
    for (let i = 1; i < 11; i++) P.p(i, 2, S.wall, i === 1 || i === 10 ? 2 : 3);
    for (let i = 3; i < 9; i++) glowAt(P, E, i, 2, i === 5 || i === 6 ? '#ffd070' : '#ff7a2e', S.crust);
    for (let i = 2; i < 10; i++) { P.p(i, 1, S.ash, 0); P.p(i, 3, S.wall, 2); }
  });
  if (S.id === 'frost') return build(10, 7, [5, 6], P => {
    for (let i = 1; i < 9; i++) P.p(i, 6, S.snow, i < 3 ? 0 : 1); for (let i = 2; i < 8; i++) P.p(i, 5, S.snow, 0);
    for (const [x, h] of [[3, 3], [5, 4], [6, 2]]) for (let j = 0; j < h; j++) P.p(x, 4 - j, STYLES.ruins.bark, j === h - 1 ? 1 : 2);
  });
  return build(9, 10, [4, 9], (P, E) => { crystal(P, E, S, 4, 1 + v, 2, 7 - v, v + 20); for (let i = 1; i < 8; i++) P.p(i, 9, S.floor, 2); });
}

// ---- riverside plants (features/riverside.js)
// A reed clump is ONE card of 5-9 stems (variants: 0 reeds, 1 cattails with brown heads, 2 a mix). Stems are 1 px, 2 px at
// the foot, lit from the top-left; the cattail heads are brown (brown stays brown through the seasons: the season matrix
// only turns green pixels). Ruins: lush greens. Frost: dry pale stalks with snow on the heads. Ember, rift: none.
function reed(p, ctx, S) {
  const ruins = S.id === 'ruins'; if (!ruins && S.id !== 'frost') return null;
  const v = p.variant | 0, m = M(ctx), R = ruins ? S.reed : S.straw, C = S.cattail, W = 34, B = m.H(1.62), H = B + 2, cx = 17;
  return build(W, H, [cx, B], P => {
    const r = rng(v * 17 + 5), n = [8, 6, 7][v % 3], st = [];
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1) * 2 - 1, cat = v === 1 || (v === 2 && i % 2 === 1);   // f: -1 .. 1 across the clump
      const len = (cat ? m.H(1.28) : m.H(1.14)) * (1 - Math.abs(f) * .22) + (r() - .5) * 6;
      st.push({f, cat, len, x0: cx + f * 6.4 + (r() - .5) * 1.4, lean: f * 3.4 + (r() - .5) * 2.6, bow: f * (cat ? 1.6 : 3.4 + r() * 3) + (r() - .5), drop: cat ? .6 : 1.4 + r() * 2, tp: .66 + r() * .14});
    }
    // one blade: base (x0, B), the tip leaning and arching outward, the tip's own droop; tone from height, the right px in shade
    const blade = (x0, len, lean, bow, drop, wide, dim, G) => {
      let lx = -1, ly = -1;
      for (let s = 0; s <= len; s += .5) {
        const t = s / len, x = Math.round(x0 + lean * t + bow * t * t), y = Math.round(B - s + drop * t * t * t);
        if (x === lx && y === ly) continue; lx = x; ly = y;
        P.p(x, y, G, Math.min(2, (t > .78 ? 0 : t < .1 ? 2 : 1) + dim));
        if (t < wide) P.p(x + 1, y, G, t < .12 ? 3 : 2);
      }
    };
    st.sort((a, b) => Math.abs(b.f) - Math.abs(a.f));   // the outer stems first: the middle ones stand in front
    for (const s of st) blade(s.x0, s.len, s.lean, s.bow, s.drop, s.cat ? .3 : .46, Math.abs(s.f) > .65 ? 1 : 0, R);
    // the long leaves that arch out of the foot, both sides
    for (const [dx, len, lean, bow] of [[-4, 20 + (r() * 5 | 0), -4, -10], [4, 19 + (r() * 5 | 0), 4, 10], [-1, 15, -2, -7], [2, 16, 2, 7]].slice(0, v === 1 ? 4 : 3))
      blade(cx + dx, len, lean, bow, 3, .3, 1, R);
    for (const s of st) {   // the heads
      if (!s.cat) continue;
      const t = s.tp, x = Math.round(s.x0 + s.lean * t + s.bow * t * t), y = Math.round(B - s.len * t), rows = ['.0.', '012', '012', '112', '113', '12.', '.2.'];
      rows.forEach((row, j) => { for (let i = 0; i < 3; i++) { const c = row[i]; if (c === '.') continue; P.p(x - 1 + i, y - 3 + j, C, +c); } });
      if (!ruins) { P.p(x, y - 3, S.snow, 0); P.p(x - 1, y - 2, S.snow, 0); P.p(x, y - 2, S.snow, 1); P.p(x + 1, y - 2, S.snow, 2); }
      for (let k = 0; k < 3; k++) P.p(x + (k > 1 ? Math.sign(s.f) : 0), y - 4 - k, R, k === 2 ? 0 : 1);   // the thin spike over the head
    }
    for (const s of st) { P.p(s.x0, B, R, 3); if (hsh(s.x0, 1) < .6) P.p(s.x0 - 1, B, R, 2); }   // the dark foot in the mud
  });
}
// a small fern: a fan of arching fronds, leaflets as short ticks. Ruins only (shade at the ravine lip, under the willows)
function fern(p, ctx, S) {
  if (S.id !== 'ruins') return null;
  const v = p.variant | 0, W = 29, H = 19, B = H - 1, cx = 14;
  return build(W, H, [cx, B], P => {
    const r = rng(v * 7 + 3), n = 6 + v, fr = [];
    for (let i = 0; i < n; i++) { const a = (i / (n - 1) * 2 - 1) * 1.28 + (r() - .5) * .3; fr.push({a, len: 15 - Math.abs(a) * 3.2 + r() * 2.5}); }
    fr.sort((a, b) => Math.abs(b.a) - Math.abs(a.a));   // the low outer fronds first
    for (const {a, len} of fr) {
      const sa = Math.sin(a), ca = Math.cos(a); let px = cx, py = B;
      for (let s = 0; s <= len; s += .5) {
        const t = s / len, x = cx + sa * s * (.75 + .45 * t) + (Math.abs(a) < .3 ? a * 3 * t : 0), y = B - ca * s * (.92 - .25 * t) + (2.4 + 4.4 * Math.abs(sa)) * t * t;
        P.p(x, y, S.fern, t > .85 ? 0 : 1);
        if (s > 2.5 && Math.round(s * 2) % 4 === 0) {   // a leaflet pair across the frond, shorter toward the tip
          const dx = x - px, dy = y - py, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d, k = Math.max(1, Math.round(2.8 * (1 - t * .85)));
          for (let q = 1; q <= k; q++) { const up = ny < 0 ? 1 : -1; P.p(x + nx * q * up, y + ny * q * up * .8, S.fern, 0); P.p(x - nx * q * up, y - ny * q * up * .8, S.fern, 2); }
        }
        px = x; py = y;
      }
    }
    P.p(cx, B, S.fern, 3); P.p(cx - 1, B, S.fern, 2); P.p(cx + 1, B, S.fern, 3);
  });
}
// the willow's painted card (trees3d.js grows the 3D one: this is its trees3d=0 fallback and what the water mirrors): a short
// stout trunk leaning right (over the water) that splits into limbs arching up and over like a fountain, 7 separate leaf
// masses on the arches (the highest over the middle, gaps between them), and sheets of thin strands hanging from the arches
// with gaps between the sheets, a ragged hem, a few to ~0.3 m above the ground
function willowCard(S, m) {
  const W = m.W(5.2), H = m.H(4.6), b = H - 3, cx = Math.round(W * .42);
  return build(W, H, [cx, H - 2], P => {
    const r = rng(91), X = u => cx + u * m.W(1), Y = v => b - v * m.H(1);   // (metres east of the trunk's foot, metres up) -> card px
    // limbs: each a polyline from the fork over its apex to a drooping tip (metres), tapering
    const ARCH = [
      [[.7, 1.15], [.85, 1.9], [1.1, 2.6], [1.5, 3.05], [1.95, 3.1], [2.35, 2.8], [2.55, 2.3]],
      [[.7, 1.15], [.55, 1.9], [.35, 2.55], [0, 2.95], [-.45, 3.0], [-.8, 2.7], [-.95, 2.2]],
      [[.7, 1.15], [.75, 2.0], [.82, 2.8], [.98, 3.3], [1.2, 3.45], [1.5, 3.25]],
      [[.65, 1.1], [.4, 1.6], [.1, 2.0], [-.3, 2.15], [-.65, 1.95]],
    ];
    const poly = (pts, w0, w1) => { for (let i = 0; i + 1 < pts.length; i++) { const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1); limb(P, X(pts[i][0]), Y(pts[i][1]), X(pts[i + 1][0]), Y(pts[i + 1][1]), w0 + (w1 - w0) * t0, w0 + (w1 - w0) * t1, S.bark); } };
    limb(P, cx, b, X(.7), Y(1.2), 12, 9, S.bark, 2);
    for (const [x, w] of [[-9, 4], [8, 4]]) limb(P, cx, b - 2, cx + x, b + 1, w, 1, S.bark);
    for (const a of ARCH) poly(a, 6, 2);
    P.runShade([S.bark]);
    // the masses: (metres east, up, half width, half height), the biggest and highest over the middle
    for (const [i, [u, v, rx, ry]] of [[.98, 3.6, .55, .42], [1.95, 3.3, .46, .36], [2.4, 2.65, .32, .26], [-.35, 3.2, .42, .34], [-.8, 2.55, .3, .25], [.35, 3.3, .34, .28], [1.5, 3.0, .3, .25]].entries())
      P.blob(X(u), Y(v), m.W(rx), m.H(ry), S.leaf, {s: i + 3, j: .38, edge: .6, bias: (v - 3.1) * .22 - (u - 1) * .06});
    P.outline();
    // the strands: sheets along the outer arches (3-6 strands 2-3 px wide, then a gap), each to its own length: the hem is ragged
    for (const a of ARCH) {
      const at = x => { for (let i = 0; i + 1 < a.length; i++) { const x0 = X(a[i][0]), x1 = X(a[i + 1][0]); if ((x - x0) * (x - x1) <= 0 && x0 !== x1) return Y(a[i][1] + (a[i + 1][1] - a[i][1]) * (x - x0) / (x1 - x0)); } return null; };
      const xa = X(a[1][0]), xb = X(a[a.length - 1][0]), lo = Math.min(xa, xb), hi = Math.max(xa, xb);
      for (let x = lo + (hi - lo) * .22 + r() * 4; x < hi - 2;) {
        const n = 3 + (r() * 5 | 0), kind = r(), hem = kind < .3 ? .3 + r() * .25 : kind < .78 ? .6 + r() * .6 : 1.25 + r() * .5;
        for (let k = 0; k < n; k++, x += 3 + (r() * 2 | 0)) {
          const y0 = at(Math.round(x)); if (y0 === null) continue;
          const y1 = Math.round(Y(Math.max(.3, hem + (r() - .5) * .45))), w = r() < .5 ? 2 : 3, ph = r() * 6;
          for (let y = Math.round(y0); y < y1; y++) {
            const f = (y - y0) / Math.max(1, y1 - y0), bulge = Math.sin(y * .62 + ph) > .35 ? 1 : 0, fall = f > .88 ? 1 : 0;   // (small tufts: the strand widens a pixel here and there)
            for (let i = 0; i < w + bulge; i++) {
              if (hsh(x + i, y, 92) < .06) continue;
              const nn = vn((x + i) / 3, y / 8, 93), tone = (nn > .6 ? 0 : nn < .4 ? 2 : 1) + (i === 0 ? -1 : i >= w - 1 + bulge ? 1 : 0) + fall;
              P.p(x + i, y, S.leaf, Math.max(0, Math.min(3, tone)));
            }
          }
        }
        x += 5 + r() * 9;
      }
    }
  });
}

// ---- the other trees' painted cards (trees3d.js grows the 3D ones: these are their trees3d=0 fallback and what the water mirrors; the same species pick,
// trees3d.js speciesOf). The ruins only. Metres east of the foot / up -> card px through X / Y
// the rowan: a small tree of 2-3 slim stems and an open, rounded crown of small soft tufts (feathery sprays: a few dark masses behind, tufts
// laid over a rounded shell with gaps between them, a ragged rim), with the red-orange bunches of berries hanging out on the outside of the crown
function rowanCard(S, m, v) {
  const W = m.W(3.6), H = m.H(4.4), b = H - 3, cx = Math.round(W * .5);
  return build(W, H, [cx, H - 2], P => {
    const r = rng(v * 29 + 11), X = u => cx + u * m.W(1), Y = h => b - h * m.H(1);
    const ns = 2 + (v % 2);
    for (let i = 0; i < ns; i++) { const a = (i / (ns - 1 || 1) - .5) * 2 * (ns > 2 ? 1 : .6) + (r() - .5) * .3; limb(P, X(a * .1), b, X(a * .55), Y(2.1 + r() * .3), 4, 2.5, S.bark, a * 2); }
    limb(P, X(0), b, X(.05), Y(.5), 5, 4, S.bark);
    for (const [x, w] of [[-5, 3], [5, 3]]) limb(P, cx, b - 1, cx + x, b + 1, w, 1, S.bark);
    for (let i = 0; i < 5; i++) { const a = (i / 4 - .5) * 2.1 + (r() - .5) * .3; limb(P, X(a * .15), Y(2.0), X(a * .85), Y(2.95 + r() * .4 - Math.abs(a) * .12), 2, 1, S.bark); }   // the branches the sprays sit on
    P.runShade([S.bark]);
    // a few dark masses behind (the crown's body), then the tufts: Fibonacci over a rounded shell, the far side first, each a small ragged blob, a little darker the deeper it sits
    const cy0 = 3.05, rx = 1.2, ry = .95;
    [[-.45, 2.75], [.45, 2.85], [0, 3.25], [-.75, 3.1], [.75, 3.05]].forEach(([u, h], i) => P.blob(X(u), Y(h), m.W(.26), m.H(.2), S.leaf, {s: i + v * 10, j: .4, edge: .8, bias: -.32}));
    const tf = [];
    for (let i = 0; i < 40; i++) {
      const cz = -.2 + 1.15 * (i + .5) / 40, sz = Math.sqrt(1 - cz * cz), az = i * 2.39996 + v * 1.3, k = .86 + r() * .26;
      tf.push({u: Math.cos(az) * sz * rx * k, h: cy0 + cz * ry * k, depth: Math.sin(az) * sz * k, w: .17 + r() * .06, hh: .12 + r() * .05});
    }
    tf.sort((a, c) => a.depth - c.depth).forEach((t, i) => P.blob(X(t.u), Y(t.h), m.W(t.w), m.H(t.hh), S.leaf, {s: i + v * 10, j: .42, edge: .9, bias: (t.h - 3) * .2 - t.u * .06 - (t.depth < 0 ? .14 : 0)}));
    P.outline();
    // the soft rim: single pixels 1-2 px out of the crown's edge, light on top and dark below (a feathery edge, no spikes)
    const tk = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (P.mat(x, y) === S.leaf.id && hsh(x, y, 7 + v) < .2) {
      const dx = (hsh(x, y, 8) < .5 ? -1 : 1), dy = hsh(x, y, 9) < .5 ? -1 : 1;
      if (!P.on(x + dx, y) || !P.on(x, y + dy)) tk.push([x + dx, y + (hsh(x, y, 11) < .5 ? 0 : dy), dy < 0 ? 0 : 2]);
    }
    for (const [x, y, t] of tk) if (!P.on(x, y)) P.p(x, y, S.leaf, t);
    // berries: 5-6 bunches of berries, flat on top, hung OUTSIDE the crown: from a leaf pixel of the crown's rim (the upper two thirds, sides first) on a 3 px stalk that
    // bends out and down into clear air (a 7 x 8 box), so a bunch hangs a little below and beside the leaves and is never inside the crown; spread out (no two within 14 px)
    let y0 = H, y1 = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (P.mat(x, y) === S.leaf.id) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const cd = [];
    for (let y = y0 + 2; y < y0 + (y1 - y0) * .66; y++) for (let x = 3; x < W - 3; x++) {
      if (P.mat(x, y) !== S.leaf.id) continue;
      for (const sd of [-1, 1]) {
        if (P.on(x + sd, y) || P.on(x + sd, y + 1)) continue;
        let free = true; for (let dy = 2; dy <= 9 && free; dy++) for (let dx = -3; dx <= 3; dx++) if (P.on(x + sd * 4 + dx, y + dy)) { free = false; break; }
        if (free) cd.push([x, y, sd, hsh(x, y, 40 + v)]);
      }
    }
    cd.sort((a, c) => a[3] - c[3]);
    const pick = [];
    for (const q of cd) { if (pick.length >= 5 + (r() < .5 ? 1 : 0)) break; if (pick.every(p => Math.hypot(p[0] - q[0], p[1] - q[1]) > 14)) pick.push(q); }
    for (const [x, y, sd] of pick) {
      P.p(x + sd, y, S.bark, 1); P.p(x + sd * 2, y + 1, S.bark, 2); P.p(x + sd * 3, y + 2, S.bark, 2);
      // the bunch, 6 px wide: flat on top, scalloped below, lit from the top left (rows of tones 0 .. 3)
      ['.AAAA.', 'AAABBB', 'ABBBBC', 'BBBCCC', 'B.C.CD'].forEach((row, dy) => [...row].forEach((c, dx) => { if (c !== '.') P.p(x + sd * 4 - 2 + dx, y + 3 + dy, S.berry, 'ABCD'.indexOf(c)); }));
    }
  });
}
// the birch: a tall slender white trunk leaning a little, dark and rough at the foot, black marks, white branches, a light crown of small leaf clumps with gaps and a few hanging tufts
function birchCard(S, m, v) {
  const W = m.W(3), H = m.H(6.6), b = H - 3, cx = Math.round(W * .42);
  return build(W, H, [cx, H - 2], P => {
    const r = rng(v * 29 + 5), X = u => cx + u * m.W(1), Y = h => b - h * m.H(1), lean = .35 + r() * .3, top = 5.9, tx = h => lean * Math.pow(h / top, 1.5);
    for (let k = 0; k < 8; k++) limb(P, X(tx(top * k / 8)), Y(top * k / 8), X(tx(top * (k + 1) / 8)), Y(top * (k + 1) / 8), 5.5 - 3 * k / 8, 5.5 - 3 * (k + 1) / 8, S.birch);
    limb(P, cx, b, cx, Y(.55), 6, 5, S.bark); for (const [x, w] of [[-5, 3], [5, 3]]) limb(P, cx, b - 1, cx + x, b + 1, w, 1, S.bark);
    for (let i = 0; i < 6; i++) { const h = 2.6 + i * .55 + r() * .3, a = i * 2.4, e = [X(tx(h) + Math.cos(a) * (.8 + r() * .5)), Y(h + .9 + r() * .4)]; limb(P, X(tx(h)), Y(h), e[0], e[1], 2, 1, S.birch); }
    P.runShade([S.birch, S.bark]);
    for (let i = 0; i < 22; i++) { const h = .7 + r() * 4.8, x = Math.round(X(tx(h))), y = Math.round(Y(h)), w = 2 + (r() * 3 | 0); for (let k = -1; k < w - 1; k++) if (P.mat(x + k, y) === S.birch.id) P.p(x + k, y, S.bark, 2); }
    const blobs = [];
    for (let i = 0; i < 18; i++) { const h = 2.7 + r() * 3.5, f = Math.sin(Math.PI * Math.min(1, (h - 2.2) / 4.2)); blobs.push([tx(h) + (r() - .5) * 2 * (1.0 * f + .25), h, .3 + r() * .18]); }
    blobs.sort((a, c) => a[1] - c[1]);
    blobs.forEach(([u, h, rr], i) => P.blob(X(u), Y(h), m.W(rr), m.H(rr * .8), S.leaf, {s: i + v * 10, j: .4, edge: .7, bias: (h - 4.2) * .1 + .06}));
    for (let i = 0; i < 9; i++) { const q = blobs[i % blobs.length], dy = 5 + (r() * 9 | 0); P.blob(X(q[0] + (r() - .5) * .5), Y(q[1]) + dy, 2 + r() * 2, 3 + r() * 3, S.leaf, {s: i + 70, j: .3, edge: .5, bias: -.05}); }
    P.outline();
  });
}
// the aspen: a straight grey-green trunk, bare to the height of a house, a narrow oval crown of round-leaved clumps with a ragged edge
function aspenCard(S, m, v) {
  const W = m.W(2.8), H = m.H(7.2), b = H - 3, cx = Math.round(W * .5);
  return build(W, H, [cx, H - 2], P => {
    const r = rng(v * 29 + 17), X = u => cx + u * m.W(1), Y = h => b - h * m.H(1), lean = .1 + r() * .2, top = 6.6, tx = h => lean * Math.pow(h / top, 1.4);
    for (let k = 0; k < 8; k++) limb(P, X(tx(top * k / 8)), Y(top * k / 8), X(tx(top * (k + 1) / 8)), Y(top * (k + 1) / 8), 5 - 2.6 * k / 8, 5 - 2.6 * (k + 1) / 8, S.aspen);
    for (const [x, w] of [[-5, 3], [5, 3], [-2, 2]]) limb(P, cx, b - 1, cx + x, b + 1, w, 1, S.aspen);
    P.runShade([S.aspen]);
    for (let i = 0; i < 6; i++) { const x = cx + (r() * 3 | 0) - 1, y = b - 2 - (r() * m.H(1.2) | 0); if (P.mat(x, y) === S.aspen.id) P.p(x, y, S.bark, 2); }
    const w = u => 1.0 * Math.pow(Math.sin(Math.PI * Math.min(1, .05 + .95 * Math.pow(u, .85))), .7), blobs = [];
    for (let i = 0; i < 34; i++) { const u = r(), h = 2.9 + u * 3.9, f = i < 18 ? r() * .7 : .85 + r() * .3; blobs.push([tx(h) + (r() < .5 ? -1 : 1) * w(u) * f, h, (i < 18 ? .36 : .25) + r() * .1]); }
    blobs.sort((a, c) => a[1] - c[1]);
    blobs.forEach(([u, h, rr], i) => P.blob(X(u), Y(h), m.W(rr), m.H(rr * .85), S.leaf, {s: i + v * 10, j: .4, edge: .8, bias: (h - 4.8) * .09 + .08}));
    P.outline();
  });
}

// ---- big mood shapes outside the walls
function limb(P, x0, y0, x1, y1, t0, t1, R, bend = 0) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let s = 0; s <= n; s++) { const t = s / n, x = x0 + (x1 - x0) * t + Math.sin(t * Math.PI) * bend, y = y0 + (y1 - y0) * t; P.disk(x, y, (t0 + (t1 - t0) * t) / 2, (a, b) => P.p(a, b, R, 1)); }
}
function tree(p, ctx, S) {
  const v = p.variant | 0, m = M(ctx);
  if (S.id === 'ruins') {
    const sp = speciesOf(p, 'ruins');   // (the same pick as the 3D trees: a birch is a birch in both)
    if (sp === 'rowan') return rowanCard(S, m, v);
    if (sp === 'birch') return birchCard(S, m, v);
    if (sp === 'aspen') return aspenCard(S, m, v);
    if (v === 3) return willowCard(S, m);   // (the willow by the river: trees3d.js grows the 3D one)
    const H = m.H(4.2) + (v * 6), W = 84;
    return build(W, H, [42, H - 2], P => {
      const r = rng(v * 31 + 7), b = H - 3, cx = 42;
      if (v === 2) {   // a dead, gnarled tree
        const br = (x, y, a, l, t, d) => { const ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l; limb(P, x, y, ex, ey, t, t * .6, S.bark, (r() - .5) * 4); if (d < 4) { br(ex, ey, a - .35 - r() * .4, l * .72, t * .62, d + 1); if (r() < .8) br(ex, ey, a + .3 + r() * .45, l * .66, t * .58, d + 1); } };
        limb(P, cx, b, cx + 3, b - 44, 9, 6, S.bark, 3);
        for (const [x, w] of [[-7, 3], [6, 3]]) limb(P, cx, b - 2, cx + x, b + 1, w, 1, S.bark);
        br(cx + 3, b - 42, -Math.PI / 2 - .5, 26, 5, 1); br(cx + 3, b - 44, -Math.PI / 2 + .45, 28, 5, 1);
        P.runShade([S.bark]); P.outline();
        return;
      }
      limb(P, cx, b, cx + 2, b - 40, 11, 6, S.bark, 2);
      for (const [x, w] of [[-9, 4], [8, 4], [-3, 3]]) limb(P, cx, b - 3, cx + x, b + 1, w, 1, S.bark);
      limb(P, cx + 1, b - 34, cx - 16, b - 58, 5, 2, S.bark, -2); limb(P, cx + 2, b - 36, cx + 18, b - 62, 5, 2, S.bark, 2);
      P.runShade([S.bark]);
      const top = 6, ch = b - 38 - top, blobs = [];
      for (let i = 0; i < 9; i++) { const a = r() * PI2, d = Math.sqrt(r()) * .62; blobs.push([cx + Math.cos(a) * d * 36, top + ch * .5 + Math.sin(a) * d * ch * .5, 12 + r() * 9, 10 + r() * 7]); }
      blobs.sort((a, b2) => a[1] - b2[1]);
      blobs.forEach(([x, y, a, bb], i) => P.blob(x, y, a, bb, S.leaf, {s: i + v * 10, j: .38, edge: .6, bias: -(y - top - ch * .4) / ch * .45 - (x - cx) / 90}));
      P.outline();
    });
  }
  if (S.id === 'ember') {   // ash spires: jagged basalt columns
    const H = m.H(3 + v * .7), W = 48;
    return build(W, H, [24, H - 2], (P, E) => {
      // a jagged basalt needle with a smaller one leaning on it; ash settles on every inward step of the profile
      const b = H - 3;
      const spire = (cx, top, bw, tw, seed) => {
        const R = rng(seed); let l = bw / 2, r = bw / 2, pl = l, pr = r;
        for (let y = b; y >= top; y--) {
          const t = (b - y) / (b - top), tl = bw / 2 + (tw / 2 - bw / 2) * Math.pow(t, .8);
          if (R() < .3) l += (tl - l) * .6 + (R() - .45) * 2.5; if (R() < .3) r += (tl - r) * .6 + (R() - .45) * 2.5;
          const xa = Math.round(cx - l), xb = Math.round(cx + r);
          for (let x = xa; x < xb; x++) P.p(x, y, S.wall, 1);
          if (y < b) { for (let x = Math.round(cx - pl); x < xa; x++) P.p(x, y + 1, S.ash, 0); for (let x = xb; x < Math.round(cx + pr); x++) P.p(x, y + 1, S.ash, 1); }
          pl = l; pr = r;
        }
        for (let x = Math.round(cx - l); x < Math.round(cx + r); x++) P.p(x, top, S.ash, 0);
      };
      spire(v === 1 ? 32 : 15, Math.round(b - (b - 4) * .45), 15, 5, v * 7 + 2);
      spire(24, 4 + v * 2, 30 - v * 2, 7, v * 7 + 1);
      P.runShade([S.wall]);
      for (let y = b - 9; y > 10; y -= 11 + (hsh(y, v) * 5 | 0)) for (let x = 0; x < W; x++) if (P.mat(x, y) === S.wall.id && hsh(x, y) < .7) P.p(x, y, S.wall, 3);
      P.outline();
      let x = 23 + v; for (let y = b - 4; y > b - 26 - v * 8; y--) { glowAt(P, E, x, y, y > b - 10 ? '#ffb050' : '#e0541e', S.crust); if (hsh(y, 5, v) < .3) x += hsh(y, 6) < .5 ? -1 : 1; }
    });
  }
  if (S.id === 'frost') {   // snowy pines
    const H = m.H(3.6 + v * .5), W = 56;
    return build(W, H, [28, H - 2], P => {
      const b = H - 3, cx = 28, tiers = 5, trunk = 8;
      for (let y = b - trunk - 2; y <= b; y++) for (let i = -2; i <= 2; i++) P.p(cx + i, y, S.bark, i < 0 ? 0 : i === 2 ? 2 : 1);
      const th = (b - trunk - 4) / tiers;
      for (let k = 0; k < tiers; k++) {
        const bot = b - trunk - k * th * .82, topY = bot - th * 1.5, hw = 24 - k * 4.2;
        const pts = [[cx, topY]]; for (let i = 0; i <= 8; i++) { const x = cx + hw - i * hw / 4; pts.push([x, bot + (i % 2 ? -2 : 1)]); }
        P.poly(pts, (x, y) => { const u = (x + .5 - cx) / hw, dy = bot - y; P.p(x, y, S.pine, dy < 3 ? 2 : u < -.35 ? 0 : u < .3 ? 1 : 2); });
        const sy = Math.round(bot - th * .82) + 1;   // snow on the tier's shoulders (the next tier covers the middle)
        for (let x = Math.floor(cx - hw); x < cx + hw * .7; x++) { const d = 2 + (vn(x / 2.5, k, 8) * 3 | 0); for (let j = 0; j < d; j++) if (P.mat(x, sy + j) === S.pine.id) P.p(x, sy + j, S.snow, j === 0 ? 0 : j === d - 1 ? 2 : 1); }
        for (let x = Math.floor(cx - hw); x < cx + hw; x++) {   // snow on the tier's upper slope
          let y = Math.floor(topY); while (y < bot && !(P.on(x, y) && P.mat(x, y) === S.pine.id)) y++;
          const d = (x < cx + hw * .45) ? 2 + (vn(x / 3, k, 7) * 3 | 0) - (x > cx ? 1 : 0) : 0; for (let j = 0; j < d; j++) if (P.mat(x, y + j) === S.pine.id) P.p(x, y + j, S.snow, j === 0 ? 0 : j === d - 1 ? 2 : 1);
        }
      }
      P.outline({only: [S.pine.id, S.bark.id]});
    });
  }
  // rift: a shard of ground floating in the void, crystals on top
  const H = m.H(3.4 + v * .6), W = 66;
  return build(W, H, [33, H - 1], (P, E) => {
    const r = rng(v * 13 + 3), lift = m.H(1.1 + v * .5), cx = 33, topY = 20, hw = 21 + v * 4, depth = H - lift - topY - 4;
    const pts = [[cx - hw, topY], [cx + hw, topY]]; for (let i = 1; i <= 6; i++) pts.push([cx + hw - i * hw / 3 + (r() - .5) * 4, topY + depth * (i === 3 ? 1 : .35 + r() * .45)]);
    P.poly(pts, (x, y) => P.p(x, y, S.rock, 1));
    P.runShade([S.rock], {jit: .3, s: v});
    for (let x = cx - hw; x < cx + hw; x++) for (let j = 0; j < 4; j++) P.p(x, topY - 2 + j, S.floor, j === 0 ? 1 : j < 3 ? 0 : 2);
    P.outline();
    for (let k = 0; k < 1 + (v > 0 ? 1 : 0); k++) crystal(P, E, S, cx - 5 + k * 12 + (r() * 3 | 0), topY - 20 + k * 7 + (r() * 3 | 0), 4 - k, 22 - k * 7, k + v * 5);
    for (let i = 0; i < 3; i++) glowAt(P, E, cx - hw / 2 + r() * hw, topY + 5 + r() * depth * .5, S.runeDim, null);
  });
}
function rockBig(p, ctx, S) {
  const v = p.variant | 0, m = M(ctx);
  if (S.id === 'rift') {   // floating debris: a chunk of old wall or a rock
    const H = m.H(2.2), W = 44;
    return build(W, H, [22, H - 1], (P, E) => {
      const y0 = 6, lift = m.H(1 + v * .3);
      if (v === 0) { block(P, E, S, 6, y0, 32, 6, 16, v * 40, {ch: 8, cover: false}); for (let x = 6; x < 38; x++) { const d = 2 + (hsh(x, 3) * 8 | 0); for (let j = 0; j < d; j++) P.p(x, y0 + 22 + j, S.rock, 2); } }
      else { const pts = [[8, y0 + 4], [36, y0 + 2], [30, y0 + 20], [20, H - lift], [12, y0 + 18]]; P.poly(pts, (x, y) => P.p(x, y, S.rock, 1)); P.runShade([S.rock], {jit: .3}); for (let x = 8; x < 36; x++) P.p(x, y0 + 3, S.floor, 0); }
      P.outline();
      if (v === 0) for (let x = 10; x < 34; x += 5) glowAt(P, E, x, y0 + 14, S.rune, null);
      else crystal(P, E, S, 22, y0 - 6, 2, 9, v);
    });
  }
  const H = 40, W = 56;
  return build(W, H, [28, H - 3], (P, E) => {
    const R = S.rock, b = H - 3;
    if (S.id === 'ruins' && v === 2) {   // a fallen column drum: a lying cylinder, top-lit bands, flutes, the round end facing us
      const r0 = 11, cy = b - r0;
      for (let y = cy - r0; y <= b; y++) { const u = (y + .5 - cy) / r0; for (let x = 6; x < 40; x++) P.p(x, y, S.wall, u < -.8 ? 1 : u < -.2 ? 0 : u < .45 ? 1 : 2); }
      for (let x = 10; x < 40; x += 4) for (let y = cy - r0 + 3; y < b - 1; y++) P.shift(x, y, 1, 2);
      P.disk(42, cy + .5, r0 - .5, (x, y) => { if (x >= 38) P.p(x, y, S.wall, (x - 42) + (y - cy) * .8 < -3 ? 0 : 1); });
      P.disk(42, cy + .5, 4, (x, y) => { if (x >= 38) P.p(x, y, S.wall, 2); });
    } else {
      P.blob(24, b - 12, 17, 12, R, {s: v + 30, j: .3, edge: .3, hi: .6});
      P.blob(36, b - 8, 11, 8, R, {s: v + 31, j: .3, edge: .3});
      P.blob(16, b - 5, 9, 5, R, {s: v + 32, j: .2});
    }
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (P.on(x, y) && !P.on(x, y - 1)) {
      if (S.id === 'ruins' && vn(x / 5, v, 3) > .38) { const d = 1 + (vn(x / 3, v, 4) * 4 | 0); for (let j = 0; j < d; j++) P.p(x, y + j, S.grass, j === 0 ? 0 : 1); }
      if (S.id === 'frost') { const d = 2 + (vn(x / 4, v, 4) * 4 | 0); for (let j = 0; j < d; j++) P.p(x, y + j, S.snow, j < 2 ? 0 : 1); }
      if (S.id === 'ember' && hsh(x, v) < .5) P.p(x, y, S.ash, 1);
      break;
    }
    P.outline();
    if (S.id === 'ember') { let x = 20 + v * 4; for (let y = b - 2; y > b - 18; y--) { if (P.on(x, y)) glowAt(P, E, x, y, y > b - 6 ? '#ffb050' : '#e0541e', S.crust); if (hsh(y, v, 3) < .45) x += hsh(y, 4) < .5 ? -1 : 1; }
      if (v === 0) return {lights: [{dx: 0, dy: 0, h: 10 / ctx.PPMH, color: '#ff6a2a', radius: 2.5, intensity: .7, flicker: .3}]}; }
    if (S.id === 'frost' && v === 2) for (const [x, h] of [[40, 16], [44, 11], [36, 9]]) { P.poly([[x, b - h - 6], [x + 3, b - 6], [x - 3, b - 6]], (a, c) => P.p(a, c, S.ice, a < x ? 0 : 1)); }
    if (S.id === 'frost' && v === 2) P.outline({only: [S.ice.id]});
  });
}


// ---- breakables: prop.stage 0 intact / 1 damaged / 2 broken (debris stays on the ground); chests; the sparring brute
const GOLD = ramp('#ffe89a', '#e0b040', '#a87a24', '#5a3e14'), HAZ = ramp('#f2d060', '#d8a830', '#9a7020', '#4e3812');
// brute facing: -1/+1, or a 16-facing index like the player's (0 = S, 4 = E, 12 = W)
const faceLeft = p => { const f = p.face; if (typeof f !== 'number') return false; if (f === -1 || f === 1) return f < 0; return Math.sin(f * PI2 / 16) < -.01; };
function mirror(sp) {
  const f = c => { if (!c) return c; const n = mk(c.width, c.height), g = n.getContext('2d'); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0); return n; };
  return {img: f(sp.img), emit: f(sp.emit), pivot: [sp.img.width - sp.pivot[0], sp.pivot[1]], lights: sp.lights};
}
// boards lying on the ground (debris): [x, y, length, slope]
function planks(P, R, list) { for (const [x, y, len, sl] of list) for (let i = 0; i < len; i++) { const yy = y + Math.round(i * sl); P.p(x + i, yy, R, 0); P.p(x + i, yy + 1, R, i === len - 1 ? 2 : 1); P.p(x + i, yy + 2, R, 2); } }
function dust(P, S, w, h) {   // snow / ash settles on whatever faces up
  if (S.id !== 'frost' && S.id !== 'ember') return;
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (P.on(x, y)) {
    if (S.id === 'frost') { P.p(x, y, S.snow, 0); if (P.on(x, y + 1) && hsh(x, 1) < .6) P.p(x, y + 1, S.snow, 1); }
    else if (hsh(x, y, 3) < .45) P.p(x, y, S.ash, 1);
    break;
  }
}
function hole(P, R, cx, cy, rx, ry, seed) {   // a stove-in hole with splinters on its upper rim
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const d = ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 + (hsh(x, y, seed) - .5) * .5;
    if (d < 1) P.p(x, y, R, d > .7 && y < cy && hsh(x, y, seed + 1) < .5 ? 0 : 3);
  }
}
function crate(p, ctx, S) {
  const m = M(ctx), st = p.stage | 0, w = m.W(.8), td = m.D(.8), h = m.H(.8), R = S.wood, MT = S.metal;
  if (st === 2) return build(w + 10, 13, [(w + 10) >> 1, 10], P => {
    planks(P, R, [[2, 6, 14, .1], [13, 2, 16, .12], [6, 8, 18, -.05], [21, 6, 11, .2]]);
    for (const [x, y] of [[4, 4], [28, 5], [17, 1], [10, 5], [1, 10]]) P.p(x, y, R, 1);
    dust(P, S, w + 10, 13); P.outline({only: [R.id]});
  });
  const H = td + h + 2, off = Math.round(.32 * ctx.PPMY);
  return build(w, H, [w >> 1, H - off], (P, E) => {
    const y0 = 2, fy = y0 + td;
    for (let y = 0; y < td; y++) for (let x = 0; x < w; x++) P.p(x, y0 + y, R, y === 0 || (y % 3 === 2 && y < td - 1) ? 1 : 0);   // lid boards, lit
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const frame = x < 2 || x >= w - 2 || y < 2 || y >= h - 2, brace = !frame && Math.abs((x - 2) - (h - 3 - y) * (w - 4) / (h - 4)) < 1.2;
      P.p(x, fy + y, R, y === 0 ? 2 : frame ? (x >= w - 2 || y >= h - 2 ? 2 : 1) : brace ? 0 : (y - 2) % 5 === 4 ? 2 : 1);
    }
    if (S.id === 'ember' || S.id === 'rift') for (const [x, y] of [[0, 0], [w - 3, 0], [0, h - 3], [w - 3, h - 3]]) P.rect(x, fy + y, 3, 3, MT, y ? 1 : 0);
    else for (const [x, y] of [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]]) P.p(x, fy + y, MT, 0);
    if (st === 1) {
      hole(P, R, w * .64, fy + h * .48, 4.6, 3.4, 5);
      P.line(w * .64 - 4, fy + h * .48 - 2, 5, fy + 3, (x, y) => P.p(x, y, R, 3));
      for (let y = 0; y < 3; y++) for (let x = w - 3 + y; x < w; x++) P.off(x, y0 + y);   // chipped corner
    }
    dust(P, S, w, H);
    P.outline();
    if (S.id === 'rift') for (let y = 2; y < h - 2; y += 2) { const x = Math.round(2 + (h - 3 - y) * (w - 4) / (h - 4)); if (P.tone(x, fy + y) === 0) E.c(x, fy + y, hex(st ? '#4a2470' : S.runeDim)); }
  });
}
function barrel(p, ctx, S, boom) {
  const m = M(ctx), st = p.stage | 0, w = m.W(.62), h = m.H(.9), R = boom ? RED : S.wood, MT = S.metal;
  if (st === 2) {
    if (boom) return build(36, 14, [18, 9], (P, E) => {   // blast mark: scorched ground, charred staves, dying embers
      for (let y = 0; y < 14; y++) for (let x = 0; x < 36; x++) { const d = ((x + .5 - 18) / 17) ** 2 + ((y + .5 - 8) / 5.5) ** 2 + (hsh(x, y, 9) - .5) * .3; if (d < 1) P.c(x, y, hex(d < .55 ? '#16100e' : '#2a201c')); }
      planks(P, S.wood, [[6, 5, 7, .3], [20, 3, 8, -.2], [14, 8, 6, .1]]);
      for (const [x, y] of [[8, 7], [22, 4], [15, 9], [27, 8]]) glowAt(P, E, x, y, '#ff7a2e', '#2a1512');
    });
    return build(w + 16, 14, [(w + 16) >> 1, 9], P => {
      planks(P, R, [[2, 7, 9, .25], [13, 3, 8, -.15], [22, 6, 9, .1], [9, 9, 7, 0]]);
      for (let a = 0; a < 40; a++) { const x = Math.round(17 + Math.cos(a / 40 * PI2) * 7), y = Math.round(8 + Math.sin(a / 40 * PI2) * 2.5); P.p(x, y, MT, y < 8 ? 0 : 2); }
      dust(P, S, w + 16, 14); P.outline({only: [R.id]});
    });
  }
  const H = h + 4 + (boom ? 8 : 1), off = Math.round(.22 * ctx.PPMY), cx = w / 2, top = H - h;
  return build(w, H, [w >> 1, H - off], (P, E) => {
    for (let y = top; y < H; y++) { const t = (y - top) / h, hw = cx * (.84 + .16 * Math.sin(Math.PI * t)); for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) P.p(x, y, R, 1); }
    P.runShade([R]);
    for (let y = top; y < H; y++) for (let x = 2; x < w - 2; x++) if (x % 4 === 1 && P.mat(x, y) === R.id) P.shift(x, y, 1, 2);   // staves
    if (boom) {   // hazard band: yellow and black stripes
      const hy = top + Math.round(h * .38);
      for (let y = hy; y < hy + 6; y++) for (let x = 0; x < w; x++) if (P.on(x, y)) P.p(x, y, HAZ, ((x - y) >> 1 & 1) ? 3 : x < cx - 3 ? 0 : x > cx + 3 ? 2 : 1);
    }
    for (const t of [.16, .8]) { const yy = top + Math.round(h * t); for (let x = 0; x < w; x++) if (P.on(x, yy)) { P.p(x, yy, MT, x < cx - 2 ? 0 : x > cx + 3 ? 2 : 1); P.p(x, yy + 1, MT, 2); } }
    for (let y = top - 3; y <= top + 2; y++) for (let x = 0; x < w; x++) {   // lid
      const d = ((x + .5 - cx) / (cx - .5)) ** 2 + ((y + .5 - top) / 2.8) ** 2; if (d > 1) continue;
      P.p(x, y, R, d > .6 ? 1 : 0);
    }
    P.p(Math.round(cx) + 2, top, R, 3);   // bung
    if (st === 1) {
      hole(P, R, cx + 2, top + h * .56, 2.8, 3.4, 7);
      const yy = top + Math.round(h * .8); for (let x = Math.round(cx); x < w; x++) if (P.mat(x, yy) === MT.id) { P.p(x, yy + 1, MT, 1); P.p(x, yy, R, 2); }   // sprung hoop
      if (boom) for (let y = Math.round(top + h * .56 + 3); y < H - 2; y++) if (hsh(y, 3) < .8) P.p(Math.round(cx + 2), y, R, 3);   // leak
    }
    dust(P, S, w, H);
    P.outline();
    if (boom) {   // fuse with a spark
      let fx = Math.round(cx) - 1; for (let y = top - 3; y > top - 9; y--) { P.p(fx, y, HAZ, 3); if (y % 2) fx += 1; }
      const sx = fx, sy = top - 10;
      glowAt(P, E, sx, sy, '#ffffff', null); for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) glowAt(P, E, sx + a, sy + b, '#ffc850', null);
      if (st === 1) for (const [a, b] of [[-2, -1], [2, -2], [1, 2], [-2, 2]]) glowAt(P, E, sx + a, sy + b, '#ff7a2a', null);
    }
  });
}
function pot(p, ctx, S) {
  const m = M(ctx), st = p.stage | 0, h = m.H(.55), w = 15, R = S.clay;
  if (st === 2) return build(24, 9, [12, 6], (P, E) => {
    for (const [x, y, l, c] of [[2, 4, 4, 0], [9, 2, 5, 1], [16, 5, 4, 0], [7, 6, 3, 1], [19, 2, 3, 1]]) for (let i = 0; i < l; i++) { P.p(x + i, y + (i === 0 || i === l - 1 ? 1 : 0) * c, R, 0); P.p(x + i, y + 1, R, 2); }
    for (let x = 10; x < 15; x++) { P.p(x, 6, R, 1); P.p(x, 7, R, 2); }   // the base
    P.outline();
    if (S.id === 'ember') glowAt(P, E, 12, 5, '#ff7a2e', null);
  });
  const H = h + 2, off = Math.round(.14 * ctx.PPMY);
  return build(w, H, [w >> 1, H - off], (P, E) => {
    const b = H - 1, cx = w / 2, top = b - h + 1;
    P.blob(cx, b - 5.5, 6.6, 6, R, {s: 3, j: .12});
    for (let y = top + 2; y < b - 9; y++) for (let x = Math.round(cx - 3); x < Math.round(cx + 3); x++) P.p(x, y, R, x < cx - 1 ? 0 : x > cx + 1 ? 2 : 1);   // neck
    for (let x = Math.round(cx - 4); x < Math.round(cx + 4); x++) { P.p(x, top, R, x < cx - 2 || x > cx + 1 ? 0 : 3); P.p(x, top + 1, R, x > cx + 2 ? 2 : 1); }   // rim + mouth
    const band = b - 8;   // decoration
    if (S.id === 'ruins') for (let x = 0; x < w; x++) if (P.on(x, band) && x % 3 !== 2) P.p(x, band, R, 2);
    if (st === 1) {
      let x = Math.round(cx + 1); for (let y = top + 2; y < top + 10; y++) { P.p(x, y, R, 3); if (hsh(y, 5) < .5) x++; }
      P.off(Math.round(cx + 3), top); P.off(Math.round(cx + 2), top);
    }
    dust(P, S, w, H);
    P.outline();
    if (S.id === 'ember') for (let x = Math.round(cx - 2); x < Math.round(cx + 2); x++) glowAt(P, E, x, top, x === Math.round(cx - 1) ? '#ffd070' : '#ff7a2e', null);
    if (S.id === 'rift') glyph((a, c) => glowAt(P, E, Math.round(cx) + a - 2, b - 8 + c, S.rune, '#2a2044'), 7);
  });
}
function cutFlat(P, E, R, x0, x1, y) {   // snap crystals off at row y: remove everything above, a lit fracture on top
  for (let yy = 0; yy < y; yy++) for (let x = x0; x < x1; x++) if (P.mat(x, yy) === R.id || !P.on(x, yy)) { P.off(x, yy); E.off(x, yy); }
  for (let x = x0; x < x1; x++) if (P.mat(x, y) === R.id) P.p(x, y, R, P.tone(x, y) === 3 ? 3 : 0);
}
function crystalProp(p, ctx, S) {
  const m = M(ctx), st = p.stage | 0, H0 = m.H(1.3), W = 32, H = H0 + 5, o = {R: S.gem, glow: S.gemGlow, inner: S.gemInner};
  return build(W, H, [16, H - 2], (P, E) => {
    const b = H - 3;
    P.blob(16, b - 2, 12, 4.5, S.rock, {s: 4}); P.outline({only: [S.rock.id]});
    if (st === 2) {   // stubs: flat broken tops, shards on the ground, a faint glow left
      for (const [x, h, lean] of [[10, 11, -1], [17, 14, 0], [23, 9, 1]]) crystal(P, E, S, x, b - h - 3, 3, h + 4, x, {...o, lean, dim: 1});
      cutFlat(P, E, S.gem, 0, W, b - 13);
      for (const [x, y] of [[4, b], [27, b - 1], [8, b + 1]]) { P.p(x, y, S.gem, 0); P.p(x + 1, y, S.gem, 2); }
      return;
    }
    crystal(P, E, S, 8, b - 17, 3, 16, 1, {...o, lean: -3});
    crystal(P, E, S, 24, b - 21, 3.5, 20, 2, {...o, lean: 3});
    crystal(P, E, S, 16, b - H0 + 3, 5.5, H0 - 4, 3, {...o, dim: st});
    if (st === 1) {   // cracked: a fracture across the big one, the right one snapped
      P.line(12, b - 24, 20, b - 14, (x, y) => { if (P.mat(x, y) === S.gem.id) P.p(x, y, S.gem, 3); });
      cutFlat(P, E, S.gem, 20, W, b - 12);
    }
    return {lights: [{dx: 0, dy: 0, h: (H0 * .5 + 2) / ctx.PPMH, color: S.gemGlow[1], radius: st ? 1.8 : 2.6, intensity: st ? .35 : .7, flicker: st ? .3 : .1}]};
  });
}
function chest(p, ctx, S) {
  const m = M(ctx), w = m.W(.9) | 1, bh = m.H(.36), lh = 6, R = S.wood, MT = S.metal, open = !!p.opened;
  const up = open ? 12 : 0, H = up + lh + bh + 1, off = Math.round(.25 * ctx.PPMY), band = x => (x >= 4 && x <= 6) || (x >= w - 7 && x <= w - 5);
  return build(w, H, [w >> 1, H - off], (P, E) => {
    if (!open) for (let r = 0; r < lh; r++) for (let x = r === 0 ? 1 : 0; x < (r === 0 ? w - 1 : w); x++) P.p(x, r, band(x) ? MT : R, r === 0 ? 1 : r < 3 ? 0 : r === lh - 1 ? 2 : 1);
    else {
      for (let r = 0; r < up + 1; r++) for (let x = 1; x < w - 1; x++) P.p(x, r, band(x) ? MT : R, r === 0 ? 1 : band(x) ? 1 : 2);   // the lid, swung back
      for (let r = 0; r < lh; r++) for (let x = 0; x < w; x++) P.p(x, up + r, R, r === 0 || x === 0 || x === w - 1 ? 1 : 3);    // rim, dark inside
      for (let y = up + 1; y < up + lh; y++) for (let x = 2; x < w - 2; x++) {   // a heap of gold
        const d = ((x + .5 - w / 2) / (w / 2 - 3)) ** 2 + ((y + .5 - (up + lh)) / 4) ** 2; if (d > 1) continue;
        P.p(x, y, GOLD, d > .75 ? 2 : (x + y) % 3 === 0 ? 0 : 1);
      }
    }
    for (let r = 0; r < bh; r++) for (let x = 0; x < w; x++) P.p(x, up + lh + r, band(x) ? MT : R, band(x) ? (x === 4 || x === w - 7 ? 0 : 1) : r === 0 || r === bh >> 1 ? 2 : 1);
    const lx = (w >> 1) - 2, ly = open ? up + lh : lh - 2;
    P.rect(lx, ly, 5, 5, GOLD, 1); P.rect(lx, ly, 5, 1, GOLD, 0); P.p(lx + 2, ly + 2, GOLD, 3); P.p(lx + 2, ly + 3, GOLD, 3);
    if (!open) dust(P, S, w, H);
    P.outline();
    if (open) for (const [x, y] of [[w / 2 - 4, up + lh - 3], [w / 2 + 3, up + lh - 2], [w / 2, up + lh - 4]]) glowAt(P, E, Math.round(x), y, '#fff4c0', null);
    else glowAt(P, E, lx + 1, ly + 1, '#fff2b0', null);
    if (S.id === 'rift') glowAt(P, E, lx + 2, ly + 2, S.rune, null);
  });
}
function brute(p, ctx, S, left) {
  const m = M(ctx), H = m.H(1.6) + 2, W = 34, body = S.brute, belt = S.id === 'ember' || !S.straw ? S.metal : S.straw;
  const sp = build(W, H, [W >> 1, H], (P, E) => {
    const b = H - 1, cx = 16;
    for (const lx of [cx - 7, cx + 1]) for (let y = b - 9; y <= b; y++) for (let i = 0; i < 6; i++) P.p(lx + i, y, body, y === b ? 2 : i === 0 ? 0 : i === 5 ? 2 : 1);   // stumpy legs
    P.blob(cx - 10, b - 19, 4, 7, body, {s: 7, bias: -.2}); P.blob(cx - 11, b - 12, 4.2, 4, body, {s: 8, bias: -.15});   // back arm + fist
    P.blob(cx, b - 21, 11, 13, body, {s: 5, j: .3});   // the sack of a body
    P.blob(cx + 4, b - 34, 6.5, 6, body, {s: 6});      // head, pushed forward
    P.blob(cx + 10, b - 20, 4, 5, body, {s: 9}); P.blob(cx + 13, b - 16, 4.8, 4.6, body, {s: 10});   // front arm, fist forward
    for (let y = b - 30; y < b - 12; y += 2) P.p(cx - 3, y, body, 3);   // stitched seam
    for (let x = cx - 10; x <= cx + 10; x++) if (P.on(x, b - 13)) { P.p(x, b - 13, belt, 1); P.p(x, b - 12, belt, 2); }   // belt
    if (S.id === 'ruins') {
      P.disk(cx + 3.5, b - 20.5, 3.3, (x, y) => P.p(x, y, RED, 1)); P.disk(cx + 3.5, b - 20.5, 1.5, (x, y) => P.p(x, y, S.cloth, 0));
      for (const [x, y] of [[cx - 6, b - 33], [cx - 5, b - 34], [cx + 8, b - 27], [cx - 13, b - 23]]) P.p(x, y, S.straw, 0);
    }
    if (S.id === 'ember') { P.rect(cx - 4, b - 25, 9, 8, S.metal, 1); P.rect(cx - 4, b - 25, 9, 1, S.metal, 0); for (const [x, y] of [[cx - 3, b - 24], [cx + 3, b - 24], [cx - 3, b - 19], [cx + 3, b - 19]]) P.p(x, y, S.metal, 3); }
    if (S.id === 'frost') for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (P.mat(x, y) === body.id && vn(x / 2, y / 2, 11) > .7) P.shift(x, y, -1);   // fur tufts
    const eye = (x, y) => { P.p(x, y, body, 3); P.p(x + 1, y, body, 3); P.p(x, y + 1, body, 3); P.p(x + 1, y + 1, body, 2); P.p(x, y - 1, body, 0); };
    eye(cx + 4, b - 36); eye(cx + 8, b - 36);
    for (let x = cx + 3; x <= cx + 9; x++) P.p(x, b - 32 + (x % 2), body, 3);   // stitched mouth
    P.outline();
    if (S.id === 'frost') for (const [x, l] of [[cx - 12, 4], [cx - 10, 3], [cx + 12, 3], [cx + 14, 5]]) for (let i = 0; i < l; i++) P.p(x, b - (x < cx ? 9 : 26) + i, S.ice, i ? 1 : 0);
    if (S.id === 'rift') { for (const [x, t, hh] of [[cx - 7, b - 42, 9], [cx - 3, b - 44, 11], [cx - 10, b - 37, 7]]) crystal(P, E, S, x, t, 2.4, hh, x, {lean: -2}); crystal(P, E, S, cx + 1, b - 25, 2.5, 8, 3); }
    if (S.id === 'ember' || S.id === 'rift') for (const x of [cx + 4, cx + 8]) { const c = S.id === 'ember' ? '#ffb050' : S.rune; glowAt(P, E, x, b - 36, c, null); glowAt(P, E, x + 1, b - 35, c, null); }
  });
  return left ? mirror(sp) : sp;
}

// ============================================================ biomes
const PAINTERS = {wall_n: (p, c, S) => wallEW(p, c, S, false), wall_s: (p, c, S) => wallEW(p, c, S, true), wall_w: wallNS, wall_e: wallNS,
  tower, gatepost, pillar: (p, c, S) => pillar(p, c, S, false), pillar_broken: (p, c, S) => pillar(p, c, S, true), rubble,
  dummy, brazier, torch, bush, rock, tuft, reed, fern, tree, rock_big: rockBig,
  crate, barrel: (p, c, S) => barrel(p, c, S, false), barrel_x: (p, c, S) => barrel(p, c, S, true), pot, crystal: crystalProp, chest,
  brute: (p, c, S) => brute(p, c, S, faceLeft(p))};
const GROUND = {ruins: groundRuins, ember: groundEmber, frost: groundFrost, rift: groundRift};
function makeBiome(id) {
  const S = STYLES[id], cache = new Map(), memo = new WeakMap();
  const B = {
    id, name: S.name, style: S, groundEmit: null, groundLights: [], hole: () => false,
    paintGround(q, ctx) { GROUND[id](q, ctx, B); },
    sprite(p, ctx) {
      // fast path: this prop's sprite at the current ground projection and state (breakable stage, open, facing)
      const sig = (p.stage | 0) * 4 + (p.opened ? 2 : 0) + (p.kind === 'brute' && faceLeft(p) ? 1 : 0) + (p.sconce ? 64 : 0) + (p.unlit ? 128 : 0) + (p.model ? 256 : 0) + (p.fx ? 512 : 0), hit = memo.get(p);
      if (hit && hit.ppmy === ctx.PPMY && hit.sig === sig) return hit.s;
      const s = B.spriteOf(p, ctx, sig); memo.set(p, {ppmy: ctx.PPMY, sig, s}); return s;
    },
    spriteOf(p, ctx, sig = 0) {
      const k = p.kind;
      if (p.outside && B.hole(p.x, p.y, ctx)) return null;
      const wall = k.startsWith('wall_');
      const key = `${k}|${p.variant | 0}|${p.light | 0}|${sig}|${ctx.PPMY.toFixed(2)}` + (wall ? `|${p.x}|${p.y}` : k === 'tree' ? `|${speciesOf(p, id)}` : '');   // (a tree's species is part of the card)
      let s = cache.get(key);
      if (s === undefined) { const f = PAINTERS[k]; s = f ? f(p, ctx, S) : null; cache.set(key, s); }
      return s;
    },
  };
  if (S.dust === false) B.dust = false;
  return B;
}
export const BIOMES = ['ruins', 'ember', 'frost', 'rift'].map(makeBiome);
// the pixel toolkit, for modules that paint their own props in the same style (render3d/features/lights.js)
export const ART = {Pix, build, flame, flameCols, glowAt, ramp, hex, mixHex, hsh, vn, rng, M, STYLES, RAMPS};
