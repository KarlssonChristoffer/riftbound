// CALLED SHOTS (docs/exp/brawl.md): where a shot meets a desert gunman matters. The cursor over a gunman already aims at the
// height it points at (sim/player/adapter.js hoverFind); this feature reads where the shot's line passed him, before combat
// takes the hit, and has his owner (features/foes/sim.js) react:
//   the HAT    the line passes over his skull (or wide of his head through the brim): the hat flies off along the shot (no
//              damage; the shot goes on: 'pass'); he goes for it, stoops, puts it back on
//   the GUN    the line passes within TUNE.calls.gunR m of the gun in his hand (while it's out): it flies out of his hand (2 hp; the
//              shot stops there); he shakes his hand, runs for it, picks it up and draws again. The aim snaps onto his gun when
//              the cursor is within SNAP px of it on screen (it's small: a called shot wants a steady hand)
//   the LEGS   under TUNE.calls.legs m: combat's damage x legDmg (a hit mod), he staggers and limps
// A label by the zone under the cursor says which (HAT / GUN / LEG). ?calls=0: off (every hit as before).
// OWNS: the leg hit's mod (combat core hitMod), the aim's snap. READS: the gunmen (foes sim: gunPoint, recOf), the cursor (host.mouse,
// G.gameToScreen), combat core. CALLS: foes sim hatOff / disarm / stagger, combat core damage.
// BUDGET: a hit on a gunman: a few multiplies; the aim's snap: one projection per gunman while one is on screen.
import {TUNE} from '../content/foes.js';
import {flags} from '../core/flags.js';

const CL = TUNE.calls, ON = flags.get('calls') !== '0', SNAP = 4;   // (SNAP: art px from the gun on screen)
// ORDER (core/features.js): before combat in the hit chain (a hat shot never reaches its damage)
export const order = {before: ['combat']};
export async function create(host) {
  let foes = null, combat = null, legHit = null, modOn = false;
  const fsim = () => (foes ??= host.feature('foes'))?.sim || null;
  const core = () => (combat ??= host.feature('combat'))?.core || null;
  const S = {hats: 0, guns: 0, legs: 0, zone: '', zp: null};
  // where the shot's line passes him: 'hat' | 'gun' | 'legs' | '' (a ray through the hit point along the shot)
  function zone(a, p) {
    const fs = fsim(), g = fs?.recOf(p); if (!g) return '';
    const vx = a.vx, vy = a.vy, vh = a.vh || 0, l2 = vx * vx + vy * vy;
    // the gun first: the line's closest approach to the gun in his hand
    const gp = fs.gunPoint(p);
    if (gp) {
      const L2 = l2 + vh * vh, t = L2 > 1e-9 ? ((gp.x - a.x) * vx + (gp.y - a.y) * vy + (gp.h - a.h) * vh) / L2 : 0;
      const dx = a.x + vx * t - gp.x, dy = a.y + vy * t - gp.y, dh = a.h + vh * t - gp.h;
      if (dx * dx + dy * dy + dh * dh < CL.gunR * CL.gunR) return 'gun';
    }
    // his axis: the line's closest approach to it on the ground, the height there
    const t = l2 > 1e-9 ? -((a.x - p.x) * vx + (a.y - p.y) * vy) / l2 : 0;
    const d = Math.hypot(a.x + vx * t - p.x, a.y + vy * t - p.y), hc = a.h + vh * t - (p.z || 0) - (p.h || 0);
    if (g.hat && (hc > CL.head || (hc > CL.brim && d > CL.skull))) return 'hat';
    if (hc < CL.legs) return 'legs';
    return '';
  }
  function legMod(p, o, M) { if (p === legHit) { M.dmg *= CL.legDmg; legHit = null; } }
  // the aim's snap: onto the gun in a gunman's hand within SNAP px of the cursor, else onto his hat when the cursor is on it (the
  // crown's band over his head, on screen, through the game's view as the hover reads it)
  const SC = [0, 0, 0], SB = [0, 0, 0], AT = {x: 0, y: 0, h: 0, target: null};
  function snap() {
    const fs = fsim(); if (!fs || !fs.gang.length) return null;
    const G = host.G, z = host.zoom, mx = host.VW / 2 + (host.mouse.x - host.VW / 2) * z, my = host.VH / 2 + (host.mouse.y - host.VH / 2) * z;
    let best = null, bd = SNAP * z, hat = null, hn = -1e9;
    for (const g of fs.gang) {
      const p = g.p; if (p.broken || g.down) continue;
      const gp = fs.gunPoint(p);
      if (gp) { G.gameToScreen(gp.x, gp.h, gp.y, SC); const d = Math.hypot(SC[0] - mx, SC[1] - my); if (d < bd) { bd = d; best = p; AT.x = gp.x; AT.y = gp.y; AT.h = gp.h; } }
      if (g.hat && !best) {   // his hat: from the crown's band up to the hat's top, its brim's width
        const z0 = (p.z || 0) + (p.h || 0); G.gameToScreen(p.x, z0 + CL.head, p.y, SC); G.gameToScreen(p.x, z0 + p.hitH, p.y, SB);
        const w = .3 * host.PPM * z;
        if (mx > SC[0] - w && mx < SC[0] + w && my < SC[1] && my > SB[1] - 2 * z) { const n = p.x * Math.sin(host.yaw) + p.y * Math.cos(host.yaw); if (n > hn) { hn = n; hat = p; } }   // (the front-most)
      }
    }
    if (!best && hat) { best = hat; AT.x = hat.x; AT.y = hat.y; AT.h = (hat.z || 0) + (hat.h || 0) + (CL.head + hat.hitH) / 2; }
    if (!best) return null;
    AT.target = best; return AT;
  }
  const F = {
    name: 'calls', label: 'Called shots', S, on: ON,
    update() {
      if (!modOn && ON && core()) { core().hitMod(legMod, true); modOn = true; }
      legHit = null;
    },
    onArrowHit(a, p) {
      if (!ON || p.kind !== 'gunman' || p.broken) return;
      const fs = fsim(); if (!fs) return;
      const z = zone(a, p), l = Math.hypot(a.vx, a.vy) || 1;
      if (z === 'hat' && fs.hatOff(p, a.vx / l, a.vy / l)) { S.hats++; return 'pass'; }
      if (z === 'gun' && fs.disarm(p, a.vx / l, a.vy / l)) {
        S.guns++; core()?.damage(p, 2, {canCrit: false, dir: [a.vx / l * 2, a.vy / l * 2], by: a.kind || 'arrow', hx: a.x, hy: a.y, hh: a.h, ux: a.vx / l, uy: a.vy / l});
        return 'stop';
      }
      if (z === 'legs') { S.legs++; legHit = p; fs.stagger(p); }   // (combat's damage, scaled by legMod)
    },
    aimTarget() { return ON ? snap() : null; },
    hd(q, sc) {   // which zone the cursor is on (a hat, a gun, a leg): a small label beside it
      if (!ON || host.lock) return;
      const fs = fsim(); if (!fs || !fs.gang.length || host.weapon?.kind !== 'gun' || !host.PL.gun?.S.out) return;   // (while his gun is up)
      const a = host.aim(), t = a.target; S.zone = '';
      if (!t || t.kind !== 'gunman') return;
      const g = fs.recOf(t); if (!g || g.down) return;
      const rel = a.h - (t.z || 0) - (t.h || 0), gp = fs.gunPoint(t);
      const z = gp && Math.abs(a.x - gp.x) < .01 && Math.abs(a.y - gp.y) < .01 ? 'GUN' : g.hat && rel > CL.head ? 'HAT' : rel < CL.legs ? 'LEG' : '';
      if (!z) return;
      S.zone = z;
      const s = host.G.toScreen(a.x, a.h, a.y), dpr = devicePixelRatio || 1, u = Math.max(.8, Math.min(2.4, host.hudScale / 2.6));
      q.save(); host.G.hdShift?.(q, sc);
      q.font = `700 ${Math.round(9 * u)}px ui-monospace, Consolas, monospace`; q.textAlign = 'left'; q.textBaseline = 'middle';
      q.lineWidth = Math.max(2, 2.5 * u); q.strokeStyle = 'rgba(16,10,12,.85)';
      const x = s[0] * sc + 9 * u, y = s[1] * sc - 7 * u;
      q.strokeText(z, x, y); q.fillStyle = '#f2d27a'; q.fillText(z, x, y);
      q.restore();
    },
    hud: () => ON ? `calls hats ${S.hats} guns ${S.guns} legs ${S.legs}` : '',
  };
  return F;
}
