// RIFT FOG (an omen: features/omens.js runs it). The world clock's fog (sim/env.js 'fog': the haze thickens, the wind falls
// to a calm) under a violet grade, and a rule in two halves:
//   SIM   nothing moves differently: what changes is the crit. A hit on an enemy within TUNE.riftfog.close m of you has
//         +TUNE.riftfog.crit critical chance (combat's hit mods): let them come.
//   VIEW  past TUNE.riftfog.see m (less each stage) an enemy is lost in the fog: not drawn (world.js veil: a view's say,
//         the sim and its collider untouched), only its eyes glowing through, and the faint light they throw. Fog banks
//         (soft HD puffs: render/gfx.js fx 'blend') roll in a ring round you past that distance and thin out toward you,
//         drifting with the wind; a puff of fog where one goes under or comes out.
// OWNS: the veils it set (lifted at the end, whatever happens), its fog banks (preallocated). READS: host.player, combat's
//   brutes, host.wind (dir), host.world.veil. EMITS: nothing. BUDGET: view ~.04 ms (60 banks, a veil per enemy on change).
import {TUNE as ALL} from '../../content/omens.js';
import {viewRandom} from '../../core/rng.js';
import {clamp, hypot2} from '../../core/mathx.js';
import {TAU, C} from './kit.js';

const T = ALL.riftfog;
const DIR0 = [.94, .34], NF = 80, EYES = C('#fff0ff'), EYEG = C('#c050ff'), MIST0 = [C('#b8a4d8'), C('#a48cc8'), C('#cbbce4')], PUFF0 = C('#c0a8e8');

export function createFog(host, K) {
  const V = viewRandom('omens.fog'), vr = (a, b) => a + V() * (b - a);
  const veiled = new Map();   // brute -> veiled now (its eyes show)
  let sk = 0, T0 = 0, k = 0;
  const see = () => Math.max(T.seeMin, T.see + T.seeK * sk);
  // fog banks: a ring of soft puffs round the player, beyond `see`; each drifts with the wind and comes round again
  const fX = new Float32Array(NF), fY = new Float32Array(NF), fH = new Float32Array(NF), fR = new Float32Array(NF), fA = new Float32Array(NF), fP = new Float32Array(NF);
  const fC = new Uint8Array(NF), fT = new Float32Array(NF);
  const MIST = MIST0.map(c => c.slice()), PUFF = PUFF0.slice();   // (lit by the mood: a pale fog by day, a dim one at night)
  let placed = false;
  function bank(i, x0, y0, any) {   // (any: at the start, already there; later it swirls up out of nothing)
    const a = V() * TAU, s = see(), d = vr(s - 1.5, s + 6);
    fX[i] = x0 + Math.sin(a) * d; fY[i] = y0 + Math.cos(a) * d * .85; fH[i] = vr(.2, 1.2); fR[i] = vr(1.8, 3.4); fA[i] = vr(.6, 1); fP[i] = V() * TAU; fC[i] = V() * 3 | 0;
    fT[i] = any ? 9 : 0;
  }
  const puffs = [];   // {x, y, h, t}: fog swirling where one goes under / comes out
  function unveilAll() { const w = host.world; for (const b of veiled.keys()) w?.veil?.(b, false); veiled.clear(); }

  const F = {
    begin(stage) { sk = stage; placed = false; k = 0; },
    end() { unveilAll(); puffs.length = 0; },
    hit(p, o, M) {   // SIM: close-range crits
      if (!(p.hunter || p.sparring)) return;
      const P = host.player; if (hypot2(p.x - P.x, p.y - P.y) < T.close) M.crit += T.crit;
    },
    view(dt) {
      T0 += dt; k = Math.min(1, k + dt / 2.5);
      const core = K.core(), P = host.player, w = host.world, s = see();
      if (!placed) { for (let i = 0; i < NF; i++) bank(i, P.x, P.y, true); placed = true; }
      // veils: past `see` (with .4 m of give, so one at the edge doesn't flicker); a puff where it changes
      if (core) for (const b of core.brutes) {
        if (b.broken || b.dead) { if (veiled.has(b)) { w?.veil?.(b, false); veiled.delete(b); } continue; }
        const d = hypot2(b.x - P.x, b.y - P.y), was = veiled.get(b) || false, now = k > .6 && (was ? d > s - .4 : d > s + .4);
        if (now !== was) { w?.veil?.(b, now); veiled.set(b, now); if (puffs.length < 24) puffs.push({x: b.x, y: b.y, h: .7, t: 0}); }
      }
      // the banks drift downwind and wobble; one that falls too far behind comes round again on the far side
      const dir = host.wind?.dir || DIR0;
      for (let i = 0; i < NF; i++) {
        fP[i] += dt * .4; fT[i] += dt; fX[i] += (dir[0] * .55 + Math.sin(fP[i]) * .12) * dt; fY[i] += (dir[1] * .55 + Math.cos(fP[i] * .8) * .1) * dt;
        const d = hypot2(fX[i] - P.x, (fY[i] - P.y) / .85);
        if (d > s + 8 || d < s - 3) bank(i, P.x, P.y, false);
      }
      for (let i = puffs.length - 1; i >= 0; i--) if ((puffs[i].t += dt) > .9) puffs.splice(i, 1);
    },
    frame(t) {
      const G = host.G, P = host.player, s = see(), core = K.core(), am = host.mood.amb, lum = Math.min(1.1, .25 + .75 * (am[0] * .3 + am[1] * .55 + am[2] * .15));
      for (let j = 0; j < 3; j++) { for (let c = 0; c < 3; c++) MIST[j][c] = MIST0[j][c] * lum; PUFF[j] = PUFF0[j] * lum; }
      if (G.fx) for (let i = 0; i < NF; i++) {   // thick past `see`, thinning toward you
        const d = hypot2(fX[i] - P.x, fY[i] - P.y), a = clamp((d - (s - 2.5)) / 3.5, 0, 1) * fA[i] * .62 * k * Math.min(1, fT[i] / 2);
        if (a > .02) G.fx(fX[i], fH[i] + Math.sin(fP[i] * 1.3) * .15, fY[i], fR[i], MIST[fC[i]], a, 'blend');
      }
      if (G.fx) for (const q of puffs) { const e = q.t / .9; G.fx(q.x, q.h + e * .4, q.y, .5 + e * .9, PUFF, .4 * (1 - e), 'blend'); }
      if (core) for (const b of core.brutes) if (veiled.get(b)) K.eyes(b, EYES, t, .9, EYEG);
    },
    lights(out) {   // the eyes' faint light on the fog (the nearest few)
      let n = 0;
      const core = K.core(); if (!core) return;
      for (const b of core.brutes) {
        if (n >= 4 || !veiled.get(b)) continue;
        const L = LR[n++]; L.x = b.x; L.y = b.y; L.h = (b.z || 0) + (b.h || 0) + 1.4; out.push(L);
      }
    },
    get see() { return see(); },
  };
  const LR = Array.from({length: 4}, (_, i) => ({x: 0, y: 0, h: 0, color: '#d8a8ff', radius: 1.3, intensity: .35, flicker: .2, id: 9780 + i}));
  return F;
}
