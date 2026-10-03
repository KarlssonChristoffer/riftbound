// PUFFS (render side): lumpy pixel puffs of smoke or dust, lit like the rest of the world (features/gunfx/smoke.js).
// One instanced quad a puff in the G-buffer (G.extra 'gbuf'); the fragment shader draws the puff on the pixel lattice from
// its numbers alone (no atlas, any size): a cauliflower of five lobes (spheres; four shapes, each mirrored or not), their
// normals (the lights and the sun or moon shade it: type 7, like a sprite with a normal map), four painted tones of its
// tint (the darker ones cooler; the crease where two lobes meet a tone darker), and its breaking up: a clumpy noise over
// the shape, scaled with it, the rim and the underside lowest, so pixels go as `erode` rises 0 -> 1. Alpha is an ordered
// dither (pixel art), denser in the middle than at the rim. Drawn as a particle (obj -1): the x-ray doesn't outline the
// player through it.
//
// API: createPuffs(G, max) -> {
//   put(x, y, h, r, tint, erode, alpha, shape, lift, edge)  one puff this frame: its middle (arena x, y, h), radius (art
//                                                     px), tint [r, g, b] 0..1 (read at once), erode 0..1, alpha 0..1 (dither),
//                                                     shape 0..7 (four shapes, +4 mirrored), lift (a faint glow of its own),
//                                                     edge (x alpha at its rim: thin edges, a dense middle)
//   frame()                                           after the frame's puts: upload them, arm the pass (none: not drawn)
//   count                                             puts this frame (until frame()) }
// OWNS: its mesh and instance buffers. READS: G.U.camYaw, G.view.zoom, G.VW / VH, G.QUAD, G.shaders.HEAD, G.frame.
// BUDGET: CPU ~.1 µs a put + one upload of the puts; GPU one instanced draw over them.
import * as THREE from 'three';
import {hash3} from '../core/mathx.js';

const TAU = Math.PI * 2;
// the four shapes' lobes [x, y (up), radius] as fractions of the puff's radius: a body low, a crown, a cheek either side
// and one more somewhere (the hash picks); each inside the puff's circle
const LOBES = [];
for (let v = 0; v < 4; v++) {
  const H = k => hash3(v, k, 77), a = H(2) * TAU;
  const L = [[0, -.18, .7], [(H(1) - .5) * .5, .32, .58], [-.46, -.02, .5], [.46, .04, .48], [Math.cos(a) * .5, Math.sin(a) * .45, .38]];
  for (const l of L) { const d = Math.hypot(l[0], l[1]); if (d + l[2] > 1) l[2] = 1 - d; LOBES.push(new THREE.Vector3(l[0], l[1], l[2])); }
}

export function createPuffs(G, max = 256) {
  const HEAD = G.shaders.HEAD;
  const VS = HEAD + `
in vec3 position; in vec4 iP; in vec4 iT; in vec4 iM;   // iP: world X, Y (up), Z, radius px; iT: tint, erode; iM: alpha, shape, lift, edge
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uSnap; uniform float uZoom;
out vec2 vL; flat out vec4 vT; flat out vec4 vM; flat out float vR;
void main() {
  float r = max(1., floor(iP.w + .5)), W = 2. * r + 3.;   // (odd: the middle on a pixel)
  vR = r; vT = iT; vM = iM;
  vec4 p = projectionMatrix * viewMatrix * vec4(iP.xyz, 1.);
  vec2 s = (p.xy * .5 + .5) * uSnap, c = mod(W * uZoom, 2.) > .5 ? floor(s) + .5 : floor(s + .5);
  vL = (position.xy - .5) * W;   // art px from the middle, y up
  gl_Position = vec4((c + vL * uZoom) / uSnap * 2. - 1., p.z - .00125, 1.);
}`;
  const FS = HEAD + `layout(location = 0) out vec4 o0;\nlayout(location = 1) out vec4 o1;\nlayout(location = 2) out vec4 o2;
in vec2 vL; flat in vec4 vT; flat in vec4 vM; flat in float vR;
uniform vec3 uLobe[20]; uniform float uCamYaw;
float bayer(ivec2 p) { int i = (p.x & 3) + (p.y & 3) * 4;
  const float B[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.); return (B[i] + .5) / 16.; }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h2(i), h2(i + vec2(1., 0.)), f.x), mix(h2(i + vec2(0., 1.)), h2(i + vec2(1., 1.)), f.x), f.y); }
void main() {
  float r = vR; vec2 d = floor(vL + .5);   // this pixel, art px from the middle (y up)
  int sh = int(vM.y + .5); float m = sh >= 4 ? -1. : 1.; sh = sh & 3;
  vec2 q = vec2(d.x * m, d.y);   // (in the shape's own frame: mirrored)
  float best = -1., second = -1.; vec3 bl = vec3(0., 0., 1.);
  if (r <= 2.) { float R = r + .35, d2 = dot(q, q); if (d2 < R * R) { best = sqrt(R * R - d2); bl = vec3(0., 0., R); } }
  else for (int k = 0; k < 5; k++) {
    vec3 l = uLobe[sh * 5 + k]; vec2 c = l.xy * r; float R = l.z * r + .5;
    vec2 e = q - c; float d2 = dot(e, e); if (d2 >= R * R) continue;
    float z = sqrt(R * R - d2);
    if (z > best) { second = best; best = z; bl = vec3(c, R); } else if (z > second) second = z;
  }
  if (best < 0.) discard;
  // breaking up: the rim and the underside go first, in clumps that scale with the puff
  float e = .55 * vn(q / r * 2.6 + vM.y * 5.3 + 10.) + .45 * (1. - length(q) / (r + .5)) + .1 * q.y / r;
  if (vT.w > 0. && e <= vT.w * .9) discard;
  // see-through: thick in the middle, thin at the rim (edge: the rim's share of alpha), as an ordered dither laid on the
  // puff's own pixels (it moves with the puff: no crawling pattern)
  float a = vM.x * mix(vM.w, 1., smoothstep(.1, .75, best / bl.z));
  if (a < .999 && a <= bayer(ivec2(d + 64.) + ivec2(sh, sh * 3))) discard;
  vec3 n = vec3((q.x - bl.x) / bl.z * m, (q.y - bl.y) / bl.z, best / bl.z);   // (back out of the mirror: lit as it stands)
  int t;
  if (r <= 2.) t = d.y > 0. || (d.y == 0. && d.x < 0.) ? 0 : d.y == 0. ? 1 : 2;
  else {
    float l = dot(n, normalize(vec3(-.42, .78, .46)));   // the painted light: up, a little left, toward the camera
    t = l > .72 ? 0 : l > .42 ? 1 : l > .08 ? 2 : 3;
    if (second >= 0. && best - second < .9) t = min(3, t + 1);   // the crease where two lobes meet
  }
  vec3 c = t == 0 ? vT.rgb * vec3(1.02, 1.015, 1.) + vec3(.02, .015, 0.) : t == 1 ? vT.rgb * vec3(.9, .9, .91) : t == 2 ? vT.rgb * vec3(.76, .78, .84) : vT.rgb * vec3(.6, .63, .72);
  vec3 F = vec3(sin(uCamYaw), 0., cos(uCamYaw)), Rt = vec3(cos(uCamYaw), 0., -sin(uCamYaw));
  const float S20 = .34202, C20 = .93969;
  vec3 U20 = vec3(0., C20, 0.) - F * S20, F20 = vec3(0., S20, 0.) + F * C20;
  o0 = vec4(clamp(c, 0., 1.), float(7 * 4) / 255.);   // type 7: lit by its normals (the lights, the sun's form)
  o1 = vec4(normalize(n.x * Rt + n.y * U20 + n.z * F20), -1.);   // obj -1: a particle
  o2 = vec4(vec3(vM.z), 0.);
}`;
  const P = new Float32Array(max * 4), T = new Float32Array(max * 4), M = new Float32Array(max * 4);
  const attr = a => { const x = new THREE.InstancedBufferAttribute(a, 4); x.setUsage(THREE.DynamicDrawUsage); return x; };
  const iP = attr(P), iT = attr(T), iM = attr(M);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', G.QUAD.getAttribute('position'));   // (never dispose: it shares the quad's GL buffer)
  geo.setAttribute('iP', iP); geo.setAttribute('iT', iT); geo.setAttribute('iM', iM); geo.instanceCount = 0;
  const uSnap = {value: new THREE.Vector2(G.VW, G.VH)}, uZoom = {value: 1};
  const mesh = new THREE.Mesh(geo, new THREE.RawShaderMaterial({vertexShader: VS, fragmentShader: FS, glslVersion: THREE.GLSL3,
    uniforms: {uSnap, uZoom, uLobe: {value: LOBES}, uCamYaw: G.U.camYaw}, side: THREE.DoubleSide}));
  mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  G.extra(mesh, 'gbuf');
  // (one {start, count} kept on each buffer: three's addUpdateRange makes a new one every call)
  function popRanges() { const u = this.updateRanges; while (u.length) u.pop(); }
  const range = (a, n) => {
    let r = a.__range; if (!r) { r = a.__range = {start: 0, count: 0}; a.clearUpdateRanges = popRanges; }
    r.start = 0; r.count = n * 4; a.clearUpdateRanges(); a.updateRanges.push(r); a.needsUpdate = true;
  };
  let n = 0;
  return {
    get count() { return n; },
    put(x, y, h, r, tint, erode, alpha, shape, lift, edge) {
      if (n >= max) return;
      const i = n++ * 4;
      P[i] = x; P[i + 1] = h; P[i + 2] = y; P[i + 3] = r;   // (arena -> world: X, Y up, Z)
      T[i] = tint[0]; T[i + 1] = tint[1]; T[i + 2] = tint[2]; T[i + 3] = erode;
      M[i] = alpha; M[i + 1] = shape; M[i + 2] = lift; M[i + 3] = edge;
    },
    frame() {
      if (n) { range(iP, n); range(iT, n); range(iM, n); }
      geo.instanceCount = n; uSnap.value.set(G.VW, G.VH); uZoom.value = G.view.zoom;
      mesh.userData.frame = n ? G.frame : -1;   // shown on this frame's render only (and only with puffs)
      n = 0;
    },
  };
}
