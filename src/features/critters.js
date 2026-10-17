// CRITTERS: small life underfoot in the forest (docs/WORLDLIFE.md "Critters"). The persistent world's woods get the small things:
//   BUTTERFLIES  by day in the sunny glades and the lakeside clearing, spring to autumn (brimstones and orange tips in spring; blues,
//                peacocks and whites in summer; a few peacocks and red admirals in autumn), fluttering in erratic loops and settling on
//                the flowers. Stand still ~3 s near one and it may come and sit on your shoulder, opening and closing its wings, until
//                you move. None in rain or a strong wind.
//   FROGS        on the lake's and the streams' banks (spring to autumn; more at dusk, at night and after rain). Come within a few metres
//                and they leap into the water with a ripple ring; a while later two eyes look up from the surface, and they climb back.
//                Brown common frogs, a green one now and then, and in spring the odd moor frog gone blue.
//   DRAGONFLIES  over the lake and the slow streams on summer days: hovering, darting in straight jerks, perching on the reeds' tops
//                (blue skimmers, red darters, banded demoiselles).
//   SNAILS, SLUGS  out on the stones and the esker's path after rain (env.wet), crawling slowly, each leaving a faint shiny trail; step
//                near and they pull in.
//   A WOODPECKER on a dead trunk by day, drumming in bursts (chips fly); come close and it slips round behind the trunk.
//   THE ODD ONES (in tone, artsy, never scary): on a rare day (about one in five) one glade has a pale butterfly with an eye on each
//                wing, and the eyes follow you (land on you and they look at the camera). Every warm night the frogs sit round the
//                stream's spring in a perfect ring, facing the middle, their throats pulsing together; step into the ring and they
//                all leap into the spring at once.
//
// MULTIPLAYER: VIEW ONLY, nothing sent. Where they live is a pure function of the world's seed (the forest plan: glades, banks, reeds,
// stones, dead trees: the same spots on every machine); how many are out at a spot is a function of the shared clock (env.day, part,
// season, weather, wet). Moment to moment they react to every person the client knows (him, co-op's peers: features/coop.js sample,
// and trolls: host.feature('trolls')?.list), so a friend walking past the bank sends your frogs in too.
//
// OWNS: its spot plan, its critter pool, its ripple / chip pools, its atlas. READS: world/layout.js FOREST (lake, streams, clearing,
// spring, esker, props), host.env (day, part, season, sky, wet, snowCover), host.player, coop (net.peers, sample), trolls (list),
// host.entities (near: is the dead tree still standing), host.elev, host.yaw. Art: features/wildlife.js (WILD_ART: the frog and
// dragonfly frames, WILD_PAL) + its own (butterflies, the eye, snails, slugs, the woodpecker).
// EMITS: critters.plop (a frog into the water), critters.drum (the woodpecker's burst), for audio later.
// BUDGET: only spots within TUNE.reach m of him are alive (a pool of TUNE.pool critters); the spots looked over 2.5 times a second;
// nothing allocated per frame (pooled critters, trails, rings, chips).
// URL: ?critters=0 off; ?critters=eye the eye butterfly every day; ?critters=all every kind out whatever the time, season, weather.
// Dev menu (F10) > Animals > Critters: go to the nearest frogs / butterflies / dragonflies / snails / woodpecker, the eye, the ring,
// make it after rain.
import {flags} from '../core/flags.js';
import {FOREST} from '../world/layout.js';
import {mulberry32, viewRandom} from '../core/rng.js';
import {TAU, clamp, hash3, hypot2} from '../core/mathx.js';
import {hex01} from '../core/color.js';
import {WILD_ART, WILD_PAL} from './wildlife.js';

const MODE = flags.get('critters');   // '0' off | 'eye' | 'all'
const ON = MODE !== '0';

const TUNE = {
  reach: 35,           // m from him: the spots inside are alive
  pool: 110,           // critters at most
  look: .4,            // s between looks over the spots
  bfly: {sp: 1, still: 3, land: 7, flee: 1.7, sit: [3, 8], fly: [3, 9]},
  frog: {flee: 3, under: [9, 20], peek: [2.5, 5], jump: .45},
  dfly: {flee: 1.5, dart: 5.5, reed: 1.02},
  snail: {flee: 1.3, speed: [.012, .028], hide: [5, 9]},
  wood: {hide: 3.6},
  ring: {n: 9, r: .95},
};

// ---------------------------------------------------------------- art (1 texel = 1 screen px; facing RIGHT; '0'-'3' the ramp, letters accents)
const A = (r, x, y) => ({r, x, y});
const ART = {
  bfly: {
    open: A(['11.11', '1a3a1', '.232.', '..3..'], 2, 2),
    mid: A(['.....', '.1.1.', '1a3a1', '..3..'], 2, 2),
    flat: A(['.....', '.....', '1a3a1', '..3..'], 2, 2),
    closed: A(['..10.', '..1a.', '..23.', '..3..'], 2, 2),
  },
  peek: {eyes: A(['1.1', '232'], 1, 1)},
  snail: {
    out: A(['.11..k', '1a21.b', '3bbbbb'], 3, 2),
    in: A(['.11...', '1a21..', '322...'], 3, 2),
  },
  slug: {
    out: A(['.0111.k', '3221111'], 3, 1),
    in: A(['..01...', '.3211..'], 3, 1),
  },
  wood: {
    cling: A(['.kk..', 'rkwb.', '.kw..', 'kwk..', 'kwk..', 'kkr..', '.k...'], 2, 6),
    peck: A(['..kk.', '.rkwb', '.kw..', 'kwk..', 'kwk..', 'kkr..', '.k...'], 2, 6),
  },
};
// the eye butterfly (9 x 5, anchor the body's middle): an eye on each wing, its pupil at (px, py) of the 3 x 2 eye
const EYE_ROWS = (px, py, shut) => {
  const r = [['.', '1', '1', '1', '.', '1', '1', '1', '.'], ['1', 's', 's', 's', '3', 's', 's', 's', '1'], ['1', 's', 's', 's', '3', 's', 's', 's', '1'],
    ['.', '1', '2', '2', '3', '2', '2', '1', '.'], ['.', '.', '2', '.', '3', '.', '2', '.', '.']];
  for (const c of [1, 5]) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) r[1 + j][c + i] = shut ? '2' : i === px && j === py ? 'p' : 's';
  return r.map(a => a.join(''));
};
const PAL = {
  brimstone: {r: ['#fbf4a8', '#ecd84c', '#b8a030', '#4c4422'], a: '#e89a3c'},
  orangetip: {r: ['#fcfbf4', '#e6e4d8', '#b0aea2', '#3a3832'], a: '#f08a2c'},
  blue: {r: ['#c4dcff', '#7f9ff2', '#4c66b6', '#20284a'], a: '#eef2fa'},
  peacock: {r: ['#f07850', '#c8402c', '#882a22', '#2a1416'], a: '#4a6ae0'},
  white: {r: ['#fbfbf6', '#e4e4dc', '#aeaea4', '#3a3a36'], a: '#3a3a3a'},
  admiral: {r: ['#4a3c3c', '#2c2424', '#1c1616', '#0c0a0a'], a: '#e8502c'},
  eye: {r: ['#f4eee4', '#d6cdbd', '#a2967f', '#3a3230'], s: '#fdfbf4', p: '#120c14'},
  frogBrown: {r: ['#b8986a', '#8e724c', '#665034', '#3a2c1e'], a: '#d8c08a'},
  frogBlue: {r: ['#b0d0f4', '#7098d0', '#4a6a9c', '#24344e'], a: '#dce8f4'},
  demoiselle: {r: ['#6ad8c8', '#2a8a9a', '#1a5260', '#0a2630'], a: '#34407a'},
  snail: {r: ['#c8a070', '#9a7448', '#6a4c2e', '#33241a'], a: '#e0c49a', b: '#9c9284', k: '#4a4440'},
  banded: {r: ['#f2dc7a', '#d8b848', '#a08030', '#3a2c14'], a: '#5a3a24', b: '#a89c88', k: '#4a4440'},
  slugBlack: {r: ['#5e5a56', '#3c3836', '#262322', '#121010'], k: '#121010'},
  slugOrange: {r: ['#f2a060', '#d4692a', '#9a4216', '#4a1e0a'], k: '#4a1e0a'},
  wood: {k: '#1c181a', w: '#eeeae2', r: '#d0342c', b: '#5a4c40'},
};
// which butterflies fly in which season (weights)
const SEASON_BFLY = {spring: [['brimstone', .5], ['orangetip', .3], ['peacock', .2]], summer: [['blue', .35], ['peacock', .3], ['white', .2], ['brimstone', .15]],
  autumn: [['peacock', .45], ['admiral', .4], ['brimstone', .15]], winter: [['peacock', 1]]};
const C01 = h => hex01(h);
const TRAIL = 40;   // trail points a snail keeps
const COL = {trail: C01('#e4ecf0'), glint: C01('#ffffff'), ring: [C01('#e2eef2'), C01('#a8c6cc')], shade: C01('#10140c'),
  chip: [C01('#8a7058'), C01('#b49a7c'), C01('#5c4a3a')]};

// ORDER (core/features.js): none needed (a view of its own, read after the world's step)
export async function create(host) {
  const F = {name: 'critters', label: 'Critters', on: ON, ambient: true, dev: {group: 'Animals'}};
  const FO = FOREST;
  if (!FO) return Object.assign(F, {on: false, dbg: () => ({off: 'no forest'})});
  const G = host.G, P = host.player, L = FO.lake, E = () => host.env;
  const game = () => host.feature('game');
  const active = () => F.on && host.biome?.id === 'ruins' && game()?.mode === 'sandbox' && !!host.layout?.forest;
  const elev = (x, y) => host.elev(x, y);
  const SEED = FO.seed | 0, RS = mulberry32(SEED ^ 0x6c17735), R = viewRandom('critters');
  const rr = (a, b) => a + R() * (b - a);
  const toast = (t, s, c = '#cfe3a0') => game()?.ui?.toast?.(t, s, c);

  // ================================================================ THE SPOTS (from the plan: the same on every machine)
  const CELL = 4, TG = new Map(), TU = new Map(), STONES = [], DEAD = [], REEDS = [];
  const ck = (x, y) => (Math.floor(x / CELL) + 512) * 4096 + Math.floor(y / CELL) + 512;
  const addTo = (M, x, y, v) => { const k = ck(x, y); let a = M.get(k); if (!a) M.set(k, a = []); a.push(v); };
  for (const p of FO.props) {
    const kind = p[0], x = p[1], y = p[2];
    if (kind === 'tree') { addTo(TG, x, y, p); if (p[3]?.species === 'dead') DEAD.push(p); }
    else if (kind === 'tuft') addTo(TU, x, y, p);
    else if (kind === 'reed') REEDS.push(p);
    else if (kind === 'rock' || kind === 'rock_big') STONES.push(p);
  }
  const within = (M, x, y, r, fn) => { const n = Math.ceil(r / CELL); for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const a = M.get(ck(x + i * CELL, y + j * CELL)); if (a) for (const p of a) fn(p); } };
  const treeD = (x, y, r) => { let d = r; within(TG, x, y, r, p => { d = Math.min(d, Math.hypot(p[1] - x, p[2] - y)); }); return d; };
  const CO = {d: 0, a: 0, l: 0, hw: 0, i: 0, k: 0};
  const courseGap = (x, y) => FO.at(x, y, CO) ? -1 : CO.d - CO.hw;
  const waterNear = (x, y, m) => FO.inLake(x, y, m) || courseGap(x, y) < m;
  const SP = FO.spring, sE = FO.stream, oF = FO.outflow;
  const mouthD = (x, y) => Math.min(Math.hypot(x - sE.px[sE.n - 1], y - sE.py[sE.n - 1]), Math.hypot(x - oF.px[0], y - oF.py[0]));
  const SITES = [];
  const site = (kind, o) => { o.kind = kind; o.id = SITES.length; o.live = 0; o.want = 0; o.in = false; SITES.push(o); return o; };
  // GLADES: open ground (no tree within 4.5 m), off the water; the clearing first; spaced 15 m apart; flowers = the tufts in them
  const GLADES = [];
  {
    const cand = [], RC = FO.rect;
    for (let y = RC.y0 + 6; y < RC.y1 - 4; y += 5) for (let x = RC.x0 + 6; x < RC.x1 - 6; x += 5) {
      const jx = x + (RS() - .5) * 3, jy = y + (RS() - .5) * 3;
      if (waterNear(jx, jy, 2)) continue;
      const open = treeD(jx, jy, 10); if (open < 4.5) continue;
      cand.push({x: jx, y: jy, open: open + RS() * .5});
    }
    cand.sort((a, b) => b.open - a.open);
    const C0 = FO.clearing; GLADES.push({x: C0.x, y: C0.y, r: C0.r - 1});
    for (const c of cand) { if (GLADES.length >= 34) break; if (GLADES.some(g => Math.hypot(g.x - c.x, g.y - c.y) < 15)) continue; GLADES.push({x: c.x, y: c.y, r: Math.min(6, c.open - 1.5)}); }
    for (const g of GLADES) {
      const fl = []; within(TU, g.x, g.y, g.r, p => { if (fl.length < 8 && Math.hypot(p[1] - g.x, p[2] - g.y) < g.r) fl.push([p[1], p[2]]); });
      while (fl.length < 5) { const a = RS() * TAU, d = Math.sqrt(RS()) * g.r * .9; fl.push([g.x + Math.cos(a) * d, g.y + Math.sin(a) * d]); }
      g.fl = fl;
      site('glade', g);
    }
  }
  // FROG BANKS: round the lake's shore (bisected on its wandering shore line) and along the streams every ~9 m, a side each
  {
    for (let k = 0, got = 0; k < 16 && got < 9; k++) {
      const a = k / 16 * TAU + (RS() - .5) * .3, ca = Math.cos(a), sa = Math.sin(a);
      let lo = .3, hi = 1.6; for (let it = 0; it < 20; it++) { const m = (lo + hi) / 2; if (FO.shoreAt(L.x + ca * L.rx * m, L.y + sa * L.ry * m) < 1) lo = m; else hi = m; }
      const sx = L.x + ca * L.rx * lo, sy = L.y + sa * L.ry * lo, ul = Math.hypot(sx - L.x, sy - L.y) || 1, ux = (sx - L.x) / ul, uy = (sy - L.y) / ul;
      const bx = sx + ux * .5, by = sy + uy * .5, wx = sx - ux * 1.1, wy = sy - uy * 1.1;
      if (mouthD(bx, by) < 3 || !FO.inLake(wx, wy) || FO.inLake(bx, by) || courseGap(bx, by) < .4 || RS() < .3) continue;
      site('pond', {x: bx, y: by, wx, wy, ux: -ux, uy: -uy, lake: true}); got++;
    }
    for (const C of [sE, oF]) for (let i = 30; i < C.n - 30; i += 90) {
      const x = C.px[i], y = C.py[i]; if (FO.inLake(x, y, 2.5) || y > -6 || Math.hypot(x - SP.x, y - SP.y) < 3) continue;
      let dx = C.px[i + 3] - C.px[i - 3], dy = C.py[i + 3] - C.py[i - 3]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const s = RS() < .5 ? 1 : -1, nx = -dy * s, ny = dx * s, hw = C.hw[i], bx = x + nx * (hw + .35), by = y + ny * (hw + .35);
      if (FO.at(bx, by, CO) || FO.inLake(bx, by, .3)) continue;
      site('pond', {x: bx, y: by, wx: x + nx * hw * .2, wy: y + ny * hw * .2, ux: -nx, uy: -ny, lake: false});
    }
  }
  // THE RING: round the spring (its ring of stones), the frogs of the night
  const RING = site('ring', {x: SP.x, y: SP.y, r: SP.r + TUNE.ring.r});
  // REEDS: clusters of the reed clumps (the dragonflies' homes); a few lake banks besides if the seed grew few reeds
  {
    const order = REEDS.map((p, i) => [hash3(SEED, i, 77), p]).sort((a, b) => a[0] - b[0]).map(a => a[1]);
    for (const p of order) {
      if (SITES.some(s => s.kind === 'reeds' && Math.hypot(s.x - p[1], s.y - p[2]) < 7)) continue;
      const rd = REEDS.filter(q => Math.hypot(q[1] - p[1], q[2] - p[2]) < 5).slice(0, 8).map(q => [q[1], q[2]]);
      site('reeds', {x: p[1], y: p[2], reeds: rd, slow: true});
    }
    let n = SITES.filter(s => s.kind === 'reeds').length;
    for (const s of SITES.slice()) if (s.kind === 'pond' && s.lake && n < 6) { site('reeds', {x: (s.x + s.wx) / 2, y: (s.y + s.wy) / 2, reeds: [], slow: true}); n++; }
  }
  // STONES and THE PATH: snails' spots (the stones in the home woods and along the way north; the esker's crest, a natural path)
  {
    const order = STONES.map((p, i) => [hash3(SEED, i, 91), p]).sort((a, b) => a[0] - b[0]).map(a => a[1]);
    let n = 0;
    for (const p of order) {
      if (n >= 46) break;
      if (SITES.some(s => s.kind === 'stone' && Math.hypot(s.x - p[1], s.y - p[2]) < 6)) continue;
      site('stone', {x: p[1], y: p[2], r: p[0] === 'rock_big' ? .85 : .3}); n++;
    }
    const ES = FO.esker?.pts; if (ES) for (const [x, y] of ES) site('stone', {x, y, r: .05, path: true});
  }
  // DEAD TRUNKS: the woodpecker's
  for (const p of DEAD) site('dead', {x: p[1], y: p[2], scale: p[3]?.scale || 1, fid: p[3]?.fid, gone: false, chk: 0});
  // THE EYE: one glade on a rare day
  const EYE = site('eye', {x: 0, y: 0, g: -1});

  // ================================================================ WHO IS OUT (the shared clock + the weather; the spot's roll for the day)
  const force = {bfly: false, frog: false, dfly: false, snail: false, wood: false, ring: false, eye: MODE === 'eye'};
  const ALL = () => MODE === 'all';
  const K = {bfly: 0, frog: 0, dfly: 0, snail: 0, wood: 0, ring: 0, day: 0, season: 'summer', eyeGlade: -1};
  let eyeForced = -1;
  function conditions() {
    const e = E(), sky = e.sky || {}, rain = sky.rain || 0, wind = sky.wind ?? 1, s = e.season, part = e.part, wet = e.wet || 0, snow = (e.snowCover || 0) > .3, all = ALL();
    K.day = e.day | 0; K.season = s;
    K.bfly = force.bfly || all ? 1 : part === 'day' && rain < .08 && wind < 1.75 && !snow ? ({spring: .8, summer: 1.2, autumn: .4}[s] || 0) : 0;
    K.frog = force.frog || all ? 1.2 : s === 'winter' || snow ? 0 : (part === 'dusk' ? 1.3 : part === 'night' ? 1.1 : part === 'dawn' ? .9 : .55) * (s === 'autumn' ? .5 : 1) * (1 + .8 * wet);
    K.dfly = force.dfly || all ? 1 : part === 'day' && rain < .05 && wind < 2 && !snow ? ({summer: 1, spring: .45, autumn: .15}[s] || 0) : 0;
    K.snail = force.snail || all ? 1 : s === 'winter' || snow ? 0 : wet > .3 || rain > .2 ? (part === 'day' ? .6 : 1) * clamp((Math.max(wet, rain) - .2) / .5, .35, 1) : 0;
    K.wood = force.wood || all ? 1 : (part === 'day' || part === 'dawn') && rain < .5 ? 1 : 0;
    K.ring = force.ring || all ? 1 : part === 'night' && s !== 'winter' && !snow ? 1 : 0;
    const eyeDay = force.eye || hash3(SEED, 991, K.day) < .2;
    K.eyeGlade = !K.bfly && !force.eye ? -1 : eyeForced >= 0 ? eyeForced : eyeDay ? Math.floor(hash3(SEED, 992, K.day) * GLADES.length) : -1;
  }
  const want = s => {
    const roll = hash3(SEED, s.id * 7 + 3, K.day), r2 = hash3(SEED, s.id * 13 + 5, K.day);
    switch (s.kind) {
      case 'glade': return K.bfly ? Math.min(5, (r2 < .25 && s.id !== 0 && !force.bfly ? 0 : Math.round(K.bfly * (1.5 + roll * 3)))) : 0;
      case 'pond': return K.frog ? Math.min(3, Math.max(force.frog ? 1 : 0, r2 < .2 ? 0 : Math.round(K.frog * (.8 + roll * 2)))) : 0;
      case 'ring': return K.ring ? TUNE.ring.n : 0;
      case 'reeds': return K.dfly ? Math.min(3, Math.max(force.dfly ? 1 : 0, Math.round(K.dfly * (.6 + roll * 2.2)))) : 0;
      case 'stone': return K.snail ? Math.min(3, Math.max(force.snail ? 1 : 0, r2 < .4 && !force.snail ? 0 : Math.round(K.snail * (1 + roll * 1.8)))) : 0;
      case 'dead': return K.wood && !s.gone && (r2 < .22 || force.wood) ? 1 : 0;
      case 'eye': return K.eyeGlade >= 0 ? 1 : 0;
    }
    return 0;
  };
  const pickW = (tab, u) => { for (const [k, w] of tab) { if ((u -= w) < 0) return k; } return tab[tab.length - 1][0]; };

  // ================================================================ PEOPLE (him, co-op's peers, trolls)
  const PEOPLE = []; for (let i = 0; i < 12; i++) PEOPLE.push({x: 0, y: 0, z: 0, sp: 0, still: 0, k: 1, me: false, px: NaN, py: NaN, seat: -1, troll: false});
  let nP = 0;
  const PS = {x: 0, y: 0, z: 0, phi: 0, s: '', pose: '', w: null, ls: null};
  function gather(dt) {
    const q = PEOPLE[0];
    q.x = P.x; q.y = P.y; q.z = P.z ?? elev(P.x, P.y); q.sp = hypot2(P.vx || 0, P.vy || 0); q.me = true; q.k = 1; q.troll = false;
    const busy = q.sp > .15 || P.state === 'roll' || P.state === 'leap' || P.state === 'knock' || P.aiming || host.lock;
    q.still = busy ? 0 : q.still + dt;
    nP = 1;
    const C = host.feature('coop')?.net;
    if (C && C.peers && C.sample) for (const peer of C.peers.values()) {
      if (nP >= 8) break;
      const o = C.sample(peer, PS); if (!o) continue;
      const r = PEOPLE[nP++], v = Number.isNaN(r.px) || dt <= 0 ? 0 : hypot2(o.x - r.px, o.y - r.py) / dt;
      r.px = r.x = o.x; r.py = r.y = o.y; r.z = o.z ?? elev(o.x, o.y); r.sp = v > 30 ? 0 : v; r.still = r.sp > .15 ? 0 : r.still + dt; r.me = false; r.k = 1; r.troll = false;
    }
    const T = host.feature('trolls')?.list;
    if (T) for (let i = 0; i < T.length && nP < PEOPLE.length; i++) {
      const t = T[i]; if (!t) continue;
      const r = PEOPLE[nP++]; r.x = t.x; r.y = t.y; r.z = elev(t.x, t.y); r.sp = 2; r.still = 0; r.k = t.loud || 1.6; r.me = false; r.troll = true; r.px = r.py = NaN;
    }
  }
  // the nearest person who'd scare a critter at (x, y) that flees at `base` m (scaled by how they move: still .45, walking 1, running 1.5)
  const TH = {i: -1, d: 1e9, x: 0, y: 0};
  function scare(x, y, base) {
    TH.i = -1; TH.d = 1e9;
    for (let i = 0; i < nP; i++) {
      const q = PEOPLE[i], d = hypot2(q.x - x, q.y - y), f = (q.sp > 4 ? 1.5 : q.sp > .3 ? 1 : .45) * q.k;
      if (d < base * f && d < TH.d) { TH.i = i; TH.d = d; TH.x = q.x; TH.y = q.y; }
    }
    return TH.i >= 0;
  }
  const nearestPerson = (x, y) => { let b = 0, bd = 1e9; for (let i = 0; i < nP; i++) { if (PEOPLE[i].troll) continue; const d = hypot2(PEOPLE[i].x - x, PEOPLE[i].y - y); if (d < bd) { bd = d; b = i; } } TH.d = bd; return PEOPLE[b]; };

  // ================================================================ THE POOL
  const CR = [];
  for (let i = 0; i < TUNE.pool; i++) CR.push({on: false, kind: '', site: null, slot: 0, pal: '', x: 0, y: 0, h: 0, a: 0, w: 0, sp: 0, fx: 1, fy: 0, st: '', t: 0, ph: 0, flap: 0,
    tx: 0, ty: 0, th: 0, hb: 0, ax: 0, ay: 0, ah: 0, bx: 0, by: 0, bh: 0, d: 0, seat: -1, leave: false, px: 1, py: 0, blink: 0, n: 0, tr: new Float32Array(TRAIL * 3), tn: 0, ti: 0, tacc: 0, sf: 1});
  let nLive = 0;
  function spawn(s) {
    let c = null; for (const q of CR) if (!q.on) { c = q; break; } if (!c) return null;
    c.on = true; c.site = s; c.leave = false; c.t = 0; c.ph = R() * TAU; c.flap = R() * 4; c.seat = -1; c.tn = 0; c.ti = 0; c.tacc = 0; c.blink = 0; c.n = 0;
    c.slot = s.live++; nLive++;
    const roll = hash3(SEED, s.id * 31 + c.slot, K.day);
    switch (s.kind) {
      case 'glade': case 'eye': {
        const g = s.kind === 'eye' ? GLADES[K.eyeGlade] : s;
        if (s.kind === 'eye') { s.g = K.eyeGlade; s.x = g.x; s.y = g.y; }
        c.kind = 'bfly'; c.pal = s.kind === 'eye' ? 'eye' : pickW(SEASON_BFLY[K.season] || SEASON_BFLY.summer, roll);
        const a = R() * TAU, d = Math.sqrt(R()) * g.r; c.x = g.x + Math.cos(a) * d; c.y = g.y + Math.sin(a) * d;
        c.hb = elev(c.x, c.y) + rr(.5, 1.3); c.h = c.hb; c.a = R() * TAU; c.w = 0; c.st = 'fly'; c.d = rr(...TUNE.bfly.fly); c.g = g; newTarget(c);
        if (c.pal === 'eye') { c.st = 'sit'; const f = g.fl[0]; c.x = f[0]; c.y = f[1]; c.h = elev(c.x, c.y) + .2; c.d = rr(25, 40); }
        break;
      }
      case 'pond': {
        c.kind = 'frog'; c.pal = K.season === 'spring' && roll < .2 ? 'frogBlue' : roll > .8 ? 'frogGreen' : 'frogBrown';
        const off = (c.slot - .9) * .6 + (hash3(SEED, s.id, c.slot) - .5) * .3;
        c.bx = s.x - s.uy * off; c.by = s.y + s.ux * off; c.bh = elev(c.bx, c.by);
        c.ax = s.wx - s.uy * off * .7; c.ay = s.wy + s.ux * off * .7; c.ah = elev(c.ax, c.ay);
        c.x = c.bx; c.y = c.by; c.h = c.bh; c.fx = s.ux; c.fy = s.uy; c.st = 'sit'; c.d = 0;
        break;
      }
      case 'ring': {
        c.kind = 'frog'; c.pal = 'frogBrown'; c.ring = true;
        const a = c.slot / TUNE.ring.n * TAU; c.bx = s.x + Math.cos(a) * s.r; c.by = s.y + Math.sin(a) * s.r * .9; c.bh = elev(c.bx, c.by);
        c.ax = s.x + Math.cos(a) * .12; c.ay = s.y + Math.sin(a) * .12; c.ah = elev(s.x, s.y);
        c.x = c.bx; c.y = c.by; c.h = c.bh; c.fx = -Math.cos(a); c.fy = -Math.sin(a); c.st = 'sit';
        break;
      }
      case 'reeds': {
        c.kind = 'dfly'; c.pal = s.reeds.length && roll < .3 ? 'demoiselle' : roll < .65 ? 'dfly0' : 'dfly1';
        c.x = s.x + rr(-1.5, 1.5); c.y = s.y + rr(-1.5, 1.5); c.h = elev(c.x, c.y) + rr(.6, 1.2); c.st = 'hover'; c.d = rr(.3, 1.5); c.tx = c.x; c.ty = c.y; c.th = c.h;
        break;
      }
      case 'stone': {
        c.kind = roll < .55 ? 'snail' : 'slug'; c.pal = c.kind === 'snail' ? (roll < .3 ? 'banded' : 'snail') : (roll > .8 ? 'slugOrange' : 'slugBlack');
        const a = R() * TAU, d = s.r + rr(.1, .8); c.x = s.x + Math.cos(a) * d; c.y = s.y + Math.sin(a) * d * .9; c.h = elev(c.x, c.y); c.a = a + Math.PI / 2; c.w = 0;
        c.sp = rr(...TUNE.snail.speed); c.st = 'crawl'; c.d = 0;
        break;
      }
      case 'dead': {
        c.kind = 'wood'; c.pal = 'wood'; c.h = elev(s.x, s.y) + 1.3 + roll * .9 * s.scale; c.x = s.x; c.y = s.y; c.st = 'pause'; c.d = rr(.5, 2); c.px = roll < .5 ? 1 : -1;
        break;
      }
    }
    return c;
  }
  function free(c) { if (!c.on) return; c.on = false; c.ring = false; nLive--; if (!c.leave && c.site) c.site.live--; c.site = null; }
  function newTarget(c) {
    const g = c.g, a = R() * TAU, d = Math.sqrt(R()) * g.r; c.tx = g.x + Math.cos(a) * d; c.ty = g.y + Math.sin(a) * d; c.th = elev(c.tx, c.ty) + rr(.35, 1.5);
  }

  // ================================================================ THE LOOK OVER THE SPOTS (2.5 a second)
  let lookT = 0, lastKey = '';
  const OUT = [];
  function look() {
    conditions();
    const key = `${K.bfly.toFixed(2)}|${K.frog.toFixed(2)}|${K.dfly.toFixed(2)}|${K.snail.toFixed(2)}|${K.wood}|${K.ring}|${K.day}|${K.season}|${K.eyeGlade}`;
    const changed = key !== lastKey; lastKey = key;
    const fx = P.x, fy = P.y, R2 = TUNE.reach;
    for (const s of SITES) {
      if (s.kind === 'eye' && K.eyeGlade < 0 && !s.live) { s.in = false; continue; }
      const sx = s.kind === 'eye' && K.eyeGlade >= 0 ? GLADES[K.eyeGlade].x : s.x, sy = s.kind === 'eye' && K.eyeGlade >= 0 ? GLADES[K.eyeGlade].y : s.y;
      const inR = Math.abs(sx - fx) < R2 && Math.abs(sy - fy) < R2 && hypot2(sx - fx, sy - fy) < R2;
      if (!inR) { if (s.in) { for (const c of CR) if (c.on && c.site === s) free(c); s.in = false; s.live = 0; } continue; }
      if (s.kind === 'dead' && (!s.in || (s.chk -= TUNE.look) <= 0)) {   // (a felled trunk: no woodpecker on it)
        s.chk = 5; host.entities.near(s.x, s.y, .7, OUT); let st = false; for (const p of OUT) if (p.kind === 'tree' && Math.abs(p.x - s.x) < .3 && Math.abs(p.y - s.y) < .3 && !p.gone) st = true; OUT.length = 0; s.gone = !st;
      }
      s.in = true;
      if (changed || !s.seen) { s.want = want(s); s.seen = true; }
      let guard = 0;
      while (s.live < s.want && guard++ < 6) if (!spawn(s)) break;
      if (s.live > s.want) for (const c of CR) { if (s.live <= s.want) break; if (c.on && c.site === s && !c.leave) { c.leave = true; s.live--; c.t = 0; } }
    }
  }

  // ================================================================ THE CRITTERS' MOVES (view: presentation only)
  const ringFx = [];
  for (let i = 0; i < 14; i++) ringFx.push({on: false, x: 0, y: 0, h: 0, t: 0, life: 1, r: .5});
  const ripple = (x, y, h, r = .5) => { for (const o of ringFx) if (!o.on) { o.on = true; o.x = x; o.y = y; o.h = h + .012; o.t = 0; o.life = 1 + r; o.r = r; return; } };
  const CH = []; for (let i = 0; i < 40; i++) CH.push({on: false, x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0, t: 0, c: 0});
  const chip = (x, y, h, dir) => { for (const o of CH) if (!o.on) { o.on = true; o.x = x; o.y = y; o.h = h; const a = rr(-.8, .8); o.vx = dir * RX * rr(.6, 1.4) + FX * a; o.vy = dir * RY * rr(.6, 1.4) + FY * a; o.vh = rr(.4, 1.4); o.t = 0; o.c = R() * 3 | 0; return; } };
  const plopEv = (x, y) => host.events?.push({type: 'critters.plop', x, y});
  let RX = 1, RY = 0, FX = 0, FY = 1;
  const wrapA = a => a - Math.round(a / TAU) * TAU;
  const seen = {land: false, eye: false, ring: false, wood: false};

  function stepBfly(c, dt) {
    const B = TUNE.bfly, g = c.g, eye = c.pal === 'eye';
    c.t += dt;
    if (c.leave) { c.st = 'fly'; c.h += dt * .9; c.x += Math.cos(c.a) * dt; c.y += Math.sin(c.a) * dt; c.flap += dt * 14; if (c.t > 4) free(c); return; }
    if (c.st === 'onyou') {
      const q = PEOPLE[c.seat];
      if (!q || c.seat >= nP || q.sp > .3 || q.still === 0) { c.st = 'fly'; c.seat = -1; c.a = R() * TAU; c.w = 0; c.d = rr(...B.fly); c.hb = c.h + .4; newTarget(c); return; }
      c.x = q.x + RX * .17 * c.sf + FX * .05; c.y = q.y + RY * .17 * c.sf + FY * .05; c.h = q.z + 1.42;
      c.flap += dt * 1.3; c.fx = RX * -c.sf; c.fy = RY * -c.sf;
      if (eye) { c.px = 1; c.py = 1; }   // (on you: it looks at the camera)
      return;
    }
    if (c.st === 'sit') {
      c.flap += dt * (eye ? .25 : 1.6);
      if (eye) {   // the eyes follow the nearest person (a blink now and then); within a metre the wings close
        const q = nearestPerson(c.x, c.y), d = TH.d, dx = (q.x - c.x) * RX + (q.y - c.y) * RY, dz = (q.x - c.x) * FX + (q.y - c.y) * FY;
        c.px = dx < -.6 ? 0 : dx > .6 ? 2 : 1; c.py = dz > .3 ? 1 : 0;
        if ((c.blink -= dt) < -rr(2, 5)) c.blink = .14;
        c.n = d < 1.1 ? 1 : 0;
        if (!seen.eye && q.me && d < 9) { seen.eye = true; toast('A butterfly in the glade', 'its wings have eyes, and the eyes follow you', '#e8dcc8'); }
        if (c.t > c.d && d > 2) { c.st = 'fly'; c.d = rr(4, 7); c.t = 0; newTarget(c); }
        return;
      }
      if (scare(c.x, c.y, B.flee) || c.t > c.d) { c.st = 'fly'; c.t = 0; c.d = rr(...B.fly); c.hb = c.h + .5; c.a = TH.i >= 0 ? Math.atan2(c.y - TH.y, c.x - TH.x) : R() * TAU; c.w = 0; newTarget(c); }
      return;
    }
    // flying: a wandering heading steered loosely at a target, jinking (the erratic loops), bobbing
    let goX = c.tx, goY = c.ty, goH = c.th;
    if (c.st === 'approach') {
      const q = PEOPLE[c.seat];
      if (!q || c.seat >= nP || q.sp > .3 || q.still === 0) { c.st = 'fly'; c.seat = -1; }
      else { goX = q.x + RX * .17 * c.sf; goY = q.y + RY * .17 * c.sf; goH = q.z + 1.42; if (hypot2(goX - c.x, goY - c.y) < .12 && Math.abs(goH - c.h) < .15) {
        c.st = 'onyou'; q.seat = c.slot; if (q.me && !seen.land) { seen.land = true; toast(eye ? 'It landed on you' : 'A butterfly landed on you', eye ? 'the eyes look past you, at whoever is watching' : 'stand still and it stays', '#f2e39c'); } return; } }
    } else if (c.st === 'settle') {
      if (hypot2(c.tx - c.x, c.ty - c.y) < .1) { c.st = 'sit'; c.t = 0; c.d = eye ? rr(10, 20) : rr(...B.sit); c.x = c.tx; c.y = c.ty; c.h = c.th; return; }
    } else {
      if (hypot2(c.tx - c.x, c.ty - c.y) < .4 || R() < dt * .4) newTarget(c);
      if (c.t > c.d) {   // time to rest: a flower
        const f = g.fl[R() * g.fl.length | 0]; c.tx = f[0] + rr(-.1, .1); c.ty = f[1] + rr(-.1, .1); c.th = elev(c.tx, c.ty) + .2; c.st = 'settle';
      }
      // a person standing still near: one comes to sit on them
      if (!c.leave) for (let i = 0; i < nP; i++) {
        const q = PEOPLE[i]; if (q.troll || q.still < B.still || seatTaken(q)) continue;
        if (hypot2(q.x - c.x, q.y - c.y) < B.land && R() < dt * .5) { c.st = 'approach'; c.seat = i; c.sf = R() < .5 ? 1 : -1; break; }
      }
      if (scare(c.x, c.y, B.flee)) { const fa = Math.atan2(c.y - TH.y, c.x - TH.x); c.a = fa; c.tx = c.x + Math.cos(fa) * 3; c.ty = c.y + Math.sin(fa) * 3; c.th = c.h + .6; }
    }
    const want = Math.atan2(goY - c.y, goX - c.x), diff = wrapA(want - c.a);
    c.w += ((diff * (c.st === 'fly' ? 2.2 : 6)) - c.w) * Math.min(1, dt * 3) + (R() - .5) * (c.st === 'fly' ? 40 : 12) * dt;
    c.w = clamp(c.w, -9, 9); c.a = wrapA(c.a + c.w * dt);
    const sp = (eye ? .6 : B.sp) * (.75 + .45 * Math.sin(c.t * 3.1 + c.ph)) * (c.st === 'fly' ? 1 : Math.min(1, hypot2(goX - c.x, goY - c.y) * 2 + .25));
    c.x += Math.cos(c.a) * sp * dt; c.y += Math.sin(c.a) * sp * dt;
    c.hb += (goH - c.hb) * Math.min(1, dt * (c.st === 'fly' ? .8 : 3));
    c.h = c.hb + (c.st === 'fly' ? Math.sin(c.t * 6.5 + c.ph) * .1 : 0);
    const gnd = elev(c.x, c.y) + .12; if (c.h < gnd) c.h = c.hb = gnd;
    if (hypot2(c.x - g.x, c.y - g.y) > g.r + 5 && c.st === 'fly') { c.tx = g.x; c.ty = g.y; }
    c.fx = Math.cos(c.a); c.fy = Math.sin(c.a);
    c.flap += dt * (eye ? 7 : 15);
  }
  function seatTaken(q) { for (const c of CR) if (c.on && c.kind === 'bfly' && (c.st === 'onyou' || c.st === 'approach') && PEOPLE[c.seat] === q) return true; return false; }

  function stepFrog(c, dt) {
    const T = TUNE.frog, s = c.site;
    c.t += dt;
    if (c.leave && c.st === 'under') { free(c); return; }
    if (c.leave && c.st === 'sit') { c.st = 'jump'; c.t = 0; c.d = 1; }   // (going: into the water, and not back)
    switch (c.st) {
      case 'sit': {
        c.flap -= dt; if (c.flap < -rr(1.5, 6)) c.flap = .6;   // a throat pulse now and then
        if (c.ring) {
          const q = nearestPerson(s.x, s.y);
          if (!seen.ring && q.me && TH.d < 10) { seen.ring = true; toast('By the spring', 'the frogs sit in a ring, all facing the middle', '#b8d0a0'); }
          if (TH.d < s.r - .15) { for (const o of CR) if (o.on && o.ring && o.st === 'sit') { o.st = 'jump'; o.t = 0; o.d = 0; } }
          return;
        }
        if (scare(c.x, c.y, T.flee)) { c.st = 'jump'; c.t = 0; c.d = 0; }
        break;
      }
      case 'jump': {   // the leap: bank -> water
        const k = Math.min(1, c.t / T.jump);
        c.x = c.bx + (c.ax - c.bx) * k; c.y = c.by + (c.ay - c.by) * k; c.h = c.bh + (c.ah - c.bh) * k + Math.sin(k * Math.PI) * .32;
        c.fx = c.ax - c.bx; c.fy = c.ay - c.by;
        if (k >= 1) {
          ripple(c.ax, c.ay, c.ah, c.ring ? .32 : .5); if (!c.ring || c.slot === 0) plopEv(c.ax, c.ay);
          if (c.leave) { free(c); return; }
          c.st = 'under'; c.t = 0; c.d = c.ring ? rr(28, 40) : rr(...T.under);
        }
        break;
      }
      case 'under': if (c.t > c.d) { c.st = c.ring ? 'back' : 'peek'; c.t = 0; c.d = rr(...T.peek); if (!c.ring) ripple(c.ax, c.ay, c.ah, .2); } break;
      case 'peek': {   // two eyes on the surface; back up the bank once nobody is near
        if (c.t > c.d) { if (scare(c.bx, c.by, T.flee * 1.3)) { c.st = 'under'; c.t = 0; c.d = rr(4, 9); ripple(c.ax, c.ay, c.ah, .2); } else { c.st = 'back'; c.t = 0; } }
        break;
      }
      case 'back': {
        if (c.ring && scare(s.x, s.y, s.r + .5)) { c.t = 0; break; }
        const k = Math.min(1, c.t / (T.jump * 1.2));
        c.x = c.ax + (c.bx - c.ax) * k; c.y = c.ay + (c.by - c.ay) * k; c.h = c.ah + (c.bh - c.ah) * k + Math.sin(k * Math.PI) * .22;
        c.fx = c.bx - c.ax; c.fy = c.by - c.ay;
        if (k >= 1) { c.st = 'sit'; c.t = 0; if (c.ring) { c.fx = s.x - c.bx; c.fy = s.y - c.by; } else { c.fx = s.ux; c.fy = s.uy; } }
        break;
      }
    }
  }
  function stepDfly(c, dt) {
    const T = TUNE.dfly, s = c.site;
    c.t += dt; c.flap += dt * 30;
    if (c.leave) { c.h += dt * 1.5; c.x += c.fx * 3 * dt; c.y += c.fy * 3 * dt; if (c.t > 3) free(c); return; }
    const flee = scare(c.x, c.y, T.flee);
    if (c.st === 'perch') { if (flee || c.t > c.d) { c.st = 'hover'; c.t = 0; c.d = .2; c.h += .15; } return; }
    if (c.st === 'hover') {
      c.h = c.th + Math.sin(c.t * 5 + c.ph) * .03;
      if (flee || c.t > c.d) {
        const rd = s.reeds;
        if (!flee && rd.length && R() < .3) { const q = rd[R() * rd.length | 0]; c.tx = q[0] + FX * .06; c.ty = q[1] + FY * .06; c.th = elev(q[0], q[1]) + T.reed; c.perch = true; }
        else {
          const a = flee ? Math.atan2(c.y - TH.y, c.x - TH.x) + rr(-.6, .6) : R() * TAU, d = flee ? rr(2.5, 4) : rr(.8, 3);
          c.tx = c.x + Math.cos(a) * d; c.ty = c.y + Math.sin(a) * d; c.perch = false;
          if (hypot2(c.tx - s.x, c.ty - s.y) > 5) { c.tx = s.x + rr(-1.5, 1.5); c.ty = s.y + rr(-1.5, 1.5); }
          c.th = elev(c.tx, c.ty) + rr(.45, 1.2);
        }
        c.st = 'dart'; c.t = 0;
      }
      return;
    }
    // dart: a straight jerk, fast then braking
    const dx = c.tx - c.x, dy = c.ty - c.y, dh = c.th - c.h, d = hypot2(dx, dy);
    if (d < .05 && Math.abs(dh) < .05) { if (c.perch) { c.st = 'perch'; c.d = rr(2, 8); } else { c.st = 'hover'; c.d = rr(.35, 1.8); } c.t = 0; return; }
    const v = Math.min(T.dart, d * 8 + .5), k = Math.min(1, v * dt / Math.max(d, 1e-3));
    c.x += dx * k; c.y += dy * k; c.h += dh * Math.min(1, dt * 9);
    if (d > .02) { c.fx = dx / d; c.fy = dy / d; }
  }
  function stepSnail(c, dt) {
    const T = TUNE.snail, s = c.site;
    c.t += dt;
    if (c.leave) { c.st = 'in'; if (c.t > 2) free(c); return; }
    if (c.st === 'in') { if (c.t > c.d && !scare(c.x, c.y, T.flee)) { c.st = 'crawl'; c.t = 0; } return; }
    if (scare(c.x, c.y, T.flee)) { c.st = 'in'; c.t = 0; c.d = rr(...T.hide); return; }
    c.w += (R() - .5) * dt * 1.2; c.w = clamp(c.w, -.5, .5); c.a += c.w * dt;
    const d = hypot2(c.x - s.x, c.y - s.y), lim = s.r + (s.path ? 2.5 : 1.1);
    if (d > lim) c.a += wrapA(Math.atan2(s.y - c.y, s.x - c.x) - c.a) * Math.min(1, dt * .5);
    const v = c.sp * (.7 + .3 * Math.sin(c.t * 1.3 + c.ph));
    c.x += Math.cos(c.a) * v * dt; c.y += Math.sin(c.a) * v * dt; c.h = elev(c.x, c.y);
    c.fx = Math.cos(c.a); c.fy = Math.sin(c.a);
    if ((c.tacc += v * dt) > .035) {   // the trail: a point every 3.5 cm
      c.tacc = 0; const i = c.ti * 3; c.tr[i] = c.x - c.fx * .05; c.tr[i + 1] = c.y - c.fy * .05; c.tr[i + 2] = c.h + .006; c.ti = (c.ti + 1) % TRAIL; if (c.tn < TRAIL) c.tn++;
    }
  }
  function stepWood(c, dt) {
    const s = c.site; c.t += dt;
    if (c.leave || s.gone) { free(c); return; }
    const near = scare(s.x, s.y, TUNE.wood.hide);
    if (near) { if (c.st !== 'hide') { c.st = 'hide'; c.t = 0; } return; }
    if (c.st === 'hide') { if (c.t > 3) { c.st = 'pause'; c.t = 0; c.d = rr(1, 3); } return; }
    if (c.st === 'pause') { if (c.t > c.d) { if (R() < .25) { c.h = clamp(c.h + rr(-.12, .25), elev(s.x, s.y) + 1.1, elev(s.x, s.y) + 2.6 * s.scale); c.d = rr(.6, 1.5); c.t = 0; } else { c.st = 'peck'; c.t = 0; c.n = 4 + (R() * 8 | 0); c.flap = 0; } } return; }
    // peck: a burst at ~11 Hz (a chip now and then), then a pause
    const k = c.t * 11 | 0;
    if (k !== c.flap) {
      c.flap = k;
      if (k === 1 && host.events) host.events.push({type: 'critters.drum', x: s.x, y: s.y, h: c.h, n: c.n});
      if (R() < .35) chip(c.x + RX * c.px * .05, c.y + RY * c.px * .05, c.h + .12, c.px);
      if (!seen.wood && nearestPerson(s.x, s.y).me && TH.d < 12) { seen.wood = true; toast('A woodpecker', 'drumming on a dead trunk', '#e0b0a0'); }
      if (k >= c.n) { c.st = 'pause'; c.t = 0; c.d = rr(1.2, 3.5); }
    }
  }

  // ================================================================ THE ATLAS
  const SPR = {};
  let ATL = null;
  {
    const defs = [];
    const pix = (rows, pal) => (q, x0, y0) => {
      for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x]; if (ch === '.' || ch === ' ') continue;
        const col = ch >= '0' && ch <= '3' ? pal.r?.[+ch] : pal[ch]; if (!col) continue;
        q.fillStyle = col; q.fillRect(x0 + x, y0 + y, 1, 1);
      }
    };
    const add = (key, f, d, pal) => { const w = Math.max(...d.r.map(r => r.length)), h = d.r.length; defs.push({key, f, w, h, ax: d.x, ay: d.y, paint: pix(d.r, pal)}); };
    for (const k of ['brimstone', 'orangetip', 'blue', 'peacock', 'white', 'admiral']) for (const f in ART.bfly) add(k, f, ART.bfly[f], PAL[k]);
    for (let px = 0; px < 3; px++) for (let py = 0; py < 2; py++) add('eye', 'o' + px + py, A(EYE_ROWS(px, py, false), 4, 2), PAL.eye);
    add('eye', 'shut', A(EYE_ROWS(0, 0, true), 4, 2), PAL.eye);
    add('eye', 'flat', A(['.........', '.........', '1ss131ss1', '..22322..', '.........'], 4, 2), PAL.eye);
    add('eye', 'closed', A(['....11...', '....1s...', '....12...', '....3....', '.........'], 4, 2), PAL.eye);
    const FR = WILD_ART.frog, frogPal = {frogBrown: PAL.frogBrown, frogGreen: WILD_PAL.ruins.frog, frogBlue: PAL.frogBlue};
    for (const k in frogPal) { for (const f in FR) add(k, f, FR[f], frogPal[k]); add(k, 'eyes', ART.peek.eyes, frogPal[k]); }
    const DF = WILD_ART.dragonfly, dPal = {dfly0: WILD_PAL.ruins.dfly0, dfly1: WILD_PAL.ruins.dfly1, demoiselle: PAL.demoiselle};
    for (const k in dPal) for (const f in DF) add(k, f, DF[f], dPal[k]);
    for (const k of ['snail', 'banded']) for (const f in ART.snail) add(k, f, ART.snail[f], PAL[k]);
    for (const k of ['slugBlack', 'slugOrange']) for (const f in ART.slug) add(k, f, ART.slug[f], PAL[k]);
    for (const f in ART.wood) add('wood', f, ART.wood[f], PAL.wood);
    let x = 1, y = 1, rowH = 0; const W = 128;
    for (const d of defs) { if (x + d.w + 1 > W) { x = 1; y += rowH + 1; rowH = 0; } d.sx = x; d.sy = y; x += d.w + 1; rowH = Math.max(rowH, d.h); }
    ATL = document.createElement('canvas'); ATL.width = W; ATL.height = y + rowH + 1;
    const q = ATL.getContext('2d');
    for (const d of defs) { d.paint(q, d.sx, d.sy); (SPR[d.key] ||= {})[d.f] = {sx: d.sx, sy: d.sy, w: d.w, h: d.h, ax: d.ax, ay: d.ay}; }
  }
  const EYEF = [['o00', 'o01'], ['o10', 'o11'], ['o20', 'o21']];
  const SP0 = {img: null, em: null, sx: 0, sy: 0, sw: 0, sh: 0, px: 0, py: 0, flip: false, x: 0, y: 0, h: 0, type: 3};
  function put(s, x, y, h, face) {
    if (!s) return;
    const fl = face < 0;
    SP0.img = ATL; SP0.sx = s.sx; SP0.sy = s.sy; SP0.sw = s.w; SP0.sh = s.h; SP0.px = fl ? s.w - 1 - s.ax : s.ax; SP0.py = s.ay; SP0.flip = fl; SP0.x = x; SP0.y = y; SP0.h = h;
    host.sprite(SP0);
  }
  const sface = c => { const s = c.fx * RX + c.fy * RY; if (Math.abs(s) > .2 || !c.sf0) c.sf0 = s < 0 ? -1 : 1; return c.sf0; };
  const PO = {size: 1, alpha: 1};

  // ================================================================ the feature
  let wasOn = false;
  function clearAll() { for (const c of CR) if (c.on) free(c); for (const s of SITES) { s.live = 0; s.in = false; s.seen = false; } for (const o of ringFx) o.on = false; for (const o of CH) o.on = false; for (const q of PEOPLE) q.seat = -1; lastKey = ''; }
  Object.assign(F, {
    view(dt) {
      const on = active();
      if (!on) { if (wasOn) clearAll(); wasOn = false; return; }
      wasOn = true;
      const a = host.viewYaw ?? host.yaw ?? 0; RX = Math.cos(a); RY = -Math.sin(a); FX = Math.sin(a); FY = Math.cos(a);
      gather(dt);
      for (let i = 0; i < nP; i++) PEOPLE[i].seat = -1;
      if ((lookT -= dt) <= 0) { lookT = TUNE.look; look(); }
      for (const c of CR) {
        if (!c.on) continue;
        if (c.kind === 'bfly') stepBfly(c, dt); else if (c.kind === 'frog') stepFrog(c, dt); else if (c.kind === 'dfly') stepDfly(c, dt);
        else if (c.kind === 'snail' || c.kind === 'slug') stepSnail(c, dt); else if (c.kind === 'wood') stepWood(c, dt);
        if (c.on && c.kind === 'bfly' && (c.st === 'onyou' || c.st === 'approach') && c.seat >= 0) PEOPLE[c.seat].seat = c.slot;
      }
      for (const o of ringFx) if (o.on && (o.t += dt) >= o.life) o.on = false;
      for (const o of CH) if (o.on) { o.t += dt; o.vh -= 6 * dt; o.x += o.vx * dt; o.y += o.vy * dt; o.h += o.vh * dt; if (o.t > 1.2 || o.h < elev(o.x, o.y)) o.on = false; }
    },
    frame() {
      if (!wasOn) return;
      const z = host.zoom || 1, Tn = performance.now() / 1000, wetK = clamp((E().wet || 0) * 1.6 + .25, .25, 1);
      PO.size = z;
      for (const c of CR) {
        if (!c.on || !G.onScreen(c.x, c.h, c.y, 30)) continue;
        const S = SPR[c.pal]; if (!S) continue;
        const face = sface(c);
        if (c.kind === 'bfly') {
          if (c.st === 'onyou' && host.playerHidden && PEOPLE[c.seat]?.me) continue;   // (photo mode hid him: and what sits on him)
          let f;
          if (c.pal === 'eye') {
            if (c.st === 'sit' || c.st === 'onyou') { const open = c.st === 'onyou' ? ((c.flap | 0) % 4 !== 3) : c.n === 0; f = !open ? 'closed' : c.blink > 0 ? 'shut' : EYEF[c.px][c.py]; }
            else { const i = (c.flap | 0) % 3; f = i === 0 ? EYEF[1][0] : i === 1 ? 'flat' : 'closed'; }
            put(S[f], c.x + FX * .02, c.y + FY * .02, c.h, c.st === 'sit' || c.st === 'onyou' ? 1 : face);
          } else {
            const i = (c.flap | 0) % 4;
            f = c.st === 'sit' || c.st === 'onyou' ? (i < 2 ? 'closed' : i === 2 ? 'mid' : 'open') : i === 0 ? 'open' : i === 1 ? 'mid' : i === 2 ? 'closed' : 'flat';
            put(S[f], c.x, c.y, c.h, face);
          }
          if (c.st !== 'sit' && c.st !== 'onyou') { const g = elev(c.x, c.y); PO.alpha = clamp(.3 - (c.h - g) * .1, .08, .3); G.point(c.x, g + .01, c.y, COL.shade, PO); }
        } else if (c.kind === 'frog') {
          if (c.st === 'under') continue;
          if (c.st === 'peek') { put(S.eyes, c.ax, c.ay, c.ah + .01, face); continue; }
          const pulse = c.ring ? (Tn * .9 % 2.4) < .5 && ((Tn * 8) | 0) & 1 : c.flap > 0 && ((c.flap * 8) | 0) & 1;
          put(S[c.st === 'jump' || c.st === 'back' ? 'jump' : pulse ? 'pulse' : 'sit'], c.x, c.y, c.h, face);
        } else if (c.kind === 'dfly') {
          put(S[c.st === 'perch' ? 'perch' : ((c.flap | 0) & 1) ? 'hov1' : 'hov0'], c.x, c.y, c.h, face);
          if (c.st !== 'perch') { const g = elev(c.x, c.y); PO.alpha = .2; G.point(c.x, g + .01, c.y, COL.shade, PO); }
        } else if (c.kind === 'snail' || c.kind === 'slug') {
          put(S[c.st === 'in' ? 'in' : 'out'], c.x, c.y, c.h, face);
          for (let k = 0; k < c.tn; k++) {   // the trail: faint, a glint running along it
            const j = ((c.ti - 1 - k + TRAIL) % TRAIL) * 3, gl = ((k + (Tn * 6 | 0)) % 9) === 0;
            PO.alpha = (gl ? .55 : .26) * wetK * (1 - k / TRAIL * .6); G.point(c.tr[j], c.tr[j + 2], c.tr[j + 1], gl ? COL.glint : COL.trail, PO);
          }
        } else if (c.kind === 'wood') {
          const s = c.site, side = c.px, hid = c.st === 'hide', r = .13 * s.scale;
          put(S[c.st === 'peck' && (c.flap & 1) ? 'peck' : 'cling'], s.x - RX * side * r + (hid ? -FX * .3 : FX * .12), s.y - RY * side * r + (hid ? -FY * .3 : FY * .12), c.h, side);
          c.x = s.x; c.y = s.y;
        }
      }
      for (const o of ringFx) {
        if (!o.on || !G.onScreen(o.x, o.h, o.y, 30)) continue;
        const u = o.t / o.life, r = o.r * (1 - (1 - u) * (1 - u)) + .04, n = 14;
        PO.alpha = .85 * (1 - u); PO.size = u < .25 ? 2 * z : z;
        for (let k = 0; k < n; k++) { const a = k / n * TAU; G.point(o.x + Math.cos(a) * r, o.h, o.y + Math.sin(a) * r * .9, COL.ring[u < .4 ? 0 : 1], PO); }
      }
      PO.size = z; PO.alpha = 1;
      for (const o of CH) if (o.on) G.point(o.x, o.h, o.y, COL.chip[o.c], PO);
    },
    biomeChanged() { clearAll(); },
    toggle() { F.on = !F.on; if (!F.on) clearAll(); return F.on; },
    menu() {
      if (!active()) return [];
      const go = (kind, flag, dx = 3) => () => {
        let b = null, bd = 1e9; for (const s of SITES) if (s.kind === kind) { const d = hypot2(s.x - P.x, s.y - P.y); if (d < bd) { bd = d; b = s; } }
        if (!b) { toast('Critters', 'none of those in this forest', '#e8a070'); return null; }
        if (flag) force[flag] = true;
        if (kind === 'pond') host.teleport(b.x - b.ux * dx, b.y - b.uy * dx); else host.teleport(b.x + dx, b.y + (kind === 'dead' ? 3 : 0));
        lastKey = ''; lookT = 0; return b;
      };
      return [
        {label: 'Critters: go to the nearest frogs (out whatever the season)', run: go('pond', 'frog', 3.5)},
        {label: 'Critters: go to the nearest butterflies (out whatever the season)', run: () => { const e = E(); if (e.part !== 'day') e.setPart('day'); go('glade', 'bfly', 2)(); }},
        {label: 'Critters: go to the nearest dragonflies (out whatever the season)', run: () => { const e = E(); if (e.part !== 'day') e.setPart('day'); go('reeds', 'dfly', 3)(); }},
        {label: 'Critters: go to the nearest snails and slugs', run: go('stone', 'snail', 2)},
        {label: 'Critters: go to the nearest woodpecker', run: () => { const e = E(); if (e.part === 'night' || e.part === 'dusk') e.setPart('day'); force.wood = true; for (const s of SITES) if (s.kind === 'dead') s.gone = false; go('dead', 'wood', 0)(); }},
        {label: 'Critters: make it after rain (the ground wet, snails out, more frogs)', run: () => { const e = E(); e.settle?.('overcast', 1); e.setWeather?.(''); lastKey = ''; lookT = 0; }},
        {label: 'Critters: the eye in the glade (the rare butterfly, today)', run: () => {
          const e = E(); if (e.part !== 'day') e.setPart('day'); force.eye = true; force.bfly = true;
          let b = 0, bd = 1e9; GLADES.forEach((g, i) => { const d = hypot2(g.x - P.x, g.y - P.y); if (d < bd) { bd = d; b = i; } }); eyeForced = b;
          for (const c of CR) if (c.on && c.site === EYE) free(c); EYE.live = 0;
          const f = GLADES[b].fl[0]; host.teleport(f[0] + 2.2, f[1] + 1); lastKey = ''; lookT = 0;
        }},
        {label: 'Critters: the frogs\' ring by the spring (night)', run: () => { const e = E(); e.setPart('night'); force.ring = true; host.teleport(SP.x + 2.6, SP.y + 2.2); lastKey = ''; lookT = 0; }},
        {label: 'Critters: back to the natural times and seasons', run: () => { for (const k in force) force[k] = MODE === 'eye' && k === 'eye'; eyeForced = -1; lastKey = ''; lookT = 0; }},
      ];
    },
    dbg: () => {
      const n = {}; for (const c of CR) if (c.on) n[c.kind + ':' + c.st] = (n[c.kind + ':' + c.st] || 0) + 1;
      const k = {}; for (const s of SITES) k[s.kind] = (k[s.kind] || 0) + 1;
      return {active: active(), live: nLive, n, sites: k, K: {...K}, eyeGlade: K.eyeGlade >= 0 ? GLADES[K.eyeGlade] && [GLADES[K.eyeGlade].x, GLADES[K.eyeGlade].y] : null, people: nP};
    },
  });
  F._ = {SITES, GLADES, CR, force, ATL, SPR, PEOPLE};
  return F;
}
