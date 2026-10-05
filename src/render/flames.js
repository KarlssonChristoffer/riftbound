// FLAMES (render side): the fire's particles (features/firesim.js) live on the GPU. The CPU only BIRTHS them: each new
// particle's random draws (where on the bed, how fast, how long, which way it swirls, ...) are written ONCE into a slot.
// Every frame the shaders work out where each one is from its age alone (its rise, swirl, the flame's dance and the wind's
// lean are closed forms of time), how hot it is (from where it is in the flame) and so its tone, size and dither, exactly as
// firesim's CPU draw did per particle per frame (~1000 particles: ~10% of the frame's JS by day).
//   pixels  the pixel flame: depth-tested particles in the G-buffer through gfx.js POINT_FS (emissive, obj -1), each drawn as a
//           size x size square on the pixel lattice (what a point sprite covers; instanced point sprites are a slow path in
//           ANGLE's D3D11 backend: ~.7 ms of GPU for 32k slots)
//   glow    the HD glow (styles hybrid / soft): soft additive blobs at display resolution, gfx.js FX_FS (depth-faded)
// Both are ONE instanced draw over the slots in use. A dead particle's slot goes back to the pool (firesim knows when each one
// dies) and a birth takes the lowest free slot, so the live ones stay packed at the bottom and the draws cover ~the live count,
// not the pool (a vertex shader over 32k mostly empty slots cost ~.6 ms of GPU per pass).
// Per fire, a row of a small float texture holds what the shaders need this frame (where it stands, its height, the dance's
// phases, the wind's push, how lit it is, its six tones). A fire not drawn this frame (off screen, unlit, the lights off)
// shows nothing; a fire that goes away bumps its row's generation, so a new fire in that row never shows the old one's sparks.
//
// API: createFlames(G) -> {
//   fire() -> row | -1          a row for a new fire (-1: all MAXF in use: that fire shows no particles)
//   free(row)                   the fire is gone (its particles vanish at once; release their slots too)
//   setFire(row, f)             this frame's look of a drawn fire: {x, y, h (arena, base of the flame), KH (flame height m),
//                               s1, s2, s3 (dance seeds), dance (m at the top x height scale), wx, wy (wind lean), on (0..1),
//                               buoy (m/s2 x height scale), big, mid (px sizes), rad (soft blob radius m), ramp (6 x [r, g, b])}
//   birth(row, b) -> slot | -1   one particle born: b = {T (firesim time, s), life, z0, vz, r0, rf, th0, sw, wob, n}, read at once
//                                (an object, not 10 numbers: a call that isn't inlined boxes every number it passes)
//   release(slot)               that particle died
//   frame(T, style)             after the frame's draws: arm the passes, upload what changed. style: 'pixel' | 'hybrid' | 'soft'
//   count                       slots in use }
// OWNS: the slots, the fire rows, its two meshes (G.extra: shown only on frames frame() armed). READS: G.VW / VH, G.fxU, G.QUAD.
// BUDGET: CPU ~.01 ms a frame + a few µs per birth / death; GPU: two instanced draws over the slots in use (~the live particles).
import * as THREE from 'three';

export const SLOTS = 32768, MAXF = 128;
const ROW = 16;   // texels per fire row: 0 (X, Y, Z, KH) 1 (s1, s2, s3, dance) 2 (wx, wy, on, buoy) 3 (big, mid, gen, shown) 4 (rad) 5..10 ramp
const TAU = Math.PI * 2;

// a particle's state now, from its birth (iA = birth (s, mod 2048), life (< 0: free), z0, vz; iB = r0, rf, th0, swirl; iC = wob, n,
// row, gen): false when it isn't drawn (dead, free, its fire not shown, an old fire's). The maths is firesim's draw, term for term
const FLAME = `
uniform highp sampler2D uFire; uniform float uTm; uniform vec4 uPh; uniform float uPh13;   // uTm: the clock mod 2048; uPh: the dance's phases (T x 2.9, 6.1, 2.4, 5.3, mod 2 pi); uPh13: T x 13
in vec4 iA; in vec4 iB; in vec4 iC;
vec4 fd(int f, int k) { return texelFetch(uFire, ivec2(k, f), 0); }
bool flame(out vec3 w, out float Tm, out float zf, out int t, out int fi) {
  w = vec3(0.); Tm = 0.; zf = 0.; t = 5; fi = 0;
  float life = iA.y, age = mod(uTm - iA.x, 2048.);
  if (age >= life) return false;   // (a free slot has life -1)
  fi = int(iC.z + .5);
  vec4 f3 = fd(fi, 3);
  if (f3.w < .5 || abs(f3.z - iC.w) > .5) return false;
  vec4 f0 = fd(fi, 0), f1 = fd(fi, 1), f2 = fd(fi, 2);
  float KH = f0.w, z = iA.z + iA.w * age + .5 * f2.w * age * age, u = age / life;
  zf = z / KH;
  float fade = u < .72 ? 1. : 1. - (u - .72) / .28, rf = iB.y;
  Tm = clamp(1.1 - .9 * pow(max(zf, 0.), 1.15) - .5 * rf * rf + iC.y, 0., 1.05) * fade * (.7 + .3 * f2.z);
  if (Tm < .1) return false;
  float conv = max(0., 1. - z / KH), r = iB.x * pow(conv, .7) + sin(uPh13 + iC.x) * .012;
  float a = f1.w * zf * zf;   // the column's dance: more sway higher up, plus the wind's push
  float ax = a * (sin(uPh.x + f1.x + z * 5.5) * .65 + sin(uPh.y + f1.y + z * 11.) * .35) + f2.x * z * .55;
  float ay = a * (sin(uPh.z + f1.z + z * 6.3) * .65 + sin(uPh.w + f1.x + z * 9.) * .35) + f2.y * z * .55;
  float th = iB.z + iB.w * age;
  w = vec3(f0.x + ax + cos(th) * r, f0.y + z, f0.z + ay + sin(th) * r);   // arena (x, y, h) -> world (X, Y up, Z)
  t = Tm > .86 ? 0 : Tm > .7 ? 1 : Tm > .55 ? 2 : Tm > .4 ? 3 : Tm > .26 ? 4 : 5;
  return true;
}
`;
const OFF = `gl_Position = vec4(2., 2., 2., 1.);`;

export function createFlames(G) {
  const {HEAD, POINT_FS, FX_FS} = G.shaders;
  // the slots: three vec4 each, shared by both meshes (one GL buffer each)
  const A = new Float32Array(SLOTS * 4), B = new Float32Array(SLOTS * 4), C = new Float32Array(SLOTS * 4);
  const attr = a => { const x = new THREE.InstancedBufferAttribute(a, 4); x.setUsage(THREE.DynamicDrawUsage); return x; };
  const iA = attr(A), iB = attr(B), iC = attr(C);
  for (let i = 0; i < SLOTS; i++) A[i * 4 + 1] = -1;   // free: life < 0 (age >= life: not drawn)
  // the free slots below the high-water mark `top`, as a min-heap (a birth takes the lowest: the live ones stay packed)
  const heap = new Int32Array(SLOTS); let nHeap = 0, top = 0, inUse = 0;
  const push = s => { let i = nHeap++; while (i > 0) { const p = (i - 1) >> 1; if (heap[p] <= s) break; heap[i] = heap[p]; i = p; } heap[i] = s; };
  const pop = () => { const s = heap[0], x = heap[--nHeap]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= nHeap) break; if (c + 1 < nHeap && heap[c + 1] < heap[c]) c++; if (heap[c] >= x) break; heap[i] = heap[c]; i = c; } heap[i] = x; return s; };
  // the fire rows
  const D = new Float32Array(ROW * MAXF * 4), tex = new THREE.DataTexture(D, ROW, MAXF, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  const gen = new Float32Array(MAXF), used = new Uint8Array(MAXF), shown = new Uint8Array(MAXF);
  const U = {uFire: {value: tex}, uTm: {value: 0}, uPh: {value: new THREE.Vector4()}, uPh13: {value: 0}, uStyle: {value: 1}};
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', G.QUAD.getAttribute('position'));   // (never dispose: it shares the quad's GL buffer)
  geo.setAttribute('iA', iA); geo.setAttribute('iB', iB); geo.setAttribute('iC', iC); geo.instanceCount = 0;
  // the pixel flame: a size x size square on the pixel lattice per particle (gfx.js POINT_VS's snap: odd sizes centre on a
  // pixel, even ones on a corner, so the square's edges lie on pixel edges and it covers what the point sprite did)
  const PIXELS_VS = HEAD + FLAME + `
in vec3 position; uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uSnap; uniform float uStyle, uZoom;
out vec4 vCol; flat out float vAlpha;
void main() {
  vec3 w; float Tm, zf; int t, fi;
  vCol = vec4(0.); vAlpha = 0.;
  if (uStyle > 1.5 || !flame(w, Tm, zf, t, fi)) { ${OFF} return; }
  bool outer = iB.y > .72; vec4 f3 = fd(fi, 3);   // the hot core: fat solid pixels; the outer sheets thin and dithered
  float size = outer ? (t <= 2 ? f3.y : 1.) : (t <= 1 ? f3.x : t <= 3 ? f3.y : 1.);
  vAlpha = outer ? .62 : Tm < .22 ? .55 : 1.;
  vCol = vec4(fd(fi, 5 + t).rgb, 1.);   // emissive (POINT_FS: a = 1)
  vec4 p = projectionMatrix * viewMatrix * vec4(w, 1.);
#ifdef CINE
  float pw = p.w; p.xyz /= pw;   // (a cinema camera's perspective: gfx.js setCine)
#endif
  vec2 s = (p.xy * .5 + .5) * uSnap;
#ifdef CINE
  vec2 c = mod(size * uZoom, 2.) > .5 ? floor(s) + .5 : floor(s + .5);
#else
  vec2 c = mod(size, 2.) > .5 ? floor(s) + .5 : floor(s + .5);
#endif
#ifdef CINE
  gl_Position = vec4((c + (position.xy - .5) * size * uZoom) / uSnap * 2. - 1., p.z - .15 * -projectionMatrix[3][2] / (pw * pw), pw > 0. ? 1. : -1.);   // (15 cm toward the camera; w -1: behind it, clipped; uZoom: the cinema's k)
#else
  gl_Position = vec4((c + (position.xy - .5) * size) / uSnap * 2. - 1., p.z - .00125, 1.);
#endif
}`;
  const uSnap = {value: new THREE.Vector2(G.VW, G.VH)}, uZoom = {value: 1};   // (uZoom: a cinema camera's k, G.view.zoom: its variant only)
  const pixels = new THREE.Mesh(geo, G.cineMat(new THREE.RawShaderMaterial({vertexShader: PIXELS_VS, fragmentShader: POINT_FS, glslVersion: THREE.GLSL3,
    uniforms: {...U, uSnap, uZoom}, side: THREE.DoubleSide})));
  pixels.frustumCulled = false; pixels.matrixAutoUpdate = false;
  // the HD glow: a soft quad per particle that has one this frame (gfx.js FX_VS / FX_FS: display resolution, additive)
  const GLOW_VS = HEAD + FLAME + `
in vec3 position; uniform mat4 viewMatrix, projectionMatrix; uniform vec2 uPxM; uniform float uStyle;
out vec2 vUv; out vec4 vCol;
void main() {
  vec3 w; float Tm, zf; int t, fi;
  vUv = position.xy * 2. - 1.; vCol = vec4(0.);
  if (uStyle < .5 || !flame(w, Tm, zf, t, fi)) { ${OFF} return; }
  bool outer = iB.y > .72; float rad = fd(fi, 4).x, R, al; vec3 col;
  if (uStyle > 1.5) {   // soft: overlapping additive blobs, the colour blended between the ramp's tones
    float k = clamp(1. + (1.05 - Tm) * 4.4, 1., 4.999); int i0 = int(k); float fr = k - float(i0);
    vec3 c0 = fd(fi, 5 + i0).rgb, c1 = fd(fi, 6 + i0).rgb; col = c0 + (c1 - c0) * fr;
    R = rad * (outer ? .6 : .82) * (.65 + .5 * Tm); al = (outer ? .13 : .19) * (.3 + .7 * Tm);
  } else {   // hybrid: a glow on the hottest third, the tips melting into the dark
    if (!outer && Tm > .55 && int(iC.x * 7.) % 3 == 0) { R = rad * 1.3; col = fd(fi, 7).rgb; al = .1 * Tm; }
    else if (zf > .62 && int(iC.x * 5.) % 2 == 0) { R = rad * .9; col = fd(fi, 9).rgb; al = .07 * Tm + .02; }
    else { ${OFF} return; }
  }
  vCol = vec4(col, al);
  vec4 c = projectionMatrix * viewMatrix * vec4(w, 1.);
#ifdef CINE
  gl_Position = vec4(c.xy + vUv * R * uPxM, c.z, c.w);   // (a cinema camera, gfx.js setCine: uPxM is its projection's scale, divided by the distance)
#else
  gl_Position = vec4(c.xy + vUv * R * uPxM * c.w, c.z, c.w);
#endif
}`;
  const F = G.fxU, glow = new THREE.Mesh(geo, G.cineMat(new THREE.RawShaderMaterial({vertexShader: GLOW_VS, fragmentShader: FX_FS, glslVersion: THREE.GLSL3,
    uniforms: {...U, tD: F.tD, uDS: F.uDS, uR: F.uR, uSoft: F.uSoft, uSharp: F.uSharp, uPxM: F.uPxM, uSub: F.uSub, uCine: F.uCine},   // (uSub: the sub-pixel camera's slide)
    depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending})));
  glow.frustumCulled = false; glow.matrixAutoUpdate = false; glow.renderOrder = 1;   // (with the other additive fx, after smoke)
  G.extra(pixels, 'gbuf'); G.extra(glow, 'fx');

  let lo = SLOTS, hi = -1, loB = SLOTS, hiB = -1, rowsDirty = true;   // the slots written since the last frame(): A (births + deaths), B / C (births)
  const STYLE = {pixel: 0, hybrid: 1, soft: 2};
  // (one {start, count} kept on each buffer: three's addUpdateRange makes a new one every call; cleared by pop: three's
  // clearUpdateRanges, `length = 0`, frees the array's store and the next push allocates one)
  function popRanges() { const u = this.updateRanges; while (u.length) u.pop(); }
  const range = (a, l, h) => {
    let r = a.__range; if (!r) { r = a.__range = {start: 0, count: 0}; a.clearUpdateRanges = popRanges; }
    r.start = l * 4; r.count = (h - l + 1) * 4; a.clearUpdateRanges(); a.updateRanges.push(r); a.needsUpdate = true;
  };
  return {
    get count() { return inUse; }, _: {pixels, glow, get top() { return top; }},   // (debug)
    fire() {
      for (let r = 0; r < MAXF; r++) if (!used[r]) { used[r] = 1; gen[r]++; D[(r * ROW + 3) * 4 + 2] = gen[r]; return r; }
      return -1;
    },
    free(r) { if (r < 0) return; used[r] = 0; shown[r] = 0; gen[r]++; D[(r * ROW + 3) * 4 + 2] = gen[r]; D[(r * ROW + 3) * 4 + 3] = 0; rowsDirty = true; },
    setFire(r, f) {
      if (r < 0) return;
      const o = r * ROW * 4, R = f.ramp;
      D[o] = f.x; D[o + 1] = f.h; D[o + 2] = f.y; D[o + 3] = f.KH;
      D[o + 4] = f.s1; D[o + 5] = f.s2; D[o + 6] = f.s3; D[o + 7] = f.dance;
      D[o + 8] = f.wx; D[o + 9] = f.wy; D[o + 10] = f.on; D[o + 11] = f.buoy;
      D[o + 12] = f.big; D[o + 13] = f.mid;   // (14: gen, 15: shown, set by fire() / frame())
      D[o + 16] = f.rad;
      for (let k = 0; k < 6; k++) { const c = R[k], q = o + (5 + k) * 4; D[q] = c[0]; D[q + 1] = c[1]; D[q + 2] = c[2]; }
      shown[r] = 1; rowsDirty = true;
    },
    birth(r, b) {
      if (r < 0) return -1;
      const s = nHeap ? pop() : top < SLOTS ? top++ : -1; if (s < 0) return -1;   // (all in use: this one isn't drawn)
      const i = s * 4; inUse++;
      A[i] = b.T % 2048; A[i + 1] = b.life; A[i + 2] = b.z0; A[i + 3] = b.vz;
      B[i] = b.r0; B[i + 1] = b.rf; B[i + 2] = b.th0; B[i + 3] = b.sw;
      C[i] = b.wob; C[i + 1] = b.n; C[i + 2] = r; C[i + 3] = gen[r];
      if (s < lo) lo = s; if (s > hi) hi = s; if (s < loB) loB = s; if (s > hiB) hiB = s;
      return s;
    },
    release(s) {
      if (s < 0) return;
      A[s * 4 + 1] = -1; inUse--; push(s); if (s < lo) lo = s; if (s > hi) hi = s;   // (free: its clock never brings it back)
      if (!inUse) { nHeap = 0; top = 0; }   // all gone: the draws shrink to nothing (the slots above are all free)
    },
    frame(T, style) {
      for (let r = 0; r < MAXF; r++) { const q = (r * ROW + 3) * 4 + 3, v = used[r] && shown[r] ? 1 : 0; if (D[q] !== v) { D[q] = v; rowsDirty = true; } shown[r] = 0; }
      if (rowsDirty) { tex.needsUpdate = true; rowsDirty = false; }
      if (hi >= lo) { range(iA, lo, hi); lo = SLOTS; hi = -1; }
      if (hiB >= loB) { range(iB, loB, hiB); range(iC, loB, hiB); loB = SLOTS; hiB = -1; }
      geo.instanceCount = top;
      U.uTm.value = T % 2048; U.uPh13.value = (T * 13) % TAU;
      U.uPh.value.set((T * 2.9) % TAU, (T * 6.1) % TAU, (T * 2.4) % TAU, (T * 5.3) % TAU);
      U.uStyle.value = STYLE[style] ?? 1; uSnap.value.set(G.VW, G.VH); uZoom.value = G.view.zoom;
      pixels.userData.frame = glow.userData.frame = top ? G.frame : -1;   // shown on this frame's render only (and only with particles)
    },
  };
}
