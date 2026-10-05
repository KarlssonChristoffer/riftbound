// INPUT: the keyboard and the mouse. Keys go to photo mode while it's open (ui/photo.js: F4 opens it; it has its own
// mouse over the screen, and the game's cursor rests meanwhile), to the menu while paused, to the game alone while host.lock (or a dev key
// outside dev mode), else to the features (F.onKey, then their hotkey toggles), then the player's own keys, then the dev
// keys (dev/devkeys.js, handed in by the boot as E.dev). The mouse: the cursor in the view (at zoom 1, as player.js
// reads it), the bow (LMB), abilities (RMB), turning the camera by dragging with the middle button, the wheel's zoom.
// OWNS: the drag (dragging, dragX, dragYaw: the yaw the drag asks for since the last sim step).
// WRITES: keys, mouse (the shared input state player.js reads).  READS: E (main.js).
//   const input = createInput(E); input.dragging / takeYaw() (the loop: the drag's yaw, once) / look(dx) (the menu's
//   backdrop drag) / cancelDrag() / remap() (the loop, after the camera: the cursor on the image as it slid this frame)
import {BUSY} from '../sim/player/player.js';

export function createInput(E) {
  const {canvas, keys, mouse, cv, host, features, events, PL, P, pa, perf, applyOpts, setYaw} = E, {DEV_KEYS, abKey, devKey} = E.dev;
  let dragging = false, dragX = 0, dragYaw = 0;
  const claimed = k => { for (const f of features) if (f.claims?.(k)) return true; return false; };
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase(), pause = E.pause;
    if (E.photo?.open && k !== 'f3') { E.photo.key(k, e); return; }   // photo mode has the keys, Escape too (ui/photo.js)
    if (k === 'escape') { if (!e.repeat) pause.toggle(); return; }
    if (k === 'f3') { e.preventDefault(); if (!e.repeat) { perf.toggle(); pause.menu.refresh(); } return; }   // the frame profiler
    if (k === 'f4') { e.preventDefault(); if (!e.repeat) E.photo?.toggle(true); return; }   // photo mode (also from the menu)
    if (pause.paused) { pause.menu.key(k, e); return; }   // the menu has the keys: arrows, Tab, Enter
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
    if (e.repeat) return;
    // locked (menus, death, travel) or a dev key outside dev mode: only the game hears it (unless a feature claims that key
    // for play while it's on: F.claims(k), the equipment experiment's F)
    if (host.lock || (!host.dev && ((DEV_KEYS.has(k) && !claimed(k)) || (e.shiftKey && /^Digit[1-6]$/.test(e.code))))) { E.game.onKey?.(k, e); return; }
    if (abKey(e, E)) { applyOpts(); return; }   // renderer A/B (Shift + 1..6)
    keys.add(k);
    for (const f of features) if (f.onKey?.(k, e)) return;
    for (const f of features) if (f.key && f.key === k && f.toggle) { f.toggle(); return; }
    if (k === ' ') {   // a leap's player.jump is emitted here, between steps: into world coordinates like the step's own
      const n0 = events.length; PL.onSpace(); for (let i = n0; i < events.length; i++) pa.toWorldEvent(events[i]);
    }
    if (k === 'e') { if (!pa.nearProp() && pa.climbSpotW() && Math.abs(cv.yaw) > 1e-6 && !BUSY.has(P.state)) pa.assist = {back: cv.yaw, phase: 'in'}; else PL.onInteractKey(); }
    if (k >= '1' && k <= '4' && !BUSY.has(P.state)) features.some(f => f.ability?.(+k));
    devKey(k, e, E);
    if (k === 'home') setYaw(0);
    applyOpts();
  });
  addEventListener('keyup', e => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'e') PL.onInteractUp(); });
  addEventListener('blur', () => { keys.clear(); mouse.down = false; dragging = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  // the cursor as the screen shows it: mx0, my0 = where it fell (view px at zoom 1, as the player reads it) on the image as
  // drawn, k0 = view px per canvas px then; the sub-pixel camera slides the image by whole canvas px every frame (G.sub,
  // render/camera.js), so remap() (the loop: after the camera, every frame) takes what's under a still cursor now
  let mx0 = NaN, my0 = NaN, k0 = 0;
  const remap = () => { if (mx0 === mx0) { mouse.x = mx0 - E.G.sub.x * k0; mouse.y = my0 - E.G.sub.y * k0; } };
  addEventListener('mousemove', e => {
    if (E.photo?.open) return;   // (photo mode: the cursor isn't the game's; it's where it was when you come back)
    const r = canvas.getBoundingClientRect(), s = r.width / cv.VW, mx = (e.clientX - r.left) / s, my = (e.clientY - r.top) / s;
    mx0 = cv.VW / 2 + (mx - cv.VW / 2) / cv.zoom; my0 = cv.VH / 2 + (my - cv.VH / 2) / cv.zoom; k0 = 1 / (s * cv.zoom);   // the player reads the screen at zoom 1
    remap();
    if (dragging) { dragYaw += (e.clientX - dragX) * -.006; dragX = e.clientX; }
  });
  canvas.addEventListener('mousedown', e => {
    if (E.pause.paused || host.lock || E.photo?.open) return;
    if (e.button === 0) { PL.press(); mouse.down = true; }
    if (e.button === 1) { e.preventDefault(); dragging = true; dragX = e.clientX; }
    if (e.button === 2 && !BUSY.has(P.state)) features.some(f => f.ability?.('rmb'));
  });
  addEventListener('mouseup', e => { if (e.button === 0) { if (!E.pause.paused && !E.photo?.open) PL.release(); mouse.down = false; } if (e.button === 1) dragging = false; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); cv.onWheel(e); }, {passive: false});
  return {
    get dragging() { return dragging; },
    takeYaw() { const d = dragYaw; dragYaw = 0; return d; },
    look(dx) { dragYaw += dx * -.006; },
    cancelDrag() { dragging = false; },
    remap,
  };
}
