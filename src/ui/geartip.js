// GEAR TIP: the card that follows the pointer over a piece of gear (the wardrobe's tiles: dev/wardrobe.js; the gear panel's:
// ui/gearpanel.js). It shows the piece's icon, name (in its rarity's colour), rarity, kind and slot, what it is, its weight
// and armor, what it does now and what it will do later. Holding SHIFT shows more: its materials, every modifier note it
// sets, what it changes on the model (zones painted or hidden, shapes added) and what wearing it does to the set worn now
// (weight, armor, speed: before -> after). A KEEPSAKE (a charm: docs/KEEPSAKES.md) shows only what it is: its icon, name and
// description (the Fiddle String's lie of the moment: ui/packpanel.js descOf), never a number or what it does, Shift or not.
// API: gearTip() -> the one tip (made on first use): attach(el, {piece: () => g | null, slot, set: () => [ids]}) (null: "his
//   own", the slot empty); hide(). doesOf(g) -> what it does now, as short lines (also the wardrobe's and the panel's).
// OWNS: #geartip and its style. READS: content/gear.js. BUDGET: DOM writes when the piece or Shift changes; a move: 2 style writes.
import {SLOT_NAMES, KINDS, RARITY, MATERIALS, RULES, gearById, setStats} from '../content/gear.js';
import {FRAMES, uiUnit} from './pixelframe.js';
import {loadPixelFont} from './pixelfont.js';
import {gearIcon, slotIcon} from './gearicons.js';
import {ITEMS} from '../content/items.js';
import {iconURL, iconHook, descOf} from './packpanel.js';
import {statWords} from '../content/fishing.js';
import {statWords as forageWords} from '../content/forage.js';
import {statWords as mineWords} from '../content/mining.js';

const CSS = `
#geartip { --u: 2px; position: fixed; left: 0; top: 0; z-index: 40; pointer-events: none; width: calc(128 * var(--u)); padding: calc(3 * var(--u)) calc(4 * var(--u));
  color: #efe6cf; font: calc(10 * var(--u)) / calc(11 * var(--u)) RiftPixel, ui-monospace, Consolas, monospace; font-synthesis: none; image-rendering: pixelated;
  border: calc(3 * var(--u)) solid transparent; border-image: var(--gt-panel) 3 fill / calc(3 * var(--u)); }
#geartip.hidden { display: none; }
#geartip b { font-weight: 400; }
#geartip .gt-top { display: flex; gap: calc(4 * var(--u)); align-items: center; margin-bottom: calc(3 * var(--u)); }
#geartip .gt-top img { flex: 0 0 auto; width: calc(18 * var(--u)); height: calc(18 * var(--u)); image-rendering: pixelated; padding: var(--u);
  border: calc(2 * var(--u)) solid transparent; border-image: var(--gt-well) 2 fill / calc(2 * var(--u)); box-sizing: content-box; }
#geartip .gt-top small, #geartip .gt-dim { display: block; font-size: inherit; color: #a39478; }
#geartip .gt-key { color: #f2c95c; }
#geartip .gt-line { margin-top: calc(2 * var(--u)); }
#geartip .gt-soon { color: #a39478; }
#geartip .gt-hint { margin-top: calc(3 * var(--u)); color: #6e6250; }
#geartip .gt-adv { margin-top: calc(4 * var(--u)); padding-top: calc(3 * var(--u)); border-top: var(--u) solid #4a3826; }
#geartip .gt-adv > div { margin-top: calc(2 * var(--u)); }
#geartip .gt-adv u { text-decoration: none; color: #f2c95c; text-transform: uppercase; display: block; }
#geartip .gt-chip { display: inline-block; width: calc(6 * var(--u)); height: calc(6 * var(--u)); margin-right: calc(2 * var(--u)); border: var(--u) solid #0c0907; vertical-align: calc(-1 * var(--u)); }
#geartip .gt-up { color: #7ad07a; } #geartip .gt-down { color: #e2644d; }`;

const pct = v => Math.round(v * 100) + '%';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const nice = s => s.replace(/_/g, ' ');

// what a piece does now (its armor and its modifier notes), in words
export function doesOf(g) {
  const out = [];
  if (g.armor) out.push(`takes ${pct(g.armor)} off the damage you take`);
  for (const m of g.mods || []) {
    if (m.stat === 'light.lantern') out.push('your lantern is always lit');
    else if (m.stat === 'light.lanternR') out.push(m.mul >= 1 ? `its light reaches ${pct(m.mul - 1)} further` : 'a smaller light');
    else if (m.stat === 'player.speed') out.push(`you move ${pct(m.mul - 1)} faster`);
    else if (m.stat === 'weapon.melee') out.push(`your blow (V) hits x${m.mul}`);
    else { const w = statWords(m) || forageWords(m) || mineWords(m); if (w) out.push(w); }   // (fishing: content/fishing.js; foraging: content/forage.js; mining: content/mining.js)
  }
  if (g.slot === 'main' && g.kind === 'fishing') out.unshift('LMB on water: cast');
  return out;
}
// a modifier note as written: stat x mul / + add
const noteOf = m => `${m.stat} ${m.mul !== undefined ? 'x' + m.mul : (m.add >= 0 ? '+' : '') + m.add}`;

let tip = null;
export function gearTip() { return tip ??= createTip(); }

function createTip() {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'geartip'; root.className = 'hidden'; document.body.appendChild(root);
  root.style.setProperty('--gt-panel', FRAMES.panel()); root.style.setProperty('--gt-well', FRAMES.well());
  loadPixelFont();
  let cur = null, shift = false, shownKey = '', px = 0, py = 0;

  function html(c) {
    const g = c.piece();
    if (!g && c.slot === 'charm') return `<div class="gt-top"><img src="${slotIcon('charm', '#8a7c64')}"><div><b>No charms</b><small>Charms</small></div></div>`;
    if (g?.keepsake) {   // (what it is, never what it does)
      const d = iconHook.of?.(g.id) || ITEMS[g.id], R = RARITY[g.rarity];
      return `<div class="gt-top"><img src="${d?.icon ? iconURL(d.icon, d.pal) : slotIcon('charm', '#efe6cf')}"><div><b style="color:${R?.col ?? ''}">${esc(g.name)}</b>` +
        `<small>${R?.name ?? ''} keepsake · Charms</small></div></div><div>${esc(descOf(ITEMS[g.id]) || g.desc)}</div>`;
    }
    if (!g) {
      const name = SLOT_NAMES[c.slot] || 'Slot';
      return `<div class="gt-top"><img src="${slotIcon(c.slot, '#8a7c64')}"><div><b>His own</b><small>${name}</small></div></div>` +
        `<div class="gt-dim">The ${name.toLowerCase()} as the model was made: no weight, no armor.</div>`;
    }
    const R = RARITY[g.rarity], does = doesOf(g);
    let s = `<div class="gt-top"><img src="${gearIcon(g) || slotIcon(g.slot, '#efe6cf')}"><div><b style="color:${R?.col ?? ''}">${esc(g.name)}</b>` +
      `<small>${R?.name ?? ''} ${(KINDS[g.kind] || '').toLowerCase()} · ${SLOT_NAMES[g.slot]}</small></div></div>` +
      `<div>${esc(g.desc)}</div><div class="gt-line"><span class="gt-key">${g.weight} kg</span>${g.armor ? ` · <span class="gt-key">armor ${pct(g.armor)}</span>` : ''}</div>` +
      (does.length ? `<div class="gt-line">Now: ${esc(does.join('; '))}.</div>` : '') +
      (g.soon ? `<div class="gt-line gt-soon">Later: ${esc(g.soon)}${/yet\)?$/.test(g.soon) ? '' : ' (not in the game yet)'}</div>` : '');
    if (!shift) return s + '<div class="gt-hint">Shift: more</div>';
    const L = g.look || {}, mats = [...new Set([...Object.values(L.paint || {}), ...(L.add || []).map(a => a.mat), ...(L.cloth && L.cloth !== 'off' ? [L.cloth] : [])])];
    const adv = [];
    if (mats.length) adv.push(`<u>Materials</u>${mats.map(m => `<span class="gt-chip" style="background:${MATERIALS[m]?.[1] ?? '#888'}"></span>${nice(m)}`).join('<br>')}`);
    const notes = [`gear weight +${g.weight} kg (${RULES.FREE_KG} kg free)`, ...(g.armor ? [`gear armor +${pct(g.armor)} (at most ${pct(RULES.ARMOR_MAX)})`] : []), ...(g.mods || []).map(noteOf)];
    adv.push(`<u>Modifiers</u>${notes.map(esc).join('<br>')}`);
    const look = [];
    if (L.paint) look.push(`paints ${Object.keys(L.paint).join(', ')}`);
    if (L.hide?.length) look.push(`hides ${L.hide.join(', ')}`);
    if (L.add?.length) look.push(`${L.add.length} shape${L.add.length > 1 ? 's' : ''} on ${[...new Set(L.add.map(a => a.on))].join(', ')}`);
    if (L.cloth) look.push(L.cloth === 'off' ? 'no coat tail' : `coat tail in ${nice(L.cloth)}`);
    if (look.length) adv.push(`<u>On the model</u>${esc(look.join('; '))}`);
    const ids = c.set?.() || null;
    if (ids) {
      if (ids.includes(g.id)) adv.push('<u>Your set</u>worn now');
      else {
        const next = [...ids.filter(id => gearById(id)?.slot !== g.slot), g.id], a = setStats(ids), b = setStats(next);
        const row = (label, x, y, f, better) => `${label} ${f(x)} -> <span class="${y === x ? '' : better(y, x) ? 'gt-up' : 'gt-down'}">${f(y)}</span>`;
        adv.push(`<u>If you wear it</u>${[row('weight', a.kg, b.kg, v => v.toFixed(1) + ' kg', (y, x) => y < x), row('armor', a.armor, b.armor, pct, (y, x) => y > x),
          row('speed', a.speed, b.speed, pct, (y, x) => y > x)].join('<br>')}`);
      }
    }
    adv.push(`<span class="gt-dim">id ${esc(g.id)}</span>`);
    return s + `<div class="gt-adv">${adv.map(x => `<div>${x}</div>`).join('')}</div>`;
  }
  function render() {
    if (!cur) return;
    const g = cur.piece(), key = `${g?.id ?? 'own:' + cur.slot}|${shift}|${cur.set?.()?.join(',') ?? ''}`;
    if (key !== shownKey) { shownKey = key; root.innerHTML = html(cur); }
    place();
  }
  function place() {   // beside the pointer, kept on screen
    const r = root.getBoundingClientRect(), u = uiUnit(), gap = 8 * u;
    let x = px + gap, y = py + gap;
    if (x + r.width > innerWidth - 4) x = px - gap - r.width;
    if (y + r.height > innerHeight - 4) y = Math.max(4, innerHeight - 4 - r.height);
    root.style.transform = `translate(${Math.max(4, Math.round(x))}px, ${Math.round(y)}px)`;
  }
  function show(c, e) {
    cur = c; px = e.clientX; py = e.clientY; shift = !!e.shiftKey;
    root.style.setProperty('--u', uiUnit() + 'px'); root.classList.remove('hidden'); shownKey = ''; render();
  }
  function hide() { cur = null; root.classList.add('hidden'); }
  const onShift = e => { if (e.key !== 'Shift' || !cur) return; const v = e.type === 'keydown'; if (v !== shift) { shift = v; render(); } };
  addEventListener('keydown', onShift, true); addEventListener('keyup', onShift, true);
  addEventListener('blur', () => { if (shift) { shift = false; render(); } });
  return {
    attach(el, c) {
      el.addEventListener('pointerenter', e => show(c, e));
      el.addEventListener('pointermove', e => { if (cur !== c) return show(c, e); px = e.clientX; py = e.clientY; if (!!e.shiftKey !== shift) shift = !!e.shiftKey; render(); });
      el.addEventListener('pointerleave', () => { if (cur === c) hide(); });
      el.addEventListener('click', () => { if (cur === c) { shownKey = ''; render(); } });   // (worn now: the set changed)
    },
    hide,
    refresh() { if (cur) { shownKey = ''; render(); } },
  };
}
