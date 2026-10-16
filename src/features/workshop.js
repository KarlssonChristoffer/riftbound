// WORKSHOP (docs/WORKSHOP.md): what ore and logs become, and what a made thing remembers. The rules and the numbers are
// content/workshop.js (the co-op server reads the same file: server/workshop.mjs).
//   RECORDS  every made thing has one: {u, item, maker, day, haft, inlay, hand, counts, marks} (content/workshop.js). A made
//            tool sits in the bag in a slot of its own carrying its uid (game/inventory.js: pack.giveMade). Offline they are
//            minted here; online the server mints them (act 'make' -> {k: 'made', rec}: the pouch pays when it hears it) and
//            this save keeps a copy, which the hello carries back (features/coop.js: records()). What the tool in hand does is
//            counted into its record: a felled tree (an old oak too), a broken vein (an iron one too); offline here from
//            tree.fell / mine.spent, online by the server from the uid on the 'fell' / 'mine' act (coop.tag), its counts
//            coming back as {k: 'rec'}. Hovering a made thing's bag slot shows its card (ui/madetip.js: pack.slotTip)
// OWNS: the records (pack.store('workshop'): {n, made: {u: record}}), the made-thing card's wiring. READS: pack (the bag, the
//   store), coop (online, act, mail, tag), host.env (the day), content/woodcut.js TREES (an old oak).
// EMITS: smith.make. BUDGET: sim: the events of a step looked at (two kinds), the mail; nothing per frame.
import {ITEMS} from '../content/items.js';
import {TREES} from '../content/woodcut.js';
import {SMITH, HAND, MAX_RECS, cleanRec, mintRec, countOn, smithCost} from '../content/workshop.js';
import {madeTip} from '../ui/madetip.js';
import {flags} from '../core/flags.js';

const ON = flags.get('workshop') !== '0' && flags.get('pack') !== '0';

// ORDER (core/features.js): after the pack (the bag it gives into) and the builds (the furnaces and anvils are builds); it reads
// co-op's mail a step after it came (coop is later in the order), like the builds and the mining
export const order = {after: ['pack', 'builds']};

export async function create(host) {
  const pack = () => host.feature('pack'), coop = () => host.feature('coop'), game = () => host.feature('game'), ui = () => game()?.ui || null;
  const online = () => !!coop()?.online;
  const store = () => { const s = pack()?.store('workshop'); if (s) { s.n ??= 0; s.made ??= {}; } return s; };
  const day = () => (host.env?.day ?? 0) + 1;
  // the maker's name: the co-op name (?name= or the one saved), else none ("Forged by your hand")
  const myName = () => { let n = flags.get('name') || ''; try { n ||= localStorage.getItem('rb.coop.name') || ''; } catch {} return n.replace(/[^\w .'-]/g, '').slice(0, 20); };
  let ver = 0;

  // ---------------------------------------------------------------- records
  const recOf = u => (u && store()?.made[u]) || null;
  function keep(r) {   // a record into the save (a newer copy of one replaces it)
    const s = store(); if (!s || !r) return null;
    s.made[r.u] = r; pack()?.dirty(); ver++;
    return r;
  }
  // a made thing is his: a tool into the bag (its slot carries the uid); a cost paid unless it is the dev's
  function receive(r, pay, at = null) {
    if (pay) for (const [k, n] of Object.entries(costOf(r))) pack()?.take(k, n);
    if (ITEMS[r.item]?.made) pack()?.giveMade(r.item, r.u, at || {x: host.player.x, y: host.player.y, h: 1.8});
    host.events.push({type: 'smith.make', x: host.player.x, y: host.player.y, item: r.item, u: r.u, hand: !!r.hand});
  }
  const costOf = r => r.hand ? HAND[r.item]?.cost || {} : smithCost(r.item, r.haft, r.inlay) || {};
  // making something: offline minted here at once; online asked of the server (the record comes back in the mail)
  //   r: a recipe (content/workshop.js SMITH or HAND), at: the anvil's build id ('' by hand), dev: no anvil, nothing paid
  function make(r, haft = '', inlay = false, at = '', dev = false) {
    const S = SMITH[r], Hd = HAND[r]; if (!S && !Hd) return false;
    if (online()) return coop().act('make', at, {r, haft, inlay: inlay ? 1 : 0, ...(dev ? {dev: 1} : {})});
    const s = store(); if (!s) return false;
    const u = 'o' + (++s.n).toString(36) + '.' + Date.now().toString(36).slice(-5);
    receive(keep(mintRec(u, S ? S.item || S.gear : Hd.gear, myName(), day(), haft, !!S?.haft && inlay, !!Hd)), !dev);
    return true;
  }
  // a count on the tool in hand's record (offline: online the server counts)
  function counted(job, ks) {
    const b = pack()?.best(job), r = recOf(b?.u); if (!r) return;
    let ch = false; for (const k of ks) ch = countOn(r, k, day()) || ch;
    if (ch) { pack()?.dirty(); ver++; }
  }
  const oldOak = (species, scale) => !!TREES[species]?.old && scale >= TREES[species].old;

  // co-op: the server's word on a record ({k: 'made', rec, dev?, late?}: one minted for him, or his records in the welcome;
  // {k: 'rec', u, counts, marks}: what his tool has done since)
  function mail(m) {
    if (m.k === 'made') {
      const r = cleanRec(m.rec); if (!r) return;
      keep(r);
      if (!m.late) receive(r, m.dev !== 1);
    } else if (m.k === 'rec') {
      const r = recOf(m.u); if (!r) return;
      const c = cleanRec({...r, counts: m.counts, marks: m.marks}); if (!c) return;
      r.counts = c.counts; r.marks = c.marks; pack()?.dirty(); ver++;
    }
  }

  let wired = false;
  function wire() {   // once the pack and co-op are there: the card over a made thing's slot, the uid on an act
    wired = true;
    const pk = pack(), tip = madeTip();
    pk.slotTip({show(slot, e) { const r = recOf(pk.inv.bag[slot]?.u); if (r) tip.show(r, e); else tip.hide(); }, move: e => tip.move(e), hide: () => tip.hide()});
    const c = coop();
    c?.tag?.('fell', p => { const ps = host.itemOf?.(p)?.pose; return {u: pk.best('chop')?.u || '', old: ps && oldOak(ps.species, ps.scale || 1) ? 1 : 0}; });
    c?.tag?.('mine', () => ({u: pk.best('mine')?.u || ''}));
  }

  const F = {
    name: 'workshop', label: 'Workshop', on: ON,
    get ver() { return ver; },
    recOf, make,
    // the records the hello carries (features/coop.js: the save's copy; the newest MAX_RECS)
    records() { const s = store(); return s ? Object.values(s.made).slice(-MAX_RECS) : []; },
    update(dt, evs) {
      if (!ON || !pack()) return;
      if (!wired) wire();
      const ol = online();
      if (!ol) for (let k = 0; k < evs.length; k++) {
        const e = evs[k];
        if (e.type === 'tree.fell') counted('chop', oldOak(e.species, e.scale) ? ['fell', 'oldoak'] : ['fell']);
        else if (e.type === 'mine.spent' && e.n > 0) counted('mine', e.kind === 'iron' ? ['veins', 'iron'] : ['veins']);
      }
      const c = coop(); if (ol && c.mail) for (let k = 0; k < c.mail.length; k++) { const m = c.mail[k]; if (m.k === 'made' || m.k === 'rec') mail(m); }
    },
    menu() {
      if (!ON || game()?.mode !== 'sandbox') return [];
      return [{label: 'Workshop: a test Iron Axe with a birch haft (made by you, now)', run: () => make('iron_axe', 'birch_log', false, '', true)}];
    },
    hud: () => { const s = store(); return ON && s ? `workshop ${Object.keys(s.made).length} made` : ''; },
  };
  return F;
}
