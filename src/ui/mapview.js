// MAP VIEW: the player's WORLD MAP, the Book's Map tab (ui/book.js, features/panels.js; hotkey H). An old parchment map of the
// world as it is painted: the ground's own canvases (world/world.js: the Proving Grounds' groundCanvas, the West Downs' westCanvas,
// the forest's tiles) drawn ONCE, small (MPX px a metre), toned sepia, its water inked over, the forest's trees dotted in; the
// landmarks as little pixel glyphs (the cave's mouth, the clearing, the fell, the tower, the yard's fire and beacon, what you
// built, your friends online); you as a pixel arrow (your facing, 8 ways; hollow while you're down in the cave, shown where the
// cave lies under the woods). FOG OF WAR: what you've never been near is a parchment cloud with a dithered, inked edge; it lifts
// REVEAL m round you as you walk (a CELL m grid, saved in the pack: pack.store('map')), and a landmark shows once its cell is seen.
// A fresh world (pack.reset empties the store) is all fog again.
//   Wheel: zoom (fit / 2x / 4x, round the pointer). Drag: pan. Double click or the button: back to you. Right click: put down a
//   PIN (or take it up): the footer says how far it is and which way. The footer: what's under the pointer (a landmark's name,
//   or x / y in metres), the share explored.
// API:
//   const map = createMapView(host)
//   map.mount(el)   once: builds its DOM in el (el's DOM is its own; el sits in the Book's scrolling column, ~340 x 230 UI px)
//   map.show()      the tab became visible: paints the map the first time (spread over frames), centres on the player
//   map.hide()      it stopped being visible
//   map.frame()     every animation frame while visible (the paint's next steps, the fog when it changed, the markers)
//   map.update(dt)  every sim step (1/60 s), ALWAYS (even shut): the fog's reveal and its save
//   map.reveal(x, y, r?) clears the fog round world (x, y) (r m, default REVEAL): for a feature that hands out a map
//   map.pin -> {x, y} | null (the player's pin, world m; a copy), map.explored -> 0..1, map.painted (the terrain drawn)
// OWNS: its DOM and style (#mv-css), the map canvases (terrain: cw x ch; fog: fw x fh), the seen grid and its part of the save
//   (pack.store('map'): {v: 1, seen: '<gw>x<gh>:<base64 bitset>', pin?: [x, y]}), the zoom ('rb.map.z' on this machine).
// READS: host.world (groundCanvas, westCanvas, forestTiles), host.PPM, host.biome.id, host.player (x, y, faceAngle), host.entities
//   (near: the yard's campfire and beacon, once), host.feature('pack') (store, dirty), host.feature('builds') (list, ver),
//   host.feature('coop').net.peers (each friend's latest place), world/layout.js (WORLD, GROUNDS, PLAY, STREAM, POOL, FALL, FOREST,
//   CAVE, HUT, WEST_LAND), world/forest.js (RECT), world/westland.js (TOWER, OAKS), ui/pixelframe.js (FRAMES).
// BUDGET: update: an integer cell compare a step; a 9 x 9 cell reveal when he enters a new cell; a save string every 4 s while new
//   ground is being seen. Shut: nothing else. Open: the first paint ~4 ms a frame until done (once a world); the fog image
//   (fw x fh, ~23 k px of integer math + one putImageData) at most 4 times a second and only when cells changed; the markers'
//   transforms only when they moved (the player > .2 m or a new facing; friends 10 times a second); no allocation per frame.
import {WORLD, GROUNDS, PLAY, STREAM, POOL, FALL, FOREST, CAVE, HUT, WEST_LAND} from '../world/layout.js';
import {RECT as FOREST_RECT} from '../world/forest.js';
import {TOWER, OAKS} from '../world/westland.js';
import {hash3} from '../core/mathx.js';
import {FRAMES} from './pixelframe.js';

const CELL = 4;            // m: the fog's grid
const REVEAL = 14;         // m round the player that the fog lifts
const SAVE_EVERY = 4;      // s between saves while new ground is seen
const ZOOMS = [1, 2, 4];   // x the fit
const HOVER = 7;           // UI px: the pointer this near a glyph names it
const PAINT_MS = 4;        // ms of painting a frame (the first show)
const ZKEY = 'rb.map.z';

// the map's rect: the world, but not the cave's band north of the forest (it lies under the woods: the cave is shown there)
const X0 = WORLD.x0, X1 = WORLD.x1, Y1 = WORLD.y1, Y0 = FOREST ? Math.max(WORLD.y0, FOREST_RECT.y0) : WORLD.y0;
const MW = X1 - X0, MH = Y1 - Y0;
const MPX = Math.min(2, 520 / Math.max(MW, MH));        // terrain px a metre
const FPM = MPX / 2;                                     // fog px a metre
const CW = Math.ceil(MW * MPX), CH = Math.ceil(MH * MPX);
const FW = Math.ceil(MW * FPM), FH = Math.ceil(MH * FPM);
const GW = Math.ceil(MW / CELL), GH = Math.ceil(MH / CELL), GN = GW * GH;
const GKEY = `${GW}x${GH}:`;
const COFF = CAVE?.off?.[1] || 0;                        // the cave's band lies this far north (-) of the woods it is under

// ---- the palette (the game's UI: ink, text, dim, gold) and the map's own
const INK = '#0c0907';
const PAL = {k: INK, w: '#efe6cf', d: '#a39478', s: '#8c8270', g: '#f2c95c', o: '#ff9a3c', n: '#7a5230', c: '#b8f0a4', p: '#c8a4ff',
  b: '#6f97a6', l: '#8fbf5a', r: '#d8452c', y: '#ffe08a'};
const WATER = {ruins: ['#6a8a8e', '#3b565b'], ember: ['#d8692a', '#7e3010'], frost: ['#b4d2da', '#6d93a2'], rift: ['#6c4c8e', '#38264f']};
const TREE = {pine: ['#26382a', '#3d5a3a'], birch: ['#4f6a3c', '#7e9a5a'], willow: ['#3f5e36', '#62844a'], dead: ['#4e4234', '#6e5e48'], oak: ['#2f4628', '#557a3e']};

// ---- the glyphs: rows of palette letters ('.' clear); an ink outline is added round them (outline: true)
const GLYPHS = {
  arena: ['w.....w', '.w...w.', '..w.w..', '...y...', '..w.w..', '.n...n.', 'n.....n'],
  cave: ['..ddd..', '.ddddd.', 'ddkkkdd', 'dkkkkkd', 'dkkkkkd', 'dkkkkkd'],
  fire: ['..o..', '.oo..', '.oyo.', 'oyyoo', 'oyyyo', 'nnnnn', 'n.n.n'],
  lamp: ['..c..', '.cwc.', '.ccc.', '..c..', '.sss.', 'sssss'],
  beacon1: ['..o..', '.oyo.', 'nnnnn', '.n.n.', '.n.n.', 'nnnnn'],
  beacon0: ['.....', '.....', 'nnnnn', '.n.n.', '.n.n.', 'nnnnn'],
  tower: ['s.s.s', 'sssss', '.sss.', '.sks.', '.sss.', '.sss.', '.sss.', 'sssss'],
  peak: ['....w....', '...www...', '..wsdss..', '.sddsdds.', 'sdddsddds'],
  hut: ['...n...', '..nnn..', '.nnnnn.', 'nnnnnnn', '.dddkd.', '.dddkd.'],
  rocks: ['.ss....', 'sdds.s.', 'sdds.ss', '.ss.sds'],
  mire: ['l.l..l.', 'l.ll.l.', '.ll.ll.', 'bbbbbbb', '.bbbbb.'],
  furnace: ['..s..', '.sss.', 'sssss', 'sssss', 'sokos', 'sssss'],
  anvil: ['sssssss', '.sssss.', '..sss..', '.nnnnn.'],
  shelf: ['nnnnnnn', '.n...n.', 'nnnnnnn', '.n...n.', '.n...n.'],
  pin: ['..rrr..', '.rrrrr.', 'rrrwrrr', '.rrrrr.', '..rrr..', '...r...', '...r...', '...r...'],
};
const PLAIN = {   // no outline (on the frame / the button)
  target: ['..www..', '.w...w.', 'w..y..w', 'w.yyy.w', 'w..y..w', '.w...w.', '..www..'],
  north: ['..y..', '.yyy.', 'yyyyy'],
};
const BUILD_GLYPH = {campfire: 'fire', fire_ring: 'fire', crystal_lamp: 'lamp', furnace: 'furnace', anvil: 'anvil', keep_shelf: 'shelf'};

const CSS = `
.mv { position: relative; user-select: none; -webkit-user-select: none; color: #efe6cf;
  font: calc(10 * var(--u, 2px)) / calc(11 * var(--u, 2px)) RiftPixel, ui-monospace, Consolas, monospace; font-synthesis: none; }
.mv-view { position: relative; height: calc(206 * var(--u, 2px)); overflow: hidden; background: #3b2d1f; cursor: grab; touch-action: none; contain: layout paint; }
.mv-view.drag { cursor: grabbing; }
.mv-pan { position: absolute; left: 0; top: 0; will-change: transform; }
.mv-pan canvas, .mv-g, .mv-me canvas { position: absolute; left: 0; top: 0; image-rendering: crisp-edges; image-rendering: pixelated; pointer-events: none; }
.mv-pan canvas.mv-fog { image-rendering: crisp-edges; image-rendering: pixelated; }
.mv-me { position: absolute; left: 0; top: 0; pointer-events: none; }
.mv-me .mv-ring { animation: mv-blink 1.1s steps(2, jump-none) infinite; }
@keyframes mv-blink { 0% { opacity: 1; } 100% { opacity: 0; } }
.mv-edge { position: absolute; inset: 0; pointer-events: none; border: calc(3 * var(--u, 2px)) solid transparent;
  border-image: var(--mv-frame) 3 / calc(3 * var(--u, 2px)); }
.mv-n { position: absolute; left: calc(6 * var(--u, 2px)); top: calc(5 * var(--u, 2px)); display: grid; justify-items: center; color: #f2c95c;
  text-shadow: var(--u, 2px) var(--u, 2px) 0 #0c0907; pointer-events: none; }
.mv-n canvas { width: calc(5 * var(--u, 2px)); height: calc(3 * var(--u, 2px)); image-rendering: pixelated; }
.mv-sc { position: absolute; left: calc(7 * var(--u, 2px)); bottom: calc(6 * var(--u, 2px)); pointer-events: none; color: #efe6cf;
  text-shadow: var(--u, 2px) var(--u, 2px) 0 #0c0907; }
.mv-sc i { display: block; height: calc(2 * var(--u, 2px)); margin: var(--u, 2px) var(--u, 2px) 0;
  background: linear-gradient(90deg, #efe6cf 50%, #0c0907 50%); box-shadow: 0 0 0 var(--u, 2px) #0c0907; }
.mv-btn { position: absolute; right: calc(6 * var(--u, 2px)); top: calc(5 * var(--u, 2px)); width: calc(15 * var(--u, 2px)); height: calc(15 * var(--u, 2px));
  padding: 0; cursor: pointer; background: none; display: grid; place-items: center;
  border: calc(2 * var(--u, 2px)) solid transparent; border-image: var(--mv-btn) 2 fill / calc(2 * var(--u, 2px)); }
.mv-btn:hover { border-image-source: var(--mv-hot); }
.mv-btn:focus { outline: none; }
.mv-btn:active { border-image-source: var(--mv-down); }
.mv-btn canvas { width: calc(7 * var(--u, 2px)); height: calc(7 * var(--u, 2px)); image-rendering: pixelated; pointer-events: none; }
.mv-wait { position: absolute; inset: 0; display: grid; place-items: center; color: #6b5236; pointer-events: none; }
.mv-foot { display: flex; justify-content: space-between; gap: calc(4 * var(--u, 2px)); margin-top: calc(3 * var(--u, 2px));
  color: #a39478; white-space: nowrap; overflow: hidden; }
.mv-foot b { font-weight: normal; color: #efe6cf; }
`;

// ABGR (little-endian ImageData words)
const rgba = (hex, a = 255) => { const v = parseInt(hex.slice(1), 16); return ((a << 24) | ((v & 255) << 16) | (v & 0xff00) | (v >> 16 & 255)) >>> 0; };
const FOG_TONES = [rgba('#c6af86'), rgba('#d1bc94'), rgba('#b9a179')], FOG_RIM = rgba('#7a6344'), FOG_INK = rgba('#5e4a32');
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const TILE = 64, TM = TILE - 1;   // the fog's pattern repeats every TILE px (a power of 2)
// value noise over a TILE px square with n lattice cells across, wrapping (a seamless tile): 0..1
const pnoise = (i, j, n, s) => {
  const x = i * n / TILE, y = j * n / TILE, xi = Math.floor(x), yi = Math.floor(y), w = q => (q % n + n) % n;
  let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash3(w(xi), w(yi), s), b = hash3(w(xi + 1), w(yi), s), c = hash3(w(xi), w(yi + 1), s), d = hash3(w(xi + 1), w(yi + 1), s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (dx, dy) => DIRS[Math.round(Math.atan2(dx, -dy) / (Math.PI / 4)) & 7];

function canvas(w, h, soft = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return {c, q: c.getContext('2d', soft ? {willReadFrequently: true} : undefined)};
}
// a glyph: its rows into a canvas, with a one-pixel ink outline round the lit pixels (4 ways) when `outline`
function glyph(rows, outline = true) {
  const h = rows.length, w = rows[0].length, o = outline ? 1 : 0, {c, q} = canvas(w + 2 * o, h + 2 * o);
  const lit = (x, y) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== '.';
  if (outline) {
    q.fillStyle = INK;
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) if (!lit(x, y) && (lit(x - 1, y) || lit(x + 1, y) || lit(x, y - 1) || lit(x, y + 1))) q.fillRect(x + o, y + o, 1, 1);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ch = rows[y][x]; if (ch === '.') continue; q.fillStyle = PAL[ch] || INK; q.fillRect(x + o, y + o, 1, 1); }
  return c;
}
// the player's arrow, 8 ways (0 = north, clockwise), 11 x 11 each in one strip: a dart rasterised turned, outlined in ink
function arrowStrip(fill, tip) {
  const N = 11, {c, q} = canvas(N * 8, N), R = 4.4, P = [[0, -1], [.8, .92], [0, .4], [-.8, .92]];
  const inside = (px, py, V) => { let s = false; for (let i = 0, j = V.length - 1; i < V.length; j = i++) { const [xi, yi] = V[i], [xj, yj] = V[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) s = !s; } return s; };
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a), V = P.map(([x, y]) => [N / 2 + (x * ca - y * sa) * R, N / 2 + (x * sa + y * ca) * R]);
    const m = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) m[y * N + x] = inside(x + .5, y + .5, V) ? 1 : 0;
    const tx = Math.floor(V[0][0]), ty = Math.floor(V[0][1]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const on = m[y * N + x], nb = (x > 0 && m[y * N + x - 1]) || (x < N - 1 && m[y * N + x + 1]) || (y > 0 && m[y * N + x - N]) || (y < N - 1 && m[y * N + x + N]);
      if (!on && !nb) continue;
      q.fillStyle = !on ? INK : Math.abs(x - tx) + Math.abs(y - ty) <= 2 ? tip : fill; q.fillRect(k * N + x, y, 1, 1);
    }
  }
  return c;
}
function ringGlyph() {   // the blinking ring round the player: gold in an ink ring
  const N = 15, {c, q} = canvas(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x + .5 - N / 2, y + .5 - N / 2);
    if (d > 5.7 && d <= 6.6) { q.fillStyle = PAL.y; q.fillRect(x, y, 1, 1); } else if ((d > 4.9 && d <= 5.7) || (d > 6.6 && d <= 7.4)) { q.fillStyle = INK; q.fillRect(x, y, 1, 1); }
  }
  return c;
}
function dotGlyph(color) {   // a friend: a dot of their colour, ink round it
  const N = 7, {c, q} = canvas(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x + .5 - N / 2, y + .5 - N / 2);
    if (d <= 2.4) { q.fillStyle = color; q.fillRect(x, y, 1, 1); } else if (d <= 3.4) { q.fillStyle = INK; q.fillRect(x, y, 1, 1); }
  }
  q.fillStyle = 'rgba(255,255,255,.55)'; q.fillRect(2, 2, 1, 1);
  return c;
}
function copyOf(src, cls = 'mv-g') { const {c, q} = canvas(src.width, src.height); q.drawImage(src, 0, 0); c.className = cls; return c; }

export function createMapView(host) {
  // ================================================================ the fog (sim side: runs always, allocates nothing)
  const seen = new Uint8Array(GN), bytes = new Uint8Array(Math.ceil(GN / 8));
  let seenN = 0, lastI = 1e9, lastJ = 1e9, changed = false, fogDirty = true, saveT = SAVE_EVERY, pollT = 0;
  let store = null, lastWritten, pin = null;
  const RC = Math.ceil(REVEAL / CELL) + 1;

  function revealAt(mx, my, r) {   // map-local metres
    const R2 = r * r, rc = Math.ceil(r / CELL), ci = Math.floor(mx / CELL), cj = Math.floor(my / CELL);
    for (let j = cj - rc; j <= cj + rc; j++) {
      if (j < 0 || j >= GH) continue;
      const dy = (j + .5) * CELL - my;
      for (let i = ci - rc; i <= ci + rc; i++) {
        if (i < 0 || i >= GW) continue;
        const dx = (i + .5) * CELL - mx;
        if (dx * dx + dy * dy > R2) continue;
        const k = j * GW + i;
        if (!seen[k]) { seen[k] = 1; seenN++; changed = true; fogDirty = true; }
      }
    }
  }
  const seenAt = (x, y) => { const i = Math.floor((x - X0) / CELL), j = Math.floor((y - Y0) / CELL); return i >= 0 && j >= 0 && i < GW && j < GH && seen[j * GW + i] === 1; };
  function clearSeen() { seen.fill(0); seenN = 0; fogDirty = true; lastI = lastJ = 1e9; }
  function encode() {
    bytes.fill(0);
    for (let k = 0; k < GN; k++) if (seen[k]) bytes[k >> 3] |= 1 << (k & 7);
    let s = ''; for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    return GKEY + btoa(s);
  }
  function decode(str, merge) {
    if (!merge) clearSeen();
    if (typeof str !== 'string' || !str.startsWith(GKEY)) return;   // (another world's size: its fog doesn't fit this one)
    let bin; try { bin = atob(str.slice(GKEY.length)); } catch { return; }
    for (let k = 0; k < GN; k++) {
      const b = k >> 3; if (b >= bin.length) break;
      if (bin.charCodeAt(b) >> (k & 7) & 1 && !seen[k]) { seen[k] = 1; seenN++; }
    }
    fogDirty = true; lastI = lastJ = 1e9;
  }
  const pinOf = v => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? {x: v[0], y: v[1]} : null;
  // the pack's store: adopted when found (merged with what was seen before it was), watched for a fresh world (its fields deleted:
  // our v mark gone) or another save loaded into it (its seen not the one we wrote)
  function poll() {
    const pk = typeof host.feature === 'function' ? host.feature('pack') : null, s = pk && typeof pk.store === 'function' ? pk.store('map') : null;
    if (!s || typeof s !== 'object') return;
    if (s !== store) {
      const first = store === null; store = s;
      decode(s.seen, first); pin = pinOf(s.pin); s.v = 1; lastWritten = s.seen;
      if (first && seenN) changed = true;
      marksDirty = true; return;
    }
    if (s.v !== 1) { clearSeen(); pin = null; s.v = 1; lastWritten = s.seen; marksDirty = true; return; }   // a fresh world
    if (s.seen !== lastWritten) { decode(s.seen, false); pin = pinOf(s.pin); lastWritten = s.seen; marksDirty = true; }
  }
  function save() {
    saveT = SAVE_EVERY;
    if (!store) return;
    const str = encode(); store.seen = str; store.v = 1; lastWritten = str;
    if (pin) store.pin = [Math.round(pin.x * 10) / 10, Math.round(pin.y * 10) / 10]; else delete store.pin;
    changed = false;
    host.feature('pack')?.dirty?.();
  }
  function update(dt) {
    if ((pollT -= dt) <= 0) { pollT = 1; poll(); }
    if (changed && (saveT -= dt) <= 0) save();
    const pl = host.player; if (!pl) return;
    const x = pl.x, y = pl.y;
    if (!(x === x && y === y)) return;
    const ci = Math.floor((x - X0) / CELL), cj = Math.floor((y - Y0) / CELL);
    if (ci === lastI && cj === lastJ) return;
    lastI = ci; lastJ = cj;
    if (ci < -RC || cj < -RC || ci >= GW + RC || cj >= GH + RC) return;   // (off the map: the cave's band)
    revealAt(x - X0, y - Y0, REVEAL);
  }

  // ================================================================ the view (DOM; built on mount)
  let root = null, view = null, pan = null, tcv = null, tq = null, fcv = null, fq = null, fimg = null, fpx = null, meEl = null, meCv = null, meQ = null;
  let footL = null, footR = null, scBar = null, scText = null, waitEl = null, marksEl = null;
  let shown = false, u = 2, vw = 1, vh = 1, zi = 1, sc = 1, tx = 0, ty = 0, dragging = false, dragX = 0, dragY = 0;
  let ARROW = null, ARROW_U = null, marksDirty = true, warned = false, needCentre = false, yardTries = 0, pinMark = null, pinShown = null;
  let thr = null, tone = null, colA = null, colB = null, colF = null, rowA = null, rowB = null, rowF = null;
  const marks = [], builds = [], peers = [];   // {name, x, y, key, el (its glyph; null: named only, r m round it), always, vis, r}
  let buildsVer = -1, beacon = null, beaconMark = null, peerN = 0, fogAt = 0, marksAt = 0, peersAt = 0;
  let meX = 1e9, meY = 1e9, meOct = -1, meUnder = null, footX = 1e9, footY = 1e9, footRText = '', footLText = '';
  const G = {};   // glyph sources by key

  // (never throws: a fault is logged once and the map goes on without that call)
  const safe = (f, what) => a => { try { return f(a); } catch (e) { if (!warned) { warned = true; console.warn('mapview: ' + what, e); } } };

  function readU() { const v = root ? parseFloat(getComputedStyle(root).getPropertyValue('--u')) : NaN; return v > 0 ? v : 2; }
  function sizeGlyph(el, src) { el.style.width = src.width * u + 'px'; el.style.height = src.height * u + 'px'; }

  function mount(el) {
    if (root) return;
    if (!document.getElementById('mv-css')) { const st = document.createElement('style'); st.id = 'mv-css'; st.textContent = CSS; document.head.appendChild(st); }
    for (const k in GLYPHS) G[k] = glyph(GLYPHS[k]);
    for (const k in PLAIN) G[k] = glyph(PLAIN[k], false);
    G.ring = ringGlyph();
    ARROW = arrowStrip(PAL.g, PAL.y); ARROW_U = arrowStrip(PAL.d, PAL.w);
    root = document.createElement('div'); root.className = 'mv';
    root.style.setProperty('--mv-frame', FRAMES.panel()); root.style.setProperty('--mv-btn', FRAMES.btn());
    root.style.setProperty('--mv-hot', FRAMES.hot()); root.style.setProperty('--mv-down', FRAMES.down());
    root.innerHTML = '<div class="mv-view"><div class="mv-pan"></div><div class="mv-wait">drawing the map…</div><div class="mv-edge"></div>'
      + '<div class="mv-n"><span></span>N</div><div class="mv-sc"><span></span><i></i></div>'
      + '<button class="mv-btn" type="button" data-tip="Back to you (or double click the map)" data-tip-t="Centre"></button></div>'
      + '<div class="mv-foot"><span></span><span></span></div>';
    view = root.querySelector('.mv-view'); pan = root.querySelector('.mv-pan'); waitEl = root.querySelector('.mv-wait');
    root.querySelector('.mv-n span').replaceWith(copyOf(G.north, ''));
    root.querySelector('.mv-btn').appendChild(copyOf(G.target, ''));
    scText = root.querySelector('.mv-sc span'); scBar = root.querySelector('.mv-sc i');
    [footL, footR] = root.querySelectorAll('.mv-foot span');
    // the terrain (painted on show) and the fog over it, both stretched to the pan's size (zoom), crisp
    ({c: tcv, q: tq} = canvas(CW, CH, true)); tcv.style.visibility = 'hidden';
    ({c: fcv, q: fq} = canvas(FW, FH)); fcv.className = 'mv-fog';
    fimg = fq.createImageData(FW, FH); fpx = new Uint32Array(fimg.data.buffer);
    marksEl = document.createElement('div'); marksEl.style.cssText = 'position:absolute;left:0;top:0';
    meEl = document.createElement('div'); meEl.className = 'mv-me';
    const ring = copyOf(G.ring, 'mv-ring'); meEl.appendChild(ring);
    ({c: meCv, q: meQ} = canvas(11, 11)); meEl.appendChild(meCv);
    pan.append(tcv, fcv, marksEl, meEl);
    el.appendChild(root);
    try { const v = localStorage.getItem(ZKEY), z = v === null ? NaN : +v; if (z >= 0 && z < ZOOMS.length) zi = z | 0; } catch { /* (no storage: the default) */ }
    // ---- input: on our own elements; the game never sees it
    view.addEventListener('wheel', safe(onWheel, 'wheel'), {passive: false});
    view.addEventListener('pointerdown', safe(onDown, 'down'));
    view.addEventListener('pointermove', safe(onMove, 'move'));
    view.addEventListener('pointerup', safe(onUp, 'up'));
    view.addEventListener('pointercancel', safe(onUp, 'cancel'));
    view.addEventListener('pointerleave', () => { if (!dragging) setHover(''); });
    view.addEventListener('mousedown', e => e.stopPropagation());
    view.addEventListener('dblclick', safe(e => { e.preventDefault(); e.stopPropagation(); centreOnMe(); }, 'dblclick'));
    view.addEventListener('contextmenu', safe(onMenu, 'menu'));
    root.querySelector('.mv-btn').addEventListener('pointerdown', e => e.stopPropagation());
    root.querySelector('.mv-btn').addEventListener('click', safe(e => { e.stopPropagation(); centreOnMe(); host.uiSound?.('click'); }, 'centre'));
    if (typeof ResizeObserver === 'function') new ResizeObserver(safe(() => { if (shown) { measure(); applyZoom(); } }, 'resize')).observe(view);
    buildStaticMarks();
    pinMark = addMark(marks, 'your pin', 0, 0, 'pin');
  }

  // ---- the fog's image: a TILE x TILE px pattern (repeating, seamless) of dither thresholds (Bayer + periodic value noise: a
  // cloud's ragged edge) and tones, made once; per column / row the two cells it lies between and how far (bilinear over the grid)
  function buildFogTables() {
    thr = new Float32Array(TILE * TILE); tone = new Uint8Array(TILE * TILE);
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
      const k = j * TILE + i;
      const t0 = .5 + (BAYER[(j & 3) * 4 + (i & 3)] / 16 + 1 / 32 - .5) * .38 + (pnoise(i, j, 8, 91) - .5) * .5 + (pnoise(i, j, 3, 7) - .5) * .25;
      thr[k] = t0 < .16 ? .16 : t0 > .86 ? .86 : t0;   // (never near 0: no rim specks in the whole cloud)
      const t = pnoise(i, j, 6, 17) + (pnoise(i, j, 16, 23) - .5) * .25;
      tone[k] = t > .62 ? 1 : t < .34 ? 2 : 0;
    }
    const axis = (n, len) => {
      const A = new Int32Array(n), B = new Int32Array(n), F = new Float32Array(n);
      for (let i = 0; i < n; i++) { const c = (i + .5) / FPM / CELL - .5, c0 = Math.floor(c); A[i] = Math.max(0, Math.min(len - 1, c0)); B[i] = Math.max(0, Math.min(len - 1, c0 + 1)); F[i] = c - c0; }
      return [A, B, F];
    };
    [colA, colB, colF] = axis(FW, GW); [rowA, rowB, rowF] = axis(FH, GH);
  }
  function redrawFog() {
    for (let j = 0; j < FH; j++) {
      const ra = rowA[j] * GW, rb = rowB[j] * GW, fy = rowF[j], o = j * FW, to = (j & TM) * TILE;
      for (let i = 0; i < FW; i++) {
        const a = colA[i], b = colB[i], fx = colF[i];
        const s00 = seen[ra + a], s10 = seen[ra + b], s01 = seen[rb + a], s11 = seen[rb + b];
        const k = o + i;
        if ((s00 & s10 & s01 & s11) === 1) { fpx[k] = 0; continue; }
        const t = to | (i & TM), top = s00 + (s10 - s00) * fx, bot = s01 + (s11 - s01) * fx, d = top + (bot - top) * fy - thr[t];
        fpx[k] = d >= 0 ? 0 : d > -.07 ? FOG_RIM : d > -.1 ? FOG_INK : FOG_TONES[tone[t]];
      }
    }
    fq.putImageData(fimg, 0, 0);
  }

  // ================================================================ the terrain: painted once a world, a few steps a frame
  const steps = [];
  let si = 0, paintedWorld, painted = false;
  function startPaint() {
    const w = host.world || null; paintedWorld = w; painted = false; steps.length = 0; si = 0;
    if (tcv) tcv.style.visibility = 'hidden';
    if (waitEl) waitEl.style.display = '';
    const PPM = host.PPM || 30;
    steps.push(() => { tq.globalCompositeOperation = 'source-over'; tq.globalAlpha = 1; tq.fillStyle = '#9c8762'; tq.fillRect(0, 0, CW, CH); tq.imageSmoothingEnabled = true; tq.imageSmoothingQuality = 'high'; });
    if (w?.westCanvas && WEST_LAND) steps.push(() => blit(w.westCanvas, WEST_LAND.x0, WEST_LAND.y0, PPM, WEST_LAND.x0, WEST_LAND.y0, WEST_LAND.x0 + w.westCanvas.width / PPM, WEST_LAND.y0 + w.westCanvas.height / PPM));
    const tiles = Array.isArray(w?.forestTiles) ? w.forestTiles : [];
    for (const T of tiles) steps.push(() => {
      if (T.canvas) blit(T.canvas, T.cx0, T.cz0, PPM, T.x0, T.z0, T.x1, T.z1);
      else { tq.fillStyle = '#7d7a55'; rectM(T.x0, T.z0, T.x1, T.z1); }   // (a biome without the forest's painter: its stand-in)
    });
    if (w?.groundCanvas) steps.push(() => blit(w.groundCanvas, GROUNDS.x0, GROUNDS.y0, PPM, GROUNDS.x0, GROUNDS.y0, GROUNDS.x0 + w.groundCanvas.width / PPM, GROUNDS.y0 + w.groundCanvas.height / PPM));
    steps.push(paintTrees, paintTone, paintWater, paintFinish);
  }
  function runPaint(now) {
    while (si < steps.length) { steps[si++](); if (performance.now() - now > PAINT_MS) break; }
  }
  const px = x => (x - X0) * MPX, py = y => (y - Y0) * MPX;
  function rectM(x0, y0, x1, y1) { const a = Math.max(0, Math.floor(px(x0))), b = Math.max(0, Math.floor(py(y0))); tq.fillRect(a, b, Math.ceil(px(x1)) - a, Math.ceil(py(y1)) - b); }
  // a world canvas (origin ox, oy; ppm px a metre) onto the map: its region x0..x1, y0..y1 (m), clipped to the map
  function blit(src, ox, oy, ppm, x0, y0, x1, y1) {
    const ax = Math.max(x0, X0, ox), ay = Math.max(y0, Y0, oy), bx = Math.min(x1, X1, ox + src.width / ppm), by = Math.min(y1, Y1, oy + src.height / ppm);
    if (!(bx > ax && by > ay)) return;
    tq.drawImage(src, (ax - ox) * ppm, (ay - oy) * ppm, (bx - ax) * ppm, (by - ay) * ppm, px(ax), py(ay), (bx - ax) * MPX, (by - ay) * MPX);
  }
  function paintTrees() {
    const dot = (x, y, sp, big) => {
      if (x < X0 || x >= X1 || y < Y0 || y >= Y1) return;
      const c = TREE[sp] || TREE.oak, i = Math.floor(px(x)), j = Math.floor(py(y));
      tq.fillStyle = c[0];
      if (big) { tq.fillRect(i - 1, j, 3, 1); tq.fillRect(i, j - 1, 1, 3); tq.fillStyle = c[1]; tq.fillRect(i - 1, j - 1, 1, 1); }
      else { tq.fillRect(i - 1, j - 1, 2, 2); tq.fillStyle = c[1]; tq.fillRect(i - 1, j - 1, 1, 1); }
    };
    if (FOREST?.trees?.forEach) FOREST.trees.forEach(t => dot(t[0], t[1], t[2] || 'pine', t[2] && t[2] !== 'pine' && (t[3] || 1) > .9));
    if (Array.isArray(OAKS)) for (const t of OAKS) dot(t[1], t[2], 'oak', true);
  }
  function paintTone() {   // an old map: the colours drawn toward sepia, warmed, the paper's grain
    tq.globalCompositeOperation = 'color'; tq.globalAlpha = .55; tq.fillStyle = '#a5875a'; tq.fillRect(0, 0, CW, CH);
    tq.globalCompositeOperation = 'multiply'; tq.globalAlpha = .5; tq.fillStyle = '#f0dcb4'; tq.fillRect(0, 0, CW, CH);
    tq.globalCompositeOperation = 'source-over'; tq.globalAlpha = 1;
  }
  function paintWater() {
    const [lite, dark] = WATER[host.biome?.id] || WATER.ruins;
    const stamp = (x, y, d, c) => { const s = Math.max(1, Math.round(d * MPX)); tq.fillStyle = c; tq.fillRect(Math.round(px(x) - s / 2), Math.round(py(y) - s / 2), s, s); };
    const course = (C, c, grow) => { if (!C?.n) return; for (let i = 0; i < C.n; i += 2) stamp(C.px[i], C.py[i], 2 * C.hw[i] + grow, c); };
    // the Proving Grounds' river (layout.js STREAM), its pool under the fall; the forest's stream and its outflow
    const river = (grow, c) => { tq.fillStyle = c; for (let y = Math.max(STREAM.y0, Y0); y < Math.min(STREAM.y1, Y1); y += 1 / MPX) { const hw = STREAM.w(y) / 2 + grow, cx = STREAM.cx(y); tq.fillRect(Math.round(px(cx - hw)), Math.floor(py(y)), Math.max(1, Math.round(2 * hw * MPX)), 1); } };
    river(.5, dark); course(FOREST?.stream, dark, 1); course(FOREST?.outflow, dark, 1);
    river(0, lite); course(FOREST?.stream, lite, 0); course(FOREST?.outflow, lite, 0);
    if (POOL) blob((x, y) => ((x - POOL.x) / POOL.rx) ** 2 + ((y - POOL.y) / POOL.ry) ** 2 < 1, POOL.x - POOL.rx, POOL.y - POOL.ry, POOL.x + POOL.rx, POOL.y + POOL.ry, lite, dark);
    const L = FOREST?.lake;
    if (L && typeof FOREST.inLake === 'function') blob((x, y) => FOREST.inLake(x, y), L.x - L.rx - 1, L.y - L.ry - 1, L.x + L.rx + 1, L.y + L.ry + 1, lite, dark);
  }
  // still water: a shape test sampled on the map's pixels in its box; the pixels at its edge inked darker
  function blob(test, x0, y0, x1, y1, lite, dark) {
    const a = Math.floor(px(x0)), b = Math.floor(py(y0)), w = Math.ceil(px(x1)) - a, h = Math.ceil(py(y1)) - b;
    if (w <= 0 || h <= 0 || w * h > 40000) return;
    const m = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) m[j * w + i] = test(X0 + (a + i + .5) / MPX, Y0 + (b + j + .5) / MPX) ? 1 : 0;
    for (let pass = 0; pass < 2; pass++) {
      tq.fillStyle = pass ? lite : dark;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = j * w + i; if (!m[k]) continue;
        const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1 || !m[k - 1] || !m[k + 1] || !m[k - w] || !m[k + w];
        if (edge !== !pass) continue;
        tq.fillRect(a + i, b + j, 1, 1);
      }
    }
  }
  function paintFinish() {
    // a dotted grid every 20 m (on the world's own 0), the paper darkening to its edges, an inked border
    tq.fillStyle = 'rgba(40,26,12,.22)';
    for (let x = Math.ceil(X0 / 20) * 20; x < X1; x += 20) { const i = Math.floor(px(x)); for (let j = 0; j < CH; j += 3) tq.fillRect(i, j, 1, 1); }
    for (let y = Math.ceil(Y0 / 20) * 20; y < Y1; y += 20) { const j = Math.floor(py(y)); for (let i = 0; i < CW; i += 3) tq.fillRect(i, j, 1, 1); }
    const g = tq.createRadialGradient(CW / 2, CH / 2, Math.min(CW, CH) * .3, CW / 2, CH / 2, Math.hypot(CW, CH) * .55);
    g.addColorStop(0, 'rgba(60,36,14,0)'); g.addColorStop(1, 'rgba(40,22,8,.55)');
    tq.fillStyle = g; tq.fillRect(0, 0, CW, CH);
    tq.fillStyle = '#3a2a1a'; tq.fillRect(0, 0, CW, 1); tq.fillRect(0, CH - 1, CW, 1); tq.fillRect(0, 0, 1, CH); tq.fillRect(CW - 1, 0, 1, CH);
    painted = true; tcv.style.visibility = ''; waitEl.style.display = 'none';
  }

  // ================================================================ the landmarks
  function addMark(list, name, x, y, key, o = {}) {
    if (!(Number.isFinite(x) && Number.isFinite(y))) return null;
    const m = {name, x, y, key: key || null, el: null, always: !!o.always, vis: false, r: o.r || 0, p: o.p || null};
    if (key && G[key]) { m.el = copyOf(G[key]); m.el.style.display = 'none'; marksEl.appendChild(m.el); }
    list.push(m); return m;
  }
  function buildStaticMarks() {
    addMark(marks, 'Proving Grounds', (PLAY.x0 + PLAY.x1) / 2, (PLAY.y0 + PLAY.y1) / 2, 'arena', {always: true});
    const M = CAVE?.mouth;
    if (M) addMark(marks, 'Cave mouth', M.x + (M.ux || 0) * (M.len || 0) * .6, M.y + (M.uy || 0) * (M.len || 0) * .6, 'cave');
    if (FOREST) {
      const L = FOREST.lake; if (L) addMark(marks, 'the Lake', L.x, L.y, null, {r: Math.max(L.rx, L.ry)});
      const C = FOREST.clearing; if (C) addMark(marks, HUT ? 'the Hut' : 'the Clearing', C.x, C.y, 'hut');
      const F = FOREST.mountain; if (F) addMark(marks, 'the Fell', F.x, F.y, 'peak');
      const B = FOREST.boulders; if (B) addMark(marks, 'Boulder field', B.x, B.y, 'rocks');
      const Mi = FOREST.mire; if (Mi && Number.isFinite(Mi.x)) addMark(marks, 'the Mire', Mi.x, Mi.y, 'mire');
      const pts = FOREST.canyon?.pts; if (pts?.length) { const q = pts[pts.length >> 1]; addMark(marks, 'the Canyon', q[0], q[1], null, {r: 9}); }
    }
    if (FALL) addMark(marks, 'the Waterfall', FALL.x, FALL.y, null, {r: 3});
    if (TOWER) addMark(marks, 'Watchtower', TOWER.x, TOWER.y, 'tower');
  }
  // the yard's campfire and the beacon (features/lights.js puts them there): looked up where they stand (the registry's near),
  // on a show, until found (a few tries: the lights may come after the Book)
  let camp = null;
  function findYard() {
    const E = host.entities; if (!E || typeof E.near !== 'function' || yardTries > 8 || (camp && beacon)) return;
    yardTries++;
    const out = [], find = (x, y, kind) => { E.near(x, y, 2, out); for (const p of out) if (p.kind === kind) return p; return null; };
    if (!camp && (camp = find(50.8, 19.4, 'campfire'))) addMark(marks, 'Campfire', camp.x, camp.y, 'fire');
    if (!beacon && (beacon = find(53.5, 10.15, 'beacon') || find(49.6, 10.35, 'beacon'))) beaconMark = addMark(marks, beacon.unlit ? 'the Beacon (unlit)' : 'the Beacon', beacon.x, beacon.y, beacon.unlit ? 'beacon0' : 'beacon1');
  }
  function setMarkGlyph(m, key) {
    if (!m || m.key === key || !G[key]) return;
    m.key = key; const c = m.el, src = G[key];
    if (c.width !== src.width || c.height !== src.height) { c.width = src.width; c.height = src.height; sizeGlyph(c, src); }
    const q = c.getContext('2d'); q.clearRect(0, 0, c.width, c.height); q.drawImage(src, 0, 0);
    placeMark(m);
  }
  // the dynamic ones (twice a second while open): what was built (features/builds.js F.list, by its ver), the beacon lit
  function refreshDynamic() {
    const B = typeof host.feature === 'function' ? host.feature('builds') : null;
    if (B?.list && B.ver !== buildsVer) {
      buildsVer = B.ver;
      for (const m of builds) m.el?.remove();
      builds.length = 0;
      B.list.forEach(b => { if (b && b.y >= Y0) { const m = addMark(builds, b.def?.name || b.kind || 'something you built', b.x, b.y, BUILD_GLYPH[b.kind] || 'fire'); if (m) { sizeGlyph(m.el, G[m.key]); placeMark(m); } } });
      marksDirty = true;
    }
    if (beacon && beaconMark) {
      const k = beacon.unlit ? 'beacon0' : 'beacon1';
      if (beaconMark.key !== k) { setMarkGlyph(beaconMark, k); beaconMark.name = beacon.unlit ? 'the Beacon (unlit)' : 'the Beacon'; }
    }
    if (pinMark && pin !== pinShown) { pinShown = pin; if (pin) { pinMark.x = pin.x; pinMark.y = pin.y; placeMark(pinMark); } marksDirty = true; }
  }
  function markVis() {
    marksDirty = false;
    const vis = m => { const v = m === pinMark ? !!pin : m.always || seenAt(m.x, m.y); if (v !== m.vis) { m.vis = v; if (m.el) m.el.style.display = v ? '' : 'none'; if (v) placeMark(m); } };
    for (const m of marks) vis(m);
    for (const m of builds) vis(m);
  }
  const scale = () => sc * MPX;   // css px a metre
  function placeMark(m) {
    if (!m.el) return;
    const w = m.el.width * u, h = m.el.height * u;
    m.el.style.transform = `translate(${Math.round((m.x - X0) * scale() - w / 2)}px,${Math.round((m.y - Y0) * scale() - h / 2)}px)`;
  }
  // friends online (features/coop.js: net.peers, each a ring of their latest places); 10 times a second while open
  const peerCb = q => {
    if (!q || !q.n || !q.X) return;
    const L = q.X.length, i = (q.head - 1 + L) % L;
    let x = q.X[i], y = q.Y[i]; if (CAVE && y < Y0) y -= COFF;
    const color = typeof q.color === 'string' && q.color ? q.color : '#7fd0ff';
    let m = peers[peerN];
    if (!m) { m = {name: '', x: 1e9, y: 1e9, el: null, color: '', vis: false}; peers.push(m); }
    peerN++;
    m.name = q.name || 'a friend';
    if (m.color !== color) {
      m.color = color; G['peer' + color] ??= dotGlyph(color);
      const el = copyOf(G['peer' + color]); sizeGlyph(el, el);
      if (m.el) m.el.replaceWith(el); else marksEl.appendChild(el);
      m.el = el; m.x = 1e9;
    }
    if (!m.vis) { m.vis = true; m.el.style.display = ''; }
    if (Math.abs(m.x - x) > .2 || Math.abs(m.y - y) > .2) { m.x = x; m.y = y; placeMark(m); }
  };
  function refreshPeers() {
    const P = typeof host.feature === 'function' ? host.feature('coop')?.net?.peers : null;
    peerN = 0;
    if (P && typeof P.forEach === 'function' && P.size) P.forEach(peerCb);
    for (let i = peerN; i < peers.length; i++) if (peers[i].vis) { peers[i].vis = false; peers[i].el.style.display = 'none'; }
  }

  // ================================================================ the player's marker
  function placeMe(force) {
    const pl = host.player; if (!pl) return;
    let x = pl.x, y = pl.y; if (!(x === x && y === y)) return;
    const under = !!CAVE && y < Y0;
    if (under) y -= COFF;
    const a = pl.faceAngle, oct = Number.isFinite(a) ? Math.round(Math.atan2(Math.sin(a), -Math.cos(a)) / (Math.PI / 4)) & 7 : 4;
    if (oct !== meOct || under !== meUnder) {
      meOct = oct; meUnder = under;
      meQ.clearRect(0, 0, 11, 11); meQ.drawImage(under ? ARROW_U : ARROW, oct * 11, 0, 11, 11, 0, 0, 11, 11);
      meEl.firstChild.style.display = under ? 'none' : '';
      force = true;
    }
    if (!force && Math.abs(x - meX) < .2 && Math.abs(y - meY) < .2) return;
    meX = x; meY = y;
    meEl.style.transform = `translate(${Math.round((x - X0) * scale() - 7.5 * u)}px,${Math.round((y - Y0) * scale() - 7.5 * u)}px)`;
    if (pin && (Math.abs(x - footX) > 1 || Math.abs(y - footY) > 1)) footRight();
  }
  function sizeMe() {
    const r = meEl.firstChild; r.style.width = r.style.height = 15 * u + 'px';
    meCv.style.width = meCv.style.height = 11 * u + 'px'; meCv.style.left = meCv.style.top = 2 * u + 'px';
  }

  // ================================================================ zoom, pan
  function measure() {
    const nu = readU();
    vw = Math.max(1, view.clientWidth); vh = Math.max(1, view.clientHeight);
    if (nu !== u) { u = nu; resizeGlyphs(); }
  }
  function resizeGlyphs() {
    for (const m of marks) if (m.el) sizeGlyph(m.el, m.el);
    for (const m of builds) if (m.el) sizeGlyph(m.el, m.el);
    for (const m of peers) if (m.el) sizeGlyph(m.el, m.el);
    sizeMe();
  }
  function zoomScale(z) {
    const fit = Math.min(vw / CW, vh / CH), s = fit * ZOOMS[z];
    return s >= 2 ? Math.round(s) : s;   // (whole css px a map pixel when it's big: every pixel the same size)
  }
  function clampPan() {
    const w = CW * sc, h = CH * sc;
    tx = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, tx));
    ty = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, ty));
  }
  function applyPan() { clampPan(); pan.style.transform = `translate(${Math.round(tx)}px,${Math.round(ty)}px)`; }
  // a new scale: the canvases' size, every marker's place, the scale bar
  function applyZoom() {
    sc = zoomScale(zi);
    const w = Math.round(CW * sc) + 'px', h = Math.round(CH * sc) + 'px';
    tcv.style.width = fcv.style.width = w; tcv.style.height = fcv.style.height = h;
    for (const m of marks) if (m.vis) placeMark(m);
    for (const m of builds) if (m.vis) placeMark(m);
    for (let i = 0; i < peerN; i++) placeMark(peers[i]);
    placeMe(true); applyPan();
    // the scale bar: a round length 24..60 UI px long
    const mpu = u / scale(); let len = 5;
    for (const L of [5, 10, 20, 25, 50, 100, 200]) { len = L; if (L / mpu >= 24) break; }
    scBar.style.width = Math.round(len / mpu) * u + 'px'; scText.textContent = len + ' m';
  }
  function centreOn(x, y) { tx = vw / 2 - (x - X0) * scale(); ty = vh / 2 - (y - Y0) * scale(); applyPan(); }
  function centreOnMe() {
    const pl = host.player; if (!pl) return;
    let y = pl.y; if (CAVE && y < Y0) y -= COFF;
    centreOn(pl.x, y);
  }
  function local(e) { const r = view.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  const toWorldX = mx => X0 + (mx - tx) / scale(), toWorldY = my => Y0 + (my - ty) / scale();
  function onWheel(e) {
    e.preventDefault(); e.stopPropagation();
    const nz = Math.max(0, Math.min(ZOOMS.length - 1, zi + (e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0)));
    if (nz === zi) return;
    const [mx, my] = local(e), wx = toWorldX(mx), wy = toWorldY(my);
    zi = nz; try { localStorage.setItem(ZKEY, String(zi)); } catch { /* (a convenience only) */ }
    applyZoom(); tx = mx - (wx - X0) * scale(); ty = my - (wy - Y0) * scale(); applyPan();
    hoverAt(mx, my);
  }
  function onDown(e) {
    e.stopPropagation();
    if (e.button !== 0) return;
    dragging = true; dragX = e.clientX; dragY = e.clientY;
    view.classList.add('drag'); view.setPointerCapture?.(e.pointerId);
  }
  function onMove(e) {
    if (dragging) {
      const dx = e.clientX - dragX, dy = e.clientY - dragY; dragX = e.clientX; dragY = e.clientY;
      tx += dx; ty += dy; applyPan();
    }
    const [mx, my] = local(e); hoverAt(mx, my);
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = false; view.classList.remove('drag'); view.releasePointerCapture?.(e.pointerId);
  }
  function onMenu(e) {   // right click: a pin there, or the pin taken up
    e.preventDefault(); e.stopPropagation();
    const [mx, my] = local(e), wx = toWorldX(mx), wy = toWorldY(my);
    if (pin && Math.hypot((pin.x - wx) * scale(), (pin.y - wy) * scale()) < HOVER * u * 1.5) pin = null;
    else if (wx >= X0 && wx <= X1 && wy >= Y0 && wy <= Y1) pin = {x: wx, y: wy};
    else return;
    changed = true; saveT = Math.min(saveT, .5);
    host.uiSound?.('click');
    refreshDynamic(); markVis(); footRight(); hoverAt(mx, my);
  }

  // ================================================================ the footer
  function hoverAt(mx, my) {
    const wx = toWorldX(mx), wy = toWorldY(my), lim = HOVER * u;
    let best = null, bd = lim;
    const test = m => {
      if (!m.vis) return;
      const d = m.el ? Math.hypot((m.x - wx) * scale(), (m.y - wy) * scale()) : Math.hypot(m.x - wx, m.y - wy) <= m.r ? lim * .99 : 1e9;
      if (d < bd) { bd = d; best = m; }
    };
    for (const m of marks) test(m);
    for (const m of builds) test(m);
    for (let i = 0; i < peerN; i++) test(peers[i]);
    if (Math.hypot((meX - wx) * scale(), (meY - wy) * scale()) < lim) { setHover(meUnder ? 'you (in the cave)' : 'you'); return; }
    if (best) { setHover(best === pinMark ? 'your pin (right click: take it up)' : best.name); return; }
    if (wx < X0 || wx > X1 || wy < Y0 || wy > Y1) { setHover(''); return; }
    setHover(seenAt(wx, wy) ? `x ${Math.round(wx)}  y ${Math.round(wy)}` : `unexplored  x ${Math.round(wx)}  y ${Math.round(wy)}`);
  }
  function setHover(t) {
    const s = t || (meUnder ? 'you are in the cave' : 'wheel zoom · drag · right click: pin');
    if (s !== footLText) { footLText = s; footL.textContent = s; }
  }
  function footRight() {
    const ex = `explored ${Math.floor(seenN * 100 / GN)}%`;
    let s = ex;
    if (pin && meX < 1e8) {
      footX = meX; footY = meY;
      const dx = pin.x - meX, dy = pin.y - meY, d = Math.hypot(dx, dy);
      s = (d < 3 ? 'pin: here' : `pin ${Math.round(d)} m ${compass(dx, dy)}`) + ' · ' + ex;
    }
    if (s !== footRText) { footRText = s; footR.innerHTML = s.replace(/(\d+%|\d+ m \w+|here)/g, '<b>$1</b>'); }
  }

  // ================================================================ show / hide / frame
  function show() {
    if (!root) return;
    shown = true;
    if (paintedWorld === undefined || host.world !== paintedWorld) startPaint();
    if (!thr) buildFogTables();
    findYard();
    measure(); resizeGlyphs();
    poll(); refreshDynamic(); refreshPeers();
    if (fogDirty) { fogDirty = false; redrawFog(); }
    marksDirty = true; markVis();
    meOct = -1; applyZoom(); centreOnMe(); needCentre = vw <= 1 || vh <= 1;   // (not laid out yet: centred once it is)
    setHover(''); footRight();
  }
  function hide() {
    shown = false;
    if (dragging) { dragging = false; view?.classList.remove('drag'); }
  }
  function frame() {
    if (!shown || !root) return;
    const now = performance.now();
    if (needCentre) { measure(); if (vw > 1 && vh > 1) { needCentre = false; applyZoom(); centreOnMe(); } }
    if (host.world !== paintedWorld) startPaint();
    if (si < steps.length) runPaint(now);
    if (fogDirty && now - fogAt > 250) { fogAt = now; fogDirty = false; redrawFog(); marksDirty = true; footRight(); }
    if (now - marksAt > 500) { marksAt = now; refreshDynamic(); }
    if (marksDirty) markVis();
    if (now - peersAt > 100) { peersAt = now; refreshPeers(); }
    placeMe(false);
  }

  function reveal(x, y, r = REVEAL) { if (Number.isFinite(x) && Number.isFinite(y)) revealAt(x - X0, y - Y0, Math.max(1, Math.min(200, +r || REVEAL))); }

  return {
    mount: safe(mount, 'mount'), show: safe(show, 'show'), hide: safe(hide, 'hide'), frame: safe(frame, 'frame'),
    update: safe(update, 'update'),
    reveal(x, y, r) { try { reveal(x, y, r); } catch (e) { console.warn('mapview: reveal', e); } },
    get pin() { return pin ? {x: pin.x, y: pin.y} : null; },
    get explored() { return seenN / GN; },
    get painted() { return painted; },
  };
}
