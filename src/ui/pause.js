// PAUSE: the menu (Escape; ui/menu.js draws it, these are its items) and what pausing means.
// PAUSED, the game stands still (the sim: player, arrows, enemies, fire, the run, the clock) but the world doesn't: the
// views of the features that declare F.ambient keep running in real time behind the blurred menu, so the wind blows,
// birds fly, rain falls and fires flicker. The cloak still answers the wind. The camera drifts slowly (drag the
// backdrop to look around) and eases back to where it was on resume. The audio feature ducks music + effects; the
// ambience plays on. (flow isn't ambient: its streaks / tracks follow the player's frozen speed)
// THE MAP: Game (resume, photo, the run, the character, the GAME_ROWS features' rows) · Graphics / Audio / Controls (what a
// player sets: the host's own rows + CLAIM). Every other feature's toggle, setting and test action is in the DEV MENU
// (dev/devmenu.js, F10 in dev mode: a page per feature), not here.
// OWNS: paused, the pause drift (pauseYaw / pauseGoal / lookT), the menu and its items (Game / Graphics / Audio / Controls
// tabs).  READS: E (the engine context, main.js).
//   const pause = createPause(E); pause.paused / toggle(force, snd) / stepPaused(dt) / pauseTurn(dt) / menu
import {createMenu} from './menu.js';
import {SNAP_NAME} from '../render/camera.js';
import {check as checkEvents} from '../core/events.js';
import {LOADOUTS} from '../view/hero.js';
const $ = s => document.querySelector(s);

const NO_EVS = [], PAUSE_TURN = .035, LOOK_HOLD = 3000;   // drift rad/s (the title turns at .07); ms after a drag before it drifts again
const onOff = (get, set) => ({options: ['on', 'off'], get: () => get() ? 'on' : 'off', set: v => set(v === 'on')});
const pick = (options, get, set) => ({options, get, set});
// features' toggles / settings a player sees, by feature and setting label ('' = its on / off); all of them (these too) are
// on the feature's page in the dev menu (dev/devmenu.js).
// id + keep: remembered on this machine (keep: the URL parameter that overrides it)
const gfx = (group, label, id, keep = true) => ({tab: 'graphics', group, label, id, keep});
const vol = label => ({tab: 'audio', group: 'Volume', label});
const CLAIM = {
  depth: {'': gfx('World', 'Clouds, light shafts & reflections', 'depth', 'depth'), 'Foreground silhouettes': gfx('World', 'Foreground foliage', 'fg')},
  weather: {'Weather fx': gfx('World', 'Rain, snow & lightning', 'rain')},
  lights: {'Heat ripple': gfx('Effects', 'Heat shimmer', 'heat')},
  atmos: {'Vignette + haze': gfx('Effects', 'Vignette', 'vignette', 'hd')},
  cinema: {'': {tab: 'controls', group: 'Camera', label: 'Cinematic camera when idle', id: 'cinema', keep: 'cinema'}},
  aim: {Aim: {tab: 'controls', group: 'Aim', label: 'Aim help', id: 'aim', keep: 'aim'}},   // (features/aim.js: manual / soft / lock / auto)
  blood: {'': gfx('Effects', 'Blood', 'blood', 'blood')},   // (features/blood.js: on by default; ?blood=0)
  uncanny: {'': {tab: 'game', group: 'World', label: 'Uncanny forest', id: 'uncanny', keep: 'uncanny'}},   // (features/uncanny.js: off by default; ?uncanny=1)
  audio: {'': {tab: 'audio', group: 'Sound', label: 'Sound', key: 'M'}, Volume: vol('Master'), Music: vol('Music'), Effects: vol('Effects'), Ambience: vol('Ambience'),
    'Gun sounds': {tab: 'audio', group: 'Sound', label: 'Gun sounds'}},   // (the western-movie flavor: features/audio.js, remembered there)
};
// THE FEATURES' ROWS (F.menu) the player sees, in the Game tab in this order (after Resume and Photo mode; back to title
// stays last): the cinematic camera, the camera (F6), the way to the dev menu (dev mode), the game's own (start / abandon
// a run, back to title). Every other feature's F.menu rows are test actions: the dev menu's (dev/devmenu.js)
export const GAME_ROWS = ['cinema', 'chasecam', 'devmenu', 'game'];
// DETAIL (Graphics), the quality tier: low switches the costliest purely cosmetic layers off (their views: the sim never
// reads a view, tools/test/simview.mjs, so gameplay can't change); high puts them back. ?detail=low starts low
const LOW_OFF = ['windlines', 'wildlife', 'fauna', 'depth', 'grass', 'litter', 'dust', 'tumbleweed', 'mist', 'airfx'];
const KEYS = [[['W', 'A', 'S', 'D'], 'move (camera-relative)'], [['Shift'], 'sprint'], [['Q'], 'walk'], [['C'], 'crouch'], [['Space'], 'roll · leap'],
  [['LMB'], 'hold to draw, release to shoot'], [['RMB'], 'multishot'], [['1', '2', '3', '4'], 'abilities'], [['E'], 'open · talk · climb'], [['F'], 'use the gadget (when you carry one)'],
  [['LMB'], 'revolver: draw · shoot'], [['RMB'], 'revolver: fan the hammer'], [['R'], 'revolver: reload'], [['V'], 'revolver: pistol whip'], [['Y'], 'tip the hat'],
  [['2', '1'], 'fists up / the gun again (the gunslinger)'], [['LMB', 'RMB'], 'fists: left / right hand (alternate: a combo; hold: a heavy; both: headbutt)'],
  [['E'], 'fists: grab a foe (again: toss)'], [['Space'], 'fists: slip a punch (then counter)'],
  [['LMB', 'E'], 'on a tree: chop it (an axe in the bag; hold to keep chopping)'], [['Tab'], 'the pack: bag, pouch, skills, build'],
  [['Z', 'X'], 'turn the camera (or drag with the middle button)'], [['Home'], 'reset the camera'], [['Wheel'], 'zoom in / out'],
  [['M'], 'mute'], [['U'], 'music on / off'], [['F4'], 'photo mode'], [['Esc'], 'this menu']];

const CHARS = {Ranger: 'ranger + cloth sim', Gunslinger: 'gunslinger', Outlaw: 'outlaw'};   // the menu's names -> LOADOUTS names
const charOf = name => name === 'gunslinger' ? 'Gunslinger' : name === 'outlaw' ? 'Outlaw' : 'Ranger';

export function createPause(E) {
  const {cv, pa, hero, events, features, keys, feat, opt, host} = E;
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
    const game = E.game;
    const out = [], A = feat('audio')?.AU;
    // Game: resume, photo mode, the cinematic camera, then the game's own rows (start / abandon a run, back to title)
    if (game.mode !== 'title') out.push({tab: 'game', label: 'Resume', main: true, sound: 'back', run() {}});
    if (E.photo?.allowed) out.push({tab: 'game', label: 'Photo mode', run: () => E.photo.toggle(true)});   // (ui/photo.js; F4)
    for (const n of GAME_ROWS) for (const m of feat(n)?.menu?.() || []) out.push({tab: 'game', label: m.label, run: m.run});
    // the character: the Ranger (bow), the gunslinger (Peacemaker), the outlaw (Brass Navy): view/hero.js LOADOUTS
    out.push({tab: 'game', group: 'Character', label: 'Play as', ...pick(Object.keys(CHARS), () => charOf(hero.loadName), v => {
      const i = LOADOUTS.findIndex(l => l[0] === CHARS[v]); if (i >= 0 && i !== hero.loadI) hero.switchLoadout(i); })});
    // Graphics, Controls: the host's own
    // (fullscreen keeps Escape for the menu: keyboard lock, where the browser has it; holding Esc still leaves fullscreen)
    out.push({tab: 'graphics', group: 'Display', label: 'Fullscreen', ...onOff(() => !!document.fullscreenElement, v => {
      try { (v ? document.documentElement.requestFullscreen?.().then(() => navigator.keyboard?.lock?.(['Escape'])) : document.fullscreenElement && document.exitFullscreen())?.catch?.(() => {}); } catch (e) {} })});
    out.push({tab: 'graphics', group: 'Display', label: 'Detail', id: 'detail', keep: 'detail', ...pick(['high', 'low'], () => detail, setDetail)});
    out.push({tab: 'graphics', group: 'World', label: 'Shadows', id: 'shadows', keep: true, ...onOff(() => opt.shadows, v => { opt.shadows = v; })});
    out.push({tab: 'controls', group: 'Camera', label: 'Camera turning', id: 'snap', keep: 'snap', ...pick(SNAP_NAME, () => SNAP_NAME[cv.snapMode], v => { cv.snapMode = SNAP_NAME.indexOf(v); })},
      {tab: 'controls', group: 'Keys', keys: KEYS});
    // the features' toggles and settings a player sees (CLAIM); the rest are the dev menu's
    for (const f of features) {
      const claim = CLAIM[f.name]; if (!claim || (!f.toggle && !f.settings)) continue;
      const put = (k, it) => { if (claim[k]) out.push({...it, key: undefined, ...claim[k]}); };
      if (f.toggle) put('', {label: f.label || f.name, ...onOff(() => f.on !== false, v => { if ((f.on !== false) !== v) f.toggle(); })});
      for (const s of f.settings?.() || []) put(s.label, s.options ? {label: s.label, ...pick(s.options, s.get, s.set)} : {label: s.label, min: s.min ?? 0, max: s.max ?? 1, step: s.step ?? .01, get: s.get, set: s.set});
    }
    if (A) out.push({tab: 'audio', group: 'Sound', label: 'Music', key: 'U', ...onOff(() => A.musicOn, v => { if (A.musicOn !== v) A.toggleMusic(); })});
    out.push({tab: 'graphics', group: 'Effects', label: 'Screen shake', id: 'shake', keep: true, ...onOff(() => opt.shake, v => { opt.shake = v; })});
    return out;
  }
  const menu = createMenu({
    root: $('#pause'), items: menuItems, sound: host.uiSound, changed: E.applyOpts,
    title: () => E.game.mode === 'title' ? ['Settings', ''] : ['Paused', E.game.mode === 'run' && E.game.run ? `Run · stage ${E.game.run.stage + 1}` : E.game.mode === 'sandbox' ? 'Proving Grounds' : ''],
    groups: {graphics: ['Display', 'World', 'Effects'], audio: ['Sound', 'Volume'], controls: ['Camera', 'Keys']},
    resume: snd => toggle(false, snd),
    look: dx => { E.input.look(dx); lookT = performance.now(); },
    zoom: e => cv.onWheel(e),
  });
  if (E.flags.get('detail') === 'low') setDetail('low');
  return {stepPaused, pauseTurn, toggle, menu, get paused() { return paused; }, get detail() { return detail; }};
}
