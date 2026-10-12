// WARDROBE: the dev wardrobe (Shift+Tab in dev mode; also Menu > Dev > Tools > Wardrobe). One place to try a character
// out and test clothes: four tabs.
//   Look     the character (loadout), the camera (turn, spin), the gear in each slot (through features/gear.js, so co-op
//            still asks the server), test paint on any zone of the model (a material, a picked colour, or hidden), the duster
//            tail's colour, and the PIECE TUNER: every shape of a piece (position, turn, size, material) on sliders, drawn as
//            you drag; "Copy code" puts the piece's shapes on the clipboard as content/gear.js lines
//   Stats    sliders as MODIFIER notes under the source 'wardrobe' (core/modifiers.js), applied by each stat's owner:
//            player.speed x (player.js)   game.hurt x (game/stats.js)   weapon.dmg / reload / gap / melee x (sim/player/gun.js)
//            combat.crit + / critMul + / enemyDmg x (combat/core.js)   light.lantern + / lanternR x (render/lighting.js)
//   Items    the run's items (+ / - a copy) and augments (on / off) through game/stats.js; they hold in the sandbox until a
//            run starts (a run starts empty)
//   Outfits  everything above saved under a name, worn again in one click; "Copy link" gives the set as URL switches
// The look and the notes hold in DEV MODE only, like the cheat panel's (a run without ?dev=1 drops them; back with it). The
// paint and the tuned pieces are the look only (features/gear.js preview): no weight, no armor, nothing sent in co-op.
// Remembered on this machine ('rb.wardrobe').
// It is a FEATURE the boot puts at the end of the list (main.js; dev/: nothing in the game imports it). F.on is the panel
// showing. Its update carries out what the panel asked for (gear, items, the camera's spin) inside a sim step, and hands
// gear the look to preview (a dev look only: gear draws it in its view).
// OWNS: the panel (#wardrobe + its style), the 'wardrobe' notes, the gear preview it asks for.
// READS: host (mods, the game's stats, the gear feature, yaw, dev), hero (the loadout: switchLoadout, loadI, loadName),
//   content/gear.js, game/items.js.
// BUDGET: closed and nothing on: nothing. Open: a few text writes 4 times a second. A slider drag: one dress at most every
//   50 ms (2-25 ms each, view/dress.js), never per frame otherwise.
import {SLOTS, SLOT_NAMES, GEAR, MATERIALS, ZONES, gearById, cleanSet, setStats} from '../content/gear.js';
import {ITEMS, AUGMENTS, TIER} from '../game/items.js';
import {LOADOUTS, SET_NAMES} from '../view/hero.js';
import {tint} from '../view/rigkit.js';

const STORE = 'rb.wardrobe', DEG = Math.PI / 180;
// the stats tab: each a note on the owner's stat (mul: x the value, 1 = as authored; add: + the value, 0 = none)
const KNOBS = [
  {k: 'speed', label: 'Move speed', stat: 'player.speed', mul: 1, min: .25, max: 3, note: 'walk / run / sprint (player.js)'},
  {k: 'hurt', label: 'Damage taken', stat: 'game.hurt', mul: 1, min: 0, max: 3, note: 'x the damage you take (0: none)'},
  {k: 'gdmg', label: 'Gun damage', stat: 'weapon.dmg', mul: 1, min: 0, max: 5, note: "a bullet's damage (sim/player/gun.js)"},
  {k: 'reload', label: 'Reload time', stat: 'weapon.reload', mul: 1, min: .1, max: 3, note: 'the revolver (< 1: faster)'},
  {k: 'gap', label: 'Shot gap', stat: 'weapon.gap', mul: 1, min: .25, max: 3, note: 'the time between shots (< 1: faster)'},
  {k: 'melee', label: 'Melee damage', stat: 'weapon.melee', mul: 1, min: 0, max: 5, note: 'a kick, a barge, a pistol-whip'},
  {k: 'crit', label: 'Crit chance', stat: 'combat.crit', add: 0, min: 0, max: 1, note: '+ on top of combat\'s 15%'},
  {k: 'critMul', label: 'Crit damage', stat: 'combat.critMul', add: 0, min: 0, max: 5, note: '+ on top of combat\'s 2x'},
  {k: 'enemyDmg', label: 'Brutes hit', stat: 'combat.enemyDmg', mul: 1, min: 0, max: 3, note: "x the run's brutes' damage"},
  {k: 'lanternR', label: 'Lantern size', stat: 'light.lanternR', mul: 1, min: .25, max: 4, note: 'x the lantern\'s radius'},
  {k: 'lantern', label: 'Lantern lit', stat: 'light.lantern', add: 0, min: 0, max: 1, step: 1, note: '1: lit whatever the switch says'},
];
const knob0 = n => n.mul ?? n.add;
// a shape's size fields, by shape (content/gear.js add): the tuner's sliders
const SIZE = {box: ['size.0', 'size.1', 'size.2'], ball: ['r.0', 'r.1', 'r.2'], tube: ['r0', 'r1', 'len'], disc: ['r', 'len'], cone: ['r', 'len']};
const TABS = ['look', 'stats', 'items', 'outfits'];
const DEF = {open: false, tab: 'look', spin: false, paint: {}, cloth: '', custom: '#5a8f6a', tune: {}, stats: {}, piece: '', shape: 0, outfits: []};
const CSS = `
#wardrobe { position: fixed; right: 10px; top: 64px; z-index: 16; width: 312px; max-height: calc(100vh - 150px); overflow: auto; padding: 8px 8px 6px;
  background: rgba(14, 16, 15, .94); border: 1px solid var(--line); border-radius: 6px; scrollbar-width: thin; user-select: none; }
#wardrobe.hidden { display: none; }
body:has(#pause:not(.hidden)) #wardrobe { visibility: hidden; }
body:has(#cheats:not(.hidden)) #wardrobe { right: 276px; }
body:has(#wardrobe:not(.hidden)) #help { right: 332px; max-width: calc(100vw - 760px); }   /* (the key help moves out from under it) */
#wardrobe header { display: flex; justify-content: space-between; align-items: baseline; padding: 0 4px 4px; }
#wardrobe header b { color: var(--key); letter-spacing: .14em; }
#wardrobe header small, #wardrobe .w-dim { color: var(--dim); }
#wardrobe header button { font: inherit; color: var(--dim); background: none; border: 0; cursor: pointer; padding: 0 2px; }
#wardrobe header button:hover { color: var(--ink); }
#wardrobe nav { display: flex; gap: 3px; padding: 0 2px 4px; border-bottom: 1px solid var(--line); }
#wardrobe nav button { flex: 1; padding: 2px 0; font: inherit; color: var(--dim); background: none; border: 1px solid transparent; border-radius: 4px; cursor: pointer; text-transform: capitalize; }
#wardrobe nav button.on { color: var(--key); border-color: var(--line); background: rgba(240, 192, 96, .12); }
#wardrobe h5 { margin: 9px 4px 3px; font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--dim); }
#wardrobe .w-row { display: flex; align-items: center; gap: 6px; padding: 2px 4px; }
#wardrobe .w-row > span:first-child { flex: 0 0 90px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#wardrobe .w-row.on > span:first-child { color: var(--key); }
#wardrobe .w-row .w-v { flex: 0 0 44px; text-align: right; color: var(--dim); font-variant-numeric: tabular-nums; }
#wardrobe .w-row.on .w-v { color: var(--key); }
#wardrobe select, #wardrobe input[type=text] { flex: 1; min-width: 0; font: inherit; color: var(--ink); background: rgba(255, 255, 255, .06); border: 1px solid var(--line); border-radius: 3px; padding: 1px 3px; }
#wardrobe select option { background: #1a1d1b; }
#wardrobe input[type=range] { flex: 1; min-width: 0; margin: 0; accent-color: #f0c060; }
#wardrobe input[type=color] { width: 28px; height: 18px; padding: 0; border: 1px solid var(--line); background: none; }
#wardrobe .w-btns { display: flex; flex-wrap: wrap; gap: 4px; padding: 3px 4px; }
#wardrobe .w-btn { flex: 1 0 auto; padding: 2px 6px; font: inherit; color: var(--ink); background: rgba(255, 255, 255, .05); border: 1px solid var(--line); border-radius: 4px; cursor: pointer; }
#wardrobe .w-btn:hover { border-color: var(--key); }
#wardrobe .w-btn.on { border-color: var(--key); background: rgba(240, 192, 96, .2); color: var(--key); }
#wardrobe .w-btn.sm { flex: 0 0 auto; padding: 0 6px; }
#wardrobe .w-item { display: flex; align-items: center; gap: 6px; padding: 1px 4px; }
#wardrobe .w-item .g { width: 14px; text-align: center; }
#wardrobe .w-item .n { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#wardrobe .w-item .c { width: 16px; text-align: center; color: var(--key); }
#wardrobe .w-item.off { opacity: .45; }
#wardrobe .w-note { padding: 1px 4px; font-size: 11px; color: var(--dim); }
#wardrobe .w-msg { min-height: 1.45em; margin-top: 4px; padding: 0 4px; color: var(--key); }`;

const fmtN = v => String(+v.toFixed(3)).replace(/^(-?)0\./, '$1.');
const copy = o => JSON.parse(JSON.stringify(o));
// a picked colour -> 4 tones (hi, base, shade, dark) like content/gear.js MATERIALS
const tonesOf = hex => [tint([hex], '#ffffff', .32)[0], hex, tint([hex], '#000000', .3)[0], tint([hex], '#000000', .62)[0]];
// a piece's shapes as content/gear.js source lines
function codeOf(g, add) {
  const v3 = a => `[${a.map(fmtN).join(', ')}]`;
  const line = a => {
    const f = [`on: '${a.on}'`, `part: '${a.part}'`, `mat: '${a.mat}'`, `shape: '${a.shape}'`];
    if (a.size) f.push(`size: ${v3(a.size)}`);
    if (a.r !== undefined) f.push(`r: ${Array.isArray(a.r) ? v3(a.r) : fmtN(a.r)}`);
    for (const k of ['r0', 'r1', 'len']) if (a[k] !== undefined) f.push(`${k}: ${fmtN(a[k])}`);
    f.push(`at: ${v3(a.at)}`);
    if (a.rot && a.rot.some(x => x)) f.push(`rot: ${v3(a.rot.map(x => Math.round(x)))}`);
    if (a.o) f.push(`o: {${Object.entries(a.o).map(([k, x]) => `${k}: ${typeof x === 'string' ? `'${x}'` : x}`).join(', ')}}`);
    return `      {${f.join(', ')}},`;
  };
  return `    // ${g.id}: look.add (dev/wardrobe.js)\n    add: [\n${add.map(line).join('\n')}\n    ]`;
}

// opts: {host, hero (the loadout: view/hero.js)}
export function createWardrobe({host, hero}) {
  const C = copy(DEF);
  try { Object.assign(C, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
  if (!TABS.includes(C.tab)) C.tab = 'look';
  for (const k of ['paint', 'tune', 'stats']) if (!C[k] || typeof C[k] !== 'object' || Array.isArray(C[k])) C[k] = {};
  if (!Array.isArray(C.outfits)) C.outfits = [];
  for (const id in C.tune) if (!gearById(id)?.look?.add || !Array.isArray(C.tune[id])) delete C.tune[id];
  for (const n of KNOBS) { const v = C.stats[n.k]; if (!(v >= n.min && v <= n.max)) delete C.stats[n.k]; }
  let saveT = 0;
  const save = () => { saveT = 0; try { localStorage.setItem(STORE, JSON.stringify(C)); } catch (e) {} };
  const gear = () => host.feature('gear'), game = () => host.feature('game'), stats = () => game()?.stats;
  const kind = () => host.weapon?.kind ?? 'bow';
  const zonesNow = () => ZONES[(hero.loadName || '').split(' ')[0] + '.py'] || ZONES['gunslinger.py'];

  // ---------------------------------------------------------------- the notes and the look (applied on change and as dev mode turns)
  function applyNotes() {
    const notes = [];
    if (host.dev) for (const n of KNOBS) { const v = C.stats[n.k]; if (v === undefined) continue; notes.push(n.mul !== undefined ? {stat: n.stat, mul: v} : {stat: n.stat, add: v}); }
    if (notes.length) host.mods.set('wardrobe', notes); else host.mods.clear('wardrobe');
  }
  let lookDirty = true, lookT = 0, previewing = false;
  const preview = o => { if (!o && !previewing) return; previewing = !!o; gear().preview(o); };   // (never asked: nothing to undo)
  function applyLook() {
    const g = gear(); if (!g?.preview) return;
    if (!host.dev) { preview(null); return; }
    const swap = {}; let n = 0;
    for (const id in C.tune) { const p = gearById(id); swap[id] = {...p, look: {...p.look, add: C.tune[id]}}; n++; }
    const paint = {}, hide = [];
    for (const [z, m] of Object.entries(C.paint)) { if (m === 'hide') hide.push(z); else if (m === 'custom') paint[z] = tonesOf(C.custom); else if (MATERIALS[m]) paint[z] = m; }
    const cloth = C.cloth === 'custom' ? tonesOf(C.custom) : C.cloth === 'off' || MATERIALS[C.cloth] ? C.cloth : '';
    const extra = Object.keys(paint).length || hide.length || cloth ? [{id: 'wardrobe', name: 'Wardrobe', slot: '', look: {paint, hide, cloth: cloth || undefined}}] : [];
    preview(n || extra.length ? {swap, extra, key: 'wardrobe'} : null);
  }
  const lookChanged = () => { lookDirty = true; saveT = .3; };

  // ---------------------------------------------------------------- what the panel asks for: carried out in the sim step
  const queue = [];
  const ask = fn => { queue.push(fn); };
  let msg = '', msgT = 0;
  const say = s => { msg = s; msgT = performance.now(); };
  const wear = ids => ask(() => gear()?.choose(cleanSet(ids)));
  const wearing = () => gear()?.S.want || [];
  function setLoadout(i) { const n = LOADOUTS.length; hero.switchLoadout(((i % n) + n) % n); lookChanged(); }
  function giveItem(id, d) {
    const st = stats(), it = ITEMS.find(x => x.id === id); if (!st || !it) return;
    if (d > 0) st.addItem(it); else st.removeItem(id);
  }
  function flipAug(id) { const st = stats(), a = AUGMENTS.find(x => x.id === id); if (!st || !a) return; if (st.augs.has(id)) st.removeAugment(id); else st.addAugment(a); }
  function clearBuild() { const st = stats(); if (!st) return; for (const [id, n] of [...st.items]) for (let i = 0; i < n; i++) st.removeItem(id); for (const id of [...st.augs]) st.removeAugment(id); }
  function randomOutfit() {   // (the panel's own pick: Math.random is fine here, it's the panel, not the sim)
    const ids = [];
    for (const s of SLOTS) { const ps = GEAR.filter(g => g.slot === s); const i = Math.floor(Math.random() * (ps.length + 1)); if (i < ps.length) ids.push(ps[i].id); }
    wear(ids); say(ids.length ? ids.map(id => gearById(id).name).join(', ') : 'own clothes');
  }

  // ---------------------------------------------------------------- outfits: all of it under a name
  function snapshot(name) {
    const st = stats();
    return {name, set: hero.loadI, gear: [...wearing()], paint: copy(C.paint), cloth: C.cloth, custom: C.custom, tune: copy(C.tune), stats: copy(C.stats),
      items: st ? [...st.items] : [], augs: st ? [...st.augs] : []};
  }
  function wearOutfit(o) {
    if (Number.isInteger(o.set) && o.set !== hero.loadI && o.set >= 0 && o.set < LOADOUTS.length) setLoadout(o.set);
    wear(o.gear || []);
    C.paint = copy(o.paint || {}); C.cloth = o.cloth || ''; C.custom = o.custom || C.custom; C.tune = copy(o.tune || {}); C.stats = copy(o.stats || {});
    for (const id in C.tune) if (!gearById(id)?.look?.add) delete C.tune[id];
    ask(() => {
      clearBuild();
      for (const [id, n] of o.items || []) for (let i = 0; i < n; i++) giveItem(id, 1);
      for (const id of o.augs || []) flipAug(id);
    });
    applyNotes(); lookChanged(); save(); build(); say(`wearing "${o.name}"`);
  }
  function linkOf() {
    const u = new URL(location.href), ids = wearing();
    u.searchParams.set('gear', ids.length ? ids.join(',') : 'none');
    if (SET_NAMES[hero.loadI]) u.searchParams.set('set', SET_NAMES[hero.loadI]);
    return u.toString();
  }
  function clip(text, what) {
    console.log(text);
    const p = navigator.clipboard?.writeText(text);
    if (p) p.then(() => say(`${what} copied`), () => say(`${what}: in the console (F12)`)); else say(`${what}: in the console (F12)`);
  }

  // ---------------------------------------------------------------- the panel
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'wardrobe'; root.className = 'hidden'; document.body.appendChild(root);
  // no focus but the form fields' (Space / Enter stay the game's); a key in a text field is the field's, any other blurs it
  root.addEventListener('mousedown', e => { if (!/^(INPUT|SELECT|OPTION)$/.test(e.target.tagName)) e.preventDefault(); });
  root.addEventListener('keydown', e => {
    if (e.target.type === 'text') { e.stopPropagation(); if (e.key === 'Escape') e.target.blur(); return; }
    e.target.blur?.();
  });
  const rows = [];   // each: sync() (writes only what changed)
  const put = (e, k, v) => { if (e[k] !== v) e[k] = v; };
  let body = null, msgEl = null;
  const el = (tag, cls, text, parent = body) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; parent.appendChild(e); return e; };
  const h5 = t => el('h5', '', t);
  const note = (t = '') => el('div', 'w-note', t);
  // a row: label + a control
  function row(label, title) { const r = el('div', 'w-row'); const l = el('span', '', label, r); if (title) r.title = title; return {r, l}; }
  function select(r, options, get, set) {   // options: [[value, text]]
    const s = el('select', '', undefined, r);
    for (const [v, t] of options) { const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o); }
    s.onchange = () => { set(s.value); s.blur(); sync(); };
    rows.push(() => put(s, 'value', String(get())));
    return s;
  }
  // a slider: label, value text, its range; a double click: back to def
  function slider(label, {min, max, step = .01, get, set, def, fmt = v => v.toFixed(2), title}) {
    const {r} = row(label, title);
    const s = el('input', '', undefined, r); s.type = 'range'; s.min = min; s.max = max; s.step = step;
    const v = el('span', 'w-v', '', r);
    s.oninput = () => { set(+s.value); sync(); };
    s.onchange = () => s.blur();
    if (def !== undefined) s.ondblclick = () => { set(def); sync(); };
    rows.push(() => { const x = get(); put(v, 'textContent', fmt(x)); if (+s.value !== x) s.value = x; r.classList.toggle('on', def !== undefined && Math.abs(x - def) > 1e-9); });
    return r;
  }
  // a row of buttons: [{text, go, on?(), title?}]
  function btns(list) {
    const d = el('div', 'w-btns');
    const bs = list.map(o => { const b = el('button', 'w-btn', o.text, d); if (o.title) b.title = o.title; b.onclick = () => { o.go(); sync(); }; return b; });
    rows.push(() => list.forEach((o, i) => { if (o.on) bs[i].classList.toggle('on', !!o.on()); }));
    return d;
  }

  // the piece tuner: the piece being tuned (one with shapes) and its shapes as tuned
  const TUNABLE = GEAR.filter(g => g.look?.add?.length);
  const tuned = id => C.tune[id] || gearById(id).look.add;
  function edit(fn) {   // change the tuned copy of the piece's current shape
    const id = C.piece; if (!id) return;
    if (!C.tune[id]) C.tune[id] = copy(gearById(id).look.add);
    const a = C.tune[id][C.shape]; if (!a) return;
    fn(a); lookChanged();
  }
  const getPath = (a, p) => { const [k, i] = p.split('.'); const v = a[k]; return i === undefined || !Array.isArray(v) ? v : v[+i]; };
  function setPath(a, p, x) { const [k, i] = p.split('.'); if (i === undefined) a[k] = x; else { if (!Array.isArray(a[k])) a[k] = [a[k], a[k], a[k]]; a[k][+i] = x; } }

  function build() {
    rows.length = 0; root.textContent = '';
    const head = el('header', '', undefined, root); head.innerHTML = '<b>WARDROBE</b><span><small>Shift+Tab</small> <button title="close">×</button></span>';
    head.querySelector('button').onclick = () => F.toggle();
    const nav = el('nav', '', undefined, root);
    for (const t of TABS) { const b = el('button', C.tab === t ? 'on' : '', t, nav); b.onclick = () => { C.tab = t; save(); build(); }; }
    body = el('div', '', undefined, root);
    ({look: buildLook, stats: buildStats, items: buildItems, outfits: buildOutfits})[C.tab]();
    msgEl = el('div', 'w-msg', '', root);
    sync();
  }

  function buildLook() {
    h5('Character');
    {
      const {r} = row('Loadout', 'O in dev mode does the same; the gear shows on a live model (the gunslinger; ?live=1: the outlaw too)');
      select(r, LOADOUTS.map((L, i) => [i, L[0]]), () => hero.loadI, v => setLoadout(+v));
    }
    const liveN = note();
    rows.push(() => { put(liveN, 'textContent', host.live ? '' : 'a sprite loadout: the gear\'s look won\'t show (its effects do)'); put(liveN.style, 'display', host.live ? 'none' : ''); });
    btns([{text: '⟲ 45°', go: () => ask(() => host.setYaw(host.yaw - 45 * DEG))}, {text: 'Spin', go: () => { C.spin = !C.spin; save(); }, on: () => C.spin, title: 'the camera turns slowly round him'},
      {text: '45° ⟳', go: () => ask(() => host.setYaw(host.yaw + 45 * DEG))}]);

    h5('Clothes');
    for (const slot of SLOTS) {
      const {r} = row(SLOT_NAMES[slot]);
      select(r, [['', '— own —'], ...GEAR.filter(g => g.slot === slot).map(g => [g.id, g.name])],
        () => wearing().find(id => gearById(id).slot === slot) || '',
        v => wear([...wearing().filter(id => gearById(id).slot !== slot), ...(v ? [v] : [])]));
    }
    btns([{text: 'Random outfit', go: randomOutfit}, {text: 'All off', go: () => wear([])}]);
    const sum = note();
    rows.push(() => {
      const st = setStats(wearing());
      put(sum, 'textContent', `${st.kg.toFixed(1)} kg · armor ${Math.round(st.armor * 100)}% · speed ${Math.round(st.speed * 100)}%${gear()?.S.waiting ? ' · waiting for the server' : ''}`);
    });

    h5('Paint (test colours)');
    const MATS = Object.keys(MATERIALS).map(m => [m, m.replace('_', ' ')]);
    {
      const {r} = row('Colour', 'what "picked colour" paints with');
      const c = el('input', '', undefined, r); c.type = 'color'; c.value = C.custom;
      c.oninput = () => { C.custom = c.value; if (Object.values(C.paint).includes('custom') || C.cloth === 'custom') lookChanged(); else saveT = .3; };
      c.onchange = () => c.blur();
      rows.push(() => put(c, 'value', C.custom));
    }
    const Z = zonesNow();
    for (const z of Object.keys(Z)) {
      if (!Z[z].length) continue;
      const {r} = row(z, Z[z].join(', '));
      select(r, [['', '—'], ['hide', 'hidden'], ['custom', 'picked colour'], ...MATS], () => C.paint[z] || '', v => { if (v) C.paint[z] = v; else delete C.paint[z]; lookChanged(); });
      rows.push(() => r.classList.toggle('on', !!C.paint[z]));
    }
    {
      const {r} = row('duster tail', "the gunslinger's runtime cloth panel");
      select(r, [['', '—'], ['off', 'off'], ['custom', 'picked colour'], ...MATS], () => C.cloth, v => { C.cloth = v; lookChanged(); });
      rows.push(() => r.classList.toggle('on', !!C.cloth));
    }
    btns([{text: 'Clear paint', go: () => { C.paint = {}; C.cloth = ''; lookChanged(); }}]);

    h5('Piece tuner');
    if (!gearById(C.piece)?.look?.add) C.piece = '';
    {
      const {r} = row('Piece', 'choosing a piece wears it');
      select(r, [['', '—'], ...TUNABLE.map(g => [g.id, `${g.name}${C.tune[g.id] ? ' *' : ''}`])], () => C.piece,
        v => { C.piece = v; C.shape = 0; if (v && !wearing().includes(v)) wear([...wearing().filter(id => gearById(id).slot !== gearById(v).slot), v]); save(); build(); });
    }
    if (!C.piece) { note('Pick a piece to move, turn and size its shapes. * = tuned (the look only, until you copy it into content/gear.js).'); return; }
    const add = tuned(C.piece); if (!(C.shape < add.length)) C.shape = 0;
    {
      const {r} = row('Shape');
      select(r, add.map((a, i) => [i, `${a.part} (${a.shape})`]), () => C.shape, v => { C.shape = +v; save(); build(); });
    }
    const a0 = gearById(C.piece).look.add[C.shape], cur = () => tuned(C.piece)[C.shape];
    {
      const {r} = row('Material');
      select(r, MATS, () => cur().mat, v => edit(a => { a.mat = v; }));
    }
    const f3 = v => v.toFixed(3);
    ['x (his left)', 'y (his back)', 'z (up)'].forEach((label, i) => slider(label, {min: a0.at[i] - .5, max: a0.at[i] + .5, step: .005, def: a0.at[i], fmt: f3,
      get: () => cur().at[i], set: x => edit(a => { a.at[i] = x; })}));
    ['turn x', 'turn y', 'turn z'].forEach((label, i) => slider(label, {min: -180, max: 180, step: 1, def: a0.rot?.[i] || 0, fmt: v => Math.round(v) + '°',
      get: () => cur().rot?.[i] || 0, set: x => edit(a => { a.rot = a.rot || [0, 0, 0]; a.rot[i] = x; })}));
    for (const p of SIZE[a0.shape] || []) {
      const d = getPath(a0, p);
      slider(p.replace('.0', ' x').replace('.1', ' y').replace('.2', ' z'), {min: 0, max: Math.max(1, d * 2.5), step: .005, def: d, fmt: f3,
        get: () => getPath(cur(), p), set: x => edit(a => setPath(a, p, x))});
    }
    note('Body space at rest, metres: the gunslinger\'s head is z 1.28 to 1.8, his hat band at 1.65. Double-click a slider: back as authored.');
    btns([{text: 'Copy code', title: 'the piece\'s shapes as content/gear.js lines (also in the console)', go: () => clip(codeOf(gearById(C.piece), tuned(C.piece)), 'the code')},
      {text: 'Reset piece', go: () => { delete C.tune[C.piece]; lookChanged(); build(); }},
      {text: 'Reset all', title: 'every tuned piece as authored', go: () => { C.tune = {}; lookChanged(); build(); }}]);
  }

  function buildStats() {
    const top = note();
    rows.push(() => {
      const st = stats()?.S, g = gear()?.S.stats;
      put(top, 'textContent', [st ? `hp ${Math.ceil(st.hp)}/${st.maxHp}` : '', g ? `gear ${g.kg.toFixed(1)} kg, armor ${Math.round(g.armor * 100)}%, speed ${Math.round(g.speed * 100)}%` : ''].filter(Boolean).join(' · '));
    });
    h5('Modifier notes (source "wardrobe")');
    for (const n of KNOBS) {
      const def = knob0(n), mul = n.mul !== undefined;
      slider(n.label, {min: n.min, max: n.max, step: n.step ?? .05, def, title: `${n.stat} ${mul ? 'x' : '+'} · ${n.note}`, fmt: v => (mul ? '×' : '+') + v.toFixed(2),
        get: () => C.stats[n.k] ?? def, set: x => { if (Math.abs(x - def) < 1e-9) delete C.stats[n.k]; else C.stats[n.k] = x; applyNotes(); saveT = .3; }});
    }
    btns([{text: 'Reset all', go: () => { C.stats = {}; applyNotes(); save(); }}]);
    note('They hold in dev mode, on top of gear, items and the cheat panel (every note counts).');
  }

  function buildItems() {
    if (!stats()) { note('no game: nothing to give'); return; }
    h5('Items (they stack)');
    const k = kind();
    for (const it of ITEMS) {
      const d = el('div', 'w-item' + (it.only && it.only !== k ? ' off' : '')); d.title = it.desc + (it.only ? ` (${it.only} loadouts)` : '');
      const g = el('span', 'g', it.glyph, d); g.style.color = TIER[it.tier].col;
      el('span', 'n', it.name, d);
      const minus = el('button', 'w-btn sm', '−', d), c = el('span', 'c', '', d), plus = el('button', 'w-btn sm', '+', d);
      minus.onclick = () => { ask(() => giveItem(it.id, -1)); }; plus.onclick = () => { ask(() => giveItem(it.id, 1)); };
      rows.push(() => put(c, 'textContent', String(stats()?.items.get(it.id) || '')));
    }
    h5('Augments');
    for (const a of AUGMENTS) {
      const d = el('div', 'w-item' + (a.only && a.only !== k ? ' off' : '')); d.title = a.desc + (a.only ? ` (${a.only} loadouts)` : '');
      el('span', 'g', a.glyph, d); el('span', 'n', a.name, d);
      const b = el('button', 'w-btn sm', '', d); b.onclick = () => ask(() => flipAug(a.id));
      rows.push(() => { const on = !!stats()?.augs.has(a.id); put(b, 'textContent', on ? 'on' : 'off'); b.classList.toggle('on', on); });
    }
    btns([{text: 'Clear all', go: () => ask(clearBuild)}]);
    note('Dimmed: not for this weapon. A run starts empty.');
  }

  function buildOutfits() {
    h5('Save this outfit');
    {
      const {r} = row('Name');
      const t = el('input', '', undefined, r); t.type = 'text'; t.placeholder = 'e.g. winter scout';
      const go = () => {
        const name = t.value.trim() || `outfit ${C.outfits.length + 1}`;
        const o = snapshot(name), i = C.outfits.findIndex(x => x.name === name);
        if (i >= 0) C.outfits[i] = o; else C.outfits.push(o);
        save(); build(); say(`saved "${name}"`);
      };
      t.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      const b = el('button', 'w-btn sm', 'Save', r); b.onclick = go;
    }
    note('Loadout, gear, paint, tuned pieces, stats, items and augments.');
    h5('Saved');
    if (!C.outfits.length) note('none yet');
    C.outfits.forEach((o, i) => {
      const d = el('div', 'w-item');
      d.title = (o.gear || []).map(id => gearById(id)?.name).filter(Boolean).join(', ') || 'own clothes';
      el('span', 'n', o.name, d);
      const w = el('button', 'w-btn sm', 'Wear', d); w.onclick = () => wearOutfit(o);
      const x = el('button', 'w-btn sm', '×', d); x.title = 'delete'; x.onclick = () => { C.outfits.splice(i, 1); save(); build(); };
    });
    h5('Share');
    btns([{text: 'Copy link', title: 'this page with ?gear= and ?set= for what you wear (the gear only)', go: () => clip(linkOf(), 'the link')}]);
  }

  function sync() {
    if (!F.on || !body) return;
    for (const r of rows) r();
    if (msg && performance.now() - msgT > 4000) msg = '';
    put(msgEl, 'textContent', msg);
  }
  function show() {
    const vis = F.on && host.dev && game()?.mode !== 'title';
    if (vis && !body) build();
    root.classList.toggle('hidden', !vis);
    return vis;
  }

  let devWas = null, syncT = 0, loadWas = -1;
  const F = {
    name: 'wardrobe', label: 'Wardrobe', key: 'shift+tab', on: !!C.open,
    toggle() {
      if (!host.dev && !F.on) return F.on;   // (dev mode only)
      F.on = !F.on; C.open = F.on; save();
      if (show()) sync();
      return F.on;
    },
    onKey(k, e) { if (k !== 'tab' || !e?.shiftKey) return false; F.toggle(); return true; },
    update(dt) {
      if (host.dev !== devWas) { devWas = host.dev; applyNotes(); lookDirty = true; }   // (the first step too: the remembered notes and look)
      if (C.spin && host.dev && !host.lock) host.setYaw(host.yaw + dt * .5);
      // the look (gear's preview, drawn in its view) and the save: here, since frame() runs only while the panel shows
      if (lookDirty && (lookT -= dt) <= 0) { lookDirty = false; lookT = .05; applyLook(); }
      if (saveT > 0 && (saveT -= dt) <= 0) save();
      if (!queue.length) return;
      for (const fn of queue) fn();
      queue.length = 0; syncT = 0;
    },
    frame({dt}) {
      if (!show()) return;
      if (hero.loadI !== loadWas) { const re = loadWas >= 0 && C.tab === 'look'; loadWas = hero.loadI; if (re) build(); }   // (another model: its zones)
      if ((syncT -= dt) <= 0) { syncT = .25; sync(); }
    },
    menu: () => [{label: 'Wardrobe: clothes, paint, piece tuner, stats, items, outfits (Shift+Tab)', run: () => { if (!F.on) F.toggle(); }}],
    hud() {
      if (!host.dev) return '';
      const a = [], np = Object.keys(C.paint).length + (C.cloth ? 1 : 0), nt = Object.keys(C.tune).length, ns = Object.keys(C.stats).length;
      if (np) a.push(`${np} paint${np > 1 ? 's' : ''}`); if (nt) a.push(`${nt} tuned`); if (ns) a.push(`${ns} stat${ns > 1 ? 's' : ''}`); if (C.spin) a.push('spin');
      return a.length ? `<b>wardrobe</b> ${a.join(' · ')}` : '';
    },
  };
  return F;
}
