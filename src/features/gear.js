// GEAR (docs/GEAR.md): what the player wears. A piece goes in one of five slots (head, body, back, legs, feet:
// content/gear.js), changes how he looks (the live body is drawn dressed: view/dress.js through host.dressPlayer) and what
// he can do: its weight past a free allowance slows him, its armor takes a share off the damage he takes, and a piece may
// bring a modifier of its own (the miner's lamp cap lights his lantern). Tab opens the gear panel (ui/gearpanel.js).
// No inventory yet: every piece is there to try on (the sandbox's wardrobe), except the KEEPSAKES (slot 'charm', two of them:
// content/gear.js SLOT_CAP; docs/KEEPSAKES.md): one is worn only while the pouch holds it, and comes off when the pouch loses it
// (checked when the set or the pouch's version changes, never per frame).
// MULTIPLAYER: the set is the server's to say. Offline it is worn at once; in co-op it is asked of the server (features/
// coop.js wear) and worn when the server's answer comes back (coop.gear), the same moment the others see it.
// SIM vs VIEW: the set worn and its modifier notes change in update (a step); the look follows in view, on a change only.
// DEV PREVIEW (dev/wardrobe.js): preview({swap, extra, key}) draws the set with some pieces swapped for edited copies and
// extra look-only pieces after them (zone paints, a piece being tuned); the look only: no notes, nothing sent. null: off.
// OWNS: the set (want: chosen; worn: in effect), the 'gear' modifier notes, the panel. READS: flags ('gear'),
//   localStorage ('rb.gear': the set last chosen here), the co-op feature (online, wear, gear), the pack's panel (open: Tab opens
//   the pack, and the gear panel beside it; with no pack, Tab is the gear panel's), the pack's pouch (count, inv.ver: the keepsakes).
// EMITS: gear.wear.  BUDGET: update ~0 (two compares a step); view: a dress on a change (2-25 ms, rare); panel: DOM, on change.
import {gearById, cleanSet, setStats, setKey, SLOT_CAP} from '../content/gear.js';
import {flags} from '../core/flags.js';
import {createGearPanel} from '../ui/gearpanel.js';

const KEY = 'rb.gear';
const remembered = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
const remember = ids => { try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch (e) { /* (private mode: not remembered) */ } };

// ORDER (core/features.js): after co-op: the server's word on your set arrives in its update, worn the same step
export const order = {after: ['coop']};
export async function create(host) {
  const q = flags.get('gear');
  const S = {
    want: cleanSet(q !== null ? (q === 'none' ? [] : q.split(',')) : remembered()), wantV: 1,   // what you chose
    worn: [], key: '', stats: setStats([]), ver: 0,                                             // what is in effect
    wornV: 0, sentV: 0, coopV: 0, waiting: false, pouchV: -1,
  };
  // a keepsake is worn only while the pouch holds one (no pack: none are)
  const pack = () => host.feature('pack');
  const owned = ids => { const pk = pack(); return ids.filter(id => !gearById(id)?.keepsake || (pk?.count?.(id) || 0) > 0); };
  const coop = () => { const c = host.feature('coop'); return c?.online ? c : null; };
  function put(ids) {
    const key = setKey(ids); if (key === S.key) return;
    S.worn = ids; S.key = key; S.stats = setStats(ids); S.ver++;
    const notes = [];
    if (S.stats.speed !== 1) notes.push({stat: 'player.speed', mul: S.stats.speed});
    if (S.stats.armor > 0) notes.push({stat: 'game.hurt', mul: 1 - S.stats.armor});
    for (const id of ids) for (const n of gearById(id).mods || []) notes.push(n);
    if (notes.length) host.mods.set('gear', notes); else host.mods.clear('gear');
    const P = host.player;
    host.events.push({type: 'gear.wear', x: P.x, y: P.y, ids, kg: S.stats.kg, armor: S.stats.armor, speed: S.stats.speed});
  }
  // the panel's choice: a piece into its slot (or the slot emptied); worn next step (online: once the server took it)
  function choose(ids) { S.want = owned(cleanSet(ids)); S.wantV++; remember(S.want); }
  const panel = createGearPanel({S, choose, online: () => !!coop(), has: id => (pack()?.count?.(id) || 0) > 0});
  let shown = -1, shownW = false, over = null, overV = 0, shownO = 0, packWas = false, shownP = -1;
  // the pieces to draw: the set worn, a piece swapped for its preview copy, then the preview's own (a later paint wins)
  function look() {
    if (!over) return [S.worn.map(gearById), S.key];
    const ps = S.worn.map(id => over.swap?.[id] || gearById(id)); if (over.extra) ps.push(...over.extra);
    return [ps, S.key + '|' + over.key + '#' + overV];
  }

  const F = {
    name: 'gear', label: 'Gear', on: true, S, panel,
    choose, wear: id => { const g = gearById(id); if (g) choose([...S.want.filter(w => SLOT_CAP[g.slot] || gearById(w).slot !== g.slot), id]); },   // (a charm: beside the other, the oldest off past two)
    takeOff: slot => choose(S.want.filter(w => gearById(w).slot !== slot)),
    update() {
      // the pouch changed: a keepsake it no longer holds comes off (and one it holds again stays off: a choice to make)
      const pv = pack()?.inv?.ver ?? 0;
      if (pv !== S.pouchV) { S.pouchV = pv; const keep = owned(S.want); if (keep.length !== S.want.length) choose(keep); }
      const c = coop();
      if (c) {
        if (S.sentV !== S.wantV) { S.sentV = S.wantV; c.wear(S.want); S.waiting = true; }
        if (c.gear.ver !== S.coopV) {   // the server's answer (it answers every ask): its word is what you wear, and what you chose
          S.coopV = c.gear.ver; const ids = cleanSet(c.gear.ids); put(ids); S.want = ids; S.waiting = false;
          if (owned(ids).length !== ids.length) choose(owned(ids));   // (a keepsake the pouch lost while the ask was out)
        }
      } else if (S.wornV !== S.wantV) { S.wornV = S.wantV; put(S.want); S.waiting = false; }
    },
    // the look only, from the dev wardrobe: {swap: {id: piece}, extra: [piece], key} or null (as worn). Drawn at the next view
    preview(o) { over = o || null; overV++; },
    view() {
      if (S.pouchV !== shownP) { shownP = S.pouchV; panel.sync(); }   // (the Charms row offers what the pouch holds)
      if (S.ver === shown && S.waiting === shownW && overV === shownO) return;
      if (S.ver !== shown || overV !== shownO) { const [ps, key] = look(); host.dressPlayer?.(ps, key); }
      shown = S.ver; shownW = S.waiting; shownO = overV; panel.sync();
    },
    // the panel goes with the pack's (Tab: what you carry and what you wear), a compare a frame
    frame() { const p = host.feature('pack'), o = !!p?.open; if (o !== packWas) { packWas = o; panel.toggle(o); } },
    onKey(k, e) { if (k !== 'tab' || e?.shiftKey) return false; panel.toggle(); return true; },   // (no pack: Tab is this panel's; Shift+Tab: the dev wardrobe)
    menu: () => [{label: `Gear: ${S.worn.length ? S.worn.map(id => gearById(id).name).join(', ') : 'your own clothes'} (Tab)`, run: () => panel.toggle(true)}],
    hud: () => `gear ${S.key || 'none'} · ${S.stats.kg.toFixed(1)} kg · armor ${Math.round(S.stats.armor * 100)}% · speed x${S.stats.speed.toFixed(2)}${S.waiting ? ' · waiting for the server' : ''}`,
  };
  return F;
}
