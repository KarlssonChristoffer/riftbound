// WORLD: the Proving Grounds rebuilt as a 3D scene for the HD-2D test, from the arena's own data.
//   ground   the biome's painter, run TOP-DOWN (the same code with PPMY = PPM and PPMH = 0), on a height grid: the stream
//            bed sits lower, the south ravine drops away. Painted over the Proving Grounds (layout GROUNDS); a bigger world's
//            open land round them is a grid of tiles with a stand-in texture (the world plan: step 3 paints it)
//   plateau  a real block: its painted top, rock-strata faces
//   props    live 3D meshes (Blender prop kit -> glb, toned on the GPU with the pixelizer's ramps and rules) or, for the
//            A/B test, the same props pre-rendered at 16 yaws (cards); trees are grown in the browser (trees3d.js: the
//            biomes it has species for; trees3d: false = the painted cards); the low plants too (bushes, ferns, tufts, reeds:
//            world/flora3d.js, drawn instanced by render/flora.js; ?flora=cards: the cards); everything else the kit doesn't
//            model (braziers, torches) stays a painted billboard card; the dummy and the crystal are
//            procedural meshes (world/props3d.js; ?props2d=1: their cards), the brutes 3D figures (features/brutes3d.js)
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
//            What lies UNDER it (the bed, the depth bands, the contact foam: the clear shallows and the dark deep): world/waterbed.js,
//            baked with the water texture (bakeWater); ?water=0 leaves it out.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {WORLD, GROUNDS, WEST_ON, WEST, WEST_LAND, PLAY, TRAIL, walkable, roamable, navArea, buildLayout, elev, inStream, PLATEAUS, STREAM, SPRING, RILL, FALL, POOL, OUTFLOW, inPool, poolEdge, rillAt, inRill, outflowAt, inOutflow, steep, TERRAIN_ON, terrainField, onGround, sameLevel, TERRAIN, MESA, CLIMBS, CASCADES, mesaAt, groundDrawn, CLEFTS, cleftWall, inCleft, BRIDGES} from './layout.js';
import {treeModel, boneHit} from './trees3d.js';
import {floraShapes, bladeRamps} from './flora3d.js';   // the low plants in 3D (the true-3D pivot): bushes, ferns, tufts, reeds
import {createFlora} from '../render/flora.js';
import {cliffGeometry} from './cliffs3d.js';
import {wallRun, towerRun, postRun} from './walls3d.js';
import {stoneMeshes, LIGHTS as STONE_LIGHTS} from './stonecircle.js';   // the West Downs' standing stones
import {watchtowerRun, colTop} from './watchtower.js';   // the West Downs' watchtower
import {TOWER_PLAN} from './layout.js';
import {stepsOf} from './terrain.js';
import {waterBed} from './waterbed.js';
import {BROOK, sample as brookSample, depth as brookDepth, fallOff as brookFallOff, inBrookPool} from './brook.js';   // the West Downs' brook
import {bridgeGeometry} from './bridge3d.js';
import {propModel} from './props3d.js';   // the true-3D props: the dummy and the crystal as live meshes (?props2d=1: their cards)
import {rgbOf, hexRaw255 as hexrgb, hex255, hex01} from '../core/color.js';
import {vnoise, smooth, hypot2, clearArray} from '../core/mathx.js';
import {flags} from '../core/flags.js';

export const WATER_H = -.18;
const FLORA = flags.get('flora') !== 'cards';   // the low plants as 3D shapes drawn instanced (world/flora3d.js, render/flora.js); cards: the painted cards   // the stream bed sits this much below the ground (features: world.waterH)
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
  // world/desert.js: sun-bleached wood, rusted iron, terracotta, sandstone, red rock, sand drifted on the tops
  desert: {wood: ['c4ab88', 'a2896a', '7f684f', '504131'], metal: ['a87c54', '83603f', '5e442e', '38281b'], clay: ['d68c5c', 'b46c40', '8a502e', '58321e'],
    stone: ['d6b88e', 'bc9c72', '9c7e58', '6a5440'], rock: ['c97e5c', 'ab6246', '874a36', '562c22'], rope: ['dcc890', 'bea872', '988456', '625438'],
    cover: ['ead4a4', 'dcc08c', 'c2a272', '90724e'], coverK: .1, coverT: .86, rockB: ['d89a70', 'be7e58', '9a6244', '643e2c']},   // (rockB: banded cliffs)
};
// the cool palette (the default; ?palette=old, biomes.js): the ruins' props in mauve-grey stone and rock, a yellow-green moss
if (flags.get('palette') !== 'old') Object.assign(PAL.ruins, {stone: ['a39ba2', '878088', '6b656f', '47424c'], rock: ['827a83', '6a636d', '544e58', '38343d'],
  cover: ['8aa866', '6c8b50', '536e42', '3a5036']});
const EMIT = {rune: {rift: ['ffe0fa', 'ff8ae8', 'c85ad8', '8a4ad8']}, crack: {ember: ['ffe08a', 'ffa040', 'e0541e', '6e1c12']}};
// (bark, leaf: the procedural trees, trees3d.js; char, ash, ember: burning wood, gfx.js MESH_FS uBurn; birch, aspen, berry: the
// birch's white bark, the aspen's grey-green bark, the rowan's berries, trees3d.js; appended, so the kit's family indices stay put.
// The rowan's berry part sits on 'berry' (ripe, scarlet); MESH_FS steps its family by the season, to the next rows: orange, green (unripe), cream (flowers))
export const FAMS = ['wood', 'metal', 'clay', 'stone', 'rock', 'rope', 'red', 'haz', 'gold', 'void', 'rune', 'crack', 'cover', 'bark', 'leaf', 'char', 'ash', 'ember', 'birch', 'aspen', 'berry', 'berryOrange', 'berryGreen', 'berryCream',
  // (the true-3D props, world/props3d.js and the features' 3D pieces: gem = a crystal's facets (the biome's style.gem), flame = the warm
  // glow of a flame or a lantern's glass, shroom = the biome's own glow (the mushrooms' caps), bone = bleached bone, wax, linen; GLOW3
  // below. They light themselves only where a mesh says so: gfx.js mesh.setGlow. NB the composite keeps a family in 5 bits (E.w =
  // part x 32 + family): at most 32 families)
  'gem', 'flame', 'shroom', 'bone',
  // (cactus: the desert's saguaros and cactus bushes, trees3d.js / flora3d.js: the true-3D pivot's flora)
  'cactus'];
// the true-3D props' families per biome, [hi, base, shade, outline] (gem: the biome's style.gem; shroom: a glow colour, ramped)
const GLOW3 = {
  flame: {ruins: ['fff4d0', 'ffd070', 'e09838', '7a4a1c'], ember: ['ffe8b0', 'ffa848', 'd8682a', '6e2a12'], frost: ['fff6d8', 'ffd890', 'd8a050', '7a5428'],
    rift: ['ffe8fc', 'ff9ae8', 'c85ad8', '5a2468']},
  shroom: {ruins: '7af0c8', ember: 'ff9a50', frost: '9ad8ff', rift: 'e070ff', desert: '7af0e0'},
  bone: {ruins: ['f4ecd6', 'e0d4b4', 'b8a888', '7a6e58'], frost: ['f4f8ff', 'd8e2f0', 'aab8cc', '6e7a8c'], rift: ['8a7aa8', '6a5a88', '4e4268', '2e2644']},
};
const mix = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
const ramp6 = r4 => { const r = r4.map(hexrgb); return [r[0], r[1], r[2], mix(r[3], r[2], .25), r[3], r[2]]; };   // + line, outline_shadow, outline_lit
function palette(biome, style) {
  const B = PAL[biome], P = {red: ramp6(RED), haz: ramp6(HAZ), gold: ramp6(GOLD)};
  for (const k of ['wood', 'metal', 'clay', 'stone', 'rock', 'rope']) P[k] = ramp6(B[k]);
  // the trees take the painted trees' own ramps (biomes.js STYLES: leaf / pine, bark)
  const sr = k => style?.[k]?.h ? ramp6(style[k].h.map(h => h.replace('#', ''))) : null;
  P.bark = sr('bark') || P.wood; P.leaf = sr('leaf') || sr('pine') || P.rock;
  P.birch = sr('birch') || P.stone; P.aspen = sr('aspen') || P.bark; P.berry = sr('berry') || P.red;   // (ruins' STYLES has them; the other biomes grow no such trees)
  P.berryOrange = sr('berryOrange') || P.gold; P.berryGreen = sr('berryGreen') || P.leaf; P.berryCream = sr('berryCream') || P.stone;
  P.cactus = sr('cactus') || P.leaf;   // (the desert's STYLE.cactus)
  const w = P.wood; P.void = [...Array(3).fill(mix(w[4], [0, 0, 0], .3)), ...Array(3).fill(mix(w[4], [0, 0, 0], .45))];
  P.cover = B.cover ? ramp6(B.cover) : P.stone;
  P.char = ramp6(['3a3330', '26211f', '161312', '0c0a0a']); P.ash = ramp6(['8e8982', '75716b', '5e5a55', '403d3a']);
  P.ember = ramp6(['ffc464', 'ff7c26', 'c0360e', '5a1406']);
  const st = P.stone;
  P.rune = EMIT.rune[biome] ? ramp6(EMIT.rune[biome]) : st;
  P.crack = EMIT.crack[biome] ? ramp6(EMIT.crack[biome]) : [st[3], st[3], st[3], st[4], st[4], st[4]];
  // the true-3D props' (GLOW3)
  P.gem = sr('gem') || P.stone; P.flame = ramp6(GLOW3.flame[biome] || GLOW3.flame.ruins); P.bone = ramp6(GLOW3.bone[biome] || GLOW3.bone.ruins);
  { const g = hexrgb(GLOW3.shroom[biome] || GLOW3.shroom.ruins), r = [mix(g, [255, 255, 255], .35), g, mix(g, [0, 0, 0], .35), mix(g, [0, 0, 0], .65)]; P.shroom = [r[0], r[1], r[2], mix(r[3], r[2], .25), r[3], r[2]]; }
  return P;
}
export function rampTexture(biome, style = null) {
  const P = palette(biome, style), data = new Uint8Array(6 * FAMS.length * 4);
  FAMS.forEach((f, j) => P[f].forEach((c, i) => data.set([...c, 255], (j * 6 + i) * 4)));
  const t = new THREE.DataTexture(data, 6, FAMS.length, THREE.RGBAFormat); t.needsUpdate = true;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  const B = PAL[biome];
  return {tex: t, cover: B.cover ? [B.coverK, B.coverT, FAMS.indexOf('cover')] : [0, 1, 0],
    emitFam: [EMIT.rune[biome] ? FAMS.indexOf('rune') : -1, EMIT.crack[biome] ? FAMS.indexOf('crack') : -1], rock: P.rock, cov: B.cover ? P.cover : null,
    rockB: B.rockB ? ramp6(B.rockB) : null};
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
export const PROP_TOP = {wall_n: 2.4, wall_w: 2.4, wall_e: 2.4, wall_s: .9, tower: 3.9, gatepost: 2.85, parapet: .56};   // (parapet: the brook's bridge, over its deck)
// a feature's own prop kinds: how high each stops arrows (registered once, at its module's load)
export function propTop(table) { Object.assign(PROP_TOP, table); }
// a prop's own top where the world built it its own height (the stone walls' pieces, towers and posts: walls3d.js, broken to their
// own heights), else its kind's (PROP_TOP); undefined for a kind with neither. Arrows, gadgets, the lasso and the gunmen read it
const TOPS = new WeakMap(), FULL = new WeakMap();
export const topOfProp = p => TOPS.get(p) ?? PROP_TOP[p.kind];
// a stone wall's segment broken below its run's full height (a BREACH): its own top (m over its base), else null (whole, or not one
// of the stone walls). The player steps over the lowest and vaults the rest (sim/player/adapter.js)
export const breachTop = p => { const t = TOPS.get(p), f = FULL.get(p); return t !== undefined && f !== undefined && t < f - .12 ? t : null; };
// how high a wall segment is where the player may get over it (sim/player/adapter.js: stepped over as rubble, else vaulted): an arena
// wall's only where it's a breach; an old field wall (the West Downs: kind 'fieldwall', world/westland.js) anywhere; else null
export const vaultTop = p => p.kind === 'fieldwall' ? TOPS.get(p) ?? null : breachTop(p);

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
  if (x < 0) { brookSample(x, y, out); return out; }   // (west of the Proving Grounds: the West Downs' brook, kinds 4 and 5: world/brook.js)
  if (y < -1 || y > 31) return out;
  const c = STREAM.cx(y), hw = STREAM.w(y) / 2, a = x - c;
  if (a > hw) {   // beyond the east bank: the plateau's rill (on its top) or, south of its face, the pool and its outflow
    if (y < FALL.y) {
      if (!rillAt(x, y, _rs)) return out;   // (rillAt keeps to the rill's own reach)
      const u = _rs.l / RILL_LEN, k = Math.max(0, Math.min(1, (u - .3) / .7));
      out.kind = 2; out.a = _rs.a; out.hw = _rs.hw; out.edge = _rs.hw - _rs.d; out.s = _rs.l * RILL_K; out.speed = RILL.pace ? RILL.pace(_rs.l) : .45 + 1.35 * k * k * (3 - 2 * k);
      out.hold = (Math.hypot(x - SPRING.x, y - SPRING.y) < SPRING.r || RILL.riffle(_rs.l, _rs.hw) || FALL.y - y < .1) ? 1 : 0;   // (the spring, the riffles / the cascades' white water, the lip's foam stay as painted)
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
  desert: {ramp: S => S.water.h, hold: [3], bank: 2, streak: 0, deep: 2, shallow: 1, deepFrac: .45, range: [0, 2], rate: 7, across: 2.5, along: 12, hi: .82, lo: .78, lap: 0, refl: .7, spark: .7},   // a muddy creek
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
// X0 / Y0: the canvas's world origin (the West Downs' own: 0, 0 is the Proving Grounds'); box: [x0, y0, x1, y1] m, the part to bake (the rest dry)
function bakeWater(biome, T, {WPX, HPX, PPM, px, cliffZ, X0 = 0, Y0 = 0, box = null}) {
  const ramp = T.ramp(biome.style).map(hex255), N = WPX * HPX, data = new Uint8Array(N * 4), o = {kind: 0, a: 0, hw: 0, edge: 0, s: 0, speed: 1, hold: 0};
  const bed = waterBed(biome, {WPX, HPX, PPM, cliffZ, X0, Y0, depth: brookDepth, dry: X0 || Y0 ? BROOK?.dry : null});   // (world/waterbed.js: the depth, the bed and the contact foam under the water; null = none)
  const toneOf = k => { for (let t = 0; t < ramp.length; t++) if (px[k] === ramp[t][0] && px[k + 1] === ramp[t][1] && px[k + 2] === ramp[t][2]) return t; return -1; };
  const bx0 = box ? Math.max(0, Math.floor((box[0] - X0) * PPM)) : 0, by0 = box ? Math.max(0, Math.floor((box[1] - Y0) * PPM)) : 0;
  const bx1 = box ? Math.min(WPX, Math.ceil((box[2] - X0) * PPM)) : WPX, by1 = box ? Math.min(HPX, Math.ceil((box[3] - Y0) * PPM)) : HPX;
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
    const mx = X0 + (x + .5) / PPM, my = Y0 + (y + .5) / PPM;
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
    if (bed) bed.add(x, y, o);
  }
  for (let y = Math.max(0, by0 - 1); y < Math.min(HPX, by1 + 1); y++) for (let x = Math.max(0, bx0 - 1); x < Math.min(WPX, bx1 + 1); x++) {   // dry texels beside water: SURF_FS blends across them when the camera turns
    const k = (y * WPX + x) * 4; if (data[k] >> 6) continue;
    for (let j = -1; j <= 1; j++) for (let l = -1; l <= 1; l++) {
      const u = x + l, v = y + j; if (u < 0 || v < 0 || u >= WPX || v >= HPX) continue;
      if (data[(v * WPX + u) * 4] >> 6 >= 2) { data[k] = 1 << 6; j = 2; break; }
    }
  }
  const tex = new THREE.DataTexture(data, WPX, HPX, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  tex.userData.bed = bed ? bed.finish(data) : null;   // {tex, rect, ...its look}: G.setWaterLook's bed
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
  max: .68, cap: .68,                                 // no cell is baked denser than this; and the living layer (render/litter.js) spreads what is piled over `cap`
  trunk: .3,                                          // a tree's trunk, as the living layer's obstacle: radius m at most (the collider's .5 is for walking)
};
const LEAF_SOLID = new Set(['tower', 'gatepost', 'pillar', 'pillar_broken', 'ruin', 'brazier', 'woodpile']);   // (props with a round collider that stay put)
const RUST = [['#e0b04e', '#c88c34', '#9a6422'], ['#d28a3a', '#b4642a', '#86441c'], ['#b0602c', '#8a4420', '#62301a'], ['#7a5232', '#5e3c24', '#44291a']];
function makeLitter(WPX, HPX, PPM) {
  const W = Math.ceil(WPX / LITTER.div), H = Math.ceil(HPX / LITTER.div), N = W * H, G = LITTER.groups;
  const dt = (data, w, h) => { const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; return t; };
  const data = new Uint8Array(N * 4), pd = new Uint8Array(12 * G * 4);
  // The living layer (render/litter.js) takes this map as its SOURCE: B = 0 open, 128 sink (water, the ravine: a leaf blown there is gone), 255
  // solid (a wall, a trunk, the plateau's foot: leaves lie against it); it reads u.value (this texture, or its own field when it runs) and
  // cap, and says through live whether it does. groups / keys: the palettes the cells carry, kept across bakes (a rebake never renumbers them)
  const L = {W, H, cell: WPX / W / PPM, data, pd, tex: dt(data, W, H), pal: dt(pd, 12, G), keep: new Float32Array(N), best: new Float32Array(N), grp: new Uint8Array(N), bonus: new Float32Array(N),
    solid: new Uint8Array(N), sink: new Uint8Array(N), sinkDone: false, groups: [RUST], keys: new Map(), u: {value: null}, live: {value: 0}, cap: {value: LITTER.cap}, sim: null,
    stats: {ms: 0, trees: 0, bakes: 0}};
  L.u.value = L.tex;
  L.dispose = () => { L.sim?.dispose(); L.tex.dispose(); L.pal.dispose(); };
  return L;
}
const segDist = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0; return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t); };
// the sink mask, once (water and the ravine don't change): a cell is a sink where the baked water texture says water (R >= 128) or the
// ravine's edge has passed (y >= cliffZ(x))
function bakeSink(L, {WPX, HPX, PPM, wdata, cliffZ}) {
  const {W, H, sink} = L, sx = WPX / W / PPM, sy = HPX / H / PPM, d = LITTER.div;
  for (let i = 0; i < W; i++) {
    const cz = cliffZ((i + .5) * sx), tx = Math.min(WPX - 1, i * d + (d >> 1));
    for (let j = 0; j < H; j++) sink[j * W + i] = (j + .5) * sy >= cz || (wdata && wdata[(Math.min(HPX - 1, j * d + (d >> 1)) * WPX + tx) * 4] >= 128) ? 1 : 0;
  }
  L.sinkDone = true;
}
// trees: [{x, y, R (m), w, autumn}], walls: [[x0, y0, x1, y1]], paths: [{pts, w}], dry(x, y): not water, not over the ravine;
// blocks: [[x0, y0, x1, y1]] and discs: [[x, y, r]]: what the living layer's leaves lie against (walls, trunks, the plateau's foot)
function bakeLitter(L, trees, {WPX, HPX, PPM, walls, paths, dry, blocks = [], discs = []}) {
  const t0 = performance.now(), {W, H, data, keep, best, grp, bonus} = L, sx = WPX / W / PPM, sy = HPX / H / PPM, [wx, wy] = LITTER.wind;
  keep.fill(1); best.fill(0); grp.fill(0); bonus.fill(1);
  // the palettes: group 0 is rust; each distinct autumn a tree brings takes the next row (distinct by its colours, not its array: every
  // shape of a species carries its own copy)
  const {groups, keys} = L, col = c => typeof c === 'string' ? hex255(c) : c.map(v => Math.round(v * 255));
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
  // what leaves lie against: the cells inside a wall (its box, a half cell fatter: a thin one still counts), a trunk, the plateau's foot
  const solid = L.solid, sink = L.sink; solid.fill(0);
  for (const r of blocks) mark(r[0] - sx / 2, r[1] - sy / 2, r[2] + sx / 2, r[3] + sy / 2, (k, x, y) => { if (x >= r[0] - sx / 2 && x <= r[2] + sx / 2 && y >= r[1] - sy / 2 && y <= r[3] + sy / 2) solid[k] = 1; });
  for (const d of discs) mark(d[0] - d[2], d[1] - d[2], d[0] + d[2], d[1] + d[2], (k, x, y) => { if (Math.hypot(x - d[0], y - d[1]) <= d[2]) solid[k] = 1; });
  // the map: leaves lie in clumps (value noise at ~0.6 m and ~0.2 m), never on water or over the ravine
  for (let j = 0, k = 0; j < H; j++) for (let i = 0; i < W; i++, k++) {
    let D = 1 - keep[k];
    if (D > .004 && !solid[k] && !sink[k]) {
      if (!dry((i + .5) * sx, (j + .5) * sy)) D = 0;
      else D = Math.min(LITTER.max, D * bonus[k] * (.3 + 1.4 * (vnoise(i / 9, j / 9, 3) * .6 + vnoise(i / 3.2, j / 3.2, 4) * .4)));
    } else D = 0;
    const o = k * 4; data[o] = Math.round(D * 255); data[o + 1] = grp[k]; data[o + 2] = solid[k] ? 255 : sink[k] ? 128 : 0; data[o + 3] = 255;
  }
  L.tex.needsUpdate = true; L.pal.needsUpdate = true;
  L.stats.ms = performance.now() - t0; L.stats.trees = trees.length; L.stats.bakes++;
}

// ---------------------------------------------------------------- strata texture for the plateau's faces
// rockB (optional): a second rock ramp for alternate layers (the desert's red and tan bands)
function strataCanvas(len, hgt, PPM, PPMH, rock, cov, seed, rockB = null) {
  const w = Math.max(1, Math.round(len * PPM)), h = Math.max(1, Math.round(hgt * PPMH)), c = document.createElement('canvas');
  c.width = w; c.height = h; const q = c.getContext('2d'), id = q.createImageData(w, h), d = id.data;
  for (let x = 0; x < w; x++) {
    const hang = cov ? (hsh(Math.floor(x / 6), seed) > .45 ? 1 + (hsh(x, 7, seed) * 4 | 0) : 1) : 0;
    for (let r = 0; r < h; r++) {
      let col;
      if (r < hang) col = cov[r === hang - 1 ? 2 : r ? 1 : 0];
      else {
        const ly = r + Math.round((hsh(Math.floor(x / 14), 94, seed) - .5) * 5), layer = Math.floor(ly / 9), inL = ((ly % 9) + 9) % 9;
        const crackX = hsh(Math.floor(x / 11), layer, 96 + seed) < (rockB ? .1 : .35) && x % 11 === (hsh(layer, Math.floor(x / 11), 97 + seed) * 11 | 0);   // (banded sandstone: few joints)
        const t = r === h - 1 ? 3 : inL === 0 ? (hsh(layer, 5, seed) < .5 ? 0 : 1) : inL >= 7 ? 2 : crackX ? 2 : hsh(layer, 9, seed) < .3 ? 2 : 1;
        col = (rockB && hsh(layer, 3, seed) < .45 ? rockB : rock)[t];
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
  desert: {mode: 'water', ramp: S => S.water.h},
};
// only: the fall alone on a clear sheet (the 3D cliffs stand behind it: cliffs3d.js), no rock. F: the fall (x = its centre, hw); deep: the
// sheet hangs on below the ground line to the pool's surface (a cascade's sheet ends where its water does: false)
function fallFace(cv, q, PPM, rock, look, ramp, only = false, F = FALL, deep = true) {
  const rows = cv.height, per = q.h / rows, foot = deep ? Math.ceil(-WATER_H / per) : 0, H = rows + foot, W = cv.width, out = document.createElement('canvas');
  out.width = W; out.height = H; const g = out.getContext('2d', {willReadFrequently: true}); if (!only) g.drawImage(cv, 0, 0);
  const id = g.getImageData(0, 0, W, H), d = id.data, put = (x, y, c, a = 255) => { const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a; };
  if (!only) for (let y = rows; y < H; y++) for (let x = 0; x < W; x++) put(x, y, rock[3]);            // the foot, below the ground line: dark, wet rock
  if (!look) { g.putImageData(id, 0, 0); return {cv: out, h: H * per}; }   // (a biome without a fall: the foot only)
  const col = (F.x - q.x0) / (q.x1 - q.x0) * W, hw = F.hw * PPM, C = ramp.map(hex255);
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
const FALL_OUT = .03;   // with the 3D cliffs: the plateau's waterfall sheet hangs this far (m) in front of the face line, the rock behind it
const POOL_GROW = .25;   // the ground mesh (.25 m cells) is lowered this far (m) beyond the pool's painted edge, so the painted outline is the drawn one
export async function buildWorld(G, {biome, ctxO, PPM, PPMH, props: keep = null, trees3d = true, cliffs3d = true}) {
  GT = G;
  // keep: the live prop list of the previous world (a biome switch): the items must point at the props gameplay uses
  // WM x HM: the Proving Grounds' painted ground (GROUNDS, from 0, 0); the world round it (WORLD) can be bigger
  const WM = GROUNDS.x1 - GROUNDS.x0, HM = GROUNDS.y1 - GROUNDS.y0, layout = buildLayout(7);
  if (keep) layout.props = keep;
  const props = layout.props;
  // for features: WM HM WPX HPX = the painted ground (groundCanvas: GROUNDS); grounds / bounds = GROUNDS / WORLD {x0 y0 x1 y1} (read only)
  Object.assign(ctxO, {WM, HM, WPX: Math.ceil(WM * ctxO.PPM), HPX: Math.ceil(HM * ctxO.PPMY), PLAY, layout, grounds: GROUNDS, bounds: WORLD});
  const disposers = [];
  const R = rampTexture(biome.id, biome.style);
  G.U.ramps.value = R.tex; G.U.cover.value.set(...R.cover); G.U.emitFam.value.set(...R.emitFam);
  if (G.compU.uSoftFam) G.compU.uSoftFam.value = FAMS.indexOf('leaf');   // a crown's clumps meet in tone, not in lines

  // ---- ground: the biome's painter, top-down
  const WPX = Math.ceil(WM * PPM), HPX = Math.ceil(HM * PPM);
  // ground: the walkable terrain's height (layout.js; ?terrain=0: none) for the painters to shade its real slopes; null = flat
  const ctxT = {PPM, PPMY: PPM, PPMH: 0, toS: (x, y) => [x * PPM, y * PPM], WM, HM, WPX, HPX, PLAY, layout, VW: G.VW, VH: G.VH, ground: TERRAIN_ON ? groundDrawn() : null};
  const gc = document.createElement('canvas'); gc.width = WPX; gc.height = HPX;
  const gq = gc.getContext('2d', {willReadFrequently: true});
  biome.paintGround(gq, ctxT);
  const groundEmit = biome.groundEmit, groundLights = (biome.groundLights || []).slice();
  const gTex = texOf(gc, true), eTex = groundEmit ? texOf(groundEmit, true) : null;
  // past the painted ground's edges (the patch's SKIRT) the texture MIRRORS: a camera turned to face an edge over the border's raised banks
  // (the east ladder's climb) sees the ground carry on there, not its last texel column stretched into stripes
  for (const t of [gTex, eTex]) if (t) { t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.needsUpdate = true; }
  // the ground's pixels (the waterfall takes the stream's painted colour at the edge)
  const px = gq.getImageData(0, 0, WPX, HPX).data;
  // the ground mesh, in PATCHES (each drawn and culled on its own): the Proving Grounds under their painted texture and, in a
  // bigger world, the OPEN LAND round them in tiles of at most TILE m (a stand-in texture until the world plan's step 3 paints
  // it). A patch side on the world's edge runs SKIRT m past it (edge texels stretched outward): the camera keeps the flat ground
  // inside the world, but lowered ground (the south ravine) projects further down the screen than that. Y1: the world's south
  // edge, which the ravine runs along
  const S = .25, SKIRT = 6, DROP = -3.5, Y1 = WORLD.y1, TILE = 32, COARSE = 2;
  // the south edge, as the biome itself defines it: ruins and ember end in a RAVINE along their cliff line (the biome's
  // hole() is y > cliff(x) - .3 there, or near the stream); frost ends in a flat frozen lake and the rift in its flat void,
  // so they keep their ground. Inside the stream's band the line is interpolated from both banks (the waterfall)
  const RAVINE = new Set(['ruins', 'ember', 'desert']).has(biome.id);   // (desert: its red canyon)
  const nearStream = (x, y) => Math.abs(x - STREAM.cx(y)) - STREAM.w(y) / 2 < .7;
  const rawCliff = x => { for (let y = Y1 - 7; y < Y1 + .5; y += .05) if (biome.hole?.(x, y) && !nearStream(x, y)) return y + .3; return Infinity; };
  const cliffCache = new Map();
  const cliffZ = x => {
    if (!RAVINE) return Infinity;
    const k = Math.round(x * 8); let c = cliffCache.get(k); if (c !== undefined) return c;
    const ys = Y1 - 2.4, hw = STREAM.w(ys) / 2 + .7, sc = STREAM.cx(ys);
    if (Math.abs(x - sc) < hw) {   // the banks a little outside the band (the stream meanders: right on its edge it's still "near")
      let a = rawCliff(sc - hw - .4), b = rawCliff(sc + hw + .4);
      if (!isFinite(a)) a = b; if (!isFinite(b)) b = a; if (!isFinite(a)) a = b = Y1 - 2.2;
      c = a + (b - a) * (x - (sc - hw)) / (2 * hw);
    } else c = rawCliff(x);
    cliffCache.set(k, c); return c;
  };
  // walkable terrain (layout.js; ?terrain=0: none): the field's height under every vertex (it is held flat at the water, the ravine's rim)
  const TF = TERRAIN_ON ? terrainField() : null, tH = TF ? groundDrawn() : () => 0;   // (the drawn ground: the mesa's falls away behind its rock)
  const hAt = (x, z) => z >= cliffZ(x) ? DROP : (inStream(x, z) || inPool(x, z, .01, POOL_GROW) || inBrookPool(x, z, POOL_GROW) ? WATER_H : 0) + tH(x, z);   // (the pool's vertices, those ON the plateau's south face too, are lowered: the face goes down to the water)
  // a patch's grid, s m cells, from (rx0, rz0) to (rx1, rz1). It follows the edge exactly: the last bank vertex of each column
  // moves onto the edge line and the next one to just past it at the ravine's depth, so the wall is one smooth face (a plain
  // 0.25 m grid made it a staircase). Neighbouring patches share their border vertices (one lattice, one edge line per column)
  function gridGeo(rx0, rz0, rx1, rz1, s) {
    const NX = Math.round((rx1 - rx0) / s), NZ = Math.round((rz1 - rz0) / s), pos = [], uv = [];
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
      const x = i * s + rx0; let z = j * s + rz0, h;
      const cz = cliffZ(x);
      if (z <= cz && z + s > cz) { z = cz - .001; h = (inStream(x, z) ? WATER_H : 0) + tH(x, z); }   // the lip
      else if (z > cz && z - s <= cz) { z = cz + .02; h = DROP; }                       // the foot
      else h = hAt(x, z);
      pos.push(x, h, z); uv.push(x / WM, z / HM);
    }
    const idx = [];
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  // the Proving Grounds' patch: their rect, + SKIRT on the sides that are the world's edge
  const G0 = GROUNDS, hx0 = G0.x0 - (G0.x0 <= WORLD.x0 ? SKIRT : 0), hz0 = G0.y0 - (G0.y0 <= WORLD.y0 ? SKIRT : 0);
  const hx1 = G0.x1 + (G0.x1 >= WORLD.x1 ? SKIRT : 0), hz1 = G0.y1 + (G0.y1 >= WORLD.y1 ? SKIRT : 0);
  const gGeo = gridGeo(hx0, hz0, hx1, hz1, S);
  const world2 = new THREE.Vector2(WM, HM), origin2 = new THREE.Vector2(G0.x0, G0.y0);
  // THE WEST DOWNS (westland.js): their own painted ground (biome.paintWest; a biome without it leaves them to the open land's
  // stand-in) over their LAND (the downs and on past the world's west and north edges) on a patch of their own, the Proving
  // Grounds' western neighbour: from LAND's west edge to GROUNDS.x0, over the same z as theirs. Planar like theirs, with LAND's origin
  const WD = WEST_ON && biome.paintWest ? WEST_LAND : null;
  let westCanvas = null, wdTex = null, westPx = null;
  const wdx0 = WD ? WD.x0 : 0, wdWorld = WD ? new THREE.Vector2(WD.x1 - WD.x0, WD.y1 - WD.y0) : null, wdOrigin = WD ? new THREE.Vector2(WD.x0, WD.y0) : null;
  if (WD) {
    const wpx = Math.ceil((WD.x1 - WD.x0) * PPM), hpx = Math.ceil((WD.y1 - WD.y0) * PPM);
    westCanvas = document.createElement('canvas'); westCanvas.width = wpx; westCanvas.height = hpx;
    biome.paintWest(westCanvas.getContext('2d', {willReadFrequently: true}), {PPM, WPX: wpx, HPX: hpx, X0: WD.x0, Y0: WD.y0, ground: TERRAIN_ON ? groundDrawn() : null, layout});
    wdTex = texOf(westCanvas, true); wdTex.wrapS = wdTex.wrapT = THREE.MirroredRepeatWrapping; wdTex.needsUpdate = true;
    if (BROOK) westPx = westCanvas.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, wpx, hpx).data;   // (the brook's water: its fall's colour, its moving texture)
  }
  // the open land's tiles [x0, z0, x1, z1, cell]: the world + skirt outside the Proving Grounds' patch, cut on a TILE m lattice
  // from the skirt's corner and at the patch's sides. Fine cells (S) where the ground can step: the ravine's band (rawCliff
  // looks 7 m in from the south edge) and the stream's box; COARSE cells on flat land (they meet fine ones only where both are flat).
  // Out to RING m past the world (the view goes WORLD.past past it: render/camera.js)
  const openTiles = [], RING = Math.max(SKIRT, (WORLD.past || 0) + 2);
  {
    const ax = WORLD.x0 - RING, az = WORLD.y0 - RING, bx = WORLD.x1 + RING, bz = WORLD.y1 + RING;
    const cuts = (a, b, h0, h1) => { const v = new Set([a, b, h0, h1]); for (let t = a; t < b; t += TILE) v.add(t); return [...v].filter(t => t >= a && t <= b).sort((p, q) => p - q); };
    const xs = cuts(ax, bx, hx0, hx1), zs = cuts(az, bz, hz0, hz1);
    if (WD && !xs.includes(wdx0)) { xs.push(wdx0); xs.sort((p, q) => p - q); }   // (the West Downs' patch edge)
    let wx0 = 1e9, wx1 = -1e9;
    for (let y = STREAM.y0; y <= STREAM.y1; y += .25) { const c = STREAM.cx(y), w = STREAM.w(y) / 2; wx0 = Math.min(wx0, c - w); wx1 = Math.max(wx1, c + w); }
    const wet = (x0, z0, x1, z1) => x1 > wx0 - 1 && x0 < wx1 + 1 && z1 > STREAM.y0 - 1 && z0 < STREAM.y1 + 1;
    const hilly = (x0, z0, x1, z1) => { if (!TF) return false; for (let x = x0; x <= x1; x += .5) for (let z = z0; z <= z1; z += .5) if (Math.abs(tH(x, z)) > .002) return true; return false; };
    for (let j = 0; j + 1 < zs.length; j++) for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
      if (x0 >= hx0 && x1 <= hx1 && z0 >= hz0 && z1 <= hz1) continue;   // the Proving Grounds' patch
      if (WD && x0 >= wdx0 && x1 <= hx0 && z0 >= hz0 && z1 <= hz1) continue;   // the West Downs' patch
      openTiles.push([x0, z0, x1, z1, z1 > Y1 - 8 || wet(x0, z0, x1, z1) || hilly(x0, z0, x1, z1) ? S : COARSE]);
    }
  }
  // the south ravine's wall (any steep ground): rock strata with the biome's grass / ash / snow lip, and a WATERFALL where
  // the stream goes over the edge, in the stream's own painted colour (streaks, dark edges, foam at the foot). Indexed by
  // world x (+ cliffOff) and depth below the bank: the ground shader maps it onto the steep cells (gfx.js SURF_FS)
  const CL_H = 3.5, cliff = strataCanvas(WORLD.WM + 2 * SKIRT, CL_H, PPM, PPMH, R.rock, R.cov, 11, R.rockB), cliffOff = SKIRT - WORLD.x0;   // column 0 = the world's x0 - SKIRT
  {
    const q = cliff.getContext('2d', {willReadFrequently: true}), id = q.getImageData(0, 0, cliff.width, cliff.height), d = id.data, CH = cliff.height;
    // where the stream glows (ember lava: the ground's emit layer), its fall glows too: alpha 250 marks emissive texels.
    // A fall of WATER carries alpha FALL_ALPHA (252): SURF_FS streams its streaks down in stepped time and flickers the foam
    // at the foot, from the baked colour (dark edge columns and the lip stay as painted). Any face texture can use the marker
    const ge = groundEmit ? groundEmit.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, groundEmit.width, groundEmit.height).data : null;
    const edgeZ = x => { for (let z = Y1 - 7; z < Y1 + SKIRT; z += .05) if (hAt(x, z) < -1) return z; return null; };
    for (let cx = 0; cx < cliff.width; cx++) {
      const x = cx / PPM - cliffOff, ze = edgeZ(x);
      const zs = ze === null ? 0 : ze - .35, offS = ze === null ? 1 : Math.abs(x - STREAM.cx(zs)) - STREAM.w(zs) / 2, offB = ze === null || !westPx ? 1 : brookFallOff(x, zs), off = Math.min(offS, offB);   // (offB: the West Downs' brook falls here too)
      if (off > 0) {   // no fall here: with the 3D cliffs the rock is live (below), and the ground's own steep cells draw nothing (alpha 0: SURF_FS)
        if (cliffs3d) for (let r = 0; r < CH; r++) d[(r * cliff.width + cx) * 4 + 3] = 0;
        continue;
      }
      const at = z => (Math.min(HPX - 1, Math.max(0, Math.round(z * PPM))) * WPX + Math.min(WPX - 1, Math.max(0, Math.round(x * PPM)))) * 4;
      let gi = at(zs), glows = false;
      if (ge) for (let z = zs - .6; z <= zs; z += 1 / PPM) {   // a glowing stream (lava): its brightest molten pixel near the edge
        const k = at(z); if (ge[k + 3] > 0) glows = true;
        if (px[k] * .3 + px[k + 1] * .55 + px[k + 2] * .15 > px[gi] * .3 + px[gi + 1] * .55 + px[gi + 2] * .15) gi = k;
      }
      if (!glows) gi = at(zs);
      if (offB < offS) { glows = false; gi = (Math.min(WD.y1 - WD.y0 - .01, Math.max(0, zs - WD.y0)) * PPM | 0) * westCanvas.width * 4 + (Math.max(0, x - WD.x0) * PPM | 0) * 4; }   // (the brook's own colour)
      const pix = offB < offS ? westPx : px, base = [pix[gi], pix[gi + 1], pix[gi + 2]], edge = off > -.08, streak = hsh(cx, 17) < .3;
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
  if (wTex) disposers.push(() => { wTex.dispose(); wTex.userData.bed?.tex.dispose(); });
  // the West Downs' brook (world/brook.js): its own moving water on their canvas, baked over its box only, with its own bed (gfx.js surface bed)
  const wdWater = WT && westPx ? bakeWater(biome, WT, {WPX: westCanvas.width, HPX: westCanvas.height, PPM, px: westPx, cliffZ, X0: WD.x0, Y0: WD.y0, box: BROOK.box}) : null;
  if (wdWater) disposers.push(() => { wdWater.dispose(); wdWater.userData.bed?.tex.dispose(); });
  G.setWaterLook(WT ? {ramp: WT.ramp(biome.style).map(h => rgbOf(h)), rate: WT.rate, across: WT.across, along: WT.along, hi: WT.hi, lo: WT.lo, range: WT.range, lap: WT.lap, refl: WT.refl, spark: WT.spark, bed: wTex.userData.bed} : null);
  // fallen leaves: the density map (empty until bakeLitter below); only where the biome turns with the seasons
  const lit = biome.id === 'ruins' ? makeLitter(WPX, HPX, PPM) : null;
  if (lit) { lit.sim = G.litterSim(lit); disposers.push(lit.dispose); }   // (the living layer: render/litter.js, driven by features/litter.js)
  const ground = G.surface(gGeo, {tex: gTex, em: eTex, planar: true, world: world2, origin: origin2, type: 1, obj: 0, cliff: cTex, cliffOff, water: wTex, litter: lit, decals: TERRAIN_ON, cliffTop: TERRAIN_ON ? -.05 : 1e9}, false); disposers.push(() => ground.dispose());
  // walkable terrain's shadows: the drawn ground casts nothing (it would shadow itself: acne), so a SHADOW-ONLY copy of it, sunk
  // CAST_SINK m, goes into the cached sun shadow and the point lights' height map: a hill throws its shadow over what lies
  // behind it at a low sun, flat ground never reaches the ground it stands for
  const CAST_SINK = .15;
  const caster = geo => { const g = geo.clone(), p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - CAST_SINK); p.needsUpdate = true;
    const s = G.surface(g, {tex: gTex, planar: true, world: world2, type: 1, obj: 0}, true); s.gm.visible = false; disposers.push(() => { s.dispose(); g.dispose(); }); };
  if (TERRAIN_ON) caster(gGeo);
  if (WD) {   // the West Downs' patch (above)
    const wg = gridGeo(wdx0, hz0, hx0, hz1, S), m = G.surface(wg, {tex: wdTex, planar: true, world: wdWorld, origin: wdOrigin, type: 1, obj: 0, cliff: cTex, cliffOff, decals: TERRAIN_ON, cliffTop: TERRAIN_ON ? -.05 : 1e9,
      ...(wdWater ? {water: wdWater, bed: wdWater.userData.bed} : {})}, false);   // (the brook's water: its own bed, not the Proving Grounds')
    disposers.push(() => { m.dispose(); wdTex.dispose(); });
    if (TERRAIN_ON) caster(wg);
  }
  // the open land: a stand-in texture until the world plan's step 3 paints the land itself. Plain ground in the biome's own colours:
  // the 3 commonest texels of a 5 m square of the Proving Grounds' ground outside their walls (the north-west corner), speckled
  // in proportion by a hash, OPEN_PATCH m a side, repeated
  if (openTiles.length) {
    const OPEN_PATCH = 8, n = Math.round(OPEN_PATCH * PPM), s0 = Math.round(.5 * PPM), s1 = Math.round(5.5 * PPM), count = new Map();
    for (let y = s0; y < s1; y++) for (let x = s0; x < s1; x++) { const i = (y * WPX + x) * 4, k = px[i] << 16 | px[i + 1] << 8 | px[i + 2]; count.set(k, (count.get(k) || 0) + 1); }
    const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3), total = top.reduce((t, e) => t + e[1], 0);
    const pc = document.createElement('canvas'); pc.width = pc.height = n;
    const pq = pc.getContext('2d'), id = pq.createImageData(n, n), d = id.data;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let r = hsh(x, y, 7) * total, k = 0; while (k < top.length - 1 && (r -= top[k][1]) >= 0) k++;
      const c = top[k][0], i = (y * n + x) * 4; d[i] = c >> 16 & 255; d[i + 1] = c >> 8 & 255; d[i + 2] = c & 255; d[i + 3] = 255;
    }
    pq.putImageData(id, 0, 0);
    const pTex = texOf(pc, true); pTex.wrapS = pTex.wrapT = THREE.RepeatWrapping; pTex.needsUpdate = true;
    const size = new THREE.Vector2(OPEN_PATCH, OPEN_PATCH);
    // (the Proving Grounds alone (no open land): the tiles round them are past the world's edge, where the painted ground goes on
    // mirrored, as on the patch's skirt: no seam)
    // (the West Downs (WD): the tiles past the world's edge beside them take their ground, mirrored, the ones beside the Proving Grounds
    // theirs; the big world's open land inside it, the stand-in)
    const alone = GROUNDS.x0 <= WORLD.x0 && GROUNDS.y0 <= WORLD.y0 && GROUNDS.x1 >= WORLD.x1 && GROUNDS.y1 >= WORLD.y1;
    const inWorld = (x0, z0, x1, z1) => x0 >= WORLD.x0 && x1 <= WORLD.x1 && z0 >= WORLD.y0 && z1 <= WORLD.y1;
    for (const [x0, z0, x1, z1, s] of openTiles) {
      const ring = WD && !inWorld(x0, z0, x1, z1), west = ring && (x0 + x1) / 2 < GROUNDS.x0;
      const tg = gridGeo(x0, z0, x1, z1, s), m = G.surface(tg, west ? {tex: wdTex, planar: true, world: wdWorld, origin: wdOrigin, type: 1, obj: 0, cliff: cTex, cliffOff, decals: TERRAIN_ON, cliffTop: TERRAIN_ON ? -.05 : 1e9}
        : alone || ring ? {tex: gTex, em: eTex, planar: true, world: world2, origin: origin2, type: 1, obj: 0, cliff: cTex, cliffOff, decals: TERRAIN_ON, cliffTop: TERRAIN_ON ? -.05 : 1e9}
        : {tex: pTex, planar: true, world: size, type: 1, obj: 0, cliff: cTex, cliffOff, decals: TERRAIN_ON, cliffTop: TERRAIN_ON ? -.05 : 1e9}, false);
      if (TERRAIN_ON && s === S) caster(tg);   // (the fine tiles are where the ground varies)
      disposers.push(() => m.dispose());
    }
  }

  // ---- plateau: top (the painted top, planar) + 4 strata faces
  const FL = FALL_LOOK[biome.id];
  for (const q of PLATEAUS) {
    const top = new THREE.PlaneGeometry(q.x1 - q.x0, q.y1 - q.y0); top.rotateX(-Math.PI / 2); top.translate((q.x0 + q.x1) / 2, q.h, (q.y0 + q.y1) / 2);
    const t = G.surface(top, {tex: gTex, em: eTex, planar: true, world: world2, type: 1, obj: 1, water: wTex, litter: lit}); disposers.push(() => t.dispose());   // (water on the plateau's top too: the rill moves; so do the leaves)
    const faces = [   // [len, centre x, centre z, rotation y]
      [q.x1 - q.x0, (q.x0 + q.x1) / 2, q.y1, 0], [q.x1 - q.x0, (q.x0 + q.x1) / 2, q.y0, Math.PI],
      [q.y1 - q.y0, q.x1, (q.y0 + q.y1) / 2, Math.PI / 2], [q.y1 - q.y0, q.x0, (q.y0 + q.y1) / 2, -Math.PI / 2]];
    faces.forEach(([len, cx, cz, ry], k) => {
      // with the 3D cliffs (below) the rock is live; only the south face's waterfall stays a sheet, standing just in front of it
      if (cliffs3d && !(k === 0 && q === PLATEAUS[0] && FL)) return;
      let cvs = strataCanvas(len, q.h, PPM, PPMH, R.rock, R.cov, k + 2, R.rockB), hgt = q.h;
      if (k === 0 && q === PLATEAUS[0]) ({cv: cvs, h: hgt} = fallFace(cvs, q, PPM, R.rock, FL, FL?.ramp(biome.style), cliffs3d));   // the south face: the waterfall, and the foot down to the pool
      if (cliffs3d) cz += FALL_OUT;
      const geo = new THREE.PlaneGeometry(len, hgt); geo.translate(0, q.h - hgt / 2, 0); geo.rotateY(ry); geo.translate(cx, 0, cz);
      const uvA = geo.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setY(i, 1 - uvA.getY(i));   // canvas rows go down
      const tex = texOf(cvs, true);
      const f = G.surface(geo, {tex, planar: false, type: 5, obj: 1}, !cliffs3d); disposers.push(() => f.dispose());   // (the sheet of water alone casts no shadow)
    });
  }
  // ---- the creek's cascades (terrain: layout.js CASCADES): at each step a sheet of falling water across the creek, facing downstream,
  // from the water above to the water below (the last into the pool); the biome's fall look (FALL_LOOK), no rock. ONE mesh: the
  // sheets side by side in one texture, each at its foot (SURF_FS's fall() reads only the texel's own column and row: the foam is
  // the texture's last rows, every sheet's foot)
  if (FL && CASCADES.length) {
    const sheets = CASCADES.map(c => {
      const len = c.hw * 2 + .5, drop = c.top - c.bot, blank = document.createElement('canvas');
      blank.width = Math.max(4, Math.round(len * PPM)); blank.height = Math.max(3, Math.round(drop * PPMH));
      const {cv, h} = fallFace(blank, {x0: -len / 2, x1: len / 2, h: drop}, PPM, R.rock, FL, FL.ramp(biome.style), true, {x: 0, hw: c.hw}, false);
      return {c, len, h, cv};
    });
    const AW = sheets.reduce((a, q) => a + q.cv.width + 1, 0), AH = Math.max(...sheets.map(q => q.cv.height)), atlas = document.createElement('canvas');
    atlas.width = AW; atlas.height = AH; const aq = atlas.getContext('2d');
    const pos = [], nrm = [], uv = [], idx = [];
    let ax = 0;
    for (const {c, len, h, cv} of sheets) {
      aq.drawImage(cv, ax, AH - cv.height);
      const ux = (c.dy), uz = -c.dx, u0 = ax / AW, u1 = (ax + cv.width) / AW, v0 = (AH - cv.height) / AH, n = pos.length / 3;   // (u: along the sheet, its right as seen from downstream)
      for (const [s, y, u, v] of [[-.5, c.top, u0, v0], [.5, c.top, u1, v0], [-.5, c.top - h, u0, 1], [.5, c.top - h, u1, 1]]) {
        pos.push(c.x + ux * s * len, y, c.y + uz * s * len); nrm.push(c.dx, 0, c.dy); uv.push(u, v);
      }
      idx.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
      ax += cv.width + 1;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    const f = G.surface(geo, {tex: texOf(atlas, true), planar: false, type: 5, obj: 1}, false); disposers.push(() => f.dispose());
  }

  // ---- the 3D cliffs (cliffs3d.js): the plateau's four faces and the ravine's wall as live rock. Runs travel with the outside
  // on their (-tz, tx) side: east along a south face
  if (cliffs3d) {
    const famOf = name => Math.max(0, FAMS.indexOf(name)), lip = !!R.cov && biome.id !== 'ember';   // (ember's cover is ash: it doesn't hang)
    const o = {fam: famOf, rockB: R.rockB ? famOf('stone') : null, cover: R.cov ? famOf('cover') : null, ladders: []};
    // props near a face keep the stones off them (built once per world: no per-frame scan)
    const near = props.filter(p => !p.outside || !biome.hole?.(p.x, p.y, ctxO)).map(p => [p.x, p.y]);
    const wet = (x, z) => hAt(x, z) < -.01 || inOutflow(x, z) || inRill(x, z);
    const plateauRuns = [];
    for (const q of PLATEAUS) {
      const P = q === PLATEAUS[0], climbs = q.climbs || [];
      const keepS = (x, z) => P && FL && Math.abs(x - FALL.x) < FALL.hw + .16 ? FALL_OUT - .04 : climbs.some(c => Math.abs(x - c.x) < c.w / 2 + .08) ? -.02 : null;
      const avoid = (x, z) => wet(x, z) || climbs.some(c => Math.abs(x - c.x) < c.w / 2 + .5 && z > q.y1 - .1) || near.some(([px, py]) => Math.hypot(px - x, py - z) < .55);
      const foot = (nx, nz) => (x, z) => Math.min(hAt(x + nx * .2, z + nz * .2), 0);   // the ground just outside (the pool lowers it)
      const dark = y => y < .45 ? -.05 : 0;
      const run = (pts, nx, nz, seed, more = {}) => ({pts, top: q.h, bot: foot(nx, nz), minBot: -.05, talus: true, avoid, lip, dark, seed, ...more});
      plateauRuns.push(
        run([[q.x0, q.y1], [q.x1, q.y1]], 0, 1, 31, {keep: keepS, minBot: WATER_H - .05}),   // south (the waterfall, the pool, the climb)
        run([[q.x1, q.y1], [q.x1, q.y0]], 1, 0, 37), run([[q.x1, q.y0], [q.x0, q.y0]], 0, -1, 41), run([[q.x0, q.y0], [q.x0, q.y1]], -1, 0, 43));
    }
    for (const c of CLIMBS) o.ladders.push({x: c.x, z: c.y, h: c.h1, y0: c.h0, nx: c.nx, nz: c.ny});   // (the plateau's, or the mesa's)
    // walkable terrain's rock (layout.js TERRAIN, shapes with rock: true): a terrace's edges, a ramp's sides as walls whose top follows
    // it. Each run's foot is the ground just outside (elev: the plateau's box too), so the rock is gone where a ramp meets a terrace,
    // the plateau or the ground, and only stands where there is a drop
    if (TERRAIN_ON) {
      const avoidT = (x, z) => wet(x, z) || near.some(([px, py]) => Math.hypot(px - x, py - z) < .55);
      const outward = (pts, cx, cz) => {   // a polyline's runs, travelled so that (-tz, tx) points away from (cx, cz)
        const a = pts[0], b = pts.at(-1), mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, tx = b[0] - a[0], tz = b[1] - a[1];
        return -tz * (mx - cx) + tx * (mz - cz) >= 0 ? pts : pts.slice().reverse();
      };
      const edgeRun = (pts, top, seed) => {
        const n = [0, 0], nrm = (x, z) => { let bx = 0, bz = 0; for (let i = 0; i + 1 < pts.length; i++) { const tx = pts[i + 1][0] - pts[i][0], tz = pts[i + 1][1] - pts[i][1], l = Math.hypot(tx, tz) || 1; bx += -tz / l; bz += tx / l; } const l = Math.hypot(bx, bz) || 1; n[0] = bx / l; n[1] = bz / l; return n; };
        nrm(0, 0); const nx = n[0], nz = n[1];
        let lo = 1e9; for (let i = 0; i + 1 < pts.length; i++) for (let k = 0; k <= 8; k++) { const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / 8, z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / 8; lo = Math.min(lo, elev(x + nx * .3, z + nz * .3)); }
        return {pts, top, bot: (x, z) => elev(x + nx * .3, z + nz * .3), minBot: lo - .05, base: .06, relief: .8, talus: true, avoid: avoidT, lip, seed};
      };
      // a terrace with a bank per point (the mesa): rock only along its cliffs (layout.js: the stretches of steep edges), each stretch ONE
      // run (the strata carry on round its bends); its foot is the lowest ground just round the face (the stretch bends, so no one
      // normal), flush at a ladder and no stones in front of one
      const ladder = (x, z, inner, outer, side) => CLIMBS.some(c => { const dx = x - c.x, dz = z - c.y, o = dx * c.nx + dz * c.ny, a = dz * c.nx - dx * c.ny; return Math.abs(a) < c.w / 2 + side && o > inner && o < outer; });
      const mesaRuns = (s, seed) => {
        const foot = (x, z) => Math.min(elev(x + .35, z), elev(x - .35, z), elev(x, z + .35), elev(x, z - .35));
        return (s.cliffs || []).map(({pts}, j) => {
          let lo = 1e9; for (const [x, z] of pts) lo = Math.min(lo, foot(x, z));
          return {pts, top: (x, z) => Math.max(TF.H(x + .55, z), TF.H(x - .55, z), TF.H(x, z + .55), TF.H(x, z - .55)), bot: foot, minBot: lo - .05, base: 0, relief: .9, talus: true, lip, seed: seed + j,   // (top: the ground inside its face, whichever way that is: blocks past a stretch's end sink with it)
            keep: (x, z) => ladder(x, z, -.4, .4, .08) ? -.02 : null, avoid: (x, z) => avoidT(x, z) || ladder(x, z, -.1, 1.2, .5), skip: (x, z) => inCleft(x, z, .02)};   // (no rock across a cleft's mouth)
        });
      };
      const terrRuns = [];
      TERRAIN.forEach((s, k) => {
        if (!s.rock) return;
        if (s.type === 'terrace' && s.banks) terrRuns.push(...mesaRuns(s, 61 + k * 13));
        else if (s.type === 'terrace') {
          const P = s.pts, cx = P.reduce((a, p) => a + p[0], 0) / P.length, cz = P.reduce((a, p) => a + p[1], 0) / P.length;
          P.forEach((p, i) => terrRuns.push(edgeRun(outward([p, P[(i + 1) % P.length]], cx, cz), s.h, 61 + k * 13 + i)));
        } else if (s.type === 'ramp') {   // its two sides, w / 2 off its line (per segment: the corner is the next segment's start)
          for (let i = 0; i + 1 < s.pts.length; i++) {
            const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1], l = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / l, uz = (bz - az) / l;
            for (const sd of [-1, 1]) {
              const ox = -uz * sd * s.w / 2, oz = ux * sd * s.w / 2, side = outward([[ax + ox, az + oz], [bx + ox, bz + oz]], (ax + bx) / 2, (az + bz) / 2);
              const r = edgeRun(side, null, 71 + k * 13 + i * 2 + (sd > 0 ? 1 : 0)), nn = [r.pts[1][1] - r.pts[0][1], r.pts[0][0] - r.pts[1][0]], nl = Math.hypot(...nn) || 1;
              r.top = (x, z) => TF.H(x + nn[0] / nl * .1, z + nn[1] / nl * .1);   // (the ramp's surface just inside the wall)
              terrRuns.push(r);
            }
          }
        }
      });
      // the clefts (layout.js CLEFTS): rock up their sides and round their chambers, facing in (a slot through the mesa's cliff)
      CLEFTS.forEach((c, j) => terrRuns.push({pts: cleftWall(c), top: (x, z) => Math.max(TF.H(x + .55, z), TF.H(x - .55, z), TF.H(x, z + .55), TF.H(x, z - .55)),
        bot: () => 0, minBot: -.05, base: 0, relief: .9, talus: true, avoid: avoidT, lip, seed: 131 + j}));
      // the creek's last step (layout.js CASCADES): a low rock rim along the pool's north edge, under the lip (the fall's sheet in its gap)
      if (CASCADES.length) {
        const F = CASCADES.at(-1), y = POOL.clip - .03;
        terrRuns.push({pts: [[POOL.x - 1.15, y], [POOL.x + 1.15, y]], top: (x, z) => TF.H(x, z - .4), bot: (x, z) => inPool(x, z + .2, 0, .25) ? WATER_H : TF.H(x, z + .3),
          minBot: WATER_H - .05, base: 0, relief: .7, talus: false, lip, seed: 97, skip: (x, z) => Math.abs(x - F.x) < F.hw + .02});
      }
      const stairs = TERRAIN.filter(s => s.type === 'ramp' && s.steps).map((s, k) => { const h0 = s.h0 ?? TF.H(...s.pts[0]), h1 = s.h1 ?? TF.H(...s.pts.at(-1)); return {pts: [s.pts[0], s.pts.at(-1)], w: s.w, h0, h1, n: stepsOf(h0, h1), seed: 29 + k}; });
      const tg = terrRuns.length ? cliffGeometry(terrRuns, {...o, ladders: [], bridges: BRIDGES.filter(b => !b.stone), stairs}) : null;   // (+ the footbridges, the stone steps; the brook's stone bridge and stones: below)
      if (tg) { const m = G.mesh(tg, 1, new THREE.Matrix4(), {static: true}); disposers.push(() => { m.dispose(); tg.dispose(); }); }
    }
    const pg = cliffGeometry(plateauRuns, o);
    if (pg) { const m = G.mesh(pg, 1, new THREE.Matrix4(), {static: true}); disposers.push(() => { m.dispose(); pg.dispose(); }); }
    // the ravine: along its edge line (the ground's own steep cells draw only the waterfall: the cliff texture's alpha, above),
    // gapped where the stream falls over it; shading toward its floor
    if (RAVINE) {
      const pts = [];
      for (let x = WORLD.x0 - SKIRT; x <= WORLD.x1 + SKIRT + 1e-6; x += .5) { const z = cliffZ(x); if (isFinite(z)) pts.push([x, z]); }
      const fallAt = (x, z) => { const zs = z - .35; return Math.abs(x - STREAM.cx(zs)) - STREAM.w(zs) / 2 < .04 || (!!westPx && brookFallOff(x, zs) < .04); };   // (and the brook's)
      if (pts.length > 1) {
        const rg = cliffGeometry([{pts, top: 0, bot: () => DROP, minBot: DROP - .05, relief: .85, skip: fallAt, lip,
          dark: y => -.34 * smooth(-y / 2.8), seed: 53}], {...o, ladders: []});
        if (rg) { const m = G.mesh(rg, 0, new THREE.Matrix4(), {static: true}); disposers.push(() => { m.dispose(); rg.dispose(); }); }
      }
    }
  }

  // ---- the West Downs' brook (world/brook.js): its stone arch bridge, its stepping stones and the rocks in its water, one static mesh
  // (world/bridge3d.js: the mason's stone); its deck and the stones' tops are layout.js decks (BRIDGES), the parapets 'parapet' props
  if (BROOK) {
    const bg = bridgeGeometry(BROOK, {fam: name => Math.max(0, FAMS.indexOf(name)), cover: R.cov ? FAMS.indexOf('cover') : null, ground: tH});
    if (bg) { const m = G.mesh(bg, 6, new THREE.Matrix4(), {static: true}); disposers.push(() => { m.dispose(); bg.dispose(); }); }
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
  // every item starts with ALL its fields (one shape: the per-frame loop's loads stay monomorphic). k*: what update() last
  // built the live mesh from (kv: the mesh's matrix version), kvis / kfl: the visibility and flash it last set
  const ITEM0 = {live: null, card: null, yaw: null, lsp: null, lrec: null, emSp: null, lean: null, manageMatrix: false,
    kx: NaN, ky: NaN, kz: NaN, kw: NaN, ks: NaN, kl: NaN, km: null, kv: -1, kvis: null, kfl: NaN, veil: false, own: false, pm: null, flora: null, rigid: false};   // own: another view draws it (own()); pm: a props3d.js model (the dummy, the crystal); flora: a 3D plant's instances (render/flora.js handles); rigid: it never leans (a cactus)
  let litterDirty = false;   // fallen leaves: a tree joined or left (bakeNow, below)
  let nextId = 10;
  const SHADOWLESS = new Set(['tuft', 'reed', 'fern']);
  if (haveGlb) await Promise.all([...new Set(props.map(stateOf).filter(Boolean))].map(s => glbGeometry(loader, s)));   // all at once
  const cardOf = (sp, o) => G.card({tex: texOf(sp.img), em: sp.emit ? texOf(sp.emit) : null, w: sp.img.width, h: sp.img.height, px: sp.pivot[0], py: sp.pivot[1], type: 3, bias: .00125, batch: true, ...o});   // batch: drawn with the other cards of its texture (gfx.js, stage 3)
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
  // THE LOW PLANTS IN 3D (bush, fern, tuft, reed: world/flora3d.js shapes, every plant of a shape in one instanced draw, render/flora.js):
  // a plant item has no card and no mesh of its own, it.flora = its instances (one per shape: a frost tuft is a snow mound and its
  // twigs); it.sp stays the painted sprite (what its card would have shown: the features that read a plant's size from it). Turned and
  // scaled per plant from its position; its autumn (plantOf) as the card's. ?flora=cards: the painted cards (an A/B)
  const flora = FLORA ? createFlora(G) : null;
  if (flora) { flora.setRamps(bladeRamps(biome.id, biome.style)); disposers.push(() => flora.dispose()); }
  const FLORA_KINDS = {bush: 1, fern: 1, tuft: 1, reed: 1}, TAU = Math.PI * 2;
  function floraOf(it, p) {
    if (!flora || !FLORA_KINDS[p.kind]) return null;
    const sh = floraShapes(p.kind, biome.id, p.variant, famOf); if (!sh || (!sh.mesh && !sh.blades)) return null;
    const yaw = hsh(p.x, p.y, 11) * TAU, sc = .88 + hsh(p.y, p.x, 13) * .24, seed = hsh(p.x, p.y, 17), pl = plantOf(p), z0 = p.z || 0, out = [];
    if (sh.mesh) out.push(flora.add(flora.shape(sh.key, sh.mesh.geo, 'mesh', {casts: sh.mesh.casts}), p.x, z0, p.y, yaw, sc, it.obj, pl, seed));
    if (sh.blades) out.push(flora.add(flora.shape(sh.key, sh.blades.geo, 'blade'), p.x, z0, p.y, yaw, sc, it.obj, pl, seed));
    it.rigid = sh.rigid; return out;
  }
  // procedural trees (trees3d.js): a live mesh instead of the painted card, turned and scaled per tree (it.pose)
  const famOf = name => Math.max(0, FAMS.indexOf(name));
  const treeOf = p => trees3d && p.kind === 'tree' && !p.painted ? treeModel(p, biome.id, famOf) : null;
  const placeOf = (it, x, h, z, M) => it.pose ? M.makeRotationY(it.pose.yaw).scale(_scl.setScalar(it.pose.scale)).setPosition(x, h, z) : it.pm ? placePm(it, x, h, z, M, 0) : M.makeTranslation(x, h, z);
  // a props3d.js model (?props2d=1: none, the cards): turned to its yaw; one that rocks when hit (the dummy) tipped about its foot by
  // w TILT steps (its wobble, update()) the way the shot went (push(), below) or, not known, back from its front
  const P2D = flags.get('props2d') === '1', TILT = {k: .012, steps: 8}, PUSH = new WeakMap();
  const PQ = new THREE.Quaternion(), PQY = new THREE.Quaternion(), PAX = new THREE.Vector3(), PV = new THREE.Vector3(), PUP = new THREE.Vector3(0, 1, 0), PONE = new THREE.Vector3(1, 1, 1);
  const pmOf = p => P2D ? null : propModel(p, biome, layout);
  function placePm(it, x, h, z, M, w) {
    PQY.setFromAxisAngle(PUP, it.pm.yaw);
    if (w) { const d = PUSH.get(it.p), dx = d ? d[0] : -Math.sin(it.pm.yaw), dy = d ? d[1] : -Math.cos(it.pm.yaw); PQ.setFromAxisAngle(PAX.set(dy, 0, -dx), w * TILT.k).multiply(PQY); }
    else PQ.copy(PQY);
    return M.compose(PV.set(x, h, z), PQ, PONE);
  }
  const pmLive = (it, m) => { if (!it.pm.occlude) m.sm.layers.disable(1); if (it.pm.glow) m.setGlow(0, famOf(it.pm.glow), it.pm.glowK(it.p.stage)); };
  // a crown overhangs: in the top-down height map it would stand as a solid pillar and black out the light under it
  // (props cast into the cached static sun shadow, gfx mesh {static}; the swaying 3D trees cast every frame). A tree brings its
  // autumn ramps (trees3d.js B.autumn): its crown turns spray by spray with the season (gfx.js MESH_FS)
  // the walls in stone (walls3d.js; ?walls=old: the kit's 1 m segments): each run (layout.js walls) built once and cut into a piece per
  // segment prop on its line (between the midpoints of their centres), each piece moved into its prop's frame: the prop's mesh
  // (towers and gateposts too: each its own geometry; every piece's own top goes to topOfProp)
  const wallGeo = new Map(), wo = {fam: famOf, cover: R.cov ? famOf('cover') : null}, wground = TERRAIN_ON ? (x, z) => elev(x, z) : null;
  const own = (p, g, top, full) => { if (g) { g.translate(-p.x, -(p.z || 0), -p.y); g.computeBoundingSphere(); g.computeBoundingBox(); disposers.push(() => g.dispose()); } wallGeo.set(p, g); TOPS.set(p, top); if (full !== undefined) FULL.set(p, full); };
  if (flags.get('walls') !== 'old') for (const run of layout.walls || []) {
    if (run.type === 'tower' || run.type === 'post') {   // the tower / post prop standing there
      const kind = run.type === 'tower' ? 'tower' : 'gatepost', p = props.find(q => q.kind === kind && Math.hypot(q.x - run.at[0], q.y - run.at[1]) < .1); if (!p) continue;
      const r = (run.type === 'tower' ? towerRun : postRun)({...run, x: p.x, z: p.y, ground: wground}, wo);
      own(p, r.geo, r.top); continue;
    }
    const [ax, az] = run.a, L = Math.hypot(run.b[0] - ax, run.b[1] - az), ux = (run.b[0] - ax) / L, uz = (run.b[1] - az) / L;
    // (its segments: on its line within run.tol (.3; the old field walls' legs, which meet at bends, closer), each taken once)
    const tol = run.tol ?? .3, sOf = p => (p.x - ax) * ux + (p.y - az) * uz;
    const segs = props.filter(p => p.kind === run.kind && !wallGeo.has(p) && Math.abs(-(p.x - ax) * uz + (p.y - az) * ux) < tol && sOf(p) > -.1 && sOf(p) < L + .1).sort((p, q) => sOf(p) - sOf(q));
    if (!segs.length) continue;
    const S = segs.map(sOf), cuts = [0, ...S.slice(1).map((v, i) => (S[i] + v) / 2), L];
    const {geos, tops} = wallRun({...run, cuts, ground: wground}, wo);
    segs.forEach((p, i) => own(p, geos[i] || null, tops[i], run.h));
  }
  // the standing stones (stonecircle.js): each 'menhir' prop its own stone and top (a lying stone's extra colliders: a top, no mesh)
  for (const r of stoneMeshes(props, wo, wground || undefined)) own(r.p, r.geo, r.top);
  STONE_LIGHTS.forEach((l, i) => groundL.push({x: l.x, y: l.h + (wground ? wground(l.x, l.y) : 0), z: l.y, c: rgbOf(l.color), r: l.radius, k: l.intensity, flicker: 0, id: 9500 + i, halo: l.halo}));
  // the West Downs' watchtower (world/watchtower.js, layout.js TOWER_PLAN): its mesh on the 'watchtower' prop, its colliders' own tops
  // (how high the wall stands over each: arrows stick in it up to there)
  if (TOWER_PLAN) {
    const r = watchtowerRun(TOWER_PLAN, wo, TF ? TF.H : () => 0);
    for (const p of props) if (p.kind === 'watchtower') own(p, r.geo, r.top - (p.z || 0)); else if (p.kind === 'towerwall') own(p, null, colTop(TOWER_PLAN, p.x, p.y, p.z || 0));
  }
  // (a rigid 3D tree, trees3d.js shape.rigid: the saguaros, spires, shards: a static mesh like any prop, no sway)
  const swayOf = it => !!it.pose && !it.pose.rigid;
  const liveOf = (it, geo, x, h, z) => { const m = G.mesh(geo, it.obj, placeOf(it, x, h, z, new THREE.Matrix4()), {sway: swayOf(it), static: !swayOf(it), autumn: it.pose?.autumn}); if (swayOf(it)) m.sm.layers.disable(1); if (it.pm) pmLive(it, m); return m; };
  for (const p of props) {
    const z0 = p.z || 0;
    if (p.outside && biome.hole?.(p.x, p.y, ctxO)) continue;   // over the ravine / in the stream
    const sp = biome.sprite(p, ctxO);
    const tm = treeOf(p), st = stateOf(p), pm = !tm && !st && !wallGeo.has(p) ? pmOf(p) : null;
    const geo = wallGeo.has(p) ? wallGeo.get(p) : tm ? tm.geo : pm ? pm.geo(p.stage) : st && haveGlb ? await glbGeometry(loader, st) : null;
    if (wallGeo.has(p) && !geo) continue;   // (a wall's piece with nothing left standing in it)
    const obj = WALL_ID[p.kind] ?? nextId++;
    const it = {p, st, obj, sp: null, hover: 0, pose: tm, ...ITEM0};
    it.pm = pm;
    if (geo) {
      it.live = liveOf(it, geo, p.x, z0, p.y);
      const yw = yawIdx && !wallGeo.has(p) && yawOf(p, st);   // (a stone wall's piece has no pre-renders)
      if (yw && yawIdx.frames[yw[0] + '_y0']) {
        it.yaw = {base: yw[0], off: yw[1], card: null};   // (its card: made the first time the pre-renders show, update(); 90 hidden cards in every scene cost each pass a walk)
      }
    } else if (sp && (it.flora = floraOf(it, p))) it.sp = sp;   // (a 3D plant)
    else if (sp) {
      it.card = cardOf(sp, {obj, shadow: !SHADOWLESS.has(p.kind), plant: plantOf(p)}); it.sp = sp;
      it.card.anchor = new THREE.Vector3(p.x, z0, p.y);
    } else continue;
    items.push(it); byProp.set(p, it);
  }
  disposers.push(() => items.forEach(it => { it.live?.dispose(); it.card?.dispose(); it.yaw?.card?.dispose(); }));
  // the later stages (damaged, broken, chest lids, debris chunks) load in the background
  if (haveGlb) loadGlbIndex().then(ix => ix && Object.keys(ix.states).forEach(s => glbGeometry(loader, s)));
  // an item for a prop created later (a feature adds props to world.props: extra crates, respawns)
  async function addItem(p) {
    if (byProp.has(p)) return byProp.get(p);
    const tm = treeOf(p), st = stateOf(p), pm = !tm && !st ? pmOf(p) : null, geo = tm ? tm.geo : pm ? pm.geo(p.stage) : st && haveGlb ? await glbGeometry(loader, st) : null, sp = biome.sprite(p, ctxO), obj = nextId++;
    if (p.dead || byProp.has(p)) return byProp.get(p) || null;   // gone (or added) while the model loaded
    const it = {p, st, obj, sp: null, hover: 0, pose: tm, ...ITEM0};
    it.pm = pm;
    if (geo) it.live = liveOf(it, geo, p.x, p.z || 0, p.y);
    else if (sp && (it.flora = floraOf(it, p))) it.sp = sp;   // (a 3D plant)
    else if (sp) { it.card = cardOf(sp, {obj, shadow: !SHADOWLESS.has(p.kind), plant: plantOf(p)}); it.sp = sp; } else return null;
    items.push(it); byProp.set(p, it); if (p.kind === 'tree') litterDirty = true; return it;
  }
  // a prop that leaves the world for good (a killed enemy): its card / mesh go with it
  function removeItem(p) {
    const it = byProp.get(p); if (!it) return;
    it.live?.dispose(); it.card?.dispose(); it.yaw?.card?.dispose(); if (it.flora) for (const h of it.flora) flora.remove(h);
    items.splice(items.indexOf(it), 1); byProp.delete(p); if (p.kind === 'tree') litterDirty = true;
  }
  // fallen leaves (LITTER): the trees as the bake wants them (a 3D tree's crown, rotated and scaled as it stands; a painted one's guess;
  // a dead tree none), and the bake itself. A tree that joined or left marks it dirty: update() bakes once before the next draw
  function bakeNow() {
    litterDirty = false; if (!lit) return;
    const trees = [], walls = [], blocks = [], discs = [], dead = p => (p.variant | 0) === 2;
    for (const it of items) {
      const p = it.p;
      if (p.rect) { walls.push(p.rect); if (!p.gone) blocks.push(p.rect); }
      else if (!p.gone && !p.broken && LEAF_SOLID.has(p.kind) && p.r > 0) discs.push([p.x, p.y, p.r]);
      if (p.kind !== 'tree' || p.gone) continue;
      discs.push([p.x, p.y, Math.min(LITTER.trunk, p.r || .22 * (it.pose?.scale || 1))]);   // the trunk
      const w = it.pose;
      if (w) {
        const c = w.crown; if (!c || w.litter === false) continue;   // (an evergreen sheds no leaves: trees3d.js shape.litter)
        const co = Math.cos(w.yaw), si = Math.sin(w.yaw), wl = w.species === 'willow';
        trees.push({x: p.x + (c.x * co + c.z * si) * w.scale, y: p.y + (c.z * co - c.x * si) * w.scale, R: c.r * w.scale * (wl ? LITTER.willow.r : 1.2), w: wl ? LITTER.willow.w : 1, autumn: w.autumn});
      } else if (it.card && !dead(p)) trees.push({x: p.x, y: p.y, R: (p.variant | 0) === 3 ? LITTER.willow.r * 1.15 : LITTER.card, w: 1, autumn: null});
    }
    const paths = layout.marks.filter(m => m.type === 'path'), fc = lit.cell;
    for (const q of PLATEAUS) for (const r of [[q.x0 - fc, q.y0 - fc, q.x1 + fc, q.y0], [q.x0 - fc, q.y1, q.x1 + fc, q.y1 + fc], [q.x0 - fc, q.y0, q.x0, q.y1], [q.x1, q.y0, q.x1 + fc, q.y1]]) blocks.push(r);   // the plateau's foot (and its lip): a wall of one cell
    if (!lit.sinkDone) bakeSink(lit, {WPX, HPX, PPM, wdata: wTex?.image.data, cliffZ});
    bakeLitter(lit, trees, {WPX, HPX, PPM, walls, paths, blocks, discs, dry: (x, y) => { if (y >= cliffZ(x)) return false; waterSample(x, y, _lw); return !_lw.kind; }});
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
    if (!L || hypot2(sx - d.x, sy - d.y) > TREE_HYST) { d.x = sx; d.y = sy; }
    it.live.setLean(d.x + (L?.shake || 0), d.y);
    const f = L?.flut || 0; it.live.setFlutter?.(f, f * .5);
    it.live.setRipple?.((L?.wx || 0) * RIP_K, (L?.wy || 0) * RIP_K, L?.ph || 0, L?.wave || 0);
  }
  // a 3D plant's lean (render/flora.js): the wind's spring as the trees' (leanTree: art px, the hysteresis), the clumps' dance a third of a
  // crown's (a bush's clump is a few px: more and its dome comes apart in a gale)
  function leanPlant(it, yaw) {
    const L = hooks.mesh?.(it), d = it.lean ||= {x: 0, y: 0};
    let sx = 0, sy = 0;
    if (L) { const c = Math.cos(yaw), s = Math.sin(yaw); sx = (L.x * c - L.y * s) * PPM; sy = (L.x * s + L.y * c) * ctxO.PPMY; }
    if (!L || hypot2(sx - d.x, sy - d.y) > TREE_HYST) { d.x = sx; d.y = sy; }
    const sh = L?.shake || 0, f = (L?.flut || 0) * .3;
    for (let i = 0; i < it.flora.length; i++) flora.setLean(it.flora[i], d.x + sh, d.y, f);
  }
  // every frame: follow the props (stage, lid, hop, wobble, flash, gone), collect their lights, pick the yaw frames.
  // A live mesh's model state and matrix are worked out only when what they're made of changed since the last frame
  // (position, wobble, stage, lid, who poses it) or someone else set its matrix since (mesh.ver: a burning prop's slump):
  // most props stand still, and their state strings, matrices and compares were most of this loop
  const DYN = {dynamic: true};
  // a sprite's light records (outside update's loop: a closure in the loop body, even in a branch seldom taken, made V8
  // allocate a context for every item every frame, ~6 KB of garbage)
  const lightRecs = (it, sp) => sp.lights.map((l, i) => ({x: 0, y: 0, z: 0, c: rgbOf(l.color), r: l.radius || 4, k: l.intensity ?? 1, flicker: l.flicker || 0, id: it.obj * 8 + i, l}));
  function update(yaw) {
    if (litterDirty) bakeNow();
    clearArray(lights); for (const l of groundL) lights.push(l);
    const k0 = -Math.round(yaw / step);
    for (const it of items) {
      const p = it.p, base = p.z || 0, z0 = base + (p.h || 0);
      const sp = biome.sprite(p, ctxO);
      if (sp?.lights) {   // the sprite's lights: records built when the sprite changes, only their positions move per frame
        if (it.lsp !== sp) { it.lsp = sp; it.lrec = lightRecs(it, sp); }
        for (const o of it.lrec) { o.x = p.x + (o.l.dx || 0); o.y = base + (o.l.h || 0); o.z = p.y + (o.l.dy || 0); lights.push(o); }
      }
      // (a props3d.js model that rocks when hit: its wobble in TILT steps, a turn about its foot (first with the shot), not the cards' 2 px shake)
      const tilt = it.pm !== null && it.pm.tilt, wob = p.wob ? Math.round(Math.sin(p.wob * 18) * p.wob * (tilt ? -TILT.steps : 2)) : 0, flash = Math.min(1, Math.max(p.flash || 0, it.hover || 0));
      const useYaw = mode === 'yaw' && it.yaw && !p.stage && !it.manageMatrix && !p.gone && !it.veil && !it.own;
      if (it.live) {
        const L = it.live;
        if (p.x !== it.kx || p.y !== it.ky || z0 !== it.kz || wob !== it.kw || p.stage !== it.ks || p.lid !== it.kl || it.manageMatrix !== it.km || L.ver !== it.kv) {
          const st = stateOf(p); if (st && st !== it.st) setState(it, st);
          if (it.pm !== null && p.stage !== it.ks) { L.setGeometry(it.pm.geo(p.stage)); if (it.pm.glow) L.setGlow(0, famOf(it.pm.glow), it.pm.glowK(p.stage)); }   // (the crystal cracks, breaks, grows back)
          if (it.pm !== null) { if (!it.manageMatrix) L.setMatrix(placePm(it, tilt ? p.x : p.x + wob / PPM, z0, p.y, M, tilt ? wob : 0)); }
          else if (!it.manageMatrix) L.setMatrix(placeOf(it, p.x + wob / PPM, z0, p.y, M));
          it.kx = p.x; it.ky = p.y; it.kz = z0; it.kw = wob; it.ks = p.stage; it.kl = p.lid; it.km = it.manageMatrix; it.kv = L.ver;
        }
        if (it.pose && !it.pose.rigid) leanTree(it, yaw);
        const vis = !p.gone && !useYaw && !it.veil && !it.own; if (vis !== it.kvis) { it.kvis = vis; L.setVisible(vis); }   // (the world is their only writer)
        if (flash !== it.kfl) { it.kfl = flash; L.flash = flash; }
      }
      if (it.flora) {   // a 3D plant: its instances (render/flora.js) shown or not, flashed, moved, leaned
        const F = it.flora, vis = !p.gone && !!sp && !it.veil;
        if (vis !== it.kvis) { it.kvis = vis; for (let i = 0; i < F.length; i++) flora.setVisible(F[i], vis); }
        if (flash !== it.kfl) { it.kfl = flash; for (let i = 0; i < F.length; i++) flora.setFlash(F[i], flash); }
        if (p.x !== it.kx || p.y !== it.ky || z0 !== it.kz) { it.kx = p.x; it.ky = p.y; it.kz = z0; for (let i = 0; i < F.length; i++) flora.setPlace(F[i], p.x, z0, p.y); }
        if (vis && !it.rigid) leanPlant(it, yaw);
      }
      if (it.yaw && (useYaw || it.yaw.card)) {
        it.yaw.card ??= G.card({tex: texOf(yawAlb), nrm: texOf(yawNrm), w: 1, h: 1, px: 0, py: 0, type: 7, obj: it.obj, bias: .00125});
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
        if (hk?.em) { it.card.g.uniforms.uEm.value = G.tex(hk.em, DYN); it.card.g.uniforms.uHasEm.value = 1; it.emSp = null; }
        else if (it.sp && it.emSp !== it.sp) { it.emSp = it.sp; it.card.g.uniforms.uEm.value = it.sp.emit ? texOf(it.sp.emit) : null; it.card.g.uniforms.uHasEm.value = it.sp.emit ? 1 : 0; }
        it.card.flash = flash; it.card.setVisible(!p.gone && !!sp && !it.veil && !it.own);
      }
    }
    flora?.commit();
  }
  const yawCount = items.filter(it => it.yaw).length, liveCount = items.filter(it => it.live).length, cardCount = items.filter(it => it.card).length, floraCount = items.filter(it => it.flora).length;
  litterDirty = true;   // (the first bake: the trees are all here)
  return {layout, props, lights, items, litter: lit && lit.stats, leaves: lit, markLitter() { litterDirty = true; },   // markLitter: re-bake the fallen leaves (a tree's palette changed)
    setMode, update, hooks, addItem, removeItem, get mode() { return mode; }, yawCount, liveCount, cardCount, floraCount, flora, haveGlb, groundCanvas: gc, westCanvas, trees3d,
    itemOf: p => byProp.get(p) || null,
    // a view's veil over a prop (features/omens/fog.js: an enemy lost in the fog): not drawn, nothing else changes (the
    // sim, its collider, the registry). It stays until lifted: veil(p, false)
    veil(p, on) { const it = byProp.get(p); if (it) it.veil = !!on; },
    // another view draws this prop itself (features/brutes3d.js: a brute as a 3D body): its card / mesh hidden, nothing else
    // changes (its item stays: the contact shadow, the hover). -> false while it has no item yet (addItem is async). veiled(p):
    // whether a veil is on it (the view that draws it keeps to the veils too)
    own(p, on) { const it = byProp.get(p); if (it) it.own = !!on; return !!it; },
    veiled: p => !!byProp.get(p)?.veil,
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
    // It doesn't block point lights unless o.occlude (tumbling chunks next to a blast threw black spikes everywhere).
    // o.static: it never moves (its sun shadow goes in the cached static map, gfx mesh {static})
    mesh: (geo, matrix, o = {}) => {
      const m = G.mesh(geo, nextId++, matrix || new THREE.Matrix4(), {static: !!o.static}), d = m.dispose; extra.add(m); m.dispose = () => { extra.delete(m); d(); };
      if (!o.occlude) m.sm.layers.disable(1);
      if (o.shadow === false) m.sm.layers.disableAll();   // (casts nothing: a flame, a lily pad flat on the water)
      return m;
    },
    // which way a view saw a prop struck (features/wind.js, from combat.hit): a props3d.js model that rocks when hit (the dummy)
    // rocks that way. Arena axes; kept per prop until the next
    push(p, dx, dy) { const l = Math.hypot(dx, dy); if (!(l > 1e-6)) return; let d = PUSH.get(p); if (!d) PUSH.set(p, d = [0, 0]); d[0] = dx / l; d[1] = dy / l; },
    waterH: WATER_H, biome, ctxO, dispose() { disposers.forEach(f => f()); [...extra].forEach(m => m.dispose()); }};
}
export {WORLD, GROUNDS, WEST_ON, WEST, WEST_LAND, PLAY, TRAIL, walkable, roamable, navArea, elev, inStream, PLATEAUS, SPRING, RILL, FALL, POOL, OUTFLOW, inPool, poolEdge, rillAt, inRill, outflowAt, inOutflow, steep, TERRAIN_ON, terrainField, onGround, sameLevel, MESA, CLIMBS, CASCADES, mesaAt};
