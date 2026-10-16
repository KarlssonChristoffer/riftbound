// THE WORKSHOP's server side (docs/WORKSHOP.md; the rules: src/content/workshop.js, the same file the game runs offline). In a
// room the server is the authority for every MADE THING's record (who made it, of what, what it has done since): it mints the
// record when a player makes something (act 'make': the client pays its pouch when it hears {k: 'made', rec}), counts what
// the tool did into it ('fell' and 'mine' carry the tool's uid: room.mjs calls count) and sends the counts back to its owner at
// most every FLUSH s ({k: 'rec', u, counts, marks}). A player's records are kept by the browser's key (server/players.mjs): a
// hello brings the save's copy (at most MAX_RECS, unknown items dropped; the server's own win), the welcome gives them back.
// And THE FURNACES: a Clay Furnace is a build (room.mjs act 'build': content/builds.js furnace); its heat, charge, bellows and the
// bars on its stone ride on its world entry (heat, ch {ore, by, prog}, bel, bars [{n, bar, by}]: a late joiner has them in the
// welcome). 'load' {id, ore} puts a charge in (the ore is the client's: it pays when it hears 'loaded'), 'pump' {id, pow} (1, or
// 1.5 on a rhythm press; at most one a player a furnace per .8 x PUMP.every s) heats it, 'fit' {id} fits a bellows, 'take' {id,
// n} gives the loader his bar. STEPS times a second the furnaces holding heat or a charge are stepped (the same rules the game
// runs offline: content/workshop.js heatStep) and {k: 'smith', id, s: 'heat', heat, prog} goes out on a change of .05 or more
// (fuel, t0 with it when white heat ate its wood); a charge done: {s: 'smelted', n, bar, by}.
// And FIRE-SETTING: once a second, an iron vein (the cave's plan: veins) with a burning fire build within FIRESET.r m for
// FIRESET.t s is cracked for FIRESET.hours in-game hours: a world entry 'k' + its index ({s: 'cracked', at}: the room's regrow
// tick closes it again, s 'grown'); room.mjs mine() asks cracked(id): one tier less, one chunk more.
//   const ws = createWorkshop({world, peers, all, log, clock, secs, players, heat, smelt}); ws.ACTS (the acts it takes);
//   ws.hello(p, m) -> the records for the welcome; ws.act(p, a, m, id, deny); ws.count(p, u, ks); ws.tick(dt) (each server tick);
//   ws.cracked('v' + i) -> bool; ws.owns(p, gearId) -> bool (the wear check, room.mjs: the free kinds, the clothes his records
//   are of; every piece with wardrobe: --wardrobe)
// OWNS: the made records' minting and counting, the furnaces' state on their entries. READS: content/workshop.js,
//   content/builds.js (a fire's fuel), the room's world (the furnaces and anvils: builds of their kinds).
import {SMITH, HAND, WOODS, REACH, MAX_RECS, HEAT, PUMP, CHARGES, FIRESET, heatStep, pumpAdd, cleanRec, mintRec, countOn} from '../src/content/workshop.js';
import {BUILDS, fuelAt} from '../src/content/builds.js';
import {encode, num, str} from '../src/net/protocol.js';
import {GEAR_BY_ID, freePiece} from '../src/content/gear.js';

const FLUSH = 2;   // s between a record's count and its owner hearing it
const STEPS = 4;   // the furnaces' steps a second

export function createWorkshop({world, peers, all, log = () => {}, clock, secs = () => Date.now() / 1000, players, veins = null, heat = 1, smelt = 1, wardrobe = false}) {
  const send = (p, m) => p.conn.send(encode(m));
  const day = () => Math.floor(clock() / 24) + 1;
  let nextU = 1, flushT = 0;
  const dirty = new Map();   // record -> its owner's key (counted since the last flush)

  // a player's records (p.rec: server/players.mjs, joined by room.mjs from the hello's key): the server's; the hello's copy
  // fills in the ones it doesn't have
  function hello(p, m) {
    p.rec ??= players.of('#' + p.id);
    const M = p.rec.made, list = Array.isArray(m.made) ? m.made.slice(0, MAX_RECS) : [];
    for (const o of list) { const r = cleanRec(o); if (r && !M.has(r.u)) M.set(r.u, r); }
    return [...M.values()];
  }
  // what the tool in hand did (room.mjs: a felled tree ['fell'] or ['fell', 'oldoak'], a broken vein ['veins'] or ['veins', 'iron'])
  function count(p, u, ks) {
    const r = typeof u === 'string' && u ? p?.rec?.made.get(u) : null; if (!r) return;
    for (const k of ks) countOn(r, k, day());
    dirty.set(r, p.rec.key);
  }
  // MAKING: a thing off the anvil ({a: 'make', id: the anvil's build id, r: content/workshop.js SMITH, haft: a log id, inlay: 1})
  // or by hand (r: HAND; id ''); dev: 1 skips the anvil (the Sandbox menu's test tool). The pouch is the client's: it pays when
  // it hears the record
  function make(p, m, id, deny) {
    const r = str(m.r, 24), S = SMITH[r], Hd = HAND[r], dev = m.dev === 1;
    if (!S && !Hd) return deny('no such thing');
    if (S && !dev) {
      const e = world.get(id); if (!e || e.s !== 'built' || e.kind !== 'anvil') return deny('no anvil');
      if (Math.hypot(e.x - p.x, e.y - p.y) > REACH.server) return deny('too far');
    }
    const haft = S?.haft ? str(m.haft, 16) : ''; if (S?.haft && !WOODS[haft]) return deny('no haft');
    const u = 's' + Date.now().toString(36) + (nextU++).toString(36);
    const rec = mintRec(u, S ? S.item || S.gear : Hd.gear, p.name, day(), haft, !!S?.haft && m.inlay === 1, !!Hd);
    p.rec.made.set(u, rec);
    send(p, {k: 'made', rec, ...(dev ? {dev: 1} : {})});
    log(`  ${p.name} made a ${rec.item}${haft ? ' (' + WOODS[haft].name + ' haft)' : ''}`);
  }
  // THE FURNACES
  const furnace = (id, p, deny) => {
    const e = world.get(id); if (!e || e.s !== 'built' || e.kind !== 'furnace') { deny('no such furnace'); return null; }
    if (Math.hypot(e.x - p.x, e.y - p.y) > REACH.server) { deny('too far'); return null; }
    e.heat ??= 0; e.bars ??= []; e.bn ??= 0; return e;
  };
  const sent = new Map();   // furnace id -> {h, p, fuelT} last told
  const pumpT = new Map();  // player id + furnace id -> when he last pumped it (s)
  function tell(id, e) {
    const o = sent.get(id) || {h: -1, p: -1}; o.h = e.heat; o.p = e.ch?.prog ?? -1; sent.set(id, o);
    const m = {k: 'smith', id, s: 'heat', heat: +e.heat.toFixed(3), prog: e.ch ? +e.ch.prog.toFixed(3) : 0};
    if (e.burnt) { m.fuel = e.fuel; m.t0 = e.t0; e.burnt = false; }
    all(m);
  }
  function furnaceAct(p, a, m, id, deny) {
    const e = furnace(id, p, deny); if (!e) return;
    if (a === 'load') {
      const ore = str(m.ore, 12), C = CHARGES[ore]; if (!C) return deny('no such ore');
      if (e.ch) return deny('full');
      e.ch = {ore, by: p.id, prog: 0};
      all({k: 'smith', id, s: 'loaded', ore, by: p.id}); log(`  ${p.name} loaded ${ore} into ${id}`); return;
    }
    if (a === 'fit') {
      if (e.bel) return deny('fitted');
      e.bel = true; all({k: 'smith', id, s: 'fit', by: p.id}); return;
    }
    if (a === 'pump') {
      const t = secs(), k = p.id + ':' + id; if (t - (pumpT.get(k) ?? -9) < PUMP.every * .8) return;   // (too quick: dropped)
      pumpT.set(k, t);
      if (!(fuelAt(e, t) > 0)) return deny('cold');
      const rhythm = num(m.pow, 1) > 1;
      e.heat = Math.min(1, e.heat + Math.min(PUMP.most, pumpAdd(!!e.bel, rhythm) * heat));
      others(p, {k: 'smith', id, s: 'pumped', by: p.id, rhythm: rhythm ? 1 : 0}); tell(id, e); return;
    }
    if (a === 'take') {
      const n = num(m.n, -1), i = e.bars.findIndex(b => b.n === n); if (i < 0) return deny('gone');
      if (e.bars[i].by !== p.id) return deny('not yours');
      e.bars.splice(i, 1); all({k: 'smith', id, s: 'taken', n, by: p.id});
    }
  }
  let stepT = 0;
  function stepFurnaces(dt) {
    const t = secs();
    for (const [id, e] of world) {
      if (e.s !== 'built' || e.kind !== 'furnace') continue;
      const lit = fuelAt(e, t) > 0; if (!lit && !(e.heat > 0) && !e.ch) continue;
      e.heat = heatStep(e.heat || 0, dt, lit);
      if (lit && e.heat > HEAT.white) { e.fuel = +Math.max(0, e.fuel - dt).toFixed(2); e.burnt = true; }   // (white heat: twice the wood)
      if (e.ch) {
        const C = CHARGES[e.ch.ore];
        if (e.heat >= C.heat) e.ch.prog = Math.min(1, e.ch.prog + dt / (C.t * smelt));
        if (e.ch.prog >= 1) {
          e.bars ??= []; e.bn = (e.bn || 0) + 1; e.bars.push({n: e.bn, bar: C.bar, by: e.ch.by});
          all({k: 'smith', id, s: 'smelted', n: e.bn, bar: C.bar, by: e.ch.by}); e.ch = null; tell(id, e); continue;
        }
      }
      const o = sent.get(id);
      if (!o || Math.abs(o.h - e.heat) >= .05 || (e.ch && Math.abs(o.p - e.ch.prog) >= .05) || (e.heat === 0 && o.h > 0)) tell(id, e);
    }
  }
  const others = (p, m) => { const t = encode(m); for (const q of peers.values()) if (q !== p) q.conn.send(t); };

  // FIRE-SETTING (the iron veins only: the others are soft enough already)
  const IRON = (veins || []).map((v, i) => v.kind === 'iron' ? i : -1).filter(i => i >= 0);
  const heatT = new Map(), fires = [];   // vein -> s a fire has burnt by it; the burning fire builds (refilled each check)
  let crackT = 0;
  function crackTick() {
    const t = secs(); fires.length = 0;
    for (const e of world.values()) if (e.s === 'built' && BUILDS[e.kind]?.fire && fuelAt(e, t) > 0) fires.push(e);
    for (const i of IRON) {
      const v = veins[i], id = 'k' + i; if (world.get(id)?.s === 'cracked') continue;
      let near = false; for (const e of fires) if (Math.hypot(e.x - v.x, e.y - v.y) < FIRESET.r) { near = true; break; }
      if (!near) { heatT.delete(i); continue; }
      const s = (heatT.get(i) || 0) + 1; heatT.set(i, s);
      if (s < FIRESET.t) continue;
      heatT.delete(i); const at = +(clock() + FIRESET.hours).toFixed(4);
      world.set(id, {s: 'cracked', at}); all({k: 'world', id, s: 'cracked', at}); log(`  the iron vein ${i} cracked in the fire`);
    }
  }

  function act(p, a, m, id, deny) {
    if (a === 'make') return make(p, m, id, deny);
    if (a === 'load' || a === 'pump' || a === 'fit' || a === 'take') return furnaceAct(p, a, m, id, deny);
    return deny('unknown act');
  }
  function tick(dt) {
    if ((stepT += dt) >= 1 / STEPS) { stepFurnaces(stepT); stepT = 0; }
    if (IRON.length && (crackT += dt) >= 1) { crackT = 0; crackTick(); }
    if ((flushT += dt) < FLUSH || !dirty.size) return;
    flushT = 0;
    for (const [r, key] of dirty) for (const q of peers.values()) if (q.rec?.key === key) send(q, {k: 'rec', u: r.u, counts: r.counts, marks: r.marks});
    dirty.clear();
  }
  // CLOTHES: what a player may wear (room.mjs wear): a free piece, one his records are of, or anything with --wardrobe
  function owns(p, id) {
    if (wardrobe || freePiece(GEAR_BY_ID[id])) return true;
    if (p?.rec) for (const r of p.rec.made.values()) if (r.item === id) return true;
    return false;
  }
  return {ACTS: new Set(['make', 'load', 'pump', 'fit', 'take']), hello, act, count, tick, owns, cracked: id => world.get('k' + String(id).slice(1))?.s === 'cracked'};
}
