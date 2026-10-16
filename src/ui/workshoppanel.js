// WORKSHOP PANEL: the furnace or the anvil he stands by (features/workshop.js; Tab, on the right while the pack's panel is up on
// the left). Pixel art like the gear panel (ui/pixelframe.js, ui/pixelfont.js): no bars, no numbers that read like a stat; the
// heat is said in words ("orange: the iron is soft and red, not yet") and shown as the mouth's colour.
//   FURNACE  the glow, the charge in it (in words), the bellows; buttons: load copper / iron, fit a bellows; how to feed and pump
//   ANVIL    what lies on it (and the blows so far), the things it makes (an icon each, its cost), for a tool the haft (the logs he
//            carries, each with what it does) and the shard inlay; "Lay it on the anvil"; how to hammer
//   const P = createWorkshopPanel({ask}); P.show(model) (redrawn only when the model's key changed) / P.hide(); P.open
//   model (features/workshop.js panelModel): {key, kind: 'furnace', glow (a css colour), words, charge (words | ''), bel, burning,
//   loads: [{v, label, cost, ok, why}], fit: {label, cost, ok, why} | null} or {key, kind: 'anvil', work: {name, n, of} | null,
//   recipes: [{v, name, icon, cost, ok, sel}], hafts: [{v, name, trait, icon, n, sel}] | null, inlay: {cost, ok, on} | null,
//   go: {ok, why}}; a click on a button asks ask(a, v): load / fit (v: the ore), recipe / haft (v: its id), inlay, lay (carried
//   out in the sim step)
// OWNS: #workshop and its style. READS: the model it is given. BUDGET: closed: nothing; open: a string compare a frame, DOM
//   writes when it changed.
import {FRAMES, uiUnit} from './pixelframe.js';
import {loadPixelFont} from './pixelfont.js';

const CSS = `
#workshop { --u: 2px; --ink: #efe6cf; --dim: #a39478; --key: #f2c95c; --bad: #e8a070;
  position: fixed; right: 10px; top: 50%; transform: translateY(-50%); z-index: 15; width: calc(168 * var(--u)); max-height: calc(100vh - 120px); overflow: auto;
  padding: calc(3 * var(--u)) calc(4 * var(--u)); color: var(--ink); user-select: none; scrollbar-width: thin; scrollbar-color: #7a5f3e #15100c;
  font: calc(10 * var(--u)) / calc(11 * var(--u)) RiftPixel, ui-monospace, Consolas, monospace; font-synthesis: none; image-rendering: pixelated;
  border: calc(3 * var(--u)) solid transparent; border-image: var(--w-panel) 3 fill / calc(3 * var(--u)); box-sizing: border-box; }
#workshop * { box-sizing: border-box; }
#workshop.hidden { display: none; }
body:has(#pause:not(.hidden)) #workshop { visibility: hidden; }
#workshop header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: calc(3 * var(--u)); }
#workshop header b { font-weight: 400; color: var(--key); letter-spacing: var(--u); text-shadow: var(--u) var(--u) 0 #0c0907; }
#workshop header small, #workshop .w-dim { color: var(--dim); font-size: inherit; }
#workshop h5 { margin: calc(4 * var(--u)) 0 calc(2 * var(--u)); font: inherit; color: var(--dim); text-transform: uppercase; }
#workshop .w-glow { display: flex; gap: calc(4 * var(--u)); align-items: center; }
#workshop .w-mouth { flex: 0 0 auto; width: calc(14 * var(--u)); height: calc(10 * var(--u)); border: calc(2 * var(--u)) solid transparent;
  border-image: var(--w-well) 2 fill / calc(2 * var(--u)); background-clip: padding-box; }
#workshop .w-line { margin-top: calc(2 * var(--u)); }
#workshop .w-row { display: flex; flex-wrap: wrap; gap: calc(2 * var(--u)); }
#workshop button { font: inherit; color: var(--ink); background: none; cursor: pointer; padding: calc(2 * var(--u)) calc(3 * var(--u)); text-align: left;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--w-btn) 2 fill / calc(2 * var(--u)); }
#workshop button:hover { border-image-source: var(--w-hot); }
#workshop button.on { border-image-source: var(--w-on); }
#workshop button.no { color: var(--dim); cursor: default; }
#workshop button.no:hover { border-image-source: var(--w-btn); }
#workshop button.it { display: flex; gap: calc(3 * var(--u)); align-items: center; }
#workshop button img { width: calc(14 * var(--u)); height: calc(14 * var(--u)); image-rendering: pixelated; }
#workshop button small { display: block; font-size: inherit; color: var(--dim); }
#workshop .w-go { margin-top: calc(4 * var(--u)); width: 100%; text-align: center; color: var(--key); }
#workshop .w-hint { margin-top: calc(5 * var(--u)); padding-top: calc(3 * var(--u)); border-top: var(--u) solid #4a3826; color: var(--dim); }
#workshop .w-bad { color: var(--bad); }`;

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const btn = (a, v, ok, inner, cls = '') => `<button class="${cls}${ok ? '' : ' no'}" data-a="${a}" data-v="${esc(v)}">${inner}</button>`;
function furnaceHTML(m) {
  let h = '<header><b>CLAY FURNACE</b><small>Tab</small></header>';
  h += `<div class="w-glow"><div class="w-mouth" style="background:${m.glow}"></div><div>${esc(m.words)}${m.burning ? '' : '<br><span class="w-dim">no fire in it</span>'}</div></div>`;
  h += `<div class="w-line">${m.charge ? esc(m.charge) : '<span class="w-dim">Nothing in it.</span>'}</div>`;
  h += `<div class="w-line w-dim">${m.bel ? 'A bellows is fitted.' : 'The birch blowpipe.'}</div>`;
  h += '<h5>Load</h5><div class="w-row">';
  for (const L of m.loads) h += btn('load', L.v, L.ok, `${esc(L.label)}<small>${esc(L.ok ? L.cost : L.why)}</small>`);
  h += '</div>';
  if (m.fit) h += `<h5>Fit</h5><div class="w-row">${btn('fit', '', m.fit.ok, `${esc(m.fit.label)}<small>${esc(m.fit.ok ? m.fit.cost : m.fit.why)}</small>`)}</div>`;
  h += `<div class="w-hint">E feeds it a log. LMB on it pumps; ${m.bel ? 'the bellows blows hard' : 'alone it won\'t pass orange: a friend pumping too, or a bellows'}.</div>`;
  return h;
}
function anvilHTML(m) {
  let h = '<header><b>STONE ANVIL</b><small>Tab</small></header>';
  h += `<div class="w-line">${m.work ? `On it: <b>${esc(m.work.name)}</b> <span class="w-dim">(${m.work.n} of ${m.work.of})</span>` : '<span class="w-dim">Nothing on it.</span>'}</div>`;
  h += '<h5>Make</h5><div class="w-row">';
  for (const r of m.recipes) h += btn('recipe', r.v, true, `<img src="${r.icon}" alt=""><span>${esc(r.name)}<small${r.ok ? '' : ' class="w-bad"'}>${esc(r.cost)}</small></span>`, 'it' + (r.sel ? ' on' : ''));
  h += '</div>';
  if (m.hafts) {
    h += '<h5>Haft</h5><div class="w-row">';
    if (!m.hafts.length) h += '<span class="w-bad">no logs in the pouch</span>';
    for (const w of m.hafts) h += btn('haft', w.v, true, `<img src="${w.icon}" alt=""><span>${esc(w.name)}<small>${esc(w.trait || 'a plain haft')}</small></span>`, 'it' + (w.sel ? ' on' : ''));
    h += '</div>';
  }
  if (m.inlay) h += `<h5>Inlay</h5><div class="w-row">${btn('inlay', '', m.inlay.ok || m.inlay.on, `Glow shards in the head<small${m.inlay.ok || m.inlay.on ? '' : ' class="w-bad"'}>${esc(m.inlay.cost)}</small>`, m.inlay.on ? 'on' : '')}</div>`;
  h += btn('lay', '', m.go.ok, m.go.ok ? 'Lay it on the anvil' : esc(m.go.why), 'w-go');
  h += '<div class="w-hint">LMB on the anvil hammers; a blow in rhythm counts twice.</div>';
  return h;
}

export function createWorkshopPanel({ask}) {
  let root = null, body = null, key = '';
  function build() {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    root = document.createElement('div'); root.id = 'workshop'; root.className = 'hidden';
    for (const [k, v] of [['panel', FRAMES.panel()], ['btn', FRAMES.btn()], ['hot', FRAMES.hot()], ['on', FRAMES.on()], ['well', FRAMES.well()]]) root.style.setProperty('--w-' + k, v);
    loadPixelFont();
    root.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });   // (no focus: the keys stay the game's; a click isn't a shot)
    root.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b && !b.classList.contains('no')) ask(b.dataset.a, b.dataset.v || ''); });
    body = document.createElement('div'); root.appendChild(body);
    document.body.appendChild(root);
  }
  return {
    get open() { return !!root && !root.classList.contains('hidden'); },
    show(m) {
      if (!root) build();
      if (root.classList.contains('hidden')) { root.classList.remove('hidden'); root.style.setProperty('--u', uiUnit() + 'px'); key = ''; }
      if (m.key !== key) { key = m.key; body.innerHTML = m.kind === 'anvil' ? anvilHTML(m) : furnaceHTML(m); }
    },
    hide() { if (root && !root.classList.contains('hidden')) { root.classList.add('hidden'); key = ''; } },
  };
}
