// WARDROBE: the dev wardrobe, a screen of its own (Shift+Tab in dev mode, or the menu's Game tab: Wardrobe). The game stands
// still (photo mode's frozen world and camera, as its studio: ui/photo.js toggle(true, studio)) and the character stands on a
// little stage out of the world (dev/stage.js: a stage and a backdrop, the world left out of the frame: G.isolate; or "the
// world", dimmed round him), framed in the middle of the screen with the UI round him:
//   TOP      the title, the loadout, the tabs (Outfit, Paint, Tuner, Stats, Items, Saved), the keys, back to the game
//   LEFT     EQUIPMENT: a card a slot (head, body, back, legs, feet) with what he wears there (its colours, × takes it off),
//            random / undress, and the set's weight, armor and speed as bars
//   RIGHT    the tab:  Outfit   the chosen slot's pieces as cards (a click wears it), the piece under the pointer in detail
//                      Paint    the model's zones, a palette (a material, a picked colour, hidden) painted on the chosen one
//                      Tuner    a piece's shapes moved / turned / sized on sliders, drawn as you drag; "Copy code" puts them
//                               on the clipboard as content/gear.js lines
//                      Stats    sliders as MODIFIER notes under the source 'wardrobe' (core/modifiers.js), each applied by its
//                               owner: player.speed x, game.hurt x, weapon.dmg / reload / gap / melee x, combat.crit + / critMul +
//                               / enemyDmg x, light.lantern + / lanternR x
//                      Items    the run's items (+ / - a copy) and augments (on / off) through game/stats.js (a run starts empty)
//                      Saved    everything here saved under a name, worn again in one click; "Copy link" (?gear= ?set=)
//   BOTTOM   the scene: the backdrop, the stage, the light (the clock's preview), his pose (the live hero's emotes), turn,
//            spin, frame him, a photo
// Drag the scene to spin him (the set turns with the camera, so the backdrop stays behind him), right-drag to move, the wheel
// zooms, R frames him, H hides the UI, Tab the next tab, P a photo, Esc / Shift+Tab back to the game (the camera, zoom and yaw
// as they were; the clothes chosen are worn from then: features/gear.js preview want, co-op asks the server then).
// The look and the notes hold in DEV MODE only, like the cheat panel's. Paint and tuned pieces are the look only (no weight,
// no armor, nothing sent in co-op). Remembered on this machine ('rb.wardrobe').
// It is a FEATURE the boot puts at the end of the list (main.js; dev/: nothing in the game imports it). F.on is the screen
// open. While it's open the world stands still, so what the UI asks for (items, augments) is done at once; while it's shut,
// its update keeps the notes and the look in step with dev mode.
// OWNS: the screen (#wardrobe + its style), the 'wardrobe' notes, the gear preview it asks for, the studio's framing.
// READS: host (mods, the game's stats, the gear feature, dev), hero (the loadout), photo (the studio: its camera, light,
//   pose), cv (the zoom, the free camera's place), live (the emotes, its rig), content/gear.js, game/items.js.
// BUDGET: shut and nothing on: nothing. Open: the game is frozen; a few text writes 4 times a second; a slider drag: one
//   dress at most every 50 ms (2-25 ms each, view/dress.js).
import {SLOTS, SLOT_NAMES, GEAR, MATERIALS, ZONES, RULES, gearById, cleanSet, setStats} from '../content/gear.js';
import {ITEMS, AUGMENTS, TIER} from '../game/items.js';
import {LOADOUTS, SET_NAMES} from '../view/hero.js';
import {tint} from '../view/rigkit.js';
import {createStage, STAGES, STAGE_SW, BACKS as SETS} from './stage.js';

const STORE = 'rb.wardrobe', DEG = Math.PI / 180;
// the stats tab: each a note on the owner's stat (mul: x the value, 1 = as authored; add: + the value, 0 = none)
const KNOBS = [
  {k: 'speed', label: 'Move speed', stat: 'player.speed', mul: 1, min: .25, max: 3, note: 'walk / run / sprint (player.js)'},
  {k: 'hurt', label: 'Damage taken', stat: 'game.hurt', mul: 1, min: 0, max: 3, note: 'x the damage you take (0: none)'},
  {k: 'gdmg', label: 'Gun damage', stat: 'weapon.dmg', mul: 1, min: 0, max: 5, note: "a bullet's damage (sim/player/gun.js)"},
  {k: 'reload', label: 'Reload time', stat: 'weapon.reload', mul: 1, min: .1, max: 3, note: 'the revolver (< 1: faster)'},
  {k: 'gap', label: 'Shot gap', stat: 'weapon.gap', mul: 1, min: .25, max: 3, note: 'the time between shots (< 1: faster)'},
  {k: 'melee', label: 'Melee damage', stat: 'weapon.melee', mul: 1, min: 0, max: 5, note: 'a kick, a barge, a pistol-whip'},
  {k: 'crit', label: 'Crit chance', stat: 'combat.crit', add: 0, min: 0, max: 1, note: '+ on top of combat\'s 15%'},
  {k: 'critMul', label: 'Crit damage', stat: 'combat.critMul', add: 0, min: 0, max: 5, note: '+ on top of combat\'s 2x'},
  {k: 'enemyDmg', label: 'Brutes hit', stat: 'combat.enemyDmg', mul: 1, min: 0, max: 3, note: "x the run's brutes' damage"},
  {k: 'lanternR', label: 'Lantern size', stat: 'light.lanternR', mul: 1, min: .25, max: 4, note: 'x the lantern\'s radius'},
  {k: 'lantern', label: 'Lantern lit', stat: 'light.lantern', add: 0, min: 0, max: 1, step: 1, note: '1: lit whatever the switch says'},
];
const knob0 = n => n.mul ?? n.add;
// a shape's size fields, by shape (content/gear.js add): the tuner's sliders
const SIZE = {box: ['size.0', 'size.1', 'size.2'], ball: ['r.0', 'r.1', 'r.2'], tube: ['r0', 'r1', 'len'], disc: ['r', 'len'], cone: ['r', 'len']};
const TABS = [['outfit', 'Outfit'], ['paint', 'Paint'], ['tuner', 'Tuner'], ['stats', 'Stats'], ['items', 'Items'], ['saved', 'Saved']];
const TAB_IDS = TABS.map(t => t[0]);
const LIGHTS = {'as is': null, dawn: 6.6, day: 12, dusk: 19.2, night: 23.5};
const BACKS = ['world', ...Object.keys(SETS)];   // 'world': no stage, the world dimmed round him (the vignette); else a studio set (dev/stage.js)
const DEF = {tab: 'outfit', slot: 'head', zone: 'coat', spin: false, back: 'curtain', stage: 'stone', light: 'as is', paint: {}, cloth: '', custom: '#5a8f6a',
  tune: {}, stats: {}, piece: '', shape: 0, outfits: []};
const OWN = '#6b5e50';   // the swatch of "his own clothes"
const CSS = `
#wardrobe { position: fixed; inset: 0; z-index: 22; pointer-events: none; user-select: none; color: var(--ink); font-size: clamp(12px, .78vw, 16px); line-height: 1.35; }
#wardrobe.hidden { display: none; }
#wardrobe.wd-clean .wd-pane, #wardrobe.wd-clean .wd-msg { display: none; }
#wardrobe .wd-vig { position: absolute; inset: 0; opacity: 0; background: radial-gradient(ellipse 24% 44% at var(--cx, 50%) var(--cy, 50%), transparent 35%, #0b0d0c 100%); }
#wardrobe .wd-pane { position: absolute; pointer-events: auto; box-sizing: border-box; background: linear-gradient(180deg, rgba(20, 22, 21, .94), rgba(11, 13, 12, .92));
  border: 1px solid rgba(240, 192, 96, .2); border-radius: .7em; box-shadow: 0 .6em 2em rgba(0, 0, 0, .45); }
#wardrobe button { font: inherit; color: inherit; cursor: pointer; }
#wardrobe .wd-h { display: flex; align-items: center; gap: .6em; margin: 1em 0 .5em; font-size: .78em; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--dim); }
#wardrobe .wd-h::after { content: ''; flex: 1; height: 1px; background: var(--line); }
#wardrobe .wd-h:first-child { margin-top: 0; }
#wardrobe .wd-dim { color: var(--dim); } #wardrobe .wd-key { color: var(--key); }
#wardrobe .wd-note { font-size: .86em; color: var(--dim); margin: .4em 0; }
/* top bar */
#wardrobe .wd-top { left: 1.2em; right: 1.2em; top: 1em; height: 3.6em; display: flex; align-items: center; gap: 1.4em; padding: 0 .8em 0 1.2em; }
#wardrobe .wd-brand b { display: block; font-size: 1.35em; letter-spacing: .3em; color: var(--key); }
#wardrobe .wd-brand select { margin-top: .1em; font: inherit; font-size: .85em; color: var(--dim); background: none; border: 0; padding: 0; cursor: pointer; }
#wardrobe .wd-brand select option { background: #1a1d1b; color: var(--ink); }
#wardrobe .wd-tabs { display: flex; gap: .3em; margin: 0 auto; }
#wardrobe .wd-tab { padding: .45em 1.1em; background: none; border: 1px solid transparent; border-radius: .5em; color: var(--dim); letter-spacing: .06em; }
#wardrobe .wd-tab:hover { color: var(--ink); background: rgba(255, 255, 255, .04); }
#wardrobe .wd-tab.on { color: var(--key); border-color: rgba(240, 192, 96, .45); background: rgba(240, 192, 96, .1); }
#wardrobe .wd-keys { font-size: .8em; color: var(--dim); text-align: right; }
#wardrobe .wd-back { padding: .5em 1em; border: 1px solid var(--line); border-radius: .5em; background: rgba(255, 255, 255, .04); }
#wardrobe .wd-back:hover { border-color: var(--key); color: var(--key); }
#wardrobe .wd-back kbd { font: inherit; font-size: .8em; color: var(--dim); margin-right: .5em; }
/* left: equipment */
#wardrobe .wd-left { left: 1.2em; top: 5.6em; bottom: 1em; width: 17em; padding: 1em; display: flex; flex-direction: column; overflow: auto; scrollbar-width: thin; }
#wardrobe .wd-slot { position: relative; display: flex; align-items: center; gap: .75em; width: 100%; margin-bottom: .45em; padding: .5em .6em; text-align: left;
  background: rgba(255, 255, 255, .035); border: 1px solid var(--line); border-radius: .55em; }
#wardrobe .wd-slot:hover { background: rgba(255, 255, 255, .07); }
#wardrobe .wd-slot.on { border-color: var(--key); background: rgba(240, 192, 96, .09); }
#wardrobe .wd-slot .wd-tx { flex: 1; min-width: 0; }
#wardrobe .wd-slot small { display: block; font-size: .72em; letter-spacing: .14em; text-transform: uppercase; color: var(--dim); }
#wardrobe .wd-slot span.n { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#wardrobe .wd-slot.own span.n { color: var(--dim); font-style: italic; }
#wardrobe .wd-off { padding: 0 .35em; border: 0; background: none; color: var(--dim); font-size: 1.1em; }
#wardrobe .wd-off:hover { color: #ff8a6a; }
#wardrobe .wd-sw { flex: 0 0 auto; width: 2.4em; height: 2.4em; border-radius: .4em; overflow: hidden; display: flex; flex-direction: column; border: 1px solid rgba(0, 0, 0, .5);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .08); }
#wardrobe .wd-sw i { flex: 1; }
#wardrobe .wd-row2 { display: flex; gap: .4em; margin: .3em 0 .2em; }
#wardrobe .wd-btn { flex: 1; padding: .45em .6em; border: 1px solid var(--line); border-radius: .5em; background: rgba(255, 255, 255, .04); }
#wardrobe .wd-btn:hover { border-color: var(--key); }
#wardrobe .wd-btn.on { border-color: var(--key); background: rgba(240, 192, 96, .18); color: var(--key); }
#wardrobe .wd-bar { margin: .45em 0; font-size: .9em; }
#wardrobe .wd-bar div { display: flex; justify-content: space-between; }
#wardrobe .wd-bar b { font-weight: 400; color: var(--key); }
#wardrobe .wd-bar span.t { display: block; height: .4em; margin-top: .25em; border-radius: .2em; background: rgba(255, 255, 255, .08); overflow: hidden; }
#wardrobe .wd-bar span.t i { display: block; height: 100%; background: linear-gradient(90deg, #c89a3a, #f2d070); border-radius: .2em; }
#wardrobe .wd-bar.bad span.t i { background: linear-gradient(90deg, #a13b33, #e2644d); }
#wardrobe .wd-wait { color: var(--key); font-size: .86em; }
/* right: the tab */
#wardrobe .wd-right { right: 1.2em; top: 5.6em; bottom: 1em; width: 22em; padding: 1em 1.1em; overflow: auto; scrollbar-width: thin; }
#wardrobe .wd-cards { display: grid; grid-template-columns: 1fr 1fr; gap: .5em; }
#wardrobe .wd-card { display: flex; flex-direction: column; padding: 0; text-align: left; background: rgba(255, 255, 255, .035); border: 1px solid var(--line); border-radius: .55em; overflow: hidden; }
#wardrobe .wd-card:hover { background: rgba(255, 255, 255, .07); border-color: rgba(240, 192, 96, .5); }
#wardrobe .wd-card.on { border-color: var(--key); box-shadow: 0 0 0 1px var(--key) inset; }
#wardrobe .wd-card .wd-band { display: flex; height: 1.9em; }
#wardrobe .wd-card .wd-band i { flex: 1; }
#wardrobe .wd-card .wd-ct { padding: .4em .55em .5em; }
#wardrobe .wd-card .wd-ct span { display: block; }
#wardrobe .wd-card .wd-ct small { color: var(--dim); font-size: .8em; }
#wardrobe .wd-card .wd-badge { float: right; font-size: .7em; letter-spacing: .1em; color: var(--key); text-transform: uppercase; }
#wardrobe .wd-info { margin-top: 1em; padding: .8em .9em; border: 1px solid var(--line); border-radius: .55em; background: rgba(0, 0, 0, .2); min-height: 7em; }
#wardrobe .wd-info b { font-size: 1.1em; color: var(--ink); }
#wardrobe .wd-info .wd-soon { color: var(--dim); font-style: italic; }
#wardrobe .wd-zones { display: grid; grid-template-columns: 1fr 1fr; gap: .35em; }
#wardrobe .wd-zone { display: flex; align-items: center; gap: .5em; padding: .35em .5em; text-align: left; background: rgba(255, 255, 255, .035); border: 1px solid var(--line); border-radius: .45em; }
#wardrobe .wd-zone:hover { background: rgba(255, 255, 255, .07); }
#wardrobe .wd-zone.on { border-color: var(--key); }
#wardrobe .wd-zone i { width: 1em; height: 1em; border-radius: .25em; border: 1px solid rgba(0, 0, 0, .5); }
#wardrobe .wd-zone.set span { color: var(--key); }
#wardrobe .wd-pal { display: grid; grid-template-columns: repeat(6, 1fr); gap: .35em; }
#wardrobe .wd-chip { position: relative; aspect-ratio: 1; padding: 0; border: 1px solid rgba(0, 0, 0, .55); border-radius: .4em; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .08); }
#wardrobe .wd-chip:hover { transform: scale(1.08); }
#wardrobe .wd-chip.on { outline: 2px solid var(--key); outline-offset: 1px; }
#wardrobe .wd-chip.tx { display: flex; align-items: center; justify-content: center; font-size: .75em; color: var(--dim); background: rgba(255, 255, 255, .05); }
#wardrobe input[type=color] { width: 2.2em; height: 1.6em; padding: 0; border: 1px solid var(--line); border-radius: .3em; background: none; cursor: pointer; }
#wardrobe .wd-sl { display: flex; align-items: center; gap: .6em; margin: .35em 0; }
#wardrobe .wd-sl > span:first-child { flex: 0 0 7.2em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#wardrobe .wd-sl.on > span:first-child, #wardrobe .wd-sl.on .wd-v { color: var(--key); }
#wardrobe .wd-sl .wd-v { flex: 0 0 3.6em; text-align: right; color: var(--dim); font-variant-numeric: tabular-nums; }
#wardrobe input[type=range] { -webkit-appearance: none; appearance: none; flex: 1; min-width: 3em; height: 3px; margin: 0; background: rgba(255, 255, 255, .22); border-radius: 2px; outline: none; cursor: pointer; }
#wardrobe input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: .9em; height: .9em; border-radius: 50%; background: #f0c060; box-shadow: 0 1px 3px rgba(0, 0, 0, .6); }
#wardrobe input[type=range]::-moz-range-thumb { width: .9em; height: .9em; border: 0; border-radius: 50%; background: #f0c060; }
#wardrobe select, #wardrobe input[type=text] { font: inherit; color: var(--ink); background: rgba(255, 255, 255, .06); border: 1px solid var(--line); border-radius: .4em; padding: .3em .45em; }
#wardrobe select option { background: #1a1d1b; }
#wardrobe .wd-pick { display: flex; flex-wrap: wrap; gap: .35em; }
#wardrobe .wd-pick button { padding: .3em .7em; border: 1px solid var(--line); border-radius: .45em; background: rgba(255, 255, 255, .04); }
#wardrobe .wd-pick button:hover { border-color: rgba(240, 192, 96, .5); }
#wardrobe .wd-pick button.on { border-color: var(--key); color: var(--key); background: rgba(240, 192, 96, .12); }
#wardrobe .wd-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: .4em; }
#wardrobe .wd-tile { display: flex; align-items: center; gap: .5em; padding: .4em .5em; border: 1px solid var(--line); border-radius: .5em; background: rgba(255, 255, 255, .035); }
#wardrobe .wd-tiles.list { grid-template-columns: 1fr; }
#wardrobe .wd-tile.off { opacity: .4; }
#wardrobe .wd-tile.on { border-color: var(--key); background: rgba(240, 192, 96, .09); }
#wardrobe .wd-tile .g { width: 1.4em; font-size: 1.2em; text-align: center; }
#wardrobe .wd-tile .n { flex: 1; min-width: 0; font-size: .9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#wardrobe .wd-tile .c { min-width: 1.2em; text-align: center; color: var(--key); }
#wardrobe .wd-tile button { width: 1.6em; height: 1.6em; padding: 0; border: 1px solid var(--line); border-radius: .35em; background: rgba(255, 255, 255, .05); }
#wardrobe .wd-tile button:hover { border-color: var(--key); }
#wardrobe .wd-saved { display: flex; align-items: center; gap: .5em; padding: .5em .6em; margin-bottom: .4em; border: 1px solid var(--line); border-radius: .5em; background: rgba(255, 255, 255, .035); }
#wardrobe .wd-saved .n { flex: 1; min-width: 0; }
#wardrobe .wd-saved .n small { display: block; color: var(--dim); font-size: .8em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* bottom: the scene */
#wardrobe .wd-bottom { left: 19.6em; right: 24.6em; bottom: 1em; padding: .7em 1em; display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-end; gap: .8em 1.6em; }
#wardrobe .wd-grp > small { display: block; margin-bottom: .35em; font-size: .72em; letter-spacing: .16em; text-transform: uppercase; color: var(--dim); text-align: center; }
#wardrobe .wd-grp .wd-row { display: flex; gap: .3em; }
#wardrobe .wd-bottom .wd-chip { width: 2.1em; }
#wardrobe .wd-bottom .wd-pick button { padding: .35em .6em; }
#wardrobe .wd-msg { position: absolute; left: 50%; top: 5.6em; transform: translateX(-50%); padding: .45em 1.1em; border-radius: 2em; background: rgba(10, 12, 11, .85);
  border: 1px solid rgba(240, 192, 96, .35); color: var(--key); opacity: 0; transition: opacity .25s; }
#wardrobe .wd-msg.on { opacity: 1; }
body.wd #gear { display: none; }`;

const fmtN = v => String(+v.toFixed(3)).replace(/^(-?)0\./, '$1.');
const copy = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const pct = v => Math.round(v * 100) + '%';
// a picked colour -> 4 tones (hi, base, shade, dark) like content/gear.js MATERIALS
const tonesOf = hex => [tint([hex], '#ffffff', .32)[0], hex, tint([hex], '#000000', .3)[0], tint([hex], '#000000', .62)[0]];
// a piece's colours (its materials' base tones, at most 4): its swatch
function colorsOf(g) {
  if (!g) return [OWN];
  const L = g.look || {}, ms = [...Object.values(L.paint || {}), ...(L.add || []).map(a => a.mat), ...(L.cloth && L.cloth !== 'off' ? [L.cloth] : [])];
  const out = [...new Set(ms)].filter(m => MATERIALS[m]).slice(0, 4).map(m => MATERIALS[m][1]);
  return out.length ? out : [OWN];
}
const stripes = (cols, el) => { el.textContent = ''; for (const c of cols) { const i = document.createElement('i'); i.style.background = c; el.appendChild(i); } };
// a piece's shapes as content/gear.js source lines
function codeOf(g, add) {
  const v3 = a => `[${a.map(fmtN).join(', ')}]`;
  const line = a => {
    const f = [`on: '${a.on}'`, `part: '${a.part}'`, `mat: '${a.mat}'`, `shape: '${a.shape}'`];
    if (a.size) f.push(`size: ${v3(a.size)}`);
    if (a.r !== undefined) f.push(`r: ${Array.isArray(a.r) ? v3(a.r) : fmtN(a.r)}`);
    for (const k of ['r0', 'r1', 'len']) if (a[k] !== undefined) f.push(`${k}: ${fmtN(a[k])}`);
    f.push(`at: ${v3(a.at)}`);
    if (a.rot && a.rot.some(x => x)) f.push(`rot: ${v3(a.rot.map(x => Math.round(x)))}`);
    if (a.o) f.push(`o: {${Object.entries(a.o).map(([k, x]) => `${k}: ${typeof x === 'string' ? `'${x}'` : x}`).join(', ')}}`);
    return `      {${f.join(', ')}},`;
  };
  return `    // ${g.id}: look.add (dev/wardrobe.js)\n    add: [\n${add.map(line).join('\n')}\n    ]`;
}

// opts: {host, hero (the loadout: view/hero.js), cv (render/camera.js), live (view/livehero.js, or null), photo: () => ui/photo.js
// (made after the features)}
export function createWardrobe({host, hero, cv, live, photo}) {
  const C = copy(DEF);
  try { Object.assign(C, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
  if (!TAB_IDS.includes(C.tab)) C.tab = 'outfit';
  if (!SLOTS.includes(C.slot)) C.slot = 'head';
  for (const k of ['paint', 'tune', 'stats']) if (!C[k] || typeof C[k] !== 'object' || Array.isArray(C[k])) C[k] = {};
  if (!Array.isArray(C.outfits)) C.outfits = [];
  for (const id in C.tune) if (!gearById(id)?.look?.add || !Array.isArray(C.tune[id])) delete C.tune[id];
  for (const n of KNOBS) { const v = C.stats[n.k]; if (!(v >= n.min && v <= n.max)) delete C.stats[n.k]; }
  if (!BACKS.includes(C.back)) C.back = 'curtain'; if (!STAGES.includes(C.stage)) C.stage = 'stone'; if (!(C.light in LIGHTS)) C.light = 'as is'; delete C.open;
  let saveT = 0;
  const save = () => { saveT = 0; try { localStorage.setItem(STORE, JSON.stringify(C)); } catch (e) {} };
  const gear = () => host.feature('gear'), game = () => host.feature('game'), stats = () => game()?.stats;
  const kind = () => host.weapon?.kind ?? 'bow';
  const zonesNow = () => ZONES[(hero.loadName || '').split(' ')[0] + '.py'] || ZONES['gunslinger.py'];
  const sound = n => host.uiSound?.(n);

  // ---------------------------------------------------------------- the notes and the look (applied on change and as dev mode turns)
  function applyNotes() {
    const notes = [];
    if (host.dev) for (const n of KNOBS) { const v = C.stats[n.k]; if (v === undefined) continue; notes.push(n.mul !== undefined ? {stat: n.stat, mul: v} : {stat: n.stat, add: v}); }
    if (notes.length) host.mods.set('wardrobe', notes); else host.mods.clear('wardrobe');
  }
  let lookDirty = true, lookT = 0, previewing = false;
  const preview = o => { if (!o && !previewing) return; previewing = !!o; gear().preview(o); };   // (never asked: nothing to undo)
  function applyLook() {
    const g = gear(); if (!g?.preview) return;
    if (!host.dev) { preview(null); return; }
    const swap = {}; let n = 0;
    for (const id in C.tune) { const p = gearById(id); swap[id] = {...p, look: {...p.look, add: C.tune[id]}}; n++; }
    const paint = {}, hide = [];
    for (const [z, m] of Object.entries(C.paint)) { if (m === 'hide') hide.push(z); else if (m === 'custom') paint[z] = tonesOf(C.custom); else if (MATERIALS[m]) paint[z] = m; }
    const cloth = C.cloth === 'custom' ? tonesOf(C.custom) : C.cloth === 'off' || MATERIALS[C.cloth] ? C.cloth : '';
    const extra = Object.keys(paint).length || hide.length || cloth ? [{id: 'wardrobe', name: 'Wardrobe', slot: '', look: {paint, hide, cloth: cloth || undefined}}] : [];
    preview(n || extra.length || F.on ? {swap, extra, key: 'wardrobe', want: F.on} : null);   // (the screen: the set as chosen, worn on the way out)
  }
  const lookChanged = () => { lookDirty = true; saveT = .3; };

  // ---------------------------------------------------------------- what the UI asks for: carried out in the sim step (or at once: the world stands still)
  const queue = [];
  const ask = fn => { if (F.on) fn(); else queue.push(fn); };
  const wear = ids => ask(() => gear()?.choose(cleanSet(ids)));
  const wearing = () => gear()?.S.want || [];
  const inSlot = slot => wearing().find(id => gearById(id).slot === slot) || '';
  const wearIn = (slot, id) => wear([...wearing().filter(w => gearById(w).slot !== slot), ...(id ? [id] : [])]);
  function setLoadout(i) { const n = LOADOUTS.length; hero.switchLoadout(((i % n) + n) % n); lookChanged(); }
  function giveItem(id, d) {
    const st = stats(), it = ITEMS.find(x => x.id === id); if (!st || !it) return;
    if (d > 0) st.addItem(it); else st.removeItem(id);
  }
  function flipAug(id) { const st = stats(), a = AUGMENTS.find(x => x.id === id); if (!st || !a) return; if (st.augs.has(id)) st.removeAugment(id); else st.addAugment(a); }
  function clearBuild() { const st = stats(); if (!st) return; for (const [id, n] of [...st.items]) for (let i = 0; i < n; i++) st.removeItem(id); for (const id of [...st.augs]) st.removeAugment(id); }
  function randomOutfit() {   // (the UI's own pick: Math.random is fine here, it's the UI, not the sim)
    const ids = [];
    for (const s of SLOTS) { const ps = GEAR.filter(g => g.slot === s); const i = Math.floor(Math.random() * (ps.length + 1)); if (i < ps.length) ids.push(ps[i].id); }
    wear(ids); say(ids.length ? ids.map(id => gearById(id).name).join(', ') : 'his own clothes');
  }

  // ---------------------------------------------------------------- saved outfits: all of it under a name
  function snapshot(name) {
    const st = stats();
    return {name, set: hero.loadI, gear: [...wearing()], paint: copy(C.paint), cloth: C.cloth, custom: C.custom, tune: copy(C.tune), stats: copy(C.stats),
      items: st ? [...st.items] : [], augs: st ? [...st.augs] : []};
  }
  function wearOutfit(o) {
    if (Number.isInteger(o.set) && o.set !== hero.loadI && o.set >= 0 && o.set < LOADOUTS.length) setLoadout(o.set);
    wear(o.gear || []);
    C.paint = copy(o.paint || {}); C.cloth = o.cloth || ''; C.custom = o.custom || C.custom; C.tune = copy(o.tune || {}); C.stats = copy(o.stats || {});
    for (const id in C.tune) if (!gearById(id)?.look?.add) delete C.tune[id];
    ask(() => {
      clearBuild();
      for (const [id, n] of o.items || []) for (let i = 0; i < n; i++) giveItem(id, 1);
      for (const id of o.augs || []) flipAug(id);
    });
    applyNotes(); lookChanged(); save(); tab(); say(`wearing "${o.name}"`);
  }
  function linkOf() {
    const u = new URL(location.href), ids = wearing();
    u.searchParams.set('gear', ids.length ? ids.join(',') : 'none');
    if (SET_NAMES[hero.loadI]) u.searchParams.set('set', SET_NAMES[hero.loadI]);
    return u.toString();
  }
  function clip(text, what) {
    console.log(text);
    const p = navigator.clipboard?.writeText(text);
    if (p) p.then(() => say(`${what} copied`), () => say(`${what}: in the console (F12)`)); else say(`${what}: in the console (F12)`);
  }

  // ---------------------------------------------------------------- the DOM: the screen round the scene
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'wardrobe'; root.className = 'hidden'; document.body.appendChild(root);
  // no focus but the form fields' (Space / Enter stay the game's); a key in a text field is the field's, any other blurs it
  root.addEventListener('mousedown', e => { if (!/^(INPUT|SELECT|OPTION)$/.test(e.target.tagName)) e.preventDefault(); });
  root.addEventListener('keydown', e => {
    if (e.target.type === 'text') { e.stopPropagation(); if (e.key === 'Escape') e.target.blur(); return; }
    e.target.blur?.();
  });
  let hov = null;   // (a hover sound once an element)
  root.addEventListener('pointerover', e => { const b = e.target.closest?.('button'); if (b && b !== hov) { hov = b; sound('hover'); } });
  const rows = [];   // each: sync() (writes only what changed); the tab's are after tabRows
  let tabRows = 0;
  const put = (e, k, v) => { if (e[k] !== v) e[k] = v; };
  const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; parent.appendChild(e); return e; };
  const btn = (cls, parent, text, go, title) => { const b = el('button', cls, parent, text); if (title) b.title = title; b.onclick = e => { go(e); sync(); }; return b; };
  const head = (parent, t) => el('div', 'wd-h', parent, t);

  const vig = el('div', 'wd-vig', root);
  const top = el('div', 'wd-pane wd-top', root), left = el('div', 'wd-pane wd-left', root), right = el('div', 'wd-pane wd-right', root);
  const bottom = el('div', 'wd-pane wd-bottom', root), msgEl = el('div', 'wd-msg', root);
  let msgT = 0;
  function say(s) { msgEl.textContent = s; msgEl.classList.add('on'); msgT = 3.5; }

  // ---- top: the title and the loadout, the tabs, the keys, back
  {
    const brand = el('div', 'wd-brand', top); el('b', '', brand, 'WARDROBE');
    const s = el('select', '', brand); s.title = 'the loadout (the gear shows on a live model: the gunslinger; ?live=1 the outlaw too)';
    LOADOUTS.forEach((L, i) => { const o = el('option', '', s, L[0]); o.value = i; });
    s.onchange = () => { setLoadout(+s.value); s.blur(); };
    rows.push(() => put(s, 'value', String(hero.loadI)));
    const tabs = el('div', 'wd-tabs', top);
    for (const [id, name] of TABS) {
      const b = btn('wd-tab', tabs, name, () => { C.tab = id; save(); sound('click'); tab(); });
      rows.push(() => b.classList.toggle('on', C.tab === id));
    }
    el('div', 'wd-keys', top).innerHTML = 'drag: spin · right-drag: move · wheel: zoom<br>R: frame · H: hide · Tab: next tab · P: photo';
    const back = btn('wd-back', top, '', () => close(), 'back to the game: the clothes chosen are worn from then');
    back.innerHTML = '<kbd>Esc</kbd>Back to the game';
  }

  // ---- left: the equipment
  {
    head(left, 'Equipment');
    for (const slot of SLOTS) {
      const b = el('button', 'wd-slot', left), sw = el('span', 'wd-sw', b), tx = el('span', 'wd-tx', b);
      el('small', '', tx, SLOT_NAMES[slot]); const n = el('span', 'n', tx);
      const off = btn('wd-off', b, '×', e => { e.stopPropagation(); wearIn(slot, ''); sound('back'); }, 'take it off (his own clothes)');
      b.onclick = () => { C.slot = slot; C.tab = 'outfit'; save(); sound('click'); tab(); sync(); };
      let shown = null;
      rows.push(() => {
        const id = inSlot(slot), g = gearById(id);
        if (id !== shown) { shown = id; stripes(colorsOf(g), sw); }
        put(n, 'textContent', g ? g.name : 'his own'); b.classList.toggle('own', !g); b.classList.toggle('on', C.tab === 'outfit' && C.slot === slot);
        put(off.style, 'visibility', g ? '' : 'hidden');
      });
    }
    const r = el('div', 'wd-row2', left);
    btn('wd-btn', r, 'Random', () => { randomOutfit(); sound('confirm'); }, 'a piece (or none) in every slot');
    btn('wd-btn', r, 'Undress', () => { wear([]); sound('back'); }, 'his own clothes in every slot');
    head(left, 'The set');
    const bar = (label, title) => {
      const d = el('div', 'wd-bar', left); d.title = title;
      const t = el('div', '', d); el('span', '', t, label); const v = el('b', '', t);
      const fill = el('i', '', el('span', 't', d));
      return (text, k, bad) => { put(v, 'textContent', text); put(fill.style, 'width', Math.round(Math.max(0, Math.min(1, k)) * 100) + '%'); d.classList.toggle('bad', !!bad); };
    };
    const wB = bar('Weight', `past ${RULES.FREE_KG} kg it slows you`), aB = bar('Armor', 'a share off the damage you take'), sB = bar('Speed', 'what the weight leaves you');
    const wait = el('div', 'wd-wait', left);
    rows.push(() => {
      const st = setStats(wearing());
      wB(`${st.kg.toFixed(1)} kg`, st.kg / 20, st.kg > RULES.FREE_KG); aB(pct(st.armor), st.armor / RULES.ARMOR_MAX); sB(pct(st.speed), (st.speed - RULES.SLOW_MIN) / (1 - RULES.SLOW_MIN), st.speed < 1);
      put(wait, 'textContent', gear()?.S.waiting ? 'waiting for the server…' : '');
    });
    el('div', 'wd-note', left, 'Shown now; worn when you go back to the game.');
  }

  // ---- bottom: the scene
  {
    const grp = (label, title) => { const g = el('div', 'wd-grp', bottom); if (title) g.title = title; el('small', '', g, label); return el('div', 'wd-row', g); };
    const bk = grp('Backdrop');
    for (const k of BACKS) {
      const c = btn('wd-chip', bk, '', () => { C.back = k; save(); backdrop(); sound('click'); }, k === 'world' ? 'the world (no stage: where he stands)' : k);
      c.style.background = k === 'world' ? 'linear-gradient(160deg, #8cb8e6 0 45%, #6e9d45 45%)' : SETS[k].sw;
      rows.push(() => c.classList.toggle('on', C.back === k));
    }
    const sg = grp('Stage'), sgGrp = sg.parentNode;
    for (const k of STAGES) {
      const c = btn('wd-chip' + (k === 'none' ? ' tx' : ''), sg, k === 'none' ? '—' : '', () => { C.stage = k; save(); backdrop(); sound('click'); }, k);
      if (k !== 'none') c.style.background = STAGE_SW[k];
      rows.push(() => c.classList.toggle('on', C.stage === k));
    }
    rows.push(() => put(sgGrp.style, 'opacity', C.back === 'world' ? '.35' : ''));
    const lt = el('div', 'wd-pick', grp('Light', "the time of day for the light (the clock's preview: nothing changes in the game)"));
    for (const k of Object.keys(LIGHTS)) {
      const b = btn('', lt, k === 'as is' ? 'Now' : k[0].toUpperCase() + k.slice(1), () => { C.light = k; save(); light(); sound('click'); });
      rows.push(() => b.classList.toggle('on', C.light === k));
    }
    if (live?.emotes?.length) {
      const ps = el('select', '', grp('Pose', "the live hero's emotes"));
      for (const [v, t] of [['none', 'Standing'], ...live.emotes.map(e => [e, e.replace(/_/g, ' ')])]) { const o = el('option', '', ps, t); o.value = v; }
      ps.onchange = () => { pose = ps.value; const ph = photo(); if (ph?.open) ph.pose = pose; ps.blur(); };
      rows.push(() => put(ps, 'value', pose));
    }
    const vw = el('div', 'wd-pick', grp('View'));
    btn('', vw, '⟲', () => photo()?.turn(-45 * DEG), 'turn 45°');
    const sp = btn('', vw, 'Spin', () => { C.spin = !C.spin; save(); }, 'he turns slowly');
    btn('', vw, '⟳', () => photo()?.turn(45 * DEG), 'turn 45°');
    btn('', vw, 'Frame', () => frame(), 'R: the camera on him again');
    btn('', vw, 'Photo', () => photo()?.shoot(), 'P: a PNG of the scene (photo mode\'s)');
    rows.push(() => sp.classList.toggle('on', C.spin));
  }
  tabRows = rows.length;   // (the panes' rows; the tab's go after them, made again on every change of tab)

  // ---------------------------------------------------------------- the right pane: the tab
  function tab() {
    rows.length = tabRows; right.textContent = '';
    ({outfit: tOutfit, paint: tPaint, tuner: tTuner, stats: tStats, items: tItems, saved: tSaved})[C.tab]();
    right.scrollTop = 0;
    sync();
  }
  // a slider: label, value text, its range; a double click: back to def
  function slider(parent, label, {min, max, step = .01, get, set, def, fmt = v => v.toFixed(2), title}) {
    const r = el('div', 'wd-sl', parent); if (title) r.title = title; el('span', '', r, label);
    const s = el('input', '', r); s.type = 'range'; s.min = min; s.max = max; s.step = step;
    const v = el('span', 'wd-v', r);
    s.oninput = () => { set(+s.value); sync(); };
    s.onchange = () => s.blur();
    if (def !== undefined) s.ondblclick = () => { set(def); sync(); };
    rows.push(() => { const x = get(); put(v, 'textContent', fmt(x)); if (+s.value !== x) s.value = x; r.classList.toggle('on', def !== undefined && Math.abs(x - def) > 1e-9); });
    return r;
  }
  const btnRow = (parent, list) => { const r = el('div', 'wd-row2', parent); for (const [t, go, title] of list) btn('wd-btn', r, t, go, title); return r; };

  // OUTFIT: the slot's pieces as cards, the one under the pointer in detail
  let infoId = null;
  function tOutfit() {
    head(right, SLOT_NAMES[C.slot]);
    const cards = el('div', 'wd-cards', right), info = el('div', 'wd-info', right);
    const show = id => {
      const g = gearById(id);
      if (!g) { info.innerHTML = `<b>His own</b><br><span class="wd-dim">The ${SLOT_NAMES[C.slot].toLowerCase()} as the model was made: no weight, no armor.</span>`; return; }
      const does = [];
      if (g.armor) does.push(`takes ${pct(g.armor)} off the damage you take`);
      for (const m of g.mods || []) { if (m.stat === 'light.lantern') does.push('your lantern is always lit'); else if (m.stat === 'player.speed') does.push(`you move ${pct(m.mul - 1)} faster`); }
      info.innerHTML = `<b>${esc(g.name)}</b><br>${esc(g.desc)}<br><span class="wd-key">${g.weight} kg</span>${g.armor ? ` · <span class="wd-key">armor ${pct(g.armor)}</span>` : ''}` +
        (does.length ? `<br>Now: ${esc(does.join('; '))}.` : '') + (g.soon ? `<br><span class="wd-soon">Later: ${esc(g.soon)} (not in the game yet)</span>` : '');
    };
    for (const g of [null, ...GEAR.filter(x => x.slot === C.slot)]) {
      const id = g?.id ?? '', b = el('button', 'wd-card', cards), band = el('span', 'wd-band', b), ct = el('span', 'wd-ct', b);
      stripes(colorsOf(g), band);
      const badge = el('em', 'wd-badge', ct, 'worn'); el('span', '', ct, g ? g.name : 'His own');
      el('small', '', ct, g ? `${g.weight} kg${g.armor ? ` · armor ${pct(g.armor)}` : ''}` : 'no weight');
      b.onclick = () => { wearIn(C.slot, id); infoId = id; show(id); sound('confirm'); sync(); };
      b.onmouseenter = () => show(id);
      b.onmouseleave = () => show(infoId ?? inSlot(C.slot));
      rows.push(() => { const on = inSlot(C.slot) === id; b.classList.toggle('on', on); put(badge.style, 'display', on ? '' : 'none'); });
    }
    infoId = inSlot(C.slot); show(infoId);
  }

  // PAINT: a zone, then a colour from the palette
  function tPaint() {
    const Z = zonesNow(), zones = [...Object.keys(Z).filter(z => Z[z].length), 'duster tail'];
    if (!zones.includes(C.zone)) C.zone = zones[0];
    const valOf = z => z === 'duster tail' ? C.cloth : C.paint[z] || '';
    const setOf = (z, v) => { if (z === 'duster tail') C.cloth = v; else if (v) C.paint[z] = v; else delete C.paint[z]; lookChanged(); };
    const colOf = v => v === 'custom' ? C.custom : MATERIALS[v]?.[1] || null;
    head(right, 'Zone');
    const zg = el('div', 'wd-zones', right);
    for (const z of zones) {
      const b = btn('wd-zone', zg, '', () => { C.zone = z; save(); sound('click'); }, z === 'duster tail' ? "the gunslinger's runtime cloth panel" : Z[z].join(', '));
      const i = el('i', '', b), s = el('span', '', b, z);
      rows.push(() => {
        const v = valOf(z), c = colOf(v);
        b.classList.toggle('on', C.zone === z); b.classList.toggle('set', !!v);
        put(i.style, 'background', c || (v === 'hide' || v === 'off' ? 'repeating-linear-gradient(45deg, #444 0 2px, #222 2px 4px)' : 'transparent'));
      });
    }
    head(right, 'Colour');
    const pal = el('div', 'wd-pal', right);
    const chip = (v, bg, title, text) => {
      const c = btn('wd-chip' + (text ? ' tx' : ''), pal, text || '', () => { setOf(C.zone, v); sound('click'); }, title);
      if (bg) c.style.background = bg;
      rows.push(() => c.classList.toggle('on', valOf(C.zone) === v));
      return c;
    };
    chip('', null, 'as made (no paint)', '—');
    chip(C.zone === 'duster tail' ? 'off' : 'hide', null, C.zone === 'duster tail' ? 'not drawn' : 'hidden', 'off');
    const cc = chip('custom', C.custom, 'the picked colour (below)');
    rows.push(() => put(cc.style, 'background', C.custom));
    for (const m of Object.keys(MATERIALS)) chip(m, `linear-gradient(135deg, ${MATERIALS[m][0]}, ${MATERIALS[m][1]} 55%, ${MATERIALS[m][2]})`, m.replace('_', ' '));
    const r = el('div', 'wd-sl', right); el('span', '', r, 'Picked colour');
    const c = el('input', '', r); c.type = 'color'; c.value = C.custom;
    c.oninput = () => { C.custom = c.value; if (Object.values(C.paint).includes('custom') || C.cloth === 'custom') lookChanged(); else saveT = .3; sync(); };
    c.onchange = () => c.blur();
    rows.push(() => put(c, 'value', C.custom));
    btnRow(right, [['Paint the picked colour', () => { setOf(C.zone, 'custom'); }], ['Clear all', () => { C.paint = {}; C.cloth = ''; lookChanged(); }]]);
    el('div', 'wd-note', right, 'The look only: a test of colours on the model (no weight, no armor, not seen in co-op).');
  }

  // TUNER: a piece's shapes on sliders
  const TUNABLE = GEAR.filter(g => g.look?.add?.length);
  const tuned = id => C.tune[id] || gearById(id).look.add;
  function edit(fn) {   // change the tuned copy of the piece's current shape
    const id = C.piece; if (!id) return;
    if (!C.tune[id]) C.tune[id] = copy(gearById(id).look.add);
    const a = C.tune[id][C.shape]; if (!a) return;
    fn(a); lookChanged();
  }
  const getPath = (a, p) => { const [k, i] = p.split('.'); const v = a[k]; return i === undefined || !Array.isArray(v) ? v : v[+i]; };
  function setPath(a, p, x) { const [k, i] = p.split('.'); if (i === undefined) a[k] = x; else { if (!Array.isArray(a[k])) a[k] = [a[k], a[k], a[k]]; a[k][+i] = x; } }
  function tTuner() {
    head(right, 'Piece');
    if (!gearById(C.piece)?.look?.add) C.piece = '';
    const pk = el('div', 'wd-pick', right);
    for (const g of TUNABLE) {
      const b = btn('', pk, g.name + (C.tune[g.id] ? ' *' : ''), () => {
        C.piece = g.id; C.shape = 0; if (!wearing().includes(g.id)) wearIn(g.slot, g.id); save(); sound('click'); tab();
      }, 'choosing a piece wears it');
      rows.push(() => b.classList.toggle('on', C.piece === g.id));
    }
    if (!C.piece) { el('div', 'wd-note', right, 'Pick a piece to move, turn and size its shapes. * = tuned (the look only, until you copy it into content/gear.js).'); return; }
    const add = tuned(C.piece); if (!(C.shape < add.length)) C.shape = 0;
    head(right, 'Shape');
    const sh = el('div', 'wd-pick', right);
    add.forEach((a, i) => { const b = btn('', sh, `${a.part} · ${a.shape}`, () => { C.shape = i; save(); tab(); }); rows.push(() => b.classList.toggle('on', C.shape === i)); });
    const a0 = gearById(C.piece).look.add[C.shape], cur = () => tuned(C.piece)[C.shape];
    {
      const r = el('div', 'wd-sl', right); el('span', '', r, 'Material');
      const s = el('select', '', r); s.style.flex = '1';
      for (const m of Object.keys(MATERIALS)) { const o = el('option', '', s, m.replace('_', ' ')); o.value = m; }
      s.onchange = () => { edit(a => { a.mat = s.value; }); s.blur(); sync(); };
      rows.push(() => put(s, 'value', cur().mat));
    }
    const f3 = v => v.toFixed(3);
    head(right, 'Place');
    ['x (his left)', 'y (his back)', 'z (up)'].forEach((label, i) => slider(right, label, {min: a0.at[i] - .5, max: a0.at[i] + .5, step: .005, def: a0.at[i], fmt: f3,
      get: () => cur().at[i], set: x => edit(a => { a.at[i] = x; })}));
    head(right, 'Turn');
    ['about x', 'about y', 'about z'].forEach((label, i) => slider(right, label, {min: -180, max: 180, step: 1, def: a0.rot?.[i] || 0, fmt: v => Math.round(v) + '°',
      get: () => cur().rot?.[i] || 0, set: x => edit(a => { a.rot = a.rot || [0, 0, 0]; a.rot[i] = x; })}));
    head(right, 'Size');
    for (const p of SIZE[a0.shape] || []) {
      const d = getPath(a0, p);
      slider(right, p.replace('.0', ' x').replace('.1', ' y').replace('.2', ' z'), {min: 0, max: Math.max(1, d * 2.5), step: .005, def: d, fmt: f3,
        get: () => getPath(cur(), p), set: x => edit(a => setPath(a, p, x))});
    }
    btnRow(right, [['Copy code', () => clip(codeOf(gearById(C.piece), tuned(C.piece)), 'the code'), "the piece's shapes as content/gear.js lines (also in the console)"],
      ['Reset piece', () => { delete C.tune[C.piece]; lookChanged(); tab(); }], ['Reset all', () => { C.tune = {}; lookChanged(); tab(); }, 'every tuned piece as authored']]);
    el('div', 'wd-note', right, "Body space at rest, metres: his head is z 1.28 to 1.8, his hat band at 1.65. Double-click a slider: back as authored.");
  }

  // STATS: the 'wardrobe' notes
  function tStats() {
    const topN = el('div', 'wd-note', right);
    rows.push(() => {
      const st = stats()?.S, g = gear()?.S.stats;
      put(topN, 'textContent', [st ? `health ${Math.ceil(st.hp)}/${st.maxHp}` : '', g ? `worn: ${g.kg.toFixed(1)} kg, armor ${pct(g.armor)}, speed ${pct(g.speed)}` : ''].filter(Boolean).join(' · '));
    });
    head(right, 'Modifier notes');
    for (const n of KNOBS) {
      const def = knob0(n), mul = n.mul !== undefined;
      slider(right, n.label, {min: n.min, max: n.max, step: n.step ?? .05, def, title: `${n.stat} ${mul ? 'x' : '+'} · ${n.note}`, fmt: v => (mul ? '×' : '+') + v.toFixed(2),
        get: () => C.stats[n.k] ?? def, set: x => { if (Math.abs(x - def) < 1e-9) delete C.stats[n.k]; else C.stats[n.k] = x; applyNotes(); saveT = .3; }});
    }
    btnRow(right, [['Reset all', () => { C.stats = {}; applyNotes(); save(); }]]);
    el('div', 'wd-note', right, "Notes under the source 'wardrobe', in dev mode, on top of gear, items and the cheat panel. Double-click a slider: x1.");
  }

  // ITEMS: the run's items and augments
  function tItems() {
    if (!stats()) { el('div', 'wd-note', right, 'no game: nothing to give'); return; }
    const k = kind();
    head(right, 'Items');
    const it = el('div', 'wd-tiles list', right);
    for (const x of ITEMS) {
      const d = el('div', 'wd-tile' + (x.only && x.only !== k ? ' off' : ''), it); d.title = `${x.name}: ${x.desc}` + (x.only ? ` (${x.only} loadouts)` : '');
      const g = el('span', 'g', d, x.glyph); g.style.color = TIER[x.tier].col;
      el('span', 'n', d, x.name);
      btn('', d, '−', () => ask(() => giveItem(x.id, -1)));
      const c = el('span', 'c', d);
      btn('', d, '+', () => { ask(() => giveItem(x.id, 1)); sound('click'); });
      rows.push(() => { const n = stats()?.items.get(x.id) || 0; put(c, 'textContent', n ? String(n) : '·'); d.classList.toggle('on', n > 0); });
    }
    head(right, 'Augments');
    const ag = el('div', 'wd-tiles', right);
    for (const a of AUGMENTS) {
      const d = el('button', 'wd-tile' + (a.only && a.only !== k ? ' off' : ''), ag); d.title = `${a.name}: ${a.desc}` + (a.only ? ` (${a.only} loadouts)` : '');
      el('span', 'g', d, a.glyph); el('span', 'n', d, a.name);
      d.onclick = () => { ask(() => flipAug(a.id)); sound('click'); sync(); };
      rows.push(() => d.classList.toggle('on', !!stats()?.augs.has(a.id)));
    }
    btnRow(right, [['Clear all', () => ask(clearBuild)]]);
    el('div', 'wd-note', right, 'Dimmed: not for this weapon. They hold in the sandbox; a run starts empty.');
  }

  // SAVED: outfits under a name
  function tSaved() {
    head(right, 'Save this outfit');
    const r = el('div', 'wd-row2', right);
    const t = el('input', '', r); t.type = 'text'; t.placeholder = 'a name, e.g. winter scout'; t.style.flex = '1';
    const go = () => {
      const name = t.value.trim() || `outfit ${C.outfits.length + 1}`;
      const o = snapshot(name), i = C.outfits.findIndex(x => x.name === name);
      if (i >= 0) C.outfits[i] = o; else C.outfits.push(o);
      save(); tab(); say(`saved "${name}"`); sound('confirm');
    };
    t.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    btn('wd-btn', r, 'Save', go).style.flex = '0 0 auto';
    el('div', 'wd-note', right, 'The loadout, the gear, the paint, tuned pieces, stats, items and augments.');
    head(right, 'Saved');
    if (!C.outfits.length) el('div', 'wd-note', right, 'none yet');
    C.outfits.forEach((o, i) => {
      const d = el('div', 'wd-saved', right), sw = el('span', 'wd-sw', d);
      stripes((o.gear || []).map(id => colorsOf(gearById(id))[0]).slice(0, 4).concat(o.gear?.length ? [] : [OWN]), sw);
      const n = el('span', 'n', d, o.name); el('small', '', n, (o.gear || []).map(id => gearById(id)?.name).filter(Boolean).join(', ') || 'his own clothes');
      btn('wd-btn', d, 'Wear', () => { wearOutfit(o); sound('confirm'); }).style.flex = '0 0 auto';
      btn('wd-off', d, '×', () => { C.outfits.splice(i, 1); save(); tab(); }, 'delete');
    });
    head(right, 'Share');
    btnRow(right, [['Copy link', () => clip(linkOf(), 'the link'), 'this page with ?gear= and ?set= for what he wears (the gear only)']]);
  }

  function sync() {
    if (!F.on) return;
    for (const r of rows) r();
  }

  // ---------------------------------------------------------------- the scene: photo mode's frozen world as our studio
  // the studio set (dev/stage.js: the world left out, a stage and a backdrop drawn round him) or the world dimmed round him
  const set = createStage(host);
  let pose = 'none';
  function backdrop() {
    const world = C.back === 'world';
    vig.style.opacity = world ? .6 : 0;
    if (world) set.isolate(false); else { set.set({stage: C.stage, back: C.back}); set.isolate(true, live?.rig); }
  }
  const light = () => { const ph = photo(); if (ph?.open) ph.setWorld('hour', LIGHTS[C.light]); };
  // the camera on him, in the middle of what the panes leave (his body, not his feet, in the middle); after every turn, zoom
  // and resize, so he stays there as the camera goes round him
  const seen = {yaw: NaN, scale: NaN, dz: NaN, w: 0, h: 0, clean: false};
  function center() {
    const ph = photo(); if (!ph?.open) return;
    const P = host.player, clean = root.classList.contains('wd-clean'), W = innerWidth, H = innerHeight;
    let cx = W / 2, cy = H / 2;
    if (!clean) {
      const l = left.getBoundingClientRect(), r = right.getBoundingClientRect(), t = top.getBoundingClientRect(), b = bottom.getBoundingClientRect();
      cx = (l.right + r.left) / 2; cy = (t.bottom + b.top) / 2;
    }
    root.style.setProperty('--cx', cx + 'px'); root.style.setProperty('--cy', cy + 'px');
    cv.freeReset(P.x, P.y, host.P.z);
    const z = cv.zoom * cv.dz, vx = -(cx - W / 2) / cv.scale / (host.PPM * z), vy = -(cy - H / 2) / cv.scale / (host.PPMY * z) - .75 * host.PPMH / host.PPMY;
    const [wx, wy] = cv.toWorld(vx, vy); ph.move(wx, wy);
    seen.yaw = cv.yaw; seen.scale = cv.scale; seen.dz = cv.dz; seen.w = W; seen.h = H; seen.clean = clean;
  }
  // frame: the zoom at which he (2 m, the hat's tip) is about half the height the panes leave (a whole display scale), then center
  function frame() {
    if (!photo()?.open) return;
    const h = root.classList.contains('wd-clean') ? innerHeight : bottom.getBoundingClientRect().top - top.getBoundingClientRect().bottom;
    cv.zoomTo(Math.max(1, Math.floor(.5 * h / (2 * host.PPMH))), true); center();
  }
  const STUDIO = {
    key(k, e) {
      if (k === 'tab' && e.shiftKey) { e.preventDefault(); close(); return true; }
      if (k === 'tab') { e.preventDefault(); C.tab = TAB_IDS[(TAB_IDS.indexOf(C.tab) + 1) % TAB_IDS.length]; save(); sound('click'); tab(); return true; }
      if (k === 'r' || k === 'home') { frame(); return true; }
      if (k === 'h') { root.classList.toggle('wd-clean'); return true; }
      return false;   // (the rest is photo mode's: Esc back, P a photo, the wheel, WASD, Z / X)
    },
    step(dt) {
      if (C.spin) photo()?.turn(dt * .5);
      if (cv.yaw !== seen.yaw || cv.scale !== seen.scale || cv.dz !== seen.dz || innerWidth !== seen.w || innerHeight !== seen.h || root.classList.contains('wd-clean') !== seen.clean) center();
      tick(dt);
      if (hero.loadI !== loadWas) { const re = loadWas >= 0 && C.tab === 'paint'; loadWas = hero.loadI; if (re) tab(); }   // (another model: its zones)
      if (msgT > 0 && (msgT -= dt) <= 0) msgEl.classList.remove('on');
      if ((syncT -= dt) <= 0) { syncT = .25; sync(); }
    },
    closed() {
      F.on = false; pose = 'none'; set.isolate(false);
      root.classList.add('hidden'); document.body.classList.remove('wd');
      lookDirty = true; lookT = 0; save();   // (the preview without the chosen set: what's worn, from the next step)
    },
  };
  function open() {
    const ph = photo();
    if (F.on || !host.dev || !ph?.allowed) return;
    F.on = true; loadWas = hero.loadI; pose = 'none';
    ph.toggle(true, STUDIO);
    if (!ph.open) { F.on = false; return; }
    root.classList.remove('hidden', 'wd-clean'); document.body.classList.add('wd');
    tab();
    backdrop(); light(); frame();
    lookDirty = true; lookT = 0; tick(0);
    sound('open');
  }
  function close() { if (F.on) photo()?.toggle(false); }   // (photo mode puts the camera back, then STUDIO.closed)
  // the notes, the look and the save, in step with what changed (the update while shut, the studio's step while open)
  function tick(dt) {
    if (host.dev !== devWas) { devWas = host.dev; applyNotes(); lookDirty = true; }   // (the first step too: the remembered notes and look)
    if (lookDirty && (lookT -= dt) <= 0) { lookDirty = false; lookT = .05; applyLook(); }
    if (saveT > 0 && (saveT -= dt) <= 0) save();
  }

  let devWas = null, syncT = 0, loadWas = -1;
  const F = {
    name: 'wardrobe', label: 'Wardrobe', key: 'shift+tab', on: false,
    toggle() { if (F.on) close(); else open(); return F.on; },
    onKey(k, e) { if (k !== 'tab' || !e?.shiftKey) return false; open(); return true; },
    frame({t}) { if (F.on && C.back !== 'world') set.draw(t); },   // (the set at his feet, turned to the camera: every frame it shows)
    update(dt) {
      tick(dt);
      if (!queue.length) return;
      for (const fn of queue) fn();
      queue.length = 0;
    },
    menu: () => host.dev && photo()?.allowed ? [{label: 'Wardrobe', run: open}] : [],
    hud() {
      if (!host.dev) return '';
      const a = [], np = Object.keys(C.paint).length + (C.cloth ? 1 : 0), nt = Object.keys(C.tune).length, ns = Object.keys(C.stats).length;
      if (np) a.push(`${np} paint${np > 1 ? 's' : ''}`); if (nt) a.push(`${nt} tuned`); if (ns) a.push(`${ns} stat${ns > 1 ? 's' : ''}`);
      return a.length ? `<b>wardrobe</b> ${a.join(' · ')}` : '';
    },
  };
  return F;
}
