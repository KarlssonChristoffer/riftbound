// LIVE KEYS (dev; the live hero, view/livehero.js): Shift+7 flips the player between his sprite and his live body (the A/B),
// Shift+8 steps through the motion knobs' presets (livehero PRESETS: smooth, step, face16, hyst, hold, snap, smear, all,
// allsmear, free32), Shift+9 through the demos (none, lasso, swing, then the live model's own emotes: cheer, wave, shrug,
// squat, played while he stands still: view/livehero.js emote()), Shift+Alt+9 turns FLOW and the COMBAT STYLE (the
// stances, the draws, the kicks) off / on, Shift+Alt+8 turns the procedural layers
// (aim at any angle, the reload over the legs) off / on. A small note in the corner says what is on (it fades).
// WRITES: nothing of the game's: it calls the live hero's API (toggle, preset, set).
let note = null, noteT = 0;
function show(text) {
  if (!note) {
    note = document.createElement('div');
    note.style.cssText = 'position:fixed;left:8px;top:8px;z-index:50;font:12px monospace;color:#f2e8d2;background:rgba(20,14,10,.78);padding:4px 7px;border-radius:3px;pointer-events:none;transition:opacity .4s';
    document.body.appendChild(note);
  }
  note.textContent = text; note.style.opacity = '1'; clearTimeout(noteT); noteT = setTimeout(() => { note.style.opacity = '0'; }, 2500);
}
export const liveState = live => `${live.on ? 'LIVE' : 'SPRITE'}${live.available ? '' : ' (this loadout is a sprite; ?live=1: every live model)'} · knobs ${live.presetName}` +
  ` · procedural ${live.K.proc ? 'on' : 'off'} · flow ${live.K.flow ? 'on' : 'off'}${live.K.demo ? ' · demo ' + live.K.demo : ''}`;
// -> true when the key was the live hero's
export function liveKey(e, live) {
  if (!e.shiftKey || !/^Digit[789]$/.test(e.code)) return false;
  const d = +e.code.slice(5), P = live.presets, D = live.demos;
  if (d === 7) live.toggle();
  if (d === 8 && e.altKey) live.set({proc: !live.K.proc});
  else if (d === 8) live.preset(P[(P.indexOf(live.presetName) + 1) % P.length]);
  if (d === 9 && e.altKey) live.set({flow: !live.K.flow});
  else if (d === 9) live.set({demo: D[(D.indexOf(live.K.demo) + 1) % D.length]});
  show(liveState(live));
  return true;
}
