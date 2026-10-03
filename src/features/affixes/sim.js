// AFFIXES SIM: the truth of features/affixes.js. Which enemy carries which affix, what each one does in the fight, and the
// telegraphed zones they leave (a hazard kit of its own: sim/hazards.js). Fixed 1/60 s steps; every random draw from this
// module's own generator (core/rng.js: seeded once from simSeed(), at boot when the feature starts on), so with ?views=0
// a run comes out the same (tools/test/simview.mjs). Nothing here draws.
//
// ROLLING: game/enemies.js runs our decorator on every spawn's options before the enemy joins the world: an elite /
//   champion (a regular brute on later stages) rolls by content/affixes.js CHANCE and WEIGHT for the run's stage; the
//   affix goes on as the creator's fields (affix: its id, bar: its HP bar colour) with its name ("Blazing Elite Brute"),
//   its aura colour (the game's ring, light and nameplate take it) and, for a regular brute, more health and damage.
//   A bearer joins our live query (host.entities 'affixes.bearer'), which makes its fight state (kept here, a WeakMap).
// THE AFFIXES (the numbers: content/affixes.js):
//   blazing     every landing leaves a burning patch (a moment's ember, then fire: it hurts you while you stand in it; a
//               wooden prop next to it catches: features/lights.js ignite); dying, a ring closes and it bursts into
//               flame, leaving patches round it
//   glacial     its blows chill you (a timed slow: the kit's 'player.speed' note); dying, a frost nova fills out from it
//               and goes off: damage, a knock and a longer chill
//   overloaded  every few seconds while you're in range it calls lightning: a strike on you, one where you're heading,
//               more round you on champions: rings close in, then the bolt; dying, a last discharge round where it fell
//   splitting   dying, it splits (a moment later) into 2-4 Splitlings: quicker, weaker, they don't split again
//   warded      a ward in front of it (turning after you slower than you can circle it) stops arrows and bullets from
//               the front until broken (it grows back); flank shots, falling arrows and blasts go round it; a piercing
//               shot hits it three times as hard and goes on through when it breaks it
//   vampiric    now and then it reaches a beam out to you (the telegraph); latched, it drains you and heals itself; get
//               out of reach, behind cover (a wall, a crate, another body) or dodge-roll to snap it. Its blows heal it too
//               (combat core heal)
// THE PLAYER is hurt the game's way (player.hurt; the kit respects every dodge / i-frame: sim/hazards.js).
// OWNS: the bearers' fight states, the pending splits, the hazard kit ('affixes': its zones and its slow note), the
//   generator. READS: the game (mode, phase, run stage), the combat core (immune, heal, spawnBrute), the player, the
//   entities (near: props to ignite), features/lights.js ignite.
// EMITS (through the kit): player.hurt, player.hit, hazard.burst.
//   const sim = createAffixSim(host, F)   (F: the feature: F.on is the switch)
//   sim.update(dt, evs) / onArrowHit(a, p) / trial(id, type) / clear() / stateOf(b) / H (the kit) / bearers / stats
import {mulberry32, simSeed} from '../../core/rng.js';
import {TAU, clamp, hypot2} from '../../core/mathx.js';
import {AFFIXES, AFFIX_IDS, CHANCE, WEIGHT, BRUTE_UP, ELITE_COINS, TIER} from '../../content/affixes.js';
import {onSpawn, spawnEnemy, scaleOf} from '../../game/enemies.js';
import {roamable} from '../../world/world.js';
import {createHazards} from '../../sim/hazards.js';

const DEG = Math.PI / 180;
const wrap = a => a - TAU * Math.floor((a + Math.PI) / TAU);   // -> [-pi, pi)

export function createAffixSim(host, F) {
  const P = host.player, ents = host.entities;
  const R = mulberry32(1); let seeded = false;
  const seed = () => { if (!seeded) { seeded = true; R.seed(simSeed()); } };   // (only once on: a draw from Math.random shifts the views')
  if (F.on) seed();
  const H = createHazards(host, {name: 'affixes', cap: 96});
  const ST = new WeakMap();   // bearer -> its fight state
  let pendK = 1, pendH = 1, want = null, game = null, core = null, lights = null;   // pendK / pendH: the spawn's damage / health scale, for its join
  const gameF = () => game ??= host.feature('game');
  const coreOf = () => core ??= host.feature('combat')?.core || null;
  const stats = {rolled: 0, patches: 0, strikes: 0, splits: 0, blocked: 0, drained: 0, healed: 0};

  // a bearer's state: one shape for every affix (a few fields each uses)
  function newState(b) {
    const id = b.affix, A = AFFIXES[id], tier = b.boss ? 2 : b.elite ? 1 : 0;
    const s = {id, A, tier, k: pendK, t: 0, air: false, lx: 1e9, ly: 1e9, cd: 0,
      ang: Math.atan2(P.x - b.x, P.y - b.y), whp: 0, wmax: 0, regrow: 0, hitN: 0, breakN: 0, hx: 0, hy: 0,
      bp: 0, bt: 0, tick: 0, castN: 0, healN: 0, healV: 0, chillN: 0, snapN: 0};
    if (id === 'overloaded') s.cd = 1.4 + R() * 1.4;
    if (id === 'vampiric') s.cd = 1.2 + R() * 1.6;
    if (id === 'warded') s.whp = s.wmax = Math.round(A.ward.hp[tier] * pendH);
    pendK = pendH = 1;
    return s;
  }
  const bearers = ents.query('affixes.bearer', p => !!p.affix && !!p.hunter, b => { ST.set(b, newState(b)); });

  // ---------------------------------------------------------------- rolling (game/enemies.js decorator)
  function pick(stage) {
    let sum = 0; for (const id of AFFIX_IDS) sum += WEIGHT[id][stage] || 0;
    let r = R() * sum;
    for (const id of AFFIX_IDS) { r -= WEIGHT[id][stage] || 0; if (r < 0) return id; }
    return null;
  }
  onSpawn((o, type, sc) => {
    if (!F.on || TIER[type] === undefined) return;
    const stage = clamp(gameF()?.run?.stage ?? 0, 0, 3);
    let id = want; want = null;
    if (!id) { seed(); if (R() >= (CHANCE[type]?.[stage] ?? 0)) return; id = pick(stage); if (!id) return; }
    const A = AFFIXES[id];
    o.affix = id; o.bar = A.bar; o.aura = A.col; o.name = `${A.name} ${o.name}`;
    if (type === 'brute') { o.hp = Math.round(o.hp * BRUTE_UP.hp); o.dmg = Math.round(o.dmg * BRUTE_UP.dmg); o.coins = BRUTE_UP.coins; }
    else if (o.coins) o.coins = [Math.round(o.coins[0] * ELITE_COINS), Math.round(o.coins[1] * ELITE_COINS)];   // worth more
    pendK = sc?.dmg ?? 1; pendH = sc?.hp ?? 1; stats.rolled++;
  });

  // ---------------------------------------------------------------- the affixes
  function firePatch(b, s) {
    const T = s.A.patch, bz = b.z || 0;
    if (hypot2(P.x - b.x, P.y - b.y) > T.near || hypot2(b.x - s.lx, b.y - s.ly) < T.gap || host.inStream(b.x, b.y)) return;
    s.lx = b.x; s.ly = b.y;
    if (H.add({x: b.x, y: b.y, z: bz, r: T.r[s.tier], warn: T.warn, last: T.last[s.tier], dps: T.dps * s.k, tick: T.tick, style: 'fire', col: s.A.col, by: b, data: 'patch'})) stats.patches++;
  }
  function strike(x, y, s, b, T, warn, i) {
    if (H.add({x, y, z: host.elev(x, y), r: T.r, warn: warn + i * .09, dmg: T.dmg[s.tier] * s.k, knock: T.knock, style: 'strike', col: s.A.col, by: b})) stats.strikes++;
  }
  function storm(b, s, dt) {
    if ((s.cd -= dt) > 0) return;
    const T = s.A.strike, d = hypot2(P.x - b.x, P.y - b.y);
    if (d > T.range || Math.abs(P.z - (b.z || 0)) > 1.5 || P.state === 'climb') { s.cd = .5; return; }
    s.cd = T.every[s.tier] + (R() * 2 - 1) * T.jitter; s.castN++;
    const n = T.n[s.tier], px = P.x, py = P.y;
    strike(px, py, s, b, T, T.warn, 0);
    // where you're heading (or a step off you, standing still), then round you
    let vx = 0, vy = 0; if (n > 1) { vx = P.vx; vy = P.vy; }
    const v = Math.sqrt(vx * vx + vy * vy);
    for (let i = 1; i < n; i++) {
      let x, y;
      if (i === 1 && v > 1) { const l = Math.min(T.leadMax, v * T.lead); x = px + vx / v * l; y = py + vy / v * l; }
      else { const a = R() * TAU, r = T.spread[0] + R() * (T.spread[1] - T.spread[0]); x = px + Math.sin(a) * r; y = py + Math.cos(a) * r; }
      strike(x, y, s, b, T, T.warn, i);
    }
  }
  function ward(b, s, dt) {
    const W = s.A.ward;
    if (s.whp <= 0 && (s.regrow -= dt) <= 0) s.whp = s.wmax;
    const max = W.turn[s.tier] * DEG * dt, d = wrap(Math.atan2(P.x - b.x, P.y - b.y) - s.ang);
    s.ang = wrap(s.ang + clamp(d, -max, max));
  }
  // a clear line for the beam: no wall, crate or other body between (sampled every ~.5 m, clear of both ends)
  function lineClear(b) {
    const dx = P.x - b.x, dy = P.y - b.y, d = Math.sqrt(dx * dx + dy * dy), n = Math.floor((d - .9) / .5);
    for (let i = 1; i <= n; i++) { const k = (.5 + i * .5) / d; if (host.blocked(b.x + dx * k, b.y + dy * k, b.z || 0, true)) return false; }   // (air: the beam passes over the stream)
    return true;
  }
  function snap(s, V) { s.bp = 0; s.bt = 0; s.cd = V.every[s.tier] * (.85 + R() * .3); s.snapN++; }
  function beam(b, s, dt) {
    const V = s.A.beam, d = hypot2(P.x - b.x, P.y - b.y), same = Math.abs(P.z - (b.z || 0)) < 1 && P.state !== 'climb';
    if (s.bp === 0) {
      if ((s.cd -= dt) > 0) return;
      if (d < V.range && same && lineClear(b)) { s.bp = 1; s.bt = 0; } else s.cd = .3;
    } else if (s.bp === 1) {   // reaching for you: the telegraph
      s.bt += dt;
      if (d > V.snap || !same || !lineClear(b)) snap(s, V);
      else if (s.bt >= V.reach) { if (P.untouchable) snap(s, V); else { s.bp = 2; s.bt = 0; s.tick = 0; } }
    } else {                   // latched: drain until you break it or it lets go
      s.bt += dt;
      if (d > V.snap || !same || P.untouchable || s.bt >= V.dur || !lineClear(b)) { snap(s, V); return; }
      if ((s.tick -= dt) <= 0) {
        s.tick = V.tick;
        const dmg = V.dps[s.tier] * V.tick * s.k;
        if (H.hurt(dmg, b)) { const h = coreOf()?.heal(b, dmg * V.heal) || 0; s.healN++; s.healV = h; stats.drained += dmg; stats.healed += h; }
      }
    }
  }
  function behave(b, s, dt) {
    s.t += dt;
    const landed = s.air && !b.air; s.air = !!b.air;
    if (s.id === 'blazing') { if (landed) firePatch(b, s); }
    else if (s.id === 'overloaded') storm(b, s, dt);
    else if (s.id === 'warded') ward(b, s, dt);
    else if (s.id === 'vampiric') beam(b, s, dt);
  }
  // its own blow landed on you (combat's player.hurt, by the brute: not our zones' or the drain's, which carry src)
  function struck(b, dmg) {
    const s = ST.get(b); if (!s) return;
    if (s.id === 'glacial') { const C = s.A.chill; H.slow(C.mul[s.tier], C.dur[s.tier]); s.chillN++; }
    else if (s.id === 'vampiric') { const h = coreOf()?.heal(b, dmg * s.A.melee) || 0; if (h > 0) { s.healN++; s.healV = h; stats.healed += h; } }
  }

  // ---------------------------------------------------------------- deaths
  const pend = [];   // splits about to happen: {t, x, y, tier, maxHp, dmg, k, ang}
  function died(b, s) {
    const x = b.x, y = b.y, z = b.z || 0, A = s.A, tier = s.tier;
    if (s.id === 'blazing') {
      const B = A.burst, T = A.patch;
      H.add({x, y, z, r: B.r[tier], warn: B.warn, dmg: B.dmg[tier] * s.k, knock: B.knock, style: 'blast', col: A.col, by: b, data: 'burst'});
      for (let i = 0, n = B.patches[tier], a0 = R() * TAU; i < n; i++) {
        const a = a0 + i / n * TAU + (R() - .5) * .5, d = B.r[tier] * (.35 + R() * .5), px = x + Math.sin(a) * d, py = y + Math.cos(a) * d;
        if (host.inStream(px, py) || host.elev(px, py) !== z) continue;
        if (H.add({x: px, y: py, z, r: T.r[tier] * (.8 + R() * .3), warn: B.warn + .05 + R() * .2, last: T.last[tier] * (.8 + R() * .4), dps: T.dps * s.k, tick: T.tick, style: 'fire', col: A.col, by: b, data: 'patch'})) stats.patches++;
      }
    } else if (s.id === 'glacial') {
      const N = A.nova;
      H.add({x, y, z, r: N.r[tier], warn: N.warn, dmg: N.dmg[tier] * s.k, knock: N.knock, slow: {mul: N.mul, dur: N.dur}, style: 'frost', col: A.col, by: b, data: 'nova'});
    } else if (s.id === 'overloaded') {
      const D = A.death, n = D.n[tier], T = A.strike;
      for (let i = 0, a0 = R() * TAU; i < n; i++) {
        const a = a0 + i / n * TAU, r = i === 0 && tier === 2 ? 0 : D.ring * (.7 + R() * .5);
        if (H.add({x: x + Math.sin(a) * r, y: y + Math.cos(a) * r, z, r: D.r, warn: D.warn + i * .12, dmg: D.dmg[tier] * s.k, knock: T.knock, style: 'strike', col: A.col, by: b})) stats.strikes++;
      }
    } else if (s.id === 'splitting') {
      pend.push({t: A.split.delay, x, y, tier, maxHp: b.maxHp, dmg: b.dmg ?? 10, k: s.k, ang: R() * TAU});
    }
    ST.delete(b);
  }
  // a split: its children hop out of where it fell (not into a wall, the stream or you)
  function split(q) {
    const c = coreOf(); if (!c) return;
    const A = AFFIXES.splitting, Sp = A.split, C = A.child, L = AFFIXES.splitling, n = Sp.n[q.tier];
    for (let i = 0; i < n; i++) {
      const a = q.ang + i / n * TAU;
      let x = q.x + Math.sin(a) * Sp.spread, y = q.y + Math.cos(a) * Sp.spread;
      const dp = hypot2(x - P.x, y - P.y);
      if (dp < .85 && Math.abs(P.z) < 1) { const ux = dp > .05 ? (x - P.x) / dp : Math.sin(a), uy = dp > .05 ? (y - P.y) / dp : Math.cos(a); x = P.x + ux * .9; y = P.y + uy * .9; }
      if (!roamable(x, y) || host.inStream(x, y) || host.elev(x, y) !== 0 || host.blocked(x, y, 0)) { x = q.x; y = q.y; }
      pendK = q.k;
      c.spawnBrute({x, y, type: 'brute', name: C.name, hp: Math.max(Sp.min, Math.round(q.maxHp * Sp.hp[q.tier])), dmg: Math.max(1, Math.round(q.dmg * Sp.dmg)),
        coins: C.coins, elite: false, boss: false, aura: L.col, bar: L.bar, affix: 'splitling',
        knock: C.knock, pause: C.pause, hopT: C.hopT, hopD: C.hopD, hopH: C.hopH, r: C.r, wait: .12 + i * .08});
      pendK = 1;
    }
    stats.splits++;
  }

  // the wooden props next to a patch catch as it does; a fire burst lights everything in its ring
  const nearI = [];
  H.onBurst = h => {
    if (h.style !== 'fire' && h.style !== 'blast') return;
    lights ??= host.feature('lights');
    if (!lights?.ignite) return;
    const r = h.style === 'blast' ? h.r : AFFIXES.blazing.ignite;
    for (const p of ents.near(h.x, h.y, r, nearI)) if (!p.broken && !p.gone && !p.hunter && Math.abs((p.z || 0) - h.z) < .8 && hypot2(p.x - h.x, p.y - h.y) < r + (p.r || .3)) lights.ignite(p);
  };

  // ---------------------------------------------------------------- the step
  let lastMode = '', lastStage = -1, lastWorld = null;
  function clear() { H.clear(); pend.length = 0; }
  function update(dt, evs) {
    const g = gameF(), mode = g?.mode ?? '';
    const live = F.on && (mode === 'sandbox' || (mode === 'run' && g.phase !== 'travel'));
    // a new mode, stage or world: what was burning is gone
    const stage = g?.run?.stage ?? -1;
    if (mode !== lastMode || stage !== lastStage || host.world !== lastWorld) { lastMode = mode; lastStage = stage; lastWorld = host.world; clear(); }
    if (!live) { if (H.n || H.slowT > 0 || pend.length) clear(); return; }
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === 'enemy.kill') { const s = e.who && ST.get(e.who); if (s) died(e.who, s); }
      else if (e.type === 'player.hurt' && e.src === undefined && e.by && e.by.affix) struck(e.by, e.dmg);
    }
    for (let i = pend.length - 1; i >= 0; i--) if ((pend[i].t -= dt) <= 0) { const q = pend[i]; pend.splice(i, 1); split(q); }
    for (let i = 0; i < bearers.length; i++) { const b = bearers[i]; if (b.broken) continue; const s = ST.get(b); if (s) behave(b, s, dt); }
    H.update(dt);
  }

  // the ward: a shot from in front of it (inside its arc, not falling from the sky) hits the ward instead (before combat
  // sees it: the feature's onArrowHit runs first). A piercing shot that breaks it goes on through
  function onArrowHit(a, p) {
    if (!F.on || p.affix !== 'warded' || p.broken) return undefined;
    const s = ST.get(p); if (!s || s.whp <= 0) return undefined;
    const W = s.A.ward, hv = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
    if (hv < 1e-3 || Math.abs(a.vh || 0) > hv * 1.5) return undefined;   // from above (the rain): over it
    if (Math.abs(wrap(Math.atan2(-a.vx, -a.vy) - s.ang)) > W.half * DEG) return undefined;   // from the side or behind: round it
    s.whp -= (a.dmg ?? 10) * (a.penK ?? 1) * (a.pierce ? W.pierce : 1); s.hitN++; s.hx = a.x; s.hy = a.y; stats.blocked++;
    if (s.whp <= 0) { s.whp = 0; s.regrow = W.regrow; s.breakN++; if (a.pierce) return undefined; }
    return 'stop';
  }

  // a trial (the sandbox's menu rows, the dev key): an enemy with this affix, ~5 m from you on open ground
  let trialN = 0;
  function trial(id, type = 'elite', at = null) {
    const c = coreOf(), g = gameF(); if (!F.on || !c || !g || !AFFIXES[id] || (g.mode !== 'sandbox' && g.mode !== 'run')) return null;
    for (let k = 0; k < 24; k++) {
      const a = (trialN * 5 + k) * TAU / 24, r = 5 + (k % 3) * .8, x = at && !k ? at.x : P.x + Math.sin(a) * r, y = at && !k ? at.y : P.y + Math.cos(a) * r;
      if (!roamable(x, y) || host.inStream(x, y) || host.elev(x, y) !== 0 || host.blocked(x, y, 0)) continue;
      trialN++; want = id;
      const b = spawnEnemy(c, type, x, y, scaleOf(Math.max(0, g.run?.stage ?? 0), 0));
      want = null; return b;
    }
    return null;
  }

  return {
    H, bearers, stats, stateOf: b => ST.get(b), update, onArrowHit, trial, clear,
    seed() { seed(); },
    get pending() { return pend.length; },
  };
}
