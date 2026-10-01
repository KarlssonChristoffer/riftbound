// OPTIONS: the renderer's switches and the player-facing graphics options (opt), and pushing them into the renderer.
// sampling (auto | nearest | smooth ground), outlines, banded light, shadows, debug view, lantern, HD bow, colliders,
// the key help panel, screen shake. The menu, the dev keys and the URL change them; apply() makes them so.
// OWNS: opt.  READS: flags; host.dev (the help panel shows in dev mode).
//   const {opt, apply} = createOptions({G, flags, dev: () => host.dev})
export const SAMPLING = ['auto', 'nearest', 'smooth'];
export const DEBUG = ['final', 'albedo', 'normals', 'depth', 'object ids', 'sun shadow', 'light only'];
const $ = s => document.querySelector(s);

export function createOptions({G, flags: Q, dev}) {
  const opt = {sampling: Q.get('smooth') === '1' ? 'smooth' : SAMPLING.includes(Q.get('sampling')) ? Q.get('sampling') : 'auto',
    outline: true, banded: true, shadows: true, lantern: Q.get('lantern') === '1', debug: +(Q.get('debug') || 0), help: true, zones: false,
    hdBow: Q.get('bow') === 'hd',   // J: the HD bow overlay instead of the pixel bow (the arena's toggle)
    shake: true};                   // screen shake (menu > Graphics)
  function apply() {
    if (opt.sampling !== 'auto') G.U.smooth.value = opt.sampling === 'smooth' ? 1 : 0;
    G.compU.uOutline.value = opt.outline ? 1 : 0; G.compU.uBanded.value = opt.banded ? 1 : 0;
    G.compU.uShadowOn.value = G.compU.uPtShadow.value = opt.shadows ? 1 : 0; G.compU.uDebug.value = opt.debug; $('#help').classList.toggle('hidden', !opt.help || !dev());
  }
  return {opt, apply};
}
