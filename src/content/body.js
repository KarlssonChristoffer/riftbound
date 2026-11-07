// BODY (data + pure rules; docs/WEATHER.md): how the weather gets into a body. Two numbers each player carries, never shown as
// numbers: WET (0 dry .. 1 soaked) and COLD (0 warm .. 1 frozen through). Rain soaks you unless you're under something, a fire
// or the sun dries you, a winter night, wind on wet clothes or a blizzard chill you, a fire or a meal warms you. What they do
// is modifier notes on the owners' stats (features/body.js sets them; the player's speeds, the tool's rhythm), and what they
// look like is on the character (drips, steam, breath, frost at the screen's edges). Pure: the co-op server can read it.
//   TUNE       the knobs (s from one end to the other, so they read as times)
//   SHELTER    how much each tree's crown keeps off (r: its radius in m at scale 1, k: the share of rain it stops; deciduous
//              crowns by how full they are: env.leafK)
//   packBody / unpackBody: a body's look in the co-op player message (st.bd, the snapshot's row: friends see it)
// Gear (content/gear.js mods): 'body.soak' (mul: how fast rain soaks you: the hood .3), 'body.chill' (mul: how fast cold
// builds: the wool pieces and the fur cloak), 'body.wetHeavy' (add: soaked, it slows you: the wool sweater).
export const TUNE = {
  // WET: s from dry to soaked in rain at full (no hood, no shelter); a drizzle (rain under .45) and a storm; s from soaked to
  // dry by a fire (within warm.reach), in the sun, under an overcast (any sky that isn't raining on you), in the cave (still air)
  soak: {rain: 90, drizzle: 240, storm: 40}, dry: {fire: 30, sun: 240, overcast: 600, cave: 900},
  // swimming soaks you at once; wading wets you up to wade (the legs), over wadeS s
  wade: .55, wadeS: 6,
  // COLD: s from warm to cold through on a winter night, soaked in a wind (wet over .5, wind over windMin), in a blizzard; a
  // winter day and an autumn night chill slower; a fire warms you through in fire s (within warm.reach m); anywhere that
  // doesn't chill you, you warm in recover s. A meal eaten (features/meals.js) holds the cold off while it lasts
  cold: {winterNight: 180, winterDay: 420, autumnNight: 480, wetWind: 120, blizzard: 90, windMin: 1.6, wetMin: .5},
  warm: {fire: 20, reach: 3.5, recover: 150},
  // what COLD does at full (eased in from coldFrom): walk / run slower, no sprint (its speed down to the run's), the tool's
  // rhythm window narrower; what WET does at full with a heavy piece on (body.wetHeavy): slower
  effects: {coldFrom: .35, walk: -.15, rhythm: .5, wetHeavy: -.05},
  // notes are set when a reading crosses a step (no per-step churn of host.mods): wet / cold in tenths, the wind in q of a share
  q: 10, windQ: .02,
  // WIND (the open fell, the lake's ice): the push (m/s along the wind) per wind level (sim/env.js: breeze 1, windy 2.1, storm
  // 2.8, gale 3), x under on the way down (a tree's shelter at full), x fell on the high ground (over fellH m: the fell top);
  // turned into the 'player.windX / windY' share the player reads (sim/player/adapter.js: of his speed) over run m/s; what he
  // shoots drifts with it: proj m/s^2 on an arrow at the gale's push (half the gale omen's, content/omens.js), less with less push
  wind: {push: [[1.5, 0], [2.1, .4], [2.8, 1.1], [3, 1.6]], under: .2, fell: 1.5, fellH: 14, run: 3, proj: 6},
  // the look: drips while wet over drip; breath while cold over breath (and on any winter morning or night); steam off wet
  // clothes by a fire; frost creeping in at the screen's edges from frost
  look: {drip: .25, breath: .3, steam: .2, frost: .45},
};
export const SHELTER = {
  pine: {r: 1.7, k: .85}, oak: {r: 2.4, k: .8, leaf: true}, willow: {r: 2, k: .6, leaf: true}, birch: {r: 1.5, k: .5, leaf: true},
  aspen: {r: 1.3, k: .5, leaf: true}, rowan: {r: 1.4, k: .55, leaf: true}, dead: {r: 1, k: .05},
};
// a tree's shelter at d m from its trunk (0..1): full under the inner half of its crown, fading to its rim
export function crownCover(species, scale, d, leafK = 1) {
  const S = SHELTER[species]; if (!S) return 0;
  const r = S.r * (scale || 1), k = S.k * (S.leaf ? .25 + .75 * leafK : 1);
  return d >= r ? 0 : d <= r * .5 ? k : k * (1 - (d - r * .5) / (r * .5));
}
// the wind's push (m/s) at a wind level
export function windPush(level) {
  const P = TUNE.wind.push; if (level <= P[0][0]) return 0;
  for (let i = 1; i < P.length; i++) if (level <= P[i][0]) return P[i - 1][1] + (P[i][1] - P[i - 1][1]) * (level - P[i - 1][0]) / (P[i][0] - P[i - 1][0]);
  return P[P.length - 1][1];
}
// how fast rain soaks (per s, before the gear's note and the shelter): rain 0..1 where he stands, storm 0..1
export function soakRate(rain, storm) {
  if (rain <= .02) return 0;
  const T = TUNE.soak, s = storm > .5 ? T.storm : rain < .45 ? T.drizzle : T.rain;
  return Math.min(1, rain / .8) / s;
}
// how fast cold builds (per s, before the gear's note): the season, night or day, wet, the wind level, a blizzard (snow + storm)
export function chillRate(season, night, wet, wind, snow, storm) {
  const C = TUNE.cold; let r = 0;
  if (season === 'winter') r = 1 / (night ? C.winterNight : C.winterDay);
  else if (season === 'autumn' && night) r = 1 / C.autumnNight;
  if (wet > C.wetMin && wind > C.windMin) r = Math.max(r, 1 / C.wetWind);
  if (snow > .5 && storm > .3) r = Math.max(r, 1 / C.blizzard);
  return r;
}
// a gear note in words (ui/geartip.js), or '' when it isn't the body's
export function statWords(m) {
  const pct = k => Math.round(Math.abs(k) * 100) + '%';
  if (m.stat === 'body.soak') return `keeps the rain off: soaked ${pct(1 - m.mul)} slower`;
  if (m.stat === 'body.chill') return `warm in the cold: the cold sets in ${pct(1 - m.mul)} slower`;
  if (m.stat === 'body.wetHeavy') return 'heavy when soaked';
  return '';
}
// a body's look in 16 bits: wet (3 bits), cold (3), sunk (3: how deep in a mire or the ice, part of .8 m), down (1: knocked flat),
// smoulder (1: his wool sweater puffs); unpackBody(n, out) -> out {wet, cold, sunk, down, smoulder} (0..1 and booleans)
export const packBody = (wet, cold, sunk = 0, down = false, smoulder = false) =>
  (Math.round(Math.min(1, Math.max(0, wet)) * 7)) | (Math.round(Math.min(1, Math.max(0, cold)) * 7) << 3) | (Math.round(Math.min(1, Math.max(0, sunk)) * 7) << 6) | (down ? 512 : 0) | (smoulder ? 1024 : 0);
export function unpackBody(n, o) { n |= 0; o.wet = (n & 7) / 7; o.cold = ((n >> 3) & 7) / 7; o.sunk = ((n >> 6) & 7) / 7; o.down = !!(n & 512); o.smoulder = !!(n & 1024); return o; }
