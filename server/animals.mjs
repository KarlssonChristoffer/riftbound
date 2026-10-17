// ANIMALS (the co-op server's part of living-animals.md; docs/FAUNA.md "With friends"): the forest's animals stay each client's
// own look (from the seed); only what someone touches comes here.
//   rope / free   a CLAIM on one animal while it's on someone's rope (features/rope.js): the first to ask has it, until they free
//                 it, leave, or ROPE.claim s pass. Told to everyone as {k: 'ev', a: 'rope' | 'free', id, by, x?, y?, how?}; a late
//                 joiner gets the open claims after its welcome. The holder's client runs the animal (its state message's an)
//   calm          a roe calmed by a player until an hour of the clock: the world map (id 'calm:' + animal + ':' + player), so the
//                 welcome carries it; gone from the map once its hour has passed
//   find          a find without killing: a tuft of hare fur 'fur:' + hare + ':' + day, a shed antler 'antler:' + buck + ':' + year
//                 + ':' + n, a feather 'feather:' + cock + ':' + day + ':' + n (or m: the moult's), the lek's bonus 'lek:' + cock + ':'
//                 + day (world/fauna.js antlersOf / feathersOf; features/animalfinds.js): first finder; the world map ('found'),
//                 gone for everyone
// The animals' ids are the plan's (world/fauna.js: 'roe3', 'hare12'); the server doesn't run the animals, so it checks the shape of
// what it's told, not where the animal is.
// THE THIEVING FOX (sim/foxden.js, the rules the game runs offline too; features/foxden.js): with the fauna plan (plan) the server
// runs them for everyone on its clock:
//   leave         a pouch item put down (id: its kind; m.x, m.y in reach); at most GROUND.most each
//   take          one taken up (id 'g' + n): first taker; {k: 'ev', a: 'took', id, by, kind, x, y}
//   den           reaching in at a fox's den (id: the fox) within reach of its mouth: all of it; {k: 'ev', a: 'den', fox, by, things}
//   drop          the lasso on a fox on its run (id: the fox; m.x, m.y where it was): what it carries lands there
//   the rules' step once a second (the burning fires: fires(); people who moved since the last); on every change the whole
//   state goes to everyone ({k: 'ev', a: 'foxden', s}) and to a late joiner after its welcome
//   const A = createAnimals({world, all, send, log, now, clock, plan, fires, players, thief}); A.act(p, a, m, id, deny) -> true
//   when it was one of its acts; A.joined(p) (the open claims, the fox's state to a late joiner), A.left(p), A.tick() (once a
//   second: lapsed claims, past calms, the fox)
import {ROPE, GROUND} from '../src/content/animals.js';
import {num, str} from '../src/net/protocol.js';
import {createFoxden} from '../src/sim/foxden.js';

export const ANIMAL_ACTS = new Set(['rope', 'free', 'calm', 'find', 'leave', 'take', 'den', 'drop']);
const ID = /^(roe|fox|hare)\d{1,3}$/;
const FIND = /^(fur:hare\d{1,3}:\d{1,6}|antler:roe\d{1,3}:-?\d{1,4}:\d|feather:capercaillie\d{1,3}:\d{1,6}:(\d|m)|lek:capercaillie\d{1,3}:\d{1,6})$/;
const HOW = new Set(['bolt', 'walk', 'calm']);

export function createAnimals({world, all, send, log, now, clock, plan = null, fires = () => [], players = () => [], thief = ''}) {
  const claims = new Map();   // animal id -> {by, t (ms)}
  const fox = plan ? createFoxden(plan, {often: thief === 'often', day0: Math.floor(clock() / 24)}) : null;
  const foxState = () => ({k: 'ev', a: 'foxden', s: fox.toJSON()});
  const KIND = /^[a-z][a-z0-9_]{1,31}$/;
  function foxAct(p, a, m, id, deny) {
    if (!fox) { deny('no fox here'); return true; }
    const t = clock(), reach = GROUND.reach + 1.5;
    if (a === 'leave') {
      if (!KIND.test(id)) { deny('no such thing'); return true; }
      const x = num(m.x, NaN), y = num(m.y, NaN); if (!(Math.hypot(x - p.x, y - p.y) < reach)) { deny('too far'); return true; }
      const it = fox.leave(p.id, id, x, y, t, null, p.name); if (typeof it === 'string') { deny(it); return true; }
    } else if (a === 'take') {
      const it = fox.ground.get(id); if (!it) { deny('gone'); return true; }
      if (Math.hypot(it.x - p.x, it.y - p.y) > reach) { deny('too far'); return true; }
      fox.take(id); all({k: 'ev', a: 'took', id, by: p.id, kind: it.kind, x: it.x, y: it.y});
    } else if (a === 'den') {
      const d = fox.dens.find(q => q.fox === id); if (!d) { deny('no such den'); return true; }
      if (Math.hypot(d.mx - p.x, d.my - p.y) > 3) { deny('too far'); return true; }
      const things = fox.reach(id) || []; all({k: 'ev', a: 'den', fox: id, by: p.id, things});
      log(`  ${p.name} reached into ${id}'s den: ${things.map(q => q.kind).join(', ') || 'nothing'}`);
    } else {   // drop
      const x = num(m.x, NaN), y = num(m.y, NaN); if (!(Math.hypot(x - p.x, y - p.y) < 30)) { deny('too far'); return true; }
      if (!fox.drop(id, x, y, t)) return true;
    }
    all(foxState());
    return true;
  }
  const moved = new Map(), MOVERS = [];
  function act(p, a, m, id, deny) {
    if (!ANIMAL_ACTS.has(a)) return false;
    if (a === 'leave' || a === 'take' || a === 'den' || a === 'drop') return foxAct(p, a, m, id, deny);
    const t = now();
    if (a === 'rope') {
      if (!ID.test(id)) { deny('no such animal'); return true; }
      const c = claims.get(id);
      if (c && c.by !== p.id && t - c.t < ROPE.claim * 1000) { deny('held'); return true; }
      claims.set(id, {by: p.id, t});
      all({k: 'ev', a: 'rope', id, by: p.id});
      return true;
    }
    if (a === 'free') {
      const c = claims.get(id); if (!c || c.by !== p.id) return true;   // (not theirs, or lapsed: nothing to say)
      claims.delete(id);
      const how = HOW.has(str(m.how, 8)) ? m.how : 'bolt';
      all({k: 'ev', a: 'free', id, by: p.id, x: +num(m.x, p.x).toFixed(2), y: +num(m.y, p.y).toFixed(2), how});
      return true;
    }
    if (a === 'calm') {
      if (!/^roe\d{1,3}$/.test(id)) { deny('no such deer'); return true; }
      const h = clock(), at = Math.min(num(m.at, h), (Math.floor(h / 24) + 1) * 24);   // (at most to the day's end)
      const key = `calm:${id}:${p.id}`, s = {s: 'calm', by: p.id, t, at};
      world.set(key, s);
      all({k: 'world', id: key, s: 'calm', by: p.id, at});
      return true;
    }
    // find
    if (!FIND.test(id)) { deny('no such find'); return true; }
    if (world.has(id)) { deny('found'); return true; }
    world.set(id, {s: 'found', by: p.id, t});
    all({k: 'world', id, s: 'found', by: p.id});
    log(`  ${p.name} found ${id}`);
    return true;
  }
  function joined(p) { for (const [id, c] of claims) send(p, {k: 'ev', a: 'rope', id, by: c.by}); if (fox) send(p, foxState()); }
  function left(p) {
    for (const [id, c] of claims) if (c.by === p.id) { claims.delete(id); all({k: 'ev', a: 'free', id, by: p.id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), how: 'bolt'}); }
  }
  function tick() {
    const t = now(), h = clock();
    for (const [id, c] of claims) if (t - c.t >= ROPE.claim * 1000) { claims.delete(id); all({k: 'ev', a: 'free', id, by: c.by, how: 'bolt'}); }
    for (const [id, e] of world) if (e.s === 'calm' && e.at <= h) world.delete(id);
    if (fox) {   // the fox: the people who moved in the last second put it off (THEFT.watch), the burning fires (THEFT.fire)
      MOVERS.length = 0;
      for (const q of players()) { const o = moved.get(q.id); if (o && Math.hypot(q.x - o.x, q.y - o.y) > .3) MOVERS.push(q); if (o) { o.x = q.x; o.y = q.y; } else moved.set(q.id, {x: q.x, y: q.y}); }
      const ev = fox.step(h, fires(), MOVERS);
      if (ev.length) { for (const e of ev) if (e.a === 'theft') log(`  a fox (${e.run.fox}) came for ${e.run.item.kind}`); all(foxState()); }
    }
  }
  // the state message's an (the animal on his rope): [id, x, y, heading, mode], checked; null when it isn't one
  const MODES = new Set(['rope', 'fly', 'tired', 'daze', 'carry']);
  function an(v, p) {
    if (!Array.isArray(v) || v.length !== 5 || !ID.test(str(v[0], 8))) return null;
    const c = claims.get(v[0]); if (!c || c.by !== p.id) return null;
    const x = num(v[1], NaN), y = num(v[2], NaN); if (!(Math.abs(x - p.x) < 30 && Math.abs(y - p.y) < 30)) return null;
    return [v[0], Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(num(v[3]) * 100) / 100, MODES.has(v[4]) ? v[4] : 'rope'];
  }
  return {act, joined, left, tick, an, claims, fox};
}
