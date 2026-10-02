// CYLINDER: a gun loadout's ammo on the HD overlay: the revolver's chambers seen from behind, at the bottom centre where
// the bow's ability bar has its slots (combat/draw.js keeps the gold left of it). Brass = a round, dark = spent; the
// chamber under the hammer (12 o'clock) fires next and the cylinder turns a chamber with every shot (counter-clockwise,
// as a Colt's does). Reloading, the chamber being filled fades in round by round; closed, it spins home. Empty: "R".
// OWNS: its turn (presentation, eased on the frame's real time). READS: the revolver's S (sim/player/gun.js), the weapon.
// BUDGET: ui; a cached blit while still (measured ~.08 ms a frame drawn live), live only while it turns or reloads.
import {clamp} from '../core/mathx.js';

const FONT = '"Segoe UI", system-ui, sans-serif', TAU = Math.PI * 2;
const COL = {back: 'rgba(12,10,16,.55)', rim: '#16141c', steel: '#4a4652', steelHi: '#625e6c', brass: '#d8a93c', brassHi: '#ffe08a',
  primer: '#9a7a3a', spent: '#0c0a10', ready: '#f2d27a', idle: '#6a6470', text: '#f4efe4', warn: '#ffb070'};

export function createCylinder() {
  let turn = 0, spin = 0, seen = -1, act = '', last = 0;
  // still (no turn, no spin, no reload): painted once into a cache and blitted (text + arcs cost ~.08 ms a frame live)
  let cache = null, key = '';
  function draw(q, sc, S, w) {
    const now = performance.now(), dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now;
    if (seen < 0 || S.shotN < seen) seen = S.shotN;
    if (S.shotN !== seen) { turn = Math.min(3, turn + S.shotN - seen); seen = S.shotN; }   // a chamber per shot
    if (act === 'reload' && S.act !== 'reload' && S.ammo === S.cap) spin = 1;   // closed: a spin home
    act = S.act;
    turn = Math.max(0, turn - dt * 14); spin = Math.max(0, spin - dt * 1.8);
    const W = q.canvas.width, HH = q.canvas.height, Sz = Math.round(clamp(sc * 12, 26, 56));   // (the ability bar's slot size)
    const R = Math.round(Sz * .78), cx = Math.round(W / 2), cy = Math.round(HH - Sz * .35 - Sz * .3 - 8 - R);   // (its label below)
    if (turn > 0 || spin > 0 || S.act === 'reload') { key = ''; paint(q, cx, cy, R, Sz, S, w); return; }
    const k = `${Sz}|${S.ammo}|${S.cap}|${S.out}|${w.name}`, bw = Math.round(Math.max(2 * R + 16, Sz * 4)), bh = Math.round(2 * R + R * .3 + Sz * .3 + 22);
    if (k !== key) {
      cache ??= document.createElement('canvas');
      if (cache.width !== bw || cache.height !== bh) { cache.width = bw; cache.height = bh; }
      const c = cache.getContext('2d'); c.clearRect(0, 0, bw, bh); paint(c, bw / 2, Math.round(R + R * .3 + 8), R, Sz, S, w); key = k;
    }
    q.drawImage(cache, cx - bw / 2, cy - Math.round(R + R * .3 + 8));
  }
  function paint(q, cx, cy, R, Sz, S, w) {
    const n = S.cap, step = TAU / n;
    const a0 = -Math.PI / 2 + (turn + spin * spin * n) * step;   // chamber i sits at a0 + i step (i = 0: the next shot)
    q.save();
    q.fillStyle = COL.back; q.beginPath(); q.arc(cx, cy, R + 6, 0, TAU); q.fill();
    q.fillStyle = COL.steel; q.beginPath(); q.arc(cx, cy, R, 0, TAU); q.fill();
    q.strokeStyle = COL.rim; q.lineWidth = Math.max(1.5, R * .07); q.stroke();
    // the flutes between the chambers (turning with them)
    q.fillStyle = COL.steelHi;
    for (let i = 0; i < n; i++) { const a = a0 + (i + .5) * step; q.beginPath(); q.arc(cx + Math.cos(a) * R * .84, cy + Math.sin(a) * R * .84, R * .12, 0, TAU); q.fill(); }
    const reload = S.act === 'reload', cr = R * .23, rr = R * .56;
    for (let i = 0; i < n; i++) {
      const a = a0 + i * step, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      q.fillStyle = COL.spent; q.beginPath(); q.arc(x, y, cr, 0, TAU); q.fill();
      const k = i < S.ammo ? 1 : reload && S.rph === 'load' && i === S.ammo ? S.reloadK : 0;   // a round, or the one going in
      if (k <= 0) continue;
      q.globalAlpha = k;
      q.fillStyle = COL.brass; q.beginPath(); q.arc(x, y, cr * .86, 0, TAU); q.fill();
      q.fillStyle = COL.brassHi; q.beginPath(); q.arc(x - cr * .28, y - cr * .28, cr * .28, 0, TAU); q.fill();
      q.fillStyle = COL.primer; q.beginPath(); q.arc(x, y, cr * .3, 0, TAU); q.fill();
      q.globalAlpha = 1;
    }
    q.fillStyle = COL.rim; q.beginPath(); q.arc(cx, cy, R * .14, 0, TAU); q.fill();   // the pin
    // the hammer's notch at 12 o'clock: gold when a shot is ready
    q.fillStyle = S.out && S.ammo > 0 && !reload ? COL.ready : COL.idle;
    q.beginPath(); q.moveTo(cx, cy - R + 1); q.lineTo(cx - R * .17, cy - R - R * .3); q.lineTo(cx + R * .17, cy - R - R * .3); q.closePath(); q.fill();
    const empty = !S.ammo && !reload, label = empty ? 'R  reload' : reload ? 'reloading' : w.name;
    q.font = `700 ${Math.max(10, Math.round(Sz * .24))}px ${FONT}`; q.textAlign = 'center'; q.textBaseline = 'top';
    q.lineJoin = 'round'; q.lineWidth = 3; q.strokeStyle = 'rgba(10,8,12,.9)'; q.strokeText(label, cx, cy + R + 5);
    q.fillStyle = empty ? COL.warn : COL.text; q.fillText(label, cx, cy + R + 5);
    q.restore();
  }
  return {draw};
}
