// MIST (view): the world's low mist and the far haze, in the world instead of on the screen. A layer of mist lies LOW: its top is a
// height that pools it in the hollows (the south ravine, floor -3.5 m; the stream's channel and a little of its banks, the pool's basin,
// the creek) while flat open ground and the plateau's top (2.4 m) stay clear (fog weather alone covers them); the view looks down
// through it to the ground (gfx.js COMP_FS MIST: flat hard levels, dithered only along the edge between two, the pattern fixed to the
// world). Its amount follows the world clock (sim/env.js: the hour, the weather):
// morning mist over the water from ~5 that burns off by noon, thicker again at dusk and through the night; fog, rain, snow and storms
// raise it, a strong wind thins it. It drifts with the wind (features/wind.js at the view's centre), stepped a world texel at a time.
// Its colour is the mood's light (host.mood: the ambient it scatters, cooled, plus the mood's haze: blue-grey at night, warm at dawn
// and dusk); the lamps light it round them. The far haze (lighting.js's fog, uFog) is laid by how far back the GROUND under a pixel
// lies instead of by its screen row, and leans a little toward the mist's colour (aerial).
// SHOW ONLY: nothing here changes how the game plays. ?mist=0 starts off (the old screen-space haze: an A/B); F.toggle().
// OWNS: its TUNE, the drift, the water's stretches (rebuilt when the world is). READS: host.env (hour, sky), host.mood, host.biome,
// host.layout (stream, pool, outflow, rill), host.world (waterH), host.elev, host.wind (at), host.G (view, setMist).
// WRITES: G.setMist, every frame it shows (gfx.js owns the uniforms; lighting.js keeps uFog).
// THE MEDIUM: F.medium (0..1, this frame) and G.mist.medium: how thick the air is overall, for light through it (god rays); in
// COMP_FS, mistAt(P) is the local density (the medium, more inside the mist). F.at(x, y, h) -> the mist's veil there on the CPU
// (0..1, without the noise: a reading for other systems, not the drawn pixel). BUDGET: ~0.01 ms a frame (the shader: ~0.05 ms).
import {flags} from '../core/flags.js';
import {clamp, smooth, lerp} from '../core/mathx.js';

export const TUNE = {
  levels: 3, dither: .9,       // the veil's hard levels (flat), and how far either side of the edge between two it is dithered (art px)
  alpha: .46,                  // the thickest level's opacity
  sigma: .75,                  // how fast the veil thickens per metre of mist the view looks down through (1 / m)
  noise: {amp: .3, freq: .17},    // the top's wander (m) and its scale (1 / m): banks and wisps (steep enough that a bank's edge is crisp)
  drift: .14,                  // the mist drifts at this share of the wind's speed
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
  col: {amb: .95, grey: .35, tint: [.93, .98, 1.05], fog: 1},
};
const MAX_SEG = 12, SKY = Object.keys(TUNE.sky);

// ORDER (core/features.js): frame only (it reads the wind's field as this frame's step left it)
export const order = {after: ['wind']};
export async function create(host) {
  const G = host.G;
  if (!G.setMist) return {name: 'mist', on: false};
  const F = {name: 'mist', label: 'Mist (world fog)', ambient: true, on: flags.get('mist') !== '0', TUNE, medium: 0, ms: 0,
    toggle() { F.on = !F.on; }};
  // ---- the water's stretches (segments with a half width and their water's height), rebuilt when the world is
  const SEG = new Float32Array(MAX_SEG * 8); let nSeg = 0, ver = 0, segWorld = null, segBiome = '';
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
    along(L.rill, MAX_SEG - nSeg, (x0, z0, x1, z1) => Math.min(host.elev(x0, z0), host.elev(x1, z1)) - .05);   // (the creek down the mesa's gully: each stretch at its lower end)
  }
  // ---- the day's curve, eased between its keys
  function dayAt(h, o) {
    const D = TUNE.day; let i = 0; while (i < D.length - 2 && h >= D[i + 1][0]) i++;
    const a = D[i], b = D[i + 1], k = smooth(clamp((h - a[0]) / (b[0] - a[0]), 0, 1));
    o[0] = lerp(a[1], b[1], k); o[1] = lerp(a[2], b[2], k); o[2] = lerp(a[3], b[3], k); return o;
  }
  const DAY = [0, 0, 1], WV = {x: 0, y: 0, g: 0};
  const O = {top: 0, sigma: 0, alpha: 0, col: [0, 0, 0], light: 0, water: 0, reach: 0, amp: 0, freq: 0, drift: [0, 0], aerial: 0, far: 1,
    levels: 3, dither: .9, medium: 0, max: 0, segs: SEG, n: 0, ver: 0};
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
    O.amp = TUNE.noise.amp; O.freq = TUNE.noise.freq; O.reach = TUNE.reach; O.light = TUNE.light; O.aerial = TUNE.aerial; O.far = TUNE.far;
    O.levels = TUNE.levels; O.dither = TUNE.dither;
    // the highest it reaches (the shader skips what stands above it): the open ground's top + its wander, the water's (the
    // highest water's) + its rise
    let hw = -1e3; for (let i = 0; i < nSeg; i++) hw = Math.max(hw, SEG[i * 8 + 5]);
    O.max = Math.max(top + O.amp + .01, nSeg && O.water > 0 ? hw + O.water * 1.5 + .01 : -1e3);   // (COMP_FS: the rise is .3 .. 1.5 x water)
    O.n = nSeg; O.ver = ver;
    // the colour: the ambient light, cooled, plus the mood's haze
    const M = host.mood, C = TUNE.col;
    const a = M.amb, l = a[0] * .3 + a[1] * .55 + a[2] * .15;
    for (let j = 0; j < 3; j++) O.col[j] = Math.min(1, (a[j] + (l - a[j]) * C.grey) * C.amb * C.tint[j] + M.fog[j] * C.fog);
    // the medium (for light through the air): a trace in clear air, more as the mist rises, most in fog
    F.medium = O.medium = clamp(.06 + .3 * smooth(clamp((top + .9) / .7, 0, 1)) + .5 * (S.fog || 0) * B.fog + .15 * (S.rain || 0) + .1 * (S.snow || 0), 0, 1);
  }
  F.frame = ({dt}) => {
    const t0 = performance.now(), E = host.env;
    if (!E || !host.biome) return;
    if (host.world !== segWorld || host.biome.id !== segBiome) buildWater();
    compute();
    // the drift: downwind at a share of the wind at the view's centre, sent in whole world texels (the mist steps, never slides)
    const T = G.view.T, w = host.wind;
    if (w?.at && dt > 0) { w.at(T.x, T.z, WV); dx += WV.x * TUNE.drift * dt; dz += WV.y * TUNE.drift * dt; if (Math.abs(dx) > 4e3 || Math.abs(dz) > 4e3) dx = dz = 0; }
    const R = host.PPM, f = O.freq;
    O.drift[0] = -Math.round(dx * R) / R * f; O.drift[1] = -Math.round(dz * R) / R * f;
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
  F.hud = () => F.on ? `mist top ${O.top.toFixed(2)} water +${O.water.toFixed(2)} medium ${O.medium.toFixed(2)} (${nSeg} stretches)` : '';
  return F;
}
