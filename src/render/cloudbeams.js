// CLOUD BEAMS: god rays THROUGH THE CLOUDS (the user, 2026-11-07, after Red Giraffe's "Pixel Perfect" lighting video): the
// view ray of every art pixel is marched through the air in front of it, and each sample asks the sky the same question the
// cloud shadows ask the ground (render/clouds.js cloudAt, the CLOUDS2 bands): follow the sun's ray up from the sample to the
// cloud field's plane, is it under a cloud? Air lit through a gap between clouds glows; air under one doesn't. Unlike the
// cloud shadows (a projection of the ground) this is the space between the ground and the sky: columns of light leaning
// toward the sun, in any camera (top-down, third person, first person: drawn under the cinema camera too).
// THE MARCH. The view ray from the near plane to the pixel's surface (the sky: the far plane), clipped to the AIR: below
// TUNE.air m over the player's feet (higher air sees no ground) and at most TUNE.len m long from its near end (first person:
// the air in front of the eye; top-down: the column from TUNE.air m above the ground down to it). TUNE.steps samples, each
// shifted by a 4 x 4 ordered dither (screen px: no noise that crawls, a fixed pattern a pan moves whole). A sample's sun: what
// the cloud bands let through where its sun ray meets the field's plane (as gfx.js cloudSunAt: the slant capped the same,
// so the beams root in the shadows' own gaps), times the sun shadow maps (TUNE.shadows: a crown or a wall cuts its beam),
// times the DUST (TUNE.dust, a video comment's idea): a slow high-threshold noise in the air, drifting, so the beams are
// stronger in some places than in others.
// WHAT GLOWS. Lit air over lit ground adds nothing (it would only lift the picture like fog, and in a clear sky every ray is
// lit): a pixel glows by how much more sun its air has than the ground it shows (the cloud's sun at the surface; the sky's
// pixels: at the march's far end). So a beam hangs over the shade beside a sun patch, leaning toward the sun, and an
// overcast or a clear sky has none.
// THE LOOK (no blur: the pixel look). The glow cut into TUNE.levels hard levels, dithered between them with the same 4 x 4
// pattern (TUNE.dither: 0 plain steps), each level a flat amount (TUNE.amt) of the sun's colour, warmed and turned to amber as
// the sun sinks (as render/godrays.js). STRENGTH: the god rays' inputs (render/lighting.js -> rays.set: rays.In): stronger
// with a low sun, in mist, looking toward the sun; nothing at night (no sun shadow) or without the cloud bands on this frame.
// OWNS: its pass (material, uniforms), TUNE (live: G.cloudBeams.TUNE; F10 > Effects > Depth). READS: gfx.js compU (the
// G-buffer depth, the view's inverse projection, the sun, its shadow maps, the cloud uniforms), rays.In (never written).
// BUDGET (GPU): one full-screen pass at art px, TUNE.steps samples a pixel (a cloud field look-up, two shadow fetches and a
// dust noise each); skipped whole on a frame without cloud bands, at night, with ?cloudbeams=0 / ?godrays=0. No allocation
// per frame, no CPU pixel work.
//   const beams = createCloudBeams({THREE, renderer, raw, tri, cam, compU, rays}); beams.draw() after the composite, into
//   the same target; beams.TUNE (live); beams.strength (this frame's, read-only)
import {flags} from '../core/flags.js';
import {CLOUD_GLSL, CLOUD_EXTRA, CLOUDS2, BANDS} from './clouds.js';

export const TUNE = {
  // OFF by default (the user, 2026-11-07: "inte snyggt alls": a washed-out haze with the dither over everything, in rain and
  // mist); F10 > Effects > Depth or ?cloudbeams=1 turns it on to try
  on: CLOUDS2 && flags.get('cloudbeams') === '1' && flags.get('godrays') !== '0',
  steps: 16,        // samples along each pixel's ray
  air: 16,          // m over the player's feet: the top of the glowing air
  len: 32,          // m: the longest stretch of a ray marched (from its near end)
  levels: 3,        // hard levels of glow
  amt: [.09, .18, .3],   // light added per level, x the sun's colour (warmed) x strength
  gain: 1.6,        // the glow: (the air's sun - the surface's) x this, 0..1
  dither: 1,        // 0: plain steps between the levels .. 1: a full 4 x 4 ordered dither across each step
  shadows: true,    // the sun shadow maps cut the beams (a crown, a wall)
  dust: .45,        // the dust's swing: a sample's light x (1 - dust .. 1 + dust)
  dustCell: 7,      // m: the dust noise's cell
  dustAt: .55,      // the dust's threshold (high: dusty pockets here and there)
  dustDrift: [.35, .12],   // m/s the dust drifts (x, z)
  k: 1.5,           // overall strength
  el: [12, 50, .35],   // the sun's elevation (deg): full below el[0], x el[2] above el[1]
  view: [.55, 1],   // looking away from the sun .. toward it
  mist: .8,         // x (1 + mist x fog)
  warm: 1.15, gold: [1, .7, .28], goldK: .8, goldEl: [12, 45],   // the colour (as render/godrays.js)
  bias: .00005,     // the per-frame shadow map's depth bias (its units)
};

const VS = `precision highp float; precision highp int;\nin vec3 position; void main() { gl_Position = vec4(position.xy, 0., 1.); }`;
const FS = `precision highp float; precision highp int;
uniform sampler2D tD, tS, tSS;
uniform mat4 uInvPV, uLightPV, uLightPVS;
uniform float uSBias, uSOn;
uniform vec2 uRes;
uniform vec3 uSunDir;    // toward the sun (unit, world)
uniform vec4 uBm;        // steps, the air's top (world y), the longest stretch (m), the dither
uniform vec4 uBm2;       // the dust: swing, 1 / cell, threshold; the shadow bias (0: no shadow maps)
uniform vec4 uBm3;       // the dust's drift (m: x, z), levels, gain
uniform vec3 uBmC[3];    // the levels' colours
out vec4 oc;
${CLOUD_GLSL}
vec3 worldAt(ivec2 p, float d) { vec2 ndc = (vec2(p) + .5) / uRes * 2. - 1.; vec4 w = uInvPV * vec4(ndc, d * 2. - 1., 1.); return w.xyz / w.w; }
// the sun the clouds let through to X (the bands where its sun ray meets the field's plane: gfx.js cloudSunAt's slant)
float cloudSun(vec3 X) {
  vec3 G = X - vec3(uSunDir.x, 0., uSunDir.z) * (X.y / max(uSunDir.y, .5));
  vec3 c = cloudAt(ivec2(0), G);
  return (1. - cloudBlock(c)) * c.z;
}
bool shadowed(vec3 X) {
  vec3 a = (uLightPV * vec4(X, 1.)).xyz * .5 + .5;
  if (all(greaterThanEqual(a.xy, vec2(0.))) && all(lessThanEqual(a.xy, vec2(1.))) && a.z - uBm2.w > textureLod(tS, a.xy, 0.).r) return true;
  if (uSOn < .5) return false;
  vec3 b = (uLightPVS * vec4(X, 1.)).xyz * .5 + .5;
  return all(greaterThanEqual(b.xy, vec2(0.))) && all(lessThanEqual(b.xy, vec2(1.))) && b.z - uBm2.w * uSBias > textureLod(tSS, b.xy, 0.).r;
}
// the dust: value noise on the ground axes (an integer hash: render/clouds.js cfH), its height folded in, drifting
float dustAt(vec3 X) {
  vec2 p = (X.xz + uBm3.xy) * uBm2.y + vec2(X.y * .37 * uBm2.y, 0.), f = floor(p), t = p - f; t = t * t * (3. - 2. * t); ivec2 i = ivec2(f);
  float n = mix(mix(cfH(i, 41), cfH(i + ivec2(1, 0), 41), t.x), mix(cfH(i + ivec2(0, 1), 41), cfH(i + ivec2(1, 1), 41), t.x), t.y);
  return 1. + uBm2.x * (2. * smoothstep(uBm2.z - .15, uBm2.z + .15, n) - 1.);
}
float bayer4(ivec2 p) {
  int x = p.x & 3, y = p.y & 3;
  int b = (((x ^ y) & 1) << 3) | ((y & 1) << 2) | (((x ^ y) & 2)) | ((y & 2) >> 1);
  return (float(b) + .5) / 16.;
}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  float d = texelFetch(tD, ip, 0).r;
  vec3 A = worldAt(ip, 0.), B = worldAt(ip, min(d, 1.));
  vec3 r = B - A; float L = length(r); if (L < 1e-4) discard; r /= L;
  // the air: below uBm.y, at most uBm.z m from where the ray enters it
  float t0 = 0., t1 = L;
  if (r.y < 0.) t0 = max(0., (A.y - uBm.y) / -r.y);
  else if (A.y >= uBm.y) discard;
  else t1 = min(t1, (uBm.y - A.y) / max(r.y, 1e-4));
  t1 = min(t1, t0 + uBm.z);
  if (t1 <= t0 + .05) discard;
  float j = mix(.5, bayer4(ip), uBm.w), n = uBm.x, s = 0.;
  float dt = (t1 - t0) / n;
  for (int k = 0; k < 48; k++) {
    if (float(k) >= n) break;
    vec3 X = A + r * (t0 + (float(k) + j) * dt);
    float l = cloudSun(X);
    if (l <= 0.) continue;
    if (uBm2.w > 0. && shadowed(X)) continue;
    s += l * dustAt(X);
  }
  // the glow: the air's sun over the sun on what the pixel shows (the march's far end: the surface, or the sky's)
  float g = clamp((s / n - cloudSun(A + r * t1)) * uBm3.w, 0., 1.);
  float lv = min(uBm3.z, floor(g * uBm3.z + mix(.5, bayer4(ip + ivec2(2, 1)), uBm.w)));
  if (lv < .5) discard;
  oc = vec4(uBmC[int(lv) - 1], 0.);
}`;

export function createCloudBeams({THREE, renderer, raw, tri, cam, compU, rays}) {
  const U = {tD: compU.tD, tS: compU.tS, tSS: compU.tSS, uInvPV: compU.uInvPV, uLightPV: compU.uLightPV, uLightPVS: compU.uLightPVS,
    uSBias: compU.uSBias, uSOn: compU.uSOn, uRes: compU.uRes, uSunDir: compU.uSunDir,
    uBm: {value: new THREE.Vector4()}, uBm2: {value: new THREE.Vector4()}, uBm3: {value: new THREE.Vector4()},
    uBmC: {value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]}};
  for (const k of ['tTop', 'uCl', 'uClM', 'uClO', 'uClC', 'uClT', 'uFr', 'uFrB', 'uFrK', 'uFrC', 'uFrS', 'uFrQ', ...CLOUD_EXTRA]) U[k] = compU[k];   // (the clouds: render/clouds.js)
  const sc = new THREE.Scene(); sc.matrixAutoUpdate = false;
  const m = new THREE.Mesh(tri, raw(VS, FS, U, {depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor}));
  m.frustumCulled = false; m.matrixAutoUpdate = false; sc.add(m);
  if (TUNE.on) renderer.compile(sc, cam);   // (while the page loads: no hitch the first time a cloud passes)
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const B = {TUNE, strength: 0, live: false, draw};
  function draw() {
    const T = TUNE;
    B.live = false; B.strength = 0;
    if (!T.on || !BANDS.on || compU.uCl.value.x < .5 || compU.uShadowA.value <= 0 || compU.uDebug.value) return;
    const In = rays.In; if (!In || In.el <= 0) return;
    // the strength: a low sun, mist, looking toward the sun (the camera's forward on the ground against the sun's bearing)
    const v = compU.uView.value, s = compU.uSunDir.value, sl = Math.hypot(s.x, s.z) || 1, vl = Math.hypot(v.x, v.z) || 1;
    const fw = -(v.x * s.x + v.z * s.z) / (vl * sl);
    const kEl = 1 - (1 - T.el[2]) * smooth(T.el[0], T.el[1], In.el);
    const k = T.k * kEl * (T.view[0] + (T.view[1] - T.view[0]) * smooth(-.4, .9, fw)) * (1 + T.mist * (In.mist || 0)) * Math.min(1, compU.uShadowA.value / .3);
    B.strength = k;
    if (k <= .01) return;
    const c = In.c || [1, 1, 1], gk = T.goldK * (1 - smooth(T.goldEl[0], T.goldEl[1], In.el)), G = T.gold;
    const wr = Math.pow(c[0], T.warm) * (1 - gk) + G[0] * gk, wg = Math.pow(c[1], T.warm) * (1 - gk) + G[1] * gk, wb = Math.pow(c[2], T.warm) * (1 - gk) + G[2] * gk;
    const nl = Math.max(1, Math.min(3, Math.round(T.levels)));
    for (let i = 0; i < 3; i++) { const a = T.amt[Math.min(i, T.amt.length - 1)] * k; U.uBmC.value[i].set(wr * a, wg * a, wb * a); }
    const feet = compU.uPlayer.value.y - .9, now = performance.now() / 1000;
    U.uBm.value.set(Math.max(2, Math.min(48, Math.round(T.steps))), feet + T.air, T.len, T.dither);
    U.uBm2.value.set(T.dust, 1 / Math.max(.5, T.dustCell), T.dustAt, T.shadows && compU.uShadowOn.value > .5 ? T.bias : 0);
    // (the drift wrapped at 256 cells of the dust noise: its lattice repeats there, so no jump and no lost precision)
    const P = 256 * Math.max(.5, T.dustCell), dx = (now * T.dustDrift[0]) % P, dz = (now * T.dustDrift[1]) % P;
    U.uBm3.value.set(-dx, -dz, nl, T.gain);
    const rt = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.render(sc, cam);
    B.live = true;
  }
  return B;
}
