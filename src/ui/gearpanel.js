// GEAR PANEL: what you wear (features/gear.js; Tab). A slot a row (head, body, back, legs, feet), each with its pieces and
// "own" (the character's own clothes: the slot empty); a click wears a piece or takes it off. Under them the piece under
// the cursor (or the last one worn): what it is, its weight and armor, what it does now, and what it will do once the game
// has the system it needs (marked "not in the game yet"). At the bottom the set's numbers: weight, armor, speed. In co-op a
// choice waits for the server ("waiting for the server").
// OWNS: the panel (#gear + its style). READS: the feature's S (want, worn, stats, waiting), content/gear.js.
// BUDGET: closed: nothing. Open: DOM writes on a change of set or of the piece shown (no per-frame work).
import {SLOTS, SLOT_NAMES, GEAR, RULES, RARITY, gearById, setStats} from '../content/gear.js';

const CSS = `
#gear { position: fixed; left: 10px; top: 50%; transform: translateY(-50%); z-index: 15; width: 300px; max-height: calc(100vh - 120px); overflow: auto;
  padding: 8px 10px 8px; background: rgba(14, 16, 15, .93); border: 1px solid var(--line); border-radius: 6px; scrollbar-width: thin; user-select: none; }
#gear.hidden { display: none; }
body:has(#pack:not(.hidden)) #gear { left: 296px; }   /* (beside the pack's panel: features/pack.js, Tab) */
body:has(#pause:not(.hidden)) #gear { visibility: hidden; }
#gear header { display: flex; justify-content: space-between; align-items: baseline; }
#gear header b { color: var(--key); letter-spacing: .14em; }
#gear header small, #gear .g-dim { color: var(--dim); }
#gear header button { font: inherit; color: var(--dim); background: none; border: 0; cursor: pointer; padding: 0 2px; }
#gear header button:hover { color: var(--ink); }
#gear h5 { margin: 8px 0 3px; font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--dim); }
#gear .g-row { display: flex; flex-wrap: wrap; gap: 4px; }
#gear .g-btn { padding: 2px 6px; font: inherit; color: var(--ink); background: rgba(255, 255, 255, .05); border: 1px solid var(--line); border-radius: 4px; cursor: pointer; }
#gear .g-btn:hover { border-color: rgba(240, 192, 96, .6); }
#gear .g-btn.on { border-color: var(--key); background: rgba(240, 192, 96, .2); color: var(--key); }
#gear .g-btn.want { border-style: dashed; border-color: var(--key); }
#gear .g-btn.own { color: var(--dim); }
#gear .g-info { min-height: 6.2em; margin-top: 10px; padding: 6px 0 0; border-top: 1px solid var(--line); }
#gear .g-info b { color: var(--ink); }
#gear .g-num { color: var(--key); }
#gear .g-soon { color: var(--dim); font-style: italic; }
#gear .g-sum { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line); }
#gear .g-wait { color: var(--key); }`;

// opts: {S (the feature's state), choose(ids), online() (co-op: a choice waits for the server)}
export function createGearPanel({S, choose, online}) {
  let root = null, info = null, sum = null, shownId = null;
  const btns = [];   // {b, id (or null: own), slot}
  const pct = v => Math.round(v * 100) + '%';
  function build() {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    root = document.createElement('div'); root.id = 'gear'; root.className = 'hidden';
    root.addEventListener('mousedown', e => e.preventDefault());   // no focus: Space / Enter stay the game's
    const head = document.createElement('header'); head.innerHTML = '<b>GEAR</b><span><small>Tab</small> <button title="close">×</button></span>';
    head.querySelector('button').onclick = () => toggle(false);
    root.appendChild(head);
    for (const slot of SLOTS) {
      const h = document.createElement('h5'); h.textContent = SLOT_NAMES[slot]; root.appendChild(h);
      const row = document.createElement('div'); row.className = 'g-row'; root.appendChild(row);
      for (const g of [null, ...GEAR.filter(x => x.slot === slot)]) {
        const b = document.createElement('button'); b.className = 'g-btn' + (g ? '' : ' own'); b.textContent = g ? g.name : 'own';
        b.title = g ? g.desc : 'the character\'s own clothes'; if (g && RARITY[g.rarity]) b.style.color = RARITY[g.rarity].col;   // (its rarity's colour)
        b.onclick = () => { const rest = S.want.filter(w => gearById(w).slot !== slot); choose(g ? [...rest, g.id] : rest); if (g) shownId = g.id; sync(); };
        b.onmouseenter = () => { if (g) { shownId = g.id; showInfo(); } };
        row.appendChild(b); btns.push({b, id: g?.id ?? null, slot});
      }
    }
    info = document.createElement('div'); info.className = 'g-info'; root.appendChild(info);
    sum = document.createElement('div'); sum.className = 'g-sum'; root.appendChild(sum);
    document.body.appendChild(root);
  }
  function showInfo() {
    const g = shownId ? gearById(shownId) : null;
    if (!g) { info.innerHTML = '<span class="g-dim">Point at a piece to see it. A slot left on "own" keeps the character\'s own clothes.</span>'; return; }
    const does = [];
    if (g.armor) does.push(`takes ${pct(g.armor)} off the damage you take`);
    for (const m of g.mods || []) {
      if (m.stat === 'light.lantern') does.push('your lantern is always lit');
      else if (m.stat === 'player.speed') does.push(`you move ${pct(m.mul - 1)} faster`);
    }
    info.innerHTML = `<b>${g.name}</b> <span class="g-dim">· ${SLOT_NAMES[g.slot]}</span><br>${g.desc}<br>` +
      `<span class="g-num">${g.weight} kg</span>${g.armor ? ` · <span class="g-num">armor ${pct(g.armor)}</span>` : ''}` +
      (does.length ? `<br>Now: ${does.join('; ')}.` : '') +
      (g.soon ? `<br><span class="g-soon">Later: ${g.soon} (not in the game yet)</span>` : '');
  }
  function sync() {
    if (!root || root.classList.contains('hidden')) return;
    for (const {b, id, slot} of btns) {
      const worn = id ? S.worn.includes(id) : !S.worn.some(w => gearById(w).slot === slot);
      const want = id ? S.want.includes(id) : !S.want.some(w => gearById(w).slot === slot);
      b.classList.toggle('on', worn); b.classList.toggle('want', want && !worn);
    }
    showInfo();
    const st = S.stats, w = setStats(S.want), wait = online() && S.waiting;
    sum.innerHTML = `<span class="g-num">${st.kg.toFixed(1)} kg</span> <span class="g-dim">(${RULES.FREE_KG} kg free)</span> · ` +
      `<span class="g-num">armor ${pct(st.armor)}</span> · <span class="g-num">speed ${pct(st.speed)}</span>` +
      (wait ? `<br><span class="g-wait">waiting for the server… (${w.kg.toFixed(1)} kg)</span>` : '');
  }
  function toggle(v) {
    if (!root) build();
    const on = v ?? root.classList.contains('hidden');
    root.classList.toggle('hidden', !on);
    if (on) { shownId ??= S.worn[S.worn.length - 1] ?? null; sync(); }
    return on;
  }
  return {toggle, sync, get open() { return !!root && !root.classList.contains('hidden'); }};
}
