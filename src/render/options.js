// OPTIONS: the renderer's switches and the player-facing graphics options (opt), and pushing them into the renderer.
// sampling (auto | nearest | smooth ground), outlines, banded light, shadows, debug view, lantern, HD bow, colliders,
// the key help panel, screen shake. The menu, the dev keys and the URL change them; apply() makes them so.
// opt.help: the dev overlay, the key help + the debug HUD (F1, in dev mode); off by default: no admin panel shows until asked for.
// OWNS: opt.  READS: flags; host.dev (the overlay shows in dev mode only).
//   const {opt, apply} = createOptions({G, flags, dev: () => host.dev})
export const SAMPLING = ['auto', 'nearest', 'smooth'];
export const DEBUG = ['final', 'albedo', 'normals', 'depth', 'object ids', 'sun shadow', 'light only'];
const $ = s => document.querySelector(s);

export function createOptions({G, flags: Q, dev}) {
  const opt = {sampling: Q.get('smooth') === '1' ? 'smooth' : SAMPLING.includes(Q.get('sampling')) ? Q.get('sampling') : 'auto',
    outline: true, banded: true, shadows: true, lantern: Q.get('lantern') === '1', debug: +(Q.get('debug') || 0), help: false, zones: false,
    hdBow: Q.get('bow') === 'hd',   // J: the HD bow overlay instead of the pixel bow (the arena's toggle)
    shake: true};                   // screen shake (menu > Graphics)
  function apply() {
    G.setOptions(opt);   // (opt.sampling: the camera eases the ground's sampling to it, render/camera.js)
    $('#help').classList.toggle('hidden', !opt.help || !dev()); $('#hud').classList.toggle('hidden', !opt.help || !dev());
  }
  return {opt, apply};
}
