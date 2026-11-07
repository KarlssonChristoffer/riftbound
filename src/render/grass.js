// GRASS (render side): a meadow of single-pixel blades, drawn into the G-buffer as GROUND (type 1), so the composite lights,
// shadows, tints (the season's matrix), snows on and wets them exactly like the painted ground they grow out of. Each blade
// is one instance of a 3-segment strip, one art px wide on screen (a parallelogram with horizontal edges 1 px apart covers
// exactly one pixel per row), its root on the pixel lattice and every other point a whole number of art px from it, so a
// blade leans a pixel at a time like the trees' crowns (gfx.js SWAY). Its tip is pushed sideways by, summed and capped:
//   wind      the wind feature's gust field (features/wind.js field(), evaluated here per vertex, term for term, from
//             W.gpu()): a steady lean downwind, gust fronts rolling across the meadow as visible waves, a flutter per
//             blade that grows in a gust
//   pushers   up to 16 things standing in the grass (the player, brutes, a rolling barrel): blades round them part
//   trample   a world-space map (TRAMPLE: direction x amount, amount) of where grass lies flattened: stamped by the pushers
//             as they move and by blasts, recovering on its own over ~10-20 s. Ping-pong render targets, one full-screen
//             pass a frame (step()), all on the GPU
// A bent blade stands lower (its length is kept), so flattened grass lies down. Colour: the ramp tone the ground was
// painted with at the root (the blade's foot melts into it), a tone lighter up the blade, some tips lighter still; a few
// meadow blades carry a flower (G-buffer tone 2: its own colour, outside the season's matrix). obj -1 (like particles):
// grass in front of the player never draws the x-ray rim. Grass casts no shadow and is in no point-light height map.
//
// API: createGrass(G, box = TBOX) -> {setBlades(a, b, n, ramps, flowers), step(dt), setWind(buf | null), setPushers(arr, n), blast(x, z, r, k),
//   setLook(snowK, flowerK), setFlowerShape(v), setCalm(v), setVisible(v), dispose(), mesh, meshes, count,
//   setTufts(a, b, n), setTuftPushers(arr, n), setTuftLook(o), setTuftsVisible(v), tuftCount}   (the tufts: TUFT_VS below)
//   box: the trample map's world rect {x0, z0, w, d (m), ppm} (features/grass.js: the world's bounds + 1 m)
//   The blades are drawn in CHUNKS (CHUNK m squares, each its own instanced mesh with its own bounds): the view's frustum culls
//   the ones off screen (a grown world has ~3x the Proving Grounds' blades; the view sees a few chunks)
//   setFlowerShape: 0 a 2 px head (default), 1 a V of two petals over a centre, 3 px wide (the cool palette: features/grass.js)
//   setCalm: 1 the blades in the ground's own tone with light tips (a calm sward), 0 each blade a tone lighter (features/grass.js)
//   a, b: Float32Array(n * 4) per blade: a = (root X, root Y (ground height), root Z, height m), b = (ramp * 4 + tone,
//   phase 0..1, flower colour 0 none / 1..4, rest lean: whole part = its size in 32nds of the height, fraction = its angle / 2 pi);
//   ramps: up to 8 x [highlight, tone 0 .. 3] as [r, g, b] 0..1 (the meadows use 4, the forest's floor 4 more: features/grass.js)
// THE CINEMA CAMERA (gfx.js setCine): a variant of the blades' shader divides by w (a perspective) and clips blades behind it.
// OWNS: its mesh (in G.gScene), the blade buffers, the trample targets. READS: G.camera, G.view.zoom, G.VW / VH, G.U.time.
// BUDGET: CPU: in features/grass.js's frame (~0.04 ms). GPU: one instanced draw (~50k blades x 8 vertices) + one 384 x 192
// pass; the bench's GPU p95 at 3440x1440 stayed within ~0.1-0.3 ms of grass=0 (a busy machine: noisy), budget 4.5 ms.
import * as THREE from 'three';
import {CUT, cutU} from './cut.js';   // the cutaway (a blade goes by its root's height)

const HEAD = `precision highp float; precision highp int;\n`;
const OUTS = `layout(location = 0) out vec4 o0;\nlayout(location = 1) out vec4 o1;\nlayout(location = 2) out vec4 o2;\n`;
export const MAX_FRONTS = 12, MAX_PUSH = 16, MAX_BLAST = 4;
// the trample map's box (world X / Z, m: the Proving Grounds + 1 m) and its texels per metre
const TBOX = {x0: -1, z0: -1, w: 64, d: 32, ppm: 6};
const CHUNK = 12, LEAN_PAD = 1.4;   // m: a chunk's side; how far past its roots a chunk's blades may reach (their height, bent)

// the gust field (features/wind.js field()): uWG[0] = (UX, UY, base, gust), uWG[1] = (LV, T, n, mode 0 off / 1 fronts /
// 2 pulse rings (the rift: not drawn here, no grass there)), uWF = 4 vec4 a front, as W.gpu() packs them
const WIND = `
uniform vec4 uWG[2]; uniform vec4 uWF[${MAX_FRONTS * 4}];
float sm(float x) { x = clamp(x, 0., 1.); return x * x * (3. - 2. * x); }
float envF(float e, float len) { float rise = min(1.6, len * .22), hold = len * .34; return e < rise ? sm(e / rise) : e < hold ? 1. : 1. - sm((e - hold) / (len - hold)); }
vec3 windAt(vec2 p) {   // arena (x, y) -> (wind x, wind y m/s, gust 0..1)
  if (uWG[1].w < .5 || uWG[1].w > 1.5) return vec3(0.);
  float UX = uWG[0].x, UY = uWG[0].y, LV = uWG[1].x, T = uWG[1].y;
  int n = int(uWG[1].z + .5);
  float sA = p.x * UX + p.y * UY, tA = -p.x * UY + p.y * UX, q = 1.;
  for (int i = 0; i < ${MAX_FRONTS}; i++) {
    if (i >= n) break;
    vec4 a = uWF[i * 4], b = uWF[i * 4 + 1], c = uWF[i * 4 + 2], d = uWF[i * 4 + 3];
    float e = a.x + a.w * (.62 * sin(tA * b.z + c.y + T * d.x) + .38 * sin(tA * b.w + c.z - T * d.y)) - sA;
    if (e <= 0. || e >= a.y) continue;
    float lat = sm((b.y - abs(tA - b.x)) / 4.); if (lat <= 0.) continue;
    q *= 1. - a.z * lat * envF(e, a.y) * (.8 + .2 * sin(tA * c.x + c.w));
  }
  float g = 1. - q, v = (uWG[0].z + g * uWG[0].w) * LV, tw = g * uWG[0].w * LV * .12 * sin(T * 1.9 + sA * .5);
  return vec3(UX * v - UY * tw, UY * v + UX * tw, g);
}
`;

const BLADE_VS = HEAD + WIND + `
in vec3 position;   // x: side (-.5 / .5 art px), y: t (0 root .. 1 tip)
in vec4 iA; in vec4 iB;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec2 uRes; uniform float uZoom, uTime, uSnowK, uFlowerK, uFlowerV;
uniform float uCalm;   // 1: a calm sward (setCalm): the blades in the ground's own tone, light tips, a few dark strokes; 0: each a tone lighter
uniform vec4 uK;   // (lean per m/s of wind, flutter at rest, flutter per unit of gust, max lean) in blade heights
uniform vec2 uSheen;   // the wind's lean (blade heights) where the sheen starts / is full
uniform vec4 uPush[${MAX_PUSH}]; uniform int uNP;   // (x, z, radius, strength in blade heights)
uniform sampler2D uTr; uniform vec4 uTrBox; uniform float uTrOn;
uniform vec3 uRamp[40];   // per ramp (up to 8): [highlight, tone 0 .. 3] (light -> dark)
flat out vec3 vR; out float vT; out float vSide; flat out vec3 vC0; flat out vec3 vC1; flat out vec3 vC2; flat out float vHp; flat out float vFl;
void main() {
  vec3 root = iA.xyz; float h = iA.w * uSnowK, t = position.y, ph = iB.y; vR = root;
  // the tip's sideways push (m, world X / Z)
  vec3 w = windAt(root.xz);
  float ra = fract(iB.w) * 6.2832;
  vec2 lean = vec2(cos(ra), sin(ra)) * floor(iB.w) / 32. * h + w.xy * uK.x * h;   // its own growth (a tuft fans out) + the wind
  float ft = uTime * (2.1 + ph * 1.7) + ph * 6.2832 + dot(root.xz, vec2(.9, .7));
  lean += vec2(sin(ft), cos(ft * 1.3)) * (uK.y + uK.z * w.z) * h;
  // tall grass (the West Downs' drifts, knee high): a slow sway rolling through it along the wind, between the gusts too (waves
  // travelling downwind at ~1.6 m/s); its amount grows with the blade's height over ~.3 m, so short grass barely shows it
  float tallK = max(0., h - .3);
  if (tallK > 0.) { float wl = length(w.xy); vec2 wd = wl > 1e-3 ? w.xy / wl : vec2(.94, .34); lean += wd * sin(dot(root.xz, wd) * 1.4 - uTime * 2.3 + ph * 1.1) * tallK * (.15 + .1 * min(3., wl)); }
  for (int i = 0; i < ${MAX_PUSH}; i++) {
    if (i >= uNP) break;
    vec4 P = uPush[i]; vec2 d = root.xz - P.xy; float l = length(d);
    if (l < P.z) lean += (l > 1e-3 ? d / l : vec2(1., 0.)) * (1. - l / P.z) * P.w * h;
  }
  float trod = 0.;   // how flat it lies here (the trample map's amount)
  if (uTrOn > .5) { vec4 tr = texture(uTr, (root.xz - uTrBox.xy) * uTrBox.zw); lean += tr.xy * h; trod = tr.z; }
  float L = length(lean), mx = uK.w * h; if (L > mx) { lean *= mx / L; L = mx; }
  float hv = sqrt(max(h * h - L * L, h * h * .03));   // the blade keeps its length: bent over, it stands lower
  vec3 Pw = root + vec3(lean.x * t * sqrt(t), hv * t, lean.y * t * sqrt(t)), Tw = root + vec3(lean.x, hv, lean.y);
  mat4 PV = projectionMatrix * viewMatrix;
  vec4 cr = PV * vec4(root, 1.), cp = PV * vec4(Pw, 1.), ct = PV * vec4(Tw, 1.);
#ifdef CINE
  // the cinema camera (gfx.js setCine): a perspective, so divide by w; a blade with its root or tip behind it is not drawn
  if (cr.w < .05 || cp.w < .05 || ct.w < .05) { gl_Position = vec4(2., 2., 2., 1.); return; }
  float cz = cp.z / cp.w - .03 * -projectionMatrix[3][2] / (cp.w * cp.w);   // (3 cm toward the camera: the oblique .00025 x R_DEPTH)
  cr.xy /= cr.w; cp.xy /= cp.w; ct.xy /= ct.w;
#endif
  vec2 S = uRes / uZoom * .5;   // NDC -> art px (y up)
  vec2 sr = (cr.xy + 1.) * S, rc = floor(sr) + .5;
  vec2 pc = rc + floor((cp.xy + 1.) * S - sr + .5);
  vFl = iB.z > .5 && fract(ph * 13.7) < uFlowerK ? iB.z : 0.;
  pc.x += vFl > .5 ? (uFlowerV > .5 ? position.x * 3. : position.x * 2. + .5) : position.x;   // (a flowering blade is 2 px wide (a V: 3, centred): the head; FS keeps the stem 1 px)
  vSide = position.x;
  if (t < .01) pc.y -= .5; else if (t > .99) pc.y += .5;   // the root row and the tip row are whole pixels
#ifdef CINE
  gl_Position = vec4(pc / S - 1., cz, 1.);
#else
  gl_Position = vec4(pc / S - 1., cp.z - .00025, 1.);   // (a hair in front of the ground it stands on)
#endif
  vT = t; vHp = max(1., floor((ct.y + 1.) * S.y - sr.y + .5) + 1.);
  // the foot in the ground's own tone; the blade a tone lighter (a quarter of them darker: depth in the sward), some tips lighter still
  int ri = int(iB.x + .5), rp = ri / 4 * 5, tn = ri - ri / 4 * 4 + 1;
  bool dark = fract(ph * 5.13) < .25;
  int body = dark ? tn : tn - 1, tip = max(0, tn - (dark ? 1 : fract(ph * 7.31) < .45 ? 2 : 1));
  // the calm sward (the user's reference meadows): a field reads as ONE tone, its blades only showing where they stand against
  // something else (a path, a shadow's edge, a stone: a jagged fringe) and as light tips; a tenth darker (depth in the sward)
  if (uCalm > .5) { dark = fract(ph * 5.13) < .1; body = dark ? min(tn + 1, 4) : tn; tip = dark ? tn : fract(ph * 7.31) < .5 ? tn - 1 : tn;
    // ~4 % of the tufts stand out a tone lighter, the whole tuft (its cell of the placing grid, features/grass.js TUNE.grid): the light
    // little sprouts sprinkled over a calm sward
    if (fract(sin(dot(floor(root.xz / .14), vec2(12.9898, 78.233))) * 43758.5453) < .04) { body = tn - 1; tip = max(0, tn - 2); } }
  // the wind's sheen: blades bent over by the wind show their lighter side, so a gust front rolls across the meadow as a
  // band of lighter grass (blade by blade, dithered by its own number: the band's edge is ragged, not a line)
  // (trodden grass shows it too: a path through the meadow is a lighter streak)
  if (fract(ph * 3.91) < max(smoothstep(uSheen.x, uSheen.y, length(w.xy) * uK.x), trod * 1.8)) { body = max(0, body - 1); tip = max(0, tip - 1); }
  vC0 = uRamp[rp + tn]; vC1 = uRamp[rp + body]; vC2 = uRamp[rp + tip];
}`;
const BLADE_FS = HEAD + OUTS + CUT + `
flat in vec3 vR; in float vT; in float vSide; flat in vec3 vC0; flat in vec3 vC1; flat in vec3 vC2; flat in float vHp; flat in float vFl;
uniform vec3 uFlower[4]; uniform float uFlowerV;
void main() {
  if (cutAway(vR + vec3(0., .05, 0.))) discard;   // (the cutaway: render/cut.js)
  float py = vT * vHp;   // art px up from the root row
  // a V head (uFlowerV): columns 0 1 2 across its 3 px; the petals in the top row's outer two, the centre under them, the stem below
  bool vee = vFl > .5 && uFlowerV > .5; int col = int(floor((vSide + .5) * 3.));
  if (vee ? (py > vHp - 1. ? col == 1 : col != 1) : vSide > .1 && py < vHp - 1.) discard;   // (else a flowering blade's right column: only its head; vSide: a plain blade's pixel 0, a flower's columns -.25 / .25)
  vec3 c = py < max(1., vHp * .34) ? vC0 : py > vHp - 1.2 ? vC2 : vC1;
  int tone = 0;
  if (vee) { if (py > vHp - 2.) { c = uFlower[int(vFl + .5) - 1] * (py > vHp - 1. ? (col == 2 ? .82 : 1.) : .72); tone = 2; } }   // the right petal in shade, the centre darker
  else if (vFl > .5 && py > vHp - 1.) { c = uFlower[int(vFl + .5) - 1] * (vSide > .1 ? .82 : 1.); tone = 2; }   // a 2 px head, its right half in shade (tone 2: own colours, outside the season's matrix)
  o0 = vec4(c, float(4 + tone) / 255.);   // type 1: ground (tone 1 would be WATER: never)
  o1 = vec4(0., 1., 0., -1.);
  o2 = vec4(0.);
}`;

// TRAMPLE: xy = where the blades are pushed (direction x amount, in blade heights), z = amount 0..1. Each frame: the amount
// recovers (uRec: per s, + per s per unit of amount: a walk's .38 is gone in ~13 s, a sprint's .65 in ~19 s, a roll's .95 in ~24 s), then every pusher with a trample strength stamps along its motion
// (spread a little outward) and every blast this frame radially. A stamp only ever raises the amount; its direction blends in
const FS_VS = HEAD + `in vec3 position; void main() { gl_Position = vec4(position.xy, 0., 1.); }`;
const TRAMPLE_FS = HEAD + `
uniform sampler2D uPrev; uniform vec4 uBox; uniform float uDt; uniform vec2 uRec;
uniform vec4 uPush[${MAX_PUSH}]; uniform vec4 uPushV[${MAX_PUSH}]; uniform int uNP;   // (x, z, r, -) / (dir x, dir z, trample, -)
uniform vec4 uBlast[${MAX_BLAST}]; uniform int uNB;                                  // (x, z, r, strength)
out vec4 o;
void stamp(inout vec3 s, vec2 dir, float k) {
  if (k <= s.z) { s.xy += dir * k * .15; float l = length(s.xy); if (l > s.z && l > 0.) s.xy *= s.z / l; return; }
  vec2 v = s.xy + dir * k * 2.; float l = length(v); s.xy = l > 1e-4 ? v / l * k : dir * k; s.z = k;
}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec3 s = texelFetch(uPrev, ip, 0).xyz;
  vec2 w = uBox.xy + (vec2(ip) + .5) / uBox.zw;   // this texel's world X / Z
  float a = max(0., s.z - uDt * (uRec.x + uRec.y * s.z));
  s.xy *= s.z > 1e-4 ? a / s.z : 0.; s.z = a;
  for (int i = 0; i < ${MAX_PUSH}; i++) {
    if (i >= uNP) break;
    vec4 P = uPush[i], V = uPushV[i]; if (V.z <= 0.) continue;
    vec2 d = w - P.xy; float l = length(d); if (l >= P.z) continue;
    vec2 rad = l > 1e-3 ? d / l : V.xy, dir = normalize(V.xy + rad * .6 + vec2(1e-4, 0.));
    stamp(s, dir, V.z * min(1., (1. - l / P.z) * 1.6));
  }
  for (int i = 0; i < ${MAX_BLAST}; i++) {
    if (i >= uNB) break;
    vec4 B = uBlast[i]; vec2 d = w - B.xy; float l = length(d); if (l >= B.z) continue;
    stamp(s, l > 1e-3 ? d / l : vec2(1., 0.), B.w * pow(1. - l / B.z, .6));
  }
  o = vec4(s, 1.);
}`;

// ---------------------------------------------------------------- TUFTS: stylized grass sprites (the "living grass" layer)
// Pixel-art tufts of grass standing up out of the sward on camera-facing quads (billboards), drawn into the G-buffer as GROUND
// like the blades (the composite lights, shadows, tints and snows on them). Ideas from a stylized-grass talk, ported to the
// pixel lattice (every tuft is its sprite's own pixels, never scaled except by whole px in the cinema / first-person view):
//   colour    each tuft in the ramp TONE the ground was painted with at its root (the painter's own patches: tuft and floor
//             match), its pixels a tone darker / lighter / highlight from there; two world-space noise fields shift whole
//             patches of tufts into the dry (lush) or deep (damp) ramp
//   accents   by the tuft's own seed: tall dry tussocks, seed heads, flowers (by the season's bloom), each its own sprite
//   wind      in WORLD space: the wind feature's direction turned by +- a divergence angle, two value-noise fields scrolled
//             along those two at different scales and speeds (pi / 3 apart: they never repeat together), multiplied and
//             clamped: the field of how far a tuft leans downwind; plus the gust fronts the blades and trees feel (windAt)
//   low fps   the wind's clock steps at uTW.x a second (0: smooth), each tuft's steps shifted by its own phase (no laggy frame)
//   fake perspective   a tuft leaning toward / away from the camera has its top rows widened / narrowed (the UV scaled in the
//             fragment, row by row: the root row not at all, the tip the most); a lean across shears its rows sideways
//   pushers   every player (co-op peers too), brute and barrel in a fixed 16 array (uPushT), sent at a low tick (features/
//             grass.js TUNE.tufts.tick): tufts round them bend away, the trample map's flattened paths too
//   hybrid toon   a tuft's light (its sheen: bent over, it shows its lighter side, most at the tips) is a continuous tone; the
//             step between two of the ramp's tones is smoothed over uTD.z of the band (0: hard steps), so a tuft fades from one
//             to the next instead of snapping
// iA = (root X, Y, Z, rest height m (bounds only)), iB = (ramp * 4 + tone, seed 0..1, 0, 0).
// SPRITES: rows top first; . empty, d a tone darker than the ground, b a tone lighter, l two lighter, h three (the ramp's highlight), f / F accent colour / its shade
const TUFT_ART = [
  ['..h..h.',
   '.lb.lb.',
   '.bb.b.l',
   'lb.bbl.',
   'bbdbbdb',
   'dbddbdd'],
  ['.h...h.h.',
   '.l.h.lbl.',
   'lb.lbbd.l',
   'bdbbdbdbb',
   '.ddddddd.'],
  ['....h..',
   '.h..l..',
   '.l..b.h',
   '..l.b.l',
   '..b.bl.',
   'h.bdb..',
   'l.bdb.l',
   '.bbdbbb',
   '.bdddbd',
   '..ddd..'],
  ['.f...f.',
   '.F..fF.',
   '.l.fF..',
   '.b.l.l.',
   '..bb.b.',
   '..bdbb.',
   '.lbdb..',
   '.bdddb.',
   '..ddd..'],
  ['.ff....',
   '.fF..f.',
   '..l.fF.',
   '..b..l.',
   '.lb.lb.',
   '.bdbbd.',
   'bdddbdd'],
];
const TUFT_IDS = {'.': 0, d: 1, b: 2, l: 3, h: 4, f: 5, F: 6};
// integer value noise (core: no sin hashes, they band on real GPUs past ~1e5: memory 'shader-gotchas')
const NOISE = `
uint ih(uvec2 v) { v = v * 1664525u + 1013904223u; v.x += v.y * 1664525u; v.y += v.x * 1664525u; v ^= v >> 16u; v.x += v.y * 1664525u; v.y += v.x * 1664525u; v ^= v >> 16u; return v.x ^ v.y; }
float h2(vec2 c) { return float(ih(uvec2(ivec2(c) + 65536)) & 0xffffffu) / 16777216.; }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h2(i), h2(i + vec2(1., 0.)), f.x), mix(h2(i + vec2(0., 1.)), h2(i + vec2(1., 1.)), f.x), f.y); }
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
`;
const TUFT_VS = HEAD + WIND + NOISE + `
in vec3 position;   // x 0 / 1 (left / right edge), y 0 / 1 (under the root / over the top)
in vec4 iA; in vec4 iB;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec2 uRes; uniform float uZoom, uTime, uSnowK, uFlowerK;
uniform vec4 uPushT[${MAX_PUSH}]; uniform int uNPT;   // (x, z, radius, strength in heights), at the low tick
uniform sampler2D uTr; uniform vec4 uTrBox; uniform float uTrOn;
uniform vec4 uSpr[${TUFT_ART.length}];   // the atlas: (x0, y0, w, h) per sprite
uniform vec4 uTW;    // wind: (fps, 0 smooth; divergence rad; lean at calm; lean per m/s) in heights
uniform vec4 uTW2;   // (noise per m, its speed m/s, view sway px, max lean in heights)
uniform vec4 uTL;    // (fake perspective, push radius x, accents on, patches on)
uniform vec4 uTD;    // (density 0..1, px per m up (PPMH), toon smoothing 0..1, show the wind field)
uniform vec3 uRamp[40]; uniform vec3 uFlower[4];
out vec2 vLoc; flat out vec4 vSpr; flat out vec4 vT; flat out vec3 vR; flat out vec3 vFlC; flat out float vRp; flat out float vTn; flat out float vFlT; flat out float vWN;
void main() {
  vec3 root = iA.xyz; float sd = iB.y; vR = root;
  if (fract(sd * 3.17) >= uTD.x) { gl_Position = vec4(2., 2., 2., 1.); return; }   // (thinned by the density)
  int code = int(iB.x + .5), ramp = code / 4, tn = code - ramp * 4;
  // the sprite: accents by the seed, else one of the two plain tufts
  int spr = fract(sd * 5.71) < .55 ? 0 : 1; float a = fract(sd * 11.31); vFlT = 0.; vFlC = vec3(1.);
  if (uTL.z > .5) {
    if (a < .07) { spr = 2; ramp = 2; tn = max(0, tn - 1); }   // tall, dry (the lush ramp, a tone lighter)
    else if (a < .11) { spr = 3; vFlC = uRamp[10] * vec3(1.08, 1.04, .9); }   // seed heads (straw: the lush ramp's highlight)
    else if (a < .15 && fract(sd * 13.7) < uFlowerK * 1.3) { spr = 4; vFlC = uFlower[int(fract(sd * 4.13) * 4.)]; vFlT = 2.; }   // in flower (own colours)
  }
  // the patches: two world-space noise fields shift whole patches into the dry or the deep ramp
  if (uTL.w > .5 && spr != 2 && (ramp <= 2 || ramp == 4 || ramp == 6)) {
    if (vn(root.xz * .085 + 17.) > .64) ramp = 2; else if (vn(root.xz * .12 - 31.) > .66) ramp = 1;
  }
  vRp = float(ramp * 5); vTn = float(tn);
  vec4 SP = uSpr[spr]; vSpr = SP; float SW = SP.z, SH = SP.w;
  float h = SH / uTD.y * uSnowK;   // m: its height (its rows at the view's px per m up), lying snow shortens it
  // ---- the wind: two noises along the wind turned +- the divergence, on the stepped clock
  vec3 w = windAt(root.xz); float wl = length(w.xy);
  vec2 D = uWG[1].w > .5 && length(uWG[0].xy) > .01 ? normalize(uWG[0].xy) : vec2(.94, .34);
  float t = uTime;
  if (uTW.x > .5) { float ph = fract(sd * 7.77); t = (floor(uTime * uTW.x + ph) - ph) / uTW.x; }
  vec2 D1 = rot(D, uTW.y), D2 = rot(D, -uTW.y);
  float k1 = uTW2.x, k2 = uTW2.x * 1.0471976;   // (pi / 3)
  float n1 = vn(root.xz * k1 - D1 * t * uTW2.y * k1), n2 = vn(root.xz * k2 + 5.3 - D2 * t * uTW2.y * 1.3183 * k2);
  float nz = clamp(n1 * n2 * 2.4 + .08, 0., 1.); vWN = nz;
  vec2 lean = D * nz * (uTW.z + uTW.w * min(6., wl)) * h + D * w.z * .3 * h;
  // ---- the pushers (the low tick's): bend away, most at the centre
  for (int i = 0; i < ${MAX_PUSH}; i++) {
    if (i >= uNPT) break;
    vec4 P = uPushT[i]; vec2 d = root.xz - P.xy; float l = length(d), r = P.z * uTL.y;
    if (l < r) lean += (l > 1e-3 ? d / l : vec2(1., 0.)) * pow(1. - l / r, 1.3) * min(P.w, 1.3) * h;
  }
  float trod = 0.;
  if (uTrOn > .5) { vec4 tr = texture(uTr, (root.xz - uTrBox.xy) * uTrBox.zw); lean += tr.xy * h * .9; trod = tr.z; }
  float L = length(lean), mx = uTW2.w * h; if (L > mx) { lean *= mx / L; L = mx; }
  float hv = sqrt(max(h * h - L * L, h * h * .05));
  // ---- on screen: the root, the top standing and the top as it leans
  mat4 PV = projectionMatrix * viewMatrix;
  vec4 cr = PV * vec4(root, 1.), c0 = PV * vec4(root + vec3(0., h, 0.), 1.), ct = PV * vec4(root + vec3(lean.x, hv, lean.y), 1.);
  float k = 1.;
#ifdef CINE
  if (cr.w < .3 || c0.w < .3 || ct.w < .3) { gl_Position = vec4(2., 2., 2., 1.); return; }
  float cz = cr.z / cr.w - .03 * -projectionMatrix[3][2] / (cr.w * cr.w);
  cr.xy /= cr.w; c0.xy /= c0.w; ct.xy /= ct.w;
#endif
  vec2 S = uRes / uZoom * .5;
  vec2 sr = (cr.xy + 1.) * S, s0 = (c0.xy + 1.) * S, st = (ct.xy + 1.) * S;
  float hp = s0.y - sr.y;   // px: its height standing up
#ifdef CINE
  if (hp < SH * .45) { gl_Position = vec4(2., 2., 2., 1.); return; }   // (far off in the perspective: the blades carry it)
  k = clamp(floor(hp / SH + .5), 1., 12.);
#endif
  hp = max(hp, 1e-3);
  float sq = clamp((hp + st.y - s0.y) / (SH * k), .25, 1.3);   // its rows now / at rest (bent over: lower)
  float sh = (st.x - s0.x) / k + uTW2.z * sin(t * 2.6 + sd * 6.2832);   // px the top moves across (+ a little sway in view space)
  vec3 fw = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]); vec2 fh = length(fw.xz) > 1e-4 ? normalize(fw.xz) : vec2(0., -1.);
  float along = dot(lean, fh) / h;   // + away from the camera, - toward it
  float lit = max(smoothstep(.12, .6, L / h), trod * 1.4);
  vT = vec4(sh, sq, uTL.x * along, lit);
  // the quad: round the sprite with room for the shear and the widening, on whole px from the root's pixel corner
  float cc = floor(SW * .5), sc = 1.2 + uTL.x * abs(along);
  vec2 lo = vec2(floor(-(cc + 1.) * sc - max(0., -sh)) - 1., 0.), hi = vec2(ceil((SW - cc + 1.) * sc + max(0., sh)) + 1., ceil(SH * max(sq, 1.)) + 1.);
  vec2 lp = mix(lo, hi, position.xy);
  vLoc = lp;
  vec2 pc = floor(sr) + lp * k;
#ifdef CINE
  gl_Position = vec4(pc / S - 1., cz, 1.);
#else
  gl_Position = vec4(pc / S - 1., cr.z - .0003, 1.);   // (all of it at its root's depth, a hair in front of the blades)
#endif
}`;
const TUFT_FS = HEAD + OUTS + CUT + `
in vec2 vLoc; flat in vec4 vSpr; flat in vec4 vT; flat in vec3 vR; flat in vec3 vFlC; flat in float vRp; flat in float vTn; flat in float vFlT; flat in float vWN;
uniform sampler2D uAtlas; uniform vec3 uRamp[40]; uniform vec4 uTD;
void main() {
  if (cutAway(vR + vec3(0., .05, 0.))) discard;
  vec2 cl = floor(vLoc); float col = cl.x, row = cl.y;
  float SW = vSpr.z, SH = vSpr.w, cc = floor(SW * .5);
  float sr = floor((row + .5) / vT.y); if (sr >= SH) discard;   // the sprite's row (squashed when it bends over)
  float u = SH > 1. ? sr / (SH - 1.) : 0.;                      // 0 the root .. 1 the tip
  float sh = floor(vT.x * pow(u, 1.5) + .5);                    // the shear: the tip the most
  float scl = clamp(1. - vT.z * u, .5, 1.8);                    // the fake perspective: the top rows widen toward the camera
  float sc = cc + floor((col - sh) / scl + .5);
  if (sc < 0. || sc >= SW) discard;
  int id = int(texelFetch(uAtlas, ivec2(int(vSpr.x + sc), int(vSpr.y + SH - 1. - sr)), 0).r * 255. + .5);
  if (id == 0) discard;
  vec3 c; int tone = 0;
  if (id >= 5) { c = vFlC * (id == 6 ? .74 : 1.); tone = int(vFlT + .5); }
  else {
    // HYBRID TOON: the tone as a number (its pixel's step from the tuft's tone, lighter where it bends and catches the light), the
    // step between two tones smoothed over uTD.z of the band
    float f = vTn + 1. + (id == 1 ? 1. : id == 2 ? -1. : id == 3 ? -2. : -3.) - vT.w * (.35 + .9 * u);   // (dark: a tone under the ground, an outline; the body a tone over it)
    f = clamp(f, 0., 4.); float i = min(3., floor(f)), fr = f - i, g = uTD.z;
    float wg = g > .001 ? smoothstep(.5 - g * .5, .5 + g * .5, fr) : step(.5, fr);
    int ri = int(vRp + .5) + int(i);
    c = mix(uRamp[ri], uRamp[ri + 1], wg);
    if (uTD.w > .5) c = vec3(vWN);   // (the dev's look at the wind field)
  }
  o0 = vec4(c, float(4 + tone) / 255.);   // type 1: ground
  o1 = vec4(0., 1., 0., -1.);
  o2 = vec4(0.);
}`;

export function createGrass(G, TB = TBOX) {
  const raw = (vs, fs, uniforms, extra = {}) => new THREE.RawShaderMaterial({vertexShader: vs, fragmentShader: fs, uniforms, glslVersion: THREE.GLSL3, ...extra});
  const v4s = n => Array.from({length: n}, () => new THREE.Vector4());
  // ---- the trample map (ping-pong)
  const TW = Math.ceil(TB.w * TB.ppm), TH = Math.ceil(TB.d * TB.ppm);
  const rtOpt = {type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false};
  const rts = [new THREE.WebGLRenderTarget(TW, TH, rtOpt), new THREE.WebGLRenderTarget(TW, TH, rtOpt)];
  let cur = 0, clean = false;
  const push = v4s(MAX_PUSH), pushV = v4s(MAX_PUSH), blasts = v4s(MAX_BLAST);
  const trU = {uPrev: {value: rts[0].texture}, uBox: {value: new THREE.Vector4(TB.x0, TB.z0, TB.ppm, TB.ppm)}, uDt: {value: 0}, uRec: {value: new THREE.Vector2(.02, .05)},
    uPush: {value: push}, uPushV: {value: pushV}, uNP: {value: 0}, uBlast: {value: blasts}, uNB: {value: 0}};
  const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const trScene = new THREE.Scene(), trCam = new THREE.Camera();
  { const m = new THREE.Mesh(tri, raw(FS_VS, TRAMPLE_FS, trU, {depthTest: false, depthWrite: false})); m.frustumCulled = false; m.matrixAutoUpdate = false; trScene.add(m); }

  // ---- the blades: a strip of 3 segments (rows at t = 0, .34, .67, 1), its own buffers per build (a geometry's dispose
  // deletes the GL buffers of every attribute it holds, shared or not)
  const STRIP_P = [], STRIP_I = [];
  for (const t of [0, .34, .67, 1]) STRIP_P.push(-.5, t, 0, .5, t, 0);
  for (let s = 0; s < 3; s++) { const a = s * 2; STRIP_I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const U = {
    uRes: {value: new THREE.Vector2(G.VW, G.VH)}, uZoom: {value: 1}, uTime: G.U.time, uSnowK: {value: 1}, uFlowerK: {value: 0}, uFlowerV: {value: 0}, uCalm: {value: 0},
    uK: {value: new THREE.Vector4(.32, .05, .16, .92)}, uSheen: {value: new THREE.Vector2(.17, .42)},
    uPush: {value: push}, uNP: {value: 0},
    uTr: {value: rts[0].texture}, uTrBox: {value: new THREE.Vector4(TB.x0, TB.z0, 1 / TB.w, 1 / TB.d)}, uTrOn: {value: 1},
    uRamp: {value: Array.from({length: 40}, () => new THREE.Vector3())},
    uFlower: {value: Array.from({length: 4}, () => new THREE.Vector3())},
    uWG: {value: v4s(2)}, uWF: {value: v4s(MAX_FRONTS * 4)}, ...cutU(G.U),
  };
  const mat = G.cineMat(raw(BLADE_VS, BLADE_FS, U, {side: THREE.DoubleSide}));   // (its cinema variant: gfx.js setCine)
  const meshes = []; let count = 0, visible = true;

  // (a, b, n) into CHUNK m squares, an instanced mesh each (geometry P / I, material mt) added to G.gScene and to list
  function chunk(a, b, n, mt, P, I, list, vis) {
    // the chunks: each blade by its root's CHUNK m square (from the blades' own corner), its instances copied into its chunk's buffers
    // (the builder's big arrays can go), the chunk's bounds round its roots + LEAN_PAD (the frustum culls it off screen)
    let gx0 = 1e9, gz0 = 1e9, gx1 = -1e9, gz1 = -1e9;   // (the blades' own extent: they may grow past the trample map's box)
    for (let i = 0; i < n; i++) { const x = a[i * 4], z = a[i * 4 + 2]; if (x < gx0) gx0 = x; if (x > gx1) gx1 = x; if (z < gz0) gz0 = z; if (z > gz1) gz1 = z; }
    const NX = Math.max(1, Math.ceil((gx1 - gx0 + 1e-3) / CHUNK)), NZ = Math.max(1, Math.ceil((gz1 - gz0 + 1e-3) / CHUNK)), key = new Int32Array(n), cnt = new Int32Array(NX * NZ);
    for (let i = 0; i < n; i++) {
      const cx = Math.min(NX - 1, Math.floor((a[i * 4] - gx0) / CHUNK)), cz = Math.min(NZ - 1, Math.floor((a[i * 4 + 2] - gz0) / CHUNK));
      key[i] = cz * NX + cx; cnt[key[i]]++;
    }
    const CA = [], CB = [], fillN = new Int32Array(NX * NZ);
    for (let k = 0; k < NX * NZ; k++) { CA.push(cnt[k] ? new Float32Array(cnt[k] * 4) : null); CB.push(cnt[k] ? new Float32Array(cnt[k] * 4) : null); }
    for (let i = 0; i < n; i++) { const k = key[i], o = fillN[k]++ * 4; for (let j = 0; j < 4; j++) { CA[k][o + j] = a[i * 4 + j]; CB[k][o + j] = b[i * 4 + j]; } }
    for (let k = 0; k < NX * NZ; k++) {
      if (!cnt[k]) continue;
      const A = CA[k]; let y0 = 1e9, y1 = -1e9, hMax = 0;
      for (let i = 0; i < cnt[k]; i++) { y0 = Math.min(y0, A[i * 4 + 1]); y1 = Math.max(y1, A[i * 4 + 1]); hMax = Math.max(hMax, A[i * 4 + 3]); }
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setIndex(I);
      geo.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4)); geo.setAttribute('iB', new THREE.InstancedBufferAttribute(CB[k], 4));
      geo.instanceCount = cnt[k];
      const cx = gx0 + ((k % NX) + .5) * CHUNK, cz = gz0 + (Math.floor(k / NX) + .5) * CHUNK, cy = (y0 + y1 + hMax) / 2;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), Math.hypot(CHUNK * .7071, (y1 + hMax - y0) / 2) + LEAN_PAD);
      geo.boundingBox = new THREE.Box3(new THREE.Vector3(cx - CHUNK / 2 - LEAN_PAD, y0 - .1, cz - CHUNK / 2 - LEAN_PAD), new THREE.Vector3(cx + CHUNK / 2 + LEAN_PAD, y1 + hMax + .2, cz + CHUNK / 2 + LEAN_PAD));
      const mesh = new THREE.Mesh(geo, mt); mesh.frustumCulled = true; mesh.matrixAutoUpdate = false; mesh.visible = vis;
      G.gScene.add(mesh); list.push(mesh);
    }
  }
  // blades: (a, b, n), ramps (up to 8 x [highlight, tone 0 .. 3]) as documented above; flowers: [r, g, b] x 4
  function setBlades(a, b, n, ramps, flowers) {
    drop();
    for (let r = 0; r < 8; r++) for (let t = 0; t < 5; t++) U.uRamp.value[r * 5 + t].set(...(ramps[r]?.[t] || [0, 0, 0]));
    for (let i = 0; i < 4; i++) U.uFlower.value[i].set(...(flowers[i] || [1, 1, 1]));
    if (!n) return;
    chunk(a, b, n, mat, STRIP_P, STRIP_I, meshes, visible);
    count = n; clean = false;
  }
  function drop() { for (const m of meshes) { G.gScene.remove(m); m.geometry.dispose(); } meshes.length = 0; count = 0; }

  // ---- THE TUFTS (TUFT_VS above): a quad each, its own chunks, the blades' wind / trample / ramps uniforms shared
  const atlas = (() => {
    const AW = 64, AH = 16, px = new Uint8Array(AW * AH), spr = [];
    let x0 = 0;
    for (const art of TUFT_ART) {
      const w = art[0].length, h = art.length;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) px[r * AW + x0 + c] = TUFT_IDS[art[r][c]] ?? 0;   // (row 0 = the top row)
      spr.push(new THREE.Vector4(x0, 0, w, h)); x0 += w + 1;
    }
    const tex = new THREE.DataTexture(px, AW, AH, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.unpackAlignment = 1; tex.flipY = false; tex.needsUpdate = true;
    return {tex, spr};
  })();
  const pushT = v4s(MAX_PUSH);
  const TU = {uRes: U.uRes, uZoom: U.uZoom, uTime: U.uTime, uSnowK: U.uSnowK, uFlowerK: U.uFlowerK, uFlower: U.uFlower, uRamp: U.uRamp,
    uTr: U.uTr, uTrBox: U.uTrBox, uTrOn: U.uTrOn, uWG: U.uWG, uWF: U.uWF, ...cutU(G.U),
    uPushT: {value: pushT}, uNPT: {value: 0}, uSpr: {value: atlas.spr}, uAtlas: {value: atlas.tex},
    uTW: {value: new THREE.Vector4(8, .5, .3, .1)}, uTW2: {value: new THREE.Vector4(.35, 1.6, .6, .85)},
    uTL: {value: new THREE.Vector4(.55, 1.5, 1, 1)}, uTD: {value: new THREE.Vector4(1, 16, .35, 0)}};
  const tmat = G.cineMat(raw(TUFT_VS, TUFT_FS, TU, {side: THREE.DoubleSide}));
  const QUAD_P = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], QUAD_I = [0, 1, 2, 1, 3, 2];
  const tmeshes = []; let tcount = 0, tvisible = true;
  // tufts: a, b Float32Array(n * 4): a = (root X, Y, Z, rest height m), b = (ramp * 4 + tone, seed 0..1, 0, 0)
  function setTufts(a, b, n) {
    for (const m of tmeshes) { G.gScene.remove(m); m.geometry.dispose(); } tmeshes.length = 0; tcount = 0;
    if (!n) return;
    chunk(a, b, n, tmat, QUAD_P, QUAD_I, tmeshes, visible && tvisible); tcount = n;
  }
  // the tufts' pushers (the low tick: features/grass.js): the same records as setPushers
  function setTuftPushers(arr, n) {
    n = Math.min(n, MAX_PUSH);
    for (let i = 0; i < n; i++) { const o = i * 8; pushT[i].set(arr[o], arr[o + 1], arr[o + 2], arr[o + 3]); }
    TU.uNPT.value = n;
  }
  // the tufts' look, any of: {fps, div (rad), calm, perMs, scale (noise per m), speed, sway (px), maxLean, persp, pushR, accents, patches,
  // density, ppmh, toon, debug}
  function setTuftLook(o) {
    const W = TU.uTW.value, W2 = TU.uTW2.value, L = TU.uTL.value, D = TU.uTD.value;
    if (o.fps !== undefined) W.x = o.fps; if (o.div !== undefined) W.y = o.div; if (o.calm !== undefined) W.z = o.calm; if (o.perMs !== undefined) W.w = o.perMs;
    if (o.scale !== undefined) W2.x = o.scale; if (o.speed !== undefined) W2.y = o.speed; if (o.sway !== undefined) W2.z = o.sway; if (o.maxLean !== undefined) W2.w = o.maxLean;
    if (o.persp !== undefined) L.x = o.persp; if (o.pushR !== undefined) L.y = o.pushR; if (o.accents !== undefined) L.z = o.accents ? 1 : 0; if (o.patches !== undefined) L.w = o.patches ? 1 : 0;
    if (o.density !== undefined) D.x = o.density; if (o.ppmh !== undefined) D.y = o.ppmh; if (o.toon !== undefined) D.z = o.toon; if (o.debug !== undefined) D.w = o.debug ? 1 : 0;
  }
  function setTuftsVisible(v) { tvisible = v; for (const m of tmeshes) m.visible = visible && v; }

  // the wind: buf as W.gpu() filled it (or null: still)
  function setWind(buf) {
    const g = U.uWG.value, f = U.uWF.value;
    if (!buf) { g[1].w = 0; return; }
    g[0].set(buf[0], buf[1], buf[2], buf[3]); g[1].set(buf[4], buf[5], buf[6], buf[7]);
    for (let i = 0, n = buf[6]; i < n; i++) for (let k = 0; k < 4; k++) { const o = 8 + i * 16 + k * 4; f[i * 4 + k].set(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]); }
  }
  // pushers: arr = [x, z, r, live strength, dir x, dir z, trample strength, 0] x n (world X / Z)
  function setPushers(arr, n) {
    n = Math.min(n, MAX_PUSH);
    for (let i = 0; i < n; i++) { const o = i * 8; push[i].set(arr[o], arr[o + 1], arr[o + 2], arr[o + 3]); pushV[i].set(arr[o + 4], arr[o + 5], arr[o + 6], 0); }
    U.uNP.value = trU.uNP.value = n;
  }
  let nb = 0;
  function blast(x, z, r, k) { if (nb < MAX_BLAST) blasts[nb++].set(x, z, r, k); }
  function setLook(snowK, flowerK) { U.uSnowK.value = snowK; U.uFlowerK.value = flowerK; }   // (positional: called every frame, no object)
  function setFlowerShape(v) { U.uFlowerV.value = v ? 1 : 0; }
  function setCalm(v) { U.uCalm.value = v ? 1 : 0; }
  // once a frame, before G.render(): the trample pass, the view's size and zoom
  function step(dt) {
    U.uRes.value.set(G.VW, G.VH); U.uZoom.value = G.view.zoom || 1;
    if ((!meshes.length && !tmeshes.length) || !visible) { nb = 0; return; }
    const R = G.renderer, prev = R.getRenderTarget();
    if (!clean) { for (const rt of rts) { R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(true, false, false); } clean = true; }
    trU.uPrev.value = rts[cur].texture; trU.uDt.value = Math.min(.1, dt); trU.uNB.value = nb;
    R.setRenderTarget(rts[1 - cur]); R.render(trScene, trCam); R.setRenderTarget(prev);
    cur = 1 - cur; U.uTr.value = rts[cur].texture; nb = 0;
  }
  function setVisible(v) { visible = v; for (const m of meshes) m.visible = v; for (const m of tmeshes) m.visible = v && tvisible; }
  function dispose() { drop(); setTufts(null, null, 0); tmat.dispose(); atlas.tex.dispose(); mat.dispose(); for (const rt of rts) rt.dispose(); trScene.children[0].material.dispose(); tri.dispose(); }
  return {setBlades, setWind, setPushers, blast, setLook, setFlowerShape, setCalm, step, setVisible, dispose, U, get count() { return count; },
    setTufts, setTuftPushers, setTuftLook, setTuftsVisible, TU, get tuftCount() { return tcount; }, tmeshes, get mesh() { return meshes[0] || null; }, meshes,
    get trample() { return rts[cur]; }, TBOX: TB};   // (the trample map now: for a look in dev tools)
}
