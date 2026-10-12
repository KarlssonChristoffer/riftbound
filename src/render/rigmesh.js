// RIGMESH: live 3D characters painted the way the sprites are (the ragdolls: view/ragdoll.js). A model is the same
// Blender model the sprite atlas is rendered from, cut into rigid per-bone segments (tools/blender/ragdoll_export.py);
// each body on screen is one INSTANCE whose segments' rigid transforms (3x4 each) sit in a small float texture (one row
// a body), so every body of a model is drawn in one draw per pass, no skinning. Three passes:
//   A  (this module's own target, before the frame's G.render: frame() renders it) every body's triangles at the
//      view's resolution, writing part / family / the pixelizer's tone / the body (bytes as floats) and the normal +
//      the pixelizer's depth (along the sprite camera's view axis). The tone is pixelize.py's: its light fixed to the
//      CAMERA (top-left, the atlas's 20 deg basis), 3 bands at .78 / .36 plus the part's bias, or the part's fixed tone.
//   B  (in the G-buffer: G.extra 'gbuf', a full-view triangle) pixelize.py's rules on A, per pixel: interior lines
//      where a nearer part of the same body borders it (same family: the line tone; another family above / left:
//      at least the shade), the orphan clean-up (on the raw bands), and the EXTERIOR outline round the silhouette (the
//      nearest neighbouring part's family, the lit outline tone where the empty side is up or left): written as a lit
//      card's pixels (type 7, the sprites' type: the same light, the same bands, no self-shadow), at A's depth (the
//      outline at its body pixel's), so the world in front still hides it. Fades with the sprites' ordered dither.
//   S  (the per-frame sun shadow: G.extra 'shadow') the true 3D body casts.
// THE SPRITE CAMERA: an upright body is drawn with its ground depth squashed toward its anchor (k = tan(pitch) cos 20 /
// sin 55; at the atlas's 20 deg: .42), so it projects exactly as the sprite camera saw it (heights cos 20 px a metre,
// ground sin 20); lying (pitch 41.08) k = 1: the game's own ground projection, as the death clips' lying frames.
// API: const rig = createRigMesh(G, {slots}); rig.id / rig.owns(obj) (its meshes in G's scenes: a studio keeps them alone,
// G.isolate); rig.addModel(json, bin) -> model; per frame rig.put(model, slot, mats,
//   params) for each body (mats: Float32Array segs x 12, rows of each segment's 3x4 world matrix; params: x, y, z (the
//   squash anchor), k, alpha, flash, pitch (rad), sx, sy, sz (the snap anchor, world axes), snap (1: on), type (the
//   G-buffer pixel type pass B writes: 0 / absent = 7, the lit card; 4 = the character, as the player's card: view/livehero.js)),
//   then rig.render() (pass A now, B and S armed for this frame's G.render). rig.putv(model, slot, mats, pv): the same with the
//   params as a Float64Array in that order (x, z, k, alpha, flash, pitch, y, type, sx, sy, sz, snap): no per-frame boxing. rig.warm() once the models are added (at load:
//   no first-use hitch). rig.bytes. rig.restyle(model, json, bin): the model's corners replaced (the same segments: gear,
//   view/dress.js), its bodies and attachments kept.
//   {xray: true}: a fourth pass X marks where a character body (type 4) is hidden, for the composite's x-ray (gfx.js).
//   rig.attach(model, corners, families) -> a DYNAMIC mesh drawn with the model's FIRST body each frame (the live hero's
//   runtime cloth, view/livehero.js): {pos (corners x 3: in the frame of the segment its info names), nrm (x 4, int8:
//   normal x 127, bias x 100), info (x 4: segment, part, family (an index into `families`, mapped here), flags; written
//   once, before the first frame: it goes up with the first draw; rewritten later: infoChanged()), fam, famRow(family) (its row, for
//   info), update(n): n corners of pos + nrm this frame}. It goes through passes A, B, S and X as the body's own triangles do.
// OWNS: its target, the transforms texture, the ramps texture, its meshes and materials.
// READS: G (camera, view size, frame, extra).  EMITS: nothing.  BUDGET: render: per model 2 draws (A, S) + 1 (B) a frame while bodies show;
//   CPU: the transforms texture upload (slots x 74 texels) when a body moved; no allocation per frame.
import * as THREE from 'three';

export const SEGMAX = 24;          // segments a model may have (the bandit: 22)
const PCOL = SEGMAX * 3;           // a body's row: 3 texels a segment, then 3 of its params
const XW = PCOL + 3;
const HEAD = `precision highp float; precision highp int;\n`;
const XF = `
uniform sampler2D uXf;
vec3 rigPos(vec3 p, int s, int b, out vec4 r0, out vec4 r1, out vec4 r2) {
  r0 = texelFetch(uXf, ivec2(s * 3, b), 0); r1 = texelFetch(uXf, ivec2(s * 3 + 1, b), 0); r2 = texelFetch(uXf, ivec2(s * 3 + 2, b), 0);
  vec4 q = vec4(p, 1.); return vec3(dot(r0, q), dot(r1, q), dot(r2, q));
}`;
const A_VS = HEAD + XF + `
in vec3 position; in vec4 aNrm; in vec4 aInfo; in float iSlot;
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uFwd;   // the view's "away" along the ground (X, Z): the squash axis
uniform vec2 uSnap;   // the view's size in px: the body's anchor lands on a whole pixel, as a sprite's does (BATCH_VS)
out vec3 vN; out vec3 vW; flat out vec4 vInfo; flat out float vSlot; flat out float vBias;
void main() {
  int b = int(iSlot + .5); vec4 r0, r1, r2;
  vec3 w = rigPos(position, int(aInfo.x + .5), b, r0, r1, r2);
  vN = vec3(dot(r0.xyz, aNrm.xyz), dot(r1.xyz, aNrm.xyz), dot(r2.xyz, aNrm.xyz));
  vec4 bp = texelFetch(uXf, ivec2(${PCOL}, b), 0);   // anchor X, Z, squash k, alpha
  vW = w;
#ifndef CINE
  w.xz -= uFwd * dot(w.xz - bp.xy, uFwd) * (1. - bp.z);   // (a cinema camera, gfx.js setCine, sees the true body: no squash)
#endif
  vInfo = aInfo; vSlot = float(b); vBias = aNrm.w * 1.27;   // (bias x 100 as an int8: 127 -> 1)
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
  vec4 sa = texelFetch(uXf, ivec2(${PCOL + 2}, b), 0);   // the snap anchor (where he stood: the last sprite's anchor), on
#ifndef CINE
  if (sa.w > .5) { vec4 a = projectionMatrix * viewMatrix * vec4(sa.xyz, 1.); vec2 p = (a.xy * .5 + .5) * uSnap; gl_Position.xy += (floor(p + .5) - p) / uSnap * 2.; }
#endif   // (a cinema camera, gfx.js setCine: no snap, the body glides with the world)
}`;
const A_FS = HEAD + `
in vec3 vN; in vec3 vW; flat in vec4 vInfo; flat in float vSlot; flat in float vBias;
uniform sampler2D uXf; uniform vec3 uLight; uniform float uYaw;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
void main() {
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  int fl = int(vInfo.w + .5), fx = fl & 7, tone;
  if (fx > 0) tone = fx - 1;
  else { float d = dot(n, uLight) + vBias; tone = d > .78 ? 0 : d > .36 ? 1 : 2; }
  vec4 p1 = texelFetch(uXf, ivec2(${PCOL + 1}, int(vSlot + .5)), 0);   // flash, pitch, anchor Y, -
  vec3 V = vec3(sin(uYaw) * cos(p1.y), sin(p1.y), cos(uYaw) * cos(p1.y));   // toward the sprite camera at the body's pitch
  vec4 p0 = texelFetch(uXf, ivec2(${PCOL}, int(vSlot + .5)), 0);
  // part, family + 1, tone + 4 (no exterior outline) + 8 (no interior lines), body + 1; normal, nearness (m, from the anchor)
  o0 = vec4(vInfo.y, vInfo.z + 1., float(tone + ((fl >> 3) & 1) * 4 + ((fl >> 4) & 1) * 8), vSlot + 1.);
  o1 = vec4(n, dot(vW - vec3(p0.x, p1.z, p0.y), V));
}`;
// X (optional, {xray: true}: the player's x-ray, G.extra 'xray') where a character body (type 4) is hidden by the scene: its
// pass-A depth behind the G-buffer's (which holds its own where it shows) -> R, as gfx.js XRAY_FS marks the player's card
const X_FS = HEAD + `
layout(location = 0) out vec4 o0;
uniform sampler2D tId, tDep, uGDep, uXf;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy); vec4 c = texelFetch(tId, p, 0);
  if (c.w < .5 || texelFetch(uXf, ivec2(${PCOL + 1}, int(c.w + .5) - 1), 0).w != 4.) discard;
  if (texelFetch(tDep, p, 0).r <= texelFetch(uGDep, p, 0).r + 1.5e-4) discard;
  o0 = vec4(1., 0., 0., 0.);
}`;
const S_VS = HEAD + XF + `
in vec3 position; in vec4 aInfo; in float iSlot; uniform mat4 viewMatrix, projectionMatrix;
void main() { vec4 r0, r1, r2; gl_Position = projectionMatrix * viewMatrix * vec4(rigPos(position, int(aInfo.x + .5), int(iSlot + .5), r0, r1, r2), 1.); }`;
const S_FS = HEAD + `layout(location = 0) out vec4 o0; void main() { o0 = vec4(1.); }`;
// (B and X cover only the bodies' screen box, uBox: NDC min x, y, max x, y; the full-view triangle mapped onto it)
const B_VS = HEAD + `in vec3 position; uniform vec4 uBox; void main() { gl_Position = vec4(uBox.xy + (position.xy + 1.) * .5 * (uBox.zw - uBox.xy), 0., 1.); }`;
const B_FS = HEAD + `
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
uniform sampler2D tId, tNv, tDep, uRamp, uXf; uniform vec2 uRes; uniform vec3 uDefN; uniform float uEps;
float bayer(ivec2 p) { int i = (p.x & 3) + (p.y & 3) * 4;
  const float B[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.); return (B[i] + .5) / 16.; }
vec4 idAt(ivec2 q) { return q.x < 0 || q.y < 0 || q.x >= int(uRes.x) || q.y >= int(uRes.y) ? vec4(0.) : texelFetch(tId, q, 0); }
bool rimBody(vec4 q) { return q.w > .5 && (int(q.z + .5) & 4) == 0; }   // a body pixel an outline may take its family from
// "empty" for the outline's tone (pixelize.py): neither a body pixel nor an outline pixel (one with a body beside it);
// e is the pixel beside the outline pixel p, k the way from e back to p (not looked at: p is no body)
bool empty(ivec2 e, int k) {
  if (idAt(e).w > .5) return false;
  ivec2 N[4] = ivec2[4](ivec2(0, 1), ivec2(-1, 0), ivec2(1, 0), ivec2(0, -1));
  for (int j = 0; j < 4; j++) if (j != k && rimBody(idAt(e + N[j]))) return false;
  return true;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = idAt(p);
  ivec2 N4[4] = ivec2[4](ivec2(0, 1), ivec2(-1, 0), ivec2(1, 0), ivec2(0, -1));   // up, left, right, down (GL rows go up)
  int fam, slot, tone; float dep; vec3 n;
  if (c.w > .5) {   // a body pixel: its band, the clean-up, the interior lines
    int part = int(c.x + .5), code = int(c.z + .5); fam = int(c.y + .5) - 1; slot = int(c.w + .5) - 1; tone = code & 3;
    vec4 nv = texelFetch(tNv, p, 0); n = nv.xyz; dep = texelFetch(tDep, p, 0).r;
    int same = 0, cnt[4] = int[4](0, 0, 0, 0); vec4 q[4]; float qd[4];
    for (int k = 0; k < 4; k++) {
      q[k] = idAt(p + N4[k]); qd[k] = q[k].w > .5 ? texelFetch(tNv, p + N4[k], 0).w : -1e9;
      if (q[k].w > .5 && int(q[k].x + .5) == part && int(q[k].w + .5) - 1 == slot) { same++; cnt[int(q[k].z + .5) & 3]++; }
    }
    if (tone < 3 && same >= 3 && cnt[tone] == 0) {   // an orphan in its part: the neighbours' most common band
      int best = 0; for (int t = 1; t < 4; t++) if (cnt[t] > cnt[best]) best = t; tone = best;
    }
    if ((code & 8) == 0) {
      int edit = -1;
      for (int k = 0; k < 4; k++) {
        if (q[k].w < .5 || int(q[k].w + .5) - 1 != slot || int(q[k].x + .5) == part || (int(q[k].z + .5) & 4) != 0) continue;
        if (qd[k] < nv.w + uEps) continue;   // not in front of me by 6 cm
        if (int(q[k].y + .5) - 1 == fam) edit = 3; else if (k <= 1) edit = max(edit, max(tone, 2));
      }
      if (edit >= 0) tone = edit;
    }
  } else {   // the exterior outline: the nearest neighbouring part's family
    int bk = -1; float bd = 2.;
    for (int k = 0; k < 4; k++) {
      vec4 q = idAt(p + N4[k]); if (!rimBody(q)) continue;
      float d = texelFetch(tDep, p + N4[k], 0).r; if (d < bd) { bd = d; bk = k; }
    }
    if (bk < 0) discard;
    vec4 q = idAt(p + N4[bk]); fam = int(q.y + .5) - 1; slot = int(q.w + .5) - 1; dep = bd; n = uDefN;
    tone = empty(p + N4[1], 2) || empty(p + N4[0], 3) ? 5 : 4;   // the empty side up or left: the lit outline
  }
  vec4 b0 = texelFetch(uXf, ivec2(${PCOL}, slot), 0), b1 = texelFetch(uXf, ivec2(${PCOL + 1}, slot), 0);
  if (b0.w < .999 && b0.w <= bayer(p)) discard;   // alpha as an ordered dither (the sprites' fade)
  int ty = b1.w > .5 ? int(b1.w + .5) : 7;   // the body's pixel type (param 'type': 4 = the character; default 7, a lit card)
  o0 = vec4(texelFetch(uRamp, ivec2(tone, fam), 0).rgb, float(ty * 4) / 255.);
  o1 = vec4(n, 9.);
  o2 = vec4(vec3(b1.x), 0.);
  gl_FragDepth = dep;
}`;

export function createRigMesh(G, {slots = 16, xray = false} = {}) {
  const raw = (vs, fs, uniforms, extra = {}) => new THREE.RawShaderMaterial({vertexShader: vs, fragmentShader: fs, uniforms, glslVersion: THREE.GLSL3, ...extra});
  const near = THREE.NearestFilter;
  let VW = G.VW, VH = G.VH;
  const rt = new THREE.WebGLRenderTarget(VW, VH, {count: 2, type: THREE.HalfFloatType, minFilter: near, magFilter: near, depthBuffer: true,
    depthTexture: new THREE.DepthTexture(VW, VH, THREE.UnsignedIntType)});
  // the bodies' transforms: a float texture, one row a slot
  const xfData = new Float32Array(XW * slots * 4);
  const xf = new THREE.DataTexture(xfData, XW, slots, THREE.RGBAFormat, THREE.FloatType);
  xf.minFilter = xf.magFilter = near; xf.generateMipmaps = false; xf.needsUpdate = true;
  // the families' ramps (6 tones each: pixelize.py's hi, base, shade, line, outline shadow, outline lit), a row each
  let rampData = new Uint8Array(6 * 4 * 32), famN = 0;
  const famRow = new Map();   // 'name:tones' -> its row
  const ramp = new THREE.DataTexture(rampData, 6, 32, THREE.RGBAFormat, THREE.UnsignedByteType);
  ramp.minFilter = ramp.magFilter = near; ramp.generateMipmaps = false; ramp.needsUpdate = true;
  const U = {
    uXf: {value: xf}, uFwd: {value: new THREE.Vector2(0, -1)}, uLight: {value: new THREE.Vector3()}, uYaw: {value: 0},
    tId: {value: rt.textures[0]}, tNv: {value: rt.textures[1]}, tDep: {value: rt.depthTexture}, uRamp: {value: ramp},
    uRes: {value: new THREE.Vector2(VW, VH)}, uSnap: {value: new THREE.Vector2(VW, VH)}, uDefN: {value: new THREE.Vector3(0, 1, 0)}, uEps: {value: .06},
    uBox: {value: new THREE.Vector4(-1, -1, 1, 1)},
  };
  const sceneA = new THREE.Scene(); sceneA.matrixAutoUpdate = false; sceneA.matrixWorldAutoUpdate = false;
  const matA = G.cineMat(raw(A_VS, A_FS, U, {side: THREE.DoubleSide})), matS = raw(S_VS, S_FS, U, {side: THREE.DoubleSide});
  const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const meshB = new THREE.Mesh(tri, raw(B_VS, B_FS, U)); meshB.frustumCulled = false; meshB.matrixAutoUpdate = false;
  const id = {};   // this rig: on each of its meshes in G's scenes (userData.rig), so a studio can keep it alone (G.isolate)
  meshB.userData.rig = id; G.extra(meshB, 'gbuf');
  let meshX = null;
  if (xray) { U.uGDep = {value: G.compU.tD.value}; meshX = new THREE.Mesh(tri, raw(B_VS, X_FS, U, {depthTest: false, depthWrite: false})); meshX.frustumCulled = false; meshX.matrixAutoUpdate = false; meshX.userData.rig = id; G.extra(meshX, 'xray'); }
  const models = [];
  let dirty = false, used = false, warmN = 0;

  // a model from ragdoll_export.py's json + bin: the triangles (de-interleaved once), its families' ramps
  function addModel(J, bin) {
    if (J.segs.length > SEGMAX) throw new Error(`rigmesh: ${J.segs.length} segments (max ${SEGMAX})`);
    const iSlot = new THREE.InstancedBufferAttribute(new Float32Array(slots), 1); iSlot.setUsage(THREE.DynamicDrawUsage);
    const geo = geometry(J, bin, iSlot);
    const mA = new THREE.Mesh(geo, matA), mS = new THREE.Mesh(geo, matS);
    for (const m of [mA, mS]) { m.frustumCulled = false; m.matrixAutoUpdate = false; }
    mS.userData.rig = id; sceneA.add(mA); G.extra(mS, 'shadow');
    const M = {J, geo, iSlot, mA, mS, n: 0, segs: J.segs.length, bytes: geoBytes(geo), att: []};
    models.push(M);
    return M;
  }
  // the model's triangles as a geometry: de-interleaved, families -> the ramps texture's rows (a family another model
  // already brought (the same name and tones: skin, leather, iron ...) shares its row)
  function geometry(J, bin, iSlot) {
    const n = J.meta.corners, dv = new DataView(bin);
    const FM = J.families.map(famRowOf);
    ramp.needsUpdate = true;
    const pos = new Float32Array(n * 3), nrm = new Int8Array(n * 4), info = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = i * 20;
      pos[i * 3] = dv.getFloat32(o, true); pos[i * 3 + 1] = dv.getFloat32(o + 4, true); pos[i * 3 + 2] = dv.getFloat32(o + 8, true);
      for (let k = 0; k < 4; k++) nrm[i * 4 + k] = dv.getInt8(o + 12 + k);
      info[i * 4] = dv.getUint8(o + 16); info[i * 4 + 1] = dv.getUint8(o + 17); info[i * 4 + 2] = FM[dv.getUint8(o + 18)]; info[i * 4 + 3] = dv.getUint8(o + 19);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aNrm', new THREE.BufferAttribute(nrm, 4, true));
    geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 4, false));
    geo.setAttribute('iSlot', iSlot);
    geo.instanceCount = 0;
    return geo;
  }
  const geoBytes = geo => geo.attributes.position.array.byteLength + geo.attributes.aNrm.array.byteLength + geo.attributes.aInfo.array.byteLength;
  // the model drawn from new corners (view/dress.js: the same segments and bones, other corners and families): its bodies,
  // slots and attachments stay. Rare (a change of gear), never per frame: a new geometry, the old one's buffers freed.
  function restyle(M, J, bin) {
    if (J.segs.length !== M.segs) throw new Error('rigmesh: restyle with other segments');
    const old = M.geo, geo = geometry(J, bin, M.iSlot);
    geo.instanceCount = old.instanceCount;
    M.mA.geometry = M.mS.geometry = geo; M.bytes += geoBytes(geo) - geoBytes(old);
    old.deleteAttribute('iSlot'); old.dispose();   // (iSlot lives on: the new geometry and the attachments draw with it)
    M.geo = geo; M.J = J;
  }
  function famRowOf(f) {
    const key = f.name + ':' + f.ramp.join(';'); let row = famRow.get(key);
    if (row !== undefined) return row;
    if (famN * 6 * 4 >= rampData.length) { const d = new Uint8Array(rampData.length * 2); d.set(rampData); rampData = d; ramp.image = {data: d, width: 6, height: d.length / 24}; ramp.dispose(); }
    f.ramp.forEach((c, t) => rampData.set([c[0], c[1], c[2], 255], (famN * 6 + t) * 4)); famRow.set(key, row = famN++);
    return row;
  }
  // a dynamic mesh drawn with model M's first body (see the API above): its buffers, rewritten by the caller
  function attach(M, corners, families) {
    const fam = families.map(famRowOf); ramp.needsUpdate = true;
    const pos = new Float32Array(corners * 3), nrm = new Int8Array(corners * 4), info = new Uint8Array(corners * 4);
    const geo = new THREE.InstancedBufferGeometry(), A = [new THREE.BufferAttribute(pos, 3), new THREE.BufferAttribute(nrm, 4, true), new THREE.BufferAttribute(info, 4, false)];
    for (const a of A) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', A[0]); geo.setAttribute('aNrm', A[1]); geo.setAttribute('aInfo', A[2]); geo.setAttribute('iSlot', M.iSlot);
    geo.instanceCount = 0; geo.setDrawRange(0, 0);
    const mA = new THREE.Mesh(geo, matA), mS = new THREE.Mesh(geo, matS);
    for (const m of [mA, mS]) { m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false; }
    mS.userData.rig = id; sceneA.add(mA); G.extra(mS, 'shadow');
    const D = {pos, nrm, info, fam, n: 0, geo, mA, mS,
      famRow: famRowOf,   // a family -> its row (to repaint info's family bytes; then infoChanged())
      infoChanged() { A[2].needsUpdate = true; ramp.needsUpdate = true; },
      update(n) { D.n = n; geo.setDrawRange(0, n); for (let i = 0; i < 2; i++) { const a = A[i]; a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; } }};
    M.att.push(D); M.bytes += pos.byteLength + nrm.byteLength + info.byteLength;
    return D;
  }
  // one body this frame: its segments' matrices (rows of 3x4, segs x 12 floats) and its params
  function put(M, slot, mats, P) {
    const o = slot * XW * 4, s = M.segs * 12;
    for (let i = 0; i < s; i++) if (xfData[o + i] !== mats[i]) { xfData[o + i] = mats[i]; dirty = true; }
    const q = o + PCOL * 4;
    for (let i = 0; i < 12; i++) { const f = Math.fround(P[KEYS[i]] ?? 0); if (xfData[q + i] !== f) { xfData[q + i] = f; dirty = true; } }
    M.iSlot.array[M.n++] = slot; used = true;
    // the bodies' screen box (view px) for passes B and X: each anchor +- BOX_R m (a body lying or reaching stays inside)
    G.toScreenInto(P.x ?? 0, P.y ?? 0, P.z ?? 0, SCR);
    if (SCR[0] < box[0]) box[0] = SCR[0]; if (SCR[1] < box[1]) box[1] = SCR[1]; if (SCR[0] > box[2]) box[2] = SCR[0]; if (SCR[1] > box[3]) box[3] = SCR[1];
  }
  // the same with the params as numbers in KEYS order (a Float64Array of 12: x, z, k, alpha, flash, pitch, y, type, sx, sy,
  // sz, snap): no property reads by name (a keyed read of a double field boxes it: ~120 bytes a body a frame through put)
  function putv(M, slot, mats, pv) {
    const o = slot * XW * 4, s = M.segs * 12;
    for (let i = 0; i < s; i++) if (xfData[o + i] !== mats[i]) { xfData[o + i] = mats[i]; dirty = true; }
    const q = o + PCOL * 4;
    for (let i = 0; i < 12; i++) { const f = Math.fround(pv[i]); if (xfData[q + i] !== f) { xfData[q + i] = f; dirty = true; } }
    M.iSlot.array[M.n++] = slot; used = true;
    G.toScreenInto(pv[0], pv[6], pv[1], SCR);
    if (SCR[0] < box[0]) box[0] = SCR[0]; if (SCR[1] < box[1]) box[1] = SCR[1]; if (SCR[0] > box[2]) box[2] = SCR[0]; if (SCR[1] > box[3]) box[3] = SCR[1];
  }
  const BOX_R = 2.4, SCR = [0, 0, 0], box = [1e9, 1e9, -1e9, -1e9];
  const KEYS = ['x', 'z', 'k', 'alpha', 'flash', 'pitch', 'y', 'type', 'sx', 'sy', 'sz', 'snap'];
  const S20 = Math.sin(20 * Math.PI / 180), C20 = Math.cos(20 * Math.PI / 180);
  // WARM (at load, so the first body costs nothing extra: three programs, the target, the textures and the buffers were a
  // 196 ms frame and then a 78 ms one at the first death): the data textures uploaded, the target allocated, the three
  // programs compiled off the main thread where the GPU allows (KHR_parallel_shader_compile: compileAsync), then the
  // next render() draws every pass once with no body (programs bound, buffers uploaded; pass B discards everywhere)
  async function warm() {
    const r = G.renderer;
    r.initTexture(xf); r.initTexture(ramp);
    const prev = r.getRenderTarget(); r.setRenderTarget(rt); r.clear(true, true, false); r.setRenderTarget(prev);
    const ws = new THREE.Scene(), cam = G.camera;   // (throwaway meshes sharing the passes' materials: B and S live in the renderer's scenes)
    ws.add(new THREE.Mesh(tri, meshB.material)); if (models[0]) ws.add(new THREE.Mesh(models[0].geo, matS));
    await Promise.all([r.compileAsync(sceneA, cam), r.compileAsync(ws, cam, G.gScene)]);
    ws.clear(); warmN = 1;
  }
  function render() {
    const fr = G.frame;
    for (const M of models) {
      M.geo.instanceCount = M.n; M.mA.visible = M.n > 0; if (M.n) { M.iSlot.needsUpdate = true; M.mS.userData.frame = fr; }
      for (const D of M.att) { const on = M.n > 0 && D.n > 0; D.geo.instanceCount = on ? 1 : 0; D.mA.visible = on; if (on) D.mS.userData.frame = fr; }   // (the first body)
    }
    if (!used && warmN > 0) {   // the warm frame: every pass once, no instances
      warmN--;
      for (const M of models) { M.mA.visible = true; M.mS.userData.frame = fr; }
      used = true;
    }
    if (!used) return;
    if (G.VW !== VW || G.VH !== VH) { VW = G.VW; VH = G.VH; rt.setSize(VW, VH); U.uRes.value.set(VW, VH); U.uSnap.value.set(VW, VH); }
    if (dirty) { xf.needsUpdate = true; dirty = false; }
    // the camera's axes at this yaw: the pixelizer's light (image space (-.55, -.62, .56): x right, y down, z toward the
    // viewer, in the atlas camera's 20 deg basis), the default normal of the outline pixels (BATCH_FS's), the squash axis
    const yaw = G.view.yaw, sy = Math.sin(yaw), cy = Math.cos(yaw);
    const R = [cy, 0, -sy], F20 = [sy * C20, S20, cy * C20], U20 = [-sy * S20, C20, -cy * S20];
    const L = U.uLight.value.set(-.55 * R[0] + .62 * U20[0] + .56 * F20[0], -.55 * R[1] + .62 * U20[1] + .56 * F20[1], -.55 * R[2] + .62 * U20[2] + .56 * F20[2]); L.normalize();
    U.uDefN.value.set(F20[0], F20[1] + .25, F20[2]).normalize(); U.uYaw.value = yaw; U.uFwd.value.set(-sy, -cy);
    const r = G.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(true, true, false);
    r.render(sceneA, G.camera);
    r.setRenderTarget(prev);
    meshB.userData.frame = fr; if (meshX && !api.noXray) { U.uGDep.value = G.compU.tD.value; meshX.userData.frame = fr; }   // (noXray: its owner asks for none this frame: the live hero carrying a crate in front of him, docs/exp/brawl.md)
    const rp = BOX_R * G.camera.projectionMatrix.elements[0] * VW / 2 + 2;   // (px a metre at this zoom: the projection's x scale)
    if (G.cine) U.uBox.value.set(-1, -1, 1, 1); else U.uBox.value.set(Math.max(-1, (box[0] - rp) / VW * 2 - 1), Math.max(-1, 1 - (box[3] + rp) / VH * 2), Math.min(1, (box[2] + rp) / VW * 2 - 1), Math.min(1, 1 - (box[1] - rp) / VH * 2));
    box[0] = box[1] = 1e9; box[2] = box[3] = -1e9;
    for (const M of models) M.n = 0;
    used = false;
  }
  const api = {addModel, restyle, attach, put, putv, render, warm, noXray: false, id, owns: o => o.userData.rig === id, get bytes() { let b = xfData.byteLength + rampData.byteLength + VW * VH * (8 * 2 + 4); for (const M of models) b += M.bytes; return b; }};
  return api;
}
