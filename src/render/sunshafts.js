// SUN SHAFTS (the user, 2026-11-07: the god rays of early October "never became good"; start over from Red Giraffe's "Pixel
// Perfect" lighting video and its comments). They replace render/godrays.js (?godrays=1 brings those back for an A/B, and then
// these step aside) and the cloud beams tried the same day. TWO WAYS (TUNE.mode; F10). 'air' (the default since he showed the
// video's own shots: wide wedges of lit air between shadows, over everything): AIR_FS below, one pass at the art px over the ground and the sky only, marches each
// pixel's view ray back from its surface and counts air that is sunlit with shade across the sun on most sides (a crown gap,
// TUNE.beam[0], or a cloud gap, beam[1]); open sunny air has none beside it, so no veil; then the levels as below.
// 'fleck' (?shafts=fleck), two cheap passes after the composite, under any camera:
// 1. WHERE THE LIGHT COMES IN (SRC_FS, at half the art resolution): a sunlit spot with shade on BOTH sides of it across the sun,
//    within TUNE.open m (a gap in a crown, the slot between pillars or trunks, a narrow gap between cloud shadows). Not open sunny
//    ground: a shaft is light through an opening. Sun = the cloud bands where the sun's ray meets their plane (render/clouds.js,
//    the same look-up the composite lights by) x the two sun shadow maps x a face turned to the sun. A slow world-fixed DUST noise
//    (a comment's idea) weakens some openings, so a few shafts read and the rest stay quiet. r: the source, g: this spot's sun.
// 2. DRAWN OUT TOWARD THE SUN (SHAFT_FS, at art px): a shaft is the air over its spot, along the sun's ray; on screen that is a
//    straight line from the spot toward where the sun's direction projects (the same in the top-down view, where it is one
//    direction for the whole picture, and in third / first person, where the lines lean toward the sun in the sky). A pixel
//    looks back down that line (TUNE.taps steps over TUNE.len m of the sun's ray from its own surface) for a source; the nearest
//    source counts most, fading to nothing at the shaft's top: the directional smear the comments asked for, with the source's
//    own sharp sides (a max, not a sum: no blur). It shows only where the pixel's own surface is in shade (the air over a dark
//    floor; never a veil over sunny ground). Cut into TUNE.lv hard levels, flat amounts of the sun's colour (warmed, amber as the
//    sun sinks). No dither, no history.
// STRENGTH: stronger with a low sun and looking toward it; none at night (no sun shadow), none in a debug view; less in rain,
// fog and snow (the air is thick with its own haze there: TUNE.wx). Everything here reads the frame as it is (no state).
// OWNS: its two passes, the source target, TUNE (live: G.shafts.TUNE; F10 > Effects > Depth). READS: gfx.js compU (the depth,
// normals, the inverse projection and projection, the sun and its shadow maps, the cloud uniforms), rays.In (the god rays'
// strength inputs, which render/lighting.js sets every frame; never written). BUDGET (GPU): the source pass at a quarter of the
// art px (five sun tests each), the shaft pass TUNE.taps fetches of a byte pair a pixel. No allocation per frame, no CPU pixel work.
//   const shafts = createSunShafts({THREE, renderer, raw, tri, cam, compU, rays}); shafts.draw() after the composite, into the
//   same target; shafts.TUNE (live); shafts.enabled; shafts.strength (this frame's)
import {flags} from '../core/flags.js';
import {CLOUD_GLSL, CLOUD_EXTRA} from './clouds.js';

export const TUNE = {
  on: flags.get('shafts') !== '0' && flags.get('godrays') !== '1' && flags.get('godrays') !== '0',
  mode: flags.get('shafts') === 'fleck' ? 'fleck' : 'air',   // air: lit air between shadows, marched (the video's way); fleck: flecks on the ground drawn out
  steps: 20,         // air: samples along a pixel's view ray
  reach: 22,         // air: m of air marched back from the surface toward the camera
  beam: [1.6, 0],    // air: m to each side a beam needs shade (crown gaps; cloud gaps: 0 = none, they swam as the clouds drifted)
  gain: 3,           // air: the beam air's share x this before the levels
  open: [1.1, 2.6],  // m: a fleck has shade all round it this far out (nearly every way) and this far (three ways of four)
  len: 7,            // m of the sun's ray a shaft reaches above its spot (a crown's height)
  taps: 28,          // steps a pixel looks back down its line for a source
  maxPx: 70,         // art px: no shaft longer on screen (near the camera in third / first person)
  lv: [.2, .45, .75],   // a pixel's glow (0..1: its source's, fading over the shaft's top part from lv[0] of its length) for levels 1, 2, 3
  amt: [.06, .11, .17],   // light added per level, x the sun's colour (warmed) x strength
  dust: .45,         // how much the dust weakens a source where it is thin (0: every opening alike)
  dustCell: 6,       // m: the dust noise's cell
  dustAt: .5,        // the dust's threshold (higher: fewer strong shafts)
  dustDrift: [.15, .05],   // m/s
  k: 1,              // overall strength
  el: [10, 55, .25], // the sun's elevation (deg): full below el[0], x el[2] above el[1] (noon: faint)
  view: [.6, 1],     // looking away from the sun .. toward it
  wx: .8,            // rain / fog / snow take this share away at their thickest (rays.In.mist: the sky's fog or the mist's medium)
  warm: 1.15, gold: [1, .72, .3], goldK: .8, goldEl: [10, 45],   // the colour
  bias: .00005,      // the per-frame shadow map's depth bias (its units)
  debug: 0,          // 1: paint the sources (red) and the sunny ground (green) over the picture; 2: the smear (magenta) everywhere
};

const VS = `precision highp float; precision highp int;\nin vec3 position; void main() { gl_Position = vec4(position.xy, 0., 1.); }`;
const COMMON = `precision highp float; precision highp int;
uniform sampler2D tD;
uniform mat4 uInvPV, uPVf;
uniform vec2 uRes;
uniform vec3 uSunDir;    // toward the sun (unit, world)
vec3 worldAt(ivec2 p, float d) { vec2 ndc = (vec2(p) + .5) / uRes * 2. - 1.; vec4 w = uInvPV * vec4(ndc, d * 2. - 1., 1.); return w.xyz / w.w; }`;
const SRC_FS = `${COMMON}
uniform sampler2D tN, tS, tSS;
uniform mat4 uLightPV, uLightPVS;
uniform float uSBias, uSOn;
uniform vec4 uSh;        // open widths (m: two), the shadow bias, the dust's amount
uniform vec4 uSh2;       // the dust: 1 / cell, threshold, drift (m: x, z)
out vec4 oc;
${CLOUD_GLSL}
bool shadowed(vec3 X) {
  vec3 a = (uLightPV * vec4(X, 1.)).xyz * .5 + .5;
  if (all(greaterThanEqual(a.xy, vec2(0.))) && all(lessThanEqual(a.xy, vec2(1.))) && a.z - uSh.z > textureLod(tS, a.xy, 0.).r) return true;
  if (uSOn < .5) return false;
  vec3 b = (uLightPVS * vec4(X, 1.)).xyz * .5 + .5;
  return all(greaterThanEqual(b.xy, vec2(0.))) && all(lessThanEqual(b.xy, vec2(1.))) && b.z - uSh.z * uSBias > textureLod(tSS, b.xy, 0.).r;
}
// the sun at X: the clouds' (the composite's look-up: where the sun's ray meets their plane) and the shadow maps
bool lit(vec3 X) {
  if (uCl.x > .5) {
    vec3 G = X - vec3(uSunDir.x, 0., uSunDir.z) * (X.y / max(uSunDir.y, .5)), c = cloudAt(ivec2(0), G);
    if ((1. - cloudBlock(c)) * c.z < .5) return false;
  }
  return !shadowed(X);
}
float dustAt(vec3 X) {
  vec2 p = (X.xz + uSh2.zw) * uSh2.x, f = floor(p), t = p - f; t = t * t * (3. - 2. * t); ivec2 i = ivec2(f);
  float n = mix(mix(cfH(i, 43), cfH(i + ivec2(1, 0), 43), t.x), mix(cfH(i + ivec2(0, 1), 43), cfH(i + ivec2(1, 1), 43), t.x), t.y);
  return 1. - uSh.w * (1. - smoothstep(uSh2.y - .12, uSh2.y + .12, n));
}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy) * 2 + 1, sz = ivec2(uRes);
  ip = min(ip, sz - 1);
  float d = texelFetch(tD, ip, 0).r;
  if (d > .99999) { oc = vec4(0., 1., 0., 1.); return; }   // (the sky: no source, counts as lit)
  vec3 P = worldAt(ip, d), N = normalize(texelFetch(tN, ip, 0).xyz);
  bool L = dot(N, uSunDir) > .05 && lit(P + N * .03);
  float src = 0.;
  if (L) {   // (a fleck: shade all round it, near (eight ways) and farther out (four))
    vec3 a = normalize(vec3(-uSunDir.z, 0., uSunDir.x)), b = vec3(-a.z, 0., a.x);
    float n = 0., f = 0.;
    for (int i = 0; i < 8; i++) { float w = float(i) * .7853982; vec3 o = (a * cos(w) + b * sin(w)) * uSh.x; n += lit(P + o) ? 0. : 1.; }
    for (int i = 0; i < 4; i++) { float w = float(i) * 1.5707963 + .3926991; vec3 o = (a * cos(w) + b * sin(w)) * uSh.y; f += lit(P + o) ? 0. : 1.; }
    src = smoothstep(5.5, 7.5, n) * smoothstep(2.5, 3.5, f);
    if (src > 0.) src *= dustAt(P);
  }
  oc = vec4(src, L ? 1. : 0., 0., 1.);
}`;
// AIR (TUNE.mode 'air', the video's way): march this pixel's view ray back from its surface toward the camera; a sample
// counts when it is sunlit AND has shade across the sun on most sides (a beam: light through a gap in the crowns, or wider,
// between cloud shadows). Open sunny air has no shade beside it (no veil), shaded air no sun. r: the beam air's share.
const AIR_FS = `${COMMON}
uniform sampler2D tN, tS, tSS;
uniform mat4 uLightPV, uLightPVS;
uniform float uSBias, uSOn;
uniform vec4 uSh;        // beam widths (m: crowns, clouds), the shadow bias, the dust's amount
uniform vec4 uSh2;       // the dust: 1 / cell, threshold, drift (m: x, z)
uniform vec4 uSa;        // steps, reach (m), gain, debug
uniform vec3 uLv;        // the levels' thresholds
uniform vec3 uCol[3];    // the levels' colours
out vec4 oc;
${CLOUD_GLSL}
bool shadowed(vec3 X) {
  vec3 a = (uLightPV * vec4(X, 1.)).xyz * .5 + .5;
  if (all(greaterThanEqual(a.xy, vec2(0.))) && all(lessThanEqual(a.xy, vec2(1.))) && a.z - uSh.z > textureLod(tS, a.xy, 0.).r) return true;
  if (uSOn < .5) return false;
  vec3 b = (uLightPVS * vec4(X, 1.)).xyz * .5 + .5;
  return all(greaterThanEqual(b.xy, vec2(0.))) && all(lessThanEqual(b.xy, vec2(1.))) && b.z - uSh.z * uSBias > textureLod(tSS, b.xy, 0.).r;
}
bool lit(vec3 X) {
  if (uCl.x > .5) {
    vec3 G = X - vec3(uSunDir.x, 0., uSunDir.z) * (X.y / max(uSunDir.y, .5)), c = cloudAt(ivec2(0), G);
    if ((1. - cloudBlock(c)) * c.z < .5) return false;
  }
  return !shadowed(X);
}
float dustAt(vec3 X) {
  vec2 p = (X.xz + uSh2.zw) * uSh2.x, f = floor(p), t = p - f; t = t * t * (3. - 2. * t); ivec2 i = ivec2(f);
  float n = mix(mix(cfH(i, 43), cfH(i + ivec2(1, 0), 43), t.x), mix(cfH(i + ivec2(0, 1), 43), cfH(i + ivec2(1, 1), 43), t.x), t.y);
  return 1. - uSh.w * (1. - smoothstep(uSh2.y - .12, uSh2.y + .12, n));
}
float shade4(vec3 X, vec3 a, vec3 b, float w) {
  return (lit(X + a * w) ? 0. : 1.) + (lit(X - a * w) ? 0. : 1.) + (lit(X + b * w) ? 0. : 1.) + (lit(X - b * w) ? 0. : 1.);
}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  float d = texelFetch(tD, ip, 0).r;
  if (d <= .99999 && normalize(texelFetch(tN, ip, 0).xyz).y < .55) discard;   // (only the air over the ground and the sky: never a wash over a crown, a trunk, a figure)
  vec3 C = worldAt(ip, 0.), F = worldAt(ip, min(d, .99999)), v = F - C;
  float L = length(v); v /= max(L, 1e-4);
  float reach = min(uSa.y, L);
  vec3 P = d > .99999 ? C + v * uSa.y : F;   // (the sky: the air out to the reach)
  vec3 a = normalize(vec3(-uSunDir.z, 0., uSunDir.x)), b = normalize(cross(uSunDir, a));
  float n = uSa.x, g = 0.;
  for (int i = 0; i < 48; i++) {
    if (float(i) >= n) break;
    vec3 X = P - v * (reach * (float(i) + .5) / n);
    if (!lit(X)) continue;
    float k = smoothstep(2.5, 3.5, shade4(X, a, b, uSh.x));
    if (k < 1. && uSh.y > .5) k = max(k, smoothstep(2.5, 3.5, shade4(X, a, b, uSh.y)));
    if (k > 0.) g += k * dustAt(X);
  }
  g = min(1., g / n * uSa.z);
  if (uSa.w > .5) { oc = vec4(g, 0., g, 0.); return; }
  float lv = dot(step(uLv, vec3(g)), vec3(1.));
  if (lv < .5) discard;
  oc = vec4(uCol[int(lv) - 1], 0.);
}`;
const SHAFT_FS = `${COMMON}
uniform sampler2D tSrc;
uniform vec4 uSf;        // the shaft's length (m), taps (0: TUNE.mode 'air', the glow is read as it is), debug, its longest on screen (px)
uniform vec3 uLv;        // the levels' thresholds
uniform vec3 uCol[3];    // the levels' colours
out vec4 oc;
vec2 px(vec3 X) { vec4 c = uPVf * vec4(X, 1.); return (c.xy / c.w * .5 + .5) * uRes; }
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy), sz = textureSize(tSrc, 0);
  float d = texelFetch(tD, ip, 0).r;
  if (uSf.z > .5 && uSf.z < 1.5) { vec2 m = texelFetch(tSrc, min(ip / 2, sz - 1), 0).rg; oc = vec4(m.x, m.y * .25, 0., 0.); return; }   // (TUNE.debug: the sources red, sunny ground green)
  if (uSf.y < .5) {   // (air: the beam air's share, cut into the levels)
    float g = texelFetch(tSrc, min(ip / 2, sz - 1), 0).r;
    if (uSf.z > .5) { oc = vec4(g, 0., g, 0.); return; }
    float L = dot(step(uLv, vec3(g)), vec3(1.));
    if (L < .5) discard;
    oc = vec4(uCol[int(L) - 1], 0.); return;
  }
  if (uSf.z < 1.5 && texelFetch(tSrc, min(ip / 2, sz - 1), 0).g > .5 && d <= .99999) discard;   // (sunny ground: no shaft shows over it)
  vec3 P = worldAt(ip, min(d, .99999));
  vec4 cb = uPVf * vec4(P + uSunDir * uSf.x, 1.);
  if (cb.w <= 0.) discard;   // (the sun behind the camera's plane from here: the line runs off)
  vec2 a = vec2(ip) + .5, D = (cb.xy / cb.w * .5 + .5) * uRes - a;   // (px: from this pixel up its shaft's full length)
  float dl = length(D);
  if (dl < 1.) discard;
  D *= min(1., uSf.w / dl);   // (a shaft near the camera would run across the whole picture: TUNE.maxPx)
  float g = 0., n = uSf.y;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= n) break;
    float t = (float(i) + .5) / n;
    ivec2 q = ivec2(floor(a - D * t)) / 2;   // (down the line, toward the shaft's foot: the source under this air)
    if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, sz))) break;
    float s = texelFetch(tSrc, q, 0).r * (1. - smoothstep(uLv.x, 1., t));   // (full most of the way up, then gone at its top)
    g = max(g, s);
  }
  if (uSf.z > 1.5) { oc = vec4(g * .6, 0., g * .6, 0.); return; }   // (TUNE.debug 2: the smear itself, everywhere)
  float L = dot(step(uLv, vec3(g)), vec3(1.));
  if (L < .5) discard;
  oc = vec4(uCol[int(L) - 1], 0.);
}`;

export function createSunShafts({THREE, renderer, raw, tri, cam, compU, rays}) {
  const nf = THREE.NearestFilter;
  const srcRT = new THREE.WebGLRenderTarget(Math.ceil(compU.uRes.value.x / 2), Math.ceil(compU.uRes.value.y / 2), {format: THREE.RGFormat, minFilter: nf, magFilter: nf, depthBuffer: false, generateMipmaps: false});
  const base = {tD: compU.tD, uInvPV: compU.uInvPV, uPVf: compU.uPVf, uRes: compU.uRes, uSunDir: compU.uSunDir};
  const SU = {...base, tN: compU.tN, tS: compU.tS, tSS: compU.tSS, uLightPV: compU.uLightPV, uLightPVS: compU.uLightPVS, uSBias: compU.uSBias, uSOn: compU.uSOn,
    uSh: {value: new THREE.Vector4()}, uSh2: {value: new THREE.Vector4()}};
  for (const k of ['tTop', 'uCl', 'uClM', 'uClO', 'uClC', 'uClT', 'uFr', 'uFrB', 'uFrK', 'uFrC', 'uFrS', 'uFrQ', ...CLOUD_EXTRA]) SU[k] = compU[k];   // (the clouds: render/clouds.js)
  const FU = {...base, tSrc: {value: srcRT.texture}, uSf: {value: new THREE.Vector4()}, uLv: {value: new THREE.Vector3()},
    uCol: {value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]}};
  const AU = {...SU, uSa: {value: new THREE.Vector4()}, uLv: null, uCol: null};
  const full = (fs, u, extra) => { const sc = new THREE.Scene(); sc.matrixAutoUpdate = false; const m = new THREE.Mesh(tri, raw(VS, fs, u, {depthTest: false, depthWrite: false, ...extra})); m.frustumCulled = false; m.matrixAutoUpdate = false; sc.add(m); return sc; };
  const srcScene = full(SRC_FS, SU, {});

  const shaftScene = full(SHAFT_FS, FU, {transparent: true, blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor});
  AU.uLv = FU.uLv; AU.uCol = FU.uCol;
  const airScene = full(AIR_FS, AU, {transparent: true, blending: THREE.CustomBlending,   // (air: one pass at the art px, straight onto the picture)
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor});
  if (TUNE.on) { renderer.compile(TUNE.mode === 'air' ? airScene : srcScene, cam); renderer.compile(shaftScene, cam); }   // (while the page loads: no hitch at the first sunny frame)
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const S = {TUNE, strength: 0, live: false, draw, get enabled() { return TUNE.on && compU.uShadowOn.value > .5; }};
  function draw() {
    const T = TUNE;
    S.live = false; S.strength = 0;
    if (!T.on || compU.uShadowA.value <= 0 || compU.uShadowOn.value < .5 || compU.uDebug.value) return;
    const In = rays.In; if (!In || In.el <= 0) return;
    const v = compU.uView.value, s = compU.uSunDir.value, sl = Math.hypot(s.x, s.z) || 1, vl = Math.hypot(v.x, v.z) || 1;
    const fw = -(v.x * s.x + v.z * s.z) / (vl * sl);
    const kEl = 1 - (1 - T.el[2]) * smooth(T.el[0], T.el[1], In.el);
    const k = T.k * kEl * (T.view[0] + (T.view[1] - T.view[0]) * smooth(-.4, .9, fw)) * (1 - T.wx * Math.min(1, In.mist || 0)) * Math.min(1, compU.uShadowA.value / .3);
    S.strength = k;
    if (k <= .01) return;
    const c = In.c || [1, 1, 1], gk = T.goldK * (1 - smooth(T.goldEl[0], T.goldEl[1], In.el)), G = T.gold;
    const wr = Math.pow(c[0], T.warm) * (1 - gk) + G[0] * gk, wg = Math.pow(c[1], T.warm) * (1 - gk) + G[1] * gk, wb = Math.pow(c[2], T.warm) * (1 - gk) + G[2] * gk;
    for (let i = 0; i < 3; i++) FU.uCol.value[i].set(wr * T.amt[i] * k, wg * T.amt[i] * k, wb * T.amt[i] * k);
    FU.uLv.value.set(T.lv[0], T.lv[1], T.lv[2]);
    const air = T.mode === 'air';
    FU.uSf.value.set(Math.max(.5, T.len), air ? 0 : Math.max(2, Math.min(64, Math.round(T.taps))), +T.debug || 0, Math.max(4, T.maxPx));
    const now = performance.now() / 1000, P = 256 * Math.max(.5, T.dustCell);
    SU.uSh.value.set(air ? T.beam[0] : T.open[0], air ? T.beam[1] : T.open[1], T.bias, T.dust);
    AU.uSa.value.set(Math.max(2, Math.min(48, Math.round(T.steps))), Math.max(1, T.reach), T.gain, +T.debug || 0);
    SU.uSh2.value.set(1 / Math.max(.5, T.dustCell), T.dustAt, -(now * T.dustDrift[0]) % P, -(now * T.dustDrift[1]) % P);
    if (air) { renderer.render(airScene, cam); S.live = true; return; }
    const W = Math.ceil(compU.uRes.value.x / 2), H = Math.ceil(compU.uRes.value.y / 2);
    if (srcRT.width !== W || srcRT.height !== H) srcRT.setSize(W, H);
    const rt = renderer.getRenderTarget();
    renderer.setRenderTarget(srcRT); renderer.render(srcScene, cam);
    renderer.setRenderTarget(rt); renderer.render(shaftScene, cam);
    S.live = true;
  }
  return S;
}
