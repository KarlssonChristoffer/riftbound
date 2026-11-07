// DIZZY (features/surprises.js; content/surprises.js DIZZY): spin the camera round and round (the mouse in first person, the
// middle-button drag from above) faster than DIZZY.free rad/s for DIZZY.need rad and you're dizzy for DIZZY.dur s: the picture
// leans and sways (view/screenwarp.js), you stumble off sideways now this way, now that ('player.windX / windY' notes under
// 'dizzy', the player's own push), and you turn slowly ('player.turn'). It eases off over its last seconds.
// SIM: the count (read from the camera's yaw: input, the same at any frame rate), the time dizzy, the stumble's notes (changed
// every DIZZY.every s). VIEW: the lean.
// MULTIPLAYER: your own head: the others just see you reel about.
import {DIZZY} from '../../content/surprises.js';
import {TAU} from '../../core/mathx.js';

export function createDizzy(C) {
  const {host, R} = C;
  let lastYaw = null, spin = 0, left = 0, pushT = 0, ph = 0, k = 0;
  const TILT = {rot: 0, s: 1, dx: 0};
  function start() {
    const P = host.player; left = DIZZY.dur; spin = 0; pushT = 0;
    host.events.push({type: 'dizzy.start', x: P.x, y: P.y, t: left});
    C.toast('Dizzy', 'the world keeps turning without you', '#f0c8f0');
  }
  function stop() { left = 0; host.mods.clear('dizzy'); }
  return {
    update(dt) {
      const y = host.yaw;
      if (lastYaw !== null) {
        let d = y - lastYaw; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
        const w = Math.min(Math.abs(d), .25) / dt;   // (a jump of the camera, a mode switched, isn't a spin)
        spin = w > DIZZY.free ? spin + (w - DIZZY.free) * dt : Math.max(0, spin - DIZZY.decay * dt);
      }
      lastYaw = y;
      if (!C.active()) { if (left > 0) stop(); return; }
      if (left <= 0 && spin > DIZZY.need) start();
      if (left <= 0) return;
      if ((left -= dt) <= 0) { stop(); return; }
      if ((pushT -= dt) <= 0) {   // a new lurch: a way to drift, as strong as what's left of it
        pushT = DIZZY.every * (.6 + R() * .8);
        const a = R() * TAU, f = DIZZY.push * Math.min(1, left / 3);
        host.mods.set('dizzy', [{stat: 'player.windX', add: Math.cos(a) * f}, {stat: 'player.windY', add: Math.sin(a) * f}, {stat: 'player.turn', mul: DIZZY.turn}]);
      }
    },
    view(dt) {
      const want = left > 0 ? Math.min(1, left / 3) : 0;
      k += (want - k) * Math.min(1, dt * 2.5);
      if (k < .002 && want === 0) { if (TILT.rot || TILT.dx) { TILT.rot = 0; TILT.dx = 0; TILT.s = 1; C.warp.clear('dizzy'); } ph = 0; return; }
      ph += dt;
      TILT.rot = Math.sin(ph * 1.7) * DIZZY.tilt * k; TILT.dx = Math.sin(ph * 1.1 + 1) * 14 * k; TILT.s = 1 + .06 * k;
      C.warp.set('dizzy', TILT);
    },
    camera() { return null; },
    chip() { return left > 0 ? {text: `Dizzy ${Math.ceil(left)}s`, col: '#f0c8f0'} : null; },
    menu: () => [{label: 'Surprise: make me dizzy', run: () => C.queue(start)}],
    dispose() { host.mods.clear('dizzy'); C.warp.clear('dizzy'); },
  };
}
