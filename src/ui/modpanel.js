// MOD PANEL: the weapon bench (features/mods.js; M, or a tab of the game's menus when they mount it). Pixel art like the workshop
// panel (ui/pixelframe.js, ui/pixelfont.js). The weapon in hand at the top with the type it deals now; its three slots (the
// slot's name is the weapon's: a gun's Chamber / Barrel / Grip, a bow's Arrowhead / Fletching / Grip, a staff's Crystal / Head /
// Wrap); the parts in the kit that fit the chosen slot (a click fits one, a click on the fitted one takes it out); the ones you
// haven't found, as riddles; the reactions you have seen, as a reminder.
//   const P = createModPanel({ask}); P.show(model, el?) (redrawn only when model.key changed; el: mount into it instead of its own
//   box) / P.hide(); P.open
//   model (features/mods.js panelModel): {key, weapon: {name, kind, elem: {name, col}}, slots: [{slot, label, id, name, icon,
//   desc, col, sel}], desc (the chosen slot's part, or its hint), parts: [{id, name, icon, desc, col, on, ok, why}], riddles:
//   [string], reacts: [{name, says}], others: [{name, line}]}; a click asks ask(a, v): slot (v: its id), fit (v: the part),
//   out (v: the slot), close
// OWNS: #modbench and its style. READS: the model. BUDGET: closed: nothing; open: a string compare a frame, DOM writes on change.
import {FRAMES} from './pixelframe.js';
import {loadPixelFont} from './pixelfont.js';

const CSS = `
#modbench { --u: 2px; --ink: #efe6cf; --dim: #a39478; --key: #f2c95c; --bad: #e8a070;
  position: fixed; right: 10px; top: 50%; transform: translateY(-50%); z-index: 16; width: calc(184 * var(--u)); max-height: calc(100vh - 100px); overflow: auto;
  padding: calc(3 * var(--u)) calc(4 * var(--u)); color: var(--ink); user-select: none; scrollbar-width: thin; scrollbar-color: #7a5f3e #15100c;
  font: calc(10 * var(--u)) / calc(11 * var(--u)) RiftPixel, ui-monospace, Consolas, monospace; font-synthesis: none; image-rendering: pixelated;
  border: calc(3 * var(--u)) solid transparent; border-image: var(--m-panel) 3 fill / calc(3 * var(--u)); box-sizing: border-box; }
#modbench.mounted { position: static; transform: none; width: auto; max-height: none; border: 0; padding: 0; }
#modbench * { box-sizing: border-box; }
#modbench.hidden { display: none; }
body:has(#pause:not(.hidden)) #modbench:not(.mounted) { visibility: hidden; }
#modbench header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: calc(2 * var(--u)); }
#modbench header b { font-weight: 400; color: var(--key); letter-spacing: var(--u); text-shadow: var(--u) var(--u) 0 #0c0907; }
#modbench header button { border: 0; background: none; color: var(--dim); font: inherit; cursor: pointer; padding: 0; }
#modbench .mb-dim { color: var(--dim); }
#modbench h5 { margin: calc(5 * var(--u)) 0 calc(2 * var(--u)); font: inherit; color: var(--dim); text-transform: uppercase; }
#modbench .mb-slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: calc(2 * var(--u)); margin-top: calc(3 * var(--u)); }
#modbench .mb-slots button { display: flex; flex-direction: column; align-items: center; gap: calc(1 * var(--u)); text-align: center; min-height: calc(44 * var(--u)); }
#modbench .mb-slots button small { color: var(--dim); font-size: inherit; }
#modbench .mb-slots .mb-empty { width: calc(14 * var(--u)); height: calc(14 * var(--u)); border: calc(2 * var(--u)) solid transparent;
  border-image: var(--m-well) 2 fill / calc(2 * var(--u)); }
#modbench button { font: inherit; color: var(--ink); background: none; cursor: pointer; padding: calc(2 * var(--u)) calc(3 * var(--u)); text-align: left;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--m-btn) 2 fill / calc(2 * var(--u)); }
#modbench button:hover { border-image-source: var(--m-hot); }
#modbench button.on { border-image-source: var(--m-on); }
#modbench button.no { color: var(--dim); cursor: default; }
#modbench button.no:hover { border-image-source: var(--m-btn); }
#modbench .mb-list { display: flex; flex-direction: column; gap: calc(2 * var(--u)); }
#modbench .mb-list button { display: flex; gap: calc(4 * var(--u)); align-items: center; }
#modbench img { width: calc(14 * var(--u)); height: calc(14 * var(--u)); image-rendering: pixelated; flex: 0 0 auto; }
#modbench .mb-list small { display: block; color: var(--dim); font-size: inherit; }
#modbench .mb-desc { margin-top: calc(3 * var(--u)); min-height: calc(22 * var(--u)); }
#modbench .mb-riddle { color: var(--dim); margin-top: calc(1 * var(--u)); }
#modbench .mb-riddle::before { content: '? '; color: var(--key); }
#modbench .mb-react { margin-top: calc(1 * var(--u)); }
#modbench .mb-hint { margin-top: calc(5 * var(--u)); padding-top: calc(3 * var(--u)); border-top: var(--u) solid #4a3826; color: var(--dim); }`;

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

function html(m, mounted) {
  let h = `<header><b>WEAPON BENCH</b>${mounted ? '' : '<button data-a="close" data-v="">M</button>'}</header>`;
  h += `<div>${esc(m.weapon.name)} <span class="mb-dim">deals</span> <span style="color:${m.weapon.elem.col}">${esc(m.weapon.elem.name.toUpperCase())}</span></div>`;
  h += '<div class="mb-slots">';
  for (const s of m.slots) {
    h += `<button class="${s.sel ? 'on' : ''}" data-a="slot" data-v="${s.slot}">`;
    h += s.id ? `<img src="${s.icon}" alt="">` : '<span class="mb-empty"></span>';
    h += `<span style="${s.id ? `color:${s.col}` : ''}">${esc(s.id ? s.name : 'empty')}</span><small>${esc(s.label)}</small></button>`;
  }
  h += `</div><div class="mb-desc">${esc(m.desc)}</div>`;
  const sel = m.slots.find(s => s.sel);
  h += `<h5>${esc(sel ? sel.label : '')}: in your kit</h5><div class="mb-list">`;
  if (!m.parts.length) h += '<div class="mb-dim">Nothing that fits here yet.</div>';
  for (const p of m.parts) h += `<button class="${p.on ? 'on' : ''}${p.ok || p.on ? '' : ' no'}" data-a="${p.on ? 'out' : 'fit'}" data-v="${p.on ? sel.slot : p.id}"><img src="${p.icon}" alt=""><span><span style="color:${p.col}">${esc(p.name)}</span><small>${esc(p.on ? 'fitted: click to take it out' : p.ok ? p.desc : p.why)}</small></span></button>`;
  h += '</div>';
  if (m.riddles.length) { h += '<h5>Not found yet</h5>'; for (const r of m.riddles) h += `<div class="mb-riddle">${esc(r)}</div>`; }
  if (m.others.length) { h += '<h5>Your other weapons</h5>'; for (const o of m.others) h += `<div class="mb-react">${esc(o.name)}: <span class="mb-dim">${esc(o.line)}</span></div>`; }
  if (m.reacts.length) { h += '<h5>When types meet</h5>'; for (const r of m.reacts) h += `<div class="mb-react">${esc(r.name)}: <span class="mb-dim">${esc(r.says)}</span></div>`; }
  h += '<div class="mb-hint">Fit what you like: it changes what each shot or blow does, not just how hard. Rain, snow, the bog and the night change the runes.</div>';
  return h;
}

export function createModPanel({ask}) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'modbench'; el.className = 'hidden'; document.body.appendChild(el);
  for (const k of ['panel', 'well', 'on', 'btn', 'hot']) el.style.setProperty('--m-' + k, FRAMES[k]());
  loadPixelFont();
  let key = '', home = null;
  el.addEventListener('mousedown', e => e.stopPropagation());
  el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.classList.contains('no')) return; e.stopPropagation(); ask(b.dataset.a, b.dataset.v); });
  const P = {
    open: false,
    show(m, into = null) {
      if (into && el.parentNode !== into) { home ??= el.parentNode; into.appendChild(el); el.classList.add('mounted'); key = ''; }
      if (!into && home && el.parentNode !== home) { home.appendChild(el); el.classList.remove('mounted'); key = ''; }
      P.open = true; el.classList.remove('hidden');
      if (m.key !== key) { key = m.key; el.innerHTML = html(m, !!into); }
    },
    hide() { if (!P.open) return; P.open = false; el.classList.add('hidden'); },
  };
  return P;
}
