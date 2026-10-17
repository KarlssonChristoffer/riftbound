// ICE (data; docs/WINTER.md "The lake ice"): the forest lake's ice, its thin spots, holes, breaking through and climbing out. Pure:
// sim/ice.js reads it (the browser offline, the co-op server online). Times are shares of a SEASON (sim/wxclock.js seasonDays: 3
// in-game days now, longer later), so the ice keeps its pace in the year when the seasons stretch.
export const TUNE = {
  // GROWTH: through winter the ice thickens from nothing at grow m per season (x the share of winter gone), up to max; walkable
  // from walk m (at .35 / .81: about 43% into winter, the second winter night at 3-day seasons); spring melts it in thaw of a season
  grow: .81, max: .5, walk: .35, thaw: 1 / 3,
  // under walk m (but over crack) it holds a moment, then cracks: a tick-tick for tell s, then he goes through (where he stands
  // still or walks on it). Under crack m: open water (swum, as in summer)
  crack: .15, tell: 1.5,
  // THIN SPOTS: where the stream comes in, where the outflow leaves, over the deepest water: x thin at the spot, back to full by r m
  thin: .6, thinR: 2.6,
  // HOLES: a pick or an axe through the ice (blows each: pick 3, axe 4), r m; going through the ice opens one of breakR m; both
  // freeze over again in refreeze of a season (a day at 3-day seasons). At most holes at once (the oldest freezes first)
  hole: {r: .5, blows: {mine: 3, chop: 4}, breakR: .8, refreeze: 1 / 3, max: 8},
  // CLIMBING OUT: through the ice he's held in the hole (no swimming off under it): hold Space climb s (mail shirt: mail s), a
  // friend within friendR m: x friend. Soaked through and chilled (cold + chill)
  climb: {s: 1, mail: 2.5, friend: .5, friendR: 2.2, chill: .35},
  // ON THE ICE: his start and stop x slip (a slide), the snow on it (snowCover) gives back grip
  slip: .35,
  // SINGING: on a cold still night the ice sings (a rising, whale-like whoop): about every sing s while the night is clear
  sing: [25, 60],
};
