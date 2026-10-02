// DEPTH (3D): near / mid / far depth cues on the HD-2D page. A port of concepts/sprites/arena/depth.js (key 7),
// same art, same TUNE, same rules; everything is anchored in the WORLD so it holds still while the camera turns.
// SHOW ONLY: nothing here changes how the game plays.
//
//   foreground   overhanging branches, vines, broken arch tops (ember: charred branches + chains; frost: snow-laden
//                boughs + icicles; rift: shards / crystal spires) along the world's four borders, drawn near the
//                camera with parallax > 1 in the FRONT layer; they fade when the player is behind them
//   clouds       cloud shadows drifting with the wind over ground and sprites alike (PRE layer), day and dusk, strength
//                from the mood's sun shadow; 2 hard-edged levels, never a gradient
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
//   clouds       the arena's tileable level map, rebuilt top-down in world metres (1 texel = 1/PPM m, like the ground
//                texture), drawn as ONE pattern fill whose transform is the ground plane's world -> view affine: crisp
//                nearest texels, no tile seams, fixed to the ground at any yaw. The PRE layer MIXES toward its colour,
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

const DEG = Math.PI / 180;
// ============================================================ tunables (live: __r3d.features.find(f => f.name === 'depth').TUNE)
const TUNE = {
  fg: {on: false /* off by default: the user found the screen-edge silhouettes didn't look good in 3D (menu / ?fg=1) */, fade: [1, .66, .34], fadeStep: .09, body: [-10, -50, 10, 2], sway: 1, hyst: .12 /* 3D: slot swap hysteresis */},
  clouds: {on: true, tileM: [40, 30], cover: .31, core: .19, s: [.24, .12], time: {day: 1, dusk: .55, night: 0}, speed: 1.9, none: ['rift'],
    mixC: .45 /* 3D: the mix colour = shadow colour x this (approximates the arena's multiply) */},
  shafts: {on: true, max: 5, lenMax: 120, el: [38, 62], time: {day: .85, dusk: 1, night: .5}, night: ['frost', 'rift'], motes: 9, yawStep: 1 /* 3D: deg */},
  refl: {on: true, alpha: .6, tint: .38, ripple: 1, reach: 2.5, glowDim: .5, bed: -.18 /* 3D: the stream bed's height (m) = world.waterH */},
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
  const windAt = (x, y) => { const W = host.wind; return (W && W.on !== false && W.at) ? W.at(x, y) : null; };
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
  const _pa = [0, 0], _pb = [0, 0], _pu = [0, 0];   // the same through scratch arrays (no allocation): proj2 / inv2 write into `o`
  const proj2 = (x, y, h, o) => { o[0] = V.ox + V.xx * x + V.yx * y + V.hx * h; o[1] = V.oy + V.xy * x + V.yy * y + V.hy * h; return o; };
  const inv2 = (X, Y, h, o) => { const u = X - V.ox - V.hx * h, v = Y - V.oy - V.hy * h; o[0] = (V.yy * u - V.yx * v) / V.det; o[1] = (-V.xy * u + V.xx * v) / V.det; return o; };
  const inv = (X, Y, h = 0) => { const u = X - V.ox - V.hx * h, v = Y - V.oy - V.hy * h; return [(V.yy * u - V.yx * v) / V.det, (-V.xy * u + V.xx * v) / V.det]; };
  // a top-down canvas (R texels per metre, its texel (0, 0) at world (x0, y0)) -> view px, as a DOMMatrix for a pattern
  const groundMatrix = (R, h, x0 = 0, y0 = 0) => { const [e, f] = proj(x0, y0, h); return new DOMMatrix([V.xx / R, V.xy / R, V.yx / R, V.yy / R, e, f]); };
  function footprint(h = 0) {   // the view's world AABB at height h
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [X, Y] of [[0, 0], [VW, 0], [0, VH], [VW, VH]]) { const [x, y] = inv(X, Y, h); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return {x0, y0, x1, y1};
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
  const CL = {R: 0, val: null, H: null, lv: null, TW: 0, TH: 0, key: '', cover: -1, cv: null, pat: null, x: 0, y: 0};
  function buildCloudLevels() {   // the arena's level map, in world metres (tile 40 x 30 m, 1 texel = 1 / PPM m)
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
    Object.assign(CL, {R, val, H, lv: new Uint8Array(TW * TH), TW, TH, key: '', cover: -1});
  }
  // the level map for a cover fraction (the noise field above is built once; this re-thresholds it, ~ms, on a change only)
  function cloudLevels(cover) {
    if (CL.cover === cover) return;
    const {val, H, lv} = CL, core = cover * TUNE.clouds.core / TUNE.clouds.cover;
    const qf = f => { let n = 0; const want = val.length * (1 - f); for (let i = 0; i < 1024; i++) { n += H[i]; if (n >= want) return (i + 1) / 1024; } return 1; };
    const tE = qf(cover), tC = qf(core);
    for (let i = 0; i < lv.length; i++) lv[i] = val[i] >= tC ? 2 : val[i] >= tE ? 1 : 0;
    CL.cover = cover; CL.key = '';
  }
  // the sky's cover from the world clock (sim/env.js sky.cloud: clear = no cloud shadows, more as it clouds over; the
  // shadows themselves soften as the sun does under an overcast sky), quantised to 1/16; the old fixed cover without a clock
  const coverNow = () => { const E = host.env; if (!E) return TUNE.clouds.cover; const c = E.sky.cloud; return c < .08 ? 0 : Math.round(Math.min(.78, .08 + .62 * c) * 16) / 16; };
  function cloudTile() {
    const tn = timeName(), k = (TUNE.clouds.time[tn] ?? 0) * (TUNE.clouds.none.includes(biome) ? 0 : 1), M = host.mood, cover = coverNow();
    const a = M ? M.shadow.a : 0, s = Math.min(1.2, a / .46) * k;
    if (s <= .01 || cover <= 0) return null;
    if (!CL.val) buildCloudLevels();
    cloudLevels(cover);
    // (quantised: the clock blends the mood every frame; an exact key re-rendered the tile every frame)
    const c = M.shadow.c, key = biome + tn + cover + (Math.round(s * 50) / 50) + c.map(v => Math.round(v * 64)).join() + TUNE.clouds.s.join() + TUNE.clouds.mixC;
    if (CL.key === key && CL.cv) return CL.cv;
    CL.key = key;
    const [cv, q] = CL.cv ? [CL.cv, CL.cv.getContext('2d')] : mk(CL.TW, CL.TH);
    const im = q.createImageData(CL.TW, CL.TH), d = im.data, lv = CL.lv;
    const rgbA = c.map(v => Math.round(255 * v * TUNE.clouds.mixC)), A = [0, Math.round(255 * TUNE.clouds.s[1] * s), Math.round(255 * TUNE.clouds.s[0] * s)];
    for (let i = 0; i < lv.length; i++) { const L = lv[i]; if (!L) continue; const o = i * 4; d[o] = rgbA[0]; d[o + 1] = rgbA[1]; d[o + 2] = rgbA[2]; d[o + 3] = A[L]; }
    q.putImageData(im, 0, 0);
    CL.pat = null;
    return (CL.cv = cv);
  }
  function drawClouds() {
    const tile = cloudTile(); if (!tile) return false;
    const q = host.layer('pre'), R = CL.R;
    CL.pat ||= q.createPattern(tile, 'repeat');
    const ox = Math.round(CL.x * R) / R, oy = Math.round(CL.y * R) / R;   // whole texels: the shadows step, never shimmer
    CL.pat.setTransform(groundMatrix(R, 0, ox, oy));
    q.save(); q.imageSmoothingEnabled = false; q.globalAlpha = 1; q.globalCompositeOperation = 'source-over';
    q.fillStyle = CL.pat; q.fillRect(0, 0, VW, VH);
    q.restore();
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
    f.tpl.fore = fore;
    return f.tpl;
  }
  function drawShafts() {
    if (!TUNE.shafts.on) return 0;
    ensureShafts(); if (!SH.col) return 0;
    const z = V.z, reach = (TUNE.shafts.lenMax + 30) * z;
    let n = 0, q = null;
    const mc = css(SH.col.mote), ec = css(SH.col.edge.map(v => v * 2));
    for (const f of SH.feet) {
      f.vis = false;
      if (n >= TUNE.shafts.max) continue;
      const [sx, sy] = proj(f.x, f.y, f.z);
      if (sx < -reach || sx > VW + reach || sy < -reach || sy > VH + reach) continue;
      const t = shaftOf(f); if (!t) continue;
      const X = Math.round(sx) - t.fx * z, Y = Math.round(sy) - t.fy * z, w = t.cv.width * z, h = t.cv.height * z;
      if (X >= VW || Y >= VH || X + w <= 0 || Y + h <= 0) continue;
      f.vis = true; n++;
      if (!q) { q = host.layer('add'); q.save(); q.globalCompositeOperation = 'lighter'; q.imageSmoothingEnabled = false; }
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
  const [RA, ra] = mk(VW, VH), [RB, rb] = mk(VW, VH), [MS, ms] = mk(VW, VH), [EM, em] = mk(VW, VH), [SK, sk] = mk(VW, VH), [HZ, hz] = mk(VW, VH);
  let SKY = sk.createImageData(VW, VH); const skyDirty = [];
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
    Object.assign(WA, {key, mask: null, mpat: null, lava: null, lpat: null, puddles: [], near: [], plane: new Map(), gpx: null, pool: null});
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
  const near = (x, y, r) => { const S = host.layout.stream; return (WA.mask && ((y < WA.yEnd + r && Math.abs(x - S.cx(y)) - S.w(y) / 2 < r) || poolNear(x, y, r))) || WA.puddles.some(u => Math.hypot(x - u.x, y - u.y) < r + .6); };
  // whole-pixel ripple: rows shifted by round(amp * sin), phase anchored to the view-frame row (the arena's world row at
  // yaw 0), stronger downstream and in gusts
  function rippleCopy(src, dq, x, y, w, h) {
    const gust = gustNow(), Rr = TUNE.refl.ripple, z = V.z, S = host.layout.stream, cxs = x + w / 2;
    const off = row => {
      const wy = (row - V.oy) / z, [mx, my] = inv(cxs, row + .5, TUNE.refl.bed);
      const onStream = WA.mask && my < WA.yEnd && Math.abs(mx - S.cx(my)) < S.w(my) / 2 + .6, onPool = !onStream && poolNear(mx, my, .6);
      const amp = onStream ? Rr * (.8 + .5 * clamp((my - 10) / 14, 0, 1) + .6 * gust) : onPool ? Rr * (.7 + .5 * gust) : Rr * (.25 + .8 * gust);
      return Math.round(amp * Math.sin(wy * .55 - T * 2.1) * (.6 + .4 * Math.sin(wy * .13 + T * .7))) * z;
    };
    let r0 = y, o0 = off(y);
    for (let r = y + 1; r <= y + h; r++) {
      const o = r < y + h ? off(r) : NaN;
      if (o !== o0) { dq.drawImage(src, x, r0, w, r - r0, x + o0, r0, w, r - r0); r0 = r; o0 = o; }
    }
  }
  // the sky glint across the stream: the arena's world rows (every 150 px of its ground), three dashes each, written as
  // ground texel + sky colour (the arena adds it before the light)
  function skyBand(g, fp) {
    const sky = WATER[biome]?.sky[timeName()]; if (!sky || !WA.mask || !WA.gpx) return;
    const S = host.layout.stream, P = 150, z = V.z, d = SKY.data, gx = WA.gw / WM(), gy = WA.gh / HM(), h = TUNE.refl.bed;
    for (const i of skyDirty) d[i + 3] = 0;
    skyDirty.length = 0;
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
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
          for (let yy = 0; yy < z; yy++) for (let xx = 0; xx < z; xx++) { const p = ((Y + yy) * VW + X + xx) * 4; d[p] = R; d[p + 1] = G; d[p + 2] = B; d[p + 3] = 255; skyDirty.push(p); }
          bx0 = Math.min(bx0, X); by0 = Math.min(by0, Y); bx1 = Math.max(bx1, X + z); by1 = Math.max(by1, Y + z);
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
    if (bx1 <= bx0) return;
    // the water mask decides (stones, floes and the ice shelf have no glint)
    sk.globalCompositeOperation = 'source-over'; sk.clearRect(bx0, by0, bx1 - bx0, by1 - by0);
    sk.putImageData(SKY, 0, 0, bx0, by0, bx1 - bx0, by1 - by0);
    sk.globalCompositeOperation = 'destination-in'; sk.drawImage(MS, bx0, by0, bx1 - bx0, by1 - by0, bx0, by0, bx1 - bx0, by1 - by0);
    sk.globalCompositeOperation = 'source-over';
    g.drawImage(SK, bx0, by0, bx1 - bx0, by1 - by0, bx0, by0, bx1 - bx0, by1 - by0);
  }
  function emitImageOf(p, sp) {   // the flame the card shows this frame (the wind's live flame when it has one)
    const it = host.itemOf(p), t = it?.card?.g?.uniforms?.uEm?.value;
    return (t && t.image && it.card.g.uniforms.uHasEm.value) ? t.image : sp?.emit || null;
  }
  function drawWater() {
    WA.used = false; WA.n = 0;
    buildWater(); if (!WA.mask && !WA.puddles.length) return;
    const z = V.z, fp = footprint(0), fb = footprint(TUNE.refl.bed), S = host.layout.stream;
    const streamIn = WA.mask && Math.max(fp.x1, fb.x1) > WA.x0 && Math.min(fp.x0, fb.x0) < WA.x1 && Math.min(fp.y0, fb.y0) < WA.yEnd;
    // puddles on the floor first (their colours follow the sky; re-rasterised when the yaw / zoom / time changes)
    const tn = timeName(), pk = Math.round(V.yaw / (.5 * DEG)) + '|' + tn, vis = [];
    for (const u of WA.puddles) {
      const [sx, sy] = proj(u.x, u.y, 0), rr = Math.max(u.rx, u.ry) * PPM * z * 1.3 + 4;
      if (sx < -rr || sx > VW + rr || sy < -rr || sy > VH + rr) continue;
      if (u.key !== pk) { Object.assign(u, puddleSprite(u, PUD_COL[tn] || PUD_COL.day)); u.key = pk; }
      u.X = Math.round(sx - u.W0 * z / 2) - u.mx * z; u.Y = Math.round(sy - u.H0 * z / 2) - u.my * z;
      vis.push(u);
    }
    if (!streamIn && !vis.length) return;
    const g = host.layer('ground');
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.imageSmoothingEnabled = false;
    for (const u of vis) g.drawImage(u.cv, u.X, u.Y, u.W * z, u.H * z);
    // the water in view as a screen mask: the stream (top-down mask at the bed's height) + the puddles' insides
    ms.setTransform(1, 0, 0, 1, 0, 0); ms.globalCompositeOperation = 'source-over'; ms.globalAlpha = 1; ms.clearRect(0, 0, VW, VH); ms.imageSmoothingEnabled = false;
    if (streamIn) {
      WA.mpat ||= ms.createPattern(WA.mask, 'no-repeat');
      WA.mpat.setTransform(groundMatrix(PPM, TUNE.refl.bed));
      ms.fillStyle = WA.mpat; ms.fillRect(0, 0, VW, VH);
    }
    for (const u of vis) ms.drawImage(u.mask, u.X, u.Y, u.W * z, u.H * z);
    if (streamIn) skyBand(g, fb);
    if (!TUNE.refl.on) { g.restore(); return; }
    // mirrored sprites into the scratch (flipped about the ground contact row gy: y -> 2 gy + z - y)
    ra.setTransform(1, 0, 0, 1, 0, 0); ra.globalCompositeOperation = 'source-over'; ra.globalAlpha = 1; ra.clearRect(0, 0, VW, VH); ra.imageSmoothingEnabled = false;
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    const mirror = (img, sx, sy, sw, sh, dx, dy, gy) => {
      const top = 2 * gy + z - (dy + sh * z), bot = 2 * gy + z - dy;
      if (dx >= VW || dx + sw * z <= 0 || bot <= 0 || top >= VH) return false;
      ra.setTransform(1, 0, 0, -1, 0, 2 * gy + z); ra.drawImage(img, sx, sy, sw, sh, dx, dy, sw * z, sh * z); ra.setTransform(1, 0, 0, 1, 0, 0);
      bx0 = Math.min(bx0, dx); by0 = Math.min(by0, top); bx1 = Math.max(bx1, dx + sw * z); by1 = Math.max(by1, bot); WA.n++; return true;
    };
    const flames = [];
    for (const p of WA.near) {
      if (p.gone) continue;
      const it = host.itemOf(p), sp = it?.sp || host.biome.sprite?.(p, host.ctxO); if (!sp || !sp.img) continue;   // live 3D prop: its painted stand-in
      const z0 = p.z || 0, [ax, ay] = proj(p.x, p.y, z0 + (p.h || 0)), gy = Math.round(proj(p.x, p.y, z0 + (WA.plane.get(p) ?? 0))[1]);
      const dx = Math.round(ax) - sp.pivot[0] * z, dy = Math.round(ay) - sp.pivot[1] * z;
      if (mirror(sp.img, 0, 0, sp.img.width, sp.img.height, dx, dy, gy)) { const e = emitImageOf(p, sp); if (e) flames.push({e, dx, dy, gy, w: sp.img.width * z, h: sp.img.height * z}); }
    }
    // the Ranger: body + cloak + bow as drawn this frame, flipped about the water plane next to him (the stream's lowered
    // surface, or ground level at a puddle; airborne: 2 x height lower)
    const P = host.P, pl = host.player;
    if (P && !(P.sink > 0) && !(P.blink && Math.floor(P.blink * 12) % 2) && near(pl.x, pl.y, 3.2)) {
      // (playerSprite's h is the player's height above the ground; the canvas size is img.width / img.height)
      const ps = host.playerSprite(), Sx = host.layout.stream, byStream = WA.mask && (Math.abs(ps.x - Sx.cx(ps.y)) - Sx.w(ps.y) / 2 < 3.2 || poolNear(ps.x, ps.y, 3.2)),
        plane = byStream ? TUNE.refl.bed : (host.elev ? host.elev(ps.x, ps.y) : 0), [ax, ay] = proj(ps.x, ps.y, ps.h), gy = Math.round(proj(ps.x, ps.y, plane)[1]);
      mirror(ps.img, 0, 0, ps.img.width, ps.img.height, Math.round(ax) - ps.px * z, Math.round(ay) - ps.py * z, gy);
    }
    if (bx1 > bx0) {
      bx0 = Math.max(0, Math.floor(bx0) - 2 * z); by0 = Math.max(0, Math.floor(by0)); bx1 = Math.min(VW, Math.ceil(bx1) + 2 * z); by1 = Math.min(VH, Math.ceil(by1));
      if (bx1 > bx0 && by1 > by0) {
        const w = bx1 - bx0, h = by1 - by0;
        rb.setTransform(1, 0, 0, 1, 0, 0); rb.globalCompositeOperation = 'source-over'; rb.globalAlpha = 1; rb.clearRect(0, 0, VW, VH); rb.imageSmoothingEnabled = false;
        rippleCopy(RA, rb, bx0, by0, w, h);
        rb.globalCompositeOperation = 'destination-in'; rb.drawImage(MS, bx0, by0, w, h, bx0, by0, w, h);
        rb.globalCompositeOperation = 'source-atop'; rb.globalAlpha = TUNE.refl.tint; rb.fillStyle = WATER[biome].tint; rb.fillRect(bx0, by0, w, h);
        rb.globalAlpha = 1; rb.globalCompositeOperation = 'source-over';
        g.globalAlpha = TUNE.refl.alpha; g.drawImage(RB, bx0, by0, w, h, bx0, by0, w, h); g.globalAlpha = 1;
      }
    }
    g.restore();
    // flames mirrored into the water / puddles: the EMIT layer (glow x darkness, like the arena's ground emitters)
    if (flames.length) {
      em.setTransform(1, 0, 0, 1, 0, 0); em.globalCompositeOperation = 'source-over'; em.globalAlpha = 1; em.clearRect(0, 0, VW, VH); em.imageSmoothingEnabled = false;
      for (const f of flames) { em.setTransform(1, 0, 0, -1, 0, 2 * f.gy + z); em.drawImage(f.e, f.dx, f.dy, f.w, f.h); }   // (the emit shares the sprite's layout, like the card's uv)
      em.setTransform(1, 0, 0, 1, 0, 0);
      em.globalCompositeOperation = 'destination-in'; em.drawImage(MS, 0, 0);
      em.globalCompositeOperation = 'source-atop'; em.globalAlpha = TUNE.refl.glowDim; em.fillStyle = '#000'; em.fillRect(0, 0, VW, VH);
      em.globalAlpha = 1; em.globalCompositeOperation = 'source-over';
      const e = host.layer('emit'); e.save(); e.setTransform(1, 0, 0, 1, 0, 0); e.globalAlpha = 1; e.globalCompositeOperation = 'source-over'; e.drawImage(EM, 0, 0); e.restore();
      WA.used = true;
    }
  }

  // ================================================================ HEAT HAZE (ember lava stream)
  const hasDistort = () => !!host.G?.compU?.tDistort;
  function drawHaze() {
    buildWater(); if (!WA.lava || !TUNE.haze.on) return 0;
    const fp = footprint(TUNE.refl.bed); if (fp.x1 < 37 || fp.x0 > 43 || fp.y0 > 27.6) return 0;
    const z = V.z, band = 2 * z, rows = [];
    for (let y = 0; y < VH; y += band) {
      const wy = Math.round((y - V.oy) / z);   // the arena's world row at yaw 0
      const s = Math.round(Math.sin(wy * .21 - T * 2.6) * Math.max(0, Math.sin(wy * .047 + T * .9)) * 1.45);
      if (s) rows.push(y, s * z);
    }
    if (!rows.length) return 0;
    if (!hasDistort()) return rows.length / 2;   // (the composite hook isn't there yet: computed, not shown)
    hz.setTransform(1, 0, 0, 1, 0, 0); hz.globalAlpha = 1; hz.globalCompositeOperation = 'source-over'; hz.clearRect(0, 0, VW, VH); hz.imageSmoothingEnabled = false;
    for (let i = 0; i < rows.length; i += 2) { hz.fillStyle = `rgb(${128 + rows[i + 1]},128,0)`; hz.fillRect(0, rows[i], VW, band); }
    WA.lpat ||= hz.createPattern(WA.lava, 'no-repeat');
    WA.lpat.setTransform(groundMatrix(PPM, TUNE.refl.bed));
    hz.globalCompositeOperation = 'destination-in'; hz.fillStyle = WA.lpat; hz.fillRect(0, 0, VW, VH); hz.globalCompositeOperation = 'source-over';
    const q = host.layer('distort'); q.save(); q.setTransform(1, 0, 0, 1, 0, 0); q.globalAlpha = 1; q.globalCompositeOperation = 'source-over'; q.drawImage(HZ, 0, 0); q.restore();
    return rows.length / 2;
  }

  // ================================================================ contract
  const PT = {clouds: 0, water: 0, shafts: 0, haze: 0, fg: 0};   // per-part cost (ms, smoothed), for tuning
  function syncBiome() {
    const id = host.biome?.id || 'ruins';
    if (id !== biome) { biome = id; SH.key = ''; SH.feet = null; CL.key = ''; WA.key = ''; FGcol = null; }
  }
  Object.assign(F, {
    toggle() { F.on = !F.on; return F.on; },
    biomeChanged() { biome = ''; syncBiome(); },
    resize(w, h) {   // the view changed size (main.js fit): the view-sized canvases and the sky glint's pixels follow
      VW = w; VH = h;
      for (const [c, q] of [[RA, ra], [RB, rb], [MS, ms], [EM, em], [SK, sk], [HZ, hz]]) { c.width = w; c.height = h; q.imageSmoothingEnabled = false; }
      SKY = sk.createImageData(w, h); skyDirty.length = 0;
    },
    view(dt) {
      const t0 = performance.now();
      T += dt;
      const dir = windDir(), v = TUNE.clouds.speed * (1 + .5 * gustNow()) * (host.env ? .6 + .4 * host.env.windLevel : 1), [TWm, THm] = TUNE.clouds.tileM;   // (a windy sky races)
      CL.x = mod(CL.x + dir[0] * v * dt, TWm); CL.y = mod(CL.y + dir[1] * v * dt, THm);   // metres (the arena: px)
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
      if (TUNE.fg.on) { const q = host.layer('front'); q.save(); q.setTransform(1, 0, 0, 1, 0, 0); q.globalCompositeOperation = 'source-over'; q.imageSmoothingEnabled = false; nf = drawFG(q); q.restore(); }
      lap('fg');
      acc += performance.now() - t0;
      hist[hN++ % hist.length] = acc; acc = 0;
      let s = 0; const n = Math.min(hN, hist.length); for (let i = 0; i < n; i++) s += hist[i]; F.ms = s / n;
      F.debug = `fg ${nf} · shafts ${ns} · haze ${nh}${nh && !hasDistort() ? ' (no distort layer)' : ''} · refl ${WA.n}${WA.used ? ' glow' : ''}${cl ? ' · clouds' : ''}`;
    },
  });
  F._dbg = {FG, SH, WA, CL, V, PT, proj, inv, footprint, cv: {RA, RB, MS, EM, SK, HZ}};
  buildCloudLevels();   // ~0.1 s once, while the page loads (not as a hitch the first time the sun comes out)
  return F;
}
