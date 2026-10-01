// DOM SCREENS over the world: the title, the augment pick, the end of a run. Only one shows at a time; each takes
// clicks and keys (game.js forwards keys while the host is locked: Enter, 1-3, Escape).
import {clock} from './save.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

export function createScreens() {
  const root = document.createElement('div'); root.id = 'gscreen'; root.className = 'hidden';
  document.body.appendChild(root);
  let keys = null;   // the shown screen's key handler: (k) -> bool

  function show(html, onKey, onClick) {
    root.innerHTML = html; root.classList.remove('hidden'); keys = onKey;
    root.onclick = e => { const a = e.target.closest('[data-act]')?.dataset.act; if (a) onClick(a); };
  }
  return {
    get open() { return !root.classList.contains('hidden'); },
    hide() { root.classList.add('hidden'); root.innerHTML = ''; keys = null; },
    key(k) { return keys ? keys(k) : false; },

    title(save, {run, sandbox}) {
      const rec = save.runs ? `${save.runs} run${save.runs > 1 ? 's' : ''} · best: stage ${save.bestStage} (${clock(save.bestTime)})` + (save.wins ? ` · ${save.wins} win${save.wins > 1 ? 's' : ''}, fastest ${clock(save.fastestWin)}` : '') : 'no runs yet';
      show(`<div class="gs-panel gs-title">
        <div class="gs-logo">RIFTBOUND</div><div class="gs-sub">working title · a ranger's run through four biomes</div>
        <button data-act="run" class="gs-main"><b>Start run</b><span>Enter</span></button>
        <button data-act="sandbox"><b>Proving Grounds</b><span>the sandbox: every test toggle</span></button>
        <div class="gs-rec">${esc(rec)}</div>
        <div class="gs-keys">WASD move · mouse aim, hold LMB to draw · RMB / 1–4 abilities · Space roll · E open · Z / X turn the camera · Esc menu</div>
      </div>`, k => { if (k === 'enter' || k === ' ') { run(); return true; } return false; }, a => a === 'run' ? run() : sandbox());
    },

    pick(stageName, choices, onPick) {
      show(`<div class="gs-panel gs-pick">
        <div class="gs-h">${esc(stageName)} cleared</div><div class="gs-sub">choose an augment</div>
        <div class="gs-cards">${choices.map((a, i) => `<button data-act="${i}" class="gs-card">
          <span class="gs-glyph">${esc(a.glyph)}</span><b>${esc(a.name)}</b><span>${esc(a.desc)}</span><i>${i + 1}</i></button>`).join('')}</div>
      </div>`, k => { const i = +k - 1; if (i >= 0 && i < choices.length) { onPick(choices[i]); return true; } return false; }, a => onPick(choices[+a]));
    },

    over(r, {again, title}) {
      const head = r.won ? 'Victory' : 'You fell', col = r.won ? '#f2d27a' : '#e0604a';
      show(`<div class="gs-panel gs-over">
        <div class="gs-h" style="color:${col}">${head}</div>
        <div class="gs-sub">${r.won ? 'all four stages cleared' : `stage ${r.stage} · ${esc(r.stageName)} · wave ${r.wave}`}</div>
        <table class="gs-stats">
          <tr><td>time</td><td>${clock(r.time)}</td></tr><tr><td>kills</td><td>${r.kills}</td></tr>
          <tr><td>gold earned</td><td>${r.gold}</td></tr><tr><td>build</td><td>${r.build.map(e => esc(e.def.name) + (e.n > 1 ? ' x' + e.n : '')).join(', ') || '—'}</td></tr>
        </table>
        ${r.record ? '<div class="gs-rec gs-new">new record</div>' : ''}
        <button data-act="again" class="gs-main"><b>Run again</b><span>Enter</span></button>
        <button data-act="title"><b>Title</b></button>
      </div>`, k => { if (k === 'enter') { again(); return true; } return false; }, a => a === 'again' ? again() : title());
    },
  };
}
