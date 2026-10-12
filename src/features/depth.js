// DEPTH (3D): near / mid / far depth cues on the HD-2D page. A port of concepts/sprites/arena/depth.js (key 7),
// same art, same TUNE, same rules; everything is anchored in the WORLD so it holds still while the camera turns.
// SHOW ONLY: nothing here changes how the game plays.
//
//   foreground   overhanging branches, vines, broken arch tops (ember: charred branches + chains; frost: snow-laden
//                boughs + icicles; rift: shards / crystal spires) along the world's four borders, drawn near the
//                camera with parallax > 1 in the FRONT layer; they fade when the player is behind them
//   clouds       cloud shadows drifting with the wind aloft over ground and sprites alike, day and dusk, strength from the
//                open sky's sun shadow; 2 hard-edged levels, never a gradient; the cover continuous. A change of weather
//                (sim/env.js TRANSITIONS): its deck over the same cloud field (a front's torn wall, a breaking deck's gaps),
//                lit by env.under where it lies (render/clouds.js, core/cloudfield.js)
//   shafts       slanted additive light bands from the sun's side with dust motes (ADD layer); they turn with the camera
//   reflections  the stream mirrors the Ranger (standing on the bank / a stepping stone, or leaping over it), bushes,
//                tufts, rocks, pots and trees beside it, plus a sky glint, broken up by ripples (GROUND layer: ground
//                pixels only); the ruins puddles mirror the sky, the pillars / dummies and the brazier / torch flames (EMIT)
//   heat haze    shimmer over the ember lava: per-pixel offsets in a DISTORT layer (needs the composite hook described
//                below; without it the haze is computed and skipped)
//
// CONTRACT (main.js FEATURE CONTRACT): export async function create(host) -> F
//   F.name 'depth', F.key '7', F.on (?depth=0 starts off), F.toggle(), F.view(dt), F.frame(f), F.biomeChanged()
//   F.ms        rolling average cost per frame (update + frame, ms)        F.debug   'fg n · shafts n · haze n · refl n'
//   F.TUNE      live tunables (the arena's TUNE + the 3D additions marked 3D)
//   F._dbg      internal state for test scripts (FG, SH, WA, CL, V, PT = per-part ms, proj / inv, the scratch canvases)
// host: toView, layer, yaw, zoom, mood, time, biome, layout, props, itemOf, elev, player, P, playerSprite(), world
//   (items[i].sp / .card, groundCanvas), wind (optional: at(x, y) -> {x, y, g}, dir, gust), ctxO, G (feature detection).
//
// 3D MAPPING (why it is built this way)
//   foreground   SCREEN-SPACE pieces in the front layer, not world cards: the projection is orthographic, so a card in the
//                world can never move faster than the ground; parallax > 1 has to be painted. Each piece keeps the
//                arena's WORLD anchor on a border (N pieces along y = 0, ...), projected with host.toView, and the
//                arena's formula per screen edge: a piece is scaled about the view edge it hangs from / stands on /
//                enters from, and it never comes further in than the arena's clamped camera allowed (min(s, 0)).
//                Which screen edge a border feeds follows the camera: a border whose outward normal points up on
//                screen hangs pieces from the top, down -> rising pieces, sideways -> side pieces (hysteresis at 45°;
//                the swap fades out and in through the same alpha steps as the player fade). At yaw 0 every piece,
//                template, offset and parallax is the arena's (same seeds, same RNG order). The host camera is not
//                clamped to the world like the arena's, so near a border the void beyond it shows; the pieces then
//                sit where the arena's clamped camera would have them (at the view edge), framing that void.
//   clouds       the cloud field in world metres (1 texel = 1/PPM m, like the ground texture), evaluated in the composite at
//                the ground texel under each pixel through the ground plane's world -> view affine: crisp texels, no seams,
//                fixed to the ground at any yaw (?wxtrans=0: the arena's tileable level map, the old way). The PRE layer MIXES toward its colour,
//                so the arena's colour multiply (1 - k (1 - c)) is approximated by mix(alb, c * .45, k) (exact at
//                albedo .45, within ~6 / 255 elsewhere).
//   shafts       feet in the world (pillar gaps, gates, trail tree gaps), the slant = the sun's direction projected for
//                the current yaw (re-rasterised per 1° of yaw), drawn 'lighter' into the ADD layer. With the sun behind
//                the camera a shaft is seen end-on (it would shrink to a bright blob at its foot), so it fades out in
//                quarter steps as its screen length drops below its height in px (gone at 0.35 x).
//   reflections  water = a top-down mask of the stream (spans minus stones / floes / the frost ice shelf) PLUS the plateau's pool and its
//                outflow (river brief D: layout.js POOL / OUTFLOW; the Ranger and the props near them mirror there too, and the sky glint
//                crosses the pool) projected at
//                the stream bed's height (-.18 m) as a pattern fill + screen-space puddle masks. Mirrored sprites go into
//                a view scratch (flipped about their ground contact row, airborne = 2 x height lower), rippled in
//                whole-pixel row bands, clipped, tinted and laid on the GROUND layer at one alpha. Sources: the Ranger
//                (host.playerSprite(), live), painted cards (item.sp) and, for LIVE 3D props (pots, rocks, pillars...),
//                the arena's painted sprite of the same prop (host.biome.sprite) as an approximation: a reflection is
//                small, tinted and rippled, so the painted stand-in reads right at any yaw. The sky glint is additive
//                BEFORE the light in the arena; the GROUND layer mixes, so its pixels are written as ground texel + sky
//                (the world's top-down ground canvas sampled under each pixel): exact.
//   heat haze    needs a distortion of the final image, which no layer can do. HOST CHANGE (gfx.js), 'distort' layer:
//                LAYERS += 'distort'; uniform sampler2D tDistort (layers.distort.t); uniform float uLayD (= layers
//                .distort.used); in COMP_FS main(): ivec2 ip0 = ivec2(gl_FragCoord.xy), ip = ip0; if (uLayD > .5) {
//                vec4 dd = lay(tDistort, ip0); if (dd.a > .5) ip = clamp(ip0 + ivec2(128 - int(dd.r * 255. + .5),
//                int(dd.g * 255. + .5) - 128), ivec2(0), ivec2(uRes) - 1); } and then every G-buffer / ground / pre /
//                emit / x-ray fetch uses ip, post() keeps ip0 (add / front stay put). Encoding (view px, canvas y down):
//                R = 128 + dx, G = 128 + dy, A = 255 where the picture moves by (dx, dy) (the arena's row shift).
//                Until it exists the bands are computed (F.debug says 'no distort layer') and nothing is drawn.
//
// ART RULES (same as the arena): 1 texel = 1 screen px (x zoom), no AA / gradients; 4-tone ramps; the foreground is a
// silhouette layer (2-3 dark tones + a 1 px rim on the sun side), calmer than the character.
import {TAU, clamp, mod, mk, fit, hsh, vn, rng, rgb, css, PAL, SHAFT, WATER, PUDDLES, PUD_COL, KIT, SEED} from './depth/art.js';
import {flags} from '../core/flags.js';
import {coverQ, wrapDrift, PERIOD, FIELD_V2, fieldUniforms, density} from '../core/cloudfield.js';
import {OLD_CLOUDS, CLOUD_SUN, CLOUD_VIEW, SOFT, QUANT_U} from '../render/clouds.js';

const DEG = Math.PI / 180;
// ============================================================ tunables (live: __r3d.features.find(f => f.name === 'depth').TUNE)
const TUNE = {
  fg: {on: false /* off by default: the user found the screen-edge silhouettes didn't look good in 3D (menu / ?fg=1) */, fade: [1, .66, .34], fadeStep: .09, body: [-10, -50, 10, 2], sway: 1, hyst: .12 /* 3D: slot swap hysteresis */},
  clouds: {on: true, tileM: [40, 30], cover: .31, core: .19, s: [.24, .12], time: {day: 1, dusk: .55, night: 0}, speed: 1.9, none: ['rift'],
    sun: [.85, .45] /* render/clouds.js CLOUD_SUN: the share of the sun a cloud takes at its thickest / (the old field) its edge level (the shade is the cast shadows' own: no alphas, no time of day) */,
    mean: .85 /* (the smooth field) a cloud's mean share over its ground (render/clouds.js SOFT: the soft edge, thinner near it): the gaps' sun back */,
    // (render/clouds.js CLOUD_VIEW) the whole view dims as a cloud passes over: its share round the player, the soft edge pen m
    // either side of the cloud's (the sun going in takes a few s: an edge crosses 2 pen at the wind aloft's ~1.3 m/s), averaged with
    // four points spread m away (weight w each), eased over ease s
    view: {pen: 3, spread: 7, w: .15, ease: 1.2},
    mixC: .45 /* 3D: the mix colour = shadow colour x this (approximates the arena's multiply) */,
    // 3D: a front's storm side (rain, snow or storm there): its cover, and how much greyer / darker than the clear side's light
    // it is drawn (x the mood's own difference, sim/env.js mood(): .35 c grey, ambient x (1 - .1 c - .12 rain - .2 storm))
    front: {cover: .94, grey: 1, dark: 1, sun: 1, col: [.92, .95, 1],
      appr: .8 /* the cloud the clear side's shadows thicken to at a front's edge (render/clouds.js: within env.front.appr m) */,
      viz: null /* dev: [r, g, b] tints the deck in that colour (its shape, in the old composite) */}},
  shafts: {on: true, max: 5, lenMax: 120, el: [38, 62], time: {day: .85, dusk: 1, night: .5}, night: ['frost', 'rift'], motes: 9, yawStep: 1 /* 3D: deg */},
  refl: {on: true, alpha: .6, tint: .38, ripple: 1, reach: 2.5, glowDim: .5, bed: -.18 /* 3D: the stream bed's height (m) = world.waterH */,
    height: 6 /* 3D: how tall a thing still mirrors whole (m over the water): how far up the GPU searches */},
  haze: {on: true},
};

// ORDER (core/features.js): clouds and shafts move with this step's wind
export const order = {after: ['wind']};
export async function create(host) {
  const Q = flags;
  const {PPM, PPMY, PPMH} = host;
  let {VW, VH} = host;   // the view size: F.resize follows the window
  const F = {name: 'depth', label: 'Depth (foreground, clouds, shafts, reflections)', key: '7', ambient: true,  on: Q.get('depth') !== '0', ms: 0, TUNE, debug: ''};
  if (Q.get('fg') === '1') TUNE.fg.on = true;
  F.settings = () => [{label: 'Foreground silhouettes', options: ['off', 'on'], get: () => TUNE.fg.on ? 'on' : 'off', set: v => { TUNE.fg.on = v === 'on'; }}];
  let T = 0, biome = '', acc = 0;
  const hist = new Float32Array(60); let hN = 0;
  const WM = () => host.ctxO.WM, HM = () => host.ctxO.HM;
  const timeName = () => host.time || 'day';
  const WAT = {x: 0, y: 0, g: 0}, windAt = (x, y) => { const W = host.wind; return (W && W.on !== false && W.at) ? W.at(x, y, WAT) : null; };   // (one scratch result: read at once)
  const windDir = () => host.wind?.dir || [.94, .34];
  const gustNow = () => { const W = host.wind; return (W && W.on !== false && W.gust) || 0; };

  // ================================================================ the view this frame: the ground plane's affine
  // screen = O + X * x + Y * y + Hv * h (view px, zoom included); inv() solves it back at a given height
  const V = {yaw: 0, z: 1, c: 1, s: 0, ox: 0, oy: 0, xx: 0, xy: 0, yx: 0, yy: 0, hx: 0, hy: 0, det: 1};
  function beginView() {
    V.yaw = host.yaw; V.z = host.zoom || 1; V.c = Math.cos(V.yaw); V.s = Math.sin(V.yaw);
    const o = host.toView(0, 0, 0), ex = host.toView(1, 0, 0), ey = host.toView(0, 1, 0), eh = host.toView(0, 0, 1);
    V.ox = o[0]; V.oy = o[1]; V.xx = ex[0] - o[0]; V.xy = ex[1] - o[1]; V.yx = ey[0] - o[0]; V.yy = ey[1] - o[1]; V.hx = eh[0] - o[0]; V.hy = eh[1] - o[1];
    V.det = V.xx * V.yy - V.yx * V.xy;
  }
  const proj = (x, y, h = 0) => [V.ox + V.xx * x + V.yx * y + V.hx * h, V.oy + V.xy * x + V.yy * y + V.hy * h];
  const _pa = [0, 0], _pb = [0, 0], _pu = [0, 0], _pr = [0, 0], _pp = [0, 0];   // the same through scratch arrays (no allocation): proj2 / inv2 write into `o`
  const proj2 = (x, y, h, o) => { o[0] = V.ox + V.xx * x + V.yx * y + V.hx * h; o[1] = V.oy + V.xy * x + V.yy * y + V.hy * h; return o; };
  const inv2 = (X, Y, h, o) => { const u = X - V.ox - V.hx * h, v = Y - V.oy - V.hy * h; o[0] = (V.yy * u - V.yx * v) / V.det; o[1] = (-V.xy * u + V.xx * v) / V.det; return o; };
  const inv = (X, Y, h = 0) => { const u = X - V.ox - V.hx * h, v = Y - V.oy - V.hy * h; return [(V.yy * u - V.yx * v) / V.det, (-V.xy * u + V.xx * v) / V.det]; };
  // a top-down canvas (R texels per metre, its texel (0, 0) at world (x0, y0)) -> view px, as a DOMMatrix for a pattern
  const groundMatrix = (R, h, x0 = 0, y0 = 0) => { const [e, f] = proj(x0, y0, h); return new DOMMatrix([V.xx / R, V.xy / R, V.yx / R, V.yy / R, e, f]); };
  // its 2 x 2 part inverted, into out [4]: view px (from the plane's origin) -> texel (gfx.js COMP_FS viewTexel)
  const groundInv = (R, out) => { const a = V.xx / R, b = V.xy / R, c = V.yx / R, d = V.yy / R, det = a * d - b * c; out[0] = d / det; out[1] = -c / det; out[2] = -b / det; out[3] = a / det; return out; };
  const FPA = {x0: 0, y0: 0, x1: 0, y1: 0}, FPB = {x0: 0, y0: 0, x1: 0, y1: 0}, FPC = {x0: 0, y0: 0, x1: 0, y1: 0}, _pf = [0, 0];
  function footprint(h, out) {   // the view's world AABB at height h, into out (one of FPA..FPC: kept, no object a call)
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let k = 0; k < 4; k++) { inv2(k & 1 ? VW : 0, k & 2 ? VH : 0, h, _pf); const x = _pf[0], y = _pf[1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    out.x0 = x0; out.y0 = y0; out.x1 = x1; out.y1 = y1; return out;
  }

  // ================================================================ FOREGROUND
  // pieces: the arena's (same seeds, same RNG order) on their home border, + a variant for each other screen edge
  const FG = {biome: '', pieces: [], tpls: [], cache: {}, slot: {N: 'N', S: 'S', W: 'W', E: 'E'}};
  const NORMAL = {N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0]};
  const CLASS = s => s === 'N' ? 'N' : s === 'S' ? 'S' : 'side';
  const DMAX = {N: 8, S: 12, side: 10};
  function buildPieces() {
    const K = KIT[biome], tpls = [], pieces = [];
    if (!K) return {tpls, pieces};
    const r = rng(SEED[biome] || 3), mkT = (e, i, j) => { const [fn, sway, amp, exp, par] = e, S = fn(SEED[biome] * 101 + i * 17 + j * 5); const t = {S, sway, amp, exp, par, mir: null, cvs: new Map()}; tpls.push(t); return t; };
    const lists = {N: K.N.map((e, i) => [mkT(e, i, 1), mkT(e, i, 2)]).flat(), S: K.S.map((e, i) => [mkT(e, i + 10, 1), mkT(e, i + 10, 2)]).flat(), side: K.side.map((e, i) => [mkT(e, i + 20, 1), mkT(e, i + 20, 2)]).flat()};
    const wb = host.ctxO.bounds;   // the world's borders (a bigger world's own, not the Proving Grounds')
    for (const edge of ['N', 'S']) {   // the arena's loop, verbatim RNG order: pick, mir, d, par, ph, spacing
      let x = wb.x0 + 1 + r() * 3, i = 0;
      while (x < wb.x1 - 1) {
        const t = lists[edge][(i * 3 + (r() * 2 | 0)) % lists[edge].length];
        const home = {tpl: t, mir: r() < .5, d: Math.round(r() * (edge === 'N' ? 8 : 12)), par: t.par + (r() - .5) * .08};
        pieces.push({border: edge, along: x, var: {[edge]: home}, ph: r() * TAU, k: 0, ft: 0, want: 0, slot: edge, next: edge, vis: false});
        x += 3.2 + r() * 2.8; i++;
      }
    }
    for (const edge of ['W', 'E']) {
      let y = wb.y0 + 1.5 + r() * 3, i = 0;
      while (y < wb.y1 - 1) {
        const t = lists.side[(i + (r() * 2 | 0)) % lists.side.length];
        const home = {tpl: t, mir: edge === 'E', d: Math.round(r() * 10), par: t.par + (r() - .5) * .08};
        pieces.push({border: edge, along: y, var: {side: home}, ph: r() * TAU, k: 0, ft: 0, want: 0, slot: edge, next: edge, vis: false});
        y += 3.8 + r() * 2.8; i++;
      }
    }
    const r2 = rng((SEED[biome] || 3) * 7919 + 5);   // the variants for the other screen edges (turned camera)
    for (const pc of pieces) for (const cl of ['N', 'S', 'side']) {
      if (pc.var[cl]) continue;
      const L = lists[cl], t = L[(r2() * L.length) | 0];
      pc.var[cl] = {tpl: t, mir: r2() < .5, d: Math.round(r2() * DMAX[cl]), par: t.par + (r2() - .5) * .08};
    }
    return {tpls, pieces};
  }
  // colour a tone map for the current mood: body x amb, rim x (amb + sun) on the sun side and on top (the arena's)
  function colour(S, pal, side, tint, rimT, attach) {
    const [c, q] = mk(S.w, S.h), im = q.createImageData(S.w, S.h), d = im.data, {w, h, m, t} = S;
    const empty = (x, y) => y < 0 ? attach !== 'N' : x < 0 ? attach !== 'W' : x >= w ? attach !== 'E' : y >= h ? attach !== 'S' : !m[y * w + x];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, mm = m[i]; if (!mm) continue;
      const P = pal[mm] || Object.values(pal)[0], rim = t[i] === 3 || empty(x, y - 1) || (side && empty(x + side, y));
      const col = rim ? P[2] : P[t[i] === 2 ? 1 : 0], k = rim ? rimT : tint;
      d[i * 4] = col[0] * k[0]; d[i * 4 + 1] = col[1] * k[1]; d[i * 4 + 2] = col[2] * k[2]; d[i * 4 + 3] = 255;
    }
    q.putImageData(im, 0, 0); return c;
  }
  let FGcol = null;   // {key, pal, side, tint, rimT}
  function fgColours() {
    const M = host.mood, tn = timeName(), az = M ? M.sun.az : 0;
    const sx = M ? Math.sin((az * DEG) + V.yaw) : -.8;   // the sun's screen-x: sin(az + yaw) (arena: sin(az) at yaw 0)
    const side = sx < -.25 ? -1 : sx > .25 ? 1 : 0, key = biome + '|' + tn + '|' + az + '|' + side;
    if (FGcol?.key === key) return FGcol;
    const amb = M ? M.amb : [1, 1, 1], sc = M ? M.sun.c : [1, 1, 1], night = tn === 'night';
    return (FGcol = {key, side, pal: PAL[biome] || PAL.ruins, tint: amb.map(v => Math.min(1.05, v)), rimT: amb.map((v, i) => Math.min(1.1, v * .45 + sc[i] * .55 * (night ? .7 : 1)))});
  }
  function cvOf(v, slot) {   // the piece's coloured canvas for this slot (lazy, cached per mood key)
    const C = fgColours(), t = v.tpl, mir = CLASS(slot) === 'side' ? slot === 'E' : v.mir, ck = slot + (mir ? 1 : 0) + C.key;
    let e = t.cvs.get(ck);   // (kept per mood + sun side: turning the camera back and forth never repaints)
    if (!e) {
      const S = mir ? (t.mir ||= t.S.mirror()) : t.S;
      e = {cv: colour(S, C.pal, C.side, C.tint, C.rimT, slot), S}; t.cvs.set(ck, e);
      if (t.cvs.size > 8) t.cvs.delete(t.cvs.keys().next().value);   // a few per template (oldest out)
    }
    return e;
  }
  function ensureFG() {
    if (FG.biome === biome) return;
    const c = FG.cache[biome] || (FG.cache[biome] = buildPieces());
    FG.biome = biome; FG.pieces = c.pieces; FG.tpls = c.tpls;
  }
  // which screen edge a border feeds: its outward normal on screen (x: n . right, y: n . toward-camera)
  function slotOf(border, cur) {
    const [nx, ny] = NORMAL[border], a = nx * V.c - ny * V.s, b = nx * V.s + ny * V.c, H = TUNE.fg.hyst;
    const vert = CLASS(cur) === 'side' ? Math.abs(b) > Math.abs(a) + H : Math.abs(b) + H >= Math.abs(a);
    return vert ? (b < 0 ? 'N' : 'S') : (a > 0 ? 'E' : 'W');
  }
  function playerBox() {
    const p = host.player, b = TUNE.fg.body, z = V.z, [sx, sy] = host.toView(p.x, p.y, p.z), x = Math.round(sx), y = Math.round(sy);
    return [x + b[0] * z, y + b[1] * z, x + b[2] * z, y + b[3] * z];
  }
  function covers(S, X, Y, z, pb) {
    const x0 = Math.max(X, pb[0]), y0 = Math.max(Y, pb[1]), x1 = Math.min(X + S.w * z, pb[2]), y1 = Math.min(Y + S.h * z, pb[3]);
    if (x0 >= x1 || y0 >= y1) return false;
    const st = 2 * z;
    for (let y = y0; y < y1; y += st) for (let x = x0; x < x1; x += st) if (S.m[Math.floor((y - Y) / z) * S.w + Math.floor((x - X) / z)]) return true;
    return false;
  }
  function anchorOf(pc) {   // world anchor on the border + the point 1 m inside (wind sample)
    const wb = host.ctxO.bounds;
    switch (pc.border) {
      case 'N': return [pc.along, wb.y0, pc.along, wb.y0 + 1];
      case 'S': return [pc.along, wb.y1, pc.along, wb.y1 - 1];
      case 'W': return [wb.x0, pc.along, wb.x0 + 1, pc.along];
      default: return [wb.x1, pc.along, wb.x1 - 1, pc.along];
    }
  }
  function drawFG(q) {
    ensureFG();
    const z = V.z, A = TUNE.fg.fade, pb = playerBox(), list = [];
    for (const b of ['N', 'S', 'W', 'E']) FG.slot[b] = slotOf(b, FG.slot[b]);
    for (const pc of FG.pieces) {
      pc.next = FG.slot[pc.border];
      let swapped = false;   // off screen: swap at once (and fade in if the swap brings it on screen)
      if (!pc.vis && pc.slot !== pc.next) { pc.slot = pc.next; swapped = true; }
      const slot = pc.slot, v = pc.var[CLASS(slot)], e = cvOf(v, slot), cv = e.cv, w = cv.width * z, h = cv.height * z;
      const [ax, ay] = anchorOf(pc), [sx, sy] = proj(ax, ay, 0), par = v.par, d = v.d * z;
      let X, Y;
      if (slot === 'N' || slot === 'S') {
        X = (sx - VW / 2) * par + VW / 2 - w / 2;
        Y = slot === 'N' ? Math.min(sy, 0) * par - d : VH + d + Math.max(sy - VH, 0) * par - h;
      } else {
        Y = (sy - VH / 2) * par + VH / 2 - h / 2;
        X = slot === 'W' ? Math.min(sx, 0) * par - d : VW + d + Math.max(sx - VW, 0) * par - w;
      }
      if (v.tpl.sway === 'bob') Y += Math.sin(T * .55 + pc.ph) * v.tpl.amp * z;
      X = Math.round(X); Y = Math.round(Y);
      if (X >= VW || Y >= VH || X + w <= 0 || Y + h <= 0) { pc.vis = false; pc.k = 0; pc.slot = pc.next; continue; }
      pc.vis = true; if (swapped) pc.k = 3;
      pc.want = covers(e.S, X, Y, z, pb) ? 2 : 0;
      list.push({pc, v, cv, X, Y});
    }
    list.sort((a, b) => a.v.par - b.v.par);   // nearer (faster) pieces on top
    for (const {pc, v, cv, X, Y} of list) {
      const t = v.tpl, alpha = A[pc.k] ?? 0; if (alpha <= 0) continue;
      q.globalAlpha = alpha;
      const w = cv.width, h = cv.height;
      // sway: whole-pixel bands, the free end moving most (wind at the piece's anchor, else a slow idle breeze)
      let amp = 0;
      if (t.sway && t.sway !== 'bob' && TUNE.fg.sway) {
        const [, , wx, wy] = anchorOf(pc), W = windAt(wx, wy), gust = W ? W.g || 0 : 0, wv = W ? W.x * V.c - W.y * V.s : 0;   // the wind's screen-x
        amp = clamp(wv * .45 + Math.sin(T * (1.1 + gust) + pc.ph) * (.75 + gust * 1.2) + gust * .8 * Math.sign(wv || 1), -1, 1) * t.amp * TUNE.fg.sway;
      }
      if (!amp) { q.drawImage(cv, X, Y, w * z, h * z); continue; }
      if (t.sway === 'side') {   // column bands, the far end bobbing
        const far = pc.slot === 'E' ? 0 : w, off = c => Math.round(amp * .8 * Math.pow(Math.abs(c - (w - far)) / w, t.exp));
        let c0 = 0, o0 = off(0);
        for (let c = 1; c <= w; c++) { const o = c < w ? off(c) : NaN; if (o !== o0) { q.drawImage(cv, c0, 0, c - c0, h, X + c0 * z, Y + o0 * z, (c - c0) * z, h * z); c0 = c; o0 = o; } }
      } else {
        const off = t.sway === 'hang' ? r => Math.round(amp * Math.pow(r / h, t.exp)) : r => Math.round(amp * Math.pow(1 - r / h, t.exp));
        let r0 = 0, o0 = off(0);
        for (let r = 1; r <= h; r++) { const o = r < h ? off(r) : NaN; if (o !== o0) { q.drawImage(cv, 0, r0, w, r - r0, X + o0 * z, Y + r0 * z, w * z, (r - r0) * z); r0 = r; o0 = o; } }
      }
    }
    q.globalAlpha = 1;
    return list.length;
  }
  function stepFG(dt) {
    for (const pc of FG.pieces) {
      if (!pc.vis) continue;
      const target = pc.slot !== pc.next ? 3 : pc.want;   // a slot swap fades out (3 = gone), swaps, fades back in
      if (pc.k === target) { if (pc.k === 3) pc.slot = pc.next; pc.ft = 0; continue; }
      if ((pc.ft += dt) >= TUNE.fg.fadeStep) { pc.ft = 0; pc.k += target > pc.k ? 1 : -1; }
    }
  }

  // ================================================================ CLOUD SHADOWS
  const CL = {R: 0, val: null, H: null, noise: null, TW: 0, TH: 0, x: 0, y: 0, thr: new Map()};
  function buildCloudLevels() {   // the arena's noise field, in world metres (tile 40 x 30 m, 1 texel = 1 / PPM m)
    const R = PPM, [TWm, THm] = TUNE.clouds.tileM, TW = Math.round(TWm * R), TH = Math.round(THm * R);
    const oct = [[3, 2, .56], [7, 5, .29], [15, 11, .15]].map(([nx, ny, w], k) => ({nx, ny, w, v: Float32Array.from({length: nx * ny}, (_, i) => hsh(i, k, 404))}));
    const val = new Float32Array(TW * TH), H = new Uint32Array(1024);
    const sm = t => t * t * (3 - 2 * t);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      let v = 0;
      for (const o of oct) {
        const fx = x / TW * o.nx, fy = y / TH * o.ny, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
        const x0 = ix % o.nx, x1 = (ix + 1) % o.nx, y0 = (iy % o.ny) * o.nx, y1 = ((iy + 1) % o.ny) * o.nx, Vv = o.v;
        v += o.w * ((Vv[y0 + x0] * (1 - tx) + Vv[y0 + x1] * tx) * (1 - ty) + (Vv[y1 + x0] * (1 - tx) + Vv[y1 + x1] * tx) * ty);
      }
      val[y * TW + x] = v; H[Math.min(1023, v * 1024 | 0)]++;
    }
    // the field as bins of 1 / 1024 for the GPU (render/clouds.js): / 4 in the first TH rows, the last 2 bits in the next TH
    // (a byte texture). A texel is cloud where its bin reaches a threshold: the bins taken from val, as the old CPU levels were
    const noise = new Uint8Array(TW * TH * 2);
    for (let i = 0; i < TW * TH; i++) { const b = Math.min(1023, Math.floor(val[i] * 1024)); noise[i] = b >> 2; noise[TW * TH + i] = b & 3; }
    Object.assign(CL, {R, val, H, noise, TW, TH}); CL.thr.clear();
  }
  // the levels' thresholds for a cover fraction: the bins (0..1024) at which a texel is cloud (edge) / thick cloud (core): the
  // histogram's quantiles, the same cut the old CPU level map made (a few per cover, cached: a cover is in 1/16ths or a front's)
  function thresholds(cover) {
    let t = CL.thr.get(cover); if (t) return t;
    const {val, H} = CL, core = cover * TUNE.clouds.core / TUNE.clouds.cover;
    const qf = f => { let n = 0; const want = val.length * (1 - f); for (let i = 0; i < 1024; i++) { n += H[i]; if (n >= want) return i + 1; } return 1024; };
    CL.thr.set(cover, t = [qf(cover), qf(core)]);
    return t;
  }
  // the sky's cover from the world clock (sim/env.js light.cloud: the view's sky; clear = no cloud shadows, more as it clouds
  // over; the shadows themselves soften as the sun does under an overcast sky), quantised to 1/16; the old fixed cover without
  // a clock. A front's sides: their own cloud's, the storm side's raised to TUNE.clouds.front.cover
  const coverOf = c => c < .08 ? 0 : Math.round(Math.min(.78, .08 + .62 * c) * 16) / 16;
  const coverNow = () => { const E = host.env; return E ? coverOf(E.light.cloud) : TUNE.clouds.cover; };
  const sideCover = (ch, storm) => storm && ch.rain + ch.snow + ch.storm > .3 ? Math.max(coverOf(ch.cloud), TUNE.clouds.front.cover) : coverOf(ch.cloud);
  // the cloud shadows for gfx.js COMP_FS (G.setClouds): the noise (uploaded once), the thresholds, its colour and two alphas, and
  // the ground plane's view -> texel affine with the drift; a front's edge, sides and storm look. The map used to be painted into
  // an RGBA tile and laid over the view as a pattern fill into the PRE layer every frame (and that layer uploaded); the shader
  // samples the same texel
  const CLS = {lv: null, TW: 0, TH: 0, ver: 0, col: [0, 0, 0], a1: 0, a2: 0, T: [1024, 1024, 1024, 1024], Q: [1024, 1024, 1024, 1024], m: [0, 0, 0, 0], e: 0, f: 0, front: null,
    fr: {dir: null, s: 0, band: null, bend: [0, 0, 0], storm: 0, arrive: true, grey: [1, 1, 1], greyK: 0, darkK: 0, sunK: 0}};
  const ambK = c => 1 - .1 * c.cloud - .12 * c.rain - .2 * c.storm;   // (sim/env.js mood(): the weather's share of the ambient)
  // THE CLOUD FIELD (render/clouds.js, core/cloudfield.js; ?wxtrans=0: drawCloudsOld below). env owns the field's drift (the sim:
  // env.aloft.o, so its rain stops in the same gaps that are drawn); the view follows it smoothly between the sim's steps:
  // its own copy moves at the layers' velocities every frame and is pulled onto the sim's (while the sim runs). Behind the
  // pause menu the clouds drift on until they are 25 m ahead of the sim's, then hold; back in play they are caught up at
  // most 2 m/s faster or slower (no jump; only 40 m off, a clock or teleport, at once). The cover is continuous (the quantiles: no steps); the
  // shadows' strength is the OPEN sky's sun shadow (the mood is the view's mean light); the deck (env.deck) and a front's
  // edge (env.front) go to the shader as they are. The old composite's storm look (uFrK, uFrS) is the deck against the
  // view's mean light: it can only darken the deck, not brighten the gaps (render/lighting.js + gfx.js light each pixel
  // from env.open / env.under once they read cloudAt().y)
  const DUMMY = new Uint8Array(1), OV = new Float64Array(6), OE = new Float64Array(6), OR = new Float64Array(6), RQ = (v, R) => Math.round(v * R) / R;
  const CLV = {rt: 0, st: -1, stRt: -1, init: false, g: 0, gInit: false};
  const coverOfN = c => c <= 0 ? 0 : c < .13 ? c / .13 * .1606 : Math.min(.78, .08 + .62 * c);   // (continuous: the old curve, from 0)
  const CLU = {uClD: [0, 0, 0, 0], uClW: [0, 0, 0, 0], uDk: [0, 0, 0, 0], uFrE: [0, 0, 0, 0], uClQa: QUANT_U[0], uClQb: QUANT_U[1], uClQc: QUANT_U[2],
    uCfA: [0, 0, 0, 0], uCfB: [0, 0, 0, 0], uCfC: [0, 0, 0, 0], uCfD: [0, 0, 0, 0]};
  function driftClouds(dt) {
    const AL = host.env?.aloft; if (!AL) return;
    CLV.rt += dt;
    if (!CLV.init) { CLV.init = true; OV.set(AL.o); }
    if (AL.t !== CLV.st) { CLV.st = AL.t; CLV.stRt = CLV.rt; }   // (the sim stepped)
    const live = CLV.rt - CLV.stRt < .1;   // (the sim runs: not paused, not held)
    let m = 0;
    for (let i = 0; i < 6; i++) { const P = PERIOD[i >> 1], e = AL.o[i] - OV[i]; OE[i] = P ? e - Math.round(e / P) * P : e; m = Math.max(m, Math.abs(OE[i])); }   // (P 0: that pair never wraps)
    if (live && m > 40) OV.set(AL.o);
    else {
      const go = live || m < 25 ? dt : 0, c = live ? Math.min(1, 3 * dt) : 0;
      for (let i = 0; i < 6; i++) OV[i] += AL.vel[i] * go + clamp(OE[i] * c, -2 * dt, 2 * dt);
    }
    wrapDrift(OV);
  }
  // (CLOUD_VIEW) the view's cloud share: the field's soft share (render/clouds.js SOFT, its slope by differences) round the player,
  // at the view's own drift (OV), eased; CLS.g goes to the composite as uCl.w
  const VP = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  function shareAt(x, y, th, pen) {
    const d = density(x, y, OV), h = .25, gx = (density(x + h, y, OV) - density(x - h, y, OV)) / (2 * h), gy = (density(x, y + h, OV) - density(x, y - h, OV)) / (2 * h);
    const e = d - th, t = clamp((e / Math.max(1e-5, Math.hypot(gx, gy)) + pen) / (2 * pen), 0, 1), k = clamp(e / SOFT.full, 0, 1);
    return t * t * (3 - 2 * t) * (SOFT.edge + (1 - SOFT.edge) * k * k * (3 - 2 * k) * (1 - SOFT.thin / 2));
  }
  function viewShare(dt) {
    const E = host.env, p = host.player; if (!CLOUD_VIEW || !E || !p) return;
    const V = TUNE.clouds.view, cO = coverOfN(E.open.cloud);
    let c = 0;
    if (cO > 0) { const th = coverQ(cO); for (let i = 0; i < 5; i++) c += (i ? V.w : 1 - 4 * V.w) * shareAt(p.x + VP[i][0] * V.spread, p.y + VP[i][1] * V.spread, th, V.pen); }
    CLV.g = CLV.gInit ? CLV.g + (c - CLV.g) * (1 - Math.exp(-dt / V.ease)) : c; CLV.gInit = true;
  }
  function drawClouds() {
    if (OLD_CLOUDS) return drawCloudsOld();
    const E = host.env; if (!host.G.setClouds || !E || !E.aloft || TUNE.clouds.none.includes(biome)) return false;
    const tn = timeName(), k = TUNE.clouds.time[tn] ?? 0, M = host.mood, O = E.open, L = E.light, Un = E.under, dk = E.deck, Fr = E.front;
    let a = M ? M.shadow.a : 0;
    if (O.cloud !== L.cloud) a = a / Math.max(.2, 1 - .8 * L.cloud) * (1 - .8 * O.cloud);   // (mood(): the shadow x (1 - .8 c); the open sky's)
    const s = Math.min(1.2, a / .46) * k, cO = coverOfN(O.cloud), deck = dk.mode > 0;
    if (!deck && (s <= .01 || cO <= 0)) return false;
    if (CLS.lv !== DUMMY) { CLS.lv = DUMMY; CLS.TW = 1; CLS.TH = 1; CLS.ver++; }   // (no tile: one texel for tTop's cloud rows)
    const cr = TUNE.clouds.core / TUNE.clouds.cover, cA = coverOfN(Math.max(O.cloud, TUNE.clouds.front.appr));
    CLS.T[0] = coverQ(cO); CLS.T[1] = coverQ(cO * cr); CLS.T[2] = coverQ(cA); CLS.T[3] = coverQ(cA * cr);
    const R = PPM, U = CLS.u = CLU;
    U.uClD[0] = RQ(OV[0], R); U.uClD[1] = RQ(OV[1], R); U.uClD[2] = RQ(OV[2], R); U.uClD[3] = RQ(OV[3], R);   // (whole texels: the shadows step, never shimmer)
    U.uClW[0] = RQ(OV[4], R); U.uClW[1] = RQ(OV[5], R); U.uClW[3] = R;
    if (FIELD_V2) { OR[0] = RQ(OV[0], R); OR[1] = RQ(OV[1], R); OR[2] = OV[2]; fieldUniforms(OR, U); }   // (the smooth field: each noise's offset, from the drift in whole texels)
    U.uDk[0] = dk.mode; U.uDk[1] = dk.q; U.uDk[2] = dk.rim;   // (photo mode's preview: as env says (a previewed weather: none))
    CLS.front = null;
    if (U.uDk[0] > 0) {   // the deck: a front's edge (mode 2) and the old composite's look of it against the view's mean light
      const f = CLS.fr, FT = TUNE.clouds.front;
      f.dir = Fr.dir; f.s = Fr.s; f.band = Fr.band; f.bend[0] = Fr.bend[0]; f.bend[1] = Fr.bend[1]; f.bend[2] = Fr.bend[2];
      U.uFrE[0] = Fr.bend[3]; U.uFrE[1] = Fr.bend[4]; U.uFrE[2] = Fr.bend[5]; U.uFrE[3] = Fr.appr;
      f.storm = Fr.storm; f.arrive = true; f.grey = FT.col;
      f.greyK = Math.min(1, .35 * Math.max(0, Un.cloud - L.cloud) * FT.grey); f.darkK = Math.min(.8, Math.max(0, 1 - ambK(Un) / ambK(L)) * FT.dark);
      f.sunK = Math.min(1, Math.max(0, 1 - (1 - .55 * Un.cloud) / (1 - .55 * L.cloud)) * FT.sun);
      if (FT.viz) { f.greyK = 1; f.darkK = .25; f.grey = FT.viz; }   // (dev: the deck tinted, to see its shape in the old composite)
      CLS.front = f;
    }
    const c = M.shadow.c, mx = TUNE.clouds.mixC;
    for (let i = 0; i < 3; i++) CLS.col[i] = Math.round(255 * c[i] * mx) / 255;
    CLS.a1 = Math.round(255 * TUNE.clouds.s[1] * s) / 255; CLS.a2 = Math.round(255 * TUNE.clouds.s[0] * s) / 255;
    // (CLOUD_SUN: the levels take the sun; the mood dims the open sky's by its whole cloud (sim/env.js mood: shadow x (1 - .8 c)),
    // so the gaps get back the share the patches now carry: the view's mean sun stays the mood's. render/lighting.js applies it)
    CLS.gap = 1; CLS.g = CLOUD_VIEW ? CLV.g : 0;
    if (CLOUD_SUN) { const S = TUNE.clouds.sun; CLS.a1 = S[1]; CLS.a2 = S[0]; CLS.gap = 1 / (1 - cO * (FIELD_V2 ? S[0] * TUNE.clouds.mean : (1 - cr) * S[1] + cr * S[0])); }
    proj2(0, 0, 0, _pp); groundInv(R, CLS.m); CLS.e = _pp[0]; CLS.f = _pp[1];   // (the world's texel grid: the drift is the layers')
    host.G.setClouds(CLS);
    return true;
  }
  function drawCloudsOld() {
    if (!host.G.setClouds) return false;
    const E = host.env, Fr = E && E.front && E.front.on && !E.previewing ? E.front : null;
    const tn = timeName(), k = (TUNE.clouds.time[tn] ?? 0) * (TUNE.clouds.none.includes(biome) ? 0 : 1), M = host.mood;
    const St = Fr && (Fr.arrive ? Fr.B : Fr.A), cA = Fr ? sideCover(Fr.A, Fr.A === St) : coverNow(), cB = Fr ? sideCover(Fr.B, Fr.B === St) : cA;
    const a = M ? M.shadow.a : 0, s = Math.min(1.2, a / .46) * k;
    if (s <= .01 || cA + cB <= 0) return false;
    if (!CL.val) buildCloudLevels();
    if (CLS.lv !== CL.noise) { CLS.lv = CL.noise; CLS.TW = CL.TW; CLS.TH = CL.TH; CLS.ver++; for (let i = 0; i < 4; i++) CLS.Q[i] = thresholds((i + 1) / 5)[0]; }   // (the quantiles a front's storm tears by)
    const tA = thresholds(cA), tB = thresholds(cB); CLS.T[0] = tA[0]; CLS.T[1] = tA[1]; CLS.T[2] = tB[0]; CLS.T[3] = tB[1];
    CLS.front = null;
    if (Fr) {   // the front: its edge, and its storm side against the light (the clear side's while it shows)
      const T = E.TUNE.front, f = CLS.fr, Cl = Fr.arrive ? Fr.A : Fr.B, FT = TUNE.clouds.front, dc = Math.max(0, St.cloud - Cl.cloud);
      f.dir = Fr.dir; f.s = Fr.s; f.band = T.band; f.bend[0] = T.wobble[0]; f.bend[1] = 2 * Math.PI / T.wobble[1]; f.bend[2] = Fr.wob;
      f.storm = Fr.storm; f.arrive = Fr.arrive; f.grey = FT.col;
      f.greyK = Math.min(1, .35 * dc * FT.grey); f.darkK = Math.min(.8, Math.max(0, 1 - ambK(St) / ambK(Cl)) * FT.dark);
      f.sunK = Math.min(1, Math.max(0, 1 - (1 - .55 * St.cloud) / (1 - .55 * Cl.cloud)) * FT.sun);   // (mood(): the sun's strength x (1 - .55 c))
      const v = 1 - Fr.storm; f.greyK *= v; f.darkK *= v; f.sunK *= v;   // (cloudAt().y is the storm's mask now: the part the light doesn't carry)
      CLS.front = f;
    }
    const c = M.shadow.c, mx = TUNE.clouds.mixC, R = CL.R;
    for (let i = 0; i < 3; i++) CLS.col[i] = Math.round(255 * c[i] * mx) / 255;
    CLS.a1 = Math.round(255 * TUNE.clouds.s[1] * s) / 255; CLS.a2 = Math.round(255 * TUNE.clouds.s[0] * s) / 255;
    const ox = Math.round(CL.x * R) / R, oy = Math.round(CL.y * R) / R;   // whole texels: the shadows step, never shimmer
    proj2(ox, oy, 0, _pp); groundInv(R, CLS.m); CLS.e = _pp[0]; CLS.f = _pp[1];
    host.G.setClouds(CLS);
    return true;
  }

  // ================================================================ LIGHT SHAFTS + MOTES
  const SH = {feet: null, key: '', col: null};
  function shaftFeet() {   // the arena's, verbatim (world metres)
    const out = [], r = rng(77), props = host.props || [], P = host.ctxO.PLAY, cx = (P.x0 + P.x1) / 2, cy = (P.y0 + P.y1) / 2;
    const pil = props.filter(p => p.kind === 'pillar' || p.kind === 'pillar_broken');
    for (let i = 0; i < pil.length; i++) for (let j = i + 1; j < pil.length; j++) {
      const a = pil[i], b = pil[j], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 1.8 || d > 3.1) continue;
      out.push({x: (a.x + b.x) / 2 + .35, y: (a.y + b.y) / 2 + .45, H: 2.2 + r() * 1, w: 5 + (r() * 7 | 0)});
    }
    out.push({x: P.x0 + 1.1, y: cy + .35, H: 3.2, w: 12}, {x: P.x0 + .9, y: cy - .9, H: 2.8, w: 6});
    out.push({x: cx + .7, y: P.y0 + 1.1, H: 3, w: 11});
    const TR = host.layout?.trail, trees = props.filter(p => p.kind === 'tree' && TR);
    const near = t => t.x > TR.x0 - 4 && t.x < TR.x1 + 4 && t.y > TR.y0 - 4 && t.y < TR.y1 + 4;
    const cand = trees.filter(near);
    for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
      const a = cand[i], b = cand[j], d = Math.hypot(a.x - b.x, a.y - b.y); if (d < 2.2 || d > 7) continue;
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2 + .6; if (out.some(f => Math.hypot(f.x - x, f.y - y) < 2.5)) continue;
      out.push({x: clamp(x, TR.x0 + .5, TR.x1 - .5), y: clamp(y, TR.y0 + .3, TR.y1 - .3), H: 3 + r() * 1, w: 6 + (r() * 8 | 0)});
    }
    const lone = props.find(p => p.kind === 'tree' && p.z > 0); if (lone) out.push({x: lone.x - 1.6, y: lone.y + 1.4, H: 3.4, w: 9});
    for (const f of out) { f.z = host.elev ? host.elev(f.x, f.y) : 0; f.ph = r() * TAU; f.motes = Array.from({length: TUNE.shafts.motes}, () => ({a: r(), c: r() * 2 - 1, va: .01 + r() * .03, ph: r() * TAU, tw: .8 + r() * 1.6})); }
    return out;
  }
  // one shaft: a parallelogram from its source (top, toward the sun) to its foot; 2 levels, the arena's rule pixel for
  // pixel. 3D: re-rasterised while the camera turns, so each row only visits the beam's span (+ the foot pool) and the
  // canvas is reused per foot
  function shaftCanvas(f, L, w, ux, uy, core, edge, seed) {
    const px = -uy, py = ux, hw = w / 2;
    const cs = [[0, 0], [ux * L, uy * L]].flatMap(([x, y]) => [[x + px * hw * 1.2, y + py * hw * 1.2], [x - px * hw * 1.2, y - py * hw * 1.2]]);
    const prx = hw * 1.4 + 2, pry = Math.max(1.5, prx * .38);
    cs.push([ux * L - prx, uy * L - pry], [ux * L + prx, uy * L + pry]);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [a, b] of cs) { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, a); y1 = Math.max(y1, b); }
    x0 = Math.floor(x0) - 1; y0 = Math.floor(y0) - 1; x1 = Math.ceil(x1) + 1; y1 = Math.ceil(y1) + 1;
    const W = x1 - x0, H = y1 - y0, ew = Math.max(1, Math.round(w * .22));
    if (!f.cv) [f.cv, f.cq] = mk(W, H); else fit(f.cv, f.cq, W, H);
    const im = f.cq.createImageData(W, H), d = im.data;
    const fx = ux * L - x0, fy = uy * L - y0, C = hw * 1.16;
    for (let y = 0; y < H; y++) {
      const vy = y + .5 + y0;
      let xa = W, xb = -1;   // this row's candidates: |cc| <= C (the beam, widest at the foot) and the foot pool
      if (Math.abs(px) > 1e-6) { let a = (-C - vy * py) / px - x0 - .5, b = (C - vy * py) / px - x0 - .5; if (a > b) [a, b] = [b, a]; xa = Math.floor(a) - 1; xb = Math.ceil(b) + 1; }
      else if (Math.abs(vy * py) <= C) { xa = 0; xb = W - 1; }
      const ey = (y + .5 - fy) / pry;
      if (ey * ey <= 1) { const r = prx * Math.sqrt(1 - ey * ey); xa = Math.min(xa, Math.floor(fx - .5 - r) - 1); xb = Math.max(xb, Math.ceil(fx - .5 + r) + 1); }
      xa = Math.max(0, xa); xb = Math.min(W - 1, xb);
      for (let x = xa; x <= xb; x++) {
        const vx = x + .5 + x0, a = vx * ux + vy * uy, cc = vx * px + vy * py, t = a / L;
        let lv = 0;
        const hwA = hw * (.85 + .3 * t);
        if (t <= 1 && Math.abs(cc) <= hwA && t >= .05 + vn(cc / 2, 1, seed) * .1) lv = t > .24 && t < .84 && Math.abs(cc) <= hwA - ew ? 2 : 1;
        if (!lv) { const ex = (x + .5 - fx) / prx; if (ex * ex + ey * ey <= 1) lv = 1; }
        if (!lv) continue;
        const col = lv === 2 ? core : edge, o = (y * W + x) * 4;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
    }
    f.cq.putImageData(im, 0, 0);
    return {cv: f.cv, fx: Math.round(fx), fy: Math.round(fy), L, w, ux, uy, x0, y0, hw, ew};
  }
  const sunAzQ = M => Math.round(M.sun.az / 2) * 2, sunElQ = M => Math.round(M.sun.el);
  function ensureShafts() {
    if (!SH.feet) SH.feet = shaftFeet();
    // (the sun in whole steps: the world clock moves it a little every frame, and an exact key re-rasterised every shaft
    // every frame; in 2 deg / 1 deg steps they're redrawn every few seconds of game time)
    const M = host.mood, tn = timeName(), key = biome + tn + (M ? sunAzQ(M) + ',' + sunElQ(M) : '');
    if (key === SH.key) return;
    SH.key = key; SH.col = null;
    for (const f of SH.feet) { f.tpl = null; f.tk = ''; }
    const base = SHAFT[biome]?.[tn], k = TUNE.shafts.time[tn] ?? 0;
    if (!base || !M || !k || (tn === 'night' && !TUNE.shafts.night.includes(biome))) return;
    const core = base.map(v => Math.round(v * k)), edge = core.map(v => Math.round(v / 2));
    SH.col = {core, edge, mote: core.map(v => Math.min(255, Math.round(v * 2.4 + 8)))};
  }
  // the foot's shaft for the current yaw (zoom-1 px): toward the sun from the foot over the source height H, projected
  function shaftOf(f) {
    const st = TUNE.shafts.yawStep * DEG, yk = Math.round(V.yaw / st), key = SH.key + '|' + yk;
    if (f.tk === key) return f.tpl;
    const M = host.mood, az = sunAzQ(M) * DEG, el = clamp(sunElQ(M), TUNE.shafts.el[0], TUNE.shafts.el[1]) * DEG, cot = Math.cos(el) / Math.sin(el);
    const a = yk * st, c = Math.cos(a), s = Math.sin(a);   // the bucket's yaw (not the exact one: no re-raster per frame)
    const hx = Math.sin(az) * cot * f.H, hy = -Math.cos(az) * cot * f.H;
    const dx = (hx * c - hy * s) * PPM, dy = (hx * s + hy * c) * PPMY - f.H * PPMH;   // right = (cos, -sin), toward = (sin, cos)
    const L0 = Math.hypot(dx, dy), L = Math.min(TUNE.shafts.lenMax, L0);
    f.tk = key;
    // 3D: with the sun behind the camera a shaft is seen end-on and shrinks to a blob at its foot: fade it out in steps
    // (full while its screen length is >= .95 x its height in px; gone below .35 x)
    const fs = clamp((L0 / (f.H * PPMH) - .35) / .6, 0, 1), fore = Math.round(fs * 4) / 4;
    if (fore <= 0 || L0 < 2) return (f.tpl = null);
    f.tpl = shaftCanvas(f, L, f.w, -dx / L0, -dy / L0, SH.col.core, SH.col.edge, (f.x * 7 + f.y * 13) | 0);
    f.tpl.fore = fore; host.G.touch(f.tpl.cv);   // (painted again in its canvas: the GPU's copy of it is stale)
    return f.tpl;
  }
  function drawShafts() {
    // (by day the real sunbeams of render/godrays.js take over where they are on: these painted ones stand at fixed spots and
    // ignore the shadows. At night, with no sun shadow map to march, the painted moonbeams of frost / rift stay)
    if (!TUNE.shafts.on || (host.G?.godrays?.enabled && timeName() !== 'night')) return 0;
    ensureShafts(); if (!SH.col) return 0;
    const z = V.z, reach = (TUNE.shafts.lenMax + 30) * z;
    let n = 0, q = null;
    const CC = SH.col, mc = CC.mcss ??= css(CC.mote), ec = CC.ecss ??= css(CC.edge.map(v => v * 2));   // (made once a colour set)
    for (const f of SH.feet) {
      f.vis = false;
      if (n >= TUNE.shafts.max) continue;
      proj2(f.x, f.y, f.z, _pp); const sx = _pp[0], sy = _pp[1];
      if (sx < -reach || sx > VW + reach || sy < -reach || sy > VH + reach) continue;
      const t = shaftOf(f); if (!t) continue;
      const X = Math.round(sx) - t.fx * z, Y = Math.round(sy) - t.fy * z, w = t.cv.width * z, h = t.cv.height * z;
      if (X >= VW || Y >= VH || X + w <= 0 || Y + h <= 0) continue;
      f.vis = true; n++;
      if (!q) { q = host.glayer('add'); q.save(); q.globalCompositeOperation = 'lighter'; }   // (the GPU draws it: G.glayer)
      const br = Math.sin(T * .35 + f.ph) + .5 * Math.sin(T * .83 + f.ph * 2);   // slow breathing in 3 steps
      q.globalAlpha = (br > .6 ? 1 : br > -.4 ? .85 : .7) * t.fore;
      q.drawImage(t.cv, X, Y, w, h);
      q.globalAlpha = t.fore;
      const ox = X - t.x0 * z, oy = Y - t.y0 * z, px = -t.uy, py = t.ux;   // shaft-local origin on screen
      for (const m of f.motes) {
        if (m.a < .12 || m.a > .95) continue;
        const a = m.a * t.L, cc = m.c * (t.hw * (.85 + .3 * m.a) - .5);
        const inCore = m.a > .24 && m.a < .84 && Math.abs(cc) <= t.hw * (.85 + .3 * m.a) - t.ew;
        const tw = Math.sin(T * m.tw + m.ph);
        if (tw < -.2) continue;   // turned edge-on: not catching the light
        q.fillStyle = inCore && tw > .45 ? mc : ec;
        q.fillRect(ox + Math.round(t.ux * a + px * cc - .5) * z, oy + Math.round(t.uy * a + py * cc - .5) * z, z, z);
      }
    }
    if (q) q.restore();
    return n;
  }
  function stepMotes(dt) {
    if (!SH.feet) return;
    const dir = windDir(), gust = gustNow(), dx = dir[0] * V.c - dir[1] * V.s;   // the wind's screen-x
    for (const f of SH.feet) {
      if (!f.vis) continue;
      for (const m of f.motes) {
        m.a += (m.va * (Math.sin(T * .4 + m.ph) * .6 + .5) + gust * .03) * dt;
        m.c += (Math.sin(T * .7 + m.ph * 3) * .07 + dx * gust * .05) * dt;
        if (m.a > 1) m.a -= 1; if (m.a < 0) m.a += 1;
        if (m.c > 1) { m.c = 1; m.ph += 1; } else if (m.c < -1) { m.c = -1; m.ph += 1; }
      }
    }
  }

  // ================================================================ WATER: masks, puddles, reflections, sky glint
  // masks are TOP-DOWN (R = PPM texels per metre, like the world's ground canvas) and projected per frame
  const WA = {key: '', mask: null, mpat: null, lava: null, lpat: null, yEnd: 0, shrink: 0, puddles: [], near: [], plane: new Map(), gpx: null, gw: 0, gh: 0, used: false, n: 0, pool: null, x0: 0, x1: 0};
  // the puddles' alpha in the GROUND layer (gfx.js COMP_FS: a puddle mirrors what stands over it) and the reflections' settings
  const PUD_A = 254, RFL = {on: true, tint: [0, 0, 0], tintK: 0, alpha: 0, glow: 0, S: 0, ripple: 0, gust: 0, t: 0, oy: 0, zoom: 1, reach: 0, puddleA: 0, pool: null};
  function topMask(yEnd, half, cuts, extra) {   // the stream's row spans (half-width function of y), plus extra(q, R), minus cuts(q, R)
    const S = host.layout.stream, R = PPM, W = Math.ceil(WM() * R), H = Math.ceil(HM() * R), [c, q] = mk(W, H);
    q.fillStyle = '#fff';
    for (let y = 0; y < H; y++) {
      const my = (y + .5) / R; if (my > yEnd) continue;
      const cx = S.cx(my), hw = half(my), x0 = Math.ceil((cx - hw) * R - .5), x1 = Math.floor((cx + hw) * R - .5) + 1;
      if (x1 > x0) q.fillRect(x0, y, x1 - x0, 1);
    }
    if (extra) extra(q, R);
    if (cuts) { q.globalCompositeOperation = 'destination-out'; cuts(q, R); q.globalCompositeOperation = 'source-over'; }
    return c;
  }
  // brief D: B's plateau pool (an ellipse at the foot of the plateau's south face, clipped at the face) and its outflow (a channel west to the river)
  function poolMask(q, R) {
    const L = host.layout, P = L.pool, O = L.outflow, sh = WA.shrink; if (!P) return;
    for (let y = Math.floor(Math.max(P.clip, P.y - P.ry) * R); y < Math.ceil((P.y + P.ry) * R); y++) {
      const k = 1 - (((y + .5) / R - P.y) / P.ry) ** 2; if (k <= 0) continue;
      const hw = P.rx * Math.sqrt(k) - sh, x0 = Math.ceil((P.x - hw) * R - .5), x1 = Math.floor((P.x + hw) * R - .5) + 1;
      if (hw > 0 && x1 > x0) q.fillRect(x0, y, x1 - x0, 1);
    }
    if (O) for (let i = 0; i < O.pts.length; i++) { const hw = O.hw[i] - sh; if (hw > 0) q.fillRect(Math.floor((O.pts[i][0] - .05) * R), Math.floor((O.pts[i][1] - hw) * R), Math.ceil(.1 * R) + 1, Math.ceil(2 * hw * R)); }
  }
  // within r m of the plateau's pool or its outflow (the water's other bodies besides the river)
  function poolNear(x, y, r) {
    const P = WA.pool; if (!WA.mask || !P) return false;
    const u = (x - P.x) / (P.rx + r), v = (y - P.y) / (P.ry + r);
    if (y > P.clip - r && u * u + v * v < 1) return true;
    const O = host.layout.outflow; if (O && x > O.x1 - r - .5 && x < O.x0 + r + .5 && y > 10.4 - r && y < 13.4 + r) for (let i = 0; i < O.pts.length; i += 3) if (Math.hypot(x - O.pts[i][0], y - O.pts[i][1]) < r + .5) return true;
    return false;
  }
  function buildWater() {
    const key = biome + '|' + (host.world?.groundCanvas ? host.world.groundCanvas.width : 0);
    if (WA.key === key) return;
    Object.assign(WA, {key, mask: null, ma: null, mw: 0, mh: 0, mpat: null, lava: null, lpat: null, puddles: [], near: [], plane: new Map(), gpx: null, pool: null});
    const S = host.layout?.stream; if (!S) return;
    if (biome === 'ember') { WA.lava = topMask(27.6, my => S.w(my) / 2 + .18); return; }
    if (!(biome === 'ruins' || biome === 'frost')) return;
    WA.yEnd = biome === 'ruins' ? 27.85 : HM();   // the ruins stream falls over the ravine edge (~27.9 m)
    WA.shrink = biome === 'frost' ? .1 : .02;     // frost: the thin ice shelf along the banks is not water
    WA.pool = host.layout.pool || null;
    { let x0 = 1e9, x1 = -1e9; for (let y = 0; y < WA.yEnd; y += .25) { x0 = Math.min(x0, S.cx(y) - S.w(y) / 2); x1 = Math.max(x1, S.cx(y) + S.w(y) / 2); }
      if (WA.pool) x1 = Math.max(x1, WA.pool.x + WA.pool.rx); WA.x0 = x0 - .35; WA.x1 = x1 + .35; }   // the water's extent in x (the view test: no hard-coded river span)
    WA.mask = topMask(WA.yEnd, my => S.w(my) / 2 - WA.shrink, (q, R) => {
      const cut = (cx, cy, rx, ry, below = 0) => { for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + below + 1); y++) { const dy = y + .5 - cy, t = dy > 0 ? Math.max(0, dy - below) : dy, k = 1 - (t / (ry + 1)) ** 2; if (k <= 0) continue; const hw = (rx + 1.5) * Math.sqrt(k); q.fillRect(Math.floor(cx - hw), y, Math.ceil(hw * 2) + 1, 1); } };
      for (const st of S.stones || []) cut(st.x * R, st.y * R, st.r * R, st.r / 1.3 * R, biome === 'frost' ? 5 : 4);
      if (biome === 'frost') for (let y = .8; y < HM(); y += 2.1) {   // the broken floes (same seeds as biomes.js)
        if (Math.abs(y - S.narrows.y) < 2.6 || S.stones.some(t => Math.abs(y - t.y) < 1.3)) continue;
        const k = y * 10 | 0, hw = S.w(y) / 2, fx = S.cx(y) + (hsh(k, 1) - .5) * hw * .9, r0 = (.14 + hsh(k, 2) * .14) * R;
        cut(fx * R, y * R, r0 * 1.1, r0 * .7, 1);
      }
    }, poolMask);
    {   // the mask's alpha as bytes (the sky glint's clip, read per glint pixel: skyBand)
      const c = WA.mask, d = c.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, c.width, c.height).data, A = new Uint8Array(c.width * c.height);
      for (let i = 0; i < A.length; i++) A[i] = d[i * 4 + 3];
      WA.ma = A; WA.mw = c.width; WA.mh = c.height;
    }
    if (biome === 'ruins') WA.puddles = PUDDLES.map(([x, y, rx, ry], i) => ({x, y, rx, ry, seed: 300 + i, key: ''}));
    // what can show up in the water: props near the stream / north of a puddle (sprites fetched per frame)
    for (const p of host.props || []) {
      if ((p.z || 0) > .05 || /^wall_/.test(p.kind)) continue;
      const nearStream = (p.y < WA.yEnd + 1 && Math.abs(p.x - S.cx(p.y)) - S.w(p.y) / 2 < TUNE.refl.reach) || poolNear(p.x, p.y, TUNE.refl.reach);
      const nearPud = WA.puddles.some(u => Math.abs(p.x - u.x) < 2.6 && p.y > u.y - 3.4 && p.y < u.y + .3);
      // the water plane it mirrors about: the stream's surface (the lowered bed) or a puddle (ground level)
      if (nearStream || nearPud) { WA.near.push(p); WA.plane.set(p, nearStream ? TUNE.refl.bed : 0); }
    }
    // the ground's own pixels (top-down), for the sky glint (additive before the light = ground texel + sky)
    const gc = host.world?.groundCanvas;
    if (gc) { try { WA.gpx = gc.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, gc.width, gc.height).data; WA.gw = gc.width; WA.gh = gc.height; } catch { WA.gpx = null; } }
  }
  // a puddle as the arena paints it, but rasterised in SCREEN space for the current yaw / zoom: the inside test is done
  // in world metres (so it sits still on the floor while the camera turns), the lit / dark rims stay screen-up / down
  function puddleSprite(u, PC) {
    const rxp = u.rx * PPM, ryp = u.ry * PPMY, W0 = Math.ceil(rxp * 2) + 4, H0 = Math.ceil(ryp * 2) + 4, cx0 = W0 / 2, cy0 = H0 / 2;
    const c = V.c, s = V.s;
    const ex = Math.sqrt((u.rx * c) ** 2 + (u.ry * s) ** 2) * PPM * 1.14, ey = Math.sqrt((u.rx * s) ** 2 + (u.ry * c) ** 2) * PPMY * 1.14;
    const mx = Math.max(0, Math.ceil((Math.ceil(ex * 2) + 4 - W0) / 2)), my = Math.max(0, Math.ceil((Math.ceil(ey * 2) + 4 - H0) / 2));
    const W = W0 + 2 * mx, H = H0 + 2 * my, cx = W / 2, cy = H / 2, inside = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const vx = (x + .5 - cx) / PPM, vy = (y + .5 - cy) / PPMY, wx = vx * c + vy * s, wy = -vx * s + vy * c;   // view -> world offset
      const dx = wx / u.rx, dy = wy / u.ry;
      if (dx * dx + dy * dy <= 1 + (vn((wx * PPM + cx0 - .5) / 3.2, (wy * PPMY + cy0 - .5) / 2, u.seed) - .5) * .55) inside[y * W + x] = 1;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {   // no stray pixels: keep those with >= 2 inside 4-neighbours
      const i = y * W + x; if (!inside[i]) continue;
      const n = (x > 0 && inside[i - 1]) + (x < W - 1 && inside[i + 1]) + (y > 0 && inside[i - W]) + (y < H - 1 && inside[i + W]);
      if (n < 2) inside[i] = 0;
    }
    // (3D: written as ImageData into canvases reused per puddle: this runs while the camera turns)
    if (!u.cv) { [u.cv, u.cq] = mk(W, H); [u.mask, u.mq] = mk(W, H); } else { fit(u.cv, u.cq, W, H); fit(u.mask, u.mq, W, H); }
    const im = u.cq.createImageData(W, H), mi = u.mq.createImageData(W, H), d = im.data, md = mi.data, I = (x, y) => x >= 0 && y >= 0 && x < W && y < H && inside[y * W + x];
    const C = PC.rgb || (PC.rgb = {in: rgb(PC.in), hi: rgb(PC.hi), lo: rgb(PC.lo), glint: rgb(PC.glint)});
    const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!I(x, y)) continue;
      const up = !I(x, y - 1), lf = !I(x - 1, y), dn = !I(x, y + 1), rt = !I(x + 1, y);
      let col = C.in;
      if (up || (lf && y < cy)) col = C.hi; else if (dn || (rt && y > cy)) col = C.lo;
      else md[(y * W + x) * 4 + 3] = 255;
      put(x, y, col);
    }
    const gx = Math.round(cx - rxp * .35), gy = Math.round(cy - ryp * .25);   // a short sky glint
    for (let k = 0; k < 3; k++) put(gx + k, gy, C.glint);
    put(gx + 5, gy + 1, C.glint);
    u.cq.putImageData(im, 0, 0); u.mq.putImageData(mi, 0, 0);
    return {W, H, W0, H0, mx, my};
  }
  // the sky glint across the stream: the arena's world rows (every 150 px of its ground), three dashes each, written as
  // ground texel + sky colour (the arena adds it before the light)
  // the sky's glints on the water: whole-pixel dashes (z x z view px each) in g, a GPU context (G.glayer), each pixel only
  // where the water mask at the bed's height lets it through (stones, floes and the ice shelf have no glint): the mask's
  // texel under the pixel's centre, as the canvas's pattern fill through groundMatrix showed it
  function skyBand(g, fp) {
    const sky = WATER[biome]?.sky[timeName()]; if (!sky || !WA.ma || !WA.gpx) return;
    const S = host.layout.stream, P = 150, z = V.z, gx = WA.gw / WM(), gy = WA.gh / HM(), h = TUNE.refl.bed, MA = WA.ma, MW = WA.mw, MH = WA.mh;
    const wet = (X, Y) => { inv2(X + .5, Y + .5, h, _pr); const tx = Math.floor(_pr[0] * PPM), ty = Math.floor(_pr[1] * PPM); return tx >= 0 && ty >= 0 && tx < MW && ty < MH && MA[ty * MW + tx] > 127; };
    const wy0 = Math.max(0, Math.floor(fp.y0 * PPMY) - 2), wy1 = Math.min(WA.yEnd * PPMY, Math.ceil(fp.y1 * PPMY) + 2);
    // three dashes across the water's row span [a, b) (px at the ground's resolution) at world row wy / y = my, gaps between
    // (proj / inv through scratch arrays: this runs per pixel of every dash, every frame)
    const dashes = (wy, my, a, b, k, band) => {
      const w = b - a, s = Math.round(Math.sin(wy * .55 - T * 2.1));
      for (let i = 0; i < 3; i++) {
        const u0 = .12 + i * .28 + hsh(band, i, 5) * .06 - k * .02, u1 = u0 + .14 + hsh(band, i, 6) * .08 - (k === 1 ? .04 : k === 2 ? .08 : 0);
        const xa = (Math.round(a + w * u0) + s) / PPM, xb = (Math.round(a + w * u1) + s) / PPM; if (xb <= xa) continue;
        proj2(xa, my, h, _pa); proj2(xb, my, h, _pb);
        const A0 = _pa[0], A1 = _pa[1], B0 = _pb[0], B1 = _pb[1], n = Math.max(1, Math.ceil(Math.max(Math.abs(B0 - A0), Math.abs(B1 - A1)) / z));
        for (let j = 0; j < n; j++) {
          const t = (j + .5) / n, X = Math.floor((A0 + (B0 - A0) * t) / z) * z, Y = Math.floor((A1 + (B1 - A1) * t) / z) * z;
          if (X < 0 || Y < 0 || X + z > VW || Y + z > VH) continue;
          inv2(X + .5 * z, Y + .5 * z, h, _pu); const tx = Math.floor(_pu[0] * gx), ty = Math.floor(_pu[1] * gy);
          if (tx < 0 || ty < 0 || tx >= WA.gw || ty >= WA.gh) continue;
          const o = (ty * WA.gw + tx) * 4, R = Math.min(255, WA.gpx[o] + sky[0]), G = Math.min(255, WA.gpx[o + 1] + sky[1]), B = Math.min(255, WA.gpx[o + 2] + sky[2]);
          for (let yy = 0; yy < z; yy++) {   // the block's rows: a fill a run of wet pixels (later dashes over earlier ones, as before)
            let s = -1;
            for (let xx = 0; xx <= z; xx++) { const w = xx < z && wet(X + xx, Y + yy); if (w && s < 0) s = xx; else if (!w && s >= 0) { g.fillRectRGB(X + s, Y + yy, xx - s, 1, R, G, B); s = -1; } }
          }
        }
      }
    };
    for (let wy = wy0; wy < wy1; wy++) {
      const k = mod(wy + 40, P); if (k > 2) continue;
      const my = (wy + .5) / PPMY, cx = S.cx(my), hw = S.w(my) / 2 - WA.shrink;
      const a = Math.ceil((cx - hw) * PPM - .5), b = Math.floor((cx + hw) * PPM - .5) + 1; if (b <= a) continue;
      dashes(wy, my, a, b, k, Math.floor((wy + 40) / P));
    }
    const Pp = WA.pool;   // brief D: the plateau's pool glints too, on rows of its own (the river's, every 6 m, never cross it)
    if (Pp) for (let k = 0, wyc = Math.round((Pp.y + .1) * PPMY) - 1; k < 3; k++) {
      const wy = wyc + k, my = (wy + .5) / PPMY, kk = 1 - ((my - Pp.y) / Pp.ry) ** 2; if (kk <= 0 || my < Pp.clip || wy < wy0 || wy >= wy1) continue;
      const hwp = Pp.rx * Math.sqrt(kk) - WA.shrink - .06, a = Math.ceil((Pp.x - hwp) * PPM - .5), b = Math.floor((Pp.x + hwp) * PPM - .5) + 1;
      if (b > a) dashes(wy, my, a, b, k, 91);
    }
  }
  function drawWater() {
    WA.used = false; WA.n = 0;
    buildWater(); if (!WA.mask && !WA.puddles.length) return;
    const z = V.z, fp = footprint(0, FPA), fb = footprint(TUNE.refl.bed, FPB), S = host.layout.stream;
    const streamIn = WA.mask && Math.max(fp.x1, fb.x1) > WA.x0 && Math.min(fp.x0, fb.x0) < WA.x1 && Math.min(fp.y0, fb.y0) < WA.yEnd;
    const BK = biome === 'ruins' ? host.layout.brook : null, brookIn = !!BK && fp.x1 > BK.box[0] && fp.x0 < BK.box[2] && fp.y1 > BK.box[1] && Math.min(fp.y0, fb.y0) < BK.box[3];   // (the West Downs' brook mirrors too: world/brook.js)
    // puddles on the floor first (their colours follow the sky; re-rasterised when the yaw / zoom / time changes)
    const tn = timeName(), pk = Math.round(V.yaw / (.5 * DEG)) + '|' + tn, vis = [];
    for (const u of WA.puddles) {
      proj2(u.x, u.y, 0, _pp); const sx = _pp[0], sy = _pp[1], rr = Math.max(u.rx, u.ry) * PPM * z * 1.3 + 4;
      if (sx < -rr || sx > VW + rr || sy < -rr || sy > VH + rr) continue;
      if (u.key !== pk) { Object.assign(u, puddleSprite(u, PUD_COL[tn] || PUD_COL.day)); u.key = pk; host.G.touch(u.cv); }
      u.X = Math.round(sx - u.W0 * z / 2) - u.mx * z; u.Y = Math.round(sy - u.H0 * z / 2) - u.my * z;
      vis.push(u);
    }
    if (!streamIn && !brookIn && !vis.length) return;
    const g = host.glayer('ground');   // (the GPU draws them: G.glayer)
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over';
    if (vis.length) {   // (at the puddles' own alpha: gfx.js COMP_FS reads it as "a puddle here" and mirrors what stands over it)
      g.globalAlpha = PUD_A / 255;
      for (const u of vis) g.drawImage(u.cv, u.X, u.Y, u.W * z, u.H * z);
      g.globalAlpha = 1;
    }
    if (streamIn) skyBand(g, fb);   // the sky's glints on the stream
    g.restore();
    // the REFLECTIONS (the stream, the pool, the puddles): on the GPU, gfx.js COMP_FS reflAt, from what is on screen this
    // frame. It mirrors as this file's 2D version did (rows shifted whole pixels by the ripple, the water's tint, laid over
    // the water's albedo before the light, flames glowing in it at glowDim), but every prop, card, tree and the Ranger, as
    // they stand in 3D; the props near the water were mirrored here as painted sprites, ~5% of the frame's JS
    if (!TUNE.refl.on) return;
    const R = RFL, t = WATER[biome]?.tint || '#33556a', c = rgb(t);
    R.tint[0] = c[0] / 255; R.tint[1] = c[1] / 255; R.tint[2] = c[2] / 255;
    R.tintK = TUNE.refl.tint; R.alpha = TUNE.refl.alpha; R.glow = 1 - TUNE.refl.glowDim; R.S = Math.abs(V.hy); R.ripple = TUNE.refl.ripple;
    R.gust = gustNow(); R.t = T; R.oy = V.oy; R.zoom = z; R.reach = Math.min(512, Math.ceil(2 * (TUNE.refl.height - TUNE.refl.bed) * R.S));
    R.puddleA = WA.puddles.length ? PUD_A : 0; R.pool = WA.pool;
    host.G.setReflect?.(R); WA.used = true;
  }

  // ================================================================ HEAT HAZE (ember lava stream)
  // gfx.js COMP_FS (G.setHaze): rows of 2 px shifted whole pixels where the lava lies, the same formula; the lava's top-down mask
  // goes up once per world (it was a DISTORT layer painted and uploaded every frame)
  const HZS = {src: null, mask: null, W: 0, H: 0, ver: 0, band: 2, zoom: 1, t: 0, m: [0, 0, 0, 0], e: 0, f: 0, oy: 0};
  function drawHaze() {
    buildWater(); if (!WA.lava || !TUNE.haze.on || !host.G.setHaze) return 0;
    const fp = footprint(TUNE.refl.bed, FPC); if (fp.x1 < 37 || fp.x0 > 43 || fp.y0 > 27.6) return 0;
    if (HZS.src !== WA.lava) {
      const c = WA.lava, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, b = new Uint8Array(c.width * c.height);
      for (let i = 0; i < b.length; i++) b[i] = d[i * 4 + 3] > 127 ? 255 : 0;
      HZS.src = c; HZS.mask = b; HZS.W = c.width; HZS.H = c.height; HZS.ver++;
    }
    const z = V.z; HZS.band = 2 * z; HZS.zoom = z; HZS.t = T; HZS.oy = V.oy;
    proj2(0, 0, TUNE.refl.bed, _pp); groundInv(PPM, HZS.m); HZS.e = _pp[0]; HZS.f = _pp[1];
    host.G.setHaze(HZS);
    return 1;
  }

  // ================================================================ contract
  const PT = {clouds: 0, water: 0, shafts: 0, haze: 0, fg: 0};   // per-part cost (ms, smoothed), for tuning
  function syncBiome() {
    const id = host.biome?.id || 'ruins';
    if (id !== biome) { biome = id; SH.key = ''; SH.feet = null; WA.key = ''; FGcol = null; }
  }
  Object.assign(F, {
    toggle() { F.on = !F.on; return F.on; },
    biomeChanged() { biome = ''; syncBiome(); },
    resize(w, h) { VW = w; VH = h; },   // the view changed size (main.js fit)
    view(dt) {
      const t0 = performance.now();
      T += dt;
      if (OLD_CLOUDS) {   // (?wxtrans=0: the old tile drifting on the ground wind)
        const dir = windDir(), v = TUNE.clouds.speed * (1 + .5 * gustNow()) * (host.env ? .6 + .4 * host.env.windLevel : 1), [TWm, THm] = TUNE.clouds.tileM;   // (a windy sky races)
        CL.x = mod(CL.x + dir[0] * v * dt, TWm); CL.y = mod(CL.y + dir[1] * v * dt, THm);   // metres (the arena: px)
      } else { driftClouds(dt); viewShare(dt); }   // (the wind aloft's: sim/env.js)
      stepFG(dt); stepMotes(dt);
      acc += performance.now() - t0;
    },
    frame() {
      const t0 = performance.now();
      syncBiome(); beginView();
      let ns = 0, nh = 0, nf = 0, cl = false, tp = t0;
      const lap = k => { const t = performance.now(); PT[k] = PT[k] * .95 + (t - tp) * .05; tp = t; };
      if (TUNE.clouds.on) cl = drawClouds();
      lap('clouds');
      drawWater(); lap('water');
      ns = drawShafts(); lap('shafts');
      if (biome === 'ember') nh = drawHaze();
      lap('haze');
      if (TUNE.fg.on) { const q = host.glayer('front'); q.save(); q.setTransform(1, 0, 0, 1, 0, 0); q.globalCompositeOperation = 'source-over'; nf = drawFG(q); q.restore(); }
      lap('fg');
      acc += performance.now() - t0;
      hist[hN++ % hist.length] = acc; acc = 0;
      let s = 0; const n = Math.min(hN, hist.length); for (let i = 0; i < n; i++) s += hist[i]; F.ms = s / n;
      F.debug = `fg ${nf} · shafts ${ns} · haze ${nh} · refl ${WA.used ? 'on' : 'off'}${cl ? ' · clouds' : ''}`;
    },
  });
  F._dbg = {FG, SH, WA, CL, V, PT, proj, inv, footprint};
  if (OLD_CLOUDS) buildCloudLevels();   // ~0.1 s once, while the page loads (not as a hitch the first time the sun comes out)
  return F;
}
