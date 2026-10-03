// ENV (sim): the world's clock, seasons and weather. The one owner of "what time / season / weather is it" (docs/
// ARCHITECTURE.md rule 7: env.time, env.weather, env.windLevel are services; nobody re-derives them). It runs quietly in
// the background: the day turns (TUNE.dayMinutes real minutes per day), the seasons follow (TUNE.seasonDays days each,
// cross-fading over the last part of one into the next), and the weather wanders between states (a weighted random walk
// per biome and season, each spell a few in-game hours, eased in over TUNE.ease s). It persists (localStorage 'rb.env'),
// so the world keeps its time and weather between sessions.
//   biomes   ruins: four seasons. frost: always winter. ember: no seasons (haze, ash). rift: no seasons, no weather (the
//            void keeps the wind feature's own pulses)
//   light    mood(biome): the lighting.js mood tables blended over the day (night -> dawn -> day -> dusk -> night; dawn is
//            the dusk mood lit from the east), the sun sweeping through the northern sky so shadows keep falling toward
//            the camera side like the art, then the weather on top (clouds soften the sun and its shadows, fog thickens)
//   wind     windLevel: the wind strength the weather asks for (the wind feature's 'auto' mode follows it)
//   seasons  leafRamp(): the ruins' leaf ramp for the season (spring fresh, summer deep, autumn a late green, winter withered),
//            blended across a season's change; ver.leaf counts its changes (update on change, never per frame)
//   ground   the weather's memory: snowCover (builds in snowfall, melts slowly in winter, fast in spring), wet (rain wets,
//            the sun dries), leafK (how full the ruins' crowns are through the year); features/weather.js shows them.
//            leafFall: how fast the leaves are dying now (0..1, the peak where autumn turns to winter; features/wind.js)
//            autumn: how far autumn has turned the leaves (0 green .. 1 fully turned; renderers colour the leaves by it)
// OWNS: the clock (t, hour, day), the season and its blend (+ year 0..4), the weather (state + eased channels), the
// ground's memory (snowCover, wet, leafK, leafFall, autumn), the blended moods.
// READS: the biome id (biome()), the mood tables (moods, content). EMITS: nothing; ver.{part, season, weather, leaf} count
// changes for whoever needs to react. BUDGET: ~0.01 ms per step, ~0.01 ms per mood(); no allocation after creation.
//
// createEnv({moods, biome, Q}) -> env. env.step(dt) once per sim step. Dev: setHour / setPart / setSeason / setWeather /
// setDayMinutes; URL ?hour= ?season= ?weather= ?daymin= (0 = the clock stands still); ?time=day|dusk|night still works.
import {flags} from '../core/flags.js';
import {clamp, smooth, lerp} from '../core/mathx.js';
import {hex01 as hex} from '../core/color.js';
import {mulberry32, simSeed} from '../core/rng.js';

export const TUNE = {
  dayMinutes: 20,     // real minutes per in-game day (dawn ~1.5, day ~7.5, dusk ~1.5, night ~7 of them)
  seasonDays: 3,      // in-game days per season (a year: 12 days, 4 h of play)
  seasonBlend: .3,    // the last 30 % of a season fades into the next
  spell: [2, 6],      // in-game hours a weather spell lasts
  ease: 25,           // s: weather channels ease toward a new spell's values (time constant)
  start: {day: 0, hour: 9},   // a fresh world: the first morning of spring
  precip: true,       // rain / snow / storm spells (features/weather.js draws them)
  // the ground's memory of the weather (sim state, in-game hours): snow builds while it snows and melts after (slowly in
  // winter, fast in spring); rain wets the ground, the sun dries it
  snowGrow: .35, snowMelt: {winter: .025, spring: .3, summer: .6, autumn: .15},
  wetGrow: .9, wetDry: {winter: .08, spring: .2, summer: .4, autumn: .15},
};
// how full the ruins' crowns are through the year (year position 0..4 = spring .. winter): budding in spring, full in
// summer, thinning through autumn, bare in winter
const LEAF_YEAR = [[0, .12], [.65, 1], [2, 1], [2.55, .78], [2.95, .3], [3.1, .07], [3.85, .07], [4, .12]];
// how fast the leaves are dying (year position -> 0..1, linear between): the odd dead one in summer, more and more through
// autumn as LEAF_YEAR thins the crowns, the most where autumn turns into winter, the last few after; in spring the buds
// push off a withered straggler. features/wind.js drops leaves at this rate and shakes them loose easier
const LEAF_FALL = [[0, .04], [.5, .02], [1, .03], [1.6, .06], [2, .14], [2.5, .45], [2.9, .9], [3.05, 1], [3.2, .3], [3.4, .06], [3.85, .03], [4, .04]];
// how far autumn has turned the leaves (year position -> 0..1, smoothed between): green until late summer, turning through
// autumn, fully turned as the crowns thin out (LEAF_YEAR); new green leaves in spring. Renderers colour leaves by it
const AUTUMN_YEAR = [[0, 0], [1.8, 0], [2.2, .35], [2.6, .75], [2.95, 1], [3.9, 1], [4, 0]];
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const PARTS = ['night', 'dawn', 'day', 'dusk'];
// the day: [hour, mood] keyframes, smoothstepped between (dawn = dusk's mood, lit from the east)
const KEYS = [[0, 'night'], [5, 'night'], [6.3, 'dawn'], [8, 'day'], [17, 'day'], [19, 'dusk'], [20.6, 'night'], [24, 'night']];
// the sun's compass bearing (the direction light comes FROM): ENE at sunrise, through north at ~12:45, WNW at sunset
const sunAz = h => (70 - (clamp(h, 6, 19.5) - 6) / 13.5 * 140 + 360) % 360;

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
};
const CH = ['cloud', 'rain', 'snow', 'fog', 'storm', 'wind'];
const GREY = [.94, .96, 1], HAZE = [.55, .6, .7];   // clouds pull the light toward a cool grey; the haze they add
// the desert's (world/desert.js) haze is warm dust, not the cool grey; and a wind over a breeze lifts a faint dust haze of its
// own (DUST_K at a full gale's sky wind, from 1.2). Presentation only: mood() is read by the lighting, never by the sim
const DUST = [.8, .66, .46], DUST_K = .09;
// which spells each biome (and season) draws from, with weights
const CLIMATE = {
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
const SEASONAL = {ruins: true};               // biomes whose look follows the seasons
const FIXED = {frost: 'winter'};              // biomes stuck in one season
// the ruins' leaves per season (4-tone ramps, light -> dark: world.js ramp6 adds the line / outline tones). This is the GREEN
// leaf of the season, what the 3D crowns show where a spray hasn't turned: in autumn a late, slightly yellowed green (the turned
// sprays take the species' own autumn ramps, trees3d.js B.autumn, by env.autumn: core/autumn.js), not the rust it used to be
export const LEAF = {
  spring: ['#86a86a', '#6a8c58', '#4f6c47', '#354a35'],
  summer: ['#6f8c68', '#577154', '#435a45', '#2e3f33'],
  autumn: ['#789262', '#5f7a4e', '#4a6040', '#33422f'],
  winter: ['#80806a', '#646451', '#4c4c3f', '#33332c'],
};
const LEAF_RGB = Object.fromEntries(Object.entries(LEAF).map(([k, v]) => [k, v.map(hex)]));

export function createEnv({moods, biome, Q = flags}) {
  const DAY = () => TUNE.dayMinutes * 60;   // real s per day
  const E = {TUNE, hour: 0, day: 0, t: 0, part: 'day', bucket: 'day', season: 'spring', seasonNext: 'summer', seasonK: 0,
    weather: 'fair', sky: {cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0, wind: 1}, windLevel: 1,
    year: 0, tinted: false, snowCover: 0, wet: 0, leafK: 1, leafFall: 0, autumn: 0,   // year 0..4 (spring .. winter); tinted = the biome's colours follow the season
    ver: {part: 0, season: 0, weather: 0, leaf: 0}, frozen: false, seasonLock: null, weatherLock: null};
  let spellLeft = 0, lastBiome = null;
  const R = mulberry32(simSeed());   // the weather's next spell: the sim's own draws (core/rng.js), never presentation's
  // ---- persistence: {t (in-game hours since the start), weather, spellLeft}
  const KEY = 'rb.env.v1', url = {hour: Q.get('hour'), season: Q.get('season'), weather: Q.get('weather'), daymin: Q.get('daymin'), time: Q.get('time')};
  let hours = TUNE.start.day * 24 + TUNE.start.hour;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && isFinite(s.hours)) { hours = s.hours; E.snowCover = s.snowCover || 0; E.wet = s.wet || 0; if (WEATHER[s.weather]) { E.weather = s.weather; spellLeft = s.spellLeft || 0; } }
  } catch (e) {}
  if (url.daymin !== null && isFinite(+url.daymin)) { if (+url.daymin <= 0) E.frozen = true; else TUNE.dayMinutes = +url.daymin; }
  if (url.hour !== null && isFinite(+url.hour)) hours = Math.floor(hours / 24) * 24 + clamp(+url.hour, 0, 23.99);
  if (SEASONS.includes(url.season)) E.seasonLock = url.season;
  if (WEATHER[url.weather]) E.weatherLock = url.weather;
  else if (Q.has('bench')) E.weatherLock = 'fair';   // the perf bench compares runs: no random rain in its scenarios
  let saveT = 0;
  function save() { try { localStorage.setItem(KEY, JSON.stringify({hours, weather: E.weather, spellLeft, snowCover: E.snowCover, wet: E.wet})); } catch (e) {} }
  if (typeof addEventListener === 'function') addEventListener('pagehide', save);

  // ---- clock -> hour, day, part, season
  function syncClock() {
    E.hour = ((hours % 24) + 24) % 24; E.day = Math.floor(hours / 24); E.t = hours;
    const h = E.hour, part = h < 5.6 || h >= 20.3 ? 'night' : h < 7.2 ? 'dawn' : h < 18 ? 'day' : 'dusk';
    if (part !== E.part) { E.part = part; E.bucket = part === 'dawn' ? 'dusk' : part; E.ver.part++; }
    const b = biome(), yearH = TUNE.seasonDays * 24, sf = ((hours / yearH) % 4 + 4) % 4, si = Math.floor(sf), into = sf - si;
    let s = SEASONS[si], n = SEASONS[(si + 1) % 4], k = smooth((into - (1 - TUNE.seasonBlend)) / TUNE.seasonBlend);
    if (E.seasonLock) { s = n = E.seasonLock; k = 0; }
    if (FIXED[b]) { s = n = FIXED[b]; k = 0; }
    if (s !== E.season) E.ver.season++;
    E.season = s; E.seasonNext = n; E.seasonK = k;
    E.seasonal = !!SEASONAL[b] || !!FIXED[b]; E.tinted = !!SEASONAL[b];
    E.year = E.seasonLock ? SEASONS.indexOf(E.seasonLock) + .5 : sf;
    let j = 0; while (j < LEAF_YEAR.length - 2 && E.year >= LEAF_YEAR[j + 1][0]) j++;
    const [y0, l0] = LEAF_YEAR[j], [y1, l1] = LEAF_YEAR[j + 1]; E.leafK = SEASONAL[b] ? lerp(l0, l1, smooth((E.year - y0) / (y1 - y0))) : 1;
    j = 0; while (j < LEAF_FALL.length - 2 && E.year >= LEAF_FALL[j + 1][0]) j++;
    const [f0, a0] = LEAF_FALL[j], [f1, a1] = LEAF_FALL[j + 1]; E.leafFall = SEASONAL[b] ? lerp(a0, a1, clamp((E.year - f0) / (f1 - f0), 0, 1)) : 0;
    j = 0; while (j < AUTUMN_YEAR.length - 2 && E.year >= AUTUMN_YEAR[j + 1][0]) j++;
    const [u0, t0] = AUTUMN_YEAR[j], [u1, t1] = AUTUMN_YEAR[j + 1]; E.autumn = SEASONAL[b] ? lerp(t0, t1, smooth((E.year - u0) / (u1 - u0))) : 0;
  }
  // the ground's memory: lying snow and wetness (in-game hours; only where the biome follows the seasons)
  function stepGround(dh) {
    const S = E.sky, sn = SEASONAL[biome()];
    E.snowCover = sn ? clamp(E.snowCover + dh * (S.snow * TUNE.snowGrow - (S.snow > .3 ? 0 : TUNE.snowMelt[E.season] ?? .2) - S.rain * .5), 0, 1) : 0;
    E.wet = clamp(E.wet + dh * (S.rain * TUNE.wetGrow - (S.rain > .3 ? 0 : (TUNE.wetDry[E.season] ?? .2) * (1 - .6 * S.cloud))), 0, 1);
  }
  // ---- weather: pick a spell for the biome / season, ease the channels toward it
  function climate() { const C = CLIMATE[biome()] || CLIMATE.ruins; return C[E.season] || C.none || Object.values(C)[0]; }
  function pick() {
    const C = climate(); let tot = 0;
    for (const k in C) if (TUNE.precip || !WEATHER[k].precip) tot += C[k];
    let r = R() * tot;
    for (const k in C) { if (!TUNE.precip && WEATHER[k].precip) continue; if ((r -= C[k]) <= 0) return k; }
    return 'fair';
  }
  function setSpell(w) { if (w !== E.weather) E.ver.weather++; E.weather = w; spellLeft = lerp(TUNE.spell[0], TUNE.spell[1], R()); }
  function stepWeather(dt, dh) {
    const b = biome();
    if (b !== lastBiome) {   // a new biome: its climate takes over at once (no snow carried into the ember wastes)
      lastBiome = b; const C = climate();
      if (!E.weatherLock && !(E.weather in C)) setSpell(pick());
    }
    if (E.weatherLock) { if (E.weather !== E.weatherLock) { E.weather = E.weatherLock; E.ver.weather++; } }
    else if ((spellLeft -= dh) <= 0 || (!TUNE.precip && WEATHER[E.weather]?.precip)) setSpell(pick());
    const W = WEATHER[E.weather] || WEATHER.fair, k = 1 - Math.exp(-dt / TUNE.ease);
    for (const c of CH) E.sky[c] += ((W[c] ?? (c === 'wind' ? 1 : 0)) - E.sky[c]) * k;
    E.windLevel = E.sky.wind;
  }
  E.step = dt => {
    const dh = E.frozen ? 0 : dt / DAY() * 24;
    hours += dh; syncClock(); stepWeather(dt, dh); stepGround(E.frozen ? dt / 50 : dh);   // (a stopped clock still lets the ground follow the weather)
    if ((saveT -= dt) <= 0) { saveT = 15; save(); }
  };

  // ---- the mood: the day's keyframes blended, then the weather
  const blank = () => ({amb: [0, 0, 0], sun: {az: 0, el: 0, c: [0, 0, 0], k: 0, rim: 0}, shadow: {a: 0, c: [0, 0, 0], ao: .5}, fog: [0, 0, 0, 0], lift: [0, 0, 0], fill: [0, 0, 0], glow: 0});
  const out = {}, tmp = {a: null, b: null};
  const moodOf = (M, name) => name === 'dawn' ? M.dusk : M[name];
  const mixArr = (o, a, b, k, n) => { for (let i = 0; i < n; i++) o[i] = lerp(a?.[i] ?? 0, b?.[i] ?? 0, k); };
  const angMix = (a, b, k) => { const d = ((b - a + 540) % 360) - 180; return (a + d * k + 360) % 360; };
  E.mood = (bid = biome()) => {
    const M = moods[bid] || moods.ruins, o = out[bid] ||= blank(), h = E.hour;
    let i = 0; while (i < KEYS.length - 2 && h >= KEYS[i + 1][0]) i++;
    const [h0, n0] = KEYS[i], [h1, n1] = KEYS[i + 1], k = smooth((h - h0) / (h1 - h0)), A = moodOf(M, n0), B = moodOf(M, n1);
    mixArr(o.amb, A.amb, B.amb, k, 3); mixArr(o.fog, A.fog, B.fog, k, 4); mixArr(o.lift, A.lift, B.lift, k, 3); mixArr(o.fill, A.fill, B.fill, k, 3);
    mixArr(o.sun.c, A.sun.c, B.sun.c, k, 3); mixArr(o.shadow.c, A.shadow.c, B.shadow.c, k, 3);
    // (by day the sun climbs to the mood's elevation at noon and sinks toward the morning / afternoon: longer shadows late)
    const arc = .74 + .26 * Math.sin(Math.PI * clamp((h - 6.5) / 12.5, 0, 1)), el = (X, n) => X.sun.el * (n === 'day' ? arc : 1);
    o.sun.el = lerp(el(A, n0), el(B, n1), k); o.sun.k = lerp(A.sun.k, B.sun.k, k); o.sun.rim = lerp(A.sun.rim ?? 0, B.sun.rim ?? 0, k);
    o.shadow.a = lerp(A.shadow.a, B.shadow.a, k); o.shadow.ao = lerp(A.shadow.ao ?? .5, B.shadow.ao ?? .5, k); o.glow = lerp(A.glow ?? .5, B.glow ?? .5, k);
    // the light's bearing: the moon's (the night mood's) by night, the sun's path by day, swinging between them at dawn / dusk
    const nightW = (n0 === 'night' ? 1 - k : 0) + (n1 === 'night' ? k : 0);
    o.sun.az = angMix(sunAz(h), M.night.sun.az, nightW);
    // the weather on top: clouds soften the sun and its shadows and grey the light; fog / rain / snow thicken the haze
    const S = E.sky, c = S.cloud, lum = o.amb[0] * .3 + o.amb[1] * .55 + o.amb[2] * .15;
    o.sun.k *= 1 - .55 * c; o.shadow.a *= 1 - .8 * c;
    const HZ = bid === 'desert' ? DUST : HAZE, dust = bid === 'desert' ? DUST_K * clamp((S.wind - 1.2) / 1.6, 0, 1) : 0;
    for (let j = 0; j < 3; j++) {
      o.amb[j] = lerp(o.amb[j], lum * GREY[j], .35 * c) * (1 - .1 * c - .12 * S.rain - .2 * S.storm);
      o.sun.c[j] = lerp(o.sun.c[j], .85, .5 * c);
      o.fog[j] += HZ[j] * (.05 * c + .1 * S.rain + .16 * S.fog + .08 * S.snow);
      if (dust) o.fog[j] += DUST[j] * dust;
    }
    o.fog[3] = Math.min(.5, o.fog[3] + .05 * c + .1 * S.rain + .16 * S.fog + .08 * S.snow);
    if (dust) o.fog[3] = Math.min(.5, o.fog[3] + dust);
    o.glow *= 1 + .3 * c;
    return o;
  };
  // ---- seasons: the ruins' leaf ramp (rgb 0..1 x 4), blended across a change; null where the biome has no seasons
  const leafOut = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let leafKey = -1;
  E.leafRamp = () => {
    if (!SEASONAL[biome()]) return null;
    const q = Math.round(E.seasonK * 16), key = (SEASONS.indexOf(E.season) * 4 + SEASONS.indexOf(E.seasonNext)) * 17 + q;   // 16 steps: re-upload rarely
    if (key !== leafKey) {
      const a = LEAF_RGB[E.season], b = LEAF_RGB[E.seasonNext], k = q / 16;
      leafKey = key; E.ver.leaf++; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) leafOut[i][j] = lerp(a[i][j], b[i][j], k);
    }
    return leafOut;
  };
  // ---- dev controls
  const PART_H = {dawn: 6.4, day: 10, dusk: 19.2, night: 22};
  E.setHour = h => { hours = Math.floor(hours / 24) * 24 + ((h % 24) + 24) % 24; syncClock(); };
  E.setPart = p => { if (PART_H[p] !== undefined) { const day0 = Math.floor(hours / 24) * 24, h = PART_H[p]; hours = day0 + h + (h < E.hour ? 24 : 0); syncClock(); } };
  E.nextPart = () => E.setPart(PARTS[(PARTS.indexOf(E.part) + 1) % 4]);
  E.setSeason = s => { E.seasonLock = SEASONS.includes(s) ? s : null; syncClock(); };
  E.setWeather = w => { E.weatherLock = WEATHER[w] ? w : null; if (!E.weatherLock) setSpell(pick()); };
  E.setDayMinutes = m => { if (m <= 0) E.frozen = true; else { E.frozen = false; TUNE.dayMinutes = m; } };
  E.clock = () => { const h = Math.floor(E.hour), m = Math.floor((E.hour - h) * 60); return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`; };
  E.label = () => `${E.clock()} ${E.part} · day ${E.day + 1}${E.seasonal ? ' · ' + E.season + (E.seasonK > .02 ? ' -> ' + E.seasonNext : '') : ''} · ${E.weather}`;
  if (url.time && PART_H[url.time] !== undefined) E.setPart(url.time);   // the old ?time=day|dusk|night
  syncClock(); lastBiome = biome();
  for (const c of CH) E.sky[c] = (WEATHER[E.weather] || WEATHER.fair)[c] ?? (c === 'wind' ? 1 : 0);
  E.windLevel = E.sky.wind;
  if (!E.weatherLock && (!spellLeft || (!TUNE.precip && WEATHER[E.weather]?.precip))) setSpell(pick());
  return E;
}
