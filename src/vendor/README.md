# Vendored dependencies

Pinned copies, so the game runs offline and never changes under us. Update deliberately, in a commit of its own, and
run `node tools/test/golden.mjs --compare <reference>` before and after.

| what | version | source | license |
|---|---|---|---|
| `three/three.module.js` | three.js 0.170.0 | https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js | MIT (`three/LICENSE`) |
| `three/addons/loaders/GLTFLoader.js` | 0.170.0 | .../examples/jsm/loaders/GLTFLoader.js | MIT |
| `three/addons/utils/BufferGeometryUtils.js` | 0.170.0 | .../examples/jsm/utils/BufferGeometryUtils.js (GLTFLoader needs it) | MIT |

`src/index.html`'s import map points `three` and `three/addons/` here. Only add an addon when code imports it.
