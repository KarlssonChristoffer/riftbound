// WARDROBE: the dev wardrobe, a screen of its own (Shift+Tab in dev mode, or the menu's Game tab: Wardrobe). The game holds
// (core/loop.js hold: not stepped, not drawn) and the STUDIO takes the screen (dev/studio.js): a renderer of its own with an
// empty scene, a fixed camera, studio light, a little stage and a backdrop (dev/stage.js), and a copy of the character (his
// live model, dressed as the wardrobe shows him) who turns on the stage: drag him to spin him, right-drag to move the view,
// the wheel zooms, R frames him again, Space spins him, arrows / A D turn him a step, H hides the UI, Tab the next tab, P a
// photo of the scene, Esc / Shift+Tab back to the game. The UI stands round the scene:
//   TOP      the title, the loadout, the tabs (Outfit, Paint, Tuner, Stats, Items, Saved), the keys, back to the game
//   LEFT     EQUIPMENT: a card a slot (head, body, back, legs, feet) with what he wears there (a pixel icon in its colour, x takes
//            it off), random / undress, and the set's weight, armor and speed as bars
//   RIGHT    the tab:  Outfit   the chosen slot's pieces as cards (a click wears it), the piece under the pointer in detail
//                      Paint    the model's zones, a palette (a material, a picked colour, hidden) painted on the chosen one
//                      Tuner    a piece's shapes moved / turned / sized on sliders, drawn as you drag; "Copy code" puts them
//                               on the clipboard as content/gear.js lines
//                      Stats    sliders as MODIFIER notes under the source 'wardrobe' (core/modifiers.js), each applied by its
//                               owner: player.speed x, game.hurt x, weapon.dmg / reload / gap / melee x, combat.crit + / critMul +
//                               / enemyDmg x, light.lantern + / lanternR x
//                      Items    the run's items (+ / - a copy) and augments (on / off) through game/stats.js (a run starts empty)
//                      Saved    everything here saved under a name, worn again in one click; "Copy link" (?gear= ?set=)
//   BOTTOM   the scene: the backdrop, the stage, the light (day, dawn, dusk, night), his pose (idle or one of his clips),
//            turn, spin, frame him, a photo
// The clothes chosen show on the studio's copy at once and are worn in the game from the step after you go back
// (features/gear.js choose: co-op asks the server then). Paint and tuned pieces are the look only (no weight, no armor,
// nothing sent in co-op): on the studio's copy, and on him in the game (features/gear.js preview). The look and the notes
// hold in DEV MODE only, like the cheat panel's. The UI is pixel art (dev/pixelfont.js, frames painted in code).
// Remembered on this machine ('rb.wardrobe').
// It is a FEATURE the boot puts at the end of the list (main.js; dev/: nothing in the game imports it). F.on is the screen
// open. While it's open the game holds, so what the UI asks for (items, augments) is done at once; while it's shut, its
// update keeps the notes and the look in step with dev mode.
// OWNS: the screen (#wardrobe + its style), the studio (dev/studio.js), the 'wardrobe' notes, the gear preview it asks for.
// READS: host (mods, the game's stats, the gear feature, dev), hero (the loadout), live (the model's URL), engine() (the boot's
//   E: loop.hold, pause, keys), content/gear.js, game/items.js.
// BUDGET: shut and nothing on: nothing. Open: the game holds; the studio's small scene a frame; a few text writes 4 times a
//   second; a slider drag: one dress at most every 50 ms (2-25 ms each, view/dress.js).
import {SLOTS, SLOT_NAMES, KINDS, RARITY, GEAR, MATERIALS, ZONES, RULES, gearById, cleanSet, setStats} from '../content/gear.js';
import {ITEMS, AUGMENTS, TIER} from '../game/items.js';
import {LOADOUTS, SET_NAMES} from '../view/hero.js';
import {tint} from '../view/rigkit.js';
import {STAGES, STAGE_SW, BACKS as SETS} from './stage.js';
import {createStudio} from './studio.js';
import {loadPixelFont} from './pixelfont.js';

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
const LIGHTS = ['day', 'dawn', 'dusk', 'night'];   // (dev/studio.js LIGHTS)
const BACKS = Object.keys(SETS);   // (dev/stage.js)
const DEF = {tab: 'outfit', slot: 'head', zone: 'coat', spin: false, back: 'curtain', stage: 'stone', light: 'day', paint: {}, cloth: '', custom: '#5a8f6a',
  tune: {}, stats: {}, piece: '', shape: 0, outfits: []};
const OWN = '#6b5e50';   // the swatch of "his own clothes"
const CSS = `
#wardrobe { --u: 2px; --ink: #efe6cf; --dim: #a39478; --key: #f2c95c; --dark: #0c0907;
  position: fixed; inset: 0; z-index: 22; pointer-events: none; user-select: none; color: var(--ink);
  font: calc(10 * var(--u)) / calc(11 * var(--u)) RiftPixel, ui-monospace, Consolas, monospace; font-synthesis: none; letter-spacing: 0; image-rendering: pixelated; }
#wardrobe *, #wardrobe *::before, #wardrobe *::after { box-sizing: border-box; border-radius: 0 !important; }
#wardrobe.hidden { display: none; }
#wardrobe.wd-clean .wd-pane, #wardrobe.wd-clean .wd-msg { display: none; }
/* the frames: 9-slice pixel art (painted in code: frame9), every edge U px a pixel */
#wardrobe .wd-pane { position: absolute; pointer-events: auto; border: calc(3 * var(--u)) solid transparent; border-image: var(--f-panel) 3 fill / calc(3 * var(--u)); }
#wardrobe button { font: inherit; color: inherit; cursor: pointer; padding: 0; background: none; border: 0; text-align: inherit; }
#wardrobe .wd-btn, #wardrobe .wd-tab, #wardrobe .wd-pick button, #wardrobe .wd-back, #wardrobe .wd-slot, #wardrobe .wd-card, #wardrobe .wd-zone, #wardrobe .wd-tile, #wardrobe .wd-saved {
  border: calc(2 * var(--u)) solid transparent; border-image: var(--f-btn) 2 fill / calc(2 * var(--u)); }
#wardrobe :is(.wd-btn, .wd-tab, .wd-pick button, .wd-back, .wd-slot, .wd-card, .wd-zone, button.wd-tile):hover { border-image-source: var(--f-hot); }
#wardrobe :is(.wd-btn, .wd-tab, .wd-pick button, .wd-back, .wd-slot, .wd-card, .wd-zone, button.wd-tile):active { border-image-source: var(--f-down); }
#wardrobe :is(.wd-btn, .wd-tab, .wd-pick button, .wd-slot, .wd-card, .wd-zone, .wd-tile).on { border-image-source: var(--f-on); color: #fff3cf; }
#wardrobe .wd-card, #wardrobe .wd-slot, #wardrobe .wd-saved, #wardrobe .wd-tile, #wardrobe .wd-zone { border-image-source: var(--f-card); }
#wardrobe .wd-well { border: calc(2 * var(--u)) solid transparent; border-image: var(--f-well) 2 fill / calc(2 * var(--u)); }
#wardrobe .wd-h { display: flex; align-items: center; gap: calc(3 * var(--u)); margin: calc(6 * var(--u)) 0 calc(3 * var(--u)); color: var(--key); text-transform: uppercase;
  text-shadow: var(--u) var(--u) 0 var(--dark); }
#wardrobe .wd-h::after { content: ''; flex: 1; height: var(--u); background: #4a3826; box-shadow: 0 var(--u) 0 var(--dark); }
#wardrobe .wd-h:first-child { margin-top: 0; }
#wardrobe .wd-dim { color: var(--dim); } #wardrobe .wd-key { color: var(--key); }
#wardrobe .wd-note { color: var(--dim); margin: calc(3 * var(--u)) 0; }
/* top bar */
#wardrobe .wd-top { left: calc(4 * var(--u)); right: calc(4 * var(--u)); top: calc(4 * var(--u)); height: calc(24 * var(--u)); display: flex; align-items: center;
  gap: calc(8 * var(--u)); padding: 0 calc(4 * var(--u)); }
#wardrobe .wd-brand { display: flex; align-items: baseline; gap: calc(6 * var(--u)); }
#wardrobe .wd-brand b { font-weight: 400; font-size: calc(20 * var(--u)); line-height: calc(20 * var(--u)); color: var(--key); letter-spacing: var(--u);
  text-shadow: var(--u) var(--u) 0 var(--dark), calc(2 * var(--u)) calc(2 * var(--u)) 0 #4a3826; }
#wardrobe .wd-brand select { font: inherit; color: var(--dim); background: none; border: 0; padding: 0; cursor: pointer; }
#wardrobe select option { background: #1e1812; color: var(--ink); font: 14px ui-monospace, Consolas, monospace; }
#wardrobe .wd-tabs { display: flex; gap: calc(2 * var(--u)); margin: 0 auto; }
#wardrobe .wd-tab { padding: calc(2 * var(--u)) calc(6 * var(--u)); color: var(--dim); }
#wardrobe .wd-tab:hover { color: var(--ink); }
#wardrobe .wd-keys { color: var(--dim); text-align: right; white-space: nowrap; }
#wardrobe .wd-back { padding: calc(2 * var(--u)) calc(6 * var(--u)); white-space: nowrap; }
#wardrobe .wd-back kbd { font: inherit; color: var(--key); margin-right: calc(4 * var(--u)); }
/* left: the equipment */
#wardrobe .wd-left { left: calc(4 * var(--u)); top: calc(30 * var(--u)); bottom: calc(4 * var(--u)); width: calc(130 * var(--u)); padding: calc(3 * var(--u));
  display: flex; flex-direction: column; overflow: auto; scrollbar-width: thin; scrollbar-color: #7a5f3e #15100c; }
#wardrobe .wd-slot { display: flex; align-items: center; gap: calc(4 * var(--u)); width: 100%; margin-bottom: calc(2 * var(--u)); padding: calc(1 * var(--u)) calc(2 * var(--u)); }
#wardrobe .wd-slot .wd-tx { flex: 1; min-width: 0; }
#wardrobe .wd-slot small { display: block; font-size: inherit; color: var(--dim); text-transform: uppercase; }
#wardrobe .wd-slot span.n { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#wardrobe .wd-slot.own span.n { color: var(--dim); }
#wardrobe .wd-ico { flex: 0 0 auto; width: calc(20 * var(--u)); height: calc(20 * var(--u)); display: grid; place-items: center; }
#wardrobe .wd-ico img { width: calc(12 * var(--u)); height: calc(12 * var(--u)); image-rendering: pixelated; }
#wardrobe .wd-off { padding: 0 calc(2 * var(--u)); color: var(--dim); }
#wardrobe .wd-off:hover { color: #ff8a6a; }
#wardrobe .wd-sw { flex: 0 0 auto; width: calc(16 * var(--u)); height: calc(16 * var(--u)); display: flex; flex-direction: column; border: var(--u) solid var(--dark); }
#wardrobe .wd-sw i, #wardrobe .wd-band i { flex: 1; }
#wardrobe .wd-row2 { display: flex; gap: calc(2 * var(--u)); margin: calc(2 * var(--u)) 0; }
#wardrobe .wd-btn { flex: 1; padding: calc(2 * var(--u)) calc(4 * var(--u)); text-align: center; }
#wardrobe .wd-bar { margin: calc(3 * var(--u)) 0; }
#wardrobe .wd-bar div { display: flex; justify-content: space-between; }
#wardrobe .wd-bar b { font-weight: 400; color: var(--key); }
#wardrobe .wd-bar span.t { display: block; height: calc(8 * var(--u)); margin-top: var(--u); padding: var(--u); }
#wardrobe .wd-bar span.t i { display: block; height: 100%;
  background: repeating-linear-gradient(90deg, #f2c95c 0 calc(3 * var(--u)), #c89a3a calc(3 * var(--u)) calc(4 * var(--u))); }
#wardrobe .wd-bar.bad span.t i { background: repeating-linear-gradient(90deg, #e2644d 0 calc(3 * var(--u)), #a13b33 calc(3 * var(--u)) calc(4 * var(--u))); }
#wardrobe .wd-wait { color: var(--key); }
/* right: the tab */
#wardrobe .wd-right { right: calc(4 * var(--u)); top: calc(30 * var(--u)); bottom: calc(4 * var(--u)); width: calc(172 * var(--u)); padding: calc(3 * var(--u)) calc(4 * var(--u));
  overflow: hidden auto; scrollbar-width: thin; scrollbar-color: #7a5f3e #15100c; }
#wardrobe .wd-cards { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: calc(2 * var(--u)); }
#wardrobe .wd-card { display: flex; flex-direction: column; padding: var(--u); }
#wardrobe .wd-card .wd-band { display: flex; height: calc(8 * var(--u)); border: var(--u) solid var(--dark); }
#wardrobe .wd-card .wd-ct { padding: calc(2 * var(--u)) var(--u) var(--u); }
#wardrobe .wd-card .wd-ct span { display: block; }
#wardrobe .wd-card .wd-ct small { display: block; font-size: inherit; color: var(--dim); }
#wardrobe .wd-card .wd-badge { float: right; font-style: normal; color: var(--key); }
#wardrobe .wd-info { margin-top: calc(4 * var(--u)); padding: calc(3 * var(--u)) calc(4 * var(--u)); min-height: calc(50 * var(--u)); }
#wardrobe .wd-info b { font-weight: 400; color: var(--key); }
#wardrobe .wd-info .wd-soon { color: var(--dim); }
#wardrobe .wd-zones { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: calc(2 * var(--u)); }
#wardrobe .wd-zone { display: flex; align-items: center; gap: calc(3 * var(--u)); padding: var(--u) calc(2 * var(--u)); }
#wardrobe .wd-zone i { width: calc(7 * var(--u)); height: calc(7 * var(--u)); border: var(--u) solid var(--dark); }
#wardrobe .wd-zone.set span { color: var(--key); }
#wardrobe .wd-pal { display: grid; grid-template-columns: repeat(6, 1fr); gap: calc(2 * var(--u)); }
#wardrobe .wd-chip { position: relative; aspect-ratio: 1; border: var(--u) solid var(--dark); box-shadow: inset var(--u) var(--u) 0 rgba(255, 255, 255, .25), inset calc(-1 * var(--u)) calc(-1 * var(--u)) 0 rgba(0, 0, 0, .3); }
#wardrobe .wd-chip:hover { border-color: #a07f55; }
#wardrobe .wd-chip.on { border-color: var(--key); outline: var(--u) solid var(--dark); }
#wardrobe .wd-chip.tx { display: flex; align-items: center; justify-content: center; color: var(--dim); background: #2c2219; }
#wardrobe input[type=color] { width: calc(16 * var(--u)); height: calc(10 * var(--u)); padding: 0; border: var(--u) solid var(--dark); background: none; cursor: pointer; }
#wardrobe .wd-sl { display: flex; align-items: center; gap: calc(3 * var(--u)); margin: calc(2 * var(--u)) 0; }
#wardrobe .wd-sl > span:first-child { flex: 0 0 calc(56 * var(--u)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#wardrobe .wd-sl.on > span:first-child, #wardrobe .wd-sl.on .wd-v { color: var(--key); }
#wardrobe .wd-sl .wd-v { flex: 0 0 calc(28 * var(--u)); text-align: right; color: var(--dim); }
#wardrobe input[type=range] { -webkit-appearance: none; appearance: none; flex: 1; min-width: calc(20 * var(--u)); height: calc(2 * var(--u)); margin: 0;
  background: var(--dark); box-shadow: 0 var(--u) 0 #5a4630; outline: none; cursor: pointer; }
#wardrobe input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: calc(4 * var(--u)); height: calc(8 * var(--u)); background: var(--key);
  box-shadow: inset calc(-1 * var(--u)) calc(-1 * var(--u)) 0 #a3762a, 0 0 0 var(--u) var(--dark); }
#wardrobe input[type=range]::-moz-range-thumb { width: calc(4 * var(--u)); height: calc(8 * var(--u)); border: var(--u) solid var(--dark); background: var(--key); }
#wardrobe select, #wardrobe input[type=text] { font: inherit; color: var(--ink); padding: var(--u) calc(2 * var(--u)); border: calc(2 * var(--u)) solid transparent;
  border-image: var(--f-well) 2 fill / calc(2 * var(--u)); background: none; outline: none; }
#wardrobe input[type=text]::placeholder { color: #6e6250; }
#wardrobe .wd-pick { display: flex; flex-wrap: wrap; gap: calc(2 * var(--u)); }
#wardrobe .wd-pick button { padding: var(--u) calc(4 * var(--u)); }
#wardrobe .wd-tiles { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: calc(2 * var(--u)); }
#wardrobe .wd-tiles.list { grid-template-columns: minmax(0, 1fr); }
#wardrobe .wd-row2 input[type=text] { flex: 1; min-width: 0; width: 100%; }
#wardrobe .wd-tile { display: flex; align-items: center; gap: calc(3 * var(--u)); padding: var(--u) calc(2 * var(--u)); }
#wardrobe .wd-tile.off { opacity: .45; }
#wardrobe .wd-tile .g { width: calc(9 * var(--u)); text-align: center; font-family: ui-monospace, Consolas, monospace; font-size: calc(7 * var(--u)); }
#wardrobe .wd-tile .n { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#wardrobe .wd-tile .c { min-width: calc(8 * var(--u)); text-align: center; color: var(--key); }
#wardrobe .wd-tile button { flex: 0 0 auto; width: calc(11 * var(--u)); height: calc(11 * var(--u)); text-align: center; border: calc(2 * var(--u)) solid transparent;
  border-image: var(--f-btn) 2 fill / calc(2 * var(--u)); line-height: calc(7 * var(--u)); }
#wardrobe .wd-tile button:hover { border-image-source: var(--f-hot); }
#wardrobe .wd-saved { display: flex; align-items: center; gap: calc(3 * var(--u)); padding: calc(2 * var(--u)); margin-bottom: calc(2 * var(--u)); }
#wardrobe .wd-saved .n { flex: 1; min-width: 0; }
#wardrobe .wd-saved .n small { display: block; font-size: inherit; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* bottom: the scene */
#wardrobe .wd-bottom { left: calc(138 * var(--u)); right: calc(180 * var(--u)); bottom: calc(4 * var(--u)); padding: calc(2 * var(--u)) calc(4 * var(--u));
  display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-end; gap: calc(3 * var(--u)) calc(8 * var(--u)); }
#wardrobe .wd-grp > small { display: block; margin-bottom: calc(2 * var(--u)); font-size: inherit; color: var(--key); text-transform: uppercase; text-align: center;
  text-shadow: var(--u) var(--u) 0 var(--dark); }
#wardrobe .wd-grp .wd-row { display: flex; gap: calc(2 * var(--u)); }
#wardrobe .wd-bottom .wd-chip { width: calc(13 * var(--u)); }
#wardrobe .wd-msg { position: absolute; left: 50%; top: calc(32 * var(--u)); transform: translateX(-50%); padding: calc(2 * var(--u)) calc(6 * var(--u)); color: var(--key);
  border: calc(3 * var(--u)) solid transparent; border-image: var(--f-panel) 3 fill / calc(3 * var(--u)); opacity: 0; }
#wardrobe .wd-msg.on { opacity: 1; }
body.wd :is(#gear, #hud, #help, #hd, #cheats, #gunfeel) { visibility: hidden; }`;

// the frames: a 9-slice pixel-art image (rings from the outside in: [top-left, bottom-right], then the fill), its outer corner
// pixels cut (a pixel-rounded corner). Painted once, as data URLs the CSS stretches by whole U px (image-rendering: pixelated)
function frame9(rings, fill) {
  const n = rings.length, N = 2 * n + 1, c = document.createElement('canvas'); c.width = c.height = N;
  const q = c.getContext('2d');
  q.fillStyle = fill; q.fillRect(n, n, 1, 1);
  rings.forEach(([tl, br], k) => {
    const a = k, b = N - 1 - k, L = b - a + 1;
    q.fillStyle = tl; q.fillRect(a, a, L, 1); q.fillRect(a, a, 1, L);
    q.fillStyle = br; q.fillRect(a, b, L, 1); q.fillRect(b, a, 1, L);
  });
  for (const [x, y] of [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1]]) q.clearRect(x, y, 1, 1);
  return `url(${c.toDataURL()})`;
}
const DK = '#0c0907';
const FRAMES = {
  panel: () => frame9([[DK, DK], ['#7a5f3e', '#2e2218'], ['#3a2c1e', '#241b13']], '#1e1812'),
  btn: () => frame9([[DK, DK], ['#8a6c47', '#3a2b1d']], '#45341f'),
  hot: () => frame9([[DK, DK], ['#b08c5c', '#4a3826']], '#58432a'),
  down: () => frame9([[DK, DK], ['#2a1f15', '#8a6c47']], '#3a2c1e'),
  on: () => frame9([[DK, DK], ['#ffe08a', '#a3762a']], '#6e5222'),
  card: () => frame9([[DK, DK], ['#5e4a32', '#2a1f15']], '#2a2018'),
  well: () => frame9([[DK, DK], ['#140f0b', '#4e3d2a']], '#15100c'),
};
// the slots' pixel icons (9 x 9): a hat, a shirt, a cape, trousers, a boot
const ICONS = {
  head: ['.........', '...###...', '..#####..', '..#####..', '..#####..', '#########', '.#######.', '.........', '.........'],
  body: ['..##.##..', '.#######.', '#########', '##.###.##', '#..###..#', '...###...', '...###...', '...###...', '.........'],
  back: ['..#####..', '.##...##.', '.#######.', '.#######.', '#########', '#########', '#########', '#.#.#.#.#', '.........'],
  legs: ['.#######.', '.#######.', '.###.###.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.........'],
  feet: ['..###....', '..###....', '..###....', '..###....', '..######.', '.#######.', '.########', '.########', '.........'],
  hands: ['..#.#.#..', '..#.#.#..', '.#######.', '.#######.', '.######..', '..#####..', '..#####..', '..#####..', '.........'],
  main: ['.......##', '......###', '.....###.', '....###..', '.#.###...', '..###....', '..##.....', '.#..#....', '#........'],
  off: ['.#######.', '#########', '#########', '#########', '.#######.', '.#######.', '..#####..', '...###...', '....#....'],
};
const icoCache = new Map();
function iconOf(slot, col) {   // a data URL: the icon in col, with a one-pixel dark shadow down-right
  const key = slot + col; let u = icoCache.get(key); if (u) return u;
  const c = document.createElement('canvas'); c.width = c.height = 10; const q = c.getContext('2d'), rows = ICONS[slot];
  for (const [dx, f] of [[1, DK], [0, col]]) { q.fillStyle = f; rows.forEach((r, y) => { for (let x = 0; x < 9; x++) if (r[x] === '#') q.fillRect(x + dx, y + dx, 1, 1); }); }
  u = c.toDataURL(); icoCache.set(key, u); return u;
}

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

// opts: {host, hero (the loadout: view/hero.js), live (view/livehero.js, or null), engine: () => the boot's E (made after the
// features: its loop, pause, keys)}
export function createWardrobe({host, hero, live, engine}) {
  const C = copy(DEF);
  try { Object.assign(C, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
  if (!TAB_IDS.includes(C.tab)) C.tab = 'outfit';
  if (!SLOTS.includes(C.slot)) C.slot = 'head';
  for (const k of ['paint', 'tune', 'stats']) if (!C[k] || typeof C[k] !== 'object' || Array.isArray(C[k])) C[k] = {};
  if (!Array.isArray(C.outfits)) C.outfits = [];
  for (const id in C.tune) if (!gearById(id)?.look?.add || !Array.isArray(C.tune[id])) delete C.tune[id];
  for (const n of KNOBS) { const v = C.stats[n.k]; if (!(v >= n.min && v <= n.max)) delete C.stats[n.k]; }
  if (!BACKS.includes(C.back)) C.back = 'curtain'; if (!STAGES.includes(C.stage)) C.stage = 'stone'; if (!LIGHTS.includes(C.light)) C.light = 'day'; delete C.open;
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
  // the paint as a look-only piece (after the set: its paint wins), or null
  function paintPiece() {
    const paint = {}, hide = [];
    for (const [z, m] of Object.entries(C.paint)) { if (m === 'hide') hide.push(z); else if (m === 'custom') paint[z] = tonesOf(C.custom); else if (MATERIALS[m]) paint[z] = m; }
    const cloth = C.cloth === 'custom' ? tonesOf(C.custom) : C.cloth === 'off' || MATERIALS[C.cloth] ? C.cloth : '';
    return Object.keys(paint).length || hide.length || cloth ? {id: 'wardrobe', name: 'Wardrobe', slot: '', look: {paint, hide, cloth: cloth || undefined}} : null;
  }
  // his look in the game (features/gear.js preview): the tuned pieces and the paint over what he wears
  function applyLook() {
    const g = gear(); if (!g?.preview) return;
    if (!host.dev) { preview(null); return; }
    const swap = {}; let n = 0;
    for (const id in C.tune) { const p = gearById(id); swap[id] = {...p, look: {...p.look, add: C.tune[id]}}; n++; }
    const x = paintPiece();
    preview(n || x ? {swap, extra: x ? [x] : [], key: 'wardrobe'} : null);
  }
  const lookChanged = () => { lookDirty = true; lookV++; saveT = .3; };

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
  loadPixelFont();   // (dev/pixelfont.js: 'RiftPixel', made once; the fallback font shows until it's in)
  for (const [k, f] of Object.entries(FRAMES)) root.style.setProperty('--f-' + k, f());
  // U: css px a UI pixel, by the window's height (2 at 1080, 3 at 1440, 4 at 2160): every edge, gap and font pixel a whole U
  const unit = () => { const u = Math.max(2, Math.min(5, Math.round(innerHeight / 480))); root.style.setProperty('--u', u + 'px'); return u; };
  // no focus but the form fields' (Space / Enter stay the game's); a key in a text field is the field's, any other blurs it
  root.addEventListener('mousedown', e => { if (!/^(INPUT|SELECT|OPTION)$/.test(e.target.tagName)) e.preventDefault(); });
  root.addEventListener('keydown', e => {
    if (e.target.type === 'text') { e.stopPropagation(); if (e.key === 'Escape') e.target.blur(); return; }
    e.target.blur?.();
  });
  let hov = null, poseSel = null;   // (a hover sound once an element)
  root.addEventListener('pointerover', e => { const b = e.target.closest?.('button'); if (b && b !== hov) { hov = b; sound('hover'); } });
  const rows = [];   // each: sync() (writes only what changed); the tab's are after tabRows
  let tabRows = 0;
  const put = (e, k, v) => { if (e[k] !== v) e[k] = v; };
  const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; parent.appendChild(e); return e; };
  const btn = (cls, parent, text, go, title) => { const b = el('button', cls, parent, text); if (title) b.title = title; b.onclick = e => { go(e); sync(); }; return b; };
  const head = (parent, t) => el('div', 'wd-h', parent, t);

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
    el('div', 'wd-keys', top).innerHTML = 'drag: turn him · right-drag: move · wheel: zoom<br>R: frame · Space: spin · H: hide · Tab: next tab · P: photo';
    const back = btn('wd-back', top, '', () => close(), 'back to the game: the clothes chosen are worn from then');
    back.innerHTML = '<kbd>Esc</kbd>Back to the game';
  }

  // ---- left: the equipment
  {
    head(left, 'Equipment');
    for (const slot of SLOTS) {
      const b = el('button', 'wd-slot', left), ico = el('img', '', el('span', 'wd-ico wd-well', b)), tx = el('span', 'wd-tx', b);
      el('small', '', tx, SLOT_NAMES[slot]); const n = el('span', 'n', tx);
      const off = btn('wd-off', b, '×', e => { e.stopPropagation(); wearIn(slot, ''); sound('back'); }, 'take it off (his own clothes)');
      b.onclick = () => { C.slot = slot; C.tab = 'outfit'; save(); sound('click'); tab(); sync(); };
      let shown = null;
      rows.push(() => {
        const id = inSlot(slot), g = gearById(id);
        if (id !== shown) { shown = id; ico.src = iconOf(slot, g ? colorsOf(g)[0] : '#8a7c64'); }
        put(n, 'textContent', g ? g.name : 'his own'); put(n.style, 'color', g ? RARITY[g.rarity]?.col ?? '' : ''); b.classList.toggle('own', !g); b.classList.toggle('on', C.tab === 'outfit' && C.slot === slot);
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
      const fill = el('i', '', el('span', 't wd-well', d));
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
      const c = btn('wd-chip', bk, '', () => { C.back = k; save(); backdrop(); sound('click'); }, k);
      c.style.background = SETS[k].sw;
      rows.push(() => c.classList.toggle('on', C.back === k));
    }
    const sg = grp('Stage');
    for (const k of STAGES) {
      const c = btn('wd-chip' + (k === 'none' ? ' tx' : ''), sg, k === 'none' ? '\u2014' : '', () => { C.stage = k; save(); backdrop(); sound('click'); }, k);
      if (k !== 'none') c.style.background = STAGE_SW[k];
      rows.push(() => c.classList.toggle('on', C.stage === k));
    }
    const lt = el('div', 'wd-pick', grp('Light', 'the studio light: a key light from the front left, a lamp when it is dark'));
    for (const k of LIGHTS) {
      const b = btn('', lt, k[0].toUpperCase() + k.slice(1), () => { C.light = k; save(); light(); sound('click'); });
      rows.push(() => b.classList.toggle('on', C.light === k));
    }
    poseSel = el('select', '', grp('Pose', 'standing, or one of his clips (played, held, played again)'));
    poseSel.onchange = () => { pose = poseSel.value; studio.set({pose}); poseSel.blur(); };
    const vw = el('div', 'wd-pick', grp('View'));
    btn('', vw, '\u27f2', () => studio.turn(-45 * DEG), 'turn him 45\u00b0 (arrows, A / D: a step)');
    const sp = btn('', vw, 'Spin', () => { C.spin = !C.spin; studio.spin = C.spin; save(); }, 'Space: he turns slowly');
    btn('', vw, '\u27f3', () => studio.turn(45 * DEG), 'turn him 45\u00b0');
    btn('', vw, 'Frame', () => studio.reframe(), 'R: the view on him again');
    btn('', vw, 'Photo', () => { studio.photo(); say('photo saved'); }, 'P: a PNG of the scene');
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
    const cards = el('div', 'wd-cards', right), info = el('div', 'wd-info wd-well', right);
    const show = id => {
      const g = gearById(id);
      if (!g) { info.innerHTML = `<b>His own</b><br><span class="wd-dim">The ${SLOT_NAMES[C.slot].toLowerCase()} as the model was made: no weight, no armor.</span>`; return; }
      const does = [];
      if (g.armor) does.push(`takes ${pct(g.armor)} off the damage you take`);
      for (const m of g.mods || []) {
        if (m.stat === 'light.lantern') does.push('your lantern is always lit');
        else if (m.stat === 'light.lanternR') does.push(m.mul >= 1 ? `its light reaches ${pct(m.mul - 1)} further` : `a smaller light`);
        else if (m.stat === 'player.speed') does.push(`you move ${pct(m.mul - 1)} faster`);
        else if (m.stat === 'weapon.melee') does.push(`your blow (V) hits x${m.mul}`);
      }
      const R = RARITY[g.rarity];
      info.innerHTML = `<b style="color:${R?.col ?? ''}">${esc(g.name)}</b><br><span class="wd-dim">${R?.name ?? ''} ${(KINDS[g.kind] || '').toLowerCase()}</span><br>${esc(g.desc)}<br><span class="wd-key">${g.weight} kg</span>${g.armor ? ` · <span class="wd-key">armor ${pct(g.armor)}</span>` : ''}` +
        (does.length ? `<br>Now: ${esc(does.join('; '))}.` : '') + (g.soon ? `<br><span class="wd-soon">Later: ${esc(g.soon)} (not in the game yet)</span>` : '');
    };
    for (const g of [null, ...GEAR.filter(x => x.slot === C.slot)]) {
      const id = g?.id ?? '', b = el('button', 'wd-card', cards), band = el('span', 'wd-band', b), ct = el('span', 'wd-ct', b);
      stripes(colorsOf(g), band);
      const badge = el('em', 'wd-badge', ct, 'worn'), nm = el('span', '', ct, g ? g.name : 'His own'), R = g && RARITY[g.rarity];
      if (R) { nm.style.color = R.col; band.style.borderColor = R.col; }
      if (g) el('small', 'wd-kind', ct, `${R?.name ?? ''} ${(KINDS[g.kind] || '').toLowerCase()}`);
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
    const ag = el('div', 'wd-tiles list', right);
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

  // ---------------------------------------------------------------- the scene: the studio, a renderer of its own (dev/studio.js)
  // the free area's middle and height (css px): what the panes leave, the whole window with the UI hidden
  function area() {
    const W = innerWidth, H = innerHeight;
    if (root.classList.contains('wd-clean') || root.classList.contains('hidden')) return {cx: W / 2, cy: H / 2, h: H};
    const l = left.getBoundingClientRect(), r = right.getBoundingClientRect(), t = top.getBoundingClientRect(), b = bottom.getBoundingClientRect();
    return {cx: (l.right + r.left) / 2, cy: (t.bottom + b.top) / 2, h: b.top - t.bottom};
  }
  const studio = createStudio({host, hero, live, area});
  let pose = 'idle', lookV = 0, seenW = 0, seenH = 0, seenClean = false, posesFor = '', wantSeen = -1;
  function backdrop() { studio.set({stage: C.stage, back: C.back}); }
  const light = () => studio.set({light: C.light});
  // what the studio's copy of him wears: the set as chosen (worn in the game when you go back), tuned pieces, the paint
  function studioLook() {
    const swap = {}; for (const id in C.tune) { const p = gearById(id); swap[id] = {...p, look: {...p.look, add: C.tune[id]}}; }
    const ids = wearing(), ps = ids.map(id => swap[id] || gearById(id)), x = paintPiece(); if (x) ps.push(x);
    studio.look(ps, ids.join(',') + '#' + lookV);
  }
  // his poses: idle and his clips (the model's live-only ones: the live hero's emotes), when the model is in
  function poses() {
    if (!studio.ready || posesFor === studio.modelName) return;
    posesFor = studio.modelName; poseSel.textContent = '';
    for (const [v, t] of [['idle', 'Standing'], ...studio.emotes.map(e => [e, e.replace(/_/g, ' ')])]) { const o = el('option', '', poseSel, t); o.value = v; }
    if (pose !== 'idle' && !studio.emotes.includes(pose)) pose = 'idle';
    poseSel.value = pose; studio.set({pose});
  }
  const SCREEN = {
    frame(dt, t) {
      const clean = root.classList.contains('wd-clean');
      if (innerWidth !== seenW || innerHeight !== seenH || clean !== seenClean) { seenW = innerWidth; seenH = innerHeight; seenClean = clean; unit(); studio.resize(); }
      tick(dt); poses();
      const wv = gear()?.S.wantV; if (wv !== wantSeen) { wantSeen = wv; studioLook(); }   // (a piece chosen: on him at once)
      studio.frame(dt, t);
      if (hero.loadI !== loadWas) { const re = loadWas >= 0 && C.tab === 'paint'; loadWas = hero.loadI; lookDirty = true; if (re) tab(); }   // (another model: its zones)
      if (msgT > 0 && (msgT -= dt) <= 0) msgEl.classList.remove('on');
      if ((syncT -= dt) <= 0) { syncT = .25; sync(); }
    },
    key(k, e) {
      if (k === 'tab' || k === ' ' || k.startsWith('arrow')) e.preventDefault();
      if (e.repeat && !k.startsWith('arrow')) return;
      if (k === 'escape' || (k === 'tab' && e.shiftKey)) { close(); return; }
      if (k === 'tab') { C.tab = TAB_IDS[(TAB_IDS.indexOf(C.tab) + 1) % TAB_IDS.length]; save(); sound('click'); tab(); return; }
      if (k === 'r' || k === 'home') { studio.reframe(); sound('click'); return; }
      if (k === 'h') { root.classList.toggle('wd-clean'); return; }
      if (k === 'p') { studio.photo(); say('photo saved'); sound('confirm'); return; }
      if (k === ' ') { C.spin = !C.spin; studio.spin = C.spin; save(); sync(); return; }
      if (k === 'arrowleft' || k === 'a' || k === 'q') studio.turn(-22.5 * DEG);
      if (k === 'arrowright' || k === 'd' || k === 'e') studio.turn(22.5 * DEG);
      if (k === '+' || k === '=') studio.zoom(1);
      if (k === '-') studio.zoom(-1);
    },
  };
  function open() {
    const E = engine();
    if (F.on || !host.dev || !E?.loop || game()?.mode === 'title' || host.lock) return;
    if (E.pause.paused) E.pause.toggle(false, null);
    F.on = true; loadWas = hero.loadI; posesFor = ''; wantSeen = -1;
    unit(); root.classList.remove('hidden', 'wd-clean'); document.body.classList.add('wd');
    tab();
    studio.show(true); studio.spin = C.spin; backdrop(); light(); studio.set({pose});
    E.keys?.clear?.(); E.loop.hold(SCREEN);   // (the game holds: not stepped, not drawn, its keys ours)
    host.feature('audio')?.duck?.(true);
    lookDirty = true; lookT = 0; tick(0);
    sound('open');
  }
  function close() {
    if (!F.on) return;
    const E = engine();
    E.loop.hold(null); studio.show(false); F.on = false;
    root.classList.add('hidden'); document.body.classList.remove('wd');
    host.feature('audio')?.duck?.(false);
    lookDirty = true; lookT = 0; save(); sound('back');   // (the set chosen is worn from the next step: features/gear.js)
  }
  // the notes, the look and the save, in step with what changed (the update while shut, the screen's frame while open)
  function tick(dt) {
    if (host.dev !== devWas) { devWas = host.dev; applyNotes(); lookDirty = true; }   // (the first step too: the remembered notes and look)
    if (lookDirty && (lookT -= dt) <= 0) { lookDirty = false; lookT = .05; applyLook(); if (F.on) studioLook(); }
    if (saveT > 0 && (saveT -= dt) <= 0) save();
  }

  let devWas = null, syncT = 0, loadWas = -1;
  const F = {
    name: 'wardrobe', label: 'Wardrobe', key: 'shift+tab', on: false,
    toggle() { if (F.on) close(); else open(); return F.on; },
    onKey(k, e) { if (k !== 'tab' || !e?.shiftKey) return false; open(); return true; },
    update(dt) {
      tick(dt);
      if (!queue.length) return;
      for (const fn of queue) fn();
      queue.length = 0;
    },
    menu: () => host.dev && game()?.mode !== 'title' ? [{label: 'Wardrobe', run: open}] : [],
    hud() {
      if (!host.dev) return '';
      const a = [], np = Object.keys(C.paint).length + (C.cloth ? 1 : 0), nt = Object.keys(C.tune).length, ns = Object.keys(C.stats).length;
      if (np) a.push(`${np} paint${np > 1 ? 's' : ''}`); if (nt) a.push(`${nt} tuned`); if (ns) a.push(`${ns} stat${ns > 1 ? 's' : ''}`);
      return a.length ? `<b>wardrobe</b> ${a.join(' · ')}` : '';
    },
  };
  return F;
}
