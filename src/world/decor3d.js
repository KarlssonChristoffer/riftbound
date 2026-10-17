// DECOR3D: the forest floor's small things (world/forest.js F.decor: stumps, fallen logs, windthrows, fly agarics, chanterelles, blueberries;
// content/recipes.js, docs/ASSETS.md) drawn INSTANCED through the world's flora (render/flora.js): every instance of one recipe's
// variant in one draw. A variant is (recipe, v, its params): forest.js keeps them few (3 a recipe). Grouped by CELL m squares too,
// each group frustum culled as a whole (flora's o.cull): ~20 draws in a forest view (of 22 variants + 13 shadows), none outside it.
// Placed once when the world is built, never moved: no per-frame work. View only (no entity, nothing the sim reads but the
// windthrows' colliders below), the same on every co-op client (the plan is a pure function of the seed). The stumps, logs and windthrows cast sun shadows, the
// small ones don't. A windthrow is solid: its colliders are layout.js's (forest.js F.decorSolid), their tops set here (TOPS)
//   growDecor(flora, decor, elev, biomeId, nextObj) -> D   (world.js, after its flora is made; its rebuild disposes them)
//   D.n: the number placed; D.setPicked(i, on): decor[i] drawn picked or whole (features/forage.js: a berry shrub swaps to its
//   variant without berries, recipe param picked; a mushroom is hidden); D.picked(i) -> bool. Kept per decor index: its flora
//   handle (stable across flora's swap-remove), its height and object id, so a swap costs one remove and one add
// OWNS: its flora geometries (the recipe's attributes + a still flex / phase), the handles.  READS: world/recipe3d.js (recipeGeo), the ground (elev).
// WRITES: world.js PROP_TOP through its API (propTop: rootplate, windlog)
import * as THREE from 'three';
import {recipeGeo} from './recipe3d.js';
import {propTop} from './world.js';   // (called at build time, never at load: world.js imports this module)

const CASTS = {stump: true, log: true, windthrow: true};
// the windthrow's solids (forest.js F.decorSolid, layout.js): how high they stop arrows, a body (world.js PROP_TOP)
const TOPS = {rootplate: 1.5, windlog: .9};   // (the plate sits half in the ground it tore from)
// how a picked one looks (features/forage.js): 'bare' its variant with picked: 1 (the twigs, no berries), 'gone' not drawn
const PICKED = {blueberry: 'bare', lingonberry: 'bare', chanterelles: 'gone', fly_agaric: 'gone', cloudberry: 'bare', bog_iron: 'gone'};
const CELL = 32;   // (m: 16 -> ~25 draws in a view, 32 -> ~21, 48 -> ~20 but spheres round half the forest's depth)
const shapes = new Map();   // key -> geometry with flora's attributes (shares the recipe's cached ones), its .pad = its reach (m)

function shapeGeo(name, v, params, biomeId) {
  const key = name + '|' + v + '|' + JSON.stringify(params || {}) + '|' + biomeId;
  if (shapes.has(key)) return {key, geo: shapes.get(key)};
  const r = recipeGeo(name, v, params, biomeId); if (!r) { shapes.set(key, null); return {key, geo: null}; }
  const g = new THREE.BufferGeometry(), A = r.geo.attributes, n = A.position.count;
  for (const k of ['position', 'normal', 'aPart', 'aFam', 'aBias', 'aFixed']) g.setAttribute(k, A[k]);
  g.setAttribute('aFlex', new THREE.BufferAttribute(new Float32Array(n), 1));                // (rigid: no lean in the wind)
  g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1));    // (no flutter)
  g.computeBoundingSphere(); g.pad = g.boundingSphere.center.length() + g.boundingSphere.radius;
  shapes.set(key, g); return {key, geo: g};
}

export function growDecor(flora, decor, elev, biomeId, nextObj) {
  propTop(TOPS);
  const N = decor.length, hs = new Array(N).fill(null), hh = new Float32Array(N), objs = new Float64Array(N), picked = new Uint8Array(N);
  const groupOf = (name, x, y, o, params) => {
    const {key, geo} = shapeGeo(name, o.v, params, biomeId); if (!geo) return null;
    return flora.shape('decor|' + key + '|' + Math.floor(x / CELL) + ',' + Math.floor(y / CELL), geo, 'mesh', {casts: !!CASTS[name], cull: true, pad: geo.pad});
  };
  const put = (g, i) => {
    const [, x, y, o] = decor[i];
    hs[i] = flora.add(g, x, hh[i], y, -o.yaw, o.s,   // (-yaw: forest.js turns from +x toward +y, flora's makeRotationY toward -z)
      objs[i], null, (o.v * .37 + x * .013 + y * .029) % 1);
  };
  let n = 0;
  for (let i = 0; i < N; i++) {
    const [name, x, y, o] = decor[i];
    const g = groupOf(name, x, y, o, o.params); if (!g) continue;
    hh[i] = elev(x, y); objs[i] = nextObj(); put(g, i);
    n++;
  }
  return {
    n,
    picked: i => picked[i] === 1,
    setPicked(i, on) {
      const H = hs[i], v = on ? 1 : 0; if (!H || picked[i] === v) return;
      picked[i] = v;
      const [name, x, y, o] = decor[i];
      if (PICKED[name] === 'bare') {
        const g = groupOf(name, x, y, o, on ? {...o.params, picked: 1} : o.params); if (!g) return;
        flora.remove(H); put(g, i);
      } else flora.setVisible(H, !on);
    },
  };
}
