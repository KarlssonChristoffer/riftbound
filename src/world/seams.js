// SEAMS: where two ground painters meet on a straight line (the Proving Grounds' canvas and the forest's tiles at y 0, the West Downs'
// canvas and the forest's at y 0, the West Downs' and the Proving Grounds' at x 0), each painted its own way (its own noise fields,
// its own swells' light), so a blob of lit grass or a worn patch was cut off on a ruler-straight line. blendSeam makes the ground on
// one side of a seam turn into the other painter's over a BAND: the other painter paints the band too (every painter is a pure
// function of the world position), and a texel there takes the other's colour where a clumpy noise falls under a share that is 1 at
// the seam and 0 at the band's far edge (that edge ragged), so the change comes in blobs and fingers, the pixel art's own way. Only
// soft ground swaps (grass, earth, moss, the green banks, heath: the style's ramps named in SOFT), on both sides: water, rock, paths'
// stones, walls' feet, flowers and twigs stay as each painted them.
//   blendSeam(q, org, band, paintOther, S)   q: the target canvas's 2d context, org {X0, Y0, PPM} its world origin and scale;
//     band {x0, y0, x1, y1 (m), depth(x, y) -> 0 at the seam .. 1 at the band's far edge}; paintOther(q2, {X0, Y0, WPX, HPX}) paints the
//     other side's ground on a canvas over the band; S the biome's style (its ramps)
// OWNS: nothing (runs once per world build, world.js). READS: core/mathx.js. BUDGET: build time only (a painter over the band: the
// forest's over 72 x 6 m ~ a third of one of its 32 m tiles).
import {vnoise, hash3, smooth} from '../core/mathx.js';

export const SEAM = {band: 6, jag: 2.2, clump: 3.2, grain: .25};   // band (m); its far edge ragged by jag m; the swap's clumps (noise k per m), a pixel's share
const SOFT = ['grass', 'earth', 'damp', 'lush', 'moss', 'hgrass', 'dgrass', 'heath', 'lichen'];

const softSet = S => {
  const s = new Set();
  for (const n of SOFT) for (const h of S[n]?.h || []) s.add(parseInt(h.slice(1, 7), 16));
  return s;
};

export function blendSeam(q, org, band, paintOther, S) {
  const {X0, Y0, PPM} = org, W = q.canvas.width, H = q.canvas.height;
  const ax = Math.max(0, Math.floor((band.x0 - X0) * PPM)), ay = Math.max(0, Math.floor((band.y0 - Y0) * PPM));
  const bx = Math.min(W, Math.ceil((band.x1 - X0) * PPM)), by = Math.min(H, Math.ceil((band.y1 - Y0) * PPM));
  const w = bx - ax, h = by - ay; if (w <= 0 || h <= 0) return;
  // the other painter over the band (on the target's pixel lattice: its texel i is the target's ax + i)
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const q2 = c.getContext('2d', {willReadFrequently: true});
  paintOther(q2, {X0: X0 + ax / PPM, Y0: Y0 + ay / PPM, WPX: w, HPX: h});
  const o = q2.getImageData(0, 0, w, h).data, id = q.getImageData(ax, ay, w, h), d = id.data, soft = softSet(S);
  for (let j = 0; j < h; j++) {
    const my = Y0 + (ay + j + .5) / PPM;
    for (let i = 0; i < w; i++) {
      const mx = X0 + (ax + i + .5) / PPM, k = (j * w + i) * 4;
      const t = band.depth(mx, my) + (vnoise(mx * .45, my * .45, 131) - .5) * SEAM.jag / SEAM.band; if (t >= 1) continue;
      const p = 1 - smooth(Math.max(0, t));
      const u = vnoise(mx * SEAM.clump, my * SEAM.clump, 132) * (1 - SEAM.grain) + hash3(ax + i, ay + j, 133) * SEAM.grain;
      if (u >= p) continue;
      if (!soft.has(d[k] << 16 | d[k + 1] << 8 | d[k + 2]) || !soft.has(o[k] << 16 | o[k + 1] << 8 | o[k + 2])) continue;
      d[k] = o[k]; d[k + 1] = o[k + 1]; d[k + 2] = o[k + 2];
    }
  }
  q.putImageData(id, ax, ay);
}
