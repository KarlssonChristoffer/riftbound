// GFX: the HD-2D test renderer. A real 3D scene drawn through the arena's own OBLIQUE projection (ground x sin 55,
// heights x cos 20), turned to any yaw, at the arena's pixel resolution, lit on the GPU in the arena's language.
//
// Pipeline per frame (all at VW x VH, nearest everywhere; the canvas is scaled up by CSS, image-rendering: pixelated):
//   1. shadow   the sun's depth map (meshes as they are; billboards as cards turned toward the sun)
//   2. gbuffer  every visible thing writes 3 targets + depth:
//                 A  rgb albedo, a = (type * 4 + tone) / 255
//                 N  xyz world normal, w = object id (whole numbers; a wall line shares one id: no outline at joints)
//                 E  rgb emissive, w = part * 32 + family (meshes: seams between parts of the same family)
//               types: 0 empty, 1 ground, 2 ramp mesh (live 3D prop), 3 billboard (painted sprite), 4 character,
//                      5 textured surface (cliff faces), 6 line (arrows), 7 lit card (a prop pre-rendered at 16 angles)
//   3. x-ray    the player's card again, marking pixels where the scene hides it
//   4. light    full-screen: outlines / seams / occlusion lines on meshes (the pixelizer's rules, live), then the arena's
//               lighting model (ambient multiply + point-light pools with the soft knee, sun shadows tinted toward the
//               mood's shadow colour, wrapped N.L shaping in 3 bands, character fill + grade, emitters, halos, fog)
//
// World axes: X east, Y up, Z south (arena x, h, y). Metres.
import * as THREE from 'three';

export const DEG = Math.PI / 180;
const R_DEPTH = 120;   // metres of "nearness" mapped onto the depth range (the world is 62 x 30 m)

const HEAD = `precision highp float; precision highp int;\n`;
const OUTS = `layout(location = 0) out vec4 o0;\nlayout(location = 1) out vec4 o1;\nlayout(location = 2) out vec4 o2;\n`;

// ---------------------------------------------------------------- shaders: gbuffer
const MESH_VS = HEAD + `
in vec3 position; in vec3 normal; in float aPart; in float aFam; in float aBias; in float aFixed;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vN; out vec3 vW; flat out float fPart; flat out float fFam; flat out float fBias; flat out float fFixed;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.);
  vW = w.xyz; vN = mat3(modelMatrix) * normal;
  fPart = aPart; fFam = aFam; fBias = aBias; fFixed = aFixed;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const MESH_FS = HEAD + OUTS + `
in vec3 vN; in vec3 vW; flat in float fPart; flat in float fFam; flat in float fBias; flat in float fFixed;
uniform sampler2D uRamps; uniform vec3 uLArt; uniform float uObj, uFlash;
uniform vec3 uCover;      // x: amount (0 = none), y: up threshold, z: cover family
uniform vec2 uEmitFam;    // families that glow in this biome (-1 = none)
float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 n = normalize(vN);
  float fam = fFam;
  int tone;
  if (fFixed >= 0.) tone = int(fFixed);
  else { float d = dot(n, uLArt) + fBias; tone = d > .62 ? 0 : d > .12 ? 1 : 2; }
  // biome cover (moss / ash / snow) on what faces up: patchy, never on the glow / void families
  if (uCover.x > 0. && n.y > uCover.y && fFixed < 0.) {
    float c = vn(vW.xz * 7.) * .7 + vn(vW.xz * 19. + 3.) * .3;
    if (c > 1. - uCover.x * 2.6) fam = uCover.z;
  }
  vec3 alb = texelFetch(uRamps, ivec2(tone, int(fam + .5)), 0).rgb;
  bool glow = abs(fam - uEmitFam.x) < .5 || abs(fam - uEmitFam.y) < .5;
  o0 = vec4(alb, float(2 * 4 + tone) / 255.);
  o1 = vec4(n, uObj);
  o2 = vec4((glow ? alb : vec3(0.)) + vec3(uFlash), fPart * 32. + fam);
}`;

// ground and textured surfaces: world-planar (ground) or uv (faces) mapping, nearest or "smooth pixel" sampling
const SURF_VS = HEAD + `
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform float uPlanar; uniform vec2 uWorld;
out vec2 vUv; out vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.);
  vUv = uPlanar > .5 ? w.xz / uWorld : uv;
  vN = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const SURF_FS = HEAD + OUTS + `
in vec2 vUv; in vec3 vN;
uniform sampler2D uTex, uEm; uniform vec2 uTexSize; uniform float uSmooth, uHasEm, uType, uObj;
// uSmooth 0..1 blends the two samplings, so the host can fade between them (crisp at rest, smooth while turning)
void main() {
  vec2 t = vUv * uTexSize, s = floor(t + .5), d = max(fwidth(t), vec2(1e-4));
  vec2 uvN = (floor(t) + .5) / uTexSize;                               // nearest (texel centre under bilinear)
  vec2 uvS = (s + clamp((t - s) / d, -.5, .5)) / uTexSize;            // smooth-pixel: sharp, blended only across texel seams
  vec4 c = uSmooth <= 0. ? texture(uTex, uvN) : uSmooth >= 1. ? texture(uTex, uvS) : mix(texture(uTex, uvN), texture(uTex, uvS), uSmooth);
  if (c.a < .5) discard;
  vec3 em = vec3(0.);
  if (uHasEm > .5) { vec4 e = mix(texture(uEm, uvN), texture(uEm, uvS), uSmooth); em = e.rgb * e.a; }
  o0 = vec4(c.rgb, float(int(uType) * 4) / 255.);
  o1 = vec4(normalize(vN), uObj);
  o2 = vec4(em, 0.);
}`;

// billboards: a unit quad turned to face uFaceYaw, sized so one sprite pixel = one screen pixel (x: 1/PPM m, y: 1/PPMH m)
const CARD_VS = HEAD + `
in vec3 position;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uAnchor; uniform vec2 uSize, uPivot; uniform float uFaceYaw, uBias; uniform vec2 uPx; uniform vec4 uRect;
uniform vec2 uSnap;   // view size in px: the anchor lands on a whole pixel, so every sprite texel is one screen pixel (0 = off)
uniform vec2 uOff; uniform float uSway;   // px offset (x right, y up: a hit wobble, a hop) and sway (px at the top: wind)
out vec2 vUv; out vec2 vC;
void main() {
  vec2 c = position.xy;
  vec3 right = vec3(cos(uFaceYaw), 0., -sin(uFaceYaw));
  float px = c.x * uSize.x - uPivot.x + uOff.x + uSway * c.y, py = uPivot.y - (1. - c.y) * uSize.y + uOff.y;
  vec3 w = uAnchor + right * (px / uPx.x) + vec3(0., py / uPx.y, 0.);
  vC = vec2(c.x, 1. - c.y);
  vUv = uRect.xy + vC * uRect.zw;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
  if (uSnap.x > 0.) {
    vec4 a = projectionMatrix * viewMatrix * vec4(uAnchor, 1.);
    vec2 p = (a.xy * .5 + .5) * uSnap;
    gl_Position.xy += (floor(p + .5) - p) / uSnap * 2.;
  }
  gl_Position.z -= uBias * gl_Position.w;
}`;
const CARD_FS = HEAD + OUTS + `
in vec2 vUv; in vec2 vC;
uniform sampler2D uTex, uNrm, uEm; uniform vec4 uNrmRect;
uniform float uHasNrm, uHasEm, uType, uObj, uCamYaw, uFlash;
void main() {
  vec4 c = texture(uTex, vUv), e = uHasEm > .5 ? texture(uEm, vUv) : vec4(0.);
  if (c.a < .5 && e.a < .5) discard;
  if (c.a < .5) c.rgb = e.rgb;   // emit-only pixels (a flame above its bowl): painted too, like wind.js's flameAlbedo
  vec3 F = vec3(sin(uCamYaw), 0., cos(uCamYaw)), R = vec3(cos(uCamYaw), 0., -sin(uCamYaw));
  const float S20 = .34202, C20 = .93969;
  vec3 U20 = vec3(0., C20, 0.) - F * S20, F20 = vec3(0., S20, 0.) + F * C20;
  vec3 n = normalize(F20 + vec3(0., .25, 0.));
  if (uHasNrm > .5) {
    vec4 t = texture(uNrm, uNrmRect.xy + vC * uNrmRect.zw);
    if (t.a > .5) { vec3 q = t.xyz * 2. - 1.; n = normalize(q.x * R + q.y * U20 + q.z * F20); }
  }
  o0 = vec4(c.rgb, float(int(uType) * 4) / 255.);
  o1 = vec4(n, uObj);
  o2 = vec4(e.rgb * e.a + vec3(uFlash), 0.);
}`;
const LINE_VS = HEAD + `
in vec3 position; in vec4 color;   // a = emissive (1) or lit (0)
uniform mat4 viewMatrix, projectionMatrix;
out vec4 vCol;
void main() { vCol = color; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); gl_Position.z -= .004 * gl_Position.w; }`;
const LINE_FS = HEAD + OUTS + `
in vec4 vCol;
void main() { o0 = vec4(vCol.rgb, float(6 * 4) / 255.); o1 = vec4(0., 1., 0., 7.); o2 = vec4(vCol.rgb * vCol.a, 0.); }`;

// the sprite batch: many small billboards per draw (one draw per source image). Per instance: anchor (world), uv rect,
// size + pivot (px), misc (alpha: ordered dither below 1, flipX, sway px at the top, flash 0..1)
const BATCH_VS = HEAD + `
in vec3 position; in vec3 iAnchor; in vec4 iRect; in vec4 iSize; in vec4 iMisc;
uniform mat4 viewMatrix, projectionMatrix;
uniform float uFaceYaw, uBias; uniform vec2 uPx, uSnap;
out vec2 vUv; out vec2 vC; flat out vec4 vMisc;
void main() {
  vec2 c = position.xy;
  vec3 right = vec3(cos(uFaceYaw), 0., -sin(uFaceYaw));
  float px = c.x * iSize.x - iSize.z + iMisc.z * c.y, py = iSize.w - (1. - c.y) * iSize.y;
  vec3 w = iAnchor + right * (px / uPx.x) + vec3(0., py / uPx.y, 0.);
  vC = vec2(iMisc.y > .5 ? 1. - c.x : c.x, 1. - c.y);
  vUv = iRect.xy + vC * iRect.zw; vMisc = iMisc;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
  if (uSnap.x > 0.) {
    vec4 a = projectionMatrix * viewMatrix * vec4(iAnchor, 1.);
    vec2 p = (a.xy * .5 + .5) * uSnap;
    gl_Position.xy += (floor(p + .5) - p) / uSnap * 2.;
  }
  gl_Position.z -= uBias * gl_Position.w;
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
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uSnap;
out vec4 vCol; flat out float vAlpha;
void main() {
  vCol = color; vAlpha = aMisc.y;
  vec4 p = projectionMatrix * viewMatrix * vec4(position, 1.);
  vec2 s = (p.xy * .5 + .5) * uSnap;
  vec2 c = mod(aMisc.x, 2.) > .5 ? floor(s) + .5 : floor(s + .5);   // odd sizes centre on a pixel, even on a corner
  gl_Position = vec4(c / uSnap * 2. - 1., p.z - .003, 1.);
  gl_PointSize = aMisc.x;
}`;
const POINT_FS = HEAD + OUTS + BAYER + `
in vec4 vCol; flat in float vAlpha;
void main() {
  if (vAlpha < .999 && vAlpha <= bayer(ivec2(gl_FragCoord.xy))) discard;
  o0 = vec4(vCol.rgb, float(3 * 4) / 255.); o1 = vec4(0., 1., 0., 9.); o2 = vec4(vCol.rgb * vCol.a, 0.);
}`;

// ---------------------------------------------------------------- shaders: shadow + x-ray (single target)
const ONE_OUT = `layout(location = 0) out vec4 o0;\n`;
const SHADOW_MESH_VS = HEAD + `
in vec3 position; uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }`;
const SHADOW_FS = HEAD + ONE_OUT + `void main() { o0 = vec4(1.); }`;
const SHADOW_CARD_FS = HEAD + ONE_OUT + `
in vec2 vUv; in vec2 vC; uniform sampler2D uTex;
void main() { if (texture(uTex, vUv).a < .5) discard; o0 = vec4(1.); }`;
const XRAY_FS = HEAD + ONE_OUT + `
in vec2 vUv; in vec2 vC; uniform sampler2D uTex, uDepth;
void main() {
  if (texture(uTex, vUv).a < .5) discard;
  float sd = texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r;
  if (gl_FragCoord.z <= sd + 1.5e-4) discard;   // visible here: not x-rayed
  o0 = vec4(1.);
}`;

// ---------------------------------------------------------------- shader: lighting / composite
const NL = 16;
const COMP_VS = HEAD + `in vec3 position; void main() { gl_Position = vec4(position.xy, 0., 1.); }`;
const COMP_FS = HEAD + `
uniform sampler2D tA, tN, tE, tD, tS, tX, uRamps;
uniform mat4 uInvPV, uLightPV;
uniform vec2 uRes; uniform float uR;
uniform vec3 uBg, uAmb, uSunDir, uShadowC, uFill, uGrade, uXCol;
uniform float uShadowA, uShadowOn, uSunK, uBanded, uOutline, uGradeK, uEmin, uShadowTexel;
uniform vec4 uFog;
uniform vec3 uPlayer;   // the player's chest (receives sun shadow as one object: no self-shadow from its own card)
uniform int uNL; uniform vec4 uLP[${NL}]; uniform vec4 uLC[${NL}];
uniform int uNH; uniform vec4 uHalo[${NL}]; uniform vec3 uHaloC[${NL}];
uniform int uDebug;
// screen layers (view px, painted by the host / features with a 2D context): ground (before light, ground pixels only),
// pre (before light, everything), emit (glow, added like an emitter), add (after light, additive), front (after light, over)
uniform sampler2D tGround, tPre, tEmitL, tAdd, tFront; uniform vec4 uLay; uniform float uLayE;
out vec4 oc;
vec4 lay(sampler2D t, ivec2 p) { return texelFetch(t, ivec2(p.x, int(uRes.y) - 1 - p.y), 0); }
vec3 post(vec3 col, ivec2 ip) {
  if (uLay.w > .5) { vec4 a = lay(tAdd, ip); col += a.rgb * a.a; }
  if (uLay.z > .5) { vec4 f = lay(tFront, ip); col = mix(col, f.rgb, f.a); }
  return col;
}
float nearOf(float d) { return -(d * 2. - 1.) * uR; }
vec3 worldAt(ivec2 p, float d) { vec2 ndc = (vec2(p) + .5) / uRes * 2. - 1.; vec4 w = uInvPV * vec4(ndc, d * 2. - 1., 1.); return w.xyz / w.w; }
int typeAt(ivec2 p) { return int(texelFetch(tA, p, 0).a * 255. + .5) / 4; }
float sunShadow(vec3 P, vec3 N) {
  vec4 lc = uLightPV * vec4(P + N * .06, 1.); vec3 sc = lc.xyz / lc.w * .5 + .5;
  if (any(lessThan(sc, vec3(0.))) || any(greaterThan(sc, vec3(1.)))) return 0.;
  return sc.z - .0006 > texture(tS, sc.xy).r ? 1. : 0.;
}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 a0 = texelFetch(tA, ip, 0);
  int code = int(a0.a * 255. + .5), type = code / 4, tone = code - type * 4;
  if (type == 0) { oc = vec4(clamp(post(uBg, ip), 0., 1.), 1.); return; }
  float d0 = texelFetch(tD, ip, 0).r;
  vec4 N0 = texelFetch(tN, ip, 0), E0 = texelFetch(tE, ip, 0);
  vec3 P = worldAt(ip, d0), N = normalize(N0.xyz), alb = a0.rgb;

  // ---- the pixelizer's rules, live, on ramp meshes: silhouette outline (selective), seams, occlusion lines
  if (type == 2 && uOutline > .5) {
    float n0 = nearOf(d0), obj = N0.w, pk = E0.w, fam = mod(pk, 32.), part = floor(pk / 32. + .001);
    bool outLit = false, outDark = false, line = false, seam = false;
    ivec2 off[4] = ivec2[4](ivec2(-1, 0), ivec2(0, 1), ivec2(1, 0), ivec2(0, -1));   // left, up, right, down
    for (int k = 0; k < 4; k++) {
      ivec2 q = ip + off[k];
      if (q.x < 0 || q.y < 0 || q.x >= int(uRes.x) || q.y >= int(uRes.y)) continue;
      int tq = typeAt(q); float nq = nearOf(texelFetch(tD, q, 0).r), oq = texelFetch(tN, q, 0).w;
      if (tq != 2 || abs(oq - obj) > .5) {
        if (tq == 0 || nq < n0 + .12) { if (k <= 1) outLit = true; else outDark = true; }   // my edge against what lies behind
      } else {
        float pq = texelFetch(tE, q, 0).w, famq = mod(pq, 32.), partq = floor(pq / 32. + .001);
        if (nq > n0 + .12) line = true;                                                     // my own front edge hides me here
        else if (k >= 2 && abs(partq - part) > .5 && abs(famq - fam) < .5) seam = true;     // plank meets plank
      }
    }
    int ti = outDark ? 4 : outLit ? 5 : line ? 3 : seam ? min(tone + 1, 3) : tone;
    alb = texelFetch(uRamps, ivec2(ti, int(fam + .5)), 0).rgb;
  }

  // ---- painted layers before the light: ground decals / animal shadows / ripples (ground only), cloud shadows (all)
  if (uLay.x > .5 && (type == 1 || type == 5)) { vec4 g = lay(tGround, ip); alb = mix(alb, g.rgb, g.a); }
  if (uLay.y > .5) { vec4 g = lay(tPre, ip); alb = mix(alb, g.rgb, g.a); }

  // ---- sun shadow, tinted toward the mood's shadow colour (the arena lays a tinted mask over the ground)
  float sh = 0.;
  if (uShadowA > 0.) {
    if (type == 5 && dot(N, uSunDir) < .03) sh = 1.;   // a cliff face turned away from the sun is in shade (the arena's rule)
    else if (type == 2 && dot(N, uSunDir) < .08) sh = 0.;   // prop faces turned away: their ramp tone already shades them
    else if (uShadowOn > .5) {
      if (type == 4) sh = sunShadow(uPlayer + uSunDir * .5, vec3(0.)) * .75;
      else if (type != 3 && type != 7) sh = sunShadow(P, N);   // cards would shadow themselves through their own sun card
    }
  }
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
    pts += uLC[i].rgb * f * shape;
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
    float w = (dot(N, uSunDir) + .35) / 1.35, s = 1. + uSunK * (w - .55) * 1.5;
    if (uBanded > .5) s = s < .93 ? (type == 4 ? .84 : .92) : s > 1.07 ? 1.15 : 1.;
    else if (type != 4) s = max(s, .9);
    L *= s;
  }
  if (type == 4) { alb = mix(alb, clamp(alb * uGrade, 0., 1.), uGradeK); L += min(uFill, L * .25); }
  vec3 col = alb * L;
  vec3 emit = E0.rgb;
  if (uLayE > .5) { vec4 el = lay(tEmitL, ip); emit += el.rgb * el.a; }
  col += emit * max(vec3(1.) - L, vec3(uEmin)) * 1.15;                   // emitters add back what the light took away
  for (int i = 0; i < ${NL}; i++) {                                       // halos at the flames
    if (i >= uNH) break;
    vec2 dp = (vec2(ip) + .5 - uHalo[i].xy); dp.y /= .9;
    float t2 = dot(dp, dp) / (uHalo[i].z * uHalo[i].z); if (t2 < 1.) { float u = 1. - t2; col += uHaloC[i] * u * u * uHalo[i].w; }
  }
  col += uFog.rgb * uFog.a * (.4 + 1.2 * gl_FragCoord.y / uRes.y);       // haze, stronger toward the far (top) edge
  // x-ray (the arena's look): where something hides the player, a dim fill with a light 1 px rim
  if (texelFetch(tX, ip, 0).r > .5 && type != 4) {
    bool rim = false;
    for (int k = 0; k < 4; k++) { ivec2 q = ip + ivec2(k == 0 ? -1 : k == 1 ? 1 : 0, k == 2 ? -1 : k == 3 ? 1 : 0); if (texelFetch(tX, q, 0).r < .5) rim = true; }
    col = rim ? mix(col, vec3(.937, .886, .769), .85) : mix(col, uXCol, .4);
  }
  col = post(col, ip);

  if (uDebug == 1) col = a0.rgb;
  else if (uDebug == 2) col = N * .5 + .5;
  else if (uDebug == 3) col = vec3(fract(nearOf(d0) * .25));
  else if (uDebug == 4) col = vec3(fract(N0.w * .137), fract(N0.w * .311), fract(E0.w * .0731));
  else if (uDebug == 5) col = mix(vec3(.9), vec3(.1, .1, .3), sh);
  else if (uDebug == 6) col = L * .8;
  oc = vec4(clamp(col, 0., 1.), 1.);
}`;

// ---------------------------------------------------------------- the renderer
export function createGfx(canvas, {VW, VH, PPM, PPMY, PPMH}) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true});
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

  const gScene = new THREE.Scene(), sScene = new THREE.Scene(), xScene = new THREE.Scene();
  gScene.matrixWorldAutoUpdate = sScene.matrixWorldAutoUpdate = xScene.matrixWorldAutoUpdate = true;
  const camera = new THREE.Camera();
  const sunCam = new THREE.OrthographicCamera(-SHADOW_E, SHADOW_E, SHADOW_E, -SHADOW_E, 1, 220);

  // shared uniforms (one object, referenced by every material that needs it)
  const U = {
    camYaw: {value: 0}, sunYaw: {value: 0}, px: {value: new THREE.Vector2(PPM, PPMH)},
    lArt: {value: new THREE.Vector3(-.55, .775, .314).normalize()},   // the pixelizer's top-left light, world-fixed
    ramps: {value: null}, cover: {value: new THREE.Vector3(0, .86, 0)}, emitFam: {value: new THREE.Vector2(-1, -1)},
    smooth: {value: 0},
  };
  const raw = (vs, fs, uniforms, extra = {}) => new THREE.RawShaderMaterial({vertexShader: vs, fragmentShader: fs, uniforms, glslVersion: THREE.GLSL3, ...extra});

  // ---- textures: one per source image (canvas / Image / ImageBitmap), nearest, no colour management
  const texCache = new WeakMap();
  function tex(img, {linear = false, dynamic = false} = {}) {
    let t = texCache.get(img);
    if (!t || t.__lin !== linear) {
      t = img instanceof HTMLCanvasElement ? new THREE.CanvasTexture(img) : new THREE.Texture(img);
      t.flipY = false; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.premultiplyAlpha = false;
      t.minFilter = t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; t.__lin = linear; t.__frame = -1;
      texCache.set(img, t);
    } else if (dynamic && t.__frame !== frameNo) { t.needsUpdate = true; t.__frame = frameNo; }   // re-upload a live canvas once per frame
    return t;
  }
  let frameNo = 0;

  // ---- materials
  const meshMat = obj => raw(MESH_VS, MESH_FS, {uRamps: U.ramps, uLArt: U.lArt, uObj: {value: obj}, uFlash: {value: 0}, uCover: U.cover, uEmitFam: U.emitFam});
  const shadowMeshMat = raw(SHADOW_MESH_VS, SHADOW_FS, {});
  const surfMat = ({tex, em = null, planar, world, type = 1, obj = 0}) => raw(SURF_VS, SURF_FS, {
    uTex: {value: tex}, uEm: {value: em}, uHasEm: {value: em ? 1 : 0}, uTexSize: {value: new THREE.Vector2(tex.image.width, tex.image.height)},
    uSmooth: U.smooth, uType: {value: type}, uObj: {value: obj}, uPlanar: {value: planar ? 1 : 0}, uWorld: {value: world || new THREE.Vector2(1, 1)}}, {side: THREE.FrontSide});
  const SNAP = {value: new THREE.Vector2(VW, VH)}, NOSNAP = {value: new THREE.Vector2(0, 0)};
  const cardUniforms = o => ({
    uAnchor: {value: new THREE.Vector3()}, uSize: {value: new THREE.Vector2(o.w, o.h)}, uPivot: {value: new THREE.Vector2(o.px, o.py)},
    uPx: U.px, uRect: {value: new THREE.Vector4(0, 0, 1, 1)}, uTex: {value: o.tex}, uBias: {value: o.bias ?? 0}, uSnap: SNAP,
    uOff: {value: new THREE.Vector2()}, uSway: {value: 0},
  });
  const QUAD = new THREE.BufferGeometry();
  QUAD.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3));

  // a billboard: {tex, w, h, px, py, em?, nrm?, nrmRect?, rect?, type (3 | 4), obj, bias, shadow (cast), xray}
  function card(o) {
    const u = cardUniforms(o);
    const g = raw(CARD_VS, CARD_FS, {...u, uFaceYaw: U.camYaw, uCamYaw: U.camYaw, uNrm: {value: o.nrm || null}, uHasNrm: {value: o.nrm ? 1 : 0},
      uNrmRect: {value: o.nrmRect || new THREE.Vector4(0, 0, 1, 1)}, uEm: {value: o.em || null}, uHasEm: {value: o.em ? 1 : 0},
      uType: {value: o.type ?? 3}, uObj: {value: o.obj ?? 0}, uFlash: {value: 0}}, {side: THREE.DoubleSide});
    const gm = new THREE.Mesh(QUAD, g); gm.frustumCulled = false; gScene.add(gm);
    let sm = null, xm = null;
    if (o.shadow !== false) {
      sm = new THREE.Mesh(QUAD, raw(CARD_VS, SHADOW_CARD_FS, {...u, uBias: {value: 0}, uSnap: NOSNAP, uFaceYaw: U.sunYaw}, {side: THREE.DoubleSide}));
      sm.frustumCulled = false; sScene.add(sm);
    }
    if (o.xray) {
      xm = new THREE.Mesh(QUAD, raw(CARD_VS, XRAY_FS, {...u, uFaceYaw: U.camYaw, uDepth: {value: gbuf.depthTexture}}, {side: THREE.DoubleSide, depthTest: false, depthWrite: false}));
      xm.frustumCulled = false; xScene.add(xm);
    }
    const C = {u, g, gm, sm, xm,
      set anchor(v) { u.uAnchor.value.copy(v); },
      set flash(k) { g.uniforms.uFlash.value = k; },            // 0..1: hit flash / hover pulse (white, glowing)
      setVisible(v) { gm.visible = v; if (sm) sm.visible = v; if (xm) xm.visible = v; },
      // swap the picture: {tex, w, h, px, py, em?} (a breakable's stage, a brute turning)
      setSprite(s) { u.uTex.value = s.tex; u.uSize.value.set(s.w, s.h); u.uPivot.value.set(s.px, s.py); g.uniforms.uEm.value = s.em || null; g.uniforms.uHasEm.value = s.em ? 1 : 0; },
      dispose() { gScene.remove(gm); if (sm) sScene.remove(sm); if (xm) xScene.remove(xm); g.dispose(); sm?.material.dispose(); xm?.material.dispose(); },
    };
    return C;
  }
  // a live ramp mesh (+ its shadow caster). setMatrix moves both; setGeometry swaps the model (a breakable's stage)
  function mesh(geom, obj, matrix) {
    const gm = new THREE.Mesh(geom, meshMat(obj)); gm.matrixAutoUpdate = false; gm.matrix.copy(matrix); gScene.add(gm);
    const sm = new THREE.Mesh(geom, shadowMeshMat); sm.matrixAutoUpdate = false; sm.matrix.copy(matrix); sScene.add(sm);
    return {gm, sm,
      setVisible(v) { gm.visible = v; sm.visible = v; },
      setMatrix(m) { gm.matrix.copy(m); sm.matrix.copy(m); gm.matrixWorldNeedsUpdate = sm.matrixWorldNeedsUpdate = true; },
      setGeometry(g) { gm.geometry = g; sm.geometry = g; },
      set flash(k) { gm.material.uniforms.uFlash.value = k; },
      dispose() { gScene.remove(gm); sScene.remove(sm); gm.material.dispose(); }};
  }
  function surface(geom, opts, castShadow = true) {
    const gm = new THREE.Mesh(geom, surfMat(opts)); gScene.add(gm);
    let sm = null; if (castShadow) { sm = new THREE.Mesh(geom, shadowMeshMat); sScene.add(sm); }
    return {gm, sm, dispose() { gScene.remove(gm); if (sm) sScene.remove(sm); gm.material.dispose(); }};
  }
  // ---- immediate-mode batches: filled every frame (G.line / G.point / G.sprite), drawn by render(), then emptied
  // lines: 1 px GL lines in world space (arrows, strings, streaks). color [r, g, b] 0..1, emit true = glows
  const LMAX = 4096, lineGeo = new THREE.BufferGeometry();
  const lPos = new THREE.BufferAttribute(new Float32Array(LMAX * 6), 3), lCol = new THREE.BufferAttribute(new Float32Array(LMAX * 8), 4);
  lPos.setUsage(THREE.DynamicDrawUsage); lCol.setUsage(THREE.DynamicDrawUsage); lineGeo.setAttribute('position', lPos); lineGeo.setAttribute('color', lCol);
  const lineObj = new THREE.LineSegments(lineGeo, raw(LINE_VS, LINE_FS, {})); lineObj.frustumCulled = false; gScene.add(lineObj);
  let nLines = 0;
  function line(x0, y0, z0, x1, y1, z1, c, emit = false) {   // world X, Y (up), Z
    if (nLines >= LMAX) return;
    lPos.array.set([x0, y0, z0, x1, y1, z1], nLines * 6); const e = emit ? 1 : 0;
    lCol.array.set([c[0], c[1], c[2], e, c[0], c[1], c[2], e], nLines * 8); nLines++;
  }
  // points: pixel particles. size 1..4 px, alpha < 1 = ordered dither, emit = glows
  const PMAX = 8192, pointGeo = new THREE.BufferGeometry();
  const pPos = new THREE.BufferAttribute(new Float32Array(PMAX * 3), 3), pCol = new THREE.BufferAttribute(new Float32Array(PMAX * 4), 4), pMisc = new THREE.BufferAttribute(new Float32Array(PMAX * 2), 2);
  for (const a of [pPos, pCol, pMisc]) a.setUsage(THREE.DynamicDrawUsage);
  pointGeo.setAttribute('position', pPos); pointGeo.setAttribute('color', pCol); pointGeo.setAttribute('aMisc', pMisc);
  const pointObj = new THREE.Points(pointGeo, raw(POINT_VS, POINT_FS, {uSnap: SNAP})); pointObj.frustumCulled = false; gScene.add(pointObj);
  let nPoints = 0;
  function point(x, y, z, c, {size = 1, alpha = 1, emit = false} = {}) {
    if (nPoints >= PMAX) return;
    pPos.array.set([x, y, z], nPoints * 3); pCol.array.set([c[0], c[1], c[2], emit ? 1 : 0], nPoints * 4); pMisc.array.set([size, alpha], nPoints * 2); nPoints++;
  }
  // sprites: billboards from any image, grouped by (image, emit image, normals, type, shadow) into instanced draws.
  //   o = {img, sx, sy, sw, sh (source rect, px; default the whole image), x, y, z (world anchor: X, Y up, Z),
  //        px, py (pivot inside the source rect), em (emit image, same layout), nrm (normal image, same layout),
  //        type 3 painted | 7 lit by its normals, alpha (dither), flip, sway (px at the top), flash, shadow (cast), dynamic}
  const groups = new Map(), imgId = new WeakMap(); let nextImg = 1;
  const idOf = img => { if (!img) return 0; let i = imgId.get(img); if (!i) { i = nextImg++; imgId.set(img, i); } return i; };
  function makeGroup(o) {
    const cap = 64, geo = new THREE.InstancedBufferGeometry(); geo.setAttribute('position', QUAD.getAttribute('position'));
    const A = {iAnchor: 3, iRect: 4, iSize: 4, iMisc: 4}, attrs = {};
    for (const [k, n] of Object.entries(A)) { attrs[k] = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); attrs[k].setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, attrs[k]); }
    const uni = {uTex: {value: null}, uEm: {value: null}, uNrm: {value: null}, uHasEm: {value: 0}, uHasNrm: {value: 0}, uType: {value: o.type ?? 3},
      uFaceYaw: U.camYaw, uCamYaw: U.camYaw, uPx: U.px, uSnap: SNAP, uBias: {value: .0025}};
    const gm = new THREE.Mesh(geo, raw(BATCH_VS, BATCH_FS, uni, {side: THREE.DoubleSide})); gm.frustumCulled = false; gScene.add(gm);
    let sm = null;
    if (o.shadow) { sm = new THREE.Mesh(geo, raw(BATCH_VS, BATCH_SHADOW_FS, {uTex: uni.uTex, uFaceYaw: U.sunYaw, uPx: U.px, uSnap: NOSNAP, uBias: {value: 0}}, {side: THREE.DoubleSide})); sm.frustumCulled = false; sScene.add(sm); }
    return {geo, attrs, uni, gm, sm, cap, n: 0, idle: 0};
  }
  function grow(G2) {
    const cap = G2.cap * 2;
    for (const [k, a] of Object.entries(G2.attrs)) { const b = new THREE.InstancedBufferAttribute(new Float32Array(cap * a.itemSize), a.itemSize); b.array.set(a.array); b.setUsage(THREE.DynamicDrawUsage); G2.geo.setAttribute(k, b); G2.attrs[k] = b; }
    G2.cap = cap;
  }
  function sprite(o) {
    const key = `${idOf(o.img)}|${idOf(o.em)}|${idOf(o.nrm)}|${o.type ?? 3}|${o.shadow ? 1 : 0}`;
    let G2 = groups.get(key); if (!G2) groups.set(key, G2 = makeGroup(o));
    if (G2.n >= G2.cap) grow(G2);
    const W = o.img.width, H = o.img.height, sx = o.sx || 0, sy = o.sy || 0, sw = o.sw ?? W, sh = o.sh ?? H, i = G2.n++;
    G2.uni.uTex.value = tex(o.img, {dynamic: o.dynamic}); if (o.em) { G2.uni.uEm.value = tex(o.em, {dynamic: o.dynamic}); G2.uni.uHasEm.value = 1; }
    if (o.nrm) { G2.uni.uNrm.value = tex(o.nrm); G2.uni.uHasNrm.value = 1; }
    G2.attrs.iAnchor.array.set([o.x, o.y, o.z], i * 3);
    G2.attrs.iRect.array.set([sx / W, sy / H, sw / W, sh / H], i * 4);
    G2.attrs.iSize.array.set([sw, sh, o.px ?? sw / 2, o.py ?? sh], i * 4);
    G2.attrs.iMisc.array.set([o.alpha ?? 1, o.flip ? 1 : 0, o.sway || 0, o.flash || 0], i * 4);
  }
  function flushBatches() {
    lPos.needsUpdate = lCol.needsUpdate = true; lineGeo.setDrawRange(0, nLines * 2);
    pPos.needsUpdate = pCol.needsUpdate = pMisc.needsUpdate = true; pointGeo.setDrawRange(0, nPoints);
    for (const [key, G2] of groups) {
      G2.geo.instanceCount = G2.n; G2.gm.visible = G2.n > 0; if (G2.sm) G2.sm.visible = G2.n > 0;
      for (const a of Object.values(G2.attrs)) a.needsUpdate = true;
      if (G2.n === 0 && ++G2.idle > 600) { gScene.remove(G2.gm); if (G2.sm) sScene.remove(G2.sm); G2.gm.material.dispose(); G2.sm?.material.dispose(); G2.geo.dispose(); groups.delete(key); }
      else if (G2.n) G2.idle = 0;
    }
  }
  function resetBatches() { nLines = 0; nPoints = 0; for (const G2 of groups.values()) G2.n = 0; }

  // ---- screen layers: 2D canvases at view resolution, uploaded only on frames they were drawn into
  const LAYERS = ['ground', 'pre', 'emit', 'add', 'front'], layers = {};
  for (const n of LAYERS) {
    const c = document.createElement('canvas'); c.width = VW; c.height = VH;
    const q = c.getContext('2d'); q.imageSmoothingEnabled = false;
    const t = new THREE.CanvasTexture(c); t.flipY = false; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.minFilter = t.magFilter = THREE.NearestFilter;
    layers[n] = {c, q, t, used: false, dirty: false};
  }
  // layer(name) -> its 2D context for this frame (cleared on first use each frame)
  function layer(n) {
    const L = layers[n];
    if (!L.used) { L.used = true; if (L.dirty) { L.q.setTransform(1, 0, 0, 1, 0, 0); L.q.globalAlpha = 1; L.q.globalCompositeOperation = 'source-over'; L.q.clearRect(0, 0, VW, VH); } L.dirty = true; }
    return L.q;
  }

  // ---- composite
  const compU = {
    tA: {value: gbuf.textures[0]}, tN: {value: gbuf.textures[1]}, tE: {value: gbuf.textures[2]}, tD: {value: gbuf.depthTexture},
    tS: {value: shadow.depthTexture}, tX: {value: xray.texture}, uRamps: U.ramps,
    uInvPV: {value: new THREE.Matrix4()}, uLightPV: {value: new THREE.Matrix4()},
    uRes: {value: new THREE.Vector2(VW, VH)}, uR: {value: R_DEPTH},
    uBg: {value: new THREE.Vector3(.1, .12, .11)}, uAmb: {value: new THREE.Vector3(1, 1, 1)}, uSunDir: {value: new THREE.Vector3(0, 1, 0)},
    uShadowC: {value: new THREE.Vector3()}, uFill: {value: new THREE.Vector3()}, uGrade: {value: new THREE.Vector3(1, 1, 1)}, uXCol: {value: new THREE.Vector3(.17, .14, .21)},
    uShadowA: {value: 0}, uShadowOn: {value: 1}, uSunK: {value: .34}, uBanded: {value: 1}, uOutline: {value: 1}, uGradeK: {value: 0}, uEmin: {value: .1}, uShadowTexel: {value: 1 / SM},
    uFog: {value: new THREE.Vector4()}, uPlayer: {value: new THREE.Vector3()},
    uNL: {value: 0}, uLP: {value: Array.from({length: NL}, () => new THREE.Vector4())}, uLC: {value: Array.from({length: NL}, () => new THREE.Vector4())},
    uNH: {value: 0}, uHalo: {value: Array.from({length: NL}, () => new THREE.Vector4())}, uHaloC: {value: Array.from({length: NL}, () => new THREE.Vector3())},
    tGround: {value: layers.ground.t}, tPre: {value: layers.pre.t}, tEmitL: {value: layers.emit.t}, tAdd: {value: layers.add.t}, tFront: {value: layers.front.t},
    uLay: {value: new THREE.Vector4()}, uLayE: {value: 0},
    uDebug: {value: 0},
  };
  const compScene = new THREE.Scene();
  const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const compMesh = new THREE.Mesh(tri, raw(COMP_VS, COMP_FS, compU, {depthTest: false, depthWrite: false})); compMesh.frustumCulled = false; compScene.add(compMesh);
  const dummyCam = new THREE.Camera();

  // ---- view: target (snapped to the pixel lattice by the caller), yaw, zoom
  const view = {T: new THREE.Vector3(), yaw: 0, zoom: 1};
  function setView(T, yaw, zoom) {
    view.T.copy(T); view.yaw = yaw; view.zoom = zoom;
    camera.position.copy(T); camera.rotation.set(0, yaw, 0); camera.updateMatrixWorld(true);
    const A = 2 * PPM * zoom / VW, B = 2 * PPMH * zoom / VH, C = 2 * PPMY * zoom / VH, Nn = Math.hypot(PPMY, PPMH);
    camera.projectionMatrix.set(A, 0, 0, 0, 0, B, -C, 0, 0, -PPMY / Nn / R_DEPTH, -PPMH / Nn / R_DEPTH, 0, 0, 0, 0, 1);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    U.camYaw.value = yaw;
  }
  // world -> internal-canvas px (y down), for halos / HUD / tests
  const _v = new THREE.Vector3();
  function toScreen(x, y, z) { _v.set(x, y, z).project(camera); return [(_v.x + 1) / 2 * VW, (1 - _v.y) / 2 * VH, _v.z]; }

  // ---- sun: direction toward the sun (world), shadow camera snapped to its texel grid around the view target
  function setSun(dir) {
    compU.uSunDir.value.copy(dir);
    U.sunYaw.value = Math.atan2(dir.x, dir.z);   // cards turned so their face points at the sun (normal = (sin, 0, cos))
    const T = view.T, texel = 2 * SHADOW_E / SM;
    sunCam.position.copy(T).addScaledVector(dir, 100); sunCam.lookAt(T); sunCam.updateMatrixWorld(true);
    // snap: move the light camera so the target sits on a texel corner in light space (no shadow crawl while walking)
    const lt = T.clone().applyMatrix4(sunCam.matrixWorldInverse);
    const dx = lt.x - Math.round(lt.x / texel) * texel, dy = lt.y - Math.round(lt.y / texel) * texel;
    const right = new THREE.Vector3().setFromMatrixColumn(sunCam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(sunCam.matrixWorld, 1);
    sunCam.position.addScaledVector(right, dx).addScaledVector(up, dy); sunCam.updateMatrixWorld(true);
    compU.uLightPV.value.multiplyMatrices(sunCam.projectionMatrix, sunCam.matrixWorldInverse);
  }

  const stats = {ms: 0, calls: 0, sprites: 0, points: 0, lines: 0};
  function render() {
    const t0 = performance.now();
    flushBatches();
    stats.sprites = [...groups.values()].reduce((s, g2) => s + g2.n, 0); stats.points = nPoints; stats.lines = nLines;
    const lay = compU.uLay.value;
    lay.set(+layers.ground.used, +layers.pre.used, +layers.front.used, +layers.add.used); compU.uLayE.value = +layers.emit.used;
    for (const L of Object.values(layers)) if (L.used) L.t.needsUpdate = true;
    renderer.setClearColor(0x000000, 0);
    if (compU.uShadowA.value > 0 && compU.uShadowOn.value > .5) {
      renderer.setRenderTarget(shadow); renderer.clear(true, true, false); renderer.render(sScene, sunCam);
    }
    renderer.setRenderTarget(gbuf); renderer.clear(true, true, false); renderer.render(gScene, camera);
    const calls = renderer.info.render.calls;
    renderer.setRenderTarget(xray); renderer.clear(true, false, false); renderer.render(xScene, camera);
    compU.uInvPV.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    renderer.setRenderTarget(null); renderer.render(compScene, dummyCam);
    stats.calls = calls; stats.ms = stats.ms * .9 + (performance.now() - t0) * .1;
    resetBatches(); for (const L of Object.values(layers)) L.used = false; frameNo++;
  }

  return {THREE, renderer, gScene, sScene, xScene, camera, sunCam, U, compU, view, stats, VW, VH,
    setView, setSun, toScreen, render, card, mesh, surface, line, point, sprite, layer, tex, QUAD};
}
