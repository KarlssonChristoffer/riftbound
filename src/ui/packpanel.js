// THE PACK'S TABS (features/pack.js; drawn in the player's window, ui/book.js through features/panels.js): what the pack owns,
// spread over the window's tabs the way Diablo-likes do it instead of one long panel.
//   PACK     (col 1; the gear's part, features/gear.js, is col 0) the BAG's slots (a click: that tool swings for its job; a made
//            thing's card over it: tips, pack.slotTip) and the POUCH's materials as a grid (a right click: Put down)
//   SKILLS   the skills with their levels and XP bars (col 0); the picked one's moves had and the next one's level, the titles
//            (a click wears one; how many are left to earn) (col 1)
//   CRAFT    the recipes' groups (Build, Cook, Make, Bait ...: col 0) and the picked group's recipes (col 1) with what each
//            costs against what you carry (short ones in red) and why one can't be made here (r.can())
//   JOURNAL  other systems' sections (pack.section: the catch journal, the cook journal ...): their titles (col 0) and the picked
//            one (col 1); their html keeps the p-* classes (styled here) and data-sec="<id>" buttons (its click(data, ask))
// Each part is rebuilt only when what it shows changed (the inventory's, the skills' versions, the held slot, the sections'
// versions; the recipes twice a second while their tab shows: whether one can be made here, room, a fire nearby).
//   const panel = createPackPanel({book, inv, skills, ITEMS, SKILLS, recipes, sections, held, ask, pick, tips, put, moves,
//     movesVer, titles, wear}); panel.toggle() / .open / .frame()   (book: features/panels.js; the rest as before)
//   iconURL(rows, pal) -> a data URL (exported: features/fishing.js draws its journal's unknown catches as silhouettes)
//   itemIcon(id) -> an item's icon as a data URL, cached (through iconHook: another system's look for it now)
//   iconHook.of(id) -> {icon, pal, key} | null: another system's look for an item now (features/keepsakes.js: the tally stick's
//   notches; key changes when it does), iconHook.ver (bumped by it: the parts redraw). descOf(d) -> what an item's card says:
//   its desc, or for one with `lies` (content/items.js: the Fiddle String) one of them, a new one each time the pack opens
// OWNS: the pack's parts (their picks: the skill, the group, the section). READS: the inventory, the skills, the recipes
// (pack.recipe), the sections (pack.section). Clicks: ask(r) (pack carries a recipe out in the sim step).
import {PAL, ITEMS as ALL_ITEMS} from '../content/items.js';

const CSS = `
#book .p-bag { display: grid; grid-template-columns: repeat(4, 1fr); gap: calc(2 * var(--u)); }
#book .p-slot { position: relative; display: grid; place-items: center; aspect-ratio: 1; line-height: 0;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--b-well) 2 fill / calc(2 * var(--u)); }
#book .p-slot.held { border-image-source: var(--b-on); }
#book .p-slot img { width: 80%; height: 80%; image-rendering: pixelated; }
#book .p-slot em { position: absolute; right: var(--u); bottom: var(--u); font-style: normal; line-height: 1; text-shadow: var(--u) var(--u) 0 #0c0907; }
#book .p-row { display: flex; align-items: center; gap: calc(3 * var(--u)); padding: 0 0 var(--u); }
#book .p-row img { width: calc(14 * var(--u)); height: calc(14 * var(--u)); image-rendering: pixelated; }
#book .p-row span { flex: 1; }
#book .p-row em { font-style: normal; color: var(--key); }
#book .p-none { color: var(--dim); }
#book .p-build { display: flex; flex-wrap: wrap; justify-content: space-between; column-gap: calc(4 * var(--u)); width: 100%; margin: 0 0 var(--u);
  padding: 0 calc(2 * var(--u)); font: inherit; color: var(--ink); text-align: left; cursor: pointer; background: none;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--b-btn) 2 fill / calc(2 * var(--u)); }
#book .p-build:hover:not(.no) { border-image-source: var(--b-hot); }
#book .p-build small { margin-left: auto; color: #cbb98f; font-size: inherit; }
#book .p-build.no { color: var(--dim); cursor: default; border-image-source: var(--b-card); }
#book .p-build.no small { color: #7d7058; }
#book .p-bag.p-grid7 { grid-template-columns: repeat(7, 1fr); gap: var(--u); }
#book .p-grid7 .p-slot img { width: 76%; height: 76%; }
#book .p-grid7 .p-slot em { right: 0; bottom: 0; }
#book .p-slot.p-dim img { opacity: .7; }
#book .p-note { color: var(--dim); margin-top: calc(2 * var(--u)); }
#book .k-bag { grid-template-columns: repeat(4, 1fr); }
#book .k-pouch { grid-template-columns: repeat(6, 1fr); gap: var(--u); }
#book .k-pouch .b-slot img { width: 76%; height: 76%; }
#book .k-pouch .b-slot em { right: 0; bottom: 0; }
#book .k-skill { padding: var(--u) calc(3 * var(--u)) calc(2 * var(--u)); }
#book .k-skill div { display: flex; justify-content: space-between; gap: calc(3 * var(--u)); }
#book .k-big { font-size: calc(20 * var(--u)); line-height: calc(20 * var(--u)); }
#book .k-move { margin: calc(2 * var(--u)) 0 0; }
#book .k-move small { display: block; font-size: inherit; color: #a89c84; }
#book .k-cost { display: flex; flex-wrap: wrap; gap: var(--u) calc(4 * var(--u)); margin-top: var(--u); }
#book .k-cost span { display: inline-flex; align-items: center; gap: var(--u); }
#book .k-cost img { width: calc(12 * var(--u)); height: calc(12 * var(--u)); image-rendering: pixelated; }
#book .k-make { display: flex; justify-content: space-between; gap: calc(3 * var(--u)); }
#book .k-make b { font-weight: 400; }
#book .b-btn.no .k-make b { color: var(--dim); }
#book .k-why { display: block; color: var(--bad); }`;

const OUTLINE = '#1a120c';
export const iconHook = {of: null, ver: 0};
const LIES = {i: 0};
export const descOf = d => d?.lies?.length ? d.lies[LIES.i % d.lies.length] : d?.desc ?? '';
// an icon (12 x 12 rows of palette letters; pal: its own letters over PAL's) -> a 14 x 14 data URL: its fills, then an outline in
// every clear pixel next to one
export function iconURL(rows, pal = null) { return iconCanvas(rows, pal).toDataURL(); }
const ICON = {};
export function itemIcon(id) {
  const o = iconHook.of?.(id);   // (another system's look for it now: cached by its key)
  if (o) { const k = id + '|' + o.key; return ICON[k] ??= iconURL(o.icon, o.pal); }
  return ICON[id] ??= ALL_ITEMS[id]?.icon ? iconURL(ALL_ITEMS[id].icon, ALL_ITEMS[id].pal) : '';
}
// the same, as the canvas (features/foxden.js: an item put down on the ground is a card of it)
export function iconCanvas(rows, pal = null) {
  const n = 14, c = document.createElement('canvas'); c.width = c.height = n;
  const q = c.getContext('2d'), filled = (x, y) => y >= 0 && y < rows.length && x >= 0 && x < rows[y].length && rows[y][x] !== '.';
  for (let y = -1; y <= rows.length; y++) for (let x = -1; x <= 12; x++) {
    const ch = filled(x, y) ? rows[y][x] : null;
    if (ch) { q.fillStyle = pal?.[ch] || PAL[ch] || '#f0f'; q.fillRect(x + 1, y + 1, 1, 1); }
    else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) { q.fillStyle = OUTLINE; q.fillRect(x + 1, y + 1, 1, 1); }
  }
  return c;
}

export function createPackPanel({book, inv, skills, ITEMS, SKILLS, recipes, sections = [], held, ask, pick = null, tips = [], put = null, moves = null, movesVer = () => 0, titles = null, wear = () => {}}) {
  if (!book) return null;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const icon = itemIcon;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const shown = r => !r.shown || r.shown();
  const short = (id, n) => inv.count(id) < n;
  const afford = r => Object.entries(r.cost || {}).every(([id, n]) => !short(id, n)) && !(r.can?.());
  const mix = (...v) => { let h = 17; for (const x of v) h = (h * 31 + (x | 0)) | 0; return h; };
  let putId = null, putV = 0, wasOpen = false;
  // the tabs' marks: what came into the pack, the skills that went up, since you last looked (cleared when that tab shows)
  let gotN = 0, upN = 0;
  book.tab({id: 'pack', badge: () => gotN ? '+' + Math.min(99, gotN) : ''});
  book.tab({id: 'skills', badge: () => upN ? '!' : ''});
  book.part({id: 'pack.seen', tab: 'pack', order: 99, onShow: () => { gotN = 0; }, frame: () => { gotN = 0; }});
  book.part({id: 'skills.seen', tab: 'skills', order: 99, onShow: () => { upN = 0; }, frame: () => { upN = 0; }});

  // ---- PACK: the bag (a made thing's card over its slot: tips; the panel's rebuilds don't lose it, by slot number)
  let tipAt = -1;
  const hideTips = () => { if (tipAt >= 0) { tipAt = -1; for (const t of tips) t.hide(); } };
  book.part({id: 'pack.bag', tab: 'pack', col: 1, order: 10, title: 'Bag',
    ver: () => mix(inv.ver, held(), iconHook.ver, LIES.i),
    html() {
      let h = '<div class="b-grid k-bag">';
      inv.bag.forEach((s, i) => {
        const d = s && ITEMS[s.id];
        if (!d) { h += `<div class="b-slot empty" data-i="${i}"></div>`; return; }
        const tip = s.u && tips.length ? '' : ` data-tip-t="${esc(d.name)}" data-tip="${esc(descOf(d))}${i === held() ? '\n(in hand)' : ''}"`;   // (a made thing: its card instead, ui/madetip.js)
        h += `<div class="b-slot${i === held() ? ' on' : ''}" data-i="${i}"${tip}><img src="${icon(s.id)}" alt="">${s.n > 1 ? `<em>${s.n}</em>` : ''}</div>`;
      });
      return h + '</div>';
    },
    click(d) { if (d.i !== undefined && pick && inv.bag[+d.i]) pick(+d.i); },
    hover(d, e) {
      const i = d?.i !== undefined ? +d.i : -1, at = i >= 0 && inv.bag[i]?.u ? i : -1;
      if (at !== tipAt) { tipAt = at; for (const t of tips) at >= 0 ? t.show(at, e) : t.hide(); } else if (at >= 0) for (const t of tips) t.move(e);
    },
    onHide: hideTips,
  });
  // the pouch: a grid of what you gathered (a right click: Put down, features/foxden.js)
  book.part({id: 'pack.pouch', tab: 'pack', col: 1, order: 20, title: 'Pouch',
    ver: () => mix(inv.ver, putV, iconHook.ver, LIES.i),
    html() {
      if (!inv.pouch.size) return '<div class="b-none">nothing gathered yet</div>';
      let h = '<div class="b-grid k-pouch">';
      for (const [id, n] of inv.pouch) {
        const d = ITEMS[id] || {name: id};
        h += `<div class="b-slot${id === putId ? ' on' : ''}" data-id="${esc(id)}" data-tip-t="${esc(d.name)}" data-tip="${esc(descOf(d))}\n${n} in the pouch"><img src="${icon(id)}" alt=""><em>${n}</em></div>`;
      }
      h += '</div>';
      if (put && putId && inv.pouch.has(putId)) h += `<button class="b-btn" data-put="${esc(putId)}" style="margin-top:calc(2 * var(--u))">Put down ${esc(ITEMS[putId]?.name || putId)} <small>on the ground here</small></button>`;
      return h;
    },
    click(d) { if (d.put) { put(d.put); putId = null; putV++; } },
    menu(d) { if (!put || !d.id) return; putId = putId === d.id ? null : d.id; putV++; },
  });

  // ---- SKILLS: the list, the picked one's moves, the titles
  let selS = Object.keys(SKILLS)[0] || '', selV = 0;
  const skillVer = () => mix(skills.ver, selV, movesVer());
  book.part({id: 'skills.list', tab: 'skills', col: 0, order: 10,
    ver: skillVer,
    html() {
      let h = '';
      for (const id in SKILLS) {
        const S = SKILLS[id], L = skills.level(id), x = skills.xp(id), sp = skills.span(id), k = sp.next > sp.at ? (x - sp.at) / (sp.next - sp.at) : 1;
        h += `<button class="b-btn k-skill${id === selS ? ' on' : ''}" data-s="${esc(id)}"><div><span>${esc(S.name)}</span><span style="color:${S.col}">${L}</span></div>`;
        h += `<div class="b-bar"><i style="width:${(k * 100).toFixed(1)}%;background:${S.col}"></i></div></button>`;
      }
      return h;
    },
    click(d) { if (d.s && d.s !== selS) { selS = d.s; selV++; } },
  });
  book.part({id: 'skills.detail', tab: 'skills', col: 1, order: 10,
    ver: skillVer,
    html() {
      const S = SKILLS[selS]; if (!S) return '<div class="b-none">no skills yet</div>';
      const L = skills.level(selS), x = skills.xp(selS), sp = skills.span(selS);
      let h = `<div class="b-row"><span class="k-big" style="color:${S.col}">${esc(S.name)}</span><span class="k-big">${L}</span></div>`;
      h += `<div class="b-dim">${Math.floor(x)}${sp.next > sp.at ? ` / ${sp.next} xp · ${Math.ceil(sp.next - x)} to level ${L + 1}` : ' xp · the top'}</div>`;
      if (S.desc) h += `<div class="b-note">${esc(S.desc)}</div>`;
      const M = moves?.(selS);
      h += '<h5>Moves</h5>';
      if (!M || (!M.had.length && !M.next)) h += '<div class="b-none">none yet</div>';
      else {
        for (const m of M.had) h += `<div class="k-move"><span style="color:${S.col}">${esc(m.name)}</span><small>${esc(m.line)}</small></div>`;
        if (M.next) h += `<div class="k-move b-dim">Level ${M.next}: ?</div>`;
      }
      return h;
    },
  });
  book.part({id: 'skills.titles', tab: 'skills', col: 1, order: 20, title: 'Titles',
    shown: () => !!titles,
    ver: () => mix(movesVer(), selV),
    html() {
      const ti = titles(), all = Object.keys(ti.names).length, left = all - ti.had.length;
      let h = '';
      if (!ti.had.length) h += '<div class="b-none">none earned yet</div>';
      else {
        h += '<div class="b-dim">The others see it under your name.</div>';
        for (const id of ti.had) h += `<button class="b-btn${id === ti.worn ? ' on' : ''}" data-w="${esc(id)}">${esc(ti.names[id].name)}</button>`;
        h += `<button class="b-btn${!ti.worn ? ' on' : ''}" data-w="">no title</button>`;
      }
      if (left > 0) h += `<div class="b-note">${left} more to earn, somewhere.</div>`;
      return h;
    },
    click(d) { if (d.w !== undefined) wear(d.w); },
  });

  // ---- CRAFT: the groups, the picked group's recipes
  let selG = '', selGV = 0, kT = 0;
  const groups = () => [...new Set(recipes.filter(shown).map(r => r.group || 'Build'))];
  const craftVer = () => { const now = performance.now(); if (now - kT > 500) kT = now; return mix(inv.ver, recipes.length, selGV, kT); };
  const costHTML = c => Object.entries(c || {}).map(([id, n]) => {
    const have = inv.count(id), wood = id === 'wood' && !ITEMS.wood, name = wood ? 'Wood (any logs)' : ITEMS[id]?.name || id;   // ('wood': any logs, game/inventory.js)
    return `<span data-tip-t="${esc(name)}" data-tip="you carry ${have}"><img src="${icon(wood ? 'log' : id)}" alt=""><span class="${have < n ? 'b-bad' : ''}">${n}</span></span>`;
  }).join('');
  book.part({id: 'craft.groups', tab: 'craft', col: 0, order: 10,
    ver: craftVer,
    html() {
      const G = groups(); if (!G.length) return '<div class="b-none">nothing to make yet</div>';
      if (!G.includes(selG)) selG = G[0];
      return G.map(g => {
        const L = recipes.filter(r => (r.group || 'Build') === g && shown(r)), ok = L.filter(afford).length;
        return `<button class="b-btn${g === selG ? ' on' : ''}" data-g="${esc(g)}">${esc(g)} <small>${ok}/${L.length}</small></button>`;
      }).join('');
    },
    click(d) { if (d.g && d.g !== selG) { selG = d.g; selGV++; } },
  });
  book.part({id: 'craft.list', tab: 'craft', col: 1, order: 10,
    ver: craftVer,
    html() {
      const G = groups(); if (!G.length) return '<div class="b-none">Gather wood, stone and food: what you can make shows here.</div>';
      if (!G.includes(selG)) selG = G[0];
      let h = '';
      recipes.forEach((r, i) => {
        if ((r.group || 'Build') !== selG || !shown(r)) return;
        const costOk = Object.entries(r.cost || {}).every(([id, n]) => !short(id, n)), why = costOk ? r.can?.() || '' : '', ok = costOk && !why;   // (short: the red numbers say it)
        h += `<div class="b-btn${ok ? '' : ' no'}" data-r="${i}"${r.desc ? ` data-tip-t="${esc(r.name)}" data-tip="${esc(r.desc)}"` : ''}>`;
        h += `<div class="k-make"><b>${esc(r.name)}</b>${ok ? '<span class="b-key">make</span>' : ''}</div><div class="k-cost">${costHTML(r.cost)}</div>`;
        if (why) h += `<small class="k-why">${esc(why)}</small>`;
        h += '</div>';
      });
      return h;
    },
    click(d) { const r = d.r !== undefined ? recipes[+d.r] : null; if (r) ask(r); },
  });

  // ---- JOURNAL: the sections' titles, the picked one
  let selJ = '', selJV = 0;
  const secVer = () => { let v = selJV; for (const s of sections) v = (v * 31 + s.ver()) | 0; return mix(v, sections.length, iconHook.ver); };
  book.part({id: 'journal.list', tab: 'journal', col: 0, order: 10,
    ver: () => mix(sections.length, selJV),
    html() {
      if (!sections.length) return '<div class="b-none">nothing written yet</div>';
      if (!sections.some(s => s.id === selJ)) selJ = sections[0].id;
      return sections.map(s => `<button class="b-btn${s.id === selJ ? ' on' : ''}" data-j="${esc(s.id)}">${esc(s.title)}</button>`).join('');
    },
    click(d) { if (d.j && d.j !== selJ) { selJ = d.j; selJV++; } },
  });
  book.part({id: 'journal.page', tab: 'journal', col: 1, order: 10,
    ver: secVer,
    html() {
      const s = sections.find(q => q.id === selJ) || sections[0];
      return s ? `<h5>${esc(s.title)}</h5>` + s.html(esc, icon) : '<div class="b-none">Fish, cook and look around: what you find is written here.</div>';
    },
    click(d) {
      if (!d.sec) return;
      const s = sections.find(q => q.id === d.sec); s?.click?.(d, ask);
    },
  });

  return {
    get open() { return book.isOpen; },
    toggle() { book.toggle('pack'); },
    got(n) { gotN += n; }, up() { upN++; },   // (features/pack.js: something came in, a level went up: the tab's mark)
    close() { book.close(); },
    // every frame: a fiddle string's lie each time the window opens; the made thing's card goes with the window
    frame() {
      const o = book.isOpen;
      if (o !== wasOpen) { wasOpen = o; if (o) LIES.i = Math.floor(Math.random() * 1e6); else hideTips(); }
    },
  };
}
