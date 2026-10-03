// SHRINES' 3D MODELS (features/shrines.js): one kit3d geometry per kind, in the world's style (the biome's ramps tone
// stone, rock, wood, rope; red and gold keep their own; moss / snow / ash settle on what faces up). Local frame: x east,
// y up, z south; the front faces +z (the default camera). Built once (the families are resolved in the shader, so one
// geometry serves every biome). Each kind also says where its glyph floats, its light, its collider and how high it
// stops arrows.
//   buildModels() -> {chance, combat, blood, mountain, exchange, trader}: geometries
//   SHAPE[kind] = {glyph: h (m), light: {h, color, radius, intensity, flicker}, r | rect: [hx, hy] (half sizes), top (m: arrows)}
import * as THREE from 'three';
import {geoOf, M4, box, along} from '../../world/kit3d.js';

export const SHAPE = {
  chance:   {glyph: 1.9, top: 1.3, r: .5, light: {h: 1.45, color: '#ffcf5a', radius: 3.6, intensity: 1.1, flicker: .12}},
  combat:   {glyph: 2.45, top: 2.0, r: .55, light: {h: 2.0, color: '#ff5a3a', radius: 3.8, intensity: 1.2, flicker: .3}},
  blood:    {glyph: 1.85, top: .7, rect: [.62, .4], light: {h: .95, color: '#e8203c', radius: 3.2, intensity: 1.25, flicker: .18}},
  mountain: {glyph: 2.25, top: 1.7, r: .55, light: {h: 1.9, color: '#a8d8ff', radius: 4.2, intensity: 1.0, flicker: .05}},
  exchange: {glyph: 2.3, top: 1.8, r: .72, light: {h: 1.0, color: '#c08aff', radius: 3.8, intensity: 1.3, flicker: .1}},
  trader:   {glyph: 2.1, top: 1.5, rect: [.72, .46], light: {h: 1.25, color: '#ffc878', radius: 3.6, intensity: 1.05, flicker: .25}},
};
// the trader's lantern hangs here (local), the blood altar's candles stand here (their flames are drawn as points)
export const LANTERN_AT = [.63, 1.3, .42], CANDLES = [[-.47, .78, .26], [.47, .78, .26]];

// a small deterministic generator for the stones' jitter (the same model every time)
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const cyl = (fam, rt, rb, h, pos, rot = [0, 0, 0], o = {}) => ({g: new THREE.CylinderGeometry(rt, rb, h, o.seg ?? 8), m: M4(pos, rot), fam, ...o});
const stoneLump = (fam, pos, scl, rot, bias = 0, detail = 0) => ({g: new THREE.IcosahedronGeometry(1, detail), m: M4(pos, rot, scl), fam, bias});
const limb = (fam, a, b, r0, r1, bias = 0) => ({...along(a, b, r0, r1, 6), fam, bias});

// Shrine of Chance: a gambler's idol. A stepped plinth, a banded pillar, a bronze bowl heaped with coins
function chance() {
  const L = [], r = rng(31);
  L.push(box('stone', [1.0, .14, 1.0], [0, .07, 0], [0, 0, 0], {bias: -.12}));
  L.push(box('stone', [.78, .12, .78], [0, .2, 0], [0, Math.PI / 4, 0], {bias: .08}));
  L.push(cyl('stone', .2, .24, .74, [0, .63, 0]));
  for (const y of [.36, .9]) L.push(cyl('gold', .255, .255, .045, [0, y, 0]));
  L.push(box('stone', [.52, .1, .52], [0, 1.05, 0], [0, Math.PI / 4, 0], {bias: .2}));
  L.push(cyl('metal', .36, .2, .16, [0, 1.18, 0], [0, 0, 0], {seg: 10}));
  L.push(cyl('gold', .37, .37, .03, [0, 1.265, 0], [0, 0, 0], {seg: 10}));
  for (let i = 0; i < 9; i++) {   // the heap in the bowl
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * .24;
    L.push(cyl('gold', .06, .06, .022, [Math.sin(a) * d, 1.26 + (.24 - d) * .25 + r() * .03, Math.cos(a) * d], [r() * .5 - .25, 0, r() * .5 - .25], {seg: 7, bias: r() * .3}));
  }
  for (const [x, z] of [[.36, .34], [-.3, .4], [.41, -.12]]) L.push(cyl('gold', .06, .06, .02, [x, .155, z], [0, 0, 0], {seg: 7, bias: .2}));
  return geoOf(L);
}
// Shrine of Combat: a war cairn. Rocks heaped round a post, a red swallow-tailed banner, two spears crossed, a shield
function combat() {
  const L = [], r = rng(47);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + r() * .4, d = .22 + r() * .2, s = .14 + r() * .1;
    L.push(stoneLump('rock', [Math.sin(a) * d, s * .6, Math.cos(a) * d], [s * 1.2, s, s * 1.1], [r() * 3, r() * 3, r() * 3], r() * .4 - .2));
  }
  L.push(stoneLump('rock', [0, .36, 0], [.24, .2, .22], [.3, 1, .2], .1));
  L.push(box('wood', [.11, 2.0, .11], [0, 1.0, -.05], [0, 0, .035]));
  L.push(box('wood', [.92, .08, .08], [.03, 1.76, -.05], [0, 0, .02], {bias: .1}));
  L.push(box('red', [.72, .86, .028], [.03, 1.3, -.01], [0, 0, .02], {bias: .1}));
  for (const sx of [-1, 1]) L.push(box('red', [.26, .16, .028], [.03 + sx * .23, .8, -.01], [0, 0, sx * .12], {bias: -.1}));
  L.push(box('gold', [.2, .2, .03], [.03, 1.42, .008], [0, 0, Math.PI / 4]));   // the device on the banner
  for (const sx of [-1, 1]) {   // spears crossed in front
    L.push(limb('wood', [sx * .5, 0, .3], [-sx * .3, 1.62, .08], .026, .02));
    L.push(limb('metal', [-sx * .3, 1.62, .08], [-sx * .36, 1.86, .06], .045, .006, .2));
  }
  L.push(cyl('wood', .3, .3, .05, [.42, .34, .38], [1.15, 0, -.3], {seg: 12}));   // a round shield leaning on the cairn
  L.push(cyl('metal', .31, .31, .03, [.415, .335, .37], [1.15, 0, -.3], {seg: 12, bias: -.2}));
  L.push(cyl('metal', .07, .07, .08, [.44, .36, .41], [1.15, 0, -.3], {seg: 8, bias: .3}));
  return geoOf(L);
}
// Shrine of Blood: a stone altar with a basin of blood, bone horns curling up from its back corners, two candles
function blood() {
  const L = [];
  L.push(box('stone', [1.06, .56, .62], [0, .28, 0], [0, 0, 0], {bias: -.1}));
  L.push(box('stone', [1.2, .12, .74], [0, .62, 0], [0, 0, 0], {bias: .2}));
  L.push(box('stone', [.62, .26, .02], [0, .3, .315], [0, 0, 0], {bias: -.35}));
  L.push(cyl('stone', .27, .25, .06, [0, .7, .02], [0, 0, 0], {seg: 12, bias: .1}));
  L.push(cyl('red', .21, .21, .02, [0, .72, .02], [0, 0, 0], {seg: 12, bias: .3}));
  for (const [x, h] of [[.14, .13], [-.22, .1], [.3, .07]]) L.push(box('red', [.035, h, .02], [x, .62 - h / 2, .375]));
  for (const sx of [-1, 1]) {   // the horns
    const P = [[sx * .48, .66, -.22], [sx * .62, .98, -.27], [sx * .56, 1.28, -.16], [sx * .4, 1.42, -.02]], R = [.075, .055, .035, .012];
    for (let i = 0; i < 3; i++) L.push(limb('rope', P[i], P[i + 1], R[i], R[i + 1], .25));
  }
  for (const [x, y, z] of CANDLES) L.push(cyl('rope', .035, .04, .14, [x, y - .07, z], [0, 0, 0], {seg: 6, bias: .35}));
  return geoOf(L);
}
// Shrine of the Mountain: a cairn of flat stones and a standing stone behind it
function mountain() {
  const L = [], r = rng(61);
  const S = [[.56, .18, .5], [.46, .16, .42], [.38, .15, .35], [.3, .13, .27], [.22, .12, .2]];
  let y = 0;
  S.forEach(([sx, sy, sz], i) => {
    y += sy * (i ? 1.05 : .55);
    L.push(stoneLump('rock', [r() * .06 - .03, y, r() * .06 - .03], [sx, sy, sz], [r() * .12, r() * 3, r() * .12], .15 - i * .06, 1));
    y += sy * .55;
  });
  L.push(box('rock', [.4, 1.7, .24], [-.12, .82, -.4], [.05, .25, -.07], {bias: .05}));
  L.push(box('rock', [.3, .3, .2], [-.08, 1.72, -.4], [.3, .5, .2], {bias: .25}));
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2, d = .45 + r() * .25, s = .06 + r() * .06;
    L.push(stoneLump('rock', [Math.sin(a) * d, s * .4, Math.cos(a) * d], [s * 1.3, s, s], [r() * 3, r() * 3, r() * 3], r() * .4 - .2));
  }
  return geoOf(L);
}
// Altar of Exchange: a small gate of drums under a lintel on a stepped dais (the rift crystal floats in it: a sprite)
function exchange() {
  const L = [], r = rng(73);
  L.push(box('stone', [1.56, .12, .74], [0, .06, 0], [0, 0, 0], {bias: -.1}));
  L.push(box('stone', [1.2, .1, .5], [0, .17, 0], [0, 0, 0], {bias: .15}));
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) L.push(box('stone', [.32, .4, .32], [sx * .56 + (r() - .5) * .02, .43 + i * .42, (r() - .5) * .02], [0, (r() - .5) * .14, 0], {bias: (r() - .5) * .3}));
    L.push(box('stone', [.4, .1, .4], [sx * .56, 1.5, 0], [0, 0, 0], {bias: .2}));
    L.push(box('rune', [.16, .5, .02], [sx * .56, .85, .165], [0, 0, 0], {bias: .3}));
  }
  L.push(box('stone', [1.58, .2, .38], [0, 1.65, 0], [0, 0, -.025], {bias: .2}));
  L.push(box('rune', [.5, .06, .02], [0, 1.65, .195], [0, 0, -.025], {bias: .3}));
  return geoOf(L);
}
// The wandering trader's cart: a handcart under a striped canvas roof, goods on its bed, a lantern on the front post
function trader() {
  const L = [], r = rng(89);
  L.push(box('wood', [1.3, .08, .78], [0, .55, 0], [0, 0, 0], {bias: .15}));
  for (const sz of [-1, 1]) L.push(box('wood', [1.3, .22, .05], [0, .7, sz * .37], [0, 0, 0], {bias: -.05}));
  for (const sx of [-1, 1]) L.push(box('wood', [.05, .22, .78], [sx * .63, .7, 0], [0, 0, 0], {bias: -.1}));
  for (const sz of [-1, 1]) {   // wheels: a wooden disc, an iron tyre, a hub
    L.push(cyl('wood', .31, .31, .06, [-.12, .32, sz * .45], [Math.PI / 2, 0, 0], {seg: 12}));
    L.push({g: new THREE.TorusGeometry(.31, .025, 4, 12), m: M4([-.12, .32, sz * .45]), fam: 'metal'});
    L.push(cyl('metal', .07, .07, .1, [-.12, .32, sz * .47], [Math.PI / 2, 0, 0], {seg: 6, bias: .2}));
    L.push(limb('wood', [.64, .55, sz * .26], [1.12, .4, sz * .26], .03, .025));   // the handles
    L.push(box('wood', [.05, .5, .05], [.58, .27, sz * .3]));                       // and the front legs it rests on
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.push(box('wood', [.05, .82, .05], [sx * .6, 1.0, sz * .35]));
  for (const sz of [-1, 1]) for (let i = 0; i < 5; i++) {   // the pitched canvas roof, striped
    L.push(box(i % 2 ? 'rope' : 'red', [.27, .03, .5], [-.56 + i * .28, 1.48, sz * .2], [sz * .42, 0, 0], {bias: .15}));
  }
  L.push(box('wood', [1.4, .05, .05], [0, 1.58, 0]));
  L.push(box('wood', [.3, .28, .3], [-.36, .73, -.12], [0, .2, 0], {bias: .1}));
  L.push(box('wood', [.22, .2, .22], [-.36, .97, -.12], [0, -.3, 0], {bias: .25}));
  L.push(cyl('wood', .14, .14, .32, [.32, .75, -.14], [0, 0, 0], {seg: 10}));
  for (const y of [.65, .86]) L.push({g: new THREE.TorusGeometry(.142, .012, 4, 10), m: M4([.32, y, -.14], [Math.PI / 2, 0, 0]), fam: 'metal'});
  L.push(stoneLump('rope', [.02, .72, .13], [.17, .15, .14], [r(), r() * 3, r()], -.5, 1));
  L.push(limb('rope', [.02, .85, .13], [.03, .93, .13], .04, .028, -.6));
  L.push(cyl('clay', .07, .09, .16, [-.08, .67, .22], [0, 0, 0], {seg: 8}));
  L.push(box('metal', [.02, .12, .02], [LANTERN_AT[0], LANTERN_AT[1] + .06, LANTERN_AT[2]]));   // the lantern's hook
  return geoOf(L);
}

export function buildModels() {
  return {chance: chance(), combat: combat(), blood: blood(), mountain: mountain(), exchange: exchange(), trader: trader()};
}
