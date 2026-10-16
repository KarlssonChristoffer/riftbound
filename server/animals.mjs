// ANIMALS (the co-op server's part of living-animals.md; docs/FAUNA.md "With friends"): the forest's animals stay each client's
// own look (from the seed); only what someone touches comes here.
//   rope / free   a CLAIM on one animal while it's on someone's rope (features/rope.js): the first to ask has it, until they free
//                 it, leave, or ROPE.claim s pass. Told to everyone as {k: 'ev', a: 'rope' | 'free', id, by, x?, y?, how?}; a late
//                 joiner gets the open claims after its welcome. The holder's client runs the animal (its state message's an)
//   calm          a roe calmed by a player until an hour of the clock: the world map (id 'calm:' + animal + ':' + player), so the
//                 welcome carries it; gone from the map once its hour has passed
//   find          a find without killing (a tuft of hare fur 'fur:' + hare + ':' + day; the antlers and feathers: the next slice):
//                 first finder; the world map ('found'), gone for everyone
// The animals' ids are the plan's (world/fauna.js: 'roe3', 'hare12'); the server doesn't run the animals, so it checks the shape of
// what it's told, not where the animal is.
//   const A = createAnimals({world, all, send, log, now, clock}); A.act(p, a, m, id, deny) -> true when it was one of its acts;
//   A.joined(p) (the open claims to a late joiner), A.left(p), A.tick() (once a second: lapsed claims, past calms)
import {ROPE} from '../src/content/animals.js';
import {num, str} from '../src/net/protocol.js';

export const ANIMAL_ACTS = new Set(['rope', 'free', 'calm', 'find']);
const ID = /^(roe|fox|hare)\d{1,3}$/;
const FIND = /^fur:(hare\d{1,3}):\d{1,6}$/;
const HOW = new Set(['bolt', 'walk', 'calm']);

export function createAnimals({world, all, send, log, now, clock}) {
  const claims = new Map();   // animal id -> {by, t (ms)}
  function act(p, a, m, id, deny) {
    if (!ANIMAL_ACTS.has(a)) return false;
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
  function joined(p) { for (const [id, c] of claims) send(p, {k: 'ev', a: 'rope', id, by: c.by}); }
  function left(p) {
    for (const [id, c] of claims) if (c.by === p.id) { claims.delete(id); all({k: 'ev', a: 'free', id, by: p.id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), how: 'bolt'}); }
  }
  function tick() {
    const t = now(), h = clock();
    for (const [id, c] of claims) if (t - c.t >= ROPE.claim * 1000) { claims.delete(id); all({k: 'ev', a: 'free', id, by: c.by, how: 'bolt'}); }
    for (const [id, e] of world) if (e.s === 'calm' && e.at <= h) world.delete(id);
  }
  // the state message's an (the animal on his rope): [id, x, y, heading, mode], checked; null when it isn't one
  const MODES = new Set(['rope', 'fly', 'tired', 'daze', 'carry']);
  function an(v, p) {
    if (!Array.isArray(v) || v.length !== 5 || !ID.test(str(v[0], 8))) return null;
    const c = claims.get(v[0]); if (!c || c.by !== p.id) return null;
    const x = num(v[1], NaN), y = num(v[2], NaN); if (!(Math.abs(x - p.x) < 30 && Math.abs(y - p.y) < 30)) return null;
    return [v[0], Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(num(v[3]) * 100) / 100, MODES.has(v[4]) ? v[4] : 'rope'];
  }
  return {act, joined, left, tick, an, claims};
}
