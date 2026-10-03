// WIND (3D): the arena's one wind for the whole world (concepts/sprites/arena/wind.js), moved into the HD-2D world.
// OWNER: the wind + wildlife port session. SHOW ONLY: nothing here changes how the game plays (no colliders, damage or
// player movement). Key 5; ?wind=0 starts off. Off = everything rigid and still, F.at = calm, F.gust = 0.
//
// Same field, same per-biome numbers, same tunables as the arena (F.TUNE === the arena's TUNE + nothing new). What changed
// is only how things reach the screen, now that the camera turns:
//   field     gust FRONTS rolling across the map along the wind (W -> E, a little south); the rift's rings roll outward
//             from the rune circle. World metres, exactly the arena's maths.
//   foliage   a damped spring per tuft / bush / tree (FLEX), now a 2D lean in the WORLD: the wind leans it along the wind
//             (so turning the camera turns the lean with the world), the idle flutter and the brushes (the player running /
//             rolling past, arrows, blasts) act along the screen's x like the arena. Shown through the host's card hook as
//             {sway: px at the top opaque row, bend: 8 weights}: the arena's per-row CURVES (tufts flex from 20 % up, tree
//             trunks stay stiff and the crown moves as a block), fitted per sprite to the host's 8-knot curve; the shader
//             shifts each row by whole pixels like the arena's drawProp bands. TUNE.hyst works on the projected lean.
//   flames    the arena's live flame renderer (coals fixed, flame rows re-sampled to a flickering height, leaning
//             downwind along the SCREEN's x, tip licks, a detached ember) at TUNE.flameFps; the canvas replaces the
//             brazier / torch emit. The card shader paints emit-only pixels as albedo (= the arena's flameAlbedo).
//   cloth     the arena's Verlet banners (north gate), standards (east gate), tower pennants, prayer flags (trail),
//             dummy strips and hanging lanterns, simulated in world metres as before, rasterised with the CAMERA's
//             projection (yaw) at TUNE.clothFps (and whenever the camera turned) into ONE cloth atlas; every piece is a
//             camera-facing card anchored where it hangs (depth-correct against walls, posts, the player). Seen from
//             behind you see the lining. Ropes, rods, lantern arms and chains are world lines (they turn with the
//             camera); posts, mast and lantern bodies are sprites (one static atlas, lantern glass = its emit).
//   cloak     F.cloth() -> CLOTH_PARAMS overrides: the arena's numbers, turned into the PLAYER's view frame (the cloth
//             rig runs there: x = screen right, y = toward the camera).
//
// FEATURE CONTRACT (main.js): create(host) -> F
//   F.name 'wind', F.key '5', F.on / F.toggle(), F.ms (rolling average cost per frame, update + frame + card hook)
//   F.view(dt, evs)     field, foliage springs, cloth / lantern sims (60 Hz fixed), shed particles (+ the season's dying
//                       leaves, env.leafFall), events (dummy hits kick the strips, explosions whip foliage and billow cloth,
//                       a bird landing on / leaving a crown, wildlife.js 'bird_perch', knocks a dying leaf loose)
//   F.frame(f)          cloth atlas raster + its cards, posts / lantern sprites, ropes / rods / chains (host.line),
//                       shed particles (host.point; sparks / motes glow through host.glayer('emit')), pole contact shadows
//                       (host.glayer('ground'): the GPU draws both)
//   F.card(it, sp)      the host's card hook (main.js installs it as world.hooks.card): foliage -> {sway, bend}, brazier /
//                       torch -> {sway: 0, em: live flame canvas}, anything else null (rigid props never sway)
//   F.mesh(it)          the host's mesh hook (world.hooks.mesh): a 3D tree -> {x, y (lean m at the top), shake (px)}
//   F.lights()          hanging lanterns (they swing: the pool moves)
//   F.cloth()           {wind: [vx, vy] (view frame), gust} for CLOTH_PARAMS
//   F.at(x, y, o?) -> {x, y, g}   wind velocity m/s on the ground plane (arena x east, y south) + gust 0..1 (into o if given)
//   F.foliage()         the trees / bushes / tufts round the view and the player (a cell index: no scan of all props)
//   F.gust (0..1 at the player; audio reads it), F.dir ([ux, uy] the wind blows TOWARD), F.atmosGust() (view centre)
//   F.biomeChanged()    re-seeds the field, rebuilds the decor for the new biome
// EXTRAS: F.TUNE / F.tune (live tunables), F.gustNow(A) (a strong front at the view now), F.info(), F._dbg()
//
// host (main.js): ctxO {PPM, PPMY, PPMH, WM, HM, PLAY, layout}, G (view.T, toScreen), yaw, zoom, player (world frame),
// props, arrows, events, biome, itemOf(p), toView, sprite, point, line, layer.
// ART RULES (biomes.js / atmos.js): 1 texel = 1 screen px, no AA / dither / gradients on the pixel art; 4-tone ramps
// [hi, base, shade, outline] lit from the screen's top-left; motion reads at 1x (a gust = 1-3 px of lean).
import {flags} from '../core/flags.js';
import {clamp, smooth, hash3 as hsh, hypot2, hypot3} from '../core/mathx.js';   // hypot2/3: Math.hypot without its garbage (bit for bit)
import {mulberry32} from '../core/rng.js';
import {hexU32 as rgba} from '../core/color.js';
import {fallStage} from '../core/autumn.js';

const TAU = Math.PI * 2;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };

// ---------------------------------------------------------------- tunables (the arena's, unchanged)
const TUNE = {
  clothV: 4,          // m/s of "show wind" the cloth feels at a full push (normalised 1); the real breeze is too weak to lift cloth
  clothIdle: .22,     // flutter of the cloth with no gust (share of a full gust's)
  clothFps: 30,       // cloth re-raster rate (simulation runs every step)
  flameFps: 12,       // live flame re-render rate
  idle: .1,           // foliage flutter, normalised: idle amplitude ...
  flutter: .26,       // ... + this per unit of gust
  hyst: .5,           // px: the lean must move this far before the drawn offset changes (no 1 px flicker at a threshold)
  push: {tuft: [.8, 3], bush: [1.1, 2.2], reed: [1, 3.6], fern: [.7, 1.8]},   // the player running / rolling past: [radius m, px at full speed] (reeds part for him)
  arrowBush: [.55, 1.45], arrowTree: [1.2, 4.6],   // an arrow through foliage: [radius m, max height m]
  towerTop: 9,        // px below the tower sprite's top where its roof centre is (fallback when the tower has no mesh)
  riftLift: 12,       // m/s^2 of eerie lift on cloth (at its free edge) while a rift ring passes
  flameAlbedo: true,  // the live flame is painted into the scene too (3D: the card shader paints emit-only pixels)
};

// ---------------------------------------------------------------- per biome wind (the arena's numbers)
const BIOME = {
  ruins: {base: .3, gust: .7, sway: .9, fronts: {every: [3.5, 8], speed: [5, 7], len: [6, 12], amp: [.55, 1], edge: [1.5, 3.5], half: [10, 30]}, cloth: [.5, 1.5]},
  ember: {base: .12, gust: .35, sway: .5, fronts: {every: [5, 10], speed: [4, 5], len: [10, 18], amp: [.5, .9], edge: [2.5, 5], half: [14, 36]}, cloth: [.3, .8]},
  frost: {base: .45, gust: 2.1, sway: 1, fronts: {every: [1.6, 4], speed: [6, 8], len: [6, 11], amp: [.6, 1], edge: [1, 3], half: [12, 30]}, cloth: [.7, 2.2]},
  rift: {base: 0, gust: 1.1, sway: .85, pulse: {every: [5.5, 9], speed: [2, 2.6], len: [2.4, 3.4], amp: [.7, 1]}, cloth: [0, 1.6]},
};
// WIND STRENGTH (render3d): the weather of the wind, on top of the gust fronts. A multiplier on every wind speed the field
// returns (base + gusts), so everything that reads the field feels it: foliage springs and 3D trees (lean, the leaves'
// dance, light rolling through the crowns), shed and airborne leaves, cloth, the Ranger's cloak / scarf / hair (main.js),
// the rustle and gust sound (audio.js). SHOW ONLY: the player is never pushed. 'auto' wanders between calm, breeze and
// brisk spells (STRENGTH.dwell s each); B cycles the modes, the pause menu has them, ?windlevel=brisk starts there.
const LEVELS = {calm: .35, breeze: 1, brisk: 2.1, gale: 3};
const MODES = ['auto', 'calm', 'breeze', 'brisk', 'gale'];
const STRENGTH = {
  auto: [['breeze', .4], ['brisk', .45], ['calm', .15]],   // the spells 'auto' picks from (weights)
  dwell: [25, 55],    // s per spell
  ease: 4,            // s: a change of strength builds up / dies down over about this long
  tree3d: 1.5,        // 3D trees lean this much more than the painted cards (a 4.5 m model, not a 3.5 px sprite top)
  dance: 1.15,        // the leaves' own dance: art px per unit of (level x gust), beyond...
  danceMin: .3,       // ...this much (a breeze between gusts leaves the crown still)
  wave: .16,          // light rolling through the crowns: tone bias per unit of (level x gust), capped at .24
  shed: 1.3,          // leaves shed per second per tree at a full gust, per unit of level above .75
  fall: .3,           // dying leaves that let go by themselves in still air, per second per tree at env.leafFall 1 (autumn's end)
  airborne: 5,        // leaves (snow, ash) blown across the view per second, per unit of level above 1.1 (x .25 in a lull, x 1.85 in a gust)
};
// foliage flexibility per biome: null = rigid. px = max lean at the top, w = spring rad/s, z = damping, fq = flutter Hz,
// curve = the arena's row weight profile (CURVES)
const FLEX = {
  ruins: {tuft: {px: 3, w: 16, z: .32, fq: 1.3, curve: 'tip'}, bush: {px: 2.4, w: 9, z: .36, fq: .8, curve: 'bush'},
    tree: {px: 3.5, w: 3.8, z: .42, fq: .33, curve: 'crown'}, dead: {px: 2, w: 4.2, z: .4, fq: .4, curve: 'limb'},
    // the riverside (features/riverside.js): reeds a little livelier than a tuft, ferns barely, the willow (variant 3) loose and slow
    reed: {px: 3.8, w: 12, z: .28, fq: 1.6, curve: 'reed'}, fern: {px: 1.4, w: 12, z: .35, fq: .9, curve: 'bush'}, willow: {px: 4.6, w: 3, z: .4, fq: .3, curve: 'crown'}},
  ember: {bush: {px: 1.6, w: 11, z: .4, fq: .5, curve: 'bush'}},
  frost: {tuft: {px: 1.6, w: 15, z: .35, fq: 1.1, curve: 'twig'}, bush: {px: 1.8, w: 8, z: .4, fq: .7, curve: 'bush'},
    tree: {px: 2.6, w: 3, z: .45, fq: .3, curve: 'pine'}, reed: {px: 2, w: 13, z: .33, fq: 1.1, curve: 'reed'}},
  rift: {bush: {px: 2, w: 7, z: .3, fq: .45, curve: 'coral'}},
};
const CURVES = {   // the arena's row weights: u = 0 at the sprite's base row .. 1 at its top row; c = crown start (trees)
  tip: u => u < .2 ? 0 : ((u - .2) / .8) ** 1.25,
  reed: u => u < .12 ? 0 : ((u - .12) / .88) ** 1.15,   // (a reed clump bends from lower down than a tuft)
  bush: u => u < .22 ? 0 : ((u - .22) / .78) ** 1.1,
  twig: u => u < .38 ? 0 : (u - .38) / .62,
  coral: u => u ** 1.6,
  pine: u => u < .08 ? 0 : ((u - .08) / .92) ** 1.7,
  limb: u => u < .1 ? 0 : ((u - .1) / .9) ** 1.5,
  crown: (u, c) => u < c ? .7 * (u / c) ** 2.2 : .7 + .3 * (u - c) / (1 - c),
};
// shed particles per biome (bushes shaken by arrows, snow blown off in a gust)
const SHED = {
  ruins: {kind: 'leaf', pals: [['#6f8c68', '#577154', '#435a45'], ['#6f8c68', '#577154', '#435a45'], ['#a4ae52', '#7a8a3c', '#4e5c2a'], ['#d0a44a', '#a47a34', '#6c5024'], ['#9c7650', '#76563a', '#503a28']]},
  ember: {kind: 'spark', pal: ['#ffd27e', '#f28a36', '#b8481c', '#5e200e'], ash: ['#a39a92', '#7c746e', '#57514d']},
  frost: {kind: 'snow', pal: ['#f2f6ff', '#c4d0e4', '#8e9cb8']},
  rift: {kind: 'mote', pal: ['#e4c8ff', '#ac80f2', '#7448c4', '#40247a']},
};

// ---------------------------------------------------------------- cloth / decor palettes ([hi, base, shade, outline])
const PAL = {
  ruins: {
    wood: ['#8c6c4a', '#70543a', '#543e2b', '#35271c'], metal: ['#a08650', '#7a6438', '#56452a', '#352a1c'],
    main: ['#c26a50', '#9a4a3a', '#6e3430', '#3a1c1e'], trim: ['#d6b068', '#ae8a4a', '#846638', '#4e3c24'],
    alt: ['#bca985', '#9e8d6b', '#7d6f53', '#514836'], blue: ['#8fa4ac', '#6f858e', '#556a74', '#33424a'],
    flags: ['main', 'trim', 'alt', 'blue'], strip: 'main', emblem: 'sun', rope: '#4a3a28',
    glass: ['#fff0c0', '#f2d48a'], glow: ['#fff2c8', '#ffd070'], light: '#ffc070',
  },
  ember: {
    wood: ['#5a4a40', '#43362f', '#30261f', '#1c1512'], metal: ['#6c666a', '#4d484d', '#363237', '#211e22'],
    main: ['#5a5250', '#423b3b', '#2e2929', '#181414'], trim: ['#c44a2c', '#922f1e', '#621e14', '#2e0e0a'],
    alt: ['#8c827b', '#79716b', '#655e59', '#4a4441'],
    flags: ['main', 'trim', 'alt'], strip: 'trim', emblem: 'diamond', rope: '#1c1512',
    fray: true, crust: '#2a1512', ember: ['#ffd070', '#ff8a3a', '#e0541e'],
    glass: ['#ffe0a0', '#ffb060'], glow: ['#ffe8b0', '#ffa848'], light: '#ff9a40',
  },
  frost: {
    wood: ['#8a7c6e', '#6d6055', '#534841', '#362f2b'], metal: ['#9ea8b8', '#768093', '#586275', '#39404f'],
    main: ['#c4daf0', '#96b6d8', '#6e8eba', '#465888'], trim: ['#f4f8ff', '#d4deec', '#a8b6cc', '#6c7c98'],
    alt: ['#9cc8dc', '#6ea2bc', '#4e7e9c', '#2e4e6c'],
    flags: ['main', 'trim', 'alt'], strip: 'main', emblem: 'flake', rope: '#362f2b', rime: true,
    glass: ['#fff4d0', '#ffd890'], glow: ['#fff6d8', '#ffd890'], light: '#ffd890',
  },
  rift: {
    wood: ['#6a5680', '#4e3e66', '#392d4e', '#221a31'], metal: ['#6c5c8c', '#4f4372', '#3b3158', '#251e39'],
    main: ['#9a70d2', '#6e4aaa', '#4c3080', '#26183e'], trim: ['#56467c', '#403460', '#30274c', '#1d1731'],
    alt: ['#d49ae8', '#a868c8', '#7a44a0', '#40205a'],
    flags: ['main', 'trim', 'alt'], strip: 'alt', emblem: 'rune', rope: '#221a31',
    rune: ['#ffd8f8', '#ff8ae8'],
    glass: ['#ffe0fa', '#e8a8ff'], glow: ['#ffe8fc', '#ff9ae8'], light: '#e08cff',
  },
};
const EMBLEM = {
  sun: ['.###.', '#...#', '#.#.#', '#...#', '.###.'],
  diamond: ['..#..', '.###.', '##.##', '.###.', '..#..'],
  flake: ['..#..', '#.#.#', '.###.', '#.#.#', '..#..'],
  rune: ['#...#', '.#.#.', '..#..', '..#..', '.###.'],
};
// lantern body, pivot = the ring at (3, 0). O outline, h/b/s metal, G glass, g glass core (glass = emissive)
const LANTERN = ['...O...', '..hbs..', '.hbbbsO', '.bGGGsO', '.bGgGsO', '.bGGGsO', '.hbbbsO', '..OOO..'];
// the sprites' light, from the screen's top-left a bit toward the viewer, in (right, up, toward camera) (cloth.js LIGHT)
const LR = -.551, LU = .621, LT = .561;
const CP = .34, SP_ = .94;   // sprite camera pitch 20 deg: toward-camera = (0, .94, .34), screen-up = (0, -.34, .94) in (x, y, z)

// ORDER (core/features.js): first: the others read its wind (they declare after: ['wind'])
export const order = {};
export async function create(host) {
  const ctx = host.ctxO, G = host.G;
  const Q = flags;
  const W = {name: 'wind', label: 'Wind', key: '5', ambient: true,  on: Q.get('wind') !== '0', ms: 0, gust: 0, dir: [.94, .34], tune: TUNE, TUNE};
  { const l = Math.hypot(W.dir[0], W.dir[1]); W.dir = [W.dir[0] / l, W.dir[1] / l]; }
  const [UX, UY] = W.dir;
  let biome = 'ruins', B = BIOME.ruins, T = 0, acc = 0;
  // strength: W.mode (MODES), W.level (eased multiplier, LV here for the hot paths), W.strength (the wind at the player,
  // normalised: 1 = a full gust of a plain breeze), W.rustle {e, pan} (what the leaves around the player sound like)
  W.mode = MODES.includes(Q.get('windlevel')) ? Q.get('windlevel') : 'auto'; W.level = LEVELS[W.mode] ?? 1; W.strength = 0; W.rustle = {e: 0, pan: 0};
  let LV = W.level, spell = W.mode === 'auto' ? 'breeze' : W.mode, spellT = 20, wph = 0, wphQ = 0, wtick = -1;
  // 'auto' follows the world clock's weather (host.env.windLevel: calm in fog, brisk on a windy day, a gale in a storm;
  // sim/env.js owns it); without an env, its own spells as before
  function stepStrength(dt) {
    const env = host.env;
    if (W.mode === 'auto' && !env && (spellT -= dt) <= 0) {
      let r = Math.random() * STRENGTH.auto.reduce((s, [, w]) => s + w, 0);
      for (const [k, w] of STRENGTH.auto) if ((r -= w) <= 0) { spell = k; break; }
      spellT = STRENGTH.dwell[0] + Math.random() * (STRENGTH.dwell[1] - STRENGTH.dwell[0]);
    }
    const tg = W.mode === 'auto' ? (env ? env.windLevel : LEVELS[spell]) : LEVELS[W.mode] ?? 1;
    LV += (tg - LV) * Math.min(1, dt / STRENGTH.ease); W.level = LV;
  }
  function setMode(m) { W.mode = m; if (m === 'auto') { spell = 'brisk'; spellT = STRENGTH.dwell[0]; } }
  const R = mulberry32(1);   // seeded (core/rng.js)
  const rr = a => a[0] + R() * (a[1] - a[0]);
  const tick = t0 => { acc += performance.now() - t0; };
  const vref = () => (B.base + B.gust) || 1;

  // ================================================================ the camera (main.js turns it any time)
  // screen right on the ground = (RX, RY), toward the camera = (FX, FY), both in arena (x, y); ZM = zoom
  let RX = 1, RY = 0, FX = 0, FY = 1, ZM = 1, YAW = 0;
  const VB = {cx: 0, cy: 0, hw: 10, hh: 6};   // the view in view-frame metres at ground level: centre, half sizes
  function viewSync() {
    YAW = host.yaw; RX = Math.cos(YAW); RY = -Math.sin(YAW); FX = Math.sin(YAW); FY = Math.cos(YAW); ZM = host.zoom || 1;
    const T3 = G.view.T, vx = T3.x * RX + T3.z * RY, vy = T3.x * FX + T3.z * FY;
    VB.cx = vx; VB.cy = vy - T3.y * ctx.PPMH / ctx.PPMY; VB.hw = ctx.VW / 2 / (ctx.PPM * ZM); VB.hh = ctx.VH / 2 / (ctx.PPMY * ZM);
  }
  // the arena's viewRect(m) test, in the turned view: 2 m to the sides, 1 m above, 5.5 m below (tall things)
  const vis = (x, y, m = 0) => {
    const dx = x * RX + y * RY - VB.cx, dy = x * FX + y * FY - VB.cy;
    return dx > -VB.hw - 2 - m && dx < VB.hw + 2 + m && dy > -VB.hh - 1 - m && dy < VB.hh + 5.5 + m;
  };
  const viewCentre = () => [VB.cx * RX + VB.cy * FX, VB.cx * RY + VB.cy * FY];   // view metres -> world (x, y)
  // the player in the world frame, read once per step (host.player's getters convert on every read)
  const PL = {x: 0, y: 0, z: 0, vx: 0, vy: 0, state: '', ok: false};
  function readPlayer() { const p = host.player; if (!p) return; PL.x = p.x; PL.y = p.y; PL.z = p.z || 0; PL.vx = p.vx || 0; PL.vy = p.vy || 0; PL.state = p.state; PL.ok = true; }

  // ================================================================ gust field (the arena's, unchanged)
  const fronts = []; let nextF = 0, S0 = 0, S1 = 60, T0 = -25, T1 = 30;
  function extent() {
    const c = [[0, 0], [ctx.WM, 0], [0, ctx.HM], [ctx.WM, ctx.HM]];
    const sv = c.map(([x, y]) => x * UX + y * UY), tv = c.map(([x, y]) => -x * UY + y * UX);
    S0 = Math.min(...sv); S1 = Math.max(...sv); T0 = Math.min(...tv); T1 = Math.max(...tv);
  }
  const ring = () => ctx.layout?.ring || {x: (ctx.PLAY.x0 + ctx.PLAY.x1) / 2, y: (ctx.PLAY.y0 + ctx.PLAY.y1) / 2};
  function newFront(F, A) {
    const Gf = B.fronts;
    return {F, v: rr(Gf.speed), len: rr(Gf.len), A: A ?? rr(Gf.amp), edge: rr(Gf.edge), tc: T0 + R() * (T1 - T0), half: rr(Gf.half),
      k1: .16 + R() * .22, k2: .42 + R() * .45, k3: .1 + R() * .2, p1: R() * TAU, p2: R() * TAU, p3: R() * TAU, w1: .2 + R() * .3, w2: .15 + R() * .3};
  }
  const newPulse = () => { const Gp = B.pulse; return {F: -.5, v: rr(Gp.speed), len: rr(Gp.len), A: rr(Gp.amp), edge: .4 + R() * .5, k1: 2 + (R() * 3 | 0), p1: R() * TAU, w1: .25 + R() * .3}; };
  function stepField(dt) {
    nextF -= dt;
    if (nextF <= 0) {
      if (B.pulse) { nextF = rr(B.pulse.every); fronts.push(newPulse()); }
      else { nextF = rr(B.fronts.every) / Math.sqrt(Math.max(.5, LV)); fronts.push(newFront(S0 - 4.5)); }   // windier: gusts come oftener
    }
    const end = B.pulse ? 48 : S1 + 4;
    for (let i = fronts.length - 1; i >= 0; i--) { const f = fronts[i]; f.F += f.v * dt; if (f.F - f.len - f.edge > end) fronts.splice(i, 1); }
  }
  const env = (e, len) => { const rise = Math.min(1.6, len * .22), hold = len * .34; return e < rise ? smooth(e / rise) : e < hold ? 1 : 1 - smooth((e - hold) / (len - hold)); };
  const FA = {x: 0, y: 0, g: 0};   // scratch result (no allocations in the hot paths)
  function field(x, y) {
    if (!W.on) { FA.x = FA.y = FA.g = 0; return FA; }
    let q = 1;
    if (B.pulse) {
      const rg = ring(), dx = x - rg.x, dy = y - rg.y, d = hypot2(dx, dy) || 1e-3, a = Math.atan2(dy, dx);
      for (const f of fronts) {
        const e = f.F + f.edge * Math.sin(a * f.k1 + f.p1 + T * f.w1) - d;
        if (e > 0 && e < f.len) q *= 1 - f.A * env(e, f.len);
      }
      const g = 1 - q, v = g * B.gust * LV; FA.x = dx / d * v; FA.y = dy / d * v; FA.g = g; return FA;
    }
    const sA = x * UX + y * UY, tA = -x * UY + y * UX;
    for (const f of fronts) {
      const e = f.F + f.edge * (.62 * Math.sin(tA * f.k1 + f.p1 + T * f.w1) + .38 * Math.sin(tA * f.k2 + f.p2 - T * f.w2)) - sA;
      if (e <= 0 || e >= f.len) continue;
      const lat = smooth((f.half - Math.abs(tA - f.tc)) / 4); if (lat <= 0) continue;
      q *= 1 - f.A * lat * env(e, f.len) * (.8 + .2 * Math.sin(tA * f.k3 + f.p3));
    }
    const g = 1 - q, v = (B.base + g * B.gust) * LV, tw = g * B.gust * LV * .12 * Math.sin(T * 1.9 + sA * .5);   // LV: the strength
    FA.x = UX * v - UY * tw; FA.y = UY * v + UX * tw; FA.g = g; return FA;
  }
  function seedField() {
    fronts.length = 0; nextF = 0; R.seed({ruins: 101, ember: 202, frost: 303, rift: 404}[biome] || 1);
    extent();
    for (let t = 0; t < 30; t += .25) stepField(.25);   // a steady state: fronts already on the map
  }

  // ================================================================ foliage
  const FOLK = {tuft: 1, bush: 1, tree: 1, reed: 1, fern: 1};
  const fst = new Map();   // prop -> spring state (2D lean in px, world axes)
  let fol = null, folN = -1, folArr = null;
  // (re-made when the registry's membership changes: host.propsVersion bumps on every join / leave, world/entities.js)
  const folList = () => { const P = host.props, v = host.propsVersion ?? P.length; if (!fol || P !== folArr || v !== folN) { fol = P.filter(p => FOLK[p.kind]); folN = v; folArr = P; } return fol; };
  // NEAR: the foliage round the view and within 16 m of the player (the rustle's reach), from an 8 m cell index built when
  // the props change; the list is redone only when that box crosses a cell edge. The per-step loops (sway, arrows through
  // the leaves, shedding, rustle; windlines.js through W.foliage()) visit NEAR, never all the props
  const CELL = 8, cells = new Map(), near = [], NB = {c0: 0, c1: -1, r0: 0, r1: -1, of: null};
  const cellKey = (cx, cy) => (cx + 512) * 1024 + cy + 512;
  let cellsOf = null;
  function nearList() {
    const L = folList();
    if (cellsOf !== L) {
      cellsOf = L; cells.clear(); NB.of = null;
      for (const p of L) { const key = cellKey(Math.floor(p.x / CELL), Math.floor(p.y / CELL)); let c = cells.get(key); if (!c) cells.set(key, c = []); c.push(p); }
    }
    // the box: the view's corners as vis() sees them (+ 2 m), and the player +- 16 m, in the world
    let x0 = PL.x - 16, x1 = PL.x + 16, y0 = PL.y - 16, y1 = PL.y + 16;
    for (let i = 0; i < 4; i++) {
      const vx = VB.cx + (i & 1 ? VB.hw + 4 : -VB.hw - 4), vy = VB.cy + (i & 2 ? VB.hh + 7.5 : -VB.hh - 3), x = vx * RX + vy * FX, y = vx * RY + vy * FY;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const c0 = Math.floor(x0 / CELL), c1 = Math.floor(x1 / CELL), r0 = Math.floor(y0 / CELL), r1 = Math.floor(y1 / CELL);
    if (NB.of === L && c0 === NB.c0 && c1 === NB.c1 && r0 === NB.r0 && r1 === NB.r1) return near;
    NB.of = L; NB.c0 = c0; NB.c1 = c1; NB.r0 = r0; NB.r1 = r1; near.length = 0;
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) { const c = cells.get(cellKey(cx, cy)); if (c) for (const p of c) near.push(p); }
    return near;
  }
  function flexOf(p) {
    const F = FLEX[biome]; if (!F) return null;
    if (p.kind === 'tree' && F.dead && (p.variant | 0) === 2) return F.dead;
    if (p.kind === 'tree' && F.willow && (p.variant | 0) === 3) return F.willow;
    return F[p.kind] || null;
  }
  // our own sprite canvases only (never the screen)
  const scr = mk(1, 1), sq = scr.getContext('2d', {willReadFrequently: true});
  function readPx(img) {
    const w = img.width, h = img.height; if (scr.width < w || scr.height < h) { scr.width = Math.max(scr.width, w); scr.height = Math.max(scr.height, h); }
    sq.clearRect(0, 0, w, h); sq.drawImage(img, 0, 0); return sq.getImageData(0, 0, w, h).data;
  }
  // per sprite: the arena's row weights (weights() in arena/wind.js: base rows fixed, tree trunks stiff, crowns move as a
  // block), then fitted to the host's bend curve: 8 knots over the CARD's height (0 = bottom row .. 1 = top row, linear
  // between), least squares over the rows, so each row's whole-pixel offset round(D * w) matches the arena's
  const shapes = new WeakMap();
  function shapeOf(img) {
    let S = shapes.get(img); if (S) return S;
    const w = img.width, h = img.height, d = readPx(img), wid = new Uint16Array(h); let top = h, base = -1;
    for (let y = 0; y < h; y++) { let x0 = -1, x1 = -1; for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]) { if (x0 < 0) x0 = x; x1 = x; } if (x0 >= 0) { wid[y] = x1 - x0 + 1; if (y < top) top = y; base = y; } }
    S = {h, top: Math.min(top, h - 1), base: Math.max(base, 0), wid, bend: {}}; shapes.set(img, S); return S;
  }
  function rowWeights(S, curve) {   // the arena's weights(img, curve), row by row (0 = the image's top row)
    const {h, top, base, wid} = S, span = Math.max(1, base - top), Wt = new Float32Array(h);
    let c = .35;
    if (curve === 'crown') {   // the crown starts where the silhouette gets much wider than the trunk
      const tr = []; for (let y = Math.round(base - span * .2); y <= Math.round(base - span * .08); y++) tr.push(wid[y]);
      tr.sort((a, b) => a - b); const tw = Math.max(3, tr[tr.length >> 1] || 3);
      for (let y = Math.round(base - span * .12); y > top + 2; y--) if (wid[y] > tw * 2.4 && wid[y - 1] > tw * 2.4 && wid[y - 2] > tw * 2.4) { c = (base - y) / span; break; }
      c = clamp(c, .15, .6);
    }
    const fn = CURVES[curve] || CURVES.bush;
    for (let y = 0; y < h; y++) Wt[y] = fn(clamp((base - y) / span, 0, 1), c);
    return Wt;
  }
  function bendOf(img, curve) {
    const S = shapeOf(img); if (S.bend[curve]) return S.bend[curve];
    const Wt = rowWeights(S, curve), h = S.h, A = Array.from({length: 8}, () => new Float64Array(9));
    for (let r = 0; r < h; r++) {   // row r's centre sits at height fraction 1 - (r + .5) / h; hat basis on the 8 knots
      const f = (1 - (r + .5) / h) * 7, i = Math.min(6, Math.floor(f)), t = f - i, ph = [[i, 1 - t], [i + 1, t]];
      const wr = r >= S.top - 1 && r <= S.base + 1 ? 1 : .05;   // the opaque rows matter, the empty margin barely
      for (const [a, pa] of ph) { for (const [b, pb] of ph) A[a][b] += wr * pa * pb; A[a][8] += wr * pa * Wt[r]; }
    }
    for (let k = 0; k < 8; k++) A[k][k] += 1e-4;   // (a knot with no rows near it stays put)
    for (let k = 0; k < 8; k++) {   // Gauss-Jordan on the 8 x 8 normal equations
      let p = k; for (let q = k + 1; q < 8; q++) if (Math.abs(A[q][k]) > Math.abs(A[p][k])) p = q;
      [A[k], A[p]] = [A[p], A[k]];
      for (let q = 0; q < 8; q++) if (q !== k) { const m = A[q][k] / A[k][k]; for (let j = k; j < 9; j++) A[q][j] -= m * A[k][j]; }
    }
    const out = new Float32Array(8); for (let k = 0; k < 8; k++) out[k] = A[k][8] / A[k][k];
    return (S.bend[curve] = out);
  }
  function stepFoliage(dt) {
    const pvx = PL.vx, pvy = PL.vy, spd = hypot2(pvx, pvy), roll = PL.state === 'roll', VR = vref();
    const svx = pvx * RX + pvy * RY;   // his velocity along the screen's x (the arena's pvx)
    for (const p of nearList()) {
      if (!vis(p.x, p.y)) continue;
      const F = flexOf(p); if (!F) continue;
      let st = fst.get(p);
      if (!st) fst.set(p, st = {dx: 0, dy: 0, vx: 0, vy: 0, disp: 0, push: 0, shake: 0, ph: hsh(p.x * 100 | 0, p.y * 100 | 0) * TAU, g: 0, D: 0});
      const a = field(p.x, p.y), nx = a.x / VR * B.sway, ny = a.y / VR * B.sway;
      const fq = F.fq * (.85 + .15 * LV);   // a stronger wind flutters faster and harder
      const fl = (TUNE.idle + a.g * TUNE.flutter) * (.55 + .45 * LV) * (.65 * Math.sin(T * fq * TAU + st.ph) + .35 * Math.sin(T * fq * TAU * 1.73 + st.ph * 2.1));
      let push = 0; const PU = TUNE.push[p.kind];
      if (PU && (spd > .8 || roll) && Math.abs((p.z || 0) - PL.z) < .5) {   // running / rolling past pushes it away from him
        const ox = p.x - PL.x, oy = p.y - PL.y, sx = ox * RX + oy * RY, sy = (ox * FX + oy * FY) * 1.3, dd = hypot2(sx, sy);
        if (dd < PU[0]) {   // brushed along with his motion (sideways on screen), or away from him when he barely moves sideways
          const side = Math.abs(svx) > .8 ? Math.sign(svx) : Math.sign(sx || 1);
          push = side * PU[1] * (1 - dd / PU[0]) * Math.min(1.3, spd / 4 + (roll ? .6 : 0));
          const k = push * F.w * 2.2 * dt; st.vx += RX * k; st.vy += RY * k;   // a kick: a quick brush still bends it
        }
      }
      st.push += (push - st.push) * Math.min(1, dt * (push ? 25 : 10));
      // target lean: the wind along the wind (world), the flutter and the brush along the screen's x
      const tx = F.px * (nx + fl * RX) + st.push * RX, ty = F.px * (ny + fl * RY) + st.push * RY, w2 = F.w * F.w, zw = 2 * F.z * F.w;
      st.vx += (w2 * (tx - st.dx) - zw * st.vx) * dt; st.vy += (w2 * (ty - st.dy) - zw * st.vy) * dt;
      st.dx += st.vx * dt; st.dy += st.vy * dt;
      const lim = F.px * Math.max(1, LV) + 1.5, l = hypot2(st.dx, st.dy); if (l > lim) { st.dx *= lim / l; st.dy *= lim / l; }
      st.shake *= Math.exp(-dt * 4.5);
      if (a.g > .62 && st.g <= .62) gustShed(p);   // a gust front arriving
      st.g = a.g;
    }
  }
  // the lean on screen (px at the top, + = right), with the arena's hysteresis and the arrow shudder
  function swayOf(st) {
    const sd = st.dx * RX + st.dy * RY;
    if (Math.abs(sd - st.disp) > TUNE.hyst) st.disp = sd;
    const D = st.disp + (st.shake > .05 ? st.shake * 1.7 * Math.sin(T * 44 + st.ph) : 0);
    st.D = D; return D;
  }

  // ================================================================ live flames (brazier, torch): the arena's renderer
  const flames = new Map();   // prop -> cache
  function buildFlame(sp) {
    const E = sp.emit, w = E.width, h = E.height;
    const ed = new Uint32Array(readPx(E).slice().buffer), ia = readPx(sp.img), base = new Uint32Array(w * h), rows = [];
    let yb = -1, yt = h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, c = ed[i]; if (!(c >>> 24)) continue;
      if (ia[i * 4 + 3]) base[i] = c;   // coals: over the sprite's own pixels (they stay put)
      else { (rows[y] ||= []).push(x, c); if (y > yb) yb = y; if (y < yt) yt = y; }
    }
    if (yb < 0) return null;
    const N = yb - yt + 1, R2 = [];
    for (let k = 0; k < N; k++) {   // k = 0 is the flame's bottom row
      const a = rows[yb - k] || [], xs = [], cs = []; let sx = 0;
      for (let j = 0; j < a.length; j += 2) { xs.push(a[j]); cs.push(a[j + 1]); sx += a[j]; }
      R2.push({xs, cs, cx: xs.length ? sx / xs.length : NaN});
    }
    const cv = mk(w, h), buf = new Uint32Array(w * h);
    return {src: E, w, h, base, rows: R2, N, yb, cv, q: cv.getContext('2d'), buf, im: new ImageData(new Uint8ClampedArray(buf.buffer), w, h), step: -1, hk: 1, lean: 0, ph: R() * TAU};
  }
  function renderFlame(c, p) {
    const a = field(p.x, p.y), nx = (a.x * RX + a.y * RY) / vref() * B.sway, {w, N, buf, rows} = c;   // leans downwind ON SCREEN
    c.lean += (clamp(nx * 3.3, -3, 3) + Math.sin(T * 2.3 + c.ph) * .35 - c.lean) * .5;
    c.hk += (.74 + R() * .26 - a.g * .1 - c.hk) * .6;
    const No = clamp(Math.round(N * c.hk), Math.max(3, N - 4), N);
    buf.set(c.base);
    let tipX = NaN, tipC = 0;
    for (let r = 0; r < No; r++) {
      const src = rows[Math.min(N - 1, Math.floor(r * N / No))]; if (!src.xs.length) continue;
      const t = No > 1 ? r / (No - 1) : 0;
      let sh = Math.round(c.lean * t ** 1.6);
      if (t > .45 && R() < .22) sh += R() < .5 ? -1 : 1;   // the tip licks
      const y = c.yb - r; if (y < 0) continue;
      for (let j = 0; j < src.xs.length; j++) { const x = src.xs[j] + sh; if (x >= 0 && x < w) buf[y * w + x] = src.cs[j]; }
      tipX = src.cx + sh; tipC = src.cs[src.cs.length >> 1];
    }
    if (R() < .28 && tipX === tipX) {   // a detached ember above the tip
      const y = c.yb - No - 1 - (R() * 3 | 0), x = Math.round(tipX + c.lean * .5 + (R() - .5) * 2);
      if (y >= 0 && x >= 0 && x < w) buf[y * w + x] = tipC;
    }
    c.q.putImageData(c.im, 0, 0);
    c.cv.version = (c.cv.version || 0) + 1;   // gfx tex(): re-uploaded only when repainted (12 fps), not every frame
  }
  function flameOf(p, sp) {
    let c = flames.get(p);
    if (!c || c.src !== sp.emit) { c = buildFlame(sp); if (!c) return null; flames.set(p, c); }
    const step = Math.floor(T * TUNE.flameFps);
    if (c.step !== step) { c.step = step; renderFlame(c, p); }
    return c.cv;
  }
  // the host's card hook: every painted prop card, every frame
  // foliage: {sway: D (the top opaque row's offset, px), bend: the arena's per-row flex}; the host shifts each row by
  // round(D * weight) whole pixels (the arena's drawProp bands). Braziers / torches: {em: the live flame}.
  const HK = {sway: 0, em: null, bend: null};
  function card(it, sp) {
    const p = it.p; if (!W.on || !sp) return null;
    const k = p.kind;
    if (FOLK[k]) {
      const F = flexOf(p), st = F && fst.get(p); if (!st) return null;
      const t0 = performance.now();
      HK.sway = swayOf(st); HK.bend = bendOf(sp.img, F.curve); HK.em = null; tick(t0); return HK;
    }
    if ((k === 'brazier' || k === 'torch') && sp.emit) {
      const t0 = performance.now(), cv = flameOf(p, sp); tick(t0);
      if (!cv) return null; HK.sway = 0; HK.bend = null; HK.em = cv; return HK;
    }
    return null;
  }
  // the host's MESH hook: a 3D tree (render3d/trees3d.js) on the same spring as its card would be. {x, y: the lean at the
  // top in metres (arena axes: the spring's px / PPM), shake: the arrow shudder, art px along the screen's x}. The host
  // projects it, keeps the hysteresis, and the shader bends the model by its baked weights (stiff trunk, crown as a block)
  // + the leaves' own dance (flut, art px) and a band of light rolling through them along the wind (wx, wy, ph, wave), both
  // growing with the gust at the tree x the strength (a breeze between gusts leaves the crown still: STRENGTH.danceMin)
  const MH = {x: 0, y: 0, shake: 0, flut: 0, wx: 1, wy: 0, ph: 0, wave: 0};
  function mesh(it) {
    const p = it.p; if (!W.on || !FOLK[p.kind]) return null;
    const F = flexOf(p), st = F && fst.get(p); if (!st) return null;
    const k = STRENGTH.tree3d / ctx.PPM, a = field(p.x, p.y), e = LV * (.25 + a.g), sp = hypot2(a.x, a.y) || 1;
    MH.x = st.dx * k; MH.y = st.dy * k; MH.shake = st.shake > .05 ? st.shake * 1.7 * Math.sin(T * 44 + st.ph) : 0;
    MH.flut = Math.min(3, Math.max(0, e * STRENGTH.dance - STRENGTH.danceMin));
    MH.wx = a.x / sp; MH.wy = a.y / sp; MH.ph = wphQ; MH.wave = Math.min(.24, LV * a.g * STRENGTH.wave);
    return MH;
  }

  // ================================================================ cloth decor (the arena's Verlet pieces)
  // A piece is a Verlet grid (cols x rows) in world metres. u runs along cols, v along rows; d = 0 at the pinned edge ..
  // 1 at the free edge (flutter grows toward it). pat(u, v) -> -1 (no cloth) | ramp index (+64 emissive, +128 rime).
  function grid(o) {
    const {cols, rows} = o, n = cols * rows, P = new Float32Array(n * 3), U = new Float32Array(n), Vv = new Float32Array(n), Dd = new Float32Array(n), pin = new Uint8Array(n);
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const i = r * cols + k, fu = cols > 1 ? k / (cols - 1) : 0, fv = rows > 1 ? r / (rows - 1) : 0, sag = o.sag ? o.sag * 4 * fu * (1 - fu) : 0;
      P[i * 3] = o.org[0] + o.ax[0] * fu + o.ay[0] * fv; P[i * 3 + 1] = o.org[1] + o.ax[1] * fu + o.ay[1] * fv; P[i * 3 + 2] = o.org[2] + o.ax[2] * fu + o.ay[2] * fv - sag;
      U[i] = fu; Vv[i] = fv; pin[i] = o.pin(r, k, cols, rows) ? 1 : 0; Dd[i] = o.dist ? o.dist(fu, fv) : fv;
    }
    const L = [];
    const link = (a, b, st) => { const dx = P[b * 3] - P[a * 3], dy = P[b * 3 + 1] - P[a * 3 + 1], dz = P[b * 3 + 2] - P[a * 3 + 2]; L.push(a, b, Math.hypot(dx, dy, dz), st); };
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const i = r * cols + k;
      if (k + 1 < cols) link(i, i + 1, 1);
      if (r + 1 < rows) link(i, i + cols, 1);
      if (r + 1 < rows && k + 1 < cols) { link(i, i + cols + 1, .6); link(i + 1, i + cols, .6); }
      if (o.bend !== 0 && k + 2 < cols) link(i, i + 2, o.bend ?? .3);
      if (o.bend !== 0 && r + 2 < rows) link(i, i + cols * 2, o.bend ?? .3);
    }
    return {cols, rows, n, P, O: P.slice(), P0: P.slice(), N: new Float32Array(n * 3), U, V: Vv, D: Dd, pin, L: Float32Array.from(L),
      k: o.k, flut: o.flut ?? 1, waves: o.waves ?? 1, freq: o.freq ?? 2, seed: R() * TAU, iters: o.iters ?? 3, damp: o.damp ?? .985,
      minY: o.minY ?? null, minX: o.minX ?? null, pat: o.pat || (() => 0), outline: o.outline || 'in', fray: !!o.fray, rope: o.rope ?? null, pinFn: o.pinFn || null,
      SX: new Float32Array(n), SY: new Float32Array(n), ZT: new Float32Array(n), LM: new Float32Array(n), nRest: null, wind0: 0};
  }
  function normals(pc) {
    const {P, N, cols, rows} = pc;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const i = r * cols + k, a = (r * cols + Math.min(cols - 1, k + 1)) * 3, b = (r * cols + Math.max(0, k - 1)) * 3;
      const c = (Math.min(rows - 1, r + 1) * cols + k) * 3, d = (Math.max(0, r - 1) * cols + k) * 3;
      const ux = P[a] - P[b], uy = P[a + 1] - P[b + 1], uz = P[a + 2] - P[b + 2], vx = P[c] - P[d], vy = P[c + 1] - P[d + 1], vz = P[c + 2] - P[d + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = hypot3(nx, ny, nz) || 1;
      N[i * 3] = nx / l; N[i * 3 + 1] = ny / l; N[i * 3 + 2] = nz / l;
    }
  }
  function simPiece(pc, h, wx, wy, g, lift = 0) {
    const {P, O, pin, n, D, U, N} = pc, k = pc.k, damp = pc.damp, h2 = h * h, ih = 1 / h;
    const fl = pc.flut * (TUNE.clothIdle + g) * TUNE.clothV * hypot3(pc.nx, pc.ny, .25);
    if (pc.pinFn) pc.pinFn(pc);
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      if (pin[i]) { O[j] = P[j]; O[j + 1] = P[j + 1]; O[j + 2] = P[j + 2]; P[j] = pc.P0[j]; P[j + 1] = pc.P0[j + 1]; P[j + 2] = pc.P0[j + 2]; continue; }
      const vx = (P[j] - O[j]) * damp, vy = (P[j + 1] - O[j + 1]) * damp, vz = (P[j + 2] - O[j + 2]) * damp;
      const f = fl * D[i] * Math.sin(TAU * (D[i] * pc.waves - T * pc.freq) + U[i] * 1.3 + pc.seed);
      const ax = k * (wx - vx * ih) + f * N[j], ay = k * (wy - vy * ih) + f * N[j + 1], az = lift * D[i] - 9.8 - k * vz * ih + f * N[j + 2];
      O[j] = P[j]; O[j + 1] = P[j + 1]; O[j + 2] = P[j + 2];
      P[j] += vx + ax * h2; P[j + 1] += vy + ay * h2; P[j + 2] += vz + az * h2;
    }
    const L = pc.L, m = L.length;
    for (let it = 0; it < pc.iters; it++) {
      for (let l = 0; l < m; l += 4) {
        const a = L[l] * 3, b = L[l + 1] * 3, wa = pin[L[l]] ? 0 : 1, wb = pin[L[l + 1]] ? 0 : 1, w = wa + wb; if (!w) continue;
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2], d = hypot3(dx, dy, dz) || 1e-6;
        const q = (d - L[l + 2]) / d * L[l + 3] / w;
        if (wa) { P[a] += dx * q; P[a + 1] += dy * q; P[a + 2] += dz * q; }
        if (wb) { P[b] -= dx * q; P[b + 1] -= dy * q; P[b + 2] -= dz * q; }
      }
      if (pc.minY !== null) for (let i = 0; i < n; i++) if (P[i * 3 + 1] < pc.minY) P[i * 3 + 1] = pc.minY;
      if (pc.minX !== null) for (let i = 0; i < n; i++) if (P[i * 3] < pc.minX) P[i * 3] = pc.minX;   // (a cloth east of its pole)
    }
    for (let i = 0; i < n; i++) if (P[i * 3 + 2] < .03) P[i * 3 + 2] = .03;
    if (pc.cols > 1 && pc.rows > 1) normals(pc);
  }
  function kick(pc, vx, vy, vz, sc = 1) {   // add a velocity (m/s over one 1/60 s step) to the free nodes
    for (let i = 0; i < pc.n; i++) if (!pc.pin[i]) { const j = i * 3, f = sc * (.4 + .6 * pc.D[i]) / 60; pc.O[j] -= vx * f; pc.O[j + 1] -= vy * f; pc.O[j + 2] -= vz * f; }
  }

  // ---------------------------------------------------------------- static decor sprites (posts, mast, lanterns): one atlas
  function paint(w, h, fn) {
    const c = mk(w, h), q = c.getContext('2d'), im = q.createImageData(c.width, c.height), d = new Uint32Array(im.data.buffer);
    fn((x, y, col) => { x = Math.round(x); y = Math.round(y); if (col && x >= 0 && y >= 0 && x < w && y < h) d[y * w + x] = typeof col === 'number' ? col : rgba(col); });
    q.putImageData(im, 0, 0); return c;
  }
  // a wooden post, 3 px: lit-side outline (shade), base, dark outline; a metal cap; pivot = bottom centre. (The arena's
  // lantern post carries its arm in the sprite; here the arm is world lines so it points east whatever the camera does.)
  function postSprite(Rm, M, hPx) {
    const w = 3, hh = hPx + 2;
    const img = paint(w, hh, put => {
      for (let y = 2; y < hh; y++) { put(0, y, Rm[2]); put(1, y, y < 5 ? Rm[0] : Rm[1]); put(2, y, Rm[3]); }
      put(0, 1, M[1]); put(1, 1, M[0]); put(2, 1, M[3]); put(1, 0, M[1]);
      put(0, hh - 1, Rm[3]); put(1, hh - 1, Rm[3]);
    });
    return {img, px: 1, py: hh - 1};
  }
  function metalPole(M, hPx) {   // 2 px mast with a finial; pivot = bottom (left px)
    const img = paint(3, hPx + 3, put => {
      for (let y = 3; y < hPx + 3; y++) { put(0, y, M[1]); put(1, y, M[3]); }
      put(0, 2, M[0]); put(1, 2, M[2]); put(0, 1, M[0]); put(1, 1, M[1]); put(2, 1, M[3]); put(0, 0, M[1]);
    });
    return {img, px: 0, py: hPx + 2};
  }
  function lanternSprites(pal) {   // body (albedo) + 2 glow frames (emit, same layout)
    const M = pal.metal, col = {O: M[3], h: M[0], b: M[1], s: M[2], G: pal.glass[1], g: pal.glass[0]};
    const body = paint(7, 8, put => LANTERN.forEach((row, y) => [...row].forEach((ch, x) => put(x, y, col[ch]))));
    const glow = [0, 1].map(f => paint(7, 8, put => LANTERN.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === 'g') put(x, y, pal.glow[0]); else if (ch === 'G') put(x, y, f && (x + y) % 3 === 0 ? pal.glow[0] : pal.glow[1]);
    }))));
    return {body, glow};
  }
  // the static atlas: albedo + emit canvases, a shelf packer; add(img, px, py, em?) -> {sx, sy, sw, sh, px, py}
  let DA = null;
  function decorAtlas() {
    const list = [];
    const A = {list, add(img, px, py, em = null) { const e = {img, em, px, py, sx: 0, sy: 0, sw: img.width, sh: img.height}; list.push(e); return e; },
      build() {
        let x = 1, y = 1, rowH = 0; const Wd = 256;
        for (const e of list) { if (x + e.sw + 1 > Wd) { x = 1; y += rowH + 1; rowH = 0; } e.sx = x; e.sy = y; x += e.sw + 1; rowH = Math.max(rowH, e.sh); }
        A.cv = mk(Wd, y + rowH + 1); A.ecv = mk(Wd, y + rowH + 1);
        const q = A.cv.getContext('2d'), eq = A.ecv.getContext('2d');
        for (const e of list) { q.drawImage(e.img, e.sx, e.sy); if (e.em) eq.drawImage(e.em, e.sx, e.sy); }
      }};
    return A;
  }

  // ---------------------------------------------------------------- decor items
  let decor = [], needDecor = true, lanterns = [];
  const ramp = a => a.map(rgba);
  function emblemPx(kind, du, dv) {   // du, dv: px from the emblem centre -> 0 none, 1 trim colour, 2 emissive glyph
    const E = EMBLEM[kind], gx = Math.floor(du + 2.5), gy = Math.floor(dv + 2.5);
    if (!E || gx < 0 || gy < 0 || gx > 4 || gy > 4 || E[gy][gx] !== '#') return 0;
    return kind === 'rune' ? 2 : 1;
  }
  function bannerPat(pal, wPx, lPx, {point = false, band = false} = {}) {
    const E = pal.emblem, rime = pal.rime;
    return (u, v) => {
      if (pal.fray) { if (v > .8 + .14 * hsh(Math.round(u * wPx), 7)) return -1; }
      else if (point) { if (v > .8 && Math.abs(u - .5) > (1 - v) / .2 * .5) return -1; }
      else if (v > .8 && Math.abs(u - .5) < (v - .8) / .2 * .28) return -1;
      if (rime && (v < .05 || (v < .3 && hsh(Math.round(u * wPx), Math.round(v * lPx), 3) > .86))) return 1 + 128;
      if (v < .08 || u < .08 || u > .92) return 1;
      if (band && v > .16 && v < .2) return 1;
      const e = emblemPx(E, (u - .5) * wPx, (v - (band ? .5 : .42)) * lPx);
      return e === 2 ? 64 : e ? 1 : 0;
    };
  }
  // a rod (the arena's rodSprite) as world lines: [x0, y, h] its left end (top row), wPx its length in px
  const rodOf = (pal, x0, y, h, wPx, alongY = false) => ({x0, y, h, len: (wPx - 1) / ctx.PPM, c: pal.wood, m: pal.metal, alongY});   // x0 / y: its start
  function wallBanner(x, yFace, pal) {
    const w = .5, len = .9, top = 1.12, wPx = w * ctx.PPM, lPx = len * ctx.PPMH;
    const pc = grid({cols: 5, rows: 8, org: [x - w / 2, yFace + .03, top], ax: [w, 0, 0], ay: [0, 0, -len], pin: r => r === 0,
      k: .75, flut: .5, waves: .8, freq: 1.4, minY: yFace + .02, pat: bannerPat(pal, wPx, lPx), fray: pal.fray});
    const it = item('banner', x, yFace + .06, [pc], pal);
    it.anchor = [x, yFace + .06, top]; it.rods = [rodOf(pal, x - w / 2 - .05, yFace + .03, top + .02, Math.round(wPx) + 2)];
    return it;
  }
  // a freestanding banner pole with a crossbar (flanking the east gate). The banner FACES EAST / WEST, toward whoever comes
  // through the gate (its crossbar runs north-south), and hangs on the pole's east side: the prevailing wind (W -> E) hits its
  // face and swings it out, away from the pole (minX keeps it from passing through the pole on a west gust). (It used to
  // span east-west: edge-on to the gate, and the wind blew along its plane, so it barely moved.)
  function standard(x, y, pal) {
    const H = 2.45, w = .5, len = 1.05, wPx = w * ctx.PPM, lPx = len * ctx.PPMH, bar = H - .12;
    const pc = grid({cols: 5, rows: 9, org: [x + .06, y - w / 2, bar - .03], ax: [0, w, 0], ay: [0, 0, -len], pin: r => r === 0,
      k: .9, flut: .6, waves: .8, freq: 1.3, minX: x + .045, pat: bannerPat(pal, wPx, lPx, {point: true, band: true}), fray: pal.fray});
    const it = item('standard', x + .08, y, [pc], pal);
    it.anchor = [x + .08, y, bar]; it.posts = [[DA.add(postSprite(pal.wood, pal.metal, Math.round(H * ctx.PPMH)).img, 1, Math.round(H * ctx.PPMH) + 1), x, y, 0]];
    it.rods = [rodOf(pal, x + .06, y - w / 2 - .09, bar, Math.round(wPx) + 4, true)]; it.shadow = [x, y];
    return it;
  }
  // the tower's roof centre: the top of its 3D model (or the painted sprite's, like the arena, if it has none)
  function towerTop(tp) {
    const geo = host.itemOf(tp)?.live?.gm.geometry;
    if (geo) { const h = topOf(geo, 0, 0); if (h === h) return (tp.z || 0) + h; }
    const sp = host.biome.sprite(tp, ctx); return sp ? (tp.z || 0) + (sp.pivot[1] - TUNE.towerTop) / ctx.PPMH : null;
  }
  function pennant(tp, pal) {   // on a mast on top of a tower
    const hTop = towerTop(tp); if (hTop === null) return null;
    const mast = 1.05, len = .78, hgt = .3, top = hTop + mast - .05, wPx = len * ctx.PPM;
    const pc = grid({cols: 6, rows: 3, org: [tp.x + .04, tp.y + .01, top], ax: [len, 0, 0], ay: [0, 0, -hgt], pin: (r, k) => k === 0,
      k: 4.5, flut: 1.4, waves: .9, freq: 2.2, bend: .45, dist: u => u,
      pat: (u, v) => {
        if (Math.abs(v - .5) > .5 * (1 - u * .94)) return -1;
        if (pal.fray && u > .72 && hsh(Math.round(u * wPx), Math.round(v * 9), 5) > .6) return -1;
        if (pal.rime && Math.abs(v - .5) > .5 * (1 - u * .94) - .12 && u < .5) return 1 + 128;
        return u < .15 ? 1 : 0;
      }, fray: pal.fray});
    const it = item('pennant', tp.x, tp.y + .02, [pc], pal);
    const mp = metalPole(pal.metal, Math.round(mast * ctx.PPMH));
    it.anchor = [tp.x, tp.y + .02, top]; it.posts = [[DA.add(mp.img, mp.px, mp.py), tp.x, tp.y + .01, hTop]];
    return it;
  }
  function flagString(A, Bp, pal) {   // prayer flags on a sagging rope between two poles
    if (Bp.x < A.x) [A, Bp] = [Bp, A];   // west -> east: the flags face the camera (at yaw 0)
    const H = 2.55, len = Math.hypot(Bp.x - A.x, Bp.y - A.y), N = Math.max(6, Math.round(len / .38) + 1);
    const rope = grid({cols: N, rows: 1, org: [A.x, A.y, H], ax: [Bp.x - A.x, Bp.y - A.y, 0], ay: [0, 0, 0], sag: .24, pin: (r, k, c) => k === 0 || k === c - 1,
      k: .8, flut: .15, iters: 6, bend: .05, rope: rgba(pal.rope), dist: u => 4 * u * (1 - u)});
    const pieces = [rope], dx = (Bp.x - A.x) / len, dy = (Bp.y - A.y) / len, fw = .2, fh = .27, nF = Math.floor((len - .7) / .4);
    for (let i = 0; i < nF; i++) {
      const t = (.35 + (i + .5) * (len - .7) / nF) / len, ci = pal.flags[i % pal.flags.length];
      const fx = A.x + (Bp.x - A.x) * t - dx * fw / 2, fy = A.y + (Bp.y - A.y) * t - dy * fw / 2;
      const pc = grid({cols: 3, rows: 3, org: [fx, fy, H], ax: [dx * fw, dy * fw, 0], ay: [0, 0, -fh], pin: r => r === 0, k: 3, flut: 1.1, waves: .6, freq: 2.6, iters: 2, bend: 0,
        pat: (u, v) => pal.rime && v < .12 ? 3 + 128 : 0, fray: false});
      pc.ramp0 = ci; pc.at = [t - fw / 2 / len, t + fw / 2 / len];
      pc.pinFn = q => {   // the top edge rides on the rope
        for (let k = 0; k < 3; k++) {
          const tt = q.at[0] + (q.at[1] - q.at[0]) * k / 2, f = tt * (rope.cols - 1), a = Math.min(rope.cols - 2, Math.floor(f)), e = f - a;
          for (let c = 0; c < 3; c++) q.P0[k * 3 + c] = rope.P[a * 3 + c] * (1 - e) + rope.P[(a + 1) * 3 + c] * e - (c === 2 ? .02 : 0);
        }
      };
      pieces.push(pc);
    }
    const it = item('flags', (A.x + Bp.x) / 2, (A.y + Bp.y) / 2, pieces, pal);
    it.rope = rope;
    // one card per flag, anchored at its top middle (it rides on the rope); the rope itself is world lines
    it.groups = pieces.slice(1).map(pc => ({pieces: [pc], box: null, slot: null, anchor: () => [pc.P[3], pc.P[4], pc.P[5]]}));
    const hPx = Math.round((H + .05) * ctx.PPMH), post = DA.add(postSprite(pal.wood, pal.metal, hPx).img, 1, hPx + 1);
    it.posts = []; it.shadow = [];
    for (const Qp of [A, Bp]) {   // a pole shared by two ropes is drawn once
      const key = Qp.x.toFixed(2) + ',' + Qp.y.toFixed(2); if (poleKeys.has(key)) continue; poleKeys.add(key);
      it.posts.push([post, Qp.x, Qp.y, 0]); it.shadow.push(Qp.x, Qp.y);
    }
    return it;
  }
  function strips(dp, pal) {   // cloth strips tied to a target dummy's arm (and a short one on the other arm now and then)
    const out = [], rift = biome === 'rift', arms = rift ? [[9, .9, .42]] : [[11, .87, .46]];
    if (!rift && hsh(dp.x * 10 | 0, dp.y * 10 | 0) > .45) arms.push([-11, .87, .3]);
    for (const [ox, oh, len] of arms) {
      const pc = grid({cols: 2, rows: 6, org: [dp.x + ox / ctx.PPM, dp.y + .02, (dp.z || 0) + oh], ax: [.07, 0, 0], ay: [0, 0, -len], pin: r => r === 0,
        k: 3.2, flut: 1.2, waves: .7, freq: 2.4, bend: .4, outline: 'out', pat: (u, v) => pal.rime && v < .15 ? 1 + 128 : 0});
      pc.ramp0 = pal.strip;
      // the dummy is a camera-facing card, so its arm is always on the screen's x: the strip's knot follows the camera
      pc.pinFn = q => {
        const wob = dp.wob ? Math.round(Math.sin(dp.wob * 18) * dp.wob * 2) / ctx.PPM : 0;
        for (let k = 0; k < 2; k++) {
          const o = ox / ctx.PPM + wob + k * .07 - .035;
          q.P0[k * 3] = dp.x + RX * o + FX * .02; q.P0[k * 3 + 1] = dp.y + RY * o + FY * .02; q.P0[k * 3 + 2] = (dp.z || 0) + oh;
        }
      };
      out.push(pc);
    }
    const it = item('strips', dp.x, dp.y + .02, out, pal);
    it.dummy = dp;
    it.groups = [{pieces: out, box: null, slot: null, anchor: () => [dp.x + FX * .06, dp.y + FY * .06, (dp.z || 0) + .9]}];   // just in front of the dummy
    return it;
  }
  function lantern(x, y, pal, i) {
    const H = 1.9, arm = .42, chain = .28, px = Math.round(arm * ctx.PPM), hPx = Math.round(H * ctx.PPMH);
    const spr = lanternSprites(pal), post = DA.add(postSprite(pal.wood, pal.metal, hPx).img, 1, hPx + 1);
    const body = [DA.add(spr.body, 3, 0, spr.glow[0]), DA.add(spr.body, 3, 0, spr.glow[1])];
    // the chain hangs from the hook under the arm's tip (the arena's sprite: column px + 3, row 5; pivot column 1, bottom row hPx + 1)
    const L = {x, y, H, ax: x + (px + 2.5) / ctx.PPM, az: (hPx - 5) / ctx.PPMH, chain, bx: 0, by: 0, bz: 0, ox: 0, oy: 0, oz: 0, body, id: 7700 + i, pal, ph: R() * TAU,
      armH: (hPx - 2) / ctx.PPMH, armPx: px};
    L.bx = L.ox = L.ax; L.by = L.oy = y; L.bz = L.oz = L.az - chain;
    const it = item('lantern', x, y, [], pal);
    it.posts = [[post, x, y, 0]]; it.shadow = [x, y];
    it.lantern = L; lanterns.push(L); return it;
  }
  function item(kind, x, y, pieces, pal) {
    const it = {kind, x, y, pieces, pal, ramps: {}, groups: null, rastered: false, posts: [], rods: [], shadow: null, anchor: null,
      lantern: null, rope: null, dummy: null, active: false, g: 0};
    for (const k of ['main', 'trim', 'alt', 'blue']) if (pal[k]) it.ramps[k] = ramp(pal[k]);
    it.groups = pieces.length ? [{pieces, box: null, slot: null, anchor: () => it.anchor}] : [];
    for (const pc of pieces) { pc.nx = 0; pc.ny = 0; normals(pc); }
    return it;
  }
  const poleKeys = new Set();
  function buildDecor() {
    needDecor = false; decor = []; lanterns = []; poleKeys.clear();
    const pal = PAL[biome] || PAL.ruins, PLAY = ctx.PLAY, props = host.props, marks = ctx.layout?.marks || [];
    const cx = (PLAY.x0 + PLAY.x1) / 2, cy = (PLAY.y0 + PLAY.y1) / 2;
    const add = it => { if (it) decor.push(it); };
    DA = decorAtlas();
    R.seed(777);
    for (const x of [cx - 3.2, cx + 3.2]) add(wallBanner(x, PLAY.y0, pal));          // flanking the north gate, on the wall's inner face
    for (const y of [cy - 1.85, cy + 1.85]) add(standard(PLAY.x1 + 1.2, y, pal));    // flanking the east gate, trail side
    for (const p of props) if (p.kind === 'tower') add(pennant(p, pal));
    const paths = marks.filter(m => m.type === 'path');
    if (paths.length) {
      const Fp = paths[0].pts[Math.min(2, paths[0].pts.length - 1)], C = {x: Fp[0] + 4.2, y: Fp[1] + 1.4};
      add(flagString({x: Fp[0] + .1, y: Fp[1] - 1.8}, C, pal));
      if (paths.length > 1) add(flagString({x: Fp[0] + 1.2, y: Fp[1] + 4.2}, C, pal));
      const P0 = paths[0].pts, P1 = paths[1]?.pts;
      let li = 0;
      add(lantern(P0[0][0] + 3.5, P0[0][1] - 1.1, pal, li++));
      if (P0.length > 4) add(lantern(P0[3][0] + (P0[4][0] - P0[3][0]) * .5, P0[3][1] + (P0[4][1] - P0[3][1]) * .5 + 1.2, pal, li++));
      if (P1 && P1.length > 2) add(lantern(P1[1][0] + (P1[2][0] - P1[1][0]) * .65 + .5, P1[1][1] + (P1[2][1] - P1[1][1]) * .65 - .7, pal, li++));
    }
    for (const p of props) if (p.kind === 'dummy' && p.target) add(strips(p, pal));
    DA.build();
    resetCloth();
    for (let i = 0; i < 90; i++) stepDecor(1 / 60, true);   // settle: hang still before the first frame
    for (const it of decor) for (const pc of it.pieces) restOf(pc);
  }
  const visItem = it => { const x = it.dummy ? it.dummy.x : it.x, y = it.dummy ? it.dummy.y : it.y; return vis(x, y, 1); };
  let simAcc = 0, nSim = 0;
  function stepDecor(dt, all = false) {
    for (const it of decor) {
      it.active = all || visItem(it);
      if (!it.active) continue;
      const ax = it.dummy ? it.dummy.x : it.x, ay = it.dummy ? it.dummy.y : it.y, a = field(ax, ay), VR = vref();
      it.g = a.g; const nx = a.x / VR * B.sway, ny = a.y / VR * B.sway;
      const lift = B.pulse ? a.g * TUNE.riftLift : 0;   // the rift's rings make cloth float up a little as they pass
      for (const pc of it.pieces) { pc.nx = nx; pc.ny = ny; simPiece(pc, dt, nx * TUNE.clothV, ny * TUNE.clothV, a.g, lift); nSim++; }
      if (it.lantern) stepLantern(it.lantern, dt, nx * TUNE.clothV, ny * TUNE.clothV);
    }
  }
  function stepLantern(L, h, wx, wy) {   // a pendulum: one Verlet node on a fixed-length chain
    const k = 1.1, vx = (L.bx - L.ox) * .99, vy = (L.by - L.oy) * .99, vz = (L.bz - L.oz) * .99, ih = 1 / h;
    L.ox = L.bx; L.oy = L.by; L.oz = L.bz;
    L.bx += vx + k * (wx - vx * ih) * h * h; L.by += vy + k * (wy - vy * ih) * h * h; L.bz += vz + (-9.8 - k * vz * ih) * h * h;
    const dx = L.bx - L.ax, dy = L.by - L.y, dz = L.bz - L.az, d = Math.hypot(dx, dy, dz) || 1e-6;
    L.bx = L.ax + dx / d * L.chain; L.by = L.y + dy / d * L.chain; L.bz = L.az + dz / d * L.chain;
  }
  // the piece at rest after the settle: its mean normal (the tone everything is measured against, per camera angle) and
  // which way it winds as seen from the default camera (yaw 0): its front. From behind you see the lining.
  function restOf(pc) {
    if (pc.rope !== null || pc.cols < 2 || pc.rows < 2) return;
    let nx = 0, ny = 0, nz = 0; for (let i = 0; i < pc.n; i++) { nx += pc.N[i * 3]; ny += pc.N[i * 3 + 1]; nz += pc.N[i * 3 + 2]; }
    const l = Math.hypot(nx, ny, nz) || 1; pc.nRest = [nx / l, ny / l, nz / l];
    const P = pc.P, sx = i => P[i * 3] * ctx.PPM, sy = i => P[i * 3 + 1] * ctx.PPMY - P[i * 3 + 2] * ctx.PPMH, a = 1, c = pc.cols + 1;
    pc.wind0 = Math.sign((sy(a) - sy(c)) * (sx(0) - sx(c)) + (sx(c) - sx(a)) * (sy(0) - sy(c))) || 1;
  }

  // ---------------------------------------------------------------- the cloth atlas (one texture for every piece's box)
  // Each changed piece box goes into its slot straight from the raster's array (G.texData: no 2D canvas between; a canvas
  // was painted and the whole of it uploaded, 512 x 256 twice, every frame a piece changed). The two canvases are blank:
  // they only name the textures (albedo, emit) and their size for the sprite batch. A slot's texels past its box are
  // stale, never shown (the sprite shows the box)
  const CA = {W: 512, H: 256, cv: null, ecv: null, x: 0, y: 0, rowH: 0, gen: 0, dirty: false, reset: false};
  let zeros = new Uint8Array(0);   // (a box that had an emit and has none now)
  function resetCloth() {   // the canvases live as long as the feature (one GPU texture each); a rebuild starts the slots over
    if (!CA.cv) { CA.cv = mk(CA.W, CA.H); CA.ecv = mk(CA.W, CA.H); }
    CA.x = CA.y = CA.rowH = 0; CA.gen++; CA.dirty = true;
  }
  function slotFor(grp, w, h) {
    const sl = grp.slot;
    if (sl && sl.gen === CA.gen && sl.w >= w && sl.h >= h) return sl;
    const W2 = w + 6, H2 = h + 6;
    if (W2 > CA.W || H2 > CA.H) return null;
    if (CA.x + W2 > CA.W) { CA.x = 0; CA.y += CA.rowH; CA.rowH = 0; }
    if (CA.y + H2 > CA.H) {   // full: start over; everything re-rasters into fresh slots this frame
      CA.x = CA.y = CA.rowH = 0; CA.gen++; CA.reset = true;
    }
    const n = {x: CA.x, y: CA.y, w: W2, h: H2, gen: CA.gen}; CA.x += W2; CA.rowH = Math.max(CA.rowH, H2); grp.slot = n;
    if (grp.box) grp.box.fresh = true;
    return n;
  }

  // ---------------------------------------------------------------- raster (per group box, view px of the turned camera)
  function rasterItem(it) { for (const grp of it.groups) rasterGroup(it, grp); it.rastered = true; }
  function rasterGroup(it, grp) {
    const {PPM, PPMY, PPMH} = ctx;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const pc of grp.pieces) {
      const {P, SX, SY, ZT} = pc;
      for (let i = 0; i < pc.n; i++) {
        const j = i * 3, vy = P[j] * FX + P[j + 1] * FY, X = (P[j] * RX + P[j + 1] * RY) * PPM, Y = vy * PPMY - P[j + 2] * PPMH;
        SX[i] = X; SY[i] = Y; ZT[i] = vy * SP_ + P[j + 2] * CP;
        if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
      }
    }
    if (x0 > x1) return;
    const bx = Math.floor(x0) - 2, by = Math.floor(y0) - 2, bw = Math.ceil(x1) - bx + 3, bh = Math.ceil(y1) - by + 3;
    let b = grp.box;
    if (!b || b.CW < bw || b.CH < bh) {
      const CW = Math.max(bw, b?.CW || 0) + 8, CH = Math.max(bh, b?.CH || 0) + 8, buf = new Uint32Array(CW * CH);
      b = grp.box = {CW, CH, buf, prev: new Uint32Array(CW * CH), im: new ImageData(new Uint8ClampedArray(buf.buffer), CW, CH),
        tone: new Int8Array(CW * CH), rid: new Uint8Array(CW * CH), fl: new Uint8Array(CW * CH), dd: new Uint8Array(CW * CH), zb: new Float32Array(CW * CH),
        rmin: new Int16Array(CH), rmax: new Int16Array(CH), ebuf: null, eim: null, x: 0, y: 0, w: 0, h: 0, any: false, eany: false, fresh: true};
    }
    const {CW, tone, rid, fl, dd, zb, buf, rmin, rmax} = b;
    for (let y = 0; y < bh; y++) { const o = y * CW; tone.fill(-1, o, o + bw); zb.fill(-1e9, o, o + bw); }
    rmin.fill(32767, 0, bh); rmax.fill(-1, 0, bh);
    const RAMP_IDS = RID(it);
    for (const pc of grp.pieces) {
      const {SX, SY, ZT, LM, N, U, V, D, cols, rows} = pc;
      if (pc.rope !== null) continue;   // ropes are world lines
      for (let i = 0; i < pc.n; i++) {   // vertex tone value against the screen's top-left light (view space)
        const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2], nvx = nx * RX + ny * RY, nvy = nx * FX + ny * FY;
        LM[i] = nvx * LR + (-CP * nvy + SP_ * nz) * LU + (SP_ * nvy + CP * nz) * LT;
      }
      // the rest tone for this camera angle, of the side that faces it (the lining from behind)
      let lam0 = 0;
      if (pc.nRest) {
        const [qx, qy, qz] = pc.nRest, nvx = qx * RX + qy * RY, nvy = qx * FX + qy * FY, sg = (SP_ * nvy + CP * qz) < 0 ? -1 : 1;
        lam0 = sg * (nvx * LR + (-CP * nvy + SP_ * qz) * LU + (SP_ * nvy + CP * qz) * LT);
      }
      // the triangle's winding on screen vs the front's at rest (yaw 0): a turn of the camera never mirrors the screen,
      // so a flipped winding means we look at the back of the cloth
      const wind0 = pc.wind0 || 1;
      const r0 = RAMP_IDS[pc.ramp0 || 'main'] ?? 0, mode = pc.outline === 'out' ? 2 : 0, fray = pc.fray ? 4 : 0;
      const tri = (i0, i1, i2) => {
        const ax = SX[i0] - bx, ay = SY[i0] - by, bx2 = SX[i1] - bx, by2 = SY[i1] - by, cx = SX[i2] - bx, cy = SY[i2] - by;
        const den = (by2 - cy) * (ax - cx) + (cx - bx2) * (ay - cy); if (Math.abs(den) < 1e-6) return;
        const back = Math.sign(den) !== wind0;
        const xa = Math.max(0, Math.floor(Math.min(ax, bx2, cx))), xb = Math.min(bw - 1, Math.ceil(Math.max(ax, bx2, cx)));
        const ya = Math.max(0, Math.floor(Math.min(ay, by2, cy))), yb = Math.min(bh - 1, Math.ceil(Math.max(ay, by2, cy)));
        for (let y = ya; y <= yb; y++) { let lo = 32767, hi = -1; for (let x = xa; x <= xb; x++) {
          const px = x + .5, py = y + .5;
          const l0 = ((by2 - cy) * (px - cx) + (cx - bx2) * (py - cy)) / den, l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, l2 = 1 - l0 - l1;
          if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) continue;
          const j = y * CW + x, z = l0 * ZT[i0] + l1 * ZT[i1] + l2 * ZT[i2]; if (z < zb[j]) continue;
          const u = l0 * U[i0] + l1 * U[i1] + l2 * U[i2], v = l0 * V[i0] + l1 * V[i1] + l2 * V[i2];
          const code = pc.pat(u, v); if (code < 0) continue;
          let lam = l0 * LM[i0] + l1 * LM[i1] + l2 * LM[i2]; if (back) lam = -lam;   // the lining: its own side faces us
          const dl = lam - lam0;
          let t = dl > .17 ? 0 : dl < -.15 ? 2 : 1; if (back) t = Math.min(2, t + 1);
          const ri = (code & 31) === 0 ? r0 : (code & 31) === 1 ? RAMP_IDS.trim : (code & 31) === 3 ? RAMP_IDS.trim : r0;
          if (code & 128) t = 0;
          zb[j] = z; tone[j] = t; rid[j] = ri; fl[j] = (code & 64 ? 1 : 0) | mode | fray; dd[j] = Math.round(clamp(l0 * D[i0] + l1 * D[i1] + l2 * D[i2], 0, 1) * 255);
          if (x < lo) lo = x; if (x > hi) hi = x;
        } if (lo < rmin[y]) rmin[y] = lo; if (hi > rmax[y]) rmax[y] = hi; }
      };
      for (let r = 0; r + 1 < rows; r++) for (let k = 0; k + 1 < cols; k++) { const i = r * cols + k; tri(i, i + 1, i + cols + 1); tri(i, i + cols + 1, i + cols); }
    }
    // colours: selective outline (bottom / right edge = darkest, top / left edge = shade), 'out' pieces get it outside
    const ramps = it.rampList, pal = it.pal, crust = rgba(pal.crust || '#000000');
    const emb = pal.fray ? pal.ember.map(rgba) : pal.rune ? pal.rune.map(rgba) : null;
    let eany = false; const E = emb ? ensureEmit(b) : null;
    const fr = Math.floor(T * 5);
    for (let y = 0; y < bh; y++) {
      const o = y * CW; buf.fill(0, o, o + bw); if (E) E.fill(0, o, o + bw);
      const xa = Math.max(0, Math.min(rmin[y], y > 0 ? rmin[y - 1] : 32767) - 1), xb = Math.min(bw - 1, Math.max(rmax[y], y > 0 ? rmax[y - 1] : -1) + 1);
      for (let x = xa; x <= xb; x++) {
        const j = o + x, t = tone[j];
        if (t < 0) {   // empty: an exterior outline for thin pieces (strips) on their shadow side
          const lj = x > 0 ? j - 1 : -1, uj = y > 0 ? j - CW : -1;
          const src = lj >= 0 && tone[lj] >= 0 && fl[lj] & 2 ? lj : uj >= 0 && tone[uj] >= 0 && fl[uj] & 2 ? uj : -1;
          buf[j] = src >= 0 ? ramps[rid[src]][3] : 0;
          continue;
        }
        const f = fl[j], R4 = ramps[rid[j]];
        const eR = x + 1 >= bw || tone[j + 1] < 0, eD = y + 1 >= bh || tone[j + CW] < 0, eL = x === 0 || tone[j - 1] < 0, eU = y === 0 || tone[j - CW] < 0;
        let tt = t;
        if (!(f & 2)) { if (eR || eD) tt = 3; else if (eL || eU) tt = Math.max(t, 2); }
        buf[j] = R4[tt];
        if (E && (f & 1)) { E[j] = emb[(x + y + fr) % 3 === 0 ? 0 : 1]; buf[j] = R4[2]; eany = true; }   // rift rune glyph: dim in the albedo, glows
        else if (E && (f & 4) && eD && dd[j] > 170) {   // ember: the ragged hem smoulders
          buf[j] = crust; E[j] = emb[hsh(x + bx, y, fr) < .3 ? 0 : hsh(x + bx, y + 1, fr) < .6 ? 1 : 2]; eany = true;
        }
      }
    }
    const sl = slotFor(grp, bw, bh); if (!sl) { b.any = false; return; }
    // upload only what changed: the albedo if a pixel changed (or the box moved / got a new slot), the emit likewise
    const kept = !b.fresh && b.w === bw && b.h === bh;
    if (!(kept && same32(b.prev, buf, bw, bh, CW))) { host.G.texData(CA.cv, sl.x, sl.y, bw, bh, b.im.data, CW); b.prev.set(buf); CA.dirty = true; }
    if (E) { if (!(kept && same32(b.eprev, E, bw, bh, CW))) { host.G.texData(CA.ecv, sl.x, sl.y, bw, bh, b.eim.data, CW); b.eprev.set(E); } }   // (zero where nothing glows)
    else if (b.eany) { if (zeros.length < bw * bh * 4) zeros = new Uint8Array(bw * bh * 4); host.G.texData(CA.ecv, sl.x, sl.y, bw, bh, zeros, bw); }
    b.fresh = false; b.eany = eany; b.x = bx; b.y = by; b.w = bw; b.h = bh; b.any = true;
  }
  function ensureEmit(b) {
    if (!b.ebuf || b.ebuf.length !== b.buf.length) { b.ebuf = new Uint32Array(b.CW * b.CH); b.eprev = new Uint32Array(b.CW * b.CH); b.eim = new ImageData(new Uint8ClampedArray(b.ebuf.buffer), b.CW, b.CH); }
    return b.ebuf;
  }
  // the first w x h px of two arrays with rows cw apart: the same?
  function same32(A, B, w, h, cw) { for (let y = 0; y < h; y++) { const o = y * cw; for (let x = 0; x < w; x++) if (A[o + x] !== B[o + x]) return false; } return true; }
  function RID(it) {   // ramp name -> index into it.rampList
    if (it.rid) return it.rid;
    it.rampList = []; it.rid = {};
    for (const k of Object.keys(it.ramps)) { it.rid[k] = it.rampList.length; it.rampList.push(it.ramps[k]); }
    return it.rid;
  }

  // ---------------------------------------------------------------- drawing (sprites, lines, ground layer)
  const hexC = {}; const C3 = h => hexC[h] || (hexC[h] = host.rgb(h));
  function shadowAt(g, x, y) {   // a small contact shadow at a pole's foot (the arena's blob-shadow colour, view px)
    const [sx, sy] = host.toView(x, y, host.elev(x, y)), X = Math.round(sx), Y = Math.round(sy), z = ZM;
    if (X < -8 || Y < -8 || X > ctx.VW + 8 || Y > ctx.VH + 8) return;
    g.fillRect(X - 2 * z, Y, 5 * z, z); g.fillRect(X - z, Y + z, 3 * z, z);
  }
  function drawRod(r) {   // the arena's rod sprite as two world lines + knobs (it turns with the world, like the cloth)
    const dh = 1 / ctx.PPMH, dx = 1 / ctx.PPM, ux = r.alongY ? 0 : 1, uy = r.alongY ? 1 : 0;   // along x (default) or y
    const x0 = r.x0, y0 = r.y, x1 = x0 + ux * r.len, y1 = y0 + uy * r.len;
    host.line(x0, y0, r.h, x1, y1, r.h, C3(r.c[1])); host.line(x0, y0, r.h - dh, x1, y1, r.h - dh, C3(r.c[3]));
    host.point(x0 - ux * dx, y0 - uy * dx, r.h, C3(r.m[0])); host.point(x0 - ux * dx, y0 - uy * dx, r.h - dh, C3(r.m[2]));
    host.point(x1 + ux * dx, y1 + uy * dx, r.h, C3(r.m[0])); host.point(x1 + ux * dx, y1 + uy * dx, r.h - dh, C3(r.m[2]));
  }
  function drawLantern(L) {
    const pal = L.pal, Rm = pal.wood, M = pal.metal, dh = 1 / ctx.PPMH, dx = 1 / ctx.PPM, x2 = L.x + (L.armPx + 2) * dx;
    // arm east from the post with its brace and the hook (the arena's sprite rows 3-5), then the chain
    host.line(L.x + 2 * dx, L.y, L.armH, x2, L.y, L.armH, C3(Rm[1])); host.line(L.x + 2 * dx, L.y, L.armH - dh, x2, L.y, L.armH - dh, C3(Rm[3]));
    host.line(L.x + 2 * dx, L.y, L.armH - 7 * dh, L.x + 6 * dx, L.y, L.armH - 3 * dh, C3(Rm[2]));
    host.point(x2, L.y, L.armH, C3(M[1])); host.point(x2, L.y, L.armH - dh, C3(M[3])); host.point(x2, L.y, L.armH - 2 * dh, C3(M[3]));
    host.line(L.ax, L.y, L.az, L.bx, L.by, L.bz, C3(M[3]));
    const fr = (T * 6) | 0, e = L.body[(fr + (L.id & 1)) % 5 === 0 ? 1 : 0];
    { const o = SPD; o.img = DA.cv; o.em = DA.ecv; o.sx = e.sx; o.sy = e.sy; o.sw = e.sw; o.sh = e.sh; o.px = e.px; o.py = e.py; o.x = L.bx; o.y = L.by; o.h = L.bz; host.sprite(o); }
  }
  // host.sprite's options, kept (an object literal a sprite a frame before): the decor atlas (casting) and the cloth atlas
  const SPD = {img: null, em: null, sx: 0, sy: 0, sw: 0, sh: 0, px: 0, py: 0, x: 0, y: 0, h: 0, shadow: true}, SPC = {img: null, em: null, sx: 0, sy: 0, sw: 0, sh: 0, px: 0, py: 0, x: 0, y: 0, h: 0};
  function drawItem(it, g) {
    if (it.shadow) for (let i = 0; i < it.shadow.length; i += 2) shadowAt(g, it.shadow[i], it.shadow[i + 1]);
    for (const [e, x, y, h] of it.posts) { const o = SPD; o.img = DA.cv; o.em = DA.ecv; o.sx = e.sx; o.sy = e.sy; o.sw = e.sw; o.sh = e.sh; o.px = e.px; o.py = e.py; o.x = x; o.y = y; o.h = h; host.sprite(o); }
    // a wall banner hangs on the wall's south face: from the north the wall hides it. (Cards and world lines carry a depth
    // bias of ~0.15 m; the banner's top hem and rod sit closer than that to the wall's top edge and would show over it.)
    const behindWall = it.kind === 'banner' && FY < -.02;
    if (!behindWall) for (const grp of it.groups) {
      const b = grp.box, sl = grp.slot; if (!b || !b.any || !sl || sl.gen !== CA.gen) continue;
      const [ax, ay, ah] = grp.anchor(), AX = Math.round((ax * RX + ay * RY) * ctx.PPM), AY = Math.round((ax * FX + ay * FY) * ctx.PPMY - ah * ctx.PPMH);
      const o = SPC; o.img = CA.cv; o.em = CA.ecv; o.sx = sl.x; o.sy = sl.y; o.sw = b.w; o.sh = b.h; o.px = AX - b.x; o.py = AY - b.y; o.x = ax; o.y = ay; o.h = ah; host.sprite(o);   // (never re-uploaded whole: its slots go up in rasterGroup, G.texData)
    }
    if (!behindWall) for (const r of it.rods) drawRod(r);
    if (it.rope) {   // the prayer-flag rope: world segments between its nodes
      const P = it.rope.P, c = C3(it.pal.rope);
      for (let i = 0; i + 1 < it.rope.n; i++) host.line(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], P[i * 3 + 3], P[i * 3 + 4], P[i * 3 + 5], c);
    }
    if (it.lantern) drawLantern(it.lantern);
  }

  // ================================================================ particles (shaken out of foliage)
  const parts = [];
  function spawnPart(o) { if (parts.length < 320) parts.push(o); }
  // a 3D tree's crown in the world (render3d/trees3d.js shape.crown, turned and scaled like the model) | null. Per item,
  // worked out once (a tree doesn't move; a rebuilt world has new items)
  const crowns = new WeakMap();
  function crownOf(p) {
    const it = host.itemOf?.(p); if (!it) return null;
    let cr = crowns.get(it); if (cr !== undefined) return cr;
    const ps = it.pose, C = ps?.crown;
    if (!C) cr = null;
    else { const c = Math.cos(ps.yaw), s = Math.sin(ps.yaw), k = ps.scale, z = p.z || 0; cr = {x: p.x + (C.x * c + C.z * s) * k, y: p.y + (-C.x * s + C.z * c) * k, h0: z + C.y0 * k, h1: z + C.y1 * k, r: C.r * k}; }
    crowns.set(it, cr); return cr;
  }
  // why: 'wind' (torn off in a gust), 'gust' (a front arriving), 'arrow', 'blast', 'fall' (a dying leaf letting go by
  // itself), 'bird' (knocked off where a bird lands / takes off: at = its spot {x, y, h})
  function shed(p, n, why, at) {
    const S = SHED[biome]; if (!S) return;
    const sp = host.biome.sprite(p, ctx), hTop = sp ? sp.pivot[1] / ctx.PPMH : .6, z = p.z || 0, tree = p.kind === 'tree';   // sprite top above the ground point
    const a = field(p.x, p.y), ax = a.x, ay = a.y, cr = tree && !at ? crownOf(p) : null, soft = why === 'fall' || why === 'bird';
    for (let i = 0; i < n; i++) {
      let h = z + (tree ? hTop * (.35 + R() * .5) : hTop * (.45 + R() * .45)), o = (R() - .5) * (tree ? 1.6 : .6), cx = p.x, cy = p.y, f = .02;   // across the crown, as seen
      if (at) { h = at.h - .04 - R() * .2; o = (R() - .5) * .4; cx = at.x; cy = at.y; f = .12 + R() * .16; }   // under the bird's feet, just on the camera side
      else if (cr) {   // a 3D crown: from its own bulk, on the side facing the camera (inside it they'd stay hidden)
        h = cr.h0 + (cr.h1 - cr.h0) * (.15 + R() * .7); o = (R() - .5) * cr.r * 1.6; cx = cr.x; cy = cr.y;
        f = cr.r * .85 * Math.sqrt(Math.max(0, 1 - (o / cr.r) ** 2));
      }
      const base = {x: cx + RX * o + FX * f, y: cy + RY * o + FY * f + (R() - .5) * .1, h, t: 0, ph: R() * TAU, rest: 0};
      if (S.kind === 'leaf') spawnPart({...base, kind: 'leaf', pal: leafPal(S, tree ? autumnOf(p) : null), vx: (R() - .5) * (soft ? .4 : 1.4) + ax * .6, vy: (R() - .5) * (soft ? .25 : .5),
        vh: why === 'arrow' || why === 'blast' ? .6 + R() * .8 : why === 'fall' ? 0 : R() * .3, life: 4 + (h - z) * 2.5, g: 1.4, big: why === 'wind' && R() < .4, lie: soft ? 2.5 : 1});   // (long enough to reach the ground: it falls ~.45 m/s)
      else if (S.kind === 'snow') spawnPart({...base, kind: 'snow', pal: S.pal, vx: (R() - .5) * 1.6 + ax * .8, vy: (R() - .5) * .6, vh: .4 + R() * 1.1, life: .5 + R() * .45, g: 6});
      else if (S.kind === 'spark') {
        if (R() < .6) spawnPart({...base, kind: 'spark', pal: S.pal, emit: true, vx: (R() - .5) * .9 + ax * .5, vy: (R() - .5) * .3, vh: .5 + R() * .9, life: .6 + R() * .7, g: -.35});
        else spawnPart({...base, kind: 'ash', pal: S.ash, vx: (R() - .5) * .8 + ax * .5, vy: (R() - .5) * .3, vh: .2 + R() * .4, life: 1.2 + R() * .8, g: .8});
      } else spawnPart({...base, kind: 'mote', pal: S.pal, emit: true, vx: (R() - .5) * .5, vy: (R() - .5) * .3, vh: .15 + R() * .35, life: 1 + R() * .9, g: -.08});
    }
  }
  function gustShed(p) {   // a gust front hits: snow blows off frost pines / bushes, a ruins tree lets go of a leaf or a few (autumn)
    if (biome === 'frost' && (p.kind === 'tree' || p.kind === 'bush') && R() < .75) shed(p, p.kind === 'tree' ? 3 + (R() * 3 | 0) : 1 + (R() * 2 | 0), 'gust');
    else if (biome === 'ruins' && p.kind === 'tree' && (p.variant | 0) !== 2) { const n = Math.floor(leafRate(SHED.ruins) * (.55 + R())); if (n > 0) shed(p, n, 'gust'); }
  }
  // ---- the season's leaves (host.env, sim/env.js): the leaves DIE through the year (env.leafFall: the odd one in summer,
  // more and more through autumn, the most where autumn turns into winter, the last few after, as env.leafK thins the
  // crowns). A dying leaf lets go by itself in still air (STRENGTH.fall) and far easier when something ruffles the crown: a
  // gust, an arrow, a blast, a bird landing or taking off (wildlife.js 'bird_perch'). leafRate = how loose they are (~.85
  // in summer, ~2 mid-autumn, ~3.2 at the peak, ~.2 on the bare winter crowns). Colours: half the crown's own (env.leafRamp),
  // half browner than it (DYING: indices into SHED.ruins.pals [green, green, yellow-green, rust-gold, withered brown]).
  // A leaf of a 3D tree (autumn ramps, trees3d.js B.autumn) is the colour of the spray it left: once autumn has begun, the
  // stage a leaf lets go from is drawn the way the crown loses them (core/autumn.js fallStage: the sprays that turned first go
  // first), and an unturned one is the season's green. The crown's own ramp is that green now (sim/env.js LEAF.autumn), so
  // in autumn the other things that shed (bushes) take only the dying colours
  const DYING = {spring: [4, 2], summer: [2, 2, 3], autumn: [3, 4], winter: [4]};
  let crownPal = null, crownV = -1;
  const hex6 = c => '#' + c.map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  const crownOwn = e => {   // the season's green leaf ([hi, base, shade] hex), null where the biome has none
    const lr = e.leafRamp?.();   // (blended across a season's change; rebuilt only when it changed)
    if (lr && e.ver.leaf !== crownV) { crownV = e.ver.leaf; crownPal = [hex6(lr[0]), hex6(lr[1]), hex6(lr[2])]; }
    return lr ? crownPal : null;
  };
  const autumnOf = p => host.itemOf?.(p)?.pose?.autumn || null;   // a 3D tree's autumn ramps
  function leafPal(S, aut) {
    const e = host.env; if (!e?.seasonal) return S.pals[R() * S.pals.length | 0];
    if (aut && e.autumn > .02) { const st = fallStage(e.autumn, R()); if (st > 0) return aut[st - 1]; const g = crownOwn(e); if (g) return g; }
    if (R() < .5 && e.season !== 'autumn') { const g = crownOwn(e); if (g) return g; }
    const ix = DYING[e.season] || DYING.autumn; return S.pals[ix[R() * ix.length | 0]];
  }
  const leafRate = S => { const e = host.env; return S.kind === 'leaf' && e?.seasonal ? e.leafK * .6 + (e.leafFall || 0) * 3.2 : 1; };
  const leafyTree = p => !(p.kind === 'tree' && (p.variant | 0) === 2 && biome === 'ruins') && p.kind !== 'reed' && p.kind !== 'fern';   // (a ruins dead tree has no leaves; reeds and ferns shed none)
  // ---- the feel of a strong wind: leaves torn off the crowns in gusts, leaves (snow, ash) blowing through the view from
  // upwind, and what the foliage around the player sounds like: W.rustle = {e: the agitation of the leafy crowns / bushes
  // near him (1 = one tree beside him in a full breeze gust), pan: where they are on screen, -1..1}
  let airAcc = 0;
  function stepFeel(dt) {
    const S = SHED[biome], lv = Math.max(0, LV - .75);
    let e = 0, ep = 0;
    const loose = S ? leafRate(S) : 1, fall = S?.kind === 'leaf' ? (host.env?.leafFall || 0) * STRENGTH.fall : 0;   // (dying leaves drop even in a calm)
    const sheds = S && (lv > 0 || fall > 0) && (S.kind === 'leaf' || S.kind === 'snow');
    for (const p of nearList()) {
      if (p.kind === 'tuft') continue;
      const F = flexOf(p); if (!F) continue;
      const leafy = leafyTree(p), d = hypot2(p.x - PL.x, p.y - PL.y);
      const sh = sheds && leafy && vis(p.x, p.y); if (!sh && d > 16) continue;   // (the wind field only where it's needed)
      const a = field(p.x, p.y);
      if (sh) {
        const torn = lv * a.g * STRENGTH.shed * loose;
        if (R() < dt * (torn + fall) * (p.kind === 'tree' ? 1 : .3)) shed(p, 1, R() * (torn + fall) < torn ? 'wind' : 'fall');
      }
      if (d > 16) continue;
      const st = fst.get(p), w = (p.kind === 'tree' ? (leafy ? 1 : .3) : .35) * (1 - d / 16) ** 2;
      const sp = hypot2(a.x, a.y) / vref(), ag = w * sp * sp * (.7 + .3 * Math.min(1, st ? hypot2(st.vx, st.vy) / 25 : 0));   // ~ wind speed^2: the gusts do the talking
      e += ag; ep += ag * clamp(((p.x - PL.x) * RX + (p.y - PL.y) * RY) / 7, -1, 1);
    }
    W.rustle.e = e; W.rustle.pan = e > 1e-4 ? ep / e : 0;
    const air = S && biome !== 'rift' ? Math.max(0, LV - 1.1) * STRENGTH.airborne * leafRate(S) : 0;
    if (air > 0) {
      airAcc += dt * air * (.25 + 1.6 * field(VB.cx * RX + VB.cy * FX, VB.cx * RY + VB.cy * FY).g);   // flurries ride the gust fronts (at the view's centre)
      while (airAcc >= 1) { airAcc -= 1; airborne(S); }
    } else airAcc = 0;
  }
  function airborne(S) {   // one leaf (flake, ash) entering from upwind of the view, at a random height
    const wvx = UX * RX + UY * RY, wvy = UX * FX + UY * FY, n = Math.hypot(wvx, wvy) || 1, ex = Math.hypot(VB.hw, VB.hh) + 1.5, s = (R() * 2 - 1) * ex;
    const vx = VB.cx - wvx / n * ex - wvy / n * s, vy = VB.cy - wvy / n * ex + wvx / n * s;   // view frame
    const x = vx * RX + vy * FX, y = vx * RY + vy * FY, a = field(x, y), h = host.elev(x, y) + .3 + R() * 3.2;
    const base = {x, y, h, t: 0, ph: R() * TAU, rest: 0};
    if (S.kind === 'leaf') spawnPart({...base, kind: 'leaf', pal: leafPal(S), vx: a.x, vy: a.y * .6, vh: (R() - .5) * .6, life: 12, g: 1.4, big: R() < .5});
    else if (S.kind === 'snow') spawnPart({...base, kind: 'snow', pal: S.pal, vx: a.x, vy: a.y * .6, vh: -.1 - R() * .3, life: 2.5 + R() * 1.5, g: .4});
    else if (S.kind === 'spark') spawnPart({...base, kind: 'ash', pal: S.ash, vx: a.x, vy: a.y * .6, vh: -.05 - R() * .2, life: 2.5 + R() * 1.5, g: .25});
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.t += dt;
      if (q.rest > 0) {
        q.rest -= dt;
        if (q.kind === 'leaf' && LV > 1.2) {   // a strong wind skitters a fallen leaf along the ground and lifts it off again
          const a = field(q.x, q.y), sp = hypot2(a.x, a.y);
          if (sp > 1.3) {
            q.x += a.x * .35 * dt; q.y += a.y * .35 * dt;
            if (R() < dt * (sp - 1.3) * 1.2) { q.rest = 0; q.vh = .5 + R() * .8; q.vx = a.x; q.vy = a.y * .6; q.t = Math.min(q.t, q.life - 4); continue; }
          }
        }
        if (q.rest <= 0) { q.onLand?.(q); parts[i] = parts[parts.length - 1]; parts.pop(); }   // (a lifted leaf hands itself back to the carpet: features/litter.js)
        continue;
      }
      if (q.t >= q.life) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      const a = field(q.x, q.y);
      if (q.kind === 'leaf') {   // flutters down, drifts with the wind; in a strong wind it loops, climbs and races (sw)
        const sw = Math.max(0, hypot2(a.x, a.y) - .9), k = .9 + .5 * Math.max(0, LV - 1), c = Math.min(1, dt * 2);
        q.vh += (-.45 + sw * .8 * Math.sin(q.t * 2.6 + q.ph * 3) - q.vh) * Math.min(1, dt * 2.2);
        q.vx += (a.x * k + Math.sin(q.t * 3.1 + q.ph) * (.5 + sw * .6) - q.vx) * c;
        q.vy += (a.y * .6 * k + Math.cos(q.t * 2.3 + q.ph * 2) * sw * .4 - q.vy) * c;
      } else { q.vh -= q.g * dt; const d = Math.exp(-dt * (q.kind === 'snow' ? 2.4 : 1.4)); q.vx = q.vx * d + a.x * (1 - d) * .8; q.vy *= d; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt;
      const gnd = host.elev(q.x, q.y);
      if (q.h <= gnd) {
        if (q.kind === 'leaf' && !(gnd === 0 && host.inStream(q.x, q.y))) { q.h = gnd; q.rest = (1.2 + R() * 1.2) * (q.lie || 1); q.restMax = q.rest; }   // (a dead leaf lies a while, darkening)
        else { parts[i] = parts[parts.length - 1]; parts.pop(); }
      }
    }
  }
  function partColour(q) {
    const n = q.pal.length;
    if (q.kind === 'leaf') return q.rest > 0 ? q.pal[q.rest / q.restMax > .5 ? 1 : 2] : q.pal[0];
    if (q.kind === 'mote') { const k = Math.min(q.t / .4, (q.life - q.t) / .5); return q.pal[k >= 1 ? 0 : k > .5 ? 1 : 2]; }
    return q.pal[Math.min(n - 1, Math.floor(q.t / q.life * n))];
  }
  // lit particles are world points (1 sprite px; a fluttering leaf shows 2 x 1 / 1 x 2 / 1 x 1); the glowing ones (sparks,
  // motes) go to the emit layer like the arena's emitter layer (no albedo of their own)
  function drawParts() {
    if (!parts.length) return;
    let eq = null; const dx = 1 / ctx.PPM, dh = 1 / ctx.PPMH, o = {size: ZM};
    for (const q of parts) {
      if (q.emit) {
        const [sx, sy] = host.toView(q.x, q.y, q.h), X = Math.round(sx), Y = Math.round(sy);
        if (X < 0 || Y < 0 || X >= ctx.VW || Y >= ctx.VH) continue;
        eq ??= host.glayer('emit'); eq.fillStyle = partColour(q); eq.fillRect(X, Y, ZM, ZM); continue;
      }
      if (!vis(q.x, q.y)) continue;
      const c = C3(partColour(q)); host.point(q.x, q.y, q.h, c, o);
      if (q.kind === 'leaf' && !(q.rest > 0)) {   // tumbling: 2 x 1 / 1 x 2 / 1 x 1; a big leaf (strong wind) turns over faster as a 2 x 2 / L
        const f = (T * (q.big ? 7 : 3) + q.ph * 4) & 3;
        if (f === 0) host.point(q.x + RX * dx, q.y + RY * dx, q.h, c, o); else if (f === 2) host.point(q.x, q.y, q.h - dh, c, o);
        if (q.big && f !== 1) host.point(q.x + RX * dx, q.y + RY * dx, q.h - dh, f === 3 ? C3(q.pal[1]) : c, o);
      }
      else if (q.kind === 'leaf') host.point(q.x + RX * dx, q.y + RY * dx, q.h, c, o);
      else if (q.kind === 'snow' && q.t < q.life * .3) host.point(q.x + RX * dx, q.y + RY * dx, q.h, c, o);
    }
  }

  // ================================================================ events: arrows through foliage, dummy hits, blasts
  const shook = new WeakMap();   // arrow -> Set of props it already shook
  function arrowsThroughFoliage() {
    const A = host.arrows; if (!A || !A.length) return;
    const NL = nearList();
    for (const a of A) {
      if (a.stuck || a.life <= -9) continue;
      const sv = (a.vx || 0) * RX + (a.vy || 0) * RY;
      for (const p of NL) {
        if (p.kind === 'tuft' || !vis(p.x, p.y)) continue;
        const F = flexOf(p); if (!F) continue;
        const [r, hMax] = p.kind === 'tree' ? TUNE.arrowTree : TUNE.arrowBush, z = p.z || 0, cr = p.kind === 'tree' ? crownOf(p) : null;
        if (cr) { if (Math.hypot(a.x - cr.x, a.y - cr.y) > cr.r || a.h < cr.h0 || a.h > cr.h1) continue; }   // a 3D crown: its own bounds
        else if (Math.hypot(a.x - p.x, (a.y - p.y) * 1.3) > r || a.h < z + (p.kind === 'tree' ? .9 : 0) || a.h > z + hMax) continue;
        let S = shook.get(a); if (!S) shook.set(a, S = new Set()); if (S.has(p)) continue; S.add(p);
        const st = fst.get(p); if (st) { st.shake = 1; const k = Math.sign(sv || 1) * 30; st.vx += RX * k; st.vy += RY * k; }   // shudders along the screen's x
        const S0 = SHED[biome], m = S0 ? clamp(.5 + .45 * leafRate(S0), .4, 2) : 1;   // (the season: a bare winter crown has few left, a dying autumn one many)
        if (leafyTree(p)) shed(p, Math.round((p.kind === 'tree' ? 4 + (R() * 3 | 0) : 3 + (R() * 3 | 0)) * m), 'arrow');
      }
    }
  }
  function onEvents(evs) {
    for (const e of evs || []) {
      if (e.type === 'arrow.hit' && e.prop && e.prop.kind === 'dummy') {   // the strips jump with the hit
        const v = Math.hypot(e.vx || 0, e.vy || 0) || 1;
        for (const it of decor) if (it.dummy === e.prop) for (const pc of it.pieces) kick(pc, (e.vx || 0) / v * 1.6, (e.vy || 0) / v * 1.2, .8, 1);
      } else if (e.type === 'combat.explode') {   // a blast wave: foliage whips, cloth billows away from it
        const r = (e.r || 2.4) * 2.5;
        const S = SHED[biome], loose = S?.kind === 'leaf' ? leafRate(S) : 0;
        for (const p of nearList()) {   // (only foliage that has swayed in view has a spring state to kick)
          const d = Math.hypot(p.x - e.x, p.y - e.y), st = fst.get(p); if (!st || d > r) continue;
          const k = Math.sign((p.x - e.x) * RX + (p.y - e.y) * RY || 1) * 90 * (1 - d / r);
          st.vx += RX * k; st.vy += RY * k; st.shake = Math.max(st.shake, .6 * (1 - d / r));
          if (loose && p.kind !== 'tuft' && leafyTree(p)) { const n = Math.floor(loose * 2.5 * (1 - d / r) * (p.kind === 'tree' ? 1 : .4) + R()); if (n > 0) shed(p, n, 'blast'); }   // and the leaves that were ready to go
        }
        for (const it of decor) {
          const d = Math.hypot(it.x - e.x, it.y - e.y); if (d > r * 1.4) continue;
          const k = 3 * (1 - d / (r * 1.4)), ux = (it.x - e.x) / (d || 1), uy = (it.y - e.y) / (d || 1);
          for (const pc of it.pieces) kick(pc, ux * k, uy * k, k * .5);
          if (it.lantern) { it.lantern.ox -= ux * k / 60; it.lantern.oy -= uy * k / 60; }
        }
      } else if (e.type === 'wildlife.bird_perch' && e.prop) {   // wildlife.js: a bird landed on / took off from a crown or a bush
        const p = e.prop, F = flexOf(p); if (!F || p.kind === 'tuft' || !vis(p.x, p.y)) continue;
        const st = fst.get(p), tree = p.kind === 'tree';   // a crow / raven bobs a branch, a sparrow on a big oak barely does
        if (st) st.shake = Math.max(st.shake, (tree ? .14 : .4) * (e.big ? 2.6 : 1) * (e.off && e.scared ? 1.4 : 1));
        const S = SHED[biome]; if (!S || (S.kind !== 'leaf' && S.kind !== 'snow') || !leafyTree(p)) continue;
        // a dying leaf under its feet lets go (snow: a puff off the branch); taking off kicks harder than landing
        const n = Math.floor((e.off ? .5 : .3) * (e.big ? 2 : 1) * (e.off && e.scared ? 1.4 : 1) * (S.kind === 'snow' ? 2 : leafRate(S)) * (tree ? 1 : .6) + R());
        if (n > 0) shed(p, n, 'bird', e);
      }
    }
  }

  // ================================================================ the mesh's top (towers: the pennant's mast stands on it)
  const topCache = new WeakMap();
  function topOf(geo, lx, lz) {   // highest surface of a mesh (local metres) over the point (lx, lz); NaN = none
    let m = topCache.get(geo); if (!m) topCache.set(geo, m = new Map());
    const key = Math.round(lx * 100) + ',' + Math.round(lz * 100); if (m.has(key)) return m.get(key);
    const P = geo.attributes.position.array; let best = NaN;
    for (let i = 0; i < P.length; i += 9) {
      const ax = P[i], az = P[i + 2], bx = P[i + 3], bz = P[i + 5], cx = P[i + 6], cz = P[i + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-9) continue;
      const l0 = ((bz - cz) * (lx - cx) + (cx - bx) * (lz - cz)) / d, l1 = ((cz - az) * (lx - cx) + (ax - cx) * (lz - cz)) / d, l2 = 1 - l0 - l1;
      if (l0 < -1e-5 || l1 < -1e-5 || l2 < -1e-5) continue;
      const y = l0 * P[i + 1] + l1 * P[i + 4] + l2 * P[i + 7]; if (!(y <= best)) best = y;
    }
    m.set(key, best); return best;
  }

  // ================================================================ public
  const EMPTY = [];
  function setBiome(id) {
    biome = id; B = BIOME[id] || BIOME.ruins; seedField(); needDecor = true;
    fst.clear(); flames.clear(); parts.length = 0; fol = null;
  }
  Object.assign(W, {
    toggle() { W.on = !W.on; if (!W.on) { W.gust = 0; W.ms = 0; parts.length = 0; } return W.on; },
    // the strength: B cycles the modes (dev key), the pause menu lists them
    onKey(k, e) { if (k !== 'b' || e?.shiftKey) return false; setMode(MODES[(MODES.indexOf(W.mode) + 1) % MODES.length]); return true; },   // (Shift+B: windlines.js)
    settings: () => [{label: 'Wind strength', options: MODES, get: () => W.mode, set: setMode}],
    hud: () => W.on ? `wind ${W.mode}${W.mode === 'auto' ? ' (' + (host.env ? host.env.weather : spell) + ')' : ''} x${LV.toFixed(2)} · at you ${W.strength.toFixed(2)} · rustle ${W.rustle.e.toFixed(2)}` : '',
    biomeChanged() { setBiome(host.biome.id); },   // (main.js re-installs the card hook on the rebuilt world)
    view(dt, evs) {   // (all of the wind is presentation: nothing in the sim reads it)
      const t0 = performance.now();
      W.ms = W.ms * .95 + acc * .05; acc = 0;
      dt = Math.min(.05, Math.max(0, dt || 0));
      if (!W.on) { W.gust = 0; W.strength = 0; W.rustle.e = 0; tick(t0); return; }
      T += dt;
      stepStrength(dt);
      wph += dt * (3 + 5 * LV);   // with world.js RIP_K: the bands roll at ~1.5 + 1.5 LV m/s
      if (Math.floor(T * 12) !== wtick) { wtick = Math.floor(T * 12); wphQ = wph % 6283.19; }   // the light wave, stepped at 12 fps (fixed: this sat in the comment above)
      viewSync(); readPlayer();
      if (needDecor && host.props && ctx.PLAY) buildDecor();
      stepField(dt);
      if (PL.ok) { const a = field(PL.x, PL.y); W.gust = a.g; W.strength = Math.hypot(a.x, a.y) / vref(); } else W.gust = W.strength = 0;
      if (PL.ok) { stepFoliage(dt); arrowsThroughFoliage(); stepFeel(dt); }
      onEvents(evs);
      simAcc = Math.min(simAcc + dt, 3 / 60); nSim = 0;
      while (simAcc >= 1 / 60 - 1e-6) { stepDecor(1 / 60); simAcc -= 1 / 60; }
      stepParts(dt);
      tick(t0);
    },
    frame() {
      if (!W.on || needDecor) return;
      const t0 = performance.now();
      viewSync();
      const turned = YAW !== lastYaw, rast = turned || T - rT >= 1 / TUNE.clothFps - 1e-6;
      if (rast) { rT = T; lastYaw = YAW; }
      // raster first (the atlas uploads once, if a pixel changed), then draw
      CA.reset = false;
      const shown = [];
      for (const it of decor) { if (!visItem(it)) continue; shown.push(it); if (rast || !it.rastered) rasterItem(it); }
      if (CA.reset) { CA.reset = false; for (const it of shown) rasterItem(it); }
      const g = host.glayer('ground'); g.fillStyle = 'rgba(12,16,10,.38)';
      for (const it of shown) drawItem(it, g);
      CA.dirty = false;
      drawParts();
      tick(t0);
    },
    card, mesh,
    // a leaf lifted off the fallen carpet by a gust or a footfall (features/litter.js): {x, y, h, vx, vy, vh (m, m/s), pal ([hi, base, shade] hex), big,
    // onLand(q)}. It tumbles on the wind like a shed leaf and lies where it comes down; once it has lain its time it is gone and onLand(q) is
    // called (q.x, q.y: where, q.grp: whatever the caller put on it). false = not taken (wind off, or the particle cap)
    leaf(o) {
      if (!W.on || biome !== 'ruins' || parts.length >= 320) return false;
      spawnPart({kind: 'leaf', t: 0, ph: R() * TAU, rest: 0, life: 9 + R() * 4, g: 1.4, big: false, lie: 1.5, ...o}); return true;
    },
    // (o: an object to fill instead of a new one: per-frame callers pass a scratch object, nothing is allocated)
    at(x, y, o = null) { const r = o || {x: 0, y: 0, g: 0}; if (!W.on) { r.x = r.y = r.g = 0; return r; } const a = field(x, y); r.x = a.x; r.y = a.y; r.g = a.g; return r; },
    // the gust field for a shader that evaluates it per vertex (features/grass.js: the same fronts the trees feel). Fills out
    // (a Float32Array of 8 + 16 x max) with [UX, UY, base, gust, LV, T, n, on (0 off / 1 fronts / 2 pulse rings)], then per front
    // [F, len, A, edge, tc, half, k1, k2, k3, p1, p2, p3, w1, w2, 0, 0] (a pulse ring: [F, len, A, edge, ring x, ring y, k1, 0,
    // 0, p1, 0, 0, w1, 0, 0, 0]): the field() above, term for term. Returns n. Allocation-free
    gpu(out, max) {
      const n = W.on ? Math.min(max, fronts.length) : 0, rg = B.pulse ? ring() : null;
      out[0] = UX; out[1] = UY; out[2] = B.base; out[3] = B.gust; out[4] = LV; out[5] = T; out[6] = n; out[7] = !W.on ? 0 : B.pulse ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const f = fronts[i], o = 8 + i * 16;
        out[o] = f.F; out[o + 1] = f.len; out[o + 2] = f.A; out[o + 3] = f.edge;
        out[o + 4] = rg ? rg.x : f.tc; out[o + 5] = rg ? rg.y : f.half; out[o + 6] = f.k1; out[o + 7] = f.k2 || 0;
        out[o + 8] = f.k3 || 0; out[o + 9] = f.p1; out[o + 10] = f.p2 || 0; out[o + 11] = f.p3 || 0;
        out[o + 12] = f.w1; out[o + 13] = f.w2 || 0; out[o + 14] = 0; out[o + 15] = 0;
      }
      return n;
    },
    // the foliage (trees, bushes, tufts) round the view and the player, for other features' per-step loops (windlines.js):
    // read-only, the same array until the view crosses a cell edge or the props change
    foliage: () => nearList(),
    lights() {
      if (!W.on || needDecor) return EMPTY;
      const out = [];
      for (const L of lanterns) if (vis(L.x, L.y, 4)) out.push({x: L.bx, y: L.by, h: L.bz - .12, color: L.pal.light, radius: 3, intensity: .8, flicker: .3, id: L.id});
      return out;
    },
    // the cloak: the arena's CLOTH_PARAMS overrides at the player, turned into his view frame (the rig runs there)
    cloth() {
      if (!W.on || !PL.ok) return null;
      const a = field(PL.x, PL.y), C = B.cloth;
      let wx, wy, gust;
      if (B.pulse) { wx = a.x * C[1] / (B.gust || 1) + .05; wy = a.y * C[1] / (B.gust || 1); gust = .2; }   // (a.x already carries LV)
      else {   // the strength, as SHOW wind (like TUNE.clothV): the heavy wool cloak holds its drape against a real breeze, so a
        // brisk / gale wind pushes harder than its speed (x1.6 / x2.2) and gusts more, or it never lifts (capped at 10 m/s)
        const v = Math.min(10, (C[0] + a.g * C[1]) * LV * (1 + .6 * Math.max(0, LV - 1)));
        wx = UX * v; wy = UY * v; gust = .3 + .5 * Math.max(0, LV - 1);
      }
      const c = Math.cos(host.yaw), sn = Math.sin(host.yaw);
      return {wind: [wx * c - wy * sn, wx * sn + wy * c], gust};
    },
    atmosGust() { if (!W.on) return null; const [x, y] = viewCentre(); return field(x, y).g; },
    gustNow(A = 1) {   // test: a strong front just west (upwind) of the view
      const [cx, cy] = viewCentre(), x = cx - VB.hw - 3, y = cy;
      if (B.pulse) { fronts.push({...newPulse(), A}); return; }
      const f = newFront(x * UX + y * UY, A); f.tc = -x * UY + y * UX; f.half = 40; fronts.push(f);
    },
    info: () => ({fronts: fronts.length, decor: decor.length, parts: parts.length, simulated: nSim, foliage: fst.size, flames: flames.size, T: +T.toFixed(2), atlas: {gen: CA.gen, y: CA.y}}),
    _dbg: () => ({decor, fronts, parts, fst, lanterns, flames, CA, DA, VB,
      bend: (img, curve) => { const S = shapeOf(img); return {fit: bendOf(img, curve), rows: rowWeights(S, curve), top: S.top, base: S.base, h: S.h}; }}),
  });
  let rT = -1, lastYaw = NaN;
  setBiome(host.biome.id);
  return W;
}
