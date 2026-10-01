// LIGHTS (render3d): light sources that read right from every side, and the things that react to them.
// OWNER: the lights session. Key 9 toggles the extra sources (the wall sconces are a fix and always stay).
//
//   sconces   the arena's wall torches hang on the walls' INNER faces now (the torch prop with p.sconce: biomes.js paints
//             the stick + cup only, wind.js still gives it the live flame), on a real 3D iron bracket (plate, arm, brace,
//             collar) built here, so from any side the bracket meets the wall. The layout's east pair, a lit pair at the
//             north gate and an UNLIT pair at the west gate (p.unlit: shoot a fire arrow at them)
//   campfire  in the yard: a stone ring + log teepee as 3D meshes (the stones throw little shadow rays), a 3-tongue
//             flame card, sparks, smoke lit by the fire, a scorched ring on the ground, heat haze, and a light that
//             jitters so every shadow round it dances
//   beacon    on the plateau's lip, above the climb: a stone plinth + iron basket (3D), UNLIT. E (or a fire arrow)
//             lights it: a flare, then a big light that spills down over the cliff onto the yard
//   candles   clusters on the broken pillar, by the rubble, by the west wall and just inside the west gate. A blast, a roll right past or an arrow
//             through them snuffs them (smoke curls); they relight after a while (a fire arrow relights them at once)
//   shrooms   glowing mushroom clusters on the stream banks and in the grove: they pulse, brighten as you come close
//             and puff glowing spores when you run through them
//   wisps     will-o'-wisps over the south stream at dusk / night: moving lights (so moving shadows) that drift, bob
//             and dart away from you
//   fire      an arrow loosed next to a flame (a torch, brazier, the campfire, the beacon, a candle cluster), or one that
//             flies through a flame, catches fire: a moving light + an ember trail. It lights unlit torches / braziers / the beacon; stuck, it burns out; in a crate, barrel or
//             dummy it sets it alight (it burns, may spread to its neighbours, then breaks; an explosive barrel cooks off)
//
// FEATURE CONTRACT (main.js): create(host) -> F with update / frame / lights / onArrowHit / interact / biomeChanged.
// It sits BEFORE combat in the feature order: onArrowHit sees the hit first (to catch fire) and returns nothing, so
// combat still resolves it. Props it adds (sconces, the campfire, the beacon) live in host.props like the layout's.
import {ART} from '../../sprites/arena/biomes.js';
import {STREAM, PLAY} from '../../sprites/arena/layout.js';
import {FAMS} from '../world.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const R = Math.random, rr = (a, b) => a + R() * (b - a);
const rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

const D = .21;   // a sconce's stick stands this far off the wall face (the arm shows a few px past the stick)
const TORCH_H = 1.72, BRAZ_H = 1.22;   // flame heights of the arena's torch / brazier sprites (their lights' h)
const GLOW = {ruins: '#7af0c8', ember: '#ff9a50', frost: '#9ad8ff', rift: '#e070ff'};
const WISP = {ruins: '#a8ffd8', ember: '#ffc070', frost: '#bfe8ff', rift: '#ff9cf0'};
const FIRE = ['#fff6c8', '#ffd060', '#ff8a30', '#c84a1c'].map(rgb), SMOKE = ['#6a625a', '#57514b', '#46423e'].map(rgb);
const BURNS = {crate: 3.6, barrel: 4.4, barrel_x: 1.1, dummy: 6};   // seconds alight before it breaks (dummies just go out)
const TOP = {crate: .72, barrel: .9, barrel_x: .9, dummy: 1.25};

export async function create(host) {
  const {THREE, PPM, PPMY} = host;
  const F = {name: 'lights', label: 'Light sources', key: '9', on: true, ms: 0};
  let T = 0, atlas = null, biomeId = '';
  const parts = [];        // particles: {x, y, h, vx, vy, vh, t, life, k: 'spark' | 'smoke' | 'spore' | 'ember', c, sz}
  const flares = [];       // short bursts of light: {x, y, h, c, r, t, life, k}
  const burning = new Map();   // prop -> {t, dur, fl (flame state), spread}
  const meshes = [];       // feature-owned 3D meshes (world.mesh: a rebuild disposes them, biomeChanged makes them again)

  // ================================================================ art: one atlas per biome (albedo + emit, same layout)
  function flameFrames(add, name, w, h, col, tongues) {
    for (let li = 0; li < 5; li++) for (let hi = 0; hi < 3; hi++) {
      const lean = (li - 2) * (tongues > 1 ? 1.4 : 1), hk = [.74, .87, 1][hi];
      const W = Math.ceil(w * (tongues > 1 ? 1.7 : 1)) + 6, H = Math.ceil(h * 1.05) + 3, E = new ART.Pix(W, H), P = new ART.Pix(W, H), cx = W / 2;
      if (tongues > 1) {   // side tongues first, the tall middle one over them (its hot core wins)
        ART.flame(E, cx - w * .32, H, w * .58, h * hk * (.5 + (hi === 1 ? .12 : 0)), col, lean - 1.6);
        ART.flame(E, cx + w * .3, H, w * .55, h * hk * (.62 - (hi === 2 ? .1 : 0)), col, lean + 1.4);
      }
      if (tongues > 2) ART.flame(E, cx + (li - 2) * .4, H, w * .4, h * hk * .35, col, lean);
      ART.flame(E, cx, H, w, h * hk, col, lean);
      add(`${name}_${li}_${hi}`, P, E, [Math.floor(cx), H]);
    }
  }
  function candleArt(add, S, v) {
    const wax = ART.ramp(...(S.id === 'rift' ? ['#8a7aa8', '#6a5a88', '#4e4268', '#2e2644'] : S.id === 'frost' ? ['#f4f8ff', '#d8e2f0', '#aab8cc', '#6e7a8c'] : ['#f4ecd6', '#e0d4b4', '#b8a888', '#7a6e58']));
    const sets = [[[2, 5], [5, 8], [9, 4]], [[3, 7], [7, 4], [10, 6]]], C = sets[v], W = 14, H = 14;
    const fc = S.id === 'rift' ? ['#ffe0fa', '#ff8ae8', '#c85ad8'] : S.id === 'frost' ? ['#f0fbff', '#9ad8ff', '#5a9ad8'] : ['#fff6c8', '#ffc860', '#ff8a30'];
    for (let f = 0; f <= 4; f++) {   // 4 flame frames + 1 snuffed
      const P = new ART.Pix(W, H), E = new ART.Pix(W, H), b = H - 1;
      for (let i = -1; i <= 12; i++) if (i >= 0 && i < W && ART.hsh(i, v, 5) < .7) P.p(i, b, wax, 2);   // the wax puddle
      C.forEach(([x, h], k) => {
        const top = b - h;
        for (let y = top; y < b; y++) { P.p(x, y, wax, 0); P.p(x + 1, y, wax, 1); }
        if (ART.hsh(x, v, 9) < .6) P.p(x + 1, top + 1, wax, 0);   // a drip
        P.p(x, top - 1, wax, 3);   // the wick
        if (f === 4) return;
        const g = (f + k) % 4, tall = g !== 1, sx = g === 2 ? 1 : g === 3 ? -1 : 0;
        E.c(x, top - 2, ART.hex(fc[0])); E.c(x, top - 3, ART.hex(fc[1]));
        if (tall) E.c(x + sx, top - 4, ART.hex(fc[2]));
      });
      add(`candles_${v}_${f}`, P, E, [7, H]);
    }
  }
  function shroomArt(add, S, v) {
    const g = GLOW[S.id] || GLOW.ruins, stem = ART.ramp('#e8e0cc', '#c8bea4', '#9a907a', '#5e5646');
    const cap = ART.ramp(ART.mixHex(g, '#ffffff', .35), g, ART.mixHex(g, '#000000', .35), ART.mixHex(g, '#000000', .65));
    // [stem x, stem height, cap width, cap height], drawn back to front
    const sets = [[[4, 6, 6, 3], [11, 9, 8, 3], [16, 4, 5, 2], [8, 2, 4, 2], [19, 2, 3, 2]],
      [[3, 3, 4, 2], [8, 7, 7, 3], [14, 10, 8, 4], [18, 3, 4, 2], [12, 2, 3, 2]],
      [[5, 8, 7, 3], [12, 5, 6, 3], [17, 2, 4, 2], [2, 2, 3, 2]]];
    const W = 24, H = 17;
    for (let lv = 0; lv < 3; lv++) {
      const P = new ART.Pix(W, H), E = new ART.Pix(W, H), b = H - 1;
      const ec = [ART.mixHex(g, '#000000', .3), g, ART.mixHex(g, '#ffffff', .45)][lv], spot = ART.mixHex(g, '#ffffff', .8);
      for (const [x, sh, cw, ch] of sets[v]) {
        for (let y = b - sh; y <= b; y++) { P.p(x, y, stem, 1); P.p(x + 1, y, stem, 2); }
        const cy = b - sh, x0 = Math.round(x + 1 - cw / 2);
        for (let j = 0; j < ch; j++) {
          const inset = j === 0 ? 1 : 0;
          for (let i = x0 + inset; i < x0 + cw + (cw > 3 ? 1 : 0) - inset; i++) {
            const y = cy - ch + 1 + j;
            P.p(i, y, cap, j === ch - 1 ? 2 : i < x0 + cw / 2 ? 0 : 1);
            if (j < ch - 1 || cw > 4) E.c(i, y, ART.hex(ART.hsh(i, y, v) < .18 ? spot : ec));
          }
        }
      }
      add(`shroom_${v}_${lv}`, P, E, [12, H]);
    }
  }
  function buildAtlas() {
    const S = host.biome.style, items = [];
    const add = (name, P, E, pivot) => items.push({name, img: P.canvas(), em: E.used ? E.canvas() : null, pivot});
    const camp = S.id === 'rift' ? '#e070ff' : S.id === 'frost' ? '#ffb04a' : '#ffa040';
    flameFrames(add, 'camp', 13, 24, camp, 3);
    flameFrames(add, 'beacon', 18, 38, S.torch || '#ffc850', 3);
    flameFrames(add, 'burn', 11, 19, '#ff9a40', 2);
    for (const v of [0, 1]) candleArt(add, S, v);
    for (const v of [0, 1, 2]) shroomArt(add, S, v);
    // shelf-pack into one sheet
    const AW = 512; let x = 0, y = 0, rowH = 0;
    for (const it of items) { const w = it.img.width, h = it.img.height; if (x + w + 1 > AW) { x = 0; y += rowH + 1; rowH = 0; } it.r = [x, y, w, h]; x += w + 1; rowH = Math.max(rowH, h); }
    const AH = y + rowH, img = document.createElement('canvas'), em = document.createElement('canvas');
    img.width = em.width = AW; img.height = em.height = AH;
    const qi = img.getContext('2d'), qe = em.getContext('2d');
    const fr = {};
    for (const it of items) { qi.drawImage(it.img, it.r[0], it.r[1]); if (it.em) qe.drawImage(it.em, it.r[0], it.r[1]); fr[it.name] = {sx: it.r[0], sy: it.r[1], sw: it.r[2], sh: it.r[3], px: it.pivot[0], py: it.pivot[1]}; }
    return {img, em, fr};
  }
  function spr(name, x, y, h, o = {}) {
    const f = atlas.fr[name]; if (!f) return;
    host.sprite({img: atlas.img, em: atlas.em, sx: f.sx, sy: f.sy, sw: f.sw, sh: f.sh, px: f.px, py: f.py, x, y, h, type: 3, shadow: !!o.shadow, alpha: o.alpha ?? 1, flip: o.flip});
  }

  // ================================================================ 3D pieces (the prop pipeline's ramps, outlines, shadows)
  function geoOf(list) {   // [{g: geometry, m: Matrix4, fam, bias?, fixed?}] -> one mesh geometry with the prop attributes
    const pos = [], nrm = [], aPart = [], aFam = [], aBias = [], aFixed = [];
    list.forEach((q, pi) => {
      const g = (q.g.index ? q.g.toNonIndexed() : q.g.clone()).applyMatrix4(q.m), P = g.attributes.position, N = g.attributes.normal;
      for (let i = 0; i < P.count; i++) {
        pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i));
        aPart.push(pi % 64); aFam.push(Math.max(0, FAMS.indexOf(q.fam))); aBias.push(q.bias || 0); aFixed.push(q.fixed ?? -1);
      }
    });
    const geo = new THREE.BufferGeometry(), A = (n, a, k) => geo.setAttribute(n, new THREE.Float32BufferAttribute(a, k));
    A('position', pos, 3); A('normal', nrm, 3); A('aPart', aPart, 1); A('aFam', aFam, 1); A('aBias', aBias, 1); A('aFixed', aFixed, 1);
    geo.computeBoundingSphere(); geo.computeBoundingBox(); return geo;
  }
  const M4 = (pos, rot = [0, 0, 0], scl = [1, 1, 1]) => new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scl));
  const along = (a, b, r0, r1, seg = 6) => {   // a cylinder from a to b (world-local points)
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return {g: new THREE.CylinderGeometry(r1, r0, len, seg), m: new THREE.Matrix4().compose(A.add(B).multiplyScalar(.5), q, new THREE.Vector3(1, 1, 1))};
  };
  // a sconce bracket, local: x = out of the wall (0 = the face), y up, z along the wall
  const bracketGeo = geoOf([
    {g: new THREE.BoxGeometry(.05, .34, .2), m: M4([.025, 1.02, 0]), fam: 'metal'},
    {g: new THREE.BoxGeometry(D, .065, .06), m: M4([D / 2, 1.07, 0]), fam: 'metal'},
    {g: new THREE.BoxGeometry(.2, .04, .04), m: M4([.095, .97, 0], [0, 0, .72]), fam: 'metal', bias: -.2},
    {g: new THREE.BoxGeometry(.12, .08, .12), m: M4([D, 1.06, 0]), fam: 'metal', bias: .2},
  ]);
  function campfireGeo() {
    const L = [], r = ART.rng(77);
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * TAU + r() * .3, d = .46 + r() * .05;
      L.push({g: new THREE.IcosahedronGeometry(1, 0), m: M4([Math.cos(a) * d, .04, Math.sin(a) * d], [r() * 3, r() * 3, r() * 3], [.085 + r() * .03, .065 + r() * .025, .075 + r() * .03]), fam: 'rock'});
    }
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * TAU + .4, b = [Math.cos(a) * .27, 0, Math.sin(a) * .27], m = [Math.cos(a) * .12, .2, Math.sin(a) * .12], t = [Math.cos(a) * .02, .36, Math.sin(a) * .02];
      L.push({...along(b, m, .045, .042), fam: 'wood'}, {...along(m, t, .042, .03), fam: 'void'});
    }
    return geoOf(L);
  }
  function beaconGeo() {
    const L = [
      {g: new THREE.BoxGeometry(.84, .12, .84), m: M4([0, .06, 0]), fam: 'stone'},
      {g: new THREE.CylinderGeometry(.27, .33, .62, 8), m: M4([0, .43, 0]), fam: 'stone'},
      {g: new THREE.CylinderGeometry(.36, .36, .06, 8), m: M4([0, .77, 0]), fam: 'stone', bias: .2},
      {g: new THREE.CylinderGeometry(.36, .2, .2, 8), m: M4([0, .9, 0]), fam: 'metal'},
      {g: new THREE.TorusGeometry(.36, .025, 4, 8), m: M4([0, 1.0, 0], [Math.PI / 2, 0, 0]), fam: 'metal', bias: .3},
    ];
    L.push({g: new THREE.CylinderGeometry(.31, .31, .03, 8), m: M4([0, .99, 0]), fam: 'void'});   // the bed of ash and coals
    for (let i = 0; i < 6; i++) {   // split logs piled across each other
      const a = i / 6 * Math.PI + (i & 1) * .25, c = Math.cos(a) * .26, s = Math.sin(a) * .26, y = 1.02 + (i % 3) * .035;
      L.push({...along([-c, y, -s], [c, y + .03, s], .032, .03), fam: i < 3 ? 'wood' : 'void'});
    }
    return geoOf(L);
  }
  const campGeo = campfireGeo(), beacGeo = beaconGeo();

  // ================================================================ the world's light sources
  const props = () => host.props;
  // the sconces: the layout's east torches move onto the wall, plus the gate pairs (west ones unlit)
  function mountSconces() {
    const {x0, y0, x1, y1} = PLAY, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, added = [];
    for (const p of props()) if (p.kind === 'torch' && !p.sconce && Math.abs(p.x - (x1 - .6)) < .05) { p.x = x1 - D; p.sconce = true; p.mount = [-1, 0]; }
    const add = (x, y, nx, ny, unlit) => {
      if (props().some(q => q.kind === 'torch' && Math.hypot(q.x - x, q.y - y) < .3)) return;
      const p = {kind: 'torch', x, y, z: 0, variant: 0, r: 0, sconce: true, mount: [nx, ny], unlit: !!unlit, lightable: true};
      props().push(p); added.push(p);
    };
    add(cx - 2.6, y0 + D, 0, 1); add(cx + 2.6, y0 + D, 0, 1);                // north gate, lit
    add(x0 + D, cy - 2.6, 1, 0, true); add(x0 + D, cy + 2.6, 1, 0, true);    // west gate, waiting for a fire arrow
    for (const p of props()) if (p.kind === 'torch') p.lightable = true;
    return added;
  }
  // the campfire and the beacon are props too (they collide; the beacon is an E target)
  const clearAround = (x, y, r) => { for (const q of props()) if ((q.kind === 'tuft' || q.kind === 'bush' || q.kind === 'rock') && Math.hypot(q.x - x, q.y - y) < r) q.gone = true; };
  let camp = props().find(p => p.kind === 'campfire'), beacon = props().find(p => p.kind === 'beacon');
  if (!camp) { camp = {kind: 'campfire', x: 50.8, y: 19.4, z: 0, r: .55, fl: {}}; props().push(camp); clearAround(camp.x, camp.y, 1.3); }
  if (!beacon) { beacon = {kind: 'beacon', x: 49.6, y: 10.35, z: 2.4, r: .45, unlit: true, interact: 'light the beacon', fl: {}}; props().push(beacon); clearAround(beacon.x, beacon.y, 1); }
  const sconcesAdded = mountSconces();
  await Promise.all(sconcesAdded.map(p => host.world.addItem(p)));

  // candles: on the broken pillar's top (ray cast on its model) and on the ground by the rubble
  const ray = new THREE.Raycaster();
  function topOf(p, x, y) {
    const it = host.itemOf(p); if (!it?.live) return 0;
    const m = new THREE.Mesh(it.live.gm.geometry); m.matrixAutoUpdate = false; m.matrix.copy(it.live.gm.matrix); m.matrixWorld.copy(it.live.gm.matrix);
    ray.set(new THREE.Vector3(x, 20, y), new THREE.Vector3(0, -1, 0));
    return ray.intersectObject(m)[0]?.point.y ?? 0;
  }
  const candles = [];
  function placeCandles() {
    candles.length = 0;
    const pb = props().find(p => p.kind === 'pillar_broken'), rb = props().find(p => p.kind === 'rubble');
    if (pb) candles.push({x: pb.x, y: pb.y + .02, h: topOf(pb, pb.x, pb.y), v: 0});
    if (rb) candles.push({x: rb.x + .55, y: rb.y + .45, h: 0, v: 1});
    candles.push({x: PLAY.x0 + 1.1, y: (PLAY.y0 + PLAY.y1) / 2 + 4.1, h: 0, v: 1});   // at the foot of the west wall, by the grove
    candles.push({x: PLAY.x0 + 1.05, y: (PLAY.y0 + PLAY.y1) / 2 - .35, h: 0, v: 0});   // inside the west gate (dip an arrow here for its torches)
    candles.forEach((c, i) => Object.assign(c, {lit: true, relight: 0, ph: R() * 4, id: 9110 + i}));
  }
  // glowing mushrooms: the stream banks + the grove
  const sx = y => STREAM.cx(y), sw = y => STREAM.w(y) / 2;
  const shrooms = [[sx(19.6) - sw(19.6) - .5, 19.6, 0], [sx(25.4) + sw(25.4) + .55, 25.4, 1], [sx(9.6) - sw(9.6) - .5, 9.6, 2],
    [PLAY.x0 + 2.6, 17.6, 1], [PLAY.x0 + 5.4, 11.6, 0]].map(([x, y, v], i) => ({x, y, v, ph: R() * TAU, b: .5, id: 9120 + i, cool: 0}));
  // wisps: over the south stream
  const wisps = [20.5, 23.2, 26.2].map((y, i) => ({hy: y, x: sx(y), y, h: .9, vx: 0, vy: 0, tx: sx(y), ty: y, t: R() * 9, fade: 0, trail: [], id: 9130 + i}));

  function buildMeshes() {
    for (const m of meshes) m.dispose(); meshes.length = 0;
    for (const p of props()) if (p.kind === 'torch' && p.mount) {
      const [nx, ny] = p.mount, th = Math.atan2(-ny, nx);
      meshes.push(host.world.mesh(bracketGeo, M4([p.x - nx * D, p.z || 0, p.y - ny * D], [0, th, 0])));
    }
    camp.mesh = host.world.mesh(campGeo, M4([camp.x, 0, camp.y], [0, .3, 0]), {occlude: true}); meshes.push(camp.mesh);   // its stones throw little shadow rays
    // (not a point-light occluder: its flame sits in the basket, which would ring it with a black disc)
    beacon.mesh = host.world.mesh(beacGeo, M4([beacon.x, beacon.z, beacon.y], [0, .2, 0])); meshes.push(beacon.mesh);
    placeCandles();
  }
  function syncBiome() {
    if (host.biome.id === biomeId) return;
    biomeId = host.biome.id; atlas = buildAtlas();
  }
  syncBiome(); buildMeshes();

  // ================================================================ fire: what burns, what lights, what catches
  const flameAt = (p) => (p.z || 0) + (p.kind === 'torch' ? TORCH_H : BRAZ_H);
  function flamePoints() {   // lit flames an arrow can catch from: [x, y, h]
    const out = [];
    for (const p of props()) if ((p.kind === 'brazier' || p.kind === 'torch') && !p.unlit && !p.gone && !p.broken) out.push([p.x, p.y, flameAt(p)]);
    if (F.on) { out.push([camp.x, camp.y, .45]); if (!beacon.unlit) out.push([beacon.x, beacon.y, beacon.z + 1.3]); }
    for (const [p] of burning) out.push([p.x, p.y, (p.z || 0) + (p.h || 0) + (TOP[p.kind] ?? .8)]);
    return out;
  }
  function flare(x, y, h, c, r = 4, k = 2.2, life = .5) { flares.push({x, y, h, c, r, k, t: 0, life}); }
  function burst(x, y, h, n, c = FIRE, speed = 1.6) {
    for (let i = 0; i < n; i++) { const a = R() * TAU, s = rr(.3, speed); parts.push({x, y, h, vx: Math.cos(a) * s, vy: Math.sin(a) * s * .8, vh: rr(.5, 2.4), t: 0, life: rr(.35, .8), k: 'spark', c, g: 3}); }
  }
  function light(p) {   // an unlit torch / brazier / the beacon catches
    p.unlit = false;
    const h = p === beacon ? beacon.z + 1.25 : flameAt(p), c = p === beacon ? host.biome.style.torch || '#ffc850' : p.kind === 'torch' ? host.biome.style.torch : '#ffb04a';
    flare(p.x, p.y, h, c, p === beacon ? 9 : 5, p === beacon ? 3 : 2.4, p === beacon ? 1.1 : .6);
    burst(p.x, p.y, h, p === beacon ? 40 : 18, FIRE, p === beacon ? 2.6 : 1.6);
    if (p === beacon) { p.opened = true; host.shake?.(2, .2); }
    host.events.push({type: 'ignite', x: p.x, y: p.y, kind: p.kind});
  }
  function ignite(p) {
    if (burning.has(p) || p.broken || p.gone) return;
    const dur = BURNS[p.kind] ?? BURNS[p.breakable]; if (!dur) return;
    burning.set(p, {t: 0, dur: dur * rr(.9, 1.15), fl: {}, spread: 0});
    burst(p.x, p.y, (p.z || 0) + .5, 12);
    host.events.push({type: 'ignite', x: p.x, y: p.y, kind: p.kind});
  }
  const candleSnuff = (c, quiet) => {
    if (!c.lit) return; c.lit = false; c.relight = rr(6, 9);
    if (!quiet) for (let i = 0; i < 6; i++) parts.push({x: c.x + rr(-.12, .12), y: c.y, h: c.h + .22, vx: rr(-.1, .1), vy: 0, vh: rr(.25, .5), t: 0, life: rr(.8, 1.4), k: 'smoke', c: SMOKE[0], sz: 1, a0: .7});
  };

  // ================================================================ simulation
  let aid = 0;
  function stepArrows(dt) {
    const fp = flamePoints();
    for (const a of host.arrows) {
      if (a._lt === undefined) {   // just loosed: next to a flame, it's dipped
        a._lt = 0; a._id = aid++;
        if (fp.some(([x, y]) => Math.hypot(x - a.x, y - a.y) < 1.5) || candles.some(c => c.lit && F.on && Math.hypot(c.x - a.x, c.y - a.y) < 1.3)) { a.fire = 1; burst(a.x, a.y, a.h, 6, FIRE, .8); }
      }
      if (!a.fire && !a.stuck) for (const [x, y, h] of fp) if (Math.hypot(x - a.x, y - a.y) < .35 && Math.abs(h - a.h) < .55) { a.fire = 1; burst(a.x, a.y, a.h, 8); break; }
      // a passing arrow snuffs candles it skims (a fire arrow lights them)
      for (const c of candles) if (!a.stuck && Math.hypot(c.x - a.x, c.y - a.y) < .3 && Math.abs(c.h + .2 - a.h) < .4) { if (a.fire) { c.lit = true; c.relight = 0; } else candleSnuff(c); }
      if (!a.fire) continue;
      a._lt += dt;
      // light what it touches: unlit torches / braziers, the beacon
      for (const p of props()) if (p.unlit && (p.lightable || p === beacon || p.kind === 'brazier')) {
        const h = p === beacon ? beacon.z + 1.25 : flameAt(p);
        const dh = a.h - h;   // stuck in the wall just under it, the flame licks up and catches
        if (Math.hypot(p.x - a.x, p.y - a.y) < (a.stuck ? .5 : .4) && dh < .5 && dh > (a.stuck ? -1.1 : -.65)) light(p);
      }
      if (!a.stuck || R() < .5) parts.push({x: a.x, y: a.y, h: a.h, vx: rr(-.2, .2), vy: rr(-.2, .2), vh: rr(.1, .6), t: 0, life: rr(.25, .5), k: 'ember', c: FIRE[1 + (R() * 2 | 0)]});
    }
  }
  function stepBurning(dt) {
    const core = host.feature('combat')?.core;
    for (const [p, b] of burning) {
      b.t += dt;
      if (p.broken || p.gone || b.t > b.dur + (p.kind === 'dummy' ? 0 : 3)) { burning.delete(p); if (p.broken) for (let i = 0; i < 10; i++) parts.push({x: p.x + rr(-.3, .3), y: p.y + rr(-.3, .3), h: (p.z || 0) + .05, vx: 0, vy: 0, vh: 0, t: 0, life: rr(1.5, 3), k: 'ember', c: FIRE[2 + (R() * 2 | 0)], g: 0}); continue; }
      const top = (p.z || 0) + (p.h || 0) + (TOP[p.kind] ?? .8);
      if (R() < dt * 26) parts.push({x: p.x + rr(-.15, .15), y: p.y + rr(-.1, .1), h: top, vx: rr(-.2, .2), vy: rr(-.2, .2), vh: rr(.8, 1.8), t: 0, life: rr(.4, .9), k: 'spark', c: FIRE[R() * 3 | 0], g: -.3});
      if (R() < dt * 9) parts.push({x: p.x + rr(-.1, .1), y: p.y, h: top + .25, vx: 0, vy: 0, vh: rr(.35, .6), t: 0, life: rr(1.6, 2.6), k: 'smoke', c: SMOKE[R() * 3 | 0], sz: 2, a0: .55});
      // it spreads to wooden neighbours
      b.spread += dt;
      if (b.spread > 1.4) { b.spread = 0; for (const q of props()) if (q !== p && !burning.has(q) && BURNS[q.kind] && !q.broken && Math.hypot(q.x - p.x, q.y - p.y) < 1.4 && R() < .45) ignite(q); }
      if (b.t >= b.dur && p.kind !== 'dummy' && core && !p.broken) core.breakProp(p, {});
    }
  }
  function stepCandles(dt, evs) {
    for (const e of evs) if (e.type === 'explode') for (const c of candles) if (Math.hypot(c.x - e.x, c.y - e.y) < (e.r || 2) * 1.8 + 1) candleSnuff(c);
    const pl = host.player;
    for (const c of candles) {
      if (pl.state === 'roll' && Math.hypot(c.x - pl.x, c.y - pl.y) < 1 && Math.abs(c.h - pl.z) < .6) candleSnuff(c);
      if (!c.lit && (c.relight -= dt) <= 0) { c.lit = true; burst(c.x, c.y, c.h + .2, 3, FIRE, .3); }
    }
  }
  function stepShrooms(dt) {
    const pl = host.player, sp = Math.hypot(pl.vx, pl.vy);
    for (const s of shrooms) {
      const d = Math.hypot(s.x - pl.x, s.y - pl.y);
      const want = .45 + .2 * Math.sin(T * 1.3 + s.ph) + clamp(1 - d / 2.8, 0, 1) * .75;
      s.b += (want - s.b) * (1 - Math.exp(-dt * (want > s.b ? 6 : 1.5)));
      s.cool -= dt;
      if (d < .75 && sp > 1.2 && s.cool <= 0) {   // run through: a puff of spores
        s.cool = .5; const g = rgb(GLOW[biomeId] || GLOW.ruins);
        for (let i = 0; i < 14; i++) { const a = R() * TAU, v = rr(.1, .6); parts.push({x: s.x + rr(-.2, .2), y: s.y + rr(-.15, .15), h: .12, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: rr(.2, .7), t: 0, life: rr(1.2, 2.4), k: 'spore', c: lerp3(g, [1, 1, 1], R() * .4), g: -.02}); }
        s.b = 1.6;
      }
    }
  }
  function stepWisps(dt) {
    const night = host.time !== 'day', pl = host.player;
    for (const w of wisps) {
      w.t += dt; w.fade += ((night ? 1 : 0) - w.fade) * (1 - Math.exp(-dt * 1.2));
      const dp = Math.hypot(w.x - pl.x, w.y - pl.y);
      let sp = 1.1;
      if (dp < 2.6) {   // dart away, along the water
        const ux = (w.x - pl.x) / (dp || 1), uy = (w.y - pl.y) / (dp || 1);
        w.ty = clamp(w.y + uy * 3 + (uy >= 0 ? 1 : -1) * 1.5, 18, 27.2); w.tx = sx(w.ty) + clamp(ux * 1.2, -1.2, 1.2); sp = 3.2;
      } else if (Math.hypot(w.tx - w.x, w.ty - w.y) < .3 || R() < dt * .25) {
        w.ty = clamp(w.hy + rr(-1.6, 1.6), 18, 27.2); w.tx = sx(w.ty) + rr(-1, 1);
      }
      const dx = w.tx - w.x, dy = w.ty - w.y, d = Math.hypot(dx, dy) || 1, k = 1 - Math.exp(-dt * 2.2);
      w.vx += (dx / d * Math.min(sp, d * 2) - w.vx) * k; w.vy += (dy / d * Math.min(sp, d * 2) - w.vy) * k;
      w.x += w.vx * dt; w.y += w.vy * dt; w.h = .85 + Math.sin(w.t * 1.7) * .22 + Math.sin(w.t * 4.1) * .05;
      w.trail.unshift([w.x, w.y, w.h]); if (w.trail.length > 9) w.trail.pop();
    }
  }
  function stepFlame(s, dt, x, y) {   // a flame card's frame: height walk + lean from the wind (along the screen's x)
    s.ft = (s.ft || 0) + dt; if (s.ft < 1 / 12 && s.li !== undefined) return;
    s.ft = 0;
    s.hi = R() < .4 ? 2 : clamp((s.hi ?? 2) + (R() < .5 ? -1 : 1), 0, 2);
    const a = host.wind?.on && host.wind.at ? host.wind.at(x, y) : {x: 0, y: 0}, yaw = host.yaw;
    const lean = (a.x * Math.cos(yaw) - a.y * Math.sin(yaw)) / 1.4;
    s.li = clamp(Math.round(2 + clamp(lean, -1.6, 1.6) + (R() - .5) * .9), 0, 4);
  }
  function stepParts(dt) {
    const wd = host.wind?.on && host.wind.at ? host.wind.at(host.player.x, host.player.y) : {x: 0, y: 0};
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.t += dt;
      if (q.t >= q.life) { parts.splice(i, 1); continue; }
      const drift = q.k === 'smoke' ? .35 : q.k === 'spore' ? .25 : .12;
      q.vx += (wd.x * drift - q.vx) * dt * .8; q.vy += (wd.y * drift - q.vy) * dt * .8;
      if (q.k === 'spark' || q.k === 'ember') { q.vx += (R() - .5) * dt * 6; q.vy += (R() - .5) * dt * 6; q.vh -= (q.g ?? 0) * dt; }
      if (q.k === 'spore') { q.vh *= Math.exp(-dt * 1.5); q.vx += Math.sin(q.t * 5 + i) * dt * .3; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt;
      if (q.k === 'smoke') q.vh *= Math.exp(-dt * .3);
      if (q.h < 0 && q.k !== 'ember') q.h = 0;
    }
    if (parts.length > 900) parts.splice(0, parts.length - 900);
  }

  // ================================================================ draw
  const near = (x, y, m = 15) => { const t = host.G.view.T; return Math.abs(x - t.x) < m && Math.abs(y - t.z) < m; };
  function drawFire(name, s, x, y, h) { spr(`${name}_${s.li ?? 2}_${s.hi ?? 2}`, x, y, h); }
  function drawCampfire() {
    if (!near(camp.x, camp.y)) return;
    drawFire('camp', camp.fl, camp.x, camp.y + .01, .12);
    for (let i = 0; i < 7; i++) {   // coals glowing between the logs
      const a = i / 7 * TAU + T * .1, d = .1 + (i & 1) * .07, k = .5 + .5 * Math.sin(T * 9 + i * 2.3);
      host.point(camp.x + Math.cos(a) * d, camp.y + Math.sin(a) * d, .03, FIRE[k > .6 ? 1 : 2], {emit: true});
    }
    // the scorched ring under it (ground layer: an exact projected circle, whole pixels)
    const z = host.zoom, [cx, cy] = host.toView(camp.x, camp.y, 0), q = host.layer('ground');
    const rx = .64 * PPM * z, ry = .64 * PPMY * z;
    for (let j = -Math.ceil(ry); j <= Math.ceil(ry); j++) {
      const t = j / ry; if (Math.abs(t) > 1) continue;
      const hw = rx * Math.sqrt(1 - t * t) - (ART.hsh(j, 3) < .3 ? 1 : 0), inner = Math.abs(t) < .62;
      q.fillStyle = inner ? 'rgba(26,21,18,.62)' : 'rgba(38,32,28,.42)';
      q.fillRect(Math.round(cx - hw), Math.round(cy + j), Math.round(hw * 2), 1);
    }
    haze(camp.x, camp.y, 1.05, 12, 26);
  }
  function haze(x, y, h, w, H) {   // heat shimmer above a fire: whole-pixel row shifts in the distort layer
    if (!host.G.compU?.tDistort) return;
    const z = host.zoom, [cx, top] = host.toView(x, y, h), q = host.layer('distort');
    for (let r = 0; r < H * z; r++) {
      const k = 1 - r / (H * z), s = Math.round(Math.sin(r * .55 / z - T * 7 + x) * 1.6 * k * z);
      if (!s) continue;
      const ww = Math.round(w * z * (.6 + .4 * k));
      q.fillStyle = `rgb(${128 + s},128,0)`; q.fillRect(Math.round(cx - ww / 2), Math.round(top - r), ww, 1);
    }
  }
  function drawBeacon() {
    if (beacon.unlit || !near(beacon.x, beacon.y)) return;
    drawFire('beacon', beacon.fl, beacon.x, beacon.y + .01, beacon.z + 1.0);
    haze(beacon.x, beacon.y, beacon.z + 2.0, 14, 30);
  }
  function drawSmall() {
    for (const c of candles) if (near(c.x, c.y)) spr(`candles_${c.v}_${c.lit ? (Math.floor(T * 7 + c.ph) % 4) : 4}`, c.x, c.y, c.h, {shadow: true});
    for (const s of shrooms) if (near(s.x, s.y)) spr(`shroom_${s.v}_${s.b > 1.05 ? 2 : s.b > .55 ? 1 : 0}`, s.x, s.y, 0, {shadow: true});
    for (const [p, b] of burning) if (near(p.x, p.y)) { stepFlame(b.fl, 0, p.x, p.y); drawFire('burn', b.fl, p.x, p.y + .01, (p.z || 0) + (p.h || 0) + (TOP[p.kind] ?? .8) - .25); }
  }
  function drawWisps() {
    for (const w of wisps) {
      if (w.fade < .05 || !near(w.x, w.y)) continue;
      const c = rgb(WISP[biomeId] || WISP.ruins), core = lerp3(c, [1, 1, 1], .6), a = w.fade;
      host.point(w.x, w.y, w.h, core, {emit: true, size: 2, alpha: a});
      host.point(w.x, w.y, w.h, c, {emit: true, size: 4, alpha: a * .45});   // a dithered glow round the core (the core wins the depth tie)
      for (let k = 0; k < 4; k++) {   // a soft ring of motes round the core
        const ang = T * 2.2 + k * TAU / 4, rx = Math.cos(ang) * .07, ry = Math.sin(ang) * .05;
        host.point(w.x + rx, w.y + ry, w.h + Math.sin(ang * 2) * .05, c, {emit: true, alpha: a * .55});
      }
      w.trail.forEach(([x, y, h], i) => { if (i > 1 && i % 2 === 0) host.point(x, y, h, c, {emit: true, alpha: a * (1 - i / 10) * .7}); });
    }
  }
  function drawArrowFire() {
    for (const a of host.arrows) if (a.fire) {
      const l = Math.hypot(a.vx, a.vy, a.vh) || 1, dx = a.vx / l, dy = a.vy / l, dh = a.vh / l, k = a.stuck ? Math.min(1, a.life / 2) : 1;
      if (k <= 0) continue;
      const fl = Math.floor(T * 14 + a._id) % 3;
      host.point(a.x - dx * .12, a.y - dy * .12, a.h - dh * .12 + .04, FIRE[fl === 0 ? 0 : 1], {emit: true, size: a.stuck ? 1 : 2, alpha: k});
      host.point(a.x - dx * .18, a.y - dy * .18, a.h - dh * .18 + .09, FIRE[2], {emit: true, alpha: k * .8});
    }
  }
  function drawParts() {
    for (const q of parts) {
      if (!near(q.x, q.y, 16)) continue;
      const u = q.t / q.life;
      if (q.k === 'smoke') host.point(q.x, q.y, q.h, q.c, {size: (q.sz || 2) + (u > .5 ? 1 : 0), alpha: (q.a0 ?? .5) * (1 - u)});
      else if (q.k === 'spore') host.point(q.x, q.y, q.h, q.c, {emit: true, alpha: (1 - u) * .9});
      else host.point(q.x, q.y, q.h, q.k === 'ember' ? q.c : FIRE[Math.min(3, Math.floor(u * 4))], {emit: true, alpha: u > .6 ? (1 - u) * 2.5 : 1});
    }
  }

  // ================================================================ contract
  F.update = (dt, evs) => {
    const t0 = performance.now();
    T += dt; syncBiome();
    stepArrows(dt); stepBurning(dt);
    if (F.on) {
      stepCandles(dt, evs); stepShrooms(dt); stepWisps(dt);
      stepFlame(camp.fl, dt, camp.x, camp.y); if (!beacon.unlit) stepFlame(beacon.fl, dt, beacon.x, beacon.y);
      if (near(camp.x, camp.y, 20)) {   // the campfire's sparks and smoke
        if (R() < dt * 14) parts.push({x: camp.x + rr(-.12, .12), y: camp.y + rr(-.08, .08), h: .4, vx: rr(-.2, .2), vy: rr(-.2, .2), vh: rr(1, 2.3), t: 0, life: rr(.6, 1.4), k: 'spark', c: FIRE[0], g: -.2});
        if (R() < dt * 7) parts.push({x: camp.x + rr(-.08, .08), y: camp.y, h: .9, vx: 0, vy: 0, vh: rr(.35, .55), t: 0, life: rr(2.2, 3.4), k: 'smoke', c: SMOKE[R() * 3 | 0], sz: 2, a0: .5});
      }
      if (!beacon.unlit && near(beacon.x, beacon.y, 20) && R() < dt * 18) parts.push({x: beacon.x + rr(-.15, .15), y: beacon.y + rr(-.1, .1), h: beacon.z + 1.5, vx: rr(-.3, .3), vy: rr(-.3, .3), vh: rr(1.4, 2.8), t: 0, life: rr(.7, 1.5), k: 'spark', c: FIRE[0], g: -.2});
    }
    for (let i = flares.length - 1; i >= 0; i--) if ((flares[i].t += dt) > flares[i].life) flares.splice(i, 1);
    stepParts(dt);
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  F.frame = () => {
    syncBiome();
    camp.mesh?.setVisible(F.on); beacon.mesh?.setVisible(F.on);
    if (F.on) { drawCampfire(); drawBeacon(); drawSmall(); drawWisps(); }
    else for (const [p, b] of burning) if (near(p.x, p.y)) drawFire('burn', b.fl, p.x, p.y + .01, (p.z || 0) + (TOP[p.kind] ?? .8) - .25);
    drawArrowFire(); drawParts();
  };
  F.lights = () => {
    const out = [];
    if (F.on) {
      out.push({x: camp.x, y: camp.y, h: .75, color: '#ffa048', radius: 6.5, intensity: 1.25, flicker: .55, id: 9101, jitter: .05});
      if (!beacon.unlit) out.push({x: beacon.x, y: beacon.y, h: beacon.z + 1.45, color: host.biome.style.torch || '#ffc850', radius: 8.5, intensity: 1.45, flicker: .4, id: 9102, jitter: .06});
      for (const c of candles) if (c.lit) out.push({x: c.x, y: c.y, h: c.h + .3, color: '#ffc070', radius: 2.3, intensity: .75, flicker: .35, id: c.id, jitter: .015});
      for (const s of shrooms) out.push({x: s.x, y: s.y, h: .3, color: GLOW[biomeId] || GLOW.ruins, radius: 2.4 + s.b * .8, intensity: .45 + s.b * .45, flicker: 0, id: s.id});
      for (const w of wisps) if (w.fade > .05) out.push({x: w.x, y: w.y, h: w.h, color: WISP[biomeId] || WISP.ruins, radius: 3.1, intensity: 1.15 * w.fade, flicker: .12, id: w.id});
    }
    for (const [p, b] of burning) { const k = Math.min(1, b.t / .4) * (p.kind === 'dummy' ? clamp((b.dur - b.t) / 1, 0, 1) : 1); out.push({x: p.x, y: p.y, h: (p.z || 0) + (p.h || 0) + (TOP[p.kind] ?? .8) + .2, color: '#ff9a40', radius: 3.4, intensity: 1.05 * k, flicker: .6, id: 9200 + (p.x * 7 | 0) % 90, jitter: .04}); }
    for (const a of host.arrows) if (a.fire) { const k = a.stuck ? clamp(a.life / 2, 0, 1) : 1; if (k > 0) out.push({x: a.x, y: a.y, h: a.h + .1, color: '#ffa040', radius: 2.6, intensity: .9 * k, flicker: .5, id: 9300 + (a._id || 0) % 60}); }
    for (const f of flares) { const k = 1 - f.t / f.life; out.push({x: f.x, y: f.y, h: f.h, color: f.c, radius: f.r * (.7 + .3 * k), intensity: f.k * k * k, flicker: 0, id: 9400}); }
    return out;
  };
  F.onArrowHit = (a, p) => { if (a.fire && BURNS[p.kind]) ignite(p); };   // nothing returned: combat resolves the hit
  F.interact = p => {
    if (p === beacon && beacon.unlit) { light(beacon); return true; }
    return false;
  };
  F.prompt = p => p === beacon && beacon.unlit ? 'E  light the beacon' : null;   // the host's prompt hook (the whole label)
  F.toggle = () => { F.on = !F.on; };
  F.biomeChanged = async () => {
    syncBiome();
    for (const p of props()) if (p.kind === 'torch' && !host.itemOf(p)) await host.world.addItem(p);
    meshes.length = 0; buildMeshes();   // the rebuilt world disposed our meshes
  };
  F.hud = () => `fire ${host.arrows.filter(a => a.fire).length} · burning ${burning.size}`;
  F._ = {camp, beacon, candles, shrooms, wisps, parts, burning, flares, ignite, light, atlas: () => atlas};
  return F;
}
