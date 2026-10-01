// AUDIO feature: the arena's procedural sound (arena/audio.js + music.js), reused as it is: it reads only events,
// the player, arrows, props, the combat feature's dbg (rain zones / traps) and the wind feature's gust, all in the
// arena's coordinates, which is what the host gives features. M mutes, U toggles the music; the pause menu has the
// volume sliders and the music mode. Panning follows the SCREEN at any camera yaw: the listener carries screenX(x, y)
// (audio.js's optional hook; the arena, without it, pans by world x as it always did).
// WIND (windaudio.js): the foliage rustle, leaf ticks and gust whoosh of a brisk wind, from the wind feature's W.rustle /
// W.strength, into the ambience bus (the Ambience slider applies); it starts with the engine (the first key / click).
// RAIN (rainaudio.js): the rain's wash and patter from the world clock (host.env.sky.rain), thunder when weather.js strikes
// (F.rainAudio.thunder), into the same bus.
import {createAudio} from '../../sprites/arena/audio.js';
import {createWindAudio} from './windaudio.js';
import {createRainAudio} from './rainaudio.js';

export async function create(host) {
  const ctx = {PPM: host.PPM, VW: host.VW, get layout() { return host.layout; }};
  const screenX = (x, y) => host.toView(x, y, 0)[0];
  const AU = createAudio(ctx, {arrows: () => host.arrows, props: () => host.props, combat: () => host.feature('combat'), wind: () => host.wind});
  const listener = {};
  let WA = null, RA = null;
  const WS = {e: 0, pan: 0, strength: 0}, RS = {rain: 0, storm: 0};   // per-step inputs, reused (no allocation)
  const ambBus = () => AU.forge ? [AU.forge.ac, AU.forge.EN.bus('amb.emitters')] : AU.E ? [AU.E.ac, AU.E.amb] : null;
  const F = {
    name: 'audio', label: 'Sound', always: false, AU,
    get on() { return !AU.muted; },
    get windAudio() { return WA; }, get rainAudio() { return RA; },
    update(dt, evs) {
      const p = host.player;
      Object.assign(listener, {x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, state: p.state, t: p.t, aim: host.mouse.down, biome: host.biome.id, time: host.time, cam: null, screenX});
      AU.update(dt, listener, evs);
      if (!WA && AU.on) {
        try { const b = ambBus(); WA = b ? createWindAudio(b[0], b[1]) : null; } catch (e) { console.warn('audio: wind layer unavailable', e); WA = false; }
      }
      if (!RA && AU.on) {
        try { const b = ambBus(); RA = b ? createRainAudio(b[0], b[1]) : null; } catch (e) { console.warn('audio: rain layer unavailable', e); RA = false; }
      }
      const w = host.wind, sky = host.env?.sky;
      if (WA) { WS.e = w?.rustle?.e || 0; WS.pan = w?.rustle?.pan || 0; WS.strength = w?.strength || 0; WA.update(dt, AU.on && w?.on ? WS : null); }
      if (RA) { RS.rain = sky?.rain || 0; RS.storm = sky?.storm || 0; RA.update(dt, AU.on && sky ? RS : null); }
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
