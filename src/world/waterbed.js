// WATERBED: what lies under the water and how deep it is, baked once per world beside the water texture (world.js bakeWater),
// for the ground shader (gfx.js WATER_FS wDeep): the look of t3ssel8r's water in pixels. Clear, light shallows along the banks,
// over the stepping stones' ford and in the wadeable creek, where the bed shows through (sand, gravel, pebbles, a few stones,
// the bank's submerged edge), wobbling a whole texel at a time as the surface's ripple refracts it; darker, richer water in the
// channel's middle (deepest toward the outside of each bend, a sand bar on the inside) and in the pool; a crisp foam line
// where things stand in the water (the stepping stones, frost's floes, the cascades' feet), with ripples pulsing out from it.
//
// One RGBA8 texel per ground texel, over the water's bounding box only (+ PAD texels round it: the refraction reads a little
// past the water's edge, and what it finds there is the bank going down under the water):
//   RGB  the bed's painted colour, within REACH texels of the water (under dry ground it is the submerged bank; further out unused)
//   A    bits 7-3 depth, 0 (the waterline) .. 31 (the deepest);  bits 2-0 contact: texels from a thing standing in the water
//        (1 = touching it .. 7), 0 = none near
// The depth comes from waterSample (world.js): how far a texel lies from the bank, against the body's width, the bend, a
// little noise (bars and holes), the stones' ford, the spring's well and the pool's bowl. The shader cuts it into BANDS
// (BED_TUNE cuts): each band its share of water over the bed (op) and its surface tone (tone), so the steps stay hard.
// A biome without a BED_TUNE entry (ember's lava) has no bed: the shader runs the old water. ?water=0: none anywhere (an A/B).
//
// OWNS: the bed texture (world.js disposes it with the world). READS: layout.js (the stream, the pool, the creek's cascades,
// the spring), the water texture's bytes (state, ring). No Math.random: hashes of the texel. ~35 ms at a build (ruins, loaded machine).
// Not baked: what joins the stream during play (a crate sunk to its lid: STREAM.addStone) gets no foam ring.
import * as THREE from 'three';
import * as LAYOUT from './layout.js';
const {STREAM, SPRING, POOL, FALL, inPool} = LAYOUT;   // (the creek's CASCADES only where the layout has them: the terrain's mesa; none = no foam at their feet)
import {flags} from '../core/flags.js';
import {hash3, vnoise, smooth, clamp, hypot2} from '../core/mathx.js';
import {hex255, hex01} from '../core/color.js';

const ON = flags.get('water') !== '0';
// per biome (the shader's uniforms come from here too: G.setWaterLook's bed):
//   sand / silt   the bed's floor: sand in three tones, silt where it's deep     bank  the submerged bank (earth, light -> dark)
//   pebble        gravel / pebble colours (light first: their lit texel is one step lighter, their shade one darker: rock)
//   peb           pebbles per 4 x 4 texel cell: [at the bank, in the deep]       rock  a few bigger stones on the bed (a ramp)
//   weed          tufts of weed on the bed (none: [])            ripples  the sand's ripple marks across the stream: texels apart (0 = none)
//   cuts          the depth bands' edges (0..1): very shallow | shallow | mid | deep
//   op            how much water covers the bed in each band (0 = the bed alone .. 1 = water only)
//   tone          the surface's base tone in each band (the water ramp's index, light 0 .. dark 3)
//   hiOp          the light crests' cover (they read as the surface over the bed)
//   tint          the bed seen through the water (multiplied in: clear water drinks the reds first)
//   hue           how much of the bed's own colour shows (0 = only its light and dark, on the water's colour)
//   dark          the deep band's darkest streaks: how far past the dark layer's cut they start (higher = fewer)
//   refr          the refraction's reach in the deepest band, whole texels (the shallowest band: 1)
//   foam          the contact foam's colour
export const BED_TUNE = {
  ruins: {sand: ['#a79a72', '#958962', '#807553'], silt: '#69644d', bank: ['#5e5244', '#4c4238', '#3a322a'],
    pebble: ['#a8a395', '#8c887c', '#a88c62', '#7a776c', '#94785a'], peb: [.62, .1], rock: ['#8e887a', '#736d61', '#59544a', '#3c3832'],
    weed: ['#5e7a4c', '#475f3e'], ripples: 7,
    cuts: [.12, .42, .7], op: [.22, .4, .66, 1], tone: [0, 1, 1, 2], hiOp: .6, tint: '#8cd9f2', hue: .25, dark: .04, refr: 2, foam: '#e8f6f2'},
  // meltwater: clear and cold over grey-blue shingle; ice-white foam
  frost: {sand: ['#8f98a4', '#7e8794', '#6b7482'], silt: '#4f5868', bank: ['#5a6272', '#485060', '#363d4b'],
    pebble: ['#a6b0bc', '#8a94a2', '#9a9a9a', '#747e8c', '#b4bcc4'], peb: [.75, .2], rock: ['#8494ad', '#6a7a95', '#55647e', '#3a455c'],
    weed: [],
    cuts: [.12, .36, .62], op: [.3, .5, .74, 1], tone: [1, 1, 2, 2], hiOp: .7, tint: '#a8c4e4', hue: .3, dark: .04, refr: 2, foam: '#f2f8ff'},
  // the muddy creek: you see the bed only at the very edge, the rest is brown water
  desert: {sand: ['#b8a47a', '#a48f66', '#8c7854'], silt: '#6e6248', bank: ['#8a6a4a', '#74583c', '#5a442e'],
    pebble: ['#b09a7a', '#94826a', '#a87a58', '#7c6c58', '#c0a884'], peb: [.5, .06], rock: ['#a87a5a', '#8a6248', '#6c4a36', '#462e22'],
    weed: [], ripples: 6,
    cuts: [.11, .3, .55], op: [.46, .72, .9, 1], tone: [0, 1, 1, 2], hiOp: .9, tint: '#e0d4b4', hue: .4, dark: .08, refr: 1, foam: '#ece4cc'},
};
const PAD = 4, MAXD = 7, REACH = 3;   // (REACH: the refraction's farthest offset, 2 texels, + 1)

// waterBed(biome, {WPX, HPX, PPM, cliffZ, X0, Y0, depth, dry}) -> null (no bed) | {add(x, y, o), finish(data) -> {tex, rect, ...the look} | null}
// bakeWater calls add for every texel it makes water (o: waterSample's out there), then finish with its finished bytes. X0 / Y0: the canvas's
// world origin (the West Downs' canvas: its brook; the river, the creek and the pool are the Proving Grounds', at 0, 0); depth(o, x, y): the
// depth of a body this file doesn't know (kind 4 and up: world/brook.js); dry: [{x, y, r}] things standing in that water (their foam lines)
export function waterBed(biome, {WPX, HPX, PPM, cliffZ, X0 = 0, Y0 = 0, depth = null, dry = null}) {
  const T = ON && BED_TUNE[biome.id];
  if (!T) return null;
  const dep = new Uint8Array(WPX * HPX);   // depth + 1 per water texel (0 = not water); freed with the closure
  let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
  let cy0 = NaN, cv0 = 0;   // the stream's x'' (1/m), its bends: once a row
  const curv = y => y === cy0 ? cv0 : (cy0 = y, cv0 = (STREAM.cx(y + .5) - 2 * STREAM.cx(y) + STREAM.cx(y - .5)) * 4);
  function depthOf(o, mx, my) {
    let d;
    if (o.kind >= 4 && depth) return depth(o, mx, my);
    if (o.kind === 1) {
      // the stream: a shelf along each bank (narrower where it narrows), then the channel; deeper toward the outside of a bend
      // (the centre of the bend lies on the side x'' points to: the far side is scoured, the near side a sand bar); bars and holes
      const sh = clamp(o.hw * .42, .2, .6), u = o.a / o.hw;
      d = .62 * smooth(o.edge / sh) + .38 * smooth((o.edge - sh) / Math.max(.05, o.hw - sh));
      d += clamp(-curv(my) * 3.2 * u, -.34, .3) * smooth(o.edge / .3);
      d += (vnoise(mx * 1.7, my * .6, 31) - .5) * .3 * smooth(o.edge / .25);
      for (const s of STREAM.stones) {   // the stepping stones stand on a ford: a shallow bar across the flow
        const dx = mx - s.x, dy = my - s.y, r = hypot2(dx, dy * 1.3) - s.r;
        d = Math.min(d, .06 + Math.max(0, r) * 1.1, .14 + hypot2(dx * .32, dy * 1.5) * .9);
      }
    } else if (o.kind === 2) {
      // the creek: wadeable, the bed in sight all along; the spring wells up out of a dark hole
      d = .05 + .22 * smooth(o.edge / Math.max(.08, o.hw)) + (vnoise(mx * 3, my * 3, 32) - .5) * .08;
      const rs = hypot2(mx - SPRING.x, my - SPRING.y) / SPRING.r;
      if (rs < 1) d = Math.max(d, .2 + .6 * smooth((1 - rs) / .7));
    } else {
      // the pool: a bowl, deepest under the fall; its outflow a shallow run
      d = inPool(mx, my) ? .1 + .85 * smooth(o.edge / .55) : .06 + .24 * smooth(o.edge / Math.max(.1, o.hw));
      d += (vnoise(mx * 3, my * 3, 33) - .5) * .1;
    }
    return clamp(d, 0, 1);
  }
  return {
    add(x, y, o) {
      dep[y * WPX + x] = 1 + Math.round(depthOf(o, X0 + (x + .5) / PPM, Y0 + (y + .5) / PPM) * 31);
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    },
    finish(data) {
      if (bx1 < 0) return null;
      const x0 = Math.max(0, bx0 - PAD), y0 = Math.max(0, by0 - PAD), x1 = Math.min(WPX - 1, bx1 + PAD), y1 = Math.min(HPX - 1, by1 + PAD);
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, n = bw * bh, out = new Uint8Array(n * 4), con = new Uint8Array(n);
      const water = (u, v) => data[((v + y0) * WPX + u + x0) * 4] >> 6 >= 2;   // (box coordinates)
      // ---- CONTACT: what stands in the water. A dry texel well inside the stream's banks (a stepping stone, its painted face, a floe,
      // a sunk crate painted in) and the foot of each falling sheet (the cascades on the creek, the fall into the pool). Each such texel
      // that touches water stamps its distance (texels, rounded) into con over a disc of MAXD: few texels, small discs, no pass over the box
      con.fill(255);
      const DISC = []; for (let j = -MAXD; j <= MAXD; j++) for (let i = -MAXD; i <= MAXD; i++) { const r = Math.round(hypot2(i, j)); if (r <= MAXD) DISC.push(i, j, r); }
      const stampC = (u, v) => { for (let q = 0; q < DISC.length; q += 3) { const a = u + DISC[q], b = v + DISC[q + 1]; if (a >= 0 && b >= 0 && a < bw && b < bh && con[b * bw + a] > DISC[q + 2]) con[b * bw + a] = DISC[q + 2]; } };
      const touches = (u, v) => (u > 0 && water(u - 1, v)) || (u < bw - 1 && water(u + 1, v)) || (v > 0 && water(u, v - 1)) || (v < bh - 1 && water(u, v + 1));
      const own = !X0 && !Y0;   // (the river's stones, the cascades' and the fall's feet: the Proving Grounds' canvas)
      for (let v = 0; v < bh && own; v++) {
        const my = (v + y0 + .5) / PPM; if (my <= STREAM.y0 || my >= STREAM.y1) continue;
        const c = STREAM.cx(my), hw = STREAM.w(my) / 2 - .1;
        for (let u = Math.max(0, Math.ceil((c - hw) * PPM - .5) - x0), ue = Math.min(bw - 1, Math.floor((c + hw) * PPM - .5) - x0); u <= ue; u++)
          if (!water(u, v) && touches(u, v) && my < cliffZ((u + x0 + .5) / PPM) - .1) stampC(u, v);
      }
      const line = (ax, ay, bx, by) => {   // a sheet's foot (m)
        const k = Math.ceil(hypot2(bx - ax, by - ay) * PPM) + 1;
        for (let i = 0; i <= k; i++) stampC(Math.floor((ax + (bx - ax) * i / k) * PPM) - x0, Math.floor((ay + (by - ay) * i / k) * PPM) - y0);
      };
      if (own) for (const c of LAYOUT.CASCADES || []) if (!c.last) line(c.x - c.dy * c.hw, c.y + c.dx * c.hw, c.x + c.dy * c.hw, c.y - c.dx * c.hw);
      if (own && FALL && POOL) line(FALL.x - FALL.hw, POOL.clip + .02, FALL.x + FALL.hw, POOL.clip + .02);
      for (const s of dry || []) {   // (another canvas's things in the water: the dry texels of each that touch it)
        const cu = Math.round((s.x - X0) * PPM) - x0, cv = Math.round((s.y - Y0) * PPM) - y0, r = Math.ceil(s.r * PPM) + 1;
        for (let v = Math.max(0, cv - r); v <= Math.min(bh - 1, cv + r); v++) for (let u = Math.max(0, cu - r); u <= Math.min(bw - 1, cu + r); u++) if (!water(u, v) && touches(u, v)) stampC(u, v);
      }
      // ---- THE BED: sand in clusters of three tones (two noises, no per-texel dither: under the refraction a speckle would crawl), the
      // stream's ripple marks across its flow, silt in the deep, the bank's earth under and along the dry ground, weed in tufts; then
      // gravel and pebbles stamped on (in patches, denser toward the banks and the ford) and a few stones, each with its shadow on the bed
      // (only within REACH texels of the water: no lookup, refracted or not, lands further out. A separable dilation of the water)
      const need = new Uint8Array(n), row = new Uint8Array(n);
      for (let v = 0; v < bh; v++) for (let u = 0, k = 0; u < bw + REACH; u++) {
        if (u < bw && water(u, v)) k = 2 * REACH + 1; if (k > 0) { k--; if (u - REACH >= 0) row[v * bw + u - REACH] = 1; }
      }
      const cnt = new Uint8Array(bw);   // (down the columns, a row at a time)
      for (let v = 0; v < bh + REACH; v++) for (let u = 0; u < bw; u++) {
        if (v < bh && row[v * bw + u]) cnt[u] = 2 * REACH + 1; if (cnt[u] > 0) { cnt[u]--; if (v - REACH >= 0) need[(v - REACH) * bw + u] = 1; }
      }
      const sand = T.sand.map(hex255), silt = hex255(T.silt), bank = T.bank.map(hex255), weed = T.weed.map(hex255);
      const set = (i, c) => { out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; };
      const mul = (i, k) => { out[i * 4] *= k; out[i * 4 + 1] *= k; out[i * 4 + 2] *= k; };   // (Uint8Array: rounds down)
      for (let v = 0; v < bh; v++) for (let u = 0; u < bw; u++) {
        const X = u + x0, Y = v + y0, i = v * bw + u, mx = X0 + (X + .5) / PPM, my = Y0 + (Y + .5) / PPM, dv = dep[Y * WPX + X];
        if (!need[i]) continue;
        const ring = water(u, v) ? data[(Y * WPX + X) * 4 + 1] >> 5 : 0;   // texels from the bank (1 .. 7; 0: further in)
        const nz = vnoise(mx * 1.6, my * 1.6, 41) * .62 + vnoise(mx * 4.6, my * 4.6, 42) * .38;
        let t = nz > .6 ? 0 : nz > .42 ? 1 : 2;
        if (!dv || (ring && ring <= 2 && hash3(X, Y, 44) < .75 - ring * .2)) { set(i, bank[t]); }   // the bank going down
        else if (dv > 21 && nz + (dv - 21) * .03 > .72) set(i, silt);
        else if (weed.length && dv > 8 && vnoise(mx * 4, my * 1.6, 45) > .74 && hash3(X, Y, 46) < .7) set(i, weed[hash3(X, Y, 47) < .6 ? 0 : 1]);
        else {
          if (T.ripples && dv > 4 && dv < 22 && my > STREAM.y0 && my < STREAM.y1 && Math.abs(mx - STREAM.cx(my)) < STREAM.w(my) / 2) {
            const r = (Y + (vnoise(mx * 2.2, my * .7, 48) - .5) * 7 + 70) % T.ripples;   // ripple marks: a dark trough, a lit crest, across the flow
            if (r < 1) t = Math.min(2, t + 1); else if (r < 2 && t > 0) t--;
          }
          set(i, sand[t]);
        }
        const c = con[i] > MAXD ? 0 : con[i];
        out[i * 4 + 3] = (dv ? dv - 1 : 0) << 3 | (dv ? c : 0);
      }
      // pebbles: one maybe per 4 x 4 cell, jittered, more in gravel patches; 2 .. 4 texels across, lit up-left, shaded down-right,
      // their shadow on the bed a texel down-right; stones: a ramp with its outline on the shaded side, a longer shadow
      const peb = T.pebble.map(hex255), rock = T.rock.map(hex255);
      const pebAt = (i, c, k) => { out[i * 4] = Math.min(255, c[0] * k); out[i * 4 + 1] = Math.min(255, c[1] * k); out[i * 4 + 2] = Math.min(255, c[2] * k); };
      const stamp = (cx, cy, r, col, ramp) => {   // a disc of radius r (texels) at (cx, cy) (box coordinates), shaded from the up-left
        const sh = ramp ? 1.3 : .9;
        for (let v = Math.floor(cy - r); v <= Math.ceil(cy + r + sh); v++) for (let u = Math.floor(cx - r); u <= Math.ceil(cx + r + sh); u++) {
          if (u < 0 || v < 0 || u >= bw || v >= bh) continue;
          const dx = u + .5 - cx, dy = v + .5 - cy, q = dx * dx + dy * dy, i = v * bw + u;
          if (q > r * r) { if ((dx - sh) ** 2 + (dy - sh) ** 2 <= r * r) mul(i, .76); continue; }   // its shadow
          const s = (dx + dy) / r;
          if (ramp) set(i, ramp[q > (r - 1) * (r - 1) && s > -.2 ? 3 : s < -.55 ? 0 : s > .45 ? 2 : 1]);
          else pebAt(i, col, s < -.6 ? 1.2 : s > .45 ? .72 : 1);
        }
      };
      for (let cy = 0; cy < bh; cy += 4) for (let cx = 0; cx < bw; cx += 4) {
        const X = cx + x0, Y = cy + y0, h = hash3(X, Y, 51), px0 = cx + hash3(X, Y, 52) * 4, py0 = cy + hash3(X, Y, 53) * 4;
        const ui = Math.min(bw - 1, px0 | 0), vi = Math.min(bh - 1, py0 | 0), dv = dep[(vi + y0) * WPX + ui + x0];
        if (!dv) continue;
        const k = 1 - (dv - 1) / 31, g = vnoise(X / 22, Y / 22, 56) > .5 ? 1.35 : .55, p = (T.peb[1] + (T.peb[0] - T.peb[1]) * k * k) * g;
        if (h < p) stamp(px0, py0, 1 + hash3(X, Y, 54) * 1.1, peb[hash3(X, Y, 55) * peb.length | 0], null);
      }
      for (let cy = 0; cy < bh; cy += 14) for (let cx = 0; cx < bw; cx += 14) {   // stones on the bed: one in ~6 cells
        const X = cx + x0, Y = cy + y0, px0 = cx + 3 + hash3(X, Y, 61) * 8, py0 = cy + 3 + hash3(X, Y, 62) * 8;
        const ui = Math.min(bw - 1, px0 | 0), vi = Math.min(bh - 1, py0 | 0), dv = dep[(vi + y0) * WPX + ui + x0];
        if (dv && dv < 26 && hash3(X, Y, 63) < .17) stamp(px0, py0, 2.6 + hash3(X, Y, 64) * 2, null, rock);
      }
      const tex = new THREE.DataTexture(out, bw, bh, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
      const s1 = hex01(T.sand[1]), lum = s1[0] * .3 + s1[1] * .55 + s1[2] * .15;   // (the sand's middle tone: the bed's light and dark are measured from it)
      return {tex, rect: [x0, y0, bw, bh], cuts: T.cuts, op: T.op, tone: T.tone, hiOp: T.hiOp, tint: hex01(T.tint), hue: T.hue, lum, dark: T.dark, refr: T.refr, foam: hex01(T.foam)};
    },
  };
}
