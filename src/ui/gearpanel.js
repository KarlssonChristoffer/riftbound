// GEAR PANEL: what you wear (features/gear.js; Tab, beside the pack). A slot a row (head, body, back, hands, legs, feet, main
// hand, off hand), each with its pieces as pixel icons (ui/gearicons.js) after "own" (the character's own clothes: the slot
// empty), then the slot's bare piece where he has a garment of his own there (No hat, No coat ...: content/gear.js BASE, a
// piece replaces his own garment); a click wears a piece or takes it off. The first row, CHARMS, holds two keepsakes
// (docs/KEEPSAKES.md): it offers only the ones in your pouch (their own item icons: content/items.js, through
// features/keepsakes.js's icon when it has one); a click puts one on beside the other (the older comes off past two) or takes
// it off. The piece under the pointer shows in a card that follows it (ui/geartip.js:
// what it is, its weight and armor, what it does; Shift for more). At the bottom the set's numbers: weight, armor, speed. In
// co-op a choice waits for the server ("waiting for the server"). Pixel art like the game (ui/pixelfont.js, ui/pixelframe.js).
// Only the pieces you own show (opts.owns: features/gear.js; a piece made shows at the next sync), a piece worn always.
// OWNS: the panel (#gear + its style). READS: the feature's S (want, worn, stats, waiting), content/gear.js, content/items.js
//   (the keepsakes' icons), has(id) (the pouch holds one).
// BUDGET: closed: nothing. Open: DOM writes on a change of set or of the pouch (no per-frame work).
import {SLOTS, SLOT_NAMES, SLOT_CAP, GEAR, RULES, RARITY, gearById, setStats} from '../content/gear.js';
import {ITEMS} from '../content/items.js';
import {iconURL, iconHook} from './packpanel.js';
import {gearIcon, slotIcon} from './gearicons.js';
import {gearTip} from './geartip.js';
import {FRAMES, uiUnit} from './pixelframe.js';
import {loadPixelFont} from './pixelfont.js';

const CSS = `
#gear { --u: 2px; --ink: #efe6cf; --dim: #a39478; --key: #f2c95c;
  position: fixed; left: 10px; top: 50%; transform: translateY(-50%); z-index: 15; width: calc(178 * var(--u)); max-height: calc(100vh - 32px); overflow: auto;
  padding: calc(3 * var(--u)) calc(4 * var(--u)); color: var(--ink); user-select: none; scrollbar-width: thin; scrollbar-color: #7a5f3e #15100c;
  font: calc(10 * var(--u)) / calc(11 * var(--u)) RiftPixel, ui-monospace, Consolas, monospace; font-synthesis: none; image-rendering: pixelated;
  border: calc(3 * var(--u)) solid transparent; border-image: var(--g-panel) 3 fill / calc(3 * var(--u)); box-sizing: border-box; }
#gear * { box-sizing: border-box; }
#gear.hidden { display: none; }
body:has(#pack:not(.hidden)) #gear { left: calc(14px + 164 * var(--u)); }   /* (beside the pack's panel, ui/packpanel.js: 164 UI px wide) */
body:has(#pause:not(.hidden)) #gear { visibility: hidden; }
#gear header { display: flex; justify-content: space-between; align-items: baseline; }
#gear header b { font-weight: 400; color: var(--key); letter-spacing: var(--u); text-shadow: var(--u) var(--u) 0 #0c0907; }
#gear header small { color: var(--dim); font-size: inherit; }
#gear header button { font: inherit; color: var(--dim); background: none; border: 0; cursor: pointer; padding: 0 calc(2 * var(--u)); }
#gear header button:hover { color: var(--ink); }
#gear h5 { margin: calc(4 * var(--u)) 0 calc(2 * var(--u)); font: inherit; color: var(--dim); text-transform: uppercase; }
#gear .g-row { display: flex; flex-wrap: wrap; gap: calc(2 * var(--u)); }
#gear .g-it { position: relative; padding: var(--u); line-height: 0; cursor: pointer; background: none;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--g-card) 2 fill / calc(2 * var(--u)); }
#gear .g-it:hover { border-image-source: var(--g-hot); }
#gear .g-it.on { border-image-source: var(--g-on); }
#gear .g-it.want { border-image-source: var(--g-hot); }
#gear .g-it img { width: calc(18 * var(--u)); height: calc(18 * var(--u)); image-rendering: pixelated; }
#gear .g-it.g-off { display: none; }
#gear .g-none { color: var(--dim); }
#gear .g-none.g-off { display: none; }
#gear .g-it.own img { opacity: .8; }
#gear .g-it.no { display: none; }
#gear .g-it i { position: absolute; right: var(--u); top: var(--u); width: calc(3 * var(--u)); height: calc(3 * var(--u)); outline: var(--u) solid #0c0907; }
#gear .g-sum { margin-top: calc(5 * var(--u)); padding-top: calc(3 * var(--u)); border-top: var(--u) solid #4a3826; }
#gear .g-num { color: var(--key); }
#gear .g-dim { color: var(--dim); }
#gear .g-wait { color: var(--key); }`;

// a keepsake's icon: its item's (redrawn when its look changes: the tally's notches, ui/packpanel.js iconHook)
const KEEP_ICON = {};
function keepIcon(id) {
  const o = iconHook.of?.(id), key = o ? o.key : '';
  const c = KEEP_ICON[id]; if (c && c.key === key) return c.url;
  const d = o || ITEMS[id]; const url = d?.icon ? iconURL(d.icon, d.pal) : '';
  KEEP_ICON[id] = {key, url}; return url;
}
// opts: {S (the feature's state), choose(ids), online() (co-op: a choice waits for the server), owns(id) (shown; default all),
//   has(id) (the pouch holds one)}
export function createGearPanel({S, choose, online, owns = () => true, has = () => true}) {
  let root = null, sum = null, none = null;
  const btns = [];   // {b, id (or null: own), slot, img}
  const pct = v => Math.round(v * 100) + '%';
  function build() {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    root = document.createElement('div'); root.id = 'gear'; root.className = 'hidden';
    for (const [k, v] of [['panel', FRAMES.panel()], ['card', FRAMES.card()], ['hot', FRAMES.hot()], ['on', FRAMES.on()]]) root.style.setProperty('--g-' + k, v);
    loadPixelFont();
    root.addEventListener('mousedown', e => e.preventDefault());   // no focus: Space / Enter stay the game's
    const head = document.createElement('header'); head.innerHTML = '<b>GEAR</b><span><small>Tab</small> <button title="close">×</button></span>';
    head.querySelector('button').onclick = () => toggle(false);
    root.appendChild(head);
    const tip = gearTip();
    for (const slot of ['charm', ...SLOTS.filter(s => s !== 'charm')]) {   // (the charms first: what you found, then what you wear)
      const h = document.createElement('h5'); h.textContent = SLOT_NAMES[slot]; root.appendChild(h);
      const row = document.createElement('div'); row.className = 'g-row'; root.appendChild(row);
      const many = SLOT_CAP[slot] > 1;
      for (const g of [null, ...GEAR.filter(x => x.slot === slot)]) {
        const b = document.createElement('button'); b.className = 'g-it' + (g ? '' : ' own');
        const img = document.createElement('img'); img.src = g ? (g.keepsake ? keepIcon(g.id) : gearIcon(g)) || slotIcon(slot, '#efe6cf') : slotIcon(slot, '#6b5e50'); b.appendChild(img);
        if (g && !g.bare && RARITY[g.rarity]) { const i = document.createElement('i'); i.style.background = RARITY[g.rarity].col; b.appendChild(i); }   // (its rarity's colour)
        b.onclick = () => {
          const rest = S.want.filter(w => gearById(w).slot !== slot);
          if (!g) choose(rest);
          else if (many) choose(S.want.includes(g.id) ? S.want.filter(w => w !== g.id) : [...S.want, g.id]);   // (a charm: on beside the other, or off)
          else choose([...rest, g.id]);
          sync();
        };
        tip.attach(b, {piece: () => g, slot, set: () => S.want});
        row.appendChild(b); btns.push({b, id: g?.id ?? null, slot, img, keep: !!g?.keepsake});
      }
      if (slot === 'charm') { none = document.createElement('div'); none.className = 'g-none'; none.textContent = 'nothing to wear here yet'; root.appendChild(none); }
    }
    sum = document.createElement('div'); sum.className = 'g-sum'; root.appendChild(sum);
    document.body.appendChild(root);
  }
  function sync() {
    if (!root || root.classList.contains('hidden')) return;
    let offered = 0;
    for (const o of btns) {
      const {b, id, slot} = o;
      const worn = id ? S.worn.includes(id) : !S.worn.some(w => gearById(w).slot === slot);
      const want = id ? S.want.includes(id) : !S.want.some(w => gearById(w).slot === slot);
      b.classList.toggle('on', worn); b.classList.toggle('want', want && !worn); b.classList.toggle('no', !!id && !worn && !want && !owns(id));
      if (o.keep) {   // (a keepsake: offered only while the pouch holds it; its icon as it looks now)
        const show = has(id) || worn; b.classList.toggle('g-off', !show); if (show) offered++;
        const src = keepIcon(id); if (o.img.src !== src && src) o.img.src = src;
      }
    }
    if (none) none.classList.toggle('g-off', offered > 0);
    const st = S.stats, w = setStats(S.want), wait = online() && S.waiting;
    sum.innerHTML = `<span class="g-num">${st.kg.toFixed(1)} kg</span> <span class="g-dim">(${RULES.FREE_KG} kg free)</span><br>` +
      `<span class="g-num">armor ${pct(st.armor)}</span> · <span class="g-num">speed ${pct(st.speed)}</span>` +
      (wait ? `<br><span class="g-wait">waiting for the server… (${w.kg.toFixed(1)} kg)</span>` : '') +
      '<br><span class="g-dim">Point at a piece; Shift for more.</span>';
  }
  function toggle(v) {
    if (!root) build();
    const on = v ?? root.classList.contains('hidden');
    root.classList.toggle('hidden', !on);
    if (on) { root.style.setProperty('--u', uiUnit() + 'px'); sync(); } else gearTip().hide();
    return on;
  }
  return {toggle, sync, get open() { return !!root && !root.classList.contains('hidden'); }};
}
