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
  let dragging = false, dragX = 0, dragYaw = 0, lmbF = false;   // (lmbF: a feature took this LMB press)
  const claimed = k => { for (const f of features) if (f.claims?.(k)) return true; return false; };
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase(), pause = E.pause;
    if (E.photo?.open && k !== 'f3') { E.photo.key(k, e); return; }   // photo mode has the keys, Escape too (ui/photo.js)
    if (E.loop?.screen) { E.loop.screen.key(k, e); return; }   // a screen of its own holds the game: its keys (core/loop.js hold)
    if (k === 'escape') { if (!e.repeat && (pause.paused || !features.some(f => f.escape?.()))) pause.toggle(); return; }   // (a feature's window shuts first: F.escape() -> true, features/panels.js)
    if (k === 'f3') { e.preventDefault(); if (!e.repeat) { perf.toggle(); pause.menu.refresh(); } return; }   // the frame profiler
    if (k === 'f4') { e.preventDefault(); if (!e.repeat) E.photo?.toggle(true); return; }   // photo mode (also from the menu)
    if (k === 'f1') e.preventDefault();   // (not the browser's help page: F1 is the key help, dev/devkeys.js)
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
    if (k === 'e') { if (!pa.climbAssist()) PL.onInteractKey(); }   // (at a climb spot facing away: the camera turns to the wall first)
    if (k >= '1' && k <= '4' && !BUSY.has(P.state)) features.some(f => f.ability?.(+k));
    devKey(k, e, E);
    if (k === 'home') setYaw(0);
    applyOpts();
  });
  addEventListener('keyup', e => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'e') PL.onInteractUp(); });
  addEventListener('blur', () => { keys.clear(); mouse.down = false; dragging = false; PL.fists?.release('L'); PL.fists?.release('R'); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  // the cursor as the screen shows it: cx0, cy0 = where it is on the page (css px). remap() (the loop: after the camera,
  // every frame) reads what's under it now on the image as drawn (view px, as the player reads it): the wheel's ease
  // magnifies the image about the middle of what shows (cv.dz) and the sub-pixel camera slides it by whole canvas px
  // (G.sub, render/camera.js), so a still cursor's point moves. The canvas's place and scale are the camera's (cv.fit)
  let cx0 = NaN, cy0 = NaN;
  const remap = () => {
    if (cx0 !== cx0) return;
    const s = cv.scale, mx = (cx0 - cv.cl) / s, my = (cy0 - cv.ct) / s, hx = (cv.VW - cv.pad) / 2, hy = (cv.VH - cv.pad) / 2;
    mouse.x = hx + (mx - hx) / cv.dz - E.G.sub.x / s; mouse.y = hy + (my - hy) / cv.dz - E.G.sub.y / s;
  };
  addEventListener('mousemove', e => {
    if (E.photo?.open) return;   // (photo mode: the cursor isn't the game's; it's where it was when you come back)
    cx0 = e.clientX; cy0 = e.clientY;
    remap();
    if (dragging) { dragYaw += (e.clientX - dragX) * -.006; dragX = e.clientX; }
  });
  canvas.addEventListener('mousedown', e => {
    if (E.pause.paused || host.lock || E.photo?.open) return;
    // (a feature can claim LMB first: F.lmb(true) -> true takes this press and its let-go; features/fishing.js casts with it)
    if (e.button === 0) { if (features.some(f => f.lmb?.(true))) lmbF = true; else { PL.press(); mouse.down = true; } }
    if (e.button === 1) { e.preventDefault(); dragging = true; dragX = e.clientX; }
    if (e.button === 2 && !PL.pressR?.() && !BUSY.has(P.state)) features.some(f => f.ability?.('rmb'));   // (the fists up: the right hand, sim/player/fists.js)
  });
  addEventListener('mouseup', e => { if (e.button === 0) { if (lmbF) { lmbF = false; features.some(f => f.lmb?.(false)); } else if (!E.pause.paused && !E.photo?.open) PL.release(); mouse.down = false; } if (e.button === 1) dragging = false; if (e.button === 2) PL.releaseR?.(); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); cv.onWheel(e); }, {passive: false});
  return {
    get dragging() { return dragging; },
    takeYaw() { const d = dragYaw; dragYaw = 0; return d; },
    look(dx) { dragYaw += dx * -.006; },
    cancelDrag() { dragging = false; },
    remap,
  };
}
