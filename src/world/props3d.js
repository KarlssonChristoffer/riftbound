// PROPS3D: procedural 3D models for world props that were painted camera-facing cards (the true-3D pivot): the training
// dummy and the breakable crystal. A model is ONE geometry per stage with the prop pipeline's attributes (kit3d.geoOf: aPart /
// aFam / aBias / aFixed), toned by the biome's ramps, outlined, seamed, lit per pixel and casting a sun shadow like every live
// prop; it reads right from every side. world.js makes the live mesh (instead of the card) and poses it; ?props2d=1 keeps the cards.
//   dummy    a straw man on a post: a cross-plank foot, the post, an arm bar at ARM.h with straw at its ends, a straw body bound
//            with two bands, a burlap sack head, a painted target on its chest AND its back (shot from either side it reads as
//            a target). Ember: charred planks, an iron breastplate and helmet, embers glowing in the wood (the crack family);
//            frost: icicles under the arms (the snow on its top is the biome's cover); rift: a crystal on a stone post, a rune
//            ring round it. It faces the screen of the camera's home view (+y), so its target reads face on where you play (turned
//            to the lane's mark it stood edge on). The hit wobble is a real rock about its foot (world.js), the way the shot went (world.push)
//   crystal  a rock with a cluster of hexagonal crystals, pointed, leaning out (stage 0); cracked, the big one's tip and the
//            right one snapped off (1); stubs broken flat with shards lying round (2, broken). The gem family lights itself
//            (mesh.setGlow: GLOW_K per stage); the light is the painted sprite's record as before (world.js reads it off the card)
//   gemChunk a crystal shard for the debris (features/combat/props.js)
// propModel(p, biome, layout) -> {geo(stage) -> geometry, yaw, tilt (rocks when hit), occlude (blocks point lights: neither does: the
//   rail dummy moves, a hit one rocks, and a moving occluder re-renders the height map; the crystal's light is inside it), glow (the
//   family that lights itself: FAMS name, or null), glowK(stage)} | null (not a kind made here: the card stays)
// ARM: where the dummy's arm bar is in its own frame (x along the arm, y up, z its front): features/wind.js ties its strips there.
// Frame: x right (the arm), y up, z the front (the way it faces), metres, origin = the ground point. Seeded (ART.rng), no
// Math.random; shapes are cached per (kind, biome).
import * as THREE from 'three';
import {geoOf, M4, box, along} from './kit3d.js';
import {ART} from './biomes.js';
import {FAMS} from './world.js';   // (read when a model is made, never at load: world.js imports this module)
import {hash3 as hsh} from '../core/mathx.js';

const TAU = Math.PI * 2;
export const ARM = {h: .87, half: .4};   // the dummy's arm bar: its height and half its length (m)
const GLOW_K = {crystal: [.8, .55, .3], rift: .45};   // the crystal's self-light per stage; the rift dummy's crystal

// ---------------------------------------------------------------- part helpers (kit3d parts: {g, m, fam, bias?, fixed?})
const cyl = (fam, r0, r1, h, pos, rot = [0, 0, 0], seg = 8, o = {}) => ({g: new THREE.CylinderGeometry(r1, r0, h, seg), m: M4(pos, rot), fam, ...o});
const lump = (fam, pos, rot, scl, o = {}, detail = 0) => ({g: new THREE.IcosahedronGeometry(1, detail), m: M4(pos, rot, scl), fam, ...o});
// a thin disc facing along z (a painted target ring) at height y, its middle at z
const disc = (fam, r, z, y, o = {}) => ({g: new THREE.CylinderGeometry(r, r, .012, 12), m: M4([0, y, z], [Math.PI / 2, 0, 0]), fam, ...o});

// a crystal: a hexagonal prism from its foot (at `at`) along the direction (yaw, lean), radius r, length len, pointed (tip) or
// broken flat (cut: the prism only, its top a little askew)
function crystal(L, at, yaw, lean, r, len, o = {}) {
  const dir = new THREE.Vector3(Math.sin(lean) * Math.sin(yaw), Math.cos(lean), Math.sin(lean) * Math.cos(yaw));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), spin = o.spin ?? 0;
  const qs = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin);
  const body = o.cut ? len : len * .78, tip = len - body, A = new THREE.Vector3(...at), S = new THREE.Vector3(1, 1, 1);
  const place = (g, y) => ({g, m: new THREE.Matrix4().compose(A.clone().addScaledVector(dir, y), q.clone().multiply(qs), S), fam: o.fam || 'gem', bias: o.bias || 0});
  L.push(place(new THREE.CylinderGeometry(r, r * (o.foot ?? .92), body, 6), body / 2));
  if (!o.cut) L.push(place(new THREE.ConeGeometry(r, tip, 6), body + tip / 2));
  else L.push({...place(new THREE.CylinderGeometry(r * .82, r, .02, 6), body + .01), bias: .2});   // the fracture: a paler facet
}

// ---------------------------------------------------------------- the dummy
function strawDummy(id) {
  const L = [], frost = id === 'frost';
  L.push(box('wood', [.66, .06, .1], [0, .03, 0], [0, .35, 0]), box('wood', [.1, .06, .66], [0, .03, 0], [0, .35, 0], {bias: -.1}));   // the foot
  L.push(box('wood', [.13, .1, .13], [0, .1, 0], [0, .35, 0], {bias: .1}));
  L.push({...along([0, .05, 0], [0, 1.02, 0], .045, .04, 6), fam: 'wood'});                                              // the post
  L.push(box('wood', [ARM.half * 2, .05, .05], [0, ARM.h, 0], [0, 0, 0], {bias: .1}));                                    // the arm bar
  for (const s of [-1, 1]) {   // straw bound round the bar's ends
    L.push(cyl('rope', .05, .05, .13, [s * (ARM.half - .07), ARM.h, 0], [0, 0, Math.PI / 2], 6, {bias: -.05}));
    L.push(cyl('rope', .052, .052, .025, [s * (ARM.half - .1), ARM.h, 0], [0, 0, Math.PI / 2], 6, {fixed: 2}));
  }
  const tw = Math.PI / 12;   // (a face of the 12-gon to the front: the target sits flat on it)
  // (as stout as the painted card's: ~.5 m across, and the arrows, stopped at its .3 m collider, stick in close to the straw)
  L.push(cyl('rope', .15, .25, .3, [0, .47, 0], [0, tw, 0], 12), cyl('rope', .25, .15, .36, [0, .8, 0], [0, tw, 0], 12));   // the straw body, a fat oval (streaked: streak())
  for (const [y, r] of [[.43, .2], [.9, .185]]) L.push(cyl('rope', r + .012, r + .012, .035, [0, y, 0], [0, tw, 0], 12, {fixed: 2}));   // its bands
  for (let i = 0; i < 8; i++) {   // straw poking out at the hem
    const a = i / 8 * TAU + .2;
    L.push({g: new THREE.ConeGeometry(.03, .1, 4), m: M4([Math.sin(a) * .19, .29, Math.cos(a) * .19], [Math.PI + Math.cos(a) * .35, 0, -Math.sin(a) * .35]), fam: 'rope', bias: (i & 1) * .15 - .1});
  }
  L.push(cyl('rope', .06, .07, .07, [0, 1.01, 0], [0, 0, 0], 6, {fixed: 2}));                                            // the neck tie
  L.push(lump('rope', [0, 1.19, 0], [.2, .4, .1], [.15, .15, .145], {bias: -.22}, 1));                                   // the sack head (burlap: the straw's darker tones)
  const fz = .228 * Math.cos(tw) + .004, fy = .7;
  for (const s of [1, -1]) L.push(disc('red', .105, s * fz, fy), disc('bone', .06, s * (fz + .006), fy, {fixed: 0}), disc('red', .024, s * (fz + .012), fy, {fixed: 1}));   // the target, front and back
  if (frost) for (const [x, l] of [[-.3, .11], [-.21, .07], [.19, .1], [.28, .08], [-.1, .06], [.09, .08]])   // icicles under the arms and the hem
    L.push({g: new THREE.ConeGeometry(.018, l, 4), m: M4([x, (Math.abs(x) > .15 ? ARM.h - .03 : .3) - l / 2, .01], [Math.PI, 0, 0]), fam: 'clay', bias: .1});
  return L;
}
function emberDummy() {   // charred planks round the post, an iron breastplate and helmet, embers in the wood
  const L = [];
  L.push(box('wood', [.66, .06, .1], [0, .03, 0], [0, .35, 0]), box('wood', [.1, .06, .66], [0, .03, 0], [0, .35, 0], {bias: -.1}));
  L.push({...along([0, .05, 0], [0, 1.0, 0], .045, .04, 6), fam: 'wood'});
  L.push(box('wood', [ARM.half * 2, .05, .05], [0, ARM.h, 0], [0, 0, 0], {bias: .1}));
  for (let i = 0; i < 4; i++) L.push(box('wood', [.085, .6, .035], [-.13 + i * .087, .62, .11], [0, 0, (i - 1.5) * .02], {bias: (i & 1) * .12 - .06}));   // planks: front
  for (let i = 0; i < 4; i++) L.push(box('wood', [.085, .6, .035], [-.13 + i * .087, .62, -.11], [0, 0, (i - 1.5) * -.02], {bias: -.1}));             // back
  for (const s of [-1, 1]) L.push(box('wood', [.035, .6, .2], [s * .17, .62, 0], [0, 0, 0], {bias: s * .1}));
  L.push(box('metal', [.3, .3, .04], [0, .75, .145], [-.08, 0, 0], {bias: .15}), box('metal', [.3, .3, .04], [0, .75, -.145], [.08, 0, 0], {bias: -.1}));   // the breastplate
  L.push(cyl('metal', .15, .13, .15, [0, 1.12, 0], [0, 0, 0], 8), {g: new THREE.SphereGeometry(.13, 8, 3, 0, TAU, 0, Math.PI / 2), m: M4([0, 1.195, 0]), fam: 'metal', bias: .2});   // the helmet
  L.push(box('void', [.16, .025, .02], [0, 1.12, .145], [0, 0, 0], {fixed: 2}));   // its visor slit
  for (const [x, y, z] of [[-.09, .45, .13], [.07, .86, .13], [.1, .4, -.13], [-.05, .7, -.13]]) L.push(box('crack', [.04, .03, .015], [x, y, z]));   // embers (the ember biome lights its crack family)
  for (const s of [1, -1]) L.push(disc('red', .085, s * .168, .78), disc('void', .045, s * .174, .78, {fixed: 1}));   // the target painted on the plate, front and back
  return L;
}
function riftDummy() {   // a crystal on a stone post, a rune ring round it
  const L = [];
  L.push(box('stone', [.4, .08, .4], [0, .04, 0], [0, .3, 0], {bias: .1}), box('stone', [.14, .5, .14], [0, .32, 0], [0, .3, 0]));
  crystal(L, [0, .5, 0], 0, .04, .17, 1.0, {bias: .05});
  for (const [a, l, r, h] of [[.6, .32, .06, .62], [2.5, .26, .05, .75], [4.3, .36, .065, .58]]) crystal(L, [Math.sin(a) * .1, h, Math.cos(a) * .1], a, .55, r, l, {bias: -.05});
  L.push({g: new THREE.TorusGeometry(.22, .016, 4, 16), m: M4([0, .98, 0], [Math.PI / 2, 0, 0]), fam: 'rune'});
  return L;
}

// ---------------------------------------------------------------- the crystal (stage 0 whole, 1 cracked, 2 stubs)
function crystalCluster(stage) {
  const L = [], r = ART.rng(41);
  L.push(lump('rock', [0, .06, 0], [0, .4, 0], [.44, .16, .38], {bias: -.05}), lump('rock', [.22, .04, -.12], [.5, 1, .2], [.18, .1, .16], {bias: .1}));
  // [x, z, yaw, lean, radius, length] the cluster: the big one leaning a little back, the others fanning out
  const C = [[0, 0, 3.4, .1, .17, 1.18], [-.2, .05, -1.3, .42, .1, .66], [.2, -.02, 1.4, .38, .11, .8], [.05, .2, .2, .55, .07, .42], [-.08, -.2, 3.0, .5, .075, .48], [.17, .17, .9, .7, .05, .3]];
  C.forEach(([x, z, yaw, lean, rad, len], i) => {
    const o = {bias: (r() - .5) * .25, spin: r() * 1.2};
    if (stage === 2) crystal(L, [x, .06, z], yaw, lean * .8, rad, Math.min(len, .16 + r() * .18), {...o, cut: true});
    else if (stage === 1 && (i === 0 || i === 2)) crystal(L, [x, .06, z], yaw, lean, rad, len * (i === 0 ? .7 : .45), {...o, cut: true});
    else crystal(L, [x, .06, z], yaw, lean, rad, len, o);
  });
  if (stage === 2) for (const [x, z, a] of [[-.5, .2, .3], [.52, -.1, 1.9], [.3, .45, 4], [-.35, -.42, 2.6]])   // shards lying round
    L.push({g: new THREE.OctahedronGeometry(1, 0), m: M4([x, .025, z], [1.2, a, .3], [.06, .03, .1]), fam: 'gem', bias: .1});
  return L;
}
// a hanging lantern (the wind decor's, the stall's, the mine's): a ring on top, a cap, a glass box in four corner posts, a base.
// Frame: origin = the top of its ring (it hangs from there), y up, so the body is below 0; ~.27 m. The glass is the flame family:
// light it with mesh.setGlow(slot, FAMS 'flame', k)
export function lanternParts(s = 1) {
  const L = [], v = (x, y, z) => [x * s, y * s, z * s];
  L.push({g: new THREE.TorusGeometry(.024 * s, .007 * s, 3, 8), m: M4(v(0, -.026, 0)), fam: 'metal', bias: .2});
  L.push({g: new THREE.ConeGeometry(.085 * s, .055 * s, 6), m: M4(v(0, -.075, 0)), fam: 'metal', bias: .25});
  L.push(cyl('metal', .088 * s, .088 * s, .014 * s, v(0, -.105, 0), [0, 0, 0], 6, {bias: -.1}));
  L.push(box('flame', [.11 * s, .125 * s, .11 * s], v(0, -.175, 0), [0, 0, 0], {fixed: 1}));
  for (const x of [-1, 1]) for (const z of [-1, 1]) L.push(box('metal', [.018 * s, .135 * s, .018 * s], v(x * .057, -.175, z * .057), [0, 0, 0], {bias: x < 0 ? .15 : -.15}));
  L.push(cyl('metal', .07 * s, .078 * s, .022 * s, v(0, -.25, 0), [0, 0, 0], 6, {bias: -.2}));
  return L;
}
export function gemChunk() { return geoOf([{g: new THREE.OctahedronGeometry(1, 0), m: M4([0, .05, 0], [.4, .3, .2], [.05, .05, .12]), fam: 'gem', bias: .1}]); }

// straw: the family's faces toned in streaks (a tone bias per sector round the y axis, n sectors, and per part), so a bundle
// reads as stalks, not a smooth tube (as trees3d.js jitters its crowns' tones)
function streak(geo, fam, amt, n, seed) {
  const j = FAMS.indexOf(fam), P = geo.attributes.position.array, F = geo.attributes.aFam.array, B = geo.attributes.aBias.array, X = geo.attributes.aFixed.array, Pt = geo.attributes.aPart.array;
  for (let t = 0; t < F.length; t += 3) {
    if (F[t] !== j || X[t] !== -1) continue;
    const cx = P[t * 3] + P[t * 3 + 3] + P[t * 3 + 6], cz = P[t * 3 + 2] + P[t * 3 + 5] + P[t * 3 + 8];
    const k = Math.floor((Math.atan2(cx, cz) / TAU + 1) * n) % n, b = (hsh(k, Pt[t], seed) - .5) * amt;
    B[t] += b; B[t + 1] += b; B[t + 2] += b;
  }
  geo.attributes.aBias.needsUpdate = true; return geo;
}

// ---------------------------------------------------------------- the models
const cache = new Map();
const cached = (key, fn) => { let v = cache.get(key); if (!v) cache.set(key, v = fn()); return v; };
// which way a dummy faces: +y, toward the camera's home view (yaw 0), every one alike: its target face on where you play.
// (Turned to the lane's mark, the lane's dummies stood edge on to the screen and read as facing the wrong way.)
const DUMMY_YAW = 0;
export function propModel(p, biome, layout) {
  const id = biome.id;
  if (p.kind === 'dummy') {
    const k = id === 'ember' ? 'ember' : id === 'rift' ? 'rift' : id === 'frost' ? 'frost' : 'straw', geo = cached('dummy|' + k, () => k === 'ember' ? geoOf(emberDummy()) : k === 'rift' ? geoOf(riftDummy()) : streak(geoOf(strawDummy(id)), 'rope', .55, 12, 3));
    return {geo: () => geo, yaw: DUMMY_YAW, tilt: true, occlude: false, glow: k === 'rift' ? 'gem' : null, glowK: () => GLOW_K.rift};
  }
  if (p.kind === 'crystal') {
    const G = [0, 1, 2].map(s => cached('crystal|' + s, () => geoOf(crystalCluster(s))));
    // (not a point-light occluder: its own light stands inside it)
    return {geo: st => G[Math.max(0, Math.min(2, st | 0))], yaw: ((p.x * 7.3 + p.y * 3.1) % TAU), tilt: false, occlude: false, glow: 'gem', glowK: st => GLOW_K.crystal[Math.max(0, Math.min(2, st | 0))]};
  }
  return null;
}
