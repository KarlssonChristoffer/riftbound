// WIND: one wind for the whole world. OWNER: ambience session ("Game demo improvements brainstorm"), wind agent.
// SHOW ONLY: nothing here changes how the game plays (no colliders, damage or player movement).
//
// Gusts are FRONTS that roll across the map along the wind direction (roughly W -> E, a little south, the same way
// atmos.js blows its leaves and cloth.js its cloak), so you can watch a gust arrive: the grass in the west leans first,
// then the bushes, the braziers' flames, the banners, the Ranger's cloak as it reaches him, then the trail.
//
// CONTRACT (the host, arena.html, calls exactly these):
//   export function createWind(ctx, host) -> W
//   W.on / W.toggle()            key 5; ?wind=0 starts off. Off = everything rigid and still (the old look), W.at = calm
//   W.ms                         rolling average cost per frame (ms)
//   W.setBiome(id), W.setTime(name)
//   W.update(dt, evs)            every simulation step (not during hitstop)
//   W.at(x, y) -> {x, y, g}      wind at a world point: velocity m/s on the ground plane (x east, y south) + gust 0..1
//   W.gust                       0..1, the gust at the player right now (audio's ambient beds follow it)
//   W.dir                        [ux, uy] unit vector the wind blows TOWARD
//   W.drawProp(g, sp, x, y, p) -> bool
//                                called for EVERY prop in the host's sorted pass instead of g.drawImage(sp.img, x, y) (x, y =
//                                the sprite's top-left, view px, hit wobble already applied). Draw it swayed and return true
//                                for FOLIAGE ONLY (tuft, bush, tree); return false for anything else (the host then draws it
//                                as before). Crates, barrels, pots, chests, pillars, rubble, rocks are rigid 3D props owned
//                                by the "Demo world graphics enhancement" session: never sway them.
//   W.emitOf(p, sp) -> canvas | null
//                                the prop's emissive layer for this frame: braziers and torches get a LIVE flame (flickers,
//                                leans with the wind); swayed foliage with glowing bits (ember twigs, rift coral tips) gets
//                                its emit swayed the same way; null = use sp.emit unchanged
//   W.sortables(cam) -> [{y, draw(g)}]   extra world things depth-sorted with the props and the player (y = world metres):
//                                banners, pennants, prayer flags, cloth strips on the dummies, hanging lanterns, leaves /
//                                snow / sparks shaken out of bushes
//   W.lights() -> [{x, y, h, color, radius, intensity, flicker, id}]   hanging lanterns (they swing: the pool moves)
//   W.emitters(cam) -> [{img, x, y}]     glowing pixels added after lighting (view px, top-left)
//   W.cloth() -> {wind: [vx, vy], gust}  for cloth.js CLOTH_PARAMS at the player (the host assigns it before rig.update)
//   W.atmosGust() -> 0..1                the gust near the view centre; atmos.js uses it instead of its own gust walk
//
// EXTRAS (tests / tuning, nothing in the host needs them):
//   W.tune             live tunables (TUNE below)          W.gustNow(A)   send a strong front at the view right now
//   W.info()           counts (fronts, decor items, particles, simulated pieces)
//
// host: see the AMBIENCE HOST block in arena.html (props, arrows, P, layout, elev, inStream, cam(), biome(), time(),
// mood(), spriteOf(p), cursorAim(), player(), drawPlayer(q, x, y), shots(), events).
// ctx = {PPM, PPMY, PPMH, toS(x, y, h), WM, HM, WPX, HPX, VW, VH, PLAY, layout}; view px = toS(...) - [cam.x, cam.y]
//
// ART RULES (same as biomes.js / atmos.js): 1 texel = 1 screen px, no AA / dither / gradients / alpha ramps on the
// pixel canvas; every material is a 4-tone ramp [hi, base, shade, outline], light from the top-left; sway is whole-pixel
// row offsets (bands), never resampling. Motion must read at 1x: a gust = 1-3 px of lean, not a wobble on every frame.
//
// HOW IT WORKS
//   field     fronts: {F leading edge along the wind axis (m), speed 4-8 m/s, length, strength, a wobbly edge (two
//             sines across the front that drift), a patchy strength along it, a lateral extent}; g = 1 - prod(1 - g_i).
//             Velocity = dir * (base + g * gust) (+ a little cross-wind in a gust). Rift: no wind, slow rings rolling
//             outward from the rune circle; velocity = radial * g * gust (things lean AWAY from the centre).
//   foliage   a damped spring per prop (px of lean at the sprite's top) driven by the local wind (steady lean + gust +
//             flutter), the player (running / rolling past pushes it away) and arrows (shudder + shed particles).
//             Drawn as horizontal row bands with whole-pixel offsets from a per-sprite weight curve (base rows fixed,
//             tree trunks stiff, crowns move as a block). A hysteresis keeps idle lean from flickering at a threshold.
//   flames    the brazier / torch emit split into coals (over opaque sprite pixels, static) and flame (emissive pixels
//             over transparent ones). Re-rendered at 12 fps: rows re-sampled to a flickering height (tip trims), the
//             upper rows lean downwind (t^1.6), row jitter near the tip, an occasional detached ember pixel.
//   cloth     Verlet grids in world metres (x, y, z up): pinned edge, gravity, drag toward a "show wind" (TUNE.clothV
//             m/s at a full gust), a flutter wave along the local normal, 3-4 constraint passes, wall planes.
//             Rasterised into a per-item pixel box (triangles, barycentric UV for the pattern, vertex-normal tone vs the
//             piece's rest tone -> hi / base / shade, lining one tone darker, selective outline), re-rasterised at
//             TUNE.clothFps and uploaded only when a pixel changed.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const hsh = (a, b = 0, c = 0) => {   // deterministic hash (same as biomes.js)
  let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 0) / 4294967296;
};
const rgba = s => { const n = parseInt(s.slice(1), 16); return (0xff000000 | ((n & 255) << 16) | (n & 0xff00) | (n >>> 16)) >>> 0; };   // '#rrggbb' -> ImageData u32
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };

// ---------------------------------------------------------------- tunables
const TUNE = {
  clothV: 4,          // m/s of "show wind" the cloth feels at a full push (normalised 1); the real breeze is too weak to lift cloth
  clothIdle: .22,     // flutter of the cloth with no gust (share of a full gust's)
  clothFps: 30,       // cloth re-raster rate (simulation runs every step)
  flameFps: 12,       // live flame re-render rate
  idle: .1,           // foliage flutter, normalised: idle amplitude ...
  flutter: .26,       // ... + this per unit of gust
  hyst: .5,           // px: the lean must move this far before the drawn offset changes (no 1 px flicker at a threshold)
  push: {tuft: [.8, 3], bush: [1.1, 2.2]},   // the player running / rolling past: [radius m, px at full speed]
  arrowBush: [.55, 1.45], arrowTree: [1.2, 4.6],   // an arrow through foliage: [radius m, max height m]
  towerTop: 9,        // px below the tower sprite's top where its roof centre is (pennant pole base)
  riftLift: 12,       // m/s^2 of eerie lift on cloth (at its free edge) while a rift ring passes
  flameAlbedo: true,  // also paint the live flame into the scene (a sortable over the brazier / torch): lighting adds emit x
                      // max(1 - B, EMIT_MIN), so an emit-only flame vanishes inside its own light pool (by day, and at night)
};

// ---------------------------------------------------------------- per biome wind
// base / gust m/s (atmos.js WIND uses the same numbers), sway = how far foliage leans at a full gust (0..1 of its max),
// fronts: every s, speed m/s, length m (along the wind), strength, edge wobble m, lateral half width m
const BIOME = {
  ruins: {base: .3, gust: .7, sway: .9, fronts: {every: [3.5, 8], speed: [5, 7], len: [6, 12], amp: [.55, 1], edge: [1.5, 3.5], half: [10, 30]}, cloth: [.5, 1.5]},
  ember: {base: .12, gust: .35, sway: .5, fronts: {every: [5, 10], speed: [4, 5], len: [10, 18], amp: [.5, .9], edge: [2.5, 5], half: [14, 36]}, cloth: [.3, .8]},
  frost: {base: .45, gust: 2.1, sway: 1, fronts: {every: [1.6, 4], speed: [6, 8], len: [6, 11], amp: [.6, 1], edge: [1, 3], half: [12, 30]}, cloth: [.7, 2.2]},
  rift: {base: 0, gust: 1.1, sway: .85, pulse: {every: [5.5, 9], speed: [2, 2.6], len: [2.4, 3.4], amp: [.7, 1]}, cloth: [0, 1.6]},
};
// foliage flexibility per biome: null = rigid (ember vents and basalt spires, rift crystals and floating islands)
// px = max lean at the top, w = spring rad/s, z = damping ratio, fq = flutter Hz, curve = row weight profile
const FLEX = {
  ruins: {tuft: {px: 3, w: 16, z: .32, fq: 1.3, curve: 'tip'}, bush: {px: 2.4, w: 9, z: .36, fq: .8, curve: 'bush'},
    tree: {px: 3.5, w: 3.8, z: .42, fq: .33, curve: 'crown'}, dead: {px: 2, w: 4.2, z: .4, fq: .4, curve: 'limb'}},
  ember: {bush: {px: 1.6, w: 11, z: .4, fq: .5, curve: 'bush'}},
  frost: {tuft: {px: 1.6, w: 15, z: .35, fq: 1.1, curve: 'twig'}, bush: {px: 1.8, w: 8, z: .4, fq: .7, curve: 'bush'},
    tree: {px: 2.6, w: 3, z: .45, fq: .3, curve: 'pine'}},
  rift: {bush: {px: 2, w: 7, z: .3, fq: .45, curve: 'coral'}},
};
const CURVES = {   // u = 0 at the sprite's base row .. 1 at its top row; c = crown start (trees)
  tip: u => u < .2 ? 0 : ((u - .2) / .8) ** 1.25,
  bush: u => u < .22 ? 0 : ((u - .22) / .78) ** 1.1,
  twig: u => u < .38 ? 0 : (u - .38) / .62,
  coral: u => u ** 1.6,
  pine: u => u < .08 ? 0 : ((u - .08) / .92) ** 1.7,
  limb: u => u < .1 ? 0 : ((u - .1) / .9) ** 1.5,
  crown: (u, c) => u < c ? .7 * (u / c) ** 2.2 : .7 + .3 * (u - c) / (1 - c),
};
// shed particles per biome (bushes shaken by arrows, snow blown off in a gust)
const SHED = {
  ruins: {kind: 'leaf', pals: [['#6f8c68', '#577154', '#435a45'], ['#6f8c68', '#577154', '#435a45'], ['#a4ae52', '#7a8a3c', '#4e5c2a'], ['#d0a44a', '#a47a34', '#6c5024']]},
  ember: {kind: 'spark', pal: ['#ffd27e', '#f28a36', '#b8481c', '#5e200e'], ash: ['#a39a92', '#7c746e', '#57514d']},
  frost: {kind: 'snow', pal: ['#f2f6ff', '#c4d0e4', '#8e9cb8']},
  rift: {kind: 'mote', pal: ['#e4c8ff', '#ac80f2', '#7448c4', '#40247a']},
};

// ---------------------------------------------------------------- cloth / decor palettes ([hi, base, shade, outline])
const PAL = {
  ruins: {
    wood: ['#8c6c4a', '#70543a', '#543e2b', '#35271c'], metal: ['#a08650', '#7a6438', '#56452a', '#352a1c'],
    main: ['#c26a50', '#9a4a3a', '#6e3430', '#3a1c1e'],     // faded red (biomes RED, sun-bleached)
    trim: ['#d6b068', '#ae8a4a', '#846638', '#4e3c24'],     // ochre
    alt: ['#bca985', '#9e8d6b', '#7d6f53', '#514836'],      // undyed linen (biomes cloth)
    blue: ['#8fa4ac', '#6f858e', '#556a74', '#33424a'],     // faded woad
    flags: ['main', 'trim', 'alt', 'blue'], strip: 'main', emblem: 'sun', rope: '#4a3a28',
    glass: ['#fff0c0', '#f2d48a'], glow: ['#fff2c8', '#ffd070'], light: '#ffc070',
  },
  ember: {
    wood: ['#5a4a40', '#43362f', '#30261f', '#1c1512'], metal: ['#6c666a', '#4d484d', '#363237', '#211e22'],
    main: ['#5a5250', '#423b3b', '#2e2929', '#181414'],     // charcoal
    trim: ['#c44a2c', '#922f1e', '#621e14', '#2e0e0a'],     // ember red
    alt: ['#8c827b', '#79716b', '#655e59', '#4a4441'],      // ash
    flags: ['main', 'trim', 'alt'], strip: 'trim', emblem: 'diamond', rope: '#1c1512',
    fray: true, crust: '#2a1512', ember: ['#ffd070', '#ff8a3a', '#e0541e'],
    glass: ['#ffe0a0', '#ffb060'], glow: ['#ffe8b0', '#ffa848'], light: '#ff9a40',
  },
  frost: {
    wood: ['#8a7c6e', '#6d6055', '#534841', '#362f2b'], metal: ['#9ea8b8', '#768093', '#586275', '#39404f'],
    main: ['#c4daf0', '#96b6d8', '#6e8eba', '#465888'],     // pale blue
    trim: ['#f4f8ff', '#d4deec', '#a8b6cc', '#6c7c98'],     // white
    alt: ['#9cc8dc', '#6ea2bc', '#4e7e9c', '#2e4e6c'],      // glacier
    flags: ['main', 'trim', 'alt'], strip: 'main', emblem: 'flake', rope: '#362f2b', rime: true,
    glass: ['#fff4d0', '#ffd890'], glow: ['#fff6d8', '#ffd890'], light: '#ffd890',
  },
  rift: {
    wood: ['#6a5680', '#4e3e66', '#392d4e', '#221a31'], metal: ['#6c5c8c', '#4f4372', '#3b3158', '#251e39'],
    main: ['#9a70d2', '#6e4aaa', '#4c3080', '#26183e'],     // violet
    trim: ['#56467c', '#403460', '#30274c', '#1d1731'],     // the rift's stone violet
    alt: ['#d49ae8', '#a868c8', '#7a44a0', '#40205a'],
    flags: ['main', 'trim', 'alt'], strip: 'alt', emblem: 'rune', rope: '#221a31',
    rune: ['#ffd8f8', '#ff8ae8'],
    glass: ['#ffe0fa', '#e8a8ff'], glow: ['#ffe8fc', '#ff9ae8'], light: '#e08cff',
  },
};
// banner emblems, 5 x 5 (drawn in the trim colour; the rift's rune glows)
const EMBLEM = {
  sun: ['.###.', '#...#', '#.#.#', '#...#', '.###.'],
  diamond: ['..#..', '.###.', '##.##', '.###.', '..#..'],
  flake: ['..#..', '#.#.#', '.###.', '#.#.#', '..#..'],
  rune: ['#...#', '.#.#.', '..#..', '..#..', '.###.'],
};
// lantern body, pivot = the ring at (3, 0). O outline, h/b/s metal, G glass, g glass core (glass = emissive)
const LANTERN = ['...O...', '..hbs..', '.hbbbsO', '.bGGGsO', '.bGgGsO', '.bGGGsO', '.hbbbsO', '..OOO..'];
// light from the top-left, a bit toward the viewer, in (right, up, toward camera) - the sprites' light (cloth.js LIGHT)
const LR = -.551, LU = .621, LT = .561;
const CP = .34, SP_ = .94;   // sprite camera pitch 20 deg: toward-camera = (0, .94, .34), screen-up = (0, -.34, .94) in (x, y, z)

export function createWind(ctx, host) {
  const Q = new URLSearchParams(location.search);
  const W = {on: Q.get('wind') !== '0', ms: 0, gust: 0, dir: [.94, .34], tune: TUNE};
  { const l = Math.hypot(W.dir[0], W.dir[1]); W.dir = [W.dir[0] / l, W.dir[1] / l]; }
  const [UX, UY] = W.dir;
  let biome = 'ruins', B = BIOME.ruins, timeName = 'day', T = 0, acc = 0;
  let s = 1;   // seeded PRNG (mulberry32)
  const R = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rr = a => a[0] + R() * (a[1] - a[0]);
  const tick = t0 => { acc += performance.now() - t0; };
  const camNow = () => host.cam?.() || {x: 0, y: 0};
  const vref = () => (B.base + B.gust) || 1;

  // ================================================================ gust field
  const fronts = []; let nextF = 0, S0 = 0, S1 = 60, T0 = -25, T1 = 30;
  function extent() {
    const c = [[0, 0], [ctx.WM, 0], [0, ctx.HM], [ctx.WM, ctx.HM]];
    const sv = c.map(([x, y]) => x * UX + y * UY), tv = c.map(([x, y]) => -x * UY + y * UX);
    S0 = Math.min(...sv); S1 = Math.max(...sv); T0 = Math.min(...tv); T1 = Math.max(...tv);
  }
  const ring = () => ctx.layout?.ring || {x: (ctx.PLAY.x0 + ctx.PLAY.x1) / 2, y: (ctx.PLAY.y0 + ctx.PLAY.y1) / 2};
  function newFront(F, A) {
    const G = B.fronts;
    return {F, v: rr(G.speed), len: rr(G.len), A: A ?? rr(G.amp), edge: rr(G.edge), tc: T0 + R() * (T1 - T0), half: rr(G.half),
      k1: .16 + R() * .22, k2: .42 + R() * .45, k3: .1 + R() * .2, p1: R() * TAU, p2: R() * TAU, p3: R() * TAU, w1: .2 + R() * .3, w2: .15 + R() * .3};
  }
  const newPulse = () => { const G = B.pulse; return {F: -.5, v: rr(G.speed), len: rr(G.len), A: rr(G.amp), edge: .4 + R() * .5, k1: 2 + (R() * 3 | 0), p1: R() * TAU, w1: .25 + R() * .3}; };
  function stepField(dt) {
    nextF -= dt;
    if (nextF <= 0) {
      if (B.pulse) { nextF = rr(B.pulse.every); fronts.push(newPulse()); }
      else { nextF = rr(B.fronts.every); fronts.push(newFront(S0 - 4.5)); }
    }
    const end = B.pulse ? 48 : S1 + 4;
    for (let i = fronts.length - 1; i >= 0; i--) { const f = fronts[i]; f.F += f.v * dt; if (f.F - f.len - f.edge > end) fronts.splice(i, 1); }
  }
  // gust envelope along the front: a quick rise, a hold, a long decay
  const env = (e, len) => { const rise = Math.min(1.6, len * .22), hold = len * .34; return e < rise ? smooth(e / rise) : e < hold ? 1 : 1 - smooth((e - hold) / (len - hold)); };
  const FA = {x: 0, y: 0, g: 0};   // scratch result (no allocations in the hot paths)
  function field(x, y) {
    if (!W.on) { FA.x = FA.y = FA.g = 0; return FA; }
    let q = 1;
    if (B.pulse) {
      const rg = ring(), dx = x - rg.x, dy = y - rg.y, d = Math.hypot(dx, dy) || 1e-3, a = Math.atan2(dy, dx);
      for (const f of fronts) {
        const e = f.F + f.edge * Math.sin(a * f.k1 + f.p1 + T * f.w1) - d;
        if (e > 0 && e < f.len) q *= 1 - f.A * env(e, f.len);
      }
      const g = 1 - q, v = g * B.gust; FA.x = dx / d * v; FA.y = dy / d * v; FA.g = g; return FA;
    }
    const sA = x * UX + y * UY, tA = -x * UY + y * UX;
    for (const f of fronts) {
      const e = f.F + f.edge * (.62 * Math.sin(tA * f.k1 + f.p1 + T * f.w1) + .38 * Math.sin(tA * f.k2 + f.p2 - T * f.w2)) - sA;
      if (e <= 0 || e >= f.len) continue;
      const lat = smooth((f.half - Math.abs(tA - f.tc)) / 4); if (lat <= 0) continue;
      q *= 1 - f.A * lat * env(e, f.len) * (.8 + .2 * Math.sin(tA * f.k3 + f.p3));
    }
    const g = 1 - q, v = B.base + g * B.gust, tw = g * B.gust * .12 * Math.sin(T * 1.9 + sA * .5);
    FA.x = UX * v - UY * tw; FA.y = UY * v + UX * tw; FA.g = g; return FA;
  }
  function seedField() {
    fronts.length = 0; nextF = 0; s = {ruins: 101, ember: 202, frost: 303, rift: 404}[biome] || 1;
    extent();
    for (let t = 0; t < 30; t += .25) stepField(.25);   // a steady state: fronts already on the map
  }

  // ================================================================ foliage
  const FOLK = {tuft: 1, bush: 1, tree: 1};
  const fst = new Map();   // prop -> spring state
  let fol = null, folN = -1;
  const folList = () => { const P = host.props; if (!fol || P.length !== folN) { fol = P.filter(p => FOLK[p.kind]); folN = P.length; } return fol; };
  function flexOf(p) {
    const F = FLEX[biome]; if (!F) return null;
    if (p.kind === 'tree' && F.dead && (p.variant | 0) === 2) return F.dead;
    return F[p.kind] || null;
  }
  // per sprite: row extents, then per curve a weight per row (cached: sprites are cached per biome / variant)
  const shapes = new WeakMap(), scr = mk(1, 1), sq = scr.getContext('2d', {willReadFrequently: true});
  function readPx(img) {   // our own sprite canvases only (never the screen)
    const w = img.width, h = img.height; if (scr.width < w || scr.height < h) { scr.width = Math.max(scr.width, w); scr.height = Math.max(scr.height, h); }
    sq.clearRect(0, 0, w, h); sq.drawImage(img, 0, 0); return sq.getImageData(0, 0, w, h).data;
  }
  function weights(img, curve) {
    let S = shapes.get(img);
    if (!S) {
      const w = img.width, h = img.height, d = readPx(img), wid = new Uint16Array(h); let top = h, base = -1;
      for (let y = 0; y < h; y++) { let x0 = -1, x1 = -1; for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]) { if (x0 < 0) x0 = x; x1 = x; } if (x0 >= 0) { wid[y] = x1 - x0 + 1; if (y < top) top = y; base = y; } }
      S = {h, top, base: Math.max(base, 0), wid}; shapes.set(img, S);
    }
    if (S[curve]) return S[curve];
    const {h, top, base, wid} = S, span = Math.max(1, base - top), Wt = new Float32Array(h);
    let c = .35;
    if (curve === 'crown') {   // the crown starts where the silhouette gets much wider than the trunk
      const tr = []; for (let y = Math.round(base - span * .2); y <= Math.round(base - span * .08); y++) tr.push(wid[y]);
      tr.sort((a, b) => a - b); const tw = Math.max(3, tr[tr.length >> 1] || 3);
      for (let y = Math.round(base - span * .12); y > top + 2; y--) if (wid[y] > tw * 2.4 && wid[y - 1] > tw * 2.4 && wid[y - 2] > tw * 2.4) { c = (base - y) / span; break; }
      c = clamp(c, .15, .6);
    }
    const fn = CURVES[curve];
    for (let y = 0; y < h; y++) Wt[y] = fn(clamp((base - y) / span, 0, 1), c);
    return (S[curve] = Wt);
  }
  function stepFoliage(dt, V) {
    const Pl = host.P, pvx = Pl.vx || 0, pvy = Pl.vy || 0, spd = Math.hypot(pvx, pvy), roll = Pl.state === 'roll', VR = vref();
    for (const p of folList()) {
      if (p.x < V.x0 || p.x > V.x1 || p.y < V.y0 || p.y > V.y1) continue;
      const F = flexOf(p); if (!F) continue;
      let st = fst.get(p);
      if (!st) fst.set(p, st = {d: 0, v: 0, disp: 0, push: 0, shake: 0, ph: hsh(p.x * 100 | 0, p.y * 100 | 0) * TAU, g: 0, D: 0});
      const a = field(p.x, p.y), n = a.x / VR * B.sway;
      const fl = (TUNE.idle + a.g * TUNE.flutter) * (.65 * Math.sin(T * F.fq * TAU + st.ph) + .35 * Math.sin(T * F.fq * TAU * 1.73 + st.ph * 2.1));
      let push = 0; const PU = TUNE.push[p.kind];
      if (PU && (spd > .8 || roll) && Math.abs((p.z || 0) - (Pl.z || 0)) < .5) {   // running / rolling past pushes it away from him
        const dx = p.x - Pl.x, dy = (p.y - Pl.y) * 1.3, dd = Math.hypot(dx, dy);
        if (dd < PU[0]) {   // brushed along with his motion (sideways), or away from him when he barely moves sideways
          const side = Math.abs(pvx) > .8 ? Math.sign(pvx) : Math.sign(dx || 1);
          push = side * PU[1] * (1 - dd / PU[0]) * Math.min(1.3, spd / 4 + (roll ? .6 : 0));
          st.v += push * F.w * 2.2 * dt;   // a kick: a quick brush still bends it, then it springs back
        }
      }
      st.push += (push - st.push) * Math.min(1, dt * (push ? 25 : 10));
      const target = F.px * (n + fl) + st.push;
      st.v += (F.w * F.w * (target - st.d) - 2 * F.z * F.w * st.v) * dt; st.d = clamp(st.d + st.v * dt, -F.px - 1.5, F.px + 1.5);
      st.shake *= Math.exp(-dt * 4.5);
      if (Math.abs(st.d - st.disp) > TUNE.hyst) st.disp = st.d;
      if (a.g > .62 && st.g <= .62) gustShed(p);   // a gust front arriving
      st.g = a.g;
    }
  }
  function drawProp(g, sp, x, y, p) {
    if (!W.on || !FOLK[p.kind]) return false;
    const F = flexOf(p), st = F && fst.get(p); if (!st) return false;
    const t0 = performance.now(), img = sp.img, w = img.width, h = img.height;
    const D = st.disp + (st.shake > .05 ? st.shake * 1.7 * Math.sin(T * 44 + st.ph) : 0);
    st.D = D;
    const Wt = weights(img, F.curve);
    let r0 = 0, o0 = Math.round(D * Wt[0]);
    for (let r = 1; r <= h; r++) {   // row bands: consecutive rows with the same whole-pixel offset, one drawImage each
      const o = r < h ? Math.round(D * Wt[r]) : NaN;
      if (o !== o0) { g.drawImage(img, 0, r0, w, r - r0, x + o0, y + r0, w, r - r0); r0 = r; o0 = o; }
    }
    tick(t0); return true;
  }
  const femit = new Map();   // prop -> {cv, key, src}: swayed emit of glowing foliage (ember twigs, rift coral tips)
  function foliageEmit(p, sp) {
    const F = flexOf(p), st = F && fst.get(p); if (!st) return null;
    const key = Math.round(st.D * 8);
    let c = femit.get(p);
    if (!c || c.src !== sp.emit) { c = {cv: mk(sp.emit.width, sp.emit.height), key: NaN, src: sp.emit}; femit.set(p, c); }
    if (c.key !== key) {
      c.key = key; const q = c.cv.getContext('2d'), E = sp.emit, w = E.width, h = E.height, Wt = weights(sp.img, F.curve), D = st.D;
      q.clearRect(0, 0, w, h);
      let r0 = 0, o0 = Math.round(D * Wt[0]);
      for (let r = 1; r <= h; r++) { const o = r < h ? Math.round(D * Wt[r]) : NaN; if (o !== o0) { q.drawImage(E, 0, r0, w, r - r0, o0, r0, w, r - r0); r0 = r; o0 = o; } }
    }
    return c.cv;
  }

  // ================================================================ live flames (brazier, torch)
  const flames = new Map();   // prop -> cache
  function buildFlame(sp) {
    const E = sp.emit, w = E.width, h = E.height;
    const ed = new Uint32Array(readPx(E).slice().buffer), ia = readPx(sp.img), base = new Uint32Array(w * h), rows = [];
    let yb = -1, yt = h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, c = ed[i]; if (!(c >>> 24)) continue;
      if (ia[i * 4 + 3]) base[i] = c;   // coals: over the sprite's own pixels (they stay put)
      else { (rows[y] ||= []).push(x, c); if (y > yb) yb = y; if (y < yt) yt = y; }
    }
    if (yb < 0) return null;
    const N = yb - yt + 1, R2 = [];
    for (let k = 0; k < N; k++) {   // k = 0 is the flame's bottom row
      const a = rows[yb - k] || [], xs = [], cs = []; let sx = 0;
      for (let j = 0; j < a.length; j += 2) { xs.push(a[j]); cs.push(a[j + 1]); sx += a[j]; }
      R2.push({xs, cs, cx: xs.length ? sx / xs.length : NaN});
    }
    const cv = mk(w, h), buf = new Uint32Array(w * h);
    return {src: E, w, h, base, rows: R2, N, yb, cv, q: cv.getContext('2d'), buf, im: new ImageData(new Uint8ClampedArray(buf.buffer), w, h), step: -1, hk: 1, lean: 0, ph: R() * TAU};
  }
  function renderFlame(c, p) {
    const a = field(p.x, p.y), nx = a.x / vref() * B.sway, {w, h, N, buf, rows} = c;
    c.lean += (clamp(nx * 3.3, -3, 3) + Math.sin(T * 2.3 + c.ph) * .35 - c.lean) * .5;
    c.hk += (.74 + R() * .26 - a.g * .1 - c.hk) * .6;
    const No = clamp(Math.round(N * c.hk), Math.max(3, N - 4), N);
    buf.set(c.base);
    let tipX = NaN, tipC = 0;
    for (let r = 0; r < No; r++) {
      const src = rows[Math.min(N - 1, Math.floor(r * N / No))]; if (!src.xs.length) continue;
      const t = No > 1 ? r / (No - 1) : 0;
      let sh = Math.round(c.lean * t ** 1.6);
      if (t > .45 && R() < .22) sh += R() < .5 ? -1 : 1;   // the tip licks
      const y = c.yb - r; if (y < 0) continue;
      for (let j = 0; j < src.xs.length; j++) { const x = src.xs[j] + sh; if (x >= 0 && x < w) buf[y * w + x] = src.cs[j]; }
      tipX = src.cx + sh; tipC = src.cs[src.cs.length >> 1];
    }
    if (R() < .28 && tipX === tipX) {   // a detached ember above the tip
      const y = c.yb - No - 1 - (R() * 3 | 0), x = Math.round(tipX + c.lean * .5 + (R() - .5) * 2);
      if (y >= 0 && x >= 0 && x < w) buf[y * w + x] = tipC;
    }
    c.q.putImageData(c.im, 0, 0);
  }
  function flameOf(p, sp) {
    let c = flames.get(p);
    if (!c || c.src !== sp.emit) { c = buildFlame(sp); if (!c) return null; flames.set(p, c); }
    const step = Math.floor(T * TUNE.flameFps);
    if (c.step !== step) { c.step = step; renderFlame(c, p); }
    return c.cv;
  }
  function emitOf(p, sp) {
    if (!W.on || !sp.emit) return null;
    const k = p.kind;
    if (k !== 'brazier' && k !== 'torch' && !FOLK[k]) return null;
    const t0 = performance.now(), r = FOLK[k] ? foliageEmit(p, sp) : flameOf(p, sp);
    tick(t0); return r;
  }

  // ================================================================ cloth decor
  // A piece is a Verlet grid (cols x rows) in world metres. u runs along cols, v along rows; d = 0 at the pinned edge ..
  // 1 at the free edge (flutter grows toward it). pat(u, v) -> -1 (no cloth) | ramp index (+64 emissive, +128 rime).
  function grid(o) {
    const {cols, rows} = o, n = cols * rows, P = new Float32Array(n * 3), U = new Float32Array(n), Vv = new Float32Array(n), Dd = new Float32Array(n), pin = new Uint8Array(n);
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const i = r * cols + k, fu = cols > 1 ? k / (cols - 1) : 0, fv = rows > 1 ? r / (rows - 1) : 0, sag = o.sag ? o.sag * 4 * fu * (1 - fu) : 0;
      P[i * 3] = o.org[0] + o.ax[0] * fu + o.ay[0] * fv; P[i * 3 + 1] = o.org[1] + o.ax[1] * fu + o.ay[1] * fv; P[i * 3 + 2] = o.org[2] + o.ax[2] * fu + o.ay[2] * fv - sag;
      U[i] = fu; Vv[i] = fv; pin[i] = o.pin(r, k, cols, rows) ? 1 : 0; Dd[i] = o.dist ? o.dist(fu, fv) : fv;
    }
    const L = [];
    const link = (a, b, st) => { const dx = P[b * 3] - P[a * 3], dy = P[b * 3 + 1] - P[a * 3 + 1], dz = P[b * 3 + 2] - P[a * 3 + 2]; L.push(a, b, Math.hypot(dx, dy, dz), st); };
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const i = r * cols + k;
      if (k + 1 < cols) link(i, i + 1, 1);
      if (r + 1 < rows) link(i, i + cols, 1);
      if (r + 1 < rows && k + 1 < cols) { link(i, i + cols + 1, .6); link(i + 1, i + cols, .6); }
      if (o.bend !== 0 && k + 2 < cols) link(i, i + 2, o.bend ?? .3);
      if (o.bend !== 0 && r + 2 < rows) link(i, i + cols * 2, o.bend ?? .3);
    }
    return {cols, rows, n, P, O: P.slice(), P0: P.slice(), N: new Float32Array(n * 3), U, V: Vv, D: Dd, pin, L: Float32Array.from(L),
      k: o.k, flut: o.flut ?? 1, waves: o.waves ?? 1, freq: o.freq ?? 2, seed: R() * TAU, iters: o.iters ?? 3, damp: o.damp ?? .985,
      minY: o.minY ?? null, pat: o.pat || (() => 0), outline: o.outline || 'in', fray: !!o.fray, rope: o.rope ?? null, pinFn: o.pinFn || null,
      SX: new Float32Array(n), SY: new Float32Array(n), ZT: new Float32Array(n), LM: new Float32Array(n), lam0: NaN, wind0: 0};
  }
  function normals(pc) {
    const {P, N, cols, rows} = pc;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const i = r * cols + k, a = (r * cols + Math.min(cols - 1, k + 1)) * 3, b = (r * cols + Math.max(0, k - 1)) * 3;
      const c = (Math.min(rows - 1, r + 1) * cols + k) * 3, d = (Math.max(0, r - 1) * cols + k) * 3;
      const ux = P[a] - P[b], uy = P[a + 1] - P[b + 1], uz = P[a + 2] - P[b + 2], vx = P[c] - P[d], vy = P[c + 1] - P[d + 1], vz = P[c + 2] - P[d + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      N[i * 3] = nx / l; N[i * 3 + 1] = ny / l; N[i * 3 + 2] = nz / l;
    }
  }
  function simPiece(pc, h, wx, wy, g, lift = 0) {
    const {P, O, pin, n, D, U, N} = pc, k = pc.k, damp = pc.damp, h2 = h * h, ih = 1 / h;
    const fl = pc.flut * (TUNE.clothIdle + g) * TUNE.clothV * Math.hypot(pc.nx, pc.ny, .25);
    if (pc.pinFn) pc.pinFn(pc);
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      if (pin[i]) { O[j] = P[j]; O[j + 1] = P[j + 1]; O[j + 2] = P[j + 2]; P[j] = pc.P0[j]; P[j + 1] = pc.P0[j + 1]; P[j + 2] = pc.P0[j + 2]; continue; }
      const vx = (P[j] - O[j]) * damp, vy = (P[j + 1] - O[j + 1]) * damp, vz = (P[j + 2] - O[j + 2]) * damp;
      const f = fl * D[i] * Math.sin(TAU * (D[i] * pc.waves - T * pc.freq) + U[i] * 1.3 + pc.seed);
      const ax = k * (wx - vx * ih) + f * N[j], ay = k * (wy - vy * ih) + f * N[j + 1], az = lift * D[i] - 9.8 - k * vz * ih + f * N[j + 2];
      O[j] = P[j]; O[j + 1] = P[j + 1]; O[j + 2] = P[j + 2];
      P[j] += vx + ax * h2; P[j + 1] += vy + ay * h2; P[j + 2] += vz + az * h2;
    }
    const L = pc.L, m = L.length;
    for (let it = 0; it < pc.iters; it++) {
      for (let l = 0; l < m; l += 4) {
        const a = L[l] * 3, b = L[l + 1] * 3, wa = pin[L[l]] ? 0 : 1, wb = pin[L[l + 1]] ? 0 : 1, w = wa + wb; if (!w) continue;
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2], d = Math.hypot(dx, dy, dz) || 1e-6;
        const q = (d - L[l + 2]) / d * L[l + 3] / w;
        if (wa) { P[a] += dx * q; P[a + 1] += dy * q; P[a + 2] += dz * q; }
        if (wb) { P[b] -= dx * q; P[b + 1] -= dy * q; P[b + 2] -= dz * q; }
      }
      if (pc.minY !== null) for (let i = 0; i < n; i++) if (P[i * 3 + 1] < pc.minY) P[i * 3 + 1] = pc.minY;
    }
    for (let i = 0; i < n; i++) if (P[i * 3 + 2] < .03) P[i * 3 + 2] = .03;
    if (pc.cols > 1 && pc.rows > 1) normals(pc);
  }
  function kick(pc, vx, vy, vz, sc = 1) {   // add a velocity (m/s over one 1/60 s step) to the free nodes
    for (let i = 0; i < pc.n; i++) if (!pc.pin[i]) { const j = i * 3, f = sc * (.4 + .6 * pc.D[i]) / 60; pc.O[j] -= vx * f; pc.O[j + 1] -= vy * f; pc.O[j + 2] -= vz * f; }
  }

  // ---------------------------------------------------------------- static decor sprites (poles, rods, lanterns)
  function paint(w, h, fn) {
    const c = mk(w, h), q = c.getContext('2d'), im = q.createImageData(c.width, c.height), d = new Uint32Array(im.data.buffer);
    fn((x, y, col) => { x = Math.round(x); y = Math.round(y); if (col && x >= 0 && y >= 0 && x < w && y < h) d[y * w + x] = typeof col === 'number' ? col : rgba(col); });
    q.putImageData(im, 0, 0); return c;
  }
  // a wooden post, 3 px: lit-side outline (shade), base, dark outline; a metal cap; pivot = bottom centre
  function postSprite(R, M, hPx, {arm = 0, knob = true} = {}) {
    const w = 3 + (arm ? arm + 1 : 0), hh = hPx + 2;
    const img = paint(w, hh, put => {
      for (let y = 2; y < hh; y++) { put(0, y, R[2]); put(1, y, y < 5 ? R[0] : R[1]); put(2, y, R[3]); }
      if (knob) { put(0, 1, M[1]); put(1, 1, M[0]); put(2, 1, M[3]); put(1, 0, M[1]); }
      put(0, hh - 1, R[3]); put(1, hh - 1, R[3]);
      if (arm) {   // an arm to the east with a brace and a hook at its tip
        for (let x = 3; x < w; x++) { put(x, 3, R[1]); put(x, 4, R[3]); }
        put(w - 1, 3, M[1]); put(w - 1, 4, M[3]); put(w - 1, 5, M[3]);
        for (let k = 0; k < 5; k++) put(3 + k, 10 - k, R[2]);
      }
    });
    return {img, px: 1, py: hh - 1};
  }
  function metalPole(M, hPx) {   // 2 px mast with a finial; pivot = bottom (left px)
    const img = paint(3, hPx + 3, put => {
      for (let y = 3; y < hPx + 3; y++) { put(0, y, M[1]); put(1, y, M[3]); }
      put(0, 2, M[0]); put(1, 2, M[2]); put(0, 1, M[0]); put(1, 1, M[1]); put(2, 1, M[3]); put(0, 0, M[1]);
    });
    return {img, px: 0, py: hPx + 2};
  }
  function rodSprite(R, M, wPx) {   // a horizontal rod with knobs; pivot = its left end, top row
    const img = paint(wPx + 2, 3, put => {
      for (let x = 1; x <= wPx; x++) { put(x, 0, R[1]); put(x, 1, R[3]); }
      for (const x of [0, wPx + 1]) { put(x, 0, M[0]); put(x, 1, M[2]); }
      put(1, 2, R[3]); put(wPx, 2, R[3]);
    });
    return {img, px: 1, py: 0};
  }
  function lanternSprites(pal) {
    const M = pal.metal, col = {O: M[3], h: M[0], b: M[1], s: M[2], G: pal.glass[1], g: pal.glass[0]};
    const body = paint(7, 8, put => LANTERN.forEach((row, y) => [...row].forEach((ch, x) => put(x, y, col[ch]))));
    const glow = [0, 1].map(f => paint(7, 8, put => LANTERN.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === 'g') put(x, y, pal.glow[0]); else if (ch === 'G') put(x, y, f && (x + y) % 3 === 0 ? pal.glow[0] : pal.glow[1]);
    }))));
    return {body, glow};
  }

  // ---------------------------------------------------------------- decor items
  let decor = [], needDecor = true, lanterns = [];
  const ramp = a => a.map(rgba);
  function emblemPx(kind, du, dv) {   // du, dv: px from the emblem centre -> 0 none, 1 trim colour, 2 emissive glyph
    const E = EMBLEM[kind], gx = Math.floor(du + 2.5), gy = Math.floor(dv + 2.5);
    if (!E || gx < 0 || gy < 0 || gx > 4 || gy > 4 || E[gy][gx] !== '#') return 0;
    return kind === 'rune' ? 2 : 1;
  }
  // banner pattern: hem + side borders in trim, an emblem, a swallowtail (or a point / a ragged ember hem)
  function bannerPat(pal, wPx, lPx, {point = false, band = false} = {}) {
    const E = pal.emblem, rime = pal.rime;
    return (u, v) => {
      if (pal.fray) { if (v > .8 + .14 * hsh(Math.round(u * wPx), 7)) return -1; }
      else if (point) { if (v > .8 && Math.abs(u - .5) > (1 - v) / .2 * .5) return -1; }
      else if (v > .8 && Math.abs(u - .5) < (v - .8) / .2 * .28) return -1;
      if (rime && (v < .05 || (v < .3 && hsh(Math.round(u * wPx), Math.round(v * lPx), 3) > .86))) return 1 + 128;
      if (v < .08 || u < .08 || u > .92) return 1;
      if (band && v > .16 && v < .2) return 1;
      const e = emblemPx(E, (u - .5) * wPx, (v - (band ? .5 : .42)) * lPx);
      return e === 2 ? 64 : e ? 1 : 0;
    };
  }
  function wallBanner(x, yFace, pal) {
    const w = .5, len = .9, top = 1.12, wPx = w * ctx.PPM, lPx = len * ctx.PPMH;
    const pc = grid({cols: 5, rows: 8, org: [x - w / 2, yFace + .03, top], ax: [w, 0, 0], ay: [0, 0, -len], pin: r => r === 0,
      k: .75, flut: .5, waves: .8, freq: 1.4, minY: yFace + .02, pat: bannerPat(pal, wPx, lPx), fray: pal.fray});
    const rod = rodSprite(pal.wood, pal.metal, Math.round(wPx) + 2);
    return item('banner', x, yFace + .06, [pc], {front: [[rod, x - w / 2 - .05, yFace + .03, top + .02]]}, pal);
  }
  function standard(x, y, pal) {   // a freestanding banner pole with a crossbar (flanking the east gate)
    const H = 2.45, w = .5, len = 1.05, wPx = w * ctx.PPM, lPx = len * ctx.PPMH, bar = H - .12;
    const pc = grid({cols: 5, rows: 9, org: [x - w / 2, y + .06, bar - .03], ax: [w, 0, 0], ay: [0, 0, -len], pin: r => r === 0,
      k: .9, flut: .6, waves: .8, freq: 1.3, minY: y + .045, pat: bannerPat(pal, wPx, lPx, {point: true, band: true}), fray: pal.fray});
    const post = postSprite(pal.wood, pal.metal, Math.round(H * ctx.PPMH)), rod = rodSprite(pal.wood, pal.metal, Math.round(wPx) + 4);
    return item('standard', x, y + .08, [pc], {back: [[post, x, y, 0]], front: [[rod, x - w / 2 - .09, y + .06, bar]], shadow: [x, y]}, pal);
  }
  function pennant(tp, pal) {   // on a mast on top of a tower
    const sp = host.spriteOf(tp); if (!sp) return null;
    const hTop = (tp.z || 0) + (sp.pivot[1] - TUNE.towerTop) / ctx.PPMH, mast = 1.05, len = .78, hgt = .3, top = hTop + mast - .05;
    const wPx = len * ctx.PPM;
    const pc = grid({cols: 6, rows: 3, org: [tp.x + .04, tp.y + .01, top], ax: [len, 0, 0], ay: [0, 0, -hgt], pin: (r, k) => k === 0,
      k: 4.5, flut: 1.4, waves: .9, freq: 2.2, bend: .45, dist: u => u,
      pat: (u, v) => {
        if (Math.abs(v - .5) > .5 * (1 - u * .94)) return -1;
        if (pal.fray && u > .72 && hsh(Math.round(u * wPx), Math.round(v * 9), 5) > .6) return -1;
        if (pal.rime && Math.abs(v - .5) > .5 * (1 - u * .94) - .12 && u < .5) return 1 + 128;
        return u < .15 ? 1 : 0;
      }, fray: pal.fray});
    const pole = metalPole(pal.metal, Math.round(mast * ctx.PPMH));
    return item('pennant', tp.x, tp.y + .02, [pc], {back: [[pole, tp.x, tp.y + .01, hTop]]}, pal);
  }
  function flagString(A, Bp, pal) {   // prayer flags on a sagging rope between two poles
    if (Bp.x < A.x) [A, Bp] = [Bp, A];   // west -> east: the flags face the camera
    const H = 2.55, len = Math.hypot(Bp.x - A.x, Bp.y - A.y), N = Math.max(6, Math.round(len / .38) + 1);
    const rope = grid({cols: N, rows: 1, org: [A.x, A.y, H], ax: [Bp.x - A.x, Bp.y - A.y, 0], ay: [0, 0, 0], sag: .24, pin: (r, k, c) => k === 0 || k === c - 1,
      k: .8, flut: .15, iters: 6, bend: .05, rope: rgba(pal.rope), dist: u => 4 * u * (1 - u)});
    const pieces = [rope], dx = (Bp.x - A.x) / len, dy = (Bp.y - A.y) / len, fw = .2, fh = .27, nF = Math.floor((len - .7) / .4);
    for (let i = 0; i < nF; i++) {
      const t = (.35 + (i + .5) * (len - .7) / nF) / len, ci = pal.flags[i % pal.flags.length];
      const fx = A.x + (Bp.x - A.x) * t - dx * fw / 2, fy = A.y + (Bp.y - A.y) * t - dy * fw / 2;
      const pc = grid({cols: 3, rows: 3, org: [fx, fy, H], ax: [dx * fw, dy * fw, 0], ay: [0, 0, -fh], pin: r => r === 0, k: 3, flut: 1.1, waves: .6, freq: 2.6, iters: 2, bend: 0,
        pat: (u, v) => pal.rime && v < .12 ? 3 + 128 : 0, fray: false});
      pc.ramp0 = ci; pc.at = [t - fw / 2 / len, t + fw / 2 / len];
      pc.pinFn = q => {   // the top edge rides on the rope
        for (let k = 0; k < 3; k++) {
          const tt = q.at[0] + (q.at[1] - q.at[0]) * k / 2, f = tt * (rope.cols - 1), a = Math.min(rope.cols - 2, Math.floor(f)), e = f - a;
          for (let c = 0; c < 3; c++) q.P0[k * 3 + c] = rope.P[a * 3 + c] * (1 - e) + rope.P[(a + 1) * 3 + c] * e - (c === 2 ? .02 : 0);
        }
      };
      pieces.push(pc);
    }
    const pole = postSprite(pal.wood, pal.metal, Math.round((H + .05) * ctx.PPMH));
    const it = item('flags', (A.x + Bp.x) / 2, (A.y + Bp.y) / 2, pieces, {}, pal);
    it.span = [A, Bp]; it.poles = []; it.groups = pieces.map(pc => ({pieces: [pc], box: null}));
    for (const Q of [A, Bp]) {   // each pole is its own sortable at its foot (a pole shared by two ropes is drawn once)
      const key = Q.x.toFixed(2) + ',' + Q.y.toFixed(2); if (poleKeys.has(key)) continue; poleKeys.add(key);
      const spr = [pole, Q.x, Q.y, 0];
      it.poles.push({y: Q.y, draw: g => { const t0 = performance.now(); shadowAt(g, Q.x, Q.y); blit(g, spr); tick(t0); }});
    }
    return it;
  }
  function strips(dp, pal) {   // cloth strips tied to a target dummy's arm (and a short one on the other arm now and then)
    const out = [], rift = biome === 'rift', arms = rift ? [[9, .9, .42]] : [[11, .87, .46]];
    if (!rift && hsh(dp.x * 10 | 0, dp.y * 10 | 0) > .45) arms.push([-11, .87, .3]);
    for (const [ox, oh, len] of arms) {
      const pc = grid({cols: 2, rows: 6, org: [dp.x + ox / ctx.PPM, dp.y + .02, (dp.z || 0) + oh], ax: [.07, 0, 0], ay: [0, 0, -len], pin: r => r === 0,
        k: 3.2, flut: 1.2, waves: .7, freq: 2.4, bend: .4, outline: 'out', pat: (u, v) => pal.rime && v < .15 ? 1 + 128 : 0});
      pc.ramp0 = pal.strip;
      pc.pinFn = q => { const wob = dp.wob ? Math.round(Math.sin(dp.wob * 18) * dp.wob * 2) / ctx.PPM : 0;
        for (let k = 0; k < 2; k++) { q.P0[k * 3] = dp.x + ox / ctx.PPM + wob + k * .07 - .035; q.P0[k * 3 + 1] = dp.y + .02; q.P0[k * 3 + 2] = (dp.z || 0) + oh; } };
      out.push(pc);
    }
    const it = item('strips', dp.x, dp.y + .02, out, {}, pal);
    it.dummy = dp; return it;
  }
  function lantern(x, y, pal, i) {
    const H = 1.9, arm = .42, chain = .28, px = Math.round(arm * ctx.PPM), hPx = Math.round(H * ctx.PPMH);
    const post = postSprite(pal.wood, pal.metal, hPx, {arm: px}), spr = lanternSprites(pal);
    // the chain hangs from the hook pixel under the arm's tip (sprite column px + 3, row 5; pivot column 1, bottom row hPx + 1)
    const L = {x, y, H, ax: x + (px + 2.5) / ctx.PPM, az: (hPx - 5) / ctx.PPMH, chain, bx: 0, by: 0, bz: 0, ox: 0, oy: 0, oz: 0, spr, id: 7700 + i, pal, ph: R() * TAU};
    L.bx = L.ox = L.ax; L.by = L.oy = y; L.bz = L.oz = L.az - chain;
    const it = item('lantern', x, y, [], {back: [[post, x, y, 0]], shadow: [x, y]}, pal);
    it.lantern = L; lanterns.push(L); return it;
  }
  function item(kind, x, y, pieces, o, pal) {
    const it = {kind, x, y, sy: y, pieces, back: o.back || [], front: o.front || [], shadow: o.shadow || null, pal,
      ramps: {}, groups: [{pieces, box: null}], rastered: false, rT: -1, emit: null, lantern: null, span: null, dummy: null, active: false, wx: 0, wy: 0, g: 0};
    for (const k of ['main', 'trim', 'alt', 'blue']) if (pal[k]) it.ramps[k] = ramp(pal[k]);
    it.so = {y, draw: g => drawItem(it, g)};
    for (const pc of pieces) { pc.nx = 0; pc.ny = 0; normals(pc); }
    return it;
  }
  const poleKeys = new Set();
  function buildDecor() {
    needDecor = false; decor = []; lanterns = []; poleKeys.clear();
    const pal = PAL[biome] || PAL.ruins, PLAY = ctx.PLAY, props = host.props, marks = ctx.layout?.marks || [];
    const cx = (PLAY.x0 + PLAY.x1) / 2, cy = (PLAY.y0 + PLAY.y1) / 2;
    const add = it => { if (it) decor.push(it); };
    s = 777;
    for (const x of [cx - 3.2, cx + 3.2]) add(wallBanner(x, PLAY.y0, pal));          // flanking the north gate, on the wall's inner face
    for (const y of [cy - 1.85, cy + 1.85]) add(standard(PLAY.x1 + 1.2, y, pal));    // flanking the east gate, trail side
    for (const p of props) if (p.kind === 'tower') add(pennant(p, pal));
    // prayer flags across the trail east of the stream: from a pole on each branch of the fork to a shared pole between them
    const paths = marks.filter(m => m.type === 'path');
    if (paths.length) {
      const F = paths[0].pts[Math.min(2, paths[0].pts.length - 1)], C = {x: F[0] + 4.2, y: F[1] + 1.4};
      add(flagString({x: F[0] + .1, y: F[1] - 1.8}, C, pal));
      if (paths.length > 1) add(flagString({x: F[0] + 1.2, y: F[1] + 4.2}, C, pal));
      // lanterns along the path: out of the east gate, on the north-east branch, on the south-east branch
      const P0 = paths[0].pts, P1 = paths[1]?.pts;
      let li = 0;
      add(lantern(P0[0][0] + 3.5, P0[0][1] - 1.1, pal, li++));
      if (P0.length > 4) add(lantern(P0[3][0] + (P0[4][0] - P0[3][0]) * .5, P0[3][1] + (P0[4][1] - P0[3][1]) * .5 + 1.2, pal, li++));
      if (P1 && P1.length > 2) add(lantern(P1[1][0] + (P1[2][0] - P1[1][0]) * .65 + .5, P1[1][1] + (P1[2][1] - P1[1][1]) * .65 - .7, pal, li++));
    }
    for (const p of props) if (p.kind === 'dummy' && p.target) add(strips(p, pal));
    for (let i = 0; i < 90; i++) stepDecor(1 / 60, true);   // settle: hang still before the first frame
  }
  function visItem(it, V) { const x = it.dummy ? it.dummy.x : it.x, y = it.dummy ? it.dummy.y : it.y; return x > V.x0 - 3 && x < V.x1 + 3 && y > V.y0 - 1 && y < V.y1 + 3; }
  let simAcc = 0, nSim = 0;
  function stepDecor(dt, all = false, V = null) {
    const nx0 = [0, 0];
    for (const it of decor) {
      it.active = all || !V || visItem(it, V);
      if (!it.active) continue;
      const ax = it.dummy ? it.dummy.x : it.x, ay = it.dummy ? it.dummy.y : it.y, a = field(ax, ay), VR = vref();
      it.g = a.g; nx0[0] = a.x / VR * B.sway; nx0[1] = a.y / VR * B.sway;
      const lift = B.pulse ? a.g * TUNE.riftLift : 0;   // the rift's rings make cloth float up a little as they pass
      for (const pc of it.pieces) { pc.nx = nx0[0]; pc.ny = nx0[1]; simPiece(pc, dt, pc.nx * TUNE.clothV, pc.ny * TUNE.clothV, a.g, lift); nSim++; }
      if (it.lantern) stepLantern(it.lantern, dt, nx0[0] * TUNE.clothV, nx0[1] * TUNE.clothV);
    }
  }
  function stepLantern(L, h, wx, wy) {   // a pendulum: one Verlet node on a fixed-length chain
    const k = 1.1, vx = (L.bx - L.ox) * .99, vy = (L.by - L.oy) * .99, vz = (L.bz - L.oz) * .99, ih = 1 / h;
    L.ox = L.bx; L.oy = L.by; L.oz = L.bz;
    L.bx += vx + k * (wx - vx * ih) * h * h; L.by += vy + k * (wy - vy * ih) * h * h; L.bz += vz + (-9.8 - k * vz * ih) * h * h;
    const dx = L.bx - L.ax, dy = L.by - L.y, dz = L.bz - L.az, d = Math.hypot(dx, dy, dz) || 1e-6;
    L.bx = L.ax + dx / d * L.chain; L.by = L.y + dy / d * L.chain; L.bz = L.az + dz / d * L.chain;
  }

  // ---------------------------------------------------------------- raster (per group box, world px)
  // an item's pieces are rastered in groups, each into its own small box (a string of prayer flags = the rope + one box
  // per flag: small boxes upload little when a few pixels change)
  function rasterItem(it) { for (const grp of it.groups) rasterGroup(it, grp); it.rastered = true; }
  function rasterGroup(it, grp) {
    const {PPM, PPMY, PPMH} = ctx;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const pc of grp.pieces) {
      const {P, SX, SY, ZT} = pc;
      for (let i = 0; i < pc.n; i++) {
        const j = i * 3, X = P[j] * PPM, Y = P[j + 1] * PPMY - P[j + 2] * PPMH;
        SX[i] = X; SY[i] = Y; ZT[i] = P[j + 1] * SP_ + P[j + 2] * CP;
        if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
      }
    }
    if (x0 > x1) return;
    const bx = Math.floor(x0) - 2, by = Math.floor(y0) - 2, bw = Math.ceil(x1) - bx + 3, bh = Math.ceil(y1) - by + 3;
    let b = grp.box;
    if (!b || b.CW < bw || b.CH < bh) {
      const CW = Math.max(bw, b?.CW || 0) + 8, CH = Math.max(bh, b?.CH || 0) + 8, cv = mk(CW, CH), buf = new Uint32Array(CW * CH);
      b = grp.box = {CW, CH, cv, q: cv.getContext('2d'), buf, prev: new Uint32Array(CW * CH), im: new ImageData(new Uint8ClampedArray(buf.buffer), CW, CH),
        tone: new Int8Array(CW * CH), rid: new Uint8Array(CW * CH), fl: new Uint8Array(CW * CH), dd: new Uint8Array(CW * CH), zb: new Float32Array(CW * CH),
        rmin: new Int16Array(CH), rmax: new Int16Array(CH),   // per row: the span that has cloth (the colour pass only walks these)
        ebuf: null, eprev: null, ecv: null, eq: null, eim: null, x: 0, y: 0, w: 0, h: 0, any: false, eany: false};
    }
    const {CW, tone, rid, fl, dd, zb, buf, rmin, rmax} = b;
    for (let y = 0; y < bh; y++) { const o = y * CW; tone.fill(-1, o, o + bw); zb.fill(-1e9, o, o + bw); }
    rmin.fill(32767, 0, bh); rmax.fill(-1, 0, bh);
    const RAMP_IDS = RID(it);
    for (const pc of grp.pieces) {
      const {SX, SY, ZT, LM, N, U, V, D, cols, rows} = pc;
      if (pc.rope !== null) {   // a rope: 1 px Bresenham between the nodes
        for (let i = 0; i + 1 < pc.n; i++) line(Math.round(SX[i]) - bx, Math.round(SY[i]) - by, Math.round(SX[i + 1]) - bx, Math.round(SY[i + 1]) - by, (x, y) => {
          if (x < 0 || y < 0 || x >= bw || y >= bh) return; const j = y * CW + x; tone[j] = 9; zb[j] = ZT[i]; if (x < rmin[y]) rmin[y] = x; if (x > rmax[y]) rmax[y] = x; });
        continue;
      }
      for (let i = 0; i < pc.n; i++) {   // vertex tone value against the top-left light (camera space)
        const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        LM[i] = nx * LR + (-CP * ny + SP_ * nz) * LU + (SP_ * ny + CP * nz) * LT;
      }
      if (pc.lam0 !== pc.lam0) {   // rest tone + winding: the first raster (the piece hangs at rest after the settle)
        let sum = 0; for (let i = 0; i < pc.n; i++) sum += LM[i]; pc.lam0 = sum / pc.n;
        const i = 0, a = 1, c = cols + 1; pc.wind0 = Math.sign((SY[a] - SY[c]) * (SX[i] - SX[c]) + (SX[c] - SX[a]) * (SY[i] - SY[c])) || 1;
      }
      const r0 = RAMP_IDS[pc.ramp0 || 'main'] ?? 0, mode = pc.outline === 'out' ? 2 : 0, fray = pc.fray ? 4 : 0;
      const tri = (i0, i1, i2) => {
        const ax = SX[i0] - bx, ay = SY[i0] - by, bx2 = SX[i1] - bx, by2 = SY[i1] - by, cx = SX[i2] - bx, cy = SY[i2] - by;
        const den = (by2 - cy) * (ax - cx) + (cx - bx2) * (ay - cy); if (Math.abs(den) < 1e-6) return;
        const back = Math.sign(den) !== pc.wind0;
        const xa = Math.max(0, Math.floor(Math.min(ax, bx2, cx))), xb = Math.min(bw - 1, Math.ceil(Math.max(ax, bx2, cx)));
        const ya = Math.max(0, Math.floor(Math.min(ay, by2, cy))), yb = Math.min(bh - 1, Math.ceil(Math.max(ay, by2, cy)));
        for (let y = ya; y <= yb; y++) { let lo = 32767, hi = -1; for (let x = xa; x <= xb; x++) {
          const px = x + .5, py = y + .5;
          const l0 = ((by2 - cy) * (px - cx) + (cx - bx2) * (py - cy)) / den, l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, l2 = 1 - l0 - l1;
          if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) continue;
          const j = y * CW + x, z = l0 * ZT[i0] + l1 * ZT[i1] + l2 * ZT[i2]; if (z < zb[j]) continue;
          const u = l0 * U[i0] + l1 * U[i1] + l2 * U[i2], v = l0 * V[i0] + l1 * V[i1] + l2 * V[i2];
          const code = pc.pat(u, v); if (code < 0) continue;
          let lam = l0 * LM[i0] + l1 * LM[i1] + l2 * LM[i2]; if (back) lam = -lam;   // the lining: its own side faces us
          const dl = lam - pc.lam0;
          let t = dl > .17 ? 0 : dl < -.15 ? 2 : 1; if (back) t = Math.min(2, t + 1);
          const ri = (code & 31) === 0 ? r0 : (code & 31) === 1 ? RAMP_IDS.trim : (code & 31) === 3 ? RAMP_IDS.trim : r0;
          if (code & 128) t = 0;
          zb[j] = z; tone[j] = t; rid[j] = ri; fl[j] = (code & 64 ? 1 : 0) | mode | fray; dd[j] = Math.round(clamp(l0 * D[i0] + l1 * D[i1] + l2 * D[i2], 0, 1) * 255);
          if (x < lo) lo = x; if (x > hi) hi = x;
        } if (lo < rmin[y]) rmin[y] = lo; if (hi > rmax[y]) rmax[y] = hi; }
      };
      for (let r = 0; r + 1 < rows; r++) for (let k = 0; k + 1 < cols; k++) { const i = r * cols + k; tri(i, i + 1, i + cols + 1); tri(i, i + cols + 1, i + cols); }
    }
    // colours: selective outline (bottom / right edge = darkest, top / left edge = shade), 'out' pieces get it outside
    const ramps = it.rampList, pal = it.pal, crust = rgba(pal.crust || '#000000'), ropeC = rgba(pal.rope);
    const emb = pal.fray ? pal.ember.map(rgba) : pal.rune ? pal.rune.map(rgba) : null;
    let eany = false; const E = emb ? ensureEmit(b) : null;
    const fr = Math.floor(T * 5);
    for (let y = 0; y < bh; y++) {
      const o = y * CW; buf.fill(0, o, o + bw); if (E) E.fill(0, o, o + bw);
      const xa = Math.max(0, Math.min(rmin[y], y > 0 ? rmin[y - 1] : 32767) - 1), xb = Math.min(bw - 1, Math.max(rmax[y], y > 0 ? rmax[y - 1] : -1) + 1);
      for (let x = xa; x <= xb; x++) {
      const j = o + x, t = tone[j];
      if (t < 0) {   // empty: an exterior outline for thin pieces (strips) on their shadow side
        const lj = x > 0 ? j - 1 : -1, uj = y > 0 ? j - CW : -1;
        const src = lj >= 0 && tone[lj] >= 0 && tone[lj] !== 9 && fl[lj] & 2 ? lj : uj >= 0 && tone[uj] >= 0 && tone[uj] !== 9 && fl[uj] & 2 ? uj : -1;
        buf[j] = src >= 0 ? ramps[rid[src]][3] : 0;
        continue;
      }
      if (t === 9) { buf[j] = ropeC; continue; }
      const f = fl[j], R4 = ramps[rid[j]];
      const eR = x + 1 >= bw || tone[j + 1] < 0, eD = y + 1 >= bh || tone[j + CW] < 0, eL = x === 0 || tone[j - 1] < 0, eU = y === 0 || tone[j - CW] < 0;
      let tt = t;
      if (!(f & 2)) { if (eR || eD) tt = 3; else if (eL || eU) tt = Math.max(t, 2); }
      buf[j] = R4[tt];
      if (E && (f & 1)) { E[j] = emb[(x + y + fr) % 3 === 0 ? 0 : 1]; buf[j] = R4[2]; eany = true; }   // rift rune glyph: dim in the albedo, glows
      else if (E && (f & 4) && eD && dd[j] > 170) {   // ember: the ragged hem smoulders
        buf[j] = crust; E[j] = emb[hsh(x + b.x, y, fr) < .3 ? 0 : hsh(x + b.x, y + 1, fr) < .6 ? 1 : 2]; eany = true;
      }
    } }
    // upload only if a pixel changed
    let same = b.x === bx && b.y === by && b.w === bw && b.h === bh;
    if (same) { const P = b.prev; outer: for (let y = 0; y < bh; y++) { const o = y * CW; for (let x = 0; x < bw; x++) if (P[o + x] !== buf[o + x]) { same = false; break outer; } } }
    if (!same) { b.q.putImageData(b.im, 0, 0, 0, 0, bw, bh); b.prev.set(buf); }
    if (E && eany) {   // the emit canvas is exactly the box (lighting reads the emitter's img size)
      if (b.ecv.width !== bw || b.ecv.height !== bh) { b.ecv.width = bw; b.ecv.height = bh; }
      b.eq.putImageData(b.eim, 0, 0, 0, 0, bw, bh);
    }
    b.eany = eany; b.x = bx; b.y = by; b.w = bw; b.h = bh; b.any = true;
  }
  function ensureEmit(b) {
    if (!b.ebuf || b.ebuf.length !== b.buf.length) { b.ebuf = new Uint32Array(b.CW * b.CH); b.ecv = mk(1, 1); b.eq = b.ecv.getContext('2d'); b.eim = new ImageData(new Uint8ClampedArray(b.ebuf.buffer), b.CW, b.CH); }
    return b.ebuf;
  }
  function RID(it) {   // ramp name -> index into it.rampList
    if (it.rid) return it.rid;
    it.rampList = []; it.rid = {};
    for (const k of Object.keys(it.ramps)) { it.rid[k] = it.rampList.length; it.rampList.push(it.ramps[k]); }
    return it.rid;
  }
  function line(x0, y0, x1, y1, fn) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    for (let n = 0; n < 400; n++) { fn(x0, y0); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  let camC = {x: 0, y: 0};
  const vx = (x, h, y) => Math.round(x * ctx.PPM - camC.x);
  const vy = (y, h) => Math.round(y * ctx.PPMY - h * ctx.PPMH - camC.y);
  function blit(g, [S, x, y, h]) { g.drawImage(S.img, vx(x) - S.px, vy(y, h) - S.py); }
  function shadowAt(g, x, y) {   // a small contact shadow at a pole's foot (the host's blob-shadow colour)
    const X = vx(x), Y = vy(y, 0); g.fillStyle = 'rgba(12,16,10,.38)'; g.fillRect(X - 2, Y, 5, 1); g.fillRect(X - 1, Y + 1, 3, 1);
  }
  function drawItem(it, g) {
    const t0 = performance.now();
    if (it.shadow) for (let i = 0; i < it.shadow.length; i += 2) shadowAt(g, it.shadow[i], it.shadow[i + 1]);
    for (const b of it.back) blit(g, b);
    for (const grp of it.groups) { const B2 = grp.box; if (B2 && B2.any) g.drawImage(B2.cv, 0, 0, B2.w, B2.h, B2.x - camC.x, B2.y - camC.y, B2.w, B2.h); }
    for (const b of it.front) blit(g, b);
    const L = it.lantern;
    if (L) {   // chain + body
      const X0 = vx(L.ax), Y0 = vy(L.y, L.az), X1 = Math.round(L.bx * ctx.PPM - camC.x), Y1 = Math.round(L.by * ctx.PPMY - L.bz * ctx.PPMH - camC.y);
      g.fillStyle = L.pal.metal[3]; line(X0, Y0, X1, Y1, (x, y) => g.fillRect(x, y, 1, 1));
      g.drawImage(L.spr.body, X1 - 3, Y1);
      L.vx = X1 - 3; L.vy = Y1;
    }
    tick(t0);
  }

  // ================================================================ particles (shaken out of foliage)
  const parts = [];
  function spawnPart(o) { if (parts.length < 180) parts.push(o); }
  function shed(p, n, why) {
    const S = SHED[biome]; if (!S) return;
    const sp = host.spriteOf?.(p), hTop = sp ? sp.pivot[1] / ctx.PPMH : .6, z = p.z || 0, tree = p.kind === 'tree';   // sprite top above the ground point
    const a = field(p.x, p.y);
    for (let i = 0; i < n; i++) {
      const h = z + (tree ? hTop * (.35 + R() * .5) : hTop * (.45 + R() * .45)), ox = (R() - .5) * (tree ? 1.6 : .6);
      const base = {x: p.x + ox, y: p.y + .02 + (R() - .5) * .1, h, t: 0, sy: p.y + .03, ph: R() * TAU, rest: 0};
      if (S.kind === 'leaf') spawnPart({...base, kind: 'leaf', pal: S.pals[R() * S.pals.length | 0], vx: (R() - .5) * 1.4 + a.x * .6, vy: (R() - .5) * .5, vh: why === 'arrow' ? .6 + R() * .8 : R() * .3, life: 9, g: 1.4});
      else if (S.kind === 'snow') spawnPart({...base, kind: 'snow', pal: S.pal, vx: (R() - .5) * 1.6 + a.x * .8, vy: (R() - .5) * .6, vh: .4 + R() * 1.1, life: .5 + R() * .45, g: 6});
      else if (S.kind === 'spark') {
        if (R() < .6) spawnPart({...base, kind: 'spark', pal: S.pal, emit: true, vx: (R() - .5) * .9 + a.x * .5, vy: (R() - .5) * .3, vh: .5 + R() * .9, life: .6 + R() * .7, g: -.35});
        else spawnPart({...base, kind: 'ash', pal: S.ash, vx: (R() - .5) * .8 + a.x * .5, vy: (R() - .5) * .3, vh: .2 + R() * .4, life: 1.2 + R() * .8, g: .8});
      } else spawnPart({...base, kind: 'mote', pal: S.pal, emit: true, vx: (R() - .5) * .5, vy: (R() - .5) * .3, vh: .15 + R() * .35, life: 1 + R() * .9, g: -.08});
    }
  }
  function gustShed(p) {   // a gust front hits: snow blows off frost pines / bushes, a leaf leaves a ruins tree now and then
    if (biome === 'frost' && (p.kind === 'tree' || p.kind === 'bush') && R() < .75) shed(p, p.kind === 'tree' ? 3 + (R() * 3 | 0) : 1 + (R() * 2 | 0), 'gust');
    else if (biome === 'ruins' && p.kind === 'tree' && (p.variant | 0) !== 2 && R() < .5) shed(p, 1, 'gust');
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.t += dt;
      if (q.rest > 0) { q.rest -= dt; if (q.rest <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); } continue; }
      if (q.t >= q.life) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      const a = field(q.x, q.y);
      if (q.kind === 'leaf') {   // flutters down, drifts with the wind
        q.vh += (-.45 - q.vh) * Math.min(1, dt * 2.2); q.vx += (a.x * .9 + Math.sin(q.t * 3.1 + q.ph) * .5 - q.vx) * Math.min(1, dt * 2); q.vy += (a.y * .6 - q.vy) * Math.min(1, dt * 2);
      } else { q.vh -= q.g * dt; const d = Math.exp(-dt * (q.kind === 'snow' ? 2.4 : 1.4)); q.vx = q.vx * d + a.x * (1 - d) * .8; q.vy *= d; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt;
      const gnd = host.elev ? host.elev(q.x, q.y) : 0;
      if (q.h <= gnd) {
        if (q.kind === 'leaf' && !(host.inStream && gnd === 0 && host.inStream(q.x, q.y))) { q.h = gnd; q.rest = 1.2 + R() * 1.2; q.restMax = q.rest; }
        else { parts[i] = parts[parts.length - 1]; parts.pop(); }
      }
    }
  }
  function partColour(q) {
    const n = q.pal.length;
    if (q.kind === 'leaf') return q.rest > 0 ? q.pal[q.rest / q.restMax > .5 ? 1 : 2] : q.pal[0];
    if (q.kind === 'mote') { const k = Math.min(q.t / .4, (q.life - q.t) / .5); return q.pal[k >= 1 ? 0 : k > .5 ? 1 : 2]; }
    return q.pal[Math.min(n - 1, Math.floor(q.t / q.life * n))];
  }
  function drawParts(g, sy) {
    const t0 = performance.now();
    for (const q of parts) {
      if (q.emit || q.sy !== sy) continue;
      const x = Math.round(q.x * ctx.PPM - camC.x), y = Math.round(q.y * ctx.PPMY - q.h * ctx.PPMH - camC.y);
      if (x < -2 || y < -2 || x > ctx.VW + 1 || y > ctx.VH + 1) continue;
      g.fillStyle = partColour(q);
      if (q.kind === 'leaf' && !(q.rest > 0)) { const f = (T * 3 + q.ph * 4) & 3; if (f === 0) g.fillRect(x, y, 2, 1); else if (f === 2) g.fillRect(x, y, 1, 2); else g.fillRect(x, y, 1, 1); }
      else if (q.kind === 'leaf') g.fillRect(x, y, 2, 1);
      else g.fillRect(x, y, q.kind === 'snow' && q.t < q.life * .3 ? 2 : 1, 1);
    }
    tick(t0);
  }
  // ONE view-sized emitter layer for everything of ours (lantern glass, smouldering hems, runes, sparks, motes), the same
  // shape as atmos.js's: the host's lighting adds a view-sized emitter directly (its per-emitter mask pass keeps only
  // the overlap of several small emitters, see the report), so small separate emitters would vanish
  const EL = {cv: mk(1, 1), q: null};
  EL.q = EL.cv.getContext('2d');
  function emitLayer() {
    const {VW, VH} = ctx, q = EL.q;
    if (EL.cv.width !== VW || EL.cv.height !== VH) { EL.cv.width = VW; EL.cv.height = VH; q.imageSmoothingEnabled = false; } else q.clearRect(0, 0, VW, VH);
    let any = false;
    const V = viewRect(), fr = (T * 6) | 0;
    for (const it of decor) {
      if (!visItem(it, V)) continue;
      for (const grp of it.groups) { const b = grp.box; if (b && b.eany) { q.drawImage(b.ecv, b.x - camC.x, b.y - camC.y); any = true; } }
      const L = it.lantern; if (L && L.vx !== undefined) { q.drawImage(L.spr.glow[(fr + (L.id & 1)) % 5 === 0 ? 1 : 0], L.vx, L.vy); any = true; }
    }
    for (const p of parts) if (p.emit) {
      const x = Math.round(p.x * ctx.PPM - camC.x), y = Math.round(p.y * ctx.PPMY - p.h * ctx.PPMH - camC.y);
      if (x < 0 || y < 0 || x >= VW || y >= VH) continue;
      q.fillStyle = partColour(p); q.fillRect(x, y, 1, 1); any = true;
    }
    return any;
  }

  // ================================================================ events: arrows through foliage, dummy hits, blasts
  const shook = new WeakMap();   // arrow -> Set of props it already shook
  function arrowsThroughFoliage(V) {
    const arrows = host.arrows || [];
    for (const a of arrows) {
      if (a.stuck || a.life <= -9) continue;
      for (const p of folList()) {
        if (p.kind === 'tuft' || p.x < V.x0 || p.x > V.x1 || p.y < V.y0 || p.y > V.y1) continue;
        const F = flexOf(p); if (!F) continue;
        const [r, hMax] = p.kind === 'tree' ? TUNE.arrowTree : TUNE.arrowBush, z = p.z || 0;
        if (Math.hypot(a.x - p.x, (a.y - p.y) * 1.3) > r || a.h < z + (p.kind === 'tree' ? .9 : 0) || a.h > z + hMax) continue;
        let S = shook.get(a); if (!S) shook.set(a, S = new Set()); if (S.has(p)) continue; S.add(p);
        const st = fst.get(p); if (st) { st.shake = 1; st.v += Math.sign(a.vx || 1) * 30; }
        shed(p, p.kind === 'tree' ? 4 + (R() * 3 | 0) : 3 + (R() * 3 | 0), 'arrow');
      }
    }
  }
  function onEvents(evs) {
    for (const e of evs || []) {
      if (e.type === 'hit' && e.prop && e.prop.kind === 'dummy') {   // the strips jump with the hit
        const v = Math.hypot(e.vx || 0, e.vy || 0) || 1;
        for (const it of decor) if (it.dummy === e.prop) for (const pc of it.pieces) kick(pc, (e.vx || 0) / v * 1.6, (e.vy || 0) / v * 1.2, .8, 1);
      } else if (e.type === 'explode') {   // a blast wave: foliage whips, cloth billows away from it
        const r = (e.r || 2.4) * 2.5;
        for (const p of folList()) {
          const d = Math.hypot(p.x - e.x, p.y - e.y), st = fst.get(p); if (!st || d > r) continue;
          st.v += Math.sign(p.x - e.x || 1) * 90 * (1 - d / r); st.shake = Math.max(st.shake, .6 * (1 - d / r));
        }
        for (const it of decor) {
          const d = Math.hypot(it.x - e.x, it.y - e.y); if (d > r * 1.4) continue;
          const k = 3 * (1 - d / (r * 1.4)), ux = (it.x - e.x) / (d || 1), uy = (it.y - e.y) / (d || 1);
          for (const pc of it.pieces) kick(pc, ux * k, uy * k, k * .5);
          if (it.lantern) { it.lantern.ox -= ux * k / 60; it.lantern.oy -= uy * k / 60; }
        }
      }
    }
  }

  // ================================================================ view helpers
  function viewRect(margin = 0) {
    const c = camNow(), {PPM, PPMY, VW, VH} = ctx;
    return {x0: c.x / PPM - 2 - margin, x1: (c.x + VW) / PPM + 2 + margin, y0: c.y / PPMY - 1 - margin, y1: (c.y + VH) / PPMY + 5.5 + margin};
  }

  // ================================================================ public
  const EMPTY = [], SO = [], partSO = new Map(), flameSO = new Map();
  function drawFlame(g, p) {   // same spot as the host's prop draw: sprite top-left = rounded ground point - pivot
    const c = flames.get(p), sp = c && host.spriteOf(p); if (!sp || sp.emit !== c.src) return;
    const t0 = performance.now(), wob = p.wob ? Math.round(Math.sin(p.wob * 18) * p.wob * 2) : 0;
    const X = Math.round(p.x * ctx.PPM - camC.x), Y = Math.round(p.y * ctx.PPMY - ((p.z || 0) + (p.h || 0)) * ctx.PPMH - camC.y);
    g.drawImage(c.cv, X - sp.pivot[0] + wob, Y - sp.pivot[1]);
    tick(t0);
  }
  Object.assign(W, {
    toggle() { W.on = !W.on; if (!W.on) { W.gust = 0; parts.length = 0; } return W.on; },
    setBiome(id) {
      biome = id; B = BIOME[id] || BIOME.ruins; seedField(); needDecor = true;
      fst.clear(); flames.clear(); femit.clear(); parts.length = 0;
    },
    setTime(name) { timeName = name; },
    update(dt, evs) {
      const t0 = performance.now();
      W.ms = W.ms * .95 + acc * .05; acc = 0;
      dt = Math.min(.05, Math.max(0, dt || 0));
      if (!W.on) { W.gust = 0; tick(t0); return; }
      T += dt;
      if (needDecor && host.props && ctx.PLAY) buildDecor();
      stepField(dt);
      const P = host.P; W.gust = P ? field(P.x, P.y).g : 0;
      const V = viewRect();
      if (P) { stepFoliage(dt, V); arrowsThroughFoliage(V); }
      onEvents(evs);
      simAcc = Math.min(simAcc + dt, 3 / 60); nSim = 0;
      while (simAcc >= 1 / 60 - 1e-6) { stepDecor(1 / 60, false, V); simAcc -= 1 / 60; }
      stepParts(dt);
      tick(t0);
    },
    at(x, y) { if (!W.on) return {x: 0, y: 0, g: 0}; const a = field(x, y); return {x: a.x, y: a.y, g: a.g}; },
    drawProp, emitOf,
    sortables(cam) {
      if (!W.on || needDecor) return EMPTY;
      const t0 = performance.now(); camC = cam || camNow(); SO.length = 0;
      const V = viewRect(), rast = T - (W._rT ?? -1) >= 1 / TUNE.clothFps - 1e-6;
      if (rast) W._rT = T;
      const Px = host.P?.x ?? 0;
      for (const it of decor) {
        if (!visItem(it, V)) continue;
        if (rast || !it.rastered) rasterItem(it);
        if (it.span) {   // the rope sorts at its own depth where the player is (walk under it from either side)
          const [A, Bp] = it.span, t = clamp((Px - A.x) / ((Bp.x - A.x) || 1), 0, 1); it.so.y = A.y + (Bp.y - A.y) * t;
        }
        SO.push(it.so);
        if (it.poles) for (const so of it.poles) SO.push(so);   // poles sort at their own feet
      }
      if (TUNE.flameAlbedo) for (const p of host.props) {   // the live flame painted into the scene, right over its brazier / torch
        if ((p.kind !== 'brazier' && p.kind !== 'torch') || p.x < V.x0 || p.x > V.x1 || p.y < V.y0 || p.y > V.y1) continue;
        const c = flames.get(p); if (!c || c.step < 0) continue;
        let so = flameSO.get(p); if (!so) flameSO.set(p, so = {y: p.y + 1e-3, draw: g => drawFlame(g, p)});
        SO.push(so);
      }
      if (parts.length) {
        for (const q of parts) if (!q.emit && !partSO.has(q.sy)) partSO.set(q.sy, {y: q.sy, draw: g => drawParts(g, q.sy)});
        for (const [sy, so] of partSO) { if (parts.some(q => !q.emit && q.sy === sy)) SO.push(so); else partSO.delete(sy); }
      }
      tick(t0); return SO;
    },
    lights() {
      if (!W.on || needDecor) return EMPTY;
      const V = viewRect(4), out = [];
      for (const L of lanterns) if (L.x > V.x0 && L.x < V.x1 && L.y > V.y0 && L.y < V.y1)
        out.push({x: L.bx, y: L.by, h: L.bz - .12, color: L.pal.light, radius: 3, intensity: .8, flicker: .3, id: L.id});
      return out;
    },
    emitters(cam) {
      if (!W.on || needDecor) return EMPTY;
      const t0 = performance.now(); camC = cam || camNow();
      const out = emitLayer() ? [{img: EL.cv, x: 0, y: 0}] : EMPTY;
      tick(t0); return out;
    },
    cloth() {
      const P = host.P; if (!W.on || !P) return null;
      const a = field(P.x, P.y), C = B.cloth;
      if (B.pulse) return {wind: [a.x * C[1] / (B.gust || 1) + .05, a.y * C[1] / (B.gust || 1)], gust: .2};
      const v = C[0] + a.g * C[1]; return {wind: [UX * v, UY * v], gust: .3};
    },
    atmosGust() {
      if (!W.on) return null;
      const c = camNow(); return field((c.x + ctx.VW / 2) / ctx.PPM, (c.y + ctx.VH / 2) / ctx.PPMY).g;
    },
    gustNow(A = 1) {   // test: a strong front just west of the view
      const c = camNow(), x = c.x / ctx.PPM - 3, y = (c.y + ctx.VH / 2) / ctx.PPMY;
      if (B.pulse) { fronts.push({...newPulse(), A}); return; }
      const f = newFront(x * UX + y * UY, A); f.tc = -x * UY + y * UX; f.half = 40; fronts.push(f);
    },
    info: () => ({fronts: fronts.length, decor: decor.length, parts: parts.length, simulated: nSim, foliage: fst.size, T: +T.toFixed(2)}),
    _dbg: () => ({decor, fronts, parts, fst, lanterns, viewRect}),
  });
  return W;
}
