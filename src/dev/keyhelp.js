// KEY HELP (dev: F1 shows it with the debug HUD, opt.help): every key, in sections, as keycaps, with what it does and, for
// a switch, what it's set to now (gold). A row that does nothing right now is dimmed: the bow's keys while you hold the
// revolver, a feature that's off, a key another one has taken (F is the gadget while the equipment is on).
// The page's #help (index.html): built once, then only what changed is written (dev/devtools.js drawHud calls it while
// it shows, 4 times a second). A new key goes in SECTIONS here, not in index.html.
// READS: the debug HUD's context (host, opt, stage, env, hero, cv, perf). WRITES: #help only.
//   keyHelp(ctx)   build (the first time) and refresh
import {flags} from '../core/flags.js';
import {SNAP_NAME} from '../render/camera.js';
import {DEBUG} from '../render/options.js';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const onOff = b => b ? 'on' : 'off';

// a row: [keys, what it does (text or () -> text), state? () -> text, active? () -> bool]. KEYS: ' / ' between
// alternatives, '+' a combo (Shift+B), a space between keys shown together (W A S D)
function sections({host, opt, stage, env, hero, cv, perf}) {
  const f = n => host.feature(n), on = n => { const x = f(n); return !!x && x.on !== false; };
  const set = (n, label) => f(n)?.settings?.().find(s => s.label === label)?.get() ?? '';
  const gun = () => host.weapon?.kind === 'gun', bow = () => !gun();
  const kick = () => gun() && on('brawl') && flags.get('kick') !== '0';   // (features/brawl.js: the live cowboys' boot)
  const gadget = () => on('equip') && !!f('equip')?.sim?.S.slot, lasso = () => gadget() && f('equip').sim.S.slot.id === 'lasso';
  const desert = () => stage.biome.id === 'desert' && on('foes');
  const fists = () => !!host.live && on('fists') && !!host.PL?.fists, fistsUp = () => fists() && host.PL.fists.on;
  const sandbox = () => f('game')?.mode === 'sandbox';
  const wood = () => !!host.live && on('woodcut') && sandbox() && stage.biome.id === 'ruins';
  return [
    ['Move', [
      ['W A S D', 'move'], ['Shift', 'sprint'], ['Q', 'walk'], ['C', 'crouch'], ['Space', 'roll · leap'],
      ['E', 'open · climb · talk']]],
    ['Bow', [
      ['LMB', 'hold to draw, release to shoot', null, bow], ['RMB', 'multishot', null, bow], ['1 2 3 4', 'abilities', null, bow]]],
    ['Revolver', [
      ['LMB', 'draw · shoot', null, gun], ['RMB', 'fan the hammer', null, gun], ['R', 'reload', null, gun],
      ['V', () => kick() ? 'kick · at a sprint: shoulder barge' : 'pistol whip', null, gun], ['Y', 'tip the hat', null, gun],
      ['E', 'lift a crate, keg, hat or gun · again: set down', null, kick], ['LMB', 'throw what you carry', null, kick],
      ['Aim', "a gunman's hat, gun hand, legs: called shots", null, () => gun() && on('calls')]]],
    ['Fists', [   // (features/fists.js, docs/exp/fists.md: a live cowboy)
      ['2 / 1', 'fists (guard up in a fight) / the gun again', () => onOff(!!host.PL?.fists?.on), fists],
      ['LMB / RMB', 'left / right hand: alternate for jab, cross, hook, uppercut', null, fistsUp],
      ['hold LMB / RMB', 'body blow / haymaker (charge, release)', null, fistsUp], ['LMB+RMB', 'headbutt', null, fistsUp],
      ['V', 'in a combo: roundhouse · clinched: knee', null, fistsUp], ['E', 'grab a foe (clinch) · again: hip toss', null, fistsUp],
      ['Space', 'slip (beat a punch: counter) · clinched: shove', null, fistsUp]]],
    ['Gadget', [
      ['F', 'use it', () => f('equip')?.settings?.()[0]?.get() || 'none', gadget],
      ['F', 'lasso: rope an enemy, tap: yank · tow a barrel · swing', null, lasso],
      ['F', 'hold + release: zip line · up a ledge · pull a wall top down', null, lasso]]],
    ['Woodcutting', [   // (features/woodcut.js, pack.js, campfires.js: docs/GATHERING.md; a live cowboy in the sandbox)
      ['LMB / hold E', 'on a tree: chop it (an axe in the bag; the logs come to you)', () => host.PL?.tool?.on ? 'axe out' : '', wood],
      ['Tab', 'the pack: bag, pouch, skills, build · and your gear beside it', null, () => on('pack')],
      ['E', 'by your campfire: add a log', null, () => on('campfires') && sandbox()]]],
    ['Camera', [
      ['Z / X', 'turn', () => SNAP_NAME[cv.snapMode]], ['MMB', 'drag to turn'], ['Home', 'reset the camera'],
      ['Wheel', 'zoom', () => (cv.scale * cv.dz / cv.dsBase).toFixed(2) + 'x']]],
    ['Panels', [
      ['Esc', 'menu · Dev tab: every switch'], ['F1', 'this help + the debug HUD'],
      ['F2', 'cheats', () => onOff(on('cheats'))], ['F3', 'frame profiler', () => onOff(perf.on)], ['F4', 'photo mode'],
      ['F7', 'move feel (Shift: A/B)', () => onOff(on('movefeel'))], ['F8', 'gun feel', () => onOff(on('gunfeel'))], ['Tab', 'gear: what you wear', null, () => !on('pack')], ['Shift+Tab', 'the wardrobe: clothes, paint, stats, items, outfits', () => onOff(on('wardrobe'))], ['M', 'sound', () => on('audio') ? 'on' : 'muted'],
      ['U', 'music', () => onOff(f('audio')?.AU.musicOn)], ['`', 'dev mode']]],
    ['World', [
      ['T', 'time of day', () => `${env.clock()} ${env.part}`], ['N', 'biome (Shift: back)', () => stage.biome.name],
      ['B', 'wind strength', () => f('wind')?.mode ?? ''], ['K', 'air particles + ground fog', () => onOff(f('atmos')?.weather)],
      ['L', 'lantern', () => onOff(opt.lantern)], ['5', 'wind', () => onOff(on('wind'))], ['6', 'wildlife', () => onOff(on('wildlife'))],
      ['7', 'depth: clouds, shafts, reflections', () => onOff(on('depth'))], ['8', 'camera feel, trails, marks', () => onOff(on('flow'))],
      ['9', 'light sources', () => onOff(on('lights'))], ['F', "flames' look", () => set('lights', 'Flames'), () => !on('equip')]]],
    ['Look', [
      ['O', 'loadout', () => hero.loadName], ['J', 'bow', () => opt.hdBow ? 'HD overlay' : 'pixel art', bow],
      ['I', 'shiny armour', () => onOff(hero.armor.on)], ['P', 'props', () => stage.propMode === 'live' ? 'live 3D' : 'sprites'],
      ['Shift+P', 'trees', () => stage.trees3d ? '3D' : 'cards'],
      ['V', 'banded light', () => onOff(opt.banded), () => !gun()], ['Shift+V', 'gun smoke', () => set('gunfx', 'Smoke')],
      ['Shift+B', 'wind lines', () => f('windlines')?.TUNE.look ?? ''], ['Shift+1', 'camera turning', () => SNAP_NAME[cv.snapMode]],
      ['Shift+2', 'ground texture', () => opt.sampling], ['Shift+3', 'prop outlines', () => onOff(opt.outline)],
      ['Shift+6', 'shadows', () => onOff(opt.shadows)], ['G', 'debug view', () => DEBUG[opt.debug]], ['Shift+G', 'colliders', () => onOff(opt.zones)]]],
    ['Spawn', [
      ['.', 'an elite with the next affix', null, () => on('affixes')], ['Shift+.', 'its champion', null, () => on('affixes')],
      ['0', 'a gang of gunmen (desert)', null, desert], ['Shift+0', 'one gunman', null, desert],
      ['E', 'wanted board: take a bounty', null, desert], ['F10', 'dev menu: every test action and toggle', null, sandbox]]],
    ...(flags.get('live') === '1' ? [['Live hero', [
      ['Shift+7', 'sprite / live body'], ['Shift+8', 'motion preset'], ['Shift+9', 'demo · emote'],
      ['Shift+Alt+7', 'new movement A/B'], ['Shift+Alt+8', 'procedural layers A/B'], ['Shift+Alt+9', 'combat style A/B'], ['Shift+Alt+0', 'reactions A/B']]]] : []),
  ];
}

const caps = keys => keys.split(' / ').map(alt => alt.split(' ').map(k => k.split('+').map(c => `<kbd>${esc(c)}</kbd>`).join('<s>+</s>')).join(''))
  .join('<s>/</s>');

let rows = null;   // [{el, what, state, active, sEl, wEl, txt, wTxt, act}]
export function keyHelp(ctx) {
  const root = $('#help');
  if (!rows) {
    rows = [];
    const secs = sections(ctx);
    root.innerHTML = `<div class="kh-cols">${secs.map(([title, list]) => `<section><h5>${esc(title)}</h5>${list.map(() =>
      `<div class="kh-row"><span class="kh-k"></span><span class="kh-w"></span><span class="kh-s"></span></div>`).join('')}</section>`).join('')}</div>
      <div class="kh-foot"><b>gold</b>: what it's set to now · dimmed: does nothing right now · <kbd>F1</kbd> hides this</div>`;
    const els = root.querySelectorAll('.kh-row');
    let i = 0;
    for (const [, list] of secs) for (const [keys, what, state, active] of list) {
      const el = els[i++];
      el.querySelector('.kh-k').innerHTML = caps(keys);
      rows.push({el, what, state, active, wEl: el.querySelector('.kh-w'), sEl: el.querySelector('.kh-s'), wTxt: null, txt: null, act: true});
    }
  }
  for (const r of rows) {
    const w = typeof r.what === 'function' ? r.what() : r.what;
    if (w !== r.wTxt) { r.wTxt = w; r.wEl.textContent = w; }
    if (r.state) { const t = String(r.state()); if (t !== r.txt) { r.txt = t; r.sEl.textContent = t; } }
    if (r.active) { const a = !!r.active(); if (a !== r.act) { r.act = a; r.el.classList.toggle('off', !a); } }
  }
}
