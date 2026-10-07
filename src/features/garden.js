// GARDEN (render3d): the light garden in the east of the arena, dressed with things that give it character.
// OWNER: the lights session. SHOW + small interaction (talk); nothing here changes combat.
//
//   stall     a merchant's stall against the east wall, north of the gate: a 3D wooden frame, plank counter, a striped
//             canvas awning with a scalloped valance, back shelves with clay pots and three glowing potions (small
//             lights), sacks, crates and a banded barrel outside, a hanging sign, and a lantern on a chain that swings
//             (wind, arrows, blasts, you brushing past), so the stall's shadows swing with it
//   merchant  a painted NPC behind the counter (front / back views, mirrored to his facing on screen): he breathes,
//             blinks, turns to face you when you come near, raises a hand and greets you; E talks (a speech bubble)
//   arch      a ruined stone arch framing the garden's west side (3D blocks: one pillar with half its arch, one broken
//             stump, fallen voussoirs), moss / snow / ash on its tops from the biome, and it throws shadows from the
//             braziers
//   bench     a stone bench by the pad
//   plants    a tree, bushes and tufts (the biome's painted cards: the wind sways them) and flower clumps
//   soft      WORLD RULE: small scatter never gets in your way. Bushes, small rocks and tufts anywhere in the world get
//             r = 0 (walked through; enemies' navigation and arrows ignore them too); only real obstacles collide
// The braziers themselves became 3D in lights.js (with their fire effects).
//
// FEATURE CONTRACT (main.js): create(host) -> F: update, frame, lights, hd (speech bubbles), prompt, interact,
// biomeChanged. Props it adds to host.props: 'stall' (rect collider), 'merchant' (interact 'talk'), 'ruin' (the arch's
// colliders), 'bench' (rect), 'goods' (sacks / crates / barrel), and tree / bush / tuft props for the biome painters.
import * as WORLD from '../world/world.js';
import {ART} from '../world/biomes.js';
import {geoOf, M4, box, along, pack, art} from '../world/kit3d.js';
import {clamp} from '../core/mathx.js';
import {viewRandom} from '../core/rng.js';
import {flags} from '../core/flags.js';
import {lanternParts} from '../world/props3d.js';   // the true-3D hanging lantern (the wind decor's and the mine's too)

const TAU = Math.PI * 2;
const R = viewRandom('garden'), rr = (a, b) => a + R() * (b - a);
// how high these stop arrows (world.js PROP_TOP, read by sim/projectiles.js)
WORLD.propTop({stall: 1.05, merchant: 0, ruin: 2.4, bench: .5, goods: .75});

// ---------------------------------------------------------------- where things stand (arena metres: x east, y south)
const STALL = {x: 30.3, y: 9.62};      // the counter's front face (the stall faces west, its back against the east wall)
const MERCH = {x: 31.0, y: 10.15};     // at its south end, under the canopy's edge: the default camera sees his face
const ARCH = {x: 29.2, y: 12.6};       // a ruined gateway into the garden from the north, facing the default camera
const BENCH = {x: 29.2, y: 19.05};
const TREES = [[25.8, 20.9, 0], [24.4, 11.5, 1]];
const BUSHES = [[26.9, 12.3, 0], [24.9, 14.2, 1], [31.9, 18.8, 2], [24.6, 18.4, 1], [32.1, 13.7, 0]];
const TUFTS = [[27.6, 13.4], [30.9, 13.6], [25.2, 16.0], [26.0, 19.5], [28.3, 20.4], [32.2, 17.6]];
const FLOWERS = [[28.4, 13.7, 0], [30.0, 13.6, 1], [26.1, 18.3, 2], [31.5, 19.7, 0], [27.3, 20.0, 1], [25.9, 15.0, 2], [32.0, 16.0, 0]];
// THE TRUE-3D PIECES (?props2d=1: the sprites as before). The stall's lantern: a 3D lantern on its chain (its glass lights itself,
// dimmer when LAN.lit is false), hung along the chain as it swings. The three potions on the upper shelf: 3D bottles in the stall's
// mesh, their draughts in the red, gold and the biome's glow families, lighting themselves (the base mesh's setGlow: nothing else in
// it is of those families). The flower clumps: a mound of 3D leaf blades each (all seven in one static mesh) with their blossoms as
// lit pixels over it (a petal is a pixel or two: a mesh that small is all outline in the pixelizer)
const P2D = flags.get('props2d') === '1';
const POT3 = [['red', '#ff7a5a'], ['gold', '#ffd25a'], ['shroom', null]];   // the potions' draught families and their lights' colours (null: the biome's glow)
const GLOWC = {ruins: '#7af0c8', ember: '#ff9a50', frost: '#9ad8ff', rift: '#e070ff', desert: '#7af0e0'};   // (world.js GLOW3.shroom)

// ---------------------------------------------------------------- the merchant (3/4 front facing screen-left, and back)
const MF = [
  '..........OOOOOO',
  '.........OhhHHHjO',
  '........OhhHHHHHjO',
  '........OhHHHHHHjO',
  '.......OgggggggGGO',
  '....OOOhhhHHHHHHjjOOO',
  '..OOhhhhHHHHHHHHHjjjjOO',
  '...OOOOOOOOOOOOOOOOOOO',
  '......OzzzzzzzzzvBO',
  '.....OSSeSSSSeSzzBBO',
  '....OsSSSSSSSSSSzvBO',
  '.....OSSzSSSSSSzbBBO',
  '....ObbbbBBBBBBbbBBO',
  '...ObbbbBBBBBBBBBvBO',
  '..OyybbBBBBBBBBBBvvYO',
  '.OyyyybBBBBBBBBBvvYYwO',
  '.OryyyyybBBBBBBvvYYwqO',
  'OrrRyyyyyybBBvvYYYwqqqO',
  'OrrRRYyyyyyvvYYYYwwqRqO',
  'OrRRROaaaaAAAAAAxxOqRqO',
  'OrRRqOaAAAAAAAAAAxOqRqqO',
  'OrRRqOaAAAAAAAAAAxOqqRqO',
  'OrRRqOaAAAAAAAAAAxxOqRqO',
  'OrRqOOaAAAAAAAAAAAxOqRqO',
  'OsSzOOaAAAAAAAAAAAxOOsSzO',
  'OsSSzOaAAAAAAAAAAAxOsSSzO',
  '.OzzOkkkkkknNkkkkkkKOzzO',
  '..OO.OaAAAAAAAAAAAxO.OO',
  '.....OaAxxxAAAAxxxAxO',
  '.....OaAxAAAAAAxAAAxO',
  '.....OaAxxxAAAAxxxAxO',
  '.....OrRRRRRRRRRRqqqO',
  '.....OrRRRRRRRRRRRqqO',
  '....OrRRRRRRRRRRRRqqqO',
  '....OrRRRRRRRRRRRRRqqO',
  '....OrRRRRRRRqRRRRRqqO',
  '....OrRRRRRRRqRRRRRRqqO',
  '...OrRRRRRRRRqRRRRRRqqO',
  '...OrRRRRRRRqqRRRRRRqqqO',
  '...OOOOOOOOOOOOOOOOOOOOO',
  '.....OKkkKO...OKkkKO',
  '....OKkkkKO...OKkkkKO',
  '....OOOOOO....OOOOOOO',
];
const MB = [
  '..........OOOOOO',
  '.........OhHHHHjO',
  '........OhHHHHHjjO',
  '........OhHHHHHjjO',
  '.......OGgggggggGO',
  '....OOOhhHHHHHHHjjOOO',
  '..OOhhhHHHHHHHHHHjjjjOO',
  '...OOOOOOOOOOOOOOOOOOO',
  '......ObBBBBBBBBvvO',
  '.....ObBBBBBBBBBBvvO',
  '.....ObBBBBBBBBBBvvO',
  '......OzSBBBBBBBvzO',
  '.....OyyyyYYYYYYYwwO',
  '....OryyyYYYYYYYYwwqO',
  '...OrrRyyYYYYYYYwwqqO',
  '..OrrRRRYYYYYYYwRRqqqO',
  '.OrrRRRRRRRRRRRRRRqqqO',
  'OrrRRRRRRRRRRRRRRRRqqqO',
  'OrrRRRRRRRRRRRRRRRRqRqO',
  'OrRRRRRRRRRRRRRRRRqqRqO',
  'OrRRqRRRRRRRRRRRRRqORqqO',
  'OrRRqRRRRRRRRRRRRRqOqRqO',
  'OrRRqRRRRRRRRRRRRRqOqRqO',
  'OrRqORRRRRRRRRRRRRqOqRqO',
  'OsSzORRRRRRRRRRRRRqOOsSzO',
  'OsSSzORRRRRRRRRRRqqOsSSzO',
  '.OzzOkkkkkaAaAkkkkkKOzzO',
  '..OO.ORRRRRaAAxRRRqqO.OO',
  '.....ORRRRRRaxRRRRqqO',
  '.....ORRRRRRRRRRRRqqO',
  '.....ORRRRRRRRRRRqqqO',
  '.....OrRRRRRRRRRRqqqO',
  '.....OrRRRRRRRRRRRqqO',
  '....OrRRRRRRRRRRRRqqqO',
  '....OrRRRRRRRRRRRRRqqO',
  '....OrRRRRRRRqRRRRRqqO',
  '....OrRRRRRRRqRRRRRRqqO',
  '...OrRRRRRRRRqRRRRRRqqO',
  '...OrRRRRRRRqqRRRRRRqqqO',
  '...OOOOOOOOOOOOOOOOOOOOO',
  '.....OKkkKO...OKkkKO',
  '....OKkkkKO...OKkkkKO',
  '....OOOOOO....OOOOOOO',
];
// the greeting: his near (screen-left) hand comes up to his hat brim (rows 6..26 replaced)
const MF_WAVE = MF.slice();
[['..OOhhhhHHHHHHHHHjjjjOO', 6], ['OsOOOOOOOOOOOOOOOOOOO', 7], ['OSzOOzzzzzzzzzvBO', 8], ['OrRO.OSSeSSSSeSzzBBO', 9],
  ['OrRO.OsSSSSSSSSSzvBO', 10], ['OrRqO.OSSzSSSSSSzbBBO', 11], ['OrRqOObbbbBBBBBBbbBBO', 12], ['.OrRqObbbbBBBBBBBBBvBO', 13],
  ['.OrRqOybBBBBBBBBBBvvYO', 14], ['..OrRqybBBBBBBBBBvvYYwO', 15], ['..OryyyybBBBBBBvvYYwqO', 16], ['.OrRyyyyyybBBvvYYYwqqqO', 17],
  ['.ORRRYyyyyyvvYYYYwwqRqO', 18], ['.OqRROaaaaAAAAAAxxOqRqO', 19], ['.OqRqOaAAAAAAAAAAxOqRqqO', 20], ['..OqqOaAAAAAAAAAAxOqqRqO', 21],
  ['..OOOOaAAAAAAAAAAxxOqRqO', 22], ['.....OaAAAAAAAAAAAxOqRqO', 23], ['.....OaAAAAAAAAAAAxOOsSzO', 24], ['.....OaAAAAAAAAAAAxOsSSzO', 25],
  ['.....OkkkkkknNkkkkkkKOzzO', 26]].forEach(([row, i]) => { MF_WAVE[i] = row; });

// ORDER (core/features.js): the lantern swings in this step's wind
export const order = {after: ['wind']};
export async function create(host) {
  const {THREE} = host;
  const F = {name: 'garden', label: 'Light garden', ambient: true, on: true, ms: 0};
  const props = () => host.props;
  let T = 0, biomeId = '', atlas = null;
  const meshes = [];

  // ================================================================ art (one sheet per biome: albedo + emit)
  function buildAtlas() {
    const S = host.biome.style, items = [], add = (name, P, E, pivot) => items.push({name, img: P.canvas(), em: E.used ? E.canvas() : null, pivot});
    const rp = (...h) => ART.ramp(...h);
    const HAT = rp('#6f8f7e', '#557566', '#3e5a4d', '#283c33'), GOLD = rp('#f2d070', '#c89a3a', '#8e6a26', '#5a4018');
    const SKIN = rp('#ecc0a0', '#d4a07e', '#ab7a5e', '#6e4a3a'), BEARD = rp('#f2eee6', '#d0cabe', '#a49e92', '#6b675e');
    const ROBE = rp('#a5566a', '#823e52', '#5f2a3c', '#3c1726'), SCARF = rp('#e8c26a', '#c89a46', '#94702e', '#5a421c');
    const APRON = rp('#c9a477', '#a78456', '#7d6140', '#4f3c28'), LEATHER = rp('#7a5a44', '#5a412f', '#3f2d20', '#261a12');
    const KEY = {O: '#241a1c', e: '#201418', h: [HAT, 0], H: [HAT, 1], j: [HAT, 2], g: [GOLD, 0], G: [GOLD, 2], n: [GOLD, 0], N: [GOLD, 1],
      s: [SKIN, 0], S: [SKIN, 1], z: [SKIN, 2], b: [BEARD, 0], B: [BEARD, 1], v: [BEARD, 2], r: [ROBE, 0], R: [ROBE, 1], q: [ROBE, 2],
      y: [SCARF, 0], Y: [SCARF, 1], w: [SCARF, 2], a: [APRON, 0], A: [APRON, 1], x: [APRON, 2], k: [LEATHER, 1], K: [LEATHER, 2]};
    const blink = rows => rows.map(r => r.replace(/e/g, 'z'));
    const breathe = rows => { const o = rows.slice(); o.splice(26, 1); o.unshift(''.padEnd(rows[0].length, '.')); return o; };   // the upper body dips a px
    for (const [n, rows] of [['mf', MF], ['mb', MB], ['mw', MF_WAVE]]) {
      for (const [m, v] of [['a', rows], ['b', breathe(rows)], ['c', blink(rows)]]) { const A = art(v, KEY); add(`${n}_${m}`, A.P, A.E, [12, A.H]); }
    }
    // potions: glass, a glowing draught, a cork
    const GLASS = '#cfe6ea', CORK = '#8a6a48';
    [['#7cff8a', '#2a9a4a'], ['#7ad8ff', '#2a6aa8'], ['#e58aff', '#8a3ab8']].forEach(([lit, dim], i) => {
      const rows = i === 1 ? ['.cc.', 'OggO', '.Og.', 'OLLO', 'OLlO', 'OlLO', '.OO.'] : i === 2 ? ['.c.', 'OgO', 'OLO', 'LLlO', 'LlLO', '.OO'] : ['.c.', 'OgO', 'OLLO', 'LLLlO', 'LLlLO', 'OLLLO', '.OOO'];
      const A = art(rows, {O: '#2a3236', c: CORK, g: GLASS, L: {emit: true, c: lit, base: dim}, l: {emit: true, c: '#ffffff', base: dim}});
      add(`potion_${i}`, A.P, A.E, [2, A.H]);
    });
    // the stall lantern (glass = emit)
    const LMET = rp('#a08650', '#7a6438', '#56452a', '#352a1c'), LG = {emit: true, c: '#ffe0a0', base: '#c89040'};
    for (const [nm, g] of [['lantern', LG], ['lantern_dim', {emit: true, c: '#e8b060', base: '#a87030'}]]) {
      const A = art(['..O..', '.OmO.', 'OmmmO', 'OgggO', 'OgGgO', 'OgggO', 'OmmmO', '.OOO.'], {O: '#241a14', m: [LMET, 1], g, G: {emit: true, c: '#ffffff', base: '#e0b060'}});
      add(nm, A.P, A.E, [2, 0]);
    }
    // flowers: three clumps in the biome's colours
    const FL = {ruins: ['#f2d36a', '#e8e4f2', '#b48ae0'], ember: ['#ff7a3a', '#ffc04a', '#d8443a'], frost: ['#bfe4ff', '#ffffff', '#9ab8ff'], rift: ['#ff7af0', '#7ae8ff', '#c08aff']}[S.id] || ['#f2d36a', '#ffffff', '#b48ae0'];
    const LEAF = S.leaf || rp('#6f8c68', '#577154', '#435a45', '#2e3f33');
    const fl = [['....a...b..', '..a.L.a.L.b', '.LaL.L.LL..', '..L.LL.L.L.', '...LLLLLL..'], ['.b...a.....', 'bLb.aLa..b.', '.L..LL..bLb', '.LL.L.L..L.', '..LLLLLLL..'],
      ['..a.....a..', '.aLa.b.aLa.', '..L.bLb.L..', '..LL.L.LL..', '...LLLLL...']];
    fl.forEach((rows, i) => {
      const A = art(rows.map(r => r.replace(/a/g, 'p').replace(/b/g, 'P')), {L: [LEAF, 1], p: FL[i % 3], P: FL[(i + 1) % 3]});
      add(`flower_${i}`, A.P, A.E, [5, A.H]);
    });
    return pack(items);
  }
  const SPO = {img: null, em: null, sx: 0, sy: 0, sw: 0, sh: 0, px: 0, py: 0, x: 0, y: 0, h: 0, type: 3, shadow: true, alpha: 1, flip: false}, NOO = {};   // (host.sprite's kept options; the default o: no object a call)
  function spr(name, x, y, h, o = NOO) {
    const f = atlas.fr[name]; if (!f) return;
    const s = SPO; s.img = atlas.img; s.em = atlas.em; s.sx = f.sx; s.sy = f.sy; s.sw = f.sw; s.sh = f.sh; s.px = f.px; s.py = f.py; s.x = x; s.y = y; s.h = h;
    s.shadow = o.shadow !== false; s.alpha = o.alpha ?? 1; s.flip = !!o.flip; host.sprite(s);   // (a kept options object: no literal a sprite)
  }

  // ================================================================ 3D pieces
  // the canopy: from the front posts (.52 m behind the counter's face, 2.3 m) up to the wall (2.78 m), overhanging a little
  const CF = .36, CB = 2.7, CH0 = 2.3, CH1 = 2.78, TH = Math.atan2(CH1 - CH0, CB - CF), cyAt = x => CH0 + (x - CF) * Math.tan(TH);
  function stallGeo() {   // local: x east (0 = the counter's front face), y up, z south (the arena's y)
    const L = [], C = [], Z = 1.12;   // L: the base (blocks point lights), C: the canopy (the height map can't see under a roof)
    for (let i = 0; i < 3; i++) L.push(box('wood', [.06, .3, 2.1], [.03, .17 + i * .32, 0], [0, 0, 0], {bias: i === 1 ? -.08 : 0}));   // counter front planks
    for (const z of [-1.05, 1.05]) L.push(box('wood', [.45, .95, .06], [.25, .475, z], [0, 0, 0], {bias: -.1}));
    L.push(box('wood', [.58, .06, 2.26], [.25, .99, 0], [0, 0, 0], {bias: .25}));                                                   // the counter top
    for (const z of [-Z, Z]) { L.push(box('wood', [.09, CH0, .09], [.52, CH0 / 2, z])); L.push(box('wood', [.09, CH1, .09], [2.6, CH1 / 2, z])); }
    for (const z of [-Z, Z]) C.push(box('wood', [(CB - CF) / Math.cos(TH) + .1, .07, .07], [(CF + CB) / 2, cyAt((CF + CB) / 2) - .05, z], [0, 0, TH]));   // beams
    C.push(box('wood', [.07, .07, 2.4], [.52, CH0 - .02, 0]));                                                                      // the front lintel
    const N = 6, W = 2.5 / N, Lc = (CB - CF + .25) / Math.cos(TH), xc = (CF - .25 + CB) / 2;
    for (let i = 0; i < N; i++) {   // striped canvas + its scalloped valance
      const z = -1.25 + W * (i + .5), fam = i % 2 ? 'rope' : 'red';
      C.push(box(fam, [Lc, .035, W - .004], [xc, cyAt(xc) + .02, z], [0, 0, TH], {bias: .15}));
      C.push(box(fam, [.03, i % 2 ? .12 : .16, W - .03], [CF - .25, cyAt(CF - .25) - .07 - (i % 2 ? 0 : .02), z], [0, 0, 0], {bias: -.1}));
    }
    for (const y of [1.05, 1.55]) L.push(box('wood', [.34, .04, 2.0], [2.36, y, 0], [0, 0, 0], {bias: .2}));                        // back shelves
    const r = ART.rng(11);
    for (let i = 0; i < 4; i++) {   // clay pots and jars on the lower shelf
      const z = -.8 + i * .5 + r() * .1, h = .14 + r() * .08, rad = .06 + r() * .04;
      L.push({g: new THREE.CylinderGeometry(rad * .8, rad, h, 8), m: M4([2.36, 1.07 + h / 2, z]), fam: 'clay', bias: r() * .2 - .1});
      L.push({g: new THREE.CylinderGeometry(rad * .55, rad * .8, .04, 8), m: M4([2.36, 1.07 + h + .02, z]), fam: 'clay', bias: .2});
    }
    L.push(box('wood', [.26, .2, .3], [.2, 1.12, -.7], [0, .3, 0], {bias: .1}));         // a small crate on the counter
    L.push(box('rope', [.24, .03, .16], [.22, 1.035, .1], [0, -.2, 0], {bias: .2}));    // a cloth on the counter
    // outside: burlap sacks (tied at the neck), crates, a banded barrel
    for (const [x, z, k] of [[-.42, 1.4, 1], [-.18, 1.66, .85], [-.6, 1.72, .75]]) {
      L.push({g: new THREE.IcosahedronGeometry(1, 1), m: M4([x, .17 * k, z], [r() * .3, r() * 3, r() * .3], [.19 * k, .19 * k, .17 * k]), fam: 'rope', bias: -.55});
      L.push({...along([x, .33 * k, z], [x + .01, .42 * k, z], .045 * k, .03 * k, 6), fam: 'rope', bias: -.7});
    }
    L.push(box('wood', [.46, .46, .46], [.35, .23, 1.6], [0, .15, 0]), box('wood', [.34, .34, .34], [.33, .63, 1.57], [0, -.25, 0], {bias: .1}));
    L.push({g: new THREE.CylinderGeometry(.23, .23, .66, 10), m: M4([-.45, .33, -1.45]), fam: 'wood'});
    for (const y of [.12, .54]) L.push({g: new THREE.TorusGeometry(.235, .018, 4, 10), m: M4([-.45, y, -1.45], [Math.PI / 2, 0, 0]), fam: 'metal'});
    L.push({g: new THREE.CylinderGeometry(.2, .2, .02, 10), m: M4([-.45, .665, -1.45]), fam: 'wood', bias: .2});
    // the sign, nailed to the north front post
    L.push(box('wood', [.035, .3, .5], [.46, 1.62, -Z + .3], [0, 0, 0], {bias: .2}), box('metal', [.04, .05, .4], [.46, 1.49, -Z + .3], [0, 0, 0], {fixed: 2}));
    if (!P2D) {   // the potions on the upper shelf (the sprites' sizes: a round flask, a tall bottle, a squat vial), glowing (buildMeshes)
      const sh = 1.57, X = 2.28;
      [[-.6, 'flask'], [-.2, 'tall'], [.25, 'vial']].forEach(([z, k], i) => {
        const fam = POT3[i][0];
        if (k === 'flask') L.push({g: new THREE.SphereGeometry(.07, 8, 5), m: M4([X, sh + .07, z], [0, 0, 0], [1, .9, 1]), fam}, {g: new THREE.CylinderGeometry(.022, .026, .07, 6), m: M4([X, sh + .16, z]), fam: 'bone', bias: .2});
        else if (k === 'tall') L.push({g: new THREE.CylinderGeometry(.045, .05, .15, 7), m: M4([X, sh + .075, z]), fam}, {g: new THREE.CylinderGeometry(.02, .03, .06, 6), m: M4([X, sh + .18, z]), fam: 'bone', bias: .2});
        else L.push({g: new THREE.CylinderGeometry(.05, .055, .09, 7), m: M4([X, sh + .045, z]), fam}, {g: new THREE.CylinderGeometry(.02, .03, .04, 6), m: M4([X, sh + .11, z]), fam: 'bone', bias: .2});
        L.push({g: new THREE.CylinderGeometry(.02, .018, .025, 6), m: M4([X, sh + (k === 'flask' ? .205 : k === 'tall' ? .22 : .14), z]), fam: 'wood', bias: .1});   // the cork
      });
    }
    return {base: geoOf(L), top: geoOf(C)};
  }
  function archGeo() {   // local: x east, y up, z south; the opening runs along z
    const L = [], C = [], r = ART.rng(29), drum = (x, y, z, s = 1, rot = 0) => box('stone', [.5 * s, .44, .5 * s], [x + (r() - .5) * .03, y, z + (r() - .5) * .03], [0, rot + (r() - .5) * .08, 0], {bias: (r() - .5) * .3});
    const Z = 1.35;
    // north pillar: plinth, 4 drums, a capital, then half its arch
    L.push(box('stone', [.66, .18, .66], [0, .09, -Z], [0, 0, 0], {bias: -.1}));
    for (let i = 0; i < 4; i++) L.push(drum(0, .18 + .22 + i * .45, -Z));
    L.push(box('stone', [.68, .16, .68], [0, 2.06, -Z], [0, 0, 0], {bias: .25}));
    const cy = 2.14, rad = 1.35;
    for (const deg of [168, 150, 132, 116]) {
      const th = deg * Math.PI / 180, z = rad * Math.cos(th), y = cy + rad * Math.sin(th);
      C.push(box('stone', [.48, .34, .36], [(r() - .5) * .04, y, z], [Math.PI / 2 - th, 0, 0], {bias: (r() - .5) * .3}));
    }
    // south pillar: broken off at two drums and a cracked, tilted third
    L.push(box('stone', [.66, .18, .66], [0, .09, Z], [0, 0, 0], {bias: -.1}));
    L.push(drum(0, .4, Z), drum(0, .85, Z, .97));
    L.push(box('stone', [.44, .3, .46], [.04, 1.2, Z - .03], [.22, .4, -.12], {bias: .1}));
    // fallen: two voussoirs and a drum in the grass
    L.push(box('stone', [.48, .34, .36], [.55, .17, .6], [0, .7, .1], {bias: .1}), box('stone', [.36, .48, .34], [-.6, .17, .2], [Math.PI / 2, .3, 0]));
    L.push(box('stone', [.5, .44, .5], [.35, .22, 2.15], [0, .5, Math.PI / 2 - .05], {bias: -.05}));
    for (let i = 0; i < 6; i++) L.push({g: new THREE.IcosahedronGeometry(1, 0), m: M4([(r() - .5) * 1.4, .04, Z + (r() - .5) * 1.2], [r() * 3, r() * 3, r() * 3], [.08 + r() * .05, .05, .07 + r() * .04]), fam: 'rock'});
    return {base: geoOf(L), top: geoOf(C)};
  }
  function benchGeo() {
    return geoOf([box('stone', [.2, .36, .34], [-.55, .18, 0], [0, .03, 0], {bias: -.15}), box('stone', [.2, .36, .34], [.55, .18, 0], [0, -.04, 0], {bias: -.15}),
      box('stone', [1.55, .1, .44], [0, .41, 0], [0, 0, .015], {bias: .2})]);
  }
  // the flower clumps (true 3D): a mound of leaf blades fanning out of the ground; the blossoms are points (F.frame): each a flower head
  // of three pixels (a heart, a petal either side along the screen's x, like the painted ones), held up over the blades in a crown.
  // BLOOMS per variant [x, z, h (m) over the clump's ground point, colour pair]
  const BLOOMS = [0, 1, 2].map(v => { const r = ART.rng(71 + v), n = [8, 9, 7][v], out = [];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + r() * .6, d = .04 + r() * .12; out.push([Math.cos(a) * d * 1.3, Math.sin(a) * d * .8, .12 + r() * .05, i % 3 === 2 ? 1 : 0]); }
    return out; });
  function flowersGeo() {
    const L = [];
    FLOWERS.forEach(([fx, fy, v], j) => {
      const r = ART.rng(91 + j), a0 = r() * 3;
      for (let i = 0; i < 11; i++) {   // the blades: thin cones leaning out of the middle
        const a = a0 + i / 11 * Math.PI * 2 + r() * .4, lean = .8 + r() * .45, len = .1 + r() * .08;   // (low and wide, as the painted clump)
        L.push({g: new THREE.ConeGeometry(.032, len, 4), m: M4([fx + Math.cos(a) * (.08 + len * .4), len / 2 * Math.cos(lean) - .005, fy + Math.sin(a) * (.06 + len * .3)], [Math.sin(a) * lean, 0, -Math.cos(a) * lean]), fam: 'leaf', fixed: i & 1});   // (the leaf's light and base tones: a blade is too thin to be toned by the light)
      }
      for (const [x, z, h] of BLOOMS[v]) L.push({...along([fx + x * .6, 0, fy + z * .6], [fx + x, h - .015, fy + z], .007, .006, 3), fam: 'leaf', bias: -.1});   // the stalks
    });
    return geoOf(L);
  }
  const GEO = {stall: stallGeo(), arch: archGeo(), bench: benchGeo(), flowers: P2D ? null : flowersGeo(), lantern: P2D ? null : geoOf(lanternParts())};
  const FLC = {ruins: ['#f2d36a', '#e8e4f2', '#b48ae0'], ember: ['#ff7a3a', '#ffc04a', '#d8443a'], frost: ['#bfe4ff', '#ffffff', '#9ab8ff'], rift: ['#ff7af0', '#7ae8ff', '#c08aff']};   // (the sprites' petals: points take any colour)

  // ================================================================ props (colliders, interaction, the biome's plants)
  const tag = (p, extra) => Object.assign(p, {garden: true}, extra);
  const add = p => host.entities.add(p);   // joins the world (world/entities.js)
  // (bushes, small rocks and tufts are soft, no collider: world/layout.js makes them so, and the garden's own below)
  let merchant = props().find(p => p.kind === 'merchant');
  if (!merchant) {
    // clear the scatter where the new pieces stand
    const clear = (x, y, r) => { for (const q of props()) if (!q.garden && ['tuft', 'bush', 'rock'].includes(q.kind) && Math.hypot(q.x - x, q.y - y) < r) host.entities.hide(q); };
    clear(31.6, 9.6, 2.2); clear(ARCH.x, ARCH.y, 2.0); clear(BENCH.x, BENCH.y, 1.1);
    add(tag({kind: 'stall', x: 31.6, y: STALL.y, z: 0, rect: [STALL.x - .05, STALL.y - 1.18, 33, STALL.y + 1.18]}));
    merchant = add(tag({kind: 'merchant', x: MERCH.x, y: MERCH.y, z: 0, r: 0, interact: 'talk'}));
    for (const [x, y, r] of [[STALL.x - .42, STALL.y + 1.55, .34], [STALL.x + .35, STALL.y + 1.6, .32], [STALL.x - .45, STALL.y - 1.45, .3]]) add(tag({kind: 'goods', x, y, z: 0, r}));
    for (const dx of [-1.35, 1.35]) add(tag({kind: 'ruin', x: ARCH.x + dx, y: ARCH.y, z: 0, r: .36}));
    add(tag({kind: 'ruin', x: ARCH.x + 2.15, y: ARCH.y - .35, z: 0, r: .3}));   // the fallen drum (the mesh's local x is the arena's -y)
    add(tag({kind: 'bench', x: BENCH.x, y: BENCH.y, z: 0, rect: [BENCH.x - .78, BENCH.y - .2, BENCH.x + .78, BENCH.y + .2]}));
    const plants = [];
    for (const [x, y, v] of TREES) plants.push(add(tag({kind: 'tree', x, y, z: 0, variant: v, r: .45})));
    for (const [x, y, v] of BUSHES) plants.push(add(tag({kind: 'bush', x, y, z: 0, variant: v, r: 0})));
    TUFTS.forEach(([x, y], i) => plants.push(add(tag({kind: 'tuft', x, y, z: 0, variant: i % 3}))));
    await Promise.all(plants.map(p => host.world.addItem(p)));
  }

  function buildMeshes() {
    for (const m of meshes) m.dispose(); meshes.length = 0;
    // the bases block point lights; the canopy and the arch's curve don't (a height map would fill in under them)
    const stallM = M4([STALL.x, 0, STALL.y]), archM = M4([ARCH.x, 0, ARCH.y], [0, Math.PI / 2, 0]);   // the arch's local z (the opening) runs east-west
    const base = host.world.mesh(GEO.stall.base, stallM, {occlude: true}); meshes.push(base, host.world.mesh(GEO.stall.top, stallM));
    if (!P2D) {   // the potions glow (stallGeo), the flower clumps, the lantern (posed every frame: F.frame)
      POT3.forEach(([fam], i) => base.setGlow(i, WORLD.FAMS.indexOf(fam), .7));
      meshes.push(host.world.mesh(GEO.flowers, null, {static: true}));
      lan3 = host.world.mesh(GEO.lantern); lan3.setGlow(0, WORLD.FAMS.indexOf('flame'), 1); meshes.push(lan3);
    }
    meshes.push(host.world.mesh(GEO.arch.base, archM, {occlude: true}), host.world.mesh(GEO.arch.top, archM));
    meshes.push(host.world.mesh(GEO.bench, M4([BENCH.x, 0, BENCH.y], [0, .05, 0]), {occlude: true}));
  }
  let lan3 = null, lanLit = true;   // the 3D lantern's mesh, its glass's state shown
  function syncBiome() { if (host.biome.id !== biomeId) { biomeId = host.biome.id; atlas = buildAtlas(); bloomC = (FLC[biomeId] || FLC.ruins).map(c => host.rgb(c)); potC = POT3.map(([, c]) => c || GLOWC[biomeId] || GLOWC.ruins); } }
  let bloomC = null, potC = null;
  syncBiome(); buildMeshes();

  // ================================================================ the lantern (a pendulum on a chain)
  const LAN = {ax: STALL.x + .36, ay: STALL.y - .75, ah: 2.26, len: .32, tx: 0, ty: 0, vx: 0, vy: 0};
  const LP = [0, 0, 0], lanPos = () => {   // (into one kept array: its callers take the three numbers at once)
    LP[0] = LAN.ax + Math.sin(LAN.tx) * LAN.len; LP[1] = LAN.ay + Math.sin(LAN.ty) * LAN.len; LP[2] = LAN.ah - Math.cos(LAN.tx) * Math.cos(LAN.ty) * LAN.len;
    return LP;
  };
  const LW = {x: 0, y: 0, g: 0}, LCALM = {x: 0, y: 0, g: 0};   // the wind at the lantern (scratch), none
  function stepLantern(dt, evs) {
    const w = host.wind?.on && host.wind.at ? host.wind.at(LAN.ax, LAN.ay, LW) : LCALM, pl = host.player;
    let fx = w.x * .9 + Math.sin(T * 1.3) * .15 * (1 + (w.g || 0) * 3), fy = w.y * .9;
    const d = Math.hypot(pl.x - LAN.ax, pl.y - LAN.ay), sp = Math.hypot(pl.vx, pl.vy);
    if (d < 1.1 && sp > .5) { fx += pl.vx * 1.4; fy += pl.vy * 1.4; }   // brushed past
    for (const a of host.arrows) if (!a.stuck && Math.hypot(a.x - LAN.ax, a.y - LAN.ay) < .5 && Math.abs(a.h - 1.7) < .5) { LAN.vx += a.vx * .05; LAN.vy += a.vy * .05; }
    for (const e of evs) if (e.type === 'combat.explode') { const dd = Math.hypot(e.x - LAN.ax, e.y - LAN.ay); if (dd < 10) { LAN.vx += (LAN.ax - e.x) / dd * 3 / (1 + dd * .3); LAN.vy += (LAN.ay - e.y) / dd * 3 / (1 + dd * .3); } }
    const k = 9.8 / LAN.len, c = 1.1;
    LAN.vx += (-k * Math.sin(LAN.tx) - c * LAN.vx + fx) * dt; LAN.vy += (-k * Math.sin(LAN.ty) - c * LAN.vy + fy) * dt;
    LAN.tx = clamp(LAN.tx + LAN.vx * dt, -1.1, 1.1); LAN.ty = clamp(LAN.ty + LAN.vy * dt, -1.1, 1.1);
  }

  // ================================================================ the merchant
  const GREET = ['Well met, ranger!', 'Ah, a customer! Come, come.', 'Evening! Mind the braziers, they bite.'];
  const TALK = ['Arrows, lamp oil, rope... and a few things I won\'t name.', 'That green flame? Swamp salt. Burns cold.',
    'Potions, fresh from the rift. Mostly safe.', 'Bring me crystal shards and we\'ll talk prices.', 'The beacon up on the cliff? Light it and the yard sleeps easy.',
    'Business was better before the walls went up.', 'Dip your arrow in a flame first. Thank me later.'];
  const M = {ang: Math.PI, face: Math.PI, blinkT: 2, blink: 0, wave: 0, greetCool: 0, near: false, say: null, sayT: 0, ti: 0};
  function say(text, t = 3.6) { M.say = text; M.sayT = t; }
  function stepMerchant(dt) {
    const pl = host.player, dx = pl.x - MERCH.x, dy = pl.y - MERCH.y, d = Math.hypot(dx, dy);
    const want = d < 7 ? Math.atan2(dy, dx) : Math.PI;   // toward you, or out over the counter (west)
    let da = Math.atan2(Math.sin(want - M.ang), Math.cos(want - M.ang)); M.ang += da * (1 - Math.exp(-dt * 4));
    M.blinkT -= dt; if (M.blinkT <= 0) { M.blink = .13; M.blinkT = rr(2.2, 4.8); } M.blink = Math.max(0, M.blink - dt);
    M.wave = Math.max(0, M.wave - dt); M.greetCool = Math.max(0, M.greetCool - dt); M.sayT = Math.max(0, M.sayT - dt);
    const close = d < 3.6;
    if (close && !M.near && M.greetCool <= 0) { M.wave = 1.4; M.greetCool = 25; say(GREET[R() * GREET.length | 0], 2.6); }
    M.near = close;
  }
  // his frames by view x eyes ('mb_c' does not exist: the back has no blink); MFO: his sprite's options, kept
  const MNAME = {mb: {a: 'mb_a', b: 'mb_b', c: 'mb_a'}, mw: {a: 'mw_a', b: 'mw_b', c: 'mw_c'}, mf: {a: 'mf_a', b: 'mf_b', c: 'mf_c'}}, MFO = {flip: false};
  function drawMerchant() {
    const yaw = host.yaw, fx = Math.cos(M.ang), fy = Math.sin(M.ang);
    const back = fx * -Math.sin(yaw) + fy * -Math.cos(yaw) > .15, side = fx * Math.cos(yaw) + fy * -Math.sin(yaw);   // (the camera's forward, its right)
    const v = back ? 'mb' : M.wave > 0 ? 'mw' : 'mf', fr = M.blink > 0 && !back ? 'c' : (Math.floor(T * 1.1) % 2 ? 'b' : 'a');
    // the art faces screen-left from the front; seen from the back his facing on screen is mirrored
    MFO.flip = back ? side < 0 : side > 0;
    spr(MNAME[v][fr], MERCH.x, MERCH.y, 0, MFO);
  }

  // ================================================================ contract
  const near = (x, y, m = 16) => { const t = host.G.view.T; return Math.abs(x - t.x) < m && Math.abs(y - t.z) < m; };
  F.view = (dt, evs) => {   // the lantern, the merchant (the pieces' colliders and E are sim: the registry, F.interact)
    const t0 = performance.now(); T += dt; syncBiome();
    if (near(STALL.x, STALL.y, 22)) { stepLantern(dt, evs); stepMerchant(dt); }
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  const CHAIN = host.rgb('#3a3028');
  const NOSH = {shadow: false}, POT = ['potion_0', 'potion_1', 'potion_2'], POTZ = [-.6, -.2, .25], FLN = FLOWERS.map(f => `flower_${f[2]}`);   // (kept: no string or object a frame)
  F.frame = () => {
    syncBiome();
    if (near(STALL.x, STALL.y)) {
      drawMerchant();
      const [lx, ly, lh] = lanPos();
      host.line(LAN.ax, LAN.ay, LAN.ah, lx, ly, lh + .02, CHAIN);
      if (lan3) poseLan(lx, ly, lh + .02);
      else { spr(LAN.lit === false ? 'lantern_dim' : 'lantern', lx, ly, lh + .02, NOSH); for (let i = 0; i < 3; i++) spr(POT[i], STALL.x + 2.28, STALL.y + POTZ[i], 1.57, NOSH); }
    }
    if (P2D) { for (let i = 0; i < FLOWERS.length; i++) { const f = FLOWERS[i]; if (near(f[0], f[1])) spr(FLN[i], f[0], f[1], 0, NOSH); } }
    else {   // the blossoms: a three-pixel flower head each (a heart, its petals a pixel either side along the screen's x), lit by the scene
      const rx = Math.cos(host.yaw) / host.PPM, ry = -Math.sin(host.yaw) / host.PPM;
      for (let i = 0; i < FLOWERS.length; i++) {
        const f = FLOWERS[i]; if (!host.G.onScreen(f[0], .1, f[1], 8)) continue;   // (on screen only: three points a blossom)
        const B = BLOOMS[f[2]], c0 = bloomC[f[2] % 3], c1 = bloomC[(f[2] + 1) % 3], c2 = bloomC[(f[2] + 2) % 3];
        for (const b of B) {
          const x = f[0] + b[0], y = f[1] + b[1], pet = b[3] ? c2 : c1;
          host.point(x, y, b[2], c0, BLOOM); host.point(x - rx, y - ry, b[2], pet, BLOOM); host.point(x + rx, y + ry, b[2], pet, BLOOM);
        }
      }
    }
  };
  // the 3D lantern hung along its chain: its ring at the chain's end (x, y, h), its up toward the hook (no allocation: kept scratch)
  const BLOOM = {emit: false}, LQ = new THREE.Quaternion(), LP3 = new THREE.Vector3(), LD3 = new THREE.Vector3(), LUP = new THREE.Vector3(0, 1, 0), LS3 = new THREE.Vector3(1, 1, 1), LM3 = new THREE.Matrix4();
  function poseLan(x, y, h) {
    LD3.set(LAN.ax - x, LAN.ah - h, LAN.ay - y).normalize(); LQ.setFromUnitVectors(LUP, LD3);
    lan3.setMatrix(LM3.compose(LP3.set(x, h, y), LQ, LS3));
    const lit = LAN.lit !== false; if (lit !== lanLit) { lanLit = lit; lan3.setGlow(0, WORLD.FAMS.indexOf('flame'), lit ? 1 : .4); }
  }
  // the lantern's light and the potions' glow: records reused every frame (lighting.js copies them at once)
  const GLR = [{x: 0, y: 0, h: 0, color: '#ffc878', radius: 4.6, intensity: 1.05, flicker: .25, id: 9501},
    ...['#7cff8a', '#7ad8ff', '#e58aff'].map((color, i) => ({x: 0, y: 0, h: 1.62, color, radius: 1.3, intensity: .55, flicker: .05, id: 9502 + i}))];
  const POTY = [-.6, -.2, .25], NOL = [];
  F.lights = () => {
    if (!near(STALL.x, STALL.y, 26)) return NOL;
    const [lx, ly, lh] = lanPos(), a = GLR[0]; a.x = lx; a.y = ly; a.h = lh;
    for (let i = 0; i < 3; i++) { const o = GLR[i + 1]; o.x = STALL.x + 2.15; o.y = STALL.y + POTY[i]; if (!P2D) o.color = potC[i]; }   // (the 3D potions' draughts: red, gold, the biome's glow)
    return GLR;
  };
  F.prompt = p => p === merchant ? 'E  talk' : null;
  F.interact = p => {
    if (p !== merchant) return false;
    say(TALK[M.ti++ % TALK.length]); M.wave = Math.max(M.wave, .7);
    host.events.push({type: 'garden.talk', x: MERCH.x, y: MERCH.y});
    return true;
  };
  F.hd = (q, sc) => {   // his speech bubble, at display resolution over his hat
    if (!M.say || M.sayT <= 0) return;
    host.G.hdShift?.(q, sc);   // (slid with the pixel image: the sub-pixel camera; the host restores q after)
    const [sx, sy] = host.G.toScreen(MERCH.x, 2.05, MERCH.y), dpr = devicePixelRatio || 1, a = Math.min(1, M.sayT * 3);
    q.font = `${Math.round(11 * dpr)}px ui-monospace, Consolas, monospace`; q.textAlign = 'center';
    const w = q.measureText(M.say).width + 16 * dpr, h = 20 * dpr, x = sx * sc, y = sy * sc - 12 * dpr;
    q.globalAlpha = a; q.fillStyle = 'rgba(240,232,214,.94)';
    q.beginPath(); q.roundRect(x - w / 2, y - h, w, h, 5 * dpr); q.fill();
    q.beginPath(); q.moveTo(x - 5 * dpr, y); q.lineTo(x + 3 * dpr, y); q.lineTo(x - 3 * dpr, y + 6 * dpr); q.fill();
    q.fillStyle = '#3a2a24'; q.fillText(M.say, x, y - 6 * dpr); q.globalAlpha = 1;
  };
  F.biomeChanged = async () => {
    syncBiome();
    for (const p of props()) if (p.garden && ['tree', 'bush', 'tuft'].includes(p.kind) && !host.itemOf(p)) await host.world.addItem(p);
    meshes.length = 0; lan3 = null; lanLit = true; buildMeshes();   // the rebuilt world disposed our meshes
  };
  F._ = {merchant, M, LAN, atlas: () => atlas, GEO};
  return F;
}
