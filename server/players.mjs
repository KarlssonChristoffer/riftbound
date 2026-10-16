// PLAYERS: the server's record of each player (docs/SKILLS.md, briefs' depth-shared: one store for every system that keeps
// something per player: skill-verbs' XP, counters and titles; the workshop's made things later). No accounts: the browser
// makes a random key once (localStorage rb.player.key, 16 bytes as hex) and sends it in its hello; a record is found by it.
// Records live in memory while the room runs. The client keeps a copy in its own save (features/pack.js) and sends its XP
// in the hello: a key the room hasn't seen starts from that, each skill capped at the import cap's level (an honest player
// keeps his progress, a doctored save gains little); after that the room never reads the client's XP again. Nothing goes
// on the server's disk unless server.mjs is given --data <dir> (an opt-in dev switch): then it loads the records from
// <dir>/players.json at start and writes them there `delay` s after a change (onChange).
// Kept small and plain so the coming server world store (the cleanup plan's step 2) can take it over whole: a record is
// plain JSON, the store's state is toJSON() / load(o).
//   const P = createPlayers({SKILLS, importCap, load, onChange}); P.join(key, xp) -> {rec, fresh}; P.get(key); P.grant(rec,
//   skill, n) -> its new total; P.set(rec, skill, n) (a dev server's --dev); P.count(rec, name, n) -> the counter's new total;
//   P.changed(); P.toJSON() (the keyed records: a key-less connection's is dropped with it); P.size
//   a record: {key, xp: {skill: n}, n: {counter: n}, titles: [id], title: id | '', caught: {fish id: n}, t: ms of its last change}
import {needXP} from '../src/content/skills.js';

export const KEY_RE = /^[0-9a-f]{32}$/;

export function createPlayers({SKILLS, importCap = 10, load = null, onChange = () => {}}) {
  const recs = new Map();
  const blank = key => ({key, xp: Object.fromEntries(Object.keys(SKILLS).map(id => [id, 0])), n: {}, titles: [], title: '', caught: {}, t: Date.now()});
  const changed = () => onChange();
  function clean(o, key) {   // a loaded record: only the known fields, numbers as numbers
    const r = blank(key);
    for (const id in SKILLS) r.xp[id] = Math.max(0, +o?.xp?.[id] || 0);
    for (const k in o?.n || {}) if (typeof k === 'string' && k.length < 24) r.n[k] = Math.max(0, +o.n[k] || 0);
    if (Array.isArray(o?.titles)) r.titles = o.titles.filter(t => typeof t === 'string' && t.length < 24).slice(0, 64);
    r.title = typeof o?.title === 'string' && r.titles.includes(o.title) ? o.title : '';
    for (const k in o?.caught || {}) if (k.length < 24) r.caught[k] = Math.max(0, +o.caught[k] | 0);
    r.t = +o?.t || Date.now();
    return r;
  }
  if (load && typeof load === 'object') for (const k in load) if (KEY_RE.test(k)) recs.set(k, clean(load[k], k));

  return {
    get size() { return recs.size; },
    get: key => recs.get(key) || null,
    // a player joins: his record, or a new one from the XP his own save brings (each skill held to the import cap's level)
    join(key, xp) {
      let rec = recs.get(key);
      if (rec) return {rec, fresh: false};
      rec = blank(key);
      const cap = needXP(Math.max(1, importCap | 0));
      for (const id in SKILLS) rec.xp[id] = Math.min(cap, Math.max(0, +xp?.[id] || 0));
      recs.set(key, rec); changed();
      return {rec, fresh: true};
    },
    grant(rec, id, n) {
      if (!rec || !(id in rec.xp) || !(n > 0)) return rec?.xp[id] ?? 0;
      rec.xp[id] = Math.round((rec.xp[id] + n) * 1000) / 1000; rec.t = Date.now(); changed();
      return rec.xp[id];
    },
    set(rec, id, n) { if (!rec || !(id in rec.xp)) return 0; rec.xp[id] = Math.max(0, +n || 0); rec.t = Date.now(); changed(); return rec.xp[id]; },
    count(rec, name, n = 1) {
      if (!rec) return 0;
      rec.n[name] = Math.round(((rec.n[name] || 0) + n) * 1000) / 1000; rec.t = Date.now(); changed();
      return rec.n[name];
    },
    changed,
    toJSON() { const o = {}; for (const [k, r] of recs) if (KEY_RE.test(k)) o[k] = r; return o; },
  };
}
