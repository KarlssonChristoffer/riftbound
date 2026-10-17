// THE BOOK (features/panels.js): the player's one window, a tab per kind of thing, the way Diablo-likes do it: Pack (what
// you wear and carry), Skills, Craft, Journal, Map, and any tab another feature adds. Pixel art like the rest of the game
// (ui/pixelframe.js frames, ui/pixelfont.js text; a UI pixel by the window's height), docked at the left so the world stays
// in view (the workshop's panel opens on the right beside it: ui/workshoppanel.js). A tab is a strip button; under it the
// tab's PARTS in one or two columns, each column scrolling on its own. Clicks land on the window, never on the game.
//   const B = createBook({sound}); B.tab(t) / B.part(p) / B.open(id) / B.close() / B.frame(hide) / B.isOpen / B.tabId
//   tab:  {id, title, key? (its hotkey's label), order? (left to right), cols? ([w0]: column 0's width in UI px; else halves),
//          hint? (text | () => text: the line at the bottom), badge?() -> '' | text (a small mark on its strip button and
//          the micro bar, read twice a second: something new there), shown?() -> bool (the tab listed at all)}
//   part: {id, tab, col? (0 | 1), order? (top to bottom), title? (a heading over it), shown?() -> bool,
//          ver?() -> number (its html is rebuilt only when this changes; checked every frame while its tab shows),
//          html?(esc, icon) -> string, or mount?(el) (once; it owns el's DOM) + sync?() (each time its tab shows),
//          onShow?() / onHide?() (its tab shown / hidden), frame?() (every frame while its tab shows),
//          click?(data, e, el) (a click in it: data = the dataset of the innermost element with data-* attributes, el = it),
//          menu?(data, e, el) (a right click: the same), hover?(data | null, e) (the pointer over it: the same, or none)}
//   TIPS: any element with data-tip="text" (data-tip-t: a title over it) shows a pixel card at the pointer; a plain title=""
//   attribute is turned into one the first time the pointer meets it ("Name: what it is" splits into title + text).
//   icon(id) is handed in (createBook({icon})): an item's pixel icon as a data URL (ui/packpanel.js).
// OWNS: #book, #btip, #bmicro and their style, the open tab ('rb.book': remembered on this machine).
// BUDGET: shut: nothing. Open: per frame, the current tab's parts' ver() compares; DOM writes only on a change.
import {FRAMES, uiUnit} from './pixelframe.js';
import {loadPixelFont} from './pixelfont.js';

const W = 336, H = 272;   // UI px: the window's size (never taller than the screen: it shrinks, the columns scroll)
const CSS = `
#book { --u: 2px; --ink: #efe6cf; --dim: #a39478; --key: #f2c95c; --bad: #e8a070; --good: #a8d88a;
  position: fixed; left: 10px; top: 50%; transform: translateY(-50%); z-index: 14; box-sizing: border-box;
  width: min(calc(${W} * var(--u)), calc(100vw - 20px)); height: min(calc(${H} * var(--u)), calc(100vh - 20px));
  display: flex; flex-direction: column; color: var(--ink); user-select: none; image-rendering: pixelated;
  font: calc(10 * var(--u)) / calc(11 * var(--u)) RiftPixel, ui-monospace, Consolas, monospace; font-synthesis: none;
  padding: calc(2 * var(--u)) calc(3 * var(--u)) calc(2 * var(--u));
  border: calc(3 * var(--u)) solid transparent; border-image: var(--b-panel) 3 fill / calc(3 * var(--u)); }
#book * { box-sizing: border-box; }
#book.hidden, body:has(#pause:not(.hidden)) #book, body:has(#pause:not(.hidden)) #bmicro { display: none; }
#book button { font: inherit; color: inherit; }
#book nav { display: flex; align-items: flex-end; gap: var(--u); padding: 0 0 calc(2 * var(--u)); border-bottom: var(--u) solid #4a3826; }
#book nav .b-tab { position: relative; padding: var(--u) calc(4 * var(--u)) 0; cursor: pointer; color: var(--dim); background: none; white-space: nowrap;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--b-card) 2 fill / calc(2 * var(--u)); }
#book nav .b-tab:hover { color: var(--ink); border-image-source: var(--b-hot); }
#book nav .b-tab.on { color: var(--key); border-image-source: var(--b-on); text-shadow: var(--u) var(--u) 0 #0c0907; }
#book nav .b-tab small { margin-left: calc(2 * var(--u)); font-size: inherit; color: #7d7058; }
#book nav .b-tab.on small { color: #cbb98f; }
#book nav .b-tab i { position: absolute; top: calc(-2 * var(--u)); right: calc(-2 * var(--u)); min-width: calc(7 * var(--u)); padding: 0 var(--u);
  font-style: normal; line-height: calc(8 * var(--u)); text-align: center; color: #0c0907; background: var(--key); outline: var(--u) solid #0c0907; }
#book nav .b-x { margin-left: auto; align-self: center; padding: 0 calc(2 * var(--u)); cursor: pointer; color: var(--dim); background: none; border: 0; }
#book nav .b-x:hover { color: var(--ink); }
#book .b-page { flex: 1; min-height: 0; display: grid; gap: calc(4 * var(--u)); padding-top: calc(2 * var(--u)); }
#book .b-page.hidden { display: none; }
#book .b-col { min-height: 0; overflow-y: auto; overflow-x: hidden; padding-right: calc(2 * var(--u)); scrollbar-width: thin; scrollbar-color: #7a5f3e #15100c; }
#book .b-col:empty { display: none; }
#book .b-part.hidden { display: none; }
#book .b-part + .b-part { margin-top: calc(6 * var(--u)); }
#book footer { display: flex; justify-content: space-between; gap: calc(4 * var(--u)); padding-top: calc(2 * var(--u)); margin-top: calc(2 * var(--u));
  border-top: var(--u) solid #4a3826; color: var(--dim); white-space: nowrap; overflow: hidden; }
#book footer span:first-child { overflow: hidden; text-overflow: ellipsis; }
#book h5 { margin: calc(3 * var(--u)) 0 calc(2 * var(--u)); font: inherit; color: var(--dim); text-transform: uppercase; letter-spacing: 0; }
#book .b-part > h5:first-child { margin-top: 0; }
/* the shared look a part's html can use */
#book .b-dim { color: var(--dim); } #book .b-key { color: var(--key); } #book .b-bad { color: var(--bad); } #book .b-good { color: var(--good); }
#book .b-btn { display: block; width: 100%; margin: 0 0 var(--u); padding: var(--u) calc(3 * var(--u)); text-align: left; cursor: pointer; background: none;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--b-btn) 2 fill / calc(2 * var(--u)); }
#book .b-btn:hover:not(.no) { border-image-source: var(--b-hot); }
#book .b-btn.on { border-image-source: var(--b-on); color: var(--key); }
#book .b-btn.no { color: var(--dim); cursor: default; border-image-source: var(--b-card); }
#book .b-btn small { font-size: inherit; color: var(--dim); }
#book .b-row { display: flex; align-items: center; gap: calc(3 * var(--u)); }
#book .b-row > span { flex: 1; min-width: 0; }
#book .b-grid { display: grid; gap: calc(2 * var(--u)); }
#book .b-slot { position: relative; display: grid; place-items: center; aspect-ratio: 1; line-height: 0; cursor: pointer;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--b-well) 2 fill / calc(2 * var(--u)); }
#book .b-slot:hover { border-image-source: var(--b-hot); }
#book .b-slot.on { border-image-source: var(--b-on); }
#book .b-slot.empty { cursor: default; } #book .b-slot.empty:hover { border-image-source: var(--b-well); }
#book .b-slot img { width: 80%; height: 80%; image-rendering: pixelated; }
#book .b-slot em { position: absolute; right: var(--u); bottom: var(--u); font-style: normal; line-height: 1; text-shadow: var(--u) var(--u) 0 #0c0907; }
#book .b-bar { height: calc(4 * var(--u)); margin-top: var(--u); background: #15100c; border: var(--u) solid #0c0907; }
#book .b-bar i { display: block; height: 100%; }
#book .b-none { color: var(--dim); }
#book .b-note { color: var(--dim); margin-top: calc(2 * var(--u)); }
#btip { --u: 2px; position: fixed; z-index: 40; pointer-events: none; max-width: calc(150 * var(--u)); box-sizing: border-box; color: #efe6cf;
  padding: calc(2 * var(--u)) calc(3 * var(--u)); font: calc(10 * var(--u)) / calc(11 * var(--u)) RiftPixel, ui-monospace, Consolas, monospace; font-synthesis: none;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--b-card) 2 fill / calc(2 * var(--u)); white-space: pre-line; }
#btip.hidden { display: none; }
#btip b { display: block; font-weight: 400; color: #f2c95c; margin-bottom: var(--u); }
#bmicro { --u: 2px; position: fixed; right: 10px; bottom: 10px; z-index: 13; display: flex; gap: var(--u); opacity: .55; transition: opacity .2s;
  font: calc(10 * var(--u)) / calc(11 * var(--u)) RiftPixel, ui-monospace, Consolas, monospace; font-synthesis: none; user-select: none; }
#bmicro:hover { opacity: 1; }
#bmicro.hidden { display: none; }
#bmicro button { padding: 0 calc(3 * var(--u)); color: #a39478; cursor: pointer; background: none; font: inherit;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--b-card) 2 fill / calc(2 * var(--u)); }
#bmicro button:hover { color: #efe6cf; border-image-source: var(--b-hot); }
#bmicro button.on { color: #f2c95c; border-image-source: var(--b-on); }`;

const STORE = 'rb.book';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const byOrder = (a, b) => (a.order ?? 50) - (b.order ?? 50);
// the innermost element with data-* between the target and the part's own element (the part's dataset itself excluded)
function dataOf(t, stop) {
  for (let el = t; el && el !== stop; el = el.parentElement) if (el.dataset && Object.keys(el.dataset).length && !el.dataset.tip) return el;
  return null;
}

export function createBook({sound = () => {}, icon = () => '', micro = true} = {}) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = document.createElement('div'); root.id = 'book'; root.className = 'hidden';
  const tip = document.createElement('div'); tip.id = 'btip'; tip.className = 'hidden';
  const bar = document.createElement('div'); bar.id = 'bmicro'; bar.className = micro ? '' : 'hidden';
  for (const k of ['panel', 'card', 'hot', 'on', 'btn', 'well']) for (const e of [root, tip, bar]) e.style.setProperty('--b-' + k, FRAMES[k]());
  root.innerHTML = '<nav></nav><div class="b-pages"></div><footer><span></span><span>Esc closes</span></footer>';
  document.body.append(root, tip, bar);
  loadPixelFont();
  const nav = root.querySelector('nav'), pages = root.querySelector('.b-pages'), foot = root.querySelector('footer span');
  pages.style.cssText = 'flex: 1; min-height: 0; display: flex; flex-direction: column;';

  const tabs = [], parts = [];
  let open = false, cur = '', hidden = false, navDirty = true, hintShown = null, badges = '', badgeT = 0;
  try { cur = localStorage.getItem(STORE) || ''; } catch (e) {}
  const tabOf = id => tabs.find(t => t.id === id);
  const page = t => {
    if (t.el) return t.el;
    t.el = document.createElement('div'); t.el.className = 'b-page hidden';
    t.el.style.gridTemplateColumns = t.cols ? `calc(${t.cols[0]} * var(--u)) 1fr` : '1fr 1fr';
    t.el.innerHTML = '<div class="b-col"></div><div class="b-col"></div>';
    t.el.style.flex = '1';
    pages.appendChild(t.el);
    return t.el;
  };
  // a part's element in its tab's column, in order (made when its tab is first shown, or at once if that tab is showing)
  function place(p) {
    const t = tabOf(p.tab); if (!t) return;
    const col = page(t).children[p.col ? 1 : 0];
    p.el = document.createElement('section'); p.el.className = 'b-part'; p.el.dataset.part = p.id;
    if (p.title) { const h = document.createElement('h5'); h.textContent = p.title; p.el.appendChild(h); }
    p.body = document.createElement('div'); p.el.appendChild(p.body);
    if (!p.html && !p.mount && !p.title) p.el.style.display = 'none';   // (a part with only hooks: nothing to show)
    const after = [...col.children].map(e => parts.find(q => q.el === e)).find(q => q && byOrder(p, q) < 0);
    col.insertBefore(p.el, after ? after.el : null);
    p.v = NaN; p.shownNow = true;
    if (p.mount) p.mount(p.body);
    // one column only: it takes the whole width
    const cols = page(t).children;
    t.el.style.gridTemplateColumns = !cols[1].children.length ? '1fr' : t.cols ? `calc(${t.cols[0]} * var(--u)) 1fr` : '1fr 1fr';
  }
  const tabParts = id => parts.filter(p => p.tab === id);
  function drawNav() {
    navDirty = false;
    const shown = tabs.filter(t => !t.shown || t.shown());
    nav.innerHTML = shown.map(t => `<button class="b-tab${t.id === cur ? ' on' : ''}" data-tab="${esc(t.id)}">${esc(t.title)}${t.key ? `<small>${esc(t.key.toUpperCase())}</small>` : ''}${t.badgeNow ? `<i>${esc(t.badgeNow)}</i>` : ''}</button>`).join('') +
      '<button class="b-x" data-x title="close (Esc)">x</button>';
    bar.innerHTML = shown.filter(t => t.key).map(t => `<button data-tab="${esc(t.id)}" class="${open && t.id === cur ? 'on' : ''}" title="${esc(t.title)}">${esc(t.key.toUpperCase())}</button>`).join('');
  }
  function show(id) {
    const t = tabOf(id) || tabs[0]; if (!t) return;
    const was = tabOf(cur);
    if (was && was !== t && was.el && open) { was.el.classList.add('hidden'); for (const p of tabParts(was.id)) p.onHide?.(); }
    cur = t.id; try { localStorage.setItem(STORE, cur); } catch (e) {}
    page(t).classList.remove('hidden');
    for (const p of tabParts(t.id)) { if (!p.el) place(p); p.sync?.(); p.onShow?.(); p.v = NaN; }
    hintShown = null; navDirty = true; hideTip();
  }
  function hideTip() { tip.classList.add('hidden'); tipEl = null; }

  // ---- clicks, right clicks, hovering, the tips
  root.addEventListener('mousedown', e => { e.stopPropagation(); if (!e.target.closest('input, textarea, select')) e.preventDefault(); });   // (no focus: the keys stay the game's; a click isn't a shot)
  root.addEventListener('wheel', e => e.stopPropagation(), {passive: true});
  root.addEventListener('click', e => {
    if (e.target.closest('[data-x]')) { api.close(); sound('back'); return; }
    const tb = e.target.closest('[data-tab]'); if (tb && nav.contains(tb)) { if (tb.dataset.tab !== cur) { show(tb.dataset.tab); sound('click'); } return; }
    const sec = e.target.closest('[data-part]'), p = sec && parts.find(q => q.id === sec.dataset.part); if (!p?.click) return;
    const el = dataOf(e.target, sec); p.click(el ? el.dataset : {}, e, el); sound('click');
  });
  root.addEventListener('contextmenu', e => {
    e.preventDefault();
    const sec = e.target.closest('[data-part]'), p = sec && parts.find(q => q.id === sec.dataset.part); if (!p?.menu) return;
    const el = dataOf(e.target, sec); p.menu(el ? el.dataset : {}, e, el);
  });
  let tipEl = null, hovPart = null, hovEl = null;
  root.addEventListener('mousemove', e => {
    // the hover hook: the part under the pointer gets the innermost data-* element (or null) when it changes
    const sec = e.target.closest('[data-part]'), p = sec && parts.find(q => q.id === sec.dataset.part), el = p ? dataOf(e.target, sec) : null;
    if (p !== hovPart || el !== hovEl) { if (hovPart && hovPart !== p) hovPart.hover?.(null, e); hovPart = p; hovEl = el; p?.hover?.(el ? el.dataset : null, e); } else p?.hover?.(el ? el.dataset : null, e);
    // the card
    let t = e.target.closest('[data-tip], [title]');
    if (t && !root.contains(t)) t = null;
    if (t && t.hasAttribute('title')) {   // (a browser title: made into a pixel card, once)
      const s = t.getAttribute('title'); t.removeAttribute('title');
      if (s) { const m = /^([^:.]{1,40}): (.+)$/s.exec(s); if (m && !t.dataset.tipT) { t.dataset.tipT = m[1]; t.dataset.tip = m[2]; } else t.dataset.tip = s; }
    }
    if (t && !t.dataset.tip) t = null;
    if (t !== tipEl) {
      tipEl = t;
      if (!t) { tip.classList.add('hidden'); return; }
      tip.innerHTML = (t.dataset.tipT ? `<b>${esc(t.dataset.tipT)}</b>` : '') + esc(t.dataset.tip);
      tip.classList.remove('hidden');
    }
    if (tipEl) {
      const r = tip.getBoundingClientRect(), x = e.clientX + 14, y = e.clientY + 16;
      tip.style.left = Math.max(4, Math.min(innerWidth - r.width - 4, x)) + 'px';
      tip.style.top = Math.max(4, Math.min(innerHeight - r.height - 4, y > innerHeight - r.height - 4 ? e.clientY - r.height - 8 : y)) + 'px';
    }
  });
  root.addEventListener('mouseleave', e => { hideTip(); if (hovPart) { hovPart.hover?.(null, e); hovPart = hovEl = null; } });
  bar.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); });
  bar.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { api.toggle(b.dataset.tab); sound(open ? 'open' : 'back'); } });

  const api = {
    get isOpen() { return open; },
    get tabId() { return cur; },
    tab(t) {
      const i = tabs.findIndex(q => q.id === t.id);
      if (i >= 0) Object.assign(tabs[i], t); else { tabs.push({...t}); tabs.sort(byOrder); }
      navDirty = true; return api;
    },
    part(p) {
      if (parts.some(q => q.id === p.id)) return api;
      parts.push(p);
      if (tabOf(p.tab) && (tabOf(p.tab).el || p.mount)) place(p);   // (its tab's page exists, or it mounts its own DOM: in at once; else when it first shows)
      if (open && p.tab === cur) { p.sync?.(); p.onShow?.(); }
      return api;
    },
    open(id) {
      const t = tabOf(id ?? cur) || tabs[0]; if (!t) return;
      if (!open) { open = true; root.classList.remove('hidden'); const u = uiUnit() + 'px'; for (const e of [root, tip, bar]) e.style.setProperty('--u', u); cur = ''; }
      if (t.id !== cur) show(t.id);
      navDirty = true;
    },
    close() {
      if (!open) return;
      open = false; root.classList.add('hidden'); hideTip(); navDirty = true;
      const t = tabOf(cur); if (t?.el) { t.el.classList.add('hidden'); for (const p of tabParts(t.id)) p.onHide?.(); }
    },
    toggle(id) { if (open && (id === undefined || id === cur)) api.close(); else api.open(id); },
    // every frame: hidden while the HUD is off (photo mode, the title) or the game locked; the current tab's parts redrawn on change
    frame(hide) {
      if (hide !== hidden) { hidden = hide; root.style.visibility = bar.style.visibility = hide ? 'hidden' : ''; if (hide) hideTip(); }
      // the tabs' badges (a count on the strip: cheap strings, compared)
      const now = performance.now();
      if (now - badgeT > 400) { badgeT = now; let b = ''; for (const t of tabs) { const v = t.badge?.() || ''; t.badgeNow = v; b += v + '|'; } if (b !== badges) { badges = b; navDirty = true; } }
      if (navDirty) drawNav();
      if (!open || hide) return;
      const t = tabOf(cur); if (!t) return;
      const hint = typeof t.hint === 'function' ? t.hint() : t.hint || '';
      if (hint !== hintShown) { hintShown = hint; foot.textContent = hint; }
      for (const p of parts) {
        if (p.tab !== cur || !p.el) continue;
        const s = !p.shown || !!p.shown();
        if (s !== p.shownNow) { p.shownNow = s; p.el.classList.toggle('hidden', !s); if (s) p.v = NaN; }
        if (!s) continue;
        if (p.html) { const v = p.ver ? p.ver() : 0; if (v !== p.v) { p.v = v; p.body.innerHTML = p.html(esc, icon); if (tipEl && !root.contains(tipEl)) hideTip(); } }
        p.frame?.();
      }
    },
    has: id => !!tabOf(id),
    redraw(id) { const p = parts.find(q => q.id === id); if (p) p.v = NaN; },
    esc,
  };
  return api;
}
