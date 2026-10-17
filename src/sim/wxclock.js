// WXCLOCK (sim, pure): the weather as a function of the world's SEED and its CLOCK, so every machine that knows both (each
// co-op client, the co-op server, a page offline) computes the same sky without a message about it (docs/WEATHER.md). No
// imports but the pure basics, no DOM, no node: the browser (sim/env.js) and the server (server/room.mjs) read this one file.
//   spells   the weather wanders from spell to spell: spell n lasts a few in-game hours (TUNE.spell) and is drawn from the
//            biome's climate for the season it starts in (CLIMATE), both from hash3(seed, n, k): nothing is stored, the n-th
//            spell is the same for everyone. The spells run back to back from hour 0 of the world's clock
//   seasons  seasonAt(hours, seasonDays): which season an in-game hour falls in (sim/env.js syncClock's rule, without its blend)
// OWNS: WEATHER (the states and their channels), CLIMATE (which spells each biome and season draws from). READS: nothing.
// BUDGET: at(h) walks forward from where it last was (one hash per spell, ~4 in-game hours each); a jump back starts over from
// hour 0 (a few thousand hashes for a long-played world: well under a ms, and only on a jump).
//   const S = createSchedule(seed); S.at(biome, hours, seasonDays, precip = true) -> {w, n, t0, t1} (one reused record)
import {hash3} from '../core/mathx.js';

// weather states: the channels they ease toward. cloud / rain / snow / fog / storm 0..1, wind = the wind strength
// (calm .35, breeze 1, brisk 2.1, gale 3: features/wind.js LEVELS)
export const WEATHER = {
  clear:    {cloud: 0,   fog: 0,   wind: .9},
  fair:     {cloud: .3,  fog: 0,   wind: 1},
  cloudy:   {cloud: .6,  fog: .05, wind: 1.3},
  overcast: {cloud: .9,  fog: .15, wind: 1.1},
  windy:    {cloud: .35, fog: 0,   wind: 2.1},
  fog:      {cloud: .5,  fog: 1,   wind: .35},
  rain:     {cloud: .95, fog: .25, rain: 1, wind: 1.5, precip: true},
  storm:    {cloud: 1,   fog: .2,  rain: 1, storm: 1, wind: 2.8, precip: true},
  snow:     {cloud: .85, fog: .2,  snow: 1, wind: 1.1, precip: true},
  blizzard: {cloud: 1,   fog: .5,  snow: 1, storm: .6, wind: 2.9, precip: true},
  haze:     {cloud: .2,  fog: .4,  wind: .8},
  ash:      {cloud: .5,  fog: .3,  wind: 1.3},
  void:     {cloud: 0,   fog: 0,   wind: 1},
  gale:     {cloud: .45, fog: .05, wind: 3},   // (no climate draws it: an omen locks it, features/omens.js)
};
// which spells each biome (and season) draws from, with weights
export const CLIMATE = {
  ruins: {
    spring: {clear: 2, fair: 3, cloudy: 2, windy: 1.5, overcast: 1, fog: 1, rain: 2},
    summer: {clear: 4, fair: 3, cloudy: 1, windy: 1, rain: .5, storm: .8},
    autumn: {fair: 1.5, cloudy: 2, overcast: 2, windy: 2.5, fog: 2, rain: 2, storm: .5},
    winter: {clear: 1.5, cloudy: 2, overcast: 2, windy: 1, fog: 1, snow: 3, blizzard: .5},
  },
  frost: {winter: {clear: 2, fair: 1, cloudy: 1.5, windy: 1.2, fog: 1, snow: 3, blizzard: 1}},
  ember: {none: {haze: 3, clear: 1, ash: 2, windy: 1}},
  rift: {none: {void: 1}},
  desert: {none: {clear: 5, fair: 1.5, haze: 2, windy: 1.5, storm: .2}},   // world/desert.js: dry; now and then a summer storm
};
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const TUNE = {spell: [2, 6], seasonDays: 3};   // in-game hours a spell lasts; in-game days a season (sim/env.js TUNE.seasonDays starts from it)
// the season an in-game hour falls in (seasonDays in-game days a season; hour 0 is the first morning of spring's day 0)
export const seasonAt = (hours, seasonDays) => SEASONS[Math.floor(((hours / (seasonDays * 24)) % 4 + 4) % 4)];
// the climate a biome draws from in a season (its own season's table, its one table, the ruins' as a fallback)
export function climateOf(biome, season) { const C = CLIMATE[biome] || CLIMATE.ruins; return C[season] || C.none || Object.values(C)[0]; }
// a weighted pick from a climate table with r in 0..1 (precip false: rain / snow / storm spells left out)
export function pickFrom(C, r, precip = true) {
  let tot = 0;
  for (const k in C) if (precip || !WEATHER[k].precip) tot += C[k];
  r *= tot;
  for (const k in C) { if (!precip && WEATHER[k].precip) continue; if ((r -= C[k]) <= 0) return k; }
  return 'fair';
}

export function createSchedule(seed) {
  const S = {w: 'fair', n: 0, t0: 0, t1: 0}, cur = {biome: '', days: 0, precip: true, n: -1, t0: 0, t1: 0, w: 'fair', wn: -1};
  const len = n => TUNE.spell[0] + (TUNE.spell[1] - TUNE.spell[0]) * hash3(seed, n, 1);
  function start() { cur.n = 0; cur.t0 = 0; cur.t1 = len(0); cur.wn = -1; }
  return {
    seed,
    // the spell an in-game hour falls in (S: reused, read at once)
    at(biome, hours, seasonDays, precip = true) {
      if (biome !== cur.biome || seasonDays !== cur.days || precip !== cur.precip || cur.n < 0 || hours < cur.t0) { cur.biome = biome; cur.days = seasonDays; cur.precip = precip; start(); }
      while (hours >= cur.t1) { cur.n++; cur.t0 = cur.t1; cur.t1 += len(cur.n); }
      if (cur.wn !== cur.n) { cur.wn = cur.n; cur.w = pickFrom(climateOf(biome, seasonAt(cur.t0, seasonDays)), hash3(seed, cur.n, 2), precip); }
      S.n = cur.n; S.t0 = cur.t0; S.t1 = cur.t1; S.w = cur.w;
      return S;
    },
  };
}
