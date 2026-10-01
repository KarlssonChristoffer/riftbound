// ATMOS (feature): weather and environment fx in the 3D world. The arena's arena/atmos.js, ported: same tables, same
// simulation, same feel; only the drawing changed (the arena painted view px on one canvas, here every particle lives in
// world metres and is drawn through the host's primitives, so it turns with the camera). OWNER: atmos port.
//
// CONTRACT (features/<name>.js, see main.js):
//   export async function create(host) -> F
//   F.on            always true: the host keeps running it (hit bursts, footprints, splashes, the rift's shards and the
//                   vignette are feedback / set dressing, not weather; they stay when the weather is off, as in the arena)
//   F.weather       weather on / off: K (F.onKey), ?weather=0 starts off. Off = no ambient particles, no ground fog, no top
//                   haze. The pause menu toggles it through F.settings()
//   F.hdOn          vignette + top haze on the HD overlay (?hd=0 starts off)
//   F.update(dt, evs)   the arena's A.update: ambient particles, events (step / land / jump / splash / hit / break /
//                   explode / roll), climb grit, spindrift, stream life, fx
//   F.frame(f)      the arena's drawGround + drawFront + emitters, mapped onto the host (below)
//   F.hd(q, scale)  the arena's drawOver (vignette, top haze), display resolution
//   F.biomeChanged(), F.settings(), F.hud(), F.ms (rolling cost per rendered frame), F.count, F.counts()
//   F.TUNE          the arena's tables (KINDS, WIND, BURST, FOG, OVER, DUST, SPLASH, STREAM_LIFE, ...), live
//   F.windSrc       optional () -> 0..1 | null: the gust source; default = the wind feature's atmosGust() when it is on
//
// WHERE THINGS GO (the arena's pass -> the 3D host)
//   'front' particles (falling snow / ash / leaves, pollen) and non-glowing fx  -> host.point: world space, depth-tested,
//                   lit (the arena drew them after the sprites, before the light: lit, but always in front)
//   'ground' particles (far snow / ash, parallax < 1), resting leaves, stream life, splash rings, foam  -> host.layer
//                   ('ground'): before the light, on ground pixels only, so every sprite / prop covers them (the arena's
//                   ground canvas). The far layers keep their parallax: each step they are carried along by (1 - par) of
//                   the camera's move, so they scroll slower than the world
//   glow (fireflies, embers, motes, lava drops, glowing rings / stream bits)  -> depth-tested EMISSIVE points at each
//                   particle's own depth (walls and props in front hide them), dithered to the arena's glow alpha
//                   (1.25 - lum(ambient) x .95, clamped .3..1: faint by day, full at night)
//   shard edges     the shard cards' emit image (glow x (1 - light), depth-correct)
//   footprints, shard shadows (the arena multiplied them into the ground)  -> host.layer('ground') with the multiply
//                   baked in: the ground texel under the pixel (world.groundCanvas) x the tone
//   ground fog (additive, pre-light in the arena)  -> host.layer('add'), laid on the ground plane with the ground's
//                   affine map (it turns with the world) and scaled by the mood's ambient (what the pre-light add became)
//   rift shards     -> host.sprite cards (5 x 7 px, 3 spin frames, glowing edges as their emit image)
//   vignette, top haze  -> F.hd
// The stream bed in world.js sits WATER_H below the bank: stream life, rings and splashes sit on that surface.
//
// RULES the art follows (the arena's): every particle is 1-3 px of solid palette colour, no alpha, no AA; fading =
// stepping through darker palette entries. Sizes scale with the host's zoom (zoom 2 = 2 x 2 px per art pixel).

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
const SH_SHADOW = '#948cac';
const WATER_H = -.18;   // world.js lowers the stream bed by this much: the surface the stream fx, rings and splashes sit on

const hex3 = h => { let s = String(h).replace('#', ''); if (s.length === 3) s = s.replace(/./g, m => m + m); const n = parseInt(s, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const RGBF = new Map();   // '#rrggbb' -> [r, g, b] 0..1 (host.point takes arrays as they are: no parsing per particle)
const rgbf = h => { let v = RGBF.get(h); if (!v) { const c = hex3(h); RGBF.set(h, v = [c[0] / 255, c[1] / 255, c[2] / 255]); } return v; };
const lum = c => c[0] * .3 + c[1] * .55 + c[2] * .15;

export async function create(host) {
  const Q = new URLSearchParams(location.search);
  const {PPM, PPMY, PPMH, VW, VH} = host;
  const F = {name: 'atmos', label: 'Weather', on: true, weather: Q.get('weather') !== '0', hdOn: Q.get('hd') !== '0', night: 1, ms: 0, count: 0,
    TUNE: {KINDS, WIND, BURST, FOG, OVER, DUST, SMOKE, SPLASH, STREAM_LIFE, PRINT, WATER_H}, windSrc: null};
  let biome = '', kinds = [], need = true;
  let T = 0, wind = 0, gust = 0, fogX = 0, acc = 0;
  let P = {x: 0, y: 0, z: 0, vx: 0, vy: 0, state: 'idle'}, dirX = 0, dirY = 1;
  const fx = [], prints = [], rings = [], plumes = [], strm = [];
  let strmFor = '';
  let s = 1;   // seeded PRNG (mulberry32): the same biome always starts the same way
  const R = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rr = a => a[0] + R() * (a[1] - a[0]);
  const M = 10;   // wrap margin, view px
  const props = () => host.props || [];
  const elevAt = (x, y) => host.elev(x, y);
  const wet = (x, y) => host.inStream(x, y);
  const tick = t0 => { acc += performance.now() - t0; };

  // ---------- the view: the host's projection as an affine map (world metres -> view px), refreshed per pass ----------
  // V.camx / camy: the arena's cam (top-left of the view at zoom 1) in VIEW-FRAME px (x = vx PPM, y = vy PPMY - h PPMH,
  // vx / vy the camera-turned ground axes): ambient particles wrap in that frame, exactly like the arena's
  const V = {ox: 0, oy: 0, xx: 1, xy: 0, yx: 0, yy: 1, hx: 0, hy: -1, c: 1, s: 0, z: 1, camx: 0, camy: 0};
  function view() {
    const o = host.toView(0, 0, 0), a = host.toView(1, 0, 0), b = host.toView(0, 1, 0), h = host.toView(0, 0, 1);
    V.ox = o[0]; V.oy = o[1]; V.xx = a[0] - o[0]; V.xy = a[1] - o[1]; V.yx = b[0] - o[0]; V.yy = b[1] - o[1]; V.hx = h[0] - o[0]; V.hy = h[1] - o[1];
    V.c = Math.cos(host.yaw); V.s = Math.sin(host.yaw); V.z = host.zoom || 1;
    V.camx = -(o[0] - VW / 2) / V.z - VW / 2; V.camy = -(o[1] - VH / 2) / V.z - VH / 2;
  }
  const SX = (x, y, h) => V.ox + x * V.xx + y * V.yx + h * V.hx, SY = (x, y, h) => V.oy + x * V.xy + y * V.yy + h * V.hy;
  const vfx = (x, y) => (x * V.c - y * V.s) * PPM, vfy = (x, y) => (x * V.s + y * V.c) * PPMY;
  const fromVF = (X, Y) => { const a = X / PPM, b = Y / PPMY; return [a * V.c + b * V.s, -a * V.s + b * V.c]; };

  // ---------- drawing: colour buckets per layer (batched fillRects), points ----------
  const BG = new Map(), BE = new Map();   // 'ground', 'emit'
  // glow pixels remember the world point they were projected from (GA, set by the caller via glowAt): they're drawn as
  // depth-tested emissive points, so walls and props in front hide them (a screen overlay glowed through walls)
  let GA = [0, 0, 0, 0, 0];
  const glowAt = (x, y, h) => { GA = [x, y, h, SX(x, y, h), SY(x, y, h)]; };
  const GL = [];
  const put = (bk, c, x, y, w = 1, h = 1) => { if (bk === BE) { GL.push(c, x, y, w, h, GA); return; } let a = bk.get(c); if (!a) bk.set(c, a = []); a.push(x, y, w, h); };
  function flush(bk, q) { for (const [c, a] of bk) { if (!a.length) continue; q.fillStyle = c; for (let i = 0; i < a.length; i += 4) q.fillRect(a[i], a[i + 1], a[i + 2], a[i + 3]); a.length = 0; } }
  const any = bk => { for (const a of bk.values()) if (a.length) return true; return false; };
  const GO = {size: 1, alpha: 1, emit: true}, RGBC = new Map(), rgbc = c => { let v = RGBC.get(c); if (!v) RGBC.set(c, v = host.rgb(c)); return v; };
  function flushGlow() {   // the glow buffer -> emissive points at their particle's depth (alpha: the arena's glow strength, dithered)
    const z = V.z, ca = Math.cos(host.yaw), sa = Math.sin(host.yaw);
    GO.size = z; GO.alpha = glowA();
    for (let k = 0; k < GL.length; k += 6) {
      const c = rgbc(GL[k]), X = GL[k + 1], Y = GL[k + 2], w = GL[k + 3], h = GL[k + 4], [ax, ay, ah, aX, aY] = GL[k + 5];
      for (let j = 0; j < h; j += z) for (let i = 0; i < w; i += z) {
        const dX = (X + i + z / 2 - aX) / z / PPM, dY = (Y + j + z / 2 - aY) / z / PPMY;   // screen right / down (along the ground) -> world
        host.point(ax + dX * ca + dY * sa, ay - dX * sa + dY * ca, ah, c, GO);
      }
    }
    GL.length = 0;
  }
  // a layer pixel at art offset (dx, dy) from a projected point, w x h art px (zoom scales art px)
  const lp = (bk, c, X, Y, dx = 0, dy = 0, w = 1, h = 1) => put(bk, c, X + dx * V.z, Y + dy * V.z, w * V.z, h * V.z);
  const PO = {size: 1};
  // a lit point at art offset (dx, dy) px from the world point (x, y, h): 1 px right = 1/PPM m along the screen's right,
  // 1 px down = 1/PPMH m lower (same ground point): exactly the next pixel after the host's snap
  const pp = (x, y, h, c, dx = 0, dy = 0, size = 1) => {
    PO.size = size * V.z;
    host.point(x + dx * V.c / PPM, y - dx * V.s / PPM, h - dy / PPMH, rgbf(c), PO);
  };
  const inView = (X, Y, m) => X > -m && Y > -m && X < VW + m && Y < VH + m;
  const glowA = () => Math.max(.3, Math.min(1, 1.25 - lum(host.mood?.amb || [1, 1, 1]) * .95));

  // ---------- the ground under a point: multiply baked in (the 3D ground layer mixes, it doesn't multiply) ----------
  // world.js paints the ground texture top-down at PPM px / m: read back lazily in 64 px tiles
  let gC = null, gQ = null, gW = 0, gH = 0;
  const gTiles = new Map(), MUL = new Map(), WHITE = [255, 255, 255], TX = [0, 0, 0];
  function texel(x, y) {   // world metres -> [r, g, b] 0..255 of the ground texel there (white when unknown)
    const c = host.world?.groundCanvas;
    if (c !== gC) { gC = c; gTiles.clear(); MUL.clear(); gQ = c ? c.getContext('2d', {willReadFrequently: true}) : null; gW = c?.width || 0; gH = c?.height || 0; }
    if (!gQ) return WHITE;
    const gx = Math.min(gW - 1, Math.max(0, Math.floor(x * PPM))), gy = Math.min(gH - 1, Math.max(0, Math.floor(y * PPM))), k = (gx >> 6) + (gy >> 6) * 4096;
    let t = gTiles.get(k);
    if (!t) { try { t = gQ.getImageData(gx & ~63, gy & ~63, 64, 64).data; } catch { return WHITE; } gTiles.set(k, t); }
    const i = ((gy & 63) * 64 + (gx & 63)) * 4; TX[0] = t[i]; TX[1] = t[i + 1]; TX[2] = t[i + 2]; return TX;
  }
  function mulCss(x, y, tone) {   // css colour: the ground texel at world (x, y) multiplied by the tone ('#rrggbb')
    const [r, g, b] = texel(x, y), t = hex3(tone);
    const k = ((r * t[0] / 255 | 0) << 16) | ((g * t[1] / 255 | 0) << 8) | (b * t[2] / 255 | 0);
    let css = MUL.get(k); if (!css) { css = '#' + k.toString(16).padStart(6, '0'); MUL.set(k, css); }
    return css;
  }

  // ---------- ambient particles ----------
  function place(K, p) {   // a random spot in the wrap region around the view
    const B = VH + 2 * M + K.span * PPMH;
    [p.x, p.y] = fromVF(-M + R() * (VW + 2 * M) + V.camx, -M + R() * B + V.camy);
  }
  function wrap(K, p) {    // keep the particle in the region around the view (world space: it only moves when it leaves)
    const W = VW + 2 * M, B = VH + 2 * M + K.span * PPMH;
    let r = vfx(p.x, p.y) - V.camx + M; if (r < 0 || r >= W) { const d = ((((r % W) + W) % W) - r) / PPM; p.x += d * V.c; p.y -= d * V.s; }
    r = vfy(p.x, p.y) - V.camy + M; if (r < 0 || r >= B) { const d = ((((r % B) + B) % B) - r) / PPMY; p.x += d * V.s; p.y += d * V.c; }
  }
  function source() {      // a brazier / torch on screen (embers rise from it)
    const vis = [];
    for (const b of props()) if ((b.kind === 'brazier' || b.kind === 'torch') && !b.gone && !b.broken && !b.unlit) {
      const x = SX(b.x, b.y, b.z || 0), y = SY(b.x, b.y, b.z || 0); if (x > -8 && x < VW + 8 && y > 0 && y < VH + 40) vis.push(b);
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
      if (K.src && !init && R() < .3) { const b = source(); if (b) { p.x = b.x + (R() - .5) * .25; p.y = b.y + (R() - .5) * .1; p.h = (b.z || 0) + (b.kind === 'torch' ? 1.6 : 1); p.v *= 1.5; p.life *= .6; } }
      if (init) { p.t = R() * p.life; p.h += p.v * p.t; }
    } else if (K.mode === 'float') { p.life = rr(K.life); p.h = rr([K.lo, K.hi]) + elevAt(p.x, p.y); p.vx = p.vy = p.vh = 0; if (init) p.t = R() * p.life; }
    else if (K.mode === 'firefly') { p.h = rr([K.lo, K.hi]) + elevAt(p.x, p.y); p.a = R() * TAU; p.f = .6 + R() * .7; }
  }
  // THE WORLD CLOCK (sim/env.js host.env; render3d): how many of a kind's particles are out. The frost lands' snow follows
  // the weather (a few flakes always), the ruins' leaves the season, pollen spring / summer and not in rain, fireflies
  // summer nights (fewer in rain). Without a clock: all of them, as in the arena
  const SEASON_KIND = {leaf: {spring: .35, summer: .45, autumn: 1, winter: .1}, pollen: {spring: 1, summer: .8, autumn: .25, winter: 0},
    fly: {spring: .45, summer: 1, autumn: .3, winter: 0}};
  function actOf(K) {
    const E = host.env, n = K.ps.length; if (!E) return n;
    let k = 1;
    if (biome === 'frost' && K.id.startsWith('snow')) k = .12 + .88 * Math.min(1, E.sky.snow + E.sky.storm * .3);
    else if (E.tinted && SEASON_KIND[K.id]) k = SEASON_KIND[K.id][E.season] ?? 1;
    if (K.id === 'pollen' || K.id === 'fly') k *= 1 - .8 * E.sky.rain;
    return Math.round(n * k);
  }
  function populate() {
    need = false;
    s = {ruins: 11, ember: 23, frost: 37, rift: 51}[biome] || 1;
    view();
    kinds = (KINDS[biome] || []).map(D => {
      const K = {...D, span: D.hMax ?? D.hi ?? 2, ps: []};
      for (let i = D.n; i > 0; i--) { const p = {}; spawn(K, p, true); K.ps.push(p); }
      return K;
    });
    camW = null;
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
        const S = host.layout?.stream;   // a leaf that landed on the stream floats downstream
        if (p.float && S) { p.y += flowAt(p.y) * .8 * dt; p.x = S.cx(p.y) + p.float * S.w(p.y); }
        return;
      }
      p.h -= p.v * dt; p.x += (sw + p.ex) * dt; p.y += p.ey * dt;
      const gnd = K.par || p.h > 2.6 ? 0 : elevAt(p.x, p.y);   // lands on the plateau top at its height
      if (p.h <= gnd) {
        if (K.rest) {
          p.h = gnd; p.rest = p.restMax = K.rest * (.6 + R() * .8); p.float = 0;
          const S = host.layout?.stream;
          if (!gnd && S && wet(p.x, p.y)) { p.float = (p.x - S.cx(p.y)) / S.w(p.y) || .01; p.rest = p.restMax = K.rest * 2.5; p.h = WATER_H; }
        } else { spawn(K, p, false); return; }
      }
    } else if (K.mode === 'rise') {
      p.h += p.v * dt; p.x += (sw + p.ex + Math.sin(T * 1.3 + p.ph * TAU) * (K.wob || 0)) * dt; p.y += p.ey * dt;
      const rg = host.layout?.ring;
      if (K.swirl && rg) {   // a slow current around the rift ring
        const dx = p.x - rg.x, dy = p.y - rg.y, d = Math.hypot(dx, dy) || 1, k = Math.max(0, 1 - Math.abs(d - rg.r) / 3) * .3 * dt;
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
  // parallax: the far (par < 1) and near (par > 1) layers are carried along by (1 - par) of the camera's move each step,
  // so on screen they scroll at par x the world's speed (the arena drew them at cam x par). Measured as the ground point
  // under the view centre (rotation-invariant: turning the camera is not a move) + the camera height.
  let camW = null;
  function parallax() {
    const z = P.z || 0, [wx, wy] = fromVF(V.camx + VW / 2, V.camy + VH / 2 + z * PPMH);
    if (camW && Math.hypot(wx - camW[0], wy - camW[1]) < 8) {
      const dx = wx - camW[0], dy = wy - camW[1], dh = -(z - camW[2]) * PPMH / PPMY;   // height change, as a ground shift
      for (const K of kinds) if (K.par && K.par !== 1) {
        const k = 1 - K.par, mx = (dx + dh * V.s) * k, my = (dy + dh * V.c) * k;
        for (const p of K.ps) if (!(p.rest > 0)) { p.x += mx; p.y += my; }
      }
    }
    camW = [wx, wy, z];
  }
  // palette index for a particle (0 = brightest)
  function shade(K, p, n) {
    if (K.mode === 'fall') return p.rest > 0 ? (p.rest / p.restMax > .5 ? 1 : 2) : p.t < .15 ? 2 : p.t < .35 ? 1 : 0;
    if (K.fade === 'cool') { const a = p.t / p.life; return a < .22 ? 0 : a < .5 ? 1 : a < .8 ? 2 : 3; }
    if (K.mode === 'firefly') { const b = Math.sin(T * 1.6 * p.f + p.ph * TAU) * F.night; return b > .55 ? 0 : b > .1 ? 1 : b > -.4 ? 2 : -1; }
    const k = Math.min(p.t / .7, (p.life - p.t) / .9);
    return k >= 1 ? 0 : Math.min(n - 1, Math.floor((1 - k) * n));
  }
  function drawKinds(pass) {   // pass: 'ground' (layer) | 'front' (lit points) | 'emit' (glow layer)
    for (const K of kinds) {
      const kp = K.emit ? 'emit' : K.pass || 'front', act = K.act ?? K.ps.length;
      if (kp !== pass && !(pass === 'ground' && K.rest)) continue;
      const bk = pass === 'emit' ? BE : BG;
      for (let pi = 0; pi < act; pi++) {
        const p = K.ps[pi];
        if (K.rest && (pass === 'ground') !== (p.rest > 0)) continue;   // resting leaves lie on the ground (behind sprites)
        const sw = K.sway && !(p.rest > 0) ? Math.round(Math.sin(T * K.sway[1] + p.ph * TAU) * K.sway[0]) : 0;
        const X0 = SX(p.x, p.y, p.h), Y0 = SY(p.x, p.y, p.h), X = Math.floor(X0) + sw * V.z, Y = Math.floor(Y0);
        if (!inView(X, Y, 3 * V.z)) continue;
        if (pass === 'emit') glowAt(p.x, p.y, p.h);
        const pal = p.pal || K.pal, n = pal.length, i = shade(K, p, n);
        if (i < 0) continue;
        const c = pal[i], c2 = pal[Math.min(n - 1, i + 1)];
        if (pass === 'front') {
          if (K.shape === 'leaf') {
            const f = (T * 3 + p.ph * 4) & 3;
            if (f === 0) { pp(p.x, p.y, p.h, c, sw); pp(p.x, p.y, p.h, c, sw + 1); } else if (f === 2) { pp(p.x, p.y, p.h, c, sw); pp(p.x, p.y, p.h, c, sw, 1); } else pp(p.x, p.y, p.h, c2, sw);
          } else if (K.shape === 'ash') { if ((T * 2.2 + p.ph * 4) & 1) { pp(p.x, p.y, p.h, c, sw); pp(p.x, p.y, p.h, c, sw + 1); } else pp(p.x, p.y, p.h, c2, sw); }
          else if (K.shape === 'near') { pp(p.x, p.y, p.h, c, sw); pp(p.x, p.y, p.h, c, sw + 1); pp(p.x, p.y, p.h, c, sw, 1); pp(p.x, p.y, p.h, c2, sw + 1, 1); }
          else pp(p.x, p.y, p.h, c, sw);
          continue;
        }
        if (K.shape === 'leaf') {
          if (p.rest > 0) { lp(bk, c, X, Y, 0, 0, 2, 1); continue; }
          const f = (T * 3 + p.ph * 4) & 3;
          if (f === 0) lp(bk, c, X, Y, 0, 0, 2, 1); else if (f === 2) lp(bk, c, X, Y, 0, 0, 1, 2); else lp(bk, c2, X, Y);
        } else if (K.shape === 'ash') ((T * 2.2 + p.ph * 4) & 1) ? lp(bk, c, X, Y, 0, 0, 2, 1) : lp(bk, c2, X, Y);
        else if (K.shape === 'near') { lp(bk, c, X, Y, 0, 0, 2, 1); lp(bk, c, X, Y, 0, 1); lp(bk, c2, X, Y, 1, 1); }
        else if (p.big && i === 0) { lp(bk, c, X, Y); const a = pal[Math.min(n - 1, 2)]; lp(bk, a, X, Y, -1, 0); lp(bk, a, X, Y, 1, 0); lp(bk, a, X, Y, 0, -1); lp(bk, a, X, Y, 0, 1); }
        else lp(bk, c, X, Y);
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
  const flowAt = y => { const S = host.layout?.stream, L = STREAM_LIFE[biome]; return S && L ? L.v * 2.6 / S.w(y) : 0; };
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
        prints.push({x, y, z, t: 0, dx: dirX, dy: dirY});   // (the shape follows the stride ON SCREEN: picked when drawn)
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
        fx.push({x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r * .8, h: WATER_H + h, vx: -Math.cos(a) * r / life, vy: -Math.sin(a) * r * .8 / life, vh: -h / life,
          t: 0, life, gr: 0, drag: 0, pal: R1.pal, emit: true, px: 1, py: 1, hold: 0, rest: false});
      }
      return;
    }
    rings.push({x: e.x, y: e.y, t: 0, life: R1.life, r0: R1.r0, r1: R1.r1 * (e.small ? .5 : 1), pal: R1.pal, emit: !!R1.emit});
    const d = B.drops; emitFx(e.x, e.y, WATER_H + .02, n, {...d, up: [d.up[0] * (e.small ? .6 : 1), d.up[1] * (e.small ? .6 : 1)]});
    if (B.bits) emitFx(e.x, e.y, WATER_H + .05, Math.max(1, Math.round(B.bits.n * k)), B.bits);
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
          const g0 = elevAt(q.x, q.y), w = !g0 && wet(q.x, q.y), gnd = w ? WATER_H : g0;
          if (q.h <= gnd) {
            if (w) { fx[i] = fx[fx.length - 1]; fx.pop(); continue; }   // sinks
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
    const bk = emit ? BE : BG;
    for (const r of rings) {
      if (!!r.emit !== emit) continue;
      const k = r.t / r.life, n0 = r.pal.length, c = r.pal[Math.min(n0 - 1, Math.floor(k * n0))];
      if (r.flash) {
        const X = Math.floor(SX(r.x, r.y, WATER_H + .3)), Y = Math.floor(SY(r.x, r.y, WATER_H + .3));
        if (emit) glowAt(r.x, r.y, WATER_H + .3);
        lp(bk, r.pal[0], X, Y, -1, 0, 3, 1); lp(bk, r.pal[0], X, Y, 0, -1, 1, 3); lp(bk, r.pal[2], X, Y, -2, 0); lp(bk, r.pal[2], X, Y, 2, 0); continue;
      }
      const e = 1 - (1 - k) * (1 - k), rad = r.r0 + (r.r1 - r.r0) * e, n = Math.max(8, Math.round(TAU * rad * PPM / 1.4));
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU, wx = r.x + Math.cos(a) * rad, wy = r.y + Math.sin(a) * rad * .8;
        if (!r.noclip && !wet(wx, wy)) continue;
        if (emit) glowAt(wx, wy, WATER_H);
        lp(bk, c, Math.floor(SX(wx, wy, WATER_H)), Math.floor(SY(wx, wy, WATER_H)));
      }
    }
  }

  // ---------- stream life ----------
  // the stream's visible stretch (world y): every y whose centreline projects near the view (any camera angle; at yaw 0
  // the arena's: the view +-12 px). Turned, more of the stream can be on screen: the particle count scales with it
  const BASE_SPAN = (270 + 24) / 24.98;   // metres of stream the arena shows at yaw 0
  function streamView() {
    const S = host.layout?.stream; if (!S || !STREAM_LIFE[biome]) return null;
    let y0 = 1e9, y1 = -1e9;
    for (let y = -1; y <= 31; y += .25) {
      const X = SX(S.cx(y), y, WATER_H), Y = SY(S.cx(y), y, WATER_H);
      if (X > -50 * V.z && X < VW + 50 * V.z && Y > -12 * V.z && Y < VH + 12 * V.z) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (y1 < y0) return null;
    // the flow's direction on screen (world south) and across it (world east): the streaks / crusts / floes follow them
    const ul = Math.hypot(V.yx, V.yy) || 1, nl = Math.hypot(V.xx, V.xy) || 1;
    return {S, y0: Math.max(-1, y0 - .25), y1: Math.min(31, y1 + .25), U: [V.yx / ul, V.yy / ul], N: [V.xx / nl, V.xy / nl]};
  }
  function sSpawn(K, p, Vs, init) {
    p.t = 0; p.ph = R(); p.y = Vs.y0 + R() * (Vs.y1 - Vs.y0); p.u = (R() - .5) * .76; p.life = K.life ? rr(K.life) : 0; p.h = 0; p.wait = 0;
    if (K.k === 'glint') { p.life = .1 + R() * .2; p.wait = R() * 1.5; }
    if (K.k === 'bubble') { p.wait = R() * 1.5; p.u *= .8; }
    if (K.k === 'suck') { p.o = (R() < .5 ? -1 : 1) * (.9 + R() * 1.2); p.h = .3 + R() * 1.1; }
    if (K.shape === 'floe') { p.w = 3 + (R() * 2 | 0); p.u *= .7; }
    if (K.shape === 'crust') p.w = 1 + (R() * 3 | 0);
    if (init && p.life) p.t = R() * p.life;
  }
  function stepStream(dt) {
    const Vs = streamView(); if (!Vs) return 0;
    const L = STREAM_LIFE[biome], span = Vs.y1 - Vs.y0, mul = Math.min(3, Math.max(1, span / BASE_SPAN));
    if (strmFor !== biome) { strm.length = 0; strmFor = biome; for (const K of L.kinds) K._n = 0; }
    for (const K of L.kinds) {   // the arena's count per visible stretch (more when the turned view shows more stream)
      const want = Math.round(K.n * mul);
      for (; K._n < want; K._n++) { const p = {K}; sSpawn(K, p, Vs, true); strm.push(p); }
      for (let i = strm.length - 1; i >= 0 && K._n > want; i--) if (strm[i].K === K) { strm.splice(i, 1); K._n--; }
    }
    for (const p of strm) {
      const K = p.K;
      if (p.wait > 0) { p.wait -= dt; continue; }
      p.t += dt;
      p.y += flowAt(p.y) * dt * (K.k === 'mist' ? .5 : K.k === 'bubble' ? .6 : 1);
      if (p.y > Vs.y1 || p.y < Vs.y0) p.y = Vs.y0 + (((p.y - Vs.y0) % span) + span) % span;   // wrap over the visible stretch
      if (K.k === 'mist') { p.h = .5 * p.t / p.life; p.u += wind * .03 * dt; }
      if (K.k === 'suck') { const k = Math.exp(-dt * (1.2 + p.t * 1.6)); p.o *= k; p.h *= k; if (Math.abs(p.o) < .12 && p.h < .08) p.t = p.life; }
      if (p.t >= p.life) {
        if (K.k === 'bubble') {   // pop: a few embers
          const x = Vs.S.cx(p.y) + p.u * Vs.S.w(p.y);
          emitFx(x, p.y, WATER_H + .03, 2 + (R() * 3 | 0), {pal: ['#ffe08a', '#ffa040', '#e0541e', '#6e1c12'], sp: [.2, .7], up: [1.4, 2.6], life: [.6, 1.1], gr: 6, drag: 1, emit: true, px: 1});
        }
        sSpawn(K, p, Vs, false);
      }
    }
    return strm.length;
  }
  function drawStream(Vs, pass) {   // 'ground' | 'emit'
    if (!Vs || strmFor !== biome) return;
    const S = Vs.S, bk = pass === 'emit' ? BE : BG, [ux, uy] = Vs.U, [nx, ny] = Vs.N;
    // art px (i across the flow, j along it) -> screen offsets: at yaw 0 exactly the arena's (i right, j down)
    const at = (i, j) => [Math.round(nx * i + ux * j), Math.round(ny * i + uy * j)];
    const run = (c, x, y, i, j, len, along) => { for (let k = 0; k < len; k++) { const [a, b] = along ? at(i, j + k) : at(i + k, j); lp(bk, c, x, y, a, b); } };
    for (const p of strm) {
      const K = p.K;
      if (p.wait > 0 || (K.emit ? 'emit' : 'ground') !== pass) continue;
      const w = S.w(p.y), wx = S.cx(p.y) + (K.k === 'suck' ? p.o : p.u * w);
      if (K.k !== 'suck' && K.k !== 'mist' && !wet(wx, p.y)) continue;   // clipped to the channel (and off the stones)
      const x = Math.floor(SX(wx, p.y, WATER_H + p.h)), y = Math.floor(SY(wx, p.y, WATER_H + p.h));
      if (!inView(x, y, 4 * V.z)) continue;
      if (pass === 'emit') glowAt(wx, p.y, WATER_H + p.h);
      const pal = K.pal, n = pal.length, a = p.life ? p.t / p.life : 0, io = Math.min(p.t / .35, (p.life - p.t) / .35), fi = io >= 1 ? 0 : io > .5 ? 1 : 2;
      switch (K.k) {
        case 'flow':
          if (K.shape === 'streak') run(pal[Math.min(n - 1, fi)], x, y, 0, 0, 3 - fi, true);
          else if (K.shape === 'crust') { run(pal[0], x, y, 0, 0, p.w, false); if (p.w > 2) run(pal[2], x, y, 1, 1, p.w - 2, false); }
          else { run(pal[0], x, y, 0, 0, p.w, false); run(pal[1], x, y, 0, 1, p.w, false); if (fi === 0 && Math.sin(T * 2 + p.ph * TAU) > .8) { const [a, b] = at(1, 0); lp(bk, '#ffffff', x, y, a, b); } }   // ice floe + glint
          break;
        case 'glint': lp(bk, pal[a < .5 ? 0 : 1], x, y); break;
        case 'bubble':
          if (a < .4) lp(bk, pal[2], x, y);
          else if (a < .85) { lp(bk, pal[1], x, y); lp(bk, pal[2], x, y, -1, 0); lp(bk, pal[2], x, y, 1, 0); lp(bk, pal[2], x, y, 0, -1); }
          else { lp(bk, pal[0], x, y, 0, 0, 2, 1); lp(bk, pal[1], x, y, -1, -1); lp(bk, pal[1], x, y, 2, -1); }
          break;
        case 'mist': lp(bk, pal[Math.min(n - 1, fi + (a > .6 ? 1 : 0))], x, y, 0, 0, a < .5 ? 2 : 1, 1); break;
        case 'shimmer': { const b = Math.sin(p.y * 1.9 - T * 1.1 + p.ph * 2); if (b > .2) lp(bk, pal[b > .8 ? 0 : b > .5 ? 1 : 2], x, y); break; }
        case 'suck': lp(bk, pal[Math.min(n - 1, fi + (a > .7 ? 1 : 0))], x, y); break;
      }
    }
    if (pass === 'ground' && (biome === 'ruins' || biome === 'frost')) {   // foam on the upstream side, across the flow
      const f = (T * 5 | 0) & 1, c = biome === 'ruins' ? '#e4f2f6' : '#f0f6ff';
      for (const st of S.stones || []) {
        const X = Math.floor(SX(st.x, st.y - st.r / 1.3, WATER_H)), Y = Math.floor(SY(st.x, st.y - st.r / 1.3, WATER_H));
        if (!inView(X, Y, 12 * V.z)) continue;
        let [a, b] = at(-3 + f, -1); lp(bk, c, X, Y, a, b); [a, b] = at(2 - f, -1); lp(bk, c, X, Y, a, b); run('#b4d0da', X, Y, -1, -2 + f, 2, false);
      }
    }
  }
  function drawFx(emit) {
    for (const q of fx) {
      if (!!q.emit !== emit) continue;
      const X0 = SX(q.x, q.y, q.h), Y0 = SY(q.x, q.y, q.h);
      if (!inView(X0, Y0, 2 * V.z)) continue;
      const n = q.pal.length, big = q.t < q.life * q.hold, w = big ? q.px : Math.max(1, q.px - 1), h = big ? q.py : Math.max(1, q.py - 1);
      const c = q.pal[Math.min(n - 1, Math.floor(q.t / q.life * n))];
      if (emit) { glowAt(q.x, q.y, q.h); lp(BE, c, Math.floor(X0), Math.floor(Y0), -(w >> 1), -(h >> 1), w, h); continue; }
      // a w x h block of lit pixels: one point of the smaller size, two when the block is a pixel longer one way
      const m = Math.min(w, h);
      pp(q.x, q.y, q.h, c, 0, 0, m);
      if (w > m) pp(q.x, q.y, q.h, c, 1, 0, m); else if (h > m) pp(q.x, q.y, q.h, c, 0, 1, m);
    }
  }

  // ---------- rift shards orbiting the ring: little cards (3 spin frames), glowing edges as their emit image ----------
  function shards(fn) {
    const rg = host.layout?.ring; if (biome !== 'rift' || !rg) return;
    for (let i = 0; i < 7; i++) {
      const a = T * .11 + i * TAU / 7 + Math.sin(i * 2.3) * .2, r = rg.r + .5 + Math.sin(T * .4 + i) * .15;
      fn(rg.x + Math.cos(a) * r, rg.y + Math.sin(a) * r, 1.7 + Math.sin(T * .8 + i * 1.9) * .22, i);
    }
  }
  const shardFrame = i => [0, 1, 2, 1][(T * .9 + i * .7 | 0) & 3];
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const SH_IMG = SHARD.map(F0 => { const c = cv(5, 7), q = c.getContext('2d'); for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) { const ch = F0[r][k]; if (ch !== ' ') { q.fillStyle = SH_COL[ch]; q.fillRect(k, r, 1, 1); } } return c; });
  const SH_EM = SHARD.map(F0 => SH_EMIT.map(col => { const c = cv(5, 7), q = c.getContext('2d');
    for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) { const ch = F0[r][k]; if (ch === 'L') { q.fillStyle = r === 0 ? SH_EMIT[0] : col; q.fillRect(k, r, 1, 1); } else if (ch === 'm') { q.fillStyle = SH_EMIT_M; q.fillRect(k, r, 1, 1); } }
    return c; }));
  const MOTEFX = {pal: KINDS.rift[0].pal, sp: [.05, .2], up: [.15, .35], life: [1, 1.6], gr: -.05, drag: .6, emit: true};

  // ---------- ground fog: a tileable noise tile, quantized to 2 additive levels ----------
  const fogTiles = {};
  function fogTile(id) {
    if (fogTiles[id]) return fogTiles[id];
    const Fg = FOG[id], TW = 384, TH = 192, c = cv(TW, TH), q = c.getContext('2d'), im = q.createImageData(TW, TH), d = im.data;
    let fs = 99; const fr = () => { fs = (fs * 16807) % 2147483647; return fs / 2147483647; };
    const oct = [[96, 24, .6], [48, 12, .28], [24, 8, .12]].map(([cw, ch, w]) => { const gw = TW / cw, gh = TH / ch; return {cw, ch, w, gw, gh, v: Array.from({length: gw * gh}, fr)}; });
    const sm = t => t * t * (3 - 2 * t), val = new Float32Array(TW * TH);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      let v = 0;
      for (const o of oct) {
        const fx0 = x / o.cw, fy0 = y / o.ch, ix = Math.floor(fx0), iy = Math.floor(fy0), tx = sm(fx0 - ix), ty = sm(fy0 - iy);
        const g = (a, b) => o.v[((b % o.gh) * o.gw) + (a % o.gw)];
        v += o.w * ((g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx) * (1 - ty) + (g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx) * ty);
      }
      val[y * TW + x] = v;
    }
    const sorted = Float32Array.from(val).sort(), t1 = sorted[Math.floor(sorted.length * (1 - Fg.cover[0]))], t2 = sorted[Math.floor(sorted.length * (1 - Fg.cover[1]))];
    for (let i = 0; i < val.length; i++) {
      const L = val[i] > t2 ? 1 : val[i] > t1 ? 0 : -1; if (L < 0) continue;
      d[i * 4] = Fg.c[L][0]; d[i * 4 + 1] = Fg.c[L][1]; d[i * 4 + 2] = Fg.c[L][2]; d[i * 4 + 3] = 255;
    }
    q.putImageData(im, 0, 0);
    return (fogTiles[id] = c);
  }
  // the tile lives in the arena's world px (x PPM, y PPMY) on the ground: drawn through the ground plane's affine map
  function drawFog() {
    if (!FOG[biome]) return;
    const tile = fogTile(biome), TW = tile.width, TH = tile.height;
    const a = V.xx / PPM, b = V.xy / PPM, c = V.yx / PPMY, d = V.yy / PPMY, e = V.ox, f = V.oy, det = a * d - b * c;
    if (Math.abs(det) < 1e-9) return;
    let u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9;   // the view's corners in world px
    for (const [X, Y] of [[0, 0], [VW, 0], [0, VH], [VW, VH]]) {
      const u = (d * (X - e) - c * (Y - f)) / det, v = (-b * (X - e) + a * (Y - f)) / det;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const sh = Math.round(fogX * PPM), m = host.mood, k = Math.max(.12, Math.min(1, lum(m?.amb || [1, 1, 1])));
    const q = host.layer('add');
    q.save(); q.imageSmoothingEnabled = false; q.globalAlpha = k; q.setTransform(a, b, c, d, e, f);
    for (let ty = Math.floor(v0 / TH) * TH; ty < v1; ty += TH) for (let tx = Math.floor((u0 - sh) / TW) * TW + sh; tx < u1; tx += TW) q.drawImage(tile, tx, ty);
    q.restore();
  }

  // ---------- HD overlay ----------
  let O = null, oKey = '';
  function buildOver(w, h) {
    if (!O) O = cv(w, h); O.width = w; O.height = h;
    const q = O.getContext('2d'), Vo = OVER[biome] || OVER.ruins, rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    if (F.weather && Vo.ha) {   // a thin haze at the top of the screen (air between us and the far ground)
      const gr = q.createLinearGradient(0, 0, 0, h * .3);
      gr.addColorStop(0, rgba(Vo.h, Vo.ha)); gr.addColorStop(.45, rgba(Vo.h, Vo.ha * .35)); gr.addColorStop(1, rgba(Vo.h, 0));
      q.fillStyle = gr; q.fillRect(0, 0, w, h * .3);
    }
    q.save(); q.translate(w / 2, h / 2); q.scale(w / 2, h / 2);   // elliptical vignette, only the corners/edges darken
    const r0 = .62, r1 = 1.42, gr = q.createRadialGradient(0, 0, r0, 0, 0, r1);
    for (let i = 0; i <= 6; i++) gr.addColorStop(i / 6, rgba(Vo.v, +(Vo.va * (i / 6) ** 1.8).toFixed(4)));
    q.fillStyle = gr; q.fillRect(-1, -1, 2, 2); q.restore();
  }

  function setBiome(id) { biome = id; need = true; fx.length = 0; prints.length = 0; rings.length = 0; plumes.length = 0; strmFor = ''; oKey = ''; camW = null; }
  function toggleWeather() { F.weather = !F.weather; oKey = ''; return F.weather; }
  const ms = () => { F.ms = F.ms * .95 + acc * .05; acc = 0; };

  Object.assign(F, {
    toggleWeather, setBiome,
    biomeChanged() { setBiome(host.biome.id); },
    onKey(k) { if (k === 'k') { toggleWeather(); return true; } return false; },
    settings: () => [
      {label: 'Weather (K)', options: ['on', 'off'], get: () => F.weather ? 'on' : 'off', set: v => { if ((v === 'on') !== F.weather) toggleWeather(); }},
      {label: 'Vignette + haze', options: ['on', 'off'], get: () => F.hdOn ? 'on' : 'off', set: v => { F.hdOn = v === 'on'; }},
    ],
    hud: () => F.weather ? '' : 'weather off (K)',
    counts: () => ({fx: fx.length, prints: prints.length, rings: rings.length, stream: strm.length, ambient: kinds.reduce((n, K) => n + K.ps.length, 0)}),
    dbg: {get kinds() { return kinds; }, V, get fx() { return fx; }, get strm() { return strm; }},   // tests
    update(dt, evs) {
      const t0 = performance.now();
      dt = Math.min(.05, Math.max(0, dt || 0)); T += dt;
      if (host.biome.id !== biome) setBiome(host.biome.id);
      const tm = host.time; F.night = tm === 'night' ? 1 : tm === 'dusk' ? .6 : .2;
      const pl = host.player; P = {x: pl.x, y: pl.y, z: pl.z, vx: pl.vx, vy: pl.vy, state: pl.state};
      view();
      if (need) populate();
      const W = WIND[biome] || [0, 0], sn = Math.sin(T * .31) + .6 * Math.sin(T * .73 + 1.3) + .4 * Math.sin(T * 1.37 + 2.1);
      const wf = host.wind, ext = F.windSrc ? F.windSrc() : wf && wf.on !== false && wf.atmosGust ? wf.atmosGust() : null;   // the wind feature's gust fronts, 0..1
      gust = ext ?? Math.max(0, (sn - .7) / 1.3); wind = W[0] + gust * W[1];
      fogX += wind * (FOG[biome]?.drift || 0) * dt + (biome === 'rift' ? .04 * dt : 0);
      let n = fx.length;
      if (F.weather) { parallax(); for (const K of kinds) { K.act = actOf(K); for (let i = 0; i < K.act; i++) stepP(K, K.ps[i], dt); n += K.act; } } else camW = null;
      if (F.weather && biome === 'frost' && gust > .25 && R() < gust * 7 * dt) {   // spindrift: a gust lifts a little snow off the ground
        const [x, y] = fromVF(V.camx + R() * VW, V.camy + R() * VH);
        fx.push({x, y, h: elevAt(x, y) + .02, vx: wind * 1.3, vy: (R() - .5) * .3, vh: .5 + R() * .5, t: 0, life: .5 + R() * .5, gr: 1.6, drag: .3, pal: SNOW, px: 1, py: 1, hold: .4});
      }
      if (biome === 'rift') shards((x, y, h) => { if (R() < .5 * dt) emitFx(x, y, h - .1, 1, MOTEFX); });   // shards shed a mote now and then
      if (P.state === 'climb') for (let k = 16 * dt + R(); k >= 1; k--)   // grit trickling off the cliff face under the hands and feet
        emitFx(P.x + (R() - .5) * .6, P.y + .06, Math.max(.1, (P.z || 0) - .2 + R() * .8), 1, {pal: dustOf(), sp: [.1, .35], up: [-.2, .3], life: [.6, 1], gr: 4, drag: 1.5, px: 1});
      for (const e of evs || []) {
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
      F.count = n;
      tick(t0);
    },
    frame() {
      const t0 = performance.now();
      ms();   // one sample per rendered frame: this frame's draw + the steps since the last one
      if (!biome) { tick(t0); return; }
      view();
      const Vs = streamView();
      // ---- the ground canvas's share: stream, rings, footprints and shard shadows (multiplied in), far layers
      drawStream(Vs, 'ground'); drawRings(false);
      for (const f of prints) {   // footprints: lightening in steps as they fill back in; the stride's shape as seen on screen
        const X = Math.floor(SX(f.x, f.y, f.z)), Y = Math.floor(SY(f.x, f.y, f.z));
        if (!inView(X, Y, 2 * V.z)) continue;
        const dX = f.dx * V.xx + f.dy * V.yx, dY = f.dx * V.xy + f.dy * V.yy, l = Math.hypot(dX, dY) || 1, ax = Math.abs(dX / l), ay = Math.abs(dY / l);
        const sh = ax > .92 ? 0 : ay > .92 ? 1 : dX * dY > 0 ? 2 : 3, col = mulCss(f.x, f.y, PRINT.find(p => f.t < p[0])[1]);
        if (sh === 0) lp(BG, col, X, Y, -1, 0, 3, 1); else if (sh === 1) lp(BG, col, X, Y, 0, -1, 1, 2);
        else if (sh === 2) { lp(BG, col, X, Y, -1, -1); lp(BG, col, X, Y); } else { lp(BG, col, X, Y, 0, -1); lp(BG, col, X, Y, -1, 0); }
      }
      shards((x, y) => { const z = elevAt(x, y), X = Math.floor(SX(x, y, z)), Y = Math.floor(SY(x, y, z)); lp(BG, mulCss(x, y, SH_SHADOW), X, Y, -1, 0, 3, 1); });
      if (F.weather) { drawFog(); drawKinds('ground'); }
      if (any(BG)) flush(BG, host.layer('ground'));
      // ---- in front (lit, depth-tested): shards, falling weather, fx
      shards((x, y, h, i) => { const f = shardFrame(i), pv = Math.sin(T * 1.5 + i * 2.1);
        host.sprite({img: SH_IMG[f], em: SH_EM[f][pv > .3 ? 0 : pv > -.4 ? 1 : 2], x, y, h, px: 2, py: 3, type: 3}); });
      if (F.weather) drawKinds('front');
      drawFx(false);
      // ---- glow: the arena's view-sized emitter canvas always overlapped the player, so lighting.apply drew it straight
      // over the lit frame at alpha 1.25 - lum(ambient) x .95 (clamped .3..1): faint by day, full at night. Same here
      if (F.weather) drawKinds('emit');
      drawFx(true); drawStream(Vs, 'emit'); drawRings(true);
      flushGlow();   // depth-tested emissive points (hidden behind walls / props)
      tick(t0);
    },
    hd(q, scale) {
      if (!F.hdOn || !biome) return;
      const t0 = performance.now(), w = q.canvas.width, h = q.canvas.height, key = `${w}x${h}|${biome}|${F.weather}`;
      if (key !== oKey) { oKey = key; buildOver(w, h); }
      q.drawImage(O, 0, 0);
      tick(t0);
    },
  });
  if (host.biome) setBiome(host.biome.id);
  return F;
}
