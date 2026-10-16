// FORAGE (data; docs/FORAGING.md): what the forest floor gives when you pick it. The patches are the forest's own small things
// (world/forest.js F.decor: the four plants below), a patch's id its index there ('d' + i: the same on every client and the
// co-op server, the plan is a pure function of the seed). Pure data and pure functions: the browser (features/forage.js) and
// the co-op server (server/room.mjs: it rolls a pick's yield and keeps the picked patches) read this one file.
//   PLANTS    recipe -> item (content/items.js), n [min, max] a pick, days (in-game) until it grows back, r (m round its root
//             at scale 1: the patch's size; x its decor scale s), berry (the berry comb's), rain (back at the next rain too), xp
//   TUNE      reach (m past the patch's edge E and LMB pick from), walk (m: held E picks a patch he passes this close), crouch (s
//             he crouches a pick), pluck (s into the crouch: the pick lands), day (hours an in-game day)
//   pickYield(R, kind, st) -> n: a roll of the plant's n, + 1 at st.extra's chance (Foraging), + st.comb on berries
//   pickStats(notes) -> {extra, comb} from modifier notes ('forage.extra', 'forage.comb'); levelNotes(per, lvl) a skill's notes
//   regrowHours(kind, k) -> in-game hours until it grows back (k: ?regrow= / --regrow, a factor on the time)
//   statWords(note) -> what a forage note does, in words ('' not one: ui/geartip.js)
export const PLANTS = {
  blueberry:    {item: 'blueberries',   n: [3, 5], days: 2, r: .55, berry: true, xp: 3},
  lingonberry:  {item: 'lingonberries', n: [4, 7], days: 2, r: .5,  berry: true, xp: 3},
  chanterelles: {item: 'chanterelles',  n: [2, 4], days: 3, r: .3,  rain: true,  xp: 5},
  fly_agaric:   {item: 'fly_agaric',    n: [1, 1], days: 1, r: .3,  xp: 4},
};
export const TUNE = {reach: .9, walk: .6, crouch: .5, pluck: .22, day: 24};

export function pickYield(R, kind, st) {
  const P = PLANTS[kind]; if (!P) return 0;
  let n = P.n[0] + Math.floor(R() * (P.n[1] - P.n[0] + 1));
  if (R() < (st.extra || 0)) n++;
  if (P.berry) n += Math.max(0, Math.round(st.comb || 0));
  return n;
}
export function pickStats(notes) {
  let extra = 0, comb = 0;
  for (const q of notes) { if (q.stat === 'forage.extra') extra += q.add || 0; else if (q.stat === 'forage.comb') comb += q.add || 0; }
  return {extra, comb};
}
export const levelNotes = (per, lvl) => per.map(q => q.mul !== undefined ? {stat: q.stat, mul: 1 + q.mul * (lvl - 1)} : {stat: q.stat, add: q.add * (lvl - 1)});
export const regrowHours = (kind, k = 1) => (PLANTS[kind]?.days ?? 1) * TUNE.day * k;
export function statWords(q) {
  if (q.stat === 'forage.comb') return 'picks berries as you walk past, +1 a patch';
  if (q.stat === 'forage.extra') return `${Math.round(q.add * 100)}% chance of one more when you pick`;
  return '';
}
