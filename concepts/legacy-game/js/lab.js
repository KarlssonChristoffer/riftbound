// Character lab: character concepts side by side in a real room, drawn by the game's own pixel pipeline.
// lab.html?set=real (default) | bb | v4 | v3 | block | grey | base | rift | ranger. Toy sets list {name, tag, build(P)}; the real set lists modelled characters.
import {THREE, G, V, camera, render, newScene, place, VIEW_H} from './core.js';
import {floorAndWalls, PAL, updateTorches} from './biomes.js';
import {toyFrom, toyDriver} from './toys.js';
import {RANGERS, RIFT, makeBow, drawAmount} from './lab_rangers.js';
import {baseBody, wear, OUTFITS} from './body.js';
import {loadAssets, modelRig, makeDriver, driveUpdate, dplay, PROPS} from './assets.js';
import {gfx} from './pixel.js';
import {CS} from './map.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// round 4: base body styles (proportions); every figure wears the same outfits, Swap outfit cycles them
const dressed = (style, outfits) => P => {
  const B = baseBody(P, {style}); B.P = P; B.outfits = outfits; B.oi = 0; wear(B, P, OUTFITS[outfits[0]]);
  const b = makeBow(B, P, {len: B.designH * .72, thick: .06, recurve: true, wood: '#8a5a34', grip: '#2a1a10', string: '#d8d0c0', tips: '#d8cdb8'});
  B.tick = D => { b.follow(); b.set(drawAmount(D), B.points.R_Hand.getWorldPosition(V())); };
  return B;
};
const LOOKS = ['adventurer', 'traveler', 'mercenary'];
const BASE = [
  {name: 'Chibi', tag: '3 heads tall: big head and face, short limbs', build: dressed('chibi', LOOKS)},
  {name: 'Stylized hero', tag: 'About 4.5 heads: broad shoulders, big hands and boots', build: dressed('hero', LOOKS)},
  {name: 'Lean', tag: 'About 5.5 heads: longer limbs, still thick enough to read', build: dressed('lean', LOOKS)},
];
// round 5: t3ssel8r's method. A modelled character on a real rig (outfits are separate meshes on the same skeleton),
// real animation clips played as held poses at 12 fps, a 45 degree / 30 degree camera, 360 rows, toon light and outlines.
const REAL = [
  {model: 'ranger', name: 'Base + ranger outfit', tag: 'Quaternius CC0 base body with the ranger outfit bound to its skeleton'},
  {model: 'voidblade', name: 'Other base, same outfit', tag: 'Female base wearing the same outfit, recoloured'},
  {model: 'qMale', name: 'Bare base body', tag: 'The body outfits are fitted onto'},
];
// round 6: the Blender pipeline. Checkpoint 1 is a grey blockout (tools/blender/ranger_grey.py), no rig or colour,
// shown in 8 facings at the game's size (~50 px tall at 270 rows) under the 45 degree / 30 degree camera.
const FACINGS = ['Front', 'Front right', 'Right', 'Back right', 'Back', 'Back left', 'Left', 'Front left'];
const GREY = FACINGS.map((name, k) => ({name, tag: `${k * 45}°`, face: k * Math.PI / 4}));
// round 7: grey v2 (tools/blender/ranger_block.py), authored planar blocks in three clay values (hood, body, legs)
// round 8: v3 (tools/blender/ranger_v3.py), three separate masses: forward-facing hood, wide asymmetric upper body, split legs
// round 9: v4 (tools/blender/ranger_v4.py), the chibi proportions designed in colour; &rows= compares pixel chunkiness
// round 10: Blockbench (tools/blockbench/ranger_bb.py -> assets/src/ranger.bbmodel -> bb2glb.py), cubes with a painted pixel texture
const SETS = {
  bb: {grey: 'chars/ranger_bb.glb', list: GREY, spacing: 1.4, back: 3, detail: .35, face: 0,
    cam: {yaw: Math.PI / 4, pitch: Math.PI / 6, viewH: 10}, gfx: {rows: 180}},
  v4: {grey: 'chars/ranger_v4.glb', list: GREY, spacing: 1.4, back: 3, detail: .35, face: 0,
    cam: {yaw: Math.PI / 4, pitch: Math.PI / 6, viewH: 10}, gfx: {rows: 270}},
  v3: {grey: 'chars/ranger_v3.glb', list: GREY, spacing: 1.4, back: 3, detail: .35, face: 0,
    cam: {yaw: Math.PI / 4, pitch: Math.PI / 6, viewH: 10}, gfx: {rows: 270}},
  block: {grey: 'chars/ranger_block.glb', list: GREY, spacing: 1.4, back: 3, detail: .35, face: 0,
    cam: {yaw: Math.PI / 4, pitch: Math.PI / 6, viewH: 10}, gfx: {rows: 270}},
  grey: {grey: 'chars/ranger_grey.glb', list: GREY, spacing: 1.4, back: 3, detail: .35, face: 0,
    cam: {yaw: Math.PI / 4, pitch: Math.PI / 6, viewH: 10}, gfx: {rows: 270}},
  real: {real: REAL, want: ['qMale', 'qFemale', 'qRangerM', 'qRangerF'], height: 1.85, spacing: 2.3, detail: .35,
    cam: {yaw: Math.PI / 4, pitch: Math.PI / 6, viewH: 8}, gfx: {rows: 360, light: 'toon', steps: 3}, stepped: 12},
  base: {list: BASE, height: 1.95, spacing: 2.8, detail: .35},
  rift: {list: RIFT, height: 2.05, spacing: 3.4, detail: .35}, // round 2: one direction, a bit taller, calmer floor
  ranger: {list: RANGERS, height: 1.85, spacing: 2.8, detail: 1}, // round 1: four concepts
};
const S = SETS[new URLSearchParams(location.search).get('set')] || SETS.real;
const CAM = {yaw: 0, pitch: Math.atan2(13.7, 9.5), viewH: VIEW_H, ...S.cam};
const qs = new URLSearchParams(location.search); if (qs.get('viewH')) CAM.viewH = +qs.get('viewH'); // e.g. 13.8 = the game's zoom
if (S.gfx) Object.assign(gfx, S.gfx); // for this page only, not saved
if (new URLSearchParams(location.search).get('rows')) gfx.rows = +new URLSearchParams(location.search).get('rows');
if (S.real) await loadAssets(null, S.want);
const greyModel = S.grey && (await new GLTFLoader().loadAsync('../../assets/' + S.grey)).scene;

// a small ruins room with the game's floor, walls and torches
const scene = newScene();
scene.background = new THREE.Color(0x2a3a24); scene.fog = new THREE.Fog(0x2a3a24, 26, 60);
scene.add(new THREE.HemisphereLight(0xf0f4e0, 0x3f5a2a, 1));
const sun = new THREE.DirectionalLight(0xfff0c8, 2.2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 60}); sun.shadow.bias = -.0004; sun.shadow.normalBias = .03;
const W = 12, H = 8, room = {W, H, floor: (i, j) => i >= 1 && i <= W - 2 && j >= 1 && j <= H - 2};
floorAndWalls(scene, room, {...PAL.ruins, detail: S.detail}, 2.4);
const cx = W * CS / 2, cz = H * CS / 2 + .6, center = V(cx, 0, cz);
sun.position.set(cx + 10, 16, cz + 6); sun.target.position.copy(center); scene.add(sun, sun.target);

// characters: toys (built in code) or modelled characters; both get update(dt) and play(clip)
const right = V(Math.cos(CAM.yaw), 0, -Math.sin(CAM.yaw)), toward = V(Math.sin(CAM.yaw), 0, Math.cos(CAM.yaw));
const world = document.getElementById('world'), list = S.real || S.list;
const chars = list.map((v, k) => {
  let root, update, play, B = null;
  if (S.grey) { // static blockout: no rig yet, just the modelled mesh in real game units
    root = new THREE.Group(); const m = greyModel.clone(true); root.add(m);
    m.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    update = () => {}; play = () => {};
  } else if (S.real) {
    const m = modelRig(v.model, S.height, true), drv = makeDriver(m.rig, 'idle', 'run', true), prop = PROPS[v.model] && PROPS[v.model](m);
    const ent = {g: m.root, rig: m.rig, drv, moving: false, runSpeed: 1.1, legYaw: 0};
    root = m.root; update = (dt, t, moving) => { ent.moving = moving; driveUpdate(ent, dt); if (prop) prop(ent, t, dt); }; play = c => dplay(drv, c, true, 1);
  } else {
    const m = toyFrom(v.build, S.height, S.designH), D = toyDriver(m.rig), ent = {moving: false, legYaw: 0};
    root = m.root; B = m.rig.B; update = (dt, t, moving) => { ent.moving = moving; D.update(ent, dt); }; play = c => D.play(c, true, 1);
  }
  root.position.copy(center).addScaledVector(right, (k - (list.length - 1) / 2) * S.spacing).addScaledVector(toward, -(S.back || 0)); scene.add(root);
  const el = document.createElement('div'); el.className = 'lbl'; el.innerHTML = `<b>${k + 1}. ${v.name}</b><small>${v.tag}</small>`; world.appendChild(el);
  return {root, update, play, B, el, next: .4 + k * .25, acc: 0, face0: v.face || 0};
});

// controls
let mode = S.grey ? 'idle' : 'demo', turn = false, zoom = false, stepped = !!S.stepped, clock = 0, face = S.face ?? -.55; // three-quarter view, bow side toward the camera
const bar = document.getElementById('bar'), $ = id => document.getElementById(id);
const sync = () => {
  bar.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));
  $('turn').setAttribute('aria-pressed', turn); $('zoom').setAttribute('aria-pressed', zoom); $('stepped').setAttribute('aria-pressed', stepped);
};
bar.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; clock = 0; sync(); });
$('turn').onclick = () => { turn = !turn; sync(); };
$('zoom').onclick = () => { zoom = !zoom; sync(); };
$('stepped').hidden = !S.stepped; $('stepped').onclick = () => { stepped = !stepped; sync(); };
const dressable = chars.filter(c => c.B && (c.B.outfits || []).length > 1);
$('outfit').hidden = !dressable.length;
$('outfit').onclick = () => { for (const c of dressable) { const B = c.B; B.oi = (B.oi + 1) % B.outfits.length; wear(B, B.P, OUTFITS[B.outfits[B.oi]]); } };
sync();

function step(dt) {
  clock += dt;
  const phase = mode === 'demo' ? ['idle', 'run', 'shoot'][Math.floor(clock / 3) % 3] : mode, rest = CAM.yaw + face;
  for (const c of chars) {
    if (phase === 'shoot' && (c.next -= dt) <= 0) { c.play('bow'); c.next = 1.6; }
    const r = c.root.rotation, want = rest + c.face0; r.y = turn ? r.y + dt * .8 : want + (r.y - want) * Math.exp(-dt * 6);
    // held poses: the animation only advances in 1/12 s steps, like hand-drawn frames
    c.acc += dt; if (!stepped || c.acc >= 1 / S.stepped) { c.update(c.acc, clock, phase === 'run'); c.acc = 0; }
    place(c.el, c.root.position.clone().addScaledVector(toward, .7));
  }
  updateTorches(center, dt, clock);
  const h = zoom ? CAM.viewH / 2 : CAM.viewH, d = 30, t = V(cx, .8, cz);
  camera.top = h / 2; camera.bottom = -h / 2; camera.right = camera.top * innerWidth / innerHeight; camera.left = -camera.right; camera.updateProjectionMatrix();
  camera.position.set(t.x + Math.sin(CAM.yaw) * Math.cos(CAM.pitch) * d, t.y + Math.sin(CAM.pitch) * d, t.z + Math.cos(CAM.yaw) * Math.cos(CAM.pitch) * d); camera.lookAt(t);
  render();
}
let last = performance.now();
(function loop(now) { requestAnimationFrame(loop); step(Math.min(.05, (now - last) / 1000)); last = now; })(last);

// contact sheet: one column per character, one row per view; each row is set up, played for a few frames and cropped
// shooting rows face sideways (aiming across the screen), where the drawn bow's silhouette matters most
const ROWS = [['In game', 'idle', false, 60, -.55], ['In game: shooting', 'shoot', false, 33, -Math.PI / 2], ['Close-up', 'idle', true, 40, -.55],
  ['Shooting', 'shoot', true, 33, -Math.PI / 2], ['Running', 'run', true, 22, -.55], ['Back', 'idle', true, 90, Math.PI - .4]];
function sheet(rows = ROWS) {
  const src = $('c'), k = src.width / innerWidth, TW = 360, TH = 300, f = VIEW_H / CAM.viewH;
  const o = document.createElement('canvas'); o.width = 190 + TW * chars.length; o.height = 70 + TH * rows.length; const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
  g.fillStyle = '#15121a'; g.fillRect(0, 0, o.width, o.height);
  g.font = '700 24px Cinzel, serif'; g.fillStyle = '#e8f4d0'; g.textAlign = 'center';
  chars.forEach((c, i) => g.fillText(c.el.querySelector('b').textContent, 190 + TW * i + TW / 2, 44));
  const keep = {mode, zoom, turn, face}; turn = false;
  rows.forEach(([name, m, z, frames, fc], r) => {
    mode = m; zoom = z; face = fc; clock = 0; chars.forEach((c, i) => { c.next = .1 + i * .02; });
    for (let i = 0; i < 25; i++) step(1 / 60); chars.forEach((c, i) => { c.next = .02 + i * .02; }); for (let i = 0; i < frames; i++) step(1 / 60); // settle the facing, then play
    const s = z ? 2 : 1, cw = 250 * s * f, ch = cw * TH / TW;
    chars.forEach((c, i) => { const x = parseFloat(c.el.style.left), y = parseFloat(c.el.style.top); g.drawImage(src, (x - cw / 2) * k, (y - ch - 12 * s * f) * k, cw * k, ch * k, 190 + TW * i + 6, 60 + TH * r + 6, TW - 12, TH - 12); });
    g.textAlign = 'left'; g.font = '700 18px Inter, sans-serif'; g.fillStyle = '#cfc6b8'; g.fillText(name, 14, 60 + TH * r + TH / 2);
  });
  ({mode, zoom, turn, face} = keep); sync();
  return o;
}
// on-screen height of each character in game pixels (render rows), from its projected bounding box
function px() {
  return chars.map(c => {
    const b = new THREE.Box3().setFromObject(c.root, true), ys = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) ys.push(V(x, y, z).project(camera).y);
    return Math.round((Math.max(...ys) - Math.min(...ys)) / 2 * gfx.rows);
  });
}
// one tile per character, cropped around its projected bounds (canvas pixels), for pixel-exact contact sheets
function tiles(pad = 10) {
  for (let i = 0; i < 120; i++) step(1 / 60); // settle facings even when the tab isn't animating
  const src = $('c'), k = src.width / innerWidth;
  return chars.map(c => {
    const b = new THREE.Box3().setFromObject(c.root, true), xs = [], ys = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const p = V(x, y, z).project(camera); xs.push(p.x); ys.push(p.y); }
    const X = v => (v + 1) / 2 * src.width, Y = v => (1 - v) / 2 * src.height;
    return [Math.floor(X(Math.min(...xs)) - pad * k), Math.floor(Y(Math.max(...ys)) - pad * k), Math.ceil(X(Math.max(...xs)) + pad * k), Math.ceil(Y(Math.min(...ys)) + pad * k)];
  });
}
window.__lab = {chars, step, sheet, px, tiles, G, face: a => { face = a; }};
