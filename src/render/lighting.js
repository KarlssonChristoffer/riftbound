// LIGHTING: the scene's light every frame, from the world clock's blended mood (sim/env.js) and the lights round the
// player: the sun (direction for shading + a capped one for shadow length), ambient, fog, the character's fill and
// grade, then up to 32 point lights (the dark scene's lift, the lantern, world + feature lights, nearest first, each
// flickering and wandering a few cm) with their halos. Writes the composite's uniforms (gfx.js compU); nothing else.
// OWNS: the light records (reused frame to frame). READS: host.env / biome / world / player / P / zoom / VH, features'
//   lights(), opt.lantern. BUDGET: ~0.05 ms (part of view).
//   const lighting = createLighting({G, host, features, opt}); lighting.apply(PX, PY, t) once per frame before G.render
import * as THREE from 'three';
import {DEG} from './gfx.js';
import {CHAR} from '../content/moods.js';
import {lum, rgbOf} from '../core/color.js';

const GRADE = {ruins: [1.039, 1.029, .818], ember: [1.166, .958, .82], frost: [.896, 1.013, 1.161], rift: [1.056, .792, 1.649]};
const BG = {ruins: [.10, .13, .11], ember: [.11, .06, .05], frost: [.10, .12, .17], rift: [.06, .04, .10]};
const HALO_A = .16, HALO_R = .3, LANTERN = {fwd: .22, side: .3, h: .95, c: [1, .76, .48], r: 4.2, k: 1, flicker: .2, id: -7};
function flick(l, t) {
  const f = l.flicker || 0; if (!f) return 1;
  const s = (l.id ?? 0) * 12.9898 % 6.283, n = .5 * Math.sin(t * 7.3 + s) + .3 * Math.sin(t * 12.7 + s * 2.3) + .2 * Math.sin(t * 23.1 + s * 3.7);
  return 1 - f * .22 * (1 + n);
}
// the arena's longest sun shadow (lighting.js SUN_LEN_MAX): 1.7 m per metre of height. A low dusk sun (10-14 deg) still
// LIGHTS from low down (warm grazing light, rims), but its shadows stop growing at this length: the true 1 / tan(el)
// stretched trees and towers 4-6x their height across the map
const SUN_LEN_MAX = 1.7, SHADOW_EL_MIN = Math.atan(1 / SUN_LEN_MAX);

export function createLighting({G, host, features, opt}) {
  const sunDir = new THREE.Vector3(), shadowDir = new THREE.Vector3();
  // the light records, reused every frame
  const LOUT = [], CAND = [], CW = [], FREC = [], colCache = new Map();
  let nL = 0;
  const colOf = c => { if (Array.isArray(c)) return c; let v = colCache.get(c); if (!v) colCache.set(c, v = rgbOf(c)); return v; };
  const byD = (a, b) => a.d - b.d;
  function putL(x, y, z, c, r, gain, flat) { const o = LOUT[nL] ??= {}; nL++; o.x = x; o.y = y; o.z = z; o.c = c; o.r = r; o.gain = gain; o.flat = flat; }
  function apply(PX, PY, t) {
    const env = host.env, world = host.world, P = host.P, player = host.player, VH = host.VH, zoom = host.zoom, PPM = host.PPM;
    const biome = host.biome.id, time = env.bucket, m = env.mood(biome), U = G.compU;   // the clock's blended mood
    U.uAmb.value.set(...m.amb);
    const az = m.sun.az * DEG, el = m.sun.el * DEG;
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const sel = Math.max(el, SHADOW_EL_MIN);
    shadowDir.set(Math.sin(az) * Math.cos(sel), Math.sin(sel), -Math.cos(az) * Math.cos(sel));
    G.setSun(sunDir, shadowDir);
    U.uSunC.value.set(...(m.sun.c || [1, 1, 1])); U.uSunStr.value = m.sun.el > 2 ? (m.shadow.a > 0 ? 1 : .45) * (m.sun.k ?? .4) * 2.2 : 0;   // armour glints
    U.uSunK.value = m.sun.k; U.uShadowA.value = m.shadow.a > 0 && m.sun.el > 2 ? m.shadow.a : 0; U.uShadowC.value.set(...m.shadow.c);
    U.uFog.value.set(...m.fog);
    const la = Math.max(.02, lum(m.amb)), fk = lum(m.fill || [0, 0, 0]) / la * CHAR.fillK;
    U.uFill.value.set(...m.amb.map(v => v * fk)); U.uGrade.value.set(...GRADE[biome]); U.uGradeK.value = CHAR.gradeK[time] ?? 0;
    const dark = Math.max(0, 1 - lum(m.amb));
    U.uEmin.value = .1 + .2 * dark;
    U.uBg.value.set(...BG[biome].map(v => v * (.35 + .65 * lum(m.amb))));
    // lights: the lift (a flat pool at the player in dark scenes), the lantern, features' lights, the nearest world lights.
    // (every record is reused frame to frame: LOUT goes to the shader, CAND holds the candidates, FREC copies features' lights)
    nL = 0;
    if (m.lift[0] + m.lift[1] + m.lift[2] > 0) putL(PX, P.z + .9, PY, m.lift, 1.7, 1, true);
    if (opt.lantern) {
      const a = player.faceAngle, fx = Math.sin(a), fy = Math.cos(a), fk2 = flick(LANTERN, t);
      putL(PX + fx * LANTERN.fwd - fy * LANTERN.side, P.z + LANTERN.h, PY + fy * LANTERN.fwd + fx * LANTERN.side, LANTERN.c, LANTERN.r * (1 + (fk2 - 1) * .15), fk2, false);
    }
    let nc = 0, nf = 0;
    const cand = l => { const d = Math.hypot(l.x - PX, l.z - PY); if (d < 24 + l.r) { const w = CW[nc] ??= {l: null, d: 0}; w.l = l; w.d = d; CAND[nc++] = w; } };
    for (const l of world.lights) cand(l);
    for (const f of features) if (f.on !== false && f.lights) for (const l of f.lights()) {
      const o = FREC[nf++] ??= {};
      o.x = l.x; o.y = l.h || 0; o.z = l.y; o.c = colOf(l.color ?? l.c); o.r = l.radius || l.r || 3; o.k = l.intensity ?? l.k ?? 1; o.flicker = l.flicker || 0; o.id = l.id ?? 7000; o.jitter = l.jitter;
      cand(o);
    }
    CAND.length = nc; CAND.sort(byD);   // nearest first (stable: ties keep the world-then-features order)
    // a flame's light wanders a few cm (l.jitter, else from its flicker), so the shadows round a fire dance with it
    for (let i = 0; i < nc && nL < 32; i++) {
      const l = CAND[i].l, k = flick(l, t), j = l.jitter ?? (l.flicker || 0) * .035, s = (l.id ?? 0) * 7.13;
      const jx = j ? j * (Math.sin(t * 11.3 + s) + Math.sin(t * 17.9 + s * 1.7) * .6) / 1.6 : 0, jz = j ? j * (Math.sin(t * 13.1 + s * 2.1) + Math.sin(t * 7.7 + s * .9) * .6) / 1.6 : 0;
      putL(l.x + jx, l.y + Math.abs(jz) * .5, l.z + jz, l.c, l.r * (1 + (k - 1) * .15), l.k * k, false);
    }
    U.uNL.value = nL; let nh = 0;
    for (let i = 0; i < nL; i++) {
      const l = LOUT[i];
      U.uLP.value[i].set(l.x, l.y, l.z, l.r); U.uLC.value[i].set(l.c[0] * l.gain, l.c[1] * l.gain, l.c[2] * l.gain, l.flat ? 1 : 0);
      if (l.flat) continue;
      const a = Math.min(.75, HALO_A * l.gain * (m.glow ?? 1) * (.3 + .7 * dark) + Math.max(0, l.gain - 1.5) * .12); if (a < .02) continue;
      const [sx, sy] = G.toScreen(l.x, l.y, l.z);
      U.uHalo.value[nh].set(sx, VH - sy, (HALO_R + .12 * Math.min(2, l.gain) + Math.max(0, l.gain - 1.3) * .35) * PPM * zoom, a); U.uHaloC.value[nh].set(l.c[0], l.c[1], l.c[2]); nh++;
    }
    U.uNH.value = nh;
    return m;
  }
  return {apply};
}
