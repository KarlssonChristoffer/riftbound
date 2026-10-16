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
// One module for every system that keeps something per player: each keeps its own part of the record (skill-verbs: xp, n,
// titles, title, caught; the workshop, server/workshop.mjs: made). The workshop touches only rec.made and calls changed().
//   const P = createPlayers({SKILLS, importCap, load, onChange} = {}); P.of(key) -> the record (made the first time a key is
//   seen; null for no key); P.join(key, xp) -> {rec, fresh} (of(key), and the first time, the hello's XP imported, capped);
//   P.get(key); P.grant(rec, skill, n) -> its new total; P.set(rec, skill, n) (a dev server's --dev); P.count(rec, name, n) ->
//   the counter's new total; P.changed(); P.toJSON() (the keyed records: a key-less connection's is dropped with it); P.size
//   a record: {key, xp: {skill: n}, n: {counter: n}, titles: [id], title: id | '', caught: {fish id: n}, t: ms of its last
//   change, made: {uid: made-thing record} (the workshop's), imp: its XP imported yet (not saved)}
//   The key: game/playerkey.js (localStorage rb.player.key, 32 hex), the hello's `key`; KEY_RE tells a real one
import {CURVE, SKILLS as ALL_SKILLS} from '../src/content/skills.js';
const needXP = L => Math.round(CURVE.k * Math.pow(L - 1, CURVE.p));   // (the workshop's copy: skill-verbs' content/skills.js exports it; take theirs on merge)

export const KEY_RE = /^[0-9a-f]{32}$/;

export function createPlayers({SKILLS = ALL_SKILLS, importCap = 10, load = null, onChange = () => {}} = {}) {
  const recs = new Map();
  const blank = key => ({key, xp: Object.fromEntries(Object.keys(SKILLS).map(id => [id, 0])), n: {}, titles: [], title: '', caught: {}, t: Date.now(), made: {}, imp: false});
  const changed = () => onChange();
  function clean(o, key) {   // a loaded record: only the known fields, numbers as numbers
    const r = blank(key);
    for (const id in SKILLS) r.xp[id] = Math.max(0, +o?.xp?.[id] || 0);
    for (const k in o?.n || {}) if (typeof k === 'string' && k.length < 24) r.n[k] = Math.max(0, +o.n[k] || 0);
    if (Array.isArray(o?.titles)) r.titles = o.titles.filter(t => typeof t === 'string' && t.length < 24).slice(0, 64);
    r.title = typeof o?.title === 'string' && r.titles.includes(o.title) ? o.title : '';
    for (const k in o?.caught || {}) if (k.length < 24) r.caught[k] = Math.max(0, +o.caught[k] | 0);
    if (o?.made && typeof o.made === 'object') r.made = o.made;   // (the workshop's records: as written by this server's --data)
    r.t = +o?.t || Date.now(); r.imp = true;
    return r;
  }
  if (load && typeof load === 'object') for (const k in load) if (KEY_RE.test(k)) recs.set(k, clean(load[k], k));

  return {
    get size() { return recs.size; },
    get: key => recs.get(key) || null,
    of(key) {
      if (typeof key !== 'string' || !key) return null;
      let rec = recs.get(key);
      if (!rec) { rec = blank(key); recs.set(key, rec); }
      return rec;
    },
    // a player joins: his record, and the first time the XP his own save brings (each skill held to the import cap's level;
    // a record another system made first with of() still takes it once)
    join(key, xp) {
      const rec = this.of(key);
      if (rec.imp) return {rec, fresh: false};
      const cap = needXP(Math.max(1, importCap | 0));
      for (const id in SKILLS) rec.xp[id] = Math.min(cap, Math.max(0, +xp?.[id] || 0));
      rec.imp = true; changed();
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
    toJSON() { const o = {}; for (const [k, r] of recs) if (KEY_RE.test(k)) { const {imp, ...keep} = r; o[k] = keep; } return o; },
  };
}
