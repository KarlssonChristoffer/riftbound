// PHOTO MODE (F4, or the menu's Game tab): the game stands still and the camera is yours. The HD-2D look is made for
// this: a pixel world in real 3D, free yaw, the clock's light, and a tilt-shift on top.
//   FROZEN    the sim stands still as in the pause menu (the run, foes, arrows, the player, the world clock). "Living
//             world" on: nature goes on as behind the menu (the features declaring F.ambient: wind, wildlife, weather,
//             fire, the cloak); off: everything still, the shaders' clocks too (gfx.js setPost .still). A change of the
//             world in a still world lets nature run SETTLE s first, so rain starts falling and the ground follows.
//   CAMERA    WASD move (Shift faster), Z / X or Q / E turn (the game's free yaw), the wheel or + / - zoom (its pixel-perfect
//             levels), drag the world to move it, drag with the right or middle button to turn, R back to the player.
//             The view's ground stays inside the world (render/camera.js FREE). Esc / F4 leaves: the camera, the yaw, the
//             zoom and the player's view-frame state come back exactly as they were (sim/player/adapter.js hold / release).
//   WORLD     time of day, the point of the year (the ruins' seasons), weather, wind: shown through the world clock's own
//             preview (sim/env.js preview): the truth is never touched, and leaving puts every reading back as it was.
//   LOOK      tilt-shift (the focus band's place and width, the blur), vignette, colour grade: render/photofx.js on the GPU.
//   SCENE     the player shown or hidden, the live hero's emotes (view/livehero.js K.demo), the HUD shown or hidden (the
//             photo never has it: it's the WebGL image alone).
//   PHOTO     P / Enter (or the button): a PNG at 1x (the screen) or 2x, rendered again at that size (the art blown up by
//             whole pixels, crisp; the soft effects at full size), downloaded as riftbound_YYYYMMDD_HHMMSS.png.
// H / Tab hides the panel. Keys: arrows walk the panel (up / down a row, left / right its value), Enter / Space press.
// STUDIO: toggle(true, studio) opens it as another screen's stage (the dev wardrobe, dev/wardrobe.js): the same frozen game
//   and camera, without photo mode's panel and hint, the world living (ambient views run: the gear's look follows), a left
//   drag turns and a right drag moves. studio = {key(k, e) -> bool (its keys first), step(dt) (every frame), closed()}.
// OWNS: open, the #photo DOM + its style, the remembered settings ('rb.photo'), the free camera's input, the world it asks
//   env to preview, the look (render/photofx.js). READS: E (main.js). EMITS: nothing.
// BUDGET: nothing while closed (the loop asks `open`); open: the post pass (render/photofx.js) and the ambient views.
//   const photo = createPhoto(E); photo.open / toggle(on) / step(dt) (the loop) / time(t) / key(k, e) (core/input.js) /
//   capture(scale) -> {w, h, data} / shoot() -> Promise<{name, w, h, blob}>
import {createPhotoFx, GRADES} from '../render/photofx.js';
import {SEASONS} from '../sim/env.js';
import {ROT_SPEED} from '../render/camera.js';

const WEATHERS = ['as is', 'clear', 'fair', 'cloudy', 'overcast', 'fog', 'windy', 'rain', 'storm', 'snow', 'blizzard', 'haze'];
const WINDS = {'as is': null, calm: .35, breeze: 1, brisk: 2.1, gale: 3};   // (features/wind.js LEVELS)
const TUNE = {move: .55, fast: 3, settle: .9, turnDrag: -.006};   // move: view widths per second (Shift x fast); settle: s of nature after a change in a still world
const STORE = 'rb.photo', TILT_ROWS = new Set(['Focus', 'Focus width', 'Blur']);
const pad = n => String(n).padStart(2, '0');
export const photoName = (d = new Date()) => `riftbound_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
const clockOf = h => { const m = Math.round(((h % 24) + 24) % 24 * 60) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const yearOf = y => { const s = SEASONS[Math.floor(((y % 4) + 4) % 4)], f = ((y % 1) + 1) % 1; return f < .3 ? 'early ' + s : f > .7 ? 'late ' + s : s; };
const pct = v => Math.round(v * 100) + '%';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

const CSS = `
#photo { position: fixed; inset: 0; z-index: 20; color: #fff; font: 14px/1.4 "Segoe UI", system-ui, sans-serif; text-shadow: 0 1px 3px rgba(0, 0, 0, .7);
  cursor: grab; user-select: none; animation: m-fade .2s ease-out; }
#photo.panning { cursor: grabbing; } #photo.turning { cursor: ew-resize; }
#ph-panel { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); width: 290px; max-height: calc(100% - 90px); display: flex; flex-direction: column;
  padding: 10px 4px 10px; box-sizing: border-box; background: rgba(0, 0, 0, .34); border-radius: 8px; cursor: default; }
#ph-panel header { display: flex; align-items: baseline; justify-content: space-between; padding: 0 10px 2px; }
.ph-title { font-size: 17px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; }
#ph-panel .m-close { position: static; }
#ph-panel .m-body h4 { margin: 10px 10px 1px; }
#ph-panel .m-row { padding: 3px 10px; }
#ph-panel .m-row.off { opacity: .35; pointer-events: none; }
#ph-panel .m-act { padding: 6px 10px; font-size: 16px; }
.ph-sl input { -webkit-appearance: none; appearance: none; flex: 1; min-width: 60px; height: 2px; margin: 0 2px 0 8px; background: rgba(255, 255, 255, .35); outline: none; cursor: pointer; }
.ph-sl input::-webkit-slider-thumb { -webkit-appearance: none; width: 11px; height: 11px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .6); }
.ph-sl input::-moz-range-thumb { width: 11px; height: 11px; border: 0; border-radius: 50%; background: #fff; }
.ph-sl .m-val { min-width: 74px; justify-content: flex-end; }
.ph-note { min-height: 1.4em; padding: 4px 10px 0; font-size: 12px; opacity: .7; text-align: center; }
.ph-hint { position: absolute; left: 0; right: 0; bottom: 14px; text-align: center; font-size: 12px; opacity: .55; pointer-events: none; }
.ph-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
.ph-flash.go { animation: ph-flash .4s ease-out; }
@keyframes ph-flash { from { opacity: .6; } to { opacity: 0; } }
.ph-band { position: absolute; left: 0; right: 0; border-top: 1px dashed rgba(255, 255, 255, .6); pointer-events: none; opacity: 0; transition: opacity .5s; }
.ph-band.on { opacity: 1; transition: none; }
#photo.ph-clean #ph-panel, #photo.ph-clean .ph-hint, #photo.ph-studio #ph-panel, #photo.ph-studio .ph-hint { display: none; }
body.photo :is(#hud, #help, #cheats, #gscreen) { visibility: hidden; }
body.photo.ph-nohud #hd { visibility: hidden; }
`;

export function createPhoto(E) {
  const {G, cv, pa, env, keys, host, feat} = E;
  const fx = createPhotoFx(G), L = fx.P;
  const sound = n => host.uiSound?.(n);
  let open = false, living = true, settle = 0, heldT = 0, showHud = false, showPlayer = true, pose = 'none', size = 1, busy = false, noteT = 0, panelT = 0;
  const want = {hour: null, year: null, weather: null, wind: null};
  let wantDirty = false, seasonal = false;
  const at = {yaw: 0, goal: 1, demo: '', weather: ''};   // what leaving comes back to (and the world's "as is")
  const held = new Set(), FA = {x: 0, y: 0, h: 0};
  let drag = null, dragYaw = 0, panX = 0, panY = 0, studio = null, look0 = null;   // (look0: photo mode's own look while a studio has a plain one)

  // ---- remembered settings (this machine): the look, the living world, the size
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s) { for (const k of Object.keys(L)) if (typeof s[k] === typeof L[k]) L[k] = s[k]; if (!GRADES[L.grade]) L.grade = 'natural'; if (typeof s.living === 'boolean') living = s.living; if (s.size === 2) size = 2; }
  } catch (e) {}
  const remember = () => { try { localStorage.setItem(STORE, JSON.stringify({...L, living, size})); } catch (e) {} };

  // ---- the world: what to preview (null = as it is), asked of the clock once a frame at most (step)
  function setWant(k, v) { if (want[k] === v) return; want[k] = v; wantDirty = true; if (!living) settle = TUNE.settle; }
  function applyWant() {
    wantDirty = false;
    const any = want.hour !== null || want.year !== null || want.weather !== null || want.wind !== null;
    env.preview(any ? {...want} : null);
  }
  function asItIs() { for (const k in want) setWant(k, null); }
  // ---- the scene
  const live = () => E.live?.on ? E.live : null;
  function setPose(v) {
    pose = v; const lv = live(); if (!lv) return;
    lv.set({demo: v === 'none' ? at.demo : v});
  }

  // ---- the panel's rows: {label, group?} | switch {sw, set} | slider {min, max, step, get, set, fmt} | choice {options, get, set, fmt} | action {act}
  const ROWS = [
    {group: 'World'},
    {label: 'Living world', sw: () => living, set: v => { living = v; settle = 0; remember(); }},
    {label: 'Time of day', min: 0, max: 24, step: .25, get: () => want.hour ?? env.hour, set: v => setWant('hour', v % 24), fmt: clockOf},
    {label: 'Season', when: () => seasonal, min: 0, max: 3.99, step: 1 / 12, get: () => want.year ?? env.year, set: v => setWant('year', v), fmt: yearOf},
    {label: 'Weather', options: WEATHERS, get: () => want.weather ?? 'as is', set: v => setWant('weather', v === 'as is' ? null : v), fmt: v => v === 'as is' ? `as is (${at.weather})` : v},
    {label: 'Wind', options: Object.keys(WINDS), get: () => Object.keys(WINDS).find(k => WINDS[k] === want.wind) || 'as is', set: v => setWant('wind', WINDS[v])},
    {label: 'As it is now', act: asItIs},
    {group: 'Look'},
    {label: 'Tilt-shift', sw: () => L.tilt, set: v => { L.tilt = v; }},
    {label: 'Focus', min: 0, max: 1, step: .01, get: () => L.focus, set: v => { L.focus = v; band(); }, fmt: v => v < .4 ? 'high' : v > .6 ? 'low' : 'middle'},
    {label: 'Focus width', min: .04, max: .9, step: .01, get: () => L.width, set: v => { L.width = v; band(); }, fmt: pct},
    {label: 'Blur', min: 0, max: 1, step: .01, get: () => L.blur, set: v => { L.blur = v; }, fmt: pct},
    {label: 'Vignette', min: 0, max: 1, step: .01, get: () => L.vignette, set: v => { L.vignette = v; }, fmt: pct},
    {label: 'Colour', options: Object.keys(GRADES), get: () => L.grade, set: v => { L.grade = v; }},
    {group: 'Scene'},
    {label: 'Player', sw: () => showPlayer, set: v => { showPlayer = v; }, on: 'shown', off: 'hidden'},
    {label: 'Pose', when: () => !!live()?.emotes?.length, options: () => ['none', ...live().emotes], get: () => pose, set: setPose, fmt: v => v.replace(/_/g, ' ')},
    {label: 'HUD', sw: () => showHud, set: v => { showHud = v; hud(); }, on: 'shown', off: 'hidden'},
    {group: 'Photo'},
    {label: 'Size', options: ['1x', '2x'], get: () => size + 'x', set: v => { size = v === '2x' ? 2 : 1; remember(); }, fmt: v => `${v} · ${G.VW * G.display * (v === '2x' ? 2 : 1)} × ${G.VH * G.display * (v === '2x' ? 2 : 1)}`},
  ];
  const opts = r => typeof r.options === 'function' ? r.options() : r.options;
  const kindOf = r => r.group !== undefined ? 'group' : r.sw ? 'sw' : r.act ? 'act' : r.options ? 'choice' : 'slider';

  // ---- the DOM (made once; rows built when photo mode opens, values refreshed in place: a drag isn't cut)
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'photo'; root.className = 'hidden';
  root.innerHTML = `<div class="ph-band"></div><div class="ph-band"></div>
    <div id="ph-panel"><header><span class="ph-title">Photo</span><button class="m-close" data-close title="Back to the game">Esc</button></header>
      <div class="m-body"></div>
      <button class="m-act main" data-shot>Take photo <small>P</small></button><div class="ph-note"></div></div>
    <div class="ph-hint">WASD move · Z X turn · wheel zoom · drag to move · right-drag to turn · R back to the player · H hide panel · P photo · Esc back</div>
    <div class="ph-flash"></div>`;
  document.body.appendChild(root);
  const panel = root.querySelector('#ph-panel'), body = panel.querySelector('.m-body'), note = panel.querySelector('.ph-note'), flashEl = root.querySelector('.ph-flash');
  const bands = root.querySelectorAll('.ph-band');
  let shown = [], els = [];   // the rows on show and their elements (by index into shown)

  function rowHtml(r, i) {
    const k = kindOf(r);
    if (k === 'group') return `<h4>${esc(r.group)}</h4>`;
    if (k === 'act') return `<button class="m-row" data-i="${i}"><span>${esc(r.label)}</span><span class="m-val">›</span></button>`;
    if (k === 'slider') return `<div class="m-row ph-sl" tabindex="-1" data-i="${i}"><span>${esc(r.label)}</span><input type="range" tabindex="-1" min="${r.min}" max="${r.max}" step="${r.step}"><span class="m-val"></span></div>`;
    if (k === 'sw') return `<button class="m-row" role="switch" data-i="${i}"><span>${esc(r.label)}</span><span class="m-val"></span></button>`;
    return `<button class="m-row" data-i="${i}"><span>${esc(r.label)}</span><span class="m-val"><i data-d="-1">‹</i><b></b><i data-d="1">›</i></span></button>`;
  }
  function build() {
    shown = ROWS.filter(r => !r.when || r.when());
    // (a group with nothing under it goes)
    shown = shown.filter((r, i) => kindOf(r) !== 'group' || (shown[i + 1] && kindOf(shown[i + 1]) !== 'group'));
    body.innerHTML = shown.map(rowHtml).join('');
    els = shown.map((r, i) => body.querySelector(`[data-i="${i}"]`));
    refresh();
  }
  function refresh() {
    for (let i = 0; i < shown.length; i++) {
      const r = shown[i], el = els[i]; if (!el) continue;
      const k = kindOf(r);
      if (k === 'sw') { const on = r.sw(); el.setAttribute('aria-checked', on); el.querySelector('.m-val').textContent = on ? (r.on || 'On') : (r.off || 'Off'); }
      else if (k === 'choice') { const v = r.get(); el.querySelector('b').textContent = r.fmt ? r.fmt(v) : v; }
      else if (k === 'slider') {
        const v = r.get(), inp = el.querySelector('input');
        if (document.activeElement !== inp) inp.value = v;   // (not under the pointer: a drag isn't cut)
        el.querySelector('.m-val').textContent = r.fmt ? r.fmt(v) : (+v).toFixed(2);
        el.classList.toggle('off', !L.tilt && TILT_ROWS.has(r.label));   // (the band's rows rest while the tilt-shift is off)
      }
    }
  }
  function say(text, sec = 3) { note.textContent = text; noteT = sec; }
  // the focus band's edges, shown for a moment while it's set
  let bandT = null;
  function band() {
    const r = E.canvas.getBoundingClientRect(), c = r.top + L.focus * r.height, h = L.width / 2 * r.height;
    bands[0].style.top = Math.round(c - h) + 'px'; bands[1].style.top = Math.round(c + h) + 'px';
    for (const b of bands) b.classList.add('on');
    clearTimeout(bandT); bandT = setTimeout(() => { for (const b of bands) b.classList.remove('on'); }, 700);
  }
  const hud = () => document.body.classList.toggle('ph-nohud', open && !showHud);

  // change row i by d (choices and sliders: a step; switches flip; actions run)
  function change(i, d = 1) {
    const r = shown[i]; if (!r) return;
    const k = kindOf(r);
    if (k === 'act') { sound('confirm'); r.act(); }
    else if (k === 'sw') { r.set(!r.sw()); sound('click'); }
    else if (k === 'choice') { const o = opts(r), c = o.indexOf(r.get()); r.set(o[((c < 0 ? 0 : c + d) % o.length + o.length) % o.length]); sound('click'); }
    else if (k === 'slider') { const span = r.max - r.min, st = Math.max(r.step, span / 48); r.set(Math.max(r.min, Math.min(r.max, r.get() + d * st))); sound('hover'); }
    else return;
    refresh();
  }
  panel.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { toggle(false); return; }
    if (e.target.closest('[data-shot]')) { shoot(); return; }
    if (e.target.tagName === 'INPUT') return;
    const el = e.target.closest('[data-i]'); if (!el) return;
    change(+el.dataset.i, +(e.target.closest('[data-d]')?.dataset.d || 1));
  });
  panel.addEventListener('input', e => {
    const el = e.target.closest('[data-i]'), r = el && shown[+el.dataset.i]; if (!r || e.target.tagName !== 'INPUT') return;
    r.set(+e.target.value); refresh();
  });
  panel.addEventListener('change', e => { if (e.target.tagName === 'INPUT') { sound('click'); e.target.blur(); } });
  let hov = '';
  panel.addEventListener('pointerover', e => { const el = e.target.closest('[data-i], [data-close], [data-shot]'), k = el ? el.dataset.i ?? 'x' + (el.dataset.shot ?? '') : ''; if (k !== hov) { hov = k; if (k) sound('hover'); } });
  // the world behind: drag to move the camera (left button) or turn it (right / middle), the wheel zooms
  root.addEventListener('contextmenu', e => e.preventDefault());
  root.addEventListener('pointerdown', e => {
    if (panel.contains(e.target)) return;
    drag = {x: e.clientX, y: e.clientY, turn: studio ? e.button === 0 : e.button !== 0};   // (a studio: the left drag turns round him) root.setPointerCapture(e.pointerId); root.classList.add(drag.turn ? 'turning' : 'panning');
    if (e.button === 1) e.preventDefault();
  });
  root.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (drag.turn) dragYaw += dx * TUNE.turnDrag; else { panX += dx; panY += dy; }
  });
  const endDrag = () => { if (!drag) return; drag = null; root.classList.remove('turning', 'panning'); };
  root.addEventListener('pointerup', endDrag); root.addEventListener('pointercancel', endDrag);
  root.addEventListener('wheel', e => { if (panel.contains(e.target)) return; e.preventDefault(); cv.onWheel(e); }, {passive: false});
  addEventListener('keyup', e => { held.delete(e.key.toLowerCase()); if (e.key === 'Shift') held.delete('shift'); });
  addEventListener('blur', () => { held.clear(); endDrag(); });

  // ---- open / close
  function toggle(on = !open, st = null) {
    if (on === open) return;
    if (on) {
      if (!ph.allowed) return;
      studio = st; root.classList.toggle('ph-studio', !!st);
      if (st) { look0 = {...L}; Object.assign(L, {tilt: false, vignette: 0, grade: 'natural'}); }   // (a studio: no tilt-shift, no vignette, the colours as they are)
      if (E.pause.paused) E.pause.toggle(false, null);
      open = true; keys.clear(); E.input.cancelDrag(); held.clear(); drag = null; dragYaw = panX = panY = 0;
      at.yaw = cv.yaw; at.goal = cv.dsGoal; at.demo = E.live?.K?.demo ?? ''; at.weather = env.weather; seasonal = !!env.tinted;
      pa.hold(); cv.freeOn(host.player.x, host.player.y, host.P.z);
      pose = 'none'; showPlayer = true; for (const k in want) want[k] = null; wantDirty = false; settle = 0;
      heldT = performance.now() / 1000;
      fx.on(); fx.still = !living;
      feat('audio')?.duck?.(true);
      root.classList.remove('hidden', 'ph-clean'); document.body.classList.add('photo'); hud(); build(); say('');
      if (!st) sound('open');
      return;
    }
    open = false;
    const st0 = studio; studio = null;
    if (look0) { Object.assign(L, look0); look0 = null; }
    env.preview(null); for (const k in want) want[k] = null; wantDirty = false;
    if (pose !== 'none') setPose('none');
    fx.off();
    cv.setYaw(at.yaw); pa.release(); pa.syncPlateaus(); cv.zoomTo(at.goal, true); cv.freeOff();   // (the release after the turn back: exact; the view last)
    feat('audio')?.duck?.(false);
    root.classList.add('hidden'); document.body.classList.remove('photo', 'ph-nohud'); endDrag(); held.clear();
    remember(); sound('back');
    st0?.closed?.();
  }

  // ---- every frame while open (the loop's step): the camera, the world, nature
  function step(dt) {
    if (E.game.mode === 'title') { toggle(false); return; }   // (the game left for the title meanwhile: a run's end)
    const rot = (held.has('x') || held.has('e') ? 1 : 0) - (held.has('z') || held.has('q') ? 1 : 0), y0 = cv.yaw;
    const ny = cv.yaw + rot * ROT_SPEED * dt + dragYaw; dragYaw = 0;
    if (ny !== y0) { cv.setYaw(ny); pa.syncPlateaus(); }
    cv.stepSampling(dt, cv.yaw !== y0);
    // move: a share of the view's width per second, along the screen (W up, D right); the drag moves the world with the cursor
    const mx = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0), my = (held.has('s') ? 1 : 0) - (held.has('w') ? 1 : 0), z = cv.zoom * cv.dz;   // (dz: the wheel's ease, the shown view's magnification)
    let vx = 0, vy = 0;
    if (mx || my) { const sp = TUNE.move * cv.VW / (host.PPM * z) * (held.has('shift') ? TUNE.fast : 1) * dt / Math.hypot(mx, my); vx += mx * sp; vy += my * sp * host.PPM / host.PPMY; }
    if (panX || panY) { vx -= panX / cv.scale / (host.PPM * z); vy -= panY / cv.scale / (host.PPMY * z); panX = panY = 0; }
    if (vx || vy) { const [wx, wy] = cv.toWorld(vx, vy); cv.freeMove(wx, wy); }
    if (wantDirty) { applyWant(); refresh(); }
    const moving = living || settle > 0 || !!studio;
    if (moving) { E.pause.stepPaused(dt); if (!living) settle = Math.max(0, settle - dt); }
    fx.still = !moving;
    if (noteT > 0 && (noteT -= dt) <= 0 && !busy) note.textContent = '';
    if ((panelT -= dt) <= 0) { panelT = .25; refresh(); }   // (the size after a zoom, a value a key changed: a few times a second)
    studio?.step?.(dt);
  }

  // ---- keys (core/input.js hands them all over while open)
  const NAV = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
  function key(k, e) {
    if (k === 'tab' || k.startsWith('arrow') || k === ' ' || k === 'enter') e.preventDefault();   // (Enter / Space: not the browser's button press too)
    if (k === 'shift') { held.add('shift'); return; }
    if (studio?.key?.(k, e)) return;
    if (e.repeat && !NAV.includes(k) && !'+-='.includes(k)) return;
    if (k === 'escape' || k === 'f4') { toggle(false); return; }
    if (k === 'h' || k === 'tab') { root.classList.toggle('ph-clean'); sound('click'); return; }
    if (k === 'p') { shoot(); return; }
    if (k === 'r' || k === 'home') { cv.freeReset(host.player.x, host.player.y, host.P.z); if (cv.yaw !== at.yaw) { cv.setYaw(at.yaw); pa.syncPlateaus(); } cv.zoomTo(at.goal); sound('click'); return; }
    if (k === '+' || k === '=' || k === '-') { cv.zoomTo(cv.dsGoal + (k === '-' ? -1 : 1)); return; }
    if ('wasdzxqe'.includes(k) && k.length === 1) { held.add(k); return; }
    // the panel: up / down a row, left / right its value, Enter / Space press it (Enter on no row: takes the photo)
    const cur = els.indexOf(document.activeElement?.closest?.('[data-i]'));
    if (k === 'arrowup' || k === 'arrowdown') {
      const d = k === 'arrowdown' ? 1 : -1; let j = cur < 0 ? (d > 0 ? -1 : els.length) : cur;
      do j += d; while (j >= 0 && j < els.length && !els[j]);
      if (j >= 0 && j < els.length) { els[j].focus({preventScroll: true}); els[j].scrollIntoView({block: 'nearest'}); sound('hover'); }
      return;
    }
    if ((k === 'arrowleft' || k === 'arrowright') && cur >= 0) { const r = shown[cur]; if (kindOf(r) === 'slider' || kindOf(r) === 'choice') change(cur, k === 'arrowright' ? 1 : -1); return; }
    if (k === 'enter' || k === ' ') { if (cur >= 0 && kindOf(shown[cur]) !== 'slider') change(cur); else if (k === 'enter') shoot(); }
  }

  // ---- the photo
  // capture(scale): the frame rendered again at scale x the screen (G.setDisplay: the art blown up by whole pixels, the HD
  // effects at full size), through the look, into a target read back: {w, h, data: RGBA rows from the bottom}
  function capture(scale = size) {
    const ds = G.display, mt = G.renderer.capabilities.maxTextureSize;
    let s = scale; while (s > 1 && (G.VW * ds * s > mt || G.VH * ds * s > mt)) s--;
    const w = G.VW * ds * s, h = G.VH * ds * s, rt = fx.target(w, h);
    if (s !== 1) G.setDisplay(ds * s);
    fx.out = rt;
    let data = null;
    try { E.loop.redraw(); data = fx.read(rt); }
    finally { fx.out = null; if (s !== 1) G.setDisplay(ds); rt.dispose(); E.loop.redraw(); }   // (the canvas again: a resize cleared it)
    // the sub-pixel camera's pad (render/camera.js: the view drawn that far past what shows, right and below) isn't in the photo
    const k = (G.sub?.pad || 0) * ds * s;
    if (k) { const W2 = w - k, H2 = h - k, d2 = new Uint8Array(W2 * H2 * 4); for (let y = 0; y < H2; y++) d2.set(data.subarray((y + k) * w * 4, ((y + k) * w + W2) * 4), y * W2 * 4); return {w: W2, h: H2, data: d2}; }
    return {w, h, data};
  }
  function toPng({w, h, data}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const q = c.getContext('2d'), im = q.createImageData(w, h), row = w * 4;
    for (let y = 0; y < h; y++) im.data.set(data.subarray((h - 1 - y) * row, (h - y) * row), y * row);   // (WebGL's rows start at the bottom)
    q.putImageData(im, 0, 0);
    return new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('no PNG')), 'image/png'));
  }
  async function shoot({download = true} = {}) {
    if (busy || !open) return null;
    busy = true; sound('confirm'); say('Saving…', 99);
    flashEl.classList.remove('go'); void flashEl.offsetWidth; flashEl.classList.add('go');
    try {
      const img = capture(size), name = photoName(), blob = await toPng(img);
      if (download) {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }
      say(`Saved ${name} · ${img.w} × ${img.h}`, 4);
      return {name, w: img.w, h: img.h, blob};
    } catch (e) { console.warn('photo: not saved', e); say('Could not save the photo', 4); return null; }
    finally { busy = false; }
  }

  const ph = {
    get open() { return open; }, get studio() { return studio; }, turn(d) { dragYaw += d; },
    get still() { return open && fx.still; }, get hidePlayer() { return open && !showPlayer; },
    get allowed() { return !open && E.game.mode !== 'title' && !host.lock; },
    toggle, step, key, capture, shoot, fx, look: L,
    time(t) { if (!fx.still) heldT = t; return heldT; },   // the draw's clock: held in a still world
    noPlayer() { E.hero.card.setVisible(false); return 0; },   // (the loop, instead of drawing him: the live hero isn't put either)
    // tests / tools: the world and the scene as the panel sets them
    setWorld(k, v) { setWant(k, v); refresh(); }, set living(v) { living = !!v; settle = 0; refresh(); }, get living() { return living; },
    set player(v) { showPlayer = !!v; refresh(); }, set pose(v) { setPose(v); refresh(); }, set size(v) { size = v === 2 ? 2 : 1; refresh(); },
    move(dx, dy) { cv.freeMove(dx, dy); }, at: () => cv.freeAt(FA),
    state: () => ({open, living, still: open && fx.still, want: {...want}, look: {...L}, size, showHud, showPlayer, pose, previewing: env.previewing}),
  };
  return ph;
}
