// CAMPFIRES (docs/GATHERING.md, docs/BUILDING.md): the fires a player builds, burning. Since the cook-and-build slice (2026-10-15)
// they are put down, kept and shared through features/builds.js (the one path for placed things: the panel's Build list, the save,
// the co-op server); a fire's fuel is part of its build (content/builds.js: fuel s at t0, burning since). This feature is what a
// fire DOES: each log burns its def.fire.log s, E adds one from the pouch (up to def.fire.max: builds.stoke, the server's for
// everyone online), when the wood is gone it glows as embers for def.fire.embers s, then it is cold. The flames are lights.js's
// (F.flame, as the gadgets' fire pools borrow them), the light its own. Two kinds burn: the campfire and the Stone Fire Ring.
// RAIN puts an open campfire out (features/builds.js decides it: docs/WEATHER.md); its fire.doused event hisses up a cloud of steam here.
// OWNS: the fires' light records, the doused fires' steam. READS: builds (the list, fire(), stoke()), pack (logs), lights (F.flame).
// API: burningNear(x, y, r) (features/meals.js cooks at a burning fire), F.fires (the burning kinds' builds, live).
// BUDGET: sim: nothing. View: a flame and a light a burning fire a frame.
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';

const ON = flags.get('campfires') !== '0';
const MOST = 32;   // fire light records kept (the nearest first is lighting's; past this they are dropped)

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
  const HISS = Array.from({length: 4}, () => ({x: 0, y: 0, h: 0, t: 9})), STEAM = [.8, .82, .84];   // (a doused fire's steam: x, y, its ground, s since)

  const F = {
    name: 'campfires', label: 'Campfires', on: ON,
    get fires() { return sync(); },
    check: () => builds()?.check('campfire') ?? 'no builds',   // (tests, the panel: '' = a fire can go down ahead of him, else why not)
    interact(p) {
      const b = fireOf(p); if (!b?.def.fire) return false;
      const why = builds().stoke(b);
      if (why) ui()?.float(p.x, p.y, 1.3, why, why === 'it burns well' ? '#ffb060' : '#e8a070');
      return true;
    },
    prompt(p) {
      const b = fireOf(p); if (!b?.def.fire) return null;
      const n = pack()?.count('log') || 0;
      return {text: n ? `E  add a log (${n})` : 'no logs in the pouch', color: n ? '#ffb060' : '#e8a070'};
    },
    view(dt, evs) {   // (the steam off a fire the rain put out: a few seconds of it)
      for (const h of HISS) h.t += dt;
      for (let k = 0; k < evs.length; k++) { const e = evs[k]; if (e.type !== 'fire.doused') continue; let o = HISS[0]; for (const h of HISS) if (h.t > o.t) o = h; o.x = e.x; o.y = e.y; o.h = host.elev(e.x, e.y); o.t = 0; }
    },
    frame(f) {
      if (!active()) return;
      for (const h of HISS) if (h.t < 4) for (let i = 0; i < 5; i++) {   // (rising, spreading, thinning: a pure function of its time)
        const u = ((h.t * .7 + i * .2) % 1), a = .25 * (1 - u) * (1 - h.t / 4);
        host.G.fx(h.x + Math.sin(i * 2.4 + h.t) * .15 * u, h.h + .2 + u * 1.4, h.y + Math.cos(i * 1.7) * .1 * u, .1 + u * .3, STEAM, a, 'blend');
      }
      const L = host.feature('lights'), flames = L?.on !== false && L?.flame ? L : null, B = builds(); if (!flames || !B) return;
      for (const b of sync()) {
        const f = B.fire(b), D = b.def.fire, k = clamp(f.fuel / (D.log * 2.2), 0, 1.1), big = b.kind === 'fire_ring' ? 1.25 : 1;
        if (f.fuel > 0) flames.flame(b.p, 'camp', '#ffa040', b.x, b.y + .01, b.z + .1, big, .88 * (.3 + .7 * k), .42 + .58 * k);
      }
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
        if (f.fuel > 0) { r.h = b.z + .3 + .45 * Math.min(1, k); r.color = '#ffa048'; r.radius = D.light * (.6 + .4 * k); r.intensity = 1.25 * (.28 + .72 * k); r.flicker = .55; }
        else { r.h = b.z + .15; r.color = '#ff5a20'; r.radius = 2.2; r.intensity = .5 * e; r.flicker = .25; }
        LOUT.push(r);
      }
      return LOUT;
    },
    hud: () => { const B = builds(); return active() && B && sync().length ? 'campfires ' + fires.map(b => { const f = B.fire(b); return f.fuel > 0 ? Math.round(f.fuel) + 's' : f.ember > 0 ? 'embers' : 'cold'; }).join(' ') : ''; },
    // a fire burning within r m of (x, y)? (features/meals.js: cooking needs one)
    burningNear(x, y, r) { const B = builds(); if (!B) return false; for (const b of sync()) if (Math.hypot(b.x - x, b.y - y) <= r && B.fire(b).fuel > 0) return true; return false; },
  };
  return F;
}
