// ASSET LAB: a dev page for the recipes (content/recipes.js, world/recipe3d.js): ?mode=sandbox&lab=1 (or &lab=<recipe>). A row of
// the chosen recipe grown from five seeds stands in front of the player, in the game's own renderer, biome, light and weather,
// turning slowly. The panel (top left) picks the recipe, turns its params on sliders, steps the seeds, stops the turn and moves the
// row to where you stand. It watches content/recipes.js and content/paints.js: save either file and the row is rebuilt from the
// new one within a second (a paint already in the world is repainted at once: world.setFamily; a new paint needs a reload).
// Keys while it shows: [ and ] the recipe, \ new seeds, ' the turn. The biome is the game's (N), the time the game's.
// Scripts (headless captures): the feature is __r3d.features.find(f => f.name === 'lab'): show(name, params?, seed?), spin(on, angle?).
// A FEATURE the boot adds at the end when ?lab is set (main.js; dev/: nothing in the game imports it).
// OWNS: the panel (#assetlab + its style), its row's meshes (host.world.mesh: a rebuild disposes them, biomeChanged grows them again).
// READS: host.player, host.elev, host.biome, host.world.  BUDGET: the turn sets 5 matrices a frame; the watch one fetch a second.
import * as THREE from 'three';
import {RECIPES} from '../content/recipes.js';
import {setRecipes, recipeList, recipeOf, recipeParams, recipeGeo} from '../world/recipe3d.js';
import {FAMS} from '../world/world.js';
import {hex01} from '../core/color.js';
import {flags} from '../core/flags.js';

const COUNT = 5, SPIN = .35;   // rad / s
const CSS = `
#assetlab { position: fixed; left: 10px; top: 64px; z-index: 15; width: 270px; padding: 8px 8px 6px; background: rgba(14, 16, 15, .93);
  border: 1px solid var(--line, #444); border-radius: 6px; user-select: none; color: var(--ink, #ddd); font: 12px/1.35 system-ui, sans-serif; }
body:has(#pause:not(.hidden)) #assetlab { visibility: hidden; }
#assetlab header { display: flex; justify-content: space-between; align-items: baseline; padding: 0 2px 4px; }
#assetlab header b { color: var(--key, #f0c060); letter-spacing: .14em; }
#assetlab header small { color: var(--dim, #888); }
#assetlab select, #assetlab button { font: inherit; color: inherit; background: rgba(255, 255, 255, .06); border: 1px solid var(--line, #444); border-radius: 4px; }
#assetlab select { width: 100%; padding: 2px; }
#assetlab .about { margin: 5px 2px 4px; color: var(--dim, #999); }
#assetlab label { display: block; padding: 2px 2px 0; }
#assetlab label span { float: right; color: var(--key, #f0c060); }
#assetlab input[type=range] { width: 100%; margin: 0; accent-color: #f0c060; }
#assetlab .row { display: flex; gap: 4px; margin-top: 6px; }
#assetlab .row button { flex: 1; padding: 2px 4px; cursor: pointer; }
#assetlab .row button:hover { border-color: var(--key, #f0c060); }
#assetlab .note { margin-top: 5px; color: var(--dim, #888); font-size: 11px; }`;

export async function createLab({host}) {
  setRecipes(RECIPES);
  const want = flags.get('lab');
  const S = {name: recipeOf(want) ? want : recipeList()[0], params: {}, seed: 0, spin: true, angle: 0, x: 0, y: 0, rx: 1, ry: 0, placed: false, ver: 0};
  S.params = recipeParams(S.name);
  const items = [], M = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), P3 = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);

  // ---------------------------------------------------------------- the row
  function clear() { for (const it of items) it.mesh?.dispose(); items.length = 0; }
  function pose(it) {
    Q.setFromAxisAngle(UP, S.angle + it.yaw); P3.set(it.x, it.h, it.y); M.compose(P3, Q, ONE); it.mesh.setMatrix(M);
  }
  function grow() {
    clear();
    if (!S.placed) {   // in front of the player, the row across the screen (whatever the camera's yaw)
      const px = host.player.x, py = host.player.y, o = host.toView(px, py), ex = host.toView(px + 1, py), ey = host.toView(px, py + 1);
      const a = ex[0] - o[0], c = ex[1] - o[1], bb = ey[0] - o[0], d = ey[1] - o[1], det = a * d - bb * c || 1;
      const rx = d / det, ry = -c / det, fx = bb / det, fy = -a / det, rl = Math.hypot(rx, ry) || 1, fl = Math.hypot(fx, fy) || 1;   // screen right / up in world
      S.rx = rx / rl; S.ry = ry / rl; S.x = px + fx / fl * 2.4; S.y = py + fy / fl * 2.4; S.placed = true;
    }
    const biome = host.biome?.id || 'ruins', made = [];
    for (let i = 0; i < COUNT; i++) made.push(recipeGeo(S.name, S.seed + i, S.params, biome));
    const gap = Math.max(.9, ...made.map(m => m ? m.r * 2 + .5 : 0));
    made.forEach((m, i) => {
      if (!m) return;
      const k = (i - (COUNT - 1) / 2) * gap, x = S.x + S.rx * k, y = S.y + S.ry * k, it = {x, y, h: host.elev(x, y), yaw: i * 1.3};
      M.makeTranslation(x, it.h, y); it.mesh = host.world.mesh(m.geo, M, {}); pose(it); items.push(it);
    });
    S.ver++; draw();
  }

  // ---------------------------------------------------------------- watching the files
  const src = {recipes: '', paints: ''};
  let watchT = 0, watching = false, reloads = 0;
  async function check() {
    if (watching) return; watching = true;
    try {
      const [r, p] = await Promise.all(['../content/recipes.js', '../content/paints.js'].map(u => fetch(new URL(u, import.meta.url), {cache: 'no-store'}).then(x => x.text())));
      const first = !src.recipes; if (first) { src.recipes = r; src.paints = p; return; }
      if (p !== src.paints) {
        src.paints = p; const m = await import(new URL('../content/paints.js?v=' + (++reloads), import.meta.url).href);
        for (const k in m.PAINTS) if (FAMS.includes(k)) host.world.setFamily(k, (m.PAINTS[k][host.biome?.id] || m.PAINTS[k].all).map(hex01));
        note('paints reloaded' + (Object.keys(m.PAINTS).some(k => !FAMS.includes(k)) ? ' (a new paint shows after a page reload)' : ''));
      }
      if (r !== src.recipes) {
        src.recipes = r; const m = await import(new URL('../content/recipes.js?v=' + (++reloads), import.meta.url).href);
        setRecipes(m.RECIPES); if (!recipeOf(S.name)) S.name = recipeList()[0];
        const d = recipeParams(S.name); for (const k in d) if (!(k in S.params)) S.params[k] = d[k];
        for (const k in S.params) if (!(k in d)) delete S.params[k];
        build(); grow(); note('recipes reloaded');
      }
    } catch (e) { note('reload failed: ' + e.message); console.warn('lab', e); } finally { watching = false; }
  }

  // ---------------------------------------------------------------- the panel
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'assetlab'; document.body.appendChild(root);
  root.addEventListener('mousedown', e => { e.stopPropagation(); if (!['INPUT', 'SELECT'].includes(e.target.tagName)) e.preventDefault(); });
  root.addEventListener('pointerdown', e => e.stopPropagation()); root.addEventListener('wheel', e => e.stopPropagation());
  let noteEl = null, noteT = 0;
  const note = t => { if (noteEl) { noteEl.textContent = t; noteT = 3; } };
  function build() {
    const R = recipeOf(S.name);
    root.innerHTML = `<header><b>ASSET LAB</b><small>seeds ${S.seed}-${S.seed + COUNT - 1}</small></header>
      <select>${recipeList().map(n => `<option${n === S.name ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <div class="about">${R?.about || ''}</div>
      ${Object.entries(R?.params || {}).map(([k, [, lo, hi]]) => `<label data-k="${k}">${k} <span></span><input type="range" min="${lo}" max="${hi}"
        step="${[lo, hi, R.params[k][0]].every(Number.isInteger) ? 1 : (hi - lo) / 100}" value="${S.params[k]}"></label>`).join('')}
      <div class="row"><button data-a="prev">&#9664; seeds</button><button data-a="next">seeds &#9654;</button></div>
      <div class="row"><button data-a="spin">${S.spin ? 'stop turning' : 'turn'}</button><button data-a="here">move here</button><button data-a="reset">reset</button></div>
      <div class="note">[ ] recipe · \\ seeds · ' turn · N biome. Save content/recipes.js and it reloads.</div><div class="note" id="labnote"></div>`;
    noteEl = root.querySelector('#labnote');
    root.querySelector('select').onchange = e => { S.name = e.target.value; S.params = recipeParams(S.name); build(); grow(); };
    root.querySelectorAll('label').forEach(l => {
      const k = l.dataset.k, inp = l.querySelector('input'), sp = l.querySelector('span');
      sp.textContent = fmt(S.params[k]);
      inp.oninput = () => { S.params[k] = +inp.value; sp.textContent = fmt(S.params[k]); grow(); };
    });
    root.querySelectorAll('button').forEach(b => b.onclick = () => act(b.dataset.a));
  }
  const fmt = v => Number.isInteger(v) ? String(v) : v.toFixed(2);
  function draw() { const s = root.querySelector('header small'); if (s) s.textContent = `seeds ${S.seed}-${S.seed + COUNT - 1}`; }
  function act(a) {
    if (a === 'prev') { S.seed = Math.max(0, S.seed - COUNT); grow(); }
    else if (a === 'next') { S.seed += COUNT; grow(); }
    else if (a === 'spin') { S.spin = !S.spin; build(); }
    else if (a === 'here') { S.placed = false; grow(); }
    else if (a === 'reset') { S.params = recipeParams(S.name); S.seed = 0; build(); grow(); }
  }
  function step(d) { const L = recipeList(), i = (L.indexOf(S.name) + d + L.length) % L.length; S.name = L[i]; S.params = recipeParams(S.name); build(); grow(); }

  build();
  const F = {
    name: 'lab', on: true, always: true, ambient: true,
    frame(f) {
      if (!items.length && host.world) grow();
      if (S.spin) { S.angle += f.dt * SPIN; for (const it of items) pose(it); }
      if ((watchT -= f.dt) <= 0) { watchT = 1; check(); }
      if (noteT > 0 && (noteT -= f.dt) <= 0 && noteEl) noteEl.textContent = '';
    },
    biomeChanged() { items.length = 0; grow(); },   // (the rebuild disposed the old meshes)
    onKey(k) {
      if (k === '[') { step(-1); return true; } if (k === ']') { step(1); return true; }
      if (k === '\\') { S.seed += COUNT; grow(); return true; } if (k === "'") { act('spin'); return true; }
      return false;
    },
    // (scripts) show a recipe, its params (merged over the defaults) and the first seed; spin(on, angle)
    show(name, params = null, seed = 0) { if (!recipeOf(name)) return false; S.name = name; S.params = {...recipeParams(name), ...(params || {})}; S.seed = seed; build(); grow(); return true; },
    spin(on, angle) { S.spin = !!on; if (angle !== undefined) S.angle = angle; for (const it of items) pose(it); build(); },
    place(x, y, rx = 1, ry = 0) { S.x = x; S.y = y; S.rx = rx; S.ry = ry; S.placed = true; grow(); },
    get state() { return {name: S.name, params: {...S.params}, seed: S.seed, n: items.length, ver: S.ver}; },
    dispose() { clear(); root.remove(); style.remove(); },
  };
  return F;
}
