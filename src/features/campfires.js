// CAMPFIRES (docs/GATHERING.md, docs/BUILDING.md): the fires a player builds, burning. Since the cook-and-build slice (2026-10-15)
// they are put down, kept and shared through features/builds.js (the one path for placed things: the panel's Build list, the save,
// the co-op server); a fire's fuel is part of its build (content/builds.js: fuel s at t0, burning since). This feature is what a
// fire DOES: each log burns its def.fire.log s, E adds one from the pouch (up to def.fire.max: builds.stoke, the server's for
// everyone online), when the wood is gone it glows as embers for def.fire.embers s, then it is cold. The flames are lights.js's
// (F.flame, as the gadgets' fire pools borrow them), the light its own. Two kinds burn: the campfire and the Stone Fire Ring.
// OWNS: the fires' light records. READS: builds (the list, fire(), stoke()), pack (logs), lights (F.flame).
// A fire with a shared pot on it (features/builds.js b.pot) draws it (F.drawPot) and its E is a spoon first (builds.spoon).
// API: burningNear(x, y, r) (features/meals.js cooks at a burning fire), burningAt(x, y, r) -> the nearest burning one | null
//   (features/cooking.js: its stick), F.fires (the burning kinds' builds, live). A cook.flare (the stick's just-right moment) makes
//   the fire under it flare up for FLARE.s s (view).
// BUDGET: sim: nothing. View: a flame and a light a burning fire a frame.
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';
import {MEALS, nameOf} from '../content/meals.js';

const ON = flags.get('campfires') !== '0';
const MOST = 32;   // fire light records kept (the nearest first is lighting's; past this they are dropped)
const FLARE = {s: .7, size: .6, light: .5};   // a flare (cook.flare): s long, x(1 + this) on the flame's size and the light
// a shared pot's look (content/builds.js POT): hung from a tripod (legs out m, apex up m) over the flames: iron body (m up, r), its
// broth in the dish's colour, steam (puffs a s, rise m/s, life s)
const POTL = {legs: .5, apex: 1.15, h: .42, r: .13, iron: '#2c2824', rim: '#4a443c', leg: '#5a4028', steam: {rate: 3, rise: .5, life: 1.6, col: '#d8d4cc'}};

// ORDER (core/features.js): after the builds (its list), before lights (its flames are drawn through lights.js F.flame within the frame)
export const order = {after: ['builds'], before: ['lights']};

export async function create(host) {
  const pack = () => host.feature('pack');
  const game = () => host.feature('game');
  const ui = () => game()?.ui || null;
  const builds = () => host.feature('builds');
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const LOUT = [], LREC = Array.from({length: MOST}, () => ({x: 0, y: 0, h: 0, color: '', radius: 0, intensity: 0, flicker: 0, id: 0}));
  const fires = [];   // the builds that burn (refilled when the list changes)
  let seen = -1;
  function sync() {
    const B = builds(); if (!B || B.ver === seen) return fires;
    seen = B.ver; fires.length = 0;
    for (const b of B.list.values()) if (b.def.fire) fires.push(b);
    return fires;
  }
  const fireOf = p => p.build ? builds()?.list.get(p.build) : null;
  const flares = new Map();   // a build -> s of flare left (view)
  const flareK = b => { const s = flares.get(b); return s ? s / FLARE.s : 0; };
  const POT3 = {size: 3}, POT2 = {size: 2}, STP = {size: 2, alpha: .4};
  const STEAM = Array.from({length: 24}, () => ({on: false, x: 0, y: 0, h: 0, t: 0}));
  const steam = (x, y, h) => { for (const s of STEAM) if (!s.on) { s.on = true; s.x = x + (Math.random() - .5) * .12; s.y = y + (Math.random() - .5) * .12; s.h = h; s.t = 0; return; } };

  const F = {
    name: 'campfires', label: 'Campfires', on: ON,
    get fires() { return sync(); },
    check: () => builds()?.check('campfire') ?? 'no builds',   // (tests, the panel: '' = a fire can go down ahead of him, else why not)
    interact(p) {
      const b = fireOf(p); if (!b?.def.fire) return false;
      if (builds().hasPot?.(b) && !builds().hadSpoon(b)) { const w = builds().spoon(b); if (w) ui()?.float(p.x, p.y, 1.3, w, '#e8a070'); return true; }   // (a pot on it: a spoon first)
      const why = builds().stoke(b);
      if (why) ui()?.float(p.x, p.y, 1.3, why, why === 'it burns well' ? '#ffb060' : '#e8a070');
      return true;
    },
    prompt(p) {
      const b = fireOf(p); if (!b?.def.fire) return null;
      if (builds().hasPot?.(b) && !builds().hadSpoon(b)) return {text: `E  a spoon of ${nameOf(b.pot.dish, b.pot.q).toLowerCase()} (${b.pot.left} left)`, color: '#ffb060'};
      const n = pack()?.count('log') || 0;
      return {text: n ? `E  add a log (${n})` : 'no logs in the pouch', color: n ? '#ffb060' : '#e8a070'};
    },
    frame() {
      if (!active()) return;
      const L = host.feature('lights'), flames = L?.on !== false && L?.flame ? L : null, B = builds(); if (!flames || !B) return;
      for (const b of sync()) {
        const f = B.fire(b), D = b.def.fire, k = clamp(f.fuel / (D.log * 2.2), 0, 1.1), big = b.kind === 'fire_ring' ? 1.25 : 1;
        const fl = 1 + FLARE.size * flareK(b);
        if (f.fuel > 0) flames.flame(b.p, 'camp', '#ffa040', b.x, b.y + .01, b.z + .1, big * fl, .88 * (.3 + .7 * k), (.42 + .58 * k) * fl);
        if (b.pot && B.hasPot(b)) F.drawPot(b.x, b.y, b.z, MEALS[b.pot.dish]?.col || '#c8b8a0');
      }
      for (const s of STEAM) if (s.on) { STP.alpha = .4 * (1 - s.t / POTL.steam.life); host.point(s.x, s.y, s.h, POTL.steam.col, STP); }
    },
    lights() {   // (the records reused: one per fire, no allocation a frame)
      LOUT.length = 0; if (!active()) return LOUT;
      const B = builds(); if (!B) return LOUT;
      let i = 0;
      for (const b of sync()) {
        if (i >= MOST) break;
        const f = B.fire(b), D = b.def.fire, k = clamp(f.fuel / (D.log * 2.2), 0, 1.1), e = f.fuel > 0 ? 0 : f.ember / D.embers, r = LREC[i];
        if (f.fuel <= 0 && e <= 0) continue;
        r.x = b.x; r.y = b.y; r.id = 9810 + i; i++;
        if (f.fuel > 0) { const fl = 1 + FLARE.light * flareK(b); r.h = b.z + .3 + .45 * Math.min(1, k); r.color = '#ffa048'; r.radius = D.light * (.6 + .4 * k) * fl; r.intensity = 1.25 * (.28 + .72 * k) * fl; r.flicker = .55; }
        else { r.h = b.z + .15; r.color = '#ff5a20'; r.radius = 2.2; r.intensity = .5 * e; r.flicker = .25; }
        LOUT.push(r);
      }
      return LOUT;
    },
    hud: () => { const B = builds(); return active() && B && sync().length ? 'campfires ' + fires.map(b => { const f = B.fire(b); return f.fuel > 0 ? Math.round(f.fuel) + 's' : f.ember > 0 ? 'embers' : 'cold'; }).join(' ') : ''; },
    // a fire burning within r m of (x, y)? (features/meals.js: cooking needs one)
    burningNear(x, y, r) { const B = builds(); if (!B) return false; for (const b of sync()) if (Math.hypot(b.x - x, b.y - y) <= r && B.fire(b).fuel > 0) return true; return false; },
    burningAt(x, y, r) { const B = builds(); if (!B) return null; let best = null, bd = r; for (const b of sync()) { const d = Math.hypot(b.x - x, b.y - y); if (d <= bd && B.fire(b).fuel > 0) { bd = d; best = b; } } return best; },
    view(dt, evs) {   // the flares: a cook.flare makes the fire under it flare up, then it settles; the pots' steam
      if (evs) for (const e of evs) if (e.type === 'cook.flare') { const b = F.burningAt(e.x, e.y, 1); if (b) flares.set(b, FLARE.s); }
      for (const [b, s] of flares) { if (s - dt <= 0) flares.delete(b); else flares.set(b, s - dt); }
      const B = builds(), S = POTL.steam;
      if (B && active()) for (const b of sync()) if (b.pot && Math.random() < dt * S.rate && B.hasPot(b)) steam(b.x, b.y, b.z + POTL.h + .1);
      for (const s of STEAM) if (s.on) { if ((s.t += dt) >= S.life) s.on = false; else s.h += S.rise * dt; }
    },
    // a pot hung over a fire at (x, y, z): the tripod, the iron, the broth (col). Also the slow game's (features/cooking.js)
    drawPot(x, y, z, col) {
      const L = POTL, top = z + L.apex, h = z + L.h;
      for (let i = 0; i < 3; i++) { const a = i * 2.094 + .5; host.line(x + Math.cos(a) * L.legs, y + Math.sin(a) * L.legs, z, x, y, top, L.leg); }
      host.line(x, y, top, x, y, h + L.r, L.rim);
      for (let i = 0; i < 6; i++) { const a = i * 1.047; host.point(x + Math.cos(a) * L.r, y + Math.sin(a) * L.r, h, L.iron, POT3); }
      host.point(x, y, h - .05, L.iron, POT3);
      host.point(x, y, h + .06, col, POT2); host.point(x + .05, y, h + .06, col, POT2); host.point(x - .05, y + .02, h + .06, col, POT2);
    },
  };
  return F;
}
