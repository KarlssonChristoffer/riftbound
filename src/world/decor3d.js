// DECOR3D: the forest floor's small things (world/forest.js F.decor: stumps, fallen logs, windthrows, fly agarics, chanterelles, blueberries;
// content/recipes.js, docs/ASSETS.md) drawn INSTANCED through the world's flora (render/flora.js): every instance of one recipe's
// variant in one draw, so ~400 things cost ~15 draws. A variant is (recipe, v, its params): forest.js keeps them few (3 a recipe).
// Placed once when the world is built, never moved: no per-frame work. View only (no entity, nothing the sim reads but the
// windthrows' colliders below), the same on every co-op client (the plan is a pure function of the seed). The stumps, logs and windthrows cast sun shadows, the
// small ones don't. A windthrow is solid: its colliders are layout.js's (forest.js F.decorSolid), their tops set here (TOPS)
//   growDecor(flora, decor, elev, biomeId, nextObj) -> the number placed   (world.js, after its flora is made; its rebuild disposes them)
// OWNS: its flora geometries (the recipe's attributes + a still flex / phase).  READS: world/recipe3d.js (recipeGeo), the ground (elev).
// WRITES: world.js PROP_TOP through its API (propTop: rootplate, windlog)
import * as THREE from 'three';
import {recipeGeo} from './recipe3d.js';
import {propTop} from './world.js';   // (called at build time, never at load: world.js imports this module)

const CASTS = {stump: true, log: true, windthrow: true};
// the windthrow's solids (forest.js F.decorSolid, layout.js): how high they stop arrows, a body (world.js PROP_TOP)
const TOPS = {rootplate: 2, windlog: .9};
const shapes = new Map();   // key -> geometry with flora's attributes (shares the recipe's cached ones)

function shapeGeo(name, v, params, biomeId) {
  const key = name + '|' + v + '|' + JSON.stringify(params || {}) + '|' + biomeId;
  if (shapes.has(key)) return {key, geo: shapes.get(key)};
  const r = recipeGeo(name, v, params, biomeId); if (!r) { shapes.set(key, null); return {key, geo: null}; }
  const g = new THREE.BufferGeometry(), A = r.geo.attributes, n = A.position.count;
  for (const k of ['position', 'normal', 'aPart', 'aFam', 'aBias', 'aFixed']) g.setAttribute(k, A[k]);
  g.setAttribute('aFlex', new THREE.BufferAttribute(new Float32Array(n), 1));                // (rigid: no lean in the wind)
  g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1));    // (no flutter)
  shapes.set(key, g); return {key, geo: g};
}

export function growDecor(flora, decor, elev, biomeId, nextObj) {
  propTop(TOPS);
  let n = 0;
  for (const [name, x, y, o] of decor) {
    const {key, geo} = shapeGeo(name, o.v, o.params, biomeId); if (!geo) continue;
    const g = flora.shape('decor|' + key, geo, 'mesh', {casts: !!CASTS[name]});
    flora.add(g, x, elev(x, y), y, -o.yaw, o.s,   // (-yaw: forest.js turns from +x toward +y, flora's makeRotationY toward -z)
      nextObj(), null, (o.v * .37 + x * .013 + y * .029) % 1);
    n++;
  }
  return n;
}
