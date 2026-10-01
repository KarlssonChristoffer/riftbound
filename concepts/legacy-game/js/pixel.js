// Pixel pipeline: the world is rendered small and scaled up pixel-sharp, while the light on top stays smooth.
// Every frame, at low resolution:
//   1. color   flat material color + emissive; alpha holds how much of the pixel glows (glow ignores lighting)
//   2. light   only the light reaching each pixel, in half float so bright spells can spill
//   3. normals view-space normals, used to find creases for edge highlights (skipped when highlights are off)
//   4. edges   dark outlines from depth jumps, light highlights along creases
//   5. screen  sharp upscale of the color times a smoothly upscaled light layer, then tone mapping
// The render camera snaps to the pixel grid and the screen pass slides the image by the leftover fraction,
// so the world never shimmers while the camera follows the hero.
import * as THREE from 'three';

export const RES = [{rows: 180, name: 'Chunky'}, {rows: 225, name: 'Classic'}, {rows: 270, name: 'Sharp'}, {rows: 360, name: 'Fine'}];
export const GFX_DEFAULT = {rows: 270, outline: .7, highlight: .5, light: 'smooth', steps: 3};
const KEY = 'riftbound.gfx.v1';
export const gfx = Object.assign({}, GFX_DEFAULT);
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) for (const k in GFX_DEFAULT) if (k in s) gfx[k] = s[k]; } catch (e) {}
if (!RES.some(r => r.rows === gfx.rows)) gfx.rows = GFX_DEFAULT.rows;
export function saveGfx() { try { localStorage.setItem(KEY, JSON.stringify(gfx)); } catch (e) {} }

// ---------- pixel textures ----------
// A big painted floor texture turns to mush when drawn at a few hundred pixels. pixelTex re-samples it to exactly one
// texel per screen pixel (and again whenever the resolution setting changes), so floors read as crisp pixel art.
// mode 'max' keeps the brightest texel of each block, so thin glowing cracks survive the shrink.
const pixelTextures = new Set(); let texPPU = 0;
export function pixelTex(tex, unitsPerRepeat, mode = 'avg') {
  tex.userData.px = {src: tex.image, units: unitsPerRepeat, mode};
  pixelTextures.add(tex); tex.addEventListener('dispose', () => { if (!tex.userData.rebaking) pixelTextures.delete(tex); });
  if (texPPU) bake(tex);
  return tex;
}
// Pixel art painted straight at the current density: paint(g, w, h, ppu) gets a canvas sized units[0] x units[1] world
// units at one texel per screen pixel. squash shortens the canvas vertically for surfaces the camera sees at an angle
// (floors and tops ~0.82, walls ~0.57), so their texels stay one pixel tall on screen too.
export function paintedTex(units, paint, squash = 1) {
  const tex = new THREE.CanvasTexture(document.createElement('canvas'));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.userData.paint = {units, paint, squash};
  pixelTextures.add(tex); tex.addEventListener('dispose', () => { if (!tex.userData.rebaking) pixelTextures.delete(tex); });
  bake(tex);
  return tex;
}
function bake(tex) {
  const P = tex.userData.paint;
  if (P) {
    const ppu = texPPU || 19.6, w = Math.max(2, Math.round(P.units[0] * ppu)), h = Math.max(2, Math.round(P.units[1] * ppu * P.squash));
    const c = document.createElement('canvas'); c.width = w; c.height = h; P.paint(c.getContext('2d'), w, h, ppu);
    swapImage(tex, c); return;
  }
  const {src, units, mode} = tex.userData.px, n = Math.max(4, Math.round(units * texPPU));
  const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
  if (mode === 'max') {
    const sw = src.width, sh = src.height, sc = document.createElement('canvas'); sc.width = sw; sc.height = sh;
    const sx = sc.getContext('2d'); sx.drawImage(src, 0, 0); const sd = sx.getImageData(0, 0, sw, sh).data, out = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const x0 = Math.floor(x * sw / n), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / n)), y0 = Math.floor(y * sh / n), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / n));
      let r = 0, gr = 0, b = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const k = (yy * sw + xx) * 4; if (sd[k] > r) r = sd[k]; if (sd[k + 1] > gr) gr = sd[k + 1]; if (sd[k + 2] > b) b = sd[k + 2]; }
      const o = (y * n + x) * 4; out.data[o] = r; out.data[o + 1] = gr; out.data[o + 2] = b; out.data[o + 3] = 255;
    }
    g.putImageData(out, 0, 0);
  } else { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, n, n); }
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestMipmapNearestFilter; tex.anisotropy = 1; swapImage(tex, c);
}
// GPU texture storage is fixed-size once uploaded, so a texture that changes size is released and uploaded fresh
function swapImage(tex, c) {
  const old = tex.image, resized = old && (old.width !== c.width || old.height !== c.height);
  if (resized) { tex.userData.rebaking = true; tex.dispose(); tex.userData.rebaking = false; }
  tex.image = c; tex.needsUpdate = true;
}

// ---------- material patch: one shader, two outputs (color pass / light pass) ----------
const PX = {pxPass: {value: 0}, pxSteps: {value: 0}};
const OPAQUE = `
#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
float pxMask = 1.0;
#ifdef PX_LIT
{
  vec3 pxE = totalEmissiveRadiance;
  vec3 pxL = min(max(outgoingLight - pxE, vec3(0.0)) / max(diffuseColor.rgb, vec3(0.004)), vec3(16.0));
  if (pxSteps > 0.5) {
    float pxM = max(max(pxL.r, pxL.g), pxL.b);
    float pxQ = floor(min(pxM, 2.0) * pxSteps + 0.5) / pxSteps;
    pxL = pxL / max(pxM, 1e-4) * max(pxQ, pxM * 0.5);
  }
  float pxEm = max(max(pxE.r, pxE.g), pxE.b), pxD = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
  pxMask = pxEm / (pxEm + pxD + 1e-4);
  outgoingLight = pxPass < 0.5 ? diffuseColor.rgb + pxE : pxL;
}
#elif defined( PX_BLEND )
if (pxPass > 0.5) outgoingLight = vec3(1.0);
#endif
gl_FragColor = vec4(outgoingLight, diffuseColor.a);
#ifdef OPAQUE
if (pxPass < 0.5) gl_FragColor.a = pxMask;
#endif
`;
// fog fades the light layer towards "no change" and additive glows towards nothing
const FOG = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  #ifdef PX_ADD
    gl_FragColor.rgb *= 1.0 - fogFactor;
  #else
    gl_FragColor.rgb = mix( gl_FragColor.rgb, pxPass > 0.5 ? vec3( 1.0 ) : fogColor, fogFactor );
  #endif
#endif
`;
const flags = m => ((m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial || m.isMeshToonMaterial) ? 'L' : '')
  + (m.blending === THREE.AdditiveBlending ? 'A' : '') + (m.transparent && m.blending === THREE.NormalBlending ? 'B' : '');
function patch(m) {
  if (m.userData.px || m.isShaderMaterial) return; // custom shaders render the same in both passes
  m.userData.px = true;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey();
  m.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    const f = flags(this);
    sh.uniforms.pxPass = PX.pxPass; sh.uniforms.pxSteps = PX.pxSteps;
    const defs = (f.includes('L') ? '#define PX_LIT\n' : '') + (f.includes('A') ? '#define PX_ADD\n' : '') + (f.includes('B') ? '#define PX_BLEND\n' : '');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float pxPass;\nuniform float pxSteps;\n' + defs)
      .replace('#include <opaque_fragment>', OPAQUE).replace('#include <fog_fragment>', FOG);
  };
  m.customProgramCacheKey = function () { return prevKey + '|px' + flags(this); };
  m.needsUpdate = true;
}

// ---------- post passes ----------
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const EDGE_FS = `
varying vec2 vUv;
uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tNormal;
uniform vec2 res; uniform float range; uniform float outline; uniform float highlight;
float dAt(vec2 uv){ return texture2D(tDepth, uv).x * range; }
vec3 nAt(vec2 uv){ return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
void main(){
  vec4 src = texture2D(tColor, vUv);
  vec3 c = src.rgb;
  float d = dAt(vUv);
  if (d < range * 0.9999 && (outline > 0.0 || highlight > 0.0)) {
    vec2 px = 1.0 / res; vec3 n = nAt(vUv);
    float dEdge = 0.0, nEdge = 0.0;
    for (int i = 0; i < 4; i++){
      vec2 o = i == 0 ? vec2(px.x, 0.0) : i == 1 ? vec2(-px.x, 0.0) : i == 2 ? vec2(0.0, px.y) : vec2(0.0, -px.y);
      float dd = dAt(vUv + o) - d;
      dEdge = max(dEdge, dd);
      if (highlight > 0.0) {
        vec3 nn = nAt(vUv + o);
        nEdge += (1.0 - dot(n, nn)) * smoothstep(-0.01, 0.01, dot(n - nn, vec3(1.0))) * step(-0.08, dd);
      }
    }
    if (dEdge > 0.3) c = mix(c, c * 0.22, outline);
    else if (nEdge > 0.2) c = mix(c, c * 1.6, highlight);
  }
  gl_FragColor = vec4(c, src.a);
}`;
const SCREEN_FS = `
uniform sampler2D tLow; uniform sampler2D tLight; uniform float lightScale;
uniform vec2 lowRes; uniform vec2 viewRes; uniform vec2 outRes; uniform vec2 offset;
vec4 cubic(float v){ vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v; vec4 s = n * n * n;
  float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x; return vec4(x, y, z, 6.0 - x - y - z) / 6.0; }
vec3 smoothLight(vec2 t){ // bicubic B-spline from four bilinear taps
  t -= 0.5; vec2 f = fract(t); t -= f;
  vec4 xc = cubic(f.x), yc = cubic(f.y);
  vec4 c = t.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (c + vec4(xc.yw, yc.yw) / s) / lowRes.xxyy;
  float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
  return mix(mix(texture2D(tLight, o.yw).rgb, texture2D(tLight, o.xw).rgb, sx), mix(texture2D(tLight, o.yz).rgb, texture2D(tLight, o.xz).rgb, sx), sy);
}
void main(){
  vec2 p0 = gl_FragCoord.xy / outRes * viewRes + 1.0 + offset;
  vec2 seam = floor(p0 + 0.5); // sharp pixels with a one-screen-pixel soft seam, so uneven scales stay even
  vec2 p = seam + clamp((p0 - seam) / max(fwidth(p0), vec2(1e-4)), -0.5, 0.5);
  vec4 al = texture2D(tLow, p / lowRes);
  vec3 light = mix(smoothLight(p0) / lightScale, vec3(1.0), clamp(al.a, 0.0, 1.0));
  gl_FragColor = vec4(al.rgb * light, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createPixelPipeline(renderer) {
  const half = renderer.capabilities.isWebGL2 && !!renderer.extensions.get('EXT_color_buffer_float');
  const colorType = half ? THREE.HalfFloatType : THREE.UnsignedByteType, lightScale = half ? 1 : .25;
  const edgeMat = new THREE.ShaderMaterial({vertexShader: QUAD_VS, fragmentShader: EDGE_FS, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: {tColor: {value: null}, tDepth: {value: null}, tNormal: {value: null}, res: {value: new THREE.Vector2()}, range: {value: 1}, outline: {value: 0}, highlight: {value: 0}}});
  const screenMat = new THREE.ShaderMaterial({vertexShader: QUAD_VS, fragmentShader: SCREEN_FS, depthTest: false, depthWrite: false, extensions: {derivatives: true},
    uniforms: {tLow: {value: null}, tLight: {value: null}, lightScale: {value: lightScale}, lowRes: {value: new THREE.Vector2()}, viewRes: {value: new THREE.Vector2()},
      outRes: {value: new THREE.Vector2()}, offset: {value: new THREE.Vector2()}}});
  const quad = m => { const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m)); return s; };
  const edgeScene = quad(edgeMat), screenScene = quad(screenMat), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const normalMat = new THREE.MeshNormalMaterial(), normalBg = new THREE.Color(.5, .5, 1), lightBg = new THREE.Color(lightScale, lightScale, lightScale);
  const camR = new THREE.OrthographicCamera(), right = new THREE.Vector3(), up = new THREE.Vector3(), outSize = new THREE.Vector2();
  let vw = 0, vh = 0, rtColor = null, rtLight = null, rtNormal = null, rtEdge = null;
  const hidden = [];

  function targets() {
    const rows = gfx.rows, cols = Math.max(16, Math.round(rows * innerWidth / Math.max(1, innerHeight)));
    if (rows === vh && cols === vw) return;
    for (const r of [rtColor, rtLight, rtNormal, rtEdge]) if (r) { if (r.depthTexture) r.depthTexture.dispose(); r.dispose(); }
    vw = cols; vh = rows;
    const w = vw + 2, h = vh + 2, nearest = {minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter}, linear = {minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter};
    rtColor = new THREE.WebGLRenderTarget(w, h, {...nearest, type: colorType});
    rtColor.depthTexture = new THREE.DepthTexture(w, h); rtColor.depthTexture.type = THREE.UnsignedIntType;
    rtLight = new THREE.WebGLRenderTarget(w, h, {...linear, type: colorType});
    rtNormal = new THREE.WebGLRenderTarget(w, h, nearest);
    rtEdge = new THREE.WebGLRenderTarget(w, h, {...linear, type: colorType});
    const e = edgeMat.uniforms; e.tColor.value = rtColor.texture; e.tDepth.value = rtColor.depthTexture; e.tNormal.value = rtNormal.texture; e.res.value.set(w, h);
    const s = screenMat.uniforms; s.tLow.value = rtEdge.texture; s.tLight.value = rtLight.texture; s.lowRes.value.set(w, h); s.viewRes.value.set(vw, vh);
  }
  // render camera = game camera moved onto the texel grid (in its own right/up axes), with a one-texel margin
  function snap(camera) {
    camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
    const tx = (camera.right - camera.left) / camera.zoom / vw, ty = (camera.top - camera.bottom) / camera.zoom / vh;
    const a = camera.position.dot(right), b = camera.position.dot(up), ia = Math.round(a / tx), ib = Math.round(b / ty);
    camR.position.copy(camera.position).addScaledVector(right, ia * tx - a).addScaledVector(up, ib * ty - b);
    camR.quaternion.copy(camera.quaternion); camR.layers.mask = camera.layers.mask;
    camR.left = camera.left / camera.zoom - tx; camR.right = camera.right / camera.zoom + tx;
    camR.top = camera.top / camera.zoom + ty; camR.bottom = camera.bottom / camera.zoom - ty;
    camR.near = camera.near; camR.far = camera.far; camR.updateProjectionMatrix(); camR.updateMatrixWorld();
    screenMat.uniforms.offset.value.set(a / tx - ia, b / ty - ib);
    edgeMat.uniforms.range.value = camera.far - camera.near;
  }
  function render(scene, camera) {
    targets(); snap(camera);
    const ppu = vh * camera.zoom / (camera.top - camera.bottom);
    if (Math.abs(ppu - texPPU) > .01) { texPPU = ppu; pixelTextures.forEach(bake); }
    hidden.length = 0;
    scene.traverse(o => {
      const m = o.material; if (!m) return;
      if (Array.isArray(m)) m.forEach(patch); else patch(m);
      if (o.visible && (o.isPoints || o.isSprite || o.isLine || (Array.isArray(m) ? m.some(x => x.transparent || x.alphaTest > 0) : m.transparent || m.alphaTest > 0))) hidden.push(o);
    });
    PX.pxSteps.value = gfx.light === 'toon' ? gfx.steps : 0;
    const bg = scene.background, auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    PX.pxPass.value = 0; renderer.setRenderTarget(rtColor); renderer.render(scene, camR);
    PX.pxPass.value = 1; scene.background = lightBg; renderer.shadowMap.needsUpdate = true; renderer.setRenderTarget(rtLight); renderer.render(scene, camR);
    PX.pxPass.value = 0;
    if (gfx.highlight > 0) {
      scene.background = normalBg; scene.overrideMaterial = normalMat; for (const o of hidden) o.visible = false;
      renderer.setRenderTarget(rtNormal); renderer.render(scene, camR);
      scene.overrideMaterial = null; for (const o of hidden) o.visible = true;
    }
    scene.background = bg; renderer.shadowMap.autoUpdate = auto;
    const e = edgeMat.uniforms; e.outline.value = gfx.outline; e.highlight.value = gfx.highlight;
    renderer.setRenderTarget(rtEdge); renderer.render(edgeScene, postCam);
    renderer.getDrawingBufferSize(outSize); screenMat.uniforms.outRes.value.copy(outSize);
    renderer.setRenderTarget(null); renderer.render(screenScene, postCam);
  }
  // low-resolution pixels per CSS pixel (used to size point particles)
  const scale = () => gfx.rows / Math.max(1, innerHeight);
  return {render, scale};
}
