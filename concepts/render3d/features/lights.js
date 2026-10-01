// LIGHTS (render3d): light sources that read right from every side, and the things that react to them.
// OWNER: the lights session. Key 9 toggles the extra sources (the wall sconces are a fix and always stay).
//
//   sconces   the arena's wall torches hang on the walls' INNER faces now (the torch prop with p.sconce: biomes.js paints
//             the stick + cup only, wind.js still gives it the live flame), on a real 3D iron bracket (plate, arm, brace,
//             collar) built here, so from any side the bracket meets the wall. The layout's east pair, a lit pair at the
//             north gate and an UNLIT pair at the west gate (p.unlit: shoot a fire arrow at them)
//   campfire  in the yard: a stone ring (3D, the stones throw little shadow rays) round a teepee of 3D logs that really
//             burn: each chars, glowing veins crawl through it, it burns away from the tip, falls in across the coals
//             (a crash of sparks, ash), burns on lying down and crumbles into the ash bed. The fire is as big as its
//             wood. E throws a log on from the woodpile beside it (or stirs it: sparks); left alone it burns down to
//             embers (and is restocked while nobody is near). Sparks, smoke, a scorched ring, heat haze, a dancing light
//   embers    now and then one drops off a torch head or spills over a brazier's rim: it floats down glowing, may
//             bounce (sparks), lies on the ground and cools to grey ash
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
//             dummy it sets it alight: the wood chars, glowing veins crawl through it, it may spread to its neighbours,
//             it slumps and crumbles (embers and charcoal falling off), then lies as charred remains that glow down,
//             crumble to an ash pile and fade (it comes back like anything broken). A powder keg cooks off; dummies go out
//
// FEATURE CONTRACT (main.js): create(host) -> F with update / frame / lights / onArrowHit / interact / biomeChanged.
// It sits BEFORE combat in the feature order: onArrowHit sees the hit first (to catch fire) and returns nothing, so
// combat still resolves it. Props it adds (sconces, the campfire, the beacon) live in host.props like the layout's.
import {ART} from '../../sprites/arena/biomes.js';
import {STREAM, PLAY} from '../../sprites/arena/layout.js';
import * as WORLD from '../world.js';
import {geoOf, M4, along} from './kit3d.js';
import {createFires} from './firesim.js';
// how high our props stop arrows (main.js reads world.js PROP_TOP; 2.5 m otherwise): arrows fly over the campfire
// (they catch fire going through it), the beacon only stops them up to its basket
if (WORLD.PROP_TOP) Object.assign(WORLD.PROP_TOP, {campfire: 0, beacon: 1.15, woodpile: .3});

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
const BURNS = {crate: 9, barrel: 11, barrel_x: 1.1, dummy: 12};   // seconds alight before it crumbles (keg: cooks off; dummies go out)
const ASHC = ['#9e9890', '#7e7a74', '#64605b', '#4a4744'].map(rgb), ASH1 = rgb('#3e3a37');   // ash greys; a cooled ember
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

  // ================================================================ 3D pieces (kit3d: the prop pipeline's ramps, outlines, shadows)
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
    return geoOf(L);   // (its logs are meshes of their own: they burn down, fall in, crumble)
  }
  // one log, its foot at 0 and LOG_L m up +y (its matrix shortens and thins it as it burns away); the woodpile's too
  const LOG_L = .46, logGeo = geoOf([{...along([0, 0, 0], [0, LOG_L, 0], .056, .048, 7), fam: 'wood'},
    {g: new THREE.CylinderGeometry(.042, .046, .008, 7), m: M4([0, .002, 0]), fam: 'rope', fixed: 1},           // the sawn ends: pale end grain
    {g: new THREE.CylinderGeometry(.036, .04, .008, 7), m: M4([0, LOG_L - .002, 0]), fam: 'rope', fixed: 1}]);
  function beaconGeo() {
    const L = [
      {g: new THREE.BoxGeometry(.84, .12, .84), m: M4([0, .06, 0]), fam: 'stone'},
      {g: new THREE.CylinderGeometry(.27, .33, .62, 8), m: M4([0, .43, 0]), fam: 'stone'},
      {g: new THREE.CylinderGeometry(.36, .36, .06, 8), m: M4([0, .77, 0]), fam: 'stone', bias: .2},
      {g: new THREE.CylinderGeometry(.36, .2, .2, 8, 1, true), m: M4([0, .9, 0]), fam: 'metal'},   // (open: its ash bed shows)
      {g: new THREE.TorusGeometry(.36, .025, 4, 8), m: M4([0, 1.0, 0], [Math.PI / 2, 0, 0]), fam: 'metal', bias: .3},
    ];
    L.push({g: new THREE.CylinderGeometry(.31, .31, .03, 8), m: M4([0, .99, 0]), fam: 'void'});   // the bed of ash and coals
    for (let i = 0; i < 6; i++) {   // split logs piled across each other
      const a = i / 6 * Math.PI + (i & 1) * .25, c = Math.cos(a) * .26, s = Math.sin(a) * .26, y = 1.02 + (i % 3) * .035;
      L.push({...along([-c, y, -s], [c, y + .03, s], .032, .03), fam: i < 3 ? 'wood' : 'void'});
    }
    return geoOf(L);
  }
  // a 3D brazier (the arena's sprite keeps only its coals + flame: p.model), local: y up, the bowl's rim at .95 m
  function brazierGeo() {
    const L = [], ring = (r, t, y, fam, bias = 0) => ({g: new THREE.TorusGeometry(r, t, 4, 10), m: M4([0, y, 0], [Math.PI / 2, 0, 0]), fam, bias});
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * TAU + .5, c = Math.cos(a), s = Math.sin(a);
      L.push({...along([c * .31, 0, s * .31], [c * .17, .8, s * .17], .024, .02), fam: 'metal', bias: -.1});
      L.push({g: new THREE.BoxGeometry(.08, .03, .08), m: M4([c * .32, .015, s * .32], [0, -a, 0]), fam: 'metal'});
    }
    L.push(ring(.235, .016, .32, 'metal', -.15));                                                       // the leg brace
    L.push({g: new THREE.CylinderGeometry(.31, .17, .17, 10, 1, true), m: M4([0, .86, 0]), fam: 'metal'});   // the bowl (open: its coal bed shows, no z-fight)
    L.push(ring(.31, .024, .95, 'metal', .3));                                                          // its rim
    L.push({g: new THREE.CylinderGeometry(.28, .28, .02, 10), m: M4([0, .935, 0]), fam: 'void'});       // the coal bed
    return geoOf(L);
  }
  const campGeo = campfireGeo(), beacGeo = beaconGeo(), brazGeo = brazierGeo();

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
    for (const p of props()) if (p.kind === 'torch') { p.lightable = true; p.fx = true; }
    return added;
  }
  // the campfire and the beacon are props too (they collide; the beacon is an E target)
  const clearAround = (x, y, r) => { for (const q of props()) if ((q.kind === 'tuft' || q.kind === 'bush' || q.kind === 'rock') && Math.hypot(q.x - x, q.y - y) < r) q.gone = true; };
  let camp = props().find(p => p.kind === 'campfire'), beacon = props().find(p => p.kind === 'beacon');
  if (!camp) { camp = {kind: 'campfire', x: 50.8, y: 19.4, z: 0, r: .55}; props().push(camp); clearAround(camp.x, camp.y, 1.3); }
  if (!beacon) { beacon = {kind: 'beacon', x: 49.6, y: 10.35, z: 2.4, r: .45, unlit: true, interact: 'light the beacon'}; props().push(beacon); clearAround(beacon.x, beacon.y, 1); }
  // the woodpile beside the campfire (a prop: it collides; arrows fly over it)
  let pile = props().find(p => p.kind === 'woodpile');
  if (!pile) { pile = {kind: 'woodpile', x: camp.x + 1.05, y: camp.y - .32, z: 0, r: .3, a: 1.05}; props().push(pile); clearAround(pile.x, pile.y, .7); }
  const PILE = [[-.115, .056], [0, .056], [.115, .056], [-.058, .154], [.058, .154], [0, .252]];   // its logs: [across, h], bottom up
  pile.n = PILE.length; camp.interact = 'tend the fire';
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

  // ================================================================ the campfire's wood
  // Five logs stand in a teepee, each burning at its own pace (wood left f: 1 -> 0). At a quarter left a log falls in
  // across the coals; lying, it burns faster and crumbles into the ash bed. campK (the fire's size) follows the wood.
  const CAMP_N = 5;
  const logs = [];   // {slot, a, f, rate, st: 'drop' | 'stand' | 'fall' | 'lie', ph, la, ly, age, sd, m}
  let ash = 1.3, campK = 1, campRate = 1;
  function newLog(slot, f, age, st = 'stand') {
    const L = {slot, a: slot / CAMP_N * TAU + .4 + rr(-.12, .12), f, rate: 1 / rr(75, 115), st, ph: 0, la: 0, ly: .04, age, sd: R() * 9, m: null};
    logs.push(L); return L;
  }
  [1, .88, .76, .64, .52].sort(() => R() - .5).forEach((f, i) => newLog(i, f + rr(-.04, .04), rr(30, 90)));
  const freeSlot = () => { for (let i = 0; i < CAMP_N; i++) if (!logs.some(L => L.slot === i && L.st !== 'lie')) return i; return -1; };
  const canAdd = () => pile.n > 0 && freeSlot() >= 0;
  const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _d = new THREE.Vector3(), _s = new THREE.Vector3(), _ax = new THREE.Vector3(), _M = new THREE.Matrix4(), UPV = new THREE.Vector3(0, 1, 0);
  function logMatrix(L) {   // world X, Y (up), Z
    const c = Math.cos(L.a), s = Math.sin(L.a), f = Math.max(0, L.f);
    // standing: its foot on the ring, leaning in over the middle (it burns away from the tip: the flame is there)
    let bx = camp.x + c * .31, bh = 0, by = camp.y + s * .31, dx = -c * .28, dh = .37, dy = -s * .28;
    if (L.st === 'fall' || L.st === 'lie') {   // falling in (accelerating), then lying across the coals
      const e = L.st === 'lie' ? 1 : L.ph * L.ph, lc = Math.cos(L.la), ls = Math.sin(L.la);
      bx += (camp.x + lc * .3 - bx) * e; bh += (L.ly - bh) * e; by += (camp.y + ls * .3 - by) * e;
      dx += (-lc * .46 - dx) * e; dh += (.012 - dh) * e; dy += (-ls * .46 - dy) * e;
    } else if (L.st === 'drop') {   // thrown on from the woodpile: an arc, swinging upright as it lands
      const e = L.ph, k = 1 - e, pc = Math.cos(pile.a) * .46, ps = Math.sin(pile.a) * .46;
      bx = pile.x * k + bx * e; by = pile.y * k + by * e; bh = .21 * k + Math.sin(e * Math.PI) * .55;
      dx = pc * k + dx * e; dh *= e; dy = ps * k + dy * e;
    }
    const len = .34 + .66 * f, kt = .78 + .22 * f;
    _d.set(dx, dh, dy).normalize(); _q.setFromUnitVectors(UPV, _d);
    return _M.compose(_v.set(bx, bh, by), _q, _s.set(kt, len, kt));
  }
  function pileMatrix(i) {
    const [o, h] = PILE[i], c = Math.cos(pile.a), s = Math.sin(pile.a);
    _d.set(c, 0, s); _q.setFromUnitVectors(UPV, _d);
    return _M.compose(_v.set(pile.x - s * o - c * .25, h, pile.y + c * o - s * .25), _q, _s.set(1, .5 / LOG_L, 1));
  }
  const brazMeshes = new Map();   // brazier -> its mesh (the coal bed's glowing veins)

  function buildMeshes() {
    for (const m of meshes) m.dispose(); meshes.length = 0;
    for (const p of props()) if (p.kind === 'torch' && p.mount) {
      const [nx, ny] = p.mount, th = Math.atan2(-ny, nx);
      meshes.push(host.world.mesh(bracketGeo, M4([p.x - nx * D, p.z || 0, p.y - ny * D], [0, th, 0])));
    }
    for (const p of props()) if (p.kind === 'brazier') {   // the bowl and tripod are 3D (not a light occluder: its own flame is in it)
      p.model = true; p.fx = true;
      const m = host.world.mesh(brazGeo, M4([p.x, p.z || 0, p.y], [0, (p.light | 0) * 1.1, 0])); meshes.push(m); brazMeshes.set(p, m);
    }
    camp.mesh = host.world.mesh(campGeo, M4([camp.x, 0, camp.y], [0, .3, 0]), {occlude: true}); meshes.push(camp.mesh);   // its stones throw little shadow rays
    // (not a point-light occluder: its flame sits in the basket, which would ring it with a black disc)
    beacon.mesh = host.world.mesh(beacGeo, M4([beacon.x, beacon.z, beacon.y], [0, .2, 0])); meshes.push(beacon.mesh);
    for (const L of logs) { L.m = host.world.mesh(logGeo, logMatrix(L)); meshes.push(L.m); }   // (not light occluders: they move)
    pile.meshes = PILE.map((_, i) => { const m = host.world.mesh(logGeo, pileMatrix(i).clone(), {occlude: true}); meshes.push(m); return m; });
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
    if (F.on) { out.push([camp.x, camp.y, .7]); if (!beacon.unlit) out.push([beacon.x, beacon.y, beacon.z + 1.3]); }
    for (const [p] of burning) out.push([p.x, p.y, (p.z || 0) + (p.h || 0) + (TOP[p.kind] ?? .8)]);
    return out;
  }
  const pals = new Map();   // '#rrggbb' -> the flame's 4 tones (hot core .. dark tip), for sparks
  function palOf(c) { let p = pals.get(c); if (!p) pals.set(c, p = [ART.mixHex(c, '#ffffff', .6), ART.mixHex(c, '#ffffff', .15), c, ART.mixHex(c, '#000000', .35)].map(rgb)); return p; }
  function flare(x, y, h, c, r = 4, k = 2.2, life = .5) { flares.push({x, y, h, c, r, k, t: 0, life}); }
  function burst(x, y, h, n, c = FIRE, speed = 1.6) {
    for (let i = 0; i < n; i++) { const a = R() * TAU, s = rr(.3, speed); parts.push({x, y, h, vx: Math.cos(a) * s, vy: Math.sin(a) * s * .8, vh: rr(.5, 2.4), t: 0, life: rr(.35, .8), k: 'spark', pal: c, g: 3}); }
  }
  // a falling ember (k 'drip'): it floats down glowing, flutters, may bounce (sparks), lies there and cools to ash. gz: the ground
  function drip(x, y, h, gz, pal, o = {}) {
    parts.push({x, y, h, vx: o.vx ?? rr(-.06, .06), vy: o.vy ?? rr(-.06, .06), vh: o.vh ?? rr(-.15, .1), t: 0, life: 14, k: 'drip', pal, gz, heat: 1, land: 0, cool: rr(1.6, 3.4), sd: R() * TAU});
  }
  function ashPuff(x, y, h, n, r) {   // grey ash: light, it hangs and drifts
    for (let i = 0; i < n; i++) { const a = R() * TAU, v = rr(.1, .5), d = r * R(); parts.push({x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, h: h + rr(0, .1), vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: rr(.15, .55), t: 0, life: rr(.9, 1.8), k: 'smoke', c: ASHC[R() * 3 | 0], sz: 1, a0: .55}); }
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
    burning.set(p, {t: 0, dur: dur * rr(.9, 1.15), spread: 0, sd: R() * TAU});
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
  const ashes = new Map();     // burnt-through prop -> {t, life, sd, cr (crumbling 0..1), gone}: charred remains, then an ash pile
  const scorched = new Map();  // a dummy that burnt out -> {t}: its char fades
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const crumbleOf = b => sstep(.72, 1, b.t / b.dur);
  const flameK = (p, b) => { const u = b.t / b.dur; return p.kind === 'dummy' ? clamp((b.dur - b.t) / 1.5, 0, 1) * Math.min(1, u * 12) : Math.min(1, u * 12) * (u > .7 ? 1 - (u - .7) / .3 * .5 : 1); };
  function stepBurning(dt) {
    const core = host.feature('combat')?.core;
    for (const [p, b] of burning) {
      b.t += dt;
      if (p.broken || p.gone) {   // smashed or blown apart while alight: what's left smoulders
        burning.delete(p); if (p.broken && !p.explode && p.kind !== 'dummy') ashes.set(p, {t: 0, life: rr(10, 16), sd: b.sd, cr: 0}); continue;
      }
      const u = b.t / b.dur, fk = flameK(p, b), base = (p.z || 0) + (p.h || 0), top = base + (TOP[p.kind] ?? .8) * (1 - crumbleOf(b) * .55);
      if (R() < dt * 26 * fk) parts.push({x: p.x + rr(-.15, .15), y: p.y + rr(-.1, .1), h: top, vx: rr(-.2, .2), vy: rr(-.2, .2), vh: rr(.8, 1.8), t: 0, life: rr(.4, .9), k: 'spark', c: FIRE[R() * 3 | 0], g: -.3});
      if (R() < dt * 9) parts.push({x: p.x + rr(-.1, .1), y: p.y, h: top + .25, vx: 0, vy: 0, vh: rr(.35, .6), t: 0, life: rr(1.6, 2.6), k: 'smoke', c: SMOKE[R() * 3 | 0], sz: 2, a0: .55});
      if (u > .45 && R() < dt * (u > .7 ? 9 : 2.5)) {   // burning through: embers and charcoal drop off its sides
        const a = R() * TAU, r = Math.max(.2, p.r || .3) * rr(.7, 1.1);
        drip(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, base + rr(.15, .65) * (top - base), p.z || 0, FIRE, {vx: Math.cos(a) * rr(.1, .4), vy: Math.sin(a) * rr(.1, .4), vh: rr(0, .5)});
      }
      if (u > .7 && R() < dt * 3) ashPuff(p.x, p.y, base + .2, 3, .25);
      // it spreads to wooden neighbours
      b.spread += dt;
      if (b.spread > 1.4) { b.spread = 0; for (const q of props()) if (q !== p && !burning.has(q) && BURNS[q.kind] && !q.broken && Math.hypot(q.x - p.x, q.y - p.y) < 1.4 && R() < .45) ignite(q); }
      if (b.t < b.dur) continue;
      burning.delete(p);
      if (p.kind === 'dummy') { scorched.set(p, {t: 0}); continue; }
      if (!core) continue;
      if (p.explode) { core.breakProp(p, {}); continue; }   // the powder keg cooks off
      core.breakProp(p, {ash: true});   // burnt through: it slumps into charred remains
      ashes.set(p, {t: 0, life: rr(22, 30), sd: b.sd, cr: 0});
      burst(p.x, p.y, base + .3, 18, FIRE, 1.4); ashPuff(p.x, p.y, base + .15, 12, .35);
      flare(p.x, p.y, base + .5, '#ff9a40', 4.5, 1, .4);
      host.events.push({type: 'crackle', x: p.x, y: p.y, big: true});
    }
    for (const [p, e] of ashes) {
      if (!p.broken) { host.itemOf(p)?.live?.burn?.(0, 0, 0, 0); if (e.gone) p.gone = false; ashes.delete(p); continue; }   // it came back
      e.t += dt;
      const base = p.z || 0, fl = clamp(1 - e.t / 9, 0, 1);   // the flames on the remains die down
      if (R() < dt * 14 * fl) parts.push({x: p.x + rr(-.2, .2), y: p.y + rr(-.15, .15), h: base + .25, vx: rr(-.2, .2), vy: rr(-.2, .2), vh: rr(.6, 1.4), t: 0, life: rr(.3, .7), k: 'spark', c: FIRE[0], g: -.3});
      if (!e.gone && R() < dt * 2.2 * clamp(1 - e.t / (e.life + 3), .15, 1)) parts.push({x: p.x + rr(-.15, .15), y: p.y + rr(-.1, .1), h: base + .3, vx: 0, vy: 0, vh: rr(.25, .45), t: 0, life: rr(1.6, 2.8), k: 'smoke', c: SMOKE[R() * 3 | 0], sz: 1, a0: .4});
      if (!e.gone && e.t > e.life) {   // the remains crumble to an ash pile
        e.cr = Math.min(1, (e.t - e.life) / 2.5);
        if (R() < dt * 7) ashPuff(p.x + rr(-.2, .2), p.y + rr(-.2, .2), base + .1, 2, .15);
        if (e.cr >= 1) { e.gone = true; p.gone = true; ashPuff(p.x, p.y, base + .08, 10, .3); }
      }
    }
    for (const [p, e] of scorched) if ((e.t += dt) > 50) { host.itemOf(p)?.live?.burn?.(0, 0, 0, 0); scorched.delete(p); }
  }
  function burnVisuals() {   // the burning props' meshes: char, veins, ash, the slump; the remains glowing down
    for (const [p, b] of burning) {
      const it = host.itemOf(p), m = it?.live; if (!m?.burn) continue;
      const u = b.t / b.dur, cr = crumbleOf(b);
      m.burn(.04 + sstep(0, .75, u), clamp(u * 6, 0, 1) * (.75 + .25 * Math.sin(T * 3 + b.sd)), T + b.sd, sstep(.65, 1, u) * .4);
      if (cr > 0 && !it.manageMatrix) {   // it sags and slumps as it burns through
        _ax.set(Math.cos(b.sd), 0, Math.sin(b.sd)); _q.setFromAxisAngle(_ax, cr * .14);
        m.setMatrix(_M.compose(_v.set(p.x, (p.z || 0) + (p.h || 0), p.y), _q, _s.set(1 + cr * .14, 1 - cr * .6, 1 + cr * .14)));
      }
    }
    for (const [p, e] of ashes) {
      const m = host.itemOf(p)?.live; if (!m?.burn || e.gone) continue;
      const k = clamp(1 - e.t / e.life, 0, 1);
      m.burn(1, k ** 1.4 * (.7 + .3 * Math.sin(T * 2 + e.sd)), T + e.sd, .35 + .3 * (1 - k));
      if (e.cr > 0) m.setMatrix(_M.compose(_v.set(p.x, p.z || 0, p.y), _q.identity(), _s.set(1 + e.cr * .25, Math.max(.02, 1 - e.cr), 1 + e.cr * .25)));
    }
    for (const [p, e] of scorched) { const m = host.itemOf(p)?.live; if (m?.burn) { const k = clamp(1 - e.t / 50, 0, 1); m.burn(k, clamp(1 - e.t / 5, 0, 1) * .6, T, .4 * k); } }
  }
  function drawAshes() {   // ash piles: grey flecks in a low mound, a few embers breathing in them while they're warm
    for (const [p, e] of ashes) {
      if (!near(p.x, p.y)) continue;
      const fade = e.gone ? clamp(1 - (e.t - e.life - 2.5) / 60, 0, 1) : 1; if (fade <= 0) continue;
      const grow = e.gone ? 1 : .35 + e.cr * .65, n = Math.round(44 * grow), heat = clamp(1 - e.t / (e.life + 25), 0, 1), s0 = e.sd * 10 | 0;
      // the ash on the ground under it (an exact projected disc, whole pixels), spreading as the remains crumble
      const z = host.zoom, [cx, cy] = host.toView(p.x, p.y, p.z || 0), q = host.layer('ground'), ra = .16 + .2 * grow, ax = ra * PPM * z, ay = ra * PPMY * z;
      for (let j = -Math.ceil(ay); j <= Math.ceil(ay); j++) {
        const t = j / ay; if (Math.abs(t) > 1) continue;
        const hw = ax * Math.sqrt(1 - t * t) - (ART.hsh(j, s0) < .4 ? 1 : 0);
        q.fillStyle = `rgba(${Math.abs(t) < .5 ? '112,107,100' : '84,80,75'},${(.5 * fade).toFixed(3)})`;
        q.fillRect(Math.round(cx - hw), Math.round(cy + j), Math.round(hw * 2), 1);
      }
      for (let i = 0; i < n; i++) {
        const a = ART.hsh(i, 7, s0) * TAU, d = Math.sqrt(ART.hsh(i, 8, s0)) * .38, h = (p.z || 0) + .012 + (1 - d / .38) * .05 * grow;
        const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d, pulse = .5 + .5 * Math.sin(T * (1.1 + ART.hsh(i, 9, s0)) + i * 1.7);
        if (i % 4 === 0 && heat * pulse > .2) host.point(x, y, h, FIRE[heat * pulse > .6 ? 2 : 3], {emit: true});
        else host.point(x, y, h, ASHC[(i * 7) % 4], {alpha: fade, size: d < .2 ? 2 : 1});
      }
      if (e.t < 9) fires.draw(p, 'burn', '#ff9a40', p.x, p.y + .01, (p.z || 0) + .1, {on: clamp(1 - e.t / 9, 0, 1), height: .55, scale: .6});
    }
  }
  function stepCamp(dt) {
    let fuel = 0;
    for (let i = logs.length - 1; i >= 0; i--) {
      const L = logs[i]; L.age += dt;
      if (L.st === 'drop') { if ((L.ph += dt / .5) >= 1) { L.st = 'stand'; L.ph = 0; logLands(L); } continue; }
      if (L.st === 'fall' && (L.ph += dt / .45) >= 1) { L.st = 'lie'; logFalls(L); }
      L.f -= dt * L.rate * campRate * (L.st === 'lie' ? 1.8 : 1);
      if (L.st === 'stand' && L.f < .24) {   // burnt through at the foot: it falls in
        L.st = 'fall'; L.ph = 0; L.la = L.a + rr(-.7, .7); L.ly = .05 + logs.filter(q => q.st === 'lie').length % 3 * .034;
      }
      if (L.f <= 0) {   // crumbled into the ash bed
        L.m?.dispose(); logs.splice(i, 1); ash = Math.min(4, ash + .7); ashPuff(camp.x, camp.y, .06, 6, .25); continue;
      }
      fuel += L.st === 'lie' ? L.f * 1.5 + .12 : L.f;
    }
    campK += (clamp(fuel / 2.6, .1, 1.15) - campK) * (1 - Math.exp(-dt * .9));
    // nobody near: the fire is tended (fed back up, the pile restocked)
    if (!near(camp.x, camp.y, 18) && logs.filter(L => L.st !== 'lie').length < 3) {
      for (let sl; (sl = freeSlot()) >= 0;) { const L = newLog(sl, rr(.85, 1), rr(20, 50)); L.m = host.world.mesh(logGeo, logMatrix(L)); meshes.push(L.m); }
      pile.n = PILE.length;
    }
  }
  const campFlare = (k = .8, pop = 0) => { const fc = fires._.get('camp'); if (fc) { fc.flare = Math.max(fc.flare, k); fc.pop = Math.max(fc.pop || 0, pop); } };
  function logLands(L) {   // a log thrown on: sparks, the flames jump
    const c = Math.cos(L.a), s = Math.sin(L.a), pal = palOf(campCol());
    burst(camp.x + c * .1, camp.y + s * .1, .3, 16, pal, 1.4); ashPuff(camp.x, camp.y, .1, 5, .3);
    flare(camp.x, camp.y, .6, campCol(), 5.5, 1, .35); campFlare(.8, .6);
    host.events.push({type: 'crackle', x: camp.x, y: camp.y, big: true});
  }
  function logFalls(L) {   // it falls in: a crash of sparks, a puff of ash, embers knocked out
    const lc = Math.cos(L.la), ls = Math.sin(L.la), pal = palOf(campCol());
    burst(camp.x, camp.y, .15, 22, pal, 2); ashPuff(camp.x + lc * .12, camp.y + ls * .12, .08, 9, .4);
    flare(camp.x, camp.y, .5, campCol(), 6, 1.2, .4); campFlare(1, 1);
    for (let i = 0; i < 6; i++) { const u = R(); drip(camp.x + lc * (.3 - u * .46), camp.y + ls * (.3 - u * .46), .12, 0, pal, {vx: rr(-.6, .6), vy: rr(-.6, .6), vh: rr(.6, 1.4)}); }
    host.events.push({type: 'crackle', x: camp.x, y: camp.y, big: true}, {type: 'logFall', x: camp.x, y: camp.y});
  }
  function tend() {   // E at the campfire: a log on from the pile, or (the teepee full / the pile empty) a stir
    if (canAdd()) {
      const L = newLog(freeSlot(), 1, 0, 'drop'); pile.n--;
      L.m = host.world.mesh(logGeo, logMatrix(L)); meshes.push(L.m);
      host.events.push({type: 'addWood', x: camp.x, y: camp.y});
      return;
    }
    const pal = palOf(campCol());
    burst(camp.x, camp.y, .25, 26, pal, 2.2); flare(camp.x, camp.y, .6, campCol(), 6, 1, .45); campFlare(1, 1); ashPuff(camp.x, camp.y, .1, 6, .3);
    for (let i = 0; i < 4; i++) drip(camp.x + rr(-.15, .15), camp.y + rr(-.15, .15), .3, 0, pal, {vx: rr(-.9, .9), vy: rr(-.9, .9), vh: rr(1, 2)});
    host.events.push({type: 'crackle', x: camp.x, y: camp.y, big: true});
  }
  function campVisuals() {   // the logs' poses and how burnt they are; the pile
    for (const L of logs) if (L.m) {
      L.m.setMatrix(logMatrix(L)); L.m.setVisible(F.on);
      if (L.st === 'drop') { L.m.burn(0, 0, 0, 0); continue; }
      const ch = clamp(Math.min(1, L.age / 25) * .5 + (1 - L.f) * .75, .02, 1);
      const g = clamp(L.age / 5, 0, 1) * (.5 + .4 * (1 - L.f)) * (.8 + .2 * Math.sin(T * 2.3 + L.sd)) * (.55 + .45 * Math.min(1, campK));
      L.m.burn(ch, g, T + L.sd, clamp((.5 - L.f) * 1.5, 0, .8));
    }
    pile.meshes?.forEach((m, i) => m.setVisible(F.on && i < pile.n));
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
  function stepParts(dt) {
    const wd = host.wind?.on && host.wind.at ? host.wind.at(host.player.x, host.player.y) : {x: 0, y: 0};
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.t += dt;
      if (q.t >= q.life) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }   // (swap-remove: splice made this O(n^2))
      if (q.k === 'drip') {   // a falling ember: it floats down, flutters, may bounce (sparks), lands and cools
        if (!q.land) {
          q.tx = q.x; q.ty = q.y; q.th = q.h;
          q.vh -= 2.6 * dt; q.vh *= Math.exp(-dt * 1.1);
          q.vx += (Math.sin(q.t * 10 + q.sd) * .5 + (wd.x * .12 - q.vx) * .6) * dt; q.vy += (Math.cos(q.t * 8 + q.sd) * .4 + (wd.y * .12 - q.vy) * .6) * dt;
          q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt; q.heat = Math.max(.62, q.heat - dt * .07);
          if (q.h <= q.gz) {
            q.h = q.gz + .004;
            if (!q.bounced && q.vh < -.8 && R() < .55) {
              q.bounced = 1; q.vh = -q.vh * .3; q.vx = q.vx * .4 + rr(-.3, .3); q.vy = q.vy * .4 + rr(-.3, .3);
              for (let j = 0; j < 2; j++) parts.push({x: q.x, y: q.y, h: q.h + .02, vx: rr(-.6, .6), vy: rr(-.5, .5), vh: rr(.5, 1.2), t: 0, life: rr(.2, .4), k: 'spark', pal: q.pal, g: 3});
            } else { q.land = q.t; q.vx = q.vy = q.vh = 0; q.life = q.t + q.cool + 1; }
          }
        } else q.heat = Math.max(0, 1 - (q.t - q.land) / q.cool) * .9;
        continue;
      }
      const drift = q.k === 'smoke' ? .35 : q.k === 'spore' ? .25 : .12;
      q.vx += (wd.x * drift - q.vx) * dt * .8; q.vy += (wd.y * drift - q.vy) * dt * .8;
      if (q.k === 'spark' || q.k === 'ember') { q.vx += (R() - .5) * dt * 6; q.vy += (R() - .5) * dt * 6; q.vh -= (q.g ?? 0) * dt; }
      if (q.k === 'spore') { q.vh *= Math.exp(-dt * 1.5); q.vx += Math.sin(q.t * 5 + i) * dt * .3; }
      if (q.k === 'spark' || q.k === 'ember') { q.tx = q.x; q.ty = q.y; q.th = q.h; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt;
      if (q.k === 'smoke') q.vh *= Math.exp(-dt * .3);
      if (q.h < 0 && q.k !== 'ember') q.h = 0;
    }
    if (parts.length > 1100) parts.splice(0, parts.length - 1100);
  }

  // ================================================================ draw
  const near = (x, y, m = 15) => { const t = host.G.view.T; return Math.abs(x - t.x) < m && Math.abs(y - t.z) < m; };
  // live flames (firesim.js): one heat sim per flame, all in one sheet
  const fires = createFires(host);
  const campCol = () => biomeId === 'rift' ? '#e070ff' : biomeId === 'frost' ? '#ffb04a' : '#ffa040';
  // (the bed a little inside the prop: it burns from within; lower as it slumps)
  const burnTop = (p, b) => (p.z || 0) + (p.h || 0) + (TOP[p.kind] ?? .8) * (1 - (b ? crumbleOf(b) : 0) * .55) - .12;
  function drawFlames() {   // braziers and wall torches (their sprites paint only the coals / the cup: p.fx), burning props
    const S = host.biome.style;
    for (const p of props()) {
      if ((p.kind !== 'brazier' && p.kind !== 'torch') || p.unlit || p.gone || !near(p.x, p.y)) continue;
      if (p.kind === 'torch') { fires.draw(p, 'torch', S.torch || '#ffc850', p.x, p.y + .01, (p.z || 0) + 1.53); continue; }
      const col = S.braz[(p.light | 0) % 3], base = (p.z || 0) + .955, pal = fires.ramp(col);
      fires.draw(p, 'brazier', col, p.x, p.y + .01, base);
      for (let i = 0; i < 9; i++) {   // coals glowing in the bowl, breathing
        const a = i / 9 * TAU + (p.light | 0), d = .07 + (i % 3) * .07, k = .5 + .5 * Math.sin(T * (5 + i % 4) + i * 1.9);
        host.point(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * .9, base - .005, pal[k > .75 ? 1 : k > .4 ? 2 : 4], {emit: true});
      }
    }
    drawBurning();
  }
  function drawBurning() {
    for (const [p, b] of burning) if (near(p.x, p.y)) { const k = flameK(p, b); fires.draw(p, 'burn', '#ff9a40', p.x, p.y + .01, burnTop(p, b), {scale: .3 + .7 * k, height: .55 + .45 * k}); }
  }
  function drawCampfire() {
    if (!near(camp.x, camp.y)) return;
    // as big as its wood (a little less than full fuel: less white-hot, more tongues)
    const k = Math.min(1.1, campK);
    fires.draw('camp', 'camp', campCol(), camp.x, camp.y + .01, .1, {scale: .88 * (.3 + .7 * k), height: .42 + .58 * k});
    // the ash bed: grey flecks in a low mound (fat ones in the middle), embers breathing in it
    const am = Math.min(4, ash), nA = Math.round(am * 30), R0 = .13 + .055 * am;
    for (let i = 0; i < nA; i++) {
      const a = ART.hsh(i, 1) * TAU, d = Math.sqrt(ART.hsh(i, 2)) * R0, hh = .012 + (1 - d / R0) * .014 * am;
      const x = camp.x + Math.cos(a) * d, y = camp.y + Math.sin(a) * d, pulse = .5 + .5 * Math.sin(T * (1.3 + ART.hsh(i, 3)) + i);
      if (i % 6 === 0 && pulse > .3) host.point(x, y, hh, FIRE[pulse > .8 ? 1 : pulse > .55 ? 2 : 3], {emit: true});
      else host.point(x, y, hh, ASHC[(i * 7) % 4], {size: d < R0 * .55 ? 2 : 1});
    }
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
    // the ash under it, spreading as the wood burns away
    const ra = .1 + .05 * Math.min(4, ash), ax = ra * PPM * z, ay = ra * PPMY * z;
    for (let j = -Math.ceil(ay); j <= Math.ceil(ay); j++) {
      const t = j / ay; if (Math.abs(t) > 1) continue;
      const hw = ax * Math.sqrt(1 - t * t) - (ART.hsh(j, 5) < .4 ? 1 : 0);
      q.fillStyle = Math.abs(t) < .55 ? 'rgba(122,117,110,.55)' : 'rgba(96,91,86,.45)';
      q.fillRect(Math.round(cx - hw), Math.round(cy + j), Math.round(hw * 2), 1);
    }
    haze(camp.x, camp.y, 1.05, 12, 26);
  }
  function haze(x, y, h, w, H) {   // heat shimmer above a fire: whole-pixel row shifts in the distort layer (HD: firesim's heat)
    if (!host.G.compU?.tDistort || (hdFx() && fires.TUNE.heat && host.G.heat)) return;
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
    fires.draw('beacon', 'beacon', host.biome.style.torch || '#ffc850', beacon.x, beacon.y + .01, beacon.z + .98);
    haze(beacon.x, beacon.y, beacon.z + 2.0, 14, 30);
  }
  function drawSmall() {
    for (const c of candles) if (near(c.x, c.y)) spr(`candles_${c.v}_${c.lit ? (Math.floor(T * 7 + c.ph) % 4) : 4}`, c.x, c.y, c.h, {shadow: true});
    for (const s of shrooms) if (near(s.x, s.y)) spr(`shroom_${s.v}_${s.b > 1.05 ? 2 : s.b > .55 ? 1 : 0}`, s.x, s.y, 0, {shadow: true});
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
      if (hdFx()) {   // its glow, the hot air over it (HD)
        host.G.fx(a.x - dx * .14, a.h - dh * .14 + .06, a.y - dy * .14, .13, FIRE[1], .35 * k, 'add');
        if (fires.TUNE.heat) host.G.heat?.(a.x - dx * .14, a.h + .2, a.y - dy * .14, .13, .5 * k);
      }
    }
  }
  // the fire's look (firesim.js TUNE.style): pixel | hybrid | soft. HD (hybrid, soft): sparks get a soft glow, smoke
  // in 'soft' is soft blended puffs, warmed by the fire near it
  const hdFx = () => !!host.G.fx && fires.TUNE.style !== 'pixel';
  const SMK = [0, 0, 0];
  function trail(q, c, a) {   // a short glowing trail (HD): back along its last step, stretched by its speed
    if (q.tx === undefined) return;
    const dx = q.x - q.tx, dy = q.y - q.ty, dh = q.h - q.th, k = Math.min(4, .045 / Math.max(.004, Math.hypot(dx, dy, dh)));
    for (const f of [1, 2]) host.G.fx(q.x - dx * f * k, q.h - dh * f * k, q.y - dy * f * k, .022 - f * .004, c, (.22 - f * .07) * a, 'add');
  }
  const PO = {emit: false, size: 1, alpha: 1};   // one options object for every point (G.point reads it at once)
  const pt = (x, y, h, c, emit, size, alpha) => { PO.emit = emit; PO.size = size; PO.alpha = alpha; host.point(x, y, h, c, PO); };
  function drawParts() {
    const style = host.G.fx ? fires.TUNE.style : 'pixel', G = host.G;
    for (const q of parts) {
      if (!near(q.x, q.y, 16)) continue;
      const u = q.t / q.life;
      if (q.k === 'smoke') {
        if (style === 'soft') { const w = Math.max(0, .45 - u) * .5; SMK[0] = q.c[0] + w * .6; SMK[1] = q.c[1] + w * .3; SMK[2] = q.c[2]; G.fx(q.x, q.h, q.y, .05 + u * .17, SMK, .3 * (q.a0 ?? .5) * (1 - u), 'blend'); }
        else {
          pt(q.x, q.y, q.h, q.c, false, (q.sz || 2) + (u > .5 ? 1 : 0), (q.a0 ?? .5) * (1 - u));
          if (style === 'hybrid') G.fx(q.x, q.h, q.y, .07 + u * .14, q.c, .1 * (q.a0 ?? .5) * (1 - u), 'blend');   // a faint soft haze round it
        }
      } else if (q.k === 'drip') {   // glowing as it falls, then on the ground it dims through the flame's tones to grey
        const pal = q.pal || FIRE, k = q.heat, c = k > .78 ? pal[1] : k > .52 ? pal[2] : k > .26 ? pal[3] : ASH1;
        pt(q.x, q.y, q.h, c, k > .26, 1, q.land && k <= .26 ? clamp(q.life - q.t, 0, 1) : 1);
        if (style !== 'pixel' && k > .15) {
          G.fx(q.x, q.h + .01, q.y, .028 + .03 * k, c, (q.land ? .3 : .42) * k, 'add');
          if (!q.land) trail(q, c, k);
        }
      } else if (q.k === 'spore') {
        pt(q.x, q.y, q.h, q.c, true, 1, (1 - u) * .9);
        if (style !== 'pixel') G.fx(q.x, q.h, q.y, .04, q.c, .25 * (1 - u), 'add');
      } else {
        const c = q.k === 'ember' ? q.c : (q.pal || FIRE)[Math.min(3, Math.floor(u * 4))], a = u > .6 ? (1 - u) * 2.5 : 1;
        if (style !== 'soft') pt(q.x, q.y, q.h, c, true, 1, a);
        if (style !== 'pixel') G.fx(q.x, q.h, q.y, style === 'soft' ? .022 : .035, c, (style === 'soft' ? .9 : .3) * a, 'add');
        if (style !== 'pixel') trail(q, c, a);
      }
    }
  }

  // ================================================================ contract
  F.update = (dt, evs) => {
    const t0 = performance.now();
    T += dt; syncBiome();
    stepArrows(dt); stepBurning(dt);
    fires.step(dt);
    if (F.on) stepCamp(dt);
    for (const o of fires.pops.splice(0)) {   // a crackle: sparks thrown high and wide, the fire's light flashes
      const big = o.kind === 'camp' || o.kind === 'beacon' || o.kind === 'burn', pal = palOf(o.col), n = Math.round((big ? 16 : 9) * o.k);
      for (let i = 0; i < n; i++) { const a = R() * TAU, v = rr(.4, 1.6) * (big ? 1.3 : 1); parts.push({x: o.x + rr(-.08, .08), y: o.y + rr(-.06, .06), h: o.h + rr(.15, .4), vx: Math.cos(a) * v, vy: Math.sin(a) * v * .8, vh: rr(1.6, 3.4) * (big ? 1.2 : 1), t: 0, life: rr(.5, 1.2), k: 'spark', pal, g: 2.2}); }
      flare(o.x, o.y, o.h + .4, o.col, big ? 5.5 : 3.6, (big ? 1.1 : .8) * o.k, .28);
      if (near(o.x, o.y, 14)) host.events.push({type: 'crackle', x: o.x, y: o.y, big});
    }
    if (F.on) {
      stepCandles(dt, evs); stepShrooms(dt); stepWisps(dt);
      if (near(camp.x, camp.y, 20)) {   // the campfire's sparks and smoke (as big as the fire)
        if (R() < dt * 14 * Math.min(1, campK)) parts.push({x: camp.x + rr(-.12, .12), y: camp.y + rr(-.08, .08), h: .4, vx: rr(-.2, .2), vy: rr(-.2, .2), vh: rr(1, 2.3), t: 0, life: rr(.6, 1.4), k: 'spark', c: FIRE[0], g: -.2});
        if (R() < dt * 7) parts.push({x: camp.x + rr(-.08, .08), y: camp.y, h: .9, vx: 0, vy: 0, vh: rr(.35, .55), t: 0, life: rr(2.2, 3.4), k: 'smoke', c: SMOKE[R() * 3 | 0], sz: 2, a0: .5});
      }
      if (!beacon.unlit && near(beacon.x, beacon.y, 20) && R() < dt * 18) parts.push({x: beacon.x + rr(-.15, .15), y: beacon.y + rr(-.1, .1), h: beacon.z + 1.5, vx: rr(-.3, .3), vy: rr(-.3, .3), vh: rr(1.4, 2.8), t: 0, life: rr(.7, 1.5), k: 'spark', c: FIRE[0], g: -.2});
      // braziers and wall torches: sparks in their own colour, a thin smoke lit by the flame
      for (const p of props()) if ((p.kind === 'brazier' || p.kind === 'torch') && !p.unlit && !p.gone && near(p.x, p.y, 14)) {
        const h = flameAt(p), big = p.kind === 'brazier', pal = palOf(big ? host.biome.style.braz[(p.light | 0) % 3] : host.biome.style.torch);
        if (R() < dt * (big ? 9 : 3)) parts.push({x: p.x + rr(-.1, .1), y: p.y + rr(-.07, .07), h: h - .08, vx: rr(-.2, .2), vy: rr(-.2, .2), vh: rr(.9, 2.1), t: 0, life: rr(.5, 1.1), k: 'spark', pal, g: -.2});
        if (big && R() < dt * 2.4) parts.push({x: p.x + rr(-.05, .05), y: p.y, h: h + .5, vx: 0, vy: 0, vh: rr(.3, .5), t: 0, life: rr(1.8, 2.8), k: 'smoke', c: SMOKE[R() * 3 | 0], sz: 1, a0: .42});
        if (R() < dt * .3) {   // now and then an ember drops: off the torch head, over the brazier's rim
          const z0 = p.z || 0;
          if (big) { const a = R() * TAU, v = rr(.15, .4); drip(p.x + Math.cos(a) * .3, p.y + Math.sin(a) * .3, z0 + .97, z0, pal, {vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: rr(.4, .9)}); }
          else drip(p.x + rr(-.03, .03), p.y + rr(-.03, .03), z0 + 1.5, z0, pal);
        }
      }
    }
    for (let i = flares.length - 1; i >= 0; i--) if ((flares[i].t += dt) > flares[i].life) flares.splice(i, 1);
    stepParts(dt);
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  F.frame = () => {
    syncBiome();
    camp.mesh?.setVisible(F.on); beacon.mesh?.setVisible(F.on);
    campVisuals(); burnVisuals();
    // the beacon's logs char and glow while it burns; the braziers' coal beds glow in veins (ash grey when unlit)
    beacon.mesh?.burn?.(beacon.unlit ? 0 : .6, beacon.unlit ? 0 : .8 + .2 * Math.sin(T * 2.7), T, beacon.unlit ? 0 : .3);
    for (const [p, m] of brazMeshes) m.burn?.(1, p.unlit ? 0 : .75 + .25 * Math.sin(T * 3.1 + (p.light | 0)), T + (p.light | 0) * 3, p.unlit ? .6 : .1);
    drawAshes();
    if (F.on) {
      drawCampfire(); drawBeacon(); drawSmall(); drawWisps(); drawFlames();
      for (const p of props()) if ((p.kind === 'brazier' || p.kind === 'torch') && !p.unlit && !p.gone && near(p.x, p.y, 12))
        p.kind === 'brazier' ? haze(p.x, p.y, flameAt(p) + .5, 10, 18) : haze(p.x, p.y, flameAt(p) + .3, 6, 10);
    }
    else drawBurning();
    drawArrowFire(); drawParts(); fires.endFrame();
  };
  F.lights = () => {
    const out = [];
    if (F.on) {
      const ck = Math.min(1.1, campK);
      out.push({x: camp.x, y: camp.y, h: .3 + .45 * Math.min(1, ck), color: '#ffa048', radius: 6.5 * (.6 + .4 * ck), intensity: 1.25 * (.28 + .72 * ck), flicker: .55, id: 9101, jitter: .05});
      if (!beacon.unlit) out.push({x: beacon.x, y: beacon.y, h: beacon.z + 1.45, color: host.biome.style.torch || '#ffc850', radius: 8.5, intensity: 1.45, flicker: .4, id: 9102, jitter: .06});
      for (const c of candles) if (c.lit) out.push({x: c.x, y: c.y, h: c.h + .3, color: '#ffc070', radius: 2.3, intensity: .75, flicker: .35, id: c.id, jitter: .015});
      for (const s of shrooms) out.push({x: s.x, y: s.y, h: .3, color: GLOW[biomeId] || GLOW.ruins, radius: 2.4 + s.b * .8, intensity: .45 + s.b * .45, flicker: 0, id: s.id});
      for (const w of wisps) if (w.fade > .05) out.push({x: w.x, y: w.y, h: w.h, color: WISP[biomeId] || WISP.ruins, radius: 3.1, intensity: 1.15 * w.fade, flicker: .12, id: w.id});
    }
    for (const [p, b] of burning) { const k = Math.min(1, b.t / .4) * flameK(p, b); out.push({x: p.x, y: p.y, h: burnTop(p, b) + .32, color: '#ff9a40', radius: 3.4, intensity: 1.05 * k, flicker: .6, id: 9200 + (p.x * 7 | 0) % 90, jitter: .04}); }
    for (const [p, e] of ashes) if (e.t < 14) out.push({x: p.x, y: p.y, h: (p.z || 0) + .45, color: '#ff8a3a', radius: 2.8, intensity: .9 * (1 - e.t / 14) ** 1.5, flicker: .6, id: 9500 + (p.x * 7 | 0) % 90, jitter: .03});
    for (const a of host.arrows) if (a.fire) { const k = a.stuck ? clamp(a.life / 2, 0, 1) : 1; if (k > 0) out.push({x: a.x, y: a.y, h: a.h + .1, color: '#ffa040', radius: 2.6, intensity: .9 * k, flicker: .5, id: 9300 + (a._id || 0) % 60}); }
    for (const f of flares) { const k = 1 - f.t / f.life; out.push({x: f.x, y: f.y, h: f.h, color: f.c, radius: f.r * (.7 + .3 * k), intensity: f.k * k * k, flicker: 0, id: 9400}); }
    return out;
  };
  F.onArrowHit = (a, p) => { if (a.fire && BURNS[p.kind]) ignite(p); };   // nothing returned: combat resolves the hit
  F.interact = p => {
    if (p === beacon && beacon.unlit) { light(beacon); return true; }
    if (p === camp && F.on) { tend(); return true; }
    return false;
  };
  F.prompt = p => p === beacon && beacon.unlit ? 'E  light the beacon' : p === camp && F.on ? (canAdd() ? 'E  add a log' : 'E  stir the fire') : null;   // the host's prompt hook (the whole label)
  F.toggle = () => {   // off: the sprites' own flames
    F.on = !F.on; for (const p of props()) if (p.kind === 'brazier' || p.kind === 'torch') p.fx = F.on;
    camp.interact = F.on ? 'tend the fire' : undefined;
    // (off, the host stops calling F.frame: show / hide our meshes here)
    camp.mesh?.setVisible(F.on); beacon.mesh?.setVisible(F.on);
    for (const L of logs) L.m?.setVisible(F.on); pile.meshes?.forEach((m, i) => m.setVisible(F.on && i < pile.n));
  };
  F.biomeChanged = async () => {
    syncBiome();
    for (const p of props()) if (p.kind === 'torch' && !host.itemOf(p)) await host.world.addItem(p);
    meshes.length = 0; buildMeshes();   // the rebuilt world disposed our meshes
  };
  F.hud = () => `flames ${fires.TUNE.style} (F, HD fx ${host.G.stats.fx ?? 0}, heat ${host.G.stats.heat ?? 0}) · camp ${campK.toFixed(2)} (${logs.length} logs, pile ${pile.n}) · fire arrows ${host.arrows.filter(a => a.fire).length} · burning ${burning.size} · ash ${ashes.size}`;
  F.onKey = k => {   // F: cycle the fire's look (pixel / hybrid / soft)
    if (k !== 'f') return false;
    const S = fires.TUNE.STYLES; fires.TUNE.style = S[(S.indexOf(fires.TUNE.style) + 1) % S.length]; return true;
  };
  F.settings = () => [{label: 'Flames', options: fires.TUNE.STYLES, get: () => fires.TUNE.style, set: v => { fires.TUNE.style = v; }},
    {label: 'Heat ripple', options: ['on', 'off'], get: () => fires.TUNE.heat ? 'on' : 'off', set: v => { fires.TUNE.heat = v === 'on'; }}];
  F._ = {fires, camp, beacon, candles, shrooms, wisps, parts, burning, flares, ignite, light, atlas: () => atlas,
    logs, pile, ashes, scorched, tend, drip, get campK() { return campK; }, set campRate(v) { campRate = v; }, get ash() { return ash; }, set ash(v) { ash = v; }};
  return F;
}
