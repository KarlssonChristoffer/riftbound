// HAZARDS (view): the look of sim/hazards.js's zones, readable at the game's pixel scale. Presentation only: it reads the
// kit's records and the frame's 'hazard.burst' events and writes nothing but its own effects (its random draws are its
// own generator: core/rng.js viewRandom).
//   telegraph   every zone with a warning shows WHERE (a dashed ring at its radius, crawling) and WHEN (a second ring
//               that closes in, or for a nova fills out, to meet the first the moment it goes off); a light grows under it
//   styles      'strike'  a violet ring closing in from far out, a cross at the centre, a flickering leader from the sky in
//                         the last moment; then the BOLT (jagged emissive lines from the sky, a fork), a flash of light, a
//                         shock ring, sparks, a scorch that fades
//               'frost'   an icy ring filling out; then the nova: a white ring racing out, ice shards, rime on the ground
//               'blast'   an orange ring closing; then a ring of fire, a fireball, embers
//               'fire'    a burning patch: an ember that catches, then glowing coals on the ground (a painted decal: lit like
//                         the ground by day, glowing at night) with flame tongues licking up off them, dying down at the
//                         end; one light each (the nearest few)
//   ground      what lies ON the ground is painted into the renderer's screen layers (G.glayer): 'ground' (its colour,
//               lit like the ground and under everything standing on it) and 'emit' (its glow). The patches come from one
//               atlas canvas painted once per size and flicker frame (a draw per layer however many burn); a telegraph's
//               danger zone is hatched in its colour, stronger as the moment nears
//               'ring'    anything else: the telegraph in its colour and a flash ring
// OWNS: its effects (bolts, marks, flashes, particles: pooled, capped), the patch atlas. READS: the kit (H.list, H.n), host
//   (point, line, glayer, yaw, G.onScreen / toScreenInto). BUDGET: ~.05-.15 ms a frame in a busy fight (points, lines,
//   layer ops; nothing allocated per frame).
//   const look = createHazardLook(host, H, {name})   (name: the kit's, to pick its own events out of the frame's)
//   look.view(dt, evs)  the bursts' effects begin, particles move     look.frame(t)  draw     look.clear()
//   look.lights(push)   push(x, y, h, color, radius, intensity, flicker, id) for each light it wants this frame
import {rgbOf, hex255} from '../core/color.js';
import {viewRandom} from '../core/rng.js';
import {TAU, clamp, hash3, vnoise} from '../core/mathx.js';
import {TERRAIN_ON} from '../world/layout.js';   // walkable terrain: rings follow the ground point by point
import {AIRK, createDrift} from './airdrift.js';   // the particles in the moving air (G.air: a blast's smoke blown about; AIRK.hazards)

const C = c => rgbOf(c);
const PAL = {
  strike: {hi: C('#f4ecff'), mid: C('#c8a8ff'), lo: C('#6a4aa8'), bolt: C('#f8f4ff'), fork: C('#b49cff'), scorch: [C('#2a2230'), C('#3a3044'), C('#4a3a5a')], spark: [C('#ffffff'), C('#e0d0ff'), C('#a888ff'), C('#6a4aa8')]},
  frost: {hi: C('#f4feff'), mid: C('#9fe6ff'), lo: C('#3a7ab0'), rime: [C('#e8f8ff'), C('#bfe8ff'), C('#8ac8ec')], spark: [C('#ffffff'), C('#d8f6ff'), C('#9fe6ff'), C('#5aa8d8')]},
  blast: {hi: C('#fff4c8'), mid: C('#ff9a3a'), lo: C('#a8341c'), spark: [C('#fff8d8'), C('#ffd060'), C('#ff8a30'), C('#c84a1c')], smoke: [C('#5a524c'), C('#46403c'), C('#36322e')]},
  fire: {coal: [C('#3a1a12'), C('#7a2a1a'), C('#c8481c'), C('#ff8a30')], flame: [C('#fff6c8'), C('#ffd060'), C('#ff8a30'), C('#d8401c')], spark: [C('#fff6c8'), C('#ffd060'), C('#ff8a30'), C('#c84a1c')]},
};
const LIGHT = {strike: '#c8a8ff', frost: '#bfeeff', blast: '#ffa040', fire: '#ff8a34'};
const HATCH = {strike: '#b48cff', frost: '#9fe6ff', blast: '#ff7a2a'};   // a telegraph's danger zone on the ground
// the patch decal: its colours by heat (ground: albedo, lit), its glow (emit), the charred rim
const COAL = ['#3a1a12', '#5a1e12', '#8a2a14', '#b83c18', '#e8642a', '#ffa040', '#ffd870'], GLOW = ['#6a200c', '#b03c14', '#ff7a2a', '#ffc850'], CHAR = ['#24140e', '#3a2418'];
const FRAMES = 3;
const COAL8 = COAL.map(hex255), GLOW8 = GLOW.map(hex255), CHAR8 = CHAR.map(hex255);   // (the atlas is painted as bytes)

export function createHazardLook(host, H, {name = 'hazards'} = {}) {
  const R = viewRandom('hazards.' + name), rr = (a, b) => a + R() * (b - a);
  const PO = {size: 1, alpha: 1, emit: false};
  const cols = new Map(), colOf = c => { let v = cols.get(c); if (!v) { v = rgbOf(c); cols.set(c, v); } return v; };
  let z = 1, T = 0, gq = null, eq = null;
  const SV = [0, 0, 0], SW = [0, 0, 0];
  const GQ = () => gq ??= host.glayer('ground'), EQ = () => eq ??= host.glayer('emit');
  // ---- the patch atlas: per size (r in tenths of a metre), FRAMES flicker frames side by side, ground over glow
  let atlas = null, shelfX = 0, shelfY = 0, shelfH = 0;
  const slots = new Map();
  function patchSlot(r10) {
    let S = slots.get(r10); if (S) return S;
    const rx = Math.round(r10 / 10 * host.PPM), ry = Math.round(r10 / 10 * host.PPMY), w = 2 * rx + 1, h = 2 * ry + 1;
    if (!atlas) { atlas = document.createElement('canvas'); atlas.width = 512; atlas.height = 512; }
    if (shelfX + w * FRAMES > atlas.width) { shelfX = 0; shelfY += shelfH; shelfH = 0; }
    if (shelfY + 2 * h > atlas.height) return null;   // (full: never with the kit's sizes)
    S = {x: shelfX, y: shelfY, w, h}; shelfX += w * FRAMES; shelfH = Math.max(shelfH, 2 * h); slots.set(r10, S);
    // painted into one ImageData (a few thousand pixels: ~.2 ms, not a fillRect each), then put in its place once
    const W = w * FRAMES, img = new ImageData(W, 2 * h), D = img.data;
    const put = (X, Y, c) => { const o = (Y * W + X) * 4; D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = 255; };
    for (let f = 0; f < FRAMES; f++) for (let j = -ry; j <= ry; j++) for (let i = -rx; i <= rx; i++) {
      const e = (i / (rx + .5)) ** 2 + (j / (ry + .5)) ** 2; if (e > 1) continue;
      const d = Math.sqrt(e), hs = hash3(i, j, r10), X = f * w + rx + i, Y = ry + j;
      if (d > .84) { if (hs < .5 + (1 - d) * 2) put(X, Y, CHAR8[hs < .22 ? 0 : 1]); continue; }   // a ragged charred rim
      const heat = (1 - d) * .7 + vnoise((i + 40) * .3, (j + 40) * .36, 7) * .5 + (hash3(i, j, 31 + f) - .5) * .32;
      const ci = clamp(Math.floor(heat * 7.2) - 1, 0, COAL.length - 1);
      put(X, Y, COAL8[ci]);
      if (ci >= 3) put(X, Y + h, GLOW8[Math.min(3, ci - 3)]);
    }
    atlas.getContext('2d').putImageData(img, S.x, S.y);
    host.G.touch(atlas);
    return S;
  }
  // view px per art px here (whatever the zoom): a metre to the view's right, projected
  function zoomAt(x, y, h) {
    const a = host.yaw; host.G.toScreenInto(x, h, y, SV); host.G.toScreenInto(x + Math.cos(a), h, y - Math.sin(a), SW);
    return Math.hypot(SW[0] - SV[0], SW[1] - SV[1]) / host.PPM;
  }
  // a hatched ellipse of radius r round (x, y) on the ground layer (rows every other art px), alpha a
  function hatch(x, y, h, r, col, a, phase) {
    const q = GQ(); host.G.toScreenInto(x, h, y, SV);
    const ex = r * host.PPM * z, ey = r * host.PPMY * z, cx = SV[0], cy = SV[1], st = 2 * z;
    q.globalAlpha = clamp(a, 0, 1); q.fillStyle = col;
    for (let dy = -ey + (phase & 1) * z; dy <= ey; dy += st) {
      const k = 1 - (dy / ey) ** 2; if (k <= 0) continue;
      const hw = Math.round(ex * Math.sqrt(k)); q.fillRect(Math.round(cx) - hw, Math.round(cy + dy), 2 * hw, z);
    }
    q.globalAlpha = 1;
  }
  function pt(x, y, h, c, size, emit, alpha = 1) { PO.size = size * z; PO.emit = emit; PO.alpha = alpha; host.point(x, y, h, c, PO); }
  // a dashed ring of world points on the ground, one per screen pixel round its ellipse: `on` of every `of` lit, crawling
  function ring(x, y, h, r, c, turn, of, on, emit, alpha = 1) {
    if (r <= .02) return;
    const n = Math.max(12, Math.round(r * (host.PPM + host.PPMY) * 1.6)), sh = Math.floor(turn * n / TAU), off = TERRAIN_ON ? h - host.elev(x, y) : 0;
    for (let i = 0; i < n; i++) {
      if ((((i + sh) % of) + of) % of >= on) continue;
      const a = i / n * TAU, px = x + Math.sin(a) * r, py = y + Math.cos(a) * r; pt(px, py, TERRAIN_ON ? host.elev(px, py) + off : h, c, 1, emit, alpha);
    }
  }
  const seen = (x, y, h, m = 60) => host.G.onScreen(x, h, y, m);

  // ---------------------------------------------------------------- effects (pooled)
  // particles: structure of arrays, capped
  const PN = 700, px = new Float32Array(PN), py = new Float32Array(PN), ph = new Float32Array(PN), pvx = new Float32Array(PN), pvy = new Float32Array(PN),
    pvh = new Float32Array(PN), pt0 = new Float32Array(PN), plife = new Float32Array(PN), pgrav = new Float32Array(PN), pdrag = new Float32Array(PN),
    psz = new Uint8Array(PN), pem = new Uint8Array(PN), ppal = new Array(PN).fill(null);
  // its share of the moving air (m/s) and how it takes it (0 sparks / embers / shards: slowly, 1 smoke / rime: fast)
  const pax = new Float32Array(PN), pay = new Float32Array(PN), pai = new Uint8Array(PN), AD = createDrift(host), AKH = AIRK.hazards, AIR2 = new Float32Array(2);
  let pn = 0;
  function part(x, y, h, vx, vy, vh, life, pal, o) {
    if (pn >= PN) return;
    const i = pn++; px[i] = x; py[i] = y; ph[i] = h; pvx[i] = vx; pvy[i] = vy; pvh[i] = vh; pt0[i] = 0; plife[i] = life; ppal[i] = pal;
    pgrav[i] = o?.grav ?? 0; pdrag[i] = o?.drag ?? 0; psz[i] = o?.sz ?? 1; pem[i] = o?.emit === false ? 0 : 1;
    pax[i] = pay[i] = 0; pai[i] = pal === PAL.blast.smoke || pal === PAL.frost.rime ? 1 : 0;
  }
  const OG = {grav: 9, drag: 2, sz: 1, emit: true}, OD = {grav: 0, drag: 3, sz: 1, emit: true}, OS = {grav: -.6, drag: 1.5, sz: 2, emit: false}, OB = {grav: 0, drag: 4, sz: 2, emit: true};
  // bolts: a jagged line from the sky, a fork
  const BOLTS = [];
  for (let i = 0; i < 8; i++) BOLTS.push({on: false, t: 0, x: 0, y: 0, z: 0, n: 0, pts: new Float32Array(3 * 14), fn: 0, fork: new Float32Array(3 * 6)});
  // ground marks: a scorch, rime; and shock rings; flashes of light
  const MARKS = [], RINGS = [], FLASH = [];
  for (let i = 0; i < 24; i++) MARKS.push({on: false, t: 0, life: 0, x: 0, y: 0, z: 0, r: 0, pal: null, seed: 0, rime: false});
  for (let i = 0; i < 16; i++) RINGS.push({on: false, t: 0, life: 0, x: 0, y: 0, z: 0, r: 0, c: null, c2: null});
  for (let i = 0; i < 8; i++) FLASH.push({on: false, t: 0, life: 0, x: 0, y: 0, h: 0, col: '', rad: 0, k: 0, id: 0});
  const take = arr => { for (const o of arr) if (!o.on) { o.on = true; o.t = 0; return o; } let old = arr[0]; for (const o of arr) if (o.t > old.t) old = o; old.t = 0; return old; };
  let flashN = 0;
  function flash(x, y, h, col, rad, k, life) { const f = take(FLASH); f.x = x; f.y = y; f.h = h; f.col = col; f.rad = rad; f.k = k; f.life = life; f.id = 7660 + (flashN++ % 8); }
  function mark(x, y, z0, r, pal, life, rime = false) { const m = take(MARKS); m.x = x; m.y = y; m.z = z0; m.r = r; m.pal = pal; m.life = life; m.seed = R() * 1e6 | 0; m.rime = rime; }
  function shock(x, y, z0, r, c, c2, life) { const s = take(RINGS); s.x = x; s.y = y; s.z = z0; s.r = r; s.c = c; s.c2 = c2; s.life = life; }
  function bolt(x, y, z0) {
    const b = take(BOLTS); b.x = x; b.y = y; b.z = z0;
    const n = 11 + (R() * 3 | 0); let bx = x + rr(-1.2, 1.2), by = y + rr(-1.2, 1.2);
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      if (i === n - 1) { bx = x; by = y; } else if (i > 0) { bx += rr(-.42, .42) + (x - bx) * .18; by += rr(-.42, .42) + (y - by) * .18; }
      b.pts[i * 3] = bx; b.pts[i * 3 + 1] = by; b.pts[i * 3 + 2] = z0 + 9 * (1 - f) ** 1.15;
    }
    b.n = n;
    const j = 3 + (R() * (n - 6) | 0), s = R() < .5 ? -1 : 1; b.fn = 5;
    for (let i = 0; i < 5; i++) { b.fork[i * 3] = b.pts[j * 3] + s * i * rr(.18, .4); b.fork[i * 3 + 1] = b.pts[j * 3 + 1] + rr(-.2, .2) * i; b.fork[i * 3 + 2] = b.pts[j * 3 + 2] - i * rr(.55, .9); }
  }

  // a zone went off: its burst
  function burst(e) {
    const x = e.x, y = e.y, z0 = e.z, r = e.r;
    if (e.style === 'strike') {
      const S = PAL.strike;
      bolt(x, y, z0); flash(x, y, z0 + 1.4, LIGHT.strike, 7, 3.2, .35);
      shock(x, y, z0 + .03, r * 1.5, S.hi, S.mid, .28);
      mark(x, y, z0, r * .75, S.scorch, 2.2);
      for (let i = 0; i < 22; i++) { const a = R() * TAU, s = rr(1.5, 5); part(x, y, z0 + .1, Math.sin(a) * s, Math.cos(a) * s * .8, rr(1.5, 5), rr(.25, .55), S.spark, OG); }
    } else if (e.style === 'frost') {
      const S = PAL.frost;
      flash(x, y, z0 + 1, LIGHT.frost, r * 2.2, 2, .45);
      shock(x, y, z0 + .03, r * 1.08, S.hi, S.mid, .32); shock(x, y, z0 + .03, r * .7, S.mid, S.lo, .45);
      mark(x, y, z0, r, S.rime, 2.6, true);
      for (let i = 0; i < 46; i++) { const a = i / 46 * TAU + rr(-.05, .05), s = rr(2.5, 6.5) * r / 2.6; part(x + Math.sin(a) * .3, y + Math.cos(a) * .3, z0 + rr(.1, .7), Math.sin(a) * s, Math.cos(a) * s * .8, rr(.3, 1.6), rr(.35, .7), S.spark, OD); }
      for (let i = 0; i < 14; i++) part(x + rr(-.4, .4), y + rr(-.3, .3), z0 + rr(.2, 1.2), rr(-.5, .5), rr(-.5, .5), rr(.2, .9), rr(.8, 1.4), S.rime, OS);
    } else if (e.style === 'blast') {
      const S = PAL.blast;
      flash(x, y, z0 + .9, LIGHT.blast, r * 2.6, 2.6, .55);
      shock(x, y, z0 + .03, r, S.hi, S.mid, .22); shock(x, y, z0 + .03, r * 1.25, S.mid, S.lo, .38);
      for (let i = 0; i < 12; i++) part(x + rr(-.3, .3), y + rr(-.2, .2), z0 + rr(.2, 1), rr(-.8, .8), rr(-.5, .5), rr(.5, 2), rr(.18, .32), S.spark, OB);
      for (let i = 0; i < 30; i++) { const a = R() * TAU, s = rr(.6, 3.6) * r / 2; part(x, y, z0 + rr(.1, .8), Math.sin(a) * s, Math.cos(a) * s * .8, rr(2, 5), rr(.35, .7), S.spark, OG); }
      for (let i = 0; i < 12; i++) { const a = R() * TAU, s = rr(.3, 1.4); part(x + Math.sin(a) * .3, y, z0 + rr(.4, 1.2), Math.sin(a) * s, Math.cos(a) * s * .6, rr(.6, 1.4), rr(.8, 1.5), S.smoke, OS); }
    } else if (e.style === 'fire') {
      for (let i = 0; i < 8; i++) part(x + rr(-.2, .2), y + rr(-.15, .15), z0 + .1, rr(-.6, .6), rr(-.4, .4), rr(1, 2.4), rr(.25, .5), PAL.fire.spark, OD);
    } else {
      const c = colOf(e.col || '#ffffff');
      shock(x, y, z0 + .03, r * 1.1, c, c, .3); flash(x, y, z0 + 1, e.col || '#ffffff', r * 2, 1.5, .3);
    }
  }

  // ---------------------------------------------------------------- the telegraphs and patches
  function zone(h, t) {
    const x = h.x, y = h.y, g = h.z + .02, warn = h.warn, k = warn > 0 ? clamp(h.t / warn, 0, 1) : 1;
    if (!seen(x, y, g, h.r * 60 + 40)) return;
    if (h.style === 'fire') { patch(h, t); return; }
    if (h.fired) return;   // a burst zone: its burst is an effect now
    const S = h.style === 'strike' ? PAL.strike : h.style === 'frost' ? PAL.frost : h.style === 'blast' ? PAL.blast : null;
    const hi = S ? S.hi : colOf(h.col), mid = S ? S.mid : colOf(h.col), lo = S ? S.lo : colOf(h.col);
    const urgent = k > .75 && Math.floor(t * 16) % 2 === 0;   // the last quarter blinks
    // the danger zone, hatched on the ground: stronger as it nears, blinking at the end
    if (HATCH[h.style]) hatch(x, y, h.z, h.r, HATCH[h.style], (.1 + .32 * k) * (urgent ? 1.5 : 1), Math.floor(t * 6));
    // WHERE: the zone's edge, dashed and crawling, brightening as it nears
    ring(x, y, g, h.r, k > .75 ? (urgent ? hi : mid) : mid, t * 1.4, 4, 3, true, .55 + .45 * k);
    if (k > .4) ring(x, y, g, h.r * .96, lo, -t, 6, 2, false);
    // WHEN: closing in from far out (a strike from the sky, a blast), or filling out (a nova from its centre)
    if (h.style === 'frost') ring(x, y, g, h.r * k, hi, -t * 2, 5, 3, true);
    else { const far = h.style === 'strike' ? 2 : 1.6; ring(x, y, g, h.r * (far - (far - 1) * k), hi, -t * 2.2, 3, 2, true); }
    if (h.style === 'strike') {
      for (let i = -2; i <= 2; i++) if (i) { pt(x + i * .09, y, g, mid, 1, true); pt(x, y + i * .09, g, mid, 1, true); }
      pt(x, y, g + .05 + k * .9, hi, 2, true);
      if (k > .82) {   // the leader: a faint line feeling down from the sky
        const n = 6, top = h.z + 9;
        for (let i = 0; i < n; i++) if (R() < .7) { const a0 = top - (top - g) * i / n, a1 = top - (top - g) * (i + 1) / n; host.line(x + rr(-.15, .15), y + rr(-.15, .15), a0, x + rr(-.15, .15), y + rr(-.15, .15), a1, PAL.strike.lo, true); }
      }
      if (R() < .35) { const a = R() * TAU; pt(x + Math.sin(a) * h.r, y + Math.cos(a) * h.r, g + rr(0, .25), PAL.strike.spark[R() * 3 | 0], 1, true); }
    } else if (h.style === 'frost') {
      if (R() < .5) { const a = R() * TAU; part(x + Math.sin(a) * h.r, y + Math.cos(a) * h.r, g + .05, 0, 0, rr(.3, .8), rr(.3, .6), PAL.frost.spark, OD); }
    } else if (h.style === 'blast') {
      if (R() < .25) { const a = R() * TAU, d = Math.sqrt(R()) * h.r; part(x + Math.sin(a) * d, y + Math.cos(a) * d, g + .05, 0, 0, rr(.4, 1), rr(.2, .35), PAL.fire.spark, OD); }
    }
  }
  // a burning patch: the ember catching (its decal fading in, a few sparks of coal), then the coals (the decal) with flame
  // tongues licking up off them, dying down at the end
  function patch(h, t) {
    const x = h.x, y = h.y, g = h.z + .02, F = PAL.fire;
    const age = h.t - h.warn, k = h.fired ? clamp(Math.min(.35 + age / .25, (h.last - age) / .7), 0, 1) : .35 * clamp(h.t / (h.warn || 1), 0, 1);
    // the coals: the painted decal (ground: its colour, lit; emit: its glow), a flicker frame 8 times a second
    const S = patchSlot(clamp(Math.round(h.r * 10), 2, 12));
    if (S && k > .02) {
      host.G.toScreenInto(x, h.z, y, SV);
      const f = (Math.floor(t * 8) + h.id) % FRAMES, w = S.w * z, hh = S.h * z, dx = Math.round(SV[0] - w / 2), dy = Math.round(SV[1] - hh / 2);
      const q = GQ(); q.globalAlpha = k; q.drawImage(atlas, S.x + f * S.w, S.y, S.w, S.h, dx, dy, w, hh); q.globalAlpha = 1;
      const e = EQ(); e.globalAlpha = k; e.drawImage(atlas, S.x + f * S.w, S.y + S.h, S.w, S.h, dx, dy, w, hh); e.globalAlpha = 1;
    }
    if (!h.fired) { for (let i = 0; i < 4; i++) { const a = hash3(h.id, i, 1) * TAU, d = Math.sqrt(hash3(h.id, i, 2)) * h.r * .6; pt(x + Math.sin(a) * d, y + Math.cos(a) * d, g + .03, F.flame[1 + (i & 1)], 1, true); } return; }
    // the tongues: rise, thin, redden (fewer as it dies down)
    const n = Math.round(h.r * h.r * 14 * k);
    for (let i = 0; i < n; i++) {
      const a = hash3(h.id, i, 3) * TAU, d = Math.sqrt(hash3(h.id, i, 4)) * h.r * .85, cx = x + Math.sin(a) * d, cy = y + Math.cos(a) * d;
      const ph = (t * (1.6 + hash3(h.id, i, 5)) + hash3(h.id, i, 6)) % 1, top = (.22 + .34 * hash3(h.id, i, 7)) * k * (1 - d / h.r * .5);
      const hh = ph * top, ci = Math.min(3, Math.floor(ph * 4));
      pt(cx + Math.sin(t * 7 + i) * .02, cy, g + .04 + hh, F.flame[ci], ph < .3 ? 2 : 1, true);
      if (ph < .5) pt(cx, cy, g + .04 + hh * .5, F.flame[Math.max(0, ci - 1)], 1, true);
    }
  }

  return {
    view(dt, evs) {
      T += dt;
      for (let i = 0; i < evs.length; i++) { const e = evs[i]; if (e.type === 'hazard.burst' && e.src === name) burst(e); }
      // lingering patches throw sparks now and then
      for (let i = 0; i < H.n; i++) { const h = H.list[i]; if (h.style === 'fire' && h.fired && R() < dt * 5 * h.r) { const a = R() * TAU, d = Math.sqrt(R()) * h.r; part(h.x + Math.sin(a) * d, h.y + Math.cos(a) * d, h.z + .15, rr(-.2, .2), rr(-.2, .2), rr(.8, 2), rr(.4, .9), PAL.fire.spark, OS); } }
      const air = AD.begin(dt, AKH.gain); if (air) { AIR2[0] = AD.a(AKH.spark); AIR2[1] = AD.a(AKH.smoke); }
      for (let i = pn - 1; i >= 0; i--) {
        pt0[i] += dt;
        if (pt0[i] > plife[i]) { const j = --pn; if (i !== j) { px[i] = px[j]; py[i] = py[j]; ph[i] = ph[j]; pvx[i] = pvx[j]; pvy[i] = pvy[j]; pvh[i] = pvh[j]; pt0[i] = pt0[j]; plife[i] = plife[j]; pgrav[i] = pgrav[j]; pdrag[i] = pdrag[j]; psz[i] = psz[j]; pem[i] = pem[j]; ppal[i] = ppal[j]; pax[i] = pax[j]; pay[i] = pay[j]; pai[i] = pai[j]; } ppal[j] = null; continue; }
        if (pdrag[i]) { const k = Math.max(0, 1 - pdrag[i] * dt); pvx[i] *= k; pvy[i] *= k; pvh[i] *= k; }
        if (air) { AD.relax(px[i], py[i], ph[i], pax[i], pay[i], AIR2[pai[i]]); pax[i] = AD.x; pay[i] = AD.y; }
        px[i] += (pvx[i] + pax[i]) * dt; py[i] += (pvy[i] + pay[i]) * dt; pvh[i] -= pgrav[i] * dt; ph[i] += pvh[i] * dt;
        if (pgrav[i] > 0) { const gz = host.elev(px[i], py[i]); if (ph[i] < gz) { ph[i] = gz; pvh[i] = -pvh[i] * .3; pvx[i] *= .5; pvy[i] *= .5; } }
      }
      for (const b of BOLTS) if (b.on && (b.t += dt) > .3) b.on = false;
      for (const m of MARKS) if (m.on && (m.t += dt) > m.life) m.on = false;
      for (const s of RINGS) if (s.on && (s.t += dt) > s.life) s.on = false;
      for (const f of FLASH) if (f.on && (f.t += dt) > f.life) f.on = false;
    },
    frame(t) {
      gq = eq = null; z = zoomAt(host.player.x, host.player.y, 0) || 1;
      for (let i = 0; i < H.n; i++) zone(H.list[i], t);
      for (const m of MARKS) if (m.on && seen(m.x, m.y, m.z)) {   // a scorch: scattered pixels that thin out; rime: a pale sheen, glints
        const k = 1 - m.t / m.life;
        if (m.rime) {
          hatch(m.x, m.y, m.z, m.r, '#e4f8ff', .42 * k * k, m.seed);
          for (let i = 0; i < 14; i++) if (hash3(m.seed, i, Math.floor(t * 6)) < .5 * k) { const a = hash3(m.seed, i, 1) * TAU, d = Math.sqrt(hash3(m.seed, i, 2)) * m.r; pt(m.x + Math.sin(a) * d, m.y + Math.cos(a) * d, m.z + .03, m.pal[0], 1, true); }
          continue;
        }
        const n = Math.round(m.r * m.r * 40 * k);
        for (let i = 0; i < n; i++) { const a = hash3(m.seed, i, 1) * TAU, d = Math.sqrt(hash3(m.seed, i, 2)) * m.r; pt(m.x + Math.sin(a) * d, m.y + Math.cos(a) * d, m.z + .015, m.pal[i % m.pal.length], 1, false); }
      }
      for (const s of RINGS) if (s.on) { const k = s.t / s.life, rad = s.r * (1 - (1 - k) * (1 - k)); ring(s.x, s.y, s.z, rad, k < .5 ? s.c : s.c2, 0, 2, k < .5 ? 2 : 1, true); }
      for (const b of BOLTS) if (b.on && (b.t < .07 || (b.t > .11 && b.t < .17) || (b.t > .21 && b.t < .25))) {   // three pulses
        for (let i = 0; i + 1 < b.n; i++) { const a = i * 3, c = a + 3; host.line(b.pts[a], b.pts[a + 1], b.pts[a + 2], b.pts[c], b.pts[c + 1], b.pts[c + 2], PAL.strike.bolt, true);
          host.line(b.pts[a] + .03, b.pts[a + 1], b.pts[a + 2], b.pts[c] + .03, b.pts[c + 1], b.pts[c + 2], PAL.strike.fork, true); }
        for (let i = 0; i + 1 < b.fn; i++) { const a = i * 3, c = a + 3; host.line(b.fork[a], b.fork[a + 1], b.fork[a + 2], b.fork[c], b.fork[c + 1], b.fork[c + 2], PAL.strike.fork, true); }
        pt(b.x, b.y, b.z + .05, PAL.strike.bolt, 3, true);
      }
      for (let i = 0; i < pn; i++) {
        const k = pt0[i] / plife[i], pal = ppal[i], c = pal[Math.min(pal.length - 1, Math.floor(k * pal.length))], s = psz[i] > 1 ? Math.max(1, Math.round(psz[i] * (1 - k * 1.2))) : 1;
        pt(px[i], py[i], ph[i], c, s, pem[i] === 1);
      }
    },
    lights(push) {
      // telegraphs: a light grows under a strike / nova / blast; patches: the nearest few burn; flashes
      const P = host.player; let nf = 0;
      for (let i = 0; i < H.n; i++) {
        const h = H.list[i], L = LIGHT[h.style];
        if (!L) continue;
        if (h.style === 'fire') {
          if (!h.fired || nf >= 5 || Math.abs(h.x - P.x) > 14 || Math.abs(h.y - P.y) > 10) continue;
          const age = h.t - h.warn, k = clamp(Math.min(age / .25, (h.last - age) / .7), 0, 1); nf++;
          push(h.x, h.y, h.z + .35, L, 1.3 + h.r * 1.4, .6 * k, .45, 7610 + h.id % 40);
        } else if (!h.fired) { const k = h.warn > 0 ? h.t / h.warn : 1; push(h.x, h.y, h.z + .5, L, h.r * 1.8 + .6, .25 + .75 * k * k, .1, 7650 + h.id % 8); }
      }
      for (const f of FLASH) if (f.on) { const k = 1 - f.t / f.life; push(f.x, f.y, f.h, f.col, f.rad * (.7 + .3 * k), f.k * k * k, 0, f.id); }
    },
    clear() { pn = 0; ppal.fill(null); for (const a of [BOLTS, MARKS, RINGS, FLASH]) for (const o of a) o.on = false; },
    part, ring, pt, flash, shock, mark, hatch, PAL,   // (the owner's own looks use the same pixels: features/affixes/look.js)
  };
}
