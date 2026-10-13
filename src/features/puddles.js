// RAIN PUDDLES (render3d): in the forest, puddles gather in the low spots of the ground as it rains, grow while it pours and shrink
// away as the ground dries (host.env.wet, sim/env.js's: it climbs in the rain, falls by the season's drying). The ground shader draws
// them (gfx.js SURF_FS: per ground texel, the sky's colour over the dark ground, a rim of wet mud, rain rings in them, and marked as
// water so the composite mirrors the trees in them); this file bakes, once per world, where the ground can hold one, and feeds the
// shader how full they are and the sky's colour:
//   WHERE   a map over the forest (TUNE.res m a texel, 0..1: how readily a texel holds water): the hollows the ground makes (the ground
//           closed over TUNE.close m, less the ground: a rut, a dip), plus a lumpy noise (the forest floor is never quite flat), on
//           level ground only (no puddle on a slope), clear of the lake and the streams (their banks are mud already)
//   FILL    eased toward host.env.wet: half wet, only the ruts and dips hold water; soaked, a tenth or so of the level floor too
//   SKY     the puddles' colour by the time of day (depth/art.js PUD_COL: the Proving Grounds' puddles' own)
// VIEW ONLY: nothing here is read by the sim; no Math.random (the bake is a function of the world).
//
// FEATURE CONTRACT (main.js): create(host) -> F: view, toggle, biomeChanged, ms. ?puddles=0: none.
// OWNS: its map and the eased fill. READS: host.world, host.layout.forest (the lake, the streams), host.env (wet, sky), host.time, host.G.
// EMITS: nothing. BUDGET: view < .005 ms (a setter); the bake at a build, ~10-30 ms (the forest at 2 texels a metre).
import {flags} from '../core/flags.js';
import {vnoise, smooth, clamp} from '../core/mathx.js';
import {rgbOf} from '../core/color.js';
import {WORLD, TERRAIN_ON, terrainField} from '../world/layout.js';
import {PUD_COL} from './depth/art.js';

const TUNE = {
  res: .5,          // m a texel of the map (the shader reads it smoothly and adds its own fine noise: ragged edges)
  close: 1,         // m: a dip narrower than twice this fills to its rims
  hollow: 3,        // the map's share per m of a dip's depth (a 10 cm rut: .3)
  lumps: .75,       // the noise's share (its high spots: where flat ground holds water)
  flat: [.06, .14], // the ground's slope (m / m) from where puddles can lie to where none can
  shore: .8,        // m kept clear of the lake's and the streams' water
  ease: 2,          // s to follow the ground's wetness
};
export const order = {after: ['weather']};

export async function create(host) {
  const F = {name: 'puddles', label: 'Rain puddles (forest)', ambient: true, on: flags.get('puddles') !== '0', ms: 0};
  let built = null, fill = 0;
  const SKY = {}; for (const k in PUD_COL) SKY[k] = rgbOf(PUD_COL[k].in);
  const sky = [0, 0, 0], _o = {d: 0, a: 0, l: 0, hw: 0, i: 0, k: 0};
  function bake() {
    built = host.world; const G = host.G, FO = host.layout?.forest;
    if (!FO || !G?.setPuddles) { G?.setPuddles?.(null); return; }
    const res = TUNE.res, x0 = WORLD.x0, z0 = WORLD.y0, x1 = WORLD.x1, z1 = Math.min(0, WORLD.y1);
    const w = Math.ceil((x1 - x0) / res) + 1, h = Math.ceil((z1 - z0) / res) + 1, n = w * h;
    const TF = TERRAIN_ON ? terrainField() : null, Hg = (x, y) => TF ? TF.H(x, y) : host.elev(x, y);
    const H = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = Hg(x0 + i * res, z0 + j * res);
    // the hollows: the ground closed (dilated, then eroded) over TUNE.close m, less the ground
    const r = Math.max(1, Math.round(TUNE.close / res));
    const pass = (src, dst, dx, dy, mx) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        let m = mx ? -1e9 : 1e9;
        for (let k = -r; k <= r; k++) { const a = Math.min(w - 1, Math.max(0, i + k * dx)), b = Math.min(h - 1, Math.max(0, j + k * dy)), v = src[b * w + a]; m = mx ? Math.max(m, v) : Math.min(m, v); }
        dst[j * w + i] = m;
      }
    };
    pass(H, A, 1, 0, true); pass(A, B, 0, 1, true); pass(B, A, 1, 0, false); pass(A, B, 0, 1, false);
    const data = new Uint8Array(n), L = FO.lake;
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      const k = j * w + i, x = x0 + i * res, y = z0 + j * res;
      const sl = Math.hypot(H[k + 1] - H[k - 1], H[k + w] - H[k - w]) / (2 * res), fl = 1 - smooth((sl - TUNE.flat[0]) / (TUNE.flat[1] - TUNE.flat[0]));
      if (fl <= 0) continue;
      if (L && Math.abs(x - L.x) < L.rx + 3 && Math.abs(y - L.y) < L.ry + 3 && (FO.inLake(x, y, TUNE.shore) || FO.strand?.(x, y))) continue;   // (the lake, its strand)
      if (FO.at(x, y, _o) || _o.d - _o.hw < TUNE.shore) continue;   // (a stream, its banks)
      const lumps = smooth((vnoise(x * .8, y * .8, 91) * .6 + vnoise(x * 2.1, y * 2.1, 92) * .4 - .47) / .25);   // (stretched: two noises' sum keeps to the middle)
      data[k] = Math.round(clamp((lumps * TUNE.lumps + Math.max(0, B[k] - H[k]) * TUNE.hollow) * fl, 0, 1) * 255);
    }
    G.setPuddles({data, w, h, x0: x0 - res / 2, z0: z0 - res / 2, wm: w * res, hm: h * res});
  }
  F.view = dt => {
    const t0 = performance.now();
    if (host.world !== built) bake();
    const E = host.env, want = F.on && E ? clamp(E.wet || 0, 0, 1) : 0;
    fill += (want - fill) * (1 - Math.exp(-dt / TUNE.ease));
    const c = SKY[host.time] || SKY.day; sky[0] = c[0]; sky[1] = c[1]; sky[2] = c[2];
    host.G?.setPuddleLook?.(fill, sky);
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  F.biomeChanged = () => { built = null; };
  F.toggle = () => { F.on = !F.on; return F.on; };
  return F;
}
