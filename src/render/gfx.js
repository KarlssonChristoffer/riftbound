// GFX: the HD-2D test renderer. A real 3D scene drawn through the arena's own OBLIQUE projection (ground x sin 55,
// heights x cos 20), turned to any yaw, at the arena's pixel resolution, lit on the GPU in the arena's language.
//
// Pipeline per frame (all at VW x VH, nearest everywhere; the canvas is scaled up by CSS, image-rendering: pixelated):
//   1. shadow   the sun's depth map (meshes as they are; billboards as cards turned toward the sun)
//   2. gbuffer  every visible thing writes 3 targets + depth:
//                 A  rgb albedo, a = (type * 4 + tone) / 255
//                 N  xyz world normal, w = object id (whole numbers; a wall line shares one id: no outline at joints;
//                    -1 = particles (points), which never count as hiding the player in the x-ray)
//                 E  rgb emissive, w = part * 32 + family (meshes: seams between parts of the same family)
//               types: 0 empty, 1 ground (tone 1 = WATER: the composite lights it as water; tone 2 = fallen leaves), 2 ramp mesh (live 3D prop), 3 billboard (painted sprite;
//                      tone 2 = a plant with its own autumn colours: the composite's season matrix skips tone 2 on types 1 and 3), 4 character,
//                      5 textured surface (cliff faces), 6 line (arrows), 7 lit card (a prop pre-rendered at 16 angles)
//   3. x-ray    the player's card again, marking pixels where the scene hides it
//   4. light    full-screen: outlines / seams / occlusion lines on meshes (the pixelizer's rules, live), then the arena's
//               lighting model (ambient multiply + point-light pools with the soft knee, sun shadows tinted toward the
//               mood's shadow colour, wrapped N.L shaping in 3 bands, character fill + grade, emitters, halos, fog)
//
// World axes: X east, Y up, Z south (arena x, h, y). Metres.
import * as THREE from 'three';
import {flags} from '../core/flags.js';
import {AUTUMN as AU, AUTUMN_MID} from '../core/autumn.js';
import {hypot2, clearArray} from '../core/mathx.js';
import {cssRGBA} from '../core/color.js';
import {createGLStats} from './glstats.js';
import {createLitterSim} from './litter.js';
import {createGodrays} from './godrays.js';
import {CLOUD_GLSL} from './clouds.js';

export const DEG = Math.PI / 180;
// a uniform-shaped holder whose value is only ever a number (a card's sway: written every frame). Its own class keeps
// that field a number in place; plain {value} objects share one hidden class with every three.js uniform (textures,
// vectors), so a number written to one is boxed: a new heap number per swaying card per frame
class NumU { constructor(v) { this.value = v; } }
const R_DEPTH = 120;   // metres of "nearness" mapped onto the depth range (the world is 62 x 30 m)

const HEAD = `precision highp float; precision highp int;\n`;
const OUTS = `layout(location = 0) out vec4 o0;\nlayout(location = 1) out vec4 o1;\nlayout(location = 2) out vec4 o2;\n`;

// ---------------------------------------------------------------- shaders: gbuffer
// SWAY (meshes made with {sway: true}: the procedural trees): every vertex leans by uLean (art px at full weight: x along
// the screen, y toward the camera) times its baked weight aFlex (0 at the foot .. 1 at the top: stiff trunk, the crown as
// a block), rounded to WHOLE art px like the cards' row shifts, so a crown steps a pixel at a time instead of crawling
// FLUTTER: leaf clumps (aPhase >= 0) also dance on their own, uFlut art px (x along the screen, y toward the camera) at
// their own phase and rate (1.6 .. 3.2 Hz), rounded with the lean: in a gust the crown churns a pixel or two at a time
const SWAY = `
in float aFlex; in float aPhase; uniform vec2 uLean, uFlut; uniform vec3 uLeanX, uLeanY; uniform float uTime;   // uLeanX / Y: world m per art px
vec3 sway() {
  vec2 l = uLean * aFlex;
  if (aPhase >= 0.) { float f = 1.6 + fract(aPhase * 3.7) * 1.6; l += uFlut * vec2(sin(uTime * f * 6.2832 + aPhase), .6 * sin(uTime * f * 4.4 + aPhase * 1.7)); }
#ifdef CINE
  return uLeanX * l.x + uLeanY * l.y;   // (the cinema camera: no whole-pixel steps; near its lens one is several pixels)
#else
  vec2 s = floor(l + .5); return uLeanX * s.x + uLeanY * s.y;
#endif
}
`;
// AUTUMN (core/autumn.js is the model; the numbers are its): how fast a leaf clump turns, per tree. aSpray = the clump's
// centre in the crown's ellipsoid (xyz, bytes, in 1/1.25ths) + its own random (w 0..1; bark -1). The clump's place is taken
// into the WORLD frame (the tree's yaw), so the sun side is the south side whichever way the tree stands; fM is the same for
// every vertex of a clump, so the mesh pass and the shadow pass (SHADOW_SWAY_VS) agree on every leaf
const gl = v => Number.isInteger(v) ? v + '.' : String(v);   // a number as a GLSL float
const gl3 = a => `vec3(${a.map(gl).join(', ')})`;
const SPRAY_VS = `
in vec4 aSpray; uniform vec2 uSeed;
float sprayM(mat4 mm) {
  if (aSpray.w < 0.) return ${gl(AUTUMN_MID)};
  mat3 M = mat3(mm);
  vec3 ew = M * (aSpray.xyz * 1.25) / length(M[0]);
  float t1 = fract(sin(dot(uSeed, vec2(12.9898, 78.233))) * 43758.5453), t2 = fract(t1 * 91.7 + .37);   // per tree: where it stands
  float k = clamp(.5 + ${gl(AU.expo)} * dot(ew, ${gl3(AU.sun)}) + ${gl(AU.rnd)} * (fract(aSpray.w + t2) - .5) + ${gl(AU.tree)} * (t1 - .5), 0., 1.);
  return ${gl(AU.lo)} + ${gl(AU.hi - AU.lo)} * k;
}`;
const NO_SPRAY_VS = `float sprayM(mat4 mm) { return ${gl(AUTUMN_MID)}; }\n`;
// the thinning (uLeafK): a fragment of a leaf is gone where a 3D noise (clumps of a few cm, varied per tree) beats the season's
// fullness, and the sprays that turned further fall first: + drop x autumn x (m - mid), nothing at autumn 0. MESH_FS and
// SHADOW_SWAY_FS both use it (vn3, uLeafK, uSeed above it), so the shadow drops exactly the leaves the camera loses
const LEAF_GONE = `
uniform float uAutumn;
bool leafGone(vec3 pl, float m) { return uLeafK < .999 && vn3(pl * 5.5 + vec3(uSeed.y, 1.7, uSeed.x)) + ${gl(AU.drop)} * uAutumn * (m - ${gl(AUTUMN_MID)}) > uLeafK * 1.1 - .05; }`;
const meshVS = sway => HEAD + (sway ? SWAY + SPRAY_VS : 'vec3 sway() { return vec3(0.); }\n' + NO_SPRAY_VS) + `
in vec3 position; in vec3 normal; in float aPart; in float aFam; in float aBias; in float aFixed;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vN; out vec3 vW; out vec3 vNL; out vec3 vPL; flat out float fPart; flat out float fFam; flat out float fBias; flat out float fFixed; flat out float fM;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.); w.xyz += sway();
  vW = w.xyz; vN = mat3(modelMatrix) * normal;
  vNL = normal; vPL = position;   // the prop's own frame: moss stays where it grew when the prop tips and rolls
  fPart = aPart; fFam = aFam; fBias = aBias; fFixed = aFixed; fM = sprayM(modelMatrix);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const MESH_FS = HEAD + OUTS + `
in vec3 vN; in vec3 vW; in vec3 vNL; in vec3 vPL; flat in float fPart; flat in float fFam; flat in float fBias; flat in float fFixed; flat in float fM;
uniform sampler2D uRamps; uniform vec3 uLArt; uniform float uObj, uFlash; uniform vec2 uSeed;
uniform vec3 uAut[12];    // leaves only: the species' autumn ramps, stage 1..4 x tone 0..2 (trees3d.js B.autumn); uAutOn 0 = none
uniform float uAutOn;
uniform vec4 uRip;        // leaves only: (k x, k z, phase, amount) of a light wave rolling along the wind (0 = still)
uniform float uLeafK;     // leaves only: how full the crowns are this season (1 = full)
uniform vec3 uCover;      // x: amount (0 = none), y: up threshold, z: cover family
uniform vec2 uEmitFam;    // families that glow in this biome (-1 = none)
uniform vec4 uBurn;       // burning wood (mesh.burn): char, ember glow, time (s), ash; 0 = untouched
float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
` + LEAF_GONE + `
void main() {
  // the season thins the crowns (uLeafK: sim/env.js leafK, 1 = full .. ~.07 = bare): leaves go in clumps of a few cm (a 3D
  // noise in the model's frame, varied per tree by uSeed); the trees' shadow pass drops the same ones (SHADOW_SWAY_FS).
  // A clump is a hollow shell: through a gap in its near side you see its far side from within (the swaying meshes are
  // two-sided), in the shade tone: leaves deeper in the crown. Only where both sides lost their leaves does it open
  // onto what's behind (a thinned crown used to show the ground through every gap). Bark, and a full crown, never show
  // their inside
  bool inner = !gl_FrontFacing;
  if (inner && (fFixed > -1.5 || uLeafK >= .999)) discard;
  if (fFixed < -1.5 && leafGone(vPL, fM)) discard;   // (the sprays that turned further go first: LEAF_GONE)
  vec3 n = normalize(vN); if (inner) n = -n;
  float fam = fFam, jn = .5;   // jn: the leaves' 3D noise (below), which the autumn stage borrows
  // a ripening berry (aFixed -1.25: the rowan's bunches, trees3d.js; toned by the light like bark, never thinned): the part's own family is the ripe scarlet
  // and the season steps it to the next rows (world.js FAMS): +1 orange, +2 green and unripe, +3 the creamy flowers of late spring (the crowns not yet full).
  // Each bunch ripens at its own time (fM: the sun side and the early ones first, as a spray turns) and the birds take the early ones as the crown goes bare
  if (fFixed < -1.1 && fFixed > -1.4) {
    float kb = clamp((fM - ${gl(AU.lo)}) / ${gl(AU.hi - AU.lo)}, 0., 1.), v = uAutumn * (.5 + 1.5 * kb);
    if (kb > mix(1., .45, 1. - smoothstep(.15, .5, uLeafK))) discard;
    fam += v > .2 ? 0. : v > .03 ? 1. : uAutumn < .001 && uLeafK > .5 && uLeafK < .999 ? 3. : 2.;
  }
  int tone;
  if (fFixed >= 0.) tone = int(fFixed);
  else if (inner) tone = 2;
  else {
    float d = dot(n, uLArt) + fBias;
    // aFixed -2 (leaves): the painted blobs' jitter, a 3D noise in the model's own frame (it stays on the leaves as the
    // camera turns), so the tone bands break into leafy patches
    if (fFixed < -1.5) { jn = vn3(vPL * 7.5 + vec3(uSeed.x, 0., uSeed.y)); d += (jn - .5) * .42
      + uRip.w * sin(dot(vW.xz, uRip.xy) - uRip.z); }   // wind: bands of light rolling through the leaves (uRip: k along the wind, phase, amount)
    tone = d > .62 ? 0 : d > .12 ? 1 : 2;
  }
  // biome cover (moss / ash / snow) on what faces up AT REST (the prop's own frame, so it tips and rolls with it):
  // patchy, never on the glow / void families; the pattern is seeded per object. aFixed -2 = toned, never covered (leaves; nor the -1.25 berries)
  if (uCover.x > 0. && normalize(vNL).y > uCover.y && fFixed < 0. && fFixed > -1.1) {
    vec2 q = vPL.xz + uSeed;   // uSeed = where the mesh was placed: continuous across wall segments, fixed on a rolling barrel
    float c = vn(q * 7.) * .7 + vn(q * 19. + 3.) * .3;
    if (c > 1. - uCover.x * 2.6) fam = uCover.z;
  }
  vec3 alb = texelFetch(uRamps, ivec2(tone, int(fam + .5)), 0).rgb;
  // autumn: a leaf of a tree with autumn ramps takes its spray's STAGE (core/autumn.js): 0 stays the green leaf row, 1..4 are
  // the species' ramps at this tone. v = autumn x (how fast this clump turns + flecks of noise + its own sun-facing + the
  // withering of a nearly bare crown): whole steps, nothing at autumn 0. (The composite keeps this colour and darkens it for
  // outlines: COMP_FS, soft family)
  if (fFixed < -1.5 && uAutOn > .5 && uAutumn > 0.) {
    float v = uAutumn * (fM + ${gl(AU.noise)} * (jn - .5) * 2. + ${gl(AU.face)} * dot(n, ${gl3(AU.sun)})
      + ${gl(AU.wither[2])} * (1. - smoothstep(${gl(AU.wither[0])}, ${gl(AU.wither[1])}, uLeafK)));   // (what hangs on a nearly bare crown has withered: brown)
    int st = v < ${gl(AU.cuts[0])} ? 0 : v < ${gl(AU.cuts[1])} ? 1 : v < ${gl(AU.cuts[2])} ? 2 : v < ${gl(AU.cuts[3])} ? 3 : 4;
    if (st > 0) alb = uAut[(st - 1) * 3 + tone];
  }
  bool glow = abs(fam - uEmitFam.x) < .5 || abs(fam - uEmitFam.y) < .5;
  // burning: only what burns chars (world.js FAMS: wood 0, rope 5, void 9, bark 13, birch 18, aspen 19; hoops, iron, stone stay). It
  // blackens in patches (higher up first: the flame is on top), glowing cracks crawl through the char, ash settles on
  // top. As FAMILIES (char 15, ash 16, ember 17), so the composite's outlines and plank seams still work on them
  vec3 em = vec3(0.);
  if (uBurn.x > 0. && (fFam < .5 || abs(fFam - 5.) < .5 || abs(fFam - 9.) < .5 || abs(fFam - 13.) < .5 || abs(fFam - 18.5) < 1.)) {
    vec3 q = vPL * 8. + vec3(uSeed.x, 0., uSeed.y);
    float c = vn3(q) * .7 + vn3(q * 2.9 + 7.) * .3, ch = uBurn.x * 1.3 - c + (vPL.y - .25) * .5 * uBurn.x;
    if (ch > .1) fam = 15.; else if (ch > 0.) tone = min(tone + 1, 2);   // charred; a scorched rim round the char
    if (ch > 0. && uBurn.y > 0.) {   // the cracks of charcoal: a cell-like web, glowing, the glow crawling along it
      float v = abs(vn3(vPL * 19. + vec3(uSeed.y, 3., uSeed.x)) - .5), w = (.011 + .028 * uBurn.y) * min(1., ch * 5.);
      if (v < w) {
        float f = vn3(vPL * 4. + vec3(0., -uBurn.z * 1.4, uBurn.z * .7)), g = clamp(uBurn.y * (.3 + .95 * f) * (1. - v / w * .6), 0., 1.);
        fam = 17.; tone = g > .62 ? 0 : g > .32 ? 1 : 2;
        em = texelFetch(uRamps, ivec2(tone, 17), 0).rgb * min(1., g * 2.2);
      }
    }
    if (uBurn.w > 0. && fam > 14.5 && fam < 15.5 && normalize(vNL).y > .2 && vn3(q * 2.3 + 11.) < uBurn.w) fam = 16.;   // ash on top
    alb = texelFetch(uRamps, ivec2(tone, int(fam + .5)), 0).rgb;
  }
  o0 = vec4(alb, float(2 * 4 + tone) / 255.);
  o1 = vec4(n, uObj);
  o2 = vec4((glow ? alb : vec3(0.)) + vec3(uFlash) + em, fPart * 32. + fam);
}`;

// THE MOVING WATER (SURF_FS). world.js bakes the water texture uWater (its layout is documented there: state, base tone, speed,
// the travel coordinate s along the flow, the across coordinate a, the ring of texels from the bank); everything here is a
// function of those WORLD TEXELS and the stepped water clock, never of the screen, so it holds still while the camera turns.
// A texel's tone is a value noise in (a, s - travelled), cut to the biome's ramp: thin streaks stretched along the flow, sliding
// by WHOLE texels (floor(clock * rate * speed)), each stretch at its own pace because s is travel TIME (the narrows run faster).
// FALLING water (a cliff / face texel with alpha 252, world.js FALL_ALPHA) streams down the same way
const WATER_FS = `
uniform sampler2D uWater; uniform float uHasWater;
uniform float uWPhase;               // the water clock, s: render() advances it at G.setWater's speed
uniform vec4 uWA, uWB;               // (rate texels/s, cell across, cell along, lapping tone | -1), (hi, lo, lightest tone, darkest tone)
uniform vec3 uWRamp[4];              // the biome's four water tones, light -> dark
float wh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wvn(vec2 p, float per) {       // value noise whose y lattice repeats every per cells: the wrapped clock never pops
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  float y0 = mod(i.y, per), y1 = mod(i.y + 1., per);
  return mix(mix(wh(vec2(i.x, y0)), wh(vec2(i.x + 1., y0)), f.x), mix(wh(vec2(i.x, y1)), wh(vec2(i.x + 1., y1)), f.x), f.y);
}
// the pattern slid along the flow by whole texels (ph = texels travelled; 768 is a multiple of every cell length and of the wobble's 24):
// the streaks meander a little as they go (a = across, wobbling by ~1.3 texels along s - travelled)
float wlay(float a, float s, float ph, float ca, float cs, float seed) {
  float d = s - mod(floor(ph), 768.);
  return wvn(vec2((a + sin(d * .2618) * 1.3) / ca + seed, d / cs), 768. / cs);
}
// DEPTH, BED AND CONTACT FOAM (world/waterbed.js bakes uWBed over the water's box, once per world; uWBedOn 0 = none and the old
// water runs untouched: ?water=0, the lava). A moving texel's depth BAND (uWCut) gives its surface's base tone (uWTone) and how
// much water covers the bed there (uWOp): clear light shallows where the bed's own texel shows through, tinted (uWTint), dark deep
// water where it doesn't. The bed is read through the surface's ripple (REFRACTION): its lookup moves by WHOLE texels, a field that
// travels with the flow at the pattern's own whole-texel steps, a texel in the shallows, up to uWCut.w in the deep, so pebbles wobble
// a pixel at a time. Light crests stay surface over the bed (uWLook.x). Where a thing stands in the water (the bake's contact rings)
// a 1-texel foam line hugs it, its gaps wandering, and a ripple pulses out from it a texel per step; the player's feet (uWFoot)
// ring the same way while he wades (his feet at the surface, on water). All of it in world texels and the stepped clock: still under
// camera turns and pans
uniform sampler2D uWBed; uniform float uWBedOn;
uniform vec4 uWBedR;                 // the box: its first texel (x, y) and size (w, h)
uniform vec4 uWCut;                  // the depth bands' cuts (0..1): very shallow | shallow | mid | deep; w = the refraction's reach (texels)
uniform vec4 uWOp, uWTone;           // per band: the water's cover over the bed (0 = the bed .. 1 = water), the surface's base tone
uniform vec4 uWLook;                 // x: the light crests' cover, y: how much of the bed's own hue shows (0: only its light and dark), z: the bed's mean luminance,
                                     // w: how much darker the dark layer must be to take the deep a step darker still (0 = as dark as it darkens the rest)
uniform vec3 uWTint, uWFoam;         // the bed seen through the water (multiplied), the foam
uniform vec4 uWFoot;                 // the player's feet: x, y, z (m); w 1 = known
uniform vec2 uWorld, uOrigin;        // (SURF_VS's planar mapping: where his feet are in texels)
vec4 wBed(ivec2 ti) { return texelFetch(uWBed, clamp(ti - ivec2(uWBedR.xy), ivec2(0), ivec2(uWBedR.zw) - 1), 0); }
int wBand(vec4 b) { float d = float(int(b.a * 255. + .5) >> 3) / 31.; return d < uWCut.x ? 0 : d < uWCut.y ? 1 : d < uWCut.z ? 2 : 3; }
// wPrep, once per fragment from its own texel (the smooth sampling's four neighbours share it: the shader stays small, wTexel is
// inlined five times): the ripple's slope (wRg, -.5 .. .5: x 2.4 x the band's reach = the bed's offset, whole texels), the foam's
// dashes (wDash: the contact line, its ripple, the feet's ring, its ripple), the ripple's ring (wPu) and where his feet are (wFt: texel
// x, y; z 1 = he wades: his feet at the surface, on water)
vec2 wRg; vec4 wDash; float wPu; vec3 wFt;
void wPrep(ivec2 ti) {
  vec4 w = texelFetch(uWater, ti, 0);
  int rc = int(w.r * 255. + .5), gg = int(w.g * 255. + .5);
  float s = float(((gg & 31) << 8) | int(w.b * 255. + .5)) * .125, a = (w.a * 255. - 128.) * .5, d = s - mod(floor(uWPhase * uWA.x * float(rc & 15) * .125), 768.);
  wRg = vec2(wvn(vec2(a / 5. + 1.3, d / 12.), 64.), wvn(vec2(a / 5. + 6.1, d / 12. + 2.7), 64.)) - .5;
  float st = mod(floor(uWPhase * 4.), 96.); vec2 p = vec2(ti);   // 4 steps a second
  wPu = 2. + mod(st, 5.);   // the ripple's ring, 2 .. 6 texels out
  wDash = vec4(wvn(p / 2.6 + vec2(st * .37, 3.1), 1e4), wvn(p / 2.2 + vec2(9.7, st * .29), 1e4), wvn(p / 1.8 + vec2(st * .41, 5.3), 1e4), wvn(p / 2. + vec2(1.3, st * .33), 1e4));
  vec2 f = (uWFoot.xz - uOrigin) / uWorld * uTexSize;
  float dz = uWFoot.y - vW.y;   // (his feet stand on the field, a few cm over the creek's carved bed; the river's surface is 18 cm under its bank)
  wFt = vec3(f, uWFoot.w > .5 && dz > -.05 && dz < .15 && texelFetch(uWater, clamp(ivec2(f), ivec2(0), ivec2(uTexSize) - 1), 0).r > .5 ? 1. : 0.);
}
// the contact foam on the fragment's texel ti (main, once: the line is crisp even while the smooth sampling blends): c = texels from
// what stands in the water (1 = touching .. 7; 0 none): the line against it, a few gaps drifting round, and its ripple; the same
// round the player's feet (r texels from them) while he wades
vec3 wFoam(vec3 res, ivec2 ti, int c) {
  float r = wFt.z > .5 ? length(vec2(ti) + .5 - wFt.xy) : 99.;
  bool line = (c == 1 && wDash.x > .27) || (r >= 8.5 && r < 9.5 && wDash.z > .25);   // (his: round both boots, just past his contact shadow)
  bool ring = (c > 1 && float(c) == wPu && wDash.y > .5 - .05 * wPu) || (abs(r - 8. - wPu * 1.5) < .5 && wDash.w > .45);
  return mix(res, uWFoam, line ? 1. : ring ? .55 : 0.);
}
// the moving texel's colour over its bed: t the pattern's tone, t0 its band's base, h / l the light / dark layers
vec3 wDeep(vec3 res, int t, int t0, int band, float h, float l, vec4 bd, ivec2 ti) {
  if (band == 3 && t == t0 && l > uWB.y + uWLook.w && h <= uWB.x && t0 < 3) res = uWRamp[t0 + 1];   // the deep's dark streaks go a step darker
  float op = t < t0 ? max(uWOp[band], uWLook.x) : uWOp[band];
  float k = band == 0 ? 1. : band == 1 ? max(1., uWCut.w - 1.) : uWCut.w;   // the refraction's reach: deeper water bends more
  if (op < .999) {   // the bed through the water: its light and dark on the water's own colour, and a share of its hue, tinted
    vec3 b = wBed(ti + ivec2(floor(wRg * 2.4 * k + .5))).rgb;
    res = mix(mix(res * dot(b, vec3(.3, .55, .15)) / uWLook.z, b * uWTint, uWLook.y), res, op);
  }
  return res;
}
// one ground texel as the water makes it: moving water (state 3) or the painted texel
vec3 wTexel(ivec2 ti, ivec2 mx) {
  ti = clamp(ti, ivec2(0), mx);
  vec4 w = texelFetch(uWater, ti, 0);
  int rc = int(w.r * 255. + .5);
  vec3 res = texelFetch(uTex, ti, 0).rgb;
  if (rc < 192) return res;
  int gg = int(w.g * 255. + .5), tone = (rc >> 4) & 3, ring = gg >> 5;
  float spd = float(rc & 15) * .125, s = float(((gg & 31) << 8) | int(w.b * 255. + .5)) * .125, a = (w.a * 255. - 128.) * .5;
  float ph = uWPhase * uWA.x * spd;
  float h = wlay(a, s, ph, uWA.y, uWA.z, 0.), l = wlay(a, s, ph * .7, uWA.y * 1.4, uWA.z * 1.5, 7.3);
  int t = tone;
  // the broad bands drift too: the base tone is read from a texel slid across by a slow wobble that travels with the flow (a band's edge meanders)
  float sw = floor((wvn(vec2(.5, (s - mod(floor(ph * .35), 768.)) / 48.), 16.) - .5) * 7. + .5);
  if (sw != 0.) { vec4 w2 = texelFetch(uWater, clamp(ti + ivec2(int(sw), 0), ivec2(0), mx), 0); int r2 = int(w2.r * 255. + .5); if (r2 >= 192) t = (r2 >> 4) & 3; }
  vec4 bd = vec4(0.); int band = 3, t0 = t;   // the bed (wDeep): the base tone is the depth band's, read through the same slide
  if (uWBedOn > .5) { bd = wBed(ti); bool sl = sw != 0. && texelFetch(uWater, clamp(ti + ivec2(int(sw), 0), ivec2(0), mx), 0).r > .745; band = wBand(sl ? wBed(ti + ivec2(int(sw), 0)) : bd); t = t0 = int(uWTone[band]); }
  if (h > uWB.x) t -= 1;
  if (h > uWB.x + .09) t -= 1;
  if (l > uWB.y) t += 1;
  t = clamp(t, int(uWB.z), int(uWB.w));
  if (uWA.w >= 0. && ring > 0) {     // the lapping line: a dashed 1-texel line that creeps in and out along the bank, a step every ~1.3 s
    float pos = 3. + abs(mod(floor(uWPhase * .75), 4.) - 2.) + (a < 0. ? 1. : 0.);
    if (float(ring) == pos && wvn(vec2(3.7, (s - mod(floor(uWPhase * 3.), 768.)) / 8.), 96.) > .42) t = int(uWA.w);
  }
  res = uWRamp[t];
  if (uWBedOn > .5) res = wDeep(res, t, t0, band, h, l, bd, ti);
  return res;
}
// a fall of water: the baked colour is the base; light streaks slide DOWN the sheet in whole texels at their own pace per column,
// dark ones with them, and the foam at the foot flickers. px = the texel (column, row from the top of the fall), rows = its height
vec3 fall(vec3 base, vec2 px, float rows) {
  float h = wh(vec2(px.x, 17.)), g = wh(vec2(px.x, 5.));
  float k = floor((px.y - mod(floor(uWPhase * 14. * (1. + g)), 1000.)) / 5.), d = wh(vec2(px.x, mod(k, 200.)));
  vec3 c = base;
  if (h < .55 && d > .5) c = mix(base, vec3(1.), .3);
  else if (d < .14) c = base * .86;
  if (px.y > rows - 6. && wh(vec2(px.x, px.y + mod(floor(uWPhase * 9.), 64.) * 13.)) < .6) c = mix(base, vec3(1.), .7);
  return c;
}
`;

// ground and textured surfaces: world-planar (ground) or uv (faces) mapping, nearest or "smooth pixel" sampling
const SURF_VS = HEAD + `
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform float uPlanar; uniform vec2 uWorld, uOrigin;   // planar: the texture covers uWorld m from uOrigin (x, z)
out vec2 vUv; out vec3 vN; out vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.);
  vUv = uPlanar > .5 ? (w.xz - uOrigin) / uWorld : uv;
  vN = mat3(modelMatrix) * normal; vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const SURF_FS = HEAD + OUTS + `
in vec2 vUv; in vec3 vN; in vec3 vW;
uniform sampler2D uTex, uEm; uniform vec2 uTexSize; uniform float uSmooth, uHasEm, uType, uObj;
// steep ground (the ravine wall): a cliff texture (rock strata, the waterfall) by world x (z on east / west faces) and
// depth below the bank, 1 texel = 1 px at yaw 0 (uPx = PPM, PPMH), repeating; drawn as a textured face (type 5)
uniform sampler2D uCliff; uniform float uHasCliff, uCliffOff; uniform vec2 uCliffSize, uPx;
uniform float uCliffTop;   // steep ground only below this height takes the cliff texture (walkable terrain: its banks above 0 stay ground)
` + WATER_FS + `
// FALLEN LEAVES (world.js bakes the source, one texel per 2 x 2 ground texels: R = how thick the leaves lie here once the crowns are bare,
// G = which tree palette they came from; uLitPal = that palette's colours, 4 stages x 3 tones along x, one row per group). A leaf
// is one ground texel or two (across or down), placed by an integer hash of its own texel coordinates and the density, so
// it is fixed to the world and holds still as the camera turns. uLitK.x = how much has fallen so far (0 = none: the whole thing is
// skipped; setGround makes it from the season), uLitK.y = how far the fallen leaves have turned (which stages they are drawn in).
// uLit is the source (uLive 0: the density is R x uLitK.x, the palette G x 255) or, while render/litter.js runs the layer (uLive 1),
// its field: the wind has moved the leaves about, R already holds how much has fallen, G is the palette itself. uLitCap: never denser
precision highp sampler2D;
uniform sampler2D uLit, uLitPal; uniform float uHasLit, uLive, uLitCap; uniform vec4 uLitK;
// GROUND DECALS on walkable terrain (G.setGroundDecals: features/flow.js's ground layer): marks in world px (x PPM, z PPMY) read at
// the fragment's own world position, so they lie on a slope as on flat ground (without terrain flow draws them through a plane)
uniform sampler2D uDecal; uniform float uHasDecal, uDecalOn; uniform vec4 uDecalRect; uniform vec2 uDecalPx;
float lh(ivec2 p, uint salt) { p = max(p, ivec2(0)); uint h = uint(p.x) * 374761393u + uint(p.y) * 668265263u + salt * 2246822519u; h = (h ^ (h >> 13)) * 1274126177u; return float((h ^ (h >> 16)) & 65535u) / 65536.; }
float lorg(ivec2 o, ivec2 mx, ivec2 ls) {   // does a leaf start at texel o? (the density here, as much as has fallen; a leaf covers ~2 texels: half the odds)
  return lh(o, 1u) < min(texelFetch(uLit, clamp(o, ivec2(0), mx) * ls / (mx + 1), 0).r * (uLive > .5 ? 1. : uLitK.x), uLitCap) * .5 ? 1. : 0.;
}
vec4 leafAt(ivec2 ti, ivec2 mx) {   // (colour, 1) where a leaf lies on this ground texel, else a = 0
  ivec2 ls = textureSize(uLit, 0), o = ti;
  float f = lorg(ti, mx, ls);
  if (f < .5) {   // or its first texel is the one on my left (a leaf lying along x) or the one above me (lying down y)
    o = ti - ivec2(1, 0); f = lorg(o, mx, ls) * (lh(o, 2u) < .5 ? 1. : 0.);
    if (f < .5) { o = ti - ivec2(0, 1); f = lorg(o, mx, ls) * (lh(o, 2u) >= .5 ? 1. : 0.); }
  }
  vec4 res = vec4(0.);
  if (f > .5) {
    int g = int(texelFetch(uLit, clamp(o, ivec2(0), mx) * ls / (mx + 1), 0).g * (uLive > .5 ? 1. : 255.) + .5);
    float r = lh(o, 3u), v = clamp(uLitK.y * 4.2 - (1. - r) * 3.4, 0., 3.99), rt = lh(o, 4u);   // the early leaves fall first: with the turn, more and more are in the late stages
    res = vec4(texelFetch(uLitPal, ivec2(int(v) * 3 + (rt < .28 ? 0 : rt < .78 ? 1 : 2), g), 0).rgb, 1.);
  }
  return res;
}
// uSmooth 0..1 blends the two samplings, so the host can fade between them (crisp at rest, smooth while turning)
void main() {
  vec2 t = vUv * uTexSize, s = floor(t + .5), d = max(fwidth(t), vec2(1e-4));   // (derivatives before any branch)
  vec2 uvN = (floor(t) + .5) / uTexSize;                               // nearest (texel centre under bilinear)
  vec2 uvS = (s + clamp((t - s) / d, -.5, .5)) / uTexSize;            // smooth-pixel: sharp, blended only across texel seams
  // the triangle's own plane (the grid's smooth normals blend a 0.25 m cliff cell into its flat neighbours)
  vec3 fn = normalize(cross(dFdx(vW), dFdy(vW))); if (dot(fn, vN) < 0.) fn = -fn;
  if (uHasCliff > .5 && abs(fn.y) < .45 && vW.y < uCliffTop) {
    vec3 n = fn;
    float along = abs(n.z) >= abs(n.x) ? vW.x : vW.z;
    vec2 ct = vec2((along + uCliffOff) * uPx.x, -vW.y * uPx.y);
    vec4 cc = texture(uCliff, (floor(ct) + .5) / uCliffSize);
    float al = cc.a * 255.;   // alpha 250: a glowing fall (lava); 252: a fall of water (streams down: fall())
    if (al < .5) discard;     // (alpha 0: no wall drawn here: the 3D cliffs stand in front, world.js / cliffs3d.js)
    o0 = vec4(abs(al - 252.) < .5 ? fall(cc.rgb, floor(ct), uCliffSize.y) : cc.rgb, float(5 * 4) / 255.);
    o1 = vec4(n, uObj); o2 = vec4(abs(al - 250.) < .5 ? cc.rgb : vec3(0.), 0.);
    return;
  }
  vec4 c = uSmooth <= 0. ? texture(uTex, uvN) : uSmooth >= 1. ? texture(uTex, uvS) : mix(texture(uTex, uvN), texture(uTex, uvS), uSmooth);
  if (c.a < .5) discard;
  if (abs((uSmooth <= 0. ? c.a : texture(uTex, uvN).a) * 255. - 252.) < .5) c.rgb = fall(c.rgb, floor(t), uTexSize.y);   // a fall of water on a face (type 5 or ground)
  // the water (ground only): a texel beside water, or water, is read from the baked water texture. Nearest: that texel's own
  // moving colour; smooth: the same bilinear blend across texel seams as the painted ground gets, of moving texels
  float wfl = 0.;
  if (uHasWater > .5) {
    ivec2 mx = ivec2(uTexSize) - 1, ti = clamp(ivec2(floor(t)), ivec2(0), mx);
    int rc = int(texelFetch(uWater, ti, 0).r * 255. + .5);
    if (rc >= 64) {
      wfl = rc >= 128 ? 1. : 0.;   // water: the G-buffer's tone 1
      if (uWBedOn > .5) wPrep(ti);   // (the bed's ripple and the foam's dashes, once for this texel and its neighbours: WATER_FS)
      vec3 cN = wTexel(ti, mx);
      if (uSmooth <= 0.) c.rgb = cN;
      else {
        vec2 q = uvS * uTexSize - .5, f = fract(q); ivec2 i0 = ivec2(floor(q));
        vec3 cS = mix(mix(wTexel(i0, mx), wTexel(i0 + ivec2(1, 0), mx), f.x), mix(wTexel(i0 + ivec2(0, 1), mx), wTexel(i0 + ivec2(1, 1), mx), f.x), f.y);
        c.rgb = mix(cN, cS, uSmooth);
      }
      if (uWBedOn > .5 && rc >= 128) c.rgb = wFoam(c.rgb, ti, int(wBed(ti).a * 255. + .5) & 7);   // (contact foam: WATER_FS)
    }
  }
  // fallen leaves (ground and the plateau's top: type 1, never on the water): drawn in their own colours, and marked (tone 2) so the
  // composite doesn't push them through the season's matrix a second time
  float leaf = 0.;
  if (uHasLit > .5 && uLitK.x > 0. && uType < 1.5 && wfl < .5 && all(greaterThanEqual(t, vec2(0.))) && all(lessThan(t, uTexSize))) {   // (none past the map's edge: the ground goes on mirrored there, its last row of leaves would smear)
    ivec2 mx = ivec2(uTexSize) - 1; vec4 lc = leafAt(clamp(ivec2(floor(t)), ivec2(0), mx), mx);
    if (lc.a > 0.) { c.rgb = lc.rgb; leaf = 1.; }
  }
  if (uHasDecal > .5 && uDecalOn > .5 && wfl < .5) {
    vec2 dp = vec2(vW.x * uDecalPx.x, vW.z * uDecalPx.y) - uDecalRect.xy;
    if (dp.x >= 0. && dp.y >= 0. && dp.x < uDecalRect.z && dp.y < uDecalRect.w) { vec4 dc = texelFetch(uDecal, ivec2(dp), 0); c.rgb = mix(c.rgb, dc.rgb, dc.a); }
  }
  vec3 em = vec3(0.);
  if (uHasEm > .5) { vec4 e = mix(texture(uEm, uvN), texture(uEm, uvS), uSmooth); em = e.rgb * e.a; }
  o0 = vec4(c.rgb, float(int(uType) * 4 + int(wfl) + (leaf > .5 ? 2 : 0)) / 255.);
  o1 = vec4(normalize(vN), uObj);
  o2 = vec4(em, 0.);
}`;

// billboards: a unit quad turned to face uFaceYaw, sized so one sprite pixel = one screen pixel (x: 1/PPM m, y: 1/PPMH m)
const CARD_VS = HEAD + `
in vec3 position;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uAnchor; uniform vec2 uSize, uPivot; uniform float uFaceYaw, uCamYaw, uBias; uniform vec2 uPx; uniform vec4 uRect;
uniform vec2 uSnap;   // view size in px: the anchor lands on a whole pixel, so every sprite texel is one screen pixel (0 = off)
uniform vec2 uOff; uniform float uSway;   // px offset (x right, y up: a hit wobble, a hop) and sway (px at the top: wind)
uniform float uHasBend;                   // 1 = the fragment shader bends rows by uBend (the quad widens by |sway|)
out vec2 vUv; out vec2 vC; out vec2 vSp;  // vSp: sprite px (x from the left, y from the top), unclamped when bending
void main() {
  vec2 c = position.xy;
  vec3 right = vec3(cos(uFaceYaw), 0., -sin(uFaceYaw));
  // a sun-facing shadow card still carries the sprite as the CAMERA drew it: its right side stays on the camera's right
  // (with the sun beyond the figure the card is seen from behind, and the shadow came out mirrored: bow on the wrong side)
  if (dot(right, vec3(cos(uCamYaw), 0., -sin(uCamYaw))) < 0.) right = -right;
  float S = uHasBend > .5 ? ceil(abs(uSway)) : 0., sxp = c.x * (uSize.x + 2. * S) - S;
  float px = sxp - uPivot.x + uOff.x + (uHasBend > .5 ? 0. : uSway * c.y), py = uPivot.y - (1. - c.y) * uSize.y + uOff.y;
  vec3 w = uAnchor + right * (px / uPx.x) + vec3(0., py / uPx.y, 0.);
  vC = vec2(c.x, 1. - c.y); vSp = vec2(sxp, (1. - c.y) * uSize.y);
  vUv = uRect.xy + vC * uRect.zw;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
  if (uSnap.x > 0.) {
    vec4 a = projectionMatrix * viewMatrix * vec4(uAnchor, 1.);
#ifndef CINE
    vec2 p = (a.xy * .5 + .5) * uSnap;
    gl_Position.xy += (floor(p + .5) - p) / uSnap * 2.;
#endif
  }
#ifdef CINE
  gl_Position.z -= uBias * 120. * -projectionMatrix[3][2] / gl_Position.w;   // (the bias in metres: an oblique b is b x R_DEPTH m)
#else
  gl_Position.z -= uBias * gl_Position.w;
#endif
}`;
const CARD_FS = HEAD + OUTS + `
in vec2 vUv; in vec2 vC; in vec2 vSp;
uniform sampler2D uTex, uNrm, uEm; uniform vec4 uNrmRect, uRect; uniform vec2 uSize;
uniform float uHasNrm, uHasEm, uType, uObj, uCamYaw, uFlash, uHasBend, uSway;
uniform sampler2D uMetal; uniform float uHasMetal;   // the shiny-armour mask (R: 255 steel, 128 gold), aligned with uTex
uniform float uBend[8];   // sway weight at height fractions 0 (bottom) .. 1 (top), 8 samples (the arena's per-row flex)
// THE PLANTS' AUTUMN (bushes, tufts, ferns, reeds: world.js plantOf fills uPlant for a card whose biome has them; every other card
// has uPlant.x = 0 and skips all of it). The card's pixels are recognised by the green ramp it was painted with (uPRamp, light ..
// dark) and swapped for the plant's own path (uPPal: 4 stages x 4 tones, then the same for a second path, at a fifth of the patches),
// in whole palette steps. The plant turns in PATCHES, a spray / a branch / a blade (jittered cells in the sprite's own pixels, their
// edges roughened), each with its own draw, and the sun side and the top go first: the exposure to a noon sun fixed in the world
// (south and up) of the face the camera sees, so the side toward the player at yaw 0 is the reddest and a plant seen from the
// north is the greenest. A patch starts at d (the plant's own delay + its draw + how shaded it is) and has run its four stages by
// autumn 1. uPlant: x kind (0 none, 1 bush, 2 tuft, 3 fern, 4 reed), y seed 0..1, z the plant's delay
uniform float uAutumn; uniform vec4 uPlant; uniform vec3 uPRamp[4]; uniform vec3 uPPal[32];
float ph2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pvn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(ph2(i), ph2(i + vec2(1, 0)), f.x), mix(ph2(i + vec2(0, 1)), ph2(i + vec2(1, 1)), f.x), f.y); }
vec3 plantTurn(vec3 col, int tn, vec2 sp) {   // sp: the pixel in the sprite (y from the top)
  float kind = uPlant.x, seed = uPlant.y;
  vec2 cs = kind < 1.5 ? vec2(5.4, 4.6) : kind < 2.5 ? vec2(2.4, 3.2) : kind < 3.5 ? vec2(4.4, 3.8) : vec2(2.2, 8.);   // a patch's size, px
  vec2 q = sp + (vec2(pvn(sp * .21 + seed * 13.), pvn(sp * .21 + 7.3 + seed * 5.)) - .5) * (kind < 1.5 ? 3. : 1.6);
  vec2 g = q / cs, gi = floor(g), gf = fract(g); float best = 9.; vec2 bc = gi;
  for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) {
    vec2 c = gi + vec2(float(k), float(j)), o = vec2(ph2(c + seed * 17.), ph2(c + seed * 17. + 5.3)), dv = vec2(float(k), float(j)) + .12 + o * .76 - gf;
    float dd = dot(dv, dv); if (dd < best) { best = dd; bc = c; }
  }
  float r1 = ph2(bc + seed * 31. + 1.7), r2 = ph2(bc + seed * 7. + 3.1);
  vec2 u = sp / uSize; float e;
  if (kind < 1.5 || (kind > 2.5 && kind < 3.5)) {   // a bush, a fern: a dome of leaves, its normal turned like the card's own face
    float x = clamp((u.x - .5) / .44, -1., 1.), y = clamp((.64 - u.y) / .46, -1., 1.), z = sqrt(max(0., 1. - x * x - y * y));
    e = clamp((-.783 * sin(uCamYaw) * x + .622 * y + .783 * cos(uCamYaw) * z) * .5 + .5, 0., 1.);
  } else e = clamp(1.08 - u.y * .95 + .08 * cos(uCamYaw), 0., 1.);   // blades: the tips first
  float d = uPlant.z + r1 * (kind < 2.5 ? .24 : .16) + (1. - e) * (kind < 2.5 ? .3 : .22);
  float k = clamp((uAutumn - d) / max(.08, 1. - d), 0., 1.);
  int stage = int(min(4., floor(k * 5.)));
  if (stage == 0) return col;
  return uPPal[(r2 > .8 ? 16 : 0) + (stage - 1) * 4 + tn];
}
void main() {
  vec2 C = vC, uv = vUv;
  if (uHasBend > .5) {   // each row shifts by whole pixels: stiff trunks, a crown moving as a block
    float f = clamp(1. - vSp.y / uSize.y, 0., 1.) * 7.; int i = int(floor(f)); float t = f - float(i);
    float sx = vSp.x - floor(uSway * mix(uBend[i], uBend[min(i + 1, 7)], t) + .5);
    if (sx < 0. || sx >= uSize.x) discard;
    C = vec2(sx / uSize.x, vSp.y / uSize.y); uv = uRect.xy + C * uRect.zw;
  }
  vec4 c = texture(uTex, uv), e = uHasEm > .5 ? texture(uEm, uv) : vec4(0.);
  if (c.a < .5 && e.a < .5) discard;
  if (c.a < .5) c.rgb = e.rgb;   // emit-only pixels (a flame above its bowl): painted too, like wind.js's flameAlbedo
  float own = 0.;   // 1 = this pixel has its own autumn colours: the composite leaves it out of the season's matrix (G-buffer tone 2)
  if (uPlant.x > .5 && uAutumn > 0. && c.a > .5) {
    int tn = -1;
    for (int k = 0; k < 4; k++) { vec3 dd = c.rgb - uPRamp[k]; if (dot(dd, dd) < .0004) { tn = k; break; } }   // (a cattail head, a painted flower: not the ramp, left as painted)
    if (tn >= 0) { own = 1.; c.rgb = plantTurn(c.rgb, tn, floor(C * uSize) + .5); }
  }
  vec3 F = vec3(sin(uCamYaw), 0., cos(uCamYaw)), R = vec3(cos(uCamYaw), 0., -sin(uCamYaw));
  const float S20 = .34202, C20 = .93969;
  vec3 U20 = vec3(0., C20, 0.) - F * S20, F20 = vec3(0., S20, 0.) + F * C20;
  vec3 n = normalize(F20 + vec3(0., .25, 0.));
  if (uHasNrm > .5) {
    vec4 t = texture(uNrm, uNrmRect.xy + C * uNrmRect.zw);
    if (t.a > .5) { vec3 q = t.xyz * 2. - 1.; n = normalize(q.x * R + q.y * U20 + q.z * F20); }
  }
  o0 = vec4(c.rgb, float(int(uType) * 4 + (own > .5 ? 2 : 0)) / 255.);
  o1 = vec4(n, uObj);
  float metal = 0.;   // the character's metal (E.w for type 4): 2 steel, 1 gold
  if (uHasMetal > .5) { float m = texture(uMetal, uv).r; metal = m > .7 ? 2. : m > .3 ? 1. : 0.; }
  o2 = vec4(e.rgb * e.a + vec3(uFlash), metal);
}`;
// ---------------------------------------------------------------- shaders: world cards in INSTANCED batches (stage 3)
// The world's painted cards (bushes, tufts, reeds, dummies, braziers, brutes ...: card({batch: true})) are drawn one instanced
// draw per texture (+ emit texture, + shadow or not) instead of a mesh + material each: CARD_VS / CARD_FS term for term, the
// card's uniforms read from instance attributes (and flat varyings), the plants' autumn palettes from a float texture (one row
// a plant path: its 4 green ramp tones, then the 32 tones of its two paths). A world card has no normal map, no metal and shows
// its whole image (uRect 0, 0, 1, 1).
//   iA anchor xyz, bias   iS size xy, pivot xy   iO offset xy, sway, bends (1/0)   iB0 / iB1 the 8 bend weights
//   iM flash, obj, plant kind, plant seed   iP plant delay, palette row
const BCARD_VS = HEAD + `
in vec3 position; in vec4 iA; in vec4 iS; in vec4 iO; in vec4 iB0; in vec4 iB1; in vec4 iM; in vec4 iP;
uniform mat4 viewMatrix, projectionMatrix;
uniform float uFaceYaw, uCamYaw, uShadow; uniform vec2 uPx, uSnap;   // uShadow 1: the sun card (no bias, no row bend)
out vec2 vUv; out vec2 vC; out vec2 vSp;
flat out vec2 vSize; flat out vec4 vB0; flat out vec4 vB1; flat out vec4 vMisc; flat out vec4 vPlant;   // vMisc: sway, bends, flash, obj
void main() {
  vec2 c = position.xy;
  vec2 uSize = iS.xy, uPivot = iS.zw, uOff = iO.xy; float uSway = iO.z, uHasBend = uShadow > .5 ? 0. : iO.w, uBias = uShadow > .5 ? 0. : iA.w;
  vec3 right = vec3(cos(uFaceYaw), 0., -sin(uFaceYaw));
  if (dot(right, vec3(cos(uCamYaw), 0., -sin(uCamYaw))) < 0.) right = -right;   // (CARD_VS: a sun card is never mirrored)
  float S = uHasBend > .5 ? ceil(abs(uSway)) : 0., sxp = c.x * (uSize.x + 2. * S) - S;
  float px = sxp - uPivot.x + uOff.x + (uHasBend > .5 ? 0. : uSway * c.y), py = uPivot.y - (1. - c.y) * uSize.y + uOff.y;
  vec3 w = iA.xyz + right * (px / uPx.x) + vec3(0., py / uPx.y, 0.);
  vC = vec2(c.x, 1. - c.y); vSp = vec2(sxp, (1. - c.y) * uSize.y);
  vUv = vC;
  vSize = uSize; vB0 = iB0; vB1 = iB1; vMisc = vec4(uSway, uHasBend, iM.x, iM.y); vPlant = vec4(iM.z, iM.w, iP.x, iP.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
  if (uSnap.x > 0.) {
    vec4 a = projectionMatrix * viewMatrix * vec4(iA.xyz, 1.);
#ifndef CINE
    vec2 p = (a.xy * .5 + .5) * uSnap;
    gl_Position.xy += (floor(p + .5) - p) / uSnap * 2.;
#endif
  }
#ifdef CINE
  gl_Position.z -= uBias * 120. * -projectionMatrix[3][2] / gl_Position.w;   // (the bias in metres: an oblique b is b x R_DEPTH m)
#else
  gl_Position.z -= uBias * gl_Position.w;
#endif
}`;
const BCARD_FS = HEAD + OUTS + `
in vec2 vUv; in vec2 vC; in vec2 vSp;
flat in vec2 vSize; flat in vec4 vB0; flat in vec4 vB1; flat in vec4 vMisc; flat in vec4 vPlant;
uniform sampler2D uTex, uEm, uPal; uniform float uHasEm, uType, uCamYaw, uAutumn;
float bend(int i) { return i < 4 ? vB0[i] : vB1[i - 4]; }
vec3 pal(int k) { return texelFetch(uPal, ivec2(k, int(vPlant.w + .5)), 0).rgb; }   // 0..3 the green ramp, 4.. the paths' tones
float ph2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pvn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(ph2(i), ph2(i + vec2(1, 0)), f.x), mix(ph2(i + vec2(0, 1)), ph2(i + vec2(1, 1)), f.x), f.y); }
vec3 plantTurn(vec3 col, int tn, vec2 sp) {   // (CARD_FS plantTurn)
  float kind = vPlant.x, seed = vPlant.y;
  vec2 cs = kind < 1.5 ? vec2(5.4, 4.6) : kind < 2.5 ? vec2(2.4, 3.2) : kind < 3.5 ? vec2(4.4, 3.8) : vec2(2.2, 8.);
  vec2 q = sp + (vec2(pvn(sp * .21 + seed * 13.), pvn(sp * .21 + 7.3 + seed * 5.)) - .5) * (kind < 1.5 ? 3. : 1.6);
  vec2 g = q / cs, gi = floor(g), gf = fract(g); float best = 9.; vec2 bc = gi;
  for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) {
    vec2 c = gi + vec2(float(k), float(j)), o = vec2(ph2(c + seed * 17.), ph2(c + seed * 17. + 5.3)), dv = vec2(float(k), float(j)) + .12 + o * .76 - gf;
    float dd = dot(dv, dv); if (dd < best) { best = dd; bc = c; }
  }
  float r1 = ph2(bc + seed * 31. + 1.7), r2 = ph2(bc + seed * 7. + 3.1);
  vec2 u = sp / vSize; float e;
  if (kind < 1.5 || (kind > 2.5 && kind < 3.5)) {
    float x = clamp((u.x - .5) / .44, -1., 1.), y = clamp((.64 - u.y) / .46, -1., 1.), z = sqrt(max(0., 1. - x * x - y * y));
    e = clamp((-.783 * sin(uCamYaw) * x + .622 * y + .783 * cos(uCamYaw) * z) * .5 + .5, 0., 1.);
  } else e = clamp(1.08 - u.y * .95 + .08 * cos(uCamYaw), 0., 1.);
  float d = vPlant.z + r1 * (kind < 2.5 ? .24 : .16) + (1. - e) * (kind < 2.5 ? .3 : .22);
  float k = clamp((uAutumn - d) / max(.08, 1. - d), 0., 1.);
  int stage = int(min(4., floor(k * 5.)));
  if (stage == 0) return col;
  return pal(4 + (r2 > .8 ? 16 : 0) + (stage - 1) * 4 + tn);
}
void main() {
  vec2 C = vC, uv = vUv;
  if (vMisc.y > .5) {   // each row shifts by whole pixels (CARD_FS)
    float f = clamp(1. - vSp.y / vSize.y, 0., 1.) * 7.; int i = int(floor(f)); float t = f - float(i);
    float sx = vSp.x - floor(vMisc.x * mix(bend(i), bend(min(i + 1, 7)), t) + .5);
    if (sx < 0. || sx >= vSize.x) discard;
    C = vec2(sx / vSize.x, vSp.y / vSize.y); uv = C;
  }
  vec4 c = texture(uTex, uv), e = uHasEm > .5 ? texture(uEm, uv) : vec4(0.);
  if (c.a < .5 && e.a < .5) discard;
  if (c.a < .5) c.rgb = e.rgb;
  float own = 0.;
  if (vPlant.x > .5 && uAutumn > 0. && c.a > .5) {
    int tn = -1;
    for (int k = 0; k < 4; k++) { vec3 dd = c.rgb - pal(k); if (dot(dd, dd) < .0004) { tn = k; break; } }
    if (tn >= 0) { own = 1.; c.rgb = plantTurn(c.rgb, tn, floor(C * vSize) + .5); }
  }
  vec3 F = vec3(sin(uCamYaw), 0., cos(uCamYaw));
  const float S20 = .34202, C20 = .93969;
  vec3 F20 = vec3(0., S20, 0.) + F * C20;
  vec3 n = normalize(F20 + vec3(0., .25, 0.));
  o0 = vec4(c.rgb, float(int(uType) * 4 + (own > .5 ? 2 : 0)) / 255.);
  o1 = vec4(n, vMisc.w);
  o2 = vec4(e.rgb * e.a + vec3(vMisc.z), 0.);
}`;
const BCARD_SHADOW_FS = HEAD + `layout(location = 0) out vec4 o0;
in vec2 vUv; in vec2 vC; in vec2 vSp; uniform sampler2D uTex;
void main() { if (texture(uTex, vUv).a < .5) discard; o0 = vec4(1.); }`;
const LINE_VS = HEAD + `
in vec3 position; in vec4 color;   // a = emissive (1) or lit (0)
uniform mat4 viewMatrix, projectionMatrix;
out vec4 vCol;
void main() {
  vCol = color; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.);
#ifdef CINE
  gl_Position.z -= .15 * -projectionMatrix[3][2] / gl_Position.w;   // (15 cm: the oblique .00125 x R_DEPTH)
#else
  gl_Position.z -= .00125 * gl_Position.w;
#endif
}`;
const LINE_FS = HEAD + OUTS + `
in vec4 vCol;
void main() { o0 = vec4(vCol.rgb, float(6 * 4) / 255.); o1 = vec4(0., 1., 0., 7.); o2 = vec4(vCol.rgb * vCol.a, 0.); }`;

// the sprite batch: many small billboards per draw (one draw per source image). Per instance: anchor (world) + lie, uv
// rect, size + pivot (px), misc (alpha: ordered dither below 1, flipX, sway px at the top, flash 0..1).
// LIE (0 upright .. 1 lying; features/foes/look.js, a death clip's per-frame `lie`): a lying body's image is the game's
// own ground projection (tools/blender/western.py render views: PPMH px per m of height, PPMY per m of ground), so a row
// py px above the pivot shows the ground (py - LIE_H PPMH) / PPMY m beyond it, LIE_H up. Drawn, the card keeps its place
// on screen and only its DEPTH lies down onto that plane (things behind the body show over it, the ground in front no
// longer buries its lowered rows); in the sun's map the card itself lies down (uSun): its shadow is the body's footprint
const BATCH_VS = HEAD + `
in vec3 position; in vec4 iAnchor; in vec4 iRect; in vec4 iSize; in vec4 iMisc;
uniform mat4 viewMatrix, projectionMatrix;
uniform float uFaceYaw, uCamYaw, uBias, uPy, uSun; uniform vec2 uPx, uSnap;
out vec2 vUv; out vec2 vC; flat out vec4 vMisc;
const float LIE_H = .18;
void main() {
  vec2 c = position.xy;
  vec3 right = vec3(cos(uFaceYaw), 0., -sin(uFaceYaw));
  if (dot(right, vec3(cos(uCamYaw), 0., -sin(uCamYaw))) < 0.) right = -right;   // shadow cards: never mirrored (CARD_VS)
  float px = c.x * iSize.x - iSize.z + iMisc.z * c.y, py = iSize.w - (1. - c.y) * iSize.y, lie = iAnchor.w;
  vec3 w = iAnchor.xyz + right * (px / uPx.x) + vec3(0., py / uPx.y, 0.), fl = w;
  if (lie > 0.) {
    vec3 rc = vec3(cos(uCamYaw), 0., -sin(uCamYaw)), fc = vec3(-sin(uCamYaw), 0., -cos(uCamYaw));   // the view's right, away along the ground
    fl = iAnchor.xyz + rc * (px / uPx.x) + fc * ((py - LIE_H * uPx.y) / uPy) + vec3(0., LIE_H, 0.);
    if (uSun > .5) w = mix(w, fl, lie);
  }
  vC = vec2(iMisc.y > .5 ? 1. - c.x : c.x, 1. - c.y);
  vUv = iRect.xy + vC * iRect.zw; vMisc = iMisc;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
  if (lie > 0. && uSun < .5) gl_Position.z = mix(gl_Position.z, (projectionMatrix * viewMatrix * vec4(fl, 1.)).z, lie);
  if (uSnap.x > 0.) {
    vec4 a = projectionMatrix * viewMatrix * vec4(iAnchor.xyz, 1.);
#ifndef CINE
    vec2 p = (a.xy * .5 + .5) * uSnap;
    gl_Position.xy += (floor(p + .5) - p) / uSnap * 2.;
#endif
  }
#ifdef CINE
  gl_Position.z -= uBias * 120. * -projectionMatrix[3][2] / gl_Position.w;   // (the bias in metres: an oblique b is b x R_DEPTH m)
#else
  gl_Position.z -= uBias * gl_Position.w;
#endif
}`;
const BAYER = `float bayer(ivec2 p) { int i = (p.x & 3) + (p.y & 3) * 4;
  const float B[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.); return (B[i] + .5) / 16.; }\n`;
const BATCH_FS = HEAD + OUTS + BAYER + `
in vec2 vUv; in vec2 vC; flat in vec4 vMisc;
uniform sampler2D uTex, uEm, uNrm; uniform float uHasEm, uHasNrm, uType, uCamYaw;
void main() {
  vec4 c = texture(uTex, vUv), e = uHasEm > .5 ? texture(uEm, vUv) : vec4(0.);
  if (c.a < .5 && e.a < .5) discard;
  if (vMisc.x < .999 && vMisc.x <= bayer(ivec2(gl_FragCoord.xy))) discard;   // alpha as an ordered dither (pixel art)
  if (c.a < .5) c.rgb = e.rgb;
  vec3 F = vec3(sin(uCamYaw), 0., cos(uCamYaw)), R = vec3(cos(uCamYaw), 0., -sin(uCamYaw));
  const float S20 = .34202, C20 = .93969;
  vec3 U20 = vec3(0., C20, 0.) - F * S20, F20 = vec3(0., S20, 0.) + F * C20;
  vec3 n = normalize(F20 + vec3(0., .25, 0.));
  if (uHasNrm > .5) { vec4 t = texture(uNrm, vUv); if (t.a > .5) { vec3 q = t.xyz * 2. - 1.; n = normalize(q.x * R + q.y * U20 + q.z * F20); } }
  o0 = vec4(c.rgb, float(int(uType) * 4) / 255.);
  o1 = vec4(n, 9.);
  o2 = vec4(e.rgb * e.a + vec3(vMisc.w), 0.);
}`;
const BATCH_SHADOW_FS = HEAD + `layout(location = 0) out vec4 o0;\n` + BAYER + `
in vec2 vUv; in vec2 vC; flat in vec4 vMisc; uniform sampler2D uTex;
void main() { if (texture(uTex, vUv).a < .5) discard; if (vMisc.x < .999 && vMisc.x <= bayer(ivec2(gl_FragCoord.xy))) discard; o0 = vec4(1.); }`;
// pixel particles: one screen pixel (or a few) each, snapped to the pixel grid, lit or emissive
const POINT_VS = HEAD + `
in vec3 position; in vec4 color; in vec2 aMisc;   // color.a = emissive; aMisc = size px, alpha
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uSnap; uniform float uPtK;   // uPtK: the cinema camera's k (gfx.js setCine)
out vec4 vCol; flat out float vAlpha;
void main() {
  vCol = color; vAlpha = aMisc.y;
  vec4 p = projectionMatrix * viewMatrix * vec4(position, 1.);
#ifdef CINE
  float pw = p.w; p.xyz /= pw;   // (the cinema camera's perspective: gfx.js setCine)
#endif
  vec2 s = (p.xy * .5 + .5) * uSnap;
#ifdef CINE
  vec2 c = mod(aMisc.x * uPtK, 2.) > .5 ? floor(s) + .5 : floor(s + .5);   // odd sizes centre on a pixel, even on a corner
#else
  vec2 c = mod(aMisc.x, 2.) > .5 ? floor(s) + .5 : floor(s + .5);   // odd sizes centre on a pixel, even on a corner
#endif
#ifdef CINE
  gl_Position = vec4(c / uSnap * 2. - 1., p.z - .15 * -projectionMatrix[3][2] / (pw * pw), pw > 0. ? 1. : -1.);   // (15 cm toward the camera; w -1: behind it, clipped)
  gl_PointSize = aMisc.x * uPtK;
#else
  gl_Position = vec4(c / uSnap * 2. - 1., p.z - .00125, 1.);
  gl_PointSize = aMisc.x;
#endif
}`;
const POINT_FS = HEAD + OUTS + BAYER + `
in vec4 vCol; flat in float vAlpha;
void main() {
  if (vAlpha < .999 && vAlpha <= bayer(ivec2(gl_FragCoord.xy))) discard;
  o0 = vec4(vCol.rgb, float(3 * 4) / 255.); o1 = vec4(0., 1., 0., -1.); o2 = vec4(vCol.rgb * vCol.a, 0.);   // obj -1: a particle
}`;

// ---------------------------------------------------------------- shaders: shadow + x-ray (single target)
const ONE_OUT = `layout(location = 0) out vec4 o0;\n`;
const SHADOW_MESH_VS = HEAD + `
in vec3 position; uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }`;
// a swaying mesh casts its shadow from the same leaned (whole-pixel) pose the camera sees, minus the leaves the season
// took (the same noise as MESH_FS)
const SHADOW_SWAY_VS = HEAD + SWAY + SPRAY_VS + `
in vec3 position; in float aFixed; uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vPL; flat out float fFixed; flat out float fM;
void main() { vec4 w = modelMatrix * vec4(position, 1.); w.xyz += sway(); vPL = position; fFixed = aFixed; fM = sprayM(modelMatrix); gl_Position = projectionMatrix * viewMatrix * w; }`;
const SHADOW_FS = HEAD + ONE_OUT + `void main() { o0 = vec4(1.); }`;
const SHADOW_SWAY_FS = HEAD + ONE_OUT + `
in vec3 vPL; flat in float fFixed; flat in float fM; uniform float uLeafK; uniform vec2 uSeed;
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
` + LEAF_GONE + `
void main() { if (fFixed < -1.5 && leafGone(vPL, fM)) discard; o0 = vec4(1.); }`;
const SHADOW_CARD_FS = HEAD + ONE_OUT + `
in vec2 vUv; in vec2 vC; uniform sampler2D uTex;
void main() { if (texture(uTex, vUv).a < .5) discard; o0 = vec4(1.); }`;
const XRAY_FS = HEAD + ONE_OUT + `
in vec2 vUv; in vec2 vC; uniform sampler2D uTex, uDepth;
void main() {
  if (texture(uTex, vUv).a < .5) discard;
  float sd = texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r;
  if (gl_FragCoord.z <= sd + 1.5e-4) discard;   // visible here: not x-rayed
  o0 = vec4(1., 0., 0., 0.);   // (R only: G is the contact shadows' mask, AO_FS)
}`;

// ---------------------------------------------------------------- shaders: CONTACT SHADOWS (features/contact.js; G.ao)
// One instanced quad per stamp, drawn into the x-ray target's G channel (R is the x-ray mark; G, B, A were free) as the
// canvas mask was: each stamp's texel shown nearest-neighbour at z px a texel (the canvas's drawImage), its alpha times the
// stamp's (globalAlpha), merged source-over (blend: one, one minus src: a + m (1 - a)). COMP_FS lays the mask on the ground.
//   iR: the stamp's top-left (canvas px, y down), z (px a texel), alpha   iT: its rect in the atlas (texels: u, v, w, h)
const AO_VS = HEAD + `
in vec3 position; in vec4 iR; in vec4 iT; uniform vec2 uRes;
flat out vec4 vR; flat out vec4 vT;
void main() {
  vec2 p = iR.xy + position.xy * iT.zw * iR.z;
  vR = iR; vT = iT;
  gl_Position = vec4(p.x / uRes.x * 2. - 1., 1. - p.y / uRes.y * 2., 0., 1.);
}`;
const AO_FS = HEAD + ONE_OUT + `
flat in vec4 vR; flat in vec4 vT; uniform vec2 uRes; uniform sampler2D uAtlas;
void main() {
  vec2 c = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);   // this pixel's centre in canvas px (y down)
  ivec2 t = ivec2(floor((c - vR.xy) / vR.z));
  if (t.x < 0 || t.y < 0 || t.x >= int(vT.z + .5) || t.y >= int(vT.w + .5)) discard;
  float s = texelFetch(uAtlas, ivec2(vT.xy + .5) + t, 0).r * vR.w;
  if (s <= 0.) discard;
  o0 = vec4(0., s, 0., 0.);
}`;

// ---------------------------------------------------------------- shaders: THE SCREEN LAYERS' GPU OPS (G.glayer)
// One instanced quad per op of a layer's GPU context (fillRect, drawImage), in canvas px (y down) as the 2D canvas was, under
// the context's transform (any affine: the quad is a parallelogram): a fill is its premultiplied colour; an image shows the
// source texel the canvas's nearest-neighbour drawImage showed (the source rect mapped onto the dest rect: a pixel centre
// mapped back), times the op's alpha. Blended into the layer's target premultiplied: source-over (one, one minus src alpha)
// or 'lighter' (one, one). A run can be clipped (clipOutside: up to 4 polygons; a pixel shows where an even number cover it).
//   iO: the dest's corner + its first axis (canvas px)   iV: its second axis   iS: the source rect (texels; w = 0: a fill)
//   iC: the colour, premultiplied (a: an image's alpha)
const LB_VS = HEAD + `
in vec3 position; in vec4 iO; in vec4 iV; in vec4 iS; in vec4 iC; uniform vec2 uRes;
out vec2 vS; flat out vec4 vC; flat out float vF;
void main() {
  vS = iS.xy + position.xy * iS.zw; vC = iC; vF = iS.z == 0. ? 1. : 0.;
  vec2 p = iO.xy + iO.zw * position.x + iV.xy * position.y;
  gl_Position = vec4(p.x / uRes.x * 2. - 1., 1. - p.y / uRes.y * 2., 0., 1.);
}`;
const LB_FS = HEAD + ONE_OUT + `
in vec2 vS; flat in vec4 vC; flat in float vF; uniform sampler2D uTex; uniform vec2 uRes;
uniform vec2 uClipP[32]; uniform vec4 uClipN; uniform float uClipK;   // the clip's polygons (points in a row, counts), how many
bool inPoly(vec2 p, int s, int n) {   // even-odd crossing test of polygon s .. s + n - 1
  bool c = false;
  for (int i = 0, j = n - 1; i < n; j = i++) { vec2 a = uClipP[s + i], b = uClipP[s + j]; if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c; }
  return c;
}
void main() {
  if (uClipK > .5) {
    vec2 c = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y); int inside = 0, s = 0;
    for (int j = 0; j < 4; j++) { if (float(j) >= uClipK) break; int n = int(uClipN[j] + .5); if (inPoly(c, s, n)) inside++; s += n; }
    if (inside % 2 == 1) discard;
  }
  if (vF > .5) { o0 = vC; return; }
  ivec2 t = ivec2(floor(vS)), sz = textureSize(uTex, 0);
  if (t.x < 0 || t.y < 0 || t.x >= sz.x || t.y >= sz.y) discard;
  o0 = texelFetch(uTex, t, 0) * vC.a;   // (the texture is premultiplied, as the canvas keeps it)
}`;

// ---------------------------------------------------------------- shader: lighting / composite
const NL = 32;
const MIST_N = 12;   // the mist's water stretches (COMP_FS MIST, G.setMist)
const COMP_VS = HEAD + `in vec3 position; void main() { gl_Position = vec4(position.xy, 0., 1.); }`;
const COMP_FS = HEAD + `
uniform sampler2D tA, tN, tE, tD, tS, tX, uRamps;
uniform mat4 uInvPV, uLightPV;
uniform sampler2D tSS; uniform mat4 uLightPVS; uniform float uSBias, uSOn;   // the static sun shadow (world-wide, cached): matrix, bias scale, on
uniform vec2 uRes; uniform float uR;
// THE CINEMA CAMERA (G.setCine; features/cinema.js): uCine.x 1 = a free perspective camera instead of the oblique view, y / z
// its near / far (m), w the air's density (1/m: distance fog toward the horizon, so the world's edge melts into it); its
// position; the sky: zenith and horizon colours, the sun's disk (direction toward it, cos of its radius) and colour
uniform vec4 uCine, uSunP; uniform vec3 uCamP, uSkyZ, uSkyH, uSunCol;
uniform vec3 uBg, uAmb, uSunDir, uShadowC, uFill, uGrade, uXCol;
uniform float uShadowA, uShadowOn, uSunK, uBanded, uOutline, uGradeK, uEmin, uShadowTexel;
uniform float uSoftFam;   // a ramp family drawn without inner seams / occlusion lines (the trees' leaves; -1 = none)
// the world clock (features/weather.js sets them): the season's colour matrix for green pixels + how much it applies,
// lying snow 0..1, wet ground 0..1, the lightning flash (rgb light added for an instant)
uniform mat3 uSeasonM; uniform float uSeasonK, uSnow, uWet; uniform vec3 uFlashC;
float hC(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnC(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hC(i), hC(i + vec2(1, 0)), f.x), mix(hC(i + vec2(0, 1)), hC(i + vec2(1, 1)), f.x), f.y); }
uniform vec4 uFog;
uniform vec3 uPlayer;   // the player's chest (receives sun shadow as one object: no self-shadow from its own card)
uniform float uPlayerSun;   // how far toward the sun (m) his one shadow test looks: .5; the live hero (view/livehero.js) more, past his own 3D body
// shiny armour: toward the viewer (the sprite camera, 20 deg pitch, turned with the yaw), the sun's glint colour / strength
uniform vec3 uView, uSunC; uniform float uSunStr;
// the water (SURF_FS marks it: type 1 + tone 1): its clock (s), (lanterns' reflections, sun sparkles) strength, (ground texels, view px) per metre
uniform float uWPhase; uniform vec4 uWRefl; uniform vec2 uWPx;
float q3(float v) { return v < .12 ? 0. : v < .4 ? .35 : v < .75 ? .7 : 1.; }   // crisp glint steps
uniform int uNL; uniform vec4 uLP[${NL}]; uniform vec4 uLC[${NL}];
uniform int uNH; uniform vec4 uHalo[${NL}]; uniform vec3 uHaloC[${NL}];
uniform int uDebug;
// screen layers (view px, painted by the host / features with a 2D context): ground (before light, ground pixels only),
// pre (before light, everything), emit (glow, added like an emitter), add (after light, additive), front (after light, over)
uniform sampler2D tGround, tPre, tEmitL, tAdd, tFront; uniform vec4 uLay; uniform float uLayE;
uniform vec4 uAo;   // the contact shadows (tX.g): the mood's shadow colour, strength (0: none this frame)
// distort: where alpha is set, this pixel shows the scene from (x + 128 - R*255, y + G*255 - 128) (heat haze). The screen
// layers after the light (post) stay put.
uniform sampler2D tDistort; uniform float uLayD;
// point-light occlusion: the top-down height map of the solid 3D things (depth from above: bigger = lower)
uniform sampler2D tH; uniform mat4 uHPV; uniform float uPtShadow, uHBias;
out vec4 oc;
vec4 lay(sampler2D t, ivec2 p) { return texelFetch(t, p, 0); }   // a screen layer's target: premultiplied, GL rows (G.glayer / G.layer)
// ---- REFLECTIONS in the water and the puddles (features/depth.js sets them every frame it shows them: G.setReflect). In the
// oblique projection a point h above the water's plane mirrors exactly 2 h S view px straight below itself (S: px per metre of
// height on screen), so this pixel shows the scene pixel k rows above it whose height above the plane is k / 2S: a search up
// the column for where that crosses (the first such thing in front: a prop, a tree, a card, the character; not the ground, a
// face, the batched sprites or particles).
// The look is depth.js's 2D one: its rows shifted whole pixels by a ripple, tinted toward the water's colour, laid over the
// water's albedo before the light; whatever glows there (flames) glows in it, dimmer
uniform vec4 uRf;    // on, tint amount, alpha, glow (the share of the mirrored emission)
uniform vec3 uRfC;   // the water's tint
uniform vec4 uRfW;   // S (view px per metre of height), ripple (px), gust 0..1, the ripple's clock (s)
uniform vec4 uRfV;   // the world origin's view row (px, y down), zoom, how far up to search (px), the puddles' ground-layer alpha (x 255; 0: none)
uniform vec4 uRfP;   // the plateau's pool: x, y (m), rx, ry (rx 0: none)
float rippleOff(ivec2 p, vec3 P, bool puddle) {   // depth.js rippleCopy: whole-pixel row shifts, stronger downstream and in gusts
  float wy = (uRes.y - 1. - float(p.y) - uRfV.x) / uRfV.y, Rr = uRfW.y, g = uRfW.z, T = uRfW.w, amp;
  if (puddle) amp = Rr * (.25 + .8 * g);
  else { vec2 u = (P.xz - uRfP.xy) / (uRfP.zw + .6); amp = uRfP.z > 0. && dot(u, u) < 1. ? Rr * (.7 + .5 * g) : Rr * (.8 + .5 * clamp((P.z - 10.) / 14., 0., 1.) + .6 * g); }
  return floor(amp * sin(wy * .55 - T * 2.1) * (.6 + .4 * sin(wy * .13 + T * .7)) + .5) * uRfV.y;
}
// ---- CLOUD SHADOWS and the LAVA'S HEAT HAZE (features/depth.js sets them every frame it shows them: G.setClouds / setHaze).
// Each was a 2D canvas painted every frame through the ground plane's affine (a pattern fill into the PRE layer; row shifts
// masked by the lava into the DISTORT layer) and uploaded; here a view pixel goes back through that affine to a texel of a
// small top-down map uploaded only when it changes: the same nearest texel the pattern fill sampled. Both maps share ONE texture
// (tTop: the cloud noise in rows 0.., the lava's mask below them): this shader is at the 16 texture units a GPU guarantees.
// The clouds (and a weather front's storm side) are render/clouds.js's: tTop, their uniforms, viewTexel, cloudAt
${CLOUD_GLSL}
uniform vec4 uTopH;                                // (the lava mask's width, height, first row)
uniform vec4 uHz, uHzM, uHzO;                      // haze: on, band (px), zoom, clock (s); view -> texel; origin (view px), the world origin's view row
// ---- MIST (features/mist.js sets it every frame it shows it: G.setMist; ?mist=0 or the feature off: the old screen haze). A layer
// lying LOW in the world: its top is a height (m) that wanders with a noise drifting on the wind and rises over the water (the
// nearest stretch's water + uMistW.x, falling off over uMistW.y m of bank). A pixel shows the world point P through the mist the view
// ray crosses on its way down to it (top - P.y m of it: the ravine's floor through 3-4 m, the meadow through a film, the plateau's top
// through none), as a veil 1 - exp(-sigma t) cut into uMistQ.x hard LEVELS, flat, the edge between two dithered by a 4x4 Bayer
// matrix fixed to the WORLD (indexed from the world origin's screen pixel, uMistO.xy, in world texels: uMistQ.z px each; the camera
// pans in whole pixels, so the pattern stays on the ground). Its colour is the mood's light (uMistC), lit by the lamps round it.
// mistAt(P) is the medium's local density for light through it (god rays): uMistK.x the air's own, more inside the mist
uniform vec4 uMist;    // on, the top over open ground (m), sigma (1 / m), the thickest level's opacity
uniform vec4 uMistC;   // colour (rgb), how much of the lamps' light round it the mist takes
uniform vec4 uMistW;   // the rise over water (m), its reach over the bank (m), the noise's wander (m), its scale (1 / m)
uniform vec4 uMistD;   // the drift (m: added to the noise's ground point), the aerial term (far haze toward the mist), the view's half depth (m)
uniform vec4 uMistO;   // the world origin's screen pixel (GL), the view's centre on the ground (x, z)
uniform vec4 uMistQ;   // levels, the dithered edge's half width (px), the dither's cell (px: a world texel), the water stretches in use
uniform vec4 uMistK;   // the medium's density 0..1 (the air: fog weather 1, a clear noon ~0), the highest the mist can reach (m), the far haze's share
uniform vec4 uMistS[${MIST_N}]; uniform vec4 uMistH[${MIST_N}];   // the water's stretches: (x0, z0, x1, z1); (half width, its water's height, 0, 0)
float mistTop(vec2 g) {
  vec2 q = g * uMistW.w + uMistD.xy;
  // (the noise's contrast is raised: banks with an edge, open ground between them, instead of a slope the levels dither all over)
  float n = vnC(q) * .65 + vnC(q * 2.7 + vec2(5.1, 1.3)) * .35, top = uMist.y + uMistW.z * (smoothstep(.28, .72, n) - .5) * 2.;
  if (uMistQ.w < .5) return top;
  // over the water it gathers in banks (a slower noise: some stretches lie thick, some clear) and spills over the bank unevenly
  float nw = vnC(q * .45 + vec2(9.7, 3.1)), rise = uMistW.x * (.3 + 1.2 * nw), reach = uMistW.y * (.65 + .7 * n);
  for (int i = 0; i < ${MIST_N}; i++) {
    if (float(i) >= uMistQ.w) break;
    vec4 s = uMistS[i]; vec2 ab = s.zw - s.xy, pa = g - s.xy;
    float t = clamp(dot(pa, ab) / max(dot(ab, ab), 1e-4), 0., 1.), d = length(pa - ab * t) - uMistH[i].x;
    float f = 1. - smoothstep(0., reach, d);
    // (past its reach a stretch sinks away, so high water, the creek on the mesa, never lifts the mist over the land round it)
    top = max(top, uMistH[i].y + rise * f * f - 3. * (1. - f));
  }
  return top;
}
float mistAt(vec3 P) { return uMist.x < .5 ? 0. : max(uMistK.x, P.y < uMistK.y ? smoothstep(0., .4, mistTop(P.xz) - P.y) : 0.); }
${BAYER}
// the veil at ground point g, height y, in levels (level k shows where it is >= k; <= 0 above the top): 1 - exp(-sigma t) (+ .4: the
// last level is reached, not only approached), and billows: where it lies deep (the veil near 1, the ravine brimming with it) its own
// slower noise heaps it a level up or thins it a level down in patches, drifting with the rest, so a deep fill isn't one flat tone
float mistV(vec2 g, float y) {
  float t = mistTop(g) - y; if (t <= 0.) return t;
  float w = 1. - exp(-uMist.z * t), nb = vnC(g * .42 + uMistD.xy * 2.5 + vec2(17.3, 4.1));
  return w * (uMistQ.x + .4) + w * w * (smoothstep(.3, .7, nb) - .5) * 1.4;
}
// shade: the sun shadow on the point (0..1 x its opacity); ny: its normal's y (ground-like above .5, else a face, a card, a figure)
vec3 mistOver(vec3 col, vec3 P, vec3 pts, float shade, float ny) {
  // the far haze: lighting's fog (uFog, x uMistK.z), by how far behind the view's centre the pixel's GROUND lies (0 at the view's bottom
  // edge, 1 at its top: the old screen gradient on the ground; a tree takes the haze of the ground it stands on, not of its screen row)
  vec2 back = -normalize(uView.xz);
  float far = clamp(dot(P.xz - uMistO.zw, back) / (2. * uMistD.w) + .5, 0., 1.);
  col += uFog.rgb * uFog.a * (.4 + 1.2 * far) * uMistK.z;
  // (the lamps round it light it, and the lightning; where a shadow falls on the ground the mist over it lies in it too, dimmer)
  vec3 mc = uMistC.rgb * (1. - .35 * shade) + pts * uMistC.a + uFlashC * .8;
  col = mix(col, mc, uMistD.z * far);
  if (P.y >= uMistK.y) return col;
  float v = mistV(P.xz, P.y); if (v < .5) return col;
  // flat levels, dithered only along the EDGE between two: within uMistQ.y px of it (the veil's change over one pixel, from the world one
  // pixel to the right and one up the screen: along the ground, or up a face), so a level never shows as a pattern over an area; where
  // the veil barely changes the edge is a clean line, where it jumps (a step, an object's outline) it is left crisp
  float L = uMistQ.x, lv = clamp(floor(v), 0., L), k = clamp(floor(v + .5), 1., L), e = v - k;
  if (abs(e) < .15) {
    float ppx = uWPx.y; vec2 right = vec2(-back.y, back.x);
    float gx = abs(mistV(P.xz + right / ppx, P.y) - v);
    float gy = abs((ny > .5 ? mistV(P.xz + back / (ppx * .81915), P.y) : mistV(P.xz, P.y + 1. / (ppx * .93969))) - v);
    float gp = max(gx, gy), dp = e / max(gp, 1e-4);   // px past the edge (+ inside the upper level)
    if (gp < .5 && abs(dp) < uMistQ.y) lv = k - (bayer(ivec2(floor((gl_FragCoord.xy - uMistO.xy) / uMistQ.z))) < .5 + .5 * dp / uMistQ.y ? 0. : 1.);
  }
  return mix(col, mc, uMist.w * lv / L);
}
vec4 reflAt(ivec2 p, float hw, out vec3 rE) {   // the mirrored albedo (a = 1: found) seen at p over water at height hw
  rE = vec3(0.);
  int kMax = int(uRfV.z), H = int(uRes.y);
  float nx = (float(p.x) + .5) / uRes.x * 2. - 1., prev = -1.;
  for (int k = 1; k <= 512; k++) {
    if (k > kMax || p.y + k >= H) break;
    ivec2 q = ivec2(p.x, p.y + k);
    float dq = texelFetch(tD, q, 0).r;
    if (dq > .99999) { prev = -1.; continue; }   // nothing there
    float ny = (float(q.y) + .5) / uRes.y * 2. - 1.;   // (the projection is affine: a pixel's world height is linear in ndc and depth)
    float Qy = uInvPV[0][1] * nx + uInvPV[1][1] * ny + uInvPV[2][1] * (dq * 2. - 1.) + uInvPV[3][1];
    float d = 2. * (Qy - hw) * uRfW.x - float(k);
    // the crossing has to lie ON what is there (d near 0: a surface goes through the mirror height between these rows). A jump from
    // below straight to far above is a thing in the AIR (the leaping Ranger, an overhanging crown): the mirrored ray passed under it,
    // and taking its lowest pixel smeared that pixel down to the water as a dark column. Search on past it instead
    if (d >= -.5 && d < 1.5 + 1.5 * uRfV.y && prev < -.5) {
      // the world's things (props, trees, their cards, the character), not the batched sprites (obj 9: riverside plants, lily
      // pads lying on the water, wildlife, decor) nor particles (obj -1): what depth.js mirrored
      vec4 aq = texelFetch(tA, q, 0); int tq = int(aq.a * 255. + .5) / 4; float ob = texelFetch(tN, q, 0).w;
      if ((tq == 2 || tq == 3 || tq == 4 || tq == 7) && ob > -.5 && abs(ob - 9.) > .5) { rE = texelFetch(tE, q, 0).rgb; return vec4(aq.rgb, 1.); }
    }
    prev = d;
  }
  return vec4(0.);
}
vec3 post(vec3 col, ivec2 ip) {
  if (uLay.w > .5) col += lay(tAdd, ip).rgb;
  if (uLay.z > .5) { vec4 f = lay(tFront, ip); col = col * (1. - f.a) + f.rgb; }
  return col;
}
#ifdef CINE
float nearOf(float d) { return -2. * uCine.y * uCine.z / (uCine.z + uCine.y - (d * 2. - 1.) * (uCine.z - uCine.y)); }   // (its depth is not linear)
#else
float nearOf(float d) { return -(d * 2. - 1.) * uR; }
#endif
vec3 worldAt(ivec2 p, float d) { vec2 ndc = (vec2(p) + .5) / uRes * 2. - 1.; vec4 w = uInvPV * vec4(ndc, d * 2. - 1., 1.); return w.xyz / w.w; }
#ifdef CINE
// the cinema camera's sky along r: the horizon's band up to the zenith, the sun's glow (wide and warm when it is low) and
// its disk (whole view pixels, like everything), stars when the zenith is dark, the haze below the horizon
vec3 skyAt(vec3 r) {
  float h = max(r.y, 0.), s = dot(r, uSunP.xyz), up = step(-.12, uSunP.y), low = 1. - smoothstep(0., .4, uSunP.y);
  vec3 c = mix(uSkyH, uSkyZ, sqrt(smoothstep(0., .55, h)));
  c += uSunCol * (pow(max(s, 0.), 5.) * (.18 + .55 * low) + pow(max(s, 0.), 90.) * .6) * up;
  if (s > uSunP.w && uSunP.y > -.04 && r.y > -.01) c = uSunCol * 1.25 + vec3(.3, .28, .22);
  float night = clamp(1. - dot(uSkyZ, vec3(2.2)), 0., 1.);
  if (night > 0. && r.y > .04) { vec3 q = floor(r * 230.); float st = hC(q.xy * 1.31 + q.z * 17.3); if (st > .9965) c += vec3(.75, .8, 1.) * night * min(1., (st - .9965) * 400.); }
  return r.y < 0. ? mix(c, uSkyH * .85, smoothstep(0., .06, -r.y)) : c;
}
vec3 airAt(vec3 r) { return uSkyH + uSunCol * pow(max(dot(r, uSunP.xyz), 0.), 4.) * (.12 + .3 * (1. - smoothstep(0., .4, uSunP.y))) * step(-.12, uSunP.y); }
#endif
int typeAt(ivec2 p) { return int(texelFetch(tA, p, 0).a * 255. + .5) / 4; }
// bias: in light depth (0..1 over the sun camera's 219 m). .0006 (13 cm along the ray) keeps props / the plateau from
// shadowing themselves; the terrain casts nothing into the map, so it takes ~1 cm. Its 13 cm, bias x cos(el) along the
// ground, was a visible GAP between a standing card's feet and the start of its shadow
// two maps: tS (round the view, every frame: what moves) and tSS (the whole world, cached: what doesn't); in shadow in either
float sunShadow(vec3 P, vec3 N, float bias) {
  vec4 lc = uLightPV * vec4(P + N * .06, 1.); vec3 sc = lc.xyz / lc.w * .5 + .5;
  if (all(greaterThanEqual(sc, vec3(0.))) && all(lessThanEqual(sc, vec3(1.))) && sc.z - bias > texture(tS, sc.xy).r) return 1.;
  if (uSOn < .5) return 0.;
  vec4 ls = uLightPVS * vec4(P + N * .06, 1.); vec3 ss = ls.xyz / ls.w * .5 + .5;
  if (any(lessThan(ss, vec3(0.))) || any(greaterThan(ss, vec3(1.)))) return 0.;
  return ss.z - bias * uSBias > texture(tSS, ss.xy).r ? 1. : 0.;   // (bias is in the per-frame map's depth units: rescaled)
}
// 1 when something solid stands between S and the light: march the height map (about one texel, 7 cm, per step across
// the ground, so a shadow edge cast over a long way stays a clean line), stopping 0.25 m short of the light, so a flame
// on a wall top or in a bracket isn't blocked by its own mount. A wall stops a torch behind it.
float ptBlock(vec3 S, vec3 L) {
  vec3 d = L - S; float len = length(d), end = len - .25;
  if (end < .15) return 0.;
  float f = end / len, n = min(128., max(ceil(length(d.xz) * f / .07), ceil(end / .3)));
  vec3 a = (uHPV * vec4(S, 1.)).xyz * .5 + .5, b = (uHPV * vec4(S + d * f, 1.)).xyz * .5 + .5;
  for (int k = 1; k <= 128; k++) {
    float t = float(k) / n; if (t > 1.) break;
    vec3 c = mix(a, b, t);
    if (c.x < 0. || c.y < 0. || c.x > 1. || c.y > 1.) continue;
    if (c.z - uHBias > texture(tH, c.xy).r) return 1.;
  }
  return 0.;
}
void main() {
  ivec2 ip0 = ivec2(gl_FragCoord.xy), ip = ip0;
  if (uLayD > .5) { vec4 dd = lay(tDistort, ip0); dd.rgb /= max(dd.a, 1e-3); if (dd.a > .5) ip = clamp(ip0 + ivec2(128 - int(dd.r * 255. + .5), int(dd.g * 255. + .5) - 128), ivec2(0), ivec2(uRes) - 1); }
  if (uHz.x > .5) {   // the lava's heat haze: rows of 2 px shifted whole pixels (depth.js drawHaze's formula) where the lava lies
    float yc = uRes.y - 1. - float(ip0.y), yb = floor(yc / uHz.y) * uHz.y, wy = floor((yb - uHzO.z) / uHz.z + .5);
    float s = floor(sin(wy * .21 - uHz.w * 2.6) * max(0., sin(wy * .047 + uHz.w * .9)) * 1.45 + .5);
    if (s != 0.) {
      ivec2 t = viewTexel(ip0, uHzM, uHzO.xy);
      if (all(greaterThanEqual(t, ivec2(0))) && all(lessThan(t, ivec2(uTopH.xy))) && texelFetch(tTop, t + ivec2(0, int(uTopH.z)), 0).r > .5)
        ip = clamp(ivec2(ip0.x - int(s * uHz.z), ip0.y), ivec2(0), ivec2(uRes) - 1);
    }
  }
  vec4 a0 = texelFetch(tA, ip, 0);
  int code = int(a0.a * 255. + .5), type = code / 4, tone = code - type * 4;
  bool water = type == 1 && tone == 1;   // (tone is only used by meshes otherwise)
#ifdef CINE
  if (type == 0) { oc = vec4(clamp(skyAt(normalize(worldAt(ip0, 1.) - uCamP)), 0., 1.), 1.); return; }   // (no screen layers: see render)
#else
  if (type == 0) { oc = vec4(clamp(post(uBg, ip0), 0., 1.), 1.); return; }
#endif
  float d0 = texelFetch(tD, ip, 0).r;
  vec4 N0 = texelFetch(tN, ip, 0), E0 = texelFetch(tE, ip, 0);
  vec3 P = worldAt(ip, d0), N = normalize(N0.xyz), alb = a0.rgb;

  // ---- the pixelizer's rules, live, on ramp meshes: silhouette outline (selective), seams, occlusion lines
  if (type == 2 && uOutline > .5) {
    float n0 = nearOf(d0), obj = N0.w, pk = E0.w, fam = mod(pk, 32.), part = floor(pk / 32. + .001);
    bool outLit = false, outDark = false, line = false, seam = false, edge = false, soft = abs(fam - uSoftFam) < .5;
    // soft (the leaves): no seams and no dark occlusion lines between its own parts; where a clump stands in front of
    // another, the one behind only steps one tone darker along the edge (the painted blob's shaded rim). Dark lines in a
    // crown come only from a branch in front of it; the silhouette keeps its outline
    ivec2 off[4] = ivec2[4](ivec2(-1, 0), ivec2(0, 1), ivec2(1, 0), ivec2(0, -1));   // left, up, right, down
    for (int k = 0; k < 4; k++) {
      ivec2 q = ip + off[k];
      if (q.x < 0 || q.y < 0 || q.x >= int(uRes.x) || q.y >= int(uRes.y)) continue;
      int tq = typeAt(q); float nq = nearOf(texelFetch(tD, q, 0).r), oq = texelFetch(tN, q, 0).w;
      if (tq != 2 || abs(oq - obj) > .5) {
        if (tq == 0 || nq < n0 + .12) { if (k <= 1) outLit = true; else outDark = true; }   // my edge against what lies behind
      } else {
        float pq = texelFetch(tE, q, 0).w, famq = mod(pq, 32.), partq = floor(pq / 32. + .001);
        if (nq > n0 + .12) { if (!soft || abs(famq - fam) > .5) line = true; else edge = true; }   // my own front edge hides me here
        else if (!soft && k >= 2 && abs(partq - part) > .5 && abs(famq - fam) < .5) seam = true;   // plank meets plank
      }
    }
    int ti = outDark ? 4 : outLit ? 5 : line ? 3 : seam ? min(tone + 1, 3) : edge ? min(tone + 1, 2) : tone;
    alb = texelFetch(uRamps, ivec2(ti, int(fam + .5)), 0).rgb;
    if (soft) {   // a crown turned by autumn (MESH_FS wrote its spray's colour into tA): keep it, and give the outline / edge tones its hue
      vec3 r0 = texelFetch(uRamps, ivec2(tone, int(fam + .5)), 0).rgb, kk = abs(a0.rgb / max(r0, vec3(.02)) - 1.);
      if (max(kk.r, max(kk.g, kk.b)) > .02) alb = clamp(alb * a0.rgb / max(r0, vec3(.02)), 0., 1.);
    }
  }

  // ---- painted layers before the light: ground decals / animal shadows / ripples (ground only), cloud shadows (all)
  float gA = 0.;
  if (uAo.w > 0. && (type == 1 || type == 5)) alb = mix(alb, uAo.rgb, texelFetch(tX, ip, 0).g * uAo.w);   // contact shadows (G.ao)
  if (uLay.x > .5 && (type == 1 || type == 5)) { vec4 g = lay(tGround, ip); alb = alb * (1. - g.a) + g.rgb; gA = g.a; }
  vec3 rfE = vec3(0.);   // ---- what stands over the water, mirrored in it (see reflAt)
  if (uRf.x > .5 && type == 1) {
    bool puddle = uRfV.w > 0. && abs(gA * 255. - uRfV.w) < .5;
    if (water || puddle) {
      ivec2 rp = ivec2(clamp(ip.x - int(rippleOff(ip, P, puddle)), 0, int(uRes.x) - 1), ip.y);
      vec4 r = reflAt(rp, P.y, rfE);
      if (r.a > .5) { alb = mix(alb, mix(r.rgb, uRfC, uRf.y), uRf.z); rfE *= uRf.w; }
    }
  }
  if (uLay.y > .5) { vec4 g = lay(tPre, ip); alb = alb * (1. - g.a) + g.rgb; }
  float frD = 0.;   // a weather front's storm side: how much darker than the view's light it is here (render/clouds.js)
  if (uCl.x > .5) {   // cloud shadows: the level map fixed to the ground plane (h 0), drifting with the wind, two hard levels
    vec3 cl = cloudAt(ip, P);
    frD = cl.y;   // (the storm: greyer and darker, as its own light would draw it: no cloud shadows, no sun shadows, the sun barely shapes things)
    alb = mix(alb, uClC, (cl.x > 1.5 ? uCl.z : cl.x > .5 ? uCl.y : 0.) * (1. - frD));
    if (frD > 0.) alb = mix(alb, vec3(dot(alb, vec3(.3, .55, .15))) * uFrC.rgb, uFrK.z * frD) * (1. - uFrK.w * frD);
  }

  // ---- the world clock (sim/env.js via features/weather.js): the SEASON turns the green of the ground and of painted
  // things (bushes, tufts, leaf particles: types 1 and 3) through uSeasonM, by how green the pixel is; SNOW lies on what
  // faces up (ground, props, crowns), in patches fixed in the world, thickening with uSnow (not on the water); WET ground
  // and props darken
  if (uSeasonK > 0. && (type == 1 || type == 3) && tone != 2) { float g = clamp((alb.g - max(alb.r, alb.b)) * 7., 0., 1.) * uSeasonK; if (g > 0.) alb = mix(alb, clamp(uSeasonM * alb, 0., 1.), g); }   // (tone 2 on a ground or card pixel: it has its own autumn colours, SURF_FS's fallen leaves and CARD_FS's plants)
  if (uSnow > 0. && (type == 1 || type == 2) && N.y > .55 && !water && !(alb.b > alb.r + .05 && alb.b >= alb.g)) {   // (water: the baked flag; the blue-ish test stays for what isn't flagged: frost's blue ground and ice keep their painted snow)
    // patches at three scales (60 cm / 20 cm / 7 cm), the large one leading so mid cover reads as drifts, not camouflage.
    // Snow settles in the darker joints first and keeps their darker tone, so the paving still shows through the snow
    float l = dot(alb, vec3(.3, .55, .15)), n = vnC(P.xz * 1.6) * .64 + vnC(P.xz * 5.2 + 3.) * .24 + vnC(P.xz * 14. + 7.) * .12;
    float e = 1. - uSnow * 1.25 + (1. - N.y) * .6 - (l < .24 ? .1 : 0.);
    // (the bright tone keeps a trace of the ground's own light and dark, so deep snow isn't a flat sheet)
    if (n > e) alb = n > e + .05 && l >= .24 ? vec3(.89, .92, .96) * clamp(.95 + (l - .32) * .35, .9, 1.) : vec3(.76, .81, .88);
  }
  if (uWet > 0. && (type == 1 || type == 2 || type == 5)) alb *= 1. - .17 * uWet;

  // ---- sun shadow, tinted toward the mood's shadow colour (the arena lays a tinted mask over the ground)
  float sh = 0.;
  // a cliff face turned away from the sun (plateau, ravine wall) is in SHADE, not in a cast shadow: the arena multiplies
  // its light by FACE_SHADE (.62 by day, .8 at night) instead of tinting it toward the shadow colour (too dark, too blue)
  bool faceAway = type == 5 && dot(N, uSunDir) < .03;
  if (uShadowA > 0. && !faceAway) {
    if (type == 2 && dot(N, uSunDir) < .08) sh = 0.;   // prop faces turned away: their ramp tone already shades them
    else if (uShadowOn > .5) {
      if (type == 4) sh = sunShadow(uPlayer + uSunDir * uPlayerSun, vec3(0.), .0006) * .75;
      else if (type != 3 && type != 7) sh = sunShadow(P, N, N0.w < .5 ? .00004 : .0006);   // obj 0: the terrain (casts nothing)   // cards would shadow themselves through their own sun card
    }
  }
  sh *= 1. - frD;
  alb = mix(alb, uShadowC, sh * uShadowA);

  // ---- light: ambient + pools (falloff (1 - t^2)^2, vertical distance weighted .25), the arena's soft knee
  vec3 pts = vec3(0.);
  bool shaped = type == 2 || type == 3 || type == 4 || type == 5 || type == 7;
  for (int i = 0; i < ${NL}; i++) {
    if (i >= uNL) break;
    vec3 lp = uLP[i].xyz, dv = P - lp; float r = uLP[i].w, dh = dv.y; dv.y = 0.;
    float t2 = (dot(dv, dv) + .0625 * dh * dh) / (r * r); if (t2 >= 1.) continue;
    float u = 1. - t2, f = u * u, shape = 1.;
    if (shaped && uLC[i].w < .5) shape = clamp(((dot(N, normalize(lp - P)) + .25) / 1.25) / .55, 0., 1.8);
    vec3 li = uLC[i].rgb * f * shape;
    // blocked by a wall / prop between (the character as one object, from its chest, like the sun shadow)
    if (uPtShadow > 0. && max(li.r, max(li.g, li.b)) > .004) li *= 1. - uPtShadow * ptBlock(type == 4 ? uPlayer : P + N * .1, lp);
    pts += li;
  }
  vec3 e = uAmb, L = e + pts;
  float m = max(L.r, max(L.g, L.b)), K = min(.97, max(.72, max(e.r, max(e.g, e.b))));
  if (m > K) {
    float y = (m - K) / (1. - K) * .5, m2 = K + (1. - K) * y / (1. + y);
    float a = m == L.r ? e.r : m == L.g ? e.g : e.b, l = m == L.r ? pts.r : m == L.g ? pts.g : pts.b;
    float sc = l > 1e-6 ? clamp((m2 - a) / l, 0., 1.) : 1.;
    L = min(e + pts * sc, vec3(1.));
  }
  // ---- form: the sun / moon shapes meshes and the character (wrapped N.L), snapped to 3 bands
  if (type == 2 || type == 4 || type == 7) {
    float w = (dot(N, uSunDir) + .35) / 1.35, s = 1. + uSunK * (1. - uFrS.x * frD) * (w - .55) * 1.5;
    if (uBanded > .5) s = s < .93 ? (type == 4 ? .84 : .92) : s > 1.07 ? 1.15 : 1.;
    else if (type != 4) s = max(s, .9);
    L *= s;
  }
  if (faceAway) L *= uShadowA > 0. ? .62 : .8;
  if (type == 4) { alb = mix(alb, clamp(alb * uGrade, 0., 1.), uGradeK); L += min(uFill, L * .25); }
  vec3 col = alb * L;
  col += alb * uFlashC;   // lightning: the whole scene lit for an instant (features/weather.js)
  vec3 emit = E0.rgb + rfE;
  if (uLayE > .5) emit += lay(tEmitL, ip).rgb;
  col += emit * max(vec3(1.) - L, vec3(uEmin)) * 1.15;                   // emitters add back what the light took away
  // ---- light on the water. Lanterns, mushrooms and wisps shine in it as thin shimmering vertical streaks and the sun twinkles on
  // it; all in view pixels and 12 steps a second, so it moves in whole pixels. A light h above the water is mirrored h below it
  // ON SCREEN (the oblique projection: heights count cos 20 px a metre, ground depth sin 55, as depth.js mirrors sprites), so the
  // streak starts under the light's foot at that distance and trails toward the camera. Clear at night, faint by day. (The sky
  // glint and the mirrored sprites are depth.js's, in the ground layer: these are light, which that can't do)
  if (water && uWRefl.x + uWRefl.y > 0.) {
    float wt = mod(floor(uWPhase * 12.), 997.), pm = uWPx.y;
    vec2 Fh = normalize(uView.xz), Rh = vec2(Fh.y, -Fh.x);
    vec3 wl = vec3(0.);
#ifdef CINE
    if (false) {   // (the streaks are where the OBLIQUE view mirrors a light)
#else
    if (uWRefl.x > 0.) {
#endif
      float night = clamp((1. - dot(uAmb, vec3(.3, .55, .15))) * 1.6, .2, 1.);
      for (int i = 0; i < ${NL}; i++) {
        if (i >= uNL) break; if (uLC[i].w > .5) continue;
        float h = uLP[i].y - P.y; if (h < .05) continue;
        vec2 d = P.xz - uLP[i].xz; float r = uLP[i].w, t2 = (dot(d, d) + .0625 * h * h) / (r * r); if (t2 >= 1.) continue;
        float pool = (1. - t2) * (1. - t2);   // glints: single texels of the light's pool flick on and off on the water (the pool is lit by the light pass)
        if (hC(floor(P.xz * uWPx.x) + vec2(float(i) * 5.3, wt) * 1.9 + 11.) > 1. - .006 * pool) wl += uLC[i].rgb * .5 * night;
        float dx = dot(d, Rh) * pm, dd = (dot(d, Fh) * .81915 - h * .93969) * pm;   // px right of the mirror image, px below it
        float wob = floor(hC(vec2(gl_FragCoord.y * .37 + float(i) * 3.1, wt)) * 3.) - 1., len = 8. + 7. * h, al = dd < 0. ? 1. + dd / 3. : 1. - dd / len;
        if (abs(dx - wob) > 1.2 || al <= 0.) continue;
        float v = al * pool * (.5 + .9 * hC(vec2(gl_FragCoord.y + float(i) * 17., wt + 31.)));
        wl += uLC[i].rgb * q3(v) * night;
      }
      wl *= uWRefl.x * .8;
    }
    if (uWRefl.y > 0. && uSunStr > 0.) {   // sparse twinkling texels, thicker where the sun mirrors toward the camera
      float spec = .35 + .65 * smoothstep(.5, 1., normalize(uSunDir + uView).y);
      if (hC(floor(P.xz * uWPx.x) + vec2(7.3, mod(floor(uWPhase * 10.), 89.)) * 1.7) > 1. - .0016 * uWRefl.y * spec) wl += uSunC * min(1., uSunStr) * .55;
    }
    col += wl;
  }
  // ---- shiny armour (the arena's armor.js shine, on the GPU): metal pixels of the character (E.w 2 steel / 1 gold) get a
  // quantised Blinn-Phong glint from every light and the sun, and reflect the sky (up) or the lit ground ~1.5 m away
  // (down), stronger at grazing angles (fresnel). Added on top of the light, like the arena's 'lighter'
  if (type == 4 && E0.w > .5) {
    vec3 tint = E0.w < 1.5 ? vec3(1., .82, .45) : vec3(.9, .95, 1.), V = uView, acc = vec3(0.);
    for (int i = 0; i < ${NL}; i++) {
      if (i >= uNL) break; if (uLC[i].w > .5) continue;
      vec3 d = uLP[i].xyz - P; float r = uLP[i].w, k = 1. - dot(d, d) / (r * r); if (k <= 0.) continue;
      float nh = max(0., dot(N, normalize(normalize(d) + V))), st = k * k * 1.8;
      acc += (q3(pow(nh, 30.) * st) * .9 + pow(nh, 6.) * st * .12) * uLC[i].rgb * tint;
    }
    if (uSunStr > 0.) { float nh = max(0., dot(N, normalize(uSunDir + V))); acc += (q3(pow(nh, 40.) * uSunStr) * .9 + pow(nh, 6.) * uSunStr * .12) * uSunC * tint; }
    vec3 R = reflect(-V, N), sky = uAmb * vec3(.55, .6, .72), env;
    if (R.y > .25) env = sky;
    else {   // the lit ground ~1.5 m along the reflected ray: the ambient + the pools there
      vec2 hz = R.xz; float hl = length(hz); vec3 G2 = vec3(P.x, 0., P.z) + vec3(hz.x, 0., hz.y) / max(hl, 1e-3) * 1.5 * min(1., hl), gl = uAmb;
      for (int i = 0; i < ${NL}; i++) {
        if (i >= uNL) break;
        vec3 dv = G2 - uLP[i].xyz; float r = uLP[i].w, dh = dv.y; dv.y = 0.; float t2 = (dot(dv, dv) + .0625 * dh * dh) / (r * r); if (t2 >= 1.) continue;
        float u = 1. - t2; gl += uLC[i].rgb * u * u;
      }
      vec3 gc = min(gl, vec3(1.6)) * .55; env = mix(gc, sky, R.y > 0. ? .5 : 0.);
    }
    acc += (.25 + .75 * pow(1. - max(0., dot(N, V)), 3.)) * .6 * env * tint;
    col += acc;
  }
  for (int i = 0; i < ${NL}; i++) {                                       // halos at the flames
    if (i >= uNH) break;
    vec2 dp = (vec2(ip0) + .5 - uHalo[i].xy); dp.y /= .9;
    float t2 = dot(dp, dp) / (uHalo[i].z * uHalo[i].z); if (t2 < 1.) { float u = 1. - t2; col += uHaloC[i] * u * u * uHalo[i].w; }
  }
#ifdef CINE
  {   // the cinema camera: the water mirrors the sky (more at a grazing look), the haze and the air by distance
    vec3 v = P - uCamP; float dist = length(v); v /= dist;
    if (water) col = mix(col, skyAt(reflect(v, vec3(0., 1., 0.))), .12 + .55 * pow(1. - clamp(-v.y, 0., 1.), 5.));
    col += uFog.rgb * uFog.a * clamp(dist / 22., .3, 1.6);
    col = mix(col, airAt(v), 1. - exp(-dist * uCine.w));
  }
#else
  if (uMist.x > .5) col = mistOver(col, P, pts, sh * uShadowA, N.y);      // the world's mist + the far haze by depth (MIST above)
  else col += uFog.rgb * uFog.a * (.4 + 1.2 * gl_FragCoord.y / uRes.y);  // haze, stronger toward the far (top) edge (?mist=0)
#endif
  // x-ray (the arena's look): where something hides the player, a dim fill with a light 1 px rim. Not where a particle
  // (obj -1) is in front: a dust mote or raindrop over him would otherwise be a lone rim pixel, a bright speck
  if (texelFetch(tX, ip, 0).r > .5 && type != 4 && N0.w > -.5) {
    bool rim = false;
    for (int k = 0; k < 4; k++) { ivec2 q = ip + ivec2(k == 0 ? -1 : k == 1 ? 1 : 0, k == 2 ? -1 : k == 3 ? 1 : 0); if (texelFetch(tX, q, 0).r < .5) rim = true; }
    col = rim ? mix(col, vec3(.937, .886, .769), .85) : mix(col, uXCol, .4);
  }
  col = post(col, ip0);

  if (uDebug == 1) col = a0.rgb;
  else if (uDebug == 2) col = N * .5 + .5;
  else if (uDebug == 3) col = vec3(fract(nearOf(d0) * .25));
  else if (uDebug == 4) col = vec3(fract(N0.w * .137), fract(N0.w * .311), fract(E0.w * .0731));
  else if (uDebug == 5) col = mix(vec3(.9), vec3(.1, .1, .3), sh);
  else if (uDebug == 6) col = L * .8;
  oc = vec4(clamp(col, 0., 1.), 1.);
}`;

// ---------------------------------------------------------------- the renderer
export function createGfx(canvas, {VW, VH, PPM, PPMY, PPMH, world}) {   // world: the world's bounds {x0, y0, x1, y1} (m; layout.WORLD)
  // (the drawing buffer is not kept between frames: keeping it costs a copy of the 3440 x 1440 back buffer each frame. Every
  // frame draws every pixel, and the captures read the canvas in the task that drew it; ?preserve=1 keeps it)
  const renderer = new THREE.WebGLRenderer({canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: flags.get('preserve') === '1'});
  const glStats = createGLStats(renderer.getContext());   // (what a frame asks of WebGL, counted while the profiler shows it)
  renderer.setPixelRatio(1); renderer.setSize(VW, VH, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // the arena does its maths on sRGB numbers: so do we
  renderer.autoClear = false;

  const near = THREE.NearestFilter;
  const gbuf = new THREE.WebGLRenderTarget(VW, VH, {count: 3, type: THREE.HalfFloatType, minFilter: near, magFilter: near, depthBuffer: true,
    depthTexture: new THREE.DepthTexture(VW, VH, THREE.UnsignedIntType)});
  const xray = new THREE.WebGLRenderTarget(VW, VH, {minFilter: near, magFilter: near, depthBuffer: false});
  const SM = 2048, SHADOW_E = 22;
  const shadow = new THREE.WebGLRenderTarget(SM, SM, {minFilter: near, magFilter: near, depthBuffer: true,
    depthTexture: new THREE.DepthTexture(SM, SM, THREE.UnsignedIntType)});

  // point-light occlusion: the solid 3D things (live meshes, the plateau; not cards) seen from straight above, as depth.
  // Covers the world (its bounds) + 2 m. Re-rendered only when one of them moved, appeared or vanished.
  const HM = {x0: world.x0 - 2, z0: world.y0 - 2, w: world.x1 - world.x0 + 4, d: world.y1 - world.y0 + 4, ppm: 16, top: 20, far: 30};
  const hmap = new THREE.WebGLRenderTarget(HM.w * HM.ppm, HM.d * HM.ppm, {minFilter: near, magFilter: near, depthBuffer: true,
    depthTexture: new THREE.DepthTexture(HM.w * HM.ppm, HM.d * HM.ppm, THREE.UnsignedIntType)});
  const hCam = new THREE.OrthographicCamera(-HM.w / 2, HM.w / 2, HM.d / 2, -HM.d / 2, 0, HM.far);
  hCam.position.set(HM.x0 + HM.w / 2, HM.top, HM.z0 + HM.d / 2); hCam.up.set(0, 0, -1); hCam.lookAt(HM.x0 + HM.w / 2, 0, HM.z0 + HM.d / 2);
  hCam.layers.set(1); hCam.updateMatrixWorld(true);   // layer 1: the casters of the height map
  let hDirty = true;

  const gScene = new THREE.Scene(), sScene = new THREE.Scene(), xScene = new THREE.Scene();
  // sStatic: the casters of the cached static sun shadow (+ the height map), out of sScene so the per-frame shadow pass doesn't
  // walk ~200 objects it never draws; a static caster that starts moving goes over to sScene until it is still again
  const sStatic = new THREE.Scene(); sStatic.matrixAutoUpdate = false;
  gScene.matrixWorldAutoUpdate = sScene.matrixWorldAutoUpdate = xScene.matrixWorldAutoUpdate = true;
  // a Scene's own matrixAutoUpdate (three's default) re-flags it on every render and forces EVERY child's world matrix to be
  // recomputed in every pass (~760 objects x 3+ passes a frame: 4% of the frame's JS). Off: an object's world matrix is
  // recomputed only when it was flagged (matrixWorldNeedsUpdate: setMatrix, syncCards, a new mesh) or it updates itself
  gScene.matrixAutoUpdate = sScene.matrixAutoUpdate = xScene.matrixAutoUpdate = false;
  const camera = new THREE.Camera();
  // the GAME's view (setView's oblique projection, whatever is drawn): what the sim reads the screen through (gameToScreen:
  // the cursor's aim, the lasso's pick), so a cinema camera never changes what the game does
  const gcam = new THREE.Camera();
  // THE CINEMA CAMERA (features/cinema.js: setCine): for the frames it is set, the same passes draw the scene through a free
  // PERSPECTIVE camera instead of the oblique view (at the art's resolution: still pixels). CINE is the shaders' uCine
  const CINE = {value: new THREE.Vector4(0, .15, 400, 0)}, cinePC = new THREE.PerspectiveCamera(40, 16 / 9, .15, 400);
  let cine = null;
  // the materials with `#ifdef CINE` code (cineMat): the cinema camera's own program variant, switched as setCine turns it on
  // or off (behind its fade). The oblique view's program is the old text exactly, so a GPU compiler's reorderings of the
  // cinema branches never reach the game's pixels. A moving perspective view has no pixel lattice: its variants snap no
  // sprite's anchor and step no crown's sway by whole pixels (each would hop against the world round it: a bounce)
  const cineMats = new Set();
  const setDef = (m, on) => { if (on === ('CINE' in m.defines)) return; if (on) m.defines.CINE = ''; else delete m.defines.CINE; m.needsUpdate = true; };
  function cineMat(m) {
    if (cineMats.has(m)) return m;
    m.defines ??= {}; cineMats.add(m); setDef(m, !!cine); m.addEventListener('dispose', () => cineMats.delete(m));
    return m;
  }
  const sunCam = new THREE.OrthographicCamera(-SHADOW_E, SHADOW_E, SHADOW_E, -SHADOW_E, 1, 220);
  // STATIC SUN SHADOW: what doesn't move (world props made with mesh(..., {static: true}), the terrain: sStatic, layer 2,
  // not 0) is drawn into a world-wide map that is re-rendered only when one of them appears / goes / changes model or
  // starts / stops moving, or the sun has turned > SUN_STEP (the clock turns it ~.3 deg/s). The per-frame map round the view
  // (sunCam, layer 0) then holds only what moves: characters, cards, swaying trees, debris. A static prop that moves (a
  // hit wobble, a push, burning) casts into the per-frame map until it has been still STILL_FRAMES. ~180 -> ~55 shadow
  // draws a frame. ?sshadow=0 puts everything back in the per-frame map (A/B)
  const STATIC_SHADOW = flags.get('sshadow') !== '0';
  const SMS = 4096, SUN_STEP = .15 * DEG, STILL_FRAMES = 45;
  // the static map's box (m): the world + its skirt while that is at most SFIT m a side (~50 texels / m: the Proving Grounds'
  // 74 x 42 m); a bigger world gets a box 2 SFOLLOW m a side round the view instead, re-centred on an SSTEP m lattice as the view
  // moves on (a re-render each time; the view shows at most ~40 x 20 m, so the box holds it plus the long shadows cast into
  // it: ~43 texels / m), its texel grid kept still in light space so the shadows don't shimmer at a re-centre
  const SWORLD = [world.x0 - 6, world.x1 + 6, -4, 9, world.y0 - 6, world.y1 + 6], SFIT = 100, SFOLLOW = 32, SSTEP = 8;
  const sFollow = SWORLD[1] - SWORLD[0] > SFIT || SWORLD[5] - SWORLD[4] > SFIT, SBOX = SWORLD.slice();
  let sCx = NaN, sCz = NaN;   // the follow box's centre (its lattice point)
  const shadowS = new THREE.WebGLRenderTarget(SMS, SMS, {minFilter: near, magFilter: near, depthBuffer: true, format: THREE.RedFormat,
    depthTexture: new THREE.DepthTexture(SMS, SMS, THREE.UnsignedIntType)});
  const sunCamS = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2); sunCamS.layers.set(2);
  let sDue = 0;   // the frame by which the static map must be re-rendered (Infinity: it's up to date)
  const staticSoon = frames => { sDue = Math.min(sDue, frameNo + frames); };
  // sCast: the sun as BOTH maps cast, turned in steps of SUN_STEP (setSun); sDir: the one the static map was drawn along
  const sDir = new THREE.Vector3(0, 2, 0), sunNow = new THREE.Vector3(0, 1, 0), sCast = new THREE.Vector3(), _sc = new THREE.Vector3(), _scR = new THREE.Vector3(), _scU = new THREE.Vector3(), movers = new Set();
  function fitStatic(d) {   // look along the sun at the world's centre; the ortho box = the world's 8 corners in light space
    const cx = (SBOX[0] + SBOX[1]) / 2, cy = (SBOX[2] + SBOX[3]) / 2, cz = (SBOX[4] + SBOX[5]) / 2;
    sunCamS.position.set(cx, cy, cz).addScaledVector(d, 100); sunCamS.lookAt(cx, cy, cz); sunCamS.updateMatrixWorld(true);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < 8; i++) {
      _sc.set(SBOX[i & 1], SBOX[2 + (i >> 1 & 1)], SBOX[4 + (i >> 2 & 1)]).applyMatrix4(sunCamS.matrixWorldInverse);
      x0 = Math.min(x0, _sc.x); x1 = Math.max(x1, _sc.x); y0 = Math.min(y0, _sc.y); y1 = Math.max(y1, _sc.y); z0 = Math.min(z0, _sc.z); z1 = Math.max(z1, _sc.z);
    }
    Object.assign(sunCamS, {left: x0, right: x1, top: y1, bottom: y0, near: -z1 - 1, far: -z0 + 1}); sunCamS.updateProjectionMatrix();
    if (sFollow) {   // a follow box: the world's origin on a texel corner, so a re-centred box keeps the same texel grid
      const tx = (x1 - x0) / SMS, ty = (y1 - y0) / SMS, o = _sc.set(0, 0, 0).applyMatrix4(sunCamS.matrixWorldInverse);
      const dx = o.x - Math.round(o.x / tx) * tx, dy = o.y - Math.round(o.y / ty) * ty;
      sunCamS.position.addScaledVector(_scR.setFromMatrixColumn(sunCamS.matrixWorld, 0), dx).addScaledVector(_scU.setFromMatrixColumn(sunCamS.matrixWorld, 1), dy);
      sunCamS.updateMatrixWorld(true);
    }
    compU.uLightPVS.value.multiplyMatrices(sunCamS.projectionMatrix, sunCamS.matrixWorldInverse);
    compU.uSBias.value = (sunCam.far - sunCam.near) / (sunCamS.far - sunCamS.near);   // the same metres of bias in its depth units
  }

  // shared uniforms (one object, referenced by every material that needs it)
  const U = {
    camYaw: {value: 0}, sunYaw: {value: 0}, px: {value: new THREE.Vector2(PPM, PPMH)},
    lArt: {value: new THREE.Vector3(-.55, .775, .314).normalize()},   // the pixelizer's top-left light, world-fixed
    ramps: {value: null}, cover: {value: new THREE.Vector3(0, .86, 0)}, emitFam: {value: new THREE.Vector2(-1, -1)},
    smooth: {value: 0},
    leanX: {value: new THREE.Vector3(1 / PPM, 0, 0)}, leanY: {value: new THREE.Vector3(0, 0, 1 / PPMY)},   // sway: m per art px (setView)
    time: {value: 0},   // s, for the leaves' flutter (render())
    leafK: {value: 1},  // how full the crowns are this season (features/weather.js from sim/env.js leafK)
    autumn: {value: 0}, // how far autumn has turned the leaves, 0 green .. 1 (setGround, from sim/env.js autumn): shaders colour leaves by it
    litK: {value: new THREE.Vector4()},   // the fallen leaves: x how much has fallen (0 = none), y how far they have turned (setGround; SURF_FS)
    decalT: {value: null}, decalOn: {value: 0}, decalRect: {value: new THREE.Vector4()}, decalPx: {value: new THREE.Vector2(1, 1)},   // setGroundDecals (SURF_FS)
    // the moving water (setWaterLook at every build, the clock in render()): see WATER_FS
    wPhase: {value: 0}, wA: {value: new THREE.Vector4(0, 3, 12, -1)}, wB: {value: new THREE.Vector4(.8, .76, 0, 2)}, wRamp: {value: Array.from({length: 4}, () => new THREE.Vector3())},
    // its depth, bed and contact foam (setWaterLook's bed: world/waterbed.js; the feet: setPlayer): see WATER_FS wDeep
    wBed: {value: null}, wBedOn: {value: 0}, wBedR: {value: new THREE.Vector4(0, 0, 1, 1)}, wCut: {value: new THREE.Vector4(.13, .33, .6, 2)},
    wOp: {value: new THREE.Vector4(1, 1, 1, 1)}, wTone: {value: new THREE.Vector4(1, 1, 2, 2)}, wLook: {value: new THREE.Vector4(.86, 0, 0, 0)},
    wTint: {value: new THREE.Vector3(1, 1, 1)}, wFoam: {value: new THREE.Vector3(1, 1, 1)}, wFoot: {value: new THREE.Vector4()},
  };
  const raw = (vs, fs, uniforms, extra = {}) => {
    const m = new THREE.RawShaderMaterial({vertexShader: vs, fragmentShader: fs, uniforms, glslVersion: THREE.GLSL3, ...extra});
    return vs.includes('#ifdef CINE') || fs.includes('#ifdef CINE') ? cineMat(m) : m;   // (its cinema variant follows setCine)
  };

  // ---- textures: one per source image (canvas / Image / ImageBitmap), nearest, no colour management.
  // dynamic: a live canvas, re-uploaded at most once per frame. Give the canvas a `version` number (bump it whenever you
  // repaint it) and it is re-uploaded only when that changed: a flame painted at 12 fps uploads 12 times a second, not 165
  const texCache = new WeakMap();
  function tex(img, {linear = false, dynamic = false} = {}) {
    let t = texCache.get(img);
    if (!t || t.__lin !== linear) {
      t = img instanceof HTMLCanvasElement ? new THREE.CanvasTexture(img) : new THREE.Texture(img);
      t.flipY = false; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.premultiplyAlpha = false;
      t.minFilter = t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; t.__lin = linear; t.__frame = -1;
      texCache.set(img, t);
    } else if (dynamic && t.__frame !== frameNo && (img.version === undefined || img.version !== t.__ver)) { t.needsUpdate = true; t.__frame = frameNo; t.__ver = img.version; ups.push(t); }
    return t;
  }
  let frameNo = 0;
  const ups = [];   // textures re-uploaded this frame (render() uploads them first, timed as stats.pass.upload)
  // ---- DATA UPLOADS (G.texData): a block of RGBA bytes the caller rasterised in its own array, into part of a canvas's
  // texture (the one tex(img) shows; made here if it isn't yet), at render, by texSubImage2D from the array: no 2D canvas
  // between (a canvas -> WebGL copy snapshots the whole canvas, and a GPU canvas's waits on the GPU). (x, y): where in the
  // canvas (px, y down); the block is data's (sx, sy, w, h), rows rowLen px apart; data must hold still till render()
  const dataUps = [];
  let dataN = 0;
  function texData(img, x, y, w, h, data, rowLen, sx = 0, sy = 0) {
    const t = img.isData ? imgTex(img) : texCache.get(img) || tex(img), U = dataUps[dataN] ||= {t: null, x: 0, y: 0, w: 0, h: 0, data: null, rowLen: 0, sx: 0, sy: 0};
    dataN++; U.t = t; U.x = x; U.y = y; U.w = w; U.h = h; U.data = data; U.rowLen = rowLen; U.sx = sx; U.sy = sy;
  }
  function uploadData() {   // (render: with the other uploads, before any pass reads them)
    if (!dataN) return;
    const gl = renderer.getContext();
    let bound = null;
    for (let i = 0; i < dataN; i++) {
      const U = dataUps[i];
      if (bound !== U.t) {
        let p = renderer.properties.get(U.t);
        if (!p.__webglTexture) { renderer.initTexture(U.t); p = renderer.properties.get(U.t); }   // (its first upload: the whole canvas, then the block over it)
        renderer.state.bindTexture(gl.TEXTURE_2D, p.__webglTexture); bound = U.t;
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);   // (as tex() uploads it)
      }
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, U.rowLen); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, U.sx); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, U.sy);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, U.x, U.y, U.w, U.h, gl.RGBA, gl.UNSIGNED_BYTE, U.data);
      U.data = null;
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); renderer.state.unbindTexture();   // (three never sets these: back to 0)
    dataN = 0;
  }

  // ---- materials
  const MESH_VS = meshVS(false), MESH_SWAY_VS = meshVS(true);
  // a tree's autumn ramps (trees3d.js B.autumn: 4 stages x 3 tones of '#rrggbb') as the shader's uAut: shared by every tree of a species
  const autVecs = new WeakMap(), AUT_NONE = Array.from({length: 12}, () => new THREE.Vector3());
  const autOf = pal => {
    let v = autVecs.get(pal);
    if (!v) {   // (the ramps are raw sRGB bytes, no colour management: parse the hex ourselves)
      v = AUT_NONE.map((_, i) => { const h = pal[Math.floor(i / 3)]?.[i % 3] || '#000000'; return new THREE.Vector3(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255); });
      autVecs.set(pal, v);
    }
    return v;
  };
  const meshMat = (obj, seed, sw = null, aut = null) => raw(sw ? MESH_SWAY_VS : MESH_VS, MESH_FS, {uRamps: U.ramps, uLArt: U.lArt, uObj: {value: obj}, uFlash: {value: 0}, uSeed: {value: seed}, uCover: U.cover, uEmitFam: U.emitFam, uBurn: {value: new THREE.Vector4()},
    uRip: {value: new THREE.Vector4()}, uLeafK: U.leafK, uAutumn: U.autumn, uAut: {value: aut ? autOf(aut) : AUT_NONE}, uAutOn: {value: aut ? 1 : 0}, ...(sw ? {uLean: sw.lean, uFlut: sw.flut, uLeanX: U.leanX, uLeanY: U.leanY, uTime: U.time} : {})},
    sw ? {side: THREE.DoubleSide} : {});   // (a thinned crown shows its clumps' inside: MESH_FS)
  const shadowMeshMat = raw(SHADOW_MESH_VS, SHADOW_FS, {});
  const surfMat = ({tex, em = null, planar, world, origin = null, type = 1, obj = 0, cliff = null, cliffOff = 0, water = null, litter = null, decals = false, cliffTop = 1e9}) => raw(SURF_VS, SURF_FS, {
    uCliffTop: {value: cliffTop},
    uDecal: U.decalT, uHasDecal: {value: decals ? 1 : 0}, uDecalOn: U.decalOn, uDecalRect: U.decalRect, uDecalPx: U.decalPx,
    uLit: litter?.u || {value: null}, uLitPal: {value: litter?.pal || null}, uHasLit: {value: litter ? 1 : 0}, uLitK: U.litK, uLive: litter?.live || {value: 0}, uLitCap: litter?.cap || {value: 1},
    uTex: {value: tex}, uEm: {value: em}, uHasEm: {value: em ? 1 : 0}, uTexSize: {value: new THREE.Vector2(tex.image.width, tex.image.height)},
    uSmooth: U.smooth, uType: {value: type}, uObj: {value: obj}, uPlanar: {value: planar ? 1 : 0}, uWorld: {value: world || new THREE.Vector2(1, 1)}, uOrigin: {value: origin || new THREE.Vector2(0, 0)},
    uCliff: {value: cliff}, uHasCliff: {value: cliff ? 1 : 0}, uCliffOff: {value: cliffOff}, uPx: U.px,
    uCliffSize: {value: new THREE.Vector2(cliff?.image.width || 1, cliff?.image.height || 1)},
    uWater: {value: water}, uHasWater: {value: water ? 1 : 0}, uWPhase: U.wPhase, uWA: U.wA, uWB: U.wB, uWRamp: U.wRamp,
    uWBed: U.wBed, uWBedOn: U.wBedOn, uWBedR: U.wBedR, uWCut: U.wCut, uWOp: U.wOp, uWTone: U.wTone, uWLook: U.wLook, uWTint: U.wTint, uWFoam: U.wFoam, uWFoot: U.wFoot}, {side: THREE.FrontSide});
  const SNAP = {value: new THREE.Vector2(VW, VH)}, NOSNAP = {value: new THREE.Vector2(0, 0)};
  // a plant's autumn (CARD_FS): {kind, seed, delay, ramp: [[r, g, b] x 4] (the card's own green ramp, light -> dark), pal: [[r, g, b] x 32]
  // (4 stages x 4 tones, then the second path's)}, or nothing: no plant, no cost beyond the uniform test
  const v3s = a => a.map(c => new THREE.Vector3(...c));
  const PLANT0 = {uAutumn: U.autumn, uPlant: {value: new THREE.Vector4()}, uPRamp: {value: v3s(Array(4).fill([0, 0, 0]))}, uPPal: {value: v3s(Array(32).fill([0, 0, 0]))}};
  const plantU = pl => !pl ? PLANT0 : {uAutumn: U.autumn, uPlant: {value: new THREE.Vector4(pl.kind, pl.seed, pl.delay, 0)}, uPRamp: {value: v3s(pl.ramp)}, uPPal: {value: v3s(pl.pal)}};
  const cardUniforms = o => ({
    uAnchor: {value: new THREE.Vector3()}, uSize: {value: new THREE.Vector2(o.w, o.h)}, uPivot: {value: new THREE.Vector2(o.px, o.py)},
    uPx: U.px, uRect: {value: new THREE.Vector4(0, 0, 1, 1)}, uTex: {value: o.tex}, uBias: {value: o.bias ?? 0}, uSnap: SNAP,
    uOff: {value: new THREE.Vector2()}, uSway: new NumU(0), uHasBend: {value: 0},
  });
  // three.js works out an instanced geometry's instance limit once, the first time it is drawn (geometry._maxInstanceCount,
  // from its instance buffer's size), and never again: a batch that swaps in a bigger buffer later must clear it, or the
  // instances past the old size are silently not drawn (a horde's 33rd brute of one facing went missing)
  const regrown = geo => { geo._maxInstanceCount = undefined; };
  // one update range on a buffer (attribute or interleaved), in a {start, count} kept on it: three's addUpdateRange makes a
  // new one every call (one a batch a frame); three empties the list after the upload
  // (and cleared by pop: `length = 0`, as three's clearUpdateRanges does after each upload, frees the array's store, and
  // the next push allocates a new one)
  function popRanges() { const u = this.updateRanges; while (u.length) u.pop(); }
  const setRange = (a, start, count) => {
    let r = a.__range; if (!r) { r = a.__range = {start: 0, count: 0}; a.clearUpdateRanges = popRanges; }
    r.start = start; r.count = count; a.clearUpdateRanges(); a.updateRanges.push(r); a.needsUpdate = true;
  };
  const QUAD = new THREE.BufferGeometry();
  QUAD.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3));

  // a billboard: {tex, w, h, px, py, em?, nrm?, nrmRect?, rect?, type (3 | 4), obj, bias, shadow (cast), xray, plant (see plantU)}
  // The vertex shader places it from uAnchor, so the mesh's matrix is free: render() sets it to the anchor and the card's
  // own geometry (the shared quad + a bounding sphere sized from uSize / uPivot / sway) lets three skip cards off screen.
  // Geometries are pooled: disposing one would delete the shared quad's GL buffer
  const cards = new Set(), cardGeoPool = [];
  function cardGeo() {
    const g = cardGeoPool.pop() || new THREE.BufferGeometry();
    if (!g.attributes.position) { g.setAttribute('position', QUAD.getAttribute('position')); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1); }
    return g;
  }
  function syncCards() {
    for (const C of cards) {
      if (!C.gm.visible) continue;   // (synced when it shows again: before the passes of that frame)
      const u = C.u, a = u.uAnchor.value, s = u.uSize.value, pv = u.uPivot.value, off = u.uOff.value, sw = Math.abs(u.uSway.value);
      if (a.x !== C.ax || a.y !== C.ay || a.z !== C.az) {
        C.ax = a.x; C.ay = a.y; C.az = a.z;
        for (const m of C.meshes) { m.matrix.makeTranslation(a.x, a.y, a.z); m.matrixWorldNeedsUpdate = true; }
      }
      const hx = (Math.max(pv.x, s.x - pv.x) + sw + Math.abs(off.x) + 2) / PPM, hy = (s.y / 2 + Math.abs(off.y) + 2) / PPMH;
      const bs = C.geo.boundingSphere; bs.center.set(0, (pv.y - s.y / 2 + off.y) / PPMH, 0); bs.radius = hypot2(hx, hy) + .25;
    }
  }
  function card(o) {
    if (o.batch && CARD_BATCH && (o.type ?? 3) === 3 && !o.nrm && !o.xray && !o.rect) return bcard(o);   // a world card: in a batch (below)
    const u = cardUniforms(o), geo = cardGeo();
    const g = raw(CARD_VS, CARD_FS, {...u, uFaceYaw: U.camYaw, uCamYaw: U.camYaw, uNrm: {value: o.nrm || null}, uHasNrm: {value: o.nrm ? 1 : 0},
      uNrmRect: {value: o.nrmRect || new THREE.Vector4(0, 0, 1, 1)}, uEm: {value: o.em || null}, uHasEm: {value: o.em ? 1 : 0},
      uType: {value: o.type ?? 3}, uObj: {value: o.obj ?? 0}, uFlash: {value: 0}, uBend: {value: new Float32Array(8).fill(1)},
      uMetal: {value: null}, uHasMetal: {value: 0}, ...plantU(o.plant)}, {side: THREE.DoubleSide});
    const gm = new THREE.Mesh(geo, g); gScene.add(gm);
    let sm = null, xm = null;
    if (o.shadow !== false) {
      sm = new THREE.Mesh(geo, raw(CARD_VS, SHADOW_CARD_FS, {...u, uBias: {value: 0}, uSnap: NOSNAP, uFaceYaw: U.sunYaw, uCamYaw: U.camYaw, uHasBend: {value: 0}}, {side: THREE.DoubleSide}));
      sScene.add(sm);
    }
    if (o.xray) {
      xm = new THREE.Mesh(geo, raw(CARD_VS, XRAY_FS, {...u, uFaceYaw: U.camYaw, uCamYaw: U.camYaw, uDepth: {value: gbuf.depthTexture}}, {side: THREE.DoubleSide, depthTest: false, depthWrite: false}));
      xScene.add(xm);
    }
    const meshes = [gm, sm, xm].filter(Boolean);
    for (const m of meshes) m.matrixAutoUpdate = false;
    const C = {u, g, gm, sm, xm, geo, meshes, ax: NaN, ay: NaN, az: NaN,
      set anchor(v) { u.uAnchor.value.copy(v); },
      set flash(k) { g.uniforms.uFlash.value = k; },            // 0..1: hit flash / hover pulse (white, glowing)
      setVisible(v) { gm.visible = v; if (sm) sm.visible = v; if (xm) xm.visible = v; },
      // swap the picture: {tex, w, h, px, py, em?} (a breakable's stage, a brute turning)
      setSprite(s) { u.uTex.value = s.tex; u.uSize.value.set(s.w, s.h); u.uPivot.value.set(s.px, s.py); g.uniforms.uEm.value = s.em || null; g.uniforms.uHasEm.value = s.em ? 1 : 0; },
      dispose() { gScene.remove(gm); if (sm) sScene.remove(sm); if (xm) xScene.remove(xm); g.dispose(); sm?.material.dispose(); xm?.material.dispose(); cards.delete(C); cardGeoPool.push(geo); },
    };
    cards.add(C);
    return C;
  }

  // ---- WORLD CARDS IN BATCHES (stage 3; BCARD_VS / BCARD_FS): card({batch: true}) returns the API world.js drives (u.*,
  // g.uniforms.*, anchor, flash, setVisible, setSprite, dispose) as plain values, no mesh or material of its own. render() packs
  // every visible one into its group's instance buffers (a group: texture x emit texture x casts a shadow) and draws each group
  // once in the G-buffer and once in the sun's shadow: three's per-draw cost (~8 µs) went per card per pass before, and 60
  // brutes were 120 draws. No per-card frustum test: an off-screen instance costs a vertex shader, not a draw. ?cards=0: a mesh
  // each (the A/B)
  const CARD_BATCH = flags.get('cards') !== '0';
  const bcards = new Set(), bGroups = new Map(), BC_ATTRS = ['iA', 'iS', 'iO', 'iB0', 'iB1', 'iM', 'iP'], BC_STRIDE = 28, BEND1 = new Float32Array(8).fill(1);
  // the plants' palettes (CARD_FS uPRamp / uPPal): one row of 36 RGBA float texels per plant path pair (4 green ramp tones, then
  // the 32 tones of its two paths), the same floats the uniforms held; the texture grows a row as a new pair turns up (at a build)
  const palRows = new Map(); let palData = new Float32Array(36 * 4), palN = 0;
  const palTex = new THREE.DataTexture(palData, 36, 1, THREE.RGBAFormat, THREE.FloatType), palU = {value: palTex};
  palTex.minFilter = palTex.magFilter = THREE.NearestFilter; palTex.generateMipmaps = false; palTex.needsUpdate = true;
  function palRow(pl) {
    let m = palRows.get(pl.pal); if (!m) palRows.set(pl.pal, m = new Map());
    const rk = pl.ramp.map(c => c.join()).join('|'); let r = m.get(rk); if (r !== undefined) return r;
    r = palN++; m.set(rk, r);
    if (palN * 36 * 4 > palData.length) { const d = new Float32Array(palData.length * 2); d.set(palData); palData = d; }
    const o = r * 36 * 4, put = (c, i) => { palData[o + i * 4] = c[0]; palData[o + i * 4 + 1] = c[1]; palData[o + i * 4 + 2] = c[2]; palData[o + i * 4 + 3] = 1; };
    pl.ramp.forEach((c, i) => put(c, i)); pl.pal.forEach((c, i) => put(c, 4 + i));
    palTex.dispose(); palTex.image = {data: palData, width: 36, height: palData.length / (36 * 4)}; palTex.needsUpdate = true;
    return r;
  }
  function bcard(o) {
    const u = {uAnchor: {value: new THREE.Vector3()}, uSize: {value: new THREE.Vector2(o.w, o.h)}, uPivot: {value: new THREE.Vector2(o.px, o.py)},
      uTex: {value: o.tex}, uBias: {value: o.bias ?? 0}, uOff: {value: new THREE.Vector2()}, uSway: new NumU(0), uHasBend: {value: 0}};
    const gu = {uBend: {value: BEND1}, uEm: {value: o.em || null}, uHasEm: {value: o.em ? 1 : 0}, uFlash: {value: 0}, uObj: {value: o.obj ?? 0}};
    const pl = o.plant, plant = pl ? [pl.kind, pl.seed, pl.delay, palRow(pl)] : [0, 0, 0, 0];
    const C = {u, g: {uniforms: gu}, shadow: o.shadow !== false, plant, vis: true, grp: null, gTex: null, gEm: null,   // grp: its group while its textures stay
      set anchor(v) { u.uAnchor.value.copy(v); },
      set flash(k) { gu.uFlash.value = k; },
      setVisible(v) { C.vis = !!v; },
      setSprite(s) { u.uTex.value = s.tex; u.uSize.value.set(s.w, s.h); u.uPivot.value.set(s.px, s.py); gu.uEm.value = s.em || null; gu.uHasEm.value = s.em ? 1 : 0; },
      dispose() { bcards.delete(C); },
    };
    bcards.add(C);
    return C;
  }
  function bGroup(key, tex, em, shadow) {
    let G2 = bGroups.get(key); if (G2) return G2;
    const cap = 32, geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', QUAD.getAttribute('position'));   // (never dispose it with the quad's attribute on: shared GL buffer)
    const ib = bBuffer(geo, new Float32Array(cap * BC_STRIDE));
    const uni = {uTex: {value: tex}, uEm: {value: em}, uHasEm: {value: em ? 1 : 0}, uType: {value: 3}, uFaceYaw: U.camYaw, uCamYaw: U.camYaw, uPx: U.px, uSnap: SNAP,
      uShadow: {value: 0}, uAutumn: U.autumn, uPal: palU};
    const gm = new THREE.Mesh(geo, raw(BCARD_VS, BCARD_FS, uni, {side: THREE.DoubleSide})); gm.frustumCulled = false; gm.matrixAutoUpdate = false; gScene.add(gm);
    let sm = null;
    if (shadow) {
      sm = new THREE.Mesh(geo, raw(BCARD_VS, BCARD_SHADOW_FS, {uTex: uni.uTex, uFaceYaw: U.sunYaw, uCamYaw: U.camYaw, uPx: U.px, uSnap: NOSNAP, uShadow: {value: 1}}, {side: THREE.DoubleSide}));
      sm.frustumCulled = false; sm.matrixAutoUpdate = false; sScene.add(sm);
    }
    G2 = {geo, ib, d: ib.array, gm, sm, cap, n: 0, n0: 0, dirty: true, idle: 0}; bGroups.set(key, G2);
    return G2;
  }
  // the group's instances, interleaved (28 floats each: iA iS iO iB0 iB1 iM iP), one buffer and one upload
  function bBuffer(geo, data) {
    const ib = new THREE.InstancedInterleavedBuffer(data, BC_STRIDE, 1); ib.setUsage(THREE.DynamicDrawUsage);
    BC_ATTRS.forEach((k, i) => geo.setAttribute(k, new THREE.InterleavedBufferAttribute(ib, 4, i * 4)));
    return ib;
  }
  function bGrow(G2) {
    const cap = G2.cap * 2, d = new Float32Array(cap * BC_STRIDE); d.set(G2.d);
    G2.ib = bBuffer(G2.geo, d); G2.d = d; G2.cap = cap; G2.dirty = true; regrown(G2.geo);
  }
  const bPut = (G2, i, v) => { const f = Math.fround(v); if (G2.d[i] !== f) { G2.d[i] = f; G2.dirty = true; } };   // (a write that changes something)
  function packCards() {   // every frame: the visible batched cards into their groups (in the order they were made)
    for (const G2 of bGroups.values()) G2.n = 0;
    for (const C of bcards) {
      if (!C.vis) continue;
      const u = C.u, g = C.g.uniforms, tex = u.uTex.value, em = g.uHasEm.value > .5 ? g.uEm.value : null;
      let G2 = C.grp;
      if (!G2 || G2.dead || C.gTex !== tex || C.gEm !== em) {   // (looked up again only when its textures change: no key a card a frame)
        const a0 = idOf(tex), e0 = idOf(em), s0 = C.shadow ? 1 : 0;
        const key = a0 < 1048576 && e0 < 1048576 ? (a0 * 1048576 + e0) * 2 + s0 : `${a0}|${e0}|${s0}`;
        G2 = C.grp = bGroup(key, tex, em, C.shadow); C.gTex = tex; C.gEm = em;
      }
      if (G2.n >= G2.cap) bGrow(G2);
      const i = G2.n++ * BC_STRIDE, an = u.uAnchor.value, s = u.uSize.value, pv = u.uPivot.value, off = u.uOff.value, b = g.uBend.value, pl = C.plant;
      bPut(G2, i, an.x); bPut(G2, i + 1, an.y); bPut(G2, i + 2, an.z); bPut(G2, i + 3, u.uBias.value);
      bPut(G2, i + 4, s.x); bPut(G2, i + 5, s.y); bPut(G2, i + 6, pv.x); bPut(G2, i + 7, pv.y);
      bPut(G2, i + 8, off.x); bPut(G2, i + 9, off.y); bPut(G2, i + 10, u.uSway.value); bPut(G2, i + 11, u.uHasBend.value);
      for (let k = 0; k < 8; k++) bPut(G2, i + 12 + k, b[k]);
      bPut(G2, i + 20, g.uFlash.value); bPut(G2, i + 21, g.uObj.value); bPut(G2, i + 22, pl[0]); bPut(G2, i + 23, pl[1]);
      bPut(G2, i + 24, pl[2]); bPut(G2, i + 25, pl[3]);
    }
    for (const [key, G2] of bGroups) {
      G2.geo.instanceCount = G2.n; G2.gm.visible = G2.n > 0; if (G2.sm) G2.sm.visible = G2.n > 0;
      if (G2.n && (G2.dirty || G2.n > G2.n0)) setRange(G2.ib, 0, G2.n * BC_STRIDE);
      G2.dirty = false; G2.n0 = G2.n;
      if (G2.n === 0 && ++G2.idle > 600) {   // (a texture nobody shows any more: its group goes)
        gScene.remove(G2.gm); if (G2.sm) sScene.remove(G2.sm); G2.gm.material.dispose(); G2.sm?.material.dispose(); G2.geo.deleteAttribute('position'); G2.geo.dispose(); bGroups.delete(key); G2.dead = true;
      } else if (G2.n) G2.idle = 0;
    }
  }
  // a live ramp mesh (+ its shadow caster). setMatrix moves both; setGeometry swaps the model (a breakable's stage).
  // o.sway: the geometry has aFlex and the mesh leans (setLean(x, y): art px at full weight, x along the screen, y toward
  // the camera; whole pixels per vertex in the shader, its shadow leans with it). o.autumn: the tree's autumn ramps (trees3d.js
  // B.autumn, [s1..s4] x ['#hi', '#base', '#shade']): its leaves turn, spray by spray, with U.autumn (core/autumn.js)
  function mesh(geom, obj, matrix, o = {}) {
    const sw = o.sway ? {lean: {value: new THREE.Vector2()}, flut: {value: new THREE.Vector2()}} : null, lean = sw?.lean;
    const gm = new THREE.Mesh(geom, meshMat(obj, new THREE.Vector2(matrix.elements[12], matrix.elements[14]), sw, o.autumn)); gm.matrixAutoUpdate = false; gm.matrix.copy(matrix); gm.matrixWorldNeedsUpdate = true; gScene.add(gm);
    const sm = new THREE.Mesh(geom, sw ? raw(SHADOW_SWAY_VS, SHADOW_SWAY_FS, {uLean: sw.lean, uFlut: sw.flut, uLeanX: U.leanX, uLeanY: U.leanY, uTime: U.time,
      uLeafK: U.leafK, uAutumn: U.autumn, uSeed: gm.material.uniforms.uSeed}, {side: THREE.DoubleSide}) : shadowMeshMat);   // (light through a crown only where both sides of a clump are bare)
    sm.matrixAutoUpdate = false; sm.matrix.copy(matrix); sm.matrixWorldNeedsUpdate = true; sm.layers.enable(1);
    hDirty = true;
    const caster = () => sm.layers.isEnabled(1);   // only a point-light caster dirties the height map (debris, burning logs move every frame)
    const H = {sm, hm: matrix.clone()};             // hm: the matrix the height map was last rendered with
    // o.static (world props): its shadow lives in the cached static map; while it moves it casts per frame (STATIC SUN SHADOW)
    const S = STATIC_SHADOW && o.static && !sw ? {sm, still: 0, moving: false, back: false} : null;
    if (S) { sm.layers.enable(2); sm.layers.disable(0); staticSoon(0); }
    (S ? sStatic : sScene).add(sm);
    const inStatic = () => S && !S.moving;
    let ver = 0;   // bumps on every setMatrix that changed the matrix (world.js: did a feature pose it since?)
    return {gm, sm, get ver() { return ver; },
      setVisible(v) { if (gm.visible !== v) { if (caster()) hDirty = true; if (inStatic()) staticSoon(0); } gm.visible = v; sm.visible = v; },
      setMatrix(m) {
        if (gm.matrix.equals(m)) return;
        ver++; gm.matrix.copy(m); sm.matrix.copy(m); gm.matrixWorldNeedsUpdate = sm.matrixWorldNeedsUpdate = true;
        if (caster()) moved.add(H);   // render() decides whether that's enough to re-render the height map
        if (S) {   // it moves: into the per-frame map now, out of the static one at its next re-render (soon)
          S.still = 0; S.back = false;
          if (!S.moving) { S.moving = true; sm.layers.enable(0); sm.layers.disable(2); sStatic.remove(sm); sScene.add(sm); movers.add(S); staticSoon(6); }
        }
      },
      setGeometry(g) { if (gm.geometry !== g) { if (caster()) hDirty = true; if (inStatic()) staticSoon(0); } gm.geometry = g; sm.geometry = g; },
      // burning wood: char 0..1 (blackens), glow 0..1 (ember veins), t (s: the veins crawl), ash 0..1 (settles on top)
      burn(char = 0, glow = 0, t = 0, ash = 0) { gm.material.uniforms.uBurn.value.set(char, glow, t, ash); },
      setLean(x, y) { if (!lean || (lean.value.x === x && lean.value.y === y)) return; lean.value.set(x, y); if (sm.layers.isEnabled(1)) hDirty = true; },
      // the leaves' own dance (art px, x along the screen / y toward the camera) and the light rolling through them:
      // (kx, kz: rad per m along the wind, phase, amount of tone bias)
      setFlutter(x, y) { sw?.flut.value.set(x, y); },
      setRipple(kx, kz, ph, amp) { gm.material.uniforms.uRip.value.set(kx, kz, ph, amp); },
      set flash(k) { gm.material.uniforms.uFlash.value = k; },
      dispose() { gScene.remove(gm); sm.parent?.remove(sm); gm.material.dispose(); if (lean) sm.material.dispose(); hDirty = true; if (S) { movers.delete(S); staticSoon(0); } }};
  }
  // the height map is re-rendered when a caster moved more than ~a texel (6 cm) or turned / scaled more than ~1%, against
  // the matrix it was last rendered with: a hit wobble (2 px) or a burning crate set to two matrices a frame no longer
  // re-render it every frame
  const moved = new Set();
  const HM_MOVE = .05, HM_TURN = .012;
  function movedEnough() {
    for (const H of moved) {
      if (!H.sm.layers.isEnabled(1)) continue;
      const a = H.sm.matrix.elements, b = H.hm.elements;
      if (Math.abs(a[12] - b[12]) > HM_MOVE || Math.abs(a[13] - b[13]) > HM_MOVE || Math.abs(a[14] - b[14]) > HM_MOVE) return true;
      for (const k of M3) if (Math.abs(a[k] - b[k]) > HM_TURN) return true;
    }
    return false;
  }
  const M3 = [0, 1, 2, 4, 5, 6, 8, 9, 10];
  function surface(geom, opts, castShadow = true) {
    const gm = new THREE.Mesh(geom, surfMat(opts)); gScene.add(gm);
    let sm = null;
    if (castShadow) { sm = new THREE.Mesh(geom, shadowMeshMat); sm.layers.enable(1); if (STATIC_SHADOW) { sm.layers.enable(2); sm.layers.disable(0); } (STATIC_SHADOW ? sStatic : sScene).add(sm); hDirty = true; staticSoon(0); }
    return {gm, sm, dispose() { gScene.remove(gm); if (sm) { sm.parent?.remove(sm); hDirty = true; staticSoon(0); } gm.material.dispose(); }};
  }
  // ---- immediate-mode batches: filled every frame (G.line / G.point / G.sprite), drawn by render(), then emptied
  // lines: 1 px GL lines in world space (arrows, strings, streaks). color [r, g, b] 0..1, emit true = glows
  const LMAX = 4096, lineGeo = new THREE.BufferGeometry();
  const lPos = new THREE.BufferAttribute(new Float32Array(LMAX * 6), 3), lCol = new THREE.BufferAttribute(new Float32Array(LMAX * 8), 4);
  lPos.setUsage(THREE.DynamicDrawUsage); lCol.setUsage(THREE.DynamicDrawUsage); lineGeo.setAttribute('position', lPos); lineGeo.setAttribute('color', lCol);
  const lineObj = new THREE.LineSegments(lineGeo, raw(LINE_VS, LINE_FS, {})); lineObj.frustumCulled = false; lineObj.matrixAutoUpdate = false; gScene.add(lineObj);
  let nLines = 0;
  // (the batches write straight into their typed arrays: no per-call allocation, no GC spikes in a big fight)
  function line(x0, y0, z0, x1, y1, z1, c, emit = false) {   // world X, Y (up), Z
    if (nLines >= LMAX) return;
    const P = lPos.array, C = lCol.array, i = nLines * 6, j = nLines * 8, e = emit ? 1 : 0;
    P[i] = x0; P[i + 1] = y0; P[i + 2] = z0; P[i + 3] = x1; P[i + 4] = y1; P[i + 5] = z1;
    C[j] = C[j + 4] = c[0]; C[j + 1] = C[j + 5] = c[1]; C[j + 2] = C[j + 6] = c[2]; C[j + 3] = C[j + 7] = e; nLines++;
  }
  // points: pixel particles. size 1..4 px, alpha < 1 = ordered dither, emit = glows
  const PMAX = 8192, pointGeo = new THREE.BufferGeometry();
  const pPos = new THREE.BufferAttribute(new Float32Array(PMAX * 3), 3), pCol = new THREE.BufferAttribute(new Float32Array(PMAX * 4), 4), pMisc = new THREE.BufferAttribute(new Float32Array(PMAX * 2), 2);
  for (const a of [pPos, pCol, pMisc]) a.setUsage(THREE.DynamicDrawUsage);
  pointGeo.setAttribute('position', pPos); pointGeo.setAttribute('color', pCol); pointGeo.setAttribute('aMisc', pMisc);
  const PTK = {value: 1};   // (the cinema camera's k: points keep their size in screen px)
  const pointObj = new THREE.Points(pointGeo, raw(POINT_VS, POINT_FS, {uSnap: SNAP, uPtK: PTK})); pointObj.frustumCulled = false; pointObj.matrixAutoUpdate = false; gScene.add(pointObj);
  let nPoints = 0;
  const NOOPT = {};
  function point(x, y, z, c, o = NOOPT) {
    if (nPoints >= PMAX) return;
    const P = pPos.array, C = pCol.array, M = pMisc.array, i = nPoints * 3, j = nPoints * 4, k = nPoints * 2;
    P[i] = x; P[i + 1] = y; P[i + 2] = z; C[j] = c[0]; C[j + 1] = c[1]; C[j + 2] = c[2]; C[j + 3] = o.emit ? 1 : 0;
    M[k] = o.size ?? 1; M[k + 1] = o.alpha ?? 1; nPoints++;
  }
  // sprites: billboards from any image, grouped by (image, emit image, normals, type, shadow) into instanced draws.
  //   o = {img, sx, sy, sw, sh (source rect, px; default the whole image), x, y, z (world anchor: X, Y up, Z),
  //        px, py (pivot inside the source rect), em (emit image, same layout), nrm (normal image, same layout),
  //        type 3 painted | 7 lit by its normals, alpha (dither), flip, sway (px at the top), flash, shadow (cast), dynamic,
  //        lie (0..1: a lying body's depth and sun card lie down, BATCH_VS)}
  const groups = new Map(), imgId = new WeakMap(); let nextImg = 1;
  const idOf = img => { if (!img) return 0; let i = imgId.get(img); if (!i) { i = nextImg++; imgId.set(img, i); } return i; };
  const PY_U = {value: PPMY}, SUN_OFF = {value: 0}, SUN_ON = {value: 1};
  function makeGroup(o) {
    const cap = 64, geo = new THREE.InstancedBufferGeometry(); geo.setAttribute('position', QUAD.getAttribute('position'));
    const A = {iAnchor: 4, iRect: 4, iSize: 4, iMisc: 4}, attrs = {};
    for (const [k, n] of Object.entries(A)) { attrs[k] = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); attrs[k].setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, attrs[k]); }
    const uni = {uTex: {value: null}, uEm: {value: null}, uNrm: {value: null}, uHasEm: {value: 0}, uHasNrm: {value: 0}, uType: {value: o.type ?? 3},
      uFaceYaw: U.camYaw, uCamYaw: U.camYaw, uPx: U.px, uPy: PY_U, uSun: SUN_OFF, uSnap: SNAP, uBias: {value: .00125}};
    const gm = new THREE.Mesh(geo, raw(BATCH_VS, BATCH_FS, uni, {side: THREE.DoubleSide})); gm.frustumCulled = false; gm.matrixAutoUpdate = false; gScene.add(gm);
    let sm = null;
    if (o.shadow) { sm = new THREE.Mesh(geo, raw(BATCH_VS, BATCH_SHADOW_FS, {uTex: uni.uTex, uFaceYaw: U.sunYaw, uCamYaw: U.camYaw, uPx: U.px, uPy: PY_U, uSun: SUN_ON, uSnap: NOSNAP, uBias: {value: 0}}, {side: THREE.DoubleSide})); sm.frustumCulled = false; sm.matrixAutoUpdate = false; sScene.add(sm); }
    return {geo, attrs, list: Object.values(attrs), uni, gm, sm, cap, n: 0, idle: 0};
  }
  function grow(G2) {
    const cap = G2.cap * 2;
    for (const [k, a] of Object.entries(G2.attrs)) { const b = new THREE.InstancedBufferAttribute(new Float32Array(cap * a.itemSize), a.itemSize); b.array.set(a.array); b.setUsage(THREE.DynamicDrawUsage); G2.geo.setAttribute(k, b); G2.attrs[k] = b; }
    G2.cap = cap; G2.list = Object.values(G2.attrs); regrown(G2.geo);
  }
  // the group key: a number while the image ids and the type fit (16 + 16 + 16 bits, type 0..15: < 2^53), else the
  // string it always was (no garbage per sprite on the common path; the groups are the same either way)
  const DYN = {dynamic: true}, STILL = {};
  function groupKey(o) {
    const a = idOf(o.img), b = idOf(o.em), c = idOf(o.nrm), t = o.type ?? 3, s = o.shadow ? 1 : 0;
    return a < 65536 && b < 65536 && c < 65536 && t >= 0 && t < 16 && (t | 0) === t ? ((a * 65536 + b) * 65536 + c) * 32 + t * 2 + s : `${a}|${b}|${c}|${t}|${s}`;
  }
  // a sprite's group, found by small integers (image id -> its emit, normals, type, shadow): the flat key is a number past
  // the small-integer range, a boxed double every lookup; made (or found by that key) the first time
  const gIdx = new Map();
  function sprite(o) {
    const ia = idOf(o.img), ie = idOf(o.em), inr = idOf(o.nrm), ty = o.type ?? 3, sh0 = o.shadow ? 1 : 0;
    let m = gIdx.get(ia); if (!m) gIdx.set(ia, m = new Map());
    const k2 = ie < 4096 && inr < 4096 && ty >= 0 && ty < 16 && (ty | 0) === ty ? ((ie * 4096 + inr) * 16 + ty) * 2 + sh0 : `${ie}|${inr}|${ty}|${sh0}`;
    let G2 = m.get(k2);
    if (!G2) { const key = groupKey(o); G2 = groups.get(key); if (!G2) groups.set(key, G2 = makeGroup(o)); G2.ia = ia; G2.ik = k2; m.set(k2, G2); }
    if (G2.n >= G2.cap) grow(G2);
    const W = o.img.width, H = o.img.height, sx = o.sx || 0, sy = o.sy || 0, sw = o.sw ?? W, sh = o.sh ?? H, i = G2.n++, dyn = o.dynamic ? DYN : STILL;
    G2.uni.uTex.value = tex(o.img, dyn); if (o.em) { G2.uni.uEm.value = tex(o.em, dyn); G2.uni.uHasEm.value = 1; }
    if (o.nrm) { G2.uni.uNrm.value = tex(o.nrm); G2.uni.uHasNrm.value = 1; }
    const A = G2.attrs.iAnchor.array, R = G2.attrs.iRect.array, S = G2.attrs.iSize.array, M = G2.attrs.iMisc.array, b = i * 4;
    A[b] = o.x; A[b + 1] = o.y; A[b + 2] = o.z; A[b + 3] = o.lie || 0;
    R[b] = sx / W; R[b + 1] = sy / H; R[b + 2] = sw / W; R[b + 3] = sh / H;
    S[b] = sw; S[b + 1] = sh; S[b + 2] = o.px ?? sw / 2; S[b + 3] = o.py ?? sh;
    M[b] = o.alpha ?? 1; M[b + 1] = o.flip ? 1 : 0; M[b + 2] = o.sway || 0; M[b + 3] = o.flash || 0;
  }
  // upload only the part of a batch buffer written this frame (three uploads the WHOLE array otherwise: ~0.9 MB a frame)
  function upload(a, n) { if (n > 0) setRange(a, 0, n * a.itemSize); }
  function flushBatches() {
    upload(lPos, nLines * 2); upload(lCol, nLines * 2); lineGeo.setDrawRange(0, nLines * 2); lineObj.visible = nLines > 0;
    upload(pPos, nPoints); upload(pCol, nPoints); upload(pMisc, nPoints); pointGeo.setDrawRange(0, nPoints); pointObj.visible = nPoints > 0;
    for (const [key, G2] of groups) {
      G2.geo.instanceCount = G2.n; G2.gm.visible = G2.n > 0; if (G2.sm) G2.sm.visible = G2.n > 0;
      for (const a of G2.list) upload(a, G2.n);
      if (G2.n === 0 && ++G2.idle > 600) {   // (the shared quad's attribute is detached first: disposing it would delete its GL buffer)
        gScene.remove(G2.gm); if (G2.sm) sScene.remove(G2.sm); G2.gm.material.dispose(); G2.sm?.material.dispose(); G2.geo.deleteAttribute('position'); G2.geo.dispose(); groups.delete(key); gIdx.get(G2.ia)?.delete(G2.ik);
      }
      else if (G2.n) G2.idle = 0;
    }
  }
  function resetBatches() { nLines = 0; nPoints = 0; aoN = 0; for (const G2 of groups.values()) G2.n = 0; }

  // ---- THE SCREEN LAYERS (ground, pre, emit, add, front, distort): render targets at the view's size, premultiplied, GL
  // rows; COMP_FS reads them. Two ways to draw into one:
  //   glayer(n): a small 2D-canvas-like context drawn by the GPU (LB_VS / LB_FS), for the marks drawn every frame: fillStyle
  //     (a CSS colour, read once per string), globalAlpha, globalCompositeOperation 'source-over' | 'lighter', fillRect,
  //     drawImage (an image, a canvas or a G.dataImage; 3, 5 or 9 arguments; nearest), save / restore, setTransform /
  //     transform / translate / scale / rotate (any affine), imageSmoothingEnabled (ignored: always nearest). Beyond the
  //     canvas: fillRectRGB(x, y, w, h, r, g, b) (0..255, no colour string a pixel) and clipOutside(polygons) (draw only
  //     where an even number of them cover: a canvas's rect(all) + the polygons + clip('evenodd')). The ops keep their order.
  //     An image drawn there is uploaded once: G.touch(canvas) after painting it again; a data image's changed rect goes up
  //     with G.texData.
  //   layer(n): the layer's 2D canvas, for what that can't do (paths, gradients, pixels). Used, it is uploaded and laid in
  //     among that frame's GPU ops where it was first drawn into (one drawImage there): what other features draw after it,
  //     on the GPU, stays over it.
  // The canvases were uploaded every frame they were used: a 2D canvas -> WebGL copy, which stalls when the GPU is busy
  const LAYERS = ['ground', 'pre', 'emit', 'add', 'front', 'distort'], layers = {}, layerList = [];   // (made below the GPU context)
  // layer(name) -> its 2D canvas context for this frame (cleared on first use each frame)
  function layer(n) {
    const L = layers[n];
    if (!L.used) {
      L.used = true; if (L.dirty) { L.q.setTransform(1, 0, 0, 1, 0, 0); L.q.globalAlpha = 1; L.q.globalCompositeOperation = 'source-over'; L.q.clearRect(0, 0, VW, VH); } L.dirty = true;
      lbOp(L, L.t, false, null, 0, 0, VW, 0, 0, VH, 0, 0, VW, VH, 0, 0, 0, 1);   // its place among the GPU ops (drawn with what it holds at render)
    }
    return L.q;
  }
  // glayer(name) -> its GPU context for this frame (its state reset on first use each frame, as layer() resets the canvas's)
  function glayer(n) {
    const L = layers[n];
    if (!L.gUsed) { L.gUsed = true; L.g.reset(); }
    return L.g;
  }
  // the ops of this frame in runs (a layer x a blend x one texture; fills join any run), pooled: one upload + one draw a run
  const lbRuns = [], lbScene = new THREE.Scene(); let lbN = 0;
  lbScene.matrixAutoUpdate = false;
  function lbGrow(R, cap) {
    const d = new Float32Array(cap * 16); if (R.d) d.set(R.d);
    const ib = new THREE.InstancedInterleavedBuffer(d, 16, 1); ib.setUsage(THREE.DynamicDrawUsage);
    R.geo.setAttribute('iO', new THREE.InterleavedBufferAttribute(ib, 4, 0)); R.geo.setAttribute('iV', new THREE.InterleavedBufferAttribute(ib, 4, 4));
    R.geo.setAttribute('iS', new THREE.InterleavedBufferAttribute(ib, 4, 8)); R.geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(ib, 4, 12));
    R.d = d; R.ib = ib; R.cap = cap; regrown(R.geo);
  }
  function lbRun(L, tex, add, clip) {
    let R = lbRuns[lbN];
    if (!R) {
      const geo = new THREE.InstancedBufferGeometry(); geo.setAttribute('position', QUAD.getAttribute('position'));
      const u = {uRes: compU.uRes, uTex: {value: null}, uClipP: {value: new Float32Array(64)}, uClipN: {value: new THREE.Vector4()}, uClipK: {value: 0}};
      const o = {side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor};
      const mOver = raw(LB_VS, LB_FS, u, {...o, blendDst: THREE.OneMinusSrcAlphaFactor}), mAdd = raw(LB_VS, LB_FS, u, {...o, blendDst: THREE.OneFactor});
      const mesh = new THREE.Mesh(geo, mOver); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.visible = false; lbScene.add(mesh);   // (shown only while its layer draws)
      R = lbRuns[lbN] = {geo, u, mOver, mAdd, mesh, d: null, ib: null, cap: 0, n: 0, tex: null, add: false, clip: null};
      lbGrow(R, 64);
    }
    lbN++; R.n = 0; R.tex = tex; R.add = add; R.clip = clip; L.runs.push(R);
    return R;
  }
  // one op: its corner (ox, oy) and axes (ux, uy) (vx, vy) in canvas px, its source rect, its colour; a run per blend x
  // texture x clip
  function lbOp(L, tex, add, clip, ox, oy, ux, uy, vx, vy, sx, sy, sw, sh, r, g, b, a) {
    let R = L.runs.length ? L.runs[L.runs.length - 1] : null;
    if (!R || R.add !== add || R.clip !== clip || (tex && R.tex && R.tex !== tex)) R = lbRun(L, tex, add, clip);
    else if (tex) R.tex = tex;
    if (R.n >= R.cap) lbGrow(R, R.cap * 2);
    const D = R.d, i = R.n++ * 16;
    D[i] = ox; D[i + 1] = oy; D[i + 2] = ux; D[i + 3] = uy; D[i + 4] = vx; D[i + 5] = vy; D[i + 6] = 0; D[i + 7] = 0;
    D[i + 8] = sx; D[i + 9] = sy; D[i + 10] = sw; D[i + 11] = sh; D[i + 12] = r; D[i + 13] = g; D[i + 14] = b; D[i + 15] = a;
  }
  // dataImage(w, h, data): an image for the GPU contexts whose pixels are an RGBA8 array its owner keeps and paints (they
  // are shown as premultiplied: straight colours whose alpha is 0 or 255 are both). drawImage takes it like a canvas; after
  // changing the array, G.texData(img, x, y, w, h, data, w, x, y) uploads that rect (no canvas between: flow's marks)
  const dataImage = (w, h, data) => ({width: w, height: h, data, isData: true});
  // setGroundDecals(img, x0, y0, pxX, pxY): the ground surfaces made with {decals: true} show img (a dataImage, kept current with
  // texData) at world px (x pxX - x0, z pxY - y0) under each fragment (walkable terrain: features/flow.js). null: off
  let gDecal = null;
  function setGroundDecals(img, x0 = 0, y0 = 0, pxX = 1, pxY = 1) {
    gDecal = img; U.decalOn.value = img ? 1 : 0;
    if (img) { U.decalRect.value.set(x0, y0, img.width, img.height); U.decalPx.value.set(pxX, pxY); U.decalT.value = imgTex(img); } else U.decalT.value = null;
  }
  // an image or canvas drawn by a GPU context: its texture, made (and uploaded) once; unused for 600 frames, it is let go
  const imgT = new WeakMap(), imgLive = new Set();
  function imgTex(img) {
    let e = imgT.get(img);
    if (!e) {
      const t = img.isData ? new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType) : new THREE.Texture(img);
      t.flipY = false; t.premultiplyAlpha = !img.isData; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace;
      t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
      e = {t, used: 0, gone: false}; imgT.set(img, e); imgLive.add(e);
    } else if (e.gone) { e.gone = false; e.t.needsUpdate = true; imgLive.add(e); }
    e.used = frameNo;
    return e.t;
  }
  // touch(img): an image a GPU context draws was painted again: upload it before it is shown next
  function touch(img) { const e = imgT.get(img); if (e && !e.gone) e.t.needsUpdate = true; }
  function gctx(L) {
    // S: the fill (string, rgba), alpha, blend, the transform (a b c d e f, as the canvas's) and the clip (null: none)
    const S = {fs: '#000', c: cssRGBA('#000'), ga: 1, add: false, ma: 1, mb: 0, mc: 0, md: 1, me: 0, mf: 0, clip: null}, stack = [], clips = [];
    let depth = 0, ci = 0;
    // a rect (x, y, w, h) in user space through the transform: its corner and axes
    const quad = (tex, x, y, w, h, sx, sy, sw, sh, r, g, b, a) => lbOp(L, tex, S.add, S.clip, S.ma * x + S.mc * y + S.me, S.mb * x + S.md * y + S.mf,
      S.ma * w, S.mb * w, S.mc * h, S.md * h, sx, sy, sw, sh, r, g, b, a);
    const X = {
      imageSmoothingEnabled: false,
      get fillStyle() { return S.fs; },
      set fillStyle(v) { if (typeof v !== 'string') throw new Error('G.glayer: fillStyle takes a colour string'); if (v !== S.fs) { S.fs = v; S.c = cssRGBA(v); } },
      get globalAlpha() { return S.ga; },
      set globalAlpha(v) { if (v >= 0 && v <= 1) S.ga = v; },   // (as the canvas: a value out of range is ignored)
      get globalCompositeOperation() { return S.add ? 'lighter' : 'source-over'; },
      set globalCompositeOperation(v) { if (v === 'lighter') S.add = true; else if (v === 'source-over') S.add = false; else throw new Error(`G.glayer: no '${v}' (source-over, lighter)`); },
      save() { Object.assign(stack[depth] ??= {}, S); depth++; },
      restore() { if (depth > 0) Object.assign(S, stack[--depth]); },
      setTransform(a, b, c, d, e, f) { S.ma = a; S.mb = b; S.mc = c; S.md = d; S.me = e; S.mf = f; },
      transform(a, b, c, d, e, f) {
        const A = S.ma, B = S.mb, C = S.mc, D = S.md;
        S.ma = A * a + C * b; S.mb = B * a + D * b; S.mc = A * c + C * d; S.md = B * c + D * d; S.me += A * e + C * f; S.mf += B * e + D * f;
      },
      translate(x, y) { S.me += S.ma * x + S.mc * y; S.mf += S.mb * x + S.md * y; },
      scale(x, y) { S.ma *= x; S.mb *= x; S.mc *= y; S.md *= y; },
      rotate(t) { const c = Math.cos(t), s = Math.sin(t); X.transform(c, s, -s, c, 0, 0); },
      // (not canvas) draw only where an even number of these polygons ([[x, y], ...], canvas px: the transform not applied)
      // cover a pixel; until restore() or the next frame. Up to 4 polygons, 32 points in all
      clipOutside(polys) {
        const C = clips[ci] ||= {p: new Float32Array(64), n: new THREE.Vector4(), k: 0}; ci++;
        let o = 0, k = 0; C.n.set(0, 0, 0, 0);
        for (const poly of polys) {
          if (k >= 4 || o + poly.length > 32) break;
          for (const pt of poly) { C.p[o * 2] = pt[0]; C.p[o * 2 + 1] = pt[1]; o++; }
          C.n.setComponent(k++, poly.length);
        }
        C.k = k; S.clip = k ? C : null;
      },
      fillRect(x, y, w, h) {
        const c = S.c, al = c[3] * S.ga; if (!(al > 0) || !w || !h) return;
        quad(null, x, y, w, h, 0, 0, 0, 0, c[0] * al, c[1] * al, c[2] * al, al);
      },
      fillRectRGB(x, y, w, h, r, g, b) {   // (not canvas) an opaque colour as numbers 0..255 (x the alpha)
        const al = S.ga; if (!(al > 0) || !w || !h) return;
        quad(null, x, y, w, h, 0, 0, 0, 0, r / 255 * al, g / 255 * al, b / 255 * al, al);
      },
      drawImage(img, a1, a2, a3, a4, a5, a6, a7, a8) {
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        let sx = 0, sy = 0, sw = iw, sh = ih, dx, dy, dw, dh;
        if (a5 !== undefined) { sx = a1; sy = a2; sw = a3; sh = a4; dx = a5; dy = a6; dw = a7; dh = a8; }
        else if (a3 !== undefined) { dx = a1; dy = a2; dw = a3; dh = a4; }
        else { dx = a1; dy = a2; dw = iw; dh = ih; }
        if (sw < 0) { sx += sw; sw = -sw; } if (sh < 0) { sy += sh; sh = -sh; } if (dw < 0) { dx += dw; dw = -dw; } if (dh < 0) { dy += dh; dh = -dh; }
        if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0 && S.ga > 0)) return;
        quad(imgTex(img), dx, dy, dw, dh, sx, sy, sw, sh, 0, 0, 0, S.ga);
      },
      reset() { S.ga = 1; S.add = false; S.ma = S.md = 1; S.mb = S.mc = S.me = S.mf = 0; S.clip = null; depth = 0; ci = 0; },
    };
    return X;
  }
  for (const n of LAYERS) {
    const c = document.createElement('canvas'); c.width = VW; c.height = VH;
    const q = c.getContext('2d'); q.imageSmoothingEnabled = false;
    const t = new THREE.CanvasTexture(c); t.flipY = false; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.minFilter = t.magFilter = THREE.NearestFilter;
    t.premultiplyAlpha = true;   // (as the canvas keeps it: laid into the target as is)
    const rt = new THREE.WebGLRenderTarget(VW, VH, {minFilter: near, magFilter: near, depthBuffer: false});
    const L = {c, q, t, rt, used: false, dirty: false, runs: [], g: null, gUsed: false}; L.g = gctx(L);
    layers[n] = L; layerList.push(L);
  }
  // render(): each used layer's target, cleared, its runs drawn in order (its canvas, if used, where layer() placed it)
  function drawLayers() {
    for (const L of layerList) if (L.used) L.t.needsUpdate = true;
    for (const L of layerList) {
      if (!L.runs.length) continue;
      renderer.setRenderTarget(L.rt); renderer.clear(true, false, false);
      for (const R of lbRuns) R.mesh.visible = false;   // (every pooled run sits in lbScene: this layer's are shown, in order)
      let k = 0;
      for (const R of L.runs) {
        R.geo.instanceCount = R.n; setRange(R.ib, 0, R.n * 16);
        R.u.uTex.value = R.tex; R.mesh.material = R.add ? R.mAdd : R.mOver; R.mesh.renderOrder = k++; R.mesh.visible = true;
        const C = R.clip; R.u.uClipK.value = C ? C.k : 0; if (C) { R.u.uClipP.value.set(C.p); R.u.uClipN.value.copy(C.n); }
      }
      renderer.render(lbScene, dummyCam);
    }
    for (const R of lbRuns) R.mesh.visible = false;
    if (frameNo % 300 === 0) for (const e of imgLive) if (frameNo - e.used > 600) { e.t.dispose(); e.gone = true; imgLive.delete(e); }
  }

  // ---- composite
  const compU = {
    tA: {value: gbuf.textures[0]}, tN: {value: gbuf.textures[1]}, tE: {value: gbuf.textures[2]}, tD: {value: gbuf.depthTexture},
    tS: {value: shadow.depthTexture}, tX: {value: xray.texture}, uRamps: U.ramps,
    uInvPV: {value: new THREE.Matrix4()}, uLightPV: {value: new THREE.Matrix4()},
    uRes: {value: new THREE.Vector2(VW, VH)}, uR: {value: R_DEPTH},
    uBg: {value: new THREE.Vector3(.1, .12, .11)}, uAmb: {value: new THREE.Vector3(1, 1, 1)}, uSunDir: {value: new THREE.Vector3(0, 1, 0)},
    uShadowC: {value: new THREE.Vector3()}, uFill: {value: new THREE.Vector3()}, uGrade: {value: new THREE.Vector3(1, 1, 1)}, uXCol: {value: new THREE.Vector3(.17, .14, .21)},
    tSS: {value: shadowS.depthTexture}, uLightPVS: {value: new THREE.Matrix4()}, uSBias: {value: 1}, uSOn: {value: 1},
    uShadowA: {value: 0}, uShadowOn: {value: 1}, uSunK: {value: .34}, uBanded: {value: 1}, uOutline: {value: 1}, uGradeK: {value: 0}, uEmin: {value: .1}, uShadowTexel: {value: 1 / SM},
    uSoftFam: {value: -1},
    uSeasonM: {value: new THREE.Matrix3()}, uSeasonK: {value: 0}, uSnow: {value: 0}, uWet: {value: 0}, uFlashC: {value: new THREE.Vector3()},   // features/weather.js
    uFog: {value: new THREE.Vector4()}, uPlayer: {value: new THREE.Vector3()}, uPlayerSun: {value: .5},
    uView: {value: new THREE.Vector3(0, .342, .94)}, uSunC: {value: new THREE.Vector3(1, 1, 1)}, uSunStr: {value: 0},
    uWPhase: U.wPhase, uWRefl: {value: new THREE.Vector4()}, uWPx: {value: new THREE.Vector2(PPM, PPM)},
    uNL: {value: 0}, uLP: {value: Array.from({length: NL}, () => new THREE.Vector4())}, uLC: {value: Array.from({length: NL}, () => new THREE.Vector4())},
    uNH: {value: 0}, uHalo: {value: Array.from({length: NL}, () => new THREE.Vector4())}, uHaloC: {value: Array.from({length: NL}, () => new THREE.Vector3())},
    tGround: {value: layers.ground.rt.texture}, tPre: {value: layers.pre.rt.texture}, tEmitL: {value: layers.emit.rt.texture}, tAdd: {value: layers.add.rt.texture},
    tFront: {value: layers.front.rt.texture}, uLay: {value: new THREE.Vector4()}, uLayE: {value: 0}, tDistort: {value: layers.distort.rt.texture}, uLayD: {value: 0},
    tH: {value: hmap.depthTexture}, uHPV: {value: new THREE.Matrix4().multiplyMatrices(hCam.projectionMatrix, hCam.matrixWorldInverse)},
    uPtShadow: {value: 1}, uHBias: {value: .03 / HM.far},
    uDebug: {value: 0},
    uRf: {value: new THREE.Vector4()}, uRfC: {value: new THREE.Vector3()}, uRfW: {value: new THREE.Vector4()}, uRfV: {value: new THREE.Vector4()}, uRfP: {value: new THREE.Vector4()},
    tTop: {value: (t => { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.unpackAlignment = 1; return t; })(new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat, THREE.UnsignedByteType))}, uTopH: {value: new THREE.Vector4()},
    uCl: {value: new THREE.Vector4()}, uClM: {value: new THREE.Vector4()}, uClO: {value: new THREE.Vector4()}, uClC: {value: new THREE.Vector3()},
    uClT: {value: new THREE.Vector4()}, uFr: {value: new THREE.Vector4()}, uFrB: {value: new THREE.Vector4()}, uFrK: {value: new THREE.Vector4()},
    uFrC: {value: new THREE.Vector4()}, uFrS: {value: new THREE.Vector4()}, uFrQ: {value: new THREE.Vector4()},
    uHz: {value: new THREE.Vector4()}, uHzM: {value: new THREE.Vector4()}, uHzO: {value: new THREE.Vector4()},
    uAo: {value: new THREE.Vector4()},
    uMist: {value: new THREE.Vector4()}, uMistC: {value: new THREE.Vector4()}, uMistW: {value: new THREE.Vector4()}, uMistD: {value: new THREE.Vector4(0, 0, 0, 1)},   // features/mist.js (G.setMist)
    uMistO: {value: new THREE.Vector4()}, uMistQ: {value: new THREE.Vector4(3, .7, 1, 0)}, uMistK: {value: new THREE.Vector4()},
    uMistS: {value: Array.from({length: MIST_N}, () => new THREE.Vector4())}, uMistH: {value: Array.from({length: MIST_N}, () => new THREE.Vector4())},
    uCine: CINE, uCamP: {value: new THREE.Vector3()}, uSunP: {value: new THREE.Vector4(0, 1, 0, 1)},   // the cinema camera (setCine)
    uSkyZ: {value: new THREE.Vector3()}, uSkyH: {value: new THREE.Vector3()}, uSunCol: {value: new THREE.Vector3()},
  };
  const compScene = new THREE.Scene();
  const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const compMesh = new THREE.Mesh(tri, raw(COMP_VS, COMP_FS, compU, {depthTest: false, depthWrite: false})); compMesh.frustumCulled = false; compMesh.matrixAutoUpdate = false; compScene.add(compMesh);
  const dummyCam = new THREE.Camera();
  // GOD RAYS (render/godrays.js): sunbeams marched through the sun's shadow maps, added to the pixel image right after the composite
  const rays = createGodrays({THREE, renderer, raw, tri, cam: dummyCam, compU});   // (not drawn under the cinema camera: they march the oblique view's parallel rays)

  // ---- CONTACT SHADOWS (features/contact.js, every frame it shows them): the arena's contact AO stamps, drawn by the GPU
  // into the x-ray target's G channel (AO_VS / AO_FS) and laid on the ground by the composite (uAo: the mood's shadow colour
  // and strength, before the ground layer). contact.js was a view-sized canvas mask: a drawImage per stamp, a full-view tint
  // fill and a blit into the ground layer every frame. A stamp's image is still contact's (its alpha bytes, as it painted
  // them), kept once in an R8 atlas here (shelves; when it is full it starts over: aoEpoch, and contact makes them again)
  const AO_MAX = 2048, AO_AW = 1024, AO_AH = 512;
  const aoAtlas = new THREE.DataTexture(new Uint8Array(AO_AW * AO_AH), AO_AW, AO_AH, THREE.RedFormat, THREE.UnsignedByteType);
  aoAtlas.minFilter = aoAtlas.magFilter = THREE.NearestFilter; aoAtlas.generateMipmaps = false; aoAtlas.unpackAlignment = 1; aoAtlas.needsUpdate = true;
  const aoGeo = new THREE.InstancedBufferGeometry(), aoBuf = new THREE.InstancedInterleavedBuffer(new Float32Array(AO_MAX * 8), 8, 1);
  aoGeo.setAttribute('position', QUAD.getAttribute('position')); aoBuf.setUsage(THREE.DynamicDrawUsage);
  aoGeo.setAttribute('iR', new THREE.InterleavedBufferAttribute(aoBuf, 4, 0)); aoGeo.setAttribute('iT', new THREE.InterleavedBufferAttribute(aoBuf, 4, 4));
  const aoScene = new THREE.Scene(); aoScene.matrixAutoUpdate = false;
  { const m = new THREE.Mesh(aoGeo, raw(AO_VS, AO_FS, {uRes: compU.uRes, uAtlas: {value: aoAtlas}}, {side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcColorFactor}));
    m.frustumCulled = false; m.matrixAutoUpdate = false; aoScene.add(m); }
  let aoX = 0, aoY = 0, aoRow = 0, aoEpoch = 0, aoN = 0, aoFrame = -1;
  // aoStamp(w, h, alpha bytes (w x h, rows top down)) -> {u, v, w, h, epoch}: the stamp's place in the atlas
  function aoStamp(w, h, d) {
    if (w > AO_AW || h > AO_AH) return null;
    if (aoX + w > AO_AW) { aoX = 0; aoY += aoRow; aoRow = 0; }
    if (aoY + h > AO_AH) { aoX = aoY = aoRow = 0; aoEpoch++; }   // full: start over (the stamps made before are stale)
    const A = aoAtlas.image.data;
    for (let j = 0; j < h; j++) A.set(d.subarray(j * w, j * w + w), (aoY + j) * AO_AW + aoX);
    const r = {u: aoX, v: aoY, w, h, epoch: aoEpoch}; aoX += w; aoRow = Math.max(aoRow, h); aoAtlas.needsUpdate = true;
    return r;
  }
  // ao(x, y, z, a, stamp): one stamp this frame, its top-left at (x, y) canvas px, z px a texel, alpha a
  function ao(x, y, z, a, r) {
    if (aoN >= AO_MAX || !r) return;
    const D = aoBuf.array, i = aoN++ * 8;
    D[i] = x; D[i + 1] = y; D[i + 2] = z; D[i + 3] = a; D[i + 4] = r.u; D[i + 5] = r.v; D[i + 6] = r.w; D[i + 7] = r.h;
  }
  // setAo(r, g, b, k): this frame's tint (0..1) and strength; no call (or no stamp) = no contact shadows this frame
  function setAo(r, g, b, k) { aoFrame = frameNo; compU.uAo.value.set(r, g, b, k); }

  // ---- HD FX: soft effects at DISPLAY resolution over the pixel image (the HD-2D trick: pixel world, smooth light).
  // setDisplay(s): the canvas becomes s x the view; the composite renders into outRT (VW x VH) and is blown up with whole
  // pixels, then fx(...) particles draw on top, smooth: gaussian blobs, additive (fire, glow, embers) or blended (smoke),
  // each depth-tested against the pixel scene (soft particles: they fade out where the scene stands in front of them)
  let DS = 1;
  // the GAME's view (art px) and display scale as camera.js sets them (resize, setDisplay); VW / VH / DS are what is drawn:
  // the same, or finer while the cinema camera is on: setCine's c.px screen px a pixel (a whole number, so every pixel is
  // the same size on screen; at most the game's own scale). A perspective view moving at the art's resolution jumps a
  // whole art px, DS screen px, every few frames; finer it glides, and a sprite's texel is still a block. cineK = gS / px
  let gW = VW, gH = VH, gS = DS, cineK = 1, cinePx = 1, canW = 0, canH = 0;
  const outRT = new THREE.WebGLRenderTarget(VW, VH, {minFilter: near, magFilter: near, depthBuffer: false});
  // HEAT: heat(...) blobs (over flames) add up in heatRT (view res, smooth); where it's warm the blit reads the pixel image
  // a little to the side, in rising ripples, at display resolution: the pixels behind the hot air wobble smoothly
  const heatRT = new THREE.WebGLRenderTarget(VW, VH, {minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false});
  // (uSub: the sub-pixel camera's slide, canvas px, GL rows: setSubpixel below)
  const BLIT_FS = HEAD + `uniform sampler2D tOut, tHeat; uniform float uDS, uHeat, uT, uZ; uniform vec2 uRes, uSub; out vec4 oc;
void main() {
  vec2 p = (gl_FragCoord.xy + uSub) / uDS;
  if (uHeat > .5) {
    float s = min(.8, texture(tHeat, p / uRes).r);
    if (s > .003) {
      vec2 w = p / uZ;   // (the ripple's size in world terms: zoomed in, it's bigger)
      float a = sin(w.y * .8 - uT * 8.5 + sin(w.x * .33 + uT * 1.9) * 2.1), b = sin(w.y * 1.85 - uT * 13.5 + w.x * .27);
      p += vec2(a * .68 + b * .32, sin(w.x * .5 + w.y * .45 - uT * 6.3) * .35) * s * .75 * uZ;   // (under an art px)
    }
  }
  oc = texelFetch(tOut, ivec2(clamp(p, vec2(0.), uRes - 1.)), 0);
}`;
  const blitU = {tOut: {value: outRT.texture}, tHeat: {value: heatRT.texture}, uDS: {value: 1}, uHeat: {value: 0}, uT: {value: 0}, uZ: {value: 1}, uRes: {value: new THREE.Vector2(VW, VH)},
      uSub: {value: new THREE.Vector2()}},
    blitScene = new THREE.Scene();
  { const m = new THREE.Mesh(tri, raw(COMP_VS, BLIT_FS, blitU, {depthTest: false, depthWrite: false})); m.frustumCulled = false; m.matrixAutoUpdate = false; blitScene.add(m); }
  const FX_VS = HEAD + `
in vec3 position; in vec4 iPos; in vec4 iCol;   // iPos: world xyz + radius (m); iCol: rgb + alpha
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uPxM;   // NDC per metre of radius (x, y): round on screen
out vec2 vUv; out vec4 vCol;
void main() {
  vec4 c = projectionMatrix * viewMatrix * vec4(iPos.xyz, 1.);
  vUv = position.xy * 2. - 1.; vCol = iCol;
#ifdef CINE
  gl_Position = vec4(c.xy + vUv * iPos.w * uPxM, c.z, c.w);   // (the cinema camera: uPxM is its projection's scale, divided by the distance like the rest)
#else
  gl_Position = vec4(c.xy + vUv * iPos.w * uPxM * c.w, c.z, c.w);
#endif
}`;
  const FX_FS = HEAD + `
in vec2 vUv; in vec4 vCol;
uniform sampler2D tD; uniform float uDS, uR, uSoft, uSharp; uniform vec2 uSub; uniform vec4 uCine;
out vec4 oc;
#ifdef CINE
float linD(float z) { return 2. * uCine.y * uCine.z / (uCine.z + uCine.y - (z * 2. - 1.) * (uCine.z - uCine.y)); }   // the cinema camera's depth -> m
#endif
void main() {
  float r2 = dot(vUv, vUv); if (r2 > 1.) discard;
  float a = max(0., exp(-r2 * uSharp) - exp(-uSharp));
  float sd = texelFetch(tD, ivec2((gl_FragCoord.xy + uSub) / uDS), 0).r;   // (the scene's pixel under it, as the blit slid it: uSub)
  if (!(sd > .0005 && sd <= 1.)) sd = 1.;   // an unreadable depth (some drivers): draw rather than hide everything
#ifdef CINE
  float behind = linD(gl_FragCoord.z) - linD(sd);
#else
  float behind = (gl_FragCoord.z - sd) * 2. * uR;   // metres behind the scene
#endif
  a *= clamp(1. - behind / uSoft, 0., 1.);
  if (a <= .002) discard;
  oc = vec4(vCol.rgb, vCol.a * a);
}`;
  const fxU = {tD: {value: gbuf.depthTexture}, uDS: {value: 1}, uR: {value: R_DEPTH}, uSoft: {value: .14}, uSharp: {value: 3.2}, uPxM: {value: new THREE.Vector2()}, uSub: blitU.uSub, uCine: CINE};
  const HEAT_FS = HEAD + `
in vec2 vUv; in vec4 vCol;
uniform sampler2D tD; uniform float uR; uniform vec4 uCine;
out vec4 oc;
#ifdef CINE
float linD(float z) { return 2. * uCine.y * uCine.z / (uCine.z + uCine.y - (z * 2. - 1.) * (uCine.z - uCine.y)); }
#endif
void main() {
  float r2 = dot(vUv, vUv); if (r2 > 1.) discard;
  float sd = texelFetch(tD, ivec2(gl_FragCoord.xy), 0).r;
  if (!(sd > .0005 && sd <= 1.)) sd = 1.;
#ifdef CINE
  float a = (1. - r2) * (1. - r2) * clamp(1. - (linD(gl_FragCoord.z) - linD(sd)) / .3, 0., 1.);
#else
  float a = (1. - r2) * (1. - r2) * clamp(1. - (gl_FragCoord.z - sd) * 2. * uR / .3, 0., 1.);
#endif
  oc = vec4(a * vCol.a, 0., 0., 1.);
}`;
  const heatU = {tD: fxU.tD, uR: fxU.uR, uPxM: fxU.uPxM, uCine: CINE}, heatScene = new THREE.Scene();
  const fxScene = new THREE.Scene(), FXMAX = 6000, fxB = {};
  // EXTRA passes owned by other modules (render/flames.js, render/rigmesh.js): extra(mesh, 'gbuf' | 'fx' | 'shadow' | 'xray') puts a
  // mesh in the G-buffer, the HD fx pass, the per-frame sun shadow (a caster that moves: layer 0) or the player's x-ray mark
  // (R where the scene hides him: the live hero, view/livehero.js); it shows only on a frame
  // its owner armed (mesh.userData.frame = G.frame before render()), so a system that didn't run this frame (its feature
  // off, paused out) leaves nothing behind
  const gExtra = [], fxExtra = [], sExtra = [], xExtra = [];
  function extra(m, pass) { if (pass === 'fx') { fxScene.add(m); fxExtra.push(m); } else if (pass === 'shadow') { sScene.add(m); sExtra.push(m); } else if (pass === 'xray') { xScene.add(m); xExtra.push(m); } else { gScene.add(m); gExtra.push(m); } m.visible = false; }
  for (const [mode, blending] of [['add', THREE.AdditiveBlending], ['blend', THREE.NormalBlending]]) {
    const geo = new THREE.InstancedBufferGeometry(); geo.setAttribute('position', QUAD.getAttribute('position'));
    const P = new THREE.InstancedBufferAttribute(new Float32Array(FXMAX * 4), 4), C = new THREE.InstancedBufferAttribute(new Float32Array(FXMAX * 4), 4);
    P.setUsage(THREE.DynamicDrawUsage); C.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('iPos', P); geo.setAttribute('iCol', C);
    const m = new THREE.Mesh(geo, raw(FX_VS, FX_FS, fxU, {depthTest: false, depthWrite: false, transparent: true, blending}));
    m.frustumCulled = false; m.matrixAutoUpdate = false; m.renderOrder = mode === 'blend' ? 0 : 1; fxScene.add(m);   // smoke first, glow over it
    fxB[mode] = {geo, P, C, n: 0, m};
  }
  {
    const geo = new THREE.InstancedBufferGeometry(); geo.setAttribute('position', QUAD.getAttribute('position'));
    const P = new THREE.InstancedBufferAttribute(new Float32Array(1024 * 4), 4), C = new THREE.InstancedBufferAttribute(new Float32Array(1024 * 4), 4);
    P.setUsage(THREE.DynamicDrawUsage); C.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('iPos', P); geo.setAttribute('iCol', C);
    const m = new THREE.Mesh(geo, raw(FX_VS, HEAT_FS, heatU, {depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending}));
    m.frustumCulled = false; m.matrixAutoUpdate = false; heatScene.add(m);
    fxB.heat = {geo, P, C, n: 0, m, max: 1024};
  }
  const fxList = [fxB.add, fxB.blend];   // (heat is drawn into its own target)
  // ---- THE VIGNETTE + TOP HAZE (features/atmos.js, every frame it shows them: G.setVignette): the arena's drawOver, two canvas
  // gradients, worked out per display pixel and laid over everything in the canvas (they were a display-sized canvas blitted
  // into the HD overlay every frame: ~3% of the frame's JS). Stops as atmos.js painted them: the vignette radial (r .62 -> 1.42 of
  // the half-size, 7 stops, alpha va (i / 6)^1.8 rounded to 4 places), the haze linear over the top 30% (ha, .35 ha at .45, 0)
  const VG_FS = HEAD + `uniform vec4 uVg; uniform vec3 uVgC, uVhC; uniform vec2 uVgS; uniform float uVgP; out vec4 oc;
float vstop(float i) { return floor(uVg.y * pow(i / 6., 1.8) * 1e4 + .5) / 1e4; }
void main() {
  vec2 p = vec2(gl_FragCoord.x, uVgS.y + uVgP - gl_FragCoord.y);   // canvas px, y down (a pixel's centre), of what shows (uVgP: the sub-pixel pad's rows below it)
  float ah = 0.;
  if (uVg.z > 0. && p.y < uVgS.y * .3) { float t = p.y / (uVgS.y * .3); ah = t < .45 ? mix(uVg.z, uVg.z * .35, t / .45) : mix(uVg.z * .35, 0., (t - .45) / .55); }
  float x = clamp((length((p - uVgS * .5) / (uVgS * .5)) - .62) / .8, 0., 1.) * 6., i = min(floor(x), 5.), av = mix(vstop(i), vstop(i + 1.), x - i);
  float a = av + ah * (1. - av); if (a <= 0.) discard;   // (the vignette over the haze: source-over, as the canvas did)
  oc = vec4((uVgC * av + uVhC * ah * (1. - av)) / a, a);
}`;
  const vgU = {uVg: {value: new THREE.Vector4()}, uVgC: {value: new THREE.Vector3()}, uVhC: {value: new THREE.Vector3()}, uVgS: {value: new THREE.Vector2(1, 1)}, uVgP: {value: 0}}, vgScene = new THREE.Scene();
  { const m = new THREE.Mesh(tri, raw(COMP_VS, VG_FS, vgU, {depthTest: false, depthWrite: false, transparent: true, blending: THREE.NormalBlending})); m.frustumCulled = false; m.matrixAutoUpdate = false; vgScene.add(m); }
  vgScene.matrixAutoUpdate = false;
  let vgFrame = -1;
  // {va, ha (0 = no haze), v: [r, g, b], h: [r, g, b] (0..255)}: shown on the next render (atmos.js sets it from F.hd, after this one)
  function setVignette(o) {
    vgFrame = frameNo; vgU.uVg.value.set(1, o.va, o.ha, 0);
    vgU.uVgC.value.set(o.v[0] / 255, o.v[1] / 255, o.v[2] / 255); vgU.uVhC.value.set(o.h[0] / 255, o.h[1] / 255, o.h[2] / 255);
  }
  // heat(X, Y (up), Z, radius m, strength): hot air this frame (strength 1 = ~.75 art px of ripple at its middle)
  const HEATC = [1, 1, 1];   // (heat's colour: fx reads it at once)
  function heat(x, y, z, r, k) { fx(x, y, z, r, HEATC, k, 'heat'); }
  // fx(X, Y (up), Z, radius m, [r, g, b], alpha, 'add' | 'blend'): one soft particle this frame (world axes)
  function fx(x, y, z, r, c, a = 1, mode = 'add') {
    const B = fxB[mode]; if (!B || B.n >= (B.max || FXMAX)) return;
    const i = B.n * 4, P = B.P.array, C = B.C.array;
    P[i] = x; P[i + 1] = y; P[i + 2] = z; P[i + 3] = r; C[i] = c[0]; C[i + 1] = c[1]; C[i + 2] = c[2]; C[i + 3] = a; B.n++;
  }
  function setDisplay(s) { gS = Math.max(1, Math.round(s)); applySize(); }
  // SUB-PIXEL CAMERA (render/camera.js, every frame): setSubpixel(ex, ey, pad): the view is drawn from its target snapped DOWN to
  // the art lattice; ex, ey (art px, 0..1) is how far the true view lies right of / below it, and the view runs `pad` art px
  // past what the window shows, right and below. The blit slides the blown-up image left / up by the remainder, rounded to
  // whole canvas px (sub.x, sub.y <= 0: at most one art px, into the pad), so the view glides at display resolution while the
  // art stays put; the fx pass draws through the same slide (hdCam), the vignette keeps to what shows. The HD overlay's
  // world-anchored drawings (bars, bubbles, the HD bow) slide with it: G.hdShift(q, sc) before drawing them; the HUD doesn't.
  // sub is read by the cursor (core/input.js: what's under it is what's shown)
  const sub = {x: 0, y: 0, ex: 0, ey: 0, pad: 0};
  // (the cinema camera, setCine: no slide; it is drawn from its own camera, not the game's snapped view)
  function subApply() { sub.x = cine ? 0 : -Math.round(sub.ex * DS) || 0; sub.y = cine ? 0 : -Math.round(sub.ey * DS) || 0; blitU.uSub.value.set(-sub.x, sub.y); }
  function setSubpixel(ex, ey, pad = 0) { sub.ex = ex; sub.ey = ey; sub.pad = pad; subApply(); }
  // the overlay q (drawn at sc device px per view px) slid as the pixel image is
  const hdShift = (q, sc) => { if (sub.x || sub.y) q.translate(sub.x * sc / DS, sub.y * sc / DS); };
  // the fx pass's camera: the view's, its projection slid by the same whole canvas px (no allocation; only while it slides)
  const hdCam = new THREE.Camera(); hdCam.matrixWorldAutoUpdate = false;
  function hdCamNow() {
    hdCam.matrixWorld.copy(camera.matrixWorld); hdCam.matrixWorldInverse.copy(camera.matrixWorldInverse); hdCam.projectionMatrix.copy(camera.projectionMatrix);
    const e = hdCam.projectionMatrix.elements; e[12] += 2 * sub.x / (VW * DS); e[13] -= 2 * sub.y / (VH * DS);   // (w = 1: a shift in NDC)
    hdCam.projectionMatrixInverse.copy(hdCam.projectionMatrix).invert();
    return hdCam;
  }
  // resize(w, h): a new view size in art px (the window changed shape: ultrawide, fullscreen; main.js fit). The view-sized
  // targets and the screen layers follow; the projection, toScreen and the fx sizes read VW / VH every frame anyway
  function resize(w, h) { gW = w; gH = h; applySize(); }
  function applySize() {
    const s = cine ? Math.min(gS, cinePx) : gS, w = cine ? Math.ceil(gW * gS / s) : gW, h = cine ? Math.ceil(gH * gS / s) : gH;
    cineK = gS / s;
    if (w !== VW || h !== VH) {
      VW = w; VH = h;
      for (const rt of [gbuf, xray, outRT, heatRT]) rt.setSize(VW, VH);
      SNAP.value.set(VW, VH); compU.uRes.value.set(VW, VH); blitU.uRes.value.set(VW, VH);
      for (const L of layerList) { L.c.width = VW; L.c.height = VH; L.q.imageSmoothingEnabled = false; L.dirty = false; L.t.dispose(); L.t.needsUpdate = true; L.rt.setSize(VW, VH); }
    }
    if (s !== DS) { DS = s; blitU.uDS.value = fxU.uDS.value = s; subApply(); }
    if (gW * gS !== canW || gH * gS !== canH) { canW = gW * gS; canH = gH * gS; renderer.setSize(canW, canH, false); }   // (the canvas: the game's, whatever is drawn)
  }

  // ---- view: target (snapped to the pixel lattice by the caller), yaw, zoom
  const view = {T: new THREE.Vector3(), yaw: 0, zoom: 1};
  function oblique(c, T, yaw, zoom, w, h) {   // the game's projection into camera c, for a view of w x h art px
    c.position.copy(T); c.rotation.set(0, yaw, 0); c.updateMatrixWorld(true);
    const A = 2 * PPM * zoom / w, B = 2 * PPMH * zoom / h, C = 2 * PPMY * zoom / h, Nn = Math.hypot(PPMY, PPMH);
    c.projectionMatrix.set(A, 0, 0, 0, 0, B, -C, 0, 0, -PPMY / Nn / R_DEPTH, -PPMH / Nn / R_DEPTH, 0, 0, 0, 0, 1);
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
  }
  // the game's view as camera.js last set it: gcam always (at the game's own size), what is drawn unless the cinema camera is set
  const gT = new THREE.Vector3(); let gYaw = 0, gZoom = 1;
  function setView(T, yaw, zoom) {
    gT.copy(T); gYaw = yaw; gZoom = zoom;
    oblique(gcam, T, yaw, zoom, gW, gH);
    if (cine) cineView(); else gameView();
  }
  function gameView() {
    const yaw = gYaw, zoom = gZoom;
    view.T.copy(gT); view.yaw = yaw; view.zoom = zoom;
    oblique(camera, gT, yaw, zoom, VW, VH);
    compU.uView.value.set(Math.sin(yaw) * .93969, .34202, Math.cos(yaw) * .93969);   // the sprite camera's toward-the-viewer
    U.camYaw.value = yaw; compU.uWPx.value.set(PPM, PPM * zoom);
    U.leanX.value.set(Math.cos(yaw) / PPM, 0, -Math.sin(yaw) / PPM); U.leanY.value.set(Math.sin(yaw) / PPMY, 0, Math.cos(yaw) / PPMY);   // art px -> m
  }
  // the cinema camera (features/cinema.js), in place of the view while it is set: c = {pos, look (Vector3, m), fov (deg,
  // vertical), near, far (m), air (1/m: the distance fog), sky: {zen, hor, sun (rgb 0..1), dir (toward the sun), disk (rad)}}.
  // It is read at every setView (the camera calls that every frame) and at setCine: view.T = what it looks at (the sun's
  // shadow box centres there), view.yaw = its heading (the cards turn to it), view.zoom = cineK (its resolution over the
  // view's: what is drawn in px, puffs, flashes, flames, points, is that much bigger). setCine(null): the game's own view again
  const _cf = new THREE.Vector3();
  function cineView() {
    const c = cine;
    view.T.copy(c.look); view.zoom = cineK; PTK.value = cineK;   // (zoom: what is drawn in px is k x: puffs, flashes, flames, points)
    camera.position.copy(c.pos); camera.up.set(0, 1, 0); camera.lookAt(c.look); camera.updateMatrixWorld(true);
    cinePC.fov = c.fov; cinePC.aspect = VW / VH; cinePC.near = c.near ?? .15; cinePC.far = c.far ?? 400; cinePC.updateProjectionMatrix();
    camera.projectionMatrix.copy(cinePC.projectionMatrix); camera.projectionMatrixInverse.copy(cinePC.projectionMatrixInverse);
    const f = _cf.subVectors(c.look, c.pos).normalize(), yaw = Math.atan2(-f.x, -f.z);
    view.yaw = yaw; U.camYaw.value = yaw;
    CINE.value.set(1, cinePC.near, cinePC.far, c.air ?? .012);
    compU.uCamP.value.copy(c.pos); compU.uView.value.set(-f.x, -f.y, -f.z); compU.uWPx.value.set(PPM, PPM);   // (uView: toward the viewer)
    U.leanX.value.set(Math.cos(yaw) / PPM, 0, -Math.sin(yaw) / PPM); U.leanY.value.set(Math.sin(yaw) / PPMY, 0, Math.cos(yaw) / PPMY);
    const s = c.sky;
    if (s) { compU.uSkyZ.value.fromArray(s.zen); compU.uSkyH.value.fromArray(s.hor); compU.uSunCol.value.fromArray(s.sun); compU.uSunP.value.set(s.dir[0], s.dir[1], s.dir[2], Math.cos(s.disk ?? .03)); }
  }
  function setCine(c) {
    const was = !!cine; cine = c || null;
    if (!cine) CINE.value.x = 0; else cinePx = Math.max(1, Math.round(c.px || 1e9));   // (none: the art's own pixels)
    if (was !== !!cine) for (const m of cineMats) setDef(m, !!cine);
    applySize();
    if (cine) cineView(); else if (was) gameView();   // (at once: a frame drawn before the next setView sees the right camera)
    subApply();
  }
  // world -> internal-canvas px (y down), for halos / HUD / tests: through what is drawn (the cinema camera while it is set;
  // a point behind it lands far off the screen, so nothing is drawn for it mirrored)
  const _v = new THREE.Vector3();
  const behind = () => cine && !(_v.z >= -1 && _v.z <= 1);
  function toScreen(x, y, z) { _v.set(x, y, z).project(camera); if (behind()) return [-1e5, -1e5, _v.z]; return [(_v.x + 1) / 2 * VW, (1 - _v.y) / 2 * VH, _v.z]; }
  // the same into out (3 numbers), no allocation: for per-frame loops
  function toScreenInto(x, y, z, out) { _v.set(x, y, z).project(camera); if (behind()) { out[0] = out[1] = -1e5; out[2] = _v.z; return out; } out[0] = (_v.x + 1) / 2 * VW; out[1] = (1 - _v.y) / 2 * VH; out[2] = _v.z; return out; }
  // the same through the GAME's view (gcam), into out: for the sim (the cursor's aim, the lasso's pick)
  function gameToScreen(x, y, z, out) { _v.set(x, y, z).project(gcam); out[0] = (_v.x + 1) / 2 * gW; out[1] = (1 - _v.y) / 2 * gH; out[2] = _v.z; return out; }
  // view px per metre at a world point (a size in metres there -> px): the oblique view's PPM x zoom; through the cinema
  // camera the perspective's at that distance (0 behind it)
  const _pw = new THREE.Vector4();
  function pxPerM(x, y, z) {
    if (!cine) return PPM * view.zoom;
    const d = -_pw.set(x, y, z, 1).applyMatrix4(camera.matrixWorldInverse).z;
    return d > .05 ? camera.projectionMatrix.elements[5] * VH / 2 / d : 0;
  }
  // is world (X, Y up, Z) on screen, give or take m view px? (allocation-free: for culling effects every frame)
  function onScreen(x, y, z, m = 0) { _v.set(x, y, z).project(camera); if (behind()) return false; const sx = (_v.x + 1) / 2 * VW, sy = (1 - _v.y) / 2 * VH; return sx > -m && sx < VW + m && sy > -m && sy < VH + m; }

  // ---- sun: direction toward the sun (world), shadow camera snapped to its texel grid around the view target
  // dir: the sun as it LIGHTS (shading, rims, glints); sdir: the sun as it CASTS shadows (same azimuth, the elevation
  // the caller wants for shadow length; main.js keeps the arena's longest shadow), default the same.
  // The shadows are cast along sCast, which follows sdir in steps of SUN_STEP (a jump, a new hour: at once), the per-frame
  // map with the static one: a map turned a hair every frame rasterised every edge a hair differently every frame, so the
  // tree shadows shimmered and the god rays (render/godrays.js, marched through both maps) boiled. A step moves a long
  // shadow's tip a few cm (an art px at most); the shading keeps the smooth dir
  const _sl = new THREE.Vector3(), _sr = new THREE.Vector3(), _su = new THREE.Vector3();
  function setSun(dir, sdir = dir) {
    compU.uSunDir.value.copy(dir); sunNow.copy(sdir).normalize();
    if (!(sunNow.dot(sCast) >= Math.cos(SUN_STEP))) sCast.copy(sunNow);   // (the first call: sCast is 0)
    U.sunYaw.value = Math.atan2(dir.x, dir.z);   // cards turned so their face points at the sun (normal = (sin, 0, cos))
    const T = view.T, texel = 2 * SHADOW_E / SM;
    sunCam.position.copy(T).addScaledVector(sCast, 100); sunCam.lookAt(T); sunCam.updateMatrixWorld(true);
    // snap: move the light camera so the WORLD's origin sits on a texel corner in light space: the texel grid stays put in the
    // world as the view moves (no shadow crawl while walking; render/godrays.js samples it at fixed world points). (It took the
    // target, which always sits at the light camera's centre: a no-op, and the map slid by fractions of a texel with the view)
    const lt = _sl.set(0, 0, 0).applyMatrix4(sunCam.matrixWorldInverse);
    const dx = lt.x - Math.round(lt.x / texel) * texel, dy = lt.y - Math.round(lt.y / texel) * texel;
    const right = _sr.setFromMatrixColumn(sunCam.matrixWorld, 0), up = _su.setFromMatrixColumn(sunCam.matrixWorld, 1);
    sunCam.position.addScaledVector(right, dx).addScaledVector(up, dy); sunCam.updateMatrixWorld(true);
    compU.uLightPV.value.multiplyMatrices(sunCam.projectionMatrix, sunCam.matrixWorldInverse);
  }

  let waterSpeed = 1, waterT = -1;
  // the fx blobs' NDC per metre of radius: the oblique view's px per metre; the cinema camera's projection scale (FX_VS divides it by the distance)
  const fxPxM = () => cine ? fxU.uPxM.value.set(camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5]) : fxU.uPxM.value.set(2 * PPM * view.zoom / VW, 2 * PPM * view.zoom / VH);
  // POST (photo mode, render/photofx.js): setPost(p) sends the finished frame into p.target (a target the canvas's size)
  // instead of the canvas, then p.run(renderer) draws it on; p.still holds the shaders' clocks (the leaves' flutter, the
  // water, the heat ripple): the world stands still. setPost(null): the frame goes to the canvas as before
  let post = null;
  const setPost = p => { post = p || null; };
  const stats = {ms: 0, calls: 0, sprites: 0, points: 0, lines: 0, pass: {}};
  function render() {
    const t0 = performance.now(), still = post !== null && post.still;
    if (gDecal) U.decalT.value = imgTex(gDecal);   // (a GPU context's image: used this frame, so it isn't let go)
    if (rflFrame !== frameNo) compU.uRf.value.x = 0;   // (the reflections, clouds and haze show only on frames depth.js set them)
    if (clFrame !== frameNo) compU.uCl.value.x = 0;
    if (hzFrame !== frameNo) compU.uHz.value.x = 0;
    if (!still) U.time.value = (t0 / 1000) % 3600;
    const dtw = waterT < 0 || still ? 0 : Math.min(.1, (t0 - waterT) / 1000); waterT = t0;   // the water's clock: its own, so G.setWater never makes the pattern jump
    U.wPhase.value = (U.wPhase.value + dtw * waterSpeed) % 65536;
    flushBatches(); syncCards(); packCards();
    let ns = 0; for (const g2 of groups.values()) ns += g2.n;
    stats.sprites = ns; stats.points = nPoints; stats.lines = nLines;
    if (!hDirty && moved.size && movedEnough()) hDirty = true;
    renderer.setClearColor(0x000000, 0);
    // stats.pass: CPU ms + draw calls of each pass this frame (F3 shows them; the bench reads them)
    const PS = stats.pass; let tp = performance.now();
    const lap = (k, calls) => { const t = performance.now(); PS[k] = t - tp; tp = t; if (calls !== undefined) PS[k + 'N'] = calls; };
    lap('prep');
    for (const t of ups) renderer.initTexture(t);
    uploadData();
    ups.length = 0; lap('upload');
    drawLayers();
    const lay = compU.uLay.value, on = n => +(layers[n].runs.length > 0);
    lay.set(on('ground'), on('pre'), on('front'), on('add')); compU.uLayE.value = on('emit'); compU.uLayD.value = on('distort');
    if (cine) {   // the cinema camera: the screen layers, cloud shadows, heat haze and reflections are painted for the oblique view
      lay.set(0, 0, 0, 0); compU.uLayE.value = compU.uLayD.value = 0; compU.uCl.value.x = compU.uHz.value.x = compU.uRf.value.x = 0;
    }
    lap('layers');
    for (const s of litters) s.run();   // the fallen leaves' field (render/litter.js): the ticks that are due; the ground shader reads the result
    lap('litter');
    PS.shadowN = PS.hmapN = PS.shadowSN = 0; PS.shadowS = 0;
    // movers that have been still long enough go back to the static map (switched over AT its re-render: no gap)
    for (const S of movers) if (!S.back && ++S.still > STILL_FRAMES) { S.back = true; staticSoon(20); }
    compU.uSOn.value = STATIC_SHADOW ? 1 : 0;
    for (const m of sExtra) m.visible = m.userData.frame === frameNo;   // (extra casters: before the shadow passes)
    if (compU.uShadowA.value > 0 && compU.uShadowOn.value > .5) {
      if (STATIC_SHADOW && sFollow) {   // a big world: the static box follows the view, on its lattice
        const cx = Math.round(view.T.x / SSTEP) * SSTEP, cz = Math.round(view.T.z / SSTEP) * SSTEP;
        if (cx !== sCx || cz !== sCz) { sCx = cx; sCz = cz; SBOX[0] = cx - SFOLLOW; SBOX[1] = cx + SFOLLOW; SBOX[4] = cz - SFOLLOW; SBOX[5] = cz + SFOLLOW; sDue = Math.min(sDue, frameNo); }
      }
      if (STATIC_SHADOW && (frameNo >= sDue || !sDir.equals(sCast))) {
        for (const S of movers) if (S.back) { S.moving = S.back = false; S.sm.layers.enable(2); S.sm.layers.disable(0); sScene.remove(S.sm); sStatic.add(S.sm); movers.delete(S); }
        sDir.copy(sCast); fitStatic(sDir); sDue = Infinity;
        renderer.setRenderTarget(shadowS); renderer.clear(true, true, false); renderer.render(sStatic, sunCamS); renderer.render(sScene, sunCamS);   // (sScene: a layer-2 caster added from outside)
        lap('shadowS', renderer.info.render.calls);
        rays.restatic();   // (render/godrays.js: its min map of the static shadow follows)
      }
      renderer.setRenderTarget(shadow); renderer.clear(true, true, false); renderer.render(sScene, sunCam);
      lap('shadow', renderer.info.render.calls);
    } else PS.shadow = 0;
    if (hDirty && compU.uPtShadow.value > 0) {
      renderer.setRenderTarget(hmap); renderer.clear(true, true, false); renderer.render(sStatic, hCam); renderer.render(sScene, hCam); hDirty = false;
      for (const H of moved) H.hm.copy(H.sm.matrix);
      lap('hmap', renderer.info.render.calls);
    } else { PS.hmap = 0; tp = performance.now(); }
    moved.clear();
    for (const m of gExtra) m.visible = m.userData.frame === frameNo;
    renderer.setRenderTarget(gbuf); renderer.clear(true, true, false); renderer.render(gScene, camera);
    const calls = renderer.info.render.calls;
    lap('gbuf', calls);
    for (const m of xExtra) m.visible = m.userData.frame === frameNo;
    renderer.setRenderTarget(xray); renderer.clear(true, false, false); if (!cine) renderer.render(xScene, camera);   // (no x-ray, no contact
    if (aoFrame !== frameNo || cine) aoN = 0;                                                                         // shadows: the cinema camera)
    compU.uAo.value.w = aoN ? compU.uAo.value.w : 0;
    if (aoN) { aoGeo.instanceCount = aoN; setRange(aoBuf, 0, aoN * 8); renderer.render(aoScene, dummyCam); }
    compU.uInvPV.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    if (msFrame !== frameNo) { compU.uMist.value.x = 0; mist.on = false; } else mistAnchors();
    const fxN = fxB.add.n + fxB.blend.n, hN = fxB.heat.n;
    let fxX = 0; for (const m of fxExtra) { m.visible = m.userData.frame === frameNo; if (m.visible) fxX++; }
    if (DS > 1 || fxN || fxX || hN) {   // the HD path: the pixel image into outRT, blown up, the soft particles over it
      renderer.setRenderTarget(outRT); renderer.render(compScene, dummyCam); if (!cine) rays.draw();
      if (hN) {
        const B = fxB.heat; B.geo.instanceCount = hN; upload(B.P, hN); upload(B.C, hN);
        fxPxM();
        renderer.setRenderTarget(heatRT); renderer.clear(true, false, false); renderer.render(heatScene, camera);
      }
      blitU.uHeat.value = hN ? 1 : 0; if (!still) blitU.uT.value = performance.now() / 1000 % 1000; blitU.uZ.value = view.zoom;
      renderer.setRenderTarget(post && post.target); renderer.render(blitScene, dummyCam);
      if (fxN || fxX) {
        fxPxM();
        for (const B of fxList) { B.geo.instanceCount = B.n; B.m.visible = B.n > 0; upload(B.P, B.n); upload(B.C, B.n); }
        renderer.render(fxScene, sub.x || sub.y ? hdCamNow() : camera);   // (slid as the blit slid the image: setSubpixel)
      }
    } else { renderer.setRenderTarget(post && post.target); renderer.render(compScene, dummyCam); if (!cine) rays.draw(); }
    if (vgFrame === frameNo) { vgU.uVgS.value.set((VW - sub.pad) * DS, (VH - sub.pad) * DS); vgU.uVgP.value = sub.pad * DS; renderer.render(vgScene, dummyCam); }   // the vignette + haze, over all of it (what shows: no pad)
    if (post) post.run(renderer);
    lap('post');
    stats.fx = fxN; stats.heat = hN; fxB.add.n = fxB.blend.n = fxB.heat.n = 0;
    stats.calls = calls; stats.ms = stats.ms * .9 + (performance.now() - t0) * .1;
    resetBatches(); for (const L of layerList) { L.used = L.gUsed = false; clearArray(L.runs); } lbN = 0; frameNo++;
  }

  // SETTINGS other modules give the renderer (they call these; the uniforms stay the renderer's): the player options
  // (render/options.js), the ground's sampling blend (render/camera.js), the weather's look and lightning
  // (features/weather.js), where the player stands (view/hero.js: the composite lights him a hair apart)
  function setOptions({outline, banded, shadows, debug}) {
    compU.uOutline.value = outline ? 1 : 0; compU.uBanded.value = banded ? 1 : 0;
    compU.uShadowOn.value = compU.uPtShadow.value = shadows ? 1 : 0; compU.uDebug.value = debug;
  }
  const setSmooth = v => { U.smooth.value = v; };
  function setSeason(m) { compU.uSeasonM.value.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]); }
  // the fallen leaves' amount (SURF_FS): they start as the first leaves turn and pile up as the crowns thin, so the most lies where
  // autumn ends, through the winter (under the snow, which covers it in the composite) and into spring, fading as the crowns fill out
  // again (leafK rising, autumn already back at 0). 0 in summer (autumn 0, leafK 1: the ground shader skips it). Old leaves are brown
  // (turn 1) once autumn has passed
  const LIT = {byAutumn: .3};
  function setGround({tinted, snow, wet, leafK, autumn = 0}) {
    compU.uSeasonK.value = tinted ? 1 : 0; compU.uSnow.value = snow; compU.uWet.value = wet; U.leafK.value = leafK; U.autumn.value = autumn;
    const fell = Math.min(1, Math.max(0, LIT.byAutumn * autumn + 1 - leafK));
    U.litK.value.set(fell, autumn > .001 ? Math.max(autumn, 1 - leafK) : fell > 0 ? 1 : 0, 0, 0);
  }
  // the living layer of fallen leaves for a litter object (world.js makeLitter): render/litter.js. The owner (features/litter.js) drives it
  // through the returned object (advance, give, take, want, release, wind, mirror); render() runs it. Disposed with the world
  const litters = new Set();
  function litterSim(lit) {
    const s = createLitterSim(renderer, lit, () => U.litK.value.x), d = s.dispose;
    litters.add(s); s.dispose = () => { litters.delete(s); d(); }; return s;
  }
  const setFlash = (r, g, b) => { compU.uFlashC.value.set(r, g, b); };
  // the reflections in the water (features/depth.js, every frame it shows them; COMP_FS reflAt): {on, tint: [r, g, b] 0..1, tintK,
  // alpha, glow, S (view px per metre of height), ripple (px), gust (0..1), t (the ripple's clock, s), oy (the world origin's view
  // row), zoom, reach (px to search up), puddleA (the puddles' ground-layer alpha x 255, 0 = none), pool: {x, y, rx, ry} | null}
  // the cloud shadows (features/depth.js, every frame it shows them; COMP_FS, render/clouds.js): {lv (Uint8Array TW x 2 TH: the
  // noise's bins, / 4 then the last 2 bits), TW, TH, ver (bump when lv changed: re-uploaded), col [r, g, b] 0..1, a1, a2 (the two
  // levels' alpha), T [4] (the levels' thresholds: ahead of a front / behind it), m [4] (view px -> texel), e, f (the tile's
  // origin in view px), Q [4] (the noise's quantile bins at .2 .. .8), front: null | {dir [2], s, band [2], bend [3] (m, rad / m,
  // phase), storm, arrive, grey [3], greyK, darkK, sunK}}. The haze (ember's lava): {mask (Uint8Array W x H, 255 = lava), W, H, ver, band (px), zoom, t (s),
  // m [4], e, f (view -> mask texel at the lava's height), oy (the world origin's view row)}
  // the shared top-down texture (tTop): the cloud levels at the top, the lava's mask under them; rebuilt and re-uploaded only
  // when one of them changes (the cover in 1/16 steps; the mask once per world)
  const top = {cl: null, clW: 0, clH: 0, hz: null, hzW: 0, hzH: 0, dirty: false};
  function topUpload() {
    const W = Math.max(top.clW, top.hzW, 1), H = top.clH + top.hzH || 1, d = new Uint8Array(W * H);
    for (let y = 0; y < top.clH; y++) d.set(top.cl.subarray(y * top.clW, (y + 1) * top.clW), y * W);
    for (let y = 0; y < top.hzH; y++) d.set(top.hz.subarray(y * top.hzW, (y + 1) * top.hzW), (top.clH + y) * W);
    // (the one texture made at the start, re-sized: three draws Math.random for a new texture's id, which would shift every
    // seeded random after it in a golden capture)
    const t = compU.tTop.value; t.dispose(); t.image = {data: d, width: W, height: H}; t.needsUpdate = true;
    compU.uTopH.value.set(top.hzW, top.hzH, top.clH, 0); top.dirty = false;
  }
  let clFrame = -1, clVer = -1, hzFrame = -1, hzVer = -1;
  function setClouds(o) {
    clFrame = frameNo; const C = compU;
    if (o.ver !== clVer) { clVer = o.ver; top.cl = o.lv; top.clW = o.TW; top.clH = o.lv.length / o.TW; topUpload(); }
    C.uCl.value.set(1, o.a1, o.a2, 0); C.uClC.value.set(o.col[0], o.col[1], o.col[2]);
    C.uClM.value.set(o.m[0], o.m[1], o.m[2], o.m[3]); C.uClO.value.set(o.e, o.f, o.TW, o.TH); C.uClT.value.set(o.T[0], o.T[1], o.T[2], o.T[3]); C.uFrQ.value.set(o.Q[0], o.Q[1], o.Q[2], o.Q[3]);
    const f = o.front;
    if (!f) { C.uFr.value.w = 0; C.uFrS.value.x = 0; return; }
    C.uFr.value.set(f.dir[0], f.dir[1], f.s, 1); C.uFrB.value.set(f.band[0], f.band[1], f.bend[0], f.bend[1]);
    C.uFrK.value.set(f.storm, f.arrive ? 1 : 0, f.greyK, f.darkK); C.uFrC.value.set(f.grey[0], f.grey[1], f.grey[2], f.bend[2]); C.uFrS.value.set(f.sunK, 0, 0, 0);
  }
  function setHaze(o) {
    hzFrame = frameNo; const C = compU;
    if (o.ver !== hzVer) { hzVer = o.ver; top.hz = o.mask; top.hzW = o.W; top.hzH = o.H; topUpload(); }
    C.uHz.value.set(1, o.band, o.zoom, o.t); C.uHzM.value.set(o.m[0], o.m[1], o.m[2], o.m[3]); C.uHzO.value.set(o.e, o.f, o.oy, 0);
  }
  let rflFrame = -1;
  function setReflect(o) {
    rflFrame = frameNo; const C = compU, p = o.pool;
    C.uRf.value.set(o.on ? 1 : 0, o.tintK, o.alpha, o.glow); C.uRfC.value.set(o.tint[0], o.tint[1], o.tint[2]);
    C.uRfW.value.set(o.S, o.ripple, o.gust, o.t); C.uRfV.value.set(o.oy, o.zoom, o.reach, o.puddleA || 0);
    C.uRfP.value.set(p ? p.x : 0, p ? p.y : 0, p ? p.rx : 0, p ? p.ry : 0);
  }
  // THE MIST (features/mist.js, every frame it shows it; COMP_FS MIST): {top (m), sigma (1 / m), alpha, col: [r, g, b] 0..1, light,
  // water (m), reach (m), amp (m), freq (1 / m), drift: [x, z] (m), aerial, far, levels, dither (px), medium 0..1, max (m), segs (Float32Array,
  // 8 numbers a stretch of water: x0, z0, x1, z1, half width, its water's height, 0, 0), n (stretches), ver (bump when segs changed)}.
  // A frame without a call: no mist (the old screen haze). G.mist: what shows now, read-only ({on, medium, top, max}: the medium's
  // density for light through the air; in COMP_FS, mistAt(P))
  let msFrame = -1, msVer = -1;
  const mist = {on: false, medium: 0, top: 0, max: 0}, MS3 = [0, 0, 0];
  function setMist(o) {
    msFrame = frameNo; const C = compU;
    C.uMist.value.set(1, o.top, o.sigma, o.alpha); C.uMistC.value.set(o.col[0], o.col[1], o.col[2], o.light);
    C.uMistW.value.set(o.water, o.reach, o.amp, o.freq); C.uMistD.value.x = o.drift[0]; C.uMistD.value.y = o.drift[1]; C.uMistD.value.z = o.aerial;
    C.uMistQ.value.x = o.levels; C.uMistQ.value.y = o.dither; C.uMistQ.value.w = Math.min(MIST_N, o.n); C.uMistK.value.set(o.medium, o.max, o.far ?? 1, 0);
    if (o.ver !== msVer) {
      msVer = o.ver; const s = o.segs;
      for (let i = 0; i < MIST_N; i++) { const j = i * 8; if (i < o.n) { C.uMistS.value[i].set(s[j], s[j + 1], s[j + 2], s[j + 3]); C.uMistH.value[i].set(s[j + 4], s[j + 5], 0, 0); } else C.uMistH.value[i].set(0, -1e3, 0, 0); }
    }
    mist.on = true; mist.medium = o.medium; mist.top = o.top; mist.max = o.max;
  }
  // (render, after the view is set) the world origin's screen pixel, made whole (its fraction is the same every frame: the camera moves
  // in whole pixels), the dither's cell (a world texel: zoom px), the view's centre on the ground and its half depth (m)
  function mistAnchors() {
    const z = view.zoom, up = view.T.y * PPMH / PPMY, C = compU;
    toScreenInto(0, 0, 0, MS3);
    C.uMistO.value.set(Math.floor(MS3[0] + .25), Math.floor(VH - MS3[1] + .25), view.T.x - Math.sin(view.yaw) * up, view.T.z - Math.cos(view.yaw) * up);
    C.uMistQ.value.z = Math.max(1, Math.floor(z + .01)); C.uMistD.value.w = VH / 2 / (PPMY * z);
  }
  // (sun: how far toward the sun his shadow test looks, .5 m; a live 3D body would shade its own test point: view/livehero.js)
  const setPlayer = (x, h, z, sun = .5) => { compU.uPlayer.value.set(x, h, z); compU.uPlayerSun.value = sun; U.wFoot.value.set(x, h - .9, z, 1); };   // (h: his chest, .9 m over his feet: the water rings them when he wades)
  // the water's clock runs at `speed` times normal (1 = the river as tuned; brief D's rain quickens it): a multiplier on the rate it
  // advances at, so changing it never makes the pattern jump
  const setWater = ({speed} = {}) => { if (speed !== undefined) waterSpeed = Math.max(0, +speed || 0); };
  // the biome's water (world.js buildWorld, at every build, from WATER_TUNE): {ramp: [[r, g, b] 0..1] light -> dark (padded to 4), rate,
  // across, along, hi, lo, range: [lightest, darkest] tone, lap (tone | -1), refl, spark} | null = no moving water (the rift)
  function setWaterLook(L) {
    const B = L?.bed;   // the depth, bed and contact foam (world/waterbed.js: {tex, rect, cuts, op, tone, hiOp, tint, hue, lum, dark, refr, foam}; none: the old water)
    U.wBed.value = B ? B.tex : null; U.wBedOn.value = B ? 1 : 0;
    if (B) { U.wBedR.value.set(...B.rect); U.wCut.value.set(...B.cuts, B.refr); U.wOp.value.set(...B.op); U.wTone.value.set(...B.tone); U.wLook.value.set(B.hiOp, B.hue, B.lum, B.dark); U.wTint.value.set(...B.tint); U.wFoam.value.set(...B.foam); }
    if (!L) { compU.uWRefl.value.set(0, 0, 0, 0); return; }
    for (let i = 0; i < 4; i++) U.wRamp.value[i].set(...L.ramp[Math.min(i, L.ramp.length - 1)]);
    U.wA.value.set(L.rate, L.across, L.along, L.lap); U.wB.value.set(L.hi, L.lo, L.range[0], L.range[1]);
    compU.uWRefl.value.set(L.refl, L.spark, 0, 0);
  }
  return {THREE, renderer, gScene, sScene, xScene, camera, sunCam, U, compU, view, stats, get VW() { return VW; }, get VH() { return VH; },
    get frame() { return frameNo; }, extra, shaders: {HEAD, POINT_FS, FX_FS},   // (render/flames.js: its own passes, the same shaders)
    setView, setCine, cineMat, get cine() { return cine; }, setSun, toScreen, toScreenInto, gameToScreen, pxPerM, onScreen, render, card, mesh, surface, line, point, sprite, layer, glayer, touch, dataImage, tex, texData, glStats, QUAD, setGroundDecals,
    fx, heat, setDisplay, resize, fxU, get display() { return DS; }, setPost, setSubpixel, hdShift, sub,
    godrays: rays, setRays: rays.set,   // (render/godrays.js: render/lighting.js sets its strength; features/depth.js asks if it's on)
    setOptions, setSmooth, get smooth() { return U.smooth.value; }, setSeason, setGround, setFlash, setPlayer, setWater, setWaterLook, litterSim, setReflect, setClouds, setHaze, setVignette, aoStamp, ao, setAo, get aoEpoch() { return aoEpoch; },
    setMist, get mist() { return mist; }};
}
