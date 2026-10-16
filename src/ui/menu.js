// THE MENU (Escape): pause + settings, plain white text in the middle of the screen, over the living world. While it's
// open the game stands still (main.js runs only the nature features: wind, foliage, wildlife, weather, clouds, fire) and
// the page blurs it (index.html #pause); drag the backdrop to look around, the wheel zooms, a click on it resumes.
// TABS: Game (resume, the run's actions), Graphics, Audio, Controls: what a player sets. A tab shows only while it has
// rows. (Test actions, feature toggles, A/B and debug views: the dev menu, dev/devmenu.js, F10 in dev mode)
// GROUPS: a tab lists its rows under group headings (opts.groups: the order); a PAGED tab (opts.paged) shows one group
// at a time instead, with a button per group above the rows (remembered on this machine, 'rb.menu'). The body scrolls.
// ITEMS come from opts.items() (main.js builds them: it owns the state they change), read fresh every time it draws:
//   {tab, group?, label, key? (a keycap hint), sub? (a setting under the row above: indented),
//    options: [...], get() -> one of them, set(v)     a choice (on / off ones read On / Off)
//    min, max, get() -> n, set(n)                      a level, in 10% steps
//    value() -> text, run(d), sizes?() -> [text]       a value it cycles itself (d = +1 / -1: the arrows; sizes: the
//                                                      values it can show, so its box keeps one width and the arrows stay put)
//    run(), main?, sound?                              an action (Resume, Start a run): closes the menu, then runs
//    keys: [[[cap, ...], what], ...]                   a read-only list of keys
//    id + keep: true | 'param'                         a player setting remembered on this machine (localStorage
//                                                      'rb.settings'); 'param': unless the URL sets it (?depth=0)}
// SOUNDS: the forge's wooden UI family (audio/forge/recipes/ui.js) through opts.sound(name): hover, click, confirm,
// back, open.
// OWNS: the #pause DOM, the open tab and group, focus, 'rb.settings', 'rb.menu'. READS: opts.items(), opts.title().
// BUDGET: nothing per frame; the DOM is rebuilt only when something changes.
const TABS = [['game', 'Game'], ['graphics', 'Graphics'], ['audio', 'Audio'], ['controls', 'Controls']];
const STORE = 'rb.settings', PAGES = 'rb.menu';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const isSwitch = it => it.options?.length === 2 && it.options.includes('on') && it.options.includes('off');
const pct = (it, v) => Math.round((v - it.min) / ((it.max - it.min) || 1) * 100) + '%';

export function createMenu({root, items, title = () => ['Paused', ''], groups = {}, paged = [], sound = () => {},
  changed = () => {}, resume = () => {}, look = () => {}, zoom = () => {}}) {
  root.innerHTML = `<div id="menu"></div><div class="m-hint">drag to look around · wheel to zoom · click to resume</div>`;
  const panel = root.querySelector('#menu');
  let open = false, tab = 'game', list = [], hov = '', drag = null, cats = [];
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) {}
  let page = {}; try { page = JSON.parse(localStorage.getItem(PAGES) || '{}') || {}; } catch (e) {}   // paged tab -> its open group

  function remember(it) {
    if (!it.keep || !it.id) return;
    saved[it.id] = it.get(); try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) {}
  }
  const tabsShown = () => TABS.filter(([id]) => list.some(it => it.tab === id));

  // plain text rows: "Label   On", "Label   ‹ value ›" (sliders too: 10% steps)
  function row(it, i) {
    if (it.keys) return `<div class="m-keys">${it.keys.map(([k, what]) => `<div><span>${esc([].concat(k).join(' '))}</span><span>${esc(what)}</span></div>`).join('')}</div>`;
    if (it.run && !it.value) return `<button class="m-act${it.main ? ' main' : ''}${it.tab !== 'game' ? ' tool' : ''}" data-i="${i}">${esc(it.label)}</button>`;   // (tool: a test action, smaller)
    const sw = isSwitch(it), v = String(it.run ? it.value() : it.min !== undefined ? pct(it, it.get()) : sw ? (it.get() === 'on' ? 'On' : 'Off') : it.get());
    const all = it.options || it.sizes?.() || (it.min !== undefined ? ['100%'] : []);
    return `<button class="m-row${it.sub ? ' sub' : ''}" data-i="${i}"${sw ? ` role="switch" aria-checked="${it.get() === 'on'}"` : ''}><span>${esc(it.label)}${it.key ? `<small>${esc(it.key)}</small>` : ''}</span>` +
      `<span class="m-val">${sw ? esc(v) : `<i data-d="-1">‹</i>${fit(all, v)}<i data-d="1">›</i>`}</span></button>`;
  }
  // the value in a box as wide as the widest it can be (every value it can take stacked in one grid cell, only the current
  // one shown: index.html .m-v), so the arrows stay put while it changes and the same spot clicks again
  const fit = (all, v) => `<span class="m-v">${[...new Set([...all.map(String), v])].map(t => `<span${t === v ? ' class="on"' : ''}>${esc(t)}</span>`).join('')}</span>`;

  function draw() {
    const body = panel.querySelector('.m-body'), top = body?.scrollTop || 0, fd = document.activeElement?.dataset || {}, fi = fd.i, fc = fd.cat;
    list = items();
    const tabs = tabsShown();
    if (!tabs.some(t => t[0] === tab)) tab = tabs[0]?.[0] || 'graphics';
    // rows by group: the tab's preferred order first (opts.groups), the rest as they come
    const mine = list.map((it, i) => [it, i]).filter(([it]) => it.tab === tab), order = [...(groups[tab] || [])];
    for (const [it] of mine) if (!order.includes(it.group || '')) order.push(it.group || '');
    const used = order.filter(g => mine.some(([it]) => (it.group || '') === g)), pg = paged.includes(tab);
    cats = pg ? used : [];
    if (pg && !cats.includes(page[tab])) page[tab] = cats[0];
    const rows = [];
    for (const g of pg ? [page[tab]] : used) {
      if (g && !pg) rows.push(`<h4>${esc(g)}</h4>`);
      for (const [it, i] of mine) if ((it.group || '') === g) rows.push(row(it, i));
    }
    const [head, sub] = title();
    panel.innerHTML = `<header><div><div class="m-title">${esc(head)}</div>${sub ? `<div class="m-sub">${esc(sub)}</div>` : ''}</div>
        <button class="m-close" data-close title="Resume">Esc</button></header>
      <nav>${tabs.map(([id, name]) => `<button class="m-tab${id === tab ? ' on' : ''}" data-tab="${id}">${name}</button>`).join('')}</nav>
      ${cats.length ? `<div class="m-cats">${cats.map(g => `<button class="m-cat${g === page[tab] ? ' on' : ''}" data-cat="${esc(g)}">${esc(g || 'Other')}</button>`).join('')}</div>` : ''}
      <div class="m-body">${rows.join('')}</div>`;
    panel.querySelector('.m-body').scrollTop = top;
    if (fi !== undefined) panel.querySelector(`[data-i="${fi}"]`)?.focus({preventScroll: true});
    else if (fc !== undefined) catEl(fc)?.focus({preventScroll: true});
  }
  const catEl = g => [...panel.querySelectorAll('[data-cat]')].find(b => b.dataset.cat === g);

  function setTab(id) { if (id === tab) return; tab = id; sound('click'); draw(); panel.querySelector('.m-body').scrollTop = 0; }
  function stepTab(d) { const t = tabsShown().map(x => x[0]), i = t.indexOf(tab); if (t.length) setTab(t[(i + d + t.length) % t.length]); }
  function setCat(g) {
    if (g === page[tab] || !cats.includes(g)) return;
    page[tab] = g; try { localStorage.setItem(PAGES, JSON.stringify(page)); } catch (e) {}
    sound('click'); draw(); panel.querySelector('.m-body').scrollTop = 0;
  }
  function activate(i, d = 1) {
    const it = list[i]; if (!it) return;
    if (it.run && !it.value) { sound(it.sound || 'confirm'); resume(null); it.run(); return; }   // an action: close, then run
    if (it.run) it.run(d);
    else if (it.min !== undefined) { const st = (it.max - it.min) / 10, n = Math.max(0, Math.min(10, Math.round((it.get() - it.min) / st) + d)); it.set(+(it.min + n * st).toFixed(4)); }
    else if (it.options) { const o = it.options, c = o.indexOf(it.get()); it.set(o[((c < 0 ? 0 : c + d) % o.length + o.length) % o.length]); }
    else return;
    sound('click'); remember(it); changed(); draw();
  }

  panel.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { resume('back'); return; }
    const tb = e.target.closest('[data-tab]'); if (tb) { setTab(tb.dataset.tab); return; }
    const cb = e.target.closest('[data-cat]'); if (cb) { setCat(cb.dataset.cat); return; }
    const el = e.target.closest('[data-i]'); if (!el) return;
    activate(+el.dataset.i, +(e.target.closest('[data-d]')?.dataset.d || 1));
  });
  panel.addEventListener('pointerover', e => {
    const el = e.target.closest('[data-i], [data-tab], [data-cat], [data-close]'), k = el ? el.dataset.i ?? el.dataset.tab ?? (el.dataset.cat !== undefined ? 'c:' + el.dataset.cat : 'x') : '';
    if (k !== hov) { hov = k; if (k) sound('hover'); }
  });
  // the backdrop: drag to turn the camera, the wheel zooms, a click resumes
  root.addEventListener('pointerdown', e => {
    if (e.target !== root && !e.target.classList.contains('m-hint')) return;
    drag = {x: e.clientX, moved: 0}; root.setPointerCapture(e.pointerId); root.classList.add('turning');
  });
  root.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x; drag.x = e.clientX; drag.moved += Math.abs(dx); if (dx) look(dx); });
  root.addEventListener('pointerup', () => { if (!drag) return; const click = drag.moved < 4; drag = null; root.classList.remove('turning'); if (click) resume('back'); });
  root.addEventListener('wheel', e => { if (panel.contains(e.target)) return; e.preventDefault(); zoom(e); }, {passive: false});   // zoom(the WheelEvent)

  return {
    get open() { return open; },
    show() {
      open = true; tab = 'game'; hov = ''; root.classList.remove('hidden'); draw(); sound('open');
      (panel.querySelector('.m-act.main') || panel.querySelector('.m-body [data-i]'))?.focus({preventScroll: true});
    },
    hide(snd = 'back') { if (!open) return; open = false; drag = null; if (snd) sound(snd); root.classList.add('hidden'); },
    refresh() { if (open) draw(); },
    // keys while open (main.js forwards them; Escape is main's): Tab / Q / E change tab, arrows (or WASD) move and change
    // values, Enter / Space press (the browser's own button handling). In a paged tab, up from the first row reaches the
    // group buttons: left / right there change the group, down goes back to the rows
    key(k, e) {
      if (k === 'tab' || k === 'q' || k === 'e') { e.preventDefault(); if (!e.repeat) stepTab(k === 'q' || (k === 'tab' && e.shiftKey) ? -1 : 1); return; }
      if (e.repeat && 'wasd'.includes(k)) return;   // still held from play: only the arrows repeat
      const els = [...panel.querySelectorAll('.m-body [data-i]')], cur = els.indexOf(document.activeElement), it = cur >= 0 ? list[+els[cur].dataset.i] : null;
      const v = k === 'arrowdown' || k === 's' ? 1 : k === 'arrowup' || k === 'w' ? -1 : 0, h = k === 'arrowright' || k === 'd' ? 1 : k === 'arrowleft' || k === 'a' ? -1 : 0;
      const onCat = document.activeElement?.dataset?.cat;
      if (onCat !== undefined && (v || h)) {
        e.preventDefault();
        if (h) { const g = cats[((cats.indexOf(onCat) + h) % cats.length + cats.length) % cats.length]; setCat(g); catEl(g)?.focus({preventScroll: true}); }
        else if (v > 0 && els.length) { els[0].focus({preventScroll: true}); els[0].scrollIntoView({block: 'nearest'}); sound('hover'); }
        return;
      }
      if (v) {
        e.preventDefault(); if (!els.length) return;
        if (cur === 0 && v < 0 && cats.length) { catEl(page[tab])?.focus({preventScroll: true}); sound('hover'); return; }
        const j = cur < 0 ? (v > 0 ? 0 : els.length - 1) : Math.max(0, Math.min(els.length - 1, cur + v));
        if (j !== cur) { els[j].focus({preventScroll: true}); els[j].scrollIntoView({block: 'nearest'}); sound('hover'); }
      } else if (h) {
        e.preventDefault();
        if (it && (it.options || it.min !== undefined || (it.run && it.value))) activate(+els[cur].dataset.i, h); else if (cur < 0 && !e.repeat) stepTab(h);
      }
    },
    // at boot, once the features exist: the player's remembered settings (the URL wins: ?depth=0 in the bench)
    restore(Q) {
      for (const it of items()) {
        if (!it.keep || !it.id || !(it.id in saved) || (typeof it.keep === 'string' && Q.has(it.keep))) continue;
        const v = saved[it.id];
        if (it.options ? it.options.includes(v) : typeof v === 'number') try { if (it.get() !== v) it.set(v); } catch (e) { console.warn('menu: restore', it.id, e); }
      }
      changed();
    },
  };
}
