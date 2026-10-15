// MINING (data; docs/MINING.md): what the cave's veins give under the pick. The veins themselves are the cave's plan
// (world/caves.js C.veins: placed from the seed, a vein's id is its index there, 'v' + i: the same on every client and the
// co-op server). Pure data and pure functions: the browser (features/mining.js) and the co-op server (server/room.mjs: it keeps
// the blows left on a vein, rolls each striker's chunks, grows spent veins back) read this one file.
//   VEINS     kind -> item (content/items.js), blows (at power 1), n [min, max] chunks a striker gets, tier (the pick it asks
//             for: content/items.js tool.tier), xp a blow that bites / the vein spent (x 4), col (sparks and grit); the living dark's
//             (docs/CAVELIFE.md): night (shows only in the dark: TUNE.night), hollow (a hollow wall's rubble plug: it never comes
//             back once broken open, and the sealed room behind it holds TUNE.cache)
//   SWING     the pick's blow (sim/player/tool.js, per job): woodcutting's fields (content/woodcut.js swing), a heavier swing
//   TUNE      rhythm (s: a fresh press this soon before or after a swing ends lands the next one RHYTHM.mul harder; ?rhythm=0 off),
//             days (in-game days a spent vein takes to come back, the same spot), day (hours a day), chunk (a chunk on the floor:
//             picked up within `pick` m, drawn in from `magnet` m after `delay` s), crystal (a cave crystal under the pick:
//             blows to break it, the Glow Shards it gives, xp), camp (m: E takes the pick this close to it), night (dark: a night
//             vein shows while no lit lantern, lamp or burning fire is within this many m of it, or while he trips), cache (what
//             a hollow wall's sealed room holds, for each player there when it opens) and keep (its keepsake, by the hollow's order)
//   blowPower(tool, st, rhythm) -> what one blow takes off a vein; mineYield(R, kind, st) -> chunks for one striker
//   mineStats(notes) -> {power, extra} from modifier notes ('mine.power', 'mine.extra'); regrowHours(k); statWords(note)
import {TUNE as WOOD} from './woodcut.js';

export const VEINS = {
  stone:  {item: 'stone',      blows: 3, n: [2, 3], tier: 1, xp: 2, col: ['#b8b2a6', '#8c867a']},
  copper: {item: 'copper_ore', blows: 5, n: [2, 3], tier: 1, xp: 4, col: ['#5ec4a0', '#c8743a']},
  iron:   {item: 'iron_ore',   blows: 7, n: [1, 2], tier: 2, xp: 6, col: ['#8a94a8', '#4a5060']},
  night:  {item: 'night_ore',  blows: 6, n: [1, 2], tier: 1, xp: 8, col: ['#e8f0ff', '#2a2c3a']},
  hollow: {item: 'stone',      blows: 6, n: [2, 3], tier: 1, xp: 4, col: ['#a89a80', '#8a7c66'], hollow: true},
};
export const SWING = {...WOOD.swing, dur: .7, hit: .3, keep: .45};
export const TUNE = {
  rhythm: .15, rhythmMul: 1.5,
  days: 3, day: 24,
  chunk: {pick: .55, magnet: 2.4, delay: .5, speed: 7},
  crystal: {blows: 3, shards: [2, 3], xp: 5},
  camp: 1.6,
  night: {dark: 6},
  cache: {copper_ore: 3, glow_shard: 3}, keep: ['tally_stick', 'big_tooth'],
};

export function blowPower(tool, st, rhythm) {
  return (tool?.power || 1) * (st.power || 1) * (rhythm ? TUNE.rhythmMul : 1);
}
export function mineYield(R, kind, st) {
  const V = VEINS[kind]; if (!V) return 0;
  let n = V.n[0] + Math.floor(R() * (V.n[1] - V.n[0] + 1));
  if (R() < (st.extra || 0)) n++;
  return n;
}
export function mineStats(notes) {
  let power = 1, extra = 0;
  for (const q of notes) {
    if (q.stat === 'mine.power') { if (q.mul !== undefined) power *= q.mul; if (q.add !== undefined) power += q.add; }
    else if (q.stat === 'mine.extra') extra += q.add || 0;
  }
  return {power, extra};
}
export const regrowHours = (k = 1) => TUNE.days * TUNE.day * k;
export function statWords(q) {
  if (q.stat === 'mine.extra') return `${Math.round(q.add * 100)}% chance of one more chunk from a vein`;
  if (q.stat === 'mine.power' && q.mul) return `the pick bites ${Math.round((q.mul - 1) * 100)}% harder`;
  return '';
}
