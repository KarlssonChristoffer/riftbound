// ATMOSPHERE: everything that moves on its own in the environment. OWNER: atmosphere agent.
//
// CONTRACT (the host, arena.html, calls exactly these):
//   export function createAtmos(ctx) -> A
//   A.setBiome(biomeId)                        // 'ruins' | 'ember' | 'frost' | 'rift'
//   A.update(dt, cam, player, events)          // player {x, y, vx, vy, state}; events: [{type: 'step'|'land'|'hit'|'roll', x, y}] metres
//   A.drawGround(g, cam)                       // after the ground canvas, before sprites (ground fog, footprints, ripples)
//   A.drawFront(g, cam)                        // after sprites, BEFORE lighting (falling snow/leaves/ash get lit)
//   A.emitters(cam) -> [{img, x, y}]           // glowing bits (embers, motes) to add after lighting, view px top-left
//   A.drawOver(og, cam, scale)                 // optional HD layer at display resolution (after lighting; soft haze, vignette)
//   A.toggle()                                 // W is taken; host maps key 'k' to toggle weather on/off
//   ctx = {PPM, PPMY, PPMH, toS, WM, HM, WPX, HPX, VW, VH, PLAY, layout}; view px = toS(...) - [cam.x, cam.y]
//
// EXTRAS (optional, nothing in the host needs them):
//   A.on      weather on/off (K). Off = no ambient particles, no ground fog, no top haze. Footprints, hit bursts,
//             landing puffs, the rift's shards and the vignette stay (they are feedback / set dressing, not weather).
//   A.hd      HD overlay (vignette + top haze) on/off. URL ?hd=0 starts with it off, ?weather=0 with weather off.
//   A.night   0..1, how strongly fireflies glow (1 = always, until lighting tells us the time of day)
//   A.ms      rolling average of this module's cost per frame (ms), A.count = live particles
//   A.windSrc optional () -> 0..1 | null: the gust from the host's wind module (arena/wind.js); null = own gust walk
//
// TERRAIN (round 2): heights come from ctx.layout.elev(x, y) (plateau 2.4 m), the stream from ctx.layout.stream /
// inStream. Footprints, puffs, hit bursts and landing particles sit at the terrain height; nothing lands on water
// (it sinks); leaves that land on the stream float downstream. Stream life per biome is drawn in drawGround, clipped
// to the channel (each stream particle lives at a lateral offset u across the width, so it follows the meander).
// Events used: step / land (big 3 = a big drop: dust ring) / jump / splash {small} / hit {vx, vy} / break / explode
// {r} / roll; player.state 'climb' trickles dust off the cliff face.
//
// RULES the art follows: every particle is 1-3 px of solid palette colour on the pixel canvas (no alpha, no AA);
// fading = stepping through darker palette entries. Glow only comes from emitters() (added after lighting).
// Everything lives in world metres (x, y ground, h height) and is drawn at toS(x, y, h) - cam, so it stays put
// when the camera moves; ambient particles wrap around the view so their density is constant.

const TAU = Math.PI * 2;
// palettes are ordered bright -> dim; fades step toward the end
const SNOW = ['#f2f6ff', '#c4d0e4', '#8e9cb8'];
const KINDS = {
  ruins: [
    // leaves: tumble (shape flips between 2x1 / 1x1 / 1x2), sway, land and lie a moment, darkening, then go
    {id: 'leaf', mode: 'fall', n: 14, hMax: 5.5, v: [.3, .5], wk: 1.2, sway: [2, 1.4], rest: 2.6, shape: 'leaf', wake: .6,
      pals: [['#a4ae52', '#7a8a3c', '#4e5c2a'], ['#d0a44a', '#a47a34', '#6c5024'], ['#b8643a', '#8a4428', '#5a2c1c']]},
    // pollen: pale specks hanging in the air, brownian, pushed aside by the player
    {id: 'pollen', mode: 'float', n: 22, lo: .3, hi: 2.4, life: [5, 9], wk: .3, jit: .8, pal: ['#eee4a4', '#c4b878', '#8a8458'], wake: 1.2},
    // fireflies: slow wanderers that blink (emissive)
    {id: 'fly', mode: 'firefly', n: 12, lo: .4, hi: 1.6, big: 1, pal: ['#e4ff8e', '#9cc84a', '#56762a'], emit: true, wake: .5},
  ],
  ember: [
    {id: 'ashFar', mode: 'fall', n: 28, hMax: 6, v: [.18, .3], wk: .5, par: .84, sway: [1, .8], pal: ['#6a625e', '#524c48', '#403a38'], pass: 'ground'},
    {id: 'ash', mode: 'fall', n: 44, hMax: 6, v: [.28, .46], wk: .8, sway: [1, 1.1], shape: 'ash', pal: ['#a39a92', '#7c746e', '#57514d'], wake: .5},
    // embers: rise from cracks (and from braziers / torches), cool from yellow to dark red, then gone (emissive)
    {id: 'ember', mode: 'rise', n: 24, hMax: 4, v: [.35, .75], life: [2.2, 4.4], wk: .6, wob: .35, fade: 'cool', src: true,
      pal: ['#ffd27e', '#f28a36', '#b8481c', '#5e200e'], emit: true, big: .15},
  ],
  frost: [
    // three depths: far (behind sprites, dim, slow, parallax < 1), mid (world space), near (2 px, fast, parallax > 1)
    {id: 'snowFar', mode: 'fall', n: 64, hMax: 6, v: [.32, .46], wk: .45, par: .82, sway: [1, .9], pal: ['#a8b6d0', '#8494b2', '#667694'], pass: 'ground'},
    {id: 'snow', mode: 'fall', n: 62, hMax: 6, v: [.65, .95], wk: .8, sway: [1, 1.3], pal: SNOW, wake: .5},
    {id: 'snowNear', mode: 'fall', n: 10, hMax: 6, v: [1.4, 1.9], wk: 1.25, par: 1.22, sway: [2, 1.7], shape: 'near', pal: ['#ffffff', '#dae4f4', '#a4b2cc']},
  ],
  rift: [
    // motes: violet sparks rising very slowly, drawn into a slow swirl around the ring; a few are bigger (a pixel cross)
    {id: 'mote', mode: 'rise', n: 34, hMax: 3.4, v: [.1, .26], life: [4.5, 8.5], wk: 0, wob: .16, fade: 'inout', swirl: true, big: .14,
      pal: ['#e4c8ff', '#ac80f2', '#7448c4', '#40247a'], emit: true, wake: 1},
  ],
};
const WIND = {ruins: [.3, .7], ember: [.12, .35], frost: [.45, 2.1], rift: [0, 0]};    // base m/s, + gust m/s
const BURST = {   // arrow hits: small, biome-flavoured, short
  ruins: {n: 8, pal: ['#e2cc84', '#b89a58', '#7a6238'], sp: [1.2, 2.6], up: [.8, 2.2], life: [.7, 1.2], gr: 9, bounce: true},
  ember: {n: 9, pal: ['#ffe6a4', '#ffa446', '#cc5626', '#661f10'], sp: [1.6, 3.4], up: [.8, 2.6], life: [.3, .55], gr: 9, emit: true, bounce: true},
  frost: {n: 8, pal: ['#ffffff', '#cfe0f4', '#8eaad0'], sp: [1.2, 2.8], up: [.8, 2.4], life: [.6, 1], gr: 9, bounce: true},
  rift: {n: 9, pal: ['#e8ccff', '#a472f0', '#5c3298'], dark: ['#1e1030', '#160c24', '#100818'], sp: [.7, 1.8], up: [-.3, .6], life: [.5, .9], gr: 0, drag: 3, emit: true},
};
const FOG = {      // additive ground mist, quantized to 2 levels (hard pixel edges), in world space, drifting with the wind
  frost: {c: [[8, 10, 14], [15, 19, 26]], cover: [.17, .05], drift: .35},
  rift: {c: [[6, 3, 10], [12, 6, 20]], cover: [.16, .045], drift: .06},
};
const OVER = {     // HD overlay: vignette colour/strength, top haze colour/strength
  ruins: {v: [10, 12, 6], va: .26, h: [236, 226, 176], ha: .05},
  ember: {v: [20, 5, 6], va: .3, h: [255, 120, 60], ha: .06},
  frost: {v: [5, 9, 20], va: .28, h: [220, 234, 255], ha: .09},
  rift: {v: [8, 3, 14], va: .32, h: [138, 74, 208], ha: .07},
};
// dust / smoke per biome (bright -> dim): landings, cliff trickle, breakables, explosions
const DUST = {ruins: ['#c8b894', '#a8987a', '#7e7260', '#5a5246'], ember: ['#948a84', '#766e68', '#56504c', '#3a3533'],
  frost: ['#d8e2ee', '#a8b6ca', '#8492aa', '#66748c'], rift: ['#7a6a98', '#5c4e78', '#44385a', '#2e263e']};
const SMOKE = ['#8a8480', '#6a6460', '#4c4744', '#302c2a'];
// splashes: droplets / chunks, a ring on the surface (clipped to the water), rift pulls inward instead
const SPLASH = {
  ruins: {n: 14, drops: {pal: ['#eef8fa', '#a8ccd8', '#6e98aa'], sp: [.3, 1.3], up: [1.6, 3.2], life: [.5, .8], gr: 9, drag: 1},
    ring: {pal: ['#d8ecf2', '#9cc0cc', '#6a8e9c'], r0: .1, r1: 1.1, life: .7}},
  ember: {n: 12, drops: {pal: ['#ffe08a', '#ffa040', '#e0541e', '#6e1c12'], sp: [.4, 1.5], up: [1.6, 3.4], life: [.6, 1], gr: 9, drag: 1, emit: true},
    bits: {n: 5, pal: ['#4a2418', '#321410', '#200c08'], sp: [.3, 1], up: [1.2, 2.4], life: [.6, .9], gr: 9, drag: 1},
    ring: {pal: ['#ffc860', '#e07028', '#8a2c12'], r0: .1, r1: .9, life: .6, emit: true}},
  frost: {n: 10, drops: {pal: ['#ffffff', '#d4e2f2', '#98acc8'], sp: [.3, 1.2], up: [1.8, 3.2], life: [.4, .7], gr: 9, drag: 1.5},
    bits: {n: 5, pal: ['#f4faff', '#cfe0f4', '#8eaad0'], sp: [.7, 1.7], up: [1.1, 2.1], life: [.8, 1.2], gr: 9, drag: 1, bounce: true, px: 2, py: 2, hold: .7},
    ring: {pal: ['#e8f0fa', '#b4c4dc', '#8494b2'], r0: .1, r1: 1, life: .7}},
  rift: {n: 14, implode: true, ring: {pal: ['#e4c8ff', '#ac80f2', '#7448c4'], r0: 1.3, r1: 0, life: .45, emit: true, noclip: true}},
};
// stream life. kinds: flow (drifts downstream), glint (a brief sparkle), bubble (lava: grows, pops, throws embers),
// mist (rises off the water), shimmer (a slow wave of light along the crack), suck (motes pulled down into the crack)
const STREAM_LIFE = {
  ruins: {v: .9, kinds: [
    {k: 'flow', n: 26, shape: 'streak', life: [.6, 1.4], pal: ['#eaf7fa', '#bcdde6', '#8cb8c8']},
    {k: 'glint', n: 7, pal: ['#ffffff', '#cfe6ee']}]},
  ember: {v: .22, kinds: [
    {k: 'flow', n: 14, shape: 'crust', life: [3, 6], pal: ['#4a2418', '#361a12', '#26100c']},
    {k: 'flow', n: 14, shape: 'streak', life: [.8, 1.8], pal: ['#ffd070', '#f08a30', '#a8401a'], emit: true},
    {k: 'bubble', n: 5, life: [1.2, 2.2], pal: ['#ffe8a0', '#ff9c3c', '#5a2014'], emit: true}]},
  frost: {v: .3, kinds: [
    {k: 'flow', n: 7, shape: 'floe', life: [6, 10], pal: ['#e6f0fa', '#b0c4dc', '#8a9cb8']},
    {k: 'glint', n: 8, pal: ['#ffffff', '#dae8f6']},
    {k: 'mist', n: 16, life: [1.6, 2.8], pal: ['#d0dcec', '#a6b6cc', '#8090aa']}]},
  rift: {v: 0, kinds: [
    {k: 'shimmer', n: 30, pal: ['#a878f0', '#6a44b8', '#3e2472'], emit: true},
    {k: 'suck', n: 12, life: [1.4, 2.4], pal: ['#e4c8ff', '#ac80f2', '#7448c4', '#40247a'], emit: true}]},
};
const PRINT = [[3, '#a4b4d0'], [6, '#bcc8dc'], [9, '#d6deea']];   // footprint age (s) -> multiply colour (deep -> faint)
// rift shards: 5x7 pixel crystals seen from 3 angles (spin = A B C B); m mid, d dark, L lit edge (= also emissive)
const SHARD = [
  ['  L  ', ' mLd ', ' mLd ', 'mmLdd', ' mLd ', '  Ld ', '  d  '],
  ['  L  ', '  L  ', '  m  ', '  m  ', '  m  ', '  d  ', '  d  '],
  ['  L  ', ' dLm ', ' dLm ', 'ddLmm', ' dLm ', ' dL  ', '  d  ']];
const SH_COL = {m: '#6c4cb4', d: '#3a2868', L: '#9a7ae0'}, SH_EMIT = ['#b88cff', '#8a5ce0', '#5c3aa8'], SH_EMIT_M = '#3a2270';

export function createAtmos(ctx) {
  const Q = new URLSearchParams(location.search);
  const A = {on: Q.get('weather') !== '0', hd: Q.get('hd') !== '0', night: 1, ms: 0, count: 0};
  let biome = 'ruins', kinds = [], need = true, lastVW = 0, lastVH = 0;
  let T = 0, wind = 0, gust = 0, fogX = 0, acc = 0;
  let cam = {x: 0, y: 0}, P = {x: 0, y: 0, vx: 0, vy: 0}, dirX = 0, dirY = 1;
  const fx = [], prints = [];
  let s = 1;   // seeded PRNG (mulberry32): the same biome always starts the same way
  const R = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rr = a => a[0] + R() * (a[1] - a[0]);
  const M = 10;   // wrap margin, view px
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const E = canvas(1, 1), eq = E.getContext('2d');   // emissive layer, view sized, reused
  let O = null, oKey = '';                           // prebuilt HD overlay
  const fogTiles = {};
  const props = () => ctx.layout?.props || [];
  const elevAt = (x, y) => ctx.layout?.elev ? ctx.layout.elev(x, y) : 0;
  const wet = (x, y) => ctx.layout?.inStream ? ctx.layout.inStream(x, y) : false;
  const rings = [], plumes = [], strm = [];   // splash rings, smoke plumes, stream particles
  let strmFor = '';

  // ---------- colour buckets: batch fillRects by colour ----------
  const bk = new Map();
  const put = (c, x, y, w = 1, h = 1) => { let a = bk.get(c); if (!a) bk.set(c, a = []); a.push(x, y, w, h); };
  function flush(q) {
    for (const [c, a] of bk) { if (!a.length) continue; q.fillStyle = c; for (let i = 0; i < a.length; i += 4) q.fillRect(a[i], a[i + 1], a[i + 2], a[i + 3]); a.length = 0; }
  }

  // ---------- ambient particles ----------
  function place(K, p) {   // a random spot in the wrap region around the view
    const par = K.par || 1, B = ctx.VH + 2 * M + K.span * ctx.PPMH;
    p.x = (-M + R() * (ctx.VW + 2 * M) + cam.x * par) / ctx.PPM;
    p.y = (-M + R() * B + cam.y * par) / ctx.PPMY;
  }
  function wrap(K, p) {    // keep the particle in the region around the view (world space: it only moves when it leaves)
    const par = K.par || 1, W = ctx.VW + 2 * M, B = ctx.VH + 2 * M + K.span * ctx.PPMH;
    let r = p.x * ctx.PPM - cam.x * par + M; if (r < 0 || r >= W) p.x += (((r % W) + W) % W - r) / ctx.PPM;
    r = p.y * ctx.PPMY - cam.y * par + M; if (r < 0 || r >= B) p.y += (((r % B) + B) % B - r) / ctx.PPMY;
  }
  function source() {      // a brazier / torch on screen (embers rise from it)
    const vis = [];
    for (const b of props()) if (b.kind === 'brazier' || b.kind === 'torch') {
      const [x, y] = ctx.toS(b.x, b.y); if (x > cam.x - 8 && x < cam.x + ctx.VW + 8 && y > cam.y && y < cam.y + ctx.VH + 40) vis.push(b);
    }
    return vis.length ? vis[R() * vis.length | 0] : null;
  }
  function spawn(K, p, init) {
    place(K, p); p.t = 0; p.ph = R(); p.ex = 0; p.ey = 0; p.rest = 0; p.v = K.v ? rr(K.v) : 0;
    if (K.pals) p.pal = K.pals[R() * K.pals.length | 0];
    p.big = !!K.big && R() < K.big;
    if (K.mode === 'fall') { p.h = init ? R() * K.hMax : K.hMax * (.8 + R() * .2); if (init) p.t = 1; }
    else if (K.mode === 'rise') {
      p.life = rr(K.life); p.h = R() * .15 + (K.par ? 0 : elevAt(p.x, p.y));
      if (K.src && !init && R() < .3) { const b = source(); if (b) { p.x = b.x + (R() - .5) * .25; p.y = b.y + (R() - .5) * .1; p.h = b.kind === 'torch' ? 1.6 : 1; p.v *= 1.5; p.life *= .6; } }
      if (init) { p.t = R() * p.life; p.h += p.v * p.t; }
    } else if (K.mode === 'float') { p.life = rr(K.life); p.h = rr([K.lo, K.hi]) + elevAt(p.x, p.y); p.vx = p.vy = p.vh = 0; if (init) p.t = R() * p.life; }
    else if (K.mode === 'firefly') { p.h = rr([K.lo, K.hi]) + elevAt(p.x, p.y); p.a = R() * TAU; p.f = .6 + R() * .7; }
  }
  function populate() {
    need = false; lastVW = ctx.VW; lastVH = ctx.VH;
    s = {ruins: 11, ember: 23, frost: 37, rift: 51}[biome] || 1;
    const area = ctx.VW * ctx.VH / (480 * 270);
    kinds = (KINDS[biome] || []).map(D => {
      const K = {...D, span: D.hMax ?? D.hi ?? 2, ps: []};
      for (let i = Math.round(D.n * area); i > 0; i--) { const p = {}; spawn(K, p, true); K.ps.push(p); }
      return K;
    });
  }
  function stepP(K, p, dt) {
    p.t += dt;
    const damp = Math.exp(-dt * 2.2); p.ex *= damp; p.ey *= damp;
    if (K.wake && !K.par) {   // the player running through pushes light particles aside
      const dx = p.x - P.x, dy = p.y - P.y, d2 = dx * dx + dy * dy, sp = Math.hypot(P.vx, P.vy);
      if (d2 < .7 && Math.abs(p.h - (P.z || 0) - 1) < 1.2 && sp > .6) {
        const d = Math.sqrt(d2) || .01, k = (1 - d / .84) * sp * K.wake * 2.4 * dt;
        p.ex += dx / d * k + P.vx * k * .25; p.ey += dy / d * k + P.vy * k * .25; if (K.mode === 'float') p.vh += k * .4;
      }
    }
    const sw = wind * (K.wk || 0);
    if (K.mode === 'fall') {
      if (p.rest > 0) {
        p.rest -= dt; if (p.rest <= 0) { spawn(K, p, false); return; }
        const S = ctx.layout?.stream;   // a leaf that landed on the stream floats downstream
        if (p.float && S) { p.y += flowAt(p.y) * .8 * dt; p.x = S.cx(p.y) + p.float * S.w(p.y); }
        return;
      }
      p.h -= p.v * dt; p.x += (sw + p.ex) * dt; p.y += p.ey * dt;
      const gnd = K.par || p.h > 2.6 ? 0 : elevAt(p.x, p.y);   // lands on the plateau top at its height
      if (p.h <= gnd) {
        if (K.rest) {
          p.h = gnd; p.rest = p.restMax = K.rest * (.6 + R() * .8); p.float = 0;
          const S = ctx.layout?.stream; if (!gnd && S && wet(p.x, p.y)) { p.float = (p.x - S.cx(p.y)) / S.w(p.y) || .01; p.rest = p.restMax = K.rest * 2.5; }
        } else { spawn(K, p, false); return; }
      }
    } else if (K.mode === 'rise') {
      p.h += p.v * dt; p.x += (sw + p.ex + Math.sin(T * 1.3 + p.ph * TAU) * (K.wob || 0)) * dt; p.y += p.ey * dt;
      if (K.swirl && ctx.layout?.ring) {   // a slow current around the rift ring
        const rg = ctx.layout.ring, dx = p.x - rg.x, dy = p.y - rg.y, d = Math.hypot(dx, dy) || 1, k = Math.max(0, 1 - Math.abs(d - rg.r) / 3) * .3 * dt;
        p.x += -dy / d * k; p.y += dx / d * k;
      }
      if (p.t >= p.life) { spawn(K, p, false); return; }
    } else if (K.mode === 'float') {
      const d = Math.exp(-dt * .8), j = K.jit * dt * 3;
      p.vx = p.vx * d + (R() - .5) * j; p.vy = p.vy * d + (R() - .5) * j; p.vh = p.vh * d + (R() - .5) * j * .5;
      const b = elevAt(p.x, p.y); if (p.h < b + K.lo) p.vh = Math.abs(p.vh) + .05 * dt; if (p.h > b + K.hi) p.vh = -Math.abs(p.vh);
      p.x += (p.vx + sw + p.ex) * dt; p.y += (p.vy + p.ey) * dt; p.h += p.vh * dt;
      if (p.t >= p.life) { spawn(K, p, false); return; }
    } else if (K.mode === 'firefly') {
      p.a += (R() - .5) * 3 * dt;
      p.x += (Math.cos(p.a) * .3 + sw + p.ex) * dt; p.y += (Math.sin(p.a) * .2 + p.ey) * dt;
      const want = elevAt(p.x, p.y) + (K.lo + K.hi) / 2 + Math.sin(T * .9 + p.ph * TAU) * (K.hi - K.lo) / 2;
      p.h += (want - p.h) * Math.min(1, dt * .8);   // eases up / down over the cliff edge
    }
    wrap(K, p);
  }
  // palette index for a particle (0 = brightest)
  function shade(K, p, n) {
    if (K.mode === 'fall') return p.rest > 0 ? (p.rest / p.restMax > .5 ? 1 : 2) : p.t < .15 ? 2 : p.t < .35 ? 1 : 0;
    if (K.fade === 'cool') { const a = p.t / p.life; return a < .22 ? 0 : a < .5 ? 1 : a < .8 ? 2 : 3; }
    if (K.mode === 'firefly') { const b = Math.sin(T * 1.6 * p.f + p.ph * TAU) * A.night; return b > .55 ? 0 : b > .1 ? 1 : b > -.4 ? 2 : -1; }
    const k = Math.min(p.t / .7, (p.life - p.t) / .9);
    return k >= 1 ? 0 : Math.min(n - 1, Math.floor((1 - k) * n));
  }
  function drawKinds(pass) {   // pass: 'ground' | 'front' | 'emit'
    const {PPM, PPMY, PPMH, VW, VH} = ctx;
    for (const K of kinds) {
      const kp = K.emit ? 'emit' : K.pass || 'front';
      if (kp !== pass && !(pass === 'ground' && K.rest)) continue;
      const par = K.par || 1, ox = cam.x * par, oy = cam.y * par;
      for (const p of K.ps) {
        if (K.rest && (pass === 'ground') !== (p.rest > 0)) continue;   // resting leaves lie on the ground (behind sprites)
        let x = Math.round(p.x * PPM - ox), y = Math.round(p.y * PPMY - p.h * PPMH - oy);
        if (K.sway && !(p.rest > 0)) x += Math.round(Math.sin(T * K.sway[1] + p.ph * TAU) * K.sway[0]);
        if (x < -3 || y < -3 || x > VW + 2 || y > VH + 2) continue;
        const pal = p.pal || K.pal, n = pal.length, i = shade(K, p, n);
        if (i < 0) continue;
        const c = pal[i], c2 = pal[Math.min(n - 1, i + 1)];
        if (K.shape === 'leaf') {
          if (p.rest > 0) { put(c, x, y, 2, 1); continue; }
          const f = (T * 3 + p.ph * 4) & 3;
          if (f === 0) put(c, x, y, 2, 1); else if (f === 2) put(c, x, y, 1, 2); else put(c2, x, y);
        } else if (K.shape === 'ash') ((T * 2.2 + p.ph * 4) & 1) ? put(c, x, y, 2, 1) : put(c2, x, y);
        else if (K.shape === 'near') { put(c, x, y, 2, 1); put(c, x, y + 1); put(c2, x + 1, y + 1); }
        else if (p.big && i === 0) { put(c, x, y); const a = pal[Math.min(n - 1, 2)]; put(a, x - 1, y); put(a, x + 1, y); put(a, x, y - 1); put(a, x, y + 1); }
        else put(c, x, y);
      }
    }
  }

  // ---------- short-lived fx: hit bursts, snow puffs, grass bits ----------
  // o: {pal, sp, up, life, gr, drag, bounce, emit, dark, px, py, hold, even}; bx, by: extra ground velocity (m/s)
  function emitFx(x, y, h, n, o, bx = 0, by = 0, spread = 0) {
    for (let i = 0; i < n && fx.length < 500; i++) {
      const a = o.even ? (i + R() * .3) / n * TAU : R() * TAU, sp = rr(o.sp), dark = o.dark && R() < .45;
      const ox = spread ? (R() - .5) * spread : 0, oy = spread ? (R() - .5) * spread * .7 : 0;
      fx.push({x: x + ox, y: y + oy, h, vx: Math.cos(a) * sp + bx, vy: Math.sin(a) * sp * .7 + by, vh: rr(o.up), t: 0, life: rr(o.life), gr: o.gr ?? 9, drag: o.drag || 1.5,
        bounce: o.bounce, pal: dark ? o.dark : o.pal, emit: o.emit && !dark, px: o.px || (R() < .25 && !dark ? 2 : 1), py: o.py || 1, hold: o.hold || .4, rest: false});
    }
  }
  const dustOf = () => DUST[biome] || DUST.ruins;
  const flowAt = y => { const S = ctx.layout?.stream, L = STREAM_LIFE[biome]; return S && L ? L.v * 2.6 / S.w(y) : 0; };
  const SNOWPUFF = {pal: SNOW, sp: [.5, 1.5], up: [.6, 1.5], life: [.35, .6], gr: 7, drag: 3};
  const GRASS = {pal: ['#8ea452', '#6a803c', '#4a5a2a'], sp: [.3, .8], up: [1, 1.7], life: [.35, .55], gr: 7, drag: 2};
  function foot(e) {
    const sp = Math.hypot(P.vx, P.vy); if (sp > .3) { dirX = P.vx / sp; dirY = P.vy / sp; }
    const z = e.z ?? elevAt(e.x, e.y);
    if (e.big >= 3) emitFx(e.x, e.y, z + .05, 26, {pal: dustOf(), sp: [3.4, 4.6], up: [.2, .7], life: [.6, .9], gr: 3, drag: 4, px: 2, hold: .5, even: true});   // big drop: dust ring
    if (biome === 'frost') {
      const side = e.foot === 'R' ? -1 : 1, x = e.x + dirY * side * .09, y = e.y - dirX * side * .09;   // left of travel = (dy, -dx)
      let dup = false; for (let i = Math.max(0, prints.length - 4); i < prints.length; i++) if (Math.hypot(prints[i].x - x, prints[i].y - y) < .07) dup = true;
      if (!dup && !(z === 0 && wet(x, y)) && elevAt(x, y) === z) {   // no prints on water or hanging over the cliff lip
        const ax = Math.abs(dirX), ay = Math.abs(dirY);
        prints.push({x, y, z, t: 0, s: ax > .92 ? 0 : ay > .92 ? 1 : dirX * dirY > 0 ? 2 : 3});
        if (prints.length > 240) prints.shift();
      }
      if (e.type === 'land' || e.big > 1) emitFx(e.x, e.y, z + .03, 7, SNOWPUFF);
      else if (sp > 4) emitFx(x, y, z + .03, 2, SNOWPUFF);
    } else if (biome === 'ruins') {   // grass rustle: kicking through a tuft throws a few blades
      for (const p of props()) if (p.kind === 'tuft' && Math.abs(p.x - e.x) < .6 && Math.abs(p.y - e.y) < .45 && Math.abs((p.z || 0) - z) < .3) { emitFx(p.x, p.y, z + .05, 3, GRASS); break; }
    }
  }
  function splash(e) {
    const B = SPLASH[biome]; if (!B) return;
    const k = e.small ? .4 : 1, n = Math.max(3, Math.round(B.n * k)), R1 = B.ring;
    if (B.implode) {   // rift: a flash, then motes pulled in from a ring and down into the crack
      rings.push({x: e.x, y: e.y, t: 0, life: R1.life, r0: R1.r0 * (e.small ? .5 : 1), r1: 0, pal: R1.pal, emit: true, noclip: true});
      rings.push({x: e.x, y: e.y, t: 0, life: .16, flash: true, pal: R1.pal, emit: true});
      for (let i = 0; i < n && fx.length < 500; i++) {
        const a = i / n * TAU + R() * .3, r = (1 + R() * .4) * (e.small ? .5 : 1), life = .35 + R() * .25, h = .15 + R() * .9 * k;
        fx.push({x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r * .8, h, vx: -Math.cos(a) * r / life, vy: -Math.sin(a) * r * .8 / life, vh: -h / life,
          t: 0, life, gr: 0, drag: 0, pal: R1.pal, emit: true, px: 1, py: 1, hold: 0, rest: false});
      }
      return;
    }
    rings.push({x: e.x, y: e.y, t: 0, life: R1.life, r0: R1.r0, r1: R1.r1 * (e.small ? .5 : 1), pal: R1.pal, emit: !!R1.emit});
    const d = B.drops; emitFx(e.x, e.y, .02, n, {...d, up: [d.up[0] * (e.small ? .6 : 1), d.up[1] * (e.small ? .6 : 1)]});
    if (B.bits) emitFx(e.x, e.y, .05, Math.max(1, Math.round(B.bits.n * k)), B.bits);
  }
  function smoke(e) {   // break: a light dust puff; explode: a dust ring + a smoke plume rising ~1.5 s
    const z = elevAt(e.x, e.y);
    if (e.type === 'break') { emitFx(e.x, e.y, z + .25, 10, {pal: dustOf(), sp: [.4, 1.2], up: [.3, .9], life: [.5, .9], gr: 1, drag: 3, px: 2, hold: .5}, 0, 0, .4); return; }
    const r = e.r ?? 2.4;
    emitFx(e.x, e.y, z + .1, 16, {pal: dustOf(), sp: [r * 1.1, r * 1.5], up: [.2, .7], life: [.45, .7], gr: 2, drag: 4, px: 2, hold: .5, even: true});
    plumes.push({x: e.x, y: e.y, z, t: 0, dur: .7, n: Math.round(20 + r * 8)});
  }
  function stepFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const q = fx[i]; q.t += dt;
      if (q.t >= q.life) { fx[i] = fx[fx.length - 1]; fx.pop(); continue; }
      if (!q.rest) {
        q.vh -= q.gr * dt; const d = Math.exp(-dt * q.drag); q.vx *= d; q.vy *= d; if (q.gr <= 0) q.vh *= d;
        q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt;
        if (q.vh <= 0) {
          const gnd = elevAt(q.x, q.y);
          if (q.h <= gnd) {
            if (!gnd && wet(q.x, q.y)) { fx[i] = fx[fx.length - 1]; fx.pop(); continue; }   // sinks
            q.h = gnd; if (q.bounce && q.vh < -1.2) { q.vh *= -.3; q.vx *= .4; q.vy *= .4; } else { q.vh = 0; q.rest = true; }
          }
        }
      }
    }
    for (let i = prints.length - 1; i >= 0; i--) if ((prints[i].t += dt) > PRINT[PRINT.length - 1][0]) prints.splice(i, 1);
    for (let i = rings.length - 1; i >= 0; i--) if ((rings[i].t += dt) >= rings[i].life) rings.splice(i, 1);
    for (let i = plumes.length - 1; i >= 0; i--) {
      const m = plumes[i], k0 = m.t / m.dur; m.t += dt; const k1 = Math.min(1, m.t / m.dur);
      for (let j = Math.round(k0 * m.n); j < Math.round(k1 * m.n) && fx.length < 500; j++)
        fx.push({x: m.x + (R() - .5) * .8, y: m.y + (R() - .5) * .5, h: m.z + .3 + R() * .4, vx: (R() - .5) * .5 + wind * .3, vy: (R() - .5) * .3, vh: 1.2 + R() * .9,
          t: 0, life: 1.1 + R() * .7, gr: 0, drag: 1.1, pal: SMOKE, px: 2 + (R() < .5 ? 1 : 0), py: 2 + (R() < .4 ? 1 : 0), hold: .6, rest: false});
      if (m.t >= m.dur) plumes.splice(i, 1);
    }
  }
  function drawRings(emit) {
    const {PPM, PPMY, PPMH} = ctx;
    for (const r of rings) {
      if (!!r.emit !== emit) continue;
      const k = r.t / r.life, n0 = r.pal.length, c = r.pal[Math.min(n0 - 1, Math.floor(k * n0))];
      const X = Math.round(r.x * PPM - cam.x), Y = Math.round(r.y * PPMY - cam.y);
      if (r.flash) { const Y2 = Y - Math.round(.3 * PPMH); put(r.pal[0], X - 1, Y2, 3, 1); put(r.pal[0], X, Y2 - 1, 1, 3); put(r.pal[2], X - 2, Y2); put(r.pal[2], X + 2, Y2); continue; }
      const e = 1 - (1 - k) * (1 - k), rad = r.r0 + (r.r1 - r.r0) * e, n = Math.max(8, Math.round(TAU * rad * PPM / 1.4));
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU, wx = r.x + Math.cos(a) * rad, wy = r.y + Math.sin(a) * rad * .8;
        if (!r.noclip && !wet(wx, wy)) continue;
        put(c, Math.round(wx * PPM - cam.x), Math.round(wy * PPMY - cam.y));
      }
    }
  }

  // ---------- stream life ----------
  function streamView() {   // the stream's visible stretch (world y at water level), or null when it is off screen
    const S = ctx.layout?.stream; if (!S || !STREAM_LIFE[biome]) return null;
    const y0 = Math.max(-1, (cam.y - 12) / ctx.PPMY), y1 = Math.min(31, (cam.y + ctx.VH + 12) / ctx.PPMY);
    if (y1 <= y0) return null;
    const xl = (cam.x - 50) / ctx.PPM, xr = (cam.x + ctx.VW + 50) / ctx.PPM;
    for (const y of [y0, (y0 + y1) / 2, y1]) { const c = S.cx(y); if (c > xl && c < xr) return {S, y0, y1}; }
    return null;
  }
  function sSpawn(K, p, V, init) {
    p.t = 0; p.ph = R(); p.y = V.y0 + R() * (V.y1 - V.y0); p.u = (R() - .5) * .76; p.life = K.life ? rr(K.life) : 0; p.h = 0; p.wait = 0;
    if (K.k === 'glint') { p.life = .1 + R() * .2; p.wait = R() * 1.5; }
    if (K.k === 'bubble') { p.wait = R() * 1.5; p.u *= .8; }
    if (K.k === 'suck') { p.o = (R() < .5 ? -1 : 1) * (.9 + R() * 1.2); p.h = .3 + R() * 1.1; }
    if (K.shape === 'floe') { p.w = 3 + (R() * 2 | 0); p.u *= .7; }
    if (K.shape === 'crust') p.w = 1 + (R() * 3 | 0);
    if (init && p.life) p.t = R() * p.life;
  }
  function stepStream(dt) {
    const V = streamView(); if (!V) return 0;
    const L = STREAM_LIFE[biome];
    if (strmFor !== biome) { strm.length = 0; strmFor = biome; for (const K of L.kinds) for (let i = 0; i < K.n; i++) { const p = {K}; sSpawn(K, p, V, true); strm.push(p); } }
    const span = V.y1 - V.y0;
    for (const p of strm) {
      const K = p.K;
      if (p.wait > 0) { p.wait -= dt; continue; }
      p.t += dt;
      p.y += flowAt(p.y) * dt * (K.k === 'mist' ? .5 : K.k === 'bubble' ? .6 : 1);
      if (p.y > V.y1 || p.y < V.y0) p.y = V.y0 + (((p.y - V.y0) % span) + span) % span;   // wrap over the visible stretch
      if (K.k === 'mist') { p.h = .5 * p.t / p.life; p.u += wind * .03 * dt; }
      if (K.k === 'suck') { const k = Math.exp(-dt * (1.2 + p.t * 1.6)); p.o *= k; p.h *= k; if (Math.abs(p.o) < .12 && p.h < .08) p.t = p.life; }
      if (p.t >= p.life) {
        if (K.k === 'bubble') {   // pop: a few embers
          const x = V.S.cx(p.y) + p.u * V.S.w(p.y);
          emitFx(x, p.y, .03, 2 + (R() * 3 | 0), {pal: ['#ffe08a', '#ffa040', '#e0541e', '#6e1c12'], sp: [.2, .7], up: [1.4, 2.6], life: [.6, 1.1], gr: 6, drag: 1, emit: true, px: 1});
        }
        sSpawn(K, p, V, false);
      }
    }
    return strm.length;
  }
  function drawStream(pass) {   // 'ground' | 'emit'
    const V = streamView(); if (!V || strmFor !== biome) return;
    const {PPM, PPMY, PPMH, VW, VH} = ctx, S = V.S;
    for (const p of strm) {
      const K = p.K;
      if (p.wait > 0 || (K.emit ? 'emit' : 'ground') !== pass) continue;
      const w = S.w(p.y), wx = S.cx(p.y) + (K.k === 'suck' ? p.o : p.u * w);
      if (K.k !== 'suck' && K.k !== 'mist' && !wet(wx, p.y)) continue;   // clipped to the channel (and off the stones)
      const x = Math.round(wx * PPM - cam.x), y = Math.round(p.y * PPMY - p.h * PPMH - cam.y);
      if (x < -4 || y < -4 || x > VW + 3 || y > VH + 3) continue;
      const pal = K.pal, n = pal.length, a = p.life ? p.t / p.life : 0, io = Math.min(p.t / .35, (p.life - p.t) / .35), fi = io >= 1 ? 0 : io > .5 ? 1 : 2;
      switch (K.k) {
        case 'flow':
          if (K.shape === 'streak') put(pal[Math.min(n - 1, fi)], x, y, 1, 3 - fi);
          else if (K.shape === 'crust') { put(pal[0], x, y, p.w, 1); if (p.w > 2) put(pal[2], x + 1, y + 1, p.w - 2, 1); }
          else { put(pal[0], x, y, p.w, 1); put(pal[1], x, y + 1, p.w, 1); if (fi === 0 && Math.sin(T * 2 + p.ph * TAU) > .8) put('#ffffff', x + 1, y); }   // ice floe + glint
          break;
        case 'glint': put(pal[a < .5 ? 0 : 1], x, y); break;
        case 'bubble':
          if (a < .4) put(pal[2], x, y);
          else if (a < .85) { put(pal[1], x, y); put(pal[2], x - 1, y); put(pal[2], x + 1, y); put(pal[2], x, y - 1); }
          else { put(pal[0], x, y, 2, 1); put(pal[1], x - 1, y - 1); put(pal[1], x + 2, y - 1); }
          break;
        case 'mist': put(pal[Math.min(n - 1, fi + (a > .6 ? 1 : 0))], x, y, a < .5 ? 2 : 1, 1); break;
        case 'shimmer': { const b = Math.sin(p.y * 1.9 - T * 1.1 + p.ph * 2); if (b > .2) put(pal[b > .8 ? 0 : b > .5 ? 1 : 2], x, y); break; }
        case 'suck': put(pal[Math.min(n - 1, fi + (a > .7 ? 1 : 0))], x, y); break;
      }
    }
    if (pass === 'ground' && (biome === 'ruins' || biome === 'frost')) for (const st of S.stones || []) {   // foam on the upstream side
      const X = Math.round(st.x * PPM - cam.x), Y = Math.round((st.y - st.r / 1.3) * PPMY - cam.y) - 1;
      if (X < -12 || X > VW + 12 || Y < -6 || Y > VH + 6) continue;
      const f = (T * 5 | 0) & 1, c = biome === 'ruins' ? '#e4f2f6' : '#f0f6ff';
      put(c, X - 3 + f, Y); put(c, X + 2 - f, Y); put('#b4d0da', X - 1, Y - 1 + f, 2, 1);
    }
  }
  function drawFx(emit) {
    const {PPM, PPMY, PPMH, VW, VH} = ctx;
    for (const q of fx) {
      if (!!q.emit !== emit) continue;
      const x = Math.round(q.x * PPM - cam.x), y = Math.round(q.y * PPMY - q.h * PPMH - cam.y);
      if (x < -2 || y < -2 || x > VW + 1 || y > VH + 1) continue;
      const n = q.pal.length, big = q.t < q.life * q.hold, w = big ? q.px : Math.max(1, q.px - 1), h = big ? q.py : Math.max(1, q.py - 1);
      put(q.pal[Math.min(n - 1, Math.floor(q.t / q.life * n))], x - (w >> 1), y - (h >> 1), w, h);
    }
  }

  // ---------- rift shards orbiting the ring ----------
  function shards(fn) {
    const rg = ctx.layout?.ring; if (biome !== 'rift' || !rg) return;
    for (let i = 0; i < 7; i++) {
      const a = T * .11 + i * TAU / 7 + Math.sin(i * 2.3) * .2, r = rg.r + .5 + Math.sin(T * .4 + i) * .15;
      fn(rg.x + Math.cos(a) * r, rg.y + Math.sin(a) * r, 1.7 + Math.sin(T * .8 + i * 1.9) * .22, i);
    }
  }
  const shardFrame = i => SHARD[[0, 1, 2, 1][(T * .9 + i * .7 | 0) & 3]];
  const MOTEFX = {pal: KINDS.rift[0].pal, sp: [.05, .2], up: [.15, .35], life: [1, 1.6], gr: -.05, drag: .6, emit: true};

  // ---------- ground fog: a tileable noise tile, quantized to 2 additive levels ----------
  function fogTile(id) {
    if (fogTiles[id]) return fogTiles[id];
    const F = FOG[id], TW = 384, TH = 192, c = canvas(TW, TH), q = c.getContext('2d'), im = q.createImageData(TW, TH), d = im.data;
    let fs = 99; const fr = () => { fs = (fs * 16807) % 2147483647; return fs / 2147483647; };
    const oct = [[96, 24, .6], [48, 12, .28], [24, 8, .12]].map(([cw, ch, w]) => { const gw = TW / cw, gh = TH / ch; return {cw, ch, w, gw, gh, v: Array.from({length: gw * gh}, fr)}; });
    const sm = t => t * t * (3 - 2 * t), val = new Float32Array(TW * TH);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      let v = 0;
      for (const o of oct) {
        const fx = x / o.cw, fy = y / o.ch, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
        const g = (a, b) => o.v[((b % o.gh) * o.gw) + (a % o.gw)];
        v += o.w * ((g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx) * (1 - ty) + (g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx) * ty);
      }
      val[y * TW + x] = v;
    }
    const sorted = Float32Array.from(val).sort(), t1 = sorted[Math.floor(sorted.length * (1 - F.cover[0]))], t2 = sorted[Math.floor(sorted.length * (1 - F.cover[1]))];
    for (let i = 0; i < val.length; i++) {
      const L = val[i] > t2 ? 1 : val[i] > t1 ? 0 : -1; if (L < 0) continue;
      d[i * 4] = F.c[L][0]; d[i * 4 + 1] = F.c[L][1]; d[i * 4 + 2] = F.c[L][2]; d[i * 4 + 3] = 255;
    }
    q.putImageData(im, 0, 0);
    return (fogTiles[id] = c);
  }
  function drawFog(g) {
    if (!FOG[biome]) return;
    const tile = fogTile(biome), TW = tile.width, TH = tile.height;
    const ox = cam.x - Math.round(fogX * ctx.PPM), x0 = -(((ox % TW) + TW) % TW), y0 = -(((cam.y % TH) + TH) % TH);
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let y = y0; y < ctx.VH; y += TH) for (let x = x0; x < ctx.VW; x += TW) g.drawImage(tile, x, y);
    g.restore();
  }

  // ---------- HD overlay ----------
  function buildOver(w, h) {
    if (!O) O = canvas(w, h); O.width = w; O.height = h;
    const q = O.getContext('2d'), V = OVER[biome] || OVER.ruins, rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    if (A.on && V.ha) {   // a thin haze at the top of the screen (air between us and the far ground)
      const gr = q.createLinearGradient(0, 0, 0, h * .3);
      gr.addColorStop(0, rgba(V.h, V.ha)); gr.addColorStop(.45, rgba(V.h, V.ha * .35)); gr.addColorStop(1, rgba(V.h, 0));
      q.fillStyle = gr; q.fillRect(0, 0, w, h * .3);
    }
    q.save(); q.translate(w / 2, h / 2); q.scale(w / 2, h / 2);   // elliptical vignette, only the corners/edges darken
    const r0 = .62, r1 = 1.42, gr = q.createRadialGradient(0, 0, r0, 0, 0, r1);
    for (let i = 0; i <= 6; i++) gr.addColorStop(i / 6, rgba(V.v, +(V.va * (i / 6) ** 1.8).toFixed(4)));
    q.fillStyle = gr; q.fillRect(-1, -1, 2, 2); q.restore();
  }

  const tick = t0 => { acc += performance.now() - t0; };
  Object.assign(A, {
    setBiome(id) { biome = id; need = true; fx.length = 0; prints.length = 0; rings.length = 0; plumes.length = 0; strmFor = ''; oKey = ''; },
    toggle() { A.on = !A.on; oKey = ''; },
    counts: () => ({fx: fx.length, prints: prints.length, rings: rings.length, stream: strm.length, ambient: kinds.reduce((n, K) => n + K.ps.length, 0)}),
    update(dt, c, player, events) {
      const t0 = performance.now();
      A.ms = A.ms * .95 + acc * .05; acc = 0;
      dt = Math.min(.05, Math.max(0, dt || 0)); T += dt;
      if (c) cam = c; if (player) P = player;
      if (need || ctx.VW !== lastVW || ctx.VH !== lastVH) populate();
      const W = WIND[biome] || [0, 0], sn = Math.sin(T * .31) + .6 * Math.sin(T * .73 + 1.3) + .4 * Math.sin(T * 1.37 + 2.1);
      const ext = A.windSrc ? A.windSrc() : null;   // the host's wind module (arena/wind.js): its gust fronts, 0..1
      gust = ext ?? Math.max(0, (sn - .7) / 1.3); wind = W[0] + gust * W[1];
      fogX += wind * (FOG[biome]?.drift || 0) * dt + (biome === 'rift' ? .04 * dt : 0);
      let n = fx.length;
      if (A.on) for (const K of kinds) { for (const p of K.ps) stepP(K, p, dt); n += K.ps.length; }
      if (A.on && biome === 'frost' && gust > .25 && R() < gust * 7 * dt) {   // spindrift: a gust lifts a little snow off the ground
        const x = (cam.x + R() * ctx.VW) / ctx.PPM, y = (cam.y + R() * ctx.VH) / ctx.PPMY;
        fx.push({x, y, h: elevAt(x, y) + .02, vx: wind * 1.3, vy: (R() - .5) * .3, vh: .5 + R() * .5, t: 0, life: .5 + R() * .5, gr: 1.6, drag: .3, pal: SNOW, px: 1, py: 1, hold: .4});
      }
      if (biome === 'rift') shards((x, y, h) => { if (R() < .5 * dt) emitFx(x, y, h - .1, 1, MOTEFX); });   // shards shed a mote now and then
      if (P.state === 'climb') for (let k = 16 * dt + R(); k >= 1; k--)   // grit trickling off the cliff face under the hands and feet
        emitFx(P.x + (R() - .5) * .6, P.y + .06, Math.max(.1, (P.z || 0) - .2 + R() * .8), 1, {pal: dustOf(), sp: [.1, .35], up: [-.2, .3], life: [.6, 1], gr: 4, drag: 1.5, px: 1});
      for (const e of events || []) {
        if (e.type === 'hit') {
          const B = BURST[biome], v = Math.hypot(e.vx || 0, e.vy || 0) || 1;   // sprayed on along the arrow's flight
          if (B) emitFx(e.x, e.y + .02, elevAt(e.x, e.y) + 1.15 + R() * .25, B.n, B, (e.vx || 0) / v * 1.1, (e.vy || 0) / v * .8);
        }
        else if (e.type === 'step' || e.type === 'land') foot(e);
        else if (e.type === 'jump') { const z = elevAt(e.x, e.y); emitFx(e.x, e.y, z + .03, 3, biome === 'frost' ? SNOWPUFF : {pal: dustOf(), sp: [.3, .9], up: [.3, .8], life: [.3, .5], gr: 6, drag: 3}); }
        else if (e.type === 'splash') splash(e);
        else if (e.type === 'break' || e.type === 'explode') smoke(e);
        else if (e.type === 'roll' && biome === 'frost') emitFx(e.x, e.y, elevAt(e.x, e.y) + .03, 4, SNOWPUFF);
      }
      n += stepStream(dt);
      stepFx(dt);
      A.count = n;
      tick(t0);
    },
    drawGround(g, c) {
      const t0 = performance.now(); if (c) cam = c;
      drawStream('ground'); drawRings(false); flush(g);
      if (prints.length) {   // footprints: multiplied into the snow, lightening in steps as they fill back in
        for (const f of prints) {
          const x = Math.round(f.x * ctx.PPM - cam.x), y = Math.round(f.y * ctx.PPMY - (f.z || 0) * ctx.PPMH - cam.y);
          if (x < -2 || y < -2 || x > ctx.VW + 1 || y > ctx.VH + 1) continue;
          const col = PRINT.find(p => f.t < p[0])[1];
          if (f.s === 0) put(col, x - 1, y, 3, 1); else if (f.s === 1) put(col, x, y - 1, 1, 2);
          else if (f.s === 2) { put(col, x - 1, y - 1); put(col, x, y); } else { put(col, x, y - 1); put(col, x - 1, y); }
        }
        g.save(); g.globalCompositeOperation = 'multiply'; flush(g); g.restore();
      }
      shards((x, y) => { const [a, b] = ctx.toS(x, y, elevAt(x, y)); put('#948cac', Math.round(a - cam.x) - 1, Math.round(b - cam.y), 3, 1); });
      g.save(); g.globalCompositeOperation = 'multiply'; flush(g); g.restore();
      if (A.on) { drawFog(g); drawKinds('ground'); flush(g); }
      tick(t0);
    },
    drawFront(g, c) {
      const t0 = performance.now(); if (c) cam = c;
      shards((x, y, h, i) => {
        const [a, b] = ctx.toS(x, y, h), X = Math.round(a - cam.x) - 2, Y = Math.round(b - cam.y) - 3, F = shardFrame(i);
        for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) { const ch = F[r][k]; if (ch !== ' ') put(SH_COL[ch], X + k, Y + r); }
      });
      if (A.on) drawKinds('front');
      drawFx(false); flush(g);
      tick(t0);
    },
    emitters(c) {
      const t0 = performance.now(); if (c) cam = c;
      if (E.width !== ctx.VW || E.height !== ctx.VH) { E.width = ctx.VW; E.height = ctx.VH; } else eq.clearRect(0, 0, E.width, E.height);
      shards((x, y, h, i) => {
        const [a, b] = ctx.toS(x, y, h), X = Math.round(a - cam.x) - 2, Y = Math.round(b - cam.y) - 3, F = shardFrame(i);
        const pv = Math.sin(T * 1.5 + i * 2.1), col = SH_EMIT[pv > .3 ? 0 : pv > -.4 ? 1 : 2];
        for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) { const ch = F[r][k]; if (ch === 'L') put(r === 0 ? SH_EMIT[0] : col, X + k, Y + r); else if (ch === 'm') put(SH_EMIT_M, X + k, Y + r); }
      });
      if (A.on) drawKinds('emit');
      drawFx(true); drawStream('emit'); drawRings(true);
      let any = false; for (const a of bk.values()) if (a.length) { any = true; break; }
      if (!any) { tick(t0); return []; }
      flush(eq); tick(t0);
      return [{img: E, x: 0, y: 0}];
    },
    drawOver(og, c, scale) {
      if (!A.hd) return;
      const t0 = performance.now(), w = og.canvas.width, h = og.canvas.height, key = `${w}x${h}|${biome}|${A.on}`;
      if (key !== oKey) { oKey = key; buildOver(w, h); }
      og.drawImage(O, 0, 0);
      tick(t0);
    },
  });
  return A;
}
