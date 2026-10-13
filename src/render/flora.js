// FLORA (render side): the low plants (world/flora3d.js shapes) drawn INSTANCED, one draw per shape for every plant using it, plus a
// shadow draw per casting mesh shape (the per-frame sun shadow, sScene layer 0: they sway). ~130 plants a map in ~10-16 draws.
//   mesh shapes   gfx.js MESH_FS's rules, instanced: the biome's ramp families, per-pixel light, the leaf clusters' tone, the season's
//                 thinning (uLeafK), the biome's cover (snow / ash / moss on what faces up), the glowing families; G-buffer type 2, so
//                 the composite outlines and seams them like every prop (the leaves are the soft family). The plant's AUTUMN (the
//                 plants' own palettes, world.js plantOf: kind, seed, delay, its two paths' 4 stages x 4 tones in a palette row) as the
//                 cards had it (gfx.js plantTurn): it turns in patches (3D cells in its own frame), the sun side and the top first
//   blade shapes  strips drawn like render/grass.js's blades: the root on the art pixel lattice, every row a whole number of px from it,
//                 w px wide; lit as GROUND (type 1, its normal up: the composite shadows, snows on, wets and season-tints them like the
//                 grass); a turned blade is tone 2 (its own colours, outside the season's matrix); obj = the plant's (the x-ray)
// THE WIND: the lean per plant comes from the wind's spring (world.js: the mesh hook, projected, with hysteresis) in art px (x along the
// screen, y toward the camera), rounded to whole px per vertex by its flex weight (gfx.js SWAY), + the clumps' own flutter. CINE (the
// cinema camera, gfx.js setCine): no whole-pixel steps; the blades are divided by w (a perspective), as grass.js's variant.
// API: createFlora(G) -> {shape(key, sh, o) -> group, add(group, x, h, z, yaw, scale, obj, plant) -> handle, remove(handle),
//   setLean(handle, x, y, flut), setVisible(handle, v), setFlash(handle, k), setPlace(handle, x, h, z), setRamps(ramps), commit(),
//   dispose(), groups, count}
//   plant: world.js plantOf's {kind, seed, delay, ramp, pal} | null (no autumn)
// OWNS: its meshes (in G.gScene / G.sScene), the instance buffers, the palette texture.  READS: G.U (ramps, cover, light, lean axes,
//   time, leaf season, autumn), G.cineMat.
// BUDGET: CPU: commit() uploads only groups whose instances changed (~16 floats a plant); the per-plant lean is world.js's. GPU: one
//   instanced draw per shape + its shadow.
import * as THREE from 'three';
import {CUT, cutU} from './cut.js';   // the cutaway (a plant goes by its root's height)

const HEAD = `precision highp float; precision highp int;\n`;
const OUTS = `layout(location = 0) out vec4 o0;\nlayout(location = 1) out vec4 o1;\nlayout(location = 2) out vec4 o2;\n`;
const STRIDE = 16;
// THE SEASON'S THINNING on a plant (uLeafK, sim/env.js leafK): finer than the crowns' (gaps of ~2 cm, not holes of ~18: a thinned bush keeps
// its dome, just sparser) and never below LEAF_MIN of a full one (it keeps its leaves through the winter, withered: the autumn's last stage)
const LEAF_MIN = '.62', THIN = 'vn3(vPL * 26. + vec3(sd.y, 1.7, sd.x))';
function popRanges() { const u = this.updateRanges; while (u.length) u.pop(); }   // floats an instance: iT (x, h, z, yaw), iS (scale, obj, flash, visible), iL (lean x, lean y, flutter, seed), iA (autumn kind, seed, delay, palette row)

// ---- shared GLSL: the instance's place and sway (as gfx.js SWAY), the noises (as gfx.js MESH_FS)
const INST = `
in vec4 iT; in vec4 iS; in vec4 iL; in vec4 iA;
uniform mat4 viewMatrix, projectionMatrix; uniform vec3 uLeanX, uLeanY; uniform float uTime;
vec3 turn(vec3 p) { float c = cos(iT.w), s = sin(iT.w); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }   // (three's makeRotationY)
vec3 swayOf(float flex, float ph) {
  vec2 l = iL.xy * flex;
  if (ph >= 0.) { float f = 1.6 + fract(ph * 3.7) * 1.6; l += iL.z * vec2(sin(uTime * f * 6.2832 + ph + iL.w * 6.2832), .6 * sin(uTime * f * 4.4 + ph * 1.7)); }
#ifdef CINE
  return uLeanX * l.x + uLeanY * l.y;
#else
  vec2 s = floor(l + .5); return uLeanX * s.x + uLeanY * s.y;
#endif
}
`;
const NOISE = `
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
`;
// the plant's autumn stage at a patch: (the card's plantTurn) d = its delay + the patch's draw + how little sun it faces; 4 stages by autumn 1
const AUTUMN = `
uniform sampler2D uPal; uniform float uAutumn;
vec3 pal(float row, int k) { return texelFetch(uPal, ivec2(k, int(row + .5)), 0).rgb; }
int stageOf(float kind, float delay, float r1, float e) {
  float d = delay + r1 * (kind < 2.5 ? .24 : .16) + (1. - e) * (kind < 2.5 ? .3 : .22);
  float k = clamp((uAutumn - d) / max(.08, 1. - d), 0., 1.);
  return int(min(4., floor(k * 5.)));
}
`;

// ---------------------------------------------------------------- the mesh plants
const MESH_VS = HEAD + INST + `
in vec3 position; in vec3 normal; in float aPart; in float aFam; in float aBias; in float aFixed; in float aFlex; in float aPhase;
flat out vec3 fR; out vec3 vN; out vec3 vNL; out vec3 vPL; flat out float fPart; flat out float fFam; flat out float fBias; flat out float fFixed; flat out vec4 fS; flat out vec4 fA; flat out float fSeed; flat out float fYaw;
void main() {
  if (iS.w < .5) { gl_Position = vec4(2., 2., 2., 1.); return; }   // (hidden: off the clip volume)
  fYaw = iT.w; fR = iT.xyz;
  vec3 w = iT.xyz + turn(position * iS.x) + swayOf(aFlex, aPhase);
  vN = turn(normal); vNL = normal; vPL = position;
  fPart = aPart; fFam = aFam; fBias = aBias; fFixed = aFixed; fS = iS; fA = iA; fSeed = iL.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
}`;
const MESH_FS = HEAD + OUTS + NOISE + AUTUMN + CUT + `
flat in vec3 fR; in vec3 vN; in vec3 vNL; in vec3 vPL; flat in float fPart; flat in float fFam; flat in float fBias; flat in float fFixed; flat in vec4 fS; flat in vec4 fA; flat in float fSeed; flat in float fYaw;
uniform sampler2D uRamps; uniform vec3 uLArt; uniform vec3 uCover; uniform vec2 uEmitFam; uniform float uLeafK; uniform vec4 uLeaf;
vec3 h33(vec3 p) { p = fract(p * vec3(.1031, .103, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float leafCell(vec3 P, out vec3 rel) {   // (gfx.js MESH_FS)
  vec3 qi = floor(P), qf = fract(P); float f1 = 9., f2 = 9.; rel = vec3(0.);
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z)), r = g + h33(qi + g) - qf; float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; rel = -r; } else if (d < f2) f2 = d;
  }
  return sqrt(f2) - sqrt(f1);
}
vec3 patchOf(vec3 P) {   // the nearest of a 3D lattice's jittered points: its cell (the autumn patch)
  vec3 qi = floor(P), qf = fract(P), best = qi; float f1 = 9.;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z)), r = g + .12 + h33(qi + g) * .76 - qf; float d = dot(r, r);
    if (d < f1) { f1 = d; best = qi + g; }
  }
  return best;
}
void main() {
  if (cutAway(fR + vec3(0., .05, 0.))) discard;   // (the cutaway: render/cut.js)
  bool leaf = fFixed < -1.5, inner = !gl_FrontFacing;
  if (inner && (!leaf || uLeafK >= .999)) discard;
  vec2 sd = vec2(fSeed * 37.1, fSeed * 11.3);
  if (leaf && uLeafK < .999 && ${THIN} > max(uLeafK, ${LEAF_MIN}) * 1.1 - .05) discard;   // (the season thins the leaves: gfx.js LEAF_GONE; a plant keeps some, withered, through the winter)
  vec3 n = normalize(vN); if (inner) n = -n;
  float fam = fFam; int tone;
  if (fFixed >= 0.) tone = int(fFixed);
  else if (inner) tone = 2;
  else {
    float d = dot(n, uLArt) + fBias; bool crescent = false;
    if (fFixed < -1.9) { float jn = vn3(vPL * 7.5 + vec3(sd.x, 0., sd.y));   // (the leaf clusters; -1.75: plain leaves, a fern's fronds)
      if (uLeaf.w > .5) { vec3 rel; float b = leafCell(vPL / uLeaf.x + vec3(sd.x, 0., sd.y) * .31, rel); d += (jn - .5) * .2 + rel.y * uLeaf.y; crescent = b < uLeaf.z && rel.y < -.05; }
      else d += (jn - .5) * .42; }
    tone = d > .62 ? 0 : d > .12 ? 1 : 2;
    if (crescent) tone = min(tone + 1, 2);
  }
  // the biome's cover on what faces up at rest (gfx.js MESH_FS): -1 and the needles under snow (-2.5); never the leaves (-2) nor -1.45
  if (uCover.x > 0. && normalize(vNL).y > uCover.y && ((fFixed < 0. && fFixed > -1.1) || (fFixed < -2.25 && fFixed > -2.75))) {
    vec2 q = vPL.xz * 1.7 + sd; float c = vn(q * 7.) * .7 + vn(q * 19. + 3.) * .3;
    if (c > 1. - uCover.x * 2.6) fam = uCover.z;
  }
  vec3 alb = texelFetch(uRamps, ivec2(tone, int(fam + .5)), 0).rgb;
  // the plant's autumn: leaves of a plant with a palette (fA.x kind), in patches ~16 cm across, the sun side (south, up: the world's) first
  bool own = false;
  if (leaf && fA.x > .5 && uAutumn > 0. && abs(fam - fFam) < .5) {
    vec3 c = patchOf(vPL / .16 + fA.y * 13.), pc = (c + .5) * .16 - fA.y * 13. * .16, dl = normalize(pc - vec3(0., .2, 0.) + vec3(0., .001, 0.));   // the patch's place round the plant's middle
    float r1 = h3(c + fA.y * 31. + 1.7), r2 = h3(c + fA.y * 7. + 3.1), cy = cos(fYaw), sy = sin(fYaw);
    float e = clamp(dot(vec3(dl.x * cy + dl.z * sy, dl.y, -dl.x * sy + dl.z * cy), vec3(0., .622, .783)) * .5 + .5, 0., 1.);   // (its exposure to a noon sun: south and up, in the world)
    int st = stageOf(fA.x, fA.z, r1, e);
    if (st > 0) { alb = pal(fA.w, 4 + (r2 > .8 ? 16 : 0) + (st - 1) * 4 + tone); own = true; }
  }
  bool glow = abs(fam - uEmitFam.x) < .5 || abs(fam - uEmitFam.y) < .5;
  o0 = vec4(alb, float(2 * 4 + tone) / 255.);
  o1 = vec4(n, fS.y);
  o2 = vec4((glow ? alb : vec3(0.)) + vec3(fS.z), fam < 31.5 ? fPart * 32. + fam : -(fPart * 32. + fam - 32.) - 1.);   // (gfx.js: the sign carries a family past 31)
}`;
// its sun shadow: the same leaned pose, minus the leaves the season took
const SHADOW_VS = HEAD + INST + `
in vec3 position; in float aFixed; in float aFlex; in float aPhase;
out vec3 vPL; flat out float fFixed; flat out float fSeed;
void main() {
  if (iS.w < .5) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vec3 w = iT.xyz + turn(position * iS.x) + swayOf(aFlex, aPhase);
  vPL = position; fFixed = aFixed; fSeed = iL.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
}`;
const SHADOW_FS = HEAD + `layout(location = 0) out vec4 o0;\n` + NOISE + `
in vec3 vPL; flat in float fFixed; flat in float fSeed; uniform float uLeafK;
void main() { vec2 sd = vec2(fSeed * 37.1, fSeed * 11.3); if (fFixed < -1.5 && uLeafK < .999 && ${THIN} > max(uLeafK, ${LEAF_MIN}) * 1.1 - .05) discard; o0 = vec4(1.); }`;

// ---------------------------------------------------------------- the blade plants (render/grass.js's blades, one plant's worth a shape)
const BLADE_VS = HEAD + INST + `
in vec3 position;   // x: side (-.5 / .5), y: f 0 .. 1 along the run
in vec3 aR; in vec3 aM; in vec3 aT; in vec4 aB; in vec4 aC;   // root, ctrl, tip (m, the plant's frame); (t0, t1, width px, colour); (flex u0, power, plant height, phase)
uniform vec2 uRes; uniform float uZoom; uniform vec3 uRamp[16];
flat out vec3 vR; out float vF; out float vSide; out float vT; flat out vec3 vC0; flat out vec3 vC1; flat out vec3 vC2; flat out ivec3 vTn; flat out vec4 vX; flat out vec4 vA;
void main() {
  if (iS.w < .5) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vR = iT.xyz; float t = mix(aB.x, aB.y, position.y), k = 1. - t;
  vec3 bl = aR * k * k + aM * 2. * k * t + aT * t * t;   // the curve at t
  vec3 root = iT.xyz + turn(aR * iS.x), pw = iT.xyz + turn(bl * iS.x);
  float u = clamp(bl.y / aC.z, 0., 1.), fw = u < aC.x ? 0. : pow((u - aC.x) / max(.01, 1. - aC.x), aC.y);
  vec2 lean = vec2(iL.x, -iL.y) * fw * (1. + .18 * sin(uTime * (1.7 + aC.w * 1.3) + aC.w * 6.2832));   // (art px: y toward the camera is down the screen)
  mat4 PV = projectionMatrix * viewMatrix;
  vec4 cr = PV * vec4(root, 1.), cp = PV * vec4(pw, 1.);
#ifdef CINE
  if (cr.w < .05 || cp.w < .05) { gl_Position = vec4(2., 2., 2., 1.); return; }
  float cz = cp.z / cp.w - .03 * -projectionMatrix[3][2] / (cp.w * cp.w);
  cr.xy /= cr.w; cp.xy /= cp.w;
  vec2 S = uRes / uZoom * .5, sr = (cr.xy + 1.) * S, pc = (cp.xy + 1.) * S + lean;
  pc.x += position.x * aB.z;
  gl_Position = vec4(pc / S - 1., cz, 1.);
#else
  vec2 S = uRes / uZoom * .5;   // NDC -> art px (y up)
  vec2 sr = (cr.xy + 1.) * S, rc = floor(sr) + .5;
  vec2 pc = rc + floor((cp.xy + 1.) * S - sr + .5) + floor(lean + .5);
  pc.x += position.x * aB.z + (mod(aB.z, 2.) < .5 ? .5 : 0.);
  if (position.y < .01) pc.y -= .5; else if (position.y > .99) pc.y += .5;   // (the run's first and last rows are whole pixels)
  gl_Position = vec4(pc / S - 1., cp.z - .00025, 1.);
#endif
  vF = position.y; vSide = position.x; vT = t;
  int ci = int(aB.w + .5), rp = ci / 4 * 4, sc = ci - ci / 4 * 4;
  // the run's three tones (ramp indices, light 0 .. dark 3): a blade (0) foot / body / tip 2 1 0, a dim blade (2) 3 2 1; a head (1) its left /
  // middle / right column 0 1 2; the light tone (3: snow on a head) 0 0 0
  vTn = sc == 0 ? ivec3(2, 1, 0) : sc == 2 ? ivec3(3, 2, 1) : sc == 1 ? ivec3(0, 1, 2) : ivec3(0);
  vC0 = uRamp[rp + vTn.x]; vC1 = uRamp[rp + vTn.y]; vC2 = uRamp[rp + vTn.z];
  vX = vec4(float(sc), iS.y, iS.z, aC.w); vA = iA;
}`;
const BLADE_FS = HEAD + OUTS + AUTUMN + CUT + `
flat in vec3 vR; in float vF; in float vSide; in float vT; flat in vec3 vC0; flat in vec3 vC1; flat in vec3 vC2; flat in ivec3 vTn; flat in vec4 vX; flat in vec4 vA;
float hh(float a, float b) { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }
void main() {
  if (cutAway(vR + vec3(0., .05, 0.))) discard;   // (the cutaway: render/cut.js)
  int sc = int(vX.x + .5), tn;
  vec3 c;
  if (sc == 1) { int k = vSide < -.2 ? 0 : vSide > .2 ? 2 : 1; if (vF < .12) k = 2; c = k == 0 ? vC0 : k == 2 ? vC2 : vC1; tn = k == 0 ? vTn.x : k == 2 ? vTn.z : vTn.y; }   // a head: lit left, its foot in shade
  else { int k = vT < .22 ? 0 : vT > .8 ? 2 : 1; c = k == 0 ? vC0 : k == 2 ? vC2 : vC1; tn = k == 0 ? vTn.x : k == 2 ? vTn.z : vTn.y; }   // foot / body / tip
  int own = 0;
  if (vA.x > .5 && uAutumn > 0. && sc != 1 && sc != 3) {   // a turned blade: its own colours, the tips first (the card's blades)
    float cell = floor(vT * 3.), r1 = hh(vX.w * 97. + cell, vA.y * 31. + 1.7), r2 = hh(vX.w * 53. + cell, vA.y * 7. + 3.1), e = clamp(1.08 - (1. - vT) * .95, 0., 1.);
    int st = stageOf(vA.x, vA.z, r1, e);
    if (st > 0) { c = pal(vA.w, 4 + (r2 > .8 ? 16 : 0) + (st - 1) * 4 + min(tn, 3)); own = 1; }
  }
  o0 = vec4(c, float(4 + (own == 1 ? 2 : 0)) / 255.);   // type 1: lit as ground (tone 1 would be WATER: never)
  o1 = vec4(0., 1., 0., vX.y);
  o2 = vec4(vec3(vX.z), 0.);
}`;

export function createFlora(G) {
  const raw = (vs, fs, uniforms, extra = {}) => G.cineMat(new THREE.RawShaderMaterial({vertexShader: vs, fragmentShader: fs, uniforms, glslVersion: THREE.GLSL3, ...extra}));
  const U = G.U;
  // the palettes (plantOf's): a row of 36 RGBA floats per (palette, green ramp): 4 green tones, then the 32 tones of its two paths
  const palRows = new Map(); let palData = new Float32Array(36 * 4), palN = 0;
  const palTex = new THREE.DataTexture(palData, 36, 1, THREE.RGBAFormat, THREE.FloatType), palU = {value: palTex};
  palTex.minFilter = palTex.magFilter = THREE.NearestFilter; palTex.generateMipmaps = false; palTex.needsUpdate = true;
  function palRow(pl) {
    const key = pl.pal.map(c => c.join()).join('|') + '#' + pl.ramp.map(c => c.join()).join('|');
    let r = palRows.get(key); if (r !== undefined) return r;
    r = palN++; palRows.set(key, r);
    if (palN * 36 * 4 > palData.length) { const d = new Float32Array(palData.length * 2); d.set(palData); palData = d; }
    const o = r * 36 * 4, put = (c, i) => { palData[o + i * 4] = c[0]; palData[o + i * 4 + 1] = c[1]; palData[o + i * 4 + 2] = c[2]; palData[o + i * 4 + 3] = 1; };
    pl.ramp.forEach((c, i) => put(c, i)); pl.pal.forEach((c, i) => put(c, 4 + i));
    palTex.dispose(); palTex.image = {data: palData, width: 36, height: palData.length / (36 * 4)}; palTex.needsUpdate = true;
    return r;
  }
  const ramps = {value: Array.from({length: 16}, () => new THREE.Vector3())};
  const res = {value: new THREE.Vector2(G.VW, G.VH)}, zoom = {value: 1};
  const meshU = {...cutU(U), uRamps: U.ramps, uLArt: U.lArt, uCover: U.cover, uEmitFam: U.emitFam, uLeafK: U.leafK, uLeaf: U.leaf, uAutumn: U.autumn, uPal: palU,
    uLeanX: U.leanX, uLeanY: U.leanY, uTime: U.time};
  const meshMat = raw(MESH_VS, MESH_FS, meshU, {side: THREE.DoubleSide});
  const shadowMat = raw(SHADOW_VS, SHADOW_FS, {uLeanX: U.leanX, uLeanY: U.leanY, uTime: U.time, uLeafK: U.leafK}, {side: THREE.DoubleSide});
  const bladeMat = raw(BLADE_VS, BLADE_FS, {...cutU(U), uRes: res, uZoom: zoom, uRamp: ramps, uLeanX: U.leanX, uLeanY: U.leanY, uTime: U.time, uAutumn: U.autumn, uPal: palU}, {side: THREE.DoubleSide});

  const groups = [];
  // a shape's group: its base geometry's attributes + the instance buffer; kind 'mesh' | 'blade'; o.casts: a shadow draw too; o.cull:
  // frustum culled as a whole (a sphere round its instances, o.pad m past their roots: the shape's reach; for groups that never sway
  // and sit together, world/decor3d.js's per-cell groups; worked out on change in commit)
  function shape(key, geo, kind, o = {}) {
    let g = groups.find(q => q.key === key && q.kind === kind); if (g) return g;
    const ig = new THREE.InstancedBufferGeometry();
    for (const [name, a] of Object.entries(geo.attributes)) ig.setAttribute(name, a);
    if (geo.index) ig.setIndex(geo.index);
    const cap = 16, data = new Float32Array(cap * STRIDE);
    g = {key, kind, geo: ig, cap, data, ib: null, n: 0, dirty: true, items: [], gm: null, sm: null, pad: o.cull ? o.pad || 1 : 0};
    if (g.pad) ig.boundingSphere = new THREE.Sphere();
    bind(g);
    g.gm = new THREE.Mesh(ig, kind === 'mesh' ? meshMat : bladeMat); g.gm.frustumCulled = false; g.gm.matrixAutoUpdate = false; G.gScene.add(g.gm);
    if (kind === 'mesh' && o.casts) { g.sm = new THREE.Mesh(ig, shadowMat); g.sm.frustumCulled = false; g.sm.matrixAutoUpdate = false; G.sScene.add(g.sm); }
    if (g.pad) { g.gm.frustumCulled = true; if (g.sm) g.sm.frustumCulled = true; }
    ig.instanceCount = 0; g.gm.visible = false; if (g.sm) g.sm.visible = false;
    groups.push(g); return g;
  }
  function bind(g) {
    const ib = new THREE.InstancedInterleavedBuffer(g.data, STRIDE, 1); ib.setUsage(THREE.DynamicDrawUsage);
    g.range ??= {start: 0, count: 0}; ib.clearUpdateRanges = popRanges;   // (three empties the list after the upload: by pop, so no new store a frame)
    ['iT', 'iS', 'iL', 'iA'].forEach((k, i) => g.geo.setAttribute(k, new THREE.InterleavedBufferAttribute(ib, 4, i * 4)));
    g.ib = ib; g.geo._maxInstanceCount = undefined;   // (three works the instance limit out once: a regrown buffer must clear it, gfx.js regrown)
  }
  // a plant's instance in a group -> its handle {g, i}
  function add(g, x, h, z, yaw, scale, obj, plant, seed) {
    if (g.n >= g.cap) { const d = new Float32Array(g.cap * 2 * STRIDE); d.set(g.data); g.data = d; g.cap *= 2; bind(g); }
    const H = {g, i: g.n++}, o = H.i * STRIDE, D = g.data;
    D[o] = x; D[o + 1] = h; D[o + 2] = z; D[o + 3] = yaw; D[o + 4] = scale; D[o + 5] = obj; D[o + 6] = 0; D[o + 7] = 1;
    D[o + 8] = 0; D[o + 9] = 0; D[o + 10] = 0; D[o + 11] = seed;
    D[o + 12] = plant ? plant.kind : 0; D[o + 13] = plant ? plant.seed : 0; D[o + 14] = plant ? plant.delay : 0; D[o + 15] = plant ? palRow(plant) : 0;
    g.items.push(H); g.dirty = true; return H;
  }
  function remove(H) {   // swap-remove: the group's last instance takes its slot
    const g = H.g, last = g.items[g.n - 1];
    if (last !== H) { g.data.copyWithin(H.i * STRIDE, last.i * STRIDE, last.i * STRIDE + STRIDE); last.i = H.i; g.items[H.i] = last; }
    g.items.pop(); g.n--; g.dirty = true; H.g = null;
  }
  const put = (H, k, v) => { if (!H.g) return; const o = H.i * STRIDE + k; if (H.g.data[o] !== v) { H.g.data[o] = v; H.g.dirty = true; } };
  // (positional arguments, no objects: called for every plant every frame)
  function setLean(H, x, y, flut) { put(H, 8, x); put(H, 9, y); put(H, 10, flut); }
  function setVisible(H, v) { put(H, 7, v ? 1 : 0); }
  function setFlash(H, k) { put(H, 6, k); }
  function setPlace(H, x, h, z) { put(H, 0, x); put(H, 1, h); put(H, 2, z); }
  function setRamps(R) { for (let r = 0; r < 4; r++) for (let t = 0; t < 4; t++) ramps.value[r * 4 + t].set(...(R[r]?.[t] || [0, 0, 0])); }
  // once a frame, after the plants were set: the view's size for the blades, the changed groups uploaded
  function commit() {
    res.value.set(G.VW, G.VH); zoom.value = G.view.zoom || 1;
    for (const g of groups) {
      g.geo.instanceCount = g.n; g.gm.visible = g.n > 0; if (g.sm) g.sm.visible = g.n > 0;
      if (g.dirty && g.n) { const r = g.ib.updateRanges; while (r.length) r.pop(); g.range.count = g.n * STRIDE; r.push(g.range); g.ib.needsUpdate = true; if (g.pad) bound(g); }   // (one kept range object: gfx.js setRange)
      g.dirty = false;
    }
  }
  function bound(g) {   // (o.cull: the sphere round its instances' roots, + pad x the largest scale)
    const D = g.data; let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9, sc = 0;
    for (let i = 0; i < g.n; i++) { const o = i * STRIDE; x0 = Math.min(x0, D[o]); x1 = Math.max(x1, D[o]); y0 = Math.min(y0, D[o + 1]); y1 = Math.max(y1, D[o + 1]); z0 = Math.min(z0, D[o + 2]); z1 = Math.max(z1, D[o + 2]); sc = Math.max(sc, D[o + 4]); }
    const S = g.geo.boundingSphere; S.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); S.radius = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + g.pad * sc;
  }
  function dispose() {
    for (const g of groups) {   // (the shape's own attributes and index belong to its cached geometry: only the instance buffer goes)
      G.gScene.remove(g.gm); if (g.sm) G.sScene.remove(g.sm);
      for (const k of Object.keys(g.geo.attributes)) if (!['iT', 'iS', 'iL', 'iA'].includes(k)) g.geo.deleteAttribute(k);
      g.geo.setIndex(null); g.geo.dispose();
    }
    groups.length = 0; meshMat.dispose(); shadowMat.dispose(); bladeMat.dispose(); palTex.dispose();
  }
  return {shape, add, remove, setLean, setVisible, setFlash, setPlace, setRamps, commit, dispose, groups, get count() { return groups.reduce((s, g) => s + g.n, 0); }};
}
