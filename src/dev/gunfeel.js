// GUN FEEL: a dev panel (F8 in dev mode; also Menu > Dev > Features > Gun feel panel) with live sliders for how the
// revolvers feel, to tune at the trick-shot range (features/trickshot.js) or anywhere. Every slider is a MODIFIER note under
// the source 'gunfeel' (core/modifiers.js), a x on the owner's own number; the owner applies it (nothing here writes
// another system's number):
//   Spread              weapon.spread x       sim/player/gun.js (aimed, on the move, from the hip)
//   Fan spread          weapon.fanSpread x    sim/player/gun.js (RMB: fanning the hammer)
//   Shot gap            weapon.gap x          sim/player/gun.js (the time between aimed shots: < 1 faster)
//   Recoil push         weapon.kick x         sim/player/gun.js (the shot shoves him back against it)
//   Camera kick         flow.gunKick x        features/flow.js (the view's punch opposite the shot, and on a body hit)
//   Hit-stop            combat.hsShot / hsShotCrit / hsShotKill x   features/combat/core.js (a bullet's hit freezes the sim)
//   Hit shake           combat.shakeShot x    features/combat/core.js (the screen shake of a bullet's hit)
//   Muzzle flash        gunfx.flash x         features/gunfx.js (the flash's size and its light)
// They hold in DEV MODE only (a run without ?dev=1 drops them; back with it), like the cheat panel's. Remembered on this
// machine ('rb.gunfeel'); Reset puts every slider back to x1 (no notes: the game as authored).
// It is a FEATURE the boot puts at the end of the list (main.js; dev/: nothing in the game imports it). F.on is the panel
// showing; its update applies the notes as dev mode turns.
// OWNS: the panel (#gunfeel + its style), the 'gunfeel' notes.  READS: host.mods, host.dev, the game's mode.
// BUDGET: closed: nothing. Open: a few text writes 4 times a second.
const STORE = 'rb.gunfeel';
const KNOBS = [
  {k: 'spread', label: 'Spread', stats: ['weapon.spread'], min: 0, max: 3, note: 'aimed, on the move, from the hip (sim/player/gun.js)'},
  {k: 'fan', label: 'Fan spread', stats: ['weapon.fanSpread'], min: 0, max: 3, note: 'fanning the hammer (RMB)'},
  {k: 'gap', label: 'Shot gap', stats: ['weapon.gap'], min: .25, max: 3, note: 'the time between aimed shots (< 1: faster)'},
  {k: 'kick', label: 'Recoil push', stats: ['weapon.kick'], min: 0, max: 4, note: 'the shot shoves you back against it'},
  {k: 'cam', label: 'Camera kick', stats: ['flow.gunKick'], min: 0, max: 4, note: "the view's punch opposite the shot (features/flow.js)"},
  {k: 'hs', label: 'Hit-stop', stats: ['combat.hsShot', 'combat.hsShotCrit', 'combat.hsShotKill'], min: 0, max: 4, note: "a bullet's hit freezes the sim this x longer"},
  {k: 'shake', label: 'Hit shake', stats: ['combat.shakeShot'], min: 0, max: 4, note: "the screen shake of a bullet's hit"},
  {k: 'flash', label: 'Muzzle flash', stats: ['gunfx.flash'], min: 0, max: 3, note: 'the flash and its light (features/gunfx.js)'},
];
const CSS = `
#gunfeel { position: fixed; left: 10px; top: 64px; z-index: 15; width: 250px; padding: 8px 8px 6px; background: rgba(14, 16, 15, .93);
  border: 1px solid var(--line); border-radius: 6px; user-select: none; }
body:has(#pause:not(.hidden)) #gunfeel { visibility: hidden; }
#gunfeel header { display: flex; justify-content: space-between; align-items: baseline; padding: 0 4px 4px; }
#gunfeel header b { color: var(--key); letter-spacing: .14em; }
#gunfeel header small { color: var(--dim); }
#gunfeel label { display: block; padding: 3px 4px 1px; color: var(--ink); }
#gunfeel label span { float: right; color: var(--dim); }
#gunfeel label.on span { color: var(--key); }
#gunfeel input { width: 100%; margin: 0; accent-color: #f0c060; }
#gunfeel button { width: 100%; margin-top: 6px; padding: 2px 6px; font: inherit; color: var(--ink); background: rgba(255, 255, 255, .05);
  border: 1px solid var(--line); border-radius: 4px; cursor: pointer; }
#gunfeel button:hover { border-color: var(--key); }`;

export function createGunFeel({host}) {
  const C = {open: false}; for (const n of KNOBS) C[n.k] = 1;
  try { Object.assign(C, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
  for (const n of KNOBS) if (!(C[n.k] >= n.min && C[n.k] <= n.max)) C[n.k] = 1;
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(C)); } catch (e) {} };
  const game = () => host.feature('game');
  function apply() {
    const notes = [];
    if (host.dev) for (const n of KNOBS) if (C[n.k] !== 1) for (const stat of n.stats) notes.push({stat, mul: C[n.k]});
    if (notes.length) host.mods.set('gunfeel', notes); else host.mods.clear('gunfeel');
  }

  // ---------------------------------------------------------------- the panel
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'gunfeel'; root.className = 'hidden'; document.body.appendChild(root);
  root.addEventListener('mousedown', e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });   // (no focus but the sliders': Space stays the game's)
  root.addEventListener('keydown', e => e.target.blur?.());   // (a key on a focused slider is the game's)
  root.innerHTML = '<header><b>GUN FEEL</b><small>F8</small></header>';
  const rows = KNOBS.map(n => {
    const l = document.createElement('label'); l.title = n.note; l.innerHTML = `${n.label}<span></span>`;
    const s = document.createElement('input'); s.type = 'range'; s.min = n.min; s.max = n.max; s.step = .05; s.value = C[n.k];
    s.oninput = () => { C[n.k] = +s.value; save(); apply(); sync(); };
    s.ondblclick = () => { C[n.k] = 1; s.value = 1; save(); apply(); sync(); };   // (a double click: x1)
    s.onchange = () => s.blur();   // (let go: the keys are the game's again)
    root.appendChild(l); root.appendChild(s);
    return {n, l, v: l.firstElementChild, s};
  });
  const reset = document.createElement('button'); reset.textContent = 'Reset all (x1)'; root.appendChild(reset);
  reset.onclick = () => { for (const r of rows) { C[r.n.k] = 1; r.s.value = 1; } save(); apply(); sync(); };
  function sync() {
    for (const r of rows) {
      const v = C[r.n.k], t = '×' + v.toFixed(2);
      if (r.v.textContent !== t) r.v.textContent = t;
      r.l.classList.toggle('on', v !== 1);
      if (+r.s.value !== v) r.s.value = v;
    }
  }
  function show() {
    const vis = F.on && host.dev && game()?.mode !== 'title';
    root.classList.toggle('hidden', !vis);
    return vis;
  }

  let devWas = null, syncT = 0;
  const F = {
    name: 'gunfeel', label: 'Gun feel panel', key: 'f8', on: !!C.open,
    toggle() {
      if (!host.dev && !F.on) return F.on;   // (dev mode only)
      F.on = !F.on; C.open = F.on; save();
      if (show()) sync();
      return F.on;
    },
    update() { if (host.dev !== devWas) { devWas = host.dev; apply(); } },   // (the first step too: the remembered sliders)
    frame({dt}) { if (!show()) return; if ((syncT -= dt) <= 0) { syncT = .25; sync(); } },
    hud() {
      if (!host.dev) return '';
      const a = []; for (const n of KNOBS) if (C[n.k] !== 1) a.push(`${n.label.toLowerCase()} ×${C[n.k].toFixed(2)}`);
      return a.length ? `<b>gun feel</b> ${a.join(' · ')}` : '';
    },
  };
  return F;
}
