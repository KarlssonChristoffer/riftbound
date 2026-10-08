// AFFIXES LOOK: the view of features/affixes.js. Reads the sim (its bearers' states, the hazard kit, the frame's events)
// and writes only its own state: particles, counters of what it has shown, floating text. Random draws are its own
// (core/rng.js viewRandom), never the sim's.
//   every bearer   its affix's mark, readable at the game's pixel scale, over the game's aura ring (in a run the game draws
//                  the ring, light and nameplate in the affix colour; in the sandbox this does)
//     blazing      flame tongues licking round its feet, embers rising off it
//     glacial      ice shards circling it, snow falling round it, rime at its feet
//     overloaded   arcs crackling over its body, a spark circling it; it calls a strike: a leader up into the sky, a flash
//     splitting    a wobbling green ring, bubbles rising off it; Splitlings drip
//     warded       the ward: a curved wall of gold light in front of it (where it points: flank it), dimmer as it weakens,
//                  flaring where a shot hits it; it shatters; it grows back from the middle out
//     vampiric     crimson motes spiralling into it, a heartbeat ring; the BEAM: a dotted line crawling out to you (the
//                  telegraph), then a pulsing beam with blood running back along it; it snaps in a spray
//   deaths         a split's goo, the ward's shards, a vampire's blood, a storm's last sparks (the blasts and novas are zones)
//   you, chilled   frost on you while slowed, and the word over your head
//   HD             nameplates the HUD doesn't draw (the sandbox; a regular brute with an affix), "blocked", heals, and in the
//                  sandbox the hurts you would have taken (practice: the sandbox doesn't count them)
// OWNS: its particles (through the hazard look's pool), the counters, the floats. READS: sim (bearers, stateOf, H), the
//   game's mode, the foes' stakes, host.player.  BUDGET: ~.05-.2 ms a frame with a few bearers (points and lines).
import {createHazardLook} from '../../view/hazards.js';
import {viewRandom} from '../../core/rng.js';
import {rgbOf} from '../../core/color.js';
import {TAU, clamp, hash3} from '../../core/mathx.js';
import {AFFIXES} from '../../content/affixes.js';

const C = c => rgbOf(c);
const hash01 = (a, b) => hash3(a + 97, b, 5);
const PAL = {
  blazing: {fl: [C('#fff6c8'), C('#ffd060'), C('#ff8a30'), C('#d8401c')], ember: [C('#ffe07a'), C('#ffb040'), C('#ff7a2a'), C('#a83a1c')]},
  glacial: {ice: [C('#ffffff'), C('#d8f6ff'), C('#9fe6ff'), C('#4a98cc')], snow: [C('#ffffff'), C('#e8f8ff'), C('#bfe8ff')], rime: C('#cfefff')},
  overloaded: {arc: C('#f4ecff'), arc2: C('#b48cff'), spark: [C('#ffffff'), C('#e0d0ff'), C('#b48cff'), C('#6a4aa8')]},
  splitting: {goo: [C('#e0ffc0'), C('#9af07a'), C('#5ac03a'), C('#2a7a1a')], ring: C('#7ae05a')},
  warded: {hi: C('#fff8dc'), mid: C('#ffc44a'), lo: C('#b07a1a'), shard: [C('#fff8dc'), C('#ffd870'), C('#e0a030'), C('#8a5a14')]},
  vampiric: {beam: C('#ff4a6a'), core: C('#ffd0d8'), dim: C('#8a1a32'), blood: [C('#ffb0bc'), C('#ff3a5a'), C('#b01a3a'), C('#5a0a1a')]},
};
const FONT = '"Segoe UI", system-ui, sans-serif';
const FONTS = new Map(), font = (w, px) => { const k = w * 1000 + px; let f = FONTS.get(k); if (!f) FONTS.set(k, f = `${w} ${px}px ${FONT}`); return f; };   // (a string a size, made once)
// pixel shapes over a bearer's head (rows top to bottom, '.' empty; a letter is a colour of its palette below): what it
// is, readable at a glance by day as by night. Anchored at their bottom centre
const SHAPES = {
  cloud: ['....aaaa.......', '..aabbbbaa.aa..', '.abbbcbbbbabbba', 'abbcbbbbbbbbbba', 'abbbbbbbbcbbbba', '.aabbbbbbbbbaa.', '...aaaaaaaaa...'],
  drop: ['...a...', '...a...', '..aba..', '.abhba.', 'abhbbca', 'abbbbca', 'abbbcca', '.abcca.', '..aaa..'],
  blob: ['.aaa.', 'abbca', 'abbba', 'abbba', '.aaa.'],
  shield: ['aaaaaaa', 'abbbbba', 'abbbbba', 'abbbbba', '.abbba.', '..aba..', '...a...'],
};
const SPAL = {
  cloud: {a: C('#2a2636'), b: C('#504670'), c: C('#8a78c0'), f: C('#e0d0ff')},
  drop: {a: C('#4a0814'), b: C('#d82a48'), c: C('#901430'), h: C('#ffb0c0')},
  dropHi: {a: C('#6a0c1c'), b: C('#ff4a6a'), c: C('#c01e3e'), h: C('#ffe0e6')},   // on the beat
  blob: {a: C('#2a6a1a'), b: C('#7ae05a'), c: C('#e0ffc0')},
  shield: {a: C('#8a5a14'), b: C('#ffd870'), e: C('#3a2a10')},
};
const parse = rows => { const out = [], H = rows.length, W = rows[0].length; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (rows[j][i] !== '.') out.push(i - (W >> 1), j - H + 1, rows[j][i]); return out; };
const SH = Object.fromEntries(Object.entries(SHAPES).map(([k, v]) => [k, parse(v)]));
const HEAD = 1.42;
const CARD_T = 5;   // s a first-sighting card shows   // a brute's head top over its feet (m): the marks float just over it, under the HP bar

export function createAffixLook(host, sim) {
  const R = viewRandom('affixes'), rr = (a, b) => a + R() * (b - a);
  const HL = createHazardLook(host, sim.H, {name: 'affixes'});
  const {part, ring, pt} = HL, P = host.player, H = sim.H;
  const auraRGB = new Map(), aura = c => { let v = auraRGB.get(c); if (!v) { v = rgbOf(c); auraRGB.set(c, v); } return v; };
  let game = null, foes;
  const gameF = () => game ??= host.feature('game');
  // particle options (the hazard look's pool): rising embers, falling snow, bubbles, sparks
  const O_RISE = {grav: -.4, drag: 1.2, sz: 1, emit: true}, O_SNOW = {grav: .5, drag: 2.5, sz: 1, emit: false}, O_BUB = {grav: -.6, drag: 2, sz: 1, emit: false},
    O_SPK = {grav: 8, drag: 2, sz: 1, emit: true}, O_IN = {grav: 0, drag: 0, sz: 1, emit: true}, O_GOO = {grav: 9, drag: 1.5, sz: 2, emit: false};
  // per frame: the view's basis in the world per ART pixel (draw.js's): right on the ground, up
  let z = 1, rx = 0, ry = 0, up = 0;
  function basis() { z = host.zoom; const a = host.yaw; rx = Math.cos(a) / host.PPM; ry = -Math.sin(a) / host.PPM; up = 1 / host.PPMH; }
  // a world anchor snapped onto the point lattice (draw.js snap), so a pixel shape keeps its exact form
  const SN = [0, 0, 0], SS = [0, 0, 0];
  function snap(x, y, h) {
    host.G.toScreenInto(x, h, y, SS); const o = z & 1 ? .5 : 0;
    const dx = (Math.floor(SS[0] + .5 - o) + o - SS[0]) / z, dy = (Math.floor(SS[1] + .5 - o) + o - SS[1]) / z;
    SN[0] = x + dx * rx; SN[1] = y + dx * ry; SN[2] = h - dy * up; return SN;
  }
  // one art pixel at (dx, dy) px from a snapped anchor (dx along view-right, dy down)
  const px1 = (A, dx, dy, c, emit) => pt(A[0] + dx * rx, A[1] + dx * ry, A[2] - dy * up, c, 1, emit);
  function blit(A, S, pal, emit) { for (let k = 0; k < S.length; k += 3) px1(A, S[k], S[k + 1], pal[S[k + 2]], emit); }
  const seen = (x, y, h) => host.G.onScreen(x, h, y, 60);

  // what each bearer has shown so far (the sim's counters: a change is something new to show)
  const shown = new WeakMap();
  function memo(b, s) {
    let m = shown.get(b);
    if (!m) { sighted(s.id); shown.set(b, m = {hitN: s.hitN, breakN: s.breakN, healN: s.healN, castN: s.castN, chillN: s.chillN, snapN: s.snapN, hitT: 0, castT: 0, growT: 0, up: s.whp > 0}); }
    return m;
  }

  // ---------------------------------------------------------------- first sightings: a card the first time an affix shows
  // up in a run (or a sandbox session): its name in its colour and what it does, top left, for a few seconds
  const seenIds = new Set(), CARDS = [];
  let seenRun = undefined;
  function sighted(id) {
    const g = gameF(), key = g?.mode === 'run' ? g.run : g?.mode;
    if (key !== seenRun) { seenRun = key; seenIds.clear(); CARDS.length = 0; }
    if (seenIds.has(id) || AFFIXES[id]?.child) return;
    seenIds.add(id); CARDS.push({id, t: 0}); if (CARDS.length > 3) CARDS.shift();
  }

  // ---------------------------------------------------------------- floating text (HD), pooled
  const FL = [];
  for (let i = 0; i < 24; i++) FL.push({on: false, x: 0, y: 0, h: 0, s: '', col: '', t: 0, big: false});
  function float(x, y, h, s, col, big = false) {
    let f = FL.find(q => !q.on); if (!f) { f = FL[0]; for (const q of FL) if (q.t > f.t) f = q; }
    f.on = true; f.x = x; f.y = y; f.h = h; f.s = s; f.col = col; f.t = 0; f.big = big;
  }

  // ---------------------------------------------------------------- the view step
  function deathFx(b, x, y) {
    const z0 = b.z || 0;
    if (b.affix === 'splitting') {
      for (let i = 0; i < 34; i++) { const a = R() * TAU, s = rr(1, 4); part(x, y, z0 + rr(.3, 1.2), Math.sin(a) * s, Math.cos(a) * s * .8, rr(1, 4), rr(.4, .8), PAL.splitting.goo, O_GOO); }
      HL.shock(x, y, z0 + .03, 1.2, PAL.splitting.goo[0], PAL.splitting.goo[2], .35);
    } else if (b.affix === 'warded') {
      for (let i = 0; i < 20; i++) { const a = R() * TAU, s = rr(1.5, 4); part(x, y, z0 + rr(.4, 1.3), Math.sin(a) * s, Math.cos(a) * s * .8, rr(1, 3), rr(.4, .8), PAL.warded.shard, O_SPK); }
    } else if (b.affix === 'vampiric') {
      for (let i = 0; i < 28; i++) { const a = R() * TAU, s = rr(.8, 3); part(x, y, z0 + rr(.4, 1.3), Math.sin(a) * s, Math.cos(a) * s * .8, rr(1, 3), rr(.4, .9), PAL.vampiric.blood, O_GOO); }
    } else if (b.affix === 'overloaded') {
      for (let i = 0; i < 24; i++) { const a = R() * TAU, s = rr(2, 5); part(x, y, z0 + rr(.4, 1.3), Math.sin(a) * s, Math.cos(a) * s * .8, rr(1, 4), rr(.25, .5), PAL.overloaded.spark, O_SPK); }
      HL.flash(x, y, z0 + 1.2, AFFIXES.overloaded.col, 4, 1.6, .3);
    } else if (b.affix === 'blazing') {
      for (let i = 0; i < 16; i++) part(x + rr(-.3, .3), y + rr(-.2, .2), z0 + rr(.2, 1.2), rr(-.6, .6), rr(-.4, .4), rr(.6, 2), rr(.4, .8), PAL.blazing.ember, O_RISE);
    } else if (b.affix === 'glacial') {
      for (let i = 0; i < 16; i++) part(x + rr(-.3, .3), y + rr(-.2, .2), z0 + rr(.2, 1.4), rr(-.8, .8), rr(-.5, .5), rr(.2, 1), rr(.5, .9), PAL.glacial.ice, O_SNOW);
    }
  }
  function bearerFx(b, s, m, dt) {
    const x = b.x, y = b.y, base = (b.z || 0) + (b.h || 0);
    // what the sim did since the last view
    if (s.hitN !== m.hitN) {   // a shot met the ward
      m.hitN = s.hitN; m.hitT = .22;
      for (let i = 0; i < 7; i++) part(s.hx, s.hy, base + rr(.6, 1.2), rr(-2, 2), rr(-2, 2), rr(0, 2.5), rr(.15, .35), PAL.warded.shard, O_SPK);
      float(x, y, base + 2, 'blocked', AFFIXES.warded.col);
    }
    if (s.breakN !== m.breakN) {   // it broke
      m.breakN = s.breakN; m.up = false;
      for (let i = 0; i < 26; i++) { const a = s.ang + rr(-1.1, 1.1), sp = rr(1.5, 4.5); part(x + Math.sin(a) * .7, y + Math.cos(a) * .7, base + rr(.3, 1.4), Math.sin(a) * sp, Math.cos(a) * sp * .8, rr(.5, 3), rr(.4, .8), PAL.warded.shard, O_SPK); }
      float(x, y, base + 2.2, 'ward broken', '#fff4c8', true);
    }
    if (s.id === 'warded' && !m.up && s.whp > 0) { m.up = true; m.growT = .6; }
    if (s.healN !== m.healN) {
      m.healN = s.healN;
      if (s.healV >= 1) float(x, y, base + 1.9, '+' + Math.round(s.healV), '#ff7a92');
      for (let i = 0; i < 5; i++) { const a = R() * TAU; part(x + Math.sin(a) * .8, y + Math.cos(a) * .6, base + rr(.4, 1.4), -Math.sin(a) * 2, -Math.cos(a) * 1.5, 0, .4, PAL.vampiric.blood, O_IN); }
    }
    if (s.castN !== m.castN) { m.castN = s.castN; m.castT = .3; HL.flash(x, y, base + 1.8, AFFIXES.overloaded.col, 3.5, 1.4, .3); }
    if (s.chillN !== m.chillN) { m.chillN = s.chillN; float(P.x, P.y, P.z + 2.1, 'chilled', AFFIXES.glacial.col); }
    if (s.snapN !== m.snapN) {   // the beam snapped: a spray where it broke
      m.snapN = s.snapN;
      const mx = (x + P.x) / 2, my = (y + P.y) / 2, mh = (base + P.z) / 2 + 1;
      for (let i = 0; i < 10; i++) part(mx, my, mh, rr(-2, 2), rr(-2, 2), rr(0, 2), rr(.2, .45), PAL.vampiric.blood, O_SPK);
    }
    m.hitT = Math.max(0, m.hitT - dt); m.castT = Math.max(0, m.castT - dt); m.growT = Math.max(0, m.growT - dt);
    // the affix's own particles (only near the view)
    if (!seen(x, y, base + 1)) return;
    switch (s.id) {
      case 'blazing': if (R() < dt * 14) part(x + rr(-.3, .3), y + rr(-.2, .2), base + rr(.3, 1.4), rr(-.2, .2), rr(-.2, .2), rr(.6, 1.4), rr(.4, .9), PAL.blazing.ember, O_RISE); break;
      case 'glacial': if (R() < dt * 10) part(x + rr(-.6, .6), y + rr(-.4, .4), base + rr(1.4, 2), rr(-.2, .2), rr(-.2, .2), -rr(.2, .5), rr(.8, 1.4), PAL.glacial.snow, O_SNOW); break;
      case 'overloaded': if (R() < dt * 8) part(x + rr(-.3, .3), y + rr(-.2, .2), base + rr(.4, 1.4), rr(-1.5, 1.5), rr(-1, 1), rr(0, 2), rr(.15, .3), PAL.overloaded.spark, O_SPK); break;
      case 'splitting': case 'splitling':
        if (R() < dt * (s.id === 'splitting' ? 12 : 4)) part(x + rr(-.35, .35), y + rr(-.25, .25), base + rr(.3, 1.3), 0, 0, rr(.2, .6), rr(.4, .8), PAL.splitting.goo, O_BUB);
        if (R() < dt * 2) part(x + rr(-.3, .3), y + rr(-.2, .2), base + rr(.4, .9), 0, 0, 0, rr(.5, .8), PAL.splitting.goo, O_GOO);
        break;
      case 'vampiric': if (R() < dt * 9) { const a = R() * TAU, r = rr(.8, 1.1), h = base + rr(.3, 1.5); part(x + Math.sin(a) * r, y + Math.cos(a) * r, h, -Math.sin(a) * r * 1.8 + Math.cos(a), -Math.cos(a) * r * 1.8 - Math.sin(a), 0, .5, PAL.vampiric.blood, O_IN); } break;
    }
  }

  // ---------------------------------------------------------------- the frame: marks, ward, beams
  function deco(b, s, m, t) {
    const x = b.x, y = b.y, base = (b.z || 0) + (b.h || 0), g = (b.z || 0) + .03, big = b.boss ? 1.35 : b.elite ? 1 : .85;
    switch (s.id) {
      case 'blazing': {
        for (let i = 0; i < 7; i++) {   // tongues round the feet: rise, thin, redden
          const a = i / 7 * TAU + t * .7, ph = (t * 2.3 + i * .37) % 1, r = .42 * big;
          const fx = x + Math.sin(a) * r, fy = y + Math.cos(a) * r, h = g + ph * .5 * big, ci = Math.min(3, Math.floor(ph * 4));
          pt(fx, fy, h, PAL.blazing.fl[ci], ph < .35 ? 2 : 1, true);
          pt(fx, fy, g, PAL.blazing.fl[3], 1, true);
        }
        break;
      }
      case 'glacial': {
        for (let i = 0; i < 3; i++) {   // ice shards circling: a little 1 x 3 crystal each
          const a = t * 1.1 + i * TAU / 3, sx = x + Math.sin(a) * .58 * big, sy = y + Math.cos(a) * .58 * big, h = base + .75 + .22 * Math.sin(t * 2.1 + i * 2);
          pt(sx, sy, h + 2 * up, PAL.glacial.ice[0], 1, true); pt(sx, sy, h + up, PAL.glacial.ice[1], 1, true); pt(sx, sy, h, PAL.glacial.ice[2], 1, true);
          pt(sx + rx, sy + ry, h + up, PAL.glacial.ice[3], 1, false); pt(sx - rx, sy - ry, h + up, PAL.glacial.ice[3], 1, false);
        }
        ring(x, y, g, .48 * big, PAL.glacial.rime, 0, 3, 1, false);
        HL.hatch(x, y, b.z || 0, .55 * big, '#e4f8ff', .4, 0);   // rime on the ground under it
        break;
      }
      case 'overloaded': {
        // an arc or two crackling over its body (a new shape every frame)
        const n = R() < .55 ? 1 + (R() < .3 ? 1 : 0) : 0;
        for (let k = 0; k < n; k++) {
          const a0 = R() * TAU, a1 = a0 + rr(.8, 2.2), h0 = base + rr(.3, 1.5), h1 = base + rr(.3, 1.5), r0 = .38 * big;
          let x0 = x + Math.sin(a0) * r0, y0 = y + Math.cos(a0) * r0, hh0 = h0;
          const x1 = x + Math.sin(a1) * r0, y1 = y + Math.cos(a1) * r0;
          for (let j = 1; j <= 3; j++) {
            const f = j / 3, xn = j === 3 ? x1 : x0 + (x1 - x0) * f + rr(-.12, .12), yn = j === 3 ? y1 : y0 + (y1 - y0) * f + rr(-.12, .12), hn = j === 3 ? h1 : hh0 + (h1 - hh0) * f + rr(-.15, .15);
            host.line(x0, y0, hh0, xn, yn, hn, j & 1 ? PAL.overloaded.arc : PAL.overloaded.arc2, true); x0 = xn; y0 = yn; hh0 = hn;
          }
        }
        const a = t * 3.2, ox = x + Math.sin(a) * .62 * big, oy = y + Math.cos(a) * .62 * big, oh = base + 1.15 + .2 * Math.sin(t * 5);
        pt(ox, oy, oh, PAL.overloaded.arc, 2, true);
        for (let j = 1; j <= 3; j++) { const aj = a - j * .22; pt(x + Math.sin(aj) * .62 * big, y + Math.cos(aj) * .62 * big, oh - j * .02, PAL.overloaded.spark[Math.min(3, j)], 1, true); }
        if (m.castT > 0) {   // it calls the strike: a leader from its head into the sky
          const h0 = base + 1.7 * big;
          for (let j = 0; j < 4; j++) host.line(x + rr(-.1, .1), y + rr(-.1, .1), h0 + j * 1.6, x + rr(-.15, .15), y + rr(-.15, .15), h0 + (j + 1) * 1.6, j & 1 ? PAL.overloaded.arc2 : PAL.overloaded.arc, true);
        }
        break;
      }
      case 'splitting': ring(x, y, g, (.5 + .07 * Math.sin(t * 5.3)) * big, PAL.splitting.ring, t * 2, 3, 2, true); break;
      case 'warded': drawWard(b, s, m, t, x, y, base, big); break;
      case 'vampiric': {
        const beat = (t * 1.1) % 1, k = beat < .1 ? 1 - beat / .1 : beat > .22 && beat < .32 ? 1 - (beat - .22) / .1 : 0;
        if (k > 0) ring(x, y, g, (.45 + .12 * k) * big, PAL.vampiric.beam, 0, 2, 1, true);
        break;
      }
    }
  }
  // the mark over its head: a fire crown, ice spikes, a storm cloud, a blob dividing, a blood drop, a shield refilling
  const SPIKES = [-4, 3, -2, 6, -1, 4, 0, 8, 1, 5, 2, 6, 4, 3];   // (dx, height) pairs
  function headMark(b, s, m, t) {
    const base = (b.z || 0) + (b.h || 0), A = snap(b.x, b.y, base + HEAD), ah = A[2];
    switch (s.id) {
      case 'blazing':
        for (let c = -4; c <= 4; c++) {   // flame columns: rise and flicker, white-hot at the root, red at the tips
          const hgt = Math.round((4 - Math.abs(c) * .7) + hash01(c, Math.floor(t * 12)) * 5);
          for (let j = 0; j < hgt; j++) { const f = j / Math.max(1, hgt - 1); px1(A, c, -j, PAL.blazing.fl[f < .2 ? 0 : f < .5 ? 1 : f < .8 ? 2 : 3], true); }
        }
        break;
      case 'glacial':
        for (let k = 0; k < SPIKES.length; k += 2) {
          const dx = SPIKES[k], hgt = SPIKES[k + 1];
          for (let j = 0; j < hgt; j++) px1(A, dx, -j, j === hgt - 1 ? PAL.glacial.ice[0] : j > hgt * .5 ? PAL.glacial.ice[1] : j > 0 ? PAL.glacial.ice[2] : PAL.glacial.ice[3], true);
        }
        if (Math.floor(t * 3) % 4 === 0) px1(A, Math.floor(t * 3) % 8 > 3 ? 1 : -1, -7, PAL.glacial.ice[0], true);   // a glint
        break;
      case 'overloaded': {
        A[2] = ah + .3 + Math.round(Math.sin(t * 2.3) * 1.5) * up;
        const fl = R() < .12 || m.castT > 0;
        blit(A, SH.cloud, SPAL.cloud, true);   // (emissive: it reads at night too)
        if (fl) for (let k = 0; k < 5; k++) px1(A, Math.floor(rr(-5, 6)), Math.floor(rr(-5, -1)), SPAL.cloud.f, true);
        if (fl) { let dx = Math.floor(rr(-2, 3)); for (let j = 1; j <= 7; j++) { dx += R() < .4 ? (R() < .5 ? -1 : 1) : 0; px1(A, dx, j, PAL.overloaded.arc, true); } }
        A[2] = ah;
        break;
      }
      case 'splitting': case 'splitling': {
        // a blob that pulls apart into two and snaps back: mitosis
        const big = s.id === 'splitting', ph = (t * (big ? .8 : 1.6) + b.x * .13) % 1, sep = Math.round(Math.sin(ph * Math.PI) ** 2 * (big ? 4 : 1));
        const ax = A[0], ay = A[1];
        A[0] = ax - (sep + 1) * rx; A[1] = ay - (sep + 1) * ry; blit(A, SH.blob, SPAL.blob, true);
        A[0] = ax + (sep + 1) * rx; A[1] = ay + (sep + 1) * ry; blit(A, SH.blob, SPAL.blob, true);
        if (sep <= 1) for (let j = -3; j <= -1; j++) px1(A, -(sep + 1), j, SPAL.blob.b, true);   // still joined: the bridge
        A[0] = ax; A[1] = ay;
        break;
      }
      case 'vampiric': {
        const beat = (t * 1.1) % 1;
        A[2] = ah + (beat < .1 || (beat > .22 && beat < .32) ? up : 0);
        blit(A, SH.drop, beat < .32 ? SPAL.dropHi : SPAL.drop, true);
        A[2] = ah;
        break;
      }
      case 'warded': {
        if (s.whp > 0) break;   // broken: a hollow shield filling back up as the ward regrows
        const k = 1 - clamp(s.regrow / s.A.ward.regrow, 0, 1), S = SH.shield, top = -6 + Math.round((1 - k) * 6);
        for (let i = 0; i < S.length; i += 3) { const ch = S[i + 2], lit = ch !== 'a' && S[i + 1] >= top; px1(A, S[i], S[i + 1], ch === 'a' ? SPAL.shield.a : lit ? SPAL.shield.b : SPAL.shield.e, lit); }
        break;
      }
    }
  }
  // the ward: rows of gold light on a curve in front of it, the arc it covers
  function drawWard(b, s, m, t, x, y, base, big) {
    if (s.whp <= 0) return;
    const W = s.A.ward, half = W.half * Math.PI / 180, Rw = .8 * big, k = s.whp / s.wmax;
    const grow = m.growT > 0 ? 1 - m.growT / .6 : 1, span = half * grow;
    const n = Math.max(6, Math.round(2 * span * Rw * host.PPM)), rows = b.boss ? 5 : 4, scan = Math.floor(t * 14);
    for (let j = 0; j < rows; j++) {
      const h = base + .25 + j * (1.3 * big / rows);
      for (let i = 0; i <= n; i++) {
        const u = i / n * 2 - 1, a = s.ang + u * span;
        const edge = Math.abs(u) > .9, lit = (i + j * 3 + scan) % 6 !== 0;
        if (!lit && !edge) continue;
        if (k < .35 && R() > k * 2.4) continue;   // weak: it flickers
        const c = m.hitT > 0 ? PAL.warded.hi : edge || j === 0 || j === rows - 1 ? PAL.warded.mid : (i + j) & 1 ? PAL.warded.mid : PAL.warded.lo;
        pt(x + Math.sin(a) * Rw, y + Math.cos(a) * Rw, h, c, 1, true);
      }
    }
    // the arc it covers, on the ground
    for (let i = 0; i <= n; i++) { if (i % 3) continue; const a = s.ang + (i / n * 2 - 1) * span; pt(x + Math.sin(a) * Rw * 1.15, y + Math.cos(a) * Rw * 1.15, (b.z || 0) + .03, PAL.warded.lo, 1, true); }
  }
  // a vampire's beam: reaching (a dotted line crawling out to you), then latched (pulsing lines, blood running back)
  function drawBeam(b, s, t) {
    if (s.bp === 0) return;
    const V = s.A.beam, x0 = b.x, y0 = b.y, h0 = (b.z || 0) + (b.h || 0) + 1.05, x1 = P.x, y1 = P.y, h1 = P.z + 1.05;
    const len = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2), n = Math.max(4, Math.round(len * host.PPM * .8)), crawl = Math.floor(t * 30);
    if (s.bp === 1) {
      const k = clamp(s.bt / V.reach, 0, 1), m = Math.round(n * k);
      for (let i = 0; i <= m; i++) { if ((i + crawl) % 3 === 0) continue; const f = i / n; pt(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, h0 + (h1 - h0) * f, i > m - 2 ? PAL.vampiric.core : PAL.vampiric.dim, i > m - 2 ? 2 : 1, true); }
      return;
    }
    const pulse = .5 + .5 * Math.sin(t * 18);   // three lines thick, its core pulsing, dim edges
    host.line(x0, y0, h0, x1, y1, h1, pulse > .5 ? PAL.vampiric.core : PAL.vampiric.beam, true);
    host.line(x0, y0, h0 + up, x1, y1, h1 + up, PAL.vampiric.beam, true);
    host.line(x0, y0, h0 - up, x1, y1, h1 - up, PAL.vampiric.beam, true);
    host.line(x0, y0, h0 + 2 * up, x1, y1, h1 + 2 * up, PAL.vampiric.dim, true);
    host.line(x0, y0, h0 - 2 * up, x1, y1, h1 - 2 * up, PAL.vampiric.dim, true);
    for (let i = 0; i < 6; i++) { const a = t * 9 + i * TAU / 6, r = .16; pt(x1 + Math.sin(a) * r, y1 + Math.cos(a) * r, h1 + Math.sin(a * 1.3) * .12, PAL.vampiric.blood[i & 1], 1, true); }   // the drain swirling off you
    for (let i = 0; i < 7; i++) { const f = 1 - ((t * 1.6 + i / 7) % 1); pt(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, h0 + (h1 - h0) * f + up, PAL.vampiric.blood[i & 1], 2, true); }
  }

  // F.lights' records, reused (lights.js's pattern)
  const LREC = [], LLIST = [];
  let nL = 0;
  const lrec = (x, y, h, color, radius, intensity, flicker, id) => {
    const o = LREC[nL] ??= {x: 0, y: 0, h: 0, color: null, radius: 0, intensity: 0, flicker: 0, id: 0};
    o.x = x; o.y = y; o.h = h; o.color = color; o.radius = radius; o.intensity = intensity; o.flicker = flicker; o.id = id;
    LLIST[nL++] = o;
  };
  const SV = [0, 0, 0];
  const text = (q, s, x, y, size, col) => {
    q.font = font(800, Math.round(size)); q.textAlign = 'center'; q.textBaseline = 'alphabetic';
    q.lineJoin = 'round'; q.lineWidth = Math.max(2, size * .22); q.strokeStyle = 'rgba(10,8,12,.9)'; q.strokeText(s, x, y); q.fillStyle = col; q.fillText(s, x, y);
  };

  return {
    view(dt, evs) {
      HL.view(dt, evs);
      const g = gameF(), practice = g?.mode === 'sandbox' && !(foes ??= host.feature('foes') || null)?.stakes;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.type === 'enemy.kill' && e.who?.affix) deathFx(e.who, e.x, e.y);
        else if (e.type === 'player.hurt' && practice && sim.bearers.length) float(P.x, P.y, P.z + 1.9, '-' + e.dmg, '#ff6a50', true);
      }
      for (let i = 0; i < sim.bearers.length; i++) { const b = sim.bearers[i]; if (b.broken || b.gone) continue; const s = sim.stateOf(b); if (s) bearerFx(b, s, memo(b, s), dt); }
      if (H.slowK > 0 && R() < dt * 18 * H.slowK) part(P.x + rr(-.3, .3), P.y + rr(-.2, .2), P.z + rr(.2, 1.6), rr(-.2, .2), rr(-.2, .2), rr(-.3, .2), rr(.5, .9), PAL.glacial.snow, O_SNOW);
      for (const f of FL) if (f.on && (f.t += dt) > 1.1) f.on = false;
      for (let i = CARDS.length - 1; i >= 0; i--) if ((CARDS[i].t += dt) > CARD_T) CARDS.splice(i, 1);
    },
    frame({t}) {
      basis();
      HL.frame(t);
      const sandbox = gameF()?.mode !== 'run';
      for (let i = 0; i < sim.bearers.length; i++) {
        const b = sim.bearers[i]; if (b.broken || b.gone) continue;
        const s = sim.stateOf(b); if (!s) continue;
        if (s.id === 'vampiric') drawBeam(b, s, t);
        if (!seen(b.x, b.y, (b.z || 0) + 1)) continue;
        if (sandbox && b.aura) {   // the game's aura ring (it draws it in a run)
          ring(b.x, b.y, (b.z || 0) + .03, b.boss ? .8 : .55, aura(b.aura), -t * (b.boss ? 1.2 : 2), 4, 3, true);
          if (b.boss) ring(b.x, b.y, (b.z || 0) + .03, 1, aura(b.aura), t * .8, 6, 2, true);
        }
        const m = memo(b, s); deco(b, s, m, t); headMark(b, s, m, t);
      }
      if (H.slowK > 0) ring(P.x, P.y, P.z + .03, .38, PAL.glacial.ice[2], t * 2, 3, 2, true);   // you, chilled
    },
    lights() {
      nL = 0;
      HL.lights(lrec);
      const sandbox = gameF()?.mode !== 'run';
      for (let i = 0; i < sim.bearers.length && nL < 24; i++) {
        const b = sim.bearers[i]; if (b.broken || b.gone) continue;
        const s = sim.stateOf(b); if (!s) continue;
        if (sandbox && b.aura) lrec(b.x, b.y, (b.z || 0) + .6, b.aura, b.boss ? 2.6 : 1.6, b.boss ? 1 : .7, .2, 7700 + i);
        if (s.id === 'vampiric' && s.bp === 2) lrec((b.x + P.x) / 2, (b.y + P.y) / 2, (b.z || 0) + 1.1, AFFIXES.vampiric.col, 2.6, .8, .3, 7740 + i);
        if (s.id === 'blazing') lrec(b.x, b.y, (b.z || 0) + .4, '#ff8a34', 1.8, .55, .5, 7760 + i);
        if (s.id === 'warded' && shown.get(b)?.hitT > 0) lrec(s.hx, s.hy, (b.z || 0) + 1, AFFIXES.warded.col, 2.2, 1.2, 0, 7780 + i);
      }
      LLIST.length = nL; return LLIST;
    },
    hd(q, sc) {
      const g = gameF(), run = g?.mode === 'run', G = host.G; let u = clamp(sc / 2.6, .7, 2.8);   // (the plates scale with the world; the cards: below)
      q.save();
      q.save(); G.hdShift?.(q, sc);   // (over the world: slid with the pixel image, the sub-pixel camera; the cards below stay put)
      for (let i = 0; i < sim.bearers.length; i++) {   // the nameplates the HUD doesn't draw
        const b = sim.bearers[i]; if (b.broken || b.gone || b.affix === 'splitling' || (run && (b.elite || b.boss))) continue;
        const h = (b.z || 0) + (b.h || 0) + (b.hitH ?? 1.6) + .45;
        if (!G.onScreen(b.x, h, b.y, 20)) continue;
        G.toScreenInto(b.x, h, b.y, SV);
        text(q, b.name, SV[0] * sc, SV[1] * sc, (b.elite || b.boss ? 11 : 9.5) * u, b.aura || '#f4efe4');
      }
      for (const f of FL) {
        if (!f.on) continue;
        G.toScreenInto(f.x, f.h, f.y, SV);
        const k = f.t / 1.1, rise = (1 - (1 - k) ** 2) * 24 * u;
        q.globalAlpha = k > .7 ? 1 - (k - .7) / .3 : 1;
        text(q, f.s, SV[0] * sc, SV[1] * sc - rise, (f.big ? 15 : 12) * u, f.col);
        q.globalAlpha = 1;
      }
      q.restore(); u = clamp(host.hudScale / 2.6, .7, 2.8);
      // the first-sighting cards (top left, under the run's banner line)
      for (let i = 0; i < CARDS.length; i++) {
        const c = CARDS[i], A = AFFIXES[c.id], a = clamp(Math.min(c.t / .3, (CARD_T - c.t) / .6), 0, 1), x = 22 * u, y = (110 + i * 46) * u;
        q.font = font(500, Math.round(10.5 * u)); const w = q.measureText(A.desc).width + 22 * u;
        q.globalAlpha = a; q.fillStyle = 'rgba(12,10,16,.72)'; q.fillRect(x - 10 * u, y - 18 * u, w, 40 * u);
        q.fillStyle = A.col; q.fillRect(x - 10 * u, y - 18 * u, 3 * u, 40 * u);
        q.textAlign = 'left'; q.font = font(800, Math.round(14 * u)); q.fillStyle = A.col; q.fillText(A.name, x, y - 1 * u);
        q.font = font(500, Math.round(10.5 * u)); q.fillStyle = '#e8e2d2'; q.fillText(A.desc, x, y + 14 * u);
        q.globalAlpha = 1;
      }
      q.restore();
    },
    clear() { HL.clear(); for (const f of FL) f.on = false; },
  };
}
