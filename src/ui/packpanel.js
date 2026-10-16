// THE PACK PANEL (Tab; features/pack.js): the bag's slots, the pouch's materials, the skills with their XP, and the builds
// the pouch pays for. A DOM panel (clicks land on it, not on the game's canvas: no shot), rebuilt only when what it shows
// changed (the inventory's, the skills' versions, the held slot, the recipes' affordability); hidden under the pause menu,
// in photo mode and behind the title. The items' pixel icons (content/items.js: fills only) are drawn once each with an
// outline round them, as data URLs at 1 px per pixel, scaled up crisp by the CSS.
//   const panel = createPackPanel({host, inv, skills, ITEMS, SKILLS, recipes, sections, held, ask}); panel.toggle() / .open / .frame()
//   (sections: other systems' parts of the panel, drawn after the skills: pack.section; recipes under their group's heading)
//   iconURL(rows, pal) -> a data URL (exported: features/fishing.js draws its journal's unknown catches as silhouettes)
// OWNS: the panel's element and its open state. READS: the inventory, the skills, the recipes (pack.recipe). Clicks: ask(r)
// (pack carries a recipe out in the sim step).
import {PAL} from '../content/items.js';

const CSS = `
#pack { position: fixed; left: 14px; top: 50%; transform: translateY(-58%); z-index: 14; width: 248px; padding: 9px 10px 10px;
  background: rgba(14, 16, 15, .92); border: 1px solid var(--line); border-radius: 6px; user-select: none;
  font: 12px/1.45 "Segoe UI", system-ui, sans-serif; color: var(--ink); max-height: 94vh; overflow-y: auto; }
#pack.hidden, body:has(#pause:not(.hidden)) #pack { display: none; }
#pack header { display: flex; justify-content: space-between; align-items: baseline; }
#pack header b { color: var(--key); letter-spacing: .16em; font-size: 11px; }
#pack header small { color: var(--dim); }
#pack h5 { margin: 10px 0 4px; font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--dim); }
#pack .p-bag { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
#pack .p-slot { position: relative; aspect-ratio: 1; background: rgba(255, 255, 255, .04); border: 1px solid var(--line); border-radius: 3px; }
#pack .p-slot.held { border-color: var(--key); background: rgba(240, 192, 96, .12); }
#pack .p-slot img { position: absolute; inset: 12%; width: 76%; height: 76%; image-rendering: pixelated; }
#pack .p-slot em { position: absolute; right: 3px; bottom: 0; font-style: normal; font-weight: 600; font-size: 11px; text-shadow: 0 1px 0 #000; }
#pack .p-row { display: flex; align-items: center; gap: 7px; padding: 1px 0; }
#pack .p-row img { width: 24px; height: 24px; image-rendering: pixelated; }
#pack .p-row span { flex: 1; }
#pack .p-row em { font-style: normal; font-weight: 600; font-variant-numeric: tabular-nums; }
#pack .p-none { color: var(--dim); font-size: 11px; }
#pack .p-skill { padding: 2px 0 3px; }
#pack .p-skill div { display: flex; justify-content: space-between; }
#pack .p-skill small { color: var(--dim); font-variant-numeric: tabular-nums; }
#pack .p-bar { height: 4px; margin-top: 2px; background: rgba(255, 255, 255, .08); border-radius: 2px; overflow: hidden; }
#pack .p-bar i { display: block; height: 100%; }
#pack .p-build { display: flex; justify-content: space-between; align-items: center; width: 100%; margin: 2px 0; padding: 3px 7px;
  font: inherit; color: var(--ink); background: rgba(255, 255, 255, .05); border: 1px solid var(--line); border-radius: 4px; cursor: pointer; }
#pack .p-build:hover:not(.no) { border-color: var(--key); }
#pack .p-build.no { opacity: .45; cursor: default; }
#pack .p-build small { color: var(--dim); }
#pack .p-bag.p-grid7 { grid-template-columns: repeat(7, 1fr); gap: 3px; }
#pack .p-grid7 .p-slot em { font-size: 9px; right: 2px; }
#pack .p-slot.p-dim { background: rgba(0, 0, 0, .18); }
#pack .p-note { color: var(--dim); font-size: 11px; margin-top: 3px; }`;

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
  const ICON = {};
  const icon = id => ICON[id] ??= ITEMS[id]?.icon ? iconURL(ITEMS[id].icon, ITEMS[id].pal) : '';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  let open = false, kInv = -1, kSk = -1, kHeld = -2, kN = -1, kT = 0, kSec = -1;
  const secVer = () => { let v = 0; for (const s of sections) v = (v * 31 + s.ver()) | 0; return v; };
  const costText = c => Object.entries(c).map(([id, n]) => `${n} ${ITEMS[id]?.name || id}`).join(', ');
  const shown = r => !r.shown || r.shown();
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
    // (the recipes under their group's heading, in the order the groups came: Build, Cook, Bait ...; a recipe whose shown()
    // says no is left out: features/meals.js's dishes not found yet)
    for (const g of new Set(recipes.filter(shown).map(r => r.group || 'Build'))) {
      h += `<h5>${esc(g)}</h5>`;
      recipes.forEach((r, i) => { if ((r.group || 'Build') === g && shown(r)) h += `<button class="p-build${afford(r) ? '' : ' no'}" data-r="${i}"${r.desc ? ` title="${esc(r.desc)}"` : ''}><span>${esc(r.name)}</span><small>${esc(costText(r.cost || {}))}</small></button>`; });
    }
    el.innerHTML = h;
  }
  el.addEventListener('click', e => {
    // a section's own buttons (data-sec: its id; the rest of the element's data- is the section's): its click(data, ask)
    const sb = e.target.closest('[data-sec]');
    if (sb) { const s = sections.find(q => q.id === sb.dataset.sec); s?.click?.(sb.dataset, ask); return; }
    const b = e.target.closest('.p-build'); if (!b) return;
    const r = recipes[+b.dataset.r]; if (r) ask(r);
  });
  el.addEventListener('mousedown', e => e.stopPropagation());   // (a click on the panel isn't a shot)

  return {
    get open() { return open; },
    toggle() { open = !open; kInv = -1; el.classList.toggle('hidden', !open); },
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
