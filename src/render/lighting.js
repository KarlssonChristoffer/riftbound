// LIGHTING: the scene's light every frame, from the world clock's blended mood (sim/env.js) and the lights round the
// player: the sun (direction for shading + a capped one for shadow length), ambient, fog, the character's fill and
// grade, then up to 32 point lights (the dark scene's lift, the lantern, world + feature lights, nearest first, each
// flickering and wandering a few cm) with their halos (a feature light with halo: false has none). Writes the composite's
// uniforms (gfx.js compU); nothing else.
// OWNS: the light records (reused frame to frame). READS: host.env / biome / world / player / P / zoom / VH, features'
//   lights(), opt.lantern, host.mods 'light.lantern' / 'light.lanternR' (a run rule lights the lantern: features/omens.js,
//   an eclipse). BUDGET: ~0.05 ms (part of view).
//   const lighting = createLighting({G, host, features, opt}); lighting.apply(PX, PY, t) once per frame before G.render
import * as THREE from 'three';
import {DEG} from './gfx.js';
import {CHAR} from '../content/moods.js';
import {lum, rgbOf} from '../core/color.js';
import {hypot2} from '../core/mathx.js';

const GRADE = {ruins: [1.039, 1.029, .818], ember: [1.166, .958, .82], frost: [.896, 1.013, 1.161], rift: [1.056, .792, 1.649], desert: [1.09, 1.0, .84]};
const BG = {ruins: [.10, .13, .11], ember: [.11, .06, .05], frost: [.10, .12, .17], rift: [.06, .04, .10], desert: [.15, .10, .07]};
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
  const ONE3 = [1, 1, 1], SV3 = [0, 0, 0];
  const RAYS = {el: 0, c: ONE3, shadow: 0, cloud: 0, mist: 0, wet: 0};   // the god rays' strength inputs (G.setRays: render/godrays.js), reused
  // (mist: the sky's fog, or the air's medium from the world mist when it's on: features/mist.js via G.mist, last frame's)
  // the lantern by a run rule (features/omens.js, an eclipse): 'light.lantern' > 0 lights it whatever the switch says,
  // 'light.lanternR' scales its reach; read when the notes change
  let lanternMod = 0, lanternR = 1;
  if (host.mods) { const f = () => { lanternMod = host.mods.value('light.lantern', 0); lanternR = host.mods.value('light.lanternR', 1); }; host.mods.watch(f); f(); }
  function putL(x, y, z, c, r, gain, flat, halo = true) { const o = LOUT[nL] ??= {}; nL++; o.x = x; o.y = y; o.z = z; o.c = c; o.r = r; o.gain = gain; o.flat = flat; o.halo = halo; }
  function apply(PX, PY, t) {
    const env = host.env, world = host.world, P = host.P, player = host.player, VH = host.VH, zoom = host.zoom, PPM = host.PPM;
    const biome = host.biome.id, time = env.bucket, m = env.mood(biome), U = G.compU;   // the clock's blended mood
    const amb = m.amb; U.uAmb.value.set(amb[0], amb[1], amb[2]);   // (no spread, no map below: no array a frame)
    const az = m.sun.az * DEG, el = m.sun.el * DEG;
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const sel = Math.max(el, SHADOW_EL_MIN);
    shadowDir.set(Math.sin(az) * Math.cos(sel), Math.sin(sel), -Math.cos(az) * Math.cos(sel));
    G.setSun(sunDir, shadowDir);
    const sc = m.sun.c || ONE3; U.uSunC.value.set(sc[0], sc[1], sc[2]); U.uSunStr.value = m.sun.el > 2 ? (m.shadow.a > 0 ? 1 : .45) * (m.sun.k ?? .4) * 2.2 : 0;   // armour glints
    U.uSunK.value = m.sun.k; U.uShadowA.value = m.shadow.a > 0 && m.sun.el > 2 ? m.shadow.a : 0; U.uShadowC.value.set(m.shadow.c[0], m.shadow.c[1], m.shadow.c[2]);
    U.uFog.value.set(m.fog[0], m.fog[1], m.fog[2], m.fog[3]);
    // the god rays: the sun's elevation and colour, the mood's shadow strength (clouds and nightfall in it), the sky's cloud / mist, wet ground
    if (G.setRays) { RAYS.el = m.sun.el; RAYS.c = sc; RAYS.shadow = U.uShadowA.value; RAYS.cloud = env.sky.cloud; RAYS.mist = G.mist?.on ? Math.max(env.sky.fog, G.mist.medium) : env.sky.fog; RAYS.wet = env.wet; G.setRays(RAYS); }
    const la = Math.max(.02, lum(m.amb)), fk = lum(m.fill || [0, 0, 0]) / la * CHAR.fillK;
    U.uFill.value.set(amb[0] * fk, amb[1] * fk, amb[2] * fk); const gr = GRADE[biome]; U.uGrade.value.set(gr[0], gr[1], gr[2]); U.uGradeK.value = CHAR.gradeK[time] ?? 0;
    const dark = Math.max(0, 1 - lum(m.amb));
    U.uEmin.value = .1 + .2 * dark;
    const bg = BG[biome], bk = .35 + .65 * lum(amb); U.uBg.value.set(bg[0] * bk, bg[1] * bk, bg[2] * bk);
    // lights: the lift (a flat pool at the player in dark scenes), the lantern, features' lights, the nearest world lights.
    // (every record is reused frame to frame: LOUT goes to the shader, CAND holds the candidates, FREC copies features' lights)
    nL = 0;
    if (m.lift[0] + m.lift[1] + m.lift[2] > 0) putL(PX, P.z + .9, PY, m.lift, 1.7, 1, true);
    if ((opt.lantern || lanternMod > 0) && !host.playerHidden) {   // (photo mode may hide him: his lantern goes with him)
      const a = player.faceAngle, fx = Math.sin(a), fy = Math.cos(a), fk2 = flick(LANTERN, t);
      putL(PX + fx * LANTERN.fwd - fy * LANTERN.side, P.z + LANTERN.h, PY + fy * LANTERN.fwd + fx * LANTERN.side, LANTERN.c, LANTERN.r * lanternR * (1 + (fk2 - 1) * .15), fk2, false);
    }
    let nc = 0, nf = 0;
    const cand = l => { const d = hypot2(l.x - PX, l.z - PY); if (d < 24 + l.r) { const w = CW[nc] ??= {l: null, d: 0}; w.l = l; w.d = d; CAND[nc++] = w; } };
    for (const l of world.lights) cand(l);
    for (const f of features) if (f.on !== false && f.lights) for (const l of f.lights()) {
      const o = FREC[nf++] ??= {};
      o.x = l.x; o.y = l.h || 0; o.z = l.y; o.c = colOf(l.color ?? l.c); o.r = l.radius || l.r || 3; o.k = l.intensity ?? l.k ?? 1; o.flicker = l.flicker || 0; o.id = l.id ?? 7000; o.jitter = l.jitter; o.halo = l.halo;
      cand(o);
    }
    // nearest first, ties in the world-then-features order (a stable insertion sort of the first nc: Array.sort made a
    // work array a call and boxed every comparison's result)
    for (let i = 1; i < nc; i++) { const w = CAND[i]; let j = i - 1; while (j >= 0 && CAND[j].d > w.d) { CAND[j + 1] = CAND[j]; j--; } CAND[j + 1] = w; }
    // a flame's light wanders a few cm (l.jitter, else from its flicker), so the shadows round a fire dance with it
    for (let i = 0; i < nc && nL < 32; i++) {
      const l = CAND[i].l, k = flick(l, t), j = l.jitter ?? (l.flicker || 0) * .035, s = (l.id ?? 0) * 7.13;
      const jx = j ? j * (Math.sin(t * 11.3 + s) + Math.sin(t * 17.9 + s * 1.7) * .6) / 1.6 : 0, jz = j ? j * (Math.sin(t * 13.1 + s * 2.1) + Math.sin(t * 7.7 + s * .9) * .6) / 1.6 : 0;
      putL(l.x + jx, l.y + Math.abs(jz) * .5, l.z + jz, l.c, l.r * (1 + (k - 1) * .15), l.k * k, false, l.halo !== false);
    }
    U.uNL.value = nL; let nh = 0;
    for (let i = 0; i < nL; i++) {
      const l = LOUT[i];
      U.uLP.value[i].set(l.x, l.y, l.z, l.r); U.uLC.value[i].set(l.c[0] * l.gain, l.c[1] * l.gain, l.c[2] * l.gain, l.flat ? 1 : 0);
      if (l.flat || !l.halo) continue;   // (halo: false, a feature light without one: a muzzle flash)
      const a = Math.min(.75, HALO_A * l.gain * (m.glow ?? 1) * (.3 + .7 * dark) + Math.max(0, l.gain - 1.5) * .12); if (a < .02) continue;
      const sv = G.toScreenInto(l.x, l.y, l.z, SV3), sx = sv[0], sy = sv[1], hr = HALO_R + .12 * Math.min(2, l.gain) + Math.max(0, l.gain - 1.3) * .35;
      const pm = G.cine ? G.pxPerM(l.x, l.y, l.z) : 1; if (pm <= 0) continue;   // (a cinema camera: px a metre there, its perspective; 0 behind it)
      U.uHalo.value[nh].set(sx, G.VH - sy, G.cine ? hr * pm : hr * PPM * zoom, a); U.uHaloC.value[nh].set(l.c[0], l.c[1], l.c[2]); nh++;
    }
    U.uNH.value = nh;
    return m;
  }
  return {apply};
}
