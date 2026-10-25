// RIFT ANOMALY (the sandbox, VISUALS ONLY: a reminder of the gameplay to come, docs/exp/anomaly.md). A vertical tear in the
// air, ~2.2 m tall, hovering just off the ground somewhere open in the Proving Grounds: a jagged slit of deep void with star
// specks drifting in it, its torn edge glowing in the rift's colours, writhing and flickering, breathing in a slow pulse.
// Motes spiral in toward it and wink out at the slit; pebbles, flakes and dust (the biome's) orbit it slowly a little above
// the ground; a scorched, crystalline ring lies under it with glowing cracks, glints and crystal spikes; its violet light
// falls on the ground and on whatever stands near (the lighting's feature lights); the air beside it shimmers (whole-pixel
// row shifts, the distort layer). It does NOTHING to the game: no update, no collider, no entity, no event; it bends,
// pulls, hurts and blocks nothing (the sim comes out the same without it: tools/test/simview.mjs). Not in runs.
//   look      all on the GPU: features/anomaly/tear.js (the slit, painted texel by texel by a G-buffer shader),
//             features/anomaly/specks.js (motes, debris, glints, spikes, cracks: closed forms of the clock in one instanced
//             draw and one line draw). Here: the ground decal (painted ONCE, drawn into the ground layer), the HD glow
//             (G.fx), the shimmer (the distort layer), the light
//   where     features/anomaly/place.js: found at runtime on flat open ground, out of the way, deterministic (a fixed seed):
//             the same spot every load for a biome, found again after every world build (the first view after it)
//   motion    the view's own clock (F.view, ambient: it goes on behind the menu and in photo mode's living world; a still
//             photo freezes it). No Math.random anywhere (no draw from the shared generator: golden stays put elsewhere)
// ?anomaly=0: none (on by default in the sandbox); Dev > World: the toggle, Space warp, HD glow; Sandbox > Places: go there.
// FEATURE CONTRACT (main.js): view, frame, lights, biomeChanged, toggle, menu, settings; ambient. F.spot: where it stands (read only).
// OWNS: F.on, the spot, its clock, the tear's / specks' meshes (tear.js, specks.js), the decal canvas, its light record.
// READS: the game's mode (sandbox), host.elev / inStream / layout / entities.near (place.js), host.biome, host.zoom,
//   host.G (toScreenInto, onScreen, fx, compU), host.env (season).
// EMITS: nothing.  BUDGET: off / not the sandbox: nothing (no view, no draws). On: view ~1 µs (a clock); frame ~.01 ms in
//   view (uniforms, 1 decal, 4 fx, <= ~40 distort rects), nothing out of view but the light record; GPU: 3 more G-buffer
//   draws (the tear, ~120 specks, 20 crack segments). Placing it (once a world build): a few ms.
import {flags} from '../core/flags.js';
import {vnoise} from '../core/mathx.js';
import {findSpot} from './anomaly/place.js';
import {createTear, SIZE} from './anomaly/tear.js';
import {createSpecks} from './anomaly/specks.js';

const TUNE = {
  hover: .14,                // m: the lens's foot above the ground
  breath: 3.4,               // s: one pulse
  light: {h: 1.15, color: [.78, .45, 1], r: 4.6, k: .82, kPulse: .3, flicker: .06, id: 7791},
  glow: {r: .46, a: .085, aPulse: .05, rgb: [.82, .42, 1], wide: {r: 1.5, a: .03}},   // the HD glow along the slit (G.fx 'add')
  ring: {r: .98},            // m: the decal's radius
  warp: {band: 3, gap: 4.5, rows: 3, speed: 2.6},   // the shimmer: px wide, px off the slit's side, rows a block, waves per s
  cull: 170,                 // px round the view within which it draws
};
// what orbits it, per biome (from each biome's palette): pebbles [lit top, body], flakes [two tones] (the ruins' in autumn:
// fall), dust, a glowing fleck (emissive: ember's embers, the rift's crystal chips) or null, and the shadows under them (the
// floor's darkest tone)
const DEBRIS = {
  ruins: {peb: ['#7e786b', '#504b44'], flake: ['#9bc464', '#57803f'], fall: ['#eea646', '#a35628'], dust: '#b5ac94', glow: null, shadow: '#4a453c'},
  ember: {peb: ['#5f4b4b', '#362a2c'], flake: ['#8c827b', '#655e59'], dust: '#79716b', glow: '#ffa040', shadow: '#2e2827'},
  frost: {peb: ['#717e90', '#475264'], flake: ['#e2e9f2', '#9dd2ef'], dust: '#c8d3e2', glow: null, shadow: '#445069'},
  rift: {peb: ['#4f4270', '#2d2545'], flake: ['#6c5c94', '#42375f'], dust: '#7a64a8', glow: '#ea7ee4', shadow: '#1b152d'},
  desert: {peb: ['#c97e5c', '#874a36'], flake: ['#c6c69a', '#808462'], dust: '#e6cc98', glow: null, shadow: '#7c6448'},
};
const EMPTY = [];

export async function create(host) {
  const {THREE, G, PPM, PPMY, PPMH} = host;
  const F = {name: 'anomaly', label: 'Rift anomaly (visual)', ambient: true, on: flags.get('anomaly') !== '0', ms: 0, TUNE};
  const tear = createTear(G, THREE, {PPM, PPMH});
  const specks = createSpecks(G, THREE, {PPM, PPMH, hover: TUNE.hover, breath: TUNE.breath, ring: .012});
  let game = null, spot = null, spotWorld = null, T = 0, pulse = 0, warp = true, hdGlow = true, season = '';
  const sandbox = () => (game ??= host.feature('game'))?.mode === 'sandbox';
  const active = () => F.on && sandbox();
  const decal = paintDecal(TUNE.ring.r, PPM, PPMY);   // (a world circle is the same ellipse at every yaw: painted once)
  // the light (one record, reused)
  const L = TUNE.light, LREC = {x: 0, y: 0, h: 0, color: L.color, radius: L.r, intensity: L.k, flicker: L.flicker, id: L.id, jitter: 0}, LI = [LREC];

  function palette() {   // what orbits it: the biome's (the ruins' leaves turn in autumn)
    season = host.env?.season || '';
    const P = DEBRIS[host.biome?.id] || DEBRIS.ruins;
    specks.palette({peb: P.peb, flake: season === 'autumn' && P.fall ? P.fall : P.flake, dust: P.dust, glow: P.glow, shadow: P.shadow});
  }
  function place() {
    const t0 = performance.now();
    spot = findSpot(host); spotWorld = host.world;
    F.placeMs = performance.now() - t0;
    if (!spot) console.warn('anomaly: no open ground found for the rift in', host.biome?.id);
    palette();
  }

  Object.defineProperty(F, 'spot', {get: () => F.on ? spot : null});   // (where it stands, {x, y, g}, once placed: features/story.js films it and counts it a place)
  F.toggle = () => { F.on = !F.on; };
  F.biomeChanged = () => { spotWorld = null; };   // (found again at the next view: after every feature has built its pieces)
  F.settings = () => [{label: 'Space warp', options: ['on', 'off'], get: () => warp ? 'on' : 'off', set: v => { warp = v === 'on'; }},
    {label: 'HD glow', options: ['on', 'off'], get: () => hdGlow ? 'on' : 'off', set: v => { hdGlow = v === 'on'; }}];
  // the menu's Sandbox tab (Places): go and look at it (stand a couple of metres south of it, the camera's side at yaw 0)
  F.menu = () => {
    if (!active() || !spot) return [];
    return [{label: 'Rift anomaly: go there', run: () => {
      for (const [ox, oy] of [[0, 2.3], [1.6, 1.8], [-1.6, 1.8], [2.3, 0], [-2.3, 0], [0, -2.3]]) {
        const x = spot.x + ox, y = spot.y + oy; if (!host.blocked(x, y, spot.g)) { host.teleport(x, y); return; }
      }
      host.teleport(spot.x, spot.y + 2.3);
    }}];
  };

  // VIEW (ambient): the clock and the pulse (everything that moves is a closed form of them, on the GPU)
  F.view = dt => {
    if (!active()) return;
    if (spotWorld !== host.world) place();
    if (!spot) return;
    if ((host.env?.season || '') !== season) palette();
    T += dt;
    pulse = .5 + .5 * Math.sin(T * 6.283185307179586 / TUNE.breath);
  };

  // FRAME: arm the tear and the specks, lay the decal, the glow, the shimmer
  const SV = [0, 0, 0];
  const DIST = ['rgb(127,128,0)', 'rgb(129,128,0)'];
  F.frame = () => {
    if (!active() || !spot) return;
    const x0 = spot.x, y0 = spot.y, g = spot.g, h0 = g + TUNE.hover;
    if (!G.onScreen(x0, h0 + 1.1, y0, TUNE.cull)) return;
    const t0 = performance.now(), z = host.G.cine ? host.G.view.zoom : host.zoom;   // (the cinema camera draws finer: gfx.js setCine)
    tear.set(x0, h0, y0, T, pulse); tear.arm();
    specks.set(x0, g, y0, T, pulse, Math.max(1, Math.round(z))); specks.arm();
    // the ground: the decal (laid before the light: the rift's own light makes it glow)
    G.toScreenInto(x0, g, y0, SV);
    host.glayer('ground').drawImage(decal, Math.round(SV[0] - decal.cx * z) | 0, Math.round(SV[1] - decal.cy * z) | 0, decal.width * z, decal.height * z);
    // the HD glow: soft blobs along the slit (display resolution, depth-faded: gfx.js FX_FS)
    if (hdGlow && G.fx) {
      const GL = TUNE.glow, a = GL.a + GL.aPulse * pulse, H = SIZE.H / PPMH;
      for (let k = 0; k < 3; k++) G.fx(x0, h0 + H * (.27 + k * .23), y0, GL.r, GL.rgb, a, 'add');
      G.fx(x0, h0 + H * .45, y0, GL.wide.r, GL.rgb, GL.wide.a * (1 + pulse), 'add');
    }
    // the shimmer: the air beside the slit pulled a pixel toward it in rows that ripple up (the distort layer)
    if (warp && G.compU?.tDistort) {
      const W = TUNE.warp, q = host.glayer('distort');
      G.toScreenInto(x0, h0, y0, SV);
      const sx = SV[0], sy = SV[1], nb = Math.ceil(SIZE.H / W.rows), bw = Math.round(W.band * z) | 0, hh = Math.round(W.rows * z) | 0;
      for (let b = 1; b < nb; b++) {
        const prof = Math.pow(Math.sin(Math.PI * b / nb), .7);
        if (Math.sin(b * .9 - T * W.speed) < .2 || prof < .2) continue;
        const off = (4.5 * prof + 2.2 + W.gap) * z, yy = Math.round(sy - b * W.rows * z) | 0;
        q.fillStyle = DIST[0]; q.fillRect(Math.round(sx - off) - bw | 0, yy, bw, hh);
        q.fillStyle = DIST[1]; q.fillRect(Math.round(sx + off) | 0, yy, bw, hh);
      }
    }
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };

  // LIGHTS: its violet light, breathing with the pulse
  F.lights = () => {
    if (!active() || !spot) return EMPTY;
    LREC.x = spot.x; LREC.y = spot.y; LREC.h = spot.g + TUNE.hover + L.h; LREC.intensity = L.k + L.kPulse * pulse;
    return LI;
  };
  F.where = () => spot && {x: +spot.x.toFixed(2), y: +spot.y.toFixed(2), g: +spot.g.toFixed(3), clear: +spot.clear.toFixed(2), biome: host.biome?.id};
  F._ = {tear, specks, get spot() { return spot; }, get T() { return T; }, set T(v) { T = v; }, get pulse() { return pulse; }, place, decal};   // (probes)
  return F;
}

// the ground under it, painted once: a world circle of radius r is the same ellipse (r PPM x r PPMY px) at every yaw. The
// ground layer is laid over the ground's colour before the light (so the rift's own light makes it glow at night): a
// scorched centre with cinder flecks, a ring of crystal (three violet tones in clumps), a faint stain round it, each edge
// ragged by a value noise. Hard tones only (no dither, no gradient). -> a canvas with cx, cy (its centre, px)
function paintDecal(r, PPM, PPMY) {
  const rx = r * PPM, ry = r * PPMY, w = Math.ceil(rx) * 2 + 1, h = Math.ceil(ry) * 2 + 1, cx = Math.ceil(rx), cy = Math.ceil(ry);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const q = c.getContext('2d'), img = q.createImageData(w, h), D = img.data;
  const put = (i, hex, a) => { const n = parseInt(hex.slice(1), 16); D[i] = n >> 16 & 255; D[i + 1] = n >> 8 & 255; D[i + 2] = n & 255; D[i + 3] = Math.round(a * 255); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x - cx) / rx, v = (y - cy) / ry, rho = Math.sqrt(u * u + v * v), n = vnoise(x * .13, y * .16, 3), i = (y * w + x) * 4;
    if (rho < .34 + .16 * (n - .5)) put(i, vnoise(x * .3, y * .36, 1) > .7 ? '#2e1c46' : '#140e1e', .52);
    else if (rho < .62 + .18 * (n - .5)) {
      const k = vnoise(x * .24, y * .29, 7);
      put(i, k > .64 ? '#7a3a98' : k > .38 ? '#4a2068' : '#24163a', .5);
    } else if (rho < 1 + .22 * (n - .5) && vnoise(x * .17, y * .2, 11) > .48) put(i, '#2e1c48', .22);
  }
  q.putImageData(img, 0, 0);
  c.cx = cx; c.cy = cy;
  return c;
}
