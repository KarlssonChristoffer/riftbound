// RNG: the seeded random generator (one algorithm: mulberry32). mulberry32(seed) -> R(): 0..1; R.seed(n) restarts it.
// Seeded systems (a biome's wind fronts, its wildlife, its weather particles) start the same way every time.
// SIM vs VIEW (docs/ARCHITECTURE.md rule 4): a sim decision (a burn's length, fire spreading, a crit, the weather's
// next spell) draws from its system's OWN generator, seeded once (simSeed(): from Math.random at boot, so play still
// differs run to run); Math.random is for presentation only. Then the sim comes out the same with or without its views
// (tools/test/simview.mjs), and a seeded run replays.
export const simSeed = () => Math.floor(Math.random() * 4294967296);
// a view's own generator for presentation draws (sparks, smoke, rain): seeded from Math.random, so it still differs run to
// run, but Math.random itself makes a new heap number every call (16 bytes, optimized or not); this one makes none
export const viewRandom = () => mulberry32(simSeed());
export function mulberry32(seed) {
  let s = seed | 0;
  const R = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  R.seed = n => { s = n | 0; };
  return R;
}
// Park-Miller (16807): the arena's combat and the run's seeds use it; kept so their numbers stay the same
export function parkMiller(seed) {
  let s = seed;
  const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  R.seed = n => { s = n; };
  return R;
}
