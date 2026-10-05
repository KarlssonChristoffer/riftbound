// ANOMALY / TEAR: the rift's slit, one camera-facing quad in the G-buffer whose fragment shader paints it texel by texel
// (the art in a shader: each texel one screen pixel at zoom 1, whole texels at any zoom, palette tones only: no AA, no
// dither, no gradient). What it paints, W x H texels (the quad stands on its anchor, its pivot the bottom middle):
//   void     a lens of deep violet-black, widest a little below its middle, closing to glowing cracks at both ends; a dark
//            inner rim, a slow nebula of two near-black tones drifting up, a few star specks drifting down and twinkling
//   edge     torn: angular teeth (each side its own, ~5-6 rows a tooth) and a slow writhe; licks of light rising along it
//            like flames, 1..~8 texels out (the white-hot rim, pink, magenta, a violet tail that breaks off and comes
//            back), their lengths a slow noise along the edge; all stepped 10 times a second, so the edge writhes a pixel
//            at a time; the rim crackles (a texel now and then one tone cooler)
//   pulse    uPulse 0..1 (a slow breath): the lens a texel wider, the licks longer, the second band white-hot at its peak
// The centre line sways a texel or two (a torn S). All motion comes from uT, the feature's own clock (its view: frozen in a
// still photo, going on behind the menu). It writes the G-buffer like a painted card (type 3, obj 9: no outline, no sun
// shadow, not mirrored in the water) with its glow as emission, so it glows at night and reads as a hole by day.
// Not in the shadow passes: a hole in space casts no shadow.
//   const T = createTear(G, THREE, {PPM, PPMH}); T.set(x, h, y, t, pulse) (arena coords: x east, y south, h up); T.arm() on a frame
//   it shows (gfx.js extra: shown only on a frame armed); T.size = {W, H} (texels)
// OWNS: its mesh (G.extra 'gbuf'), its material's uniforms. READS: G (VW, VH, frame, shaders, QUAD, U.camYaw), PPM / PPMH (px per m).
// BUDGET: CPU ~2 µs a frame (a few uniforms); GPU one quad of ~34 x 70 px: nothing measurable.
import {NumU} from './specks.js';   // (a number-only uniform: no heap number per write)
export const SIZE = {W: 34, H: 70, margin: 3};   // texels; margin: rows above / below the lens left for its cracks' glow
// the rift's palette (world/biomes.js STYLES.rift: crystal ramp, gemGlow, runeDim; the void from its floor's darkest tones)
export const PAL = ['#ffe0fa', '#ffc6f2', '#ea7ee4', '#ad48bd', '#5c2474', '#0b0717', '#1a1030', '#2b1747', '#f6efff', '#9a7ae0', '#8a4ad8'];

const VS = `
in vec3 position;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uAnchor; uniform float uYaw; uniform vec2 uPx, uSnap, uSize;
out vec2 vT;
void main() {
  vec2 c = position.xy; vT = c * uSize;
  vec3 right = vec3(cos(uYaw), 0., -sin(uYaw));
  vec3 w = uAnchor + right * ((c.x - .5) * uSize.x / uPx.x) + vec3(0., c.y * uSize.y / uPx.y, 0.);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
  vec4 a = projectionMatrix * viewMatrix * vec4(uAnchor, 1.);   // the anchor on a pixel corner: the texels on the pixels
  vec2 p = (a.xy * .5 + .5) * uSnap;
  gl_Position.xy += (floor(p + .5) - p) / uSnap * 2.;
}`;
const FS = `
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
in vec2 vT;
uniform float uT, uPulse, uYaw, uHW, uMargin;
uniform vec2 uSize;
uniform vec3 uPal[11];
float hs(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n1(float x, float s) { float i = floor(x), f = fract(x); f = f * f * (3. - 2. * f); return mix(hs(vec2(i, s)), hs(vec2(i + 1., s)), f); }
float tri(float t) { return 1. - abs(2. * fract(t) - 1.); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hs(i), hs(i + vec2(1., 0.)), f.x), mix(hs(i + vec2(0., 1.)), hs(i + vec2(1., 1.)), f.x), f.y); }
void main() {
  ivec2 it = ivec2(floor(vT));
  float W = uSize.x, H = uSize.y, x = float(it.x), y = float(it.y) + .5;
  float v = (y - uMargin) / (H - 2. * uMargin);            // 0 at the lens's bottom tip .. 1 at its top
  if (v < 0. || v > 1.) discard;
  float tk = floor(uT * 10.), ts = mod(tk, 4096.) * .1, tw = mod(tk, 2048.);   // the writhing's steps (10 a second)
  float prof = pow(sin(3.14159 * pow(v, .92)), .7);         // the lens: 0 at the tips, 1 a little below the middle
  float cx = .5 * W + 2. * sin(v * 4.4 + .7) + 1.2 * sin(y * .19 + ts * .8) + .7 * sin(y * .43 - ts * 1.4 + 2.);
  float hw = (uHW + floor(uPulse * 1.6)) * prof;
  // torn edges: angular teeth (each side its own, ~5-6 rows a tooth, fixed) and a slow writhe (stepped)
  float tl = y / 5.3 + .3, tr = y / 6.1 + .7;
  float jl = ((.6 + 2.4 * hs(vec2(floor(tl), 3.))) * (tri(tl) - .5) + (n1(y * .23 + ts * .45, 11.) - .5) * 2.2) * prof;
  float jr = ((.6 + 2.4 * hs(vec2(floor(tr), 7.))) * (tri(tr) - .5) + (n1(y * .23 - ts * .4, 23.) - .5) * 2.2) * prof;
  float XL = floor(cx - hw - jl + .5), XR = floor(cx + hw + jr + .5), XC = floor(cx + .5);
  bool slit = XR - XL >= 2.;
  float side = x < cx ? 0. : 1., d, rw = floor(y * .5);
  if (slit) d = x <= XL ? XL - x + 1. : x >= XR ? x - XR + 1. : 0.;   // 1 = the rim, beside the void (0)
  else d = abs(x - XC) + 1.;                                            // a crack: its line is the rim
  vec3 alb, em;
  if (d > 0.) {
    // a lick of light: tongues rising along the edge (each side its own), longer with the pulse, short at the tips
    float lk = 1. + floor((1.8 + 5.2 * smoothstep(.25, .9, n1(y * .21 - ts * 1.5 + side * 31., 41. + side)) + 1.6 * uPulse) * (.3 + .7 * prof));
    if (d > lk) discard;
    if (d > 2.5 && d > lk - .5 && hs(vec2(rw + side * 50., floor(ts * 4.))) < .25) discard;   // its tail breaks off and comes back
    int k = d < 1.5 ? (hs(vec2(y, tw)) < .13 ? 1 : 0) : d < 2.5 ? (uPulse > .75 ? 0 : 1) : d < 3.5 ? 2 : d < .5 + lk * .75 ? 3 : 10;
    alb = uPal[k]; em = alb;
  } else {
    bool rim = x == XL + 1. || x == XR - 1.;
    alb = n2(vec2(x * .45, (y - ts * 1.1) * .2)) > .64 ? uPal[6] : uPal[5];
    if (rim) alb = uPal[7];
    em = alb * .6;
    if (!rim) {   // star specks: drifting down a texel every ~1.1 s, twinkling
      float s = hs(vec2(x + 61., floor(y + ts * .9)));
      if (s > .955 && hs(vec2(s * 97., floor(ts * 2.5))) > .2) { alb = s > .988 ? uPal[8] : uPal[9]; em = alb; }
    }
  }
  const float S20 = .34202, C20 = .93969;
  vec3 F = vec3(sin(uYaw), 0., cos(uYaw));
  o0 = vec4(alb, float(3 * 4) / 255.);
  o1 = vec4(normalize(vec3(0., S20 + .25, 0.) + F * C20), 9.);
  o2 = vec4(em, 0.);
}`;

export function createTear(G, THREE, {PPM, PPMH, W = SIZE.W, H = SIZE.H, margin = SIZE.margin, hw = 5}) {
  const HEAD = G.shaders.HEAD;
  const pal = PAL.map(h => { const n = parseInt(h.slice(1), 16); return new THREE.Vector3((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); });
  const U = {uAnchor: {value: new THREE.Vector3()}, uYaw: G.U.camYaw,   // (the camera's own: the yaw it renders with)
    uPx: {value: new THREE.Vector2(PPM, PPMH)}, uSnap: {value: new THREE.Vector2(G.VW, G.VH)},
    uSize: {value: new THREE.Vector2(W, H)}, uT: new NumU(0), uPulse: new NumU(0), uHW: {value: hw}, uMargin: {value: margin}, uPal: {value: pal}};
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', G.QUAD.getAttribute('position'));   // (never dispose: it shares the quad's GL buffer)
  const mesh = new THREE.Mesh(geo, new THREE.RawShaderMaterial({vertexShader: HEAD + VS, fragmentShader: HEAD + FS, glslVersion: THREE.GLSL3,
    uniforms: U, side: THREE.DoubleSide}));
  mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  G.extra(mesh, 'gbuf');
  return {
    size: {W, H, margin}, mesh, U,
    // this frame's look: the anchor (arena x, y; h the lens's foot, metres), the clock (s), the pulse (0..1)
    set(x, h, y, t, pulse) {
      U.uAnchor.value.set(x, h - margin / PPMH, y); U.uT.value = t; U.uPulse.value = pulse;
      U.uSnap.value.set(G.VW, G.VH);
    },
    arm() { mesh.userData.frame = G.frame; },
  };
}
