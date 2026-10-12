// AIM: how much the game helps you aim (a prototype to feel the options: docs/AIM.md). Four modes, chosen in the menu
// (Controls > Aim; ?aim=manual | soft | lock | auto):
//   manual   as before: the shot goes where the cursor is (a target under the cursor still takes it: the adapter's ARPG hover)
//   soft     the cursor is sticky: the foe nearest the cursor within a small radius on screen takes the shot (his chest)
//   lock     a target is held: the foe nearest the cursor (anywhere on screen) is locked, and stays locked until he falls,
//            leaves the screen or another comes clearly nearer the cursor; every shot goes to him
//   auto     he shoots by himself: the foe nearest HIM (in range, on screen) is the target, and the gun fires whenever it can
//            (the gun's own pace, reloads and all); you move, dodge, lasso, brawl
// Foes: the run's brutes and the desert's gunmen (hunter), the yard's sparring brutes, the training dummies.
// The marker: a ring at the target's feet in lock and auto (the soft mode shows none: it should feel like your own aim).
// SIM vs VIEW: aimTarget() and autoFire() are read by the player's step (sim/player/adapter.js -> player.js / gun.js): they
// read the sim's foes and the cursor, deterministic; the lock is sim state (update). The ring is presentation (frame).
// OWNS: the mode, the lock. READS: host.entities (the foes), host.player, host.mouse, the view (G.gameToScreen: what's on
//   screen, as the adapter's hover does). BUDGET: a pass over the foes (a live query: a few) when the player aims.
import {flags} from '../core/flags.js';

const MODES = ['manual', 'soft', 'lock', 'auto'];
export const TUNE = {
  softPx: 26,       // art px round the cursor (at zoom 1) the soft mode reaches
  switchK: .6,      // lock: another foe takes the lock when it's this share (or less) of the locked one's distance to the cursor
  autoRange: 14,    // m: the auto mode's reach
  chest: .62,       // share of a foe's hit height the shot aims at
};

export function create(host) {
  const flagMode = flags.get('aim');
  const S = {mode: MODES.includes(flagMode) ? flagMode : 'manual', lock: null};
  const foes = host.entities.query('aim.foes', p => !!(p.hunter || p.sparring || p.kind === 'dummy'));
  const OUT = {x: 0, y: 0, h: 0, target: null}, SC = [0, 0, 0];
  const alive = p => !p.broken && !p.gone && (p.hp > 0 || p.target);
  // a foe's chest on screen (view px at zoom 1, the cursor's frame) -> SC, or null off screen
  function screen(p) {
    const G = host.G, s = G.gameToScreen(p.x, (p.z || 0) + (p.hitH ?? 1.6) * TUNE.chest, p.y, SC), z = host.zoom || 1;
    const x = host.VW / 2 + (s[0] - host.VW / 2) / z, y = host.VH / 2 + (s[1] - host.VH / 2) / z;
    if (x < 0 || y < 0 || x > host.VW || y > host.VH) return null;
    SC[0] = x; SC[1] = y; return SC;
  }
  const cursorD = p => { const s = screen(p); return s ? Math.hypot(s[0] - host.mouse.x, s[1] - host.mouse.y) : Infinity; };
  function nearCursor(max) {
    let best = null, bd = max;
    for (const p of foes) { if (!alive(p)) continue; const d = cursorD(p); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function nearMe() {
    const P = host.player; let best = null, bd = TUNE.autoRange;
    for (const p of foes) { if (!alive(p) || !screen(p)) continue; const d = Math.hypot(p.x - P.x, p.y - P.y); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function target() {
    if (S.mode === 'soft') return nearCursor(TUNE.softPx);
    if (S.mode === 'lock') {
      const L = S.lock && alive(S.lock) && screen(S.lock) ? S.lock : null, n = nearCursor(Infinity);
      if (!L || (n && n !== L && cursorD(n) < cursorD(L) * TUNE.switchK)) S.lock = n;
      return S.lock;
    }
    if (S.mode === 'auto') return (S.lock = nearMe());
    return null;
  }
  const F = {
    name: 'aim', label: 'Aim', on: true, S, TUNE,
    // the player's aim (sim/player/adapter.js hoverFind: a feature's aim target first): the foe's chest, or null (the cursor)
    aimTarget() {
      const p = target(); if (!p) return null;
      OUT.x = p.x; OUT.y = p.y; OUT.h = (p.z || 0) + (p.hitH ?? 1.6) * TUNE.chest; OUT.target = p;
      return OUT;
    },
    // the gun fires by itself (sim/player/gun.js, through the adapter): the auto mode with a target
    autoFire() { return S.mode === 'auto' && !host.lock && !host.paused && !!nearMe(); },
    update() { if (S.mode !== 'lock' && S.mode !== 'auto') S.lock = null; else if (S.lock && !alive(S.lock)) S.lock = null; },
    // the marker: a ring of points at the locked target's feet (lock, auto)
    frame({t}) {
      const p = S.lock; if (!p || !alive(p) || S.mode === 'soft' || S.mode === 'manual' || host.playerHidden) return;
      const r = Math.max(.35, (p.hitR ?? p.r ?? .4) + .15), h = (p.z || 0) + .04, col = S.mode === 'auto' ? '#ff8a5a' : '#f2d27a';
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + t * 1.2; host.point(p.x + Math.sin(a) * r, p.y + Math.cos(a) * r, h, col, PT); }
    },
    settings: () => [{label: 'Aim', options: MODES, get: () => S.mode, set: v => { S.mode = MODES.includes(v) ? v : 'manual'; S.lock = null; }}],
    hud: () => S.mode === 'manual' ? '' : `aim <b>${S.mode}</b>${S.lock ? ' (target)' : ''}`,
  };
  const PT = {emit: true};
  return F;
}
