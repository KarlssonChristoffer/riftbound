// FJALLPAINT: the fjäll's ground painted as pixel art (world/fjall.js's zones -> RGBA bytes), in the paint worker
// (world/fjallworker.js). A rect of the region at ppm px / m: its zones worked out on a coarse lattice (1 m near, 2 m far), read
// bilinearly per pixel and cut into materials with an ordered dither (no soft blends: hard pixel edges, as the woods' painter), each
// material a 4-tone ramp lit by the ground's slope (the sun from the south-west, as the woods are painted) and broken by specks.
//   MATERIALS  the mountain birch's floor (blueberry and crowberry green), the willow belt, the heath (brown-olive kalfjäll), lichen
//              (pale patches on the heath), scree and stones high up, bare rock on the steep, late snow, the glacier's ice with its
//              crevasses, the shore's gravel, the lake (darker where deep), the jokk (pale and foaming), the trail's worn earth
//   paintRect(P, x0, y0, wm, hm, ppm) -> Uint8ClampedArray (wm * ppm x hm * ppm, RGBA, row 0 = y0: the planar texture's v)
// OWNS: nothing (pure). READS: the plan (H, zone, lakeR, jokkAt).
import {clamp, hash3 as hash2, vnoise} from '../core/mathx.js';

const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const ramp = (...c) => c.map(hex);
// light -> dark, like the woods' ramps (world/biomes.js STYLES.ruins: the fell's heath and lichen are theirs)
export const PAL = {
  birch: ramp('#71805a', '#5b6a49', '#48553c', '#333d2d'),     // the birch wood's floor: blueberry, crowberry, grass
  grass: ramp('#7a8463', '#636d50', '#4e5741', '#363d30'),     // the valley's meadow (the woods' upland grass)
  willow: ramp('#8b9a74', '#72805e', '#5a664b', '#3e4736'),    // the willow belt: grey-green
  heath: ramp('#857a5b', '#6d6349', '#564e3c', '#3b352b'),     // the kalfjäll's heath: crowberry and dwarf shrubs, brown-olive
  lichen: ramp('#bdbd9c', '#a2a384', '#85876e', '#5d5f4e'),    // reindeer lichen, pale
  scree: ramp('#9d988b', '#837e73', '#69655c', '#494741'),
  rock: ramp('#8a857a', '#6e6a61', '#56534d', '#393835'),
  snow: ramp('#f4f6f8', '#dfe6ee', '#c3cedb', '#9aa8ba'),
  ice: ramp('#dbeff4', '#b6d9e5', '#8ebdd1', '#5f8fa9'),
  gravel: ramp('#a39b89', '#888170', '#6d675a', '#4d4940'),
  trail: ramp('#93836a', '#7a6c55', '#615643', '#433c30'),
  lake: ramp('#7ea7ae', '#62909b', '#4a7585', '#34596c'),
  jokk: ramp('#c2e0e2', '#9cc8cc', '#77a8b2', '#527f8e'),
  speck: {berry: hex('#2f3a3a'), crow: hex('#2a2a24'), flower: hex('#d8d4c0'), lichenW: hex('#e2e0c8'), foam: hex('#eef6f6'), dark: hex('#262622')},
};
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16 - .5);
const LX = -.38, LY = .42, LZ = .82;   // the light (x east, y south, up): from the south-west, above
const F = ['h', 'tree', 'willow', 'snow', 'glacier', 'rock', 'trail', 'wet', 'wl', 'shore', 'light', 'fast'];   // (the lattice's fields)

export function paintRect(P, x0, y0, wm, hm, ppm) {
  const W = Math.round(wm * ppm), Hh = Math.round(hm * ppm), out = new Uint8ClampedArray(W * Hh * 4);
  const zs = ppm >= 4 ? 1 : 2, nx = Math.ceil(wm / zs) + 3, ny = Math.ceil(hm / zs) + 3, lx0 = x0 - zs, ly0 = y0 - zs;
  const L = {}; for (const k of F) L[k] = new Float32Array(nx * ny);
  const Z = {};
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = lx0 + i * zs, y = ly0 + j * zs, k = j * nx + i;
    P.zone(x, y, Z);
    const e = .8, gx = (P.H(x + e, y) - P.H(x - e, y)) / (2 * e), gy = (P.H(x, y + e) - P.H(x, y - e)) / (2 * e), nl = Math.hypot(gx, gy, 1);
    L.h[k] = Z.h; L.tree[k] = Z.tree; L.willow[k] = Z.willow; L.snow[k] = Z.snow; L.glacier[k] = Z.glacier; L.rock[k] = Z.rock; L.trail[k] = Math.min(Z.trail, 9);
    const wet = Z.water === Z.water; L.wet[k] = wet ? 1 : 0; L.wl[k] = wet ? Z.water - Z.h : 0;
    const lr = P.lakeR(x, y), je = P.jokkEdge(x, y);
    L.fast[k] = lr < 1 ? 0 : 1;
    L.shore[k] = lr < 1.2 && lr > .9 || je < 2.5 && je > -1.5 ? 1 : 0;   // (near an edge: worked out per pixel)
    L.light[k] = (-gx * LX - gy * LY + LZ) / nl;
  }
  let fx = 0, fy = 0, ii = 0, jj = 0, u = 0, w = 0;
  const rd = A => { const k = jj * nx + ii, a = A[k], b = A[k + 1], c = A[k + nx], d = A[k + nx + 1]; return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w; };
  const put = (o, c) => { out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; };
  for (let py = 0; py < Hh; py++) {
    const wy = y0 + (py + .5) / ppm; fy = (wy - ly0) / zs; jj = Math.min(ny - 2, fy | 0); w = fy - jj;
    for (let px = 0; px < W; px++) {
      const wx = x0 + (px + .5) / ppm; fx = (wx - lx0) / zs; ii = Math.min(nx - 2, fx | 0); u = fx - ii;
      const gx = Math.round(wx * ppm), gy = Math.round(wy * ppm);   // (the world pixel: specks agree across tiles at one density)
      const d = BAYER[(gy & 3) * 4 + (gx & 3)], n1 = hash2(gx, gy, 11), n2 = vnoise(wx * 1.4, wy * 1.4, 12), n3 = vnoise(wx * .3, wy * .3, 13);
      const h = rd(L.h), light = rd(L.light);
      let tone = 1.35 - (light - .8) * 5.5 + (n2 - .5) * .7 + d * .5;
      let pal, speck = null;
      // the water's edge exactly per pixel where the lattice says it is near (the lake's outline, the jokk's banks): no 1 m stairs
      let wet = rd(L.wet), shore = rd(L.shore);
      if ((wet > .001 && wet < .999) || shore > .001) {
        const lr = P.lakeR(wx, wy), je = lr < 1 ? 99 : P.jokkEdge(wx, wy);
        if (lr < 1 || je < 0) wet = 1; else if (wet < .999) wet = 0;
        shore = wet ? 0 : lr < 1.055 || je < 1.1 + (n2 - .5) * .8 ? 1 : 0;
      }
      if (wet > .5 + d * .4) {
        if (rd(L.fast) > .5) { pal = PAL.jokk; tone = 1.2 + (n2 - .5) * 1.6 + d; if (n1 < .07) speck = PAL.speck.foam; }
        else { pal = PAL.lake; tone = .6 + clamp(rd(L.wl) / 2.6, 0, 1) * 2.4 + d * .6 + (n3 - .5) * .5; if (n1 < .004) speck = PAL.speck.foam; }
      } else if (rd(L.glacier) > .5 + d * .5) {
        pal = PAL.ice; tone += (n3 - .5) * .8;
        const fu = wx * .62 + wy * .78, fv = wy * .62 - wx * .78; if (vnoise(fu * .7, fv * .09, 14) > .8 && n1 < .85) tone = 3;   // (crevasses: dark cracks across the ice's flow, south-east)
      } else if (rd(L.snow) > .5 + d * .6) { pal = PAL.snow; tone -= .4; }
      else if (rd(L.trail) < .95 + d * .7 + (n2 - .5) * .5) { pal = h > 90 ? PAL.gravel : PAL.trail; tone += (n1 - .5) * .9; if (n1 < .05) speck = PAL.speck.dark; }
      else if (shore > .5 + d * .5) { pal = PAL.gravel; tone += (n1 - .5) * 1.2; }
      else if (rd(L.rock) > .5 + d * .6) { pal = PAL.rock; tone += (n2 - .5) * .9; if (n1 < .05) speck = PAL.speck.dark; }
      else if (rd(L.tree) > .2 + d * .4) {
        pal = PAL.birch; tone += .3; if (n1 < .03) speck = PAL.speck.berry; else if (n1 > .99) speck = PAL.speck.flower;
        if (n3 > .8 + d * .1) pal = PAL.lichen;   // (lichen in the birch wood's glades)
      } else {
        const wl = rd(L.willow);
        if (h < 24 && wl < .3) { pal = PAL.grass; if (n1 > .985) speck = PAL.speck.flower; }
        else if (wl > .3 + d * .5) { pal = PAL.willow; if (n1 < .04) speck = PAL.speck.crow; }
        else {
          // the open fell: heath with lichen in patches, scree and stones as it goes up
          const lich = vnoise(wx * .12, wy * .12, 15) * .6 + n3 * .4, high = clamp((h - 104) / 40, 0, 1);
          pal = high > .5 + d + (n3 - .5) * .6 ? PAL.scree : lich > .56 - d * .12 ? PAL.lichen : PAL.heath;
          if (n1 < .045) speck = pal === PAL.lichen ? PAL.speck.lichenW : PAL.speck.crow;
        }
      }
      const o = (py * W + px) * 4;
      if (speck) { put(o, speck); continue; }
      put(o, pal[tone < 0 ? 0 : tone > 3 ? 3 : tone | 0]);
    }
  }
  return out;
}
