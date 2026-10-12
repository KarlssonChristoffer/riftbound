// AIR DRIFT (view): how the CPU particles take the moving air (render/air.js `G.air`; docs/exp/air.md section 3). A
// particle keeps all of its own motion (its jet, its rise, the wind, its eddies) and carries one velocity more: its share of
// the air (w, m/s on the ground plane). Each step w relaxes toward the air's velocity where the particle is,
//   w += (air - w) (1 - e^(-k dt))     k (1/s): how light it is (thin smoke takes the air at once, dust slower, embers slower still)
// and the particle moves by w dt as well. So a blast blows the smoke away and the air rushing back pulls it in again, a
// muzzle's jet carries the gun's own smoke on, a passer-by's wake drags it along. In still air w decays back to 0; with the
// air off (?air=0, no G.air) the systems skip all of it and nothing changes. The field is the air near the ground: a
// particle feels it fully up to AIRK.h0 m above its ground, less and less up to AIRK.h1 (a chimney's plume high over a
// passing blast doesn't feel it).
//   const D = createDrift(host)        once (nothing allocated after)
//   D.begin(dt, gain) -> bool          once a step: the air is on (false: the caller skips the air entirely); gain: x the air
//                                      (the system's AIRK.<sys>.gain)
//   D.a(k) -> 1 - e^(-k dt)            this step's relaxation for a k (a system takes it once per kind, not per particle)
//   D.relax(x, y, h, wx, wy, a)        the particle's new w -> D.x, D.y (m/s); x, y arena metres, h its height (arena h)
//   D.n                                velAt calls this step (tests, the budget)
// The k values, one per system and kind: AIRK (live: window.__r3d's features read it each step). VIEW ONLY: the sim never
// reads the air (docs/exp/air.md).
// OWNS: nothing but its scratch. READS: host.G.air (velAt, on), host.elev (only for particles higher than h0).
// BUDGET: one velAt a particle a step (~.1-.3 us with a few dozen live splats); the systems cap their particles.

export const AIRK = {
  on: true,         // the particles take the air (false: they don't, the field and the mist still do: an A/B of this layer alone)
  h0: 2.5, h1: 7,   // m above the ground: the air felt fully below h0, fading to none at h1
  // gunfx/smoke.js: the shot's puffs, the barrel's wisp (a thread: the lightest), the strands' motes, a bullet's dust puff
  gun: {smoke: 6, wisp: 9, motes: 8, dust: 3.5, gain: 1},
  // features/atmos.js: dust (landings, breaks, a blast's ring), smoke (a blast's plume), snow puffs, water drops, grit /
  // grass bits / chips, embers; the ambient leaves, pollen, ash, snow, rising embers / motes, fireflies
  atmos: {dust: 3.5, smoke: 4, snow: 3, drop: .5, grit: .8, ember: 1.2, leaf: 2.2, pollen: 4.5, ash: 3, snow2: 2.2, rise: 1.6, fly: .8, gain: 1},
  // features/lights.js: fire smoke (campfire, braziers, burning props), ash, spores, sparks, embers, falling embers
  lights: {smoke: 3.5, spore: 4, spark: .9, ember: .9, drip: 1, gain: 1},
  // features/equip/look.js: the soft puffs (soot, steam, dust, the bomb's ring), the smoke bomb's cloud, the light bits
  equip: {puff: 3.5, cloud: 4, spark: .9, light: 1.5, gain: 1},
  // features/combat/core.js (its view's particles): dust rings, explosion smoke, fire / embers / sparks
  combat: {dust: 3.5, smoke: 3.5, fire: 1, gain: 1},
  // view/hazards.js: a blast's smoke, sparks / embers / shards
  hazards: {smoke: 3.5, spark: .9, gain: 1},
  // features/dust.js: the skipping drift grains (0: heavy and wind-driven, not by the air), fine dust, kicked grains, puffs
  dust: {grain: 0, fine: 3, kicked: 1, puff: 3, gain: 1},
};

export function createDrift(host) {
  const V = [0, 0];
  let air = null, dt = 0, gain = 1;
  const D = {
    x: 0, y: 0, n: 0,
    begin(dt0, g = 1) {
      air = host.G?.air; dt = dt0; gain = g; D.n = 0;
      return !!(AIRK.on && air && air.on && dt0 > 0);
    },
    a: k => 1 - Math.exp(-k * dt),
    relax(x, y, h, wx, wy, a) {
      let f = gain;
      const h0 = AIRK.h0;
      if (h > h0) { const u = h - host.elev(x, y), h1 = AIRK.h1; if (u > h0) f *= u >= h1 ? 0 : (h1 - u) / (h1 - h0); }
      if (f > 0) { air.velAt(x, y, V); D.n++; D.x = wx + (V[0] * f - wx) * a; D.y = wy + (V[1] * f - wy) * a; }
      else { D.x = wx - wx * a; D.y = wy - wy * a; }
    },
  };
  return D;
}
