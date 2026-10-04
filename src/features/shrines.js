// SHRINES (an experiment, branch exp/shrines; off unless ?shrines=1 or the Dev tab's toggle, which remembers it): Risk of
// Rain / Hades style mini-events in a run. Each stage 2-3 shrines stand at free spots away from the spawn, the portal, the
// gates and the paths, drawn from the run's generator: real 3D props in the world's style (world/kit3d.js) with a
// floating emissive glyph, a coloured light, an E prompt with the price or the deal, particles and a sound on use, and a
// spent state (the light dies, the glyph cracks and slumps).
//   chance    pay gold for a chance at an item; the price rises per try; spent after a win or 3 tries
//   combat    calls a pack in round it now, through the wave director's own telegraphs (run.js summon; the sandbox and the
//             portal phase telegraph their own the same way); killing the pack pays gold, often an item
//   blood     a share of your health for gold scaled by it (a fountain of coins); 3 times
//   mountain  a run rule for this stage: the champion is stronger and an elite joins the last wave (host.mods notes run.js
//             reads), and clearing the stage gives extra items; an icon on the HUD while it holds (the sandbox: it calls a
//             mountain champion and an elite in, and beating them pays the items)
//   exchange  trades one of your items for a random one of the next tier, shown before you take it (E accepts, walking
//             away declines; the offer stands while you hold the item)
//   trader    a wandering trader's cart: one item, shown, for gold
// They go on a stage change and when the run ends. In the sandbox the pause menu's Game tab places each kind next to you
// (the sandbox's gold, health and build).
// SIM / VIEW: what the shrines are, their props, prices, rolls, packs and rewards are sim (update, interact: the feature's
// own generator, seeded per stage from the run's); the glyphs' bob, the lights' swell and fade, the particles and the
// meshes are view (view, frame: viewRandom), fed by the shrine.use events the sim emits.
// OWNS: its props (kind shrine_<kind>: a collider, interact 'shrine'; opened while it can't be used), the shrines' state,
//   the host.mods source 'shrine.mountain', its meshes (world.mesh, static: the cached static shadow) and sprite sheet, its
//   telegraphs (the sandbox's, the portal phase's), the particles.
// READS: the game (mode, phase, run, director, nav, stats, rewards, ui), combat's core (gold, enemies, spill), the layout
//   (spawn, ring, paths, lane, rail, pad), host.entities (near), the player.
// EMITS: shrine.use; for their sounds chest.open (a win, a payout, a trade), combat.coin (paying), combat.loot (core.spill),
//   combat.trap (a challenge called, the mountain woken), player.dryfire (a lost gamble: the hammer on an empty chamber).
// BUDGET: off: nothing (update returns; no Math.random, no props, no draws). On: update ~.01 ms (a few records); view +
//   frame ~.05 ms (<= 8 sprites, <= 512 points, <= 6 lights); <= 6 static meshes.
import * as WORLD from '../world/world.js';
import {roamable, elev, inStream, PLAY, TRAIL, sameLevel} from '../world/world.js';
import {mulberry32, viewRandom} from '../core/rng.js';
import {clamp, hypot2, TAU, clearArray} from '../core/mathx.js';
import {rgbOf} from '../core/color.js';
import {flags} from '../core/flags.js';
import {ITEMS, TIER, itemById} from '../game/items.js';
import {spawnEnemy, scaleOf} from '../game/enemies.js';
import {TELE} from '../game/run.js';
import {M4} from '../world/kit3d.js';
import {buildModels, SHAPE, LANTERN_AT, CANDLES} from './shrines/models.js';
import {buildArt, GLOW} from './shrines/art.js';

export const KINDS = ['chance', 'combat', 'blood', 'mountain', 'exchange', 'trader'];
export const NAMES = {chance: 'Shrine of Chance', combat: 'Shrine of Combat', blood: 'Shrine of Blood', mountain: 'Shrine of the Mountain',
  exchange: 'Altar of Exchange', trader: 'Wandering Trader'};
// how high each stops arrows (world.js PROP_TOP, read by sim/projectiles.js)
WORLD.propTop(Object.fromEntries(KINDS.map(k => ['shrine_' + k, SHAPE[k].top])));

// ---------------------------------------------------------------- tuning
export const TUNE = {
  count: 2, third: .5,                  // shrines a stage: 2, and a third with this chance
  weight: {chance: 1, combat: 1, blood: .9, mountain: .7, exchange: .8, trader: .7},   // which kinds (no kind twice a stage)
  trail: .5,                            // a spot out on the trail (east of the arena) is taken with this chance (the arena first)
  // placement (m): clear ground round it, and how far from the spawn, from each other, the gates, the paths (their
  // half width added), the range lane / rail, the movement ring (the portal opens in it), the light garden's pad, chests
  away: {clear: 1.25, spawn: 8, apart: 7, gate: 3.4, path: 1.6, lane: 2.6, ring: 1.6, pad: 1.4, interact: 2.6},
  chance: {price: 12, rise: 1.5, odds: .45, tries: 3, luck: .35},     // gold (x (1 + .5 stage), x rise per try), win odds, luck (a chest's is .25 x stage)
  combat: {budget: 5, perStage: 2.5, max: 6, near: [2.6, 4.6], coins: 16, coinsStage: 8, item: .5},   // a pack's budget (brute 1, elite 4)
  blood: {share: .3, minHp: 18, gold: 1, goldStage: .35, uses: 3},      // health share; gold per health x (gold + goldStage x stage)
  mountain: {hp: 1.6, dmg: 1.25, elites: 1, items: 2, luck: .5},       // the champion's health / damage x, extra elites, items on clear
  exchange: {reach: 2.4},               // m: further than this from the altar and its offer is put away
  trader: {price: [0, 40, 75, 140], perStage: .4, luck: .3},         // gold by the item's tier, x (1 + perStage x stage)
  glyphBob: 1.5,                        // art px
};
const round5 = v => Math.max(5, Math.round(v / 5) * 5);
const STAGE_PHASES = new Set(['arrive', 'wave', 'portal']);   // a run's shrines appear in these phases (not mid-travel or a pick)

export const order = {after: ['combat']};   // it reads this step's kills (the challenge's foes) after combat's step
export async function create(host) {
  const KEY = 'riftbound3d.shrines';
  const stored = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
  const q = flags.get('shrines');
  const F = {name: 'shrines', label: 'Shrines (experiment)', on: q === '1' || (q !== '0' && stored()), ms: 0};
  const R = mulberry32(1);   // the SIM's draws: placement, kinds, rolls (reseeded per stage from the run's generator)
  const V = viewRandom('shrines'), VR = (a, b) => a + V() * (b - a);   // presentation's
  const shrines = [], tele = [], NEAR = [];
  let ver = 0, game = null, core = null, runRef = null, stageI = -1, sbSeeded = false;
  const mountain = {on: false, paid: false, s: null};   // the Mountain's run rule this stage
  const P = host.player;

  const g = () => game ??= host.feature('game');
  const emit = (type, x, y, o) => { const e = {type, x, y}; if (o) Object.assign(e, o); host.events.push(e); };
  const use = (s, what, n = 0) => emit('shrine.use', s.x, s.y, {kind: s.kind, what, n, who: s.p});
  const stageOf = () => g()?.mode === 'run' && game.run ? game.run.stage : 0;

  // ================================================================ placement (sim)
  // free ground: enemies may roam it at height z, no water, nothing solid within r (soft scatter and enemies don't count)
  function freeAt(x, y, r, z = 0) {
    if (!roamable(x, y) || !sameLevel(elev(x, y), z, .15) || inStream(x, y)) return false;   // (a level footprint: within .15 m on walkable terrain)
    for (let k = 0; k < 8; k++) { const a = k * TAU / 8, sx = x + Math.sin(a) * r, sy = y + Math.cos(a) * r; if (!roamable(sx, sy) || !sameLevel(elev(sx, sy), z, .15) || inStream(sx, sy)) return false; }
    for (const p of host.entities.near(x, y, r + .8, NEAR)) {
      if (p.gone || p.hunter || (!(p.r > 0) && !p.rect)) continue;
      if (Math.abs((p.z || 0) - z) > 1) continue;
      if (p.rect ? x > p.rect[0] - r && x < p.rect[2] + r && y > p.rect[1] - r && y < p.rect[3] + r : hypot2(p.x - x, p.y - y) < p.r + r) return false;
    }
    return true;
  }
  const segD = (x, y, a, b) => {   // distance from (x, y) to the segment a-b
    const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l, 0, 1) : 0;
    return hypot2(x - a[0] - dx * t, y - a[1] - dy * t);
  };
  // every spot a stage's shrine may take (a 1 m grid; once a stage)
  function candidates() {
    const L = host.layout, A = TUNE.away, out = [], sp = L.spawn, cx = (PLAY.x0 + PLAY.x1) / 2, cy = (PLAY.y0 + PLAY.y1) / 2;
    const gates = [[cx, PLAY.y0], [cx, PLAY.y1], [PLAY.x0, cy], [PLAY.x1, cy]];
    const inter = host.entities.list.filter(p => p.interact && !p.gone);
    const nav = g()?.nav;
    // (only where enemies roam: the arena and the trail, layout.js roamable; not the whole world, which may be grown)
    const x0 = Math.floor(Math.min(PLAY.x0, TRAIL.x0)), x1 = Math.max(PLAY.x1, TRAIL.x1), y0 = Math.floor(Math.min(PLAY.y0, TRAIL.y0)), y1 = Math.max(PLAY.y1, TRAIL.y1);
    for (let y = y0 + .5; y < y1; y += 1) for (let x = x0 + .5; x < x1; x += 1) {
      if (hypot2(x - sp.x, y - sp.y) < A.spawn) continue;
      if (nav?.built && !nav.isOpen(x, y)) continue;
      if (gates.some(([gx, gy]) => hypot2(x - gx, y - gy) < A.gate)) continue;
      let bad = false;
      for (const m of L.marks) {
        if (m.type === 'path') { for (let i = 0; i + 1 < m.pts.length && !bad; i++) if (segD(x, y, m.pts[i], m.pts[i + 1]) < m.w / 2 + A.path) bad = true; }
        else if (m.type === 'lane' || m.type === 'rail') { if (x > m.x0 - A.lane && x < m.x1 + A.lane && Math.abs(y - m.y) < A.lane) bad = true; }
        else if (m.type === 'ring' || m.type === 'pad') { if (hypot2(x - m.x, y - m.y) < m.r + (m.type === 'ring' ? A.ring : A.pad)) bad = true; }
        if (bad) break;
      }
      if (bad || inter.some(p => hypot2(p.x - x, p.y - y) < A.interact)) continue;
      if (!freeAt(x, y, A.clear)) continue;
      out.push({x, y, trail: x > PLAY.x1});
    }
    return out;
  }
  function pickKinds(n) {
    const pool = KINDS.slice(), out = [];
    while (out.length < n && pool.length) {
      let sum = 0; for (const k of pool) sum += TUNE.weight[k];
      let r = R() * sum, i = 0;
      for (; i < pool.length - 1; i++) { r -= TUNE.weight[pool[i]]; if (r <= 0) break; }
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }
  function spawnStage() {
    clearAll();
    R.seed(game.rewards.seed());
    const n = TUNE.count + (R() < TUNE.third ? 1 : 0), kinds = pickKinds(n), cand = candidates();
    for (const kind of kinds) {
      for (let tries = 0; tries < 80 && cand.length; tries++) {
        const c = cand[Math.floor(R() * cand.length)];
        if (c.trail && R() > TUNE.trail) continue;
        if (shrines.some(s => hypot2(s.x - c.x, s.y - c.y) < TUNE.away.apart)) continue;
        addShrine(kind, c.x, c.y, 0);
        break;
      }
    }
    runRef = game.run; stageI = game.run.stage;
    if (shrines.length) ui().toast(shrines.length === 1 ? 'A shrine stands in the grounds' : `${shrines.length} shrines stand in the grounds`, shrines.map(s => NAMES[s.kind]).join(' · '), '#c8b4ff');
  }

  // ================================================================ a shrine (sim)
  // the record: {kind, p (its prop), x, y, z, yaw, uses, spent, busy, price, item, offer, pack, sig, prompt}
  function addShrine(kind, x, y, z) {
    const S = SHAPE[kind], yaw = S.rect ? 0 : (R() - .5) * .6;   // (a rect collider stays square to the axes)
    const p = {kind: 'shrine_' + kind, x, y, z, interact: 'shrine', opened: false};
    if (S.rect) p.rect = [x - S.rect[0], y - S.rect[1], x + S.rect[0], y + S.rect[1]]; else p.r = S.r;
    const s = {kind, p, x, y, z, yaw, uses: 0, spent: false, busy: false, price: 0, item: null, offer: null, pack: [], sig: -1, prompt: {text: '', color: ''}, left: 0};
    const st = stageOf();
    if (kind === 'chance') s.price = priceChance(st, 0);
    if (kind === 'trader') { s.item = game.rewards.rollItem(R, st * .25 + TUNE.trader.luck); s.price = round5(TUNE.trader.price[s.item.tier] * (1 + TUNE.trader.perStage * st)); }
    host.entities.add(p);
    shrines.push(s); ver++;
    return s;
  }
  function removeShrine(s) {
    host.entities.remove(s.p);
    const i = shrines.indexOf(s); if (i >= 0) shrines.splice(i, 1);
    if (mountain.s === s) mountain.s = null;
    ver++;
  }
  function clearAll() {
    while (shrines.length) removeShrine(shrines[shrines.length - 1]);
    tele.length = 0;
    if (mountain.on) { host.mods.clear('shrine.mountain'); mountain.on = false; }
    mountain.paid = false; mountain.s = null;
    runRef = null; stageI = -1;
  }
  function spend(s) { s.spent = true; s.busy = false; s.offer = null; s.p.opened = true; use(s, 'spent'); }
  const priceChance = (st, used) => round5(TUNE.chance.price * (1 + .5 * st) * TUNE.chance.rise ** used);
  const ui = () => game.ui;
  const say = (s, text, col = '#e0604a') => ui().float(s.x, s.y, SHAPE[s.kind].glyph - .3, text, col);

  // ---- the challenge's foes (Shrine of Combat; the sandbox's Mountain): round the shrine, on ground they can stand on
  function packOf(st) {
    const T = TUNE.combat; let budget = T.budget + T.perStage * st; const out = [];
    while (budget >= 4 + 1 && out.length < T.max - 1 && R() < .45 + .1 * st) { out.push('elite'); budget -= 4; }
    while (budget >= 1 && out.length < T.max) { out.push('brute'); budget -= 1; }
    return out;
  }
  function spotsNear(s, n) {
    const out = [], [lo, hi] = TUNE.combat.near;
    for (let tries = 0; out.length < n && tries < 60; tries++) {
      const a = R() * TAU, d = lo + R() * (hi - lo), x = s.x + Math.sin(a) * d, y = s.y + Math.cos(a) * d;
      if (!freeAt(x, y, .45, s.z) || hypot2(x - P.x, y - P.y) < 2) continue;
      if (out.some(o => hypot2(o.x - x, o.y - y) < 1.2)) continue;
      out.push({x, y});
    }
    return out;
  }
  // call them in: the director's telegraphs while it runs a wave; else this feature's own (the same ring, the same spawn)
  function callPack(s, types, sc) {
    const at = spotsNear(s, types.length), D = game.director, viaDirector = game.mode === 'run' && game.phase === 'wave';
    for (let i = 0; i < at.length; i++) {
      const t = viaDirector ? D.summon(types[i], at[i].x, at[i].y) : {x: at[i].x, y: at[i].y, type: types[i], t: 0, b: null, sc, boss: types[i] === 'champion', elite: types[i] === 'elite'};
      if (!viaDirector) tele.push(t);
      s.pack.push(t);
    }
    s.busy = true; s.p.opened = true; s.left = s.pack.length;
    return at.length;
  }
  function stepPack(s) {
    let live = 0, lost = 0;
    for (const t of s.pack) {
      const b = t.b;
      if (!b) { if (tele.includes(t) || game.director.tele.includes(t)) live++; else lost++; continue; }   // (still a ring; or the director dropped it)
      if (!(b.dead || b.broken)) live++;
      else if (!(b.hp <= 0)) lost++;   // taken away (a run ended, cleared), not killed
    }
    s.left = live;
    if (live) return;
    if (lost) { spend(s); return; }   // nothing for foes you didn't kill
    payPack(s);
  }
  function payPack(s) {
    const st = stageOf();
    if (s.kind === 'mountain') { for (let i = 0; i < TUNE.mountain.items; i++) game.rewards.giveItem(game.rewards.rollItem(R, st * .25 + TUNE.mountain.luck), s.x, s.y, SHAPE[s.kind].glyph + i * .45); use(s, 'yield', TUNE.mountain.items); }
    else {
      const T = TUNE.combat, coins = T.coins + T.coinsStage * st, elite = s.pack.some(t => t.type === 'elite');
      core.spill(s.x, s.y, (s.z || 0) + 1, coins, 1.2);
      if (elite || R() < T.item) game.rewards.giveItem(game.rewards.rollItem(R), s.x, s.y, SHAPE[s.kind].glyph);
      use(s, 'clear', coins);
    }
    emit('chest.open', s.x, s.y);
    spend(s);
  }

  // ---- E at a shrine (sim: the key handler, like a chest)
  const ACT = {
    chance(s) {
      const T = TUNE.chance, cost = s.price;
      if (!game.rewards.spend(cost)) { say(s, `need ${cost} gold`); return; }
      s.uses++; use(s, 'pay', cost); emit('combat.coin', s.x, s.y);
      if (R() < T.odds) {
        const it = game.rewards.rollItem(R, stageOf() * .25 + T.luck);
        game.rewards.giveItem(it, s.x, s.y, SHAPE.chance.glyph); use(s, 'win'); emit('chest.open', s.x, s.y); spend(s);
      } else {
        use(s, 'lose'); emit('player.dryfire', s.x, s.y, {z: s.z, gun: 'shrine'}); say(s, 'nothing', '#b8b0a4');
        if (s.uses >= T.tries) spend(s); else s.price = priceChance(stageOf(), s.uses);
      }
    },
    combat(s) {
      const run = game.mode === 'run';
      if (run && game.phase !== 'wave' && game.phase !== 'portal') { say(s, 'the shrine waits for the fight', '#b8b0a4'); return; }
      const st = stageOf(), n = callPack(s, packOf(st), scaleOf(st, run ? game.director.wave : 0));
      if (!n) { s.busy = false; s.p.opened = false; s.pack.length = 0; say(s, 'no room for a fight here', '#b8b0a4'); return; }
      use(s, 'call', n); emit('combat.trap', s.x, s.y);
    },
    blood(s) {
      const S = game.stats.S, T = TUNE.blood;
      if (S.hp < T.minHp) { say(s, 'too weak to bleed'); return; }
      const cost = Math.round(S.hp * T.share), d = game.stats.hurt(cost), gold = Math.round(d * (T.gold + T.goldStage * stageOf()));
      host.PL.flicker(.5); ui().float(P.x, P.y, P.z + 1.9, '-' + d, '#ff6a50', true);
      core.spill(s.x, s.y, (s.z || 0) + .8, gold, 1.1);
      s.uses++; use(s, 'bleed', d);
      if (s.uses >= T.uses) spend(s);
    },
    mountain(s) {
      const T = TUNE.mountain;
      if (game.mode !== 'run') {   // the sandbox: the mountain's champion and an elite, here and now
        const sc = scaleOf(0, 0), cs = {hp: sc.hp * T.hp, dmg: sc.dmg * T.dmg};
        if (!callPack(s, ['champion', 'elite'], sc)) { say(s, 'no room for a fight here', '#b8b0a4'); return; }
        for (const t of s.pack) if (t.type === 'champion') t.sc = cs;
        use(s, 'wake'); emit('combat.trap', s.x, s.y);
        return;
      }
      if (!mountainOpen()) { say(s, 'the mountain sleeps', '#b8b0a4'); return; }
      host.mods.set('shrine.mountain', [{stat: 'run.champHp', mul: T.hp}, {stat: 'run.champDmg', mul: T.dmg}, {stat: 'run.eliteLast', add: T.elites}]);
      mountain.on = true; mountain.paid = false; mountain.s = s;
      s.busy = true; s.p.opened = true;
      ui().toast('The mountain wakes', `the champion is stronger, an elite joins the last wave · ${T.items} items when the stage is cleared`, '#a8d8ff');
      use(s, 'wake'); emit('combat.trap', s.x, s.y);
    },
    exchange(s) {
      if (s.offer && game.stats.items.has(s.offer.give.id)) {   // the trade
        const {give, get} = s.offer;
        game.rewards.takeItem(give.id); game.rewards.giveItem(get, s.x, s.y, SHAPE.exchange.glyph); ui().float(s.x, s.y, SHAPE.exchange.glyph - .9, '- ' + give.name, '#9a937f');
        use(s, 'trade'); emit('chest.open', s.x, s.y); spend(s);
        return;
      }
      s.offer = offerOf(); s.sig = -1;
      if (!s.offer) { say(s, 'the rift wants a common or uncommon item', '#b8b0a4'); return; }
      use(s, 'offer');
    },
    trader(s) {
      if (!game.rewards.spend(s.price)) { say(s, `need ${s.price} gold`); return; }
      game.rewards.giveItem(s.item, s.x, s.y, SHAPE.trader.glyph);
      use(s, 'buy', s.price); emit('combat.coin', s.x, s.y); emit('chest.open', s.x, s.y); spend(s);
    },
  };
  // the Mountain may be woken until the last wave is planned (the director plans a wave as it starts)
  function mountainOpen() {
    const D = game.director;
    return game.phase === 'arrive' || (game.phase === 'wave' && !(D.phase === 'wave' && D.wave >= D.waves - 1));
  }
  // the altar's offer: one of your items below the top tier (by copies held), for a random one of the next tier
  function offerOf() {
    const held = [];
    for (const [id, n] of game.stats.items) { const it = itemById(id); if (it.tier < 3) for (let i = 0; i < n; i++) held.push(it); }
    if (!held.length) return null;
    const give = held[Math.floor(R() * held.length)], kind = host.weapon?.kind ?? 'bow';
    const pool = ITEMS.filter(i => i.tier === give.tier + 1 && (!i.only || i.only === kind));
    return pool.length ? {give, get: pool[Math.floor(R() * pool.length)]} : null;
  }

  // ================================================================ the prompt (cached: rebuilt when what it says changes)
  function promptOf(s) {
    const gold = core.gold, st = stageOf();
    let sig = 0, text = '', color = GLOW[s.kind][1];
    if (s.kind === 'chance') { const ok = gold >= s.price; sig = s.price * 8 + s.uses * 2 + (ok ? 1 : 0); if (sig === s.sig) return s.prompt;
      text = `E  gamble ${s.price} gold · ${Math.round(TUNE.chance.odds * 100)}% for an item · ${TUNE.chance.tries - s.uses} left`; if (!ok) color = '#e0604a'; }
    else if (s.kind === 'combat') { const ok = !(game.mode === 'run' && game.phase !== 'wave' && game.phase !== 'portal'); sig = ok ? 1 : 2; if (sig === s.sig) return s.prompt;
      text = ok ? 'E  call a challenge · beat it for gold' : 'the shrine waits for the fight'; if (!ok) color = '#9a937f'; }
    else if (s.kind === 'blood') {
      const hp = game.stats.S.hp, cost = Math.round(hp * TUNE.blood.share), ok = hp >= TUNE.blood.minHp, gold = Math.round(cost * (TUNE.blood.gold + TUNE.blood.goldStage * st));
      sig = cost * 8 + s.uses * 2 + (ok ? 1 : 0); if (sig === s.sig) return s.prompt;
      text = ok ? `E  bleed ${cost} health · ${gold} gold · ${TUNE.blood.uses - s.uses} left` : 'too weak to bleed'; if (!ok) color = '#e0604a';
    }
    else if (s.kind === 'mountain') { const ok = game.mode !== 'run' || mountainOpen(); sig = ok ? 1 : 2; if (sig === s.sig) return s.prompt;
      text = !ok ? 'the mountain sleeps' : game.mode === 'run' ? `E  wake the mountain · a stronger champion, +${TUNE.mountain.items} items` : `E  wake the mountain · its champion, +${TUNE.mountain.items} items`;
      if (!ok) color = '#9a937f'; }
    else if (s.kind === 'exchange') { const o = s.offer; sig = o ? 3 + (o.away ? 1 : 0) + ITEMS.indexOf(o.give) * 64 + ITEMS.indexOf(o.get) * 2 : 1; if (sig === s.sig) return s.prompt;
      text = o ? (o.away ? `E  trade ${o.give.name}  →  ${o.get.name}` : 'E  accept the trade') : 'E  hear the rift\'s offer'; }
    else if (s.kind === 'trader') { const ok = gold >= s.price; sig = ok ? 1 : 2; if (sig === s.sig) return s.prompt;
      text = `E  buy ${s.item.name} · ${s.price} gold`; if (!ok) color = '#e0604a'; }
    s.sig = sig; s.prompt = {text, color};
    return s.prompt;
  }

  // ================================================================ the sandbox's menu: place one next to you
  function placeNear(kind) {
    if (!g() || !core) return;
    if (!F.on) setOn(true);
    if (!sbSeeded) { R.seed(game.rewards.seed()); sbSeeded = true; }
    const z = P.z, fa = P.faceAngle;
    for (let k = 0; k < 24; k++) {   // in front of you first, then round you, a little further each time
      const a = fa + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * .5, d = 2.2 + Math.floor(k / 8) * .6, x = P.x + Math.sin(a) * d, y = P.y + Math.cos(a) * d;
      if (!freeAt(x, y, .9, Math.abs(elev(x, y) - z) < .05 ? elev(x, y) : -1)) continue;
      if (shrines.some(s => hypot2(s.x - x, s.y - y) < 1.8)) continue;
      addShrine(kind, x, y, elev(x, y)); return;
    }
    game.ui.float(P.x, P.y, P.z + 2, 'no room here', '#e0604a');
  }
  function setOn(v) {
    F.on = v;
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* storage blocked: for this page only */ }
    if (!v) { clearAll(); dropView(); }   // (off, the views and draws stop: what they hold goes now)
  }
  F.toggle = () => setOn(!F.on);
  F.menu = () => g()?.mode === 'sandbox' && F.on ? [...KINDS.map(k => ({label: `Place: ${NAMES[k]}`, run: () => placeNear(k)})), {label: 'Clear the shrines', run: clearAll}] : [];

  // ================================================================ sim
  F.update = (dt, evs) => {
    if (!F.on) return;
    if (!g()) return;
    core ??= host.feature('combat')?.core; if (!core) return;
    const t0 = performance.now();
    // the run's stages: a new stage (or a new run) gets its own; leaving the run, travelling or dying takes them away
    if (game.mode === 'run' && game.run && !game.run.done) {
      if (game.phase === 'travel' || runRef !== game.run || stageI !== game.run.stage) {
        if (shrines.length || runRef) clearAll();
        if (STAGE_PHASES.has(game.phase)) spawnStage();
      }
    } else if (game.mode !== 'sandbox') { if (shrines.length || runRef) clearAll(); }
    else if (runRef) clearAll();   // (back in the sandbox after a run)
    // this feature's own telegraphs ripen into enemies (the director's ripen in its own step)
    for (let i = tele.length - 1; i >= 0; i--) {
      const t = tele[i]; t.t += dt;
      if (t.t >= TELE) { tele.splice(i, 1); t.b = spawnEnemy(core, t.type, t.x, t.y, t.sc); }
    }
    for (let i = shrines.length - 1; i >= 0; i--) {
      const s = shrines[i];
      if (s.busy && s.pack.length) stepPack(s);
      if (s.offer && hypot2(P.x - s.x, P.y - s.y) > TUNE.exchange.reach && !s.spent) { s.offer.away = true; }
      else if (s.offer) s.offer.away = false;
    }
    // the Mountain pays when the stage is cleared
    if (mountain.on && !mountain.paid && game.mode === 'run' && game.phase === 'clear') {
      mountain.paid = true; host.mods.clear('shrine.mountain'); mountain.on = false;
      const s = mountain.s, x = s ? s.x : P.x, y = s ? s.y : P.y, T = TUNE.mountain;
      for (let i = 0; i < T.items; i++) game.rewards.giveItem(game.rewards.rollItem(R, stageOf() * .25 + T.luck), P.x, P.y, P.z + 2.2 + i * .45);
      if (s) { use(s, 'yield', T.items); spend(s); }
      emit('chest.open', x, y);
    }
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  const shrineOf = p => { for (let i = 0; i < shrines.length; i++) if (shrines[i].p === p) return shrines[i]; return null; };
  F.interact = p => {
    if (!F.on || p.interact !== 'shrine') return false;
    const s = shrineOf(p); if (!s || s.spent || s.busy || !g()) return !!s;
    core ??= host.feature('combat')?.core; if (!core) return true;
    ACT[s.kind](s);
    return true;
  };
  F.prompt = p => {
    if (!F.on || p.interact !== 'shrine' || !game || !core) return null;
    const s = shrineOf(p);
    return s && !s.spent && !s.busy ? promptOf(s) : null;
  };

  // ================================================================ view: particles (structure of arrays), glyphs, lights
  const NP = 512, px = new Float32Array(NP), py = new Float32Array(NP), ph = new Float32Array(NP), pvx = new Float32Array(NP), pvy = new Float32Array(NP),
    pvh = new Float32Array(NP), page = new Float32Array(NP), plife = new Float32Array(NP), pdrag = new Float32Array(NP), pgrav = new Float32Array(NP),
    pcol = new Uint8Array(NP), pfl = new Uint8Array(NP);   // pfl: bit 0 glows, bit 1 big
  let np = 0;
  // the palette: each kind's three glows, then smoke greys, white, blood, gold
  const PAL = [], palOf = {};
  for (const k of KINDS) { palOf[k] = PAL.length; for (const c of GLOW[k]) PAL.push(rgbOf(c)); }
  const SMOKE = PAL.length; for (const c of ['#8a8580', '#6a6560', '#4e4a46']) PAL.push(rgbOf(c));
  const WHITE = PAL.length; for (const c of ['#ffffff', '#fff6e0', '#e8f0ff']) PAL.push(rgbOf(c));
  const BLOODC = PAL.length; for (const c of ['#ff3a48', '#c8142c', '#7e0a1a']) PAL.push(rgbOf(c));   // (blood: deeper than the shrine's glow)
  const GOLDC = palOf.chance;
  // host.point's options, kept (glow x size x 4 alpha steps): no object a point
  const OPT = []; for (let f = 0; f < 4; f++) for (let a = 0; a < 4; a++) OPT.push({emit: !!(f & 1), size: f & 2 ? 2 : 1, alpha: 1 - a * .22});
  function part(x, y, h, vx, vy, vh, life, col, fl = 1, drag = 0, grav = 0) {
    if (np >= NP) return;
    const i = np++; px[i] = x; py[i] = y; ph[i] = h; pvx[i] = vx; pvy[i] = vy; pvh[i] = vh; page[i] = 0; plife[i] = life; pcol[i] = col; pfl[i] = fl; pdrag[i] = drag; pgrav[i] = grav;
  }
  const NOOPT = {}, NOGLOW = {glow: 0}, DUSTO = {glow: 0, grav: 6}, BLEEDO = {up: .6};
  function burst(x, y, h, n, col, sp = 2.5, o = NOOPT) {
    const glow = o.glow ?? 1;   // (0: smoke and dust, unlit)
    for (let i = 0; i < n; i++) { const a = V() * TAU, s = VR(.3, 1) * sp; part(x, y, h, Math.sin(a) * s, Math.cos(a) * s * .8, VR(.5, 2.5) * (o.up ?? 1), VR(.35, .8), col + (V() * 3 | 0), (V() < .3 ? 2 : 0) | glow, 2.5, o.grav ?? 3); }
  }
  // a stream from (x0, y0, h0) to (x1, y1, h1): each lands there after `T` s (ballistic, gravity g)
  function stream(x0, y0, h0, x1, y1, h1, n, col, T = .55, g = 9, spread = .4) {
    for (let i = 0; i < n; i++) {
      const tt = T * VR(.8, 1.2), dx = x1 - x0 + VR(-.15, .15), dy = y1 - y0 + VR(-.15, .15);
      part(x0 + VR(-spread, spread) * .3, y0 + VR(-spread, spread) * .3, h0 + VR(0, .3), dx / tt, dy / tt, (h1 - h0) / tt + .5 * g * tt, tt, col + (V() * 3 | 0), V() < .45 ? 3 : 1, 0, g);
    }
  }
  function stepParts(dt) {
    for (let i = np - 1; i >= 0; i--) {
      page[i] += dt;
      if (page[i] >= plife[i]) { np--; px[i] = px[np]; py[i] = py[np]; ph[i] = ph[np]; pvx[i] = pvx[np]; pvy[i] = pvy[np]; pvh[i] = pvh[np]; page[i] = page[np]; plife[i] = plife[np]; pcol[i] = pcol[np]; pfl[i] = pfl[np]; pdrag[i] = pdrag[np]; pgrav[i] = pgrav[np]; continue; }
      if (pdrag[i]) { const k = Math.max(0, 1 - pdrag[i] * dt); pvx[i] *= k; pvy[i] *= k; pvh[i] *= k; }
      pvh[i] -= pgrav[i] * dt; px[i] += pvx[i] * dt; py[i] += pvy[i] * dt; ph[i] += pvh[i] * dt;
    }
  }
  // per shrine, presentation only (a list kept in step with the shrines: syncView on `ver`): glow (0..1, the light), pulse
  // (a use's flash), bob phase, fall (the spent glyph slumping), the mote timer, the mesh
  const VL = [];
  let viewVer = -1, models = null, sheet = null, T = 0;
  const glyphH = s => SHAPE[s.kind].glyph;
  const shaped = s => SHAPE[s.kind];
  function dropView() { for (const v of VL) v.mesh?.dispose(); VL.length = 0; np = 0; viewVer = -1; }
  function syncView() {
    viewVer = ver;
    for (let i = VL.length - 1; i >= 0; i--) if (!shrines.includes(VL[i].s)) { VL[i].mesh?.dispose(); VL.splice(i, 1); }
    for (const s of shrines) if (!VL.some(v => v.s === s)) VL.push({s, glow: 0, pulse: 1, ph: V() * TAU, fall: 0, mote: V(), mesh: null, flash: -1});
  }
  function onUse(e) {
    let v = null; for (let i = 0; i < VL.length; i++) if (VL[i].s.p === e.who) v = VL[i];
    if (!v) return;
    const s = v.s;
    const k = palOf[s.kind], gh = glyphH(s) + (s.z || 0), x = s.x, y = s.y, z = s.z || 0;
    switch (e.what) {
      case 'pay': stream(P.x, P.y, P.z + 1.1, x, y, z + shaped(s).top, 12, GOLDC, .45); v.pulse = Math.max(v.pulse, .4); break;
      case 'win': case 'trade': case 'buy': case 'yield': case 'clear':
        burst(x, y, gh, 46, k, 3.2); burst(x, y, gh, 10, WHITE, 1.5); v.pulse = 1; break;
      case 'lose':
        for (let i = 0; i < 26; i++) part(x + VR(-.35, .35), y + VR(-.25, .25), z + shaped(s).top + VR(0, .35), VR(-.6, .6), VR(-.45, .45), VR(.3, 1.2), VR(.9, 1.6), SMOKE + (V() * 3 | 0), V() < .75 ? 2 : 0, 1.4, -.35);
        burst(x, y, gh, 8, SMOKE, 1.4, NOGLOW); v.pulse = Math.max(v.pulse, .25); break;
      case 'bleed': stream(P.x, P.y, P.z + 1.1, x, y + .02, z + .72, 30, BLOODC, .65, 11, .7); burst(x, y + .02, z + .75, 12, BLOODC, 1.2, BLEEDO); v.pulse = .8; break;
      case 'call': for (let i = 0; i < 28; i++) { const a = i / 28 * TAU; part(x + Math.sin(a) * .5, y + Math.cos(a) * .4, z + .1, Math.sin(a) * 3.5, Math.cos(a) * 2.8, VR(.5, 2), VR(.4, .8), k + (V() * 3 | 0), 1, 3, 2); }
        v.pulse = 1; break;
      case 'wake': for (let i = 0; i < 36; i++) { const a = V() * TAU, r = VR(.2, .7); part(x + Math.sin(a) * r, y + Math.cos(a) * r * .8, z + VR(0, .4), Math.cos(a) * 1.2, -Math.sin(a) * 1, VR(1.5, 3.5), VR(.8, 1.5), k + (V() * 3 | 0), 1, 1.2, 0); }
        v.pulse = 1; break;
      case 'offer': for (let i = 0; i < 20; i++) { const a = V() * TAU; part(x + Math.sin(a) * .5, y + Math.cos(a) * .3, z + .9, Math.cos(a) * 1.5, -Math.sin(a) * 1.2, VR(-.3, .8), VR(.5, 1), k + (V() * 3 | 0), 1, 2, 0); }
        v.pulse = .6; break;
      case 'spent': burst(x, y, gh, 14, SMOKE, 1.6, DUSTO); break;
    }
  }
  F.view = (dt, evs) => {
    const t0 = performance.now(); T += dt;
    if (ver !== viewVer) syncView();
    for (let i = 0; i < evs.length; i++) if (evs[i].type === 'shrine.use') onUse(evs[i]);
    for (let i = 0; i < VL.length; i++) {
      const v = VL[i], s = v.s, lit = !s.spent || (s.kind === 'mountain' && mountain.on && mountain.s === s);
      v.glow += ((lit ? 1 : 0) - v.glow) * Math.min(1, dt * (lit ? 2.5 : 1.4));
      v.pulse = Math.max(0, v.pulse - dt * 1.6);
      if (s.spent) v.fall = Math.min(1, v.fall + dt * 2.2);
      // idle motes rising round the glyph while it's lit (on screen only)
      if (!s.spent && (v.mote -= dt) <= 0) {
        v.mote = s.busy ? .08 : .35;
        if (host.G.onScreen(s.x, glyphH(s) + (s.z || 0), s.y, 40)) {
          const a = V() * TAU, r = VR(.15, .45), k = palOf[s.kind];
          part(s.x + Math.sin(a) * r, s.y + Math.cos(a) * r * .7, (s.z || 0) + shaped(s).top * VR(.3, 1), VR(-.1, .1), VR(-.1, .1), VR(.35, .8), VR(1, 1.8), k + (V() * 3 | 0), 1, .3, 0);
        }
      }
    }
    stepParts(dt);
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };

  // ---------------------------------------------------------------- draw
  const SPR = {img: null, em: null, sx: 0, sy: 0, sw: 0, sh: 0, px: 0, py: 0, x: 0, y: 0, h: 0, type: 3, shadow: false, alpha: 1, flip: false};
  function spr(name, x, y, h, shadow = false) {
    const f = sheet.fr[name]; if (!f) return;
    const o = SPR; o.img = sheet.img; o.em = sheet.em; o.sx = f.sx; o.sy = f.sy; o.sw = f.sw; o.sh = f.sh; o.px = f.px; o.py = f.py; o.x = x; o.y = y; o.h = h; o.shadow = shadow;
    host.sprite(o);
  }
  const SPENT = Object.fromEntries(KINDS.map(k => [k, k + '_spent']));
  const LIT = Object.fromEntries(KINDS.map(k => [k, k]));
  const TELEC = [rgbOf('#e8d8b0'), rgbOf('#ff6a40'), rgbOf('#ffb040'), rgbOf('#fff4d0')], FLAME = [rgbOf('#fff2c0'), rgbOf('#ffb040'), rgbOf('#ff7a2a')];
  const ring = (x, y, z, r, col, turn, of, on, o = OPT[4]) => {   // the game's telegraph ring (game.js): one point per screen pixel round it
    const n = Math.max(12, Math.round(r * (host.PPM + host.PPMY) * 1.6)), sh = Math.floor(turn * n / TAU);
    for (let i = 0; i < n; i++) { if ((((i + sh) % of) + of) % of >= on) continue; const a = i / n * TAU; host.point(x + Math.sin(a) * r, y + Math.cos(a) * r, z + .03, col, o); }
  };
  const ringR = s => { const S = SHAPE[s.kind]; return (S.r ?? Math.max(S.rect[0], S.rect[1])) + .45; };
  F.frame = ({t}) => {
    if (ver !== viewVer) syncView();
    if (!shrines.length && !np && !tele.length && !mountain.on) return;
    sheet ??= buildArt();
    const pxa = 1 / host.PPMH;
    for (let i = 0; i < VL.length; i++) {
      const v = VL[i], s = v.s;
      // the 3D model (made here, once per shrine: world.mesh, a static caster)
      if (!v.mesh) { models ??= buildModels(); v.mesh = host.world.mesh(models[s.kind], M4([s.x, s.z || 0, s.y], [0, s.yaw, 0]), {occlude: true, static: true}); v.flash = -1; }
      const fl = Math.round(v.pulse * 6) / 20; if (fl !== v.flash) { v.flash = fl; v.mesh.flash = fl; }
      if (!host.G.onScreen(s.x, (s.z || 0) + 1, s.y, 80)) continue;
      const z = s.z || 0, top = shaped(s).top, gh = glyphH(s);
      // the glyph: lit and bobbing; spent, it cracks and slumps down onto the shrine
      const bob = Math.round(Math.sin(T * 1.7 + v.ph) * TUNE.glyphBob) * pxa;
      const lit = !s.spent || (s.kind === 'mountain' && mountain.on && mountain.s === s);
      if (lit) {
        spr(LIT[s.kind], s.x, s.y, z + gh + bob);
        // a faint dotted ring on the ground round it, turning (faster, brighter, the other way while its challenge is on)
        ring(s.x, s.y, z, ringR(s), PAL[palOf[s.kind] + (s.busy ? 1 : 2)], (s.busy ? -.9 : .25) * T + v.ph, s.busy ? 4 : 7, 2, OPT[s.busy ? 5 : 6]);
      }
      else { const k = v.fall * v.fall; spr(SPENT[s.kind], s.x, s.y, z + gh + (top + .22 - gh) * k); }
      if (s.kind === 'exchange') {   // the rift crystal in the gate
        if (!s.spent) spr('crystal', s.x, s.y, z + 1.0 + Math.round(Math.sin(T * 2.3 + v.ph) * 2) * pxa);
        else spr('crystal_dead', s.x, s.y, z + .3 + .7 * (1 - v.fall));
      }
      if (s.kind === 'trader') spr(s.spent ? 'lantern_out' : 'lantern', s.x + LANTERN_AT[0], s.y + LANTERN_AT[2], z + LANTERN_AT[1]);
      if (s.kind === 'blood' && !s.spent) for (let c = 0; c < 2; c++) {   // the candles' flames
        const [cx, ch, cz] = CANDLES[c], f = Math.sin(t * 13 + c * 2.1) > -.2;
        host.point(s.x + cx, s.y + cz, z + ch + .02, FLAME[1], OPT[1]); host.point(s.x + cx, s.y + cz, z + ch + .02 + pxa, f ? FLAME[0] : FLAME[2], OPT[1]);
      }
    }
    // this feature's telegraphs (the director's are the game's to draw): the same closing ring and rising glow
    for (const q of tele) {
      const k = q.t / TELE, col = q.boss ? TELEC[2] : q.elite ? TELEC[1] : TELEC[0];
      ring(q.x, q.y, 0, (q.boss ? 1.3 : q.elite ? .9 : .65) * (1.4 - k * .6), col, t * 1.5, 5, 3);
      if (k > .5) host.point(q.x, q.y, .1 + k * .6, TELEC[3], OPT[12]);
    }
    // the Mountain's champion carries its peak (the run rule's; the sandbox's mountain calls its own)
    const peak = Math.round(Math.sin(T * 2) * 1.5) * pxa;
    if (mountain.on && core) for (const b of core.enemies) if (b.boss) spr('mountain', b.x, b.y, (b.z || 0) + (b.h || 0) + 2.6 + peak);
    for (const s of shrines) if (s.kind === 'mountain' && s.busy) for (const t of s.pack) { const b = t.b; if (b && b.boss && !b.broken) spr('mountain', b.x, b.y, (b.z || 0) + (b.h || 0) + 2.6 + peak); }
    // the particles
    for (let i = 0; i < np; i++) {
      const k = page[i] / plife[i], a = k < .55 ? 0 : k < .7 ? 1 : k < .85 ? 2 : 3;
      host.point(px[i], py[i], ph[i], PAL[pcol[i]], OPT[(pfl[i] & 3) * 4 + a]);
    }
  };
  // the lights: one record a shrine, kept; its glow eases in, swells on a use, dies when it's spent
  const LREC = [], LOUT = [];
  F.lights = () => {
    clearArray(LOUT); let i = 0;
    for (let j = 0; j < VL.length; j++) {
      const v = VL[j], s = v.s;
      if (v.glow < .02) continue;
      const L = shaped(s).light, o = LREC[i] ??= {x: 0, y: 0, h: 0, color: null, radius: 0, intensity: 0, flicker: 0, id: 0};
      const busy = s.busy && s.kind === 'combat' ? .25 * (1 + Math.sin(T * 9)) : 0;
      o.x = s.x; o.y = s.y + .1; o.h = (s.z || 0) + L.h; o.color = L.color; o.radius = L.radius * (1 + .25 * v.pulse); o.intensity = L.intensity * v.glow * (1 + .9 * v.pulse + busy); o.flicker = L.flicker; o.id = 9700 + i;
      LOUT.push(o); i++;
    }
    for (const q of tele) {   // the telegraphs' glow (as the game's)
      const o = LREC[i] ??= {x: 0, y: 0, h: 0, color: null, radius: 0, intensity: 0, flicker: 0, id: 0};
      o.x = q.x; o.y = q.y; o.h = .5; o.color = q.boss ? '#ffb040' : '#ffd8a0'; o.radius = 1.2 + q.t; o.intensity = .6 * q.t / TELE; o.flicker = 0; o.id = 9700 + i;
      LOUT.push(o); i++;
    }
    return LOUT;
  };

  // ---------------------------------------------------------------- HD: the offers, the trader's goods, the rule's icon
  const FONT = '"Segoe UI", system-ui, sans-serif', SC = [0, 0, 0], WT = {w: 700, align: 'center'}, MID = {w: 700, align: 'center'}, LEFT = {w: 700, align: 'left'}, LEFT5 = {w: 500, align: 'left'};
  function text(q, s, x, y, size, col, o = MID) {
    q.font = `${o.w ?? 700} ${Math.round(size)}px ${FONT}`; q.textAlign = o.align ?? 'center'; q.textBaseline = 'alphabetic';
    q.lineJoin = 'round'; q.lineWidth = Math.max(2, size * .22); q.strokeStyle = 'rgba(10,8,12,.9)'; q.strokeText(s, x, y); q.fillStyle = col; q.fillText(s, x, y);
  }
  const tierCol = it => TIER[it.tier].col;
  function card(q, sc, u, s, lines) {   // lines: [[text, colour, size, weight]]: a dark card over the shrine
    host.G.toScreenInto(s.x, (s.z || 0) + glyphH(s) + .45, s.y, SC);
    let w = 0;
    for (let i = 0; i < lines.length; i++) { const [t, , size, wt] = lines[i]; q.font = `${wt ?? 700} ${Math.round(size * u)}px ${FONT}`; w = Math.max(w, q.measureText(t).width); }
    const lh = 17 * u, h = lines.length * lh + 10 * u, x = SC[0] * sc, y = SC[1] * sc - h;
    w += 22 * u;
    q.fillStyle = 'rgba(16,14,20,.88)'; q.fillRect(x - w / 2, y, w, h);
    q.strokeStyle = GLOW[s.kind][1]; q.lineWidth = 1; q.strokeRect(x - w / 2 + .5, y + .5, w - 1, h - 1);
    for (let i = 0; i < lines.length; i++) { const L = lines[i]; WT.w = L[3] ?? 700; text(q, L[0], x, y + 5 * u + (i + .8) * lh, L[2] * u, L[1], WT); }
  }
  const near = (s, r) => hypot2(P.x - s.x, P.y - s.y) < r;
  let MOUNTAIN_SUB = null;
  // what the cards say, made once per offer / item (and per can-afford for the trader), the foe counts once each
  const LINES = new WeakMap(), FOES = Array.from({length: 13}, (_, n) => n === 1 ? '1 foe left' : `${n} foes left`);
  function offerLines(o) {
    let L = LINES.get(o); if (L) return L;
    L = [[`${o.give.glyph}  ${o.give.name}   →   ${o.get.glyph}  ${o.get.name}`, tierCol(o.get), 14], [o.get.desc, '#d8d0c0', 11, 500], [`gives up: ${o.give.desc}`, '#9a937f', 10, 500],
      ['E  accept · walk away to decline', GLOW.exchange[1], 10, 600]];
    LINES.set(o, L); return L;
  }
  function itemLines(s, ok) {
    let L = LINES.get(s); if (!L) LINES.set(s, L = []);
    const it = s.item;
    return L[ok ? 1 : 0] ??= [[`${it.glyph}  ${it.name}`, tierCol(it), 14], [it.desc, '#d8d0c0', 11, 500], [`${TIER[it.tier].name} · ${s.price} gold`, ok ? '#f0c060' : '#e0604a', 11, 600]];
  }
  F.hd = (q, sc) => {
    if (!game || game.mode === 'title') return;
    const u = clamp(sc / 2.6, .7, 2.8);
    for (const s of shrines) {
      if (s.spent) continue;
      if (s.kind === 'exchange' && s.offer && !s.offer.away) card(q, sc, u, s, offerLines(s.offer));
      else if (s.kind === 'trader' && near(s, 3.2)) card(q, sc, u, s, itemLines(s, !!core && core.gold >= s.price));
      else if (s.busy && (s.kind !== 'mountain' || game.mode !== 'run')) {
        host.G.toScreenInto(s.x, (s.z || 0) + glyphH(s) + .5, s.y, SC);
        text(q, FOES[Math.min(12, s.left)], SC[0] * sc, SC[1] * sc, 13 * u, GLOW[s.kind][1]);
      }
    }
    if (mountain.on && game.mode === 'run' && sheet) {   // the run rule's icon (top left), as the build's icons are drawn; under
      // a stage omen's icon when one holds (features/omens.js draws it at the same corner), above the affixes' cards
      const f = sheet.fr.mountain, is = Math.round(30 * u), x = Math.round(20 * u), y = Math.round((host.feature('omens')?.active ? 58 : 20) * u);
      q.fillStyle = 'rgba(16,14,20,.9)'; q.fillRect(x, y, is, is); q.strokeStyle = GLOW.mountain[1]; q.lineWidth = 2; q.strokeRect(x + 1, y + 1, is - 2, is - 2);
      q.imageSmoothingEnabled = false; const k = Math.floor((is - 8) / f.sw);
      q.drawImage(sheet.img, f.sx, f.sy, f.sw, f.sh, x + (is - f.sw * k) / 2, y + (is - f.sh * k) / 2, f.sw * k, f.sh * k);
      q.globalCompositeOperation = 'lighter'; q.drawImage(sheet.em, f.sx, f.sy, f.sw, f.sh, x + (is - f.sw * k) / 2, y + (is - f.sh * k) / 2, f.sw * k, f.sh * k); q.globalCompositeOperation = 'source-over';
      text(q, 'The Mountain', x + is + 8 * u, y + 13 * u, 13 * u, GLOW.mountain[1], LEFT);
      text(q, MOUNTAIN_SUB ??= `champion x${TUNE.mountain.hp} health · +${TUNE.mountain.elites} elite · ${TUNE.mountain.items} items on clear`, x + is + 8 * u, y + 27 * u, 10 * u, '#d8d0c0', LEFT5);
    }
  };

  F.biomeChanged = () => {   // a rebuilt world disposed the meshes it lent us: made again at the next draw
    for (const v of VL) v.mesh = null;
  };
  F._ = {shrines, tele, mountain, TUNE, R, addShrine, placeNear, clearAll, candidates, freeAt, VL, get np() { return np; }};
  return F;
}
