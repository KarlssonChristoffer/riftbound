// AUDIO feature: the arena's procedural sound (arena/audio.js + music.js), reused as it is: it reads only events,
// the player, arrows, props, the combat feature's dbg (rain zones / traps) and the wind feature's gust, all in the
// arena's coordinates, which is what the host gives features. M mutes, U toggles the music; the pause menu has the
// volume sliders and the music mode. Panning follows the SCREEN at any camera yaw: the listener carries screenX(x, y)
// (audio.js's optional hook; the arena, without it, pans by world x as it always did).
// WIND (windaudio.js): the foliage rustle, leaf ticks and gust whoosh of a brisk wind, from the wind feature's W.rustle /
// W.strength, into the ambience bus (the Ambience slider applies); it starts with the engine (the first key / click).
// RAIN (rainaudio.js): the rain's wash and patter from the world clock (host.env.sky.rain), thunder when weather.js strikes
// (F.rainAudio.thunder), into the same bus.
// THE SPACE (src/audio/acoustics.js; ?acoustics=0 off): the world's acoustics from its real shape: the room round the player picks
// the reverb (open land, woods, inside walls, under cliffs, a rock chamber, a height, the canyon's rim), loud sounds echo off the
// faces round him, sounds behind walls and hills come through darker; the wind's gust layer follows how exposed he stands and the
// rain how covered. Its map is built with the world (biomeChanged) and again when the registry changed (a pulled wall).
// THE MENU (ui/menu.js): F.ui(name) plays the forge's wooden UI family (ui_hover / click / confirm / back / open,
// audio/forge/recipes/ui.js) on the 'ui' bus; F.duck(on) keeps the paused world quiet: music and effects ducked (an
// engine snapshot, so the volume settings stay as they are) while the ambience plays on.
import {createAudio} from '../audio/audio.js';
import {createAcoustics} from '../audio/acoustics.js';
import {flags} from '../core/flags.js';
import {createWindAudio} from './windaudio.js';
import {createRainAudio} from './rainaudio.js';
import {viewRandom} from '../core/rng.js';

// ORDER (core/features.js): it hears this step's world: the rustle (wind), fires lit or out (lights), traps, stomps
// and rolling barrels (combat)
export const order = {after: ['wind', 'lights', 'combat']};
export async function create(host) {
  // (ground: what the biome's painter says is under a foot, where it says: world/desert.js B.groundAt; null elsewhere)
  // (propAt: the kind of the solid prop at a point, for a bullet that ended in one: the registry's near(), the exact test here)
  const NEAR = [];
  const propAt = (x, y) => {
    let best = null, bd = 1e9;
    for (const p of host.entities.near(x, y, .3, NEAR)) {   // a point in a rect (a wall, a wagon): 0; a round one: off its edge
      if (p.broken || p.gone) continue;
      let d;
      if (p.rect) { if (!(x > p.rect[0] - .1 && x < p.rect[2] + .1 && y > p.rect[1] - .1 && y < p.rect[3] + .1)) continue; d = 0; }
      else { if (!(p.r > .05)) continue; d = Math.hypot(p.x - x, p.y - y) - p.r; if (d > .15) continue; }
      if (d < bd) { bd = d; best = p; }
    }
    return best ? best.kind : null;
  };
  const space = flags.get('acoustics') !== '0' ? createAcoustics({props: () => host.props, biome: () => host.biome, env: () => host.env, wind: () => host.wind, time: () => host.time}) : null;
  let spaceVer = -1, spaceT = 0;
  const ctx = {PPM: host.PPM, get VW() { return host.VW; }, get layout() { return host.layout; }, ground: (x, y) => host.biome?.groundAt?.(x, y) ?? null, propAt, space};
  const screenX = (x, y) => host.toView(x, y, 0)[0];
  const AU = createAudio(ctx, {arrows: () => host.arrows, props: () => host.props, combat: () => host.feature('combat'), wind: () => host.wind});
  const listener = {};
  let WA = null, RA = null;
  const WS = {e: 0, pan: 0, strength: 0}, RS = {rain: 0, storm: 0};   // per-step inputs, reused (no allocation)
  const ambBus = () => AU.forge ? [AU.forge.ac, AU.forge.EN.bus('amb.emitters')] : AU.E ? [AU.E.ac, AU.E.amb] : null;
  // the wind and rain layers: made at load with the engine when the forge runtime is up (its context exists from load:
  // audio.js prepare), behind the loading screen; quiet until the context runs (update gets null). Their noise loops are
  // ~70 ms of synthesis that froze the first frame after the first key or click. Made from core/rng.js viewRandom: no
  // Math.random draws at load. Without the forge (?forge=0) they come with the engine, on the first gesture, as before
  if (AU.forge) {
    try { const b = ambBus(); WA = createWindAudio(b[0], b[1], viewRandom('audio.wind')); } catch (e) { console.warn('audio: wind layer unavailable', e); WA = false; }
    try { const b = ambBus(); RA = createRainAudio(b[0], b[1], viewRandom('audio.rain')); } catch (e) { console.warn('audio: rain layer unavailable', e); RA = false; }
  }
  const UI_AT = {pan: 0, dist: 0, off: 0}, QUIET = {buses: {music: -9, sfx: -12}, attack: .3, hold: Infinity, release: .6};
  let quiet = null;
  const F = {
    name: 'audio', label: 'Sound', ambient: true, AU,
    get on() { return !AU.muted; },
    get windAudio() { return WA; }, get rainAudio() { return RA; },
    view(dt, evs) {
      const p = host.player;
      Object.assign(listener, {x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, state: p.state, t: p.t, aim: host.mouse.down, biome: host.biome.id, time: host.time, cam: null, screenX, gun: host.weapon?.kind === 'gun'});
      if (space) {   // the map: at the first step, then again (at most every 2 s) when the registry changed
        spaceT += dt; const v = host.entities.ver;
        if (!space.built || (v !== spaceVer && spaceT > 2)) { space.build(); spaceVer = v; spaceT = 0; }
        space.update(dt, p);
      }
      AU.update(dt, listener, evs);
      if (!WA && AU.on) {
        try { const b = ambBus(); WA = b ? createWindAudio(b[0], b[1]) : null; } catch (e) { console.warn('audio: wind layer unavailable', e); WA = false; }
      }
      if (!RA && AU.on) {
        try { const b = ambBus(); RA = b ? createRainAudio(b[0], b[1]) : null; } catch (e) { console.warn('audio: rain layer unavailable', e); RA = false; }
      }
      const w = host.wind, sky = host.env?.sky;
      const ex = space ? space.room.exposure : 1, cov = space ? space.room.cover : 0;   // (THE SPACE: on a height the gusts blow harder; under rock, less rain)
      if (WA) { WS.e = w?.rustle?.e || 0; WS.pan = w?.rustle?.pan || 0; WS.strength = (w?.strength || 0) * ex; WA.update(dt, AU.on && w?.on ? WS : null); }
      if (RA) { RS.rain = (sky?.rain || 0) * (1 - .6 * cov); RS.storm = sky?.storm || 0; RA.update(dt, AU.on && sky ? RS : null); }
    },
    ui(name) { if (!AU.muted) AU.forge?.D.post('ui_' + name, UI_AT); },
    duck(on) {
      const EN = AU.forge?.EN; if (!EN?.snapshot) return;
      if (on) quiet ??= EN.snapshot('menu', QUIET); else { quiet?.release(); quiet = null; }
    },
    toggle() { AU.toggle(); }, key: 'm',
    onKey(k) { if (k === 'u') { AU.toggleMusic(); return true; } return false; },
    settings: () => [
      ...['master', 'music', 'sfx', 'amb'].map(k => ({label: {master: 'Volume', music: 'Music', sfx: 'Effects', amb: 'Ambience'}[k], min: 0, max: 1, step: .05,
        get: () => AU.volumes?.[k] ?? 1, set: v => AU.setVolume(k, v)})),
      {label: 'Music mode', options: ['adaptive', 'explore', 'combat'], get: () => AU.musicMode || 'adaptive', set: v => AU.setMusicMode(v)},
      // the gun sounds' western-movie flavor (audio/runtime/events.js GUN_SFX; ?gunsfx=; remembered): menu > Audio
      {label: 'Gun sounds', options: AU.gunSfxList || [], get: () => AU.gunSfx, set: v => AU.setGunSfx?.(v)},
    ],
    hud: () => AU.muted ? 'muted (M)' : space ? space.hud() : '',
    biomeChanged() { space?.build(); spaceVer = host.entities.ver; spaceT = 0; },
    space,
  };
  return F;
}
