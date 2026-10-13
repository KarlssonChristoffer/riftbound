// HUT: the roof of the small stone hut in the forest's lakeside clearing (layout.js HUT: its outline, walls, roofY), a place to try the
// cutaway (features/cutaway.js) under a roof. Its walls are stone runs (walls3d.js, via layout.js walls); this lays the ROOF: big flat
// stone slabs side by side across the hut from wall to wall, an overhang all round, each slab a little uneven (its own height, a lean,
// a tone: walls3d.js's mason), and a row of capstones along the middle where the slabs meet. Moss on the tops (the biome's cover).
//   hutRoof(H, o) -> {geo, top (m: its highest point)};  o = {fam, cover} (walls3d.js)
// OWNS: nothing at run time (a pure function of the plan). Frame: world metres, x east, y up, z south (world.js moves it to its prop).
import {mason} from './walls3d.js';
import {sink, cuboid} from './cliffs3d.js';
import {setMaterials} from '../content/materials.js';

setMaterials({hutroof: 'stone'});   // (bullets glance off it, chip it: sim/projectiles.js, features/gunfx.js)

const SLAB = [.72, 1.02], THICK = [.2, .26], CAP = {w: .5, h: .16};

export function hutRoof(H, o) {
  const M = mason(907, o), {R, rr, fs} = M, B = sink(), e = H.d / 2 + H.over;
  const x0 = H.x0 - e, x1 = H.x1 + e, z0 = H.y0 - e, z1 = H.y1 + e, y = H.roofY, U = [1, 0, 0], V = [0, 1, 0], W = [0, 0, 1];
  let top = y;
  // the slabs: across the hut (along z), one after another along x, each its own width, thickness and lean
  for (let x = x0; x < x1 - .05;) {
    const w = Math.min(rr(SLAB[0], SLAB[1]), x1 - x), t = rr(THICK[0], THICK[1]), lift = rr(-.03, .04), cx = x + w / 2;
    const [u, v, ww] = M.axes(U, W, rr(-.03, .03), rr(-.03, .03), rr(-.04, .04));
    cuboid(B, [cx, y + lift + t / 2, (z0 + z1) / 2], u, v, ww, w / 2 - .012, t / 2, (z1 - z0) / 2 + rr(-.08, .06), fs, B.part(), M.tone(), R, .05);
    top = Math.max(top, y + lift + t);
    x += w;
  }
  // the capstones along the middle (east-west), over the slabs' joints
  for (let x = x0 + .1; x < x1 - .2;) {
    const l = Math.min(rr(.55, .85), x1 - .1 - x), cx = x + l / 2;
    const [u, v, ww] = M.axes(U, W, rr(-.06, .06), rr(-.04, .04), rr(-.05, .05));
    cuboid(B, [cx, top + CAP.h / 2 - .02, (z0 + z1) / 2 + rr(-.05, .05)], u, v, ww, l / 2 - .015, CAP.h / 2, CAP.w / 2, fs, B.part(), M.tone() - .05, R, .08);
    x += l;
  }
  return {geo: B.geometry(), top: top + CAP.h};
}
