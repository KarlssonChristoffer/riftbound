// WORLD: the Proving Grounds rebuilt as a 3D scene for the HD-2D test, from the arena's own data.
//   ground   the biome's painter, run TOP-DOWN (the same code with PPMY = PPM and PPMH = 0), on a height grid: the stream
//            bed sits lower, the south ravine drops away
//   plateau  a real block: its painted top, rock-strata faces
//   props    live 3D meshes (Blender prop kit -> glb, toned on the GPU with the pixelizer's ramps and rules) or, for the
//            A/B test, the same props pre-rendered at 16 yaws (cards); trees are grown in the browser (trees3d.js: the
//            biomes it has species for; trees3d: false = the painted cards); everything else the kit doesn't model
//            (bushes, tufts, braziers, torches, dummies, brutes, crystal) stays a painted billboard card
//   lights   from the biome's sprites (braziers, torches, crystals) and ground (lava, runes), in metres
//   leaves   fallen leaves lie under and downwind of the 3D trees: a density map baked here (LITTER, bakeLitter) that gfx.js SURF_FS
//            draws from, by how far autumn has gone (the season looks: gfx.js setGround). The plants' autumn: plantOf, below
//   water    the stream's surface MOVES, in the shader (gfx.js SURF_FS), from one baked texture. Everything animated is built
//            from waterSample(x, y, out) below: it is the ONE place that says "this is water" and what the water there does.
//            A new body of water (a plateau stream, a pool) adds a branch to waterSample and nothing else needs to change.
//            What a water body provides, per point (metres, world axes: x east, y south):
//              out.kind   0 = not water; 1 = the stream; 2 = the plateau's rill; 3 = the pool at the foot of its south face and its outflow
//                         to the stream (a new body takes the next number)
//              out.a      across the flow: signed metres from the body's axis (the stream: x - cx(y))
//              out.hw     half the body's width here (m);  out.edge = hw - |a|: metres to the nearest bank
//              out.s      the TRAVEL coordinate (m): the integral of dy / speed along the flow, speed ~ 1 / width. The shader
//                         slides its pattern along s (pattern(a, s - clock)), so every stretch moves at its own speed and
//                         the narrows run faster, with none of the shear a plain y - v t piles up
//              out.speed  relative speed here (1 = the body's base; the stream runs a little faster mid-channel). 0 = still
//              out.hold   1 = by a stone: the painted foam stays as painted
//            The rill (kind 2, layout.js RILL): a = metres across it (+ to the left of the flow), s = 0.55 x its length from the spring, the
//            pace rising toward the lip; hold = the spring's basin, the narrow riffles and the lip's foam, where the painted bright streaks
//            stay put. The pool and its outflow (kind 3, south of the plateau's face, beyond the river's east bank): one body flowing west
//            into the river. s = the river's own travel at that y minus the distance from the bank (eased in over the first .3 m: it joins
//            the river's s without a seam), the pace falling from the river's 1 at the bank to a slow churn in the pool; a = metres south
//            of the outflow's axis; edge counts the face as a bank; hold = the foam where the fall lands. Inside the river's band the
//            outflow changes only edge (no bank at its mouth).
//            FALLING water (a waterfall over the ravine, brief B's one down the plateau's south face) is marked in a face /
//            cliff texture with alpha FALL_ALPHA (252, next to the alpha-250 note in buildWorld); the shader streams it down
//            (gfx.js fall(): light streaks slide down in stepped time, the foam in the last 6 rows flickers).
//            G.setWater({speed}) (gfx.js) scales the water's clock: brief D drives it from rain.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {WORLD, PLAY, TRAIL, buildLayout, elev, inStream, PLATEAUS, STREAM, SPRING, RILL, FALL, POOL, OUTFLOW, inPool, poolEdge, rillAt, inRill, outflowAt, inOutflow} from './layout.js';
import {treeModel, boneHit} from './trees3d.js';
import {rgbOf, hexRaw255 as hexrgb, hex255, hex01} from '../core/color.js';
import {vnoise, smooth} from '../core/mathx.js';

export const WATER_H = -.18;   // the stream bed sits this much below the ground (features: world.waterH)
const GLB = '../concepts/sprites/out/render3d/glb/', YAW = '../concepts/sprites/out/render3d/props_yaw/';

// ---------------------------------------------------------------- the pixelizer's palettes (props_pixelize.py BIOMES)
const RED = ['d8573e', 'a8342b', '72222a', '3e1420'], HAZ = ['f2d060', 'd8a830', '9a7020', '4e3812'], GOLD = ['ffe89a', 'e0b040', 'a87a24', '5a3e14'];
const PAL = {
  ruins: {wood: ['8c6c4a', '70543a', '543e2b', '35271c'], metal: ['a08650', '7a6438', '56452a', '352a1c'], clay: ['c8845a', 'a8643e', '7e472c', '4e2a1c'],
    stone: ['a09c90', '868278', '6a675f', '46443e'], rock: ['7e786b', '666056', '504b44', '35322d'], rope: ['cdb577', 'ad935a', '877043', '594a2b'],
    cover: ['7d9470', '627a58', '4b6048', '334436'], coverK: .08, coverT: .86},
  ember: {wood: ['5a4a40', '43362f', '30261f', '1c1512'], metal: ['6c666a', '4d484d', '363237', '211e22'], clay: ['6a6078', '463e52', '2e2838', '18141e'],
    stone: ['6c5656', '524042', '3e2f32', '261c1f'], rock: ['5f4b4b', '483839', '362a2c', '221a1c'], rope: ['8c7a5a', '6e5e44', '4e4230', '2e261c'],
    cover: ['8c827b', '79716b', '655e59', '4a4441'], coverK: .16, coverT: .84},
  frost: {wood: ['8a7c6e', '6d6055', '534841', '362f2b'], metal: ['9ea8b8', '768093', '586275', '39404f'], clay: ['cfdcea', 'a0b6d0', '7690b0', '4a5e80'],
    stone: ['8494ad', '6a7a95', '55647e', '3a455c'], rock: ['717e90', '5a6679', '475264', '2f3747'], rope: ['c9bd94', 'a99c74', '857a58', '58503a'],
    cover: ['eef3f8', 'd6dfeb', 'b4c2d6', '8795b2'], coverK: .5, coverT: .78},
  rift: {wood: ['6a5680', '4e3e66', '392d4e', '221a31'], metal: ['6c5c8c', '4f4372', '3b3158', '251e39'], clay: ['7a64a8', '5a4886', '433466', '2a2044'],
    stone: ['5e4e88', '46396a', '352b54', '211a36'], rock: ['4f4270', '3c3158', '2d2545', '1c1730'], rope: ['8a78a8', '6a5a88', '4e4268', '2e2644'], cover: null},
};
const EMIT = {rune: {rift: ['ffe0fa', 'ff8ae8', 'c85ad8', '8a4ad8']}, crack: {ember: ['ffe08a', 'ffa040', 'e0541e', '6e1c12']}};
// (bark, leaf: the procedural trees, trees3d.js; char, ash, ember: burning wood, gfx.js MESH_FS uBurn; appended, so the kit's
// family indices stay put)
export const FAMS = ['wood', 'metal', 'clay', 'stone', 'rock', 'rope', 'red', 'haz', 'gold', 'void', 'rune', 'crack', 'cover', 'bark', 'leaf', 'char', 'ash', 'ember'];
const mix = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
const ramp6 = r4 => { const r = r4.map(hexrgb); return [r[0], r[1], r[2], mix(r[3], r[2], .25), r[3], r[2]]; };   // + line, outline_shadow, outline_lit
function palette(biome, style) {
  const B = PAL[biome], P = {red: ramp6(RED), haz: ramp6(HAZ), gold: ramp6(GOLD)};
  for (const k of ['wood', 'metal', 'clay', 'stone', 'rock', 'rope']) P[k] = ramp6(B[k]);
  // the trees take the painted trees' own ramps (biomes.js STYLES: leaf / pine, bark)
  const sr = k => style?.[k]?.h ? ramp6(style[k].h.map(h => h.replace('#', ''))) : null;
  P.bark = sr('bark') || P.wood; P.leaf = sr('leaf') || sr('pine') || P.rock;
  const w = P.wood; P.void = [...Array(3).fill(mix(w[4], [0, 0, 0], .3)), ...Array(3).fill(mix(w[4], [0, 0, 0], .45))];
  P.cover = B.cover ? ramp6(B.cover) : P.stone;
  P.char = ramp6(['3a3330', '26211f', '161312', '0c0a0a']); P.ash = ramp6(['8e8982', '75716b', '5e5a55', '403d3a']);
  P.ember = ramp6(['ffc464', 'ff7c26', 'c0360e', '5a1406']);
  const st = P.stone;
  P.rune = EMIT.rune[biome] ? ramp6(EMIT.rune[biome]) : st;
  P.crack = EMIT.crack[biome] ? ramp6(EMIT.crack[biome]) : [st[3], st[3], st[3], st[4], st[4], st[4]];
  return P;
}
export function rampTexture(biome, style = null) {
  const P = palette(biome, style), data = new Uint8Array(6 * FAMS.length * 4);
  FAMS.forEach((f, j) => P[f].forEach((c, i) => data.set([...c, 255], (j * 6 + i) * 4)));
  const t = new THREE.DataTexture(data, 6, FAMS.length, THREE.RGBAFormat); t.needsUpdate = true;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  const B = PAL[biome];
  return {tex: t, cover: B.cover ? [B.coverK, B.coverT, FAMS.indexOf('cover')] : [0, 1, 0],
    emitFam: [EMIT.rune[biome] ? FAMS.indexOf('rune') : -1, EMIT.crack[biome] ? FAMS.indexOf('crack') : -1], rock: P.rock, cov: B.cover ? P.cover : null};
}

// ---------------------------------------------------------------- helpers
const _scl = new THREE.Vector3();
let GT = null;   // the renderer: one texture cache for everything (gfx.js tex)
export const texOf = (img, linear = false) => GT.tex(img, {linear});
const loadImg = src => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => err(new Error(src)); i.src = src; });
const hsh = (a, b = 0, c = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };

// glb state -> merged non-indexed geometry with per-part attributes (part index, family, tone bias, fixed tone)
const glbCache = {};
async function loadGlbIndex() { try { return await fetch(GLB + 'index.json').then(r => r.ok ? r.json() : null); } catch { return null; } }
async function glbGeometry(loader, state) {
  if (state in glbCache) return glbCache[state];
  const p = (async () => {
    const gltf = await loader.loadAsync(GLB + state + '.glb'); gltf.scene.updateMatrixWorld(true);
    const parts = []; gltf.scene.traverse(o => { if (o.isMesh) parts.push(o); });
    const pos = [], nrm = [], aPart = [], aFam = [], aBias = [], aFixed = [];
    const nm = new THREE.Matrix3();
    parts.forEach((m, pi) => {
      const [fam, , bias, flags = ''] = (m.material.name || 'stone|?|0|').split('|');
      const fixed = (flags.match(/fixed(\d)/) || [])[1];
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const P = g.attributes.position, N = g.attributes.normal; nm.getNormalMatrix(m.matrixWorld);
      const v = new THREE.Vector3(), n = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); pos.push(v.x, v.y, v.z);
        n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nrm.push(n.x, n.y, n.z);   // per-polygon normals as exported
        aPart.push(pi % 64); aFam.push(Math.max(0, FAMS.indexOf(fam))); aBias.push(+bias || 0); aFixed.push(fixed === undefined ? -1 : +fixed);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('aPart', new THREE.Float32BufferAttribute(aPart, 1)); geo.setAttribute('aFam', new THREE.Float32BufferAttribute(aFam, 1));
    geo.setAttribute('aBias', new THREE.Float32BufferAttribute(aBias, 1)); geo.setAttribute('aFixed', new THREE.Float32BufferAttribute(aFixed, 1));
    geo.computeBoundingSphere();
    return geo;
  })().catch(e => { console.warn('glb', state, e.message); return null; });
  return (glbCache[state] = p);
}
// the arena's kind (+ breakable stage, chest lid) -> prop-kit state (arena/props3d.js frameName; barrels tip and roll
// as real rotations here, so they have no tilt / roll states)
const wallV = p => ((Math.round(p.x * 3) * 7 + Math.round(p.y * 5) * 13) >>> 0) % 4;
const potV = p => ((Math.round(p.x * 7) + Math.round(p.y * 13)) & 1) ? 'pot_b' : 'pot';
export function stateOf(p) {
  switch (p.kind) {
    case 'crate': return p.stage === 2 ? 'crate_broken' : p.stage === 1 ? 'crate_dmg' : 'crate';
    case 'barrel': case 'barrel_x': return p.stage === 2 ? p.kind + '_broken' : p.stage === 1 ? p.kind + '_dmg' : p.kind;
    case 'pot': { const v = potV(p); return p.stage === 2 ? 'pot_broken' : p.stage === 1 ? v + '_dmg' : v; }
    case 'chest': return 'chest_' + Math.max(0, Math.min(4, Math.round((p.lid || 0) * 4)));
    case 'pillar': case 'pillar_broken': case 'rubble': case 'tower': case 'gatepost': return p.kind;
    case 'rock': return 'rock_' + ((p.variant | 0) % 3);
    case 'rock_big': return 'rock_big_' + ((p.variant | 0) % 3);
    case 'wall_n': return 'wall_ew_' + wallV(p);
    case 'wall_s': return 'wall_low_' + wallV(p);
    case 'wall_w': case 'wall_e': return 'wall_ns_' + wallV(p);
  }
  return null;
}
// the 16-yaw pre-renders: state -> [frame base, yaw step offset]
function yawOf(p, st) {
  if (p.kind === 'wall_n') return ['wall_ew_0', 0];
  if (p.kind === 'wall_w' || p.kind === 'wall_e') return ['wall_ew_0', 4];   // a N-S wall is the E-W wall turned 90 deg
  if (['crate', 'barrel', 'pillar', 'tower'].includes(st)) return [st, 0];
  if (st === 'rock_big_0') return ['rock_big_0', 0];
  return null;
}
const WALL_ID = {wall_n: 2, wall_s: 3, wall_w: 4, wall_e: 5};
// masonry tops (m) as the 3D kit builds them (tools/blender/props3d_glb.py SIZES_3D; the arena's are lower)
export const PROP_TOP = {wall_n: 2.4, wall_w: 2.4, wall_e: 2.4, wall_s: .9, tower: 3.9, gatepost: 2.85};
// a feature's own prop kinds: how high each stops arrows (registered once, at its module's load)
export function propTop(table) { Object.assign(PROP_TOP, table); }

// ---------------------------------------------------------------- water: the sampler
export const FALL_ALPHA = 252;   // a cliff / face texel with this alpha is falling water (SURF_FS streams it); 250 = a glowing fall (lava)
const W_REF = 2.9, S_Y0 = -1, S_DY = .05;   // the stream's reference width (its normal 2.9 m) and the travel table's grid
let S_TAB = null;
function travelTab() {   // S(y) = integral of w(y') / W_REF dy' from y = -1, every 5 cm: built once (the stream never changes shape)
  const n = Math.round((31 - S_Y0) / S_DY) + 2, t = new Float32Array(n);
  for (let i = 1; i < n; i++) t[i] = t[i - 1] + STREAM.w(S_Y0 + (i - .5) * S_DY) / W_REF * S_DY;
  return S_TAB = t;
}
// waterSample(x, y, out): is (x, y) water and what does the water there do? Fills out (see the header); no allocation.
// Stones are dry footing (their painted body, out.kind 0); the water round them is flagged out.hold
const _rs = {d: 0, a: 0, l: 0, hw: 0}, _os = {d: 0, a: 0, l: 0, hw: 0}, _lw = {kind: 0, a: 0, hw: 0, edge: 0, s: 0, speed: 1, hold: 0}, RILL_K = .55, RILL_LEN = RILL.len[RILL.len.length - 1];
const travel = y => { const tab = S_TAB || travelTab(), f = (y - S_Y0) / S_DY, i = Math.min(tab.length - 2, f | 0); return tab[i] + (tab[i + 1] - tab[i]) * (f - i); };
// the outflow / pool: its travel falls by `ease(u)` metres over the u metres east of the river's bank (0 for the first OUT_U0 m, then eased in:
// continuous in value and slope, so it joins the river's own s without a seam); its axis's y at x (a linear lookup in OUTFLOW.pts, the ends held)
const OUT_U0 = .3, OUT_W = .6, ease = u => u <= OUT_U0 ? 0 : u < OUT_U0 + OUT_W ? (u - OUT_U0) ** 2 / (2 * OUT_W) : u - OUT_U0 - OUT_W / 2;
const outAxisY = x => { const P = OUTFLOW.pts, f = Math.max(0, Math.min(P.length - 1.001, (OUTFLOW.x0 - x) / OUTFLOW.dx)), i = f | 0; return P[i][1] + (P[i + 1][1] - P[i][1]) * (f - i); };
export function waterSample(x, y, out) {
  out.kind = 0;
  if (y < -1 || y > 31) return out;
  const c = STREAM.cx(y), hw = STREAM.w(y) / 2, a = x - c;
  if (a > hw) {   // beyond the east bank: the plateau's rill (on its top) or, south of its face, the pool and its outflow
    if (y < FALL.y) {
      if (x < RILL.x1 - .5 || x > 58 || y < 5.8 || !rillAt(x, y, _rs)) return out;
      const u = _rs.l / RILL_LEN, k = Math.max(0, Math.min(1, (u - .3) / .7));
      out.kind = 2; out.a = _rs.a; out.hw = _rs.hw; out.edge = _rs.hw - _rs.d; out.s = _rs.l * RILL_K; out.speed = .45 + 1.35 * k * k * (3 - 2 * k);
      out.hold = (Math.hypot(x - SPRING.x, y - SPRING.y) < SPRING.r || RILL.riffle(_rs.l, _rs.hw) || FALL.y - y < .1) ? 1 : 0;   // (the spring, the riffles, the lip's foam stay as painted)
      return out;
    }
    const inP = inPool(x, y), inO = outflowAt(x, y, _os);
    if (!inP && !inO) return out;
    const u = a - hw, v = Math.min(1, u / 3);   // u = metres east of the river's bank
    out.kind = 3; out.a = y - outAxisY(x); out.hw = inP ? Math.max(.55, inO ? _os.hw : 0) : _os.hw;
    out.edge = inP ? poolEdge(x, y) : _os.hw - _os.d; if (inP && inO && _os.hw - _os.d > out.edge) out.edge = _os.hw - _os.d;
    out.s = travel(y) - ease(u);
    out.speed = Math.max(.2, 1 - .8 * v * v * (3 - 2 * v));   // the river's pace at the bank, a slow churn in the pool
    out.hold = Math.hypot(x - FALL.foot.x, (y - FALL.foot.y) * 1.25) < .6 ? 1 : 0;   // the foam where the fall lands stays as painted
    return out;
  }
  if (a < -hw) return out;
  let hold = 0;
  for (let k = 0, st = STREAM.stones; k < st.length; k++) {
    const s = st[k], dx = x - s.x, dy = y - s.y;
    if (Math.hypot(dx, dy * 1.3) < s.r) return out;                                                 // the stone itself
    if ((dx / (s.r + .22)) ** 2 + ((dy - .05) / (s.r / 1.3 + .25)) ** 2 < 1) hold = 1;             // its foam ring and a hair more
  }
  out.kind = 1; out.a = a; out.hw = hw; out.edge = hw - Math.abs(a); out.hold = hold;
  out.s = travel(y);
  out.speed = 1 + .3 * (1 - (a / hw) ** 2);
  if (a > 0 && y > 11 && y < 13.4 && outflowAt(x, y, _os) && _os.hw - _os.d > out.edge) out.edge = _os.hw - _os.d;   // (the outflow's mouth: no bank here)
  return out;
}

// the water's tuning, per biome (setWaterLook hands it to the shader at every build). A biome without an entry has no
// moving water (the rift's crack: its flow speed is 0).
//   ramp      the four painted water tones, light -> dark, as the biome paints them: a painted texel counts as water only when
//             it matches one EXACTLY (stones, ice, foam rings of other colours, anything painted over the water stay as painted)
//   hold      tones that never move (a bank's shadow)        bank   texels from the bank where the 'streak' tone stays (the bright edge line)
//   streak    the tone the painter scatters over the interior as sparse streaks (-1 = none): the moving pattern replaces them
//   deep / shallow / deepFrac   the interior's base tone where the painter put 'streak' (|a| < deepFrac * hw is deep)
//   range     [lightest, darkest] tone the moving pattern uses       rate  texels per second the pattern travels at speed 1
//   across / along   the pattern's cell size in texels (thin streaks stretched along the flow); along is a divisor of 768
//   hi / lo   the light / dark share of the surface (the pattern's thresholds: lower = more)     lap  the lapping line's tone (-1 = none)
//   refl      how much the lanterns, mushrooms and wisps shine in it      spark  sun sparkles
export const WATER_TUNE = {
  ruins: {ramp: S => S.water.h, hold: [3], bank: 2, streak: 0, deep: 2, shallow: 1, deepFrac: .45, range: [0, 2], rate: 9, across: 2.5, along: 12, hi: .8, lo: .76, lap: 0, refl: 1, spark: 1},
  // lava: the crust's three colours drift slowly; the glowing seams (lava-coloured, in the emissive layer) stay put. (The first two
  // colours are literals in biomes.js groundEmber, not exposed by the style: keep them in step)
  ember: {ramp: S => ['#5a1a10', '#3a1410', S.crust], hold: [0], bank: 2, streak: -1, deep: 2, shallow: 2, deepFrac: 0, range: [1, 2], rate: 2.5, across: 5, along: 24, hi: .82, lo: .8, lap: -1, refl: 0, spark: 0},
  frost: {ramp: S => S.melt.h, hold: [3], bank: 2, streak: 1, deep: 2, shallow: 2, deepFrac: 0, range: [1, 2], rate: 4, across: 3, along: 16, hi: .86, lo: .8, lap: 1, refl: 1, spark: .5},
};

// ---------------------------------------------------------------- water: the texture
// One RGBA8 texel per ground texel (so the ground canvas's size), read NEAREST by SURF_FS with texelFetch:
//   R  bits 7-6 state: 0 dry and far from water; 1 dry beside water (a bank, a stone, ice: painted as it is); 2 water that
//                      stays as painted (the bank's shadow, the bright edge line, foam round a stone); 3 water that MOVES
//                      (state >= 2 is "water": SURF_FS writes tone 1 into the G-buffer and the composite lights it as water)
//      bits 5-4 the base tone, 0 light .. 3 dark (which of the ramp's colours the pattern starts from)
//      bits 3-0 the flow speed here in 1/8ths of the biome's rate (waterSample's speed)
//   G  bits 7-5 ring: texels from the bank (1 = the first texel .. 7; 0 = further in);  bits 4-0 = travel bits 12-8
//   B  travel bits 7-0: the travel coordinate s in 1/8 texel (13 bits: up to 1023 texels)
//   A  across the flow, signed texels from the axis in 1/2 texel, + 128 (clamped: +-63.5 texels, 2.08 m at PPM 30.5)
function bakeWater(biome, T, {WPX, HPX, PPM, px, cliffZ}) {
  const ramp = T.ramp(biome.style).map(hex255), N = WPX * HPX, data = new Uint8Array(N * 4), o = {kind: 0, a: 0, hw: 0, edge: 0, s: 0, speed: 1, hold: 0};
  const toneOf = k => { for (let t = 0; t < ramp.length; t++) if (px[k] === ramp[t][0] && px[k + 1] === ramp[t][1] && px[k + 2] === ramp[t][2]) return t; return -1; };
  for (let y = 0; y < HPX; y++) for (let x = 0; x < WPX; x++) {
    const mx = (x + .5) / PPM, my = (y + .5) / PPM;
    waterSample(mx, my, o);
    if (!o.kind || my >= cliffZ(mx)) continue;                  // (the ravine takes the stream over its edge: below it is the waterfall's pool)
    const i = y * WPX + x, k = i * 4, p = toneOf(i * 4);
    if (p < 0) continue;                                        // painted over: not (moving) water
    const ring = o.edge * PPM < 7 ? Math.max(1, Math.ceil(o.edge * PPM)) : 0;
    let state = 3, tone = p;
    if (T.hold.includes(p) || (p === T.streak && ring <= T.bank) || (o.hold && p === 0)) state = 2;
    else if (p === T.streak) tone = Math.abs(o.a) < T.deepFrac * o.hw ? T.deep : T.shallow;
    const s13 = Math.min(8191, Math.round(o.s * PPM * 8));
    data[k] = state << 6 | tone << 4 | (Math.round(Math.min(1.875, o.speed) * 8) & 15);
    data[k + 1] = ring << 5 | s13 >> 8; data[k + 2] = s13 & 255;
    data[k + 3] = Math.max(0, Math.min(255, Math.round(o.a * PPM * 2) + 128));
  }
  for (let y = 0; y < HPX; y++) for (let x = 0; x < WPX; x++) {   // dry texels beside water: SURF_FS blends across them when the camera turns
    const k = (y * WPX + x) * 4; if (data[k] >> 6) continue;
    for (let j = -1; j <= 1; j++) for (let l = -1; l <= 1; l++) {
      const u = x + l, v = y + j; if (u < 0 || v < 0 || u >= WPX || v >= HPX) continue;
      if (data[(v * WPX + u) * 4] >> 6 >= 2) { data[k] = 1 << 6; j = 2; break; }
    }
  }
  const tex = new THREE.DataTexture(data, WPX, HPX, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- fallen leaves: the density bake
// The ground shader (gfx.js SURF_FS) draws leaves from one RGBA8 map, a texel per LITTER.div x LITTER.div ground texels, read
// NEAREST: R = how thickly leaves lie here once the crowns are bare (0..1; the shader scales it by how much has fallen so far,
// gfx.js setGround, so this never changes with the season), G = which tree palette they came from (a row of the palette
// texture), B / A spare. It is baked from where the 3D trees stand and how big their crowns are, with presentation's only
// inputs (no sim state, no Math.random): a pool under each crown, drawn out DOWNWIND (the prevailing wind, west to east:
// features/wind.js W.dir), drifted against the walls and along the edges of the paths, never on water (waterSample) or over
// the ravine. A tree's leaves are the colours of its own autumn (shape.autumn: 4 stages of ['#light', '#base', '#shade'],
// trees3d.js; a tree without one drops RUST). Baked at the build and again when a tree joins the world (the garden's, the
// willows': it is marked dirty and the next update bakes once), never per frame
export const LITTER = {
  div: 2, groups: 8,
  wind: [.94, .34],                                   // where the wind blows toward (arena x east, y south)
  head: .9, tail: 2.0, side: 1.15, core: .55, edge: 1.5, // the pool in crown radii: upwind, downwind, across, solid core, where it ends
  peak: .5, willow: {r: 1.7, w: .75}, card: 1.6,     // the density under a crown, a willow's (radius x, weight: its leaves hang, they don't pile), a painted tree's radius (m)
  wall: [.6, 1.3], path: [.4, .7],                    // the drift against a wall: (reach m, extra density), along a path's edge
};
const RUST = [['#e0b04e', '#c88c34', '#9a6422'], ['#d28a3a', '#b4642a', '#86441c'], ['#b0602c', '#8a4420', '#62301a'], ['#7a5232', '#5e3c24', '#44291a']];
function makeLitter(WPX, HPX) {
  const W = Math.ceil(WPX / LITTER.div), H = Math.ceil(HPX / LITTER.div), N = W * H, G = LITTER.groups;
  const dt = (data, w, h) => { const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; return t; };
  const data = new Uint8Array(N * 4), pd = new Uint8Array(12 * G * 4);
  const L = {W, H, data, pd, tex: dt(data, W, H), pal: dt(pd, 12, G), keep: new Float32Array(N), best: new Float32Array(N), grp: new Uint8Array(N), bonus: new Float32Array(N), stats: {ms: 0, trees: 0, bakes: 0}};
  L.dispose = () => { L.tex.dispose(); L.pal.dispose(); };
  return L;
}
const segDist = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0; return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t); };
// trees: [{x, y, R (m), w, autumn}], walls: [[x0, y0, x1, y1]], paths: [{pts, w}], dry(x, y): not water, not over the ravine
function bakeLitter(L, trees, {WPX, HPX, PPM, walls, paths, dry}) {
  const t0 = performance.now(), {W, H, data, keep, best, grp, bonus} = L, sx = WPX / W / PPM, sy = HPX / H / PPM, [wx, wy] = LITTER.wind;
  keep.fill(1); best.fill(0); grp.fill(0); bonus.fill(1);
  // the palettes: group 0 is rust; each distinct autumn a tree brings takes the next row (distinct by its colours, not its array: every
  // shape of a species carries its own copy)
  const groups = [RUST], keys = new Map(), col = c => typeof c === 'string' ? hex255(c) : c.map(v => Math.round(v * 255));
  for (const t of trees) {
    let g = 0;
    if (t.autumn) {
      const key = JSON.stringify(t.autumn); g = keys.get(key);
      if (g === undefined) { g = groups.length < LITTER.groups ? groups.push(t.autumn) - 1 : 0; keys.set(key, g); }
    }
    t.g = g;
  }
  groups.forEach((st, g) => st.forEach((ramp, s) => ramp.forEach((c, k) => { const o = (g * 12 + s * 3 + k) * 4, rgb = col(c); L.pd[o] = rgb[0]; L.pd[o + 1] = rgb[1]; L.pd[o + 2] = rgb[2]; L.pd[o + 3] = 255; })));
  // a pool under each crown, drawn out downwind: the distance is measured in crown radii, stretched along the wind
  for (const t of trees) {
    const reach = t.R * LITTER.edge * Math.max(LITTER.tail, LITTER.head, LITTER.side), i0 = Math.max(0, Math.floor((t.x - reach) / sx)), i1 = Math.min(W - 1, Math.ceil((t.x + reach) / sx));
    const j0 = Math.max(0, Math.floor((t.y - reach) / sy)), j1 = Math.min(H - 1, Math.ceil((t.y + reach) / sy));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = (i + .5) * sx - t.x, dy = (j + .5) * sy - t.y, u = dx * wx + dy * wy, v = dy * wx - dx * wy;
      const ue = u / (t.R * (u >= 0 ? LITTER.tail : LITTER.head)), ve = v / (t.R * LITTER.side), q = Math.sqrt(ue * ue + ve * ve);
      if (q >= LITTER.edge) continue;
      const f = q <= LITTER.core ? 1 : 1 - smooth((q - LITTER.core) / (LITTER.edge - LITTER.core)), d = LITTER.peak * t.w * f, k = j * W + i;
      keep[k] *= 1 - d; if (d > best[k]) { best[k] = d; grp[k] = t.g; }
    }
  }
  // drifts: against a wall's foot, along the edge of a path (only where leaves lie at all: the density multiplies)
  const mark = (x0, y0, x1, y1, fn) => {   // the lit texels of a box in metres, each with its centre
    for (let j = Math.max(0, Math.floor(y0 / sy)); j <= Math.min(H - 1, Math.ceil(y1 / sy)); j++) for (let i = Math.max(0, Math.floor(x0 / sx)); i <= Math.min(W - 1, Math.ceil(x1 / sx)); i++) fn(j * W + i, (i + .5) * sx, (j + .5) * sy);
  };
  const [wr, wk] = LITTER.wall, [pr, pk] = LITTER.path;
  for (const r of walls) mark(r[0] - wr, r[1] - wr, r[2] + wr, r[3] + wr, (k, x, y) => {
    const d = Math.hypot(Math.max(r[0] - x, 0, x - r[2]), Math.max(r[1] - y, 0, y - r[3]));
    if (d < wr) bonus[k] = Math.max(bonus[k], 1 + wk * (1 - d / wr));
  });
  for (const P of paths) for (let s = 0; s + 1 < P.pts.length; s++) {
    const a = P.pts[s], b = P.pts[s + 1], m = P.w / 2 + pr + .1;
    mark(Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, (k, x, y) => {
      const e = Math.abs(segDist(x, y, a, b) - P.w / 2);
      if (e < pr) bonus[k] = Math.max(bonus[k], 1 + pk * (1 - e / pr));
    });
  }
  // the map: leaves lie in clumps (value noise at ~0.6 m and ~0.2 m), never on water or over the ravine
  for (let j = 0, k = 0; j < H; j++) for (let i = 0; i < W; i++, k++) {
    let D = 1 - keep[k];
    if (D > .004) {
      if (!dry((i + .5) * sx, (j + .5) * sy)) D = 0;
      else D = Math.min(.9, D * bonus[k] * (.3 + 1.4 * (vnoise(i / 9, j / 9, 3) * .6 + vnoise(i / 3.2, j / 3.2, 4) * .4)));
    } else D = 0;
    const o = k * 4; data[o] = Math.round(D * 255); data[o + 1] = grp[k]; data[o + 2] = 0; data[o + 3] = 255;
  }
  L.tex.needsUpdate = true; L.pal.needsUpdate = true;
  L.stats.ms = performance.now() - t0; L.stats.trees = trees.length; L.stats.bakes++;
}

// ---------------------------------------------------------------- strata texture for the plateau's faces
function strataCanvas(len, hgt, PPM, PPMH, rock, cov, seed) {
  const w = Math.max(1, Math.round(len * PPM)), h = Math.max(1, Math.round(hgt * PPMH)), c = document.createElement('canvas');
  c.width = w; c.height = h; const q = c.getContext('2d'), id = q.createImageData(w, h), d = id.data;
  for (let x = 0; x < w; x++) {
    const hang = cov ? (hsh(Math.floor(x / 6), seed) > .45 ? 1 + (hsh(x, 7, seed) * 4 | 0) : 1) : 0;
    for (let r = 0; r < h; r++) {
      let col;
      if (r < hang) col = cov[r === hang - 1 ? 2 : r ? 1 : 0];
      else {
        const ly = r + Math.round((hsh(Math.floor(x / 14), 94, seed) - .5) * 5), layer = Math.floor(ly / 9), inL = ((ly % 9) + 9) % 9;
        const crackX = hsh(Math.floor(x / 11), layer, 96 + seed) < .35 && x % 11 === (hsh(layer, Math.floor(x / 11), 97 + seed) * 11 | 0);
        const t = r === h - 1 ? 3 : inL === 0 ? (hsh(layer, 5, seed) < .5 ? 0 : 1) : inL >= 7 ? 2 : crackX ? 2 : hsh(layer, 9, seed) < .3 ? 2 : 1;
        col = rock[t];
      }
      const i = (r * w + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  q.putImageData(id, 0, 0); return c;
}

// ---------------------------------------------------------------- the waterfall on the plateau's south face (layout.js FALL)
// Where the rill goes over the lip: a sheet FALL.hw wide (a little wider at the foot) down the face into the pool. The face's texture
// is taller than the face: its last rows hang below the ground line down to the pool's surface (WATER_H), so nothing shows through
// where the ground is lowered; they are hidden under the ground everywhere else. The look per biome:
//   water  the biome's water colour, alpha FALL_ALPHA: SURF_FS streams light streaks down it and flickers the foam in the last 6 rows
//          (which are exactly the rows between the ground line and the pool); a foam lip, dark edge columns, static foam flecks
//   glow   a light fall (lava, arcane): alpha 250, the colours in the emissive layer, static streaks per column, a white-hot lip
//   ice    frozen: a painted curtain of icicles, static
const FALL_LOOK = {
  ruins: {mode: 'water', ramp: S => S.water.h},
  ember: {mode: 'glow', ramp: S => S.lava.h},
  frost: {mode: 'ice', ramp: S => S.ice.h},
  rift: {mode: 'glow', ramp: () => EMIT.rune.rift.map(h => '#' + h)},
};
function fallFace(cv, q, PPM, rock, look, ramp) {
  const rows = cv.height, per = q.h / rows, foot = Math.ceil(-WATER_H / per), H = rows + foot, W = cv.width, out = document.createElement('canvas');
  out.width = W; out.height = H; const g = out.getContext('2d', {willReadFrequently: true}); g.drawImage(cv, 0, 0);
  const id = g.getImageData(0, 0, W, H), d = id.data, put = (x, y, c, a = 255) => { const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a; };
  for (let y = rows; y < H; y++) for (let x = 0; x < W; x++) put(x, y, rock[3]);                       // the foot, below the ground line: dark, wet rock
  if (!look) { g.putImageData(id, 0, 0); return {cv: out, h: H * per}; }   // (a biome without a fall: the foot only)
  const col = (FALL.x - q.x0) / (q.x1 - q.x0) * W, hw = FALL.hw * PPM, C = ramp.map(hex255);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1), half = hw + 2.2 * t * t + (y > rows - 2 ? (hsh(y, 3) < .5 ? 1 : 0) : 0);   // spreads a little toward the foot
    for (let x = Math.floor(col - half - 1); x <= Math.ceil(col + half + 1); x++) {
      const dx = x + .5 - col, ad = Math.abs(dx); if (ad > half || x < 0 || x >= W) continue;
      const edge = ad > half - 1.2, lip = y < 2, foam = y >= rows - 4 && hsh(x, y, 5) < .55, streak = hsh(x, 17) < .3;
      if (look.mode === 'water') {
        const base = C[1], m = lip ? .5 : foam ? .72 : edge ? -.3 : streak ? .25 : 0, live = !lip && !foam && !edge;
        put(x, y, m >= 0 ? base.map(v => Math.round(v + (255 - v) * m)) : base.map(v => Math.round(v * (1 + m))), live ? FALL_ALPHA : 255);
      } else if (look.mode === 'glow') {
        const tone = lip ? 0 : edge ? 3 : foam ? (hsh(x, y, 6) < .5 ? 0 : 1) : hsh(x, 17) < .35 ? 0 : hsh(x, 18) < .5 ? 1 : 2;
        put(x, y, C[tone], edge ? 255 : 250);
      } else {   // ice: columns of light and shade, jagged at the sides, icicle tips at the foot
        const jag = hsh(Math.floor(x / 2), 7, 9) * 1.6, band = (y + Math.floor(hsh(x, 14) * 30)) % 21 < 2;   // (frozen ripples across the columns)
        const ice = ad > half - 1 - jag * .6 ? 2 : lip ? 0 : hsh(x, 11) < .3 ? 0 : hsh(x, 12) < .2 ? 2 : band ? 0 : 1;
        if (y > H - 1 - Math.floor(hsh(x, 13) * 4) && ad < half - 1.5) continue;   // the icicles end in points (a few rows above the pool)
        put(x, y, ad > half - .8 ? C[3] : C[ice]);
      }
    }
  }
  g.putImageData(id, 0, 0);
  return {cv: out, h: H * per};
}

// ---------------------------------------------------------------- build
const POOL_GROW = .25;   // the ground mesh (.25 m cells) is lowered this far (m) beyond the pool's painted edge, so the painted outline is the drawn one
export async function buildWorld(G, {biome, ctxO, PPM, PPMH, props: keep = null, trees3d = true}) {
  GT = G;
  // keep: the live prop list of the previous world (a biome switch): the items must point at the props gameplay uses
  const {WM, HM} = WORLD, layout = buildLayout(7);
  if (keep) layout.props = keep;
  const props = layout.props;
  Object.assign(ctxO, {WM, HM, WPX: Math.ceil(WM * ctxO.PPM), HPX: Math.ceil(HM * ctxO.PPMY), PLAY, layout});
  const disposers = [];
  const R = rampTexture(biome.id, biome.style);
  G.U.ramps.value = R.tex; G.U.cover.value.set(...R.cover); G.U.emitFam.value.set(...R.emitFam);
  if (G.compU.uSoftFam) G.compU.uSoftFam.value = FAMS.indexOf('leaf');   // a crown's clumps meet in tone, not in lines

  // ---- ground: the biome's painter, top-down
  const WPX = Math.ceil(WM * PPM), HPX = Math.ceil(HM * PPM);
  const ctxT = {PPM, PPMY: PPM, PPMH: 0, toS: (x, y) => [x * PPM, y * PPM], WM, HM, WPX, HPX, PLAY, layout, VW: G.VW, VH: G.VH};
  const gc = document.createElement('canvas'); gc.width = WPX; gc.height = HPX;
  const gq = gc.getContext('2d', {willReadFrequently: true});
  biome.paintGround(gq, ctxT);
  const groundEmit = biome.groundEmit, groundLights = (biome.groundLights || []).slice();
  const gTex = texOf(gc, true), eTex = groundEmit ? texOf(groundEmit, true) : null;
  // the ground's pixels (the waterfall takes the stream's painted colour at the edge)
  const px = gq.getImageData(0, 0, WPX, HPX).data;
  // the grid runs SKIRT m past the world on every side (edge texels stretched outward): the camera keeps the flat
  // ground inside the world, but lowered ground (the south ravine) projects further down the screen than that
  const S = .25, SKIRT = 6, NX = Math.round((WM + 2 * SKIRT) / S), NZ = Math.round((HM + 2 * SKIRT) / S), DROP = -3.5;
  // the south edge, as the biome itself defines it: ruins and ember end in a RAVINE along their cliff line (the biome's
  // hole() is y > cliff(x) - .3 there, or near the stream); frost ends in a flat frozen lake and the rift in its flat void,
  // so they keep their ground. Inside the stream's band the line is interpolated from both banks (the waterfall)
  const RAVINE = new Set(['ruins', 'ember']).has(biome.id);
  const nearStream = (x, y) => Math.abs(x - STREAM.cx(y)) - STREAM.w(y) / 2 < .7;
  const rawCliff = x => { for (let y = HM - 7; y < HM + .5; y += .05) if (biome.hole?.(x, y) && !nearStream(x, y)) return y + .3; return Infinity; };
  const cliffCache = new Map();
  const cliffZ = x => {
    if (!RAVINE) return Infinity;
    const k = Math.round(x * 8); let c = cliffCache.get(k); if (c !== undefined) return c;
    const ys = HM - 2.4, hw = STREAM.w(ys) / 2 + .7, sc = STREAM.cx(ys);
    if (Math.abs(x - sc) < hw) {   // the banks a little outside the band (the stream meanders: right on its edge it's still "near")
      let a = rawCliff(sc - hw - .4), b = rawCliff(sc + hw + .4);
      if (!isFinite(a)) a = b; if (!isFinite(b)) b = a; if (!isFinite(a)) a = b = HM - 2.2;
      c = a + (b - a) * (x - (sc - hw)) / (2 * hw);
    } else c = rawCliff(x);
    cliffCache.set(k, c); return c;
  };
  const hAt = (x, z) => z >= cliffZ(x) ? DROP : inStream(x, z) || inPool(x, z, .01, POOL_GROW) ? WATER_H : 0;   // (the pool's vertices, those ON the plateau's south face too, are lowered: the face goes down to the water)
  // the grid follows the edge exactly: the last bank vertex of each column moves onto the edge line and the next one
  // to just past it at the ravine's depth, so the wall is one smooth face (a plain 0.25 m grid made it a staircase)
  const pos = [], uv = [];
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    const x = i * S - SKIRT; let z = j * S - SKIRT, h;
    const cz = cliffZ(x);
    if (z <= cz && z + S > cz) { z = cz - .001; h = inStream(x, z) ? WATER_H : 0; }   // the lip
    else if (z > cz && z - S <= cz) { z = cz + .02; h = DROP; }                       // the foot
    else h = hAt(x, z);
    pos.push(x, h, z); uv.push(x / WM, z / HM);
  }
  const idx = [];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const gGeo = new THREE.BufferGeometry(); gGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  gGeo.setIndex(idx); gGeo.computeVertexNormals();
  const world2 = new THREE.Vector2(WM, HM);
  // the south ravine's wall (any steep ground): rock strata with the biome's grass / ash / snow lip, and a WATERFALL where
  // the stream goes over the edge, in the stream's own painted colour (streaks, dark edges, foam at the foot). Indexed by
  // world x (+ SKIRT) and depth below the bank: the ground shader maps it onto the steep cells (gfx.js SURF_FS)
  const CL_H = 3.5, cliff = strataCanvas(WM + 2 * SKIRT, CL_H, PPM, PPMH, R.rock, R.cov, 11);
  {
    const q = cliff.getContext('2d', {willReadFrequently: true}), id = q.getImageData(0, 0, cliff.width, cliff.height), d = id.data, CH = cliff.height;
    // where the stream glows (ember lava: the ground's emit layer), its fall glows too: alpha 250 marks emissive texels.
    // A fall of WATER carries alpha FALL_ALPHA (252): SURF_FS streams its streaks down in stepped time and flickers the foam
    // at the foot, from the baked colour (dark edge columns and the lip stay as painted). Any face texture can use the marker
    const ge = groundEmit ? groundEmit.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, groundEmit.width, groundEmit.height).data : null;
    const edgeZ = x => { for (let z = HM - 7; z < HM + SKIRT; z += .05) if (hAt(x, z) < -1) return z; return null; };
    for (let cx = 0; cx < cliff.width; cx++) {
      const x = cx / PPM - SKIRT, ze = edgeZ(x); if (ze === null) continue;
      const zs = ze - .35, off = Math.abs(x - STREAM.cx(zs)) - STREAM.w(zs) / 2;
      if (off > 0) continue;
      const at = z => (Math.min(HPX - 1, Math.max(0, Math.round(z * PPM))) * WPX + Math.min(WPX - 1, Math.max(0, Math.round(x * PPM)))) * 4;
      let gi = at(zs), glows = false;
      if (ge) for (let z = zs - .6; z <= zs; z += 1 / PPM) {   // a glowing stream (lava): its brightest molten pixel near the edge
        const k = at(z); if (ge[k + 3] > 0) glows = true;
        if (px[k] * .3 + px[k + 1] * .55 + px[k + 2] * .15 > px[gi] * .3 + px[gi + 1] * .55 + px[gi + 2] * .15) gi = k;
      }
      if (!glows) gi = at(zs);
      const base = [px[gi], px[gi + 1], px[gi + 2]], edge = off > -.08, streak = hsh(cx, 17) < .3;
      for (let r = 0; r < CH; r++) {
        const k = (r * cliff.width + cx) * 4, foam = r > CH - 6 && hsh(cx, r) < .6, lip = r < 2;
        const live = !glows && !edge && !lip;   // a sheet of falling water: the shader adds the moving streaks and the foam
        const m = live ? 0 : foam ? .7 : lip ? .45 : edge ? -.3 : streak ? .3 : 0;   // + toward white, - darker
        for (let c = 0; c < 3; c++) d[k + c] = m >= 0 ? base[c] + (255 - base[c]) * m : base[c] * (1 + m);
        d[k + 3] = glows && !edge ? 250 : live ? FALL_ALPHA : 255;
      }
    }
    q.putImageData(id, 0, 0);
  }
  const cTex = texOf(cliff); cTex.wrapS = cTex.wrapT = THREE.RepeatWrapping; cTex.needsUpdate = true;
  // the moving water: the baked texture (rebuilt, and the old one disposed, with the world) + the biome's look for the shader
  const WT = WATER_TUNE[biome.id], wTex = WT ? bakeWater(biome, WT, {WPX, HPX, PPM, px, cliffZ}) : null;
  if (wTex) disposers.push(() => wTex.dispose());
  G.setWaterLook(WT ? {ramp: WT.ramp(biome.style).map(h => rgbOf(h)), rate: WT.rate, across: WT.across, along: WT.along, hi: WT.hi, lo: WT.lo, range: WT.range, lap: WT.lap, refl: WT.refl, spark: WT.spark} : null);
  // fallen leaves: the density map (empty until bakeLitter below); only where the biome turns with the seasons
  const lit = biome.id === 'ruins' ? makeLitter(WPX, HPX) : null;
  if (lit) disposers.push(lit.dispose);
  const ground = G.surface(gGeo, {tex: gTex, em: eTex, planar: true, world: world2, type: 1, obj: 0, cliff: cTex, cliffOff: SKIRT, water: wTex, litter: lit}, false); disposers.push(() => ground.dispose());

  // ---- plateau: top (the painted top, planar) + 4 strata faces
  const FL = FALL_LOOK[biome.id];
  for (const q of PLATEAUS) {
    const top = new THREE.PlaneGeometry(q.x1 - q.x0, q.y1 - q.y0); top.rotateX(-Math.PI / 2); top.translate((q.x0 + q.x1) / 2, q.h, (q.y0 + q.y1) / 2);
    const t = G.surface(top, {tex: gTex, em: eTex, planar: true, world: world2, type: 1, obj: 1, water: wTex, litter: lit}); disposers.push(() => t.dispose());   // (water on the plateau's top too: the rill moves; so do the leaves)
    const faces = [   // [len, centre x, centre z, rotation y]
      [q.x1 - q.x0, (q.x0 + q.x1) / 2, q.y1, 0], [q.x1 - q.x0, (q.x0 + q.x1) / 2, q.y0, Math.PI],
      [q.y1 - q.y0, q.x1, (q.y0 + q.y1) / 2, Math.PI / 2], [q.y1 - q.y0, q.x0, (q.y0 + q.y1) / 2, -Math.PI / 2]];
    faces.forEach(([len, cx, cz, ry], k) => {
      let cvs = strataCanvas(len, q.h, PPM, PPMH, R.rock, R.cov, k + 2), hgt = q.h;
      if (k === 0 && q === PLATEAUS[0]) ({cv: cvs, h: hgt} = fallFace(cvs, q, PPM, R.rock, FL, FL?.ramp(biome.style)));   // the south face: the waterfall, and the foot down to the pool
      const geo = new THREE.PlaneGeometry(len, hgt); geo.translate(0, q.h - hgt / 2, 0); geo.rotateY(ry); geo.translate(cx, 0, cz);
      const uvA = geo.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setY(i, 1 - uvA.getY(i));   // canvas rows go down
      const tex = texOf(cvs, true);
      const f = G.surface(geo, {tex, planar: false, type: 5, obj: 1}); disposers.push(() => f.dispose());
    });
  }

  // ---- props
  const loader = new GLTFLoader(), haveGlb = !!(await loadGlbIndex());
  let yawIdx = null, yawAlb = null, yawNrm = null;
  try {
    yawIdx = await fetch(YAW + 'props.json').then(r => r.ok ? r.json() : null);
    if (yawIdx) [yawAlb, yawNrm] = await Promise.all([loadImg(YAW + `props_${biome.id}.png`), loadImg(YAW + 'props_nrm.png')]);
  } catch { yawIdx = null; }
  const groundL = groundLights.map((l, i) => ({x: l.x, y: l.h || 0, z: l.y, c: rgbOf(l.color), r: l.radius || 3, k: l.intensity ?? 1, flicker: l.flicker || 0, id: 9000 + i}));
  const lights = [];   // rebuilt every frame by sync(): ground lights + whatever the props' current sprites carry
  // ITEMS: one per prop. {p, st (model state), obj (id), live (G.mesh) | card (G.card), sp (painted sprite shown), yaw?,
  //   manageMatrix (a feature poses the mesh itself), hover (0..1 pulse set by the host)}
  const items = [], byProp = new Map(), extra = new Set();
  let litterDirty = false;   // fallen leaves: a tree joined or left (bakeNow, below)
  let nextId = 10;
  const SHADOWLESS = new Set(['tuft', 'reed', 'fern']);
  if (haveGlb) await Promise.all([...new Set(props.map(stateOf).filter(Boolean))].map(s => glbGeometry(loader, s)));   // all at once
  const cardOf = (sp, o) => G.card({tex: texOf(sp.img), em: sp.emit ? texOf(sp.emit) : null, w: sp.img.width, h: sp.img.height, px: sp.pivot[0], py: sp.pivot[1], type: 3, bias: .00125, ...o});
  // a plant's autumn (gfx.js CARD_FS): the biome's style.plantAutumn gives each kind a few PATHS (four stages of colour, biomes.js).
  // A plant takes one by the golden ratio in the order the world creates them (twelve bushes are spread over the paths instead of
  // twelve dice: some crimson, some orange, most yellow, a straggler or two) and starts at a delay of its own; where its patches
  // are comes from its position. Deterministic, no Math.random. null = a kind with no autumn here (the card is as painted)
  const PLANT_KIND = {bush: 1, tuft: 2, fern: 3, reed: 4}, plantN = {}, palOf = new Map();
  const plantOf = p => {
    const PA = biome.style.plantAutumn?.[p.kind]; if (!PA) return null;
    const n = plantN[p.kind] = (plantN[p.kind] ?? -1) + 1, u = (.17 + n * .6180339887) % 1;
    let i = 0, acc = PA.paths[0].w; while (i < PA.paths.length - 1 && u >= acc) acc += PA.paths[++i].w;
    const P = PA.paths[i], A = PA.paths[P.alt ?? i], key = P.name + '|' + A.name + '|' + p.kind;
    let pal = palOf.get(key); if (!pal) palOf.set(key, pal = [P, A].flatMap(q => q.stages.flatMap(st => st.map(hex01))));
    return {kind: PLANT_KIND[p.kind], seed: hsh(p.x, p.y, 5), delay: P.delay[0] + (P.delay[1] - P.delay[0]) * hsh(p.y, p.x, 9), ramp: biome.style[PA.ramp].h.map(hex01), pal};
  };
  // procedural trees (trees3d.js): a live mesh instead of the painted card, turned and scaled per tree (it.pose)
  const famOf = name => Math.max(0, FAMS.indexOf(name));
  const treeOf = p => trees3d && p.kind === 'tree' && !p.painted ? treeModel(p, biome.id, famOf) : null;
  const placeOf = (it, x, h, z, M) => it.pose ? M.makeRotationY(it.pose.yaw).scale(_scl.setScalar(it.pose.scale)).setPosition(x, h, z) : M.makeTranslation(x, h, z);
  // a crown overhangs: in the top-down height map it would stand as a solid pillar and black out the light under it
  // (props cast into the cached static sun shadow, gfx mesh {static}; the swaying 3D trees cast every frame). A tree brings its
  // autumn ramps (trees3d.js B.autumn): its crown turns spray by spray with the season (gfx.js MESH_FS)
  const liveOf = (it, geo, x, h, z) => { const m = G.mesh(geo, it.obj, placeOf(it, x, h, z, new THREE.Matrix4()), {sway: !!it.pose, static: !it.pose, autumn: it.pose?.autumn}); if (it.pose) m.sm.layers.disable(1); return m; };
  for (const p of props) {
    const z0 = p.z || 0;
    if (p.outside && biome.hole?.(p.x, p.y, ctxO)) continue;   // over the ravine / in the stream
    const sp = biome.sprite(p, ctxO);
    const tm = treeOf(p), st = stateOf(p), geo = tm ? tm.geo : st && haveGlb ? await glbGeometry(loader, st) : null;
    const obj = WALL_ID[p.kind] ?? nextId++;
    const it = {p, st, obj, sp: null, hover: 0, pose: tm};
    if (geo) {
      it.live = liveOf(it, geo, p.x, z0, p.y);
      const yw = yawIdx && yawOf(p, st);
      if (yw && yawIdx.frames[yw[0] + '_y0']) {
        it.yaw = {base: yw[0], off: yw[1], card: G.card({tex: texOf(yawAlb), nrm: texOf(yawNrm), w: 1, h: 1, px: 0, py: 0, type: 7, obj, bias: .00125})};
        it.yaw.card.anchor = new THREE.Vector3(p.x, z0, p.y); it.yaw.card.setVisible(false);
      }
    } else if (sp) {
      it.card = cardOf(sp, {obj, shadow: !SHADOWLESS.has(p.kind), plant: plantOf(p)}); it.sp = sp;
      it.card.anchor = new THREE.Vector3(p.x, z0, p.y);
    } else continue;
    items.push(it); byProp.set(p, it);
  }
  disposers.push(() => items.forEach(it => { it.live?.dispose(); it.card?.dispose(); it.yaw?.card.dispose(); }));
  // the later stages (damaged, broken, chest lids, debris chunks) load in the background
  if (haveGlb) loadGlbIndex().then(ix => ix && Object.keys(ix.states).forEach(s => glbGeometry(loader, s)));
  // an item for a prop created later (a feature adds props to world.props: extra crates, respawns)
  async function addItem(p) {
    if (byProp.has(p)) return byProp.get(p);
    const tm = treeOf(p), st = stateOf(p), geo = tm ? tm.geo : st && haveGlb ? await glbGeometry(loader, st) : null, sp = biome.sprite(p, ctxO), obj = nextId++;
    if (p.dead || byProp.has(p)) return byProp.get(p) || null;   // gone (or added) while the model loaded
    const it = {p, st, obj, sp: null, hover: 0, pose: tm};
    if (geo) it.live = liveOf(it, geo, p.x, p.z || 0, p.y);
    else if (sp) { it.card = cardOf(sp, {obj, shadow: !SHADOWLESS.has(p.kind), plant: plantOf(p)}); it.sp = sp; } else return null;
    items.push(it); byProp.set(p, it); if (p.kind === 'tree') litterDirty = true; return it;
  }
  // a prop that leaves the world for good (a killed enemy): its card / mesh go with it
  function removeItem(p) {
    const it = byProp.get(p); if (!it) return;
    it.live?.dispose(); it.card?.dispose(); it.yaw?.card.dispose();
    items.splice(items.indexOf(it), 1); byProp.delete(p); if (p.kind === 'tree') litterDirty = true;
  }
  // fallen leaves (LITTER): the trees as the bake wants them (a 3D tree's crown, rotated and scaled as it stands; a painted one's guess;
  // a dead tree none), and the bake itself. A tree that joined or left marks it dirty: update() bakes once before the next draw
  function bakeNow() {
    litterDirty = false; if (!lit) return;
    const trees = [], walls = [], dead = p => (p.variant | 0) === 2;
    for (const it of items) {
      const p = it.p;
      if (p.rect) walls.push(p.rect);
      if (p.kind !== 'tree' || p.gone) continue;
      const w = it.pose;
      if (w) {
        const c = w.crown; if (!c) continue;
        const co = Math.cos(w.yaw), si = Math.sin(w.yaw), wl = w.species === 'willow';
        trees.push({x: p.x + (c.x * co + c.z * si) * w.scale, y: p.y + (c.z * co - c.x * si) * w.scale, R: c.r * w.scale * (wl ? LITTER.willow.r : 1.2), w: wl ? LITTER.willow.w : 1, autumn: w.autumn});
      } else if (it.card && !dead(p)) trees.push({x: p.x, y: p.y, R: (p.variant | 0) === 3 ? LITTER.willow.r * 1.15 : LITTER.card, w: 1, autumn: null});
    }
    const paths = layout.marks.filter(m => m.type === 'path');
    bakeLitter(lit, trees, {WPX, HPX, PPM, walls, paths, dry: (x, y) => { if (y >= cliffZ(x)) return false; waterSample(x, y, _lw); return !_lw.kind; }});
  }
  function setState(it, st) {
    it.st = st;
    glbGeometry(loader, st).then(geo => { if (geo && it.st === st) it.live.setGeometry(geo); });
  }

  // prop display mode: live 3D meshes, or the 16-yaw pre-renders where they exist (A/B reference)
  let mode = 'live';
  const step = Math.PI / 8;
  function setMode(m) { mode = m; }
  // hooks for features: card(it, sp) -> {sway (px at the top), em (a live emit canvas, re-uploaded every frame)} | null
  //   mesh(it) -> {x, y (the lean at the top, metres, arena axes), shake (art px along the screen's x), flut (art px: the
  //   leaf clumps' own dance), wx, wy (the wind's direction, arena axes), ph (rad), wave (tone bias)} | null: 3D trees
  const hooks = {card: null, mesh: null};
  const M = new THREE.Matrix4();
  // a 3D tree's lean on screen: art px (x right, y toward the camera), held until it moves TREE_HYST px (no 1 px flicker
  // at a threshold, like the cards' hysteresis); the shader rounds it per vertex by the baked weights. The leaves dance on
  // top of it (each clump on its own phase) and a band of light rolls through them along the wind (RIP_K: ~4 m waves)
  const TREE_HYST = .5, RIP_K = 3.2;   // ~2 m light waves: two or three bands across a crown, not the whole crown blinking
  function leanTree(it, yaw) {
    const L = hooks.mesh?.(it), d = it.lean ||= {x: 0, y: 0};
    let sx = 0, sy = 0;
    if (L) { const c = Math.cos(yaw), s = Math.sin(yaw); sx = (L.x * c - L.y * s) * PPM; sy = (L.x * s + L.y * c) * ctxO.PPMY; }
    if (!L || Math.hypot(sx - d.x, sy - d.y) > TREE_HYST) { d.x = sx; d.y = sy; }
    it.live.setLean(d.x + (L?.shake || 0), d.y);
    const f = L?.flut || 0; it.live.setFlutter?.(f, f * .5);
    it.live.setRipple?.((L?.wx || 0) * RIP_K, (L?.wy || 0) * RIP_K, L?.ph || 0, L?.wave || 0);
  }
  // every frame: follow the props (stage, lid, hop, wobble, flash, gone), collect their lights, pick the yaw frames
  function update(yaw) {
    if (litterDirty) bakeNow();
    lights.length = 0; for (const l of groundL) lights.push(l);
    const k0 = -Math.round(yaw / step);
    for (const it of items) {
      const p = it.p, base = p.z || 0, z0 = base + (p.h || 0);
      const sp = biome.sprite(p, ctxO);
      if (sp?.lights) {   // the sprite's lights: records built when the sprite changes, only their positions move per frame
        if (it.lsp !== sp) { it.lsp = sp; it.lrec = sp.lights.map((l, i) => ({x: 0, y: 0, z: 0, c: rgbOf(l.color), r: l.radius || 4, k: l.intensity ?? 1, flicker: l.flicker || 0, id: it.obj * 8 + i, l})); }
        for (const o of it.lrec) { o.x = p.x + (o.l.dx || 0); o.y = base + (o.l.h || 0); o.z = p.y + (o.l.dy || 0); lights.push(o); }
      }
      const wob = p.wob ? Math.round(Math.sin(p.wob * 18) * p.wob * 2) : 0, flash = Math.min(1, Math.max(p.flash || 0, it.hover || 0));
      const useYaw = mode === 'yaw' && it.yaw && !p.stage && !it.manageMatrix && !p.gone;
      if (it.live) {
        const st = stateOf(p); if (st && st !== it.st) setState(it, st);
        if (!it.manageMatrix) it.live.setMatrix(placeOf(it, p.x + wob / PPM, z0, p.y, M));
        if (it.pose) leanTree(it, yaw);
        it.live.setVisible(!p.gone && !useYaw); it.live.flash = flash;
      }
      if (it.yaw) {
        it.yaw.card.setVisible(!!useYaw);
        if (useYaw && yawIdx) {
          const k = (((k0 + it.yaw.off) % 16) + 16) % 16, f = yawIdx.frames[`${it.yaw.base}_y${k}`];
          if (f) {
            const AW = yawIdx.size[0], AH = yawIdx.size[1], u = it.yaw.card.u, r = [f[0] / AW, f[1] / AH, f[2] / AW, f[3] / AH];
            u.uRect.value.set(...r); it.yaw.card.g.uniforms.uNrmRect.value.set(...r); u.uSize.value.set(f[2], f[3]); u.uPivot.value.set(f[4], f[5]);
            u.uAnchor.value.set(p.x, z0, p.y); it.yaw.card.flash = flash;
          }
        }
      }
      if (it.card) {
        if (sp && sp !== it.sp) { it.sp = sp; it.card.setSprite({tex: texOf(sp.img), em: sp.emit ? texOf(sp.emit) : null, w: sp.img.width, h: sp.img.height, px: sp.pivot[0], py: sp.pivot[1]}); }
        const u = it.card.u; u.uAnchor.value.set(p.x, z0, p.y); u.uOff.value.set(wob, 0);
        const hk = hooks.card?.(it, sp);
        u.uSway.value = hk?.sway || 0;
        if (hk?.bend) { it.card.g.uniforms.uBend.value = hk.bend; u.uHasBend.value = 1; } else u.uHasBend.value = 0;   // per-row flex (8 weights, bottom -> top)
        if (hk?.em) { it.card.g.uniforms.uEm.value = G.tex(hk.em, {dynamic: true}); it.card.g.uniforms.uHasEm.value = 1; it.emSp = null; }
        else if (it.sp && it.emSp !== it.sp) { it.emSp = it.sp; it.card.g.uniforms.uEm.value = it.sp.emit ? texOf(it.sp.emit) : null; it.card.g.uniforms.uHasEm.value = it.sp.emit ? 1 : 0; }
        it.card.flash = flash; it.card.setVisible(!p.gone && !!sp);
      }
    }
  }
  const yawCount = items.filter(it => it.yaw).length, liveCount = items.filter(it => it.live).length, cardCount = items.filter(it => it.card).length;
  litterDirty = true;   // (the first bake: the trees are all here)
  return {layout, props, lights, items, litter: lit && lit.stats, markLitter() { litterDirty = true; },   // markLitter: re-bake the fallen leaves (a tree's palette changed)
    setMode, update, hooks, addItem, removeItem, get mode() { return mode; }, yawCount, liveCount, cardCount, haveGlb, groundCanvas: gc, trees3d,
    itemOf: p => byProp.get(p) || null,
    // repaint one family of the ramp texture: r4 = 4 tones, rgb 0..1, light -> dark (+ the line / outline tones derived as
    // ramp6 does). The seasons' leaves (sim/env.js leafRamp); call it on change, not per frame
    setFamily(name, r4) {
      const j = FAMS.indexOf(name), d = R.tex.image.data; if (j < 0) return;
      const r = r4.map(c => c.map(v => Math.round(v * 255))), six = [r[0], r[1], r[2], mix(r[3], r[2], .25), r[3], r[2]];
      for (let i = 0; i < 6; i++) d.set(six[i], (j * 6 + i) * 4);
      R.tex.needsUpdate = true;
    },
    // an arrow's step (arena coords) against the 3D trees' trunks and big limbs -> {x, y, h, prop} where it sticks | null.
    // A 3D tree stops arrows only there (its round collider is for walking; the crown lets arrows through)
    treeHit(x0, y0, h0, x1, y1, h1) {
      for (const it of items) {
        const p = it.p; if (!it.pose || !it.live || p.gone || Math.abs(p.x - x1) > 3 || Math.abs(p.y - y1) > 3) continue;
        const q = boneHit({x: p.x, y: p.y, z: p.z || 0, pose: it.pose}, x0, y0, h0, x1, y1, h1); if (q) { q.prop = p; return q; }
      }
      return null;
    },
    glb: state => glbGeometry(loader, state),                   // Promise<geometry | null> (debris chunks, ...)
    // an extra live mesh owned by a feature (debris chunks): dispose it when done; a rebuild (biome switch) disposes the rest.
    // It doesn't block point lights unless o.occlude (tumbling chunks next to a blast threw black spikes everywhere)
    mesh: (geo, matrix, o = {}) => {
      const m = G.mesh(geo, nextId++, matrix || new THREE.Matrix4()), d = m.dispose; extra.add(m); m.dispose = () => { extra.delete(m); d(); };
      if (!o.occlude) m.sm.layers.disable(1);
      return m;
    },
    waterH: WATER_H, biome, ctxO, dispose() { disposers.forEach(f => f()); [...extra].forEach(m => m.dispose()); }};
}
export {WORLD, PLAY, TRAIL, elev, inStream, PLATEAUS, SPRING, RILL, FALL, POOL, OUTFLOW, inPool, poolEdge, rillAt, inRill, outflowAt, inOutflow};
