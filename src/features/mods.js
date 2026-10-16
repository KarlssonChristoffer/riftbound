// MODS (docs/MODS.md): weapon attachments and runes. Every weapon has three slots: a RUNE decides what kind of damage it deals
// (Ember burns, Rime chills and freezes, Storm jumps between targets, Rot stacks and spreads, Hollow makes things fall upward),
// a TIP how the shot flies (a fork, a sighted barrel, a moth lens, a bent bough, a heavy slug, a glancing lip, a prism, a
// staff's caster crystal), a GRIP a trigger that bends a rule (a hair trigger, a kick, an echo, a weather vane, the last word).
// Types meet on a target (fire on frozen: a steam burst; storm on burning: a flashover; ...: content/mods.js REACT), and the
// weather, the ground and the hour change them. Parts turn up round the world (content/mods.js FINDS); N opens the weapon
// bench (ui/modpanel.js) to fit them.
//   mods/sim.js    the truth: the kit, the shots' tags, the hits, the statuses, the finds        content/mods.js   the numbers
//   mods/look.js   the view: trails, statuses, arcs, bursts, the dropped parts, the toasts      ui/modpanel.js    the bench
// HOOKS: F.arrow (every shot spawned: its type, tip and grip), F.onArrowHit (ahead of combat: the hit's type; returns nothing),
//   combat core's hitMod (the factor on the damage; a melee blow's type), F.update (statuses, echoes, finds, the drops), the
//   modifier source 'mods' (the gun in hand's notes: content/mods.js PART notes -> weapon.spread / dmg / gap / reload /
//   fanSpread / last, proj.ricochet).
// TURNING IT OFF: ?mods=0. ?mods=all: every part in the kit. Sandbox rows: every part, a pack of brutes, a fresh kit.
// API: F.sim / F.look (tests), F.give(id), F.fit(wid, slot, id), F.elemOf(wid) -> the type a blow of that weapon deals now
//   (the melee weapons may ask), F.setWeapon(fn) (() -> the weapon id in hand: the melee weapons' feature hands it over when
//   it holds one), F.tab {id, title, key, mount(el), unmount(), refresh()} (the game's menus may show the bench as a tab).
// OWNS: the modifier source 'mods', pack.store('mods') (through the sim), #modbench (ui/modpanel.js). READS: flags ('mods'),
//   host.weapon, the pack (store, dirty). BUDGET: see the sim and the look; the bench only while it is open.
import {flags} from '../core/flags.js';
import {createModsSim} from './mods/sim.js';
import {createModsLook} from './mods/look.js';
import {createModPanel} from '../ui/modpanel.js';
import {iconURL} from '../ui/packpanel.js';
import {hdUnit, hdFrame, hdText, hdFont} from '../ui/hdpixel.js';
import {ELEM, REACT, REACT_IDS, PARTS, PART_IDS, SLOTS, SLOT_NAMES, KNOWN, kindOf, fits, descOf} from '../content/mods.js';
import {WEAPONS} from '../content/weapons.js';
import {onGround} from '../world/world.js';

const Q = flags.get('mods'), ON = Q !== '0';
const NOTE = {spread: 'weapon.spread', dmg: 'weapon.dmg', gap: 'weapon.gap', reload: 'weapon.reload', fanSpread: 'weapon.fanSpread', last: 'weapon.last',
  ricochet: 'proj.ricochet'};
const ADD = {last: true, ricochet: true};
const SLOT_HINT = {rune: 'Empty: a plain hit. A rune here decides what kind of damage it deals.', tip: 'Empty. A tip here changes how the shot flies.',
  grip: 'Empty. A grip here bends a rule each time you shoot.'};

// ORDER (core/features.js): ahead of combat in the hook chains (onArrowHit: the hit's type is set before combat resolves the
// damage, which asks our hit mod for its factor); after the pack (its save loaded)
export const order = {before: ['combat'], after: ['pack']};
export async function create(host) {
  const pack = () => host.feature('pack');
  const mem = {};
  let saveObj = null;
  const saved = () => (saveObj = pack()?.store?.('mods') ?? mem);
  const sim = createModsSim(host, saved);
  sim.setDirty(() => pack()?.dirty?.());
  const look = createModsLook(host, sim);
  if (Q === 'all') for (const id of PART_IDS) if (!sim.S.own[id]) sim.S.own[id] = 1;
  // the weapon in hand: whoever handed one over (setWeapon), else the melee feature's blade or staff, else the gun or bow
  const weaponId = () => wfn ? wfn() : host.feature('melee')?.weapon?.() || host.weapon?.id || '';
  let wfn = null;
  sim.setWeapon(() => weaponId());

  // the gun in hand's notes (its tip's and grip's): set when the weapon or the kit changes
  let notesKey = '';
  function notes() {
    const wid = weaponId(), f = sim.fitOf(wid), key = wid + '|' + sim.S.ver;
    if (key === notesKey) return; notesKey = key;
    const L = [];
    if (ON && f && sim.kindOfW(wid) === 'gun') for (const s of ['tip', 'grip']) {
      const n = f[s] && PARTS[f[s]].notes; if (!n) continue;
      for (const k in n) if (NOTE[k]) L.push(ADD[k] ? {stat: NOTE[k], add: n[k]} : {stat: NOTE[k], mul: n[k]});
    }
    if (L.length) host.mods.set('mods', L); else host.mods.clear('mods');
  }

  // ---- the bench ----
  let sel = 'rune', open = false, mountEl = null;
  // the game's tabbed window (features/panels.js) mounts the bench as its 'weapon' tab (N) when it's in the game; else our own box
  const panels = () => host.feature('panels');
  const shown = () => mountEl ? !!(panels()?.isOpen && panels().tabId === 'weapon') : open;
  const ICON = {}, icon = id => ICON[id] ??= iconURL(PARTS[id].icon, PARTS[id].pal);
  const wname = w => WEAPONS[w]?.name || KNOWN[w]?.name || w;
  const partCol = id => PARTS[id].elem ? ELEM[PARTS[id].elem].col : '#efe6cf';
  function model() {
    const wid = weaponId(), kind = sim.kindOfW(wid), names = SLOT_NAMES[kindOf(kind)], f = sim.fitOf(wid) || {}, S = sim.S;
    const el = ELEM[sim.elemOf(wid)];
    const slots = SLOTS.map(s => ({slot: s, label: names[s], id: f[s] || '', name: f[s] ? PARTS[f[s]].name : '', icon: f[s] ? icon(f[s]) : '', col: f[s] ? partCol(f[s]) : '', sel: s === sel}));
    const parts = PART_IDS.filter(id => PARTS[id].slot === sel && S.own[id] && fits(id, kind)).map(id => {
      const on = f[sel] === id, ok = sim.free(id) > 0;
      const where = !ok && !on ? Object.keys(S.fit).find(w => SLOTS.some(s => S.fit[w][s] === id)) : '';
      return {id, name: PARTS[id].name + (S.own[id] > 1 ? ` x${S.own[id]}` : ''), icon: icon(id), desc: descOf(id), col: partCol(id), on, ok, why: where ? `on your ${wname(where)}` : 'in use'};
    });
    const riddles = PART_IDS.filter(id => PARTS[id].slot === sel && !S.own[id] && fits(id, kind) && PARTS[id].riddle).map(id => PARTS[id].riddle);
    const others = Object.keys(S.fit).filter(w => w !== wid && SLOTS.some(s => S.fit[w][s])).map(w => ({name: wname(w), line: SLOTS.map(s => PARTS[S.fit[w][s]]?.name).filter(Boolean).join(', ')}));
    const seen = REACT_IDS.filter(id => S.seen['r:' + id]), reacts = seen.map(id => ({name: REACT[id].name, says: REACT[id].says}));
    if (seen.length < REACT_IDS.length) reacts.push({name: `${REACT_IDS.length - seen.length} more`, says: 'hit something that already burns, freezes or rots with another rune'});
    const desc = f[sel] ? `${PARTS[f[sel]].name}: ${descOf(f[sel])}` : SLOT_HINT[sel];
    return {key: [wid, S.ver, sel, el.name, seen.length].join('|'), weapon: {name: wname(wid), kind, elem: el}, slots, desc, parts, riddles, reacts, others};
  }
  const panel = createModPanel({ask(a, v) {
    const wid = weaponId(), kind = sim.kindOfW(wid);
    if (a === 'close') setOpen(false);
    else if (a === 'slot') sel = v;
    else if (a === 'fit') sim.fit(wid, kind, sel, v);
    else if (a === 'out') sim.fit(wid, kind, v, '');
    host.uiSound?.(a === 'fit' ? 'confirm' : 'click');
    if (shown()) panel.show(model(), mountEl);
  }});
  function setOpen(on) {
    const W = panels(); if (W?.open && mountEl) { if (on) W.open('weapon'); else W.close(); return; }
    open = on && ON; if (open) panel.show(model(), mountEl); else panel.hide();
  }

  // a pack of hunting brutes round (x, y) (the sandbox's row: something to burn, freeze and shatter)
  function spawnPack(n, x, y) {
    const c = host.feature('combat')?.core; if (!c) return 0;
    let k = 0;
    for (let i = 0; i < 40 && k < n; i++) {
      const a = i * 2.4, d = .8 + (i % 4) * .8, bx = x + Math.sin(a) * d, by = y + Math.cos(a) * d;
      if (!onGround(bx, by) || host.blocked(bx, by, host.elev(bx, by)) || host.inStream(bx, by)) continue;
      c.spawnBrute({x: bx, y: by, hp: 60, dmg: 6, coins: [1, 2], type: 'brute', name: 'Brute', wait: 1 + k * .15}); k++;
    }
    return k;
  }

  let coreHooked = false;
  const F = {
    name: 'mods', label: 'Weapon mods', on: ON, sim, look,
    give: id => sim.give(id), fit: (wid, slot, id) => sim.fit(wid, sim.kindOfW(wid), slot, id), elemOf: wid => sim.elemOf(wid, false),
    setWeapon(fn) { wfn = fn; notesKey = ''; },
    tab: {id: 'weapon', title: 'Weapon', key: 'n', mount(el) { mountEl = el; open = false; panel.show(model(), el); }, unmount() { mountEl = null; panel.hide(); },
      refresh() { if (mountEl) panel.show(model(), mountEl); }},
    arrow(a) { if (ON) sim.shot(a); },
    onArrowHit(a, p) { if (ON) sim.onArrowHit(a, p); },
    onKey(k) {
      if (!ON || k !== 'n' || host.lock || panels()?.open) return false;   // (with the tabbed window, its own N opens the tab)
      setOpen(!open); return true;
    },
    update(dt, evs) {
      if (!ON) return;
      if (!coreHooked) { const c = host.feature('combat')?.core; if (c?.hitMod) { c.hitMod(sim.hitMod, true); coreHooked = true; } }
      sim.setHits(host.feature('hits'));
      if (saveObj !== (pack()?.store?.('mods') ?? mem)) sim.load();
      for (const e of evs) if (e.type === 'pack.reset') sim.load();
      notes();
      sim.step(dt, evs);
    },
    view(dt) { if (ON) look.view(dt); },
    frame(f) { if (!ON) return; look.frame(f); if (shown()) panel.show(model(), mountEl); },
    lights: () => ON ? look.lights() : [],
    // the type the weapon in hand deals now, in a small pixel chip bottom left (only once something is fitted)
    hd(q) {
      if (!ON || host.hudOff || shown()) return;
      const wid = weaponId(), f = sim.fitOf(wid); if (!f || !SLOTS.some(s => f[s])) return;
      const E = ELEM[sim.elemOf(wid)], u = hdUnit(), H = q.canvas.height;
      const s = E.name.toUpperCase(), n = SLOTS.filter(k => f[k]).length;
      q.font = hdFont(u); const w = Math.ceil(q.measureText(s).width / u) * u + 26 * u, x = 8 * u, y = H - 46 * u;
      hdFrame(q, x, y, w, 16 * u, u);
      q.fillStyle = E.col; q.fillRect(x + 5 * u, y + 5 * u, 6 * u, 6 * u); q.fillStyle = '#0c0907'; q.fillRect(x + 7 * u, y + 7 * u, 2 * u, 2 * u);
      hdText(q, s, x + 14 * u, y + 12 * u, u, E.col);
      for (let i = 0; i < 3; i++) { q.fillStyle = i < n ? '#f2c95c' : '#4a3826'; q.fillRect(x + w - 11 * u + i * 3 * u, y + 7 * u, 2 * u, 2 * u); }
    },
    hud: () => {
      if (!ON) return '';
      const wid = weaponId(), f = sim.fitOf(wid) || {};
      return `mods: ${wid} ${ELEM[sim.elemOf(wid)].name}${SLOTS.map(s => f[s] ? ' ' + s + ':' + f[s] : '').join('')} · statuses ${sim.ST.size}${sim.drops.length ? ' · drops ' + sim.drops.length : ''}`;
    },
    menu() {
      if (!ON || host.feature('game')?.mode !== 'sandbox') return [];
      const P = host.player, a = host.yaw;
      return [
        {label: 'Weapon mods: every part in the kit', run: () => { for (const id of PART_IDS) if (!sim.S.own[id]) sim.give(id); }},
        {label: 'Weapon mods: a pack of brutes to try them on', run: () => spawnPack(6, P.x - Math.sin(a) * 7, P.y - Math.cos(a) * 7)},
        {label: 'Weapon mods: drop a part you don\'t have at your feet', run: () => { const id = PART_IDS.find(k => !sim.S.own[k]); if (id) sim.drop(id, P.x + 1.2, P.y); }},
        {label: 'Weapon mods: open the weapon bench (N)', run: () => setOpen(true)},
        {label: 'Weapon mods: a fresh kit', run: () => { const o = saved(); for (const k in o) delete o[k]; sim.load(); pack()?.dirty?.(); }},
      ];
    },
    dispose() { host.mods.clear('mods'); sim.setHits(null); panel.hide(); },
  };
  return F;
}
