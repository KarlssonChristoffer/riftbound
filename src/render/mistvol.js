// THE MIST AS A VOLUME (features/mist.js drives it every frame it shows it: G.setMistVol; ?mist=flat: the old flat sheet in
// gfx.js COMP_FS MIST instead). The old mist was a level: each pixel asked how far below a horizontal top its ground lay and
// drew that as a veil cut into three flat tones, so it read as the surface of a lake laid over the world. Here the mist is AIR
// WITH SOMETHING IN IT, marched along every pixel's view ray at art resolution, right after the composite (before the god rays):
//
// THE DENSITY at a world point X comes from a top-down FIELD of the world (features/mist.js bakes it when the world is built:
// the ground's height, how deep a hollow lies there, how near water is and its height; G.mistField) and a tiling 3D NOISE
// (made here, once):
//   film   a thin layer over all the ground, thinning upward (its height wanders with the noise),
//   pools  the hollows (the ravine, the stream's channel, the West Downs' dips) filled to a share of their depth, the top
//          billowing,
//   water  rising off the water and spilling over its banks,
// each broken into BANKS by the coarse noise (clear air between them) and BILLOWS by the fine one; the noise is fixed in the
// world, drifts with the wind (stretched along it: wisps), churns slowly, and steps rather than slides (mist.js sends whole
// world texels, the churn in steps).
// THE AIR (render/air.js, G.air: docs/exp/air.md): where the moving-air field says the air was blown CLEAR (a blast's bubble, a
// shot's channel, a runner's wake) the mist near the ground is gone, refilling as the field refills it; its noise is carried
// along the air's velocity (it swirls and streams round what pushes it); the field's SMOKE (a blast's dust) is mist too,
// near the ground, a shade darker. mist.js hands the field over with the frame's numbers (o.air); without it nothing changes.
// ROUND HIM (features/mist.js TUNE.vol.near): the mist low down thins in a few metres round the player, so the ground he stands
// on and the tracks on it read in the thickest morning mist (higher up it stays: he still walks in it, it doesn't vanish).
// THE LIGHT each step of mist scatters: its shade colour (the ambient, set by mist.js), the lamps round it, the lightning, and
// the sun where the sun's shadow maps say the step is lit (so trees, walls and the tower cast shadow lanes through it; only
// while the scene has sun shadows: the moon lights it evenly, sunLanes), strongest looking toward the sun (forward
// scattering: a Henyey-Greenstein lobe). AT NIGHT (mist.js eases TUNE.vol.night in as the ambient dims) the mist catches light:
// the moon's colour on its tops and a sheen of it on all of it (lighter than the dark ground, so what the air does to it shows),
// and the lights round it (lanterns, torches, a muzzle flash's chain, a blast) glow in it in uGlow.x flat rings, their height
// counting less (a lamp on its post lights the mist under it, as the ground's pools), capped by the brightest channel (hue kept).
// THE MARCH: from the pixel's surface P toward the viewer (the projection is oblique: every view ray is parallel), up through
// the air the mist can reach over P (film, fill, rise), in uV3.y steps at the same fractions for every pixel (a per-pixel
// jitter dithered whole areas); back to front: what is nearer covers what is behind. Each step's light is dimmed the deeper
// it lies under the mist's local top (to uV3.z): the tops bright, the depths dim, as a cloud's. Things standing in it (legs, trunks, the wall's foot) get the mist
// between them and the viewer; a crown or a wall top, whose rays rise straight out of it, none.
// THE LOOK (pixel art): the opacity is cut into uQ.x flat levels (up to uC1.a), the seam between two dithered by the same
// world-fixed Bayer (only within uQ.y of a level's edge: flat areas never show a pattern); the sunlit share into uQ.z flat
// tones the same way. Drawn premultiplied over what the composite drew (dst = mist + dst x (1 - opacity)).
// TWO LIGHTS (render/lighting.js, features/mist.js; wx-A): while the weather changes over the view, mist.js sends the under side's
// amounts (film, fill, water, cover) and colours (shade, sun, lamps) beside the open side's (o.under): a pixel takes them mixed by
// the clouds' under share where the sun's ray to its surface meets the ground (underAt: render/clouds.js cloudAt().y, as the
// composite's light), and the sun it scatters by the under light's sun and shadow strength (compU uSun2) as much. Under a storm the
// mist is the storm's slate rain haze, in a sun gap the sun's. Without o.under: as before, bit for bit.
// OWNS: its pass, the noise, the field texture, its uniforms. READS (shared uniform objects, never written): gfx.js compU's
// depth, sun shadow maps and matrices, the sun, the ambient, the lamps, the lightning, the dither's anchor (uMistO / uMistQ), the
// clouds' (every compU uniform render/clouds.js names), the two lights' (uLt2, uSun2, uPVf).
// BUDGET (GPU): one full-screen pass at art px, uV3.y steps a pixel (~.15-.3 ms at 688 x 288); CPU: a few uniforms.
//   const mv = createMistVol({THREE, renderer, raw, tri, cam, compU, NL}); mv.set(o) each frame it shows; mv.draw() right after the
//   composite, into the same target; mv.setField({x0, z0, w, h, res, data: Float32Array w x h x 4}) when the world is built

import {CLOUD_GLSL} from './clouds.js';

const N3 = 32;   // the noise's cube (texels a side, tiling)
const VS = `precision highp float; precision highp int;\nin vec3 position; void main() { gl_Position = vec4(position.xy, 0., 1.); }`;
const FS = NL => `precision highp float; precision highp int; precision highp sampler3D;
uniform sampler2D tD, tS, tSS, tF;
uniform sampler3D tN;
uniform mat4 uInvPV, uLightPV, uLightPVS;
uniform float uSBias, uSOn, uShadowA, uSunStr;
uniform vec2 uRes;
uniform vec3 uSunDir, uSunC, uFlashC;
uniform int uNL; uniform vec4 uLP[${NL}]; uniform vec4 uLC[${NL}];
uniform vec4 uMistO, uMistQ;   // (gfx.js MIST: the world origin's screen px, the dither cell: a world texel's px)
uniform vec4 uF;    // the field: its x0, z0 (m), 1 / its width, 1 / its depth (m)
uniform vec4 uV0;   // sigma (1 / m at density 1), the film's density, the film's height (m), the hollows' fill (share of their depth)
uniform vec4 uV1;   // the water's density, its rise (m), the noise's scale (1 / m), the banks' cover (0 none .. 1 everywhere)
uniform vec4 uV2;   // drift (noise units along x, z), the churn (noise units), the wisps' stretch along the wind
uniform vec4 uV3;   // the most air marched (m up), steps, the light deep in the mist (x its light at the top), forward scatter g
uniform vec4 uC0;   // the mist in shade (rgb: the ambient it scatters), the lamps' share
uniform vec4 uC1;   // the sun it scatters (rgb, x glow), the most opacity
uniform vec4 uQ;    // opacity levels, the seam (+- share of a level dithered), sunlit tones, the billows' contrast
uniform vec4 uNear;   // ROUND HIM: his x, z (m), the clear's radius (m), how clear (0 none): the mist thins low down there
uniform sampler2D tAir; uniform vec4 uAir, uAirK;   // the air: its state (vx, vz, clear, smoke), its rect (x0, z0, 1 / size), (on, the
                                                     // noise carried this many s of its velocity, the clear's reach up (m), smoke's density)
uniform vec2 uWind; // the way the wisps lie on the ground (unit: fixed by mist.js, TUNE.vol.wisp)
// TWO LIGHTS (the header): the clouds (render/clouds.js), the composite's two-light numbers (uLt2: on, the view's mean under share;
// uSun2.y / .z: the under light's shadow opacity and sun strength), the projection (a world point -> its view px); the under side's
// amounts (film, fill, water, cover) and colours (shade + lamps' share, the sun it scatters), on (uTwo)
${CLOUD_GLSL}
uniform vec4 uLt2, uSun2; uniform mat4 uPVf;
uniform vec4 uVu, uC0u; uniform vec3 uC1u; uniform float uTwo;
vec4 V0, V1, C0, C1; float SA, SS;   // this pixel's uV0, uV1, uC0, uC1, sun shadow opacity, sun strength (mixed by the under share)
float underAt(vec3 X) {   // (gfx.js COMP_FS underAt)
  if (uCl.x < .5) return uLt2.y;
  vec3 G = X - vec3(uSunDir.x, 0., uSunDir.z) * (X.y / max(uSunDir.y, .5));
  vec4 c = uPVf * vec4(G, 1.);
  return cloudAt(ivec2(floor((c.xy / c.w * .5 + .5) * uRes)), G).y;
}
out vec4 oc;
float bayer(ivec2 p) { int i = (p.x & 3) + (p.y & 3) * 4;
  const float B[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.); return (B[i] + .5) / 16.; }
vec3 worldAt(ivec2 p, float d) { vec2 ndc = (vec2(p) + .5) / uRes * 2. - 1.; vec4 w = uInvPV * vec4(ndc, d * 2. - 1., 1.); return w.xyz / w.w; }
// the field: (the ground's height, the hollow's depth there, how near water is 0..1, that water's height)
vec4 fieldAt(vec2 g) { return texture(tF, (g - uF.xy) * uF.zw); }
// the density at X (before sigma): the film, the pools, the water's, in banks and billows; and (k) how lit X is from above: the
// mist over it, roughly (how far under its local top it lies): its tops bright, its depths dimmer, as a cloud's
float dens(vec3 X, vec4 f, out float k, out float dust) {
  float h = X.y - f.r; k = 1.; dust = 0.;
  if (h < -.25) return 0.;   // (in the ground)
  // the air here: its velocity carries the noise (the mist streams and swirls), its CLEAR thins the mist low down, its SMOKE adds
  vec4 air = vec4(0.);
  if (uAirK.x > .5) { vec2 au = (X.xz - uAir.xy) * uAir.zw; if (au.x > 0. && au.y > 0. && au.x < 1. && au.y < 1.) air = texture(tAir, au); }
  vec2 xz = X.xz - air.xy * uAirK.y;
  vec2 w = uWind, wp = vec2(-w.y, w.x), g = vec2(dot(xz, w) / uV2.w, dot(xz, wp));   // (the wind's frame, stretched along it)
  vec3 q = vec3(g.x, X.y * 1.7, g.y) * uV1.z + vec3(uV2.x, uV2.z, uV2.y);
  float nb = texture(tN, q * .31).r, nf = texture(tN, q * 1.17 + vec3(.31, .17, .53)).r, n = nb * .6 + nf * .4;
  float bank = smoothstep(1.02 - V1.w - .14, 1.02 - V1.w + .14, nb);
  // the film: thinning upward over its height, which the noise lifts and lowers
  float fh = V0.z * (.35 + 1.3 * n), film = V0.y * exp(-max(h, 0.) / max(fh, .05)) * bank;
  // the pools: a hollow filled to a share of its depth that the banks raise and lower by half, the top billowing, thinning toward it
  float lvl = f.g * V0.w * (.5 + 1.0 * nb) + (nf - .5) * .6 * min(1., f.g);
  float pool = f.g > .05 ? smoothstep(.45, -.35, h - lvl) * (.55 + .45 * smoothstep(lvl, 0., h)) * (.5 + .5 * bank) * 1.4 : 0.;
  // the water's: rising off it over its rise (the banks lift it), spilling over its banks
  float wr = V1.y * (.35 + 1.3 * nb), wat = f.b * V1.x * smoothstep(wr, wr * .15, X.y - f.a) * (.35 + .65 * bank);
  float top = max(f.r + fh * 1.6, max(f.g > .05 ? f.r + lvl : -1e3, f.b > .01 ? f.a + wr : -1e3));
  k = exp(-V0.x * .55 * max(0., top - X.y));
  float d = max(film, max(pool, wat)) * mix(1., .25 + 1.5 * nf, uQ.w);
  d *= 1. - clamp(air.z, 0., 1.) * smoothstep(uAirK.z, uAirK.z * .4, h);   // (blown clear low down, less higher up)
  if (uNear.w > 0.) d *= 1. - uNear.w * smoothstep(uNear.z, uNear.z * .45, length(X.xz - uNear.xy)) * smoothstep(3.4, 1.4, h);   // (round him: the ground and its tracks show)
  dust = air.w * uAirK.w * exp(-max(h, 0.) / 1.1) * (.55 + .9 * nf);   // (the field's smoke / dust, near the ground, billowing: its own tone)
  return d + dust;
}
// (only while the maps are drawn: gfx.js draws them only while there are sun shadows, uShadowA > 0 and the Shadows setting
// on, as the ground and the god rays read them. At night (the moon casts none) they hold the last dusk's picture under a
// matrix still centred on the view each frame: the mist showed shadows that slid along with the player. Without them the
// mist is lit evenly; the lanes fade with the ground's shadows, full from uShadowA .2: every clear day's)
uniform float uShadowOn;
float sunLanes() { return uShadowOn > .5 && uShadowA > 0. ? clamp(SA / .2, 0., 1.) : 0.; }   // (SA: the pixel's, TWO LIGHTS; the maps: while uShadowA > 0)
float sunVis(vec3 X) {
  vec4 lc = uLightPV * vec4(X, 1.); vec3 sc = lc.xyz / lc.w * .5 + .5;
  if (all(greaterThanEqual(sc, vec3(0.))) && all(lessThanEqual(sc, vec3(1.))) && sc.z - .00005 > textureLod(tS, sc.xy, 0.).r) return 0.;
  if (uSOn > .5) {
    vec4 ls = uLightPVS * vec4(X, 1.); vec3 ss = ls.xyz / ls.w * .5 + .5;
    if (all(greaterThanEqual(ss, vec3(0.))) && all(lessThanEqual(ss, vec3(1.))) && ss.z - .00005 * uSBias > textureLod(tSS, ss.xy, 0.).r) return 0.;
  }
  return 1.;
}
uniform vec4 uLamp;   // the share of a light's radius the mist round it takes its light over, the most it adds (per channel)
uniform vec4 uGlow;   // the lamps' glow in it: flat tones (0: smooth)
vec3 lamps(vec3 X) {
  vec3 l = vec3(0.);
  for (int i = 0; i < ${NL}; i++) {
    if (i >= uNL) break; if (uLC[i].w > .5) continue;   // (not the dark scenes' flat lift round the player: it is no lamp)
    vec3 d = X - uLP[i].xyz; d.y *= .4;   // (height counts less: a lamp on its post, a muzzle at the hip light the mist under them, as the ground's pools)
    float r = max(uLP[i].w * uLamp.x, min(uLP[i].w, 1.6)), k = 1. - dot(d, d) / (r * r); if (k > 0.) l += uLC[i].rgb * k * k;   // (a small light, a flash's chain, its whole radius: one glow, not beads)
  }
  return l * min(1., uLamp.y / max(1e-4, max(l.r, max(l.g, l.b))));   // (at most uLamp.y, its hue kept: a blast stays orange, not white)
}
// a value cut into flat steps, the seam between two dithered (only within s of the step's edge)
float steps(float v, float s, float b) { float k = floor(v), e = v - k; return k + (e > .5 + s ? 1. : e < .5 - s ? 0. : (b < (e - .5 + s) / (2. * s) ? 1. : 0.)); }
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  float d = texelFetch(tD, ip, 0).r;
  if (d > .99999) discard;
  vec3 P = worldAt(ip, d), V = -normalize(uInvPV[2].xyz);   // (V: toward the viewer)
  // TWO LIGHTS (the header): the under share at P mixes the two sides' amounts and colours (once a pixel)
  V0 = uV0; V1 = uV1; C0 = uC0; C1 = uC1; SA = uShadowA; SS = uSunStr;
  float wu = uTwo > .5 ? underAt(P) : 0.;
  if (wu > 0.) {
    V0.y = mix(uV0.y, uVu.x, wu); V0.w = mix(uV0.w, uVu.y, wu); V1.x = mix(uV1.x, uVu.z, wu); V1.w = mix(uV1.w, uVu.w, wu);
    C0 = mix(uC0, uC0u, wu); C1.rgb = mix(uC1.rgb, uC1u, wu); SA = mix(uShadowA, uSun2.y, wu); SS = mix(uSunStr, uSun2.z, wu);
  }
  vec4 f0 = fieldAt(P.xz);
  // how much air over P the mist can reach: the film's, the hollow's fill, the water's rise
  float top = max(f0.r + V0.z * 3.2, max(f0.g > .05 ? f0.r + f0.g * V0.w + .45 : -1e3, f0.b > .01 ? f0.a + V1.y * 1.8 : -1e3));
  float H = min(top - P.y, uV3.x);
  if (H <= .02) discard;
  float n = uV3.y, ds = H / max(V.y, .25) / n, b = bayer(ivec2(floor((gl_FragCoord.xy - uMistO.xy) / max(uMistQ.z, 1.))));   // (fixed to the world)
  // forward scattering: a Henyey-Greenstein lobe over its value across the sun's rays (1 there, more looking toward the sun)
  float g = uV3.w, cs = -dot(uSunDir, V), ph = min(uLamp.z, pow((1. + g * g) / max(1e-3, 1. + g * g - 2. * g * cs), 1.5));
  bool sun = SS > 0. && C1.r + C1.g + C1.b > 0.;
  float lanes = sunLanes();
  vec3 S = vec3(0.), Lm = vec3(0.); float T = 1., L = 0.;
  for (int i = 0; i < 24; i++) {
    if (float(i) >= n) break;
    vec3 X = P + V * ((float(i) + .5) * ds);
    vec4 f = fieldAt(X.xz);
    float k, du, rho = dens(X, f, k, du) * V0.x; if (rho <= 0.) continue;
    float a = 1. - exp(-rho * ds), up = mix(uV3.z, 1., k);   // (up: lit from above, less deep under the mist's top)
    vec3 c0 = mix(C0.rgb, C0.rgb * vec3(.8, .74, .64), clamp(du * V0.x / rho, 0., 1.));   // (dust: darker, warmer than the mist)
    S = S * (1. - a) + (c0 * up + uFlashC * .8) * a;
    Lm = Lm * (1. - a) + lamps(X) * a;
    L = L * (1. - a) + (sun ? (lanes > 0. ? 1. - lanes * (1. - sunVis(X)) : 1.) * up : 0.) * a;
    T *= 1. - a;
  }
  float A = 1. - T; if (A < .004) discard;
  // the look: flat opacity levels, flat sunlit tones, the lamps' glow in flat rings
  float lv = min(uQ.x, steps(A / C1.a * uQ.x, uQ.y, b));
  if (lv < .5) discard;
  float aq = lv / uQ.x * C1.a, sl = L / A, tq = uQ.z > .5 ? min(uQ.z, steps(sl * uQ.z, uQ.y, 1. - b)) / uQ.z : sl;
  vec3 lm = Lm / A; float ll = dot(lm, vec3(.3, .55, .15));
  if (uGlow.x > .5 && ll > 1e-4) lm *= min(uGlow.x, steps(ll / uLamp.y * uGlow.x, uQ.y, b)) / uGlow.x * uLamp.y / ll;
  vec3 col = S / A + lm * C0.a + C1.rgb * tq * SS * (1. - SA * .3) * ph;
  float lum = dot(col, vec3(.3, .55, .15)); if (lum > uLamp.w) col *= uLamp.w / lum;
  oc = vec4(col * aq, 1. - aq);
}`;

export function createMistVol({THREE, renderer, raw, tri, cam, compU, NL}) {
  // the noise: a tiling cube of smooth value noise (two lattices, 4 and 8 cells across), one byte a texel, trilinear
  const nd = new Uint8Array(N3 * N3 * N3);
  {
    let s = 0x9e3779b9 | 0; const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const lat = c => { const a = new Float32Array(c * c * c); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
    const L4 = lat(4), L8 = lat(8), sm = t => t * t * (3 - 2 * t);
    const at = (L, c, x, y, z) => {   // smooth value noise at (x, y, z) in cells, tiling every c
      const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = sm(x - x0), fy = sm(y - y0), fz = sm(z - z0);
      const v = (i, j, k) => L[((i % c + c) % c) + ((j % c + c) % c) * c + ((k % c + c) % c) * c * c];
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(v(x0, y0, z0), v(x0 + 1, y0, z0), fx), l(v(x0, y0 + 1, z0), v(x0 + 1, y0 + 1, z0), fx), fy),
        l(l(v(x0, y0, z0 + 1), v(x0 + 1, y0, z0 + 1), fx), l(v(x0, y0 + 1, z0 + 1), v(x0 + 1, y0 + 1, z0 + 1), fx), fy), fz);
    };
    for (let z = 0; z < N3; z++) for (let y = 0; y < N3; y++) for (let x = 0; x < N3; x++) {
      const v = at(L4, 4, x / 8, y / 8, z / 8) * .65 + at(L8, 8, x / 4, y / 4, z / 4) * .35;
      nd[x + y * N3 + z * N3 * N3] = Math.round(Math.min(1, Math.max(0, (v - .5) * 1.5 + .5)) * 255);   // (contrast up: banks with edges)
    }
  }
  const tN = new THREE.Data3DTexture(nd, N3, N3, N3);
  tN.format = THREE.RedFormat; tN.type = THREE.UnsignedByteType; tN.minFilter = tN.magFilter = THREE.LinearFilter;
  tN.wrapS = tN.wrapT = tN.wrapR = THREE.RepeatWrapping; tN.unpackAlignment = 1; tN.needsUpdate = true;
  // the field (a top-down map of the world, set when the world is built): until then, 1 x 1 of nothing
  let tF = new THREE.DataTexture(new Uint16Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType); tF.needsUpdate = true;
  const U = {tD: compU.tD, tS: compU.tS, tSS: compU.tSS, uInvPV: compU.uInvPV, uLightPV: compU.uLightPV, uLightPVS: compU.uLightPVS,
    uSBias: compU.uSBias, uSOn: compU.uSOn, uShadowA: compU.uShadowA, uShadowOn: compU.uShadowOn, uSunStr: compU.uSunStr, uRes: compU.uRes, uSunDir: compU.uSunDir,
    uSunC: compU.uSunC, uFlashC: compU.uFlashC, uNL: compU.uNL, uLP: compU.uLP, uLC: compU.uLC, uMistO: compU.uMistO, uMistQ: compU.uMistQ,
    tF: {value: tF}, tN: {value: tN}, uF: {value: new THREE.Vector4(0, 0, 1, 1)},
    uV0: {value: new THREE.Vector4()}, uV1: {value: new THREE.Vector4()}, uV2: {value: new THREE.Vector4(0, 0, 0, 1)}, uV3: {value: new THREE.Vector4(3, 12, 1, .5)},
    uC0: {value: new THREE.Vector4()}, uC1: {value: new THREE.Vector4()}, uLamp: {value: new THREE.Vector4(.55, .3, 1.6, .7)}, uGlow: {value: new THREE.Vector4(0, 0, 0, 0)},
    uNear: {value: new THREE.Vector4(0, 0, 1, 0)}, tAir: {value: null}, uAir: {value: new THREE.Vector4(0, 0, 1, 1)}, uAirK: {value: new THREE.Vector4(0, .35, 2.2, 1.6)}, uQ: {value: new THREE.Vector4(4, .12, 2, .5)}, uWind: {value: new THREE.Vector2(1, 0)},
    uLt2: compU.uLt2, uSun2: compU.uSun2, uPVf: compU.uPVf,   // (TWO LIGHTS: the composite's)
    uVu: {value: new THREE.Vector4()}, uC0u: {value: new THREE.Vector4()}, uC1u: {value: new THREE.Vector3()}, uTwo: {value: 0}};
  for (const k in compU) if (!U[k] && new RegExp('\\b' + k + '\\b').test(CLOUD_GLSL)) U[k] = compU[k];   // (the clouds' uniforms, whatever render/clouds.js names)
  const sc = new THREE.Scene(); sc.matrixAutoUpdate = false;
  const mat = raw(VS, FS(NL), U, {depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor});
  const mesh = new THREE.Mesh(tri, mat); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; sc.add(mesh);
  renderer.compile(sc, cam);   // (at load: no hitch when the mist first shows)
  let armed = false, hasField = false, air = null;   // (air: G.air, handed over with the frame's numbers)
  const NO_AIR = new THREE.DataTexture(new Uint8Array(4), 1, 1); NO_AIR.needsUpdate = true; U.tAir.value = NO_AIR;
  const M = {
    on: false, ms: 0,
    // the field: {x0, z0 (m), w, h (texels), res (m a texel), data: Float32Array w x h x 4}
    setField(o) {
      const n = o.w * o.h * 4, hd = new Uint16Array(n);
      for (let i = 0; i < n; i++) hd[i] = THREE.DataUtils.toHalfFloat(o.data[i]);
      const t = new THREE.DataTexture(hd, o.w, o.h, THREE.RGBAFormat, THREE.HalfFloatType);
      t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
      tF.dispose(); tF = t; U.tF.value = t;
      U.uF.value.set(o.x0 - o.res / 2, o.z0 - o.res / 2, 1 / (o.w * o.res), 1 / (o.h * o.res));   // (texel centres at x0 + i res)
      hasField = true;
    },
    // every frame it shows: {sigma, film, filmH, fill, water, rise, scale, cover, drift: [x, z], churn, stretch, wind: [x, z],
    // band, steps, g, shade: [r, g, b], lamp, sun: [r, g, b], amax, levels, seam, tones, billow, near: null | [x, z, r, k], under: null | {film, fill, water, cover,
    // shade: [r, g, b], sun: [r, g, b], lamp} (TWO LIGHTS)}
    set(o) {
      U.uV0.value.set(o.sigma, o.film, o.filmH, o.fill); U.uV1.value.set(o.water, o.rise, o.scale, o.cover);
      U.uV2.value.set(o.drift[0], o.drift[1], o.churn, o.stretch); U.uV3.value.set(o.band, o.steps, o.deep ?? .6, o.g);
      U.uC0.value.set(o.shade[0], o.shade[1], o.shade[2], o.lamp); U.uC1.value.set(o.sun[0], o.sun[1], o.sun[2], o.amax);
      U.uQ.value.set(o.levels, o.seam, o.tones, o.billow); U.uLamp.value.set(o.lampR ?? .55, o.lampMax ?? .3, o.lobe ?? 1.6, o.bright ?? .7);
      U.uGlow.value.x = o.glowTones ?? 0;
      const u = o.under; U.uTwo.value = u ? 1 : 0;   // (TWO LIGHTS: the under side's, while two lights show)
      if (u) { U.uVu.value.set(u.film, u.fill, u.water, u.cover); U.uC0u.value.set(u.shade[0], u.shade[1], u.shade[2], u.lamp); U.uC1u.value.set(u.sun[0], u.sun[1], u.sun[2]); }
      const wl = Math.hypot(o.wind[0], o.wind[1]); if (wl > 1e-4) U.uWind.value.set(o.wind[0] / wl, o.wind[1] / wl);
      const nr = o.near; if (nr && nr[3] > 0) U.uNear.value.set(nr[0], nr[1], nr[2], nr[3]); else U.uNear.value.w = 0;   // (ROUND HIM)
      air = o.air && o.air.on ? o.air : null;
      if (air) U.uAirK.value.set(1, o.airCarry ?? .35, o.airReach ?? 2.2, o.airSmoke ?? 1.6);
      armed = true;
    },
    draw() {
      M.on = armed && hasField; armed = false;
      if (!M.on || compU.uDebug.value) return;
      // the air's state as it is now (it ping-pongs: read at the draw, after it stepped this frame), or none
      if (air && air.on && air.tex) { U.tAir.value = air.tex; U.uAir.value.copy(air.rect); } else { U.uAirK.value.x = 0; U.tAir.value = NO_AIR; }
      renderer.render(sc, cam);
    },
    U,
  };
  return M;
}
