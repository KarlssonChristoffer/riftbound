// PHOTOFX: photo mode's look (ui/photo.js), a post pass on the GPU over the finished frame: TILT-SHIFT (a band of focus
// across the screen, the blur growing above and below it: the miniature look HD-2D is made for), a VIGNETTE and a few
// subtle colour GRADES. While it's on, the renderer draws the frame into SRC (the canvas's size) instead of the canvas
// (gfx.js setPost), and run() lays it on: the blur is worked out at the ART resolution (VW x VH: two separable passes
// whose radius follows the screen row), then the final pass reads the sharp frame texel for texel (the pixel art stays
// crisp in focus) and the blur smoothly (bilinear: the soft parts are soft at any size), and grades, vignettes and
// dithers it into the canvas, or into an export target (capture: the same passes at the export's size).
// Off (photo mode closed) nothing of it runs and nothing is made: its targets and materials are created on first use
// (three.js draws Math.random for every new object's id: made at boot they'd shift every seeded capture) and freed by off().
// OWNS: its targets, materials, the look's numbers (P). READS: G (VW, VH, display, renderer).
// BUDGET: nothing while closed; open, ~0.1-0.3 ms GPU at 3440 x 1440 (two 17-tap passes at art resolution + one full-size pass).
//   const fx = createPhotoFx(G); fx.P = {...}; fx.on() / off(); fx.still = bool; fx.out = null | target (capture)
//   fx.target(w, h) -> an export target; fx.read(rt) -> Uint8Array (rows bottom-up, RGBA)
const HEAD = `precision highp float; precision highp int;\n`;
const VS = HEAD + `in vec3 position; out vec2 vUv; void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`;
// the blur radius (art px) at a screen row (uv y, 0 at the bottom): 0 inside the band, rising to the full radius over uTS.z
const RADIUS = `uniform vec4 uTS;   // x: the band's centre (uv y), y: its half width, z: the ramp to the full blur, w: the full radius (art px)
float radius(float y) { float d = max(0., abs(y - uTS.x) - uTS.y); return uTS.w * smoothstep(0., uTS.z, d); }
`;
// (textureLod: no implicit gradients inside the radius' branch and loop)
const BLUR_FS = HEAD + RADIUS + `uniform sampler2D tSrc; uniform vec2 uDir, uRes; in vec2 vUv; out vec4 oc;
void main() {
  float r = radius(vUv.y);
  if (r < .3) { oc = textureLod(tSrc, vUv, 0.); return; }
  vec4 a = vec4(0.); float ws = 0.;
  for (int i = -8; i <= 8; i++) { float f = float(i) / 8., w = exp(-f * f * 3.); a += textureLod(tSrc, vUv + uDir * (f * r) / uRes, 0.) * w; ws += w; }
  oc = a / ws;
}`;
const FINAL_FS = HEAD + RADIUS + `uniform sampler2D tSharp, tBlur; uniform vec2 uOut; uniform float uTilt, uVig, uAny, uSat, uCon; uniform vec3 uGain, uLift;
out vec4 oc;
void main() {
  vec3 c = texelFetch(tSharp, ivec2(gl_FragCoord.xy), 0).rgb;
  if (uAny < .5) { oc = vec4(c, 1.); return; }
  vec2 uv = gl_FragCoord.xy / uOut;
  if (uTilt > .5) { float m = smoothstep(.25, 1.5, radius(uv.y)); if (m > 0.) c = mix(c, textureLod(tBlur, uv, 0.).rgb, m); }
  c *= uGain;
  float l = dot(c, vec3(.299, .587, .114));
  c = mix(vec3(l), c, uSat);
  c = (c - .5) * uCon + .5;
  c = uLift + c * (1. - uLift);
  vec2 q = (uv - .5) * 2.; c *= 1. - uVig * smoothstep(.12, 1., dot(q, q) * .5);
  c += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))) - .5) / 255.;   // (no banding in the soft gradients)
  oc = vec4(clamp(c, 0., 1.), 1.);
}`;
// the grades: subtle. gain (white balance), saturation, contrast, lift (the blacks)
export const GRADES = {
  natural: {gain: [1, 1, 1], sat: 1, con: 1, lift: [0, 0, 0]},
  warm:    {gain: [1.04, 1.0, .93], sat: 1.05, con: 1.02, lift: [.01, .005, 0]},
  cool:    {gain: [.93, .99, 1.07], sat: .96, con: 1.02, lift: [0, .004, .014]},
  vivid:   {gain: [1, 1, 1], sat: 1.28, con: 1.1, lift: [0, 0, 0]},
  faded:   {gain: [1.02, 1, .96], sat: .82, con: .88, lift: [.06, .05, .045]},
  mono:    {gain: [1.03, 1, .95], sat: 0, con: 1.12, lift: [.01, .01, .01]},
};
export const LOOK = {focus: .5, width: .28, blur: .5, ramp: .32, maxR: 11};   // focus / width: of the screen's height (focus from the top); blur 0..1 -> maxR art px

export function createPhotoFx(G) {
  const THREE = G.THREE;
  const P = {tilt: true, focus: LOOK.focus, width: LOOK.width, blur: LOOK.blur, vignette: .25, grade: 'natural'};
  let made = null, src = null, bA = null, bB = null, onNow = false;
  const fx = {P, still: false, out: null, ms: 0};
  function make() {
    const lin = THREE.LinearFilter, opt = {minFilter: lin, magFilter: lin, depthBuffer: false};
    src = new THREE.WebGLRenderTarget(1, 1, opt); bA = new THREE.WebGLRenderTarget(1, 1, opt); bB = new THREE.WebGLRenderTarget(1, 1, opt);
    const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const ts = {value: new THREE.Vector4()};
    const mat = (fs, u) => new THREE.RawShaderMaterial({vertexShader: VS, fragmentShader: fs, uniforms: u, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false});
    const bU = {tSrc: {value: null}, uDir: {value: new THREE.Vector2()}, uRes: {value: new THREE.Vector2()}, uTS: ts};
    const fU = {tSharp: {value: null}, tBlur: {value: null}, uOut: {value: new THREE.Vector2()}, uTS: ts, uTilt: {value: 0}, uVig: {value: 0}, uAny: {value: 0},
      uSat: {value: 1}, uCon: {value: 1}, uGain: {value: new THREE.Vector3(1, 1, 1)}, uLift: {value: new THREE.Vector3()}};
    const scene = m => { const s = new THREE.Scene(), me = new THREE.Mesh(tri, m); me.frustumCulled = false; me.matrixAutoUpdate = false; s.add(me); s.matrixAutoUpdate = false; return s; };
    const bM = mat(BLUR_FS, bU), fM = mat(FINAL_FS, fU);
    made = {tri, bU, fU, bM, fM, blur: scene(bM), fin: scene(fM), cam: new THREE.Camera()};
  }
  const fit = (rt, w, h) => { if (rt.width !== w || rt.height !== h) rt.setSize(w, h); };
  // the renderer's hook (gfx.js setPost): the target it draws the frame into, the canvas's size now; run() after it
  const post = {
    get target() { fit(src, G.VW * G.display, G.VH * G.display); return src; },
    get still() { return fx.still; },
    run(renderer) {
      const t0 = performance.now(), M = made, VW = G.VW, VH = G.VH, W = src.width, H = src.height;
      const g = GRADES[P.grade] || GRADES.natural, tilt = P.tilt && P.blur > .001 && P.width < 1;
      M.bU.uTS.value.set(1 - P.focus, P.width / 2, LOOK.ramp, P.blur * LOOK.maxR);
      if (tilt) {   // the blur at art resolution: across, then down
        fit(bA, VW, VH); fit(bB, VW, VH); M.bU.uRes.value.set(VW, VH);
        M.bU.tSrc.value = src.texture; M.bU.uDir.value.set(1, 0); renderer.setRenderTarget(bA); renderer.render(M.blur, M.cam);
        M.bU.tSrc.value = bA.texture; M.bU.uDir.value.set(0, 1); renderer.setRenderTarget(bB); renderer.render(M.blur, M.cam);
      }
      const F = M.fU;
      F.tSharp.value = src.texture; F.tBlur.value = bB.texture; F.uOut.value.set(W, H); F.uTilt.value = tilt ? 1 : 0; F.uVig.value = P.vignette;
      F.uSat.value = g.sat; F.uCon.value = g.con; F.uGain.value.set(...g.gain); F.uLift.value.set(...g.lift);
      F.uAny.value = tilt || P.vignette > .001 || P.grade !== 'natural' ? 1 : 0;
      renderer.setRenderTarget(fx.out); renderer.render(M.fin, M.cam);
      fx.ms = fx.ms * .9 + (performance.now() - t0) * .1;
    },
  };
  // on(): the frame goes through the pass from the next render; off(): back to the canvas, everything freed
  fx.on = () => { if (!made) make(); onNow = true; G.setPost(post); };
  fx.off = () => {
    G.setPost(null); onNow = false; fx.out = null;
    if (made) { for (const rt of [src, bA, bB]) rt.dispose(); made.bM.dispose(); made.fM.dispose(); made.tri.dispose(); made = src = bA = bB = null; }
  };
  Object.defineProperty(fx, 'active', {get: () => onNow});
  // an export's target (w x h, nearest, no depth) and its pixels (RGBA bytes, rows from the bottom)
  fx.target = (w, h) => new THREE.WebGLRenderTarget(w, h, {minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false});
  // (another system's async readback may be in flight, its pixel-pack buffer bound: render/litter.js's mirror through three's
  // readRenderTargetPixelsAsync. A read into memory fails while one is bound: unbound for this read, then put back)
  fx.read = rt => {
    const gl = G.renderer.getContext(), pb = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING), d = new Uint8Array(rt.width * rt.height * 4);
    if (pb) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    try { G.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, d); } finally { if (pb) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pb); }
    return d;
  };
  return fx;
}
