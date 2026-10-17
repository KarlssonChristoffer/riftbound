// ENV (sim): the world's clock, seasons and weather. The one owner of "what time / season / weather is it" (docs/
// ARCHITECTURE.md rule 7: env.time, env.weather, env.windLevel are services; nobody re-derives them). It runs quietly in
// the background: the day turns (TUNE.dayMinutes real minutes per day), the seasons follow (TUNE.seasonDays days each,
// cross-fading over the last part of one into the next), and the weather wanders between states (a weighted walk per biome
// and season, each spell a few in-game hours, eased in over TUNE.ease s). The spells are a pure function of the world's seed
// and its clock (sim/wxclock.js): every co-op client and the server compute the same sky, and a world keeps its weather
// between sessions because it keeps its clock (localStorage 'rb.env': the clock and the ground's memory).
//   biomes   ruins: four seasons. frost: always winter. ember: no seasons (haze, ash). rift: no seasons, no weather (the
//            void keeps the wind feature's own pulses)
//   light    mood(biome): the lighting.js mood tables blended over the day (night -> dawn -> day -> dusk -> night; dawn is
//            the dusk mood lit from the east), the sun sweeping through the northern sky so shadows keep falling toward
//            the camera side like the art, then the weather on top (clouds soften the sun and its shadows, fog thickens);
//            moodFor(biome, channels): the same from a given channel set (two lights, env.open / env.under: MOOD below)
//   wind     windLevel: the wind strength the weather asks for (the wind feature's 'auto' mode follows it)
//   changes  a new spell comes as a TRANSITION (below): rain arrives as a front rolling in from upwind, a storm breaks up into
//            sun gaps, a small change eases; sky is the weather where the player stands, light the view's mean, open / under
//            the two weathers a pixel is lit by (the sun's gaps, the deck), aloft the wind the clouds drift on
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
// createEnv({moods, biome, Q, focus}) -> env (focus() -> {x, y}: the player, where the weather is felt). env.step(dt)
// once per sim step. Dev: setHour / setPart / setSeason / setWeather / setDayMinutes; URL ?hour= ?season= ?weather= ?daymin=
// (0 = the clock stands still); ?time=day|dusk|night still works.
// Other systems: setWeather(w, ease) (an omen's storm rolls in over a few s), setGrade(source, g) / clearGrade(source): a
// colour grade over mood() (features/omens.js: a blood moon, an eclipse; GRADES below). env.front / frontAt(x, y) /
// skyAt(x, y, channel): the front on its way (features/depth.js draws it, render/clouds.js keeps the god rays out of its
// shadow, features/weather.js rains under it).
//
// TRANSITIONS (?wxtrans=0: the old FRONTS below). A change of weather looks like weather, and no two alike: each draws its own
// timings (+- TUNE.trans.vary), its wind aloft (veering round the prevailing wind) and, for a front, its speed and edge.
//   'front'   (rain / snow / a storm arriving on a dry sky) the precursors first: the wind rises, the cloud shadows thicken and
//             speed up, the light flattens (open eases toward a heavier sky); then the dark wall from upwind, an edge bent at two
//             scales and torn by the cloud field, rolling along the wind aloft; the rain starts a few m into it; once the view
//             is all under it, the deck settles (its last gaps close and the storm's own faint cloud shadows come back)
//   'breakup' (a storm, rain, snow or a heavy overcast clearing to a fairer sky) NO edge: the downpour eases to a drizzle over
//             the whole view while the deck brightens (under eases toward a light overcast, not to clear); then the deck
//             breaks: gaps open at the cloud field's thinnest places, everywhere in view, and grow; sun patches race over the
//             ground, drifting slowly on the wind aloft; the rain stops in the gaps first (skyAt), then everywhere; the patches merge; clear.
//             The ground stays wet (wet, as ever)
//   'ease'    (small changes: fair <-> cloudy, a fog, rain -> storm) the channels ease (TUNE.ease s) and the
//             clouds form and dissolve on the continuous cover (render/clouds.js)
// A COMMANDED change (setWeather: the F2 cheat panel, the dev menu) starts close: a breakup at once, a front's precursors short
// (its wall in view within ~10 s); after that it plays at a natural spell's pace (the user: the quick pacing and clouds at
// 4.5-6 m/s "happen way too rapidly"; the F9 weather panel's x4 runs a change fast to look at it).
// THE CHANNEL SETS (a pixel is lit by one or the other: render/clouds.js cloudAt().y, 0 open .. 1 under):
//   open    the weather where the SUN gets through (a front's clear side, the gaps in a breaking deck)
//   under   the weather under the deck (a front's storm side, the deck while it breaks)
//   light   the view's MEAN: lerp(open, under, the view's share under the deck) (mood() and the old readers)
//   sky     the weather felt where the player stands (rain, wind, the ground's memory; a breakup: the mean)
//   (all four the same values when nothing is changing)
//   sunView 0..1 the share of the view's ground the sun reaches ((1 - under share) x (1 - .9 open cloud); 1 on a clear day)
//   broken  0..1 how broken the sky over the view is (4 u (1 - u) x the deck's darkness over the open sky, u the view's share
//           under it; on a steady sky a part of partial heavy cloud: up to .5 at a cloudy sky's cover; 0 on a uniform sky)
//   trans   {kind: 'front' | 'breakup' | 'ease' | null, phase: (front: pre, wall, settle; breakup: close, ease, break), k 0..1, t s}
//   deck    {mode: 0 none | 1 everywhere at its cover | 2 behind a front's edge, cover 0..1, q: the density it starts at (mode 1),
//           rim: the density band of its thin rim}: where the deck lies over the cloud field (core/cloudfield.js)
//   aloft   {dir: [x, y] unit, v m/s, o: the cloud field's drift (core/cloudfield.js: what each is), vel: their rates, t: s}: the wind the
//           clouds and fronts move on, veering per change round the prevailing TUNE.trans.dir (the ground wind, features/
//           wind.js W.dir, stays as it is: a surface wind 20-40 deg off the wind aloft is normal)
//   skyAt(x, y, c): a channel where it falls: a front's band (the rain a few m into it), a breakup's deck (no rain in its gaps)
//
// FRONTS (?wxtrans=0). The sky used to ease from one spell to the next everywhere at once (TUNE.ease s), rain and cloud together. Now a
// spell that turns it over (TUNE.front.dCloud of cloud, or rain / snow starting or stopping) comes as a front: a straight
// edge, bent a little along its length, rolling DOWNWIND (TUNE.front.dir, the wind feature's prevailing wind) at
// TUNE.front.v from TUNE.front.lead m upwind of the player. Behind it the new weather, ahead of it the old, the change spread
// over TUNE.front.band m. What the player feels (sky: the rain, the wind, the storm) changes as the edge passes the player, each
// channel at its own place (TUNE.front.at: the wind ahead of the edge, the rain a few m into the storm). What the view is LIT
// by (light: the mood's channels) is the clear side's while that side is on screen, and the storm's once it covers the
// view (TUNE.front.view, crossed over TUNE.front.fade m): one light can't be both, so the clear one holds and the storm side
// is drawn darker on the ground (features/depth.js); an arriving storm darkens the land edge first and rains after, a
// clearing one breaks into holes with the sun (and its beams) through them. A natural spell waits for a front to pass.
import {flags} from '../core/flags.js';
import {clamp, smooth, lerp} from '../core/mathx.js';
import {hex01 as hex} from '../core/color.js';
import {mulberry32, simSeed, simRandom} from '../core/rng.js';
import {WEATHER, CLIMATE, createSchedule, TUNE as WXT} from './wxclock.js';   // the spells from the seed and the clock (shared with the co-op server)
import {density, coverQ, wrapDrift, QUANT, FIELD_V2} from '../core/cloudfield.js';

export const TUNE = {
  dayMinutes: 20,     // real minutes per in-game day (dawn ~1.5, day ~7.5, dusk ~1.5, night ~7 of them)
  seasonDays: WXT.seasonDays,   // in-game days per season (a year: 12 days, 4 h of play; sim/wxclock.js: the server's too)
  seasonBlend: .3,    // the last 30 % of a season fades into the next
  // (a spell's length: sim/wxclock.js TUNE.spell)
  ease: 25,           // s: weather channels ease toward a new spell's values (time constant)
  start: {day: 0, hour: 9},   // a fresh world: the first morning of spring
  precip: true,       // rain / snow / storm spells (features/weather.js draws them)
  // the ground's memory of the weather (sim state, in-game hours): snow builds while it snows and melts after (slowly in
  // winter, fast in spring); rain wets the ground, the sun dries it
  snowGrow: .35, snowMelt: {winter: .025, spring: .3, summer: .6, autumn: .15},
  wetGrow: .9, wetDry: {winter: .08, spring: .2, summer: .4, autumn: .15},
  replay: 96, replayJump: 2,   // the ground's memory replayed over this many in-game hours after a jump of the clock past replayJump (setT)
  // FRONTS (above): the way they travel (features/wind.js W.dir: the prevailing wind, the clouds drift along it), m/s, how
  // far upwind of the player one starts (m), the change behind / ahead of the edge (m), the edge's bends (m, m along it),
  // half the view across the wind (m) and the light's cross-over there (m), what makes a change a front, and where each
  // channel the player feels changes (m into the storm side; < 0: on the clear side, before the edge reaches the player)
  front: {dir: [.94, .34], v: 2.4, lead: 70, band: [14, 14], wobble: [6, 38], view: 22, fade: 10, dCloud: .3,
    at: {cloud: 0, rain: 7, snow: 7, storm: 4, fog: 2, wind: -12}},
  // TRANSITIONS (the header). [natural, commanded] pairs; every duration, speed and bend is drawn +- vary of its value per change.
  //   view    m: how far the view reaches from the player any way (the widest window's half diagonal: a front is past when all
  //           of it is behind the edge); viewIn: m, where a front's wall first shows (~ a 1080p view's half height / width:
  //           its torn edge reaches there as the precursors end); viewMean: the radii the view's mean is taken at (17 points),
  //           meanEase: s, a breaking deck's sampled mean eases
  //   dir / veer   the prevailing wind aloft and how far a change's veers from it (deg, either way)
  //   aloft   m/s: the clouds' speed in a breeze (each change draws one), x (windK[0] + windK[1] x the view's wind): slow, under
  //           the old fixed drift's ~1.9 (a cloud shadow takes ~20-30 s across a 3440 px view), a gale's ~1.6x
  //   layerB  layer B turned (deg, a side per change) and slowed against A; warp: the warp's share of A's drift; turn: s, the
  //           wind aloft swings to a change's way
  //   evo     m/s: (the smooth field, core/cloudfield.js FIELD_V2) the warp under the clouds drifts this much against them (its
  //           way a change's side): their shapes change over minutes while they drift as one (layerB / warp: the old field's)
  //   wander  (FIELD_V2) the wind aloft wanders round a change's way: deg either way, its speed +- v (share), over the periods T
  //           (s: two for the way, one for the speed), so the clouds don't cross the view the same way at the same pace for hours
  //   rim     the deck's thin rim (density: half under, half open)
  //   breakup close: s the deck closes over the old sky's faint shadows (nothing else changes); ease: s the downpour eases to a
  //           drizzle (drizzle: its rain) as the deck brightens to a light overcast (deck: its cloud, at most); brk: s the deck
  //           breaks; dry: the share of brk by which the rain has stopped everywhere; remnant: the cloud of what's left of it
  //   front   pre: s of precursors before the wall reaches the view (open eases toward preCloud, the wind halfway to the storm's,
  //           the clouds speed up x boost); v m/s; band: m the change behind / ahead of the edge; bend: two [amplitude m,
  //           wavelength m]; appr: m ahead of the edge over which the clear side's clouds thicken (to appr cover); settle: s;
  //           at: where each channel the player feels changes (m into the storm; < 0 before the edge reaches him)
  trans: {view: 15, viewIn: 6, viewMean: [3.5, 7], meanEase: 1.2, dir: [.94, .34], veer: 45, aloft: [1.1, 1.6], windK: [.8, .2], layerB: [14, .82], warp: .45,
    evo: .05, wander: {deg: 18, v: .15, T: [430, 170, 260]},
    turn: [24, 24], vary: .3, rim: .014, ease: 25,
    breakup: {close: 1, ease: [30, 30], brk: [75, 75], drizzle: .22, deck: .88, dry: .65, remnant: .6},
    front: {pre: [30, 8], v: [1.5, 1.5], band: [12, 10], bend: [[7, 30], [3, 10]], appr: 20, settle: [10, 10], boost: 1.2, preCloud: .55,
      at: {cloud: 0, rain: 6, snow: 6, storm: 3, fog: 2, wind: -12}}},
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

export {WEATHER};   // (sim/wxclock.js: the states and their channels)
const CH = ['cloud', 'rain', 'snow', 'fog', 'storm', 'wind'];
const GREY = [.94, .96, 1], HAZE = [.55, .6, .7];   // clouds pull the light toward a cool grey; the haze they add
// rain (and a storm, a heavy overcast) washes the light blue-teal and fills the air with a cool veil: the whole view turns
// toward slate and teal, not just darker (c: a multiply on the ambient at full rain; haze: its veil's colour, veil its share, a
// the opacity it adds: the darks lift, as in the air of a downpour; k: the share of it all, 0 the old grey; not in the desert).
// (c never raises a channel: a brighter ambient leaves the lamps' pools no headroom under the light's soft knee, gfx.js COMP_FS,
// and they flatten into discs; the blue comes from the veil, added after the light)
// Live-tunable
export const WET = {k: 1, c: [.78, .9, 1], haze: [.34, .5, .7], veil: .75, a: .13};
// the desert's (world/desert.js) haze is warm dust, not the cool grey; and a wind over a breeze lifts a faint dust haze of its
// own (DUST_K at a full gale's sky wind, from 1.2). Presentation only: mood() is read by the lighting, never by the sim
const DUST = [.8, .66, .46], DUST_K = .09;
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
// the cool palette (the default; ?palette=old, world/biomes.js): a brighter yellow-green leaf, light over the grass as in the references
if (flags.get('palette') !== 'old') Object.assign(LEAF, {spring: ['#accc6c', '#86a856', '#5e8246', '#3c5a3c'],
  summer: ['#a2c262', '#7a9e4c', '#527642', '#34503c'], autumn: ['#a6b060', '#808e4a', '#5a6a40', '#3c4a34']});
const LEAF_RGB = Object.fromEntries(Object.entries(LEAF).map(([k, v]) => [k, v.map(hex)]));

export function createEnv({moods, biome, Q = flags, focus = null, seed = null}) {
  const DAY = () => TUNE.dayMinutes * 60;   // real s per day
  const E = {TUNE, hour: 0, day: 0, t: 0, part: 'day', bucket: 'day', season: 'spring', seasonNext: 'summer', seasonK: 0,
    weather: 'fair', sky: {cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0, wind: 1}, windLevel: 1,
    light: {cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0, wind: 1},   // the channels the view is lit by (= sky but in a front)
    open: {cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0, wind: 1}, under: {cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0, wind: 1},   // (TRANSITIONS)
    sunView: 1, broken: 0, trans: {kind: null, phase: '', k: 0, t: 0}, deck: {mode: 0, cover: 0, q: 1, rim: TUNE.trans.rim},
    year: 0, tinted: false, snowCover: 0, wet: 0, leafK: 1, leafFall: 0, autumn: 0,   // year 0..4 (spring .. winter); tinted = the biome's colours follow the season
    ver: {part: 0, season: 0, weather: 0, leaf: 0}, frozen: false, seasonLock: null, weatherLock: null};
  let lastBiome = null, lastW = null, instant = false, cmdNext = false;   // (instant: the next change eases, no front; cmdNext: it was commanded)
  const OLD = Q.get('wxtrans') === '0';   // ?wxtrans=0: the old fronts (FRONTS below), no transitions
  let pv = null, truth = null;   // PREVIEW (below): what photo mode asks to see; the readings as they were before it
  const R = mulberry32(simSeed());   // a change's own shape (its timings, its wind aloft): the sim's own draws (core/rng.js), never presentation's
  // THE SPELLS (sim/wxclock.js): from the world's seed (the forest's, a co-op server's; without one a seed of this session's,
  // simRandom: no Math.random draw) and the clock. E.seed: the one in use
  const SCH = createSchedule(E.seed = seed ?? (simRandom('env.spells')() * 4294967296 | 0));
  const spell = (h = hours) => SCH.at(biome(), h, TUNE.seasonDays, TUNE.precip);
  // the wind aloft (the header): its way, the way it swings to, speed, the drift of the cloud field's layers and their velocities
  const TT = TUNE.trans, A0 = Math.atan2(TT.dir[1], TT.dir[0]);
  const AL = E.aloft = {dir: [Math.cos(A0), Math.sin(A0)], want: [Math.cos(A0), Math.sin(A0)], v: (TT.aloft[0] + TT.aloft[1]) / 2, base: (TT.aloft[0] + TT.aloft[1]) / 2,
    turn: 1, tau: TT.turn[0], boost: 1, t: 0, o: new Float64Array(6), vel: new Float64Array(6)};
  // ---- persistence: {hours (in-game hours since the start), snowCover, wet} (the weather follows from the clock)
  const KEY = 'rb.env.v1', url = {hour: Q.get('hour'), season: Q.get('season'), weather: Q.get('weather'), daymin: Q.get('daymin'), time: Q.get('time')};
  let hours = TUNE.start.day * 24 + TUNE.start.hour;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && isFinite(s.hours)) { hours = s.hours; E.snowCover = s.snowCover || 0; E.wet = s.wet || 0; }
  } catch (e) {}
  if (url.daymin !== null && isFinite(+url.daymin)) { if (+url.daymin <= 0) E.frozen = true; else TUNE.dayMinutes = +url.daymin; }
  if (url.hour !== null && isFinite(+url.hour)) hours = Math.floor(hours / 24) * 24 + clamp(+url.hour, 0, 23.99);
  if (SEASONS.includes(url.season)) E.seasonLock = url.season;
  if (WEATHER[url.weather]) E.weatherLock = url.weather;
  else if (Q.has('bench')) E.weatherLock = 'fair';   // the perf bench compares runs: no random rain in its scenarios
  let saveT = 0;
  function save() { if (E.borrowed) return; const S = truth ? truth.r : E; try { localStorage.setItem(KEY, JSON.stringify({hours, snowCover: S.snowCover, wet: S.wet})); } catch (e) {} }   // (the truth, not a preview)
  if (typeof addEventListener === 'function') addEventListener('pagehide', save);

  // ---- clock -> hour, day, part, season
  function syncClock() {
    const H = pv && pv.hour != null ? Math.floor(hours / 24) * 24 + pv.hour : hours;   // (a preview's hour: the same day)
    E.hour = ((H % 24) + 24) % 24; E.day = Math.floor(H / 24); E.t = H;
    const h = E.hour, part = h < 5.6 || h >= 20.3 ? 'night' : h < 7.2 ? 'dawn' : h < 18 ? 'day' : 'dusk';
    if (part !== E.part) { E.part = part; E.bucket = part === 'dawn' ? 'dusk' : part; E.ver.part++; }
    const b = biome(), yr = pv && pv.year != null && SEASONAL[b] ? pv.year : null;   // (a preview's point of the year)
    const yearH = TUNE.seasonDays * 24, sf = yr !== null ? (yr % 4 + 4) % 4 : ((hours / yearH) % 4 + 4) % 4, si = Math.floor(sf), into = sf - si;
    let s = SEASONS[si], n = SEASONS[(si + 1) % 4], k = smooth((into - (1 - TUNE.seasonBlend)) / TUNE.seasonBlend);
    if (E.seasonLock && yr === null) { s = n = E.seasonLock; k = 0; }
    if (FIXED[b]) { s = n = FIXED[b]; k = 0; }
    if (s !== E.season) E.ver.season++;
    E.season = s; E.seasonNext = n; E.seasonK = k;
    E.seasonal = !!SEASONAL[b] || !!FIXED[b]; E.tinted = !!SEASONAL[b];
    E.year = E.seasonLock && yr === null ? SEASONS.indexOf(E.seasonLock) + .5 : sf;
    let j = 0; while (j < LEAF_YEAR.length - 2 && E.year >= LEAF_YEAR[j + 1][0]) j++;
    const [y0, l0] = LEAF_YEAR[j], [y1, l1] = LEAF_YEAR[j + 1]; E.leafK = SEASONAL[b] ? lerp(l0, l1, smooth((E.year - y0) / (y1 - y0))) : 1;
    j = 0; while (j < LEAF_FALL.length - 2 && E.year >= LEAF_FALL[j + 1][0]) j++;
    const [f0, a0] = LEAF_FALL[j], [f1, a1] = LEAF_FALL[j + 1]; E.leafFall = SEASONAL[b] ? lerp(a0, a1, clamp((E.year - f0) / (f1 - f0), 0, 1)) : 0;
    j = 0; while (j < AUTUMN_YEAR.length - 2 && E.year >= AUTUMN_YEAR[j + 1][0]) j++;
    const [u0, t0] = AUTUMN_YEAR[j], [u1, t1] = AUTUMN_YEAR[j + 1]; E.autumn = SEASONAL[b] ? lerp(t0, t1, smooth((E.year - u0) / (u1 - u0))) : 0;
  }
  // the ground's memory: lying snow and wetness (in-game hours; only where the biome follows the seasons)
  function stepGround(dh, S = E.sky, season = E.season) {
    const sn = SEASONAL[biome()], snow = S.snow ?? 0, rain = S.rain ?? 0;
    E.snowCover = sn ? clamp(E.snowCover + dh * (snow * TUNE.snowGrow - (snow > .3 ? 0 : TUNE.snowMelt[season] ?? .2) - rain * .5), 0, 1) : 0;
    E.wet = clamp(E.wet + dh * (rain * TUNE.wetGrow - (rain > .3 ? 0 : (TUNE.wetDry[season] ?? .2) * (1 - .6 * (S.cloud ?? 0)))), 0, 1);
  }
  // the ground's memory as the clock's own weather left it (a co-op welcome: the server's clock is hours away from this page's
  // own): from bare ground TUNE.replay in-game hours before h, a step a quarter hour, each spell's channels as they are (no
  // changes' shapes). ~400 cheap steps, once
  function replayGround(h) {
    E.snowCover = 0; E.wet = 0;
    for (let t = Math.max(0, h - TUNE.replay); t < h; t += .25) {
      const w = E.weatherLock || spell(t).w, yr = ((t / (TUNE.seasonDays * 24)) % 4 + 4) % 4;
      stepGround(Math.min(.25, h - t), WEATHER[w] || WEATHER.fair, E.seasonLock || SEASONS[Math.floor(yr)]);
    }
  }
  // ---- weather: the clock's spell for the biome (sim/wxclock.js), the channels eased toward it
  function climate() { const C = CLIMATE[biome()] || CLIMATE.ruins; return C[E.season] || C.none || Object.values(C)[0]; }
  let easeS = 0;   // s: setWeather's own ease for the spell it set (0: TUNE.ease)
  function setSpell(w) { if (w !== E.weather) E.ver.weather++; E.weather = w; easeS = 0; }
  // ---- FRONTS (?wxtrans=0, the header): the edge's place along the wind (s, m: dot(x, dir)), which side the storm is on, the
  // channels ahead (A) and behind (B) of it, the player's distance ahead of it (up, m), the storm's share of the light (0..1).
  // TRANSITIONS use the same object for a front's edge (dir, s, up, storm; band, bend: their own, drawn per front)
  const FD = TUNE.front.dir, FL = Math.hypot(FD[0], FD[1]) || 1;
  const F = E.front = {on: false, n: 0, s: 0, dir: [FD[0] / FL, FD[1] / FL], arrive: true, A: {}, B: {}, up: 0, storm: 0, wob: 0,
    v: 0, band: [10, 8], bend: [0, 0, 0, 0, 0, 0], appr: TT.front.appr, at: {}};
  const darkOf = c => (c.cloud ?? 0) + (c.rain ?? 0) + (c.snow ?? 0) + (c.storm ?? 0);
  // the weather behind the edge's share at u m ahead of it (0 well ahead .. 1 well behind); the edge's bend at a point
  const behind = u => 1 - smooth((u + TUNE.front.band[0]) / (TUNE.front.band[0] + TUNE.front.band[1]));
  const bend = (x, y) => TUNE.front.wobble[0] * Math.sin((y * F.dir[0] - x * F.dir[1]) * 2 * Math.PI / TUNE.front.wobble[1] + F.wob);
  const aheadOf = (x, y) => x * F.dir[0] + y * F.dir[1] - F.s + bend(x, y);   // m ahead of the edge (downwind)
  function startFront(W) {
    const T = TUNE.front, p = focus && focus();
    if (!p) return false;
    const wet = c => (c.rain ?? 0) + (c.snow ?? 0) > .3;
    if (Math.abs((W.cloud ?? 0) - E.sky.cloud) < T.dCloud && wet(W) === wet(E.sky)) return false;
    for (const c of CH) { F.A[c] = E.sky[c]; F.B[c] = W[c] ?? (c === 'wind' ? 1 : 0); }
    F.arrive = darkOf(F.B) > darkOf(F.A); F.n++; F.wob = F.n * 2.17;
    F.s = 0; F.s = aheadOf(p.x, p.y) - T.lead;   // (the edge T.lead m upwind of the player, bend and all)
    F.on = true;
    return true;
  }
  function stepFront(dt) {
    const T = TUNE.front, p = focus();
    F.s += T.v * dt;
    const up = F.up = aheadOf(p.x, p.y), sd = F.arrive ? -1 : 1;   // (sd: the storm side's way along u)
    for (const c of CH) E.sky[c] = lerp(F.A[c], F.B[c], behind(up - sd * (T.at[c] ?? 0)));
    const St = F.arrive ? F.B : F.A, Cl = F.arrive ? F.A : F.B;
    if (WXL) {   // (wx-A shim: the merge takes B's FRONTS) two lights, no hold-then-swap: open = the clear side's channels, under =
      // the storm side's (render/lighting.js mixes them per pixel), light = the view's mean (the storm's share over the view along the wind)
      let ms = 0; for (let k = -2; k <= 2; k++) { const b = behind(up + k * T.view / 2); ms += (F.arrive ? b : 1 - b) / 5; }
      for (const c of CH) { E.open[c] = Cl[c]; E.under[c] = St[c]; E.light[c] = lerp(Cl[c], St[c], ms); }
      F.storm = ms;
    } else {
      // the light: the clear side's while it shows (arriving: until the edge leaves the view downwind; clearing: from when
      // it comes into the view upwind), crossed over T.fade m
      const vis = F.arrive ? smooth((up + T.view + T.fade) / (2 * T.fade)) : smooth((T.view + T.fade - up) / (2 * T.fade));
      for (const c of CH) E.light[c] = lerp(St[c], Cl[c], vis);
      F.storm = 1 - vis;
    }
    if (up < -(T.view + T.fade + T.band[0])) F.on = false;   // past the view: the spell's own channels from here
  }

  // ---- TRANSITIONS (the header). X: the running one (kind, commanded, its clock, the weather it started from (A) and goes to
  // (B), its phases' durations, a breakup's drizzle overcast (Dz) and remnants (Rm), a front's precursor sky (P))
  const X = {kind: null, cmd: false, t: 0, d0: 0, d1: 0, d2: 0, m0: 1, tau: 1, passed: -1, total: 1, U: 0,
    A: {}, B: {}, Dz: {}, Rm: {}, P: {}};
  const set = (o, a) => { for (const c of CH) o[c] = a[c]; };
  const mix = (o, a, b, k) => { for (const c of CH) o[c] = lerp(a[c], b[c], k); };
  const vary = () => 1 + (2 * R() - 1) * TT.vary;   // (+- TT.vary of a value: no two changes alike)
  // a front's edge (TT.front): m ahead of it at a point (downwind; its two bends across the way), its storm's share at u
  const bendN = (x, y) => { const a = y * F.dir[0] - x * F.dir[1], b = F.bend; return b[0] * Math.sin(a * b[1] + b[2]) + b[3] * Math.sin(a * b[4] + b[5]); };
  const uOf = (x, y) => x * F.dir[0] + y * F.dir[1] - F.s + bendN(x, y);
  const behindN = u => 1 - smooth((u + F.band[0]) / (F.band[0] + F.band[1]));
  // the view round the player: 16 points on its rim (TT.view), and 17 over it for its mean (centre + 8 at each TT.viewMean)
  const RIM = Float64Array.from({length: 32}, (_, i) => (i & 1 ? Math.sin : Math.cos)((i >> 1) / 16 * 2 * Math.PI));
  function rimU(p, most, r) {   // the least / most u on a circle of r m round the player
    let m = most ? -1e9 : 1e9;
    for (let i = 0; i < 16; i++) { const u = uOf(p.x + RIM[i * 2] * r, p.y + RIM[i * 2 + 1] * r); m = most ? Math.max(m, u) : Math.min(m, u); }
    return m;
  }
  function viewUnder(p) {   // the view's mean share behind the edge
    let s = behindN(uOf(p.x, p.y));
    for (let j = 0; j < TT.viewMean.length; j++) { const r = TT.viewMean[j]; for (let i = 0; i < 16; i += 2) s += behindN(uOf(p.x + RIM[i * 2] * r, p.y + RIM[i * 2 + 1] * r)); }
    return s / (1 + 8 * TT.viewMean.length);
  }
  // the deck over the cloud field at a point: 1 under it, .5 its rim, 0 a gap (core/cloudfield.js, the drift as the sim has it)
  const deckAt = (x, y) => {
    const D = E.deck; if (!D.mode || D.cover <= 0) return 0; if (D.cover >= 1) return 1;
    const d = density(x, y, AL.o); return d >= D.q ? 1 : d >= D.q - D.rim ? .5 : 0;
  };
  // the view's share under the deck: its mean over the same 17 points (the view is a few cloud cells across: a breaking deck
  // over it can be far from its cover), eased over TT.meanEase s (patches racing by don't make the mean light flicker)
  function viewDeck(p, dt) {
    let s = deckAt(p.x, p.y);
    for (let j = 0; j < TT.viewMean.length; j++) { const r = TT.viewMean[j]; for (let i = 0; i < 16; i += 2) s += deckAt(p.x + RIM[i * 2] * r, p.y + RIM[i * 2 + 1] * r); }
    X.U += (s / (1 + 8 * TT.viewMean.length) - X.U) * (1 - Math.exp(-dt / TT.meanEase));
  }
  const wetOf = c => (c.rain ?? 0) + (c.snow ?? 0) > .3;
  // which kind a change is: rain / snow arriving on a dry sky a front; a wet or heavy sky clearing to a fairer one a breakup
  function kindOf(A, B) {
    if (wetOf(B) && !wetOf(A)) return 'front';
    if (!wetOf(B) && B.cloud < .8 && (wetOf(A) || A.cloud >= .85) && A.cloud - B.cloud >= .25) return 'breakup';
    return 'ease';
  }
  // each change: the wind aloft veers somewhere round the prevailing one, draws its speed and which side layer B turns to
  function newAloft(cmd) {
    const a = A0 + (2 * R() - 1) * TT.veer * Math.PI / 180;
    AL.want[0] = Math.cos(a); AL.want[1] = Math.sin(a); AL.base = lerp(TT.aloft[0], TT.aloft[1], R()); AL.turn = R() < .5 ? -1 : 1;
    AL.tau = TT.turn[cmd ? 1 : 0];
  }
  function startTrans(W, kind, cmd) {
    const p = focus && focus(), i = cmd ? 1 : 0;
    if (kind === 'front' && !p) kind = 'ease';
    for (const c of CH) { X.A[c] = E.sky[c]; X.B[c] = W[c] ?? (c === 'wind' ? 1 : 0); }
    X.kind = kind; X.cmd = cmd; X.t = 0; X.passed = -1; newAloft(cmd);
    const A = X.A, B = X.B, D = E.deck, tr = E.trans;
    tr.kind = kind; tr.phase = ''; tr.k = 0; tr.t = 0;
    if (kind === 'breakup') {
      const T = TT.breakup; X.d0 = T.close; X.d1 = T.ease[i] * vary(); X.d2 = T.brk[i] * vary(); X.total = X.d0 + X.d1 + X.d2;
      // the drizzle overcast the downpour eases to, and what's left of the deck as it goes (its shade, no rain)
      X.Dz.cloud = Math.min(A.cloud, T.deck); X.Dz.fog = Math.min(A.fog, Math.max(B.fog, .1)); X.Dz.storm = 0; X.Dz.wind = lerp(A.wind, B.wind, .45);
      X.Dz.rain = Math.min(A.rain, T.drizzle); X.Dz.snow = Math.min(A.snow, T.drizzle);
      X.Rm.cloud = Math.max(B.cloud, T.remnant); X.Rm.fog = B.fog; X.Rm.rain = X.Rm.snow = X.Rm.storm = 0; X.Rm.wind = B.wind;
      D.mode = 1; D.cover = 0; F.on = false;
    } else if (kind === 'front') {
      const T = TT.front;
      F.dir[0] = AL.want[0]; F.dir[1] = AL.want[1]; F.arrive = true; F.n++;
      F.v = T.v[i] * vary(); X.d0 = T.pre[i] * vary(); X.d2 = T.settle[i];
      F.band[0] = T.band[0] * vary(); F.band[1] = T.band[1] * vary();
      for (let j = 0; j < 2; j++) { F.bend[j * 3] = T.bend[j][0] * vary(); F.bend[j * 3 + 1] = 2 * Math.PI / (T.bend[j][1] * vary()); F.bend[j * 3 + 2] = R() * 2 * Math.PI; }
      for (const c of CH) F.at[c] = T.at[c] ?? 0;
      F.at.rain *= vary(); F.at.snow = F.at.rain;
      // the precursors' sky: heavier, windier, the light flatter (open eases to it while the wall is still outside the view)
      set(X.P, A); X.P.cloud = Math.max(A.cloud, T.preCloud); X.P.wind = lerp(A.wind, B.wind, .5); X.P.fog = Math.min(1, A.fog + .04);
      // the edge: placed so that its wall shows (the deck's share there ~.12: its torn tips) at TT.viewIn m from the player (the
      // nearest point, bends and all) as the precursors end
      F.s = 0; F.s = rimU(p, false, TT.viewIn) - (F.band[1] - .23 * (F.band[0] + F.band[1])) - F.v * X.d0;
      X.total = X.d0 + (2 * TT.view + F.band[0] + F.band[1] + 2 * (F.bend[0] + F.bend[3])) / F.v + X.d2;
      D.mode = 2; D.cover = 1; F.on = true;
    } else {
      X.tau = cmd ? TT.ease : easeS || TUNE.ease; X.m0 = 0;
      for (const c of CH) X.m0 = Math.max(X.m0, Math.abs(B[c] - A[c]));
      X.m0 = Math.max(X.m0, 1e-3); D.mode = 0; F.on = false;
    }
  }
  function endTrans() {
    set(E.sky, X.B); set(E.open, X.B); set(E.under, X.B); set(E.light, X.B);
    X.kind = null; X.U = 0; E.deck.mode = 0; E.deck.cover = 0; F.on = false; AL.boost = 1;
    const tr = E.trans; tr.kind = null; tr.phase = ''; tr.k = 1;
  }
  // a new change while one runs (a command clicked mid-way): the view as it is (its mean) is where the new one starts from
  function collapse() {
    set(E.sky, E.light); set(E.open, E.light); set(E.under, E.light);
    X.kind = null; X.U = 0; E.deck.mode = 0; E.deck.cover = 0; F.on = false; AL.boost = 1; E.trans.kind = null;
  }
  function stepTrans(dt) {
    X.t += dt;
    const tr = E.trans, A = X.A, B = X.B, O = E.open, Un = E.under, D = E.deck;
    tr.t = X.t;
    if (X.kind === 'breakup') {
      let t = X.t;
      if (t < X.d0) { tr.phase = 'close'; set(O, A); set(Un, A); D.cover = smooth(t / X.d0); }   // (nothing changes but the old sky's shadows going)
      else if ((t -= X.d0) < X.d1) { tr.phase = 'ease'; set(O, B); mix(Un, A, X.Dz, smooth(t / X.d1)); D.cover = 1; }
      else if ((t -= X.d1) < X.d2) {
        const k = t / X.d2; tr.phase = 'break'; set(O, B); mix(Un, X.Dz, X.Rm, smooth(k));
        const dry = 1 - smooth(k / TT.breakup.dry); Un.rain = X.Dz.rain * dry; Un.snow = X.Dz.snow * dry;   // (the rain stops everywhere)
        D.cover = 1 - smooth(k);   // (the gaps open slowly, grow, merge; the last patches thin out slowly)
      } else return endTrans();
      const p = focus && focus(); if (p && tr.phase === 'break') viewDeck(p, dt); else X.U = D.cover;   // (closed: all of it)
      mix(E.light, O, Un, X.U); set(E.sky, E.light);   // (the player's weather: the view's mean, not a gap's flicker)
    } else if (X.kind === 'front') {
      const p = focus();
      if (X.passed < 0) {
        F.s += F.v * dt;
        const kp = smooth(X.t / X.d0);
        mix(O, A, X.P, kp); set(Un, B); AL.boost = 1 + (TT.front.boost - 1) * kp;
        tr.phase = X.t < X.d0 ? 'pre' : 'wall';
        const up = F.up = uOf(p.x, p.y);
        X.U = viewUnder(p);
        for (const c of CH) E.sky[c] = lerp(O[c], Un[c], behindN(up + F.at[c]));
        // past: the whole view behind the edge (the deck everywhere in it): the storm's sky from here, its deck settles
        if (rimU(p, true, TT.view) < -F.band[0] - .5) { X.passed = X.t; F.on = false; D.mode = 1; D.cover = 1; set(O, B); set(E.sky, B); }
      } else {
        const k = (X.t - X.passed) / X.d2;
        tr.phase = 'settle'; set(O, B); set(Un, B); set(E.sky, B); D.cover = 1 - smooth(k); viewDeck(p, dt); AL.boost = 1;
        if (k >= 1) return endTrans();
      }
      mix(E.light, O, Un, X.U);
    } else {   // 'ease'
      const k = 1 - Math.exp(-dt / X.tau); let m = 0;
      for (const c of CH) { E.sky[c] += (B[c] - E.sky[c]) * k; m = Math.max(m, Math.abs(B[c] - E.sky[c])); }
      set(O, E.sky); set(Un, E.sky); set(E.light, E.sky); tr.phase = 'ease'; tr.k = 1 - m / X.m0;
      if (m < .004) return endTrans();
      return;
    }
    tr.k = Math.min(1, X.t / X.total);
  }
  // the readings the renderers build on (the header): the deck's density, the sun's share of the view, how broken the sky is
  const dk = c => c.cloud + .5 * (c.rain + c.snow + c.storm);   // (how dark a sky is: the deck against the open sky)
  function derive() {
    const O = E.open, Un = E.under, U = X.U, D = E.deck;
    D.q = coverQ(D.cover); D.rim = TT.rim;
    E.sunView = (1 - U) * (1 - .9 * O.cloud);
    const c = O.cloud, cO = c < .13 ? 0 : Math.min(.78, .08 + .62 * c), wetK = clamp(O.rain + O.snow + O.storm + O.fog, 0, 1);
    const steady = 2 * cO * (1 - cO) * clamp((c - .4) / .2, 0, 1) * clamp((.92 - c) / .2, 0, 1) * (1 - wetK);
    E.broken = Math.max(4 * U * (1 - U) * clamp(1.5 * (dk(Un) - dk(O)), 0, 1), steady);
    F.storm = U;
  }
  // the wind aloft: swings toward the change's way, its speed with the view's wind (and a front's precursors; eased over 2 s), the cloud
  // field's layers drifting on it (A with it; B turned and slower; the warp slower still), wrapped at whole periods
  function stepAloft(dt) {
    const Wd = TT.wander, tw = 2 * Math.PI * AL.t, wa = FIELD_V2 ? Wd.deg * Math.PI / 180 * (.6 * Math.sin(tw / Wd.T[0] + 1.3) + .4 * Math.sin(tw / Wd.T[1] + 4.1)) : 0;
    const wv = FIELD_V2 ? 1 + Wd.v * Math.sin(tw / Wd.T[2] + 2.2) : 1;   // (the wander: a function of the sim's clock, no draws)
    const a = Math.atan2(AL.dir[1], AL.dir[0]); let d = Math.atan2(AL.want[1], AL.want[0]) + wa - a; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    const na = a + d * (1 - Math.exp(-dt / AL.tau)), dx = AL.dir[0] = Math.cos(na), dy = AL.dir[1] = Math.sin(na);
    const v = AL.v += (AL.base * wv * (TT.windK[0] + TT.windK[1] * E.light.wind) * AL.boost - AL.v) * (1 - Math.exp(-dt / 2)), V = AL.vel;   // (eased: never a jump in speed)
    if (FIELD_V2) {   // all of it with the wind (o[0..1], never wrapped: core/cloudfield.js); the warp under it slowly against it (o[2])
      V[0] = dx * v; V[1] = dy * v; V[2] = TT.evo * AL.turn; V[3] = V[4] = V[5] = 0;
    } else {
      const tb = TT.layerB[0] * Math.PI / 180 * AL.turn, cb = Math.cos(tb), sb = Math.sin(tb), vb = v * TT.layerB[1];
      V[0] = dx * v; V[1] = dy * v; V[2] = (dx * cb - dy * sb) * vb; V[3] = (dx * sb + dy * cb) * vb; V[4] = dx * v * TT.warp; V[5] = dy * v * TT.warp;
    }
    for (let i = 0; i < 6; i++) AL.o[i] += V[i] * dt;
    wrapDrift(AL.o); AL.t += dt;
  }
  // the storm's share at a world point (0: the clear side's weather .. 1: the storm's), -1 without a front (a breakup: its
  // deck there); a channel of the weather felt at a world point (features/weather.js: the rain falls where the storm is, under
  // the deck), = sky with nothing changing
  E.frontAt = (x, y) => {
    if (OLD) { if (!F.on) return -1; const b = behind(aheadOf(x, y)); return F.arrive ? b : 1 - b; }
    return X.kind === 'front' && F.on ? behindN(uOf(x, y)) : E.deck.mode ? deckAt(x, y) : -1;
  };
  E.skyAt = (x, y, c) => {
    if (OLD) return F.on ? lerp(F.A[c], F.B[c], behind(aheadOf(x, y) - (F.arrive ? -1 : 1) * (TUNE.front.at[c] ?? 0))) : E.sky[c];
    if (X.kind === 'front' && F.on) return lerp(E.open[c], E.under[c], behindN(uOf(x, y) + F.at[c]));
    if (E.deck.mode) return lerp(E.open[c], E.under[c], deckAt(x, y));
    return E.sky[c];
  };
  function stepWeather(dt, dh) {
    const b = biome();
    if (b !== lastBiome) {   // a new biome: its climate takes over at once (no snow carried into the ember wastes)
      lastBiome = b; const C = climate();
      if (!E.weatherLock && !(E.weather in C)) { setSpell(spell().w); instant = true; }
    }
    const busy = OLD ? F.on : !!X.kind;
    if (E.weatherLock) { if (E.weather !== E.weatherLock) { E.weather = E.weatherLock; E.ver.weather++; } }
    else { const w = spell().w; if (w !== E.weather && (!busy || (!TUNE.precip && WEATHER[E.weather]?.precip))) setSpell(w); }   // (a natural spell waits for a change to pass)
    const W = WEATHER[E.weather] || WEATHER.fair;
    if (E.weather !== lastW) {   // a new spell: a front / breakup / ease, or the plain ease (an omen's own ease, a new biome)
      const inst = instant || easeS > 0, cmd = cmdNext; lastW = E.weather; instant = false; cmdNext = false;
      if (OLD) { if (inst || !startFront(W)) F.on = false; }
      else { if (X.kind) collapse(); startTrans(W, inst ? 'ease' : kindOf(E.sky, W), cmd && !inst); }
    }
    if (OLD) {
      if (F.on) stepFront(dt);
      else {
        const k = 1 - Math.exp(-dt / (easeS || TUNE.ease));
        for (const c of CH) { E.sky[c] += ((W[c] ?? (c === 'wind' ? 1 : 0)) - E.sky[c]) * k; E.light[c] = E.open[c] = E.under[c] = E.sky[c]; }
        F.storm = 0;
      }
      const tr = E.trans; tr.kind = F.on ? 'front' : null; tr.phase = F.on ? (F.arrive ? 'arrive' : 'clear') : ''; tr.k = F.on ? 1 - F.storm : 0;
      E.sunView = 1 - .9 * E.light.cloud; E.broken = 0;
    } else {
      if (X.kind) stepTrans(dt);
      else {   // (steady: the last bit of the ease, open = under = light = sky)
        const k = 1 - Math.exp(-dt / (easeS || TUNE.ease));
        for (const c of CH) { E.sky[c] += ((W[c] ?? (c === 'wind' ? 1 : 0)) - E.sky[c]) * k; E.light[c] = E.open[c] = E.under[c] = E.sky[c]; }
      }
      derive();
    }
    stepAloft(dt);
    E.windLevel = E.sky.wind;
  }
  E.step = dt => {
    const dh = E.frozen ? 0 : dt / DAY() * 24;
    hours += dh; syncClock(); stepWeather(dt, dh); stepGround(E.frozen ? dt / 50 : dh);   // (a stopped clock still lets the ground follow the weather)
    if ((saveT -= dt) <= 0) { saveT = 15; save(); }
  };

  // ---- the mood: the day's keyframes blended, then the weather
  // TWO LIGHTS (render/lighting.js): mood(bid) is the light of env.light (the view's mean: what one light for the whole view
  // reads); moodFor(bid, channels, out?) the same from any channel set: lighting.js lights the sun's side by env.open's and what
  // lies under the deck by env.under's and the composite mixes the two per pixel (gfx.js COMP_FS, the clouds' under share).
  // out: the caller's record (blankMood() makes one; one per caller, reused: no allocation a call), else one kept per biome.
  // lightSides() -> {open, under, two}: the channel sets now (env.light for both while a preview shows: photo mode sets sky /
  // light, not open / under) and whether they differ (a front or a breaking deck: two lights this frame). ?wxlight=0: never
  // (the old one light, swapped as a front passes, and the storm side's albedo fake: features/depth.js, gfx.js COMP_FS frD)
  const WXL = Q.get('wxlight') !== '0';
  const blank = () => ({amb: [0, 0, 0], sun: {az: 0, el: 0, c: [0, 0, 0], k: 0, rim: 0}, shadow: {a: 0, c: [0, 0, 0], ao: .5}, fog: [0, 0, 0, 0], lift: [0, 0, 0], fill: [0, 0, 0], glow: 0});
  const out = {}, outFor = {}, tmp = {a: null, b: null};
  const moodOf = (M, name) => name === 'dawn' ? M.dusk : M[name];
  const mixArr = (o, a, b, k, n) => { for (let i = 0; i < n; i++) o[i] = lerp(a?.[i] ?? 0, b?.[i] ?? 0, k); };
  const angMix = (a, b, k) => { const d = ((b - a + 540) % 360) - 180; return (a + d * k + 360) % 360; };
  E.blankMood = blank;
  E.mood = (bid = biome()) => E.moodFor(bid, E.light, out[bid] ||= blank());
  const SIDES = {open: E.light, under: E.light, two: false};
  E.lightSides = () => {
    const pv = !!truth, o = SIDES.open = !pv && E.open || E.light, u = SIDES.under = !pv && E.under || E.light;
    let d = 0; if (WXL && o !== u) for (let i = 0; i < CH.length; i++) d = Math.max(d, Math.abs((o[CH[i]] ?? 0) - (u[CH[i]] ?? 0)));
    SIDES.two = d > 1e-3;
    return SIDES;
  };
  E.moodFor = (bid = biome(), S = E.light, o = outFor[bid] ||= blank()) => {
    const M = moods[bid] || moods.ruins, h = E.hour;
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
    const c = S.cloud, lum = o.amb[0] * .3 + o.amb[1] * .55 + o.amb[2] * .15;   // (S: the channels this light is of)
    o.sun.k *= 1 - .55 * c; o.shadow.a *= 1 - .8 * c;
    const HZ = bid === 'desert' ? DUST : HAZE, dust = bid === 'desert' ? DUST_K * clamp((S.wind - 1.2) / 1.6, 0, 1) : 0;
    const wash = bid === 'desert' ? 0 : WET.k * Math.min(1, S.rain + .5 * S.storm + .25 * Math.max(0, c - .6) / .4);
    for (let j = 0; j < 3; j++) {
      o.amb[j] = lerp(o.amb[j], lum * GREY[j], .35 * c) * (1 - .1 * c - .12 * S.rain - .2 * S.storm) * (1 + (WET.c[j] - 1) * wash);
      o.sun.c[j] = lerp(o.sun.c[j], .85, .5 * c);
      o.fog[j] += HZ[j] * (.05 * c + .1 * S.rain + .16 * S.fog + .08 * S.snow) + WET.haze[j] * WET.veil * wash;
      if (dust) o.fog[j] += DUST[j] * dust;
    }
    o.fog[3] = Math.min(.5, o.fog[3] + .05 * c + .1 * S.rain + .16 * S.fog + .08 * S.snow + WET.a * wash);
    if (dust) o.fog[3] = Math.min(.5, o.fog[3] + dust);
    o.glow *= 1 + .3 * c;
    for (let j = 0; j < grades.length; j++) grade(o, grades[j].g);   // another system's grade on top (setGrade, below)
    return o;
  };
  // GRADES: another system's colour grade over the mood (features/omens.js: a blood moon, an eclipse), at its own k (0..1,
  // eased by its owner): amb / sun (the sun's or moon's colour) / lift / fill: [r, g, b] multipliers; sunK, shadow (the
  // shadows' opacity), glow: multipliers; fog: [r, g, b, a] added. Presentation only: nothing in the sim reads mood().
  //   env.setGrade(source, g) (g: the caller's object, read live) / env.clearGrade(source)
  const grades = [], mulK = (v, m, k) => v * (1 + (m - 1) * k);
  function grade(o, g) {
    const k = clamp(g.k ?? 1, 0, 1); if (k <= 0) return;
    for (let j = 0; j < 3; j++) {
      if (g.amb) o.amb[j] = mulK(o.amb[j], g.amb[j], k);
      if (g.sun) o.sun.c[j] = mulK(o.sun.c[j], g.sun[j], k);
      if (g.lift) o.lift[j] = mulK(o.lift[j], g.lift[j], k);
      if (g.fill) o.fill[j] = mulK(o.fill[j], g.fill[j], k);
      if (g.fog) o.fog[j] += g.fog[j] * k;
    }
    if (g.fog) o.fog[3] = Math.min(.7, o.fog[3] + g.fog[3] * k);
    if (g.sunK !== undefined) o.sun.k = mulK(o.sun.k, g.sunK, k);
    if (g.shadow !== undefined) o.shadow.a = mulK(o.shadow.a, g.shadow, k);
    if (g.glow !== undefined) o.glow = mulK(o.glow, g.glow, k);
  }
  E.setGrade = (src, g) => { const i = grades.findIndex(e => e.src === src); if (i >= 0) grades[i].g = g; else grades.push({src, g}); };
  E.clearGrade = src => { const i = grades.findIndex(e => e.src === src); if (i >= 0) grades.splice(i, 1); };
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
  // (ease: s, this spell's channels ease toward it faster or slower than TUNE.ease: an omen's storm rolls in over a few s.
  // Without one the change is COMMANDED (the cheat panel, the dev menu: TRANSITIONS start close); how 'natural': paced as a
  // natural spell's (tests, dev))
  E.setWeather = (w, ease = 0, how = '') => { E.weatherLock = WEATHER[w] ? w : null; if (!E.weatherLock) setSpell(spell().w); easeS = ease; cmdNext = ease <= 0 && how !== 'natural'; };   // (no lock: the clock's own spell again)
  // dev (the weather panel, probes): a settled weather at once: locked, every channel set (sky, light, open, under), no change on
  // its way (no front, no deck), the ground wet under rain / snowed under snow (wet: a wetness to set as well, 0..1)
  E.settle = (w, wet = null) => {
    if (!WEATHER[w]) return;
    const W = WEATHER[w];
    E.weatherLock = w; if (E.weather !== w) { E.weather = w; E.ver.weather++; }
    lastW = w; instant = cmdNext = false; easeS = 0;
    X.kind = null; X.U = 0; F.on = false; E.deck.mode = 0; E.deck.cover = 0; AL.boost = 1;
    const tr = E.trans; tr.kind = null; tr.phase = ''; tr.k = 1; tr.t = 0;
    for (const c of CH) E.sky[c] = E.light[c] = E.open[c] = E.under[c] = W[c] ?? (c === 'wind' ? 1 : 0);
    if (W.rain) E.wet = 1; if (wet != null) E.wet = clamp(wet, 0, 1);
    if (W.snow && SEASONAL[biome()]) E.snowCover = 1;
    E.windLevel = E.sky.wind;
    if (!OLD) derive(); else { E.sunView = 1 - .9 * E.light.cloud; E.broken = 0; }
  };
  E.setDayMinutes = m => { if (m <= 0) E.frozen = true; else { E.frozen = false; TUNE.dayMinutes = m; } };
  // co-op (features/coop.js): the server owns the world's clock; the page follows it (setT: in-game hours since the start) and
  // doesn't keep a borrowed clock as its own (borrowed: save() skips it, so playing offline again goes on from where it was)
  E.borrowed = false;
  // a jump of more than TUNE.replayJump hours (a welcome from a server whose world is elsewhere in its year): the ground's memory
  // replayed from the clock's own weather (replayGround), so a late joiner's snow and wet ground are everyone's
  E.setT = h => { if (isFinite(h)) { const far = Math.abs(h - hours) > TUNE.replayJump; hours = h; syncClock(); if (far) replayGround(h); } };
  E.spellAt = h => spell(h);   // (the clock's spell at an in-game hour: tests, the wrong weather's scheduling)
  // ---- PREVIEW (ui/photo.js: photo mode, while the sim stands still): another hour, point of the year, weather or wind
  // shown through every reading above (hour, part, season, year, leafK, autumn, sky, windLevel, weather, the ground's snow
  // and wet, so mood(), leafRamp() and every view follow) without touching the truth: the clock, the spell, its generator
  // and the ground's memory stay as they are. preview(null) puts every reading back exactly as it was, the change
  // counters (ver) too: a view that saw the preview sees them differ and refreshes, a sim system that didn't sees no change.
  // Nothing may step the clock (env.step) or call its setters while a preview is on (photo mode holds the sim).
  //   env.preview({hour?: 0..24, year?: 0..4 (spring .. winter; seasonal biomes), weather?: a WEATHER key, wind?: a level}) | null
  //   env.previewing (bool). Snow / rain previewed lie on the ground (snowCover / wet 1); a season other than winter melts it
  const READINGS = ['hour', 'day', 't', 'part', 'bucket', 'season', 'seasonNext', 'seasonK', 'seasonal', 'tinted', 'year', 'leafK', 'leafFall', 'autumn',
    'weather', 'windLevel', 'snowCover', 'wet', 'sunView', 'broken'];
  const SETS = ['sky', 'light', 'open', 'under', 'trans', 'deck'];   // (objects: their fields saved and put back)
  E.preview = o => {
    if (!o) {
      if (!truth) return;
      pv = null; for (const k of READINGS) E[k] = truth.r[k];
      for (const k of SETS) Object.assign(E[k], truth[k]); Object.assign(E.ver, truth.ver); F.on = truth.front;
      leafKey = truth.leafKey; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) leafOut[i][j] = truth.leaf[i * 3 + j];
      truth = null; return;
    }
    if (!truth) {   // (once, as the preview begins)
      const r = {}; for (const k of READINGS) r[k] = E[k];
      truth = {r, ver: {...E.ver}, leafKey, leaf: leafOut.flat(), front: F.on};
      for (const k of SETS) truth[k] = {...E[k]};
    }
    pv = o; syncClock();
    const T = truth.r, w = WEATHER[o.weather] ? o.weather : T.weather, W = WEATHER[w];
    if (w !== E.weather) { E.weather = w; E.ver.weather++; }
    for (const k of SETS) Object.assign(E[k], truth[k]);
    if (WEATHER[o.weather]) {   // (at once, everywhere: the world stands still; no front, no deck, no change on its way)
      for (const c of CH) E.sky[c] = E.light[c] = E.open[c] = E.under[c] = W[c] ?? (c === 'wind' ? 1 : 0);
      E.deck.mode = 0; E.deck.cover = 0; E.trans.kind = null; E.trans.phase = ''; E.sunView = 1 - .9 * E.light.cloud; E.broken = 0;
    }
    F.on = WEATHER[o.weather] ? false : truth.front;
    if (o.wind != null) E.sky.wind = E.light.wind = E.open.wind = E.under.wind = o.wind;
    E.windLevel = E.sky.wind;
    const sn = SEASONAL[biome()], shown = WEATHER[o.weather];
    E.snowCover = sn && shown && W.snow ? 1 : sn && o.year != null && E.season !== 'winter' && E.seasonNext !== 'winter' ? 0 : T.snowCover;
    E.wet = shown && W.rain ? 1 : T.wet;
  };
  Object.defineProperty(E, 'previewing', {get: () => !!truth, enumerable: false});
  E.clock = () => { const h = Math.floor(E.hour), m = Math.floor((E.hour - h) * 60); return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`; };
  E.label = () => `${E.clock()} ${E.part} · day ${E.day + 1}${E.seasonal ? ' · ' + E.season + (E.seasonK > .02 ? ' -> ' + E.seasonNext : '') : ''} · ${E.weather}`;
  if (url.time && PART_H[url.time] !== undefined) E.setPart(url.time);   // the old ?time=day|dusk|night
  syncClock(); lastBiome = biome();
  if (!E.weatherLock) E.weather = spell().w;   // (the clock's spell, settled: a page opens on the world's weather as it is)
  for (const c of CH) E.sky[c] = E.light[c] = E.open[c] = E.under[c] = (WEATHER[E.weather] || WEATHER.fair)[c] ?? (c === 'wind' ? 1 : 0);
  E.windLevel = E.sky.wind; E.sunView = 1 - .9 * E.light.cloud;
  lastW = E.weather; instant = !!E.weatherLock && E.weatherLock !== E.weather;   // (a ?weather= lock eases in from where the sky was set above, as before: no front)
  return E;
}
