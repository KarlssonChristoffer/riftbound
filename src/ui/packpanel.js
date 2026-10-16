// THE PACK PANEL (Tab; features/pack.js): the bag's slots, the pouch's materials, the skills with their XP, and the builds
// the pouch pays for. A DOM panel (clicks land on it, not on the game's canvas: no shot), rebuilt only when what it shows
// changed (the inventory's, the skills' versions, the held slot, the recipes' affordability); hidden under the pause menu,
// in photo mode and behind the title. The items' pixel icons (content/items.js: fills only) are drawn once each with an
// outline round them, as data URLs at 1 px per pixel, scaled up crisp by the CSS. Pixel art like the gear panel beside it
// (ui/pixelfont.js, ui/pixelframe.js; a UI pixel by the window's height), centred, never taller than the window: it scrolls.
//   const panel = createPackPanel({host, inv, skills, ITEMS, SKILLS, recipes, sections, held, ask}); panel.toggle() / .open / .frame()
//   (sections: other systems' parts of the panel, drawn after the skills: pack.section; recipes under their group's heading)
//   iconURL(rows, pal) -> a data URL (exported: features/fishing.js draws its journal's unknown catches as silhouettes)
// OWNS: the panel's element and its open state. READS: the inventory, the skills, the recipes (pack.recipe). Clicks: ask(r)
// (pack carries a recipe out in the sim step).
import {PAL} from '../content/items.js';
import {FRAMES, uiUnit} from './pixelframe.js';
import {loadPixelFont} from './pixelfont.js';

const CSS = `
#pack { --u: 2px; --ink: #efe6cf; --dim: #a39478; --key: #f2c95c;
  position: fixed; left: 10px; top: 50%; transform: translateY(-50%); z-index: 14; width: calc(164 * var(--u)); max-height: calc(100vh - 32px); overflow: auto;
  padding: calc(3 * var(--u)) calc(4 * var(--u)); color: var(--ink); user-select: none; scrollbar-width: thin; scrollbar-color: #7a5f3e #15100c;
  font: calc(10 * var(--u)) / calc(11 * var(--u)) RiftPixel, ui-monospace, Consolas, monospace; font-synthesis: none; image-rendering: pixelated;
  border: calc(3 * var(--u)) solid transparent; border-image: var(--p-panel) 3 fill / calc(3 * var(--u)); box-sizing: border-box; }
#pack * { box-sizing: border-box; }
#pack.hidden, body:has(#pause:not(.hidden)) #pack { display: none; }
#pack header { display: flex; justify-content: space-between; align-items: baseline; }
#pack header b { font-weight: 400; color: var(--key); letter-spacing: var(--u); text-shadow: var(--u) var(--u) 0 #0c0907; }
#pack header small { color: var(--dim); font-size: inherit; }
#pack h5 { margin: calc(4 * var(--u)) 0 calc(2 * var(--u)); font: inherit; color: var(--dim); text-transform: uppercase; }
#pack .p-bag { display: grid; grid-template-columns: repeat(4, 1fr); gap: calc(2 * var(--u)); }
#pack .p-slot { position: relative; display: grid; place-items: center; aspect-ratio: 1; line-height: 0;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--p-well) 2 fill / calc(2 * var(--u)); }
#pack .p-slot.held { border-image-source: var(--p-on); }
#pack .p-slot img { width: calc(28 * var(--u)); height: calc(28 * var(--u)); image-rendering: pixelated; }
#pack .p-slot em { position: absolute; right: var(--u); bottom: var(--u); font-style: normal; line-height: 1; text-shadow: var(--u) var(--u) 0 #0c0907; }
#pack .p-row { display: flex; align-items: center; gap: calc(3 * var(--u)); padding: 0 0 var(--u); }
#pack .p-row img { width: calc(14 * var(--u)); height: calc(14 * var(--u)); image-rendering: pixelated; }
#pack .p-row span { flex: 1; }
#pack .p-row em { font-style: normal; color: var(--key); }
#pack .p-none { color: var(--dim); }
#pack .p-skill { padding: 0 0 calc(2 * var(--u)); }
#pack .p-skill div { display: flex; flex-wrap: wrap; justify-content: space-between; column-gap: calc(4 * var(--u)); }
#pack .p-skill small { margin-left: auto; color: var(--dim); font-size: inherit; }
#pack .p-bar { height: calc(4 * var(--u)); margin-top: var(--u); background: #15100c; border: var(--u) solid #0c0907; }
#pack .p-bar i { display: block; height: 100%; }
#pack .p-build { display: flex; flex-wrap: wrap; justify-content: space-between; column-gap: calc(4 * var(--u)); width: 100%; margin: 0 0 var(--u);
  padding: 0 calc(2 * var(--u)); font: inherit; color: var(--ink); text-align: left; cursor: pointer; background: none;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--p-btn) 2 fill / calc(2 * var(--u)); }
#pack .p-build:hover:not(.no) { border-image-source: var(--p-hot); }
#pack .p-build small { margin-left: auto; color: #cbb98f; font-size: inherit; }
#pack .p-build.no { color: var(--dim); cursor: default; border-image-source: var(--p-card); }
#pack .p-build.no small { color: #7d7058; }
#pack .p-bag.p-grid7 { grid-template-columns: repeat(7, 1fr); gap: var(--u); }
#pack .p-grid7 .p-slot img { width: calc(14 * var(--u)); height: calc(14 * var(--u)); }
#pack .p-grid7 .p-slot em { right: 0; bottom: 0; }
#pack .p-slot.p-dim img { opacity: .7; }
#pack .p-note { color: var(--dim); margin-top: calc(2 * var(--u)); }`;

const OUTLINE = '#1a120c';
// an icon (12 x 12 rows of palette letters; pal: its own letters over PAL's) -> a 14 x 14 data URL: its fills, then an outline in
// every clear pixel next to one
export function iconURL(rows, pal = null) {
  const n = 14, c = document.createElement('canvas'); c.width = c.height = n;
  const q = c.getContext('2d'), filled = (x, y) => y >= 0 && y < rows.length && x >= 0 && x < rows[y].length && rows[y][x] !== '.';
  for (let y = -1; y <= rows.length; y++) for (let x = -1; x <= 12; x++) {
    const ch = filled(x, y) ? rows[y][x] : null;
    if (ch) { q.fillStyle = pal?.[ch] || PAL[ch] || '#f0f'; q.fillRect(x + 1, y + 1, 1, 1); }
    else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) { q.fillStyle = OUTLINE; q.fillRect(x + 1, y + 1, 1, 1); }
  }
  return c.toDataURL();
}

export function createPackPanel({host, inv, skills, ITEMS, SKILLS, recipes, sections = [], held, ask}) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'pack'; el.className = 'hidden'; document.body.appendChild(el);
  for (const k of ['panel', 'well', 'on', 'btn', 'hot', 'card']) el.style.setProperty('--p-' + k, FRAMES[k]());
  loadPixelFont();
  const ICON = {};
  const icon = id => ICON[id] ??= ITEMS[id]?.icon ? iconURL(ITEMS[id].icon, ITEMS[id].pal) : '';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  let open = false, kInv = -1, kSk = -1, kHeld = -2, kN = -1, kT = 0, kSec = -1;
  const secVer = () => { let v = 0; for (const s of sections) v = (v * 31 + s.ver()) | 0; return v; };
  const costText = c => Object.entries(c).map(([id, n]) => `${n} ${ITEMS[id]?.name || id}`).join(', ');
  const afford = r => Object.entries(r.cost || {}).every(([id, n]) => inv.count(id) >= n) && !(r.can?.());

  function build() {
    let h = '<header><b>PACK</b><small>Tab</small></header><h5>Bag</h5><div class="p-bag">';
    inv.bag.forEach((s, i) => {
      const d = s && ITEMS[s.id];
      h += `<div class="p-slot${i === held() ? ' held' : ''}"${d ? ` title="${esc(d.name)}: ${esc(d.desc)}"` : ''}>`;
      if (d) h += `<img src="${icon(s.id)}" alt="">${s.n > 1 ? `<em>${s.n}</em>` : ''}`;
      h += '</div>';
    });
    h += '</div><h5>Pouch</h5>';
    if (!inv.pouch.size) h += '<div class="p-none">nothing gathered yet</div>';
    for (const [id, n] of inv.pouch) { const d = ITEMS[id]; h += `<div class="p-row" title="${esc(d.desc)}"><img src="${icon(id)}" alt=""><span>${esc(d.name)}</span><em>${n}</em></div>`; }
    h += '<h5>Skills</h5>';
    for (const id in SKILLS) {
      const S = SKILLS[id], L = skills.level(id), x = skills.xp(id), sp = skills.span(id), k = sp.next > sp.at ? (x - sp.at) / (sp.next - sp.at) : 1;
      h += `<div class="p-skill"><div><span>${esc(S.name)}</span><small>Lv ${L} · ${Math.floor(x)}${sp.next > sp.at ? ' / ' + sp.next : ''} xp</small></div>`;
      h += `<div class="p-bar"><i style="width:${(k * 100).toFixed(1)}%;background:${S.col}"></i></div></div>`;
    }
    for (const s of sections) h += `<h5>${esc(s.title)}</h5>` + s.html(esc, icon);
    // (the recipes under their group's heading, in the order the groups came: Build, Cook, Bait ...)
    for (const g of new Set(recipes.map(r => r.group || 'Build'))) {
      h += `<h5>${esc(g)}</h5>`;
      recipes.forEach((r, i) => { if ((r.group || 'Build') === g) h += `<button class="p-build${afford(r) ? '' : ' no'}" data-r="${i}"${r.desc ? ` title="${esc(r.desc)}"` : ''}><span>${esc(r.name)}</span><small>${esc(costText(r.cost || {}))}</small></button>`; });
    }
    el.innerHTML = h;
  }
  el.addEventListener('click', e => {
    const b = e.target.closest('.p-build'); if (!b) return;
    const r = recipes[+b.dataset.r]; if (r) ask(r);
  });
  el.addEventListener('mousedown', e => e.stopPropagation());   // (a click on the panel isn't a shot)

  return {
    get open() { return open; },
    toggle() { open = !open; kInv = -1; el.classList.toggle('hidden', !open); if (open) el.style.setProperty('--u', uiUnit() + 'px'); },
    // each frame while open: rebuilt when the bag, the pouch, the skills, the held slot or the recipes changed, and twice a
    // second while there are recipes (whether one can be built here: room, a fire nearby)
    frame() {
      if (!open) return;
      const hide = !!host.hudOff || !!host.lock;
      if (hide !== el.classList.contains('hidden')) el.classList.toggle('hidden', hide);
      if (hide) return;
      const now = performance.now(), h = held();
      const sv = secVer();
      if (inv.ver !== kInv || skills.ver !== kSk || h !== kHeld || recipes.length !== kN || sv !== kSec || (recipes.length && now - kT > 500)) {
        kInv = inv.ver; kSk = skills.ver; kHeld = h; kN = recipes.length; kSec = sv; kT = now; build();
      }
    },
  };
}
