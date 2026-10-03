// LITTER (render3d): the fallen leaves live. world.js bakes where leaves fall; render/litter.js runs the carpet as a field on the GPU; this
// feature DRIVES it: it hands the field the wind, lifts leaves off it in gusts and under a sprinting foot, and takes them back when they
// settle. SHOW ONLY: nothing here touches the sim (no colliders, never pushes anything). ?litter=0 starts with the carpet static (the old
// look); menu > Graphics > Detail low switches it off too.
//   wind     every TICK the field gets the wind on a 2 m grid (host.wind.at, the same field the trees and the cloak feel): leaves slide
//            downwind where it is stronger than TUNE.sim.thr (gusts do it; a calm leaves them lying where they are), pile up against
//            walls, trunks and the plateau's foot, and vanish into the water and the ravine
//   lift     in a strong gust some leaves rise from the carpet: wind.js leaf particles in the colours of the leaf that lay there. They
//            tumble downwind, come down and add themselves to the field where they land. The carpet is read from a coarse copy of the
//            field that the GPU hands back every few seconds, never a stall
//   kick     a sprinting footfall (player.land, big 2) in a thick patch throws up a few leaves
// FEATURE CONTRACT (main.js): create(host) -> F: view (drive the layer, spawn leaves), toggle (Detail low), info.
// OWNS: the particles it spawns' bookkeeping (none: wind.js owns them). READS: host.wind (at, leaf), host.world.leaves (the layer: a world's
// makeLitter object and its sim), host.G.U.litK (how far the fallen leaves have turned), the view. EMITS: nothing. BUDGET: ~0.1 ms CPU.
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';
import {mulberry32} from '../core/rng.js';

export const TUNE = {
  // the layer's own numbers (render/litter.js DEFAULTS has the rest): wind speed (m/s) above which leaves move, leaf m/s per m/s above it,
  // the shuffling, the soft cap on the density, how fast a blown-clear carpet fills again under the crowns / a drift thins (s)
  sim: {thr: .55, kappa: .3, diff: .012, cap: .68, tauUp: 90, tauDown: 320},
  mirror: 2.5,       // s between reads of the coarse copy of the carpet
  lift: {
    tries: 150,      // places looked at per second (in the view)
    thr: .8, span: 1.2,   // a try lifts when the wind there is past thr: the odds rise to 1 over `span` m/s
    dens: .22,       // the mean density (of the coarse copy) at which a try is sure to find a leaf
    min: .03,        // below this there are no leaves to lift
    up: [.9, 1.9],   // m/s a leaf rises at (it decays within ~.5 s: a lift of a few dozen cm, more where the gust keeps it up)
    big: .3,         // share that tumble as the larger 2 x 2 leaf
  },
  kick: {n: [1, 3], dens: .1, speed: [.5, 1.2], vh: [.8, 1.6]},   // a sprinting footfall: leaves thrown, their number, the density needed
};

// ORDER (core/features.js): it reads this step's wind
export const order = {after: ['wind']};
export async function create(host) {
  const G = host.G, ctx = host.ctxO;
  const F = {name: 'litter', label: 'Leaf layer', ambient: true, on: flags.get('litter') !== '0', TUNE, ms: 0, lifted: 0, kicked: 0};
  const R = mulberry32(11), rr = (a, b) => a + R() * (b - a);
  const WA = {x: 0, y: 0, g: 0};   // wind.at fills it: no allocation per call
  let T = 0, mirT = 0, acc = 0, kicks = 0, simOf = null, cost = 0;
  // the view in the world: its centre and half sizes in view-frame metres, the screen's right / toward-camera on the ground (arena x, y)
  const V = {RX: 1, RY: 0, FX: 0, FY: 1, cx: 0, cy: 0, hw: 1, hh: 1};
  function view() {
    const yaw = host.yaw, z = host.zoom || 1, T3 = G.view.T;
    V.RX = Math.cos(yaw); V.RY = -Math.sin(yaw); V.FX = Math.sin(yaw); V.FY = Math.cos(yaw);
    const up = T3.y * ctx.PPMH / ctx.PPMY;
    V.cx = T3.x - V.FX * up; V.cy = T3.z - V.FY * up; V.hw = ctx.VW / 2 / (ctx.PPM * z); V.hh = ctx.VH / 2 / (ctx.PPMY * z);
  }
  // the wind on the layer's grid: what the field's F.at says at each cell's middle (a fresh grid every tick the layer asks for one)
  let wind = null;
  function fill(g) {
    const W = wind, o = WA;
    for (let j = 0, k = 0; j < g.h; j++) for (let i = 0; i < g.w; i++, k += 4) {
      W.at((i + .5) * g.cell, (j + .5) * g.cell, o); g.data[k] = o.x; g.data[k + 1] = o.y; g.data[k + 2] = o.g;
    }
  }
  // a leaf of the carpet in the colours it lies in (the ground shader's choice: the stage by how far the leaves have turned, the tone by luck)
  const hexOf = c => typeof c === 'string' ? c : '#' + c.map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  const ramps = new Map();
  function rampOf(lit, g, v) {
    const key = g * 4 + v; let r = ramps.get(key);
    if (!r) { const st = lit.groups[g]?.[v] || lit.groups[0][v]; ramps.set(key, r = [hexOf(st[0]), hexOf(st[1]), hexOf(st[2])]); }
    return r;
  }
  const landed = q => { const s = host.world?.leaves?.sim; if (s) s.give(q.x, q.y, 1, q.grp); };   // a lifted leaf has lain its time: the carpet takes it back
  // the coarse copy of the carpet: mean density (of the cells in a block) and the palette of the heaviest, at a world point; -1 = none yet
  function carpetAt(sim, x, y, out) {
    const m = sim.mirror, i = Math.floor(x / (m.k * sim.h)), j = Math.floor(y / (m.k * sim.h));
    if (!m.ver || i < 0 || j < 0 || i >= m.w || j >= m.h) return -1;
    const o = (j * m.w + i) * 4; out.g = m.data[o + 1]; return m.data[o] / 255 * 2;
  }
  const CP = {g: 0};
  // one leaf off the carpet at (x, y), thrown with (vx, vy, vh): its colour from the leaf that lay there
  function spawn(lit, sim, x, y, g, vx, vy, vh) {
    const K = G.U.litK.value.y, v = Math.max(0, Math.min(3, Math.floor(K * 4.2 - (1 - R()) * 3.4)));
    const ok = wind.leaf({x, y, h: host.elev(x, y) + .03, vx, vy, vh, pal: rampOf(lit, g, v), big: R() < TUNE.lift.big, grp: g, onLand: landed});
    if (ok) sim.take(x, y, 1);
    return ok;
  }
  function lift(dt, lit, sim) {
    const e = TUNE.lift; acc += dt * e.tries;
    for (let n = 0; acc >= 1 && n < 8; acc -= 1, n++) {
      const vx = V.cx + (R() * 2 - 1) * V.hw, vy = V.cy + (R() * 2 - 1) * V.hh, x = vx * V.RX + vy * V.FX, y = vx * V.RY + vy * V.FY;
      const s = carpetAt(sim, x, y, CP); if (s < e.min || R() > s / e.dens) continue;
      wind.at(x, y, WA); const sp = Math.hypot(WA.x, WA.y), p = clamp((sp - e.thr) / e.span, 0, 1);
      if (R() > p) continue;
      if (spawn(lit, sim, x, y, CP.g, WA.x * .5 + rr(-.3, .3), WA.y * .5 + rr(-.3, .3), rr(e.up[0], e.up[1]))) F.lifted++;
    }
    if (acc > 8) acc = 0;
  }
  // a sprinting footfall: a few leaves thrown up round the foot, away from where he is heading
  function kick(lit, sim, ev) {
    const k = TUNE.kick, s = carpetAt(sim, ev.x, ev.y, CP); if (s < k.dens) return;
    const n = Math.round(rr(k.n[0], k.n[1])), a0 = R() * 6.2832;
    for (let i = 0; i < n; i++) {
      const a = a0 + i * 2.1 + rr(-.5, .5), sp = rr(k.speed[0], k.speed[1]), d = rr(.05, .3);
      if (spawn(lit, sim, ev.x + Math.cos(a) * d, ev.y + Math.sin(a) * d, CP.g, Math.cos(a) * sp, Math.sin(a) * sp, rr(k.vh[0], k.vh[1]))) F.kicked++;
    }
  }
  Object.assign(F, {
    view(dt, evs) {
      const t0 = performance.now();
      const lit = host.world?.leaves, sim = lit?.sim; wind = host.wind;
      if (!sim?.ok || !wind?.on) { cost += performance.now() - t0; return; }
      if (sim !== simOf) { simOf = sim; sim.set(TUNE.sim); mirT = 0; }
      dt = Math.min(.05, Math.max(0, dt || 0)); T += dt; view();
      sim.advance(dt, fill);
      if ((mirT -= dt) <= 0) { mirT = TUNE.mirror; sim.want(); }
      if (lit.live.value > .5 && sim.mirror.ver) {
        lift(dt, lit, sim);
        if (evs) for (let i = 0; i < evs.length; i++) { const ev = evs[i]; if (ev.type === 'player.land' && ev.big === 2) kick(lit, sim, ev); }
      }
      cost += performance.now() - t0;
    },
    frame() { F.ms = F.ms * .95 + cost * .05; cost = 0; },
    // Graphics > Detail low switches it off: the ground goes back to drawing the baked carpet as it was
    toggle() { F.on = !F.on; if (!F.on) host.world?.leaves?.sim?.release(); return F.on; },
    info() { const l = host.world?.leaves, s = l?.sim; return l ? {live: l.live.value, ok: s?.ok, ...(s?.stats || {}), mirror: s?.mirror?.ver, lifted: F.lifted, kicked: F.kicked} : null; },
    apply() { simOf?.set(TUNE.sim); },   // (dev: after changing TUNE.sim live)
    biomeChanged() { simOf = null; ramps.clear(); },
  });
  return F;
}
