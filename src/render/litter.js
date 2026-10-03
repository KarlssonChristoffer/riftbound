// LITTER (render3d): the living layer of fallen leaves. world.js bakes where leaves fall (density, palette, a wall / water mask: the
// SOURCE); this module runs the layer itself as a small simulation on the GPU and hands the ground shader (gfx.js SURF_FS) the
// result. Presentation only: nothing in the sim reads it, it can be switched off (the ground then draws the static source, as
// before) and it costs nothing in summer (nothing has fallen: no pass runs).
//
//   state    one float RGBA field, a cell per baked cell (2 x 2 ground texels), ping-pong render targets: R = how thickly leaves lie
//            here (the same units as the baked density, already scaled by how much has fallen), G = which tree palette (the dominant
//            one), B = the source density this cell has taken in so far (a rebake adds only the difference), A spare
//   a tick   TICK Hz (the owner calls advance(dt) every frame; the GPU runs a tick's SUB small passes at the next render), each:
//              wind      the wind grid (a coarse DataTexture of F.at, filled by features/litter.js) pushes leaves downwind where it
//                        is stronger than a threshold (a gust lifts them along; a calm leaves them lying exactly where they are)
//                        and shuffles them (dense -> sparse, in proportion to how far over the threshold)
//                        mass is conserved edge by edge: both cells of an edge compute the same flux; a solid cell (a wall, a trunk,
//                        the plateau's foot) lets none through (leaves pile against it); a sink cell (water, the ravine, the
//                        map's edge) takes leaves for good
//              the cap   a cell at the cap takes no more leaves (a pile against a wall grows back along the wind, never denser), and what is
//                        over it anyway (a seed, a rebake, a few leaves given back) spreads out to its neighbours
//              season    the whole field fades as `fell` (gfx.js litK.x) falls; leaves land from the source as it rises (a ground
//                        density = source x fell); and the field drifts back toward source x fell very slowly (the crowns go on
//                        shedding where a gust blew the carpet away; a blown-up drift thins), in a deadband so a calm stays still
//              events    give / take a few leaves at a point (features/litter.js: a leaf lifted off the carpet, one that settled)
//   read     the ground shader reads the current state texture (u.value) when `live` is 1, else the source with the old maths
//   mirror   a coarse copy of the field (1 texel per MIRROR x MIRROR cells, RGBA8) read back asynchronously on request, so a
//            feature can see where the carpet is without a stall (R = mean density / 2, G = palette)
//
// OWNS: the state targets, the passes, the mirror. READS: lit (world/world.js makeLitter: W, H, cell, tex = the source, u, live, cap),
// the season's `fell` (a function). BUDGET: a tick (4 passes over 946 x 458 cells) ~0.15-0.35 ms GPU on the dev machine, 8 a second: ~0.05 ms a frame
// at 60 fps, ~0.02 at 164; ~0.1 ms CPU on the frames that run a tick (submitting the passes); nothing in summer.
import * as THREE from 'three';

export const MAXEV = 16;     // events applied per tick
export const LEAF = .5;      // the density one leaf is worth in ONE cell (a cell holds ~2 x density leaves: the ground shader draws a leaf per 2 texels at density 1)
export const MIRROR = 8;     // cells per mirror texel
const STALE = 45;            // renders without an advance(): the owner stopped driving it (the feature was switched off): draw the source again (frames, not time: a hidden tab stops both)

export const DEFAULTS = {
  tick: 8, sub: 4,           // ticks per second, passes per tick (the cells are ~6.6 cm: small steps)
  thr: .55,                  // m/s of wind below which leaves lie still
  kappa: .3,                 // leaf speed (m/s) per m/s of wind above the threshold
  vmax: .22,                 // the fastest leaf speed, in cells per pass (a CFL limit: the scheme is explicit)
  diff: .012,                // shuffling, m^2/s per m/s of wind above the threshold (capped per pass in the shader)
  cap: .68, relax: .06,      // the soft cap on the density, and how fast what is over it spreads (per pass, per edge)
  tauUp: 90, tauDown: 320,   // s: how fast the field drifts back toward source x fell (refill under the crowns, a drift thinning)
  dead: .02,                 // the drift's deadband (density): smaller differences stay as they are
};

const HEAD = `precision highp float; precision highp int; precision highp sampler2D;\n`;
const VS = `precision highp float; in vec3 position; void main() { gl_Position = vec4(position.xy, 0., 1.); }`;

const SIM_FS = HEAD + `
uniform sampler2D tS, tSrc, tWind;
uniform ivec2 uSz, uWG;        // the field's size in cells, the wind grid's size
uniform vec4 uA;               // dt (s per pass), h (m per cell), thr (m/s), kappa
uniform vec4 uB;               // diff (m^2/s per m/s above thr), cap, relax (per pass), vmax (m/s)
uniform vec4 uC;               // fell, fellPrev (this pass: the season's step, first pass of a tick only), the wind grid's cell (m), mode
uniform vec4 uD;               // tauUp, tauDown (s), dead, first (1 = the first pass of a tick: the season and the events)
uniform vec4 uEv[${MAXEV}]; uniform int uNEv;   // events: x, y (cells), amount (density: + give, - take), palette
out vec4 oc;

int maskAt(ivec2 q) {          // 0 open, 1 sink (water, the ravine, off the map), 2 solid
  if (q.x < 0 || q.y < 0 || q.x >= uSz.x || q.y >= uSz.y) return 1;
  float b = texelFetch(tSrc, q, 0).b;
  return b < .25 ? 0 : b < .75 ? 1 : 2;
}
vec4 stAt(ivec2 q) { return texelFetch(tS, clamp(q, ivec2(0), uSz - 1), 0); }
float sOf(ivec2 q, int m) { if (m != 0) return 0.; float s = stAt(q).x; return s < .004 ? 0. : s; }   // (below the dust level a cell neither gives nor shows its leaves to a neighbour)
vec2 windAt(vec2 p) {          // m/s: bilinear between the grid cells' centres
  vec2 g = p / uC.z - .5, f = fract(g); ivec2 i0 = ivec2(floor(g)), mx = uWG - 1;
  vec2 a = texelFetch(tWind, clamp(i0, ivec2(0), mx), 0).xy, b = texelFetch(tWind, clamp(i0 + ivec2(1, 0), ivec2(0), mx), 0).xy;
  vec2 c = texelFetch(tWind, clamp(i0 + ivec2(0, 1), ivec2(0), mx), 0).xy, d = texelFetch(tWind, clamp(i0 + ivec2(1, 1), ivec2(0), mx), 0).xy;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// the leaves' drift across the edge between cell a and a + (1, 0) / (0, 1): (speed along the edge's axis, the wind's excess over the threshold)
vec2 edgeV(ivec2 a, int axis) {
  vec2 p = (vec2(a) + (axis == 0 ? vec2(1., .5) : vec2(.5, 1.))) * uA.y;   // the edge's middle (m): both cells of the edge evaluate the same point
  vec2 w = windAt(p); float sp = length(w), ex = max(0., sp - uA.z), v = min(uB.w, uA.w * ex);
  return vec2(sp > 1e-4 ? (axis == 0 ? w.x : w.y) / sp * v : 0., ex);
}
float room(float S) { return clamp(1. - S / uB.y, 0., 1.); }   // a cell at the cap takes no more: a pile against a wall grows back along the wind instead of up
// the mass crossing the edge (a, a + axis) in one pass, positive = toward + (negative: back). Both cells of the edge call this with
// the same arguments, so what one loses the other gains
float edgeFlux(ivec2 a, int axis) {
  ivec2 b = a + (axis == 0 ? ivec2(1, 0) : ivec2(0, 1));
  int ma = maskAt(a), mb = maskAt(b);
  if (ma == 2 || mb == 2) return 0.;
  float Sa = sOf(a, ma), Sb = sOf(b, mb), f = 0.;
  if (int(uC.w + .5) != 2) {
    vec2 v = edgeV(a, axis);
    f += (v.x > 0. ? v.x * Sa * (mb == 0 ? room(Sb) : 1.) : v.x * Sb * (ma == 0 ? room(Sa) : 1.)) * uA.x / uA.y;   // carried (upwind), into what room there is
    f += min(v.y * uB.x * uA.x / (uA.y * uA.y), .06) * (Sa - Sb);                            // shuffled, dense -> sparse
  }
  if (ma == 0 && mb == 0) f += uB.z * (max(Sa - uB.y, 0.) - max(Sb - uB.y, 0.));              // over the cap: spreads
  return f;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 sr = texelFetch(tSrc, c, 0), st = stAt(c);
  int mc = maskAt(c), mode = int(uC.w + .5);
  float D = sr.r, sg = floor(sr.g * 255. + .5), fell = uC.x, fp = uC.y;
  if (mc != 0) { oc = vec4(0., 0., D, 1.); return; }
  if (mode == 1) { oc = vec4(D * fell, sg, D, 1.); return; }                                  // seed: the source as it stands
  float S = st.x, g = st.y;
  float fR = edgeFlux(c, 0), fD = edgeFlux(c, 1), fL = edgeFlux(c - ivec2(1, 0), 0), fU = edgeFlux(c - ivec2(0, 1), 1);
  float m[6], gs[6];
  m[0] = max(S - max(fR, 0.) - max(fD, 0.) - max(-fL, 0.) - max(-fU, 0.), 0.); gs[0] = g;      // what stayed
  m[1] = max(fL, 0.);  gs[1] = stAt(c - ivec2(1, 0)).y;                                        // what came in, from the west, north, east, south
  m[2] = max(fU, 0.);  gs[2] = stAt(c - ivec2(0, 1)).y;
  m[3] = max(-fR, 0.); gs[3] = stAt(c + ivec2(1, 0)).y;
  m[4] = max(-fD, 0.); gs[4] = stAt(c + ivec2(0, 1)).y;
  // the season: the field fades as less has fallen; leaves land from the source as more does (and as a rebake adds some)
  float r = fell <= 1e-6 ? 0. : fell < fp ? fell / fp : 1.;
  for (int i = 0; i < 5; i++) m[i] *= r;
  float add = D * max(fell - fp, 0.) + max(D - st.z, 0.) * fell;
  // the slow drift back toward source x fell
  float Sn = m[0] + m[1] + m[2] + m[3] + m[4], e = D * fell - Sn;
  if (mode != 2 && abs(e) > uD.z) {
    if (e > 0.) add += e * min(1., uA.x / uD.x);
    else { float k = max(0., 1. + e * min(1., uA.x / uD.y) / max(Sn, 1e-6)); for (int i = 0; i < 5; i++) m[i] *= k; }
  }
  m[5] = add; gs[5] = sg;
  float best = -1., bg = g, tot = 0.;
  for (int i = 0; i < 6; i++) {
    float w = 0.; for (int j = 0; j < 6; j++) if (gs[j] == gs[i]) w += m[j];
    if (w > best + 1e-7) { best = w; bg = gs[i]; }
    tot += m[i];
  }
  if (uD.w > .5) for (int i = 0; i < ${MAXEV}; i++) {   // events (leaves given back / taken, a few cells wide)
    if (i >= uNEv) break;
    vec4 ev = uEv[i]; vec2 d = abs(vec2(c) + .5 - ev.xy);
    if (d.x > 1.5 || d.y > 1.5) continue;
    float a = ev.z / 9.;
    if (a > 0. && a >= .5 * tot) bg = ev.w;
    tot = max(0., tot + a);
  }
  oc = vec4(tot < 1e-4 ? 0. : tot, bg, D, 1.);
}`;

// the mirror: the mean density of a MIRROR x MIRROR block of cells (/ 2, to fit a byte) and the palette of its heaviest cell
const MIR_FS = HEAD + `
uniform sampler2D tS; uniform ivec2 uSz; uniform int uK; out vec4 oc;
void main() {
  ivec2 o = ivec2(gl_FragCoord.xy) * uK; float sum = 0., best = -1., bg = 0.;
  for (int j = 0; j < uK; j++) for (int i = 0; i < uK; i++) {
    ivec2 q = o + ivec2(i, j); if (q.x >= uSz.x || q.y >= uSz.y) continue;
    vec4 s = texelFetch(tS, q, 0); sum += s.x; if (s.x > best) { best = s.x; bg = s.y; }
  }
  oc = vec4(clamp(sum / float(uK * uK) * .5, 0., 1.), bg / 255., 0., 1.);
}`;

// lit: the world's litter object (W, H, cell (m), tex (the source, RGBA8: R density, G palette / 255, B mask 0 / 128 / 255),
// u {value} (what SURF_FS reads), live {value} (0 = the source, 1 = the field), cap {value}); fellOf(): how much has fallen (0..1)
export function createLitterSim(renderer, lit, fellOf) {
  const {W, H} = lit, p = {...DEFAULTS};
  const gl = renderer.getContext();
  const ok = !!(renderer.extensions.has('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_float'));
  const sim = {ok, W, H, h: lit.cell, p, mirror: null, wind: null, stats: {ticks: 0, passes: 0, ms: 0, seeds: 0}, get seeded() { return seeded; }};
  let seeded = false, needSeed = true, lastAdv = -1e9, runN = 0, acc = 0, pending = 0, fellPrev = 0, evN = 0, mWant = false, mBusy = false;
  lit.cap.value = p.cap;
  sim.set = o => { Object.assign(p, o); lit.cap.value = p.cap; };
  if (!ok) { sim.advance = sim.run = sim.give = sim.take = sim.want = sim.release = () => {}; sim.dispose = () => {}; return sim; }

  const mk = () => new THREE.WebGLRenderTarget(W, H, {type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false});
  let cur = mk(), nxt = mk();
  // the wind grid: F.at on a coarse grid (features/litter.js fills sim.wind.data: x, y of the wind in m/s per cell, then sim.advance)
  const WC = 2, GW = Math.ceil(W * lit.cell / WC), GH = Math.ceil(H * lit.cell / WC), wdata = new Float32Array(GW * GH * 4);
  const wtex = new THREE.DataTexture(wdata, GW, GH, THREE.RGBAFormat, THREE.FloatType);
  wtex.minFilter = wtex.magFilter = THREE.NearestFilter; wtex.generateMipmaps = false; wtex.colorSpace = THREE.NoColorSpace; wtex.needsUpdate = true;
  sim.wind = {w: GW, h: GH, cell: WC, data: wdata, tex: wtex};
  const V4 = () => ({value: new THREE.Vector4()});
  const uni = {tS: {value: null}, tSrc: {value: lit.tex}, tWind: {value: wtex}, uSz: {value: new THREE.Vector2(W, H)}, uWG: {value: new THREE.Vector2(GW, GH)},
    uA: V4(), uB: V4(), uC: V4(), uD: V4(), uEv: {value: Array.from({length: MAXEV}, () => new THREE.Vector4())}, uNEv: {value: 0}};
  // (three uploads an ivec2 uniform from a Vector2)
  const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const cam = new THREE.Camera(), scene = new THREE.Scene();
  const simMat = new THREE.RawShaderMaterial({vertexShader: VS, fragmentShader: SIM_FS, uniforms: uni, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false});
  const MK = Math.ceil(W / MIRROR), MH = Math.ceil(H / MIRROR);
  const mirRT = new THREE.WebGLRenderTarget(MK, MH, {minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false}), mtmp = new Uint8Array(MK * MH * 4);
  const mirMat = new THREE.RawShaderMaterial({vertexShader: VS, fragmentShader: MIR_FS, uniforms: {tS: {value: null}, uSz: {value: new THREE.Vector2(W, H)}, uK: {value: MIRROR}},
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false});
  const quad = new THREE.Mesh(tri, simMat); quad.frustumCulled = false; scene.add(quad);
  sim.mirror = {w: MK, h: MH, k: MIRROR, data: new Uint8Array(MK * MH * 4), ver: 0};
  // compile both programs now, while the world is still loading (the first tick would otherwise stall the first frame)
  try { quad.material = mirMat; renderer.compile(scene, cam); quad.material = simMat; renderer.compile(scene, cam); } catch (e) { console.warn('litter: shader compile', e); }

  const evQ = new Float32Array(MAXEV * 4);
  function draw(mat, rt) { quad.material = mat; renderer.setRenderTarget(rt); renderer.render(scene, cam); }
  function pass(mode, first, fell, fp) {
    const dt = 1 / p.tick / p.sub, hh = lit.cell;
    uni.uA.value.set(dt, hh, p.thr, p.kappa); uni.uB.value.set(p.diff, p.cap, p.relax, p.vmax * hh / dt);
    uni.uC.value.set(fell, fp, WC, mode); uni.uD.value.set(p.tauUp, p.tauDown, p.dead, first ? 1 : 0);
    if (first && evN) {
      const E = uni.uEv.value; for (let i = 0; i < evN; i++) E[i].set(evQ[i * 4], evQ[i * 4 + 1], evQ[i * 4 + 2], evQ[i * 4 + 3]);
      uni.uNEv.value = evN; evN = 0;
    } else uni.uNEv.value = 0;
    uni.tS.value = cur.texture; draw(simMat, nxt);
    const t = cur; cur = nxt; nxt = t; sim.stats.passes++;
  }
  // the owner (features/litter.js) calls this every frame it runs the layer, with a function that fills sim.wind.data when a tick is due
  sim.advance = (dt, fill) => {
    if (!seeded || runN - lastAdv >= STALE) { needSeed = true; acc = 0; pending = 0; }
    lastAdv = runN; acc = Math.min(acc + dt, .5);
    const T = 1 / p.tick;
    if (acc >= T) { if (fill) { fill(sim.wind); wtex.needsUpdate = true; } while (acc >= T && pending < 3) { acc -= T; pending++; } acc = Math.min(acc, T); }
  };
  // leaves given back (n > 0) or taken (n < 0) at a world point (m), `pal` = the palette group; a few cells wide (the next tick)
  sim.give = (x, y, n, pal = 0) => { if (evN < MAXEV) { const o = evN++ * 4; evQ[o] = x / lit.cell; evQ[o + 1] = y / lit.cell; evQ[o + 2] = n * LEAF; evQ[o + 3] = pal; } };
  sim.take = (x, y, n) => sim.give(x, y, -n, 0);
  sim.want = () => { mWant = true; };       // read the mirror back at the next render (it lands a few frames later: mirror.ver counts)
  sim.release = () => { lastAdv = -1e9; };   // stop driving it: the ground draws the source again from the next render
  // every render, before the scene: the ticks that are due, then what the ground shader should read
  sim.run = () => {
    const fresh = ++runN - lastAdv <= STALE;
    if (!fresh) { lit.u.value = lit.tex; lit.live.value = 0; pending = 0; evN = 0; return; }
    const t0 = performance.now(), fell = fellOf();
    if (needSeed) {   // the field starts as the source as it stands (what the static version drew), eased a little over the cap
      needSeed = false; seeded = true; pending = 0; evN = 0; fellPrev = fell; sim.stats.seeds++;
      pass(1, true, fell, fell);   // (also with nothing fallen: it records the source each cell has taken in)
      if (fell > 0) for (let i = 0; i < 24; i++) pass(2, false, fell, fell);
    }
    if (fell > 0 || fellPrev > 0) {
      for (let t = 0; t < pending; t++) {
        for (let s = 0; s < p.sub; s++) pass(0, s === 0, fell, s === 0 ? fellPrev : fell);
        fellPrev = fell; sim.stats.ticks++;
      }
    } else evN = 0;
    pending = 0;   // (fellPrev moves with a tick, not a frame: the season's step between two ticks must reach the next one)
    lit.u.value = cur.texture; lit.live.value = 1;
    if (mWant && !mBusy && fell > 0) {
      mWant = false; mBusy = true;
      mirMat.uniforms.tS.value = cur.texture; draw(mirMat, mirRT);
      renderer.readRenderTargetPixelsAsync(mirRT, 0, 0, MK, MH, mtmp).then(() => { sim.mirror.data.set(mtmp); sim.mirror.ver++; mBusy = false; }, () => { mBusy = false; });
    }
    sim.stats.ms = sim.stats.ms * .95 + (performance.now() - t0) * .05;
  };
  // tests only (a synchronous read: it stalls the GPU): the field as floats, R density, G palette, B the source taken in, A 1
  sim.dump = () => { const b = new Float32Array(W * H * 4); renderer.readRenderTargetPixels(cur, 0, 0, W, H, b); return b; };
  sim.dispose = () => { cur.dispose(); nxt.dispose(); mirRT.dispose(); wtex.dispose(); simMat.dispose(); mirMat.dispose(); tri.dispose(); lit.u.value = lit.tex; lit.live.value = 0; };
  return sim;
}
