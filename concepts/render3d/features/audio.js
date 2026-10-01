// AUDIO feature: the arena's procedural sound (arena/audio.js + music.js), reused as it is: it reads only events,
// the player, arrows, props, the combat feature's dbg (rain zones / traps) and the wind feature's gust, all in the
// arena's coordinates, which is what the host gives features. M mutes, U toggles the music; the pause menu has the
// volume sliders and the music mode. Panning follows the SCREEN at any camera yaw: the listener carries screenX(x, y)
// (audio.js's optional hook; the arena, without it, pans by world x as it always did).
import {createAudio} from '../../sprites/arena/audio.js';

export async function create(host) {
  const ctx = {PPM: host.PPM, VW: host.VW, get layout() { return host.layout; }};
  const screenX = (x, y) => host.toView(x, y, 0)[0];
  const AU = createAudio(ctx, {arrows: () => host.arrows, props: () => host.props, combat: () => host.feature('combat'), wind: () => host.wind});
  const listener = {};
  const F = {
    name: 'audio', label: 'Sound', always: false, AU,
    get on() { return !AU.muted; },
    update(dt, evs) {
      const p = host.player;
      Object.assign(listener, {x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, state: p.state, t: p.t, aim: host.mouse.down, biome: host.biome.id, time: host.time, cam: null, screenX});
      AU.update(dt, listener, evs);
    },
    toggle() { AU.toggle(); }, key: 'm',
    onKey(k) { if (k === 'u') { AU.toggleMusic(); return true; } return false; },
    settings: () => [
      ...['master', 'music', 'sfx', 'amb'].map(k => ({label: {master: 'Volume', music: 'Music', sfx: 'Effects', amb: 'Ambience'}[k], min: 0, max: 1, step: .05,
        get: () => AU.volumes?.[k] ?? 1, set: v => AU.setVolume(k, v)})),
      {label: 'Music mode', options: ['adaptive', 'explore', 'combat'], get: () => AU.musicMode || 'adaptive', set: v => AU.setMusicMode(v)},
    ],
    hud: () => AU.muted ? 'muted (M)' : '',
  };
  return F;
}
