// MADE TIP: the card over a made thing (the pack panel's bag slot: features/pack.js slotTip; the workshop panel's: ui/workshoppanel.js):
// its icon, its name, what it is made of ("birch haft, shard inlay"), what its haft does, the maker's line ("Forged by Ann on day 4,
// of cave iron and home-woods birch.") and its history ("Felled 212 trees"), two lines of it; Shift shows them all. Pixel art like
// the gear card (ui/geartip.js: the same frame and font), no numbers that read like "+8%".
// API: madeTip() -> the one card (made on first use): show(rec, e) / move(e) / hide(); rec: a record (content/workshop.js).
// OWNS: #madetip and its style. READS: content/workshop.js, content/items.js, content/gear.js. BUDGET: DOM writes when the record
//   or Shift changes; a move: one style write.
import {ITEMS} from '../content/items.js';
import {gearById} from '../content/gear.js';
import {WOODS, makerLine, recLines, recWhat} from '../content/workshop.js';
import {FRAMES, uiUnit} from './pixelframe.js';
import {loadPixelFont} from './pixelfont.js';
import {iconURL} from './packpanel.js';
import {gearIcon} from './gearicons.js';

const CSS = `
#madetip { --u: 2px; position: fixed; left: 0; top: 0; z-index: 41; pointer-events: none; width: calc(132 * var(--u)); padding: calc(3 * var(--u)) calc(4 * var(--u));
  color: #efe6cf; font: calc(10 * var(--u)) / calc(11 * var(--u)) RiftPixel, ui-monospace, Consolas, monospace; font-synthesis: none; image-rendering: pixelated;
  border: calc(3 * var(--u)) solid transparent; border-image: var(--mt-panel) 3 fill / calc(3 * var(--u)); box-sizing: border-box; }
#madetip.hidden { display: none; }
#madetip b { font-weight: 400; color: #f2c95c; }
#madetip .mt-top { display: flex; gap: calc(4 * var(--u)); align-items: center; margin-bottom: calc(3 * var(--u)); }
#madetip .mt-top img { flex: 0 0 auto; width: calc(18 * var(--u)); height: calc(18 * var(--u)); image-rendering: pixelated; padding: var(--u);
  border: calc(2 * var(--u)) solid transparent; border-image: var(--mt-well) 2 fill / calc(2 * var(--u)); box-sizing: content-box; }
#madetip .mt-top small, #madetip .mt-dim { display: block; font-size: inherit; color: #a39478; }
#madetip .mt-maker { margin-top: calc(2 * var(--u)); color: #d8c8a0; }
#madetip .mt-line { margin-top: calc(2 * var(--u)); }
#madetip .mt-hint { margin-top: calc(3 * var(--u)); color: #6e6250; }`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const ICON = {};
const iconOf = id => ICON[id] ??= ITEMS[id]?.icon ? iconURL(ITEMS[id].icon, ITEMS[id].pal) : gearById(id) ? gearIcon(gearById(id)) || '' : '';

let tip = null;
export function madeTip() { return tip ??= createTip(); }

function createTip() {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'madetip'; root.className = 'hidden'; document.body.appendChild(root);
  root.style.setProperty('--mt-panel', FRAMES.panel()); root.style.setProperty('--mt-well', FRAMES.well());
  loadPixelFont();
  let rec = null, shift = false, key = '', px = 0, py = 0;
  function html(r) {
    const d = ITEMS[r.item], g = gearById(r.item), name = d?.name || g?.name || r.item, what = recWhat(r), W = WOODS[r.haft];
    let s = `<div class="mt-top"><img src="${iconOf(r.item)}"><div><b>${esc(name)}</b>${what ? `<small>${esc(what)}</small>` : ''}</div></div>`;
    if (W?.trait) s += `<div class="mt-dim">The ${esc(W.name)} haft ${esc(W.trait)}.</div>`;
    if (r.inlay) s += '<div class="mt-dim">Its shards light the rock at each blow.</div>';
    s += `<div class="mt-maker">${esc(makerLine(r))}</div>`;
    const L = recLines(r, shift), all = recLines(r, true);
    for (const l of L) s += `<div class="mt-line">${esc(l)}.</div>`;
    if (!shift && all.length > L.length) s += '<div class="mt-hint">Shift: all of it</div>';
    return s;
  }
  function place() {
    const r = root.getBoundingClientRect(), gap = 8 * uiUnit();
    let x = px + gap, y = py + gap;
    if (x + r.width > innerWidth - 4) x = px - gap - r.width;
    if (y + r.height > innerHeight - 4) y = Math.max(4, innerHeight - 4 - r.height);
    root.style.transform = `translate(${Math.max(4, Math.round(x))}px, ${Math.round(y)}px)`;
  }
  function render() {
    if (!rec) return;
    const k = JSON.stringify(rec) + shift;
    if (k !== key) { key = k; root.innerHTML = html(rec); }
    place();
  }
  const onKey = e => { if (e.key === 'Shift' && rec && shift !== (e.type === 'keydown')) { shift = e.type === 'keydown'; render(); } };
  addEventListener('keydown', onKey); addEventListener('keyup', onKey);
  return {
    show(r, e) { if (!r) return this.hide(); rec = r; px = e.clientX; py = e.clientY; shift = !!e.shiftKey; root.style.setProperty('--u', uiUnit() + 'px'); root.classList.remove('hidden'); render(); },
    move(e) { if (!rec) return; px = e.clientX; py = e.clientY; if (!!e.shiftKey !== shift) { shift = !!e.shiftKey; render(); } else place(); },
    hide() { rec = null; key = ''; root.classList.add('hidden'); },
  };
}
