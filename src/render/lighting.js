// LIGHTING: the scene's light every frame, from the world clock's blended mood (sim/env.js) and the lights round the
// player: the sun (direction for shading + a capped one for shadow length), ambient, fog, the character's fill and
// grade, then up to 32 point lights (the dark scene's lift, the lantern, world + feature lights, nearest first, each
// flickering and wandering a few cm) with their halos (a feature light with halo: false has none). Writes the composite's
// uniforms (gfx.js compU); nothing else.
// TWO LIGHTS (wx-A; ?wxlight=0 the old one): while the weather changes over the view (a front, a deck breaking up: env.lightSides()
// two) there are two lights, each a whole mood: the OPEN light, where the sun gets through (env.open: the clear side, the gaps), in
// the uniforms as ever, and the UNDER light, under the deck (env.under: the storm side, the cloud that remains), in a second compact
// set (uAmb2 .. uLt2 below). The composite mixes them per pixel by the clouds' under share at the point (render/clouds.js
// cloudAt().y: 0 open .. 1 under): the ambient, the sun's shaping, its shadows, the coloured shade, the crests, the fog's veil, the
// emitters' floor, the character's fill (he is lit by where he stands). One light (the normal case: the same channels) leaves the
// second set off and the composite takes its old path, bit for bit. The halos and the background follow the view's mean (env.mood:
// env.light), as the features reading host.mood do.
// OWNS: the light records (reused frame to frame). READS: host.env / biome / world / player / P / zoom / VH, features'
//   lights(), opt.lantern, host.mods 'light.lantern' / 'light.lanternR' (a run rule lights the lantern: features/omens.js,
//   an eclipse). BUDGET: ~0.05 ms (part of view).
//   const lighting = createLighting({G, host, features, opt}); lighting.apply(PX, PY, t) once per frame before G.render
import * as THREE from 'three';
import {DEG} from './gfx.js';
import {CHAR} from '../content/moods.js';
import {lum, rgbOf} from '../core/color.js';
import {hypot2} from '../core/mathx.js';
import {flags} from '../core/flags.js';

const GRADE = {ruins: [1.039, 1.029, .818], ember: [1.166, .958, .82], frost: [.896, 1.013, 1.161], rift: [1.056, .792, 1.649], desert: [1.09, 1.0, .84]};
const BG = {ruins: [.10, .13, .11], ember: [.11, .06, .05], frost: [.10, .12, .17], rift: [.06, .04, .10], desert: [.15, .10, .07]};
const HALO_A = .16, HALO_R = .3, LANTERN = {fwd: .22, side: .3, h: .95, c: [1, .76, .48], r: 4.2, k: 1, flicker: .2, id: -7};
// UNDERGROUND (features/caves.js F.under 0..1: how far the world above has gone dark round him): the mood turns toward the cave's:
// a faint cold ambient, no sun, no sun shadows, no fog's colour, a black background, a small lift round him (he stays readable);
// the lights (his lantern, the crystals) do the rest
const CAVE = {amb: [.012, .012, .016], lift: [.05, .045, .04], fill: .25, glow: [.05, .049, .056], glowR: 7, glowH: 2, lantern: .5, lanternR: .25};   // (glow: a wide faint pool round him
// instead of an ambient: the cave's floor past the lantern shows its shapes, while the woods above, metres over him and away,
// go black, so the step into the cave changes nothing round him)
const mixInto = (a, b, k, o) => { o[0] = a[0] + (b[0] - a[0]) * k; o[1] = a[1] + (b[1] - a[1]) * k; o[2] = a[2] + (b[2] - a[2]) * k; return o; };
function flick(l, t) {
  const f = l.flicker || 0; if (!f) return 1;
  const s = (l.id ?? 0) * 12.9898 % 6.283, n = .5 * Math.sin(t * 7.3 + s) + .3 * Math.sin(t * 12.7 + s * 2.3) + .2 * Math.sin(t * 23.1 + s * 3.7);
  return 1 - f * .22 * (1 + n);
}
// the arena's longest sun shadow (lighting.js SUN_LEN_MAX): 1.7 m per metre of height. A low dusk sun (10-14 deg) still
// LIGHTS from low down (warm grazing light, rims), but its shadows stop growing at this length: the true 1 / tan(el)
// stretched trees and towers 4-6x their height across the map
const SUN_LEN_MAX = 1.7, SHADOW_EL_MIN = Math.atan(1 / SUN_LEN_MAX);
// COLOURED SHADE (?shade=0: the old look): a sun shadow keeps the colour of what it falls on and turns it toward the mood's
// shadow hue (moods.js shadow.c: blue by day, violet at dusk, the biome's own), the way sky light fills a shadow: sunlit grass
// yellow-green, shaded grass teal. The old shadow mixed every colour toward that one dark colour (grass, stone and path alike
// went the same grey-blue mud). dark: how much of the mood's shadow opacity (shadow.a) darkens it; hue: how far toward the hue
// (at full opacity: a weak, cloudy shadow is barely tinted); lift: a trace of the shadow colour added (dark things don't go
// black); face: the share of the hue on what faces away from the sun (cliff faces in shade, the dark side of props); cool: how far
// the hue leans toward the open sky's blue (SKY); unwarm: how much of a warm ambient's colour the shade takes back out (the
// shadow is lit by the sky, not by the low sun: at dusk the shade would otherwise go pink). crest: the 1 px light line along a
// block's top edge (gfx.js COMP_FS crest; ?crest=0 none); rim / rimLow: how much of the sun's colour it catches by day / with
// the sun low (golden rims at dusk and dawn). Live-tunable (import this module in the page and set SHADE's fields).
// dark 1.05 with one sun (gfx.js setSun; ?onesun=0: .62): a clear day's shadow ~.52 of the light, two to three of the ground's
// painted tones (a grass tone is ~.8 of the next): at .71 a tower's shadow read as one more of the meadow's swells
export const SHADE = {on: flags.get('shade') !== '0', dark: flags.get('onesun') !== '0' ? 1.05 : .62, hue: .45, lift: .25, face: .6, cool: .4, unwarm: .6,
  crest: flags.get('crest') !== '0', rim: .12, rimLow: .45};
const SKY = [.6, .72, 1];
const WXL = flags.get('wxlight') !== '0', CHS = ['cloud', 'rain', 'snow', 'fog', 'storm', 'wind'];   // (TWO LIGHTS: sim/env.js's weather channels)

export function createLighting({G, host, features, opt}) {
  const sunDir = new THREE.Vector3(), shadowDir = new THREE.Vector3();
  // the light records, reused every frame
  const LOUT = [], CAND = [], CW = [], FREC = [], colCache = new Map();
  let nL = 0;
  const colOf = c => { if (Array.isArray(c)) return c; let v = colCache.get(c); if (!v) colCache.set(c, v = rgbOf(c)); return v; };
  const ONE3 = [1, 1, 1], SV3 = [0, 0, 0];
  const RAYS = {el: 0, c: ONE3, shadow: 0, cloud: 0, mist: 0, wet: 0, sunView: 1, broken: 0, t: 0, env: null};   // the god rays' strength inputs (G.setRays: render/godrays.js), reused
  // (mist: the sky's fog, or the air's medium from the world mist when it's on: features/mist.js via G.mist, last frame's)
  // (wx-D: the envelope's: sunView the sun's share of the view, broken how broken the sky is (undefined: godrays.js estimates
  // it from env.front), t the frame's clock, env for its front and a preview)
  // the lantern by a run rule (features/omens.js, an eclipse): 'light.lantern' > 0 lights it whatever the switch says,
  // 'light.lanternR' scales its reach, 'light.lanternOut' > 0 puts it out whatever lights it (the cave's dark: features/caves.js);
  // read when the notes change. Its flame leans toward a hollow wall: features/cavelife.js F.lean (m, world x / y)
  let lanternMod = 0, lanternR = 1, lanternOut = 0, lean = undefined;
  if (host.mods) { const f = () => { lanternMod = host.mods.value('light.lantern', 0); lanternR = host.mods.value('light.lanternR', 1); lanternOut = host.mods.value('light.lanternOut', 0); }; host.mods.watch(f); f(); }
  function putL(x, y, z, c, r, gain, flat, halo = true) { const o = LOUT[nL] ??= {}; nL++; o.x = x; o.y = y; o.z = z; o.c = c; o.r = r; o.gain = gain; o.flat = flat; o.halo = halo; }
  // the coloured shade's uniforms (SHADE): T the shadow's multiply (rgb, w on), L its lift, H the hue alone (luminance 1)
  const HUE = [0, 0, 0];
  function shade(c, a, amb, T, L, H) {
    if (!SHADE.on || a <= 0) { T.set(1, 1, 1, SHADE.on ? 1 : 0); L.set(0, 0, 0); H.set(1, 1, 1); return; }
    // the hue: the shadow colour's (normalised to its brightest channel), leaning toward the sky, the ambient's warmth taken back
    // out, at luminance 1; then applied by w (a weak shadow barely tinted) and darkened by the shadow's opacity
    const mx = Math.max(c[0], c[1], c[2], 1e-3), la = Math.max(.02, lum(amb));
    for (let j = 0; j < 3; j++) HUE[j] = (c[j] / mx + (SKY[j] - c[j] / mx) * SHADE.cool) * Math.pow(la / Math.max(.02, amb[j]), SHADE.unwarm);
    const l = Math.max(.05, lum(HUE)), w = SHADE.hue * Math.min(1, a / .4), d = Math.max(0, 1 - a * SHADE.dark), f = SHADE.face;
    const h0 = 1 + (HUE[0] / l - 1) * w, h1 = 1 + (HUE[1] / l - 1) * w, h2 = 1 + (HUE[2] / l - 1) * w;
    T.set(h0 * d, h1 * d, h2 * d, 1); L.set(c[0] * a * SHADE.lift, c[1] * a * SHADE.lift, c[2] * a * SHADE.lift);
    H.set(1 + (h0 - 1) * f, 1 + (h1 - 1) * f, 1 + (h2 - 1) * f);
  }
  // TWO LIGHTS (above): the moods (the caller's records: no allocation a frame), the crest's sun rim for an elevation
  let MO = null, MU = null;
  const crestRim = el => SHADE.rim + (SHADE.rimLow - SHADE.rim) * (1 - Math.min(1, Math.max(0, (el - 8) / 27)));
  // the view's mean under share (where no cloud field says it per pixel: no clouds drawn this frame, the cinema camera): how far
  // env.light (the mean) lies from the open channels toward the under ones
  function meanShare(o, u, l) {
    let n = 0, d = 0;
    for (let i = 0; i < CHS.length; i++) { const c = CHS[i], w = c === 'wind' ? .3 : 1, a = ((u[c] ?? 0) - (o[c] ?? 0)) * w; n += ((l[c] ?? 0) - (o[c] ?? 0)) * w * a; d += a * a; }
    return d > 1e-9 ? Math.min(1, Math.max(0, n / d)) : 0;
  }
  let caves = null;   // (features/caves.js, found on the first frame)
  const AMB = [0, 0, 0], LIFT = [0, 0, 0];
  function apply(PX, PY, t) {
    const env = host.env, world = host.world, P = host.P, player = host.player, VH = host.VH, zoom = host.zoom, PPM = host.PPM;
    caves ??= features.find(f => f.name === 'caves') || false;
    const ug = caves ? caves.under : 0, sunK = (1 - ug) * (1 - ug);   // (UNDERGROUND above: the sun goes first, before the sky)
    const biome = host.biome.id, time = env.bucket, U = G.compU, sides = env.lightSides ? env.lightSides() : null, two = !!(sides && sides.two) && ug < .01;
    // the clock's blended mood: the open light's while two lights show, else the one (env.light's)
    const m = two ? env.moodFor(biome, sides.open, MO ||= env.blankMood()) : env.mood(biome), mv = two ? env.mood(biome) : m;
    const amb = ug > 0 ? mixInto(m.amb, CAVE.amb, ug, AMB) : m.amb; U.uAmb.value.set(amb[0], amb[1], amb[2]);   // (no spread, no map below: no array a frame)
    const az = m.sun.az * DEG, el = m.sun.el * DEG;
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const sel = Math.max(el, SHADOW_EL_MIN);
    shadowDir.set(Math.sin(az) * Math.cos(sel), Math.sin(sel), -Math.cos(az) * Math.cos(sel));
    G.setSun(sunDir, shadowDir);
    const sc = m.sun.c || ONE3; U.uSunC.value.set(sc[0], sc[1], sc[2]); U.uSunStr.value = m.sun.el > 2 ? (m.shadow.a > 0 ? 1 : .45) * (m.sun.k ?? .4) * 2.2 * sunK : 0;   // armour glints
    U.uSunK.value = m.sun.k * sunK; U.uShadowA.value = m.shadow.a > 0 && m.sun.el > 2 ? m.shadow.a * sunK : 0; U.uShadowC.value.set(m.shadow.c[0], m.shadow.c[1], m.shadow.c[2]);
    const sA = U.uShadowA.value, gap = G.cloudGap ? G.cloudGap() : 1;   // (the cloud shadows take the sun where they lie: the gaps get theirs back, render/clouds.js CLOUD_SUN)
    if (gap !== 1) U.uShadowA.value = Math.min(1, sA * gap);
    U.uFog.value.set(m.fog[0] * sunK, m.fog[1] * sunK, m.fog[2] * sunK, m.fog[3] * sunK);
    // the god rays: the sun's elevation and colour, the mood's shadow strength (clouds and nightfall in it), the view's cloud (env.light), the mist, wet ground
    if (G.setRays) { RAYS.el = m.sun.el; RAYS.c = sc; RAYS.shadow = sA; RAYS.cloud = env.light.cloud; RAYS.mist = G.mist?.on ? Math.max(env.sky.fog, G.mist.medium) : env.sky.fog; RAYS.wet = env.wet;
      RAYS.sunView = (env.sunView ?? 1 - env.light.cloud * .9) * sunK; RAYS.broken = env.broken; RAYS.t = t; RAYS.env = env; G.setRays(RAYS); }   // (wx-D)
    shade(m.shadow.c, U.uShadowA.value, amb, U.uShadeT.value, U.uShadeL.value, U.uShadeH.value);
    U.uCrest.value.set(SHADE.crest ? 1 : 0, U.uShadowA.value > 0 ? crestRim(m.sun.el) : 0);
    const la = Math.max(.02, lum(m.amb)), fk = lum(m.fill || [0, 0, 0]) / la * CHAR.fillK * (1 + (CAVE.fill - 1) * ug);
    U.uFill.value.set(amb[0] * fk, amb[1] * fk, amb[2] * fk); const gr = GRADE[biome]; U.uGrade.value.set(gr[0], gr[1], gr[2]); U.uGradeK.value = CHAR.gradeK[time] ?? 0;
    const dark = Math.max(0, 1 - lum(amb)), darkV = Math.max(0, 1 - lum(ug > 0 ? amb : mv.amb));   // (darkV: the view's mean, for the halos)
    U.uEmin.value = .1 + .2 * dark;
    const bg = BG[biome], bk = (.35 + .65 * lum(mv.amb)) * sunK; U.uBg.value.set(bg[0] * bk, bg[1] * bk, bg[2] * bk);
    // the UNDER light (TWO LIGHTS above): the same numbers from env.under's mood, into the second set; uLt2: on, the view's mean
    // under share (the composite's fallback), the old storm fake (?wxlight=0), the under light's emitter floor
    const L2 = U.uLt2.value;
    if (two) {
      const u = env.moodFor(biome, sides.under, MU ||= env.blankMood()), a2 = u.amb, c2 = u.sun.c || ONE3;
      const sA2 = u.shadow.a > 0 && u.sun.el > 2 ? u.shadow.a : 0, str2 = u.sun.el > 2 ? (u.shadow.a > 0 ? 1 : .45) * (u.sun.k ?? .4) * 2.2 : 0;
      U.uAmb2.value.set(a2[0], a2[1], a2[2]); U.uSunC2.value.set(c2[0], c2[1], c2[2]); U.uFog2.value.set(u.fog[0], u.fog[1], u.fog[2], u.fog[3]);
      U.uSun2.value.set(u.sun.k, sA2, str2, sA2 > 0 ? crestRim(u.sun.el) : 0);
      shade(u.shadow.c, sA2, a2, U.uShade2T.value, U.uShade2L.value, U.uShade2H.value);
      const fk2 = lum(u.fill || [0, 0, 0]) / Math.max(.02, lum(a2)) * CHAR.fillK; U.uFill2.value.set(a2[0] * fk2, a2[1] * fk2, a2[2] * fk2);
      L2.set(1, meanShare(sides.open, sides.under, env.light), 0, .1 + .2 * Math.max(0, 1 - lum(a2)));
    } else L2.set(0, 0, WXL ? 0 : 1, U.uEmin.value);
    // lights: the lift (a flat pool at the player in dark scenes), the lantern, features' lights, the nearest world lights.
    // (every record is reused frame to frame: LOUT goes to the shader, CAND holds the candidates, FREC copies features' lights)
    nL = 0;
    const lift = ug > 0 ? mixInto(m.lift, CAVE.lift, ug, LIFT) : m.lift;
    if (lift[0] + lift[1] + lift[2] > 0) putL(PX, P.z + .9, PY, lift, 1.7, 1, true);
    if (ug > 0) putL(PX, P.z + CAVE.glowH, PY, CAVE.glow, CAVE.glowR, ug, false);   // (UNDERGROUND: the cave's glow)
    if ((opt.lantern || lanternMod > 0) && lanternOut <= 0 && !host.playerHidden) {   // (photo mode may hide him: his lantern goes with him)
      const a = player.faceAngle, fx = Math.sin(a), fy = Math.cos(a), fk2 = flick(LANTERN, t);
      if (lean === undefined && features.length) lean = features.find(f => f.name === 'cavelife')?.lean || null;
      putL(PX + fx * LANTERN.fwd - fy * LANTERN.side + (lean ? lean.x : 0), P.z + LANTERN.h, PY + fy * LANTERN.fwd + fx * LANTERN.side + (lean ? lean.y : 0), LANTERN.c, LANTERN.r * lanternR * (1 + CAVE.lanternR * ug) * (1 + (fk2 - 1) * .15), fk2 * (1 + CAVE.lantern * ug), false);
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
      const a = Math.min(.75, HALO_A * l.gain * (mv.glow ?? 1) * (.3 + .7 * darkV) + Math.max(0, l.gain - 1.5) * .12); if (a < .02) continue;
      const sv = G.toScreenInto(l.x, l.y, l.z, SV3), sx = sv[0], sy = sv[1], hr = HALO_R + .12 * Math.min(2, l.gain) + Math.max(0, l.gain - 1.3) * .35;
      const pm = G.cine ? G.pxPerM(l.x, l.y, l.z) : 1; if (pm <= 0) continue;   // (a cinema camera: px a metre there, its perspective; 0 behind it)
      U.uHalo.value[nh].set(sx, G.VH - sy, G.cine ? hr * pm : hr * PPM * zoom, a); U.uHaloC.value[nh].set(l.c[0], l.c[1], l.c[2]); nh++;
    }
    U.uNH.value = nh;
    return m;
  }
  return {apply};
}
