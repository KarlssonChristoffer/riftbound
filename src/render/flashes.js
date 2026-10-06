// FLASHES (render side): muzzle flashes as pixel art in the world (features/gunfx.js). One instanced quad a flash in the
// G-buffer (G.extra 'gbuf'), drawn by the fragment shader from its numbers alone, on the pixel lattice at any angle: a hot
// core at the muzzle, a flame tongue along the shot with a tip beyond it, and a petal out either side, in four tones
// (white -> pale gold -> orange -> a dithered red rim) that cool and shrink as it ages. Emissive (it lights itself) and
// depth-tested at the muzzle's real place (the sim's: the aim's depth), so whatever stands in front of the gun, the
// shooter's own hat when he fires away from the camera, hides it. Drawn as a particle (obj -1): no x-ray outline.
//
// API: createFlashes(G, max) -> {
//   put(x, y, h, len, ang, k, variant, width)  one flash this frame: the muzzle (arena x, y, h), its length (art px), its
//                                              angle on screen (rad, y down: the shot's way), k 1 fresh .. 0 gone, variant
//                                              (0..2: the lobes' jitter), width (x its thickness)
//   frame()                                    after the frame's puts: upload them, arm the pass (none: not drawn)
//   count }
// OWNS: its mesh and instance buffers. READS: G.view.zoom, G.VW / VH, G.QUAD, G.shaders.HEAD, G.frame.
// BUDGET: CPU ~.1 µs a put + one small upload; GPU one instanced draw (a few flashes at most).
import * as THREE from 'three';

export function createFlashes(G, max = 16) {
  const HEAD = G.shaders.HEAD;
  const VS = HEAD + `
in vec3 position; in vec4 iP; in vec4 iA;   // iP: world X, Y (up), Z, length px; iA: angle, k, variant, width
uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uSnap; uniform float uZoom;
out vec2 vL; flat out vec4 vA; flat out float vLen;
void main() {
  float L = max(3., iP.w), W = 2. * ceil(L) + 5.;   // (odd: the muzzle on a pixel's middle)
  vLen = L; vA = iA;
  vec4 p = projectionMatrix * viewMatrix * vec4(iP.xyz, 1.);
#ifdef CINE
  float pw = p.w; p.xyz /= pw;   // (a cinema camera's perspective: gfx.js setCine)
#endif
  vec2 s = (p.xy * .5 + .5) * uSnap, c = mod(W * uZoom, 2.) > .5 ? floor(s) + .5 : floor(s + .5);
  vL = (position.xy - .5) * W;   // art px from the muzzle, y up
#ifdef CINE
  gl_Position = vec4((c + vL * uZoom) / uSnap * 2. - 1., p.z - .15 * -projectionMatrix[3][2] / (pw * pw), pw > 0. ? 1. : -1.);   // (15 cm toward the camera; w -1: behind it, clipped)
#else
  gl_Position = vec4((c + vL * uZoom) / uSnap * 2. - 1., p.z - .00125, 1.);
#endif
}`;
  const FS = HEAD + `layout(location = 0) out vec4 o0;\nlayout(location = 1) out vec4 o1;\nlayout(location = 2) out vec4 o2;
in vec2 vL; flat in vec4 vA; flat in float vLen;
float h1(float n) { return fract(sin(n * 91.345 + 3.1) * 47453.1); }
float ell(vec2 q, vec2 c, vec2 r) { vec2 e = (q - c) / r; return 1. - dot(e, e); }   // 1 at its middle, 0 at its edge
void main() {
  vec2 d = floor(vL + .5);   // this pixel, art px from the muzzle (y up)
  float L = vLen, k = vA.y, v = vA.z, w = vA.w;
  vec2 u = vec2(cos(vA.x), -sin(vA.x)), n = vec2(-u.y, u.x);
  vec2 q = vec2(dot(d, u), dot(d, n));   // px along the shot, across it
  float j1 = h1(v) - .5, j2 = h1(v + 7.) - .5, j3 = h1(v + 13.) - .5;
  float heat = ell(q, vec2(.04 * L, 0.), vec2(.13 * L + 1.3, .1 * L * w + 1.1)) * 1.25;                      // the core
  heat = max(heat, ell(q, vec2(.4 * L, j1 * .07 * L), vec2(.38 * L, .085 * L * w + .7)) * 1.);              // the tongue
  heat = max(heat, ell(q, vec2((.8 + j2 * .08) * L, j2 * .12 * L), vec2(.2 * L, .05 * L * w + .55)) * .72); // its tip
  float pa = .1 * L, pr = (.2 + j3 * .06) * L;                                                              // the petals
  heat = max(heat, ell(q, vec2(pa, pr), vec2(.05 * L + .6, .12 * L)) * .78);
  heat = max(heat, ell(q, vec2(pa, -pr * (.85 + .3 * h1(v + 21.))), vec2(.05 * L + .6, .11 * L)) * .74);
  heat *= .5 + .5 * k;   // it cools as it goes
  if (heat < .1) discard;
  vec3 c;
  if (heat > .78) c = vec3(1., .985, .91);
  else if (heat > .5) c = vec3(1., .87, .52);
  else if (heat > .27) c = vec3(1., .6, .23);
  else { if (((int(d.x) + int(d.y)) & 1) == 0) discard; c = vec3(.83, .33, .15); }   // the rim, half its pixels
  o0 = vec4(c, float(3 * 4) / 255.); o1 = vec4(0., 1., 0., -1.); o2 = vec4(c, 0.);   // emissive; obj -1: a particle
}`;
  const P = new Float32Array(max * 4), A = new Float32Array(max * 4);
  const attr = a => { const x = new THREE.InstancedBufferAttribute(a, 4); x.setUsage(THREE.DynamicDrawUsage); return x; };
  const iP = attr(P), iA = attr(A);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', G.QUAD.getAttribute('position'));   // (never dispose: it shares the quad's GL buffer)
  geo.setAttribute('iP', iP); geo.setAttribute('iA', iA); geo.instanceCount = 0;
  const uSnap = {value: new THREE.Vector2(G.VW, G.VH)}, uZoom = {value: 1};
  const mesh = new THREE.Mesh(geo, G.cineMat(new THREE.RawShaderMaterial({vertexShader: VS, fragmentShader: FS, glslVersion: THREE.GLSL3,
    uniforms: {uSnap, uZoom}, side: THREE.DoubleSide})));
  mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  G.extra(mesh, 'gbuf');
  function popRanges() { const u = this.updateRanges; while (u.length) u.pop(); }
  const range = (a, n) => {
    let r = a.__range; if (!r) { r = a.__range = {start: 0, count: 0}; a.clearUpdateRanges = popRanges; }
    r.start = 0; r.count = n * 4; a.clearUpdateRanges(); a.updateRanges.push(r); a.needsUpdate = true;
  };
  let n = 0, warm = false;
  return {
    get count() { return n; },
    put(x, y, h, len, ang, k, variant, width) {
      if (n >= max) return;
      const i = n++ * 4;
      P[i] = x; P[i + 1] = h; P[i + 2] = y; P[i + 3] = len;   // (arena -> world: X, Y up, Z)
      A[i] = ang; A[i + 1] = k; A[i + 2] = variant; A[i + 3] = width;
    },
    frame() {
      if (n) { range(iP, n); range(iA, n); }
      geo.instanceCount = n; uSnap.value.set(G.VW, G.VH); uZoom.value = G.view.zoom;
      // shown on this frame's render only, and only with flashes; and once with none on the first frame, so its shader
      // compiles at boot, not on the first shot (render/puffs.js)
      mesh.userData.frame = n || !warm ? G.frame : -1; warm = true;
      n = 0;
    },
  };
}
