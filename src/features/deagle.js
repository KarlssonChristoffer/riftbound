// DEAGLE: the golden Desert Eagle (assets/deagle/golden_deagle.glb, Lucas's model: his Tripo export through one Blender
// pass, tools/blender/deagle_bake.py, decimated to ~24k triangles with 1024 px maps, set in the gun bone's frame: the muzzle
// -Y, the slide's top +Z, the palm point at the origin, Z up) in the live hero's gun hand. On purpose NOT pixelized: it draws in the HD fx
// pass (G.extra 'fx': display resolution, over the pixel image) as smooth PBR gold lit by a little studio of its own, so
// it shines against the pixel world instead of joining it.
// It rides the drawn pose's GunHold0 (host.playerPose) through the body's own placing (view/livehero.js toWorld, the sprite
// camera's squash about his anchor; render/rigmesh.js: the anchor's whole-pixel snap), so it stays in his fist whatever
// the pose (the stand-in's aiming poses hold the arm out: assets/standin .../live/gunslinger/model.json, whose GunMuzzle0
// sits at this gun's muzzle). Tested against the pixel scene's depth, so his body and whatever stands in front hide it.
// FIRST PERSON (features/chasecam.js hidesBody): the same gun as the weapon model, at the bottom right of the view (camera
// space, placed at draw time against the camera that draws it), its barrel on the crosshair's point, while the gun is out
// or coming out; a shot kicks it up and back with a soft flash at the muzzle (G.fx), a reload tips it over and down, a
// roll / climb / swim takes it down; it bobs with his steps and trails a turn of the look. Drawn over the scene (a weapon
// model never goes into a wall); view/fphands.js leaves its pixel revolver out while F.fp.
// ?deagle=0 leaves the hand empty.
// OWNS: its mesh, its environment map, its first-person springs. READS: host.playerPose / P / PL (gun) / weapon / yaw,
//   features/chasecam.js hidesBody, host.G (camera, view size, frame, cine, fxU, fx).
// BUDGET: one draw (~24k triangles) a frame while it shows; nothing allocated per frame.
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';

const URL = '../assets/deagle/golden_deagle.glb';
const DEG = Math.PI / 180, K_UP = Math.tan(20 * DEG) * Math.cos(20 * DEG) / Math.sin(55 * DEG);   // (view/livehero.js K_UP)
const SHINE = 1.5;   // the studio's strength on the gold
const SIZE = 1.5;    // x the real thing (the model is 30 cm): a hand cannon that reads at the game's zoom
const BEHIND = .04;  // m behind the pixel scene before a fragment of it hides (his own block hand a hair in front: still drawn)
// first person: the grip in the camera's frame (m: right, up, back), the size, how far off the crosshair's point is
const FP = {x: .15, y: -.16, z: -.42, size: 1, aim: 14};
const MUZ = [0, -.228, .073];   // the bore's tip in the model (m at size 1): the flash
const FLASH = [1, .78, .42];
const HIDE = new Set(['roll', 'climb', 'mantle', 'rope', 'swim', 'fall', 'knock', 'leap', 'vault', 'launched', 'floored', 'hold']);   // (view/fphands.js HIDE)

export async function create(host) {
  const F = {name: 'deagle', on: flags.get('deagle') !== '0', fp: false};
  if (!F.on) return F;
  const {G, THREE} = host;
  const root = new THREE.Group(); root.matrixAutoUpdate = false;
  G.extra(root, 'fx');
  const FPU = {value: 0};   // 1: first person (camera space, no scene depth test)
  const VM = new THREE.Matrix4();   // first person: the gun in the camera's frame
  let gun = null;
  new GLTFLoader().loadAsync(URL).then(g => {
    const env = studio(THREE, G.renderer);
    g.scene.updateMatrixWorld(true);
    let first = true;
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const loc = o.matrixWorld.clone();   // (its place in the model)
      o.onBeforeRender = (r, s, cam) => {
        if (first === o) r.clearDepth();   // (the canvas' depth is the blit's: start clean)
        if (FPU.value) o.matrixWorld.multiplyMatrices(cam.matrixWorld, VM).multiply(loc);   // (three makes the model-view from it next)
      };
      if (first === true) first = o;
      const m = o.material; m.envMap = env; m.envMapIntensity = SHINE;
      // the game's renderer writes linear numbers (gfx.js: the arena's sRGB maths); this one material encodes itself,
      // through a filmic curve so the highlights roll off instead of clipping (three defines its tone curves only for a
      // tone-mapped renderer: the ACES fit inline). Hidden where the pixel scene stands in front of it, as the soft
      // particles are (gfx.js FX_FS: its depth under the pixel, slid and magnified as the blit drew it; the fx pass's own
      // uniforms, read only): his body when it's in the far hand, his fist round the grip
      m.onBeforeCompile = s => {
        for (const k of ['tD', 'uDS', 'uR', 'uSub', 'uZm']) s.uniforms[k] = G.fxU[k];
        s.uniforms.uDgFp = FPU;
        s.fragmentShader = `uniform sampler2D tD; uniform float uDS, uR, uDgFp; uniform vec2 uSub; uniform vec4 uZm;
vec3 dgAces(vec3 x) { return clamp(x * (2.51 * x + .03) / (x * (2.43 * x + .59) + .14), 0., 1.); }
void dgHide() {
  if (uDgFp > .5) return;
  vec2 q = uZm.x > 1. ? uZm.yz + (gl_FragCoord.xy - uZm.yz) / uZm.x : gl_FragCoord.xy;
  float sd = texelFetch(tD, ivec2((q + uSub) / uDS), 0).r;
  if (sd > .0005 && sd <= 1. && (gl_FragCoord.z - sd) * 2. * uR > ${BEHIND.toFixed(3)}) discard;
}
` + s.fragmentShader.replace('void main() {', 'void main() {\n  dgHide();')
          .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = dgAces(gl_FragColor.rgb);')
          .replace('#include <colorspace_fragment>', 'gl_FragColor = sRGBTransferOETF(gl_FragColor);');
      };
      m.customProgramCacheKey = () => 'deagle';
      m.needsUpdate = true;
    });
    root.add(g.scene); gun = g.scene;
  }).catch(e => console.warn('deagle: no model', e));

  // the model's frame -> the gun bone's rest-local frame (the muzzle's way along GunMuzzle0 but level: the bore sits above
  // the palm point; up along the rest's Z), per model
  const O = new THREE.Matrix4();
  let oJ = null, gi = -1, oBN = null;
  function frameOf(J) {
    const g = J.bones.GunHold0, m = J.bones.GunMuzzle0, r = g.rest;
    const loc = (x, y, z) => [r[0] * x + r[4] * y + r[8] * z, r[1] * x + r[5] * y + r[9] * z, r[2] * x + r[6] * y + r[10] * z];   // R^T v
    const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const Z = unit(loc(0, 0, 1)), m0 = m ? loc(m.head[0] - g.head[0], m.head[1] - g.head[1], m.head[2] - g.head[2]) : loc(0, -1, 0);
    const mu = m0[0] * Z[0] + m0[1] * Z[1] + m0[2] * Z[2], b = unit([m0[0] - Z[0] * mu, m0[1] - Z[1] * mu, m0[2] - Z[2] * mu]);
    const Y = [-b[0], -b[1], -b[2]];
    const X = [Y[1] * Z[2] - Y[2] * Z[1], Y[2] * Z[0] - Y[0] * Z[2], Y[0] * Z[1] - Y[1] * Z[0]];
    O.set(X[0], Y[0], Z[0], 0, X[1], Y[1], Z[1], 0, X[2], Y[2], Z[2], 0, 0, 0, 0, 1).multiplyScalar(SIZE);
    O.elements[15] = 1;
  }

  const M = new THREE.Matrix4(), B = new THREE.Matrix4(), S = new THREE.Matrix4(), Q = new THREE.Quaternion();
  const P3 = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), A = new THREE.Vector3(), D = new THREE.Vector4();
  const show = () => { root.matrix.copy(M); root.matrixWorldNeedsUpdate = true; root.userData.frame = G.frame; };

  // ---------------------------------------------------------------- third person: in his hand
  function inHand() {
    const pp = !G.cine && host.playerPose?.();   // (a cinema camera: the depth test above is the oblique view's)
    if (!pp?.J?.bones.GunHold0) return false;
    if (pp.J !== oJ) { oJ = pp.J; frameOf(pp.J); }
    if (pp.BN !== oBN) { oBN = pp.BN; gi = pp.BN.indexOf('GunHold0'); }
    if (gi < 0) return false;
    const w = pp.w, o = gi * 7;
    // the bone in body space (Blender axes: Z up, facing -Y), then body -> world as livehero's toWorld
    M.compose(P3.set(w[o + 4], w[o + 5], w[o + 6]), Q.set(w[o], w[o + 1], w[o + 2], w[o + 3]), ONE).multiply(O);
    const fc = Math.cos(pp.phi), fs = Math.sin(pp.phi);
    B.set(fc, -fs, 0, pp.x, 0, 0, 1, pp.h, -fs, -fc, 0, pp.z, 0, 0, 0, 1);
    M.premultiply(B);
    // the sprite camera's squash: the ground depth along the view's "away" pulled toward his anchor
    const yaw = host.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), k = 1 - K_UP, fa = fx * pp.x + fz * pp.z;
    S.set(1 - k * fx * fx, 0, -k * fx * fz, k * fx * fa, 0, 1, 0, 0, -k * fx * fz, 0, 1 - k * fz * fz, k * fz * fa, 0, 0, 0, 1);
    M.premultiply(S);
    // the body's snap: his anchor onto a whole view pixel, the same shift for the gun (in NDC, back to a world offset)
    const cam = G.camera, vw = G.VW, vh = G.VH;
    A.set(pp.x, pp.h, pp.z).project(cam);
    const px = (A.x * .5 + .5) * vw, py = (A.y * .5 + .5) * vh;
    D.set((Math.round(px) - px) / vw * 2, (Math.round(py) - py) / vh * 2, 0, 0).applyMatrix4(cam.projectionMatrixInverse).applyMatrix4(cam.matrixWorld);
    S.makeTranslation(D.x, D.y, D.z); M.premultiply(S);
    return true;
  }

  // ---------------------------------------------------------------- first person: the weapon model
  // springs: down (0 up .. 1 out of sight), the kick, the flash, the reload's tip, the look's lag
  const K = {down: 1, kick: 0, flash: 0, rl: 0, sway: 0, yaw: NaN};
  const FW = new THREE.Vector3(), UP = new THREE.Vector3(), RT = new THREE.Vector3(), XV = new THREE.Vector3(), YV = new THREE.Vector3();
  const SC = new THREE.Vector3(FP.size, FP.size, FP.size), MW = new THREE.Vector3();
  function inView(dt) {
    const P = host.P, gs = host.PL.gun?.S;
    const want = host.weapon?.kind === 'gun' && (!!gs?.out || P.state === 'draw') && !HIDE.has(P.state) && (P.sink || 0) <= .55;
    K.down = clamp(K.down + (want ? -dt * 4 : dt * 6), 0, 1);
    K.kick = Math.max(0, K.kick - dt * 7); K.flash = Math.max(0, K.flash - dt);
    K.rl += ((host.PL.gun?.reloading ? 1 : 0) - K.rl) * (1 - Math.exp(-dt * 10));
    if (K.yaw === K.yaw) K.sway = clamp(K.sway - (((host.yaw - K.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * .4, -.05, .05);
    K.yaw = host.yaw; K.sway *= Math.exp(-dt * 9);
    if (K.down >= 1) return false;
    const moving = P.state === 'move' ? clamp(Math.hypot(P.vx, P.vy) / 4, 0, 1.4) : 0, ph = (P.ph || 0) * Math.PI * 2;
    const x = FP.x + K.sway + Math.sin(ph) * .008 * moving;
    const y = FP.y - Math.abs(Math.cos(ph)) * .01 * moving - K.down * K.down * .3 - K.rl * .14 + K.kick * .012;
    const z = FP.z + K.kick * .07;
    // the barrel on the crosshair's point; its left side to the camera's left; then the kick (muzzle up) and the reload's tip
    FW.set(-x, -y, -FP.aim - z).normalize(); UP.set(0, 1, 0); RT.crossVectors(FW, UP).normalize(); UP.crossVectors(RT, FW);
    VM.makeBasis(XV.copy(RT).negate(), YV.copy(FW).negate(), UP);
    VM.premultiply(B.makeRotationFromQuaternion(Q.setFromAxisAngle(RT, K.kick * .5 + K.rl * .35)));
    VM.premultiply(B.makeRotationFromQuaternion(Q.setFromAxisAngle(FW, K.rl * .9)));
    VM.scale(SC).setPosition(x, y, z);
    if (K.flash > 0) {   // (the camera now: a frame's lag is lost in the flash)
      MW.set(MUZ[0], MUZ[1], MUZ[2]).applyMatrix4(VM).applyMatrix4(G.camera.matrixWorld);
      G.fx(MW.x, MW.y, MW.z, .07, FLASH, K.flash / .06, 'add');
    }
    return true;
  }

  let cc = null;   // features/chasecam.js
  F.view = (dt, evs) => { for (let i = 0; i < evs.length; i++) if (evs[i].type === 'player.shoot') { K.kick = 1; K.flash = .06; } };
  F.frame = f => {
    if (!gun) return;
    F.fp = !!(cc ??= host.feature('chasecam') || false) && !!cc.hidesBody;
    FPU.value = F.fp ? 1 : 0;
    if (F.fp ? inView(Math.min(f.dt || 0, .1)) : inHand()) show();
  };
  return F;
}

// a small photo studio for the gold to mirror: a dim room, a big softbox overhead, a warm and a cool strip at the sides
// (its PMREM: once, at load)
function studio(THREE, renderer) {
  const s = new THREE.Scene(), box = new THREE.BoxGeometry(1, 1, 1), mats = [];
  const add = (hex, k, x, y, z, sx, sy, sz, side = THREE.FrontSide) => {
    const m = new THREE.MeshBasicMaterial({color: new THREE.Color(hex).multiplyScalar(k), side}); mats.push(m);
    const b = new THREE.Mesh(box, m); b.position.set(x, y, z); b.scale.set(sx, sy, sz); s.add(b);
  };
  add(0x3a342c, 1, 0, 4, 0, 24, 12, 24, THREE.BackSide);
  add(0xffffff, 7, 0, 9.8, 0, 9, .2, 9);
  add(0xffd9a0, 5, -11.8, 4, -2, .2, 5, 9);
  add(0xb8d4ff, 3.5, 11.8, 4, 2, .2, 4, 7);
  add(0xffffff, 2.5, 0, 3, -11.8, 8, 3, .2);
  add(0x201a14, 1, 0, -1.9, 0, 23, .2, 23);
  const pm = new THREE.PMREMGenerator(renderer), t = pm.fromScene(s, .03).texture;
  pm.dispose(); box.dispose(); for (const m of mats) m.dispose();
  return t;
}
