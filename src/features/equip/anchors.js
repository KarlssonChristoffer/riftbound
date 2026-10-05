// LASSO ANCHORS: the lasso's own high anchors (features/equip/lasso.js swings from them), there only while the lasso is
// (the equipment experiment on and a gun loadout) and only in the biomes that have a place for them. Old dead trees
// ("snags") leaning out over the stream's wide parts, one off the plateau's west edge over the ledge and the stream: a
// swing from the far bank lands you on top, and one from the top drops you over the water to the far bank. In the
// Proving Grounds they're dark oak, in Red Mesa bleached cottonwood. A frayed old rope hangs off each limb's end (a hint).
//   sim    each a collider in the registry (kind 'lasso_snag': its trunk), and the limb's segments the loop can catch
//          (world: x0 y0 h0 x1 y1 h1 r); joined / left by update(want) (the feature's sim step)
//   view   one static mesh per snag (world/kit3d.js: the props' look, toned by the biome's ramps, in the cached static sun
//          shadow), made for each world they stand in (draw(): a rebuild disposed the last)
// OWNS: its entities, its segment table, its meshes. READS: host.biome, host.world. BUDGET: nothing per step but a check;
// per frame nothing (static meshes, culled by the camera).
import * as THREE from 'three';
import {along, geoOf} from '../../world/kit3d.js';
import {propTop, TERRAIN_ON} from '../../world/world.js';

propTop({lasso_snag: 4.3});   // (how high it stops an arrow: the trunk; the limb above is the lasso's)
// where they stand (arena metres): base (x, y, the ground's height there), the limb's tip (x, y, h over the ground at the
// base), which way the bank is (the trunk leans out over the water)
const SNAGS = [
  TERRAIN_ON ? {base: [45.95, 3.4], z: 2.4, tip: [40.9, 3.7, 4.7], seed: 3}   // (walkable terrain: on the mesa's west cliff, north of its gully)
    : {base: [44.25, 7.7], z: 2.4, tip: [40.7, 7.9, 4.7], seed: 3},      // on the plateau by its west edge, out over the ledge and the stream
  {base: [37.0, 23.55], z: 0, tip: [41.8, 25.2, 5.8], seed: 7},       // from the west bank over the stream's south stretch (its trunk north of
                                                                       // where you run out under the limb: behind you from the default camera)
];
const BIOMES = {ruins: 'bark', desert: 'wood'};

// a snag's parts (kit3d), in the world: roots, a leaning trunk, the big limb out over the water (a droop), two broken stubs,
// a frayed rope off the limb's end. Returns {parts, segs: the limb as [x0, y0, h0, x1, y1, h1, r] x n}
function snag(S, fam) {
  const [bx, by] = S.base, z = S.z, [tx, ty, th] = S.tip, P = [], segs = [];
  let s = S.seed * 9301 + 49297; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const dx = tx - bx, dy = ty - by, dl = Math.hypot(dx, dy), ux = dx / dl, uy = dy / dl;
  const V = (x, y, h) => [x, h, y];   // (kit3d's frame: x east, y up, z south)
  // the trunk: three pieces leaning toward the water, tapering
  const T0 = [bx, by, z], T1 = [bx + ux * .35, by + uy * .35, z + 1.5], T2 = [bx + ux * .95, by + uy * .95, z + 2.9], T3 = [bx + ux * 1.55, by + uy * 1.55, z + 3.9];
  const tr = [[T0, T1, .36, .3], [T1, T2, .3, .24], [T2, T3, .24, .2]];
  for (const [a, b, r0, r1] of tr) P.push({...along(V(...a), V(...b), r0, r1, 7), fam});
  for (let k = 0; k < 4; k++) {   // roots: flared, half sunk
    const a = k / 4 * Math.PI * 2 + rnd() * .6, c = Math.cos(a), sn = Math.sin(a);
    P.push({...along(V(bx + c * .15, by + sn * .15, z + .32), V(bx + c * .75, by + sn * .75, z - .06), .17, .07, 5), fam});
  }
  // the limb: from the trunk's top out to the tip, drooping a little in the middle, tapering
  const n = 4, pts = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n, x = T3[0] + (tx - T3[0]) * k, y = T3[1] + (ty - T3[1]) * k, h = T3[2] + (z + th - T3[2]) * k + Math.sin(k * Math.PI) * .35 - k * k * .25;
    pts.push([x, y, h]);
  }
  for (let i = 0; i < n; i++) {
    const r0 = .2 - .13 * i / n, r1 = .2 - .13 * (i + 1) / n, a = pts[i], b = pts[i + 1];
    P.push({...along(V(...a), V(...b), r0, r1, 6), fam});
    segs.push([a[0], a[1], a[2], b[0], b[1], b[2], Math.max(r0, .12)]);
  }
  // broken stubs off the trunk's top, up and back; the snapped crown
  P.push({...along(V(...T3), V(T3[0] - ux * .5 + uy * .3, T3[1] - uy * .5 - ux * .3, T3[2] + 1.1), .14, .06, 5), fam});
  P.push({...along(V(...T2), V(T2[0] + uy * .7, T2[1] - ux * .7, T2[2] + .6), .11, .05, 5), fam});
  P.push({...along(V(...T3), V(T3[0] + ux * .1, T3[1] + uy * .1, T3[2] + .55), .19, .1, 6), fam});
  // the old rope off the limb's end: a few pieces hanging, frayed short
  const E = pts[n - 1], hang = [[E[0], E[1], E[2] - .05], [E[0] + .04, E[1] + .02, E[2] - .7], [E[0] + .02, E[1] + .05, E[2] - 1.25]];
  P.push({...along(V(...hang[0]), V(...hang[1]), .025, .025, 4), fam: 'rope'});
  P.push({...along(V(...hang[1]), V(...hang[2]), .025, .02, 4), fam: 'rope'});
  return {parts: P, segs};
}

export function createAnchors(host) {
  const list = {seg: new Float64Array(64 * 7), n: 0, src: []};   // the limbs (features/equip/lasso.js gather): segments, the snag of each
  const ents = [], built = {};   // the colliders in the world; per family and snag {geo, segs} (made once)
  let on = false, biome = '', world = null, meshes = [];
  function join(fam) {
    list.n = 0;
    for (let i = 0; i < SNAGS.length; i++) {
      const S = SNAGS[i], key = fam + i;
      let b = built[key]; if (!b) { const m = snag(S, fam); b = built[key] = {geo: geoOf(m.parts), segs: m.segs}; }
      const p = {kind: 'lasso_snag', x: S.base[0], y: S.base[1], z: S.z, r: .34, anchor: i};
      host.entities.add(p); ents.push(p);
      for (const g of b.segs) if (list.n < 64) { list.seg.set(g, list.n * 7); list.src[list.n++] = p; }
    }
  }
  function leave() { for (const p of ents) host.entities.remove(p); ents.length = 0; list.n = 0; list.src.length = 0; }
  function drop() { for (const m of meshes) m.dispose(); meshes = []; world = null; }
  return {
    list,
    get on() { return on; },
    // the sim's step: there or not (want: the lasso is in play), per biome
    update(want) {
      const fam = want ? BIOMES[host.biome.id] : null, b = fam ? host.biome.id : '';
      if (!!fam === on && b === biome) return;
      if (on) leave();
      on = !!fam; biome = b;
      if (on) join(fam);
    },
    // the view: the meshes for this world (a rebuild disposed the ones it lent us)
    draw() {
      if (!on) { if (meshes.length) drop(); return; }
      if (host.world === world && meshes.length) return;
      if (host.world !== world) meshes = [];   // (a rebuild disposed the ones the last world lent us)
      drop(); world = host.world;
      const fam = BIOMES[biome];
      for (let i = 0; i < SNAGS.length; i++) meshes.push(host.world.mesh(built[fam + i].geo, new THREE.Matrix4(), {occlude: true, static: true}));
    },
    biomeChanged() { meshes = []; world = null; },   // (the old world's meshes are gone with it)
    clear() { if (on) leave(); on = false; biome = ''; },
    dropMeshes: drop,   // (the feature switched off: its frame no longer runs)
  };
}
