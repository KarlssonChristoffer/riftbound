# Vendored dependencies

Pinned copies, so the game runs offline and never changes under us. Update deliberately, in a commit of its own, and
run `node tools/test/golden.mjs --compare <reference>` before and after.

| what | version | source | license |
|---|---|---|---|
| `three/three.module.js` | three.js 0.170.0 | https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js | MIT (`three/LICENSE`) |
| `three/addons/loaders/GLTFLoader.js` | 0.170.0 | .../examples/jsm/loaders/GLTFLoader.js | MIT |
| `three/addons/utils/BufferGeometryUtils.js` | 0.170.0 | .../examples/jsm/utils/BufferGeometryUtils.js (GLTFLoader needs it) | MIT |

`src/index.html`'s import map points `three` and `three/addons/` here. Only add an addon when code imports it.

**Local patch** (2026-10-02): `three.module.js` `generateUUID` draws from its own generator (`_uuidRandom`, a seeded
mulberry32) instead of `Math.random`. Every texture, material, geometry and object three makes takes an id, and golden's
captures seed `Math.random`: with the stock code, a renderer change that made one object more shifted every later random
draw (rain, sparks, dust landed elsewhere) and hid the real difference. Re-apply it when updating three.js.

**Local patches** (2026-10-03, garbage: docs/PERF_AUDIT_2026-10-02.md E.15). Each is marked `LOCAL PATCH` in the file;
re-apply them when updating three.js. None changes what's drawn.

- The float uniform setters (`setValueV1f` .. `setValueV4f`, `setValueM2` .. `setValueM4`) upload through
  `uniformNfv` / `uniformMatrixNfv` from typed arrays and keep their last values in `cacheF`, a Float64Array of each
  `SingleUniform`'s own. Numbers passed to `uniform1f`..`4f` were boxed one by one, and the shared `cache` arrays (one
  allocation site, made generic by the first boolean stored there) boxed every number stored in them.
- `WebGLRenderList`: its arrays are emptied by pop (`_emptyArray`), not `length = 0` (that freed their stores every
  render), and sorted by `_stableSort`, a merge sort through a kept array (Array.prototype.sort made a work array and
  boxed every comparison's result). Both sorts are stable: the same order.
- `WebGLAttributes` `updateBuffer`: the update ranges are sorted only when there are two or more.
- `flatten`: `typeof firstElem === 'number'` instead of `firstElem <= 0 || firstElem > 0`.
