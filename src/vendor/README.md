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
