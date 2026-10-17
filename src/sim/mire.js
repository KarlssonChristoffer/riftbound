// MIRE RULES (sim, pure: docs/MIRE.md): what every machine works out about the mire from the seed and the clock, without a
// message: how high its water stands (from the weather's spells: sim/wxclock.js), whether it's frozen (the lake's ice clock:
// sim/ice.js), and each night's wisps (which one is true, where it goes, where the find lies). The browser (features/mire.js)
// and the co-op server (server/room.mjs: a dig is checked against the night's find) read this one file.
//   floodAt(sched, biome, hours, seasonDays) -> 0..1 the water now (the last FLOOD.back hours of spells, stepped)
//   floodStep(f, rain, dtH) -> the water after dtH in-game hours of rain 0..1+ (a storm counts more: FLOOD.storm)
//   frozenAt(hours, seasonDays) -> true while winter's ice holds it
//   nightOf(hours, often) -> the night's number (n: from its dusk) or -1 by day (often: every hour is a night's)
//   createWisps(seed, M) -> {night(n)}: n's wisps {n, find: [x, y], kind (content/mire.js FINDS), lights: [{path: [[x, y], ...],
//     len (m), truth}]}, made once a night (kept: one record)
import {TUNE, findOf} from '../content/mire.js';
import {WEATHER} from './wxclock.js';
import {thickAt} from './ice.js';

const F = TUNE.flood, W = TUNE.wisps;
export function floodStep(f, rain, dtH) {
  return Math.max(0, Math.min(1, f + (rain * F.rise - F.drain) * dtH));
}
export function floodAt(sched, biome, hours, seasonDays) {
  let f = 0;
  for (let h = hours - F.back; h < hours; h += F.step) {
    const w = WEATHER[sched.at(biome, h, seasonDays).w] || WEATHER.fair;
    f = floodStep(f, (w.rain || 0) * (w.storm ? F.storm : 1), F.step);
  }
  return f;
}
export const frozenAt = (hours, seasonDays) => thickAt(hours, seasonDays) > TUNE.frozen.ice;
export function nightOf(hours, often = false) {
  const day = Math.floor(hours / 24), d = hours - day * 24;
  if (often) return d >= W.to ? day : day - 1;
  return d >= W.from ? day : d < W.to ? day - 1 : -1;
}

function rng(seed) { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function createWisps(seed, M) {
  let rec = null;
  const firm = (x, y) => M.k(x, y) > .35 && M.poolQ(x, y) < -.62 && M.softQ(x, y) < .36 && M.walkD(x, y) > 1.2;   // (firm even in a flood: the find never sinks you)
  const inside = (R, test) => { for (let t = 0; t < 80; t++) { const a = R() * Math.PI * 2, q = Math.sqrt(R()) * .85, x = M.x + Math.cos(a) * M.rx * q, y = M.y + Math.sin(a) * M.ry * q; if (test(x, y)) return [+x.toFixed(2), +y.toFixed(2)]; } return [M.x, M.y]; };
  const edgeOf = (R, p) => { const a = R() * Math.PI * 2; return [+(p.x + Math.cos(a) * p.r * .6).toFixed(2), +(p.y + Math.sin(a) * p.r * .6).toFixed(2)]; };
  function night(n) {
    if (rec && rec.n === n) return rec;
    const R = rng(Math.imul(seed | 0, 31) ^ Math.imul(n + 7, 2246822519)), P = M.pools, count = W.n[0] + Math.floor(R() * (W.n[1] - W.n[0] + 1)), truth = Math.floor(R() * count);
    const lights = [];
    for (let i = 0; i < count; i++) {
      const p0 = P[Math.floor(R() * P.length)], path = [p0 ? edgeOf(R, p0) : inside(R, firm)];
      let len = 0;
      if (i === truth) {   // the true one: a winding walk over firm moss, then it stops over the find
        const want = W.walk[0] + R() * (W.walk[1] - W.walk[0]);
        for (let k = 0; k < 24 && len < want; k++) {
          const [lx, ly] = path[path.length - 1], q = inside(R, (x, y) => firm(x, y) && Math.hypot(x - lx, y - ly) > 6 && Math.hypot(x - lx, y - ly) < 14);
          len += Math.hypot(q[0] - lx, q[1] - ly); path.push(q);
        }
      } else {   // a false one: a little way, then into the soft ground and out over the deepest pool it finds
        const q = inside(R, (x, y) => M.softQ(x, y) > .62 && M.poolQ(x, y) < 0), p1 = P[Math.floor(R() * P.length)];
        path.push(q); if (p1) path.push([p1.x, p1.y]);
        for (let k = 1; k < path.length; k++) len += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
      }
      lights.push({path, len, truth: i === truth});
    }
    const T = lights[truth];
    rec = {n, lights, find: T.path[T.path.length - 1], kind: findOf(seed, n)};
    return rec;
  }
  return {night};
}
