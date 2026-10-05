// ANOMALY / SPECKS: everything small round the rift, on the GPU: ONE instanced draw of pixel particles (motes, debris, their
// shadows, the crystal ring's glints and spikes) and one line draw (the glowing cracks in the ground). Their motion is a
// closed form of the feature's clock (like render/flames.js), so the CPU only sets a few uniforms a frame: no particle loop,
// no per-frame allocation, nothing uploaded after the first frame.
//   motes    (kind 0) spiral in from 1.4-2.8 m, faster and tighter as they near the slit (r = r0 (1 - u)^1.6, the angle
//            winding up with u^3), settling to a height on the slit; dim violet far out, pink, then the pale rim colour;
//            at the end of each life a 2 px flash on the slit, then a new life (its numbers a hash of the life's count).
//            A streak (kind 1) follows each one inside 0.9 m: the same mote 50 ms earlier, in a darker tone
//   debris   pebbles (2 px body, 1 px lit top), flakes turning over (2 px: across, then up), dust, a glowing fleck (ember's
//            embers, the rift's chips), on tilted, bobbing rings 0.7-1.4 m out, 0.1-1 m up; a 1-2 px shadow under the
//            pebbles and flakes (kinds 2-8)
//   ring     glints flickering on the crystal ring (kind 9) and crystal spikes 3 px tall (kind 10, its top bright at the
//            pulse's peak); the cracks: 5 zigzag lines, a light running out along each with the pulse (the line draw)
// Pixel particles as gfx.js draws its own (a size x size square on the pixel lattice, POINT_FS: lit or emissive, obj -1);
// the cracks as its lines (type 6). Colours in uC: the rift's six, then the biome's debris (set on a biome change).
//   const S = createSpecks(G, THREE, {PPM, PPMH, tune}); S.palette(debris); S.set(x, g, y, t, pulse, zoom) and S.arm() a frame
//   it shows (gfx.js extra: shown only on a frame armed)
// OWNS: its two meshes (G.extra 'gbuf') and their uniforms. READS: G (VW, VH, frame, shaders, QUAD, U.camYaw).
// BUDGET: CPU ~2 µs a frame (uniforms); GPU ~120 tiny quads + 20 line segments: nothing measurable.
export const COUNTS = {motes: 26, pebbles: 6, flakes: 7, dust: 5, glow: 2, glints: 12, veins: 5, vseg: 4};
// uC: 0 hot, 1 rim, 2 pink, 3 magenta, 4 deep, 5 dim (the rift's); 6 pebble's top, 7 pebble, 8 / 9 flake, 10 dust, 11 glow, 12 shadow
export const RIFT_C = ['#ffe0fa', '#ffc6f2', '#ea7ee4', '#ad48bd', '#5c2474', '#8a4ad8'];
const SHADOW_C = '#1c1626';

const HASH = `float hs(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n`;
const SPECKS_VS = `
in vec3 position; in vec4 aK;   // aK: kind, index, extra (a shadow's size, a spike's level), -
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uA; uniform float uT, uPulse, uHover, uZ, uGlowOn, uYaw; uniform vec2 uSnap, uPx; uniform vec3 uC[13];
out vec4 vCol; flat out float vAlpha;
${HASH}
void main() {
  int k = int(aK.x + .5); float i = aK.y, T = uT, em = 0., size = 1.;
  vec3 w = uA, col = uC[0];
  bool show = true;
  if (k <= 1) {   // a mote (0) or its streak (1)
    float L = 3.2 + 2.6 * hs(vec2(i, 1.)), P = L + .12, tt = T + hs(vec2(i, 2.)) * P - (k == 1 ? .05 : 0.);
    float cyc = floor(tt / P), u = (tt - cyc * P) / L, s = mod(cyc, 997.);
    float r0 = 1.4 + 1.4 * hs(vec2(i, s + 3.)), a0 = 6.2832 * hs(vec2(i, s + 7.));
    float h0 = .12 + 2.38 * hs(vec2(i, s + 11.)), ht = uHover + .25 + 1.7 * hs(vec2(i, s + 13.));
    em = 1.;
    if (u >= 1.) { show = k == 0; w += vec3(0., ht, 0.); size = 2.; col = uC[0]; }   // the flash where it went
    else {
      float r = r0 * pow(1. - u, 1.6), a = a0 + (3.5 + 2. * hs(vec2(i, 5.))) * (u + 1.4 * u * u * u);
      w += vec3(cos(a) * r, mix(h0, ht, 1. - (1. - u) * (1. - u)), sin(a) * r);
      if (k == 0) col = r > 1.3 ? uC[5] : r > .6 ? uC[2] : uC[1];
      else { show = r < .9 && r > .07; col = r < .45 ? uC[3] : uC[4]; }
    }
  } else if (k <= 8) {   // debris: pebble (2 body, 3 lit top), flake (4, 5), dust (6), glowing fleck (7), a shadow (8)
    float rho = .72 + .7 * hs(vec2(i, 21.)), ph = 6.2832 * hs(vec2(i, 26.));
    float a = 6.2832 * hs(vec2(i, 22.)) + (.32 + .3 * hs(vec2(i, 23.))) * (1.25 - (rho - .72) / .7 * .5) * T;
    float h = .1 + .85 * hs(vec2(i, 27.)) + (.04 + .09 * hs(vec2(i, 24.))) * sin(T * (2.2 + 2.8 * hs(vec2(i, 25.))) + ph) + rho * .16 * sin(a + ph);
    vec3 base = uA + vec3(cos(a) * rho, 0., sin(a) * rho);
    bool c0 = hs(vec2(i, 28.)) < .5;
    w = base + vec3(0., h, 0.);
    if (k == 2) { size = 2.; col = uC[7]; }
    else if (k == 3) { w.y += 1.5 / uPx.y; col = uC[6]; }
    else if (k == 4) col = c0 ? uC[8] : uC[9];
    else if (k == 5) {   // the flake's other pixel: across, then up, as it turns over
      col = c0 ? uC[9] : uC[8];
      if (sin(T * (2. + 3. * hs(vec2(i, 29.))) + ph) > 0.) w += vec3(cos(uYaw), 0., -sin(uYaw)) / uPx.x; else w.y += 1. / uPx.y;
    }
    else if (k == 6) col = uC[10];
    else if (k == 7) { col = uC[11]; em = 1.; show = uGlowOn > .5; }
    else { w = base + vec3(0., .01, 0.); col = uC[12]; size = aK.z; }
  } else {   // the crystal ring: a glint (9) or a spike's pixel (10, level aK.z)
    float a = i / 12. * 6.2832 + hs(vec2(i, 31.)) * .4, r = .44 + .2 * hs(vec2(i, 32.)), on = sin(T * 1.7 + i * 2.3) + uPulse * .8;
    w += vec3(cos(a) * r, .012, sin(a) * r); em = 1.;
    if (k == 9) { show = on > .35; col = on > 1.3 ? uC[1] : uC[2]; }
    else { w.y += aK.z / uPx.y; col = aK.z < .5 ? uC[4] : aK.z < 1.5 ? uC[3] : on > 1. ? uC[1] : uC[2]; }
  }
  vCol = vec4(col, em); vAlpha = 1.;
  if (!show) { gl_Position = vec4(2., 2., 2., 1.); return; }
  size *= uZ;
  vec4 p = projectionMatrix * viewMatrix * vec4(w, 1.);   // (the oblique projection is orthographic: w = 1)
#ifdef CINE
  float pw = p.w; p.xyz /= pw;   // (the cinema camera's perspective: gfx.js setCine)
#endif
  vec2 s = (p.xy * .5 + .5) * uSnap;
  vec2 c = mod(size, 2.) > .5 ? floor(s) + .5 : floor(s + .5);   // odd sizes centre on a pixel, even on a corner (gfx.js POINT_VS)
#ifdef CINE
  gl_Position = vec4((c + (position.xy - .5) * size) / uSnap * 2. - 1., p.z - .15 * -projectionMatrix[3][2] / (pw * pw), pw > 0. ? 1. : -1.);   // (15 cm; behind it, clipped)
#else
  gl_Position = vec4((c + (position.xy - .5) * size) / uSnap * 2. - 1., p.z - .00125, 1.);
#endif
}`;
const VEIN_VS = `
in vec3 position; in vec2 aV;   // aV: the vein, the segment
uniform mat4 viewMatrix, projectionMatrix; uniform vec3 uA; uniform float uT, uBreath; uniform vec3 uC[13];
out vec4 vCol;
void main() {
  float lit = floor(fract(uT / uBreath + aV.x * .13) * ${COUNTS.vseg + 3}.);   // the segment the light runs along now
  vCol = vec4(aV.y == lit ? uC[2] : aV.y == lit - 1. ? uC[3] : uC[4], 1.);
  gl_Position = projectionMatrix * viewMatrix * vec4(uA + position, 1.);
#ifdef CINE
  gl_Position.z -= .15 * -projectionMatrix[3][2] / gl_Position.w;   // (15 cm, as the oblique .00125: gfx.js setCine)
#else
  gl_Position.z -= .00125 * gl_Position.w;
#endif
}`;
const VEIN_FS = `
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
in vec4 vCol;
void main() { o0 = vec4(vCol.rgb, float(6 * 4) / 255.); o1 = vec4(0., 1., 0., 7.); o2 = vec4(vCol.rgb * vCol.a, 0.); }`;
// a uniform that only ever holds a number, in a class of its own (gfx.js NumU: a plain {value} shares its hidden class with
// every three.js uniform, so a number written to one is boxed: a new heap number every write)
export class NumU { constructor(v) { this.value = v; } }

const hex3 = (THREE, h) => { const n = parseInt(h.slice(1), 16); return new THREE.Vector3((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };

export function createSpecks(G, THREE, {PPM, PPMH, hover, breath, ring}) {
  const N = COUNTS, K = [];
  const add = (kind, i, extra = 0) => K.push(kind, i, extra, 0);
  for (let i = 0; i < N.motes; i++) { add(0, i); add(1, i); }
  let d = 0;
  for (let j = 0; j < N.pebbles; j++, d++) { add(2, d); add(3, d); add(8, d, 2); }
  for (let j = 0; j < N.flakes; j++, d++) { add(4, d); add(5, d); add(8, d, 1); }
  for (let j = 0; j < N.dust; j++, d++) add(6, d);
  for (let j = 0; j < N.glow; j++, d++) add(7, d);
  for (let g = 0; g < N.glints; g++) if (g & 1) add(9, g); else for (let lv = 0; lv < 3; lv++) add(10, g, lv);
  const n = K.length / 4;
  const C = Array.from({length: 13}, () => new THREE.Vector3());
  RIFT_C.forEach((h, i) => C[i].copy(hex3(THREE, h))); C[12].copy(hex3(THREE, SHADOW_C));
  const U = {uA: {value: new THREE.Vector3()}, uT: new NumU(0), uPulse: new NumU(0), uHover: {value: hover}, uZ: new NumU(1), uGlowOn: new NumU(0),
    uYaw: G.U.camYaw, uSnap: {value: new THREE.Vector2(G.VW, G.VH)}, uPx: {value: new THREE.Vector2(PPM, PPMH)}, uC: {value: C}, uBreath: {value: breath}};
  // the particles: the shared quad, one instance each (their kinds and indices never change)
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', G.QUAD.getAttribute('position'));   // (never dispose: it shares the quad's GL buffer)
  geo.setAttribute('aK', new THREE.InstancedBufferAttribute(new Float32Array(K), 4)); geo.instanceCount = n;
  const pts = new THREE.Mesh(geo, G.cineMat(new THREE.RawShaderMaterial({vertexShader: G.shaders.HEAD + SPECKS_VS, fragmentShader: G.shaders.POINT_FS,
    glslVersion: THREE.GLSL3, uniforms: U, side: THREE.DoubleSide})));
  pts.frustumCulled = false; pts.matrixAutoUpdate = false;
  // the cracks: zigzag segments out from under it (fixed: a hash), as offsets (m) from its foot
  const P = [], V = [], hs = (a, b, c) => { let x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };
  for (let v = 0; v < N.veins; v++) {
    const a = v / N.veins * Math.PI * 2 + (hs(v, 3, 9) - .5) * .9;
    let x = Math.cos(a) * .14, y = Math.sin(a) * .14;
    for (let j = 0; j < N.vseg; j++) {
      const b = a + (j & 1 ? -1 : 1) * (.25 + hs(v, j, 5) * .45), l = .1 + hs(v, j, 7) * .09, x1 = x + Math.cos(b) * l, y1 = y + Math.sin(b) * l;
      P.push(x, ring, y, x1, ring, y1); V.push(v, j, v, j); x = x1; y = y1;
    }
  }
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); lgeo.setAttribute('aV', new THREE.Float32BufferAttribute(V, 2));
  const lines = new THREE.LineSegments(lgeo, G.cineMat(new THREE.RawShaderMaterial({vertexShader: G.shaders.HEAD + VEIN_VS, fragmentShader: G.shaders.HEAD + VEIN_FS,
    glslVersion: THREE.GLSL3, uniforms: U})));
  lines.frustumCulled = false; lines.matrixAutoUpdate = false;
  G.extra(pts, 'gbuf'); G.extra(lines, 'gbuf');
  return {
    count: n, U, _: {pts, lines},
    // what orbits it: {peb: [top, body], flake: [a, b], dust, glow | null, shadow} as '#rrggbb'
    palette(D) {
      C[6].copy(hex3(THREE, D.peb[0])); C[7].copy(hex3(THREE, D.peb[1])); C[8].copy(hex3(THREE, D.flake[0])); C[9].copy(hex3(THREE, D.flake[1]));
      C[10].copy(hex3(THREE, D.dust)); C[12].copy(hex3(THREE, D.shadow || SHADOW_C)); if (D.glow) C[11].copy(hex3(THREE, D.glow)); U.uGlowOn.value = D.glow ? 1 : 0;
    },
    // this frame: the foot (arena x, y; g the ground's height), the clock (s), the pulse (0..1), whole px per art px
    set(x, g, y, t, pulse, z) { U.uA.value.set(x, g, y); U.uT.value = t; U.uPulse.value = pulse; U.uZ.value = z; U.uSnap.value.set(G.VW, G.VH); },
    arm() { pts.userData.frame = lines.userData.frame = G.frame; },
  };
}
