// Gamepad input (Xbox / PlayStation, standard mapping) with edge detection, radial dead zones and rumble.
export const BTN = {a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15};
export const Pad = {connected: false, type: 'xbox', btn: [], prev: [], ls: {x: 0, y: 0}, rs: {x: 0, y: 0}, gp: null};

const GLYPHS = {
  xbox: {[BTN.a]: 'A', [BTN.b]: 'B', [BTN.x]: 'X', [BTN.y]: 'Y', [BTN.lb]: 'LB', [BTN.rb]: 'RB', [BTN.lt]: 'LT', [BTN.rt]: 'RT', [BTN.view]: 'View', [BTN.r3]: 'R3'},
  ps: {[BTN.a]: '✕', [BTN.b]: '○', [BTN.x]: '□', [BTN.y]: '△', [BTN.lb]: 'L1', [BTN.rb]: 'R1', [BTN.lt]: 'L2', [BTN.rt]: 'R2', [BTN.view]: 'Share', [BTN.r3]: 'R3'},
};
export const glyph = b => GLYPHS[Pad.type][b];

function stick(x, y, dead = .2) {
  const m = Math.hypot(x, y); if (m < dead) return {x: 0, y: 0};
  const k = Math.min(1, (m - dead) / (1 - dead)) / m; return {x: x * k, y: y * k};
}
export function pollPad() {
  const gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(g => g && g.connected);
  if (!gp) { Pad.connected = false; Pad.gp = null; return null; }
  Pad.connected = true; Pad.gp = gp;
  Pad.type = /054c|dualsense|dualshock|playstation/i.test(gp.id) ? 'ps' : 'xbox';
  Pad.prev = Pad.btn; Pad.btn = gp.buttons.map(b => b.pressed || b.value > .5);
  Pad.ls = stick(gp.axes[0] || 0, gp.axes[1] || 0); Pad.rs = stick(gp.axes[2] || 0, gp.axes[3] || 0);
  return Pad;
}
export const pressed = b => !!Pad.btn[b] && !Pad.prev[b];
export const held = b => !!Pad.btn[b];
export const released = b => !Pad.btn[b] && !!Pad.prev[b];
export const anyInput = () => Pad.btn.some(Boolean) || Pad.ls.x || Pad.ls.y || Pad.rs.x || Pad.rs.y;
export function rumble(strong, weak, ms) {
  const a = Pad.gp && Pad.gp.vibrationActuator;
  if (a && a.playEffect) a.playEffect('dual-rumble', {duration: ms, strongMagnitude: strong, weakMagnitude: weak}).catch(() => {});
}
