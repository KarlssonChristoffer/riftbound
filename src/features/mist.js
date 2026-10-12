// MIST (view): the world's low mist and the far haze, in the world instead of on the screen.
// THE VOLUME (the default since 2026-10-07; render/mistvol.js draws it): the mist is air with something in it, marched along every
// view ray: a film over all the ground, the hollows filled to a share of their depth, banks rising off the water, broken into banks
// and billows by a drifting 3D noise, lit by the sun where its shadow maps say so (trees and walls cast lanes through it), by the
// ambient, the lamps and the lightning, cut into flat levels and tones. Here: the FIELD it reads (bakeField: the ground's height,
// how deep a hollow lies there, how near water is and its height, a top-down map of the world baked when the world is built: no
// per-frame CPU pixel work) and its numbers by the clock, the weather, the wind and the biome (TUNE.vol; computeVol). The old
// sheet's veil is then off (G.setMist still lays the far haze: max under everything). ?mist=flat: the old sheet below, an A/B.
// THE OLD SHEET (?mist=flat): A layer of mist lies LOW: its top is a
// height that pools it in the hollows (the south ravine, floor -3.5 m; the stream's channel and a little of its banks, the pool's basin,
// the creek; the West Downs' hollows between their hills, at dawn and dusk) while flat open ground and the plateau's top (2.4 m) stay
// clear (fog weather alone covers them); the view looks down
// through it to the ground (gfx.js COMP_FS MIST: flat hard levels, dithered only along the edge between two, the pattern fixed to the
// world). Its amount follows the world clock (sim/env.js: the hour, the weather):
// morning mist over the water from ~5 that burns off by noon, thicker again at dusk and through the night; fog, rain, snow and storms
// raise it, a strong wind thins it. It drifts with the wind (features/wind.js at the view's centre), stepped a world texel at a time.
// Its colour is the mood's light (host.mood: the ambient it scatters, cooled, plus the mood's haze: blue-grey at night, warm at dawn
// and dusk); the lamps light it round them. The far haze (lighting.js's fog, uFog) is laid by how far back the GROUND under a pixel
// lies instead of by its screen row, and leans a little toward the mist's colour (aerial).
// TWO LIGHTS (render/lighting.js; wx-A): while the weather changes over the view (env.lightSides().two: a front, a deck breaking)
// the mist under the deck is the under side's weather's and lit by its light, the rest the open side's (the sun's): the volume
// gets both sides' amounts and colours (OV, OV.under) and render/mistvol.js mixes them per pixel by the clouds' under share, as
// the composite mixes the light; the sheet's (and the far haze's) colour likewise (O.col, O.col2). Under a storm the mist reads
// as its dark slate rain haze, in a sun gap as the sun's. One light: as before (env.sky's amounts, host.mood's colour), bit for bit.
// SHOW ONLY: nothing here changes how the game plays. ?mist=0 starts off (the old screen-space haze: an A/B); F.toggle().
// OWNS: its TUNE, the drift, the water's stretches (rebuilt when the world is). READS: host.env (hour, sky, lightSides, moodFor), host.mood, host.biome,
// host.layout (stream, pool, outflow, rill, brook), host.world (waterH), host.elev, host.wind (at), host.G (view, setMist).
// WRITES: G.setMist, every frame it shows (gfx.js owns the uniforms; lighting.js keeps uFog).
// THE MEDIUM: F.medium (0..1, this frame) and G.mist.medium: how thick the air is overall, for light through it (god rays); in
// COMP_FS, mistAt(P) is the local density (the medium, more inside the mist). F.at(x, y, h) -> the mist's veil there on the CPU
// (0..1, without the noise: a reading for other systems, not the drawn pixel). BUDGET: ~0.01 ms a frame (the shader: ~0.05 ms).
import {flags} from '../core/flags.js';
import {clamp, smooth, lerp} from '../core/mathx.js';
import {WORLD, TERRAIN_ON, terrainField} from '../world/layout.js';   // (the field's bounds: the world's; its ground: the bare terrain)

export const TUNE = {
  levels: 3, dither: .9,       // the veil's hard levels (flat), and how far either side of the edge between two it is dithered (art px)
  alpha: .6,                   // the thickest level's opacity
  sigma: .75,                  // how fast the veil thickens per metre of mist the view looks down through (1 / m)
  noise: {amp: .3, freq: .17},    // the top's wander (m) and its scale (1 / m): banks and wisps (steep enough that a bank's edge is crisp)
  drift: .14,                  // the mist drifts at this share of the wind's speed
  shade: .1,                   // how much a shadow on the ground dims the mist over it (it scatters the sky's light, so a shadow under it only greys it)
  light: 1,                    // the lamps light the mist round them (a share of their pool: 1, so a veil over a lamplit spot glows, never dims it)
  aerial: .012,                // the far haze leans toward the mist's colour, up to this at the view's top edge
  far: .4,                     // the share of lighting's fog (uFog) laid as the far haze (1: the old screen haze's strength)
  reach: 1.4,                  // m of bank the mist over the water reaches
  // through the day: [hour, the top over open ground (m: the ground lies at 0; kept under it, wander included, so flat ground stays
  // clear and only the hollows hold it: the ravine, the stream's channel, the pool's basin), the rise over the water (m above it: low
  // banks at dawn, a breath at night), x alpha (a clear noon leaves the ravine a haze, not a fill)], eased between
  day: [[0, -.35, .45, 1], [4, -.32, .55, 1], [5.5, -.32, .9, 1], [7.5, -.35, .95, 1], [9, -.45, .7, .9], [10.5, -.6, .35, .75], [12, -.85, .1, .6],
    [16.5, -.85, .1, .6], [18.5, -.5, .35, .85], [20, -.38, .45, 1], [22, -.35, .45, 1], [24, -.35, .45, 1]],
  // the weather on top (sim/env.js sky channels 0..1): m added to the top and to the rise over the water, and to sigma / alpha
  sky: {fog: [1.3, .5, .25, .04], rain: [.25, .3, .1, .03], storm: [.1, .1, 0, 0], snow: [.25, 0, .1, .03], cloud: [.08, .1, 0, 0]},
  windThin: .18,               // m off the top per wind level over a brisk breeze (1.2): a gale clears the meadows
  // per biome: top (m added), water (x the rise: 0 = none, ember's lava, the rift's void), fog (x the weather's response), sigma (x)
  biome: {
    ruins: {top: 0, water: 1, fog: 1, sigma: 1},
    frost: {top: .1, water: .8, fog: 1, sigma: 1},
    ember: {top: -.3, water: 0, fog: .55, sigma: .8},
    rift: {top: .15, water: 0, fog: 1, sigma: 1.1},
    desert: {top: -.5, water: .35, fog: .3, sigma: .7},
  },
  // the colour: the ambient light it scatters (x amb), a little greyed (grey: toward its luminance), cooled (tint), plus the mood's haze
  // colour (x fog): pale blue-white by day, peach at dawn and dusk, blue-grey at night
  col: {amb: .95, grey: .35, tint: [.93, .98, 1.05], fog: 1,
    // then paler: this share of the way to its own lightness x lift in a cool white (the mood's tint stays a hint, the veil reads
    // as mist, not dust), faded in over the lightness dim (the night's blue-grey mist keeps its colour)
    pale: .7, lift: 1.3, white: [.97, .99, 1.03], dim: [.3, .6]},
};
// THE VOLUME's numbers (render/mistvol.js: what each does is said there)
TUNE.vol = {
  res: .5, pad: 4,             // the field's texel (m) and its margin round the world (m)
  close: 8,                    // m: a hollow is what the ground closed over this radius fills (a dip narrower than twice it: the ravine,
                               // the stream's channel, the West Downs' dips; not the open land beside a hill)
  reach: 1.6,                  // m of bank the water's mist spills over
  sigma: 1.2,                  // 1 / m at density 1
  filmH: .45,                  // the film's height (m: it thins upward over about this)
  rise: .9,                    // m the mist over the water rises
  scale: .11, stretch: 4,      // the noise's scale (1 / m: banks ~7 m apart, billows ~2 m) and its stretch along the wind (wisps)
  wisp: [1, .3],               // the way the wisps lie (world x, z): FIXED (the noise turning with the gusting wind turned the whole field
                               // about the world's origin: whole banks jumped); the drift still follows the wind
  churn: .025, churnHz: 4,     // the noise turns over this many units a second, in steps this often (the shapes change, never slide)
  band: 4, steps: 12,          // the most air marched over a pixel (m up) and the steps along it
  g: .55,                      // forward scattering (0 none .. 1 all toward the sun)
  deep: .6,                    // the light deep in the mist (x its light at its top): tops bright, depths dim
  amax: .7, levels: 4, seam: .1, tones: 2, billow: 1,   // the look: the most opacity, its levels, the dithered seam, the sunlit tones, the billows' contrast
  lamp: .25, lampR: .55, lampMax: .3,   // the lamps: the share of their light the mist takes, over this share of their radius, at most this
  tone: .7, grey: .45,         // its colour: the ambient light x tone, this share of the way to grey (a veil in the scene's own light, not white)
  sun: [.26, .24, .2], lobe: 1.6,   // the sun it scatters (x the sun's colour and strength), up to lobe x that looking toward the sun
  airCarry: .35, airReach: 2.4, airSmoke: .6,    // THE AIR (render/air.js): the noise carried this many s of its velocity, how high up its
                               // CLEAR thins the mist (m), its SMOKE's density as mist
  bright: .7,                  // never lighter than this (its colour's luminance): a veil, not a light
  // AT NIGHT (eased in as the ambient light dims from lum dark[0] to dark[1]: dusk into night, a black storm part way) the mist
  // catches light: the moon's colour on its tops instead of the sun's warm one (x moon), a moonlit sheen on all of it (x the
  // moon's colour), and the lamps, torches, muzzle flashes and blasts light it round them (lamp, lampR, lampMax as above), in
  // glowTones flat rings. By day a veil the light passes through; at night what it shows of the air (a blast's bubble, a shot's
  // channel, a runner's wake) has to be lit to be seen
  night: {dark: [.6, .3], moon: .45, sheen: .05, lamp: .9, lampR: .6, lampMax: .4, glowTones: 3},
  // through the day: [hour, the film (density), the hollows' fill (share of their depth), the water's (density), the banks' cover (0..1)]
  day: [[0, .2, .55, .75, .38], [4, .22, .6, .85, .42], [5.5, .36, .75, 1, .47], [7.5, .36, .78, 1, .47], [9, .2, .55, .7, .38],
    [10.5, .07, .28, .32, .3], [12, 0, .08, .06, .2], [16.5, 0, .08, .06, .2], [18.5, .17, .45, .45, .37], [20, .21, .55, .7, .38],
    [22, .2, .55, .75, .38], [24, .2, .55, .75, .38]],
  // the weather on top (sim/env.js sky channels 0..1): added to the film, the fill, the water, the cover
  sky: {fog: [.7, .45, .4, .4], rain: [.15, .15, .2, .1], storm: [.05, .05, 0, 0], snow: [.15, .1, .05, .1], cloud: [.05, .05, .05, .05]},
  windThin: .12,               // the cover lost per wind level over a brisk breeze (1.2): a gale tears the banks apart
  // per biome: x the film, x the fill, x the water (ember's lava, the rift's void: none)
  biome: {ruins: [1, 1, 1], frost: [1.1, 1, .8], ember: [.3, .5, 0], rift: [1.1, 1, 0], desert: [.25, .4, .35]},
};
const MAX_SEG = 16, SKY = Object.keys(TUNE.sky);   // (gfx.js MIST_N)

// ORDER (core/features.js): frame only (it reads the wind's field as this frame's step left it)
export const order = {after: ['wind']};
export async function create(host) {
  const G = host.G;
  if (!G.setMist) return {name: 'mist', on: false};
  const VOL = flags.get('mist') !== 'flat' && !!G.setMistVol;   // the volume (render/mistvol.js); else the old flat sheet
  const F = {name: 'mist', label: 'Mist (world fog)', ambient: true, on: flags.get('mist') !== '0', TUNE, medium: 0, ms: 0, vol: VOL,
    toggle() { F.on = !F.on; }};
  // ---- the water's stretches (segments with a half width and their water's height), rebuilt when the world is
  const SEG = new Float32Array(MAX_SEG * 8); let nSeg = 0, ver = 0, segWorld = null, segBiome = '', wdA = 0, wdB = 0;   // (wdA..wdB: the West Downs' hollows)
  function put(x0, z0, x1, z1, hw, h) { if (nSeg >= MAX_SEG) return; const j = nSeg++ * 8; SEG[j] = x0; SEG[j + 1] = z0; SEG[j + 2] = x1; SEG[j + 3] = z1; SEG[j + 4] = hw; SEG[j + 5] = h; }
  function along(C, n, hOf) {   // a curve's pts / hw in n stretches
    const P = C?.pts; if (!P || P.length < 2) return;
    for (let k = 0; k < n; k++) {
      const a = Math.floor(k * (P.length - 1) / n), b = Math.floor((k + 1) * (P.length - 1) / n), m = (a + b) >> 1;
      put(P[a][0], P[a][1], P[b][0], P[b][1], C.hw ? C.hw[m] : .4, hOf(P[a][0], P[a][1], P[b][0], P[b][1]));
    }
  }
  function buildWater() {
    nSeg = 0; ver++; segWorld = host.world; segBiome = host.biome.id;
    const L = host.layout, wh = host.world?.waterH ?? -.18;
    if (!L || !(TUNE.biome[segBiome] || TUNE.biome.ruins).water) return;
    const S = L.stream;
    if (S) for (let y = S.y0; y < S.y1 - .01; y += 4) { const y1 = Math.min(S.y1, y + 4); put(S.cx(y), y, S.cx(y1), y1, S.w((y + y1) / 2) / 2, wh); }
    const Pl = L.pool; if (Pl && Pl.rx) { const e = Math.max(0, Pl.rx - Pl.ry); put(Pl.x - e, Pl.y, Pl.x + e, Pl.y, Pl.ry, wh); }
    along(L.outflow, 1, () => wh * .5);
    // the West Downs (world/westland.js): two wide stretches over their hollows at the ground's own height (0), so the mist rises there
    // as it does over the water: banks filling the hollows between the hills at dawn and dusk (the hilltops and the oaks stand out of
    // it), a breath at night, gone by midday
    const wd = L.west; wdA = nSeg; if (wd) { put(wd.x0 - 4, 8.5, wd.x1 - 2.5, 8.5, 7, 0); put(wd.x0 - 4, 20.5, wd.x1 - 2.5, 20.5, 6, 0); } wdB = nSeg;
    // their brook (world/brook.js): four stretches down it at its water's height (its bed, not elev: a stretch's end may lie under the bridge's deck)
    const bk = L.brook; if (bk) for (let k = 0, m = Math.round(bk.fallL / bk.ds); k < 4; k++) {
      const a = Math.round(k * m / 4), b = Math.round((k + 1) * m / 4);
      put(bk.px[a], bk.py[a], bk.px[b], bk.py[b], bk.hw[(a + b) >> 1], Math.min(bk.bed[a], bk.bed[b]) - .03);
    }
    along(L.rill, MAX_SEG - nSeg, (x0, z0, x1, z1) => Math.min(host.elev(x0, z0), host.elev(x1, z1)) - .05);   // (the creek down the mesa's gully: each stretch at its lower end)
  }
  // ---- THE FIELD (the volume's): a top-down map of the world at TUNE.vol.res m a texel: (the ground's height, the hollow's depth
  // there, how near water is 0..1, that water's height), baked when the world is (no per-frame work)
  function bakeField() {
    const V = TUNE.vol, res = V.res, x0 = WORLD.x0 - V.pad, z0 = WORLD.y0 - V.pad;
    const w = Math.ceil((WORLD.x1 - WORLD.x0 + 2 * V.pad) / res) + 1, h = Math.ceil((WORLD.y1 - WORLD.y0 + 2 * V.pad) / res) + 1, n = w * h;
    const H = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    // (the bare terrain, not host.elev: a bridge's deck or the tower's floors aren't ground the mist lies on; it fills under them)
    const TF = TERRAIN_ON ? terrainField() : null;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = TF ? TF.H(x0 + i * res, z0 + j * res) : host.elev(x0 + i * res, z0 + j * res);
    // the hollows: the ground CLOSED over V.close m (dilated, then eroded: a dip narrower than twice it fills to its rims), less the ground
    const r = Math.max(1, Math.round(V.close / res));
    const pass = (src, dst, dx, dy, mx) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        let m = mx ? -1e9 : 1e9;
        for (let k = -r; k <= r; k++) { const a = Math.min(w - 1, Math.max(0, i + k * dx)), b = Math.min(h - 1, Math.max(0, j + k * dy)), v = src[b * w + a]; m = mx ? Math.max(m, v) : Math.min(m, v); }
        dst[j * w + i] = m;
      }
    };
    pass(H, A, 1, 0, true); pass(A, B, 0, 1, true); pass(B, A, 1, 0, false); pass(A, B, 0, 1, false);
    const data = new Float32Array(n * 4);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i, x = x0 + i * res, y = z0 + j * res;
      let near = 0, wh = -9;   // the nearest water stretch (the West Downs' hollow stretches left out: they are pools now)
      for (let s = 0; s < nSeg; s++) {
        if (s >= wdA && s < wdB) continue;
        const q = s * 8, ax = SEG[q], az = SEG[q + 1], bx = SEG[q + 2] - ax, bz = SEG[q + 3] - az, px = x - ax, pz = y - az;
        const t = clamp((px * bx + pz * bz) / Math.max(bx * bx + bz * bz, 1e-4), 0, 1), d = Math.hypot(px - bx * t, pz - bz * t) - SEG[q + 4];
        const f = 1 - smooth(clamp(d / V.reach, 0, 1)); if (f > near) { near = f; wh = SEG[q + 5]; }
      }
      data[k * 4] = H[k]; data[k * 4 + 1] = Math.max(0, B[k] - H[k]); data[k * 4 + 2] = near; data[k * 4 + 3] = wh;
    }
    G.mistField({x0, z0, w, h, res, data});
  }
  // ---- the volume's numbers now (into OV): the clock, the weather, the wind, the biome
  const OV = {sigma: 0, film: 0, filmH: 0, fill: 0, water: 0, rise: 0, scale: 0, cover: 0, drift: [0, 0], churn: 0, stretch: 1, wind: [1, 0],
    band: 4, steps: 12, g: .5, deep: .6, shade: [0, 0, 0], lamp: 0, lampR: .55, lampMax: .3, lobe: 1.6, bright: .62, sun: [0, 0, 0], amax: .8, levels: 4, seam: .12, tones: 2, billow: .5,
    under: null};
  // TWO LIGHTS (the header): the under side's amounts and colours (OV.under while two lights show), the sky's amounts (the medium's,
  // at the player's as ever), this frame's lights (LM: the open side's mood, or host.mood with one light; the under side's)
  const OU = {film: 0, fill: 0, water: 0, cover: 0, shade: [0, 0, 0], sun: [0, 0, 0], lamp: 0}, OS = {film: 0, fill: 0, water: 0, cover: 0};
  const LM = {two: false, open: null, under: null, mo: null, mu: null};
  function lights() {
    const E = host.env, sd = E.lightSides ? E.lightSides() : null, two = LM.two = !!(sd && sd.two), b = host.biome.id;
    LM.open = two ? E.moodFor(b, sd.open, LM.mo ||= E.blankMood()) : host.mood;
    LM.under = two ? E.moodFor(b, sd.under, LM.mu ||= E.blankMood()) : null;
    return sd;
  }
  const DV = [0, 0, 0, 0];
  let churnT = 0;
  function dayVol(hr) {
    const D = TUNE.vol.day; let i = 0; while (i < D.length - 2 && hr >= D[i + 1][0]) i++;
    const a = D[i], b = D[i + 1], k = smooth(clamp((hr - a[0]) / (b[0] - a[0]), 0, 1));
    for (let j = 0; j < 4; j++) DV[j] = lerp(a[j + 1], b[j + 1], k);
    return DV;
  }
  // the amounts for a set of weather channels S (into o: film, fill, water, cover), after dayVol
  function volAmounts(S, Bm, o) {
    const V = TUNE.vol;
    let film = DV[0], fill = DV[1], water = DV[2], cover = DV[3];
    for (const c of SKY) { const v = S[c] || 0, k = V.sky[c]; if (!k) continue; film += k[0] * v; fill += k[1] * v; water += k[2] * v; cover += k[3] * v; }
    cover -= V.windThin * Math.max(0, (S.wind ?? 1) - 1.2);
    o.film = Math.max(0, film * Bm[0]); o.fill = clamp(fill * Bm[1], 0, 1); o.water = Math.max(0, water * Bm[2]); o.cover = clamp(cover, 0, 1);
  }
  // its colour in a light M (into o: shade, sun, lamp; returns how far into the night's look it is)
  // its colour: the mood's ambient light, part of the way to grey, x tone, cooled a little (the old sheet's colour was paled toward white);
  // by night the moon's sheen on it, the moon on its tops, the lamps brighter in it (V.night)
  function volColour(M, o) {
    const V = TUNE.vol, am = M.amb, al = am[0] * .3 + am[1] * .55 + am[2] * .15, N = V.night, mc = M.sun.c;
    const nk = smooth(clamp((N.dark[0] - al) / (N.dark[0] - N.dark[1]), 0, 1));
    for (let j = 0; j < 3; j++) {
      o.shade[j] = (am[j] + (al - am[j]) * V.grey) * V.tone * TUNE.col.tint[j] + N.sheen * mc[j] * nk;
      o.sun[j] = lerp(V.sun[j], N.moon * mc[j], nk);
    }
    o.lamp = lerp(V.lamp, N.lamp, nk);
    return nk;
  }
  function computeVol(dt, sd) {
    const V = TUNE.vol, E = host.env, S = E.sky, Bm = V.biome[host.biome.id] || V.biome.ruins, two = LM.two;
    dayVol(E.hour);
    volAmounts(two ? sd.open : S, Bm, OV);
    OV.sigma = V.sigma; OV.filmH = V.filmH; OV.rise = V.rise; OV.scale = V.scale; OV.stretch = V.stretch; OV.band = V.band; OV.steps = V.steps; OV.g = V.g; OV.deep = V.deep;
    OV.amax = V.amax; OV.levels = V.levels; OV.seam = V.seam; OV.tones = V.tones; OV.billow = V.billow; OV.lobe = V.lobe; OV.bright = V.bright;
    const N = V.night, nk = volColour(LM.open, OV);
    OV.lampR = lerp(V.lampR, N.lampR, nk); OV.lampMax = lerp(V.lampMax, N.lampMax, nk); OV.glowTones = N.glowTones;
    if (two) { volAmounts(sd.under, Bm, OU); volColour(LM.under, OU); volAmounts(S, Bm, OS); }   // (TWO LIGHTS: the under side's; the sky's for the medium)
    OV.under = two ? OU : null;
    churnT += dt; OV.churn = Math.floor(churnT * V.churnHz) / V.churnHz * V.churn % 64;
    const A = two ? OS : OV;
    F.medium = O.medium = clamp(.06 + .35 * clamp(A.film + .5 * A.fill, 0, 1) * A.cover * 1.4 + .5 * (S.fog || 0), 0, 1);
  }
  // ---- the day's curve, eased between its keys
  function dayAt(h, o) {
    const D = TUNE.day; let i = 0; while (i < D.length - 2 && h >= D[i + 1][0]) i++;
    const a = D[i], b = D[i + 1], k = smooth(clamp((h - a[0]) / (b[0] - a[0]), 0, 1));
    o[0] = lerp(a[1], b[1], k); o[1] = lerp(a[2], b[2], k); o[2] = lerp(a[3], b[3], k); return o;
  }
  const DAY = [0, 0, 1], WV = {x: 0, y: 0, g: 0};
  const O = {top: 0, sigma: 0, alpha: 0, col: [0, 0, 0], col2: null, light: 0, shade: .35, water: 0, reach: 0, amp: 0, freq: 0, drift: [0, 0], aerial: 0, far: 1,
    levels: 3, dither: .9, medium: 0, max: 0, segs: SEG, n: 0, ver: 0};
  const COL2 = [0, 0, 0];   // (TWO LIGHTS: the under light's colour, O.col2 while two lights show)
  // the colour in a light M (into c): the ambient light, cooled, plus the mood's haze, then paled
  function sheetColour(M, c) {
    const C = TUNE.col, a = M.amb, l = a[0] * .3 + a[1] * .55 + a[2] * .15;
    for (let j = 0; j < 3; j++) c[j] = (a[j] + (l - a[j]) * C.grey) * C.amb * C.tint[j] + M.fog[j] * C.fog;
    const pl = c[0] * .3 + c[1] * .55 + c[2] * .15, pk = C.pale * smooth(clamp((pl - C.dim[0]) / (C.dim[1] - C.dim[0]), 0, 1));
    for (let j = 0; j < 3; j++) c[j] = Math.min(1, lerp(c[j], pl * C.lift * C.white[j], pk));
  }
  let dx = 0, dz = 0;   // the drift (m), stepped to world texels when it is sent
  // the mist's numbers now (into O): the clock, the weather, the biome
  function compute() {
    const E = host.env, B = TUNE.biome[host.biome.id] || TUNE.biome.ruins, S = E.sky, K = TUNE.sky;
    dayAt(E.hour, DAY);
    // (the day's alpha: a noon thins it, but a foggy or rainy noon is as thick as a morning)
    const thick = clamp((S.fog || 0) * B.fog + .5 * (S.rain || 0) + .3 * (S.snow || 0), 0, 1);
    let top = DAY[0] + B.top, water = DAY[1], sig = TUNE.sigma * B.sigma, al = TUNE.alpha * lerp(DAY[2], 1, thick);
    for (let i = 0; i < SKY.length; i++) { const c = SKY[i], v = (S[c] || 0) * (c === 'fog' ? B.fog : 1), k = K[c]; top += k[0] * v; water += k[1] * v; sig += k[2] * v; al += k[3] * v; }
    top -= TUNE.windThin * Math.max(0, (S.wind ?? 1) - 1.2);
    water *= B.water;
    O.top = top; O.water = Math.max(0, water); O.sigma = sig; O.alpha = Math.min(.7, al);
    O.amp = TUNE.noise.amp; O.freq = TUNE.noise.freq; O.reach = TUNE.reach; O.light = TUNE.light; O.shade = TUNE.shade; O.aerial = TUNE.aerial; O.far = TUNE.far;
    O.levels = TUNE.levels; O.dither = TUNE.dither;
    // the highest it reaches (the shader skips what stands above it): the open ground's top + its wander, the water's (the
    // highest water's) + its rise
    let hw = -1e3; for (let i = 0; i < nSeg; i++) hw = Math.max(hw, SEG[i * 8 + 5]);
    O.max = Math.max(top + O.amp + .01, nSeg && O.water > 0 ? hw + O.water * 1.5 + .01 : -1e3);   // (COMP_FS: the rise is .3 .. 1.5 x water)
    O.n = nSeg; O.ver = ver;
    // the colour: the ambient light, cooled, plus the mood's haze (the open light's and the under light's while two show: TWO LIGHTS)
    sheetColour(LM.open, O.col);
    if (LM.two) sheetColour(LM.under, COL2);
    O.col2 = LM.two ? COL2 : null;
    // the medium (for light through the air): a trace in clear air, more as the mist rises, most in fog
    F.medium = O.medium = clamp(.06 + .3 * smooth(clamp((top + .9) / .7, 0, 1)) + .5 * (S.fog || 0) * B.fog + .15 * (S.rain || 0) + .1 * (S.snow || 0), 0, 1);
  }
  F.frame = ({dt}) => {
    const t0 = performance.now(), E = host.env;
    if (!E || !host.biome) return;
    if (host.world !== segWorld || host.biome.id !== segBiome) { buildWater(); if (VOL) bakeField(); }
    const sd = lights();
    compute();
    // the drift: downwind at a share of the wind at the view's centre, sent in whole world texels (the mist steps, never slides)
    const T = G.view.T, w = host.wind;
    if (w?.at && dt > 0) { w.at(T.x, T.z, WV); dx += WV.x * TUNE.drift * dt; dz += WV.y * TUNE.drift * dt; if (Math.abs(dx) > 4e3 || Math.abs(dz) > 4e3) dx = dz = 0; }
    const R = host.PPM, f = O.freq;
    O.drift[0] = -Math.round(dx * R) / R * f; O.drift[1] = -Math.round(dz * R) / R * f;
    if (VOL) {   // the volume: its numbers, the drift in the noise's units (whole world texels), the wind's way; the old sheet's veil off
      computeVol(dt, sd);
      // (the drift in whole world texels, into the noise's frame: along the wisps / stretch, across them)
      const V = TUNE.vol, wl = Math.hypot(V.wisp[0], V.wisp[1]) || 1, wx = V.wisp[0] / wl, wz = V.wisp[1] / wl, ex = Math.round(dx * R) / R, ez = Math.round(dz * R) / R;
      OV.wind[0] = wx; OV.wind[1] = wz;
      OV.drift[0] = -(ex * wx + ez * wz) / V.stretch * V.scale; OV.drift[1] = -(-ex * wz + ez * wx) * V.scale;
      OV.air = G.air; OV.airCarry = V.airCarry; OV.airReach = V.airReach; OV.airSmoke = V.airSmoke;   // (the moving air: docs/exp/air.md)
      G.setMistVol(OV);
      O.max = -1e3;   // (G.setMist below still lays the far haze; COMP_FS draws no veil under -1e3 m)
    }
    G.setMist(O);
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  // the veil at a world point (x, y on the ground, h up), 0..1, as the shader has it but without the noise (a reading for others)
  F.at = (x, y, h) => {
    if (!F.on) return 0;
    let top = O.top;
    for (let i = 0; i < nSeg; i++) {
      const j = i * 8, ax = SEG[j], az = SEG[j + 1], bx = SEG[j + 2] - ax, bz = SEG[j + 3] - az, px = x - ax, pz = y - az;
      const t = clamp((px * bx + pz * bz) / Math.max(bx * bx + bz * bz, 1e-4), 0, 1), d = Math.hypot(px - bx * t, pz - bz * t) - SEG[j + 4];
      const fo = 1 - smooth(clamp(d / O.reach, 0, 1)); top = Math.max(top, SEG[j + 5] + O.water * .9 * fo * fo - 3 * (1 - fo));   // (the shader's rise at its mean)
    }
    return top > h ? 1 - Math.exp(-O.sigma * (top - h)) : 0;
  };
  F.biomeChanged = () => { segWorld = null; };
  F.hud = () => !F.on ? '' : VOL ? `mist (volume) film ${OV.film.toFixed(2)} fill ${OV.fill.toFixed(2)} water ${OV.water.toFixed(2)} cover ${OV.cover.toFixed(2)} medium ${O.medium.toFixed(2)}`
    : `mist top ${O.top.toFixed(2)} water +${O.water.toFixed(2)} medium ${O.medium.toFixed(2)} (${nSeg} stretches)`;
  return F;
}
