// GLOWLIFE: the forest glows at night (docs/WORLDLIFE.md "The forest glows at night"). The night woods were nearly black and
// empty; now they have light-life of their own:
//   FIREFLIES  drifts over the glades, the lake's shore and the streams' banks, from dusk through the night: many in late spring
//              and summer, a few in early autumn, none in winter, snow or heavy rain. Each blinks on its own rhythm, and now and then
//              a whole drift falls into step and the flashes roll through it in a wave. A running player scatters them; one who
//              stands still a few seconds slowly gathers a little cloud of them circling him (he becomes a lantern), which
//              scatters when he moves. Co-op friends count too. The 2-3 brightest drifts near you (and the lantern) light the
//              ground softly; the rest are emissive points only.
//   FOXFIRE    glowing fungus (green-blue shelves and tiny caps) on the dead trees, the woods' own stumps, the fallen logs and
//              windthrows, and at the foot of the oldest trees in the thickest wood. It glows at night (faintly at dusk), brighter
//              after rain (env.wet), dims as someone comes close (it is shy) and slowly glows back after they leave. Seen by day
//              too, as pale fungus. A felled tree's fungus goes with it.
//   NIGHT BLOOM moonflowers in a few open glades: buds by day, opening at dusk, glowing faintly through the night, closing at
//              dawn (late spring to early autumn). Walking through a patch knocks glowing pollen up that drifts and fades.
//   ÄLVDANS    the elf ring: one glade in the home woods has a ring of foxfire caps that breathes, a slow wave of light going round
//              it. Stand inside it at night and pale motes rise from the caps and dance round you in the ring's rhythm.
// MULTIPLAYER: view only. Every place is the world seed's (world/glowplan.js: a pure function of the forest plan), the times and
// seasons the shared clock's (host.env), so friends see the same drifts, fungus, flowers and ring; each client animates its own
// fireflies and reacts to every player it knows (itself + the co-op peers it draws). Nothing is sent, nothing is saved.
// Only in the persistent world (the sandbox's ruins biome with the forest). ?glow=0 off, ?glow=always: night glow all day (and a
// firefly season all year) for testing. Dev menu (F10) > Nature > Glowlife: on / off, all day, a summer night here, go to the
// nearest fireflies / foxfire / moonflowers / elf ring.
// OWNS: its plan, its fireflies / motes / pollen pools, the foxfire's shyness, three light records. READS: world/layout.js FOREST,
//   host.env (hour, year, sky, wet, snowCover), host.player, coop (net.peers, sample), game (mode, ui.toast), host.entities (near:
//   is a snag still standing). EMITS: nothing.
// BUDGET: view ~.05 ms a step (only what is within ~40 m of you: up to 300 fireflies, ~60 foxfire spots, a few patches); draws:
//   points and sprites from two small atlases; no per-frame allocation (pools, reused records).
import {flags} from '../core/flags.js';
import {FOREST} from '../world/layout.js';
import {glowPlan} from '../world/glowplan.js';
import {clamp, lerp, smooth, TAU} from '../core/mathx.js';
import {rgbOf} from '../core/color.js';

const MODE = flags.get('glow'), ON = MODE !== '0';

// ORDER: after co-op (its peers this step)
export const order = {after: ['coop']};

export const TUNE = {
  near: 40,                      // m from you: only what is this close is alive (spawned, drawn)
  fly: {most: 300, speed: .38, hi: [.5, 2.4], scare: 3.6, run: 2.4, still: 2.6, lantern: [3, 13], gather: 14, orbit: [.65, 1.6]},
  // the year's firefly count (env.year 0..4: spring .. winter): late spring up, summer full, early autumn a few
  flyYear: [[0, 0], [.3, 0], [.85, 1], [1.9, 1], [2.1, .3], [2.55, .18], [2.75, 0], [4, 0]],
  bloomYear: [.35, 2.7],         // the moonflowers grow from late spring to early autumn
  fox: {shy: 3.4, dim: .12, out: 1.1, back: 7},
  lights: 3,
};
const TOAST = {fly: ['Fireflies', 'stand still a while, and they come to you'], fox: ['Foxfire', 'shy fungus: it dims as you come near. Brighter after rain'],
  bloom: ['Moonflowers', 'they open at dusk. Walk through them'], ring: ['Älvdans', 'a ring of foxfire, breathing. Stand in it']};

// ---------------------------------------------------------------- the art: foxfire (4 variants x 6 glow levels) and moonflowers
const FW = 12, FH = 12, FLV = 6, BW = 9, BH = 12, BLV = 4;
function paintFox() {
  const img = document.createElement('canvas'), em = document.createElement('canvas');
  img.width = em.width = FW * 4; img.height = em.height = FH * FLV;
  const a = img.getContext('2d'), e = em.getContext('2d');
  const cap = '#b6c4a4', capHi = '#d6e0c4', under = '#6c7a60', stalk = '#dcdfcc';
  const GC = [94, 255, 196], GU = [150, 255, 226], GS = [70, 210, 170];   // glow: cap, gills, stalk
  for (let lv = 0; lv < FLV; lv++) {
    const k = lv / (FLV - 1), oy = lv * FH;
    const px = (ctx, c, x, y, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y + oy, w, h); };
    const gl = (g, m = 1) => `rgb(${g[0] * k * m | 0},${g[1] * k * m | 0},${g[2] * k * m | 0})`;
    const shelf = (ox, x, y, w) => {   // a bracket: a flat half-disc, a pale rim on top, gills below
      px(a, cap, ox + x + 1, y, w - 2); px(a, capHi, ox + x + 2, y, w - 4); px(a, cap, ox + x, y + 1, w); px(a, under, ox + x + 1, y + 2, w - 2);
      px(e, gl(GC, .55), ox + x + 1, y, w - 2); px(e, gl(GC, .8), ox + x, y + 1, w); px(e, gl(GU), ox + x + 1, y + 2, w - 2);
    };
    const bell = (ox, x, y, s) => {   // a tiny bell cap on a stalk s px tall (mycena)
      px(a, stalk, ox + x + 1, y + 2, 1, s); px(e, gl(GS, .7), ox + x + 1, y + 2, 1, s);
      px(a, cap, ox + x, y + 1, 3); px(a, capHi, ox + x + 1, y); px(e, gl(GC), ox + x, y + 1, 3); px(e, gl(GU), ox + x + 1, y);
    };
    // v0: two shelves
    shelf(0, 3, 4, 7); shelf(0, 2, 7, 6);
    // v1: three shelves
    shelf(FW, 1, 2, 9); shelf(FW, 2, 5, 8); shelf(FW, 3, 8, 6);
    // v2: a cluster of bells
    bell(FW * 2, 1, 5, 5); bell(FW * 2, 4, 3, 7); bell(FW * 2, 7, 6, 4); bell(FW * 2, 9, 8, 2);
    // v3: one bigger cap and a little one
    { const ox = FW * 3; px(a, stalk, ox + 5, 6, 1, 5); px(e, gl(GS, .7), ox + 5, 6, 1, 5); px(a, cap, ox + 3, 4, 5, 2); px(a, capHi, ox + 4, 3, 3); px(a, under, ox + 3, 6, 5);
      px(e, gl(GC), ox + 3, 4, 5, 2); px(e, gl(GC, .8), ox + 4, 3, 3); px(e, gl(GU), ox + 3, 6, 5); bell(ox, 7, 7, 3); }
  }
  return {img, em};
}
function paintBloom() {   // columns: 3 variants x 3 frames (bud, opening, open); rows: glow levels
  const img = document.createElement('canvas'), em = document.createElement('canvas');
  img.width = em.width = BW * 9; img.height = em.height = BH * BLV;
  const a = img.getContext('2d'), e = em.getContext('2d');
  const stem = '#4e6a3a', leaf = '#5f7f44', bud = '#cfdcc0', TINT = [['#eef2ff', '#d4def4'], ['#f6f0ff', '#dcd2f0'], ['#eefaf6', '#cce6dc']];
  const GP = [[150, 190, 255], [190, 170, 255], [150, 235, 220]], GE = [255, 236, 170];
  for (let lv = 0; lv < BLV; lv++) for (let v = 0; v < 3; v++) for (let f = 0; f < 3; f++) {
    const k = lv / (BLV - 1), ox = (v * 3 + f) * BW, oy = lv * BH, cx = ox + 4;
    const px = (ctx, c, x, y, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y + oy, w, h); };
    const gl = (g, m = 1) => `rgb(${g[0] * k * m | 0},${g[1] * k * m | 0},${g[2] * k * m | 0})`;
    const [p0, p1] = TINT[v], top = 4 - (v === 1 ? 1 : 0);
    px(a, stem, cx, top + 2, 1, BH - top - 2); px(a, leaf, cx - 2, BH - 4, 2); px(a, leaf, cx + 1, BH - 5, 2); px(a, leaf, cx - 1, BH - 3);
    if (f === 0) { px(a, bud, cx, top, 1, 2); px(a, '#9fb88a', cx, top + 2); px(e, gl(GP[v], .25), cx, top); }
    else if (f === 1) { px(a, p1, cx - 1, top, 3); px(a, p0, cx - 1, top + 1, 3); px(a, bud, cx, top + 2); px(e, gl(GP[v], .5), cx - 1, top, 3, 2); }
    else {
      px(a, p0, cx - 2, top, 5); px(a, p1, cx - 1, top - 1, 3); px(a, p1, cx - 1, top + 1, 3); px(a, '#f2e4a0', cx, top);
      px(e, gl(GP[v]), cx - 2, top, 5); px(e, gl(GP[v], .7), cx - 1, top - 1, 3); px(e, gl(GP[v], .7), cx - 1, top + 1, 3); px(e, gl(GE), cx, top);
    }
  }
  return {img, em};
}

const curve = (T, y) => { for (let i = 1; i < T.length; i++) if (y <= T[i][0]) { const [x0, a] = T[i - 1], [x1, b] = T[i]; return lerp(a, b, clamp((y - x0) / ((x1 - x0) || 1), 0, 1)); } return 0; };
// how far into the night: up over [on0, on1] h in the evening, down over [off0, off1] h in the morning
const nightOf = (h, on0, on1, off0, off1) => h >= 12 ? smooth((h - on0) / (on1 - on0)) : 1 - smooth((h - off0) / (off1 - off0));
const flash = (p, w) => p < w ? Math.sin(Math.PI * p / w) : 0;
const frac = x => x - Math.floor(x);

export async function create(host) {
  const F = {name: 'glowlife', label: 'The forest glows at night', on: ON, ambient: true, always: MODE === 'always', dev: {group: 'Nature'}};
  const PL = FOREST ? glowPlan(FOREST) : null;
  if (!PL) return Object.assign(F, {on: false, dbg: () => ({off: 'no forest'})});
  const game = () => host.feature('game'), coop = () => host.feature('coop'), ui = () => game()?.ui || null;
  const active = () => F.on && host.biome?.id === 'ruins' && game()?.mode === 'sandbox' && !!host.layout?.forest;
  const online = () => !!coop()?.online;
  const P = host.player, NEAR = TUNE.near, FT = TUNE.fly;
  const R = Math.random;
  let FOXA = null, BLOA = null;

  // ---------------------------------------------------------------- the amounts: night, season, weather
  const K = {fly: 0, fox: 0, bloom: 0, open: 0, foxNight: 0};
  function amounts() {
    const E = host.env; if (!E) return;
    const h = E.hour, y = E.year ?? 1.5, sky = E.sky || {}, all = F.always;
    const rain = all ? 0 : sky.rain || 0, snow = all ? 0 : Math.max(sky.snow || 0, E.snowCover || 0);
    const wetOff = (1 - smooth((rain - .2) / .35)) * (1 - smooth((snow - .1) / .3));
    K.fly = (all ? 1 : nightOf(h, 19.9, 21.2, 4.2, 5.3)) * (all ? Math.max(.8, curve(TUNE.flyYear, y)) : curve(TUNE.flyYear, y)) * wetOff;
    K.foxNight = all ? 1 : nightOf(h, 19.2, 20.9, 5, 6.4);
    const winter = y > 3 || y < .1 ? .35 : 1;
    K.fox = K.foxNight * (.62 + .38 * clamp(E.wet || 0, 0, 1)) * winter * (1 - .85 * smooth(((E.snowCover || 0) - .2) / .4));
    const inSeason = all || (y > TUNE.bloomYear[0] && y < TUNE.bloomYear[1] && (E.snowCover || 0) < .2);
    K.bloom = inSeason ? 1 : 0;
    K.open = inSeason ? (all ? 1 : nightOf(h, 18.9, 20.6, 5.2, 6.6)) : 0;
  }

  // ---------------------------------------------------------------- the players it knows: you + the co-op peers it draws
  const WALK = [];   // {id, x, y, z, sp, still, seen, px, py}
  const WBY = new Map(), SMP = {x: 0, y: 0, z: 0, phi: 0};
  let nW = 0;
  function walker(id) { let w = WBY.get(id); if (!w) { w = {id, x: 0, y: 0, z: 0, sp: 0, still: 0, seen: -1, px: NaN, py: NaN, orb: 0}; WBY.set(id, w); } return w; }
  let stamp = 0;
  function walkers(dt) {
    stamp++; nW = 0;
    const me = walker('me'); me.x = P.x; me.y = P.y; me.z = P.z || 0; me.sp = Math.hypot(P.vx || 0, P.vy || 0); me.seen = stamp; WALK[nW++] = me;
    const C = online() ? coop().net : null;
    if (C?.peers) for (const q of C.peers.values()) {
      if (!q.n || !C.sample(q, SMP) || nW >= 9) continue;
      const w = walker(q.id ?? q); if (w.seen !== stamp - 1 || !(w.px === w.px)) { w.px = SMP.x; w.py = SMP.y; }
      w.x = SMP.x; w.y = SMP.y; w.z = SMP.z || 0; w.sp = dt > 0 ? Math.hypot(w.x - w.px, w.y - w.py) / dt : 0; w.px = w.x; w.py = w.y; w.seen = stamp; WALK[nW++] = w;
    }
    for (let i = 0; i < nW; i++) { const w = WALK[i]; w.still = w.sp < .25 ? w.still + dt : 0; }
    if (WBY.size > 12) for (const [k, w] of WBY) if (w.seen !== stamp) WBY.delete(k);
  }

  // ---------------------------------------------------------------- what is near (refreshed twice a second)
  const NS = [], NF = [], NB = [];   // the plan's swarms / foxfire spots / bloom patches within reach
  let ringNear = false, nearT = 0;
  const shy = new Float32Array(PL.fox.length).fill(1), standing = new Uint8Array(PL.fox.length).fill(1);
  const inNS = new Uint8Array(PL.swarms.length);
  const SW = PL.swarms.map(() => ({have: 0, want: 0, sum: 0, cx: 0, cy: 0, cn: 0, g: NaN}));
  const OUT = [];
  function stands(i) {   // a snag / an old tree with fungus: still standing (woodcut fells them)
    const s = PL.fox[i]; if (!s.fid) return true;
    host.entities.near(s.x, s.y, .6, OUT);
    for (const p of OUT) if (p.fid === s.fid) return !p.gone;
    return false;
  }
  let felledDirty = true;
  function refresh() {
    NS.length = NF.length = NB.length = 0; inNS.fill(0);
    const x = P.x, y = P.y;
    for (let i = 0; i < PL.swarms.length; i++) { const s = PL.swarms[i]; if (Math.abs(s.x - x) < NEAR + s.r && Math.abs(s.y - y) < NEAR + s.r) { NS.push(i); inNS[i] = 1; } }
    for (let i = 0; i < PL.fox.length; i++) {
      const s = PL.fox[i]; if (Math.abs(s.x - x) > NEAR || Math.abs(s.y - y) > NEAR) continue;
      if (felledDirty || !standing[i]) standing[i] = stands(i) ? 1 : 0;
      if (standing[i]) NF.push(i);
    }
    felledDirty = false;
    for (let i = 0; i < PL.blooms.length; i++) { const b = PL.blooms[i]; if (Math.abs(b.x - x) < NEAR + b.r && Math.abs(b.y - y) < NEAR + b.r) NB.push(i); }
    ringNear = !!PL.ring && Math.hypot(PL.ring.x - x, PL.ring.y - y) < NEAR;
  }

  // ---------------------------------------------------------------- fireflies: a pool
  const MOST = FT.most;
  const fx = new Float32Array(MOST), fy = new Float32Array(MOST), fh = new Float32Array(MOST), fvx = new Float32Array(MOST), fvy = new Float32Array(MOST);
  const fang = new Float32Array(MOST), ffr = new Float32Array(MOST), fph = new Float32Array(MOST), fhb = new Float32Array(MOST), fg = new Float32Array(MOST);
  const fa = new Float32Array(MOST), fb = new Float32Array(MOST), fob = new Float32Array(MOST), forr = new Float32Array(MOST), fos = new Float32Array(MOST), foh = new Float32Array(MOST);
  const fsw = new Int16Array(MOST), fmode = new Int8Array(MOST), fout = new Int8Array(MOST);   // swarm (-1 a stray), 0 free 1 drifting 2 lantern; fading out
  const fwho = [];   // lantern: which walker it circles
  const free = []; for (let i = MOST - 1; i >= 0; i--) free.push(i);
  const live = [];
  function spawn(sw, x, y) {
    if (!free.length) return -1;
    const i = free.pop(); live.push(i);
    fx[i] = x; fy[i] = y; fhb[i] = rr(FT.hi[0], FT.hi[1]); fg[i] = groundAt(x, y, sw); fh[i] = fg[i] + fhb[i];
    fvx[i] = fvy[i] = 0; fang[i] = R() * TAU; ffr[i] = .35 + R() * .45; fph[i] = R(); fa[i] = 0; fb[i] = 0; fsw[i] = sw; fmode[i] = 1; fout[i] = 0; fwho[i] = null;
    return i;
  }
  const rr = (a, b) => a + R() * (b - a);
  function groundAt(x, y, sw) { const g = host.elev(x, y); if (sw < 0) return g; const s = PL.swarms[sw], c = SW[sw]; if (!(c.g === c.g)) c.g = host.elev(s.x, s.y); return Math.max(g, c.g - .4); }
  function kill(k) { const i = live[k]; if (fmode[i] === 2 && fwho[i]) fwho[i].orb = Math.max(0, fwho[i].orb - 1); live[k] = live[live.length - 1]; live.pop(); fmode[i] = 0; fwho[i] = null; free.push(i); }

  let T = 0, spawnAcc = 0, toastSaid = {};
  function stepFlies(dt) {
    const amt = K.fly;
    // how many each near drift should have, and spawning (gradually: they rise out of the grass)
    for (const c of SW) c.want = 0;
    for (const si of NS) { const s = PL.swarms[si]; SW[si].want = Math.round(s.n * amt); }
    spawnAcc += dt;
    if (spawnAcc > .08) {
      spawnAcc = 0;
      for (const si of NS) {
        const c = SW[si], s = PL.swarms[si]; if (c.have >= c.want) continue;
        const a = R() * TAU, q = Math.sqrt(R()) * s.r, i = spawn(si, s.x + Math.cos(a) * q, s.y + Math.sin(a) * q * .8); if (i >= 0) c.have++;
      }
    }
    // the lantern: someone standing still gathers a cloud (from the drifts near, else strays out of the dark)
    for (let w = 0; w < nW; w++) {
      const W = WALK[w];
      if (W.still < FT.still || amt < .05) { W.orb = 0; continue; }
      const want = Math.round(FT.lantern[0] + (FT.lantern[1] - FT.lantern[0]) * amt);
      if (W.orb < want && R() < dt * 2.2) {
        let got = -1, bd = FT.gather;
        for (let k = 0; k < live.length; k++) { const i = live[k]; if (fmode[i] !== 1 || fout[i]) continue; const d = Math.hypot(fx[i] - W.x, fy[i] - W.y); if (d < bd) { bd = d; got = i; } }
        if (got < 0 && R() < .5) { const a = R() * TAU; got = spawn(-1, W.x + Math.cos(a) * 9, W.y + Math.sin(a) * 7); }
        if (got >= 0) { fmode[got] = 2; fwho[got] = W; forr[got] = rr(FT.orbit[0], FT.orbit[1]); fob[got] = R() * TAU; fos[got] = (R() < .5 ? -1 : 1) * rr(.3, .75); foh[got] = rr(.7, 2.1); W.orb++; }
      }
    }
    // the flies
    for (let k = live.length - 1; k >= 0; k--) {
      const i = live[k], sw = fsw[i];
      // fade in / out
      if (fout[i] || (sw >= 0 && SW[sw].have > SW[sw].want && fmode[i] === 1 && R() < dt * .5)) {
        if (!fout[i]) { fout[i] = 1; if (sw >= 0) SW[sw].have--; }
        fa[i] -= dt * .5; if (fa[i] <= 0) { kill(k); continue; }
      } else fa[i] = Math.min(1, fa[i] + dt * .4);
      if (sw >= 0 && !inNS[sw] && !fout[i]) { fout[i] = 1; SW[sw].have--; }
      if (fmode[i] === 2) {
        const W = fwho[i];
        if (!W || W.seen !== stamp || W.still < FT.still) {   // he moved: they scatter
          if (W) W.orb = Math.max(0, W.orb - 1);
          fmode[i] = 1; fwho[i] = null; const a = R() * TAU; fvx[i] += Math.cos(a) * 1.4; fvy[i] += Math.sin(a) * 1.4;
          if (sw < 0) fout[i] = 1;
        } else {
          fob[i] += fos[i] * dt;
          const tx = W.x + Math.cos(fob[i]) * forr[i], ty = W.y + Math.sin(fob[i]) * forr[i] * .85, th = W.z + foh[i] + Math.sin(T * .8 + fph[i] * TAU) * .18, e = 1 - Math.exp(-dt * .7);
          fx[i] += (tx - fx[i]) * e; fy[i] += (ty - fy[i]) * e; fh[i] += (th - fh[i]) * e;
          continue;
        }
      }
      // drifting: a lazy wander, kept to the drift, pushed away by anyone running through
      fang[i] += (R() - .5) * 2.6 * dt;
      let ax = Math.cos(fang[i]) * FT.speed, ay = Math.sin(fang[i]) * FT.speed * .8;
      if (sw >= 0) {
        const s = PL.swarms[sw], dx = s.x - fx[i], dy = s.y - fy[i], d = Math.hypot(dx, dy);
        if (d > s.r) { const p = Math.min(1, (d - s.r) * .25) * .6; ax += dx / d * p; ay += dy / d * p; }
      }
      for (let w = 0; w < nW; w++) {
        const W = WALK[w]; if (W.sp < FT.run) continue;
        const dx = fx[i] - W.x, dy = fy[i] - W.y, d = Math.hypot(dx, dy);
        if (d < FT.scare && d > .01) { const p = (1 - d / FT.scare) * 9 * dt; fvx[i] += dx / d * p; fvy[i] += dy / d * p; fhb[i] = Math.min(3, fhb[i] + dt * .8); }
      }
      const dmp = Math.exp(-dt * 1.4); fvx[i] *= dmp; fvy[i] *= dmp; fhb[i] += (rr(FT.hi[0], FT.hi[1]) - fhb[i]) * dt * .02;
      fx[i] += (ax + fvx[i]) * dt; fy[i] += (ay + fvy[i]) * dt;
      if ((k + (T * 60 | 0)) % 12 === 0) fg[i] = groundAt(fx[i], fy[i], sw);
      const want = fg[i] + fhb[i] + Math.sin(T * .7 + fph[i] * TAU) * .35;
      fh[i] += (want - fh[i]) * Math.min(1, dt * .9);
    }
  }
  // a fly's light now (0..1): its own rhythm, its drift's wave when the drift is in step, the lantern's slow common pulse
  function bright(i) {
    const sw = fsw[i];
    if (fmode[i] === 2) return (.4 + .6 * flash(frac(T * .42), .45)) * fa[i];
    const own = flash(frac(T * ffr[i] + fph[i]), .24);
    if (sw < 0) return (.15 + .85 * own) * fa[i];
    const s = PL.swarms[sw], sync = smooth((Math.sin(T * TAU / s.per + s.ph) - .45) / .4);
    let b = own;
    if (sync > 0) { const u = (fx[i] - s.x) * Math.cos(s.dir) + (fy[i] - s.y) * Math.sin(s.dir), wave = flash(frac(T * .5 - u / 7), .2); b = lerp(own, wave, sync); }
    return (.15 + .85 * b) * fa[i];
  }

  // ---------------------------------------------------------------- foxfire spores, pollen, the ring's dancers: one pool of motes
  const MM = 240, mx = new Float32Array(MM), my = new Float32Array(MM), mh = new Float32Array(MM), mvx = new Float32Array(MM), mvy = new Float32Array(MM), mvh = new Float32Array(MM);
  const mt = new Float32Array(MM), ml = new Float32Array(MM), mk = new Int8Array(MM), mo = new Float32Array(MM);   // kind: 0 none, 1 spore, 2 pollen, 3 dancer
  let mN = 0;
  function mote(kind, x, y, h, vx, vy, vh, life) {
    let i = -1; for (let j = 0; j < MM; j++) { const q = (mN + j) % MM; if (!mk[q]) { i = q; break; } }
    if (i < 0) return -1; mN = (i + 1) % MM;
    mk[i] = kind; mx[i] = x; my[i] = y; mh[i] = h; mvx[i] = vx; mvy[i] = vy; mvh[i] = vh; mt[i] = 0; ml[i] = life; mo[i] = 0; return i;
  }
  let dancers = 0;
  function stepMotes(dt) {
    for (let i = 0; i < MM; i++) {
      if (!mk[i]) continue;
      mt[i] += dt; if (mt[i] >= ml[i]) { if (mk[i] === 3) dancers--; mk[i] = 0; continue; }
      if (mk[i] === 3) {   // circling the ring
        const G = PL.ring; mo[i] += dt * .32;
        const a = mvx[i] + mo[i], r = G.r * (.55 + .2 * Math.sin(mo[i] * 1.7 + mvy[i]));
        mx[i] += (G.x + Math.cos(a) * r - mx[i]) * Math.min(1, dt * 1.2); my[i] += (G.y + Math.sin(a) * r * .85 - my[i]) * Math.min(1, dt * 1.2);
        mh[i] += (ringH + .4 + mvh[i] + Math.sin(mo[i] * 2.3 + mvy[i]) * .25 - mh[i]) * Math.min(1, dt * .8);
        continue;
      }
      const d = Math.exp(-dt * (mk[i] === 2 ? 1.2 : .6));
      mvx[i] = mvx[i] * d + (R() - .5) * dt * .5; mvy[i] = mvy[i] * d + (R() - .5) * dt * .5;
      mx[i] += mvx[i] * dt; my[i] += mvy[i] * dt; mh[i] += mvh[i] * dt; mvh[i] *= Math.exp(-dt * .25);
    }
  }
  let ringH = 0;

  // ---------------------------------------------------------------- foxfire: shy, and its spores; the moonflowers' pollen
  const bloomCool = PL.blooms.map(b => new Float32Array(b.flowers.length));
  // the ground under each spot / flower (static: found once, the first time it's drawn; a new world build forgets them)
  const foxG = new Float32Array(PL.fox.length).fill(NaN), bloomG = PL.blooms.map(b => new Float32Array(b.flowers.length).fill(NaN));
  F.biomeChanged = () => { foxG.fill(NaN); for (const a of bloomG) a.fill(NaN); for (const c of SW) c.g = NaN; };
  function stepFox(dt) {
    const X = TUNE.fox;
    for (const i of NF) {
      const s = PL.fox[i]; let close = false;
      for (let w = 0; w < nW; w++) if (Math.abs(WALK[w].x - s.x) < X.shy && Math.abs(WALK[w].y - s.y) < X.shy && Math.hypot(WALK[w].x - s.x, WALK[w].y - s.y) < X.shy) { close = true; break; }
      shy[i] = close ? Math.max(X.dim, shy[i] - dt / X.out) : Math.min(1, shy[i] + dt / X.back);
      const g = K.fox * s.k * shy[i];
      if (g > .35 && R() < dt * .12 * g * s.caps.length) {   // a spore drifting up off it
        const c = s.caps[R() * s.caps.length | 0];
        mote(1, s.x + c.dx, s.y + c.dy, host.elev(s.x, s.y) + c.h + .1, (R() - .5) * .1, (R() - .5) * .1, .06 + R() * .08, 3 + R() * 3);
      }
    }
  }
  function stepBloom(dt) {
    if (K.bloom <= 0) return;
    for (const bi of NB) {
      const b = PL.blooms[bi], cool = bloomCool[bi];
      for (let j = 0; j < cool.length; j++) if (cool[j] > 0) cool[j] -= dt;
      if (K.open < .3) continue;
      for (let w = 0; w < nW; w++) {
        const W = WALK[w]; if (W.sp < .5 || Math.hypot(W.x - b.x, W.y - b.y) > b.r + 1) continue;
        for (let j = 0; j < b.flowers.length; j++) {
          const f = b.flowers[j], x = b.x + f.dx, y = b.y + f.dy;
          if (cool[j] > 0 || Math.abs(W.x - x) > .6 || Math.abs(W.y - y) > .6 || Math.hypot(W.x - x, W.y - y) > .6) continue;
          cool[j] = 2.5; const g = host.elev(x, y);
          for (let n = 3 + (R() * 4 | 0); n > 0; n--) mote(2, x + (R() - .5) * .2, y + (R() - .5) * .2, g + .25 + R() * .1, (R() - .5) * .5, (R() - .5) * .5, .12 + R() * .25, 3 + R() * 2.5);
        }
      }
    }
  }
  function stepRing(dt) {
    const G = PL.ring; if (!G || !ringNear) return;
    ringH = host.elev(G.x, G.y);
    let inside = false; for (let w = 0; w < nW; w++) if (Math.hypot(WALK[w].x - G.x, WALK[w].y - G.y) < G.r * 1.1) inside = true;
    if (inside && K.foxNight > .3 && dancers < 12 && R() < dt * 1.5) {
      const c = G.caps[R() * G.caps.length | 0], i = mote(3, G.x + c.dx, G.y + c.dy, ringH + .1, Math.atan2(c.dy, c.dx), R() * TAU, R() * 1.2, 9 + R() * 6);
      if (i >= 0) dancers++;
    }
  }

  // ---------------------------------------------------------------- toasts: once each a session, as you first meet it
  function toasts() {
    const say = (k, ok) => { if (!ok || toastSaid[k]) return; toastSaid[k] = 1; ui()?.toast?.(TOAST[k][0], TOAST[k][1], k === 'fly' ? '#e4ff8e' : k === 'bloom' ? '#dce6ff' : '#8effd2'); };
    const x = P.x, y = P.y, d = (a, b) => Math.hypot(a - x, b - y);
    if (K.fly > .2) for (const si of NS) if (d(PL.swarms[si].x, PL.swarms[si].y) < 9 && SW[si].have > 3) say('fly', true);
    if (K.fox > .3) for (const i of NF) if (d(PL.fox[i].x, PL.fox[i].y) < 7) say('fox', true);
    if (K.open > .6) for (const bi of NB) if (d(PL.blooms[bi].x, PL.blooms[bi].y) < 8) say('bloom', true);
    if (PL.ring && ringNear && K.foxNight > .5 && d(PL.ring.x, PL.ring.y) < 7) say('ring', true);
  }

  // ---------------------------------------------------------------- the step (view: presentation only)
  let was = false, toastT = 0;
  F.view = dt => {
    const on = active();
    if (!on) { if (was) clearAll(); was = false; return; }
    was = true; T += dt;
    amounts(); walkers(dt);
    if ((nearT -= dt) <= 0) { nearT = .5; refresh(); }
    stepFlies(dt); stepFox(dt); stepBloom(dt); stepRing(dt); stepMotes(dt);
    if ((toastT -= dt) <= 0) { toastT = 1; toasts(); }
  };
  function clearAll() {
    for (let k = live.length - 1; k >= 0; k--) kill(k);
    for (const c of SW) c.have = 0;
    mk.fill(0); dancers = 0; NS.length = NF.length = NB.length = 0; inNS.fill(0); ringNear = false;
    for (const w of WBY.values()) w.orb = 0;
  }
  F.update = (dt, evs) => { if (evs) for (const e of evs) if (e.type === 'tree.fell' || e.type === 'tree.grow' || e.type === 'tree.charred') { felledDirty = true; nearT = 0; } };

  // ---------------------------------------------------------------- drawn
  const C1 = [0, 0, 0], C2 = [0, 0, 0], PT = {emit: true, size: 1, alpha: 1};
  const FLY_HI = rgbOf('#f6ffb4'), FLY_MID = rgbOf('#c4f05a'), SPORE = rgbOf('#7effd0'), POLLEN = rgbOf('#fff2c4'), DANCE = rgbOf('#bff8ff');
  const pt = (x, y, h, c, size, alpha) => { PT.size = size; PT.alpha = alpha; host.point(x, y, h, c, PT); };
  const mix = (o, a, b, k, m) => { o[0] = (a[0] + (b[0] - a[0]) * k) * m; o[1] = (a[1] + (b[1] - a[1]) * k) * m; o[2] = (a[2] + (b[2] - a[2]) * k) * m; return o; };
  const SPR = {img: null, em: null, sx: 0, sy: 0, sw: 0, sh: 0, x: 0, y: 0, h: 0, px: 0, py: 0, type: 3};
  F.frame = f => {
    if (!was) return;
    const z = Math.max(1, Math.round(host.zoom || 1)), t = T;
    // fireflies
    for (let k = 0; k < live.length; k++) {
      const i = live[k], b = bright(i); if (b < .03) continue;
      const sw = fsw[i]; if (sw >= 0) { const c = SW[sw]; c.sum += b; c.cx += fx[i]; c.cy += fy[i]; c.cn++; }
      pt(fx[i], fy[i], fh[i], mix(C1, FLY_MID, FLY_HI, clamp(b * 1.3 - .3, 0, 1), Math.min(1, .3 + b)), (b > .5 ? 2 : 1) * z, 1);
      if (b > .3) pt(fx[i], fy[i], fh[i], mix(C2, FLY_MID, FLY_HI, .3, .8 * b), (b > .75 ? 4 : 3) * z, .22 + .3 * b);   // (the soft glow round it, dithered)
    }
    lightsFrom();
    // the motes
    for (let i = 0; i < MM; i++) {
      if (!mk[i]) continue;
      const u = mt[i] / ml[i], fade = Math.min(1, mt[i] / .6) * (1 - smooth((u - .55) / .45));
      if (mk[i] === 1) pt(mx[i], my[i], mh[i], mix(C1, SPORE, SPORE, 0, .6 * fade * K.fox), z, 1);
      else if (mk[i] === 2) pt(mx[i], my[i], mh[i], mix(C1, POLLEN, POLLEN, 0, .85 * fade * Math.max(.35, K.open)), u < .25 ? 2 * z : z, 1);
      else { const pulse = ringPulse(Math.atan2(my[i] - PL.ring.y, mx[i] - PL.ring.x)); pt(mx[i], my[i], mh[i], mix(C1, DANCE, DANCE, 0, fade * (.35 + .65 * pulse)), z, 1); if (pulse > .6) pt(mx[i], my[i], mh[i], mix(C2, SPORE, SPORE, 0, .4 * fade), 3 * z, .3); }
    }
    // foxfire and the ring
    if (!FOXA) { FOXA = paintFox(); BLOA = paintBloom(); }
    SPR.img = FOXA.img; SPR.em = FOXA.em; SPR.sw = FW; SPR.sh = FH; SPR.px = FW / 2; SPR.py = FH - 1;
    for (const i of NF) {
      if (!(foxG[i] === foxG[i])) foxG[i] = host.elev(PL.fox[i].x, PL.fox[i].y);
      const s = PL.fox[i], g0 = foxG[i], lv = Math.round(Math.sqrt(clamp(K.fox * s.k * shy[i], 0, 1)) * (FLV - 1));
      for (let j = 0; j < s.caps.length; j++) {
        const c = s.caps[j], tw = lv > 1 ? Math.round(.6 * Math.sin(t * .5 + j * 1.9 + i)) : 0;   // (a slow shimmer: one level up or down)
        SPR.sx = c.v * FW; SPR.sy = clamp(lv + tw, 0, FLV - 1) * FH; SPR.x = s.x + c.dx; SPR.y = s.y + c.dy; SPR.h = g0 + c.h - .06;
        host.sprite(SPR);
      }
    }
    const G = PL.ring;
    if (G && ringNear) {
      const g0 = ringH || host.elev(G.x, G.y);
      for (let j = 0; j < G.caps.length; j++) {
        const c = G.caps[j], p = ringPulse(Math.atan2(c.dy, c.dx)), lv = Math.round(clamp(K.foxNight * (.2 + .8 * p), 0, 1) * (FLV - 1));
        SPR.sx = c.v * FW; SPR.sy = lv * FH; SPR.x = G.x + c.dx; SPR.y = G.y + c.dy; SPR.h = g0 - .04;
        host.sprite(SPR);
      }
    }
    // the moonflowers
    if (K.bloom > 0 && NB.length) {
      SPR.img = BLOA.img; SPR.em = BLOA.em; SPR.sw = BW; SPR.sh = BH; SPR.px = BW >> 1; SPR.py = BH - 1;
      for (const bi of NB) {
        const b = PL.blooms[bi];
        for (let j = 0; j < b.flowers.length; j++) {
          const fl = b.flowers[j], o = clamp((K.open - fl.d * .35) / .65, 0, 1), fr = o < .3 ? 0 : o < .75 ? 1 : 2;
          const lv = fr === 0 ? (K.open > .2 ? 1 : 0) : Math.round(clamp(K.open * (.55 + .45 * Math.sin(t * .4 + j)), 0, 1) * (BLV - 1));
          SPR.sx = (fl.v * 3 + fr) * BW; SPR.sy = lv * BH; SPR.x = b.x + fl.dx; SPR.y = b.y + fl.dy; const gg = bloomG[bi]; if (!(gg[j] === gg[j])) gg[j] = host.elev(SPR.x, SPR.y); SPR.h = gg[j] - .04;
          host.sprite(SPR);
        }
      }
    }
    SPR.img = SPR.em = null;
  };
  // the ring breathes: a slow wave of light going round it (period 7 s), with a breath in and out over the whole (period 11 s)
  const ringPulse = a => { const u = frac(T / 7 - a / TAU); return smooth(1 - Math.abs(u - .5) * 2.4) * (.7 + .3 * Math.sin(T * TAU / 11)); };

  // ---------------------------------------------------------------- lights: the brightest drifts near you, the lantern, the ring
  const LREC = [], LR = [0, 1, 2, 3].map(k => ({x: 0, y: 0, h: 0, color: '#bff060', radius: 3.6, intensity: 0, flicker: .1, id: 9950 + k}));
  const BEST = [-1, -1, -1], BESTV = [0, 0, 0];
  function lightsFrom() {
    LREC.length = 0; let n = 0;
    const me = WBY.get('me');
    if (me && me.orb >= 3) { const L = LR[n++]; L.x = me.x; L.y = me.y; L.h = me.z + 1.4; L.color = '#c8f070'; L.radius = 3.2; L.intensity = Math.min(.7, me.orb * .06) * K.fly; LREC.push(L); }
    BEST[0] = BEST[1] = BEST[2] = -1; BESTV[0] = BESTV[1] = BESTV[2] = 0;
    for (const si of NS) {
      const c = SW[si]; if (c.cn < 3) { c.sum = c.cx = c.cy = c.cn = 0; continue; }
      const s = PL.swarms[si], v = c.sum / (1 + Math.hypot(s.x - P.x, s.y - P.y) / 12);
      for (let k = 0; k < 3; k++) if (v > BESTV[k]) { for (let m = 2; m > k; m--) { BEST[m] = BEST[m - 1]; BESTV[m] = BESTV[m - 1]; } BEST[k] = si; BESTV[k] = v; break; }
    }
    for (let k = 0; k < 3 && n < TUNE.lights; k++) {
      const si = BEST[k]; if (si < 0) break;
      const c = SW[si], L = LR[n++]; L.x = c.cx / c.cn; L.y = c.cy / c.cn; L.h = (SW[si].g || 0) + 1.3; L.color = '#bff060'; L.radius = 3.8; L.intensity = clamp(c.sum * .12, .08, .9); LREC.push(L);
    }
    for (const si of NS) { const c = SW[si]; c.sum = c.cx = c.cy = c.cn = 0; }
    if (PL.ring && ringNear && dancers > 2 && Math.hypot(PL.ring.x - P.x, PL.ring.y - P.y) < 15) { const L = LR[3]; L.x = PL.ring.x; L.y = PL.ring.y; L.h = ringH + 1; L.color = '#8ef8e0'; L.radius = 4; L.intensity = .25 + .3 * ringPulse(0); LREC.push(L); }
  }
  F.lights = () => (was ? LREC : (LREC.length = 0, LREC));

  // ---------------------------------------------------------------- dev menu (F10 > Nature > Glowlife)
  const nearest = list => { let b = null, bd = 1e9; for (const s of list) { const d = Math.hypot(s.x - P.x, s.y - P.y); if (d > 6 && d < bd) { bd = d; b = s; } } if (!b) for (const s of list) { const d = Math.hypot(s.x - P.x, s.y - P.y); if (d < bd) { bd = d; b = s; } } return b; };
  const go = (s, off) => { if (!s) { ui()?.toast?.('Glow', 'none in this world', '#e8a070'); return; } const a = Math.atan2(P.y - s.y, P.x - s.x) || 0; host.teleport(s.x + Math.cos(a) * off, s.y + Math.sin(a) * off); nearT = 0; };
  F.toggle = () => { F.on = !F.on; };
  F.dev.rows = () => [
    {label: 'Glow (fireflies, foxfire, moonflowers)', get: () => F.on, set: v => { F.on = !!v; }},
    {label: 'Glow all day (test)', get: () => F.always, set: v => { F.always = !!v; }},
    {label: 'Make it a summer night here', run: () => { if (online()) { ui()?.toast?.('Glow', 'the clock is the server\'s in co-op', '#e8a070'); return; } host.env?.setSeason?.('summer'); host.env?.setHour?.(22); }},
    {label: 'Go to the nearest fireflies', run: () => go(nearest(PL.swarms), 2)},
    {label: 'Go to the nearest foxfire', run: () => go(nearest(PL.fox.filter((s, i) => standing[i])), 5)},
    {label: 'Go to the nearest night bloom', run: () => go(nearest(PL.blooms), 4)},
    {label: 'Go to the elf ring (älvdans)', run: () => go(PL.ring, 4)},
    {label: 'Now', text: () => `fireflies ${live.length} (x${K.fly.toFixed(2)}) · foxfire ${NF.length} spots (x${K.fox.toFixed(2)}) · flowers open ${K.open.toFixed(2)} · motes ${MM - mk.filter(k => !k).length}`},
  ];
  F.menu = () => [];
  F.hud = () => was && (live.length || K.fox > .05) ? `glow: fireflies ${live.length} · foxfire x${K.fox.toFixed(2)} · bloom ${K.open.toFixed(2)}` : '';
  F.state = () => ({on: F.on, active: active(), K: {...K}, flies: live.length, lantern: WBY.get('me')?.orb || 0, nearSwarms: NS.length, nearFox: NF.length, nearBlooms: NB.length, ring: !!PL.ring, ringNear, dancers, me: [+P.x.toFixed(1), +P.y.toFixed(1)],
    plan: {swarms: PL.swarms.length, fox: PL.fox.length, blooms: PL.blooms.length}});
  F.plan = PL;
  return F;
}
