// PAUSE: the menu (Escape; ui/menu.js draws it, these are its items) and what pausing means.
// PAUSED, the game stands still (the sim: player, arrows, enemies, fire, the run, the clock) but the world doesn't: the
// views of the features that declare F.ambient keep running in real time behind the blurred menu, so the wind blows,
// birds fly, rain falls and fires flicker. The cloak still answers the wind. The camera drifts slowly (drag the
// backdrop to look around) and eases back to where it was on resume. The audio feature ducks music + effects; the
// ambience plays on. (flow isn't ambient: its streaks / tracks follow the player's frozen speed)
// OWNS: paused, the pause drift (pauseYaw / pauseGoal / lookT), the menu and its items (Game / Graphics / Audio / Controls /
// Dev tabs).  READS: E (the engine context, main.js).
//   const pause = createPause(E); pause.paused / toggle(force, snd) / stepPaused(dt) / pauseTurn(dt) / menu
import {createMenu} from './menu.js';
import {SNAP_NAME} from '../render/camera.js';
import {SAMPLING, DEBUG} from '../render/options.js';
import {SEASONS, WEATHER} from '../sim/env.js';
import {check as checkEvents} from '../core/events.js';
import {LOADOUTS} from '../view/hero.js';
const $ = s => document.querySelector(s);

const NO_EVS = [], PAUSE_TURN = .035, LOOK_HOLD = 3000;   // drift rad/s (the title turns at .07); ms after a drag before it drifts again
const onOff = (get, set) => ({options: ['on', 'off'], get: () => get() ? 'on' : 'off', set: v => set(v === 'on')});
const pick = (options, get, set) => ({options, get, set});
const cyc = (o, cur, d, set) => set(o[((o.indexOf(cur) + d) % o.length + o.length) % o.length]);
// features' toggles / settings a player sees, by feature and setting label ('' = its on / off); the rest go to Dev.
// id + keep: remembered on this machine (keep: the URL parameter that overrides it)
const gfx = (group, label, id, keep = true) => ({tab: 'graphics', group, label, id, keep});
const vol = label => ({tab: 'audio', group: 'Volume', label});
const CLAIM = {
  depth: {'': gfx('World', 'Clouds, light shafts & reflections', 'depth', 'depth'), 'Foreground silhouettes': gfx('World', 'Foreground foliage', 'fg')},
  weather: {'Weather fx': gfx('World', 'Rain, snow & lightning', 'rain')},
  lights: {'Heat ripple': gfx('Effects', 'Heat shimmer', 'heat')},
  atmos: {'Vignette + haze': gfx('Effects', 'Vignette', 'vignette', 'hd')},
  blood: {'': gfx('Effects', 'Blood', 'blood', 'blood')},   // (features/blood.js: on by default; ?blood=0)
  audio: {'': {tab: 'audio', group: 'Sound', label: 'Sound', key: 'M'}, Volume: vol('Master'), Music: vol('Music'), Effects: vol('Effects'), Ambience: vol('Ambience'),
    'Music mode': {tab: 'dev', group: 'Tools', label: 'Music mode'},
    'Gun sounds': {tab: 'audio', group: 'Sound', label: 'Gun sounds'}},   // (the western-movie flavor: features/audio.js, remembered there)
};
// DETAIL (Graphics), the quality tier: low switches the costliest purely cosmetic layers off (their views: the sim never
// reads a view, tools/test/simview.mjs, so gameplay can't change); high puts them back. ?detail=low starts low
const LOW_OFF = ['windlines', 'wildlife', 'depth', 'grass', 'litter', 'dust', 'tumbleweed'];
const KEYS = [[['W', 'A', 'S', 'D'], 'move (camera-relative)'], [['Shift'], 'sprint'], [['Q'], 'walk'], [['C'], 'crouch'], [['Space'], 'roll · leap'],
  [['LMB'], 'hold to draw, release to shoot'], [['RMB'], 'multishot'], [['1', '2', '3', '4'], 'abilities'], [['E'], 'open · talk · climb'],
  [['LMB'], 'revolver: draw · shoot'], [['RMB'], 'revolver: fan the hammer'], [['R'], 'revolver: reload'], [['Y'], 'tip the hat'],
  [['Z', 'X'], 'turn the camera (or drag with the middle button)'], [['Home'], 'reset the camera'], [['Wheel'], 'zoom in / out'],
  [['M'], 'mute'], [['U'], 'music on / off'], [['Esc'], 'this menu']];

const CHARS = {Ranger: 'ranger + cloth sim', Gunslinger: 'gunslinger', Outlaw: 'outlaw'};   // the menu's names -> LOADOUTS names
const charOf = name => name === 'gunslinger' ? 'Gunslinger' : name === 'outlaw' ? 'Outlaw' : 'Ranger';

export function createPause(E) {
  const {cv, pa, hero, events, features, keys, feat, opt, stage, env, perf, host} = E;
  let paused = false, pauseYaw = 0, pauseGoal = 1, lookT = 0, detail = 'high';
  function setDetail(v) {
    detail = v;
    for (const n of LOW_OFF) { const f = feat(n); if (f?.toggle && (f.on !== false) !== (v === 'high')) f.toggle(); }
  }
  function stepPaused(dt) {
    hero.stepCloth(dt);
    const evs = events.length ? events.splice(0) : NO_EVS;   // wildlife's calls, fire crackles: for the audio feature
    if (host.dev) checkEvents(evs);
    for (const f of features) if (f.ambient && f.on !== false) f.view?.(dt, evs);
  }
  const pauseTurn = dt => E.game.mode === 'title' || performance.now() - lookT < LOOK_HOLD ? 0 : PAUSE_TURN * dt;   // (the title turns itself)
  function toggle(force, snd) {
    const was = paused; paused = force ?? !paused; if (paused === was) return;
    feat('audio')?.duck?.(paused);
    if (paused) { keys.clear(); E.input.cancelDrag(); pauseYaw = cv.yaw; pauseGoal = cv.dsGoal; lookT = 0; menu.show(); return; }
    menu.hide(snd); cv.zoomTo(pauseGoal);   // back to the zoom you played at (it eases)
    const d = Math.atan2(Math.sin(cv.yaw - pauseYaw), Math.cos(cv.yaw - pauseYaw));
    if (E.game.mode !== 'title' && !pa.assist && Math.abs(d) > .002) pa.assist = {back: pauseYaw, phase: 'back'};   // back to where you were looking
  }
  function menuItems() {
    const game = E.game, setBiome = E.setBiome;
    const out = [], dv = (group, it) => out.push({tab: 'dev', group, ...it}), A = feat('audio')?.AU;
    // Game: resume, then the game's own rows (start / abandon a run, back to title)
    if (game.mode !== 'title') out.push({tab: 'game', label: 'Resume', main: true, sound: 'back', run() {}});
    for (const m of features.flatMap(f => f.menu?.() || [])) out.push({tab: 'game', label: m.label, run: m.run});
    // the character: the Ranger (bow), the gunslinger (Peacemaker), the outlaw (Brass Navy): view/hero.js LOADOUTS
    out.push({tab: 'game', group: 'Character', label: 'Character', ...pick(Object.keys(CHARS), () => charOf(hero.loadName), v => {
      const i = LOADOUTS.findIndex(l => l[0] === CHARS[v]); if (i >= 0 && i !== hero.loadI) hero.switchLoadout(i); })});
    // Graphics, Controls: the host's own
    // (fullscreen keeps Escape for the menu: keyboard lock, where the browser has it; holding Esc still leaves fullscreen)
    out.push({tab: 'graphics', group: 'Display', label: 'Fullscreen', ...onOff(() => !!document.fullscreenElement, v => {
      try { (v ? document.documentElement.requestFullscreen?.().then(() => navigator.keyboard?.lock?.(['Escape'])) : document.fullscreenElement && document.exitFullscreen())?.catch?.(() => {}); } catch (e) {} })});
    out.push({tab: 'graphics', group: 'Display', label: 'Detail', id: 'detail', keep: 'detail', ...pick(['high', 'low'], () => detail, setDetail)});
    out.push({tab: 'graphics', group: 'World', label: 'Shadows', id: 'shadows', keep: true, ...onOff(() => opt.shadows, v => { opt.shadows = v; })});
    out.push({tab: 'controls', group: 'Camera', label: 'Camera turning', id: 'snap', keep: 'snap', ...pick(SNAP_NAME, () => SNAP_NAME[cv.snapMode], v => { cv.snapMode = SNAP_NAME.indexOf(v); })},
      {tab: 'controls', group: 'Keys', keys: KEYS});
    // Dev: the character, the world's dials, the renderer's A/B (each with its dev key)
    dv('Character', {label: 'Loadout', key: 'O', value: () => hero.loadName, run: d => hero.switchLoadout(hero.loadI + d)});
    dv('Character', {label: 'Bow', key: 'J', ...pick(['pixel art', 'HD overlay'], () => opt.hdBow ? 'HD overlay' : 'pixel art', v => { opt.hdBow = v === 'HD overlay'; })});
    dv('Character', {label: 'Shiny armour', key: 'I', ...onOff(() => hero.armor.on, v => { if (hero.armor.on !== v) hero.toggleArmour(); })});
    dv('Character', {label: 'Lantern', key: 'L', ...onOff(() => opt.lantern, v => { opt.lantern = v; })});
    dv('World', {label: 'Biome', key: 'N', value: () => stage.biome.name, run: d => setBiome(stage.biomeI + d)});
    dv('World', {label: 'Time', key: 'T', value: () => `${env.clock()} ${env.part}`, run: () => env.nextPart()});
    dv('World', {label: 'Season', value: () => env.seasonLock || `auto (${env.season})`, run: d => cyc(['auto', ...SEASONS], env.seasonLock || 'auto', d, env.setSeason)});
    dv('World', {label: 'Weather', value: () => env.weatherLock || `auto (${env.weather})`,
      run: d => cyc(['auto', ...Object.keys(WEATHER).filter(w => !WEATHER[w].precip || env.TUNE.precip)], env.weatherLock || 'auto', d, env.setWeather)});
    dv('World', {label: 'Day length', value: () => env.frozen ? 'stopped' : `${env.TUNE.dayMinutes} min`, run: d => cyc([20, 5, 60, 0], env.frozen ? 0 : env.TUNE.dayMinutes, d, env.setDayMinutes)});
    dv('Renderer', {label: 'Ground texture', key: 'Shift+2', ...pick(SAMPLING, () => opt.sampling, v => { opt.sampling = v; })});
    dv('Renderer', {label: 'Prop outlines', key: 'Shift+3', ...onOff(() => opt.outline, v => { opt.outline = v; })});
    dv('Renderer', {label: 'Props', key: 'P', ...pick(['live 3D', '16-angle sprites'], () => stage.propMode === 'live' ? 'live 3D' : '16-angle sprites', v => { stage.propMode = v === 'live 3D' ? 'live' : 'yaw'; })});
    dv('Renderer', {label: 'Trees', key: 'Shift+P', ...pick(['3D (grown)', 'painted cards'], () => stage.trees3d ? '3D (grown)' : 'painted cards', v => { stage.trees3d = v === '3D (grown)'; })});
    dv('Renderer', {label: 'Banded light', key: 'V', ...onOff(() => opt.banded, v => { opt.banded = v; })});
    dv('Renderer', {label: 'Debug view', key: 'G', ...pick(DEBUG, () => DEBUG[opt.debug], v => { opt.debug = DEBUG.indexOf(v); })});
    dv('Renderer', {label: 'Colliders', key: 'Shift+G', ...onOff(() => opt.zones, v => { opt.zones = v; })});
    // the features' toggles and settings: Dev > Features, unless CLAIMed for a player tab
    for (const f of features) {
      if (!f.toggle && !f.settings) continue;
      const claim = CLAIM[f.name] || {}, put = (k, it) => out.push(claim[k] ? {...it, key: undefined, ...claim[k]} : {...it, tab: 'dev', group: 'Features'});
      if (f.toggle) put('', {label: f.label || f.name, key: f.key?.toUpperCase(), ...onOff(() => f.on !== false, v => { if ((f.on !== false) !== v) f.toggle(); })});
      for (const s of f.settings?.() || []) put(s.label, s.options ? {label: s.label, ...pick(s.options, s.get, s.set)} : {label: s.label, min: s.min ?? 0, max: s.max ?? 1, step: s.step ?? .01, get: s.get, set: s.set});
    }
    if (A) out.push({tab: 'audio', group: 'Sound', label: 'Music', key: 'U', ...onOff(() => A.musicOn, v => { if (A.musicOn !== v) A.toggleMusic(); })});
    out.push({tab: 'graphics', group: 'Effects', label: 'Screen shake', id: 'shake', keep: true, ...onOff(() => opt.shake, v => { opt.shake = v; })});
    dv('Tools', {label: 'Frame profiler', key: 'F3', ...onOff(() => perf.on, v => { if (perf.on !== v) perf.toggle(); })});
    dv('Tools', {label: 'Key help panel', key: 'H', ...onOff(() => opt.help, v => { opt.help = v; })});
    dv('Tools', {label: 'Dev mode', key: '`', ...onOff(() => host.dev, v => { host.dev = v; })});
    return out;
  }
  const menu = createMenu({
    root: $('#pause'), items: menuItems, dev: () => host.dev, sound: host.uiSound, changed: E.applyOpts,
    title: () => E.game.mode === 'title' ? ['Settings', ''] : ['Paused', E.game.mode === 'run' && E.game.run ? `Run · stage ${E.game.run.stage + 1}` : E.game.mode === 'sandbox' ? 'Proving Grounds' : ''],
    groups: {graphics: ['Display', 'World', 'Effects'], audio: ['Sound', 'Volume'], controls: ['Camera', 'Keys'], dev: ['Character', 'World', 'Renderer', 'Features', 'Tools']},
    resume: snd => toggle(false, snd),
    look: dx => { E.input.look(dx); lookT = performance.now(); },
    zoom: e => cv.onWheel(e),
  });
  if (E.flags.get('detail') === 'low') setDetail('low');
  return {stepPaused, pauseTurn, toggle, menu, get paused() { return paused; }, get detail() { return detail; }};
}
