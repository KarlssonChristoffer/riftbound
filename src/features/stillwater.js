// STILL WATER (render3d): the weather on the forest's lake. The lake's look is the ground shader's (gfx.js WATER_FS wStill: the cat's
// paws the wind draws, the calm's glassy lines, the lapping shore, the bed on the shallow shelf, rain rings, a fish rising); this file
// only feeds it, through G.setWater({still}), what the sky and the wind are doing over it:
//   wind     the wind at the lake (host.wind.at: its direction and strength, the gust fronts crossing it) sets which way the ripples go,
//            how fast (TUNE.pace texels a second at full wind) and how much of the surface they take; eased, so a gust swells and dies
//   rain     host.env.sky rain / storm: rings all over it
//   fish     rise now and then, most at dawn and dusk, few in the heat of the day or at night, none in a storm or under ice
// A biome without still water (no forest, or setWaterLook gave it no still look) costs one test a view.
// VIEW ONLY: nothing here is read by the sim, no Math.random (the shader's hashes of the texel and the clock decide everything).
//
// FEATURE CONTRACT (main.js): create(host) -> F: view, toggle, ms. ?stillwater=0: the lake's surface holds still (no wind, rain or fish).
// OWNS: its eased wind / travel / clock. READS: host.layout.forest (the lake), host.wind.at, host.env (sky, hour, season), host.G.
// EMITS: nothing. BUDGET: view < .005 ms (a wind sample and one setter a view).
import {flags} from '../core/flags.js';

const TUNE = {
  pace: 9,          // texels a second the ripples travel at full wind (the paws drift at half that)
  windFull: 1,      // m/s of wind at which the lake is all ripples (wind.js: .3 m/s, 1 in a gust, x the level: calm .35, breeze 1, brisk 2.1, gale 3)
  ease: 1.6,        // s to follow the wind (a gust swells over this)
  turn: 4,          // s to follow a change in the wind's direction
  rain: 1, storm: .4,
  fish: {dawn: [4, 8], dusk: [18, 22], peak: .9, day: .3, night: .12},   // hours of the two rises and the share of cells rising then / otherwise
  WRAP: 4608,       // the travel wraps here (gfx.js WATER_FS: every lattice repeats in it)
};
export const order = {after: ['wind']};

export async function create(host) {
  const F = {name: 'stillwater', label: 'Still water (wind, rain and fish on the lake)', ambient: true, on: flags.get('stillwater') !== '0', ms: 0};
  const S = {dir: [1, 0], travel: 0, wind: 0, rain: 0, fish: 0, gust: 0, t: 0}, W = {x: 0, y: 0, g: 0}, ARG = {still: S};   // (preallocated: no garbage a view)
  let dx = 1, dy = 0, wind = 0;
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function fishNow(E) {
    if (!E) return TUNE.fish.day;
    const h = E.hour % 24, f = TUNE.fish, rise = (r) => smooth(r[0], r[0] + 1.5, h) * (1 - smooth(r[1] - 1.5, r[1], h));
    const k = Math.max(rise(f.dawn), rise(f.dusk)), night = h < f.dawn[0] || h > f.dusk[1];
    return (night ? f.night : f.day + (f.peak - f.day) * k) * (1 - (E.sky?.storm || 0)) * (E.season === 'winter' ? .15 : 1);
  }
  F.view = dt => {
    const t0 = performance.now(), L = host.layout?.forest?.lake;
    if (!L || !host.G?.setWater) return;
    S.t = (S.t + dt) % 3600;
    const E = host.env, wf = host.wind;
    if (F.on && wf && wf.on !== false && wf.at) {
      wf.at(L.x, L.y, W);
      const v = Math.hypot(W.x, W.y);
      if (v > .05) {   // its direction eases round (a gust front doesn't spin the ripples); the travel follows the eased direction
        const k = 1 - Math.exp(-dt / TUNE.turn); dx += (W.x / v - dx) * k; dy += (W.y / v - dy) * k;
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      }
      wind += (Math.min(1, v / TUNE.windFull) - wind) * (1 - Math.exp(-dt / TUNE.ease));
      S.gust = W.g || 0;
    } else { wind += (0 - wind) * (1 - Math.exp(-dt / TUNE.ease)); S.gust = 0; }
    S.travel = (S.travel + dt * TUNE.pace * (F.on ? .15 + .85 * wind : 0)) % TUNE.WRAP;
    S.dir[0] = dx; S.dir[1] = dy; S.wind = F.on ? wind : 0;
    const sk = E?.sky;
    S.rain = F.on && sk ? Math.min(1, (sk.rain || 0) * TUNE.rain + (sk.storm || 0) * TUNE.storm) * (1 - Math.min(1, sk.snow || 0)) : 0;
    S.fish = F.on ? fishNow(E) : 0;
    host.G.setWater(ARG);
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  F.toggle = () => { F.on = !F.on; return F.on; };
  return F;
}
