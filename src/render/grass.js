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
// API: createGrass(G) -> {setBlades(a, b, n, ramps, flowers), step(dt), setWind(buf | null), setPushers(arr, n), blast(x, z, r, k),
//   setLook(snowK, flowerK), setFlowerShape(v), setCalm(v), setVisible(v), dispose(), mesh, count}
//   setFlowerShape: 0 a 2 px head (default), 1 a V of two petals over a centre, 3 px wide (the cool palette: features/grass.js)
//   setCalm: 1 the blades in the ground's own tone with light tips (a calm sward), 0 each blade a tone lighter (features/grass.js)
//   a, b: Float32Array(n * 4) per blade: a = (root X, root Y (ground height), root Z, height m), b = (ramp * 4 + tone,
//   phase 0..1, flower colour 0 none / 1..4, rest lean: whole part = its size in 32nds of the height, fraction = its angle / 2 pi);
//   ramps: 4 x [highlight, tone 0 .. 3] as [r, g, b] 0..1
// THE CINEMA CAMERA (gfx.js setCine): a variant of the blades' shader divides by w (a perspective) and clips blades behind it.
// OWNS: its mesh (in G.gScene), the blade buffers, the trample targets. READS: G.camera, G.view.zoom, G.VW / VH, G.U.time.
// BUDGET: CPU: in features/grass.js's frame (~0.04 ms). GPU: one instanced draw (~50k blades x 8 vertices) + one 384 x 192
// pass; the bench's GPU p95 at 3440x1440 stayed within ~0.1-0.3 ms of grass=0 (a busy machine: noisy), budget 4.5 ms.
import * as THREE from 'three';

const HEAD = `precision highp float; precision highp int;\n`;
const OUTS = `layout(location = 0) out vec4 o0;\nlayout(location = 1) out vec4 o1;\nlayout(location = 2) out vec4 o2;\n`;
export const MAX_FRONTS = 12, MAX_PUSH = 16, MAX_BLAST = 4;
// the trample map's box (world X / Z, m: the Proving Grounds + 1 m) and its texels per metre
const TBOX = {x0: -1, z0: -1, w: 64, d: 32, ppm: 6};

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
uniform vec3 uRamp[20];   // per ramp: [highlight, tone 0 .. 3] (light -> dark)
out float vT; out float vSide; flat out vec3 vC0; flat out vec3 vC1; flat out vec3 vC2; flat out float vHp; flat out float vFl;
void main() {
  vec3 root = iA.xyz; float h = iA.w * uSnowK, t = position.y, ph = iB.y;
  // the tip's sideways push (m, world X / Z)
  vec3 w = windAt(root.xz);
  float ra = fract(iB.w) * 6.2832;
  vec2 lean = vec2(cos(ra), sin(ra)) * floor(iB.w) / 32. * h + w.xy * uK.x * h;   // its own growth (a tuft fans out) + the wind
  float ft = uTime * (2.1 + ph * 1.7) + ph * 6.2832 + dot(root.xz, vec2(.9, .7));
  lean += vec2(sin(ft), cos(ft * 1.3)) * (uK.y + uK.z * w.z) * h;
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
const BLADE_FS = HEAD + OUTS + `
in float vT; in float vSide; flat in vec3 vC0; flat in vec3 vC1; flat in vec3 vC2; flat in float vHp; flat in float vFl;
uniform vec3 uFlower[4]; uniform float uFlowerV;
void main() {
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

export function createGrass(G) {
  const raw = (vs, fs, uniforms, extra = {}) => new THREE.RawShaderMaterial({vertexShader: vs, fragmentShader: fs, uniforms, glslVersion: THREE.GLSL3, ...extra});
  const v4s = n => Array.from({length: n}, () => new THREE.Vector4());
  // ---- the trample map (ping-pong)
  const TW = TBOX.w * TBOX.ppm, TH = TBOX.d * TBOX.ppm;
  const rtOpt = {type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false};
  const rts = [new THREE.WebGLRenderTarget(TW, TH, rtOpt), new THREE.WebGLRenderTarget(TW, TH, rtOpt)];
  let cur = 0, clean = false;
  const push = v4s(MAX_PUSH), pushV = v4s(MAX_PUSH), blasts = v4s(MAX_BLAST);
  const trU = {uPrev: {value: rts[0].texture}, uBox: {value: new THREE.Vector4(TBOX.x0, TBOX.z0, TBOX.ppm, TBOX.ppm)}, uDt: {value: 0}, uRec: {value: new THREE.Vector2(.02, .05)},
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
    uTr: {value: rts[0].texture}, uTrBox: {value: new THREE.Vector4(TBOX.x0, TBOX.z0, 1 / TBOX.w, 1 / TBOX.d)}, uTrOn: {value: 1},
    uRamp: {value: Array.from({length: 20}, () => new THREE.Vector3())},
    uFlower: {value: Array.from({length: 4}, () => new THREE.Vector3())},
    uWG: {value: v4s(2)}, uWF: {value: v4s(MAX_FRONTS * 4)},
  };
  const mat = G.cineMat(raw(BLADE_VS, BLADE_FS, U, {side: THREE.DoubleSide}));   // (its cinema variant: gfx.js setCine)
  let mesh = null, geo = null, count = 0, visible = true;

  // blades: (a, b, n), ramps (4 x [highlight, tone 0 .. 3]) as documented above; flowers: [r, g, b] x 4
  function setBlades(a, b, n, ramps, flowers) {
    drop();
    for (let r = 0; r < 4; r++) for (let t = 0; t < 5; t++) U.uRamp.value[r * 5 + t].set(...(ramps[r]?.[t] || [0, 0, 0]));
    for (let i = 0; i < 4; i++) U.uFlower.value[i].set(...(flowers[i] || [1, 1, 1]));
    if (!n) return;
    geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(STRIP_P, 3)); geo.setIndex(STRIP_I);
    geo.setAttribute('iA', new THREE.InstancedBufferAttribute(a.slice(0, n * 4), 4));   // (copies: the builder's big arrays can go)
    geo.setAttribute('iB', new THREE.InstancedBufferAttribute(b.slice(0, n * 4), 4));
    geo.instanceCount = n; count = n;
    mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.visible = visible;
    G.gScene.add(mesh); clean = false;
  }
  function drop() { if (mesh) { G.gScene.remove(mesh); geo.dispose(); mesh = geo = null; } count = 0; }

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
    if (!mesh || !visible) { nb = 0; return; }
    const R = G.renderer, prev = R.getRenderTarget();
    if (!clean) { for (const rt of rts) { R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(true, false, false); } clean = true; }
    trU.uPrev.value = rts[cur].texture; trU.uDt.value = Math.min(.1, dt); trU.uNB.value = nb;
    R.setRenderTarget(rts[1 - cur]); R.render(trScene, trCam); R.setRenderTarget(prev);
    cur = 1 - cur; U.uTr.value = rts[cur].texture; nb = 0;
  }
  function setVisible(v) { visible = v; if (mesh) mesh.visible = v; }
  function dispose() { drop(); mat.dispose(); for (const rt of rts) rt.dispose(); trScene.children[0].material.dispose(); tri.dispose(); }
  return {setBlades, setWind, setPushers, blast, setLook, setFlowerShape, setCalm, step, setVisible, dispose, U, get count() { return count; }, get mesh() { return mesh; },
    get trample() { return rts[cur]; }, TBOX};   // (the trample map now: for a look in dev tools)
}
