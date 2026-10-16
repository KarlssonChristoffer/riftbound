// THE WORKSHOP's server side (docs/WORKSHOP.md; the rules: src/content/workshop.js, the same file the game runs offline). In a
// room the server is the authority for every MADE THING's record (who made it, of what, what it has done since): it mints the
// record when a player makes something (act 'make': the client pays its pouch when it hears {k: 'made', rec}), counts what
// the tool did into it ('fell' and 'mine' carry the tool's uid: room.mjs calls count) and sends the counts back to its owner at
// most every FLUSH s ({k: 'rec', u, counts, marks}). A player's records are kept by the browser's key (server/players.mjs): a
// hello brings the save's copy (at most MAX_RECS, unknown items dropped; the server's own win), the welcome gives them back.
//   const ws = createWorkshop({world, peers, all, log, clock, players}); ws.ACTS (the acts it takes); ws.hello(p, m) -> the
//   records for the welcome; ws.act(p, a, m, id, deny); ws.count(p, u, ks); ws.tick(dt) (each server tick)
// OWNS: the made records' minting and counting. READS: content/workshop.js, the room's world (the anvils: builds of kind anvil).
import {SMITH, HAND, WOODS, REACH, MAX_RECS, cleanRec, mintRec, countOn} from '../src/content/workshop.js';
import {encode, str} from '../src/net/protocol.js';

const FLUSH = 2;   // s between a record's count and its owner hearing it

export function createWorkshop({world, peers, all, log = () => {}, clock, players}) {
  const send = (p, m) => p.conn.send(encode(m));
  const day = () => Math.floor(clock() / 24) + 1;
  let nextU = 1, flushT = 0;
  const dirty = new Map();   // record -> its owner's key (counted since the last flush)

  // a player's records: the server's by key; the hello's copy fills in the ones it doesn't have
  function hello(p, m) {
    p.rec = players.of(str(m.key, 48)) || players.of('#' + p.id);
    const list = Array.isArray(m.made) ? m.made.slice(0, MAX_RECS) : [];
    for (const o of list) { const r = cleanRec(o); if (r && !p.rec.made.has(r.u)) p.rec.made.set(r.u, r); }
    return [...p.rec.made.values()];
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
  function act(p, a, m, id, deny) {
    if (a === 'make') return make(p, m, id, deny);
    return deny('unknown act');
  }
  function tick(dt) {
    if ((flushT += dt) < FLUSH || !dirty.size) return;
    flushT = 0;
    for (const [r, key] of dirty) for (const q of peers.values()) if (q.rec?.key === key) send(q, {k: 'rec', u: r.u, counts: r.counts, marks: r.marks});
    dirty.clear();
  }
  return {ACTS: new Set(['make']), hello, act, count, tick};
}
