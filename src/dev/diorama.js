// DIORAMA: the wardrobe studio's layered backdrop (themes: a puppet show, forest, mountains, desert) (dev/studio.js): a "3D" scene behind him made of flat pixel-art cut-outs
// at different distances, like a theatre set or a pop-up book: the sky, far mountains, hills, a treeline, the near ground,
// and a framing layer in front of him. Each layer is a picture painted here in code once (a theme's palette, value-noise
// ridges, pines, crowns, mesas, clouds, grass, a seeded generator: the same picture every time) and drawn as a lit sprite
// in the studio's renderer at its depth, so the studio light (day, dawn, dusk, night) tints it; far layers are painted
// hazier (toward the sky's colour), near ones darker and fuller.
// THE DEPTH shows by PARALLAX: the studio's camera is orthographic (nothing gets smaller with distance), so each layer is
// shifted by the view's motion times its own share (par: the sky 0 .. the foreground past 1): the pointer over the screen
// (a little), a slow drift of its own, the view's move (right-drag). Clouds drift, the near grass and leaves sway a pixel.
// Shifts are whole art px (the pictures stay crisp).
// API: const d = createDiorama(G); d.themes; d.set(name); d.sky(light) -> [r, g, b] (the rest of the frame);
//   d.draw(t, cam: {x, y} (the view's motion, art px), feet: {x, y} (his feet on screen, art px from the view's centre), T,
//   PPM, PPMY, PPMH) every frame it shows.
// OWNS: its pictures (canvases, made once per theme). READS: nothing. BUDGET: a theme's pictures painted once (a few ms);
//   a frame: ~8 sprites.
import {mulberry32} from '../core/rng.js';

const hex = c => { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;
// value noise on a line (seeded): smooth 0..1
function noise1(rng, n) {
  const v = Array.from({length: n + 2}, () => rng());
  return x => { const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f); return v[i % (n + 1)] * (1 - s) + v[(i + 1) % (n + 1)] * s; };
}
// a ridge: heights (px from the bottom) for x in 0..W, from octaves of noise
function ridge(rng, W, base, amp, scale, oct = 3) {
  const ns = Array.from({length: oct}, () => noise1(rng, Math.ceil(W / scale) + 4)), out = new Float32Array(W);
  for (let x = 0; x < W; x++) { let h = 0, a = 1, f = 1, t = 0; for (const n of ns) { h += n(x / scale * f) * a; t += a; a *= .5; f *= 2.1; } out[x] = base + amp * (h / t); }
  return out;
}
function canvas(W, H) { const c = document.createElement('canvas'); c.width = W; c.height = H; const q = c.getContext('2d'); q.imageSmoothingEnabled = false; return {c, q, W, H}; }
const px = (q, x, y, w = 1, h = 1) => q.fillRect(x | 0, y | 0, w, h);

// ---------------------------------------------------------------- the painters (each: a picture, its bottom at the canvas's bottom)
function mountains(rng, W, H, col, snow, shade) {
  const L = canvas(W, H), q = L.q, r = ridge(rng, W, H * .25, H * .7, 70, 4);
  for (let x = 0; x < W; x++) {
    const top = H - Math.round(r[x]);
    q.fillStyle = css(col); px(q, x, top, 1, H - top);
    const sl = r[Math.min(W - 1, x + 1)] - r[x];   // the right-facing slopes in shade, a stripe of light on the left ones
    if (sl < -.3) { q.fillStyle = css(shade); px(q, x, top, 1, Math.min(H - top, 6 + ((x * 7) % 5))); }
    if (snow && r[x] > H * .68) { q.fillStyle = css(snow); px(q, x, top, 1, Math.round((r[x] - H * .68) * .6) + 1); }
  }
  return L;
}
function hills(rng, W, H, col, light) {
  const L = canvas(W, H), q = L.q, r = ridge(rng, W, H * .35, H * .55, 110, 3);
  for (let x = 0; x < W; x++) { const top = H - Math.round(r[x]); q.fillStyle = css(col); px(q, x, top, 1, H - top); q.fillStyle = css(light); px(q, x, top, 1, 1); }
  return L;
}
function pines(rng, W, H, col, light, n, hMin, hMax, ground) {
  const L = canvas(W, H), q = L.q, g = ridge(rng, W, ground * .6, ground * .8, 90, 2);
  for (let x = 0; x < W; x++) { q.fillStyle = css(col); px(q, x, H - Math.round(g[x]), 1, Math.round(g[x])); }
  for (let i = 0; i < n; i++) {
    const x0 = Math.floor(rng() * W), h = hMin + rng() * (hMax - hMin), w = h * (.32 + rng() * .1), b = H - g[Math.min(W - 1, x0)] + 2;
    for (let y = 0; y < h; y++) {
      const half = Math.max(0, Math.round((y / h) * w / 2 + (((y + i) % 4) === 0 ? 1 : 0)));
      q.fillStyle = css(col); px(q, x0 - half, b - h + y, half * 2 + 1, 1);
      if (half > 1) { q.fillStyle = css(light); px(q, x0 - half, b - h + y, 1, 1); }
    }
    q.fillStyle = css(col); px(q, x0, b - 1, 1, 3);
  }
  return L;
}
function crowns(rng, W, H, col, light, dark, n, rMin, rMax, ground) {
  const L = canvas(W, H), q = L.q, g = ridge(rng, W, ground * .5, ground * .9, 80, 2);
  for (let x = 0; x < W; x++) { q.fillStyle = css(dark); px(q, x, H - Math.round(g[x]), 1, Math.round(g[x])); }
  for (let i = 0; i < n; i++) {
    const x0 = rng() * W, r = rMin + rng() * (rMax - rMin), b = H - g[Math.min(W - 1, x0 | 0)], cy = b - r * 1.6;
    q.fillStyle = css(dark); px(q, x0 - 1, cy, 3, b - cy);   // the trunk
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = (x * x) / (r * r) + (y * y) / (r * r * .8);
      if (d > 1 - rng() * .08) continue;
      q.fillStyle = css(x + y < -r * .5 ? light : d > .7 && x - y > r * .3 ? dark : col); px(q, x0 + x, cy + y, 1, 1);
    }
  }
  return L;
}
function mesas(rng, W, H, col, light, shade) {
  const L = canvas(W, H), q = L.q;
  let x = -30;
  while (x < W) {
    const w = 50 + rng() * 140, h = H * (.4 + rng() * .5), top = H - h, tilt = (rng() - .5) * 6, talus = h * (.35 + rng() * .2);
    for (let c = 0; c < w; c++) {
      const t0 = Math.round(top + tilt * c / w);
      q.fillStyle = css(c > w * .78 ? shade : col); px(q, x + c, t0, 1, H - t0);
      q.fillStyle = css(light); px(q, x + c, t0, 1, 2);
    }
    for (let y = 0; y < talus; y++) {   // the scree at its foot, wider as it goes down
      const sp = Math.round(y * 1.3), yy = H - talus + y;
      q.fillStyle = css(col); px(q, x - sp, yy, sp, 1); q.fillStyle = css(shade); px(q, x + w, yy, sp, 1);
    }
    for (let s = 1; s < 4; s++) {   // the strata, broken
      const yy = Math.round(top + s * h / 4.2);
      q.fillStyle = css(shade);
      for (let c = 2; c < w - 2; c += 1) if (((c * 7 + s * 13) % 11) < 8) px(q, x + c, yy + Math.round(tilt * c / w), 1, 1);
    }
    x += w + 20 + rng() * 90;
  }
  return L;
}
function dunes(rng, W, H, col, light) {
  const L = canvas(W, H), q = L.q, r = ridge(rng, W, H * .3, H * .5, 140, 2);
  for (let x = 0; x < W; x++) { const top = H - Math.round(r[x]); q.fillStyle = css(col); px(q, x, top, 1, H - top); q.fillStyle = css(light); px(q, x, top, 1, 2); }
  return L;
}
function ground(rng, W, H, col, light, dark, rocks) {
  const L = canvas(W, H), q = L.q, r = ridge(rng, W, H - 30, 14, 60, 2);   // (the ridge ~ 16..30 px under its top)
  for (let x = 0; x < W; x++) {
    const top = H - Math.round(r[x]);
    q.fillStyle = css(col); px(q, x, top, 1, H - top);
    if (rng() < .35) { q.fillStyle = css(light); px(q, x, top - 1 - (rng() * 3 | 0), 1, 2); }   // grass tips
    if (rng() < .08) { q.fillStyle = css(dark); px(q, x, top + 3 + rng() * (H - top - 4), 1, 1); }
  }
  for (let i = 0; i < rocks; i++) {
    const x0 = rng() * W | 0, w = 4 + rng() * 8 | 0, h = 2 + rng() * 4 | 0, b = H - Math.round(r[Math.min(W - 1, x0)]) + 2 + (rng() * 6 | 0);
    q.fillStyle = css(dark); px(q, x0, b - h, w, h); q.fillStyle = css(light); px(q, x0, b - h, w - 1, 1);
  }
  return L;
}
function clouds(rng, W, H, col, light, n) {
  const L = canvas(W, H), q = L.q;
  for (let i = 0; i < n; i++) {
    const cx = rng() * W, cy = H * (.2 + rng() * .6), w = 30 + rng() * 60;
    for (let k = 0; k < 6; k++) {
      const bx = cx + (rng() - .5) * w, by = cy + (rng() - .5) * 6, r = 5 + rng() * 9;
      for (let y = -r; y <= r * .6; y++) for (let x = -r; x <= r; x++) if (x * x + y * y < r * r) { q.fillStyle = css(y < -r * .3 ? light : col); px(q, bx + x, by + y); }
    }
  }
  return L;
}
function sky(W, H, top, horizon) {
  const L = canvas(W, H), q = L.q, N = 9;
  for (let y = 0; y < H; y++) {
    const k = Math.pow(y / H, 1.4) * (N - 1), b = Math.floor(k), f = k - b;
    for (let x = 0; x < W; x += 1) {
      const band = f > .5 && ((x + y) & 1) ? b + 1 : b;   // (a checker where two bands meet: the pixel artist's dither)
      if (x === 0 || band !== (f > .5 && ((x - 1 + y) & 1) ? b + 1 : b)) q.fillStyle = css(mix(top, horizon, Math.min(1, band / (N - 1))));
      px(q, x, y);
    }
  }
  return L;
}
function stars(rng, W, H, col, n) { const L = canvas(W, H), q = L.q; q.fillStyle = css(col); for (let i = 0; i < n; i++) px(q, rng() * W, rng() * H); return L; }
// the framing in front of him: dark leaves and branches hanging in at the top corners, grass tufts along the bottom edge
function framing(rng, W, H, col, light) {
  const L = canvas(W, H), q = L.q, e0 = W * .19, e1 = W * .81;   // (what shows of a picture 1.6 views wide: .19 .. .81)
  for (const side of [0, 1]) {
    for (let i = 0; i < 14; i++) {
      const u = rng(), x0 = side ? e1 - u * W * .12 + 6 : e0 + u * W * .12 - 6, y0 = (1 - u) * H * .3 + rng() * 10 - 6, r = 8 + rng() * 14 * (1 - u * .6);
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x / (r * r) + y * y / (r * r * .55) < 1 - rng() * .12) { q.fillStyle = css(x + y < -r * .55 ? light : col); px(q, x0 + x, y0 + y); }
    }
    for (let v = 0; v < 3; v++) {   // hanging vines
      const vx = side ? e1 - 8 - rng() * W * .08 : e0 + 8 + rng() * W * .08, len = H * (.15 + rng() * .2);
      for (let y = 0; y < len; y++) { q.fillStyle = css(col); px(q, vx + Math.round(Math.sin(y * .12 + v) * 2), y); if (y % 9 === 4) { q.fillStyle = css(light); px(q, vx + 1, y, 2, 2); } }
    }
  }
  for (let x = 0; x < W; x++) if (x < e0 + W * .1 || x > e1 - W * .1) {   // grass at the bottom corners
    const k = x < e0 + W * .1 ? 1 - (x - e0) / (W * .1) : (x - (e1 - W * .1)) / (W * .1), h = 3 + rng() * 16 * Math.max(0, Math.min(1, k));
    q.fillStyle = css(col); px(q, x, H - h, 1, h); if (rng() < .3) { q.fillStyle = css(light); px(q, x, H - h, 1, 1); }
  }
  return L;
}

// ---------------------------------------------------------------- the puppet show's painters: flat cardboard, thick outlines,
// strings and sticks, a painted cloth behind (an obviously fake stage)
// a cut-out: the mask's pixels in fill (a light edge along the top-left), a dark outline round it
function cutout(q, W, H, inside, fill, outline, light) {
  const M = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) M[y * W + x] = 1;
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && M[y * W + x];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!M[y * W + x]) { if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) { q.fillStyle = css(outline); px(q, x, y); } continue; }
    q.fillStyle = css(light && (!at(x - 1, y) || !at(x, y - 1)) ? light : fill); px(q, x, y);
  }
}
function backcloth(rng, W, H, a, b, seam) {   // a painted sky: brush bands, cloth seams, a few drips
  const L = canvas(W, H), q = L.q;
  let y = 0; while (y < H) { const h = 5 + rng() * 10 | 0; q.fillStyle = css(rng() < .5 ? a : b); px(q, 0, y, W, h); y += h; }
  q.fillStyle = css(b);
  for (let i = 0; i < W / 18; i++) { const x = rng() * W | 0, yy = rng() * H | 0; px(q, x, yy, 1 + (rng() * 2 | 0), 3 + rng() * 9 | 0); }
  q.fillStyle = css(seam); for (let x = 60 + (rng() * 40 | 0); x < W; x += 110 + (rng() * 30 | 0)) px(q, x, 0, 1, H);
  return L;
}
function sunStick(rng, W, H, sun, rays, outline, stick) {   // a cardboard sun held up on a stick from above
  const L = canvas(W, H), q = L.q, cx = W * .66 | 0, cy = H - 26, r = 15;
  q.fillStyle = css(stick); px(q, cx - 1, 0, 3, cy - r);
  cutout(q, W, H, (x, y) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    return d < r || (d < r + 8 && Math.cos(a * 8) > .55);
  }, sun, outline, rays);
  q.fillStyle = css(outline); px(q, cx - 5, cy - 3, 2, 2); px(q, cx + 3, cy - 3, 2, 2); px(q, cx - 4, cy + 4, 8, 1);   // a painted face
  return L;
}
function cloudStrings(rng, W, H, fill, outline, light, string) {   // cardboard clouds hanging on strings
  const L = canvas(W, H), q = L.q, list = [];
  for (let i = 0; i < 5; i++) list.push({x: W * (.12 + i * .19 + (rng() - .5) * .06), y: H - 18 - rng() * 30, w: 22 + rng() * 14});
  q.fillStyle = css(string);
  for (const c of list) { px(q, c.x - c.w * .5 | 0, 0, 1, c.y - 8); px(q, c.x + c.w * .5 | 0, 0, 1, c.y - 8); }
  cutout(q, W, H, (x, y) => list.some(c => {
    const dx = (x - c.x) / c.w, dy = (y - c.y) / (c.w * .45);
    return (dx * dx + dy * dy < 1 && y < c.y + c.w * .25) || Math.hypot(x - c.x + c.w * .35, y - c.y + 4) < c.w * .4 || Math.hypot(x - c.x - c.w * .3, y - c.y + 2) < c.w * .35;
  }), fill, outline, light);
  return L;
}
function hillCutouts(rng, W, H, fill, outline, light, brace) {   // flat green hills, wooden braces showing at their feet
  const L = canvas(W, H), q = L.q, hills = [];
  for (let x = -40; x < W + 40; x += 60 + rng() * 60) hills.push({x, w: 50 + rng() * 60, h: 14 + rng() * 22});
  q.fillStyle = css(brace);
  for (const h of hills) { px(q, h.x + h.w * .2 | 0, H - 10, 2, 10); for (let k = 0; k < 9; k++) px(q, (h.x + h.w * .2 + k) | 0, H - 1 - k, 1, 1); }
  cutout(q, W, H, (x, y) => hills.some(h => { const dx = (x - h.x) / h.w; return dx * dx < 1 && y > H - 6 - h.h * Math.sqrt(1 - dx * dx) && y < H - 4; }), fill, outline, light);
  return L;
}
function lollipops(rng, W, H, crown, outline, light, trunk, base) {   // lollipop trees on little wooden stands
  const L = canvas(W, H), q = L.q, trees = [];
  for (let x = 10 + rng() * 30; x < W; x += 50 + rng() * 70) trees.push({x, r: 9 + rng() * 6, h: 14 + rng() * 12});
  for (const t of trees) {
    q.fillStyle = css(base); px(q, t.x - 7, H - 5, 14, 5); q.fillStyle = css(outline); px(q, t.x - 7, H - 6, 14, 1);
  }
  cutout(q, W, H, (x, y) => trees.some(t => (Math.abs(x - t.x) < 2 && y > H - 6 - t.h && y < H - 5)), trunk, outline, null);
  cutout(q, W, H, (x, y) => trees.some(t => Math.hypot(x - t.x, y - (H - 6 - t.h - t.r * .6)) < t.r), crown, outline, light);
  return L;
}
function boards(rng, W, H, a, b, line) {   // the stage floor: planks, their seams
  const L = canvas(W, H), q = L.q, top = 16;
  for (let y = top; y < H; y += 7) { q.fillStyle = css(((y / 7) | 0) & 1 ? a : b); px(q, 0, y, W, 7); q.fillStyle = css(line); px(q, 0, y, W, 1);
    for (let x = (rng() * 60) | 0; x < W; x += 50 + (rng() * 50 | 0)) px(q, x, y, 1, 7); }
  q.fillStyle = css(line); px(q, 0, top - 1, W, 2);
  return L;
}
function proscenium(rng, W, H, red, redDk, gold, goldDk, bulb) {   // the theatre's frame: curtains at the sides, a valance, footlights
  const L = canvas(W, H), q = L.q, e0 = Math.round(W * .19), e1 = Math.round(W * .81), cw = Math.round(W * .085);
  for (const side of [0, 1]) for (let c = 0; c < cw; c++) {   // the curtains, gathered: folds and a tie-back
    const x = side ? e1 - 1 - c : e0 + c, fold = ((c / 6) | 0) & 1;
    q.fillStyle = css(fold ? redDk : red); px(q, x, 0, 1, H);
  }
  for (const side of [0, 1]) { q.fillStyle = css(gold); px(q, side ? e1 - cw : e0 + cw - 6, H * .55 | 0, 6, 4); }   // the tie-backs
  const vh = 22;   // the valance: a gold-trimmed red pelmet with scallops
  q.fillStyle = css(red); px(q, e0, 0, e1 - e0, vh);
  for (let x = e0; x < e1; x++) { const k = ((x - e0) % 20) / 20, d = Math.round(Math.sin(k * Math.PI) * 6); q.fillStyle = css(red); px(q, x, vh, 1, d); q.fillStyle = css(gold); px(q, x, vh + d, 1, 2); }
  q.fillStyle = css(gold); px(q, e0, 3, e1 - e0, 2); q.fillStyle = css(goldDk); px(q, e0, 5, e1 - e0, 1);
  q.fillStyle = css(goldDk); px(q, e0, H - 9, e1 - e0, 9);   // the stage's lip, its footlights
  for (let x = e0 + 10; x < e1 - 6; x += 16) { q.fillStyle = css(bulb); px(q, x, H - 13, 4, 4); q.fillStyle = css(gold); px(q, x - 1, H - 10, 6, 2); }
  return L;
}

// ---------------------------------------------------------------- the themes: layers back to front
// a layer: {paint(rng, W, H) -> picture, w, h (art px; w: share of the view's width), par (parallax share), y (its bottom's
// screen offset from his feet, art px: + below), depth (m north of him: the depth buffer's order), drift (px/s), sway}
export const THEMES = {
  'puppet show': {sky: ['#7eb6e8', '#a9d2f2'], sw: ['#c43b2f', '#7eb6e8'],   // (an obviously fake stage: cardboard on sticks and strings)
    layers: P => [
      {name: 'backcloth', par: .04, y: 30, depth: 70, paint: (r, W, H) => backcloth(r, W, H, P.sky, P.sky2, P.seam), h: 'tall'},
      {name: 'sun', par: .08, y: -6, depth: 55, bob: 2, paint: (r, W, H) => sunStick(r, W, H, P.sun, P.sunLt, P.ink, P.stick), h: 170},
      {name: 'clouds', par: .12, y: -22, depth: 50, sway: 2, paint: (r, W, H) => cloudStrings(r, W, H, P.cloud, P.ink, P.cloudLt, P.string), h: 170},
      {name: 'hills', par: .25, y: 10, depth: 35, paint: (r, W, H) => hillCutouts(r, W, H, P.hill, P.ink, P.hillLt, P.wood), h: 80},
      {name: 'trees', par: .45, y: 16, depth: 24, bob: 1, paint: (r, W, H) => lollipops(r, W, H, P.crown, P.ink, P.crownLt, P.trunk, P.wood), h: 80},
      {name: 'floor', par: .9, y: 142, depth: 6, paint: (r, W, H) => boards(r, W, H, P.board, P.board2, P.boardLn), h: 170},
      {name: 'stage', par: 1.15, y: 0, depth: -3, front: true, paint: (r, W, H) => proscenium(r, W, H, P.red, P.redDk, P.gold, P.goldDk, P.bulb), h: 'view'},
    ],
    pal: {sky: '#7eb6e8', sky2: '#8cc0ee', seam: '#6aa2d6', sun: '#ffd84a', sunLt: '#fff0a0', ink: '#2b1d14', stick: '#6b4a2b',
      cloud: '#f2f0ea', cloudLt: '#ffffff', string: '#e8e0cc', hill: '#5fae4a', hillLt: '#86cc62', wood: '#8a6a42', crown: '#3f9a46',
      crownLt: '#6cc25a', trunk: '#8a5a32', board: '#b07a46', board2: '#9c6a3c', boardLn: '#5e3c20', red: '#c43b2f', redDk: '#8f2623',
      gold: '#e8b84a', goldDk: '#8a6420', bulb: '#fff3b0'}},
  'forest': {sky: ['#7fb3e6', '#e3f0f6'], sw: ['#7fb3e6', '#3f6b3e'],
    layers: P => [
      {name: 'clouds', par: .04, y: -150, depth: 60, drift: 2, paint: (r, W, H) => clouds(r, W, H, P.cloud, P.cloudHi, 7), h: 70},
      {name: 'mountains', par: .08, y: 0, depth: 50, paint: (r, W, H) => mountains(r, W, H, P.far, P.snow, P.farSh), h: 140},
      {name: 'hills', par: .2, y: 0, depth: 40, paint: (r, W, H) => hills(r, W, H, P.hill, P.hillHi), h: 90},
      {name: 'treeline', par: .38, y: 12, depth: 30, paint: (r, W, H) => pines(r, W, H, P.pine, P.pineHi, 120, 14, 34, 26), h: 70},
      {name: 'forest', par: .62, y: 22, depth: 20, paint: (r, W, H) => crowns(r, W, H, P.crown, P.crownHi, P.crownDk, 34, 8, 16, 32), h: 90},
      {name: 'ground', par: .9, y: 142, depth: 6, paint: (r, W, H) => ground(r, W, H, P.ground, P.groundHi, P.groundDk, 18), h: 170},
      {name: 'front', par: 1.35, y: 0, depth: -3, front: true, sway: 1, paint: (r, W, H) => framing(r, W, H, P.leaf, P.leafHi), h: 'view'},
    ],
    pal: {cloud: '#eef3f6', cloudHi: '#ffffff', far: '#8c9fc0', snow: '#e9eff8', farSh: '#7889ad', hill: '#6f8fa3', hillHi: '#86a6b6',
      pine: '#4f7466', pineHi: '#5f8676', crown: '#3f6b3e', crownHi: '#558a4b', crownDk: '#2d4d2f', ground: '#5d7f3c', groundHi: '#7fa14c', groundDk: '#4a6431',
      leaf: '#1f3320', leafHi: '#2d4a2c'}},
  'mountains': {sky: ['#6fa6e0', '#dcebf6'], sw: ['#6fa6e0', '#a9b9d0'],
    layers: P => [
      {name: 'clouds', par: .03, y: -170, depth: 60, drift: 3, paint: (r, W, H) => clouds(r, W, H, P.cloud, P.cloudHi, 9), h: 80},
      {name: 'peaks', par: .06, y: 5, depth: 55, paint: (r, W, H) => mountains(r, W, H, P.far, P.snow, P.farSh), h: 160},
      {name: 'ridge', par: .16, y: 12, depth: 45, paint: (r, W, H) => mountains(r, W, H, P.mid, P.snow2, P.midSh), h: 110},
      {name: 'slopes', par: .34, y: 14, depth: 32, paint: (r, W, H) => pines(r, W, H, P.pine, P.pineHi, 90, 8, 18, 32), h: 70},
      {name: 'ground', par: .9, y: 142, depth: 6, paint: (r, W, H) => ground(r, W, H, P.ground, P.groundHi, P.groundDk, 30), h: 170},
      {name: 'front', par: 1.35, y: 0, depth: -3, front: true, sway: 1, paint: (r, W, H) => framing(r, W, H, P.leaf, P.leafHi), h: 'view'},
    ],
    pal: {cloud: '#f2f5f8', cloudHi: '#ffffff', far: '#b8c4da', snow: '#f4f7fc', farSh: '#a2aec7', mid: '#8a97ad', snow2: '#e8edf4', midSh: '#76839a',
      pine: '#3f5f58', pineHi: '#4d726a', ground: '#6b7d4a', groundHi: '#8a9a5c', groundDk: '#55653a', leaf: '#1d2b26', leafHi: '#2a3c35'}},
  'desert': {sky: ['#7db2e6', '#f6e6c8'], sw: ['#7db2e6', '#b86a45'],
    layers: P => [
      {name: 'clouds', par: .03, y: -140, depth: 60, drift: 2, paint: (r, W, H) => clouds(r, W, H, P.cloud, P.cloudHi, 4), h: 70},
      {name: 'far mesas', par: .07, y: -8, depth: 50, paint: (r, W, H) => mesas(r, W, H, P.far, P.farHi, P.farSh), h: 75},
      {name: 'mesas', par: .22, y: 14, depth: 38, paint: (r, W, H) => mesas(r, W, H, P.mid, P.midHi, P.midSh), h: 60},
      {name: 'dunes', par: .45, y: 22, depth: 25, paint: (r, W, H) => dunes(r, W, H, P.dune, P.duneHi), h: 60},
      {name: 'ground', par: .9, y: 142, depth: 6, paint: (r, W, H) => ground(r, W, H, P.ground, P.groundHi, P.groundDk, 26), h: 170},
    ],
    pal: {cloud: '#f7efe2', cloudHi: '#ffffff', far: '#d9a98a', farHi: '#e8c2a5', farSh: '#c4917a', mid: '#b86a45', midHi: '#d68c5c', midSh: '#94522f',
      dune: '#d9b071', duneHi: '#ecc98a', ground: '#c99a5b', groundHi: '#ddb174', groundDk: '#a87b45'}},
};
// the night: the same layers, stars in the sky
const STAR = '#fff6d8';

export function createDiorama(G) {
  let theme = null, made = null, viewW = 0, starPic = null, skyPic = null;
  const D = {img: null, em: null, x: 0, y: 0, z: 0, px: 0, py: 0, sw: 0, sh: 0, type: 3, alpha: 1, flip: false, sway: 0, flash: 0, lie: 0};
  function make(name, VW, VH) {
    const T = THEMES[name], rng = mulberry32(0x5eed ^ name.length * 977), P = {};
    for (const [k, v] of Object.entries(T.pal)) P[k] = hex(v);
    const W = Math.ceil(VW * 1.6);   // (room for the parallax both ways)
    made = T.layers(P).map(L => {
      const h = L.h === 'view' ? VH : L.h === 'tall' ? Math.ceil(VH * 1.5) : L.h, pic = L.paint(rng, W, h);
      return {...L, pic: pic.c, W, H: h};
    });
    skyPic = sky(W, Math.ceil(VH * 1.5), hex(T.sky[0]), hex(T.sky[1])).c;
    starPic = stars(mulberry32(77), W, Math.ceil(VH * .7), hex(STAR), Math.round(W * VH * .0012)).c;
    viewW = VW;
  }
  return {
    themes: Object.keys(THEMES),
    has: name => name in THEMES,
    get on() { return !!theme; },
    set(name) { name = name in THEMES ? name : null; if (name !== theme) { theme = name; made = null; } },
    // the sky's top colour (0..1: the rest of the frame, behind the sky picture)
    skyTop() { return THEMES[theme] ? hex(THEMES[theme].sky[0]).map(v => v / 255) : null; },
    // the layers at their depths, shifted by the view's motion (cam) times their share
    draw(t, cam, feet, T, VW, VH, PPM, PPMY, PPMH, night) {
      if (!theme) return;
      if (!made || Math.abs(VW - viewW) > 8) make(theme, VW, VH);
      const put = (img, W, H, sx, sy, depth, em = null) => {   // a picture with its bottom-centre at screen (sx, sy) art px from the view's centre
        // (screen -> the studio's world: x east = sx / PPM + T.x; at the depth's z (south +), the height that puts it there)
        const z = -depth, y = ((z - T.z) * PPMY - sy) / PPMH;
        D.img = img; D.em = em; D.x = T.x + sx / PPM; D.y = y; D.z = z; D.sw = W; D.sh = H; D.px = W / 2; D.py = H; G.sprite(D);
      };
      put(skyPic, skyPic.width, skyPic.height, 0, feet.y + 20, 90);   // (its bottom just under his feet: it fills behind every layer)
      if (night) put(starPic, starPic.width, starPic.height, -Math.round(cam.x * .02), Math.round(-VH * .2), 80, starPic);   // (the stars glow: their own emission)
      for (const L of made) {
        let ox = -Math.round(cam.x * L.par), oy = -Math.round(cam.y * L.par * .5);
        if (L.drift) ox = ((Math.round(ox + t * L.drift) % (L.W - VW) + (L.W - VW)) % (L.W - VW)) - (L.W - VW) / 2;
        if (L.sway) ox += Math.round(Math.sin(t * .9) * L.sway);
        if (L.bob) oy += Math.round(Math.sin(t * 1.3 + L.depth) * L.bob);   // (held up by a hand off stage: it bobs)
        const sy = L.front ? Math.round(VH / 2) + oy : feet.y + L.y + oy;
        put(L.pic, L.W, L.H, (L.front ? 0 : feet.x) + ox, sy, L.depth);
      }
      D.img = D.em = null;
    },
  };
}
